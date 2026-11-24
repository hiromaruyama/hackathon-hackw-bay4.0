import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from secrets import token_urlsafe
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from signal_app.config import Settings
from signal_app.errors import ProviderError
from signal_app.main import create_app
from signal_app.models import Contact, IntakeReply, Workspace
from signal_app.providers import Delivery, Enriched, GmailFeedback, Source
from signal_app.research import CopyCheck, CopyOutput, DiscoveryOutput, ProfileOutput, SequenceOutput
from signal_app.store import Neo4jStore
from signal_app.workflow import Workflow


ORIGIN = 'http://localhost:8000'
HEADERS = {'Origin': ORIGIN}
PASSWORD = token_urlsafe(24)
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
        self.intake_requests = []
        self.feedback = {}
        self.advanced_sources = False
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
                                 'Siting Tool provides parcel screening. Its public plan starts at $29 per month. '
                                 'Starter covers 10 parcels at $29 per month. Portfolio includes utility screening.', None, 'tavily')
        self.bios = [
            Source('bright-bio', 'https://bright.example.com/team', 'Bright Energy leadership',
                   'Alex Example currently works at Bright Energy and previously worked at Shared Grid. '
                   'Alex Example of Bright Energy earned a degree from Harbor University.', self.recent, 'tavily'),
            Source('west-bio', 'https://west.example.com/team', 'West Energy leadership',
                   'Sam Example currently works at West Energy and previously worked at Shared Grid.', self.recent, 'tavily'),
        ]
        self.filing = Source('bright-filing', 'https://www.sec.gov/Archives/example/bright', 'Bright Energy filing',
                             'Bright Energy will renew its GridTools contract. Bright Energy plans to replace OldScreen.', self.recent, 'tavily')
        self.job = Source('bright-job', 'https://bright.example.com/jobs/site-analyst', 'Bright Energy job posting',
                          'Bright Energy seeks an analyst to evaluate site-selection software.', self.recent, 'tavily')
        self.market = [
            Source('gis', 'https://gis.example.com/tools', 'General GIS', 'General GIS maps many kinds of spatial data.', None, 'tavily'),
            Source('manual', 'https://manual.example.com/services', 'Manual Review Co', 'Manual Review Co provides human parcel screening services.', None, 'tavily'),
        ]

    def close(self):
        pass

    def search(self, query, *, limit, include_details=False, source_domains=()):
        self.searches.append(query)
        if self.advanced_sources:
            if 'regulatory filings' in query:
                return [self.filing]
            if 'job postings' in query:
                return [self.job]
            if 'vendors software' in query:
                return [self.competitor, *self.market]
            if 'recent project' in query or 'press releases' in query:
                return [*self.prospects, *self.bios]
        return [self.competitor] if 'vendors software' in query or 'adjacent B2B' in query else self.prospects

    def complete(self, schema, instructions, context, *, max_tokens=1800, wrap_json=False):
        if schema is IntakeReply:
            request = json.loads(context)
            self.intake_requests.append(request)
            if request['history']:
                return IntakeReply(reply='Review your product details in the form.', proposal={'constraints': ['United States only']})
            return IntakeReply(reply='Which regions can you serve?', proposal={'description': 'Compare utility-scale solar development sites.'})
        if schema is ProfileOutput:
            return schema.model_validate({
                'fields': {**FIELDS, 'industry_codes': [{'system': 'NAICS', 'code': '221114'}, {'system': 'NAICS', 'code': '000000'}]},
                'confidence': {'industries': 0.8, 'revenue_band': 0.9},
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
                               'pricing': '$29/month', 'pricing_evidence': proof('siting', '$29 per month.'),
                               'plans': [
                                   {'name': 'Starter', 'price': '$29 per month', 'evidence': proof('siting', 'Starter covers 10 parcels at $29 per month.')},
                                   {'name': 'Portfolio', 'price': '$999 per month', 'evidence': proof('siting', 'Portfolio includes utility screening.')},
                                   {'name': 'Unlimited', 'price': None, 'evidence': proof('siting', 'Portfolio includes utility screening.')},
                               ]},
            }
            if self.only_hold:
                results['accounts'] = results['accounts'][-1:]
            if self.advanced_sources:
                bright['affiliations'] = [
                    {'person': 'Alex Example', 'organization': 'Shared Grid', 'kind': 'employment',
                     'evidence': proof('bright-bio', 'Alex Example currently works at Bright Energy and previously worked at Shared Grid.')},
                    {'person': 'Alex Example', 'organization': 'Harbor University', 'kind': 'education',
                     'evidence': proof('bright-bio', 'Alex Example of Bright Energy earned a degree from Harbor University.')},
                ]
                results['accounts'][2]['affiliations'] = [
                    {'person': 'Sam Example', 'organization': 'Shared Grid', 'kind': 'employment',
                     'evidence': proof('west-bio', 'Sam Example currently works at West Energy and previously worked at Shared Grid.')},
                ]
                bright['market_signals'] = [
                    {'kind': 'buying_evaluation', 'evidence': proof('bright-job', self.job.text)},
                    {'kind': 'renewal', 'vendor': 'GridTools', 'evidence': proof('bright-filing', 'Bright Energy will renew its GridTools contract.')},
                    {'kind': 'churn', 'vendor': 'OldScreen', 'evidence': proof('bright-filing', 'Bright Energy plans to replace OldScreen.')},
                ]
                results['competitors'] = [
                    {'name': item.title, 'category': category, 'positioning': item.text, 'differentiator': item.text,
                     'positioning_evidence': proof(item.id, item.text), 'differentiation_evidence': proof(item.id, item.text)}
                    for item, category in zip(self.market, ('indirect', 'alternative'))
                ]
            return schema.model_validate(results)
        if schema is CopyOutput:
            evidence = json.loads(context)['required_graph_evidence_id']
            self.graph_evidence_used.append(evidence)
            return schema(subject='Compare sites for your solar project',
                          body='I saw your announcement about site analysis. GeoFlow helps compare proposed sites. Would a walkthrough help?',
                          evidence_ids=['unrelated'] if self.invalid_citation else [evidence])
        if schema is CopyCheck:
            return schema(supported=not self.reject_copy and 'unsupported claim' not in context)
        if schema is SequenceOutput:
            return schema(follow_up_subject='Compare potential solar sites',
                          follow_up_body='Would a site-comparison walkthrough help your team?',
                          linkedin_body='GeoFlow helps compare solar project sites. Would a brief walkthrough be useful?')
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

    def gmail_feedback(self, message_ids):
        return {message_id: self.feedback[message_id] for message_id in message_ids if message_id in self.feedback}

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
        public_origin=ORIGIN, demo_password=PASSWORD, session_secret=token_urlsafe(32),
        neo4j_uri=uri, neo4j_password=os.getenv('SIGNAL_TEST_NEO4J_PASSWORD', ''),
        gmail_client_id='simulated', gmail_client_secret=token_urlsafe(24), gmail_refresh_token=token_urlsafe(24),
        gmail_sender='owner@example.com', test_recipient='demo@example.com', **params,
    )
    store = Neo4jStore(settings, workspace_id=f'test-{uuid4()}')
    providers = SimulatedProviders()
    providers.store = store
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


