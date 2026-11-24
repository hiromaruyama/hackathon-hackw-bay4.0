import base64
import json
from secrets import token_urlsafe
from time import time

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from google.auth import crypt, jwt

from signal_app.config import GMAIL_PUSH_PATH, Settings
from signal_app.gmail_push import GOOGLE_CERTS_URL
from signal_app.main import create_app
from signal_app.providers import Providers
from signal_app.workflow import Workflow


@pytest.fixture(scope='module')
def signing_keys():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    signer = crypt.RSASigner.from_string(pem, key_id='test-google-key')
    wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wrong_pem = wrong_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    wrong_signer = crypt.RSASigner.from_string(wrong_pem, key_id='test-google-key')
    cert = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return signer, wrong_signer, cert.decode()


def test_push_uses_signed_google_identity_and_only_its_configured_subscription(monkeypatch, signing_keys):
    settings = Settings(
        public_origin='https://signal.example.com', gmail_client_id='fixture', gmail_client_secret=token_urlsafe(24),
        gmail_feedback_refresh_token=token_urlsafe(24), gmail_sender='sender@example.com', test_recipient='test@example.com',
        gmail_pubsub_topic='projects/signal-project/topics/signal-feedback',
        gmail_pubsub_subscription='projects/signal-project/subscriptions/signal-feedback',
        gmail_pubsub_service_account='signal-push@signal-project.iam.gserviceaccount.com',
    )
    signer, wrong_signer, cert = signing_keys
    processed, cert_fetches = [], []
    monkeypatch.setattr(Workflow, 'process_gmail_notification', lambda _, history_id: processed.append(history_id))

    def certificates(request):
        assert str(request.url) == GOOGLE_CERTS_URL
        cert_fetches.append(1)
        return httpx.Response(200, json={'test-google-key': cert})

    def token(**claims):
        now = int(time())
        return jwt.encode(signer, {'iat': now - 1, 'exp': now + 120, 'iss': 'https://accounts.google.com',
                                   'aud': settings.gmail_push_audience, 'email_verified': True,
                                   'email': settings.gmail_pubsub_service_account, **claims}).decode()

    def envelope(mailbox='sender@example.com', history_id='123', subscription=None):
        data = json.dumps({'emailAddress': mailbox, 'historyId': history_id}).encode()
        return {'subscription': subscription or settings.gmail_pubsub_subscription,
                'message': {'data': base64.urlsafe_b64encode(data).decode().rstrip('='), 'messageId': 'publish-1'}}

    def post(payload, bearer=None):
        return client.post(GMAIL_PUSH_PATH, json=payload, headers={'Authorization': 'Bearer ' + bearer} if bearer else {})

    with httpx.Client(transport=httpx.MockTransport(certificates)) as http:
        # Do not enter the lifespan because this test exercises the webhook boundary only.
        client = TestClient(create_app(settings, providers=Providers(settings, http)))
        assert post(envelope()).status_code == 401
        assert post(envelope(), 'forged').status_code == 401
        assert not cert_fetches
        for claims in (
            {'email_verified': False}, {'email': 'other@signal-project.iam.gserviceaccount.com'},
            {'iss': 'https://unknown.example.com'}, {'aud': 'https://unknown.example.com'}, {'exp': int(time()) - 10},
        ):
            assert post(envelope(), token(**claims)).status_code == 401
        wrong_token = jwt.encode(wrong_signer, jwt.decode(token(), verify=False)).decode()
        assert post(envelope(), wrong_token).status_code == 401
        assert post(envelope(mailbox='other@example.com'), token()).status_code == 403
        assert post(envelope(subscription='projects/other-project/subscriptions/unknown'), token()).status_code == 403
        assert post(envelope(history_id='unexpected'), token()).status_code == 400
        assert post({'subscription': settings.gmail_pubsub_subscription, 'message': {'data': 'a' * 17_000}}, token()).status_code == 413
        assert post(envelope(), token()).status_code == 204
        assert post(envelope(history_id=124), token()).status_code == 204
        assert processed == [123, 124]
        assert len(cert_fetches) == 1
        assert client.post('/api/drafts/some-draft/send', json={'revision': 1},
                           headers={'Authorization': 'Bearer ' + token()}).status_code == 403
        assert client.post('/api/drafts/some-draft/send', json={'revision': 1},
                           headers={'Origin': settings.public_origin, 'Authorization': 'Bearer ' + token()}).status_code == 401
