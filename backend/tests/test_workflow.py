import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from signal_app.config import Settings
from signal_app.errors import ProviderError
from signal_app.main import create_app
from signal_app.models import Contact, Workspace
from signal_app.providers import Delivery, Enriched, Source
from signal_app.research import CopyCheck, CopyOutput, DiscoveryOutput, ProfileOutput
from signal_app.store import Neo4jStore


ORIGIN = 'http://localhost:8000'
HEADERS = {'Origin': ORIGIN}
PASSWORD = 'fixture-only-password'
FIELDS = {
    'industries': ['Renewable energy project development'], 'geography': ['United States'],
    'headcount_band': '50–500', 'revenue_band': None, 'buyer_titles': ['Director of Project Development'],
    'seniority': ['Director'], 'triggers': ['Recent project announcement'], 'exclusions': ['Develops only outside the US'],
}


def proof(source: str, quote: str) -> dict:
    return {'source_id': source, 'quote': quote}


class SimulatedProviders:
    """Provider doubles for a real local Neo4j integration test."""

    def __init__(self):
        self.sent = []
        self.lookups = []
        self.meters = []
        self.searches = []
        self.graph_evidence_used = []
        self.delivery = Delivery('sent', 'gmail-test-1')
        self.balance = Decimal('1')
        self.send_entered = Event()
        self.resume_send = None
        self.invalid_citation = False
        self.reject_copy = False
        self.reject_discovery = False
        self.only_hold = False
        self.no_contact = False
        self.recent = date.today() - timedelta(days=14)
        self.prospects = [
            Source('bright', 'https://bright.example.com/project', 'Bright Energy',
                   'Bright Energy develops utility-scale solar in the United States. It has 180 employees. '
                   'Bright Energy announced site analysis for its new solar project.', self.recent, 'tavily'),
            Source('west', 'https://west.example.com/project', 'West Energy',
                   'West Energy develops utility-scale solar in the United States. It has 100 employees. '
                   'West Energy announced site analysis for its new solar project.', self.recent, 'tavily'),
            Source('north', 'https://north.example.com/jobs', 'North Storage',
                   'North Storage develops exclusively in Ontario. North Storage plans to hire locally.', self.recent, 'tavily'),
        ]
        self.competitor = Source('siting', 'https://siting.example.com/pricing', 'Siting Tool',
                                 'Siting Tool provides parcel screening. Its public plan starts at $29 per month.', None, 'tavily')

    def close(self):
        pass

    def search(self, query, *, limit, include_details=False, source_domains=()):
        self.searches.append(query)
        return [self.competitor] if 'vendors software' in query or 'adjacent B2B' in query else self.prospects

    def complete(self, schema, instructions, context, *, max_tokens=1800):
        if schema is ProfileOutput:
            return schema.model_validate({
                'fields': FIELDS, 'confidence': {'industries': 0.8, 'revenue_band': 0.9},
                'expansion': {'segment': 'Parcel screening', 'reason': 'Existing screening workflows',
                              'evidence': proof('siting', 'Siting Tool provides parcel screening.')},
            })
        if schema is DiscoveryOutput:
            if self.reject_discovery:
                raise ProviderError('Claude', 'failed the simulated extraction.')
            def match(source, name, staff):
                summary = f'{name} announced site analysis for its new solar project.'
                industry = proof(source, f'{name} develops utility-scale solar in the United States.')
                return {
                    'name': name, 'domain': f'{source}.example.com', 'identity': industry,
                    'industry': 'Renewable energy', 'company_size': staff, 'geography': 'United States',
                    'fit': {'industry': industry, 'company_size': proof(source, f'It has {staff} employees.'),
                            'product_need': proof(source, summary), 'geography': industry},
                    'signal': {'kind': 'direct', 'summary': summary, 'evidence': proof(source, summary)},
                }

            bright = match('bright', 'Bright Energy', '180')
            results = {
                'accounts': [bright, {**bright, 'domain': 'www.bright.example.com'}, match('west', 'West Energy', '100'), {
                    'name': 'North Storage', 'domain': 'north.example.com',
                    'identity': proof('north', 'North Storage develops exclusively in Ontario.'),
                    'negative': {'reason': 'Operates outside the approved US geography.', 'hard_exclusion': True,
                                 'matched_exclusion': FIELDS['exclusions'][0],
                                 'evidence': proof('north', 'North Storage develops exclusively in Ontario.')},
                }],
                'competitor': {'name': 'Siting Tool', 'positioning': 'Parcel screening',
                               'positioning_evidence': proof('siting', 'Siting Tool provides parcel screening.'),
                               'differentiator': 'Published starting plan',
                               'differentiation_evidence': proof('siting', 'Its public plan starts at $29 per month.'),
                               'pricing': '$29/month', 'pricing_evidence': proof('siting', '$29 per month.')},
            }
            if self.only_hold:
                results['accounts'] = results['accounts'][-1:]
            return schema.model_validate(results)
        if schema is CopyOutput:
            evidence = json.loads(context)['required_graph_evidence_id']
            self.graph_evidence_used.append(evidence)
            return schema(subject='Compare sites for your solar project',
                          body='I saw your announcement about site analysis. GeoFlow helps compare proposed sites. Would a walkthrough help?',
                          evidence_ids=['unrelated'] if self.invalid_citation else [evidence])
        if schema is CopyCheck:
            return schema(supported=not self.reject_copy and 'unsupported claim' not in context)
        raise AssertionError(f'Unexpected schema: {schema}')

    def enrich(self, domain, target_role):
        self.lookups.append(domain)
        if self.no_contact:
            return Enriched('not_found', None)
        return Enriched('verified', Contact(id=f'contact-{domain}', role=target_role,
                                            email_masked=f'•••@{domain}', verification_status='valid'))

    def send(self, snapshot):
        self.sent.append(snapshot)
        self.send_entered.set()
        if self.resume_send:
            assert self.resume_send.wait(8)
        return self.delivery

    def flexprice_balance(self):
        return self.balance

    def meter(self, event):
        self.meters.append(event)