def test_intake_chat_proposes_fields_without_mutating_workspace(system):
    client, providers = system
    route = '/api/intake/chat'
    request = {'message': 'We compare utility-scale solar development sites. Contact team@example.com.'}
    post(client, route, request, 401)
    sign_in(client)
    before = client.get('/api/workspace').json()
    result = post(client, route, request)
    assert result['proposal']['description'] == 'Compare utility-scale solar development sites.'
    assert 'team@example.com' not in providers.intake_requests[-1]['message']
    history = [{'role': 'user', 'text': 'We compare solar sites.'}, {'role': 'assistant', 'text': result['reply']}]
    followup = post(client, route, {'product': result['proposal'], 'history': history, 'message': 'United States only.'})
    assert followup['proposal']['constraints'] == ['United States only']
    assert post(client, route, {'history': history * 7, 'message': 'More history.'}, 422)['error']['code'] == 'validation_error'
    assert client.get('/api/workspace').json() == before
    assert len(providers.intake_requests) == 2
    assert providers.searches == providers.lookups == providers.sent == []


@pytest.mark.parametrize('system', [{'gmail_feedback_refresh_token': 'simulated-read-token'}], indirect=True)
def test_gmail_feedback_and_rep_moves_preserve_attribution(system):
    client, providers = system
    account_id, draft = prepare_draft(client)
    path = f'/api/drafts/{draft["id"]}'
    stage = f'/api/pipeline/{account_id}/stage'
    post(client, stage, {'expected_stage': 'matched', 'to_stage': 'replied'}, 422)
    post(client, path + '/review', {'revision': 1, 'decision': 'approve'})
    post(client, path + '/send', {'revision': 1})

    providers.feedback['gmail-test-1'] = [GmailFeedback('reply-1', 'reply')]
    result = post(client, '/api/feedback/gmail/sync')['pipeline']
    assert result['counts']['replied'] == 1
    assert result['events'][-1]['source'] == 'gmail'
    assert result['events'][-1]['actor'] == 'system'
    assert post(client, '/api/feedback/gmail/sync')['pipeline']['events'] == result['events']
    post(client, stage, {'expected_stage': 'contacted', 'to_stage': 'replied'}, 409)
    post(client, stage, {'expected_stage': 'replied', 'to_stage': 'closed_lost', 'outcome': 'won'}, 422)
    result = post(client, stage, {'expected_stage': 'replied', 'to_stage': 'meeting_booked', 'note': 'Confirmed with team@example.com'})['pipeline']
    assert result['events'][-1]['source'] == 'rep'
    assert result['events'][-1]['actor'] == 'demo'
    assert 'team@example.com' not in result['events'][-1]['note']
    result = post(client, stage, {'expected_stage': 'meeting_booked', 'to_stage': 'closed_lost', 'outcome': 'won'})['pipeline']
    assert result['counts']['closed_lost'] == 1
    assert result['events'][-1]['outcome'] == 'won'
    assert result['analytics']['industry'][0]['reached']['contacted'] == 1
    assert result['analytics']['tier'][0]['reached']['meeting_booked'] == 1
    assert len(providers.sent) == 1


