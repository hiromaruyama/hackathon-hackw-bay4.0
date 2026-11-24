import base64
import json
from datetime import datetime, timezone
from decimal import Decimal
from email import policy
from email.parser import BytesParser

import httpx
import pytest

from signal_app.config import Settings
from signal_app.models import DraftRevision, UsageEvent
from signal_app.providers import Providers


def message(recipient='demo@example.com'):
    return DraftRevision(
        revision=2, subject='Review this site-analysis idea', body='Would a quick walkthrough help?',
        test_recipient=recipient, evidence_ids=['ev-1'], role_based=False, actor='demo', at=datetime.now(timezone.utc),
    )


def gmail_settings():
    return Settings(gmail_client_id='dummy', gmail_client_secret='dummy', gmail_refresh_token='dummy',
                    gmail_sender='owner@example.com', test_recipient='demo@example.com')


def test_gmail_uses_exact_mime_and_configured_recipient():
    sent = []

    def handler(request):
        if request.url.host == 'oauth2.googleapis.com':
            assert b'grant_type=refresh_token' in request.content
            return httpx.Response(200, json={'access_token': 'demo-token'})
        assert request.url.path == '/gmail/v1/users/me/messages/send'
        assert request.headers['Authorization'] == 'Bearer demo-token'
        sent.append(BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(json.loads(request.content)['raw'])))
        return httpx.Response(200, json={'id': 'test-provider-id'})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        providers = Providers(gmail_settings(), client)
        assert providers.send(message('someone@example.com')).status == 'failed'
        approval = message()
        delivery = providers.send(approval)
    assert delivery.provider_message_id == 'test-provider-id'
    assert len(sent) == 1
    assert sent[0]['To'] == approval.test_recipient
    assert sent[0]['Subject'] == approval.subject
    assert sent[0].get_content().rstrip('\n') == approval.body
    assert not sent[0]['Cc'] and not sent[0]['Bcc']


@pytest.mark.parametrize('status, expected', [(403, 'failed'), (503, 'pending_outcome'), (408, 'pending_outcome')])
def test_gmail_transport_reports_definitive_and_ambiguous_failures(status, expected):
    def handler(request):
        if request.url.host == 'oauth2.googleapis.com':
            return httpx.Response(200, json={'access_token': 'demo-token'})
        return httpx.Response(status)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert Providers(gmail_settings(), client).send(message()).status == expected


def test_flexprice_queries_wallet_and_emits_idempotent_event():
    event = UsageEvent(id='event-234', account_id='acct-1', operation='leads_enriched',
                       at=datetime.now(timezone.utc), status='pending')

    def handler(request):
        assert request.headers['x-api-key'] == 'sandbox-key'
        if request.method == 'GET':
            assert request.url.path == '/v1/customers/wallets'
            assert request.url.params['include_real_time_balance'] == 'true'
            return httpx.Response(200, json={'items': [
                {'id': 'other', 'wallet_status': 'active', 'real_time_credit_balance': '100'},
                {'id': 'wallet-1', 'wallet_status': 'active', 'real_time_credit_balance': '1.25'},
            ]})
        payload = json.loads(request.content)
        assert request.url.path == '/v1/events'
        assert payload['event_id'] == event.id
        assert payload['event_name'] == 'leads_enriched'
        assert payload['external_customer_id'] == 'demo-user'
        assert payload['properties'] == {'account_id': 'acct-1', 'quantity': '1'}
        return httpx.Response(202, json={'event_id': event.id})

    settings = Settings(flexprice_api_key='sandbox-key', flexprice_customer_id='cust-1',
                        flexprice_external_customer_id='demo-user', flexprice_wallet_id='wallet-1')
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        providers = Providers(settings, client)
        assert providers.flexprice_balance() == Decimal('1.25')
        providers.meter(event)


def test_hunter_preserves_verification_and_masks_person_address():
    def handler(request):
        assert request.url.path == '/v2/domain-search'
        assert request.url.params['domain'] == 'example.com'
        return httpx.Response(200, json={'data': {'emails': [
            {'value': 'sales@example.com', 'position': 'Sales Director', 'verification': {'status': 'valid'}},
            {'value': 'pat@example.com', 'position': 'Project Development Director',
             'verification': {'status': 'accept_all'}, 'mx_records': True},
        ]}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = Providers(Settings(hunter_api_key='test-only'), client).enrich('example.com', 'Director of Project Development')
    assert result.status == 'uncertain'
    assert result.contact.verification_status == 'accept_all'
    assert result.contact.mx_valid is True
    assert result.contact.email_masked == '•••@example.com'
    assert 'pat@' not in result.contact.model_dump_json()


def test_nexla_restricts_source_and_keeps_cited_evidence():
    def handler(request):
        assert request.url.host == 'dataops-sync.nexla.io'
        return httpx.Response(200, json={'records': [
            {'source_url': 'https://company.example.com/project', 'title': 'Project',
             'excerpt': 'Company announced a new project. Contact pat@example.com for details.'},
        ]})

    settings = Settings(nexla_sync_url='https://dataops-sync.nexla.io/sync/fixture', nexla_access_token='sandbox')
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        evidence = Providers(settings, client).nexla_sources()
    assert evidence[0].url == 'https://company.example.com/project'
    assert evidence[0].provider == 'nexla'
    assert 'pat@example.com' not in evidence[0].text