@pytest.fixture
def system(request):
    uri = os.getenv('SIGNAL_TEST_NEO4J_URI')
    if not uri:
        pytest.skip('Set SIGNAL_TEST_NEO4J_URI to a disposable Neo4j instance for integration tests.')
    params = getattr(request, 'param', {})
    settings = Settings(
        public_origin=ORIGIN, demo_password=PASSWORD, session_secret='test-secret-only-' * 4,
        neo4j_uri=uri, neo4j_password=os.getenv('SIGNAL_TEST_NEO4J_PASSWORD', ''),
        gmail_client_id='simulated', gmail_client_secret='simulated', gmail_refresh_token='simulated',
        gmail_sender='owner@example.com', test_recipient='demo@example.com', **params,
    )
    store = Neo4jStore(settings, workspace_id=f'test-{uuid4()}')
    providers = SimulatedProviders()
    with TestClient(create_app(settings, store=store, providers=providers), base_url=ORIGIN) as client:
        yield client, providers


def post(client, route, data=None, expected=200):
    result = client.post(route, json=data, headers=HEADERS)
    assert result.status_code == expected, result.json()
    return result.json()


def sign_in(client):
    return post(client, '/api/session', {'password': PASSWORD})


def approve_profile(client):
    sign_in(client)
    proposed = post(client, '/api/icp/generate', {'name': 'GeoFlow', 'description': 'Compare project development sites.'})
    assert proposed['icp']['confidence']['revenue_band'] == 0
    assert proposed['icp']['expansion']['evidence']['url'] == 'https://siting.example.com/pricing'
    assert post(client, '/api/discover', {'revision': 1}, 409)['error']['code'] == 'icp_not_approved'
    approved = post(client, '/api/icp/approve', {'revision': 1, 'fields': FIELDS, 'expansion_decision': 'dismiss'})
    assert approved['approved_icp_revision'] == 2
    assert post(client, '/api/discover', {'revision': 1}, 409)['error']['code'] == 'icp_not_approved'
    return approved['approved_icp_revision']