@pytest.mark.parametrize('system', [{'gmail_feedback_refresh_token': 'simulated-read-token'}], indirect=True)
def test_gmail_watch_reconciles_and_deduplicates_feedback(system):
    client, providers = system
    settings = replace(client.app.state.settings, gmail_pubsub_topic='projects/signal-project/topics/feedback',
                       gmail_pubsub_subscription='projects/signal-project/subscriptions/feedback',
                       gmail_pubsub_service_account='push@signal-project.iam.gserviceaccount.com')
    workflow = Workflow(settings, providers.store, providers)
    account_id, draft = prepare_draft(client)
    route = f'/api/drafts/{draft["id"]}'
    post(client, route + '/review', {'revision': 1, 'decision': 'approve'})
    post(client, route + '/send', {'revision': 1})

    watch_calls, history_calls = [], []
    now = datetime.now(timezone.utc)
    def register():
        watch_calls.append(1)
        return 100 if len(watch_calls) == 1 else 106, now + timedelta(days=7)
    providers.gmail_watch = register
    def history(cursor):
        history_calls.append(cursor)
        return 105 if len(watch_calls) == 1 else 106, True
    providers.gmail_history_checkpoint = history

    workflow.reconcile_gmail_watch()
    assert workflow.gmail_watch_status() == (True, None)
    workflow.process_gmail_notification(100)
    active, first_push_at = workflow.gmail_watch_status()
    assert active and first_push_at
    assert history_calls == []
    providers.feedback['gmail-test-1'] = [GmailFeedback('reply-1', 'reply'), GmailFeedback('bounce-1', 'bounce')]
    workflow.process_gmail_notification(105)
    workflow.process_gmail_notification(102)
    workflow.process_gmail_notification(105)
    pipeline = workflow.workspace().pipeline
    assert pipeline.counts['replied'] == 1
    assert [(e.action, e.source, e.account_id) for e in pipeline.events][-2:] == [
        ('reply', 'gmail', account_id), ('bounce', 'gmail', account_id),
    ]
    assert history_calls == [100]

    def renewal_due(_, state):
        state.gmail_watch.renewed_at = now - timedelta(days=2)
    providers.store.write(renewal_due)
    workflow.reconcile_gmail_watch()
    assert len(watch_calls) == 2
    assert history_calls == [100, 105]
    assert providers.store.read(lambda _, state: state.gmail_watch.history_id) == 106
    assert workflow.gmail_watch_status()[1] >= first_push_at
    assert workflow.workspace().pipeline.events == pipeline.events
    assert len(providers.sent) == 1


