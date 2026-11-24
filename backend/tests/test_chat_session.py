import json
from pathlib import Path
from secrets import token_urlsafe

import httpx
from fastapi.testclient import TestClient

from signal_app.config import Settings
from signal_app.main import create_app
from signal_app.models import Workspace
from signal_app.providers import Providers


ORIGIN = 'http://localhost:8000'
HEADERS = {'Origin': ORIGIN}
PASSWORD = token_urlsafe(24)
API_KEY = token_urlsafe(24)
SIGNED = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent-test&conversation_signature=sig'


class NoStore:
    def close(self):
        pass


def settings(**overrides):
    values = dict(public_origin=ORIGIN, demo_password=PASSWORD, session_secret=token_urlsafe(32),
                  elevenlabs_api_key=API_KEY, elevenlabs_agent_id='agent-test')
    values.update(overrides)
    return Settings(**values)


def client(handler, **overrides):
    calls = []

    def record(request):
        calls.append(request)
        return handler(request)

    http = httpx.Client(transport=httpx.MockTransport(record))
    config = settings(**overrides)
    app = create_app(config, store=NoStore(), providers=Providers(config, http))
    return TestClient(app), calls


def signed_in(test_client):
    assert test_client.post('/api/session', json={'password': PASSWORD}, headers=HEADERS).status_code == 200
    return test_client


def ok(_request):
    return httpx.Response(200, json={'signed_url': SIGNED})


def test_signed_url_requires_session_and_origin():
    test_client, calls = client(ok)
    assert test_client.post('/api/chat/session', json={}, headers=HEADERS).status_code == 401
    signed_in(test_client)
    assert test_client.post('/api/chat/session', json={}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert calls == []


def test_signed_url_uses_server_key_and_agent():
    test_client, calls = client(ok)
    response = signed_in(test_client).post('/api/chat/session', json={}, headers=HEADERS)
    assert response.status_code == 200
    assert response.json() == {'signed_url': SIGNED}
    assert response.headers['cache-control'] == 'no-store'
    (call,) = calls
    assert call.url.path == '/v1/convai/conversation/get-signed-url'
    assert call.url.params['agent_id'] == 'agent-test'
    assert call.headers['xi-api-key'] == API_KEY


def test_unconfigured_and_provider_failures_do_not_leak_details():
    test_client, calls = client(ok, elevenlabs_agent_id='')
    response = signed_in(test_client).post('/api/chat/session', json={}, headers=HEADERS)
    assert response.status_code == 503 and response.json()['error']['code'] == 'chat_unconfigured'
    assert calls == []

    test_client, _ = client(lambda _r: httpx.Response(401, json={'detail': f'bad key {API_KEY}'}))
    response = signed_in(test_client).post('/api/chat/session', json={}, headers=HEADERS)
    assert response.status_code == 502
    assert API_KEY not in response.text

    test_client, _ = client(lambda _r: httpx.Response(200, json={'signed_url': 'http://not-a-websocket'}))
    assert signed_in(test_client).post('/api/chat/session', json={}, headers=HEADERS).status_code == 502


def test_sessions_are_rate_limited():
    test_client, calls = client(ok)
    signed_in(test_client)
    codes = [test_client.post('/api/chat/session', json={}, headers=HEADERS).status_code for _ in range(21)]
    assert codes[:20] == [200] * 20
    assert codes[20] == 429
    assert len(calls) == 20



def test_text_chat_works_without_voice_and_uses_only_safe_workspace_fields():
    fixture = Path(__file__).resolve().parents[2] / 'docs' / 'workspace.example.json'
    workspace = Workspace.model_validate_json(fixture.read_text())
    calls = []

    class ReadOnlyStore(NoStore):
        def read(self, _view):
            return workspace

    class AssistantProvider:
        def complete(self, schema, instructions, context, *, max_tokens):
            calls.append(json.loads(context))
            return schema(reply='There is one matched account.')

    config = settings(elevenlabs_api_key='', elevenlabs_agent_id='')
    app = create_app(config, store=ReadOnlyStore(), providers=AssistantProvider())
    test_client = TestClient(app)
    payload = {'message': 'How many accounts are matched?', 'history': [{'role': 'user', 'text': 'Hello'}]}
    assert test_client.post('/api/chat/message', json=payload, headers=HEADERS).status_code == 401
    signed_in(test_client)
    assert test_client.post('/api/chat/message', json=payload, headers={'Origin': 'https://other.example'}).status_code == 403
    assert calls == []

    result = test_client.post('/api/chat/message', json=payload, headers=HEADERS)
    assert result.status_code == 200
    assert result.json() == {'reply': 'There is one matched account.'}
    (request,) = calls
    assert request['question'] == payload['message'] and request['history'] == payload['history']
    assert request['pipeline']['matched'] == 1
    assert request['accounts'][0]['evidence'][0]['title']
    assert request['accounts'][0]['draft']['evidence_ids']
    serialized = json.dumps(request)
    assert workspace.accounts[0].draft.test_recipient not in serialized
    assert workspace.accounts[0].contact.email_masked not in serialized
    assert workspace.accounts[0].draft.body not in serialized