def discover_accounts(client):
    return post(client, '/api/discover', {'revision': approve_profile(client)})


def get_draft(client, account_id):
    state = post(client, f'/api/accounts/{account_id}/draft')
    return next(account['draft'] for account in state['accounts'] if account['id'] == account_id)


def prepare_draft(client):
    state = discover_accounts(client)
    account_id = state['accounts'][0]['id']
    draft = get_draft(client, account_id)
    return account_id, draft


def test_real_graph_flow_and_single_send(system):
    client, providers = system
    assert client.get('/api/workspace').status_code == 401
    assert client.post('/api/session', json={'password': PASSWORD}, headers={'Origin': 'https://elsewhere.example'}).status_code == 403
    state = discover_accounts(client)
    assert len(state['accounts']) == 3
    assert state['competitor']['pricing'] == '$29/month'
    assert state['accounts'][-1]['recommendation'] == 'reject'
    assert state['accounts'][-1]['negative_signal']['evidence_id']
    search_count = len(providers.searches)
    assert post(client, '/api/discover', {'revision': 2})['accounts'] == state['accounts']
    assert len(providers.searches) == search_count
    account = state['accounts'][0]
    assert [step['label'] for step in account['graph_path']] == ['Product', 'Company', 'Signal']
    assert account['fit_score'] == account['intent_score'] == 100
    draft = get_draft(client, account['id'])
    assert providers.graph_evidence_used == [account['graph_path'][-1]['evidence_id']]
    assert draft['evidence_ids'] == providers.graph_evidence_used
    assert draft['test_recipient'] == 'demo@example.com'

    path = f'/api/drafts/{draft["id"]}'
    assert post(client, path + '/send', {'revision': 1}, 409)['error']['code'] == 'approval_required'
    post(client, path + '/review', {'revision': 1, 'decision': 'reject'})
    post(client, path + '/send', {'revision': 1}, 409)
    post(client, path + '/review', {'revision': 1, 'decision': 'approve'})
    edit = client.patch(path, headers=HEADERS, json={'expected_revision': 1, 'subject': draft['subject'], 'body': draft['body'] + '\nThanks.'})
    assert edit.status_code == 200, edit.json()
    assert post(client, path + '/send', {'revision': 1}, 409)['error']['code'] == 'stale_draft_revision'
    assert post(client, path + '/send', {'revision': 2}, 409)['error']['code'] == 'approval_required'
    post(client, path + '/review', {'revision': 2, 'decision': 'approve'})
    post(client, path + '/send', {'revision': 2, 'recipient': 'unapproved@example.com'}, 422)
    assert not providers.sent

    providers.resume_send = Event()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(post, client, path + '/send', {'revision': 2})
            assert providers.send_entered.wait(5)
            duplicate = post(client, path + '/send', {'revision': 2})
            assert duplicate['accounts'][0]['draft']['dispatch_status'] == 'pending_outcome'
            assert duplicate['pipeline']['counts']['contacted'] == 0
            assert len(providers.sent) == 1
            providers.resume_send.set()
            first.result(timeout=8)
    finally:
        providers.resume_send.set()

    confirmed = post(client, path + '/send', {'revision': 2})
    assert len(providers.sent) == 1
    assert providers.sent[0].body.endswith('Thanks.')
    assert providers.sent[0].test_recipient == 'demo@example.com'
    assert confirmed['pipeline']['counts']['contacted'] == 1
    assert len(confirmed['pipeline']['events']) == 1
    assert confirmed['pipeline']['events'][0]['actor'] == 'demo'
    assert confirmed['pipeline']['matched_to_contacted_rate'] == 0.5
    assert client.get('/api/workspace').json()['pipeline'] == confirmed['pipeline']