def test_industry_codes_are_canonicalized_before_profile_approval(system):
    client, providers = system
    sign_in(client)
    state = post(client, '/api/icp/generate', {'name': 'GeoFlow', 'description': 'Compare solar development sites.'})
    assert state['icp']['fields']['industry_codes'] == [{'system': 'NAICS', 'code': '221114', 'title': 'Solar Electric Power Generation'}]
    invalid = {'revision': 1, 'fields': {**FIELDS, 'industry_codes': [{'system': 'NAICS', 'code': '000000'}]}}
    assert post(client, '/api/icp/approve', invalid, 422)['error']['code'] == 'unknown_industry_code'
    valid = {'revision': 1, 'fields': {**FIELDS, 'industry_codes': [{'system': 'SIC', 'code': '4911', 'title': 'Model-suggested title'}]}}
    assert post(client, '/api/icp/approve', valid)['icp']['fields']['industry_codes'][0]['title'] == 'ELECTRIC SERVICES'


def test_targeted_sources_and_multi_hop_graph_paths(system):
    client, providers = system
    providers.advanced_sources = True
    revision = approve_profile(client)
    state = post(client, '/api/discover', {'revision': revision, 'deeper_sources': True})
    assert [item['category'] for item in state['competitors']] == ['direct', 'indirect', 'alternative']
    assert any('regulatory filings' in query for query in providers.searches)
    assert any('job postings' in query for query in providers.searches)
    account = next(item for item in state['accounts'] if item['name'] == 'Bright Energy')
    assert {'filing', 'job'} <= {item['source_type'] for item in account['evidence']}
    response = client.get(f'/api/accounts/{account["id"]}/insights')
    assert response.status_code == 200
    insights = response.json()
    assert {item['kind'] for item in insights} == {'employment', 'education', 'warm_introduction', 'buying_evaluation', 'renewal', 'churn'}
    intro = next(item for item in insights if item['kind'] == 'warm_introduction')
    assert intro['path'] == ['Alex Example', 'Shared Grid', 'Sam Example', 'West Energy']
    assert len(intro['evidence']) == 2


@pytest.mark.parametrize('system', [{'research_refresh_minutes': 1440}], indirect=True)
def test_scheduled_research_claim_runs_once_when_due(system):
    client, providers = system
    revision = approve_profile(client)
    initial = post(client, '/api/discover', {'revision': revision})
    assert initial['research_schedule']['next_due_at']
    workflow = Workflow(client.app.state.settings, providers.store, providers)
    assert not workflow.refresh_research_due()

    def backdate(graph, state):
        state.research_completed_at = datetime.now(timezone.utc) - timedelta(days=2)

    providers.store.write(backdate)
    assert workflow.refresh_research_due()
    assert not workflow.refresh_research_due()
    latest = client.get('/api/workspace').json()
    assert latest['research_schedule']['last_completed_at'] >= initial['research_schedule']['last_completed_at']
    assert next(event for event in latest['activity'] if event['type'] == 'discovery_completed')['actor'] == 'system'


@pytest.mark.parametrize('system', [{'linkedin_test_profile_url': 'https://www.linkedin.com/in/signal-test-only/'}], indirect=True)
def test_followups_use_independent_review_schedule_and_handoff(system):
    client, providers = system
    account_id, initial = prepare_draft(client)
    state = post(client, f'/api/accounts/{account_id}/sequence')
    account = next(item for item in state['accounts'] if item['id'] == account_id)
    followup, linkedin = account['sequence']
    email = f'/api/drafts/{followup["id"]}'
    linked = f'/api/drafts/{linkedin["id"]}'
    due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    post(client, email + '/schedule', {'revision': 1, 'scheduled_at': due}, 409)
    post(client, email + '/review', {'revision': 1, 'decision': 'approve'})
    post(client, email + '/schedule', {'revision': 1, 'scheduled_at': due})
    assert post(client, email + '/send', {'revision': 1}, 409)['error']['code'] == 'followup_not_ready'
    assert providers.sent == []
    initial_route = f'/api/drafts/{initial["id"]}'
    post(client, initial_route + '/review', {'revision': 1, 'decision': 'approve'})
    post(client, initial_route + '/send', {'revision': 1})
    assert post(client, email + '/send', {'revision': 1}, 409)['error']['code'] == 'followup_scheduled'
    response = client.patch(email, headers=HEADERS, json={'expected_revision': 1, 'subject': 'Follow up on site comparison', 'body': followup['body']})
    assert response.status_code == 200
    assert response.json()['accounts'][0]['sequence'][0]['scheduled_at'] is None
    post(client, email + '/send', {'revision': 2}, 409)
    post(client, email + '/review', {'revision': 2, 'decision': 'approve'})
    post(client, email + '/send', {'revision': 2})
    post(client, linked + '/review', {'revision': 1, 'decision': 'approve'})
    post(client, linked + '/send', {'revision': 1}, 422)
    result = post(client, linked + '/linkedin-handoff', {'revision': 1})
    assert result['accounts'][0]['sequence'][1]['prepared_at']
    assert result['pipeline']['counts']['contacted'] == 1
    assert result['pipeline']['analytics']['message_variant'][0]['label'] == initial['message_variant']
    assert len(providers.sent) == 2
    assert len(providers.lookups) == 1


def test_real_graph_flow_and_single_send(system):
    client, providers = system
    assert client.get('/api/workspace').status_code == 401
    assert client.post('/api/session', json={'password': PASSWORD}, headers={'Origin': 'https://elsewhere.example'}).status_code == 403
    state = discover_accounts(client)
    assert len(state['accounts']) == 3
    assert state['competitor']['pricing'] == '$29/month'
    assert [(plan['name'], plan['price']) for plan in state['competitor']['plans']] == [
        ('Starter', '$29 per month'), ('Portfolio', None),
    ]
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


@pytest.mark.parametrize('system', [{'test_send_limit_per_hour': 1}], indirect=True)
def test_hourly_send_limit_counts_distinct_draft_reservations(system):
    client, providers = system
    state = discover_accounts(client)
    first, second = [get_draft(client, account['id']) for account in state['accounts'] if account['recommendation'] == 'contact']
    first_path, second_path = [f'/api/drafts/{draft["id"]}' for draft in (first, second)]
    for path in (first_path, second_path):
        post(client, path + '/review', {'revision': 1, 'decision': 'approve'})

    providers.resume_send = Event()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempt = pool.submit(post, client, first_path + '/send', {'revision': 1})
            assert providers.send_entered.wait(5)
            try:
                duplicate = post(client, first_path + '/send', {'revision': 1})
                assert duplicate['pipeline']['counts']['contacted'] == 0
                blocked = post(client, second_path + '/send', {'revision': 1}, 429)
                assert blocked['error']['code'] == 'send_rate_limit'
                assert len(providers.sent) == 1
            finally:
                providers.resume_send.set()
            result = attempt.result(timeout=8)
    finally:
        providers.resume_send.set()

    assert result['pipeline']['counts']['contacted'] == 1
    assert next(account for account in result['accounts'] if account['id'] == second['account_id'])['draft']['dispatch_status'] == 'not_sent'


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