@pytest.mark.parametrize('outcome', ['failed', 'pending_outcome'])
def test_unsuccessful_send_keeps_matched_stage(system, outcome):
    client, providers = system
    providers.delivery = Delivery(outcome)
    _, draft = prepare_draft(client)
    path = f'/api/drafts/{draft["id"]}'
    post(client, path + '/review', {'revision': 1, 'decision': 'approve'})
    for _ in range(2):
        result = post(client, path + '/send', {'revision': 1})
        assert result['accounts'][0]['draft']['dispatch_status'] == outcome
        assert result['pipeline']['counts']['contacted'] == 0
        assert result['pipeline']['events'] == []
    assert len(providers.sent) == 1


@pytest.mark.parametrize('system', [{'flexprice_enabled': True}], indirect=True)
def test_flexprice_blocks_before_hunter_despite_async_wallet(system):
    client, providers = system
    state = discover_accounts(client)
    first, second = state['accounts'][:2]
    get_draft(client, first['id'])
    assert len(providers.meters) == 1
    assert providers.meters[0].operation == 'leads_enriched'
    result = post(client, f'/api/accounts/{second["id"]}/draft', expected=402)
    assert result['error']['code'] == 'insufficient_enrichment_credits'
    assert providers.lookups == [first['domain']]
    usage = client.get('/api/workspace').json()['usage']
    assert [event['status'] for event in usage['events']] == ['accepted', 'blocked']
    assert usage['available_for_enrichment'] == 0


def test_unrelated_citation_is_rejected_and_enrichment_is_retained(system):
    client, providers = system
    providers.invalid_citation = True
    providers.no_contact = True
    account = discover_accounts(client)['accounts'][0]
    result = post(client, f'/api/accounts/{account["id"]}/draft', expected=422)
    assert result['error']['code'] == 'invalid_draft_evidence'
    saved = client.get('/api/workspace').json()['accounts'][0]
    assert saved['enrichment_status'] == 'not_found'
    assert saved['draft'] is None
    providers.invalid_citation = False
    assert get_draft(client, account['id'])['role_based'] is True
    assert len(providers.lookups) == 1


def test_rejected_generated_copy_falls_back_to_a_literal_graph_quote(system):
    client, providers = system
    providers.reject_copy = True
    account = discover_accounts(client)['accounts'][0]
    draft = get_draft(client, account['id'])
    cited = next(item['excerpt'] for item in account['evidence'] if item['id'] == draft['evidence_ids'][0])
    assert draft['synthesis_mode'] == 'grounded_template'
    assert cited in draft['body']
    assert draft['review_status'] == 'pending_review'


def test_discovery_retry_reuses_sources_after_model_failure(system):
    client, providers = system
    revision = approve_profile(client)
    providers.reject_discovery = True
    first = post(client, '/api/discover', {'revision': revision}, 502)
    assert first['error']['code'] == 'claude_unavailable'
    searches = len(providers.searches)
    providers.reject_discovery = False
    assert len(post(client, '/api/discover', {'revision': revision})['accounts']) == 3
    assert len(providers.searches) == searches


def test_weak_research_makes_at_most_one_focused_search(system):
    client, providers = system
    providers.only_hold = True
    revision = approve_profile(client)
    first = post(client, '/api/discover', {'revision': revision})
    second = post(client, '/api/discover', {'revision': revision})
    assert first['accounts'] == second['accounts']
    assert len([query for query in providers.searches if 'original developer news releases' in query]) == 1
    assert len(providers.searches) == 4


@pytest.mark.parametrize('system', [{'suppressed_recipients': frozenset({'demo@example.com'})}], indirect=True)
def test_suppressed_test_recipient_blocks_before_gmail(system):
    client, providers = system
    _, draft = prepare_draft(client)
    route = f'/api/drafts/{draft["id"]}'
    post(client, route + '/review', {'revision': 1, 'decision': 'approve'})
    blocked = post(client, route + '/send', {'revision': 1}, 409)
    assert blocked['error']['code'] == 'recipient_suppressed'
    assert not providers.sent


def test_published_fixture_matches_the_api_model():
    from pathlib import Path

    example = Path(__file__).resolve().parents[2] / 'docs' / 'workspace.example.json'
    data = Workspace.model_validate_json(example.read_text())
    assert data.accounts[0].draft.test_recipient == 'demo@example.com'