@pytest.mark.parametrize('system', [{'flexprice_enabled': True, 'flexprice_meter_graph_and_outreach': True}], indirect=True)
def test_extended_flexprice_meters_track_one_lead_and_one_confirmed_dispatch(system):
    client, providers = system
    account_id, draft = prepare_draft(client)
    path = f'/api/drafts/{draft["id"]}'
    assert [event.operation for event in providers.meters] == ['leads_enriched', 'graph_query_evaluated']
    post(client, path + '/review', {'revision': 1, 'decision': 'approve'})
    post(client, path + '/send', {'revision': 1})
    state = post(client, path + '/send', {'revision': 1})
    events = state['usage']['events']
    assert [event['operation'] for event in events] == ['leads_enriched', 'graph_query_evaluated', 'outreach_sent']
    assert all(event['account_id'] == account_id and event['status'] == 'accepted' for event in events)
    assert len({event.id for event in providers.meters}) == 3
    assert len(providers.sent) == 1


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


def test_expand_discovery_reuses_sources_and_preserves_an_approved_draft(system, monkeypatch):
    client, providers = system
    route = '/api/discover/more'
    post(client, route, {'revision': 2}, 401)
    _, draft = prepare_draft(client)
    before = post(client, f'/api/drafts/{draft["id"]}/review', {'revision': draft['revision'], 'decision': 'approve'})
    revision = before['approved_icp_revision']
    original = providers.complete
    searches = []
    south = Source('south', 'https://south.example.com/news/site-analysis', 'South Energy',
                   'South Energy develops utility-scale solar in the United States. '
                   'South Energy announced site analysis for its new solar project.', providers.recent, 'tavily')

    def search(query, *, limit, include_details, source_domains, exclude_domains):
        searches.append((limit, source_domains, exclude_domains))
        return [providers.prospects[0], south]

    def complete(schema, instructions, context, *, max_tokens, wrap_json=False):
        result = original(schema, instructions, context, max_tokens=max_tokens, wrap_json=wrap_json)
        data = result.model_dump()
        data['accounts'].append({
            'name': 'South Energy', 'domain': 'south.example.com',
            'identity': proof('south', 'South Energy develops utility-scale solar'),
            'industry': FIELDS['industries'][0], 'geography': FIELDS['geography'][0],
            'fit': {
                'industry': proof('south', 'develops utility-scale solar'),
                'geography': proof('south', 'in the United States'),
                'product_need': proof('south', 'announced site analysis for its new solar project'),
            },
            'signal': {'kind': 'direct', 'summary': 'New solar project site analysis',
                       'evidence': proof('south', 'South Energy announced site analysis for its new solar project.')},
        })
        return schema.model_validate(data)

    monkeypatch.setattr(providers, 'search', search)
    monkeypatch.setattr(providers, 'complete', complete)
    invalid = post(client, route, {'revision': revision, 'source_domains': ['http://127.0.0.1']}, 422)
    assert invalid['error']['code'] == 'invalid_source_domain'
    request = {'revision': revision, 'source_domains': ['www.south.example.com']}
    providers.reject_discovery = True
    assert post(client, route, request, 502)['error']['code'] == 'claude_unavailable'
    providers.reject_discovery = False
    expanded = post(client, route, request)
    assert searches == [(16, ('south.example.com',), tuple(a['domain'] for a in before['accounts']))]
    assert expanded['accounts'][:-1] == before['accounts']
    assert expanded['competitors'] == before['competitors']
    assert expanded['accounts'][-1]['domain'] == 'south.example.com'
    assert expanded['accounts'][-1]['recommendation'] == 'contact'
    assert len(providers.lookups) == 1


def test_contact_lookup_is_saved_without_a_draft_and_reused(system):
    client, providers = system
    state = discover_accounts(client)
    target = next(a for a in state['accounts'] if a['recommendation'] == 'contact')
    rejected = next(a for a in state['accounts'] if a['recommendation'] == 'reject')
    path = f'/api/accounts/{target["id"]}/enrich'
    post(client, f'/api/accounts/{rejected["id"]}/enrich', expected=409)
    assert providers.lookups == []
    for _ in range(2):
        enriched = post(client, path)
        account = next(a for a in enriched['accounts'] if a['id'] == target['id'])
        assert account['enrichment_status'] == 'verified'
        assert account['contact']['email_masked']
        assert account['draft'] is None
    assert len(providers.lookups) == 1
    assert get_draft(client, target['id'])['review_status'] == 'pending_review'
    assert len(providers.lookups) == 1
    assert providers.sent == []


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
