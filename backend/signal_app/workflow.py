from collections import Counter
from datetime import datetime, timedelta
from threading import Lock
from uuid import NAMESPACE_URL, uuid4, uuid5

from .classification import validate_codes
from .config import EMAIL_PATTERN, Settings
from .errors import ProviderError, SignalError
from .models import (
    INITIAL_DISCOVERY_LIMIT, MAX_DISCOVERY_ACCOUNTS, Account, Activity, ApproveIcp, DispatchAttempt, Draft, DraftReview,
    DraftRevision, EditDraft, GmailWatch, GraphInsight, Icp, Lead, PendingDiscoveryExpansion, Pipeline, PipelineChange, PipelineEvent, Product, ProductInput,
    ResearchBatch, ResearchSchedule, ReviewDraft, ScheduleDraft, State,
    Usage, UsageEvent, UsageOperation, Workspace,
)
from .pipeline import PIPELINE_STAGES, funnel_analytics
from .providers import Delivery, Enriched, GmailFeedback, Providers, clean_text, normalize_domain, stable_id, utcnow
from .research import (
    analyze_research, check_copy, draft_followups, focus_research, gather_research, make_profile, search_more_accounts, write_copy,
)
from .store import GraphTransaction, Neo4jStore


def add_activity(state: State, event: str, actor: str, message: str, *, account_id=None, draft_id=None, revision=None) -> None:
    state.activity.append(Activity(
        id=str(uuid4()), type=event, actor=actor, at=utcnow(), message=message,
        account_id=account_id, draft_id=draft_id, revision=revision,
    ))


def research_schedule(state: State, interval: int) -> ResearchSchedule:
    completed = state.research_completed_at or max((item.researched_at for item in state.accounts), default=None)
    reference = max((at for at in (completed, state.research_scheduled_attempt_at) if at), default=None)
    return ResearchSchedule(interval_minutes=interval, last_completed_at=completed,
                            next_due_at=reference + timedelta(minutes=interval) if interval and reference else None)


def icp_current(state: State, revision: int) -> Icp:
    icp = state.latest_icp
    if not icp or not icp.approved or state.approved_icp_revision != revision or icp.revision != revision:
        raise SignalError('icp_not_approved', 'Use the current approved ICP revision.')
    return icp


def get_account(state: State, account_id: str) -> Account:
    account = next((item for item in state.accounts if item.id == account_id), None)
    if not account:
        raise SignalError('account_not_found', 'This account is not in the current discovery results.', 404)
    return account


def draft_id(account: Account, step: int = 1) -> str:
    parts = (account.id, str(account.icp_revision))
    return stable_id('draft', *parts) if step == 1 else stable_id('draft', *parts, str(step))


def current_draft(graph: GraphTransaction, state: State, key: str, revision: int, *, lock: bool = False) -> Draft:
    draft = graph.draft(key, lock=lock)
    if not draft:
        raise SignalError('draft_not_found', 'The requested draft was not found.', 404)
    if draft.current.revision != revision:
        raise SignalError('stale_draft_revision', 'Refresh and use the current draft revision.')
    icp_current(state, draft.icp_revision)
    return draft


def require_open_draft(draft: Draft) -> None:
    if draft.dispatch or draft.prepared_at:
        raise SignalError('dispatch_already_reserved', 'This draft is locked after its approved handoff or send reservation.')


def validate_copy(subject: str, body: str) -> None:
    if '\r' in subject or '\n' in subject:
        raise SignalError('invalid_subject', 'Use a single-line email subject.', 422)
    if EMAIL_PATTERN.search(subject) or EMAIL_PATTERN.search(body):
        raise SignalError('contact_data_in_copy', 'Remove email addresses from the subject and body.', 422)


def validate_account_evidence(account: Account, version: DraftRevision) -> None:
    if account.recommendation != 'contact' or not account.signal or account.signal.evidence_id not in version.evidence_ids or not set(version.evidence_ids) <= {
        item.id for item in account.evidence
    }:
        raise SignalError('draft_evidence_changed', 'Research changed. Generate a new draft from the current supporting evidence.')


class Workflow:
    def __init__(self, settings: Settings, store: Neo4jStore, providers: Providers):
        self.settings = settings
        self.store = store
        self.providers = providers
        # The hackathon deployment runs one worker; durable send and credit claims also use Neo4j locks.
        self._draft_generation_lock = Lock()
        self._discovery_lock = Lock()
        self._feedback_lock = Lock()

    def workspace(self) -> Workspace:
        def view(graph: GraphTransaction, state: State) -> Workspace:
            accounts = []
            for account in state.accounts:
                draft = graph.draft(draft_id(account))
                path = graph.graph_path(state.product.id, account) if state.product else []
                followups = [record.view() for step in (2, 3) if (record := graph.draft(draft_id(account, step)))] if draft else []
                accounts.append(account.model_copy(update={'graph_path': path, 'draft': draft.view() if draft else None, 'sequence': followups}))

            leads = []
            drafts_by_account = {account.id: account.draft for account in accounts}
            accounts_by_id = {account.id: account for account in accounts}
            for lead in state.leads.values():
                draft = drafts_by_account.get(lead.account_id)
                if account := accounts_by_id.get(lead.account_id):
                    lead = lead.model_copy(update={'industry': lead.industry or account.industry, 'tier': lead.tier or account.tier})
                if lead.stage == 'matched' and draft:
                    if draft.dispatch_status == 'pending_outcome':
                        action = 'Verify the pending send outcome in the controlled inbox'
                    elif draft.dispatch_status == 'failed':
                        action = 'Inspect the recorded dispatch failure'
                    elif draft.review_status == 'approved':
                        action = 'Send the approved demo email'
                    else:
                        action = 'Review the current draft revision'
                    lead = lead.model_copy(update={'next_action': action})
                elif lead.stage == 'matched' and account and account.recommendation == 'contact' and account.enrichment_status != 'not_started':
                    lead = lead.model_copy(update={'next_action': 'Write a source-backed draft'})
                leads.append(lead)
            stage_counts = Counter(lead.stage for lead in leads)
            reached_contacted = sum(lead.stage != 'matched' for lead in leads)
            usage = state.usage if self.settings.flexprice_enabled else None
            if self.settings.flexprice_enabled and usage is None:
                usage = Usage(enrichment_cost=float(self.settings.flexprice_enrichment_cost))
            return Workspace(
                product=state.product, icp=state.latest_icp, approved_icp_revision=state.approved_icp_revision,
                accounts=accounts, competitor=state.competitor,
                competitors=state.competitors or ([state.competitor] if state.competitor else []),
                activity=list(reversed(state.activity[-60:])),
                pipeline=Pipeline(
                    leads=leads, events=state.pipeline_events, counts={stage: stage_counts[stage] for stage in PIPELINE_STAGES},
                    enriched_count=sum(account.enrichment_status == 'verified' for account in accounts),
                    pending_approval_count=sum(d.review_status == 'pending_review' for a in accounts
                                               for d in ([a.draft] if a.draft else []) + a.sequence),
                    matched_to_contacted_rate=reached_contacted / len(leads) if leads else None,
                    analytics=funnel_analytics(leads, state.pipeline_events),
                    gmail_feedback_configured=self.settings.gmail_feedback_configured,
                ),
                usage=usage,
                research_schedule=research_schedule(state, self.settings.research_refresh_minutes),
                more_accounts_available=bool(state.approved_icp_revision and 0 < len(accounts) < MAX_DISCOVERY_ACCOUNTS),
            )

        return self.store.read(view)

    def generate_icp(self, request: ProductInput, actor: str) -> Workspace:
        product = Product(id=stable_id('product', request.name, request.description), **request.model_dump())
        output, expansion = make_profile(self.providers, product)
        output.fields.industry_codes = validate_codes(output.fields.industry_codes)
        confidence = {name: value if getattr(output.fields, name) else 0 for name, value in output.confidence.model_dump().items()}

        def save(graph: GraphTransaction, state: State) -> None:
            revision = state.latest_icp.revision + 1 if state.latest_icp else 1
            state.product = product
            state.icp_versions.append(Icp(revision=revision, approved=False, fields=output.fields,
                                          confidence=confidence, expansion=expansion, updated_at=utcnow()))
            state.approved_icp_revision = None
            state.discovery_revision = None
            state.research_batch = None
            state.pending_discovery_expansion = None
            state.research_completed_at = None
            state.research_scheduled_attempt_at = None
            state.accounts = []
            state.competitor = None
            state.competitors = []
            add_activity(state, 'icp_generated', actor, 'An editable ICP was generated with source-backed expansion where available.', revision=revision)

        self.store.write(save)
        return self.workspace()

    def approve_icp(self, request: ApproveIcp, actor: str) -> Workspace:
        def approve(graph: GraphTransaction, state: State) -> None:
            current = state.latest_icp
            if not current or current.revision != request.revision:
                raise SignalError('stale_icp_revision', 'Refresh and approve the current ICP revision.')
            fields = request.fields.model_copy(deep=True)
            fields.industry_codes = validate_codes(fields.industry_codes, strict=True)
            expansion = current.expansion
            if request.expansion_decision in ('accept', 'edit'):
                if not expansion:
                    raise SignalError('expansion_unavailable', 'There is no sourced expansion to select.', 422)
                if request.expansion_decision == 'edit':
                    if not request.expansion_segment:
                        raise SignalError('expansion_segment_required', 'Enter the edited target segment.', 422)
                    expansion = expansion.model_copy(update={'segment': request.expansion_segment})
                if expansion.segment not in fields.industries:
                    if len(fields.industries) >= 12:
                        raise SignalError('too_many_industries', 'Remove an industry before adding the expansion.', 422)
                    fields.industries.append(expansion.segment)
            confidence = {}
            for name in type(fields).model_fields:
                value = getattr(fields, name)
                confidence[name] = 0 if not value else current.confidence.get(name, 0) if value == getattr(current.fields, name) else 1
            revision = current.revision + 1
            state.icp_versions.append(Icp(revision=revision, approved=True, fields=fields, confidence=confidence,
                                          expansion=expansion, expansion_decision=request.expansion_decision, updated_at=utcnow()))
            state.approved_icp_revision = revision
            state.discovery_revision = None
            state.research_batch = None
            state.pending_discovery_expansion = None
            state.research_completed_at = None
            state.research_scheduled_attempt_at = None
            state.accounts = []
            state.competitor = None
            state.competitors = []
            add_activity(state, 'icp_approved', actor, 'The edited ICP revision was approved.', revision=revision)

        self.store.write(approve)
        return self.workspace()

    def discover(self, revision: int, actor: str, *, refresh: bool = False, deeper_sources: bool = False) -> Workspace:
        with self._discovery_lock:
            completed = self.store.read(lambda graph, state: state.discovery_revision == icp_current(state, revision).revision
                                        and (not deeper_sources or bool(state.research_batch and state.research_batch.deeper_sources)))
            if completed and not refresh:
                return self.workspace()
            return self._run_discovery(revision, actor, refresh=refresh, deeper_sources=deeper_sources)

    def _run_discovery(self, revision: int, actor: str, *, refresh: bool, deeper_sources: bool = False) -> Workspace:
        product, icp, batch = self.store.read(lambda graph, state: (state.product, icp_current(state, revision), state.research_batch))
        if not product:
            raise SignalError('product_missing', 'Generate an ICP from a product first.')
        def cache(graph: GraphTransaction, state: State) -> None:
            icp_current(state, revision)
            state.research_batch = batch
            state.discovery_revision = None
            add_activity(state, 'research_sources_collected', 'system',
                         f'Collected {len(batch.prospects)} prospect sources and {len(batch.competitors)} competitor sources for validation.',
                         revision=revision)

        if refresh or not batch or batch.revision != revision or (deeper_sources and not batch.deeper_sources):
            previous_sources = batch.additional_prospects if batch and batch.revision == revision else []
            batch = gather_research(self.providers, product, icp, bool(self.settings.nexla_sync_url),
                                    self.settings.discovery_domains, deeper_sources=deeper_sources)
            batch.additional_prospects = previous_sources
            self.store.write(cache)

        account_limit = MAX_DISCOVERY_ACCOUNTS if batch.additional_prospects else INITIAL_DISCOVERY_LIMIT
        accounts, competitors = analyze_research(self.providers, product, icp, batch, account_limit=account_limit)
        if not batch.focused_search_used and (len(accounts) < 2 or not any(a.recommendation == 'contact' for a in accounts)):
            previous_sources = batch.prospects
            batch = focus_research(self.providers, product, icp, batch, accounts, self.settings.discovery_domains)
            self.store.write(cache)
            if batch.prospects != previous_sources:
                accounts, competitors = analyze_research(self.providers, product, icp, batch, account_limit=account_limit)

        def save(graph: GraphTransaction, state: State) -> None:
            icp_current(state, revision)
            self._record_account_matches(state, accounts)
            graph.save_discovery(product, accounts, competitors)
            state.accounts = accounts
            state.competitors = competitors
            state.competitor = competitors[0] if competitors else None
            state.discovery_revision = revision
            state.research_completed_at = utcnow()
            verdicts = Counter(account.recommendation for account in accounts)
            add_activity(state, 'discovery_completed', actor,
                         f'Saved {len(accounts)} cited accounts. {verdicts["contact"]} marked Contact, '
                         f'{verdicts["hold"]} on Hold, and {verdicts["reject"]} rejected.', revision=revision)
            if competitors:
                add_activity(state, 'competitor_sourced', 'system', f'{len(competitors)} competitor comparisons were saved with public citations.')
            if batch.nexla_status:
                add_activity(state, 'nexla_discovery', 'system', batch.nexla_status)

        self.store.write(save)
        return self.workspace()

    @staticmethod
    def _record_account_matches(state: State, accounts: list[Account]) -> None:
        previous = {account.id: account for account in state.accounts}
        for account in accounts:
            if old := previous.get(account.id):
                account.enrichment_status = old.enrichment_status
                account.contact = old.contact
            lead = state.leads.get(account.id)
            if account.recommendation == 'contact' and (not lead or lead.stage == 'matched'):
                state.leads[account.id] = Lead(
                    account_id=account.id, company=account.name, role=account.buyer_role, fit_score=account.fit_score,
                    actor='system', updated_at=account.researched_at, next_action='Enrich this matched account',
                    industry=account.industry, tier=account.tier,
                )
            elif account.recommendation != 'contact' and lead and lead.stage == 'matched':
                lead.next_action = 'Review the current research before outreach'

    def discover_more(self, revision: int, actor: str, source_domains: list[str]) -> Workspace:
        with self._discovery_lock:
            product, icp, existing, pending = self.store.read(lambda graph, state: (
                state.product, icp_current(state, revision), tuple(account.domain for account in state.accounts),
                state.pending_discovery_expansion,
            ))
            if len(existing) >= MAX_DISCOVERY_ACCOUNTS:
                return self.workspace()
            if not product or not existing:
                raise SignalError('discovery_required', 'Find the first set of accounts before looking for more.')

            normalized = [normalize_domain(domain) for domain in source_domains]
            if None in normalized:
                raise SignalError('invalid_source_domain', 'Use public hostnames such as example.com.', 422)
            requested = tuple(dict.fromkeys(domain for domain in normalized if domain))
            normalized_config = [normalize_domain(domain) for domain in self.settings.discovery_domains]
            if None in normalized_config:
                raise ProviderError('Tavily', 'requires valid configured research source domains.', 503)
            configured = tuple(dict.fromkeys(domain for domain in normalized_config if domain))
            if configured and any(not any(domain == root or domain.endswith('.' + root) for root in configured)
                                  for domain in requested):
                raise SignalError('source_domain_out_of_scope', 'Choose from the configured research source domains.', 422)
            allowed = requested or configured
            remaining_domains = tuple(domain for domain in allowed if domain not in existing)
            if allowed and not remaining_domains:
                return self.workspace()

            key = stable_id('discovery-expansion', str(revision), ','.join(sorted(existing)), ','.join(sorted(remaining_domains)))
            if pending and pending.key == key:
                sources = pending.sources
            else:
                sources = search_more_accounts(self.providers, product, icp, remaining_domains, existing)

                def cache(graph: GraphTransaction, state: State) -> None:
                    icp_current(state, revision)
                    state.pending_discovery_expansion = PendingDiscoveryExpansion(key=key, sources=sources)

                self.store.write(cache)
            capacity = min(MAX_DISCOVERY_ACCOUNTS - len(existing), INITIAL_DISCOVERY_LIMIT)
            batch = ResearchBatch(revision=revision, prospects=sources, competitors=[])
            accounts, _ = analyze_research(self.providers, product, icp, batch, exclude_domains=existing, account_limit=capacity)

            def save(graph: GraphTransaction, state: State) -> None:
                icp_current(state, revision)
                saved = {account.domain for account in state.accounts}
                new_accounts = [account for account in accounts if account.domain not in saved][:MAX_DISCOVERY_ACCOUNTS - len(saved)]
                if new_accounts:
                    self._record_account_matches(state, new_accounts)
                    graph.save_discovery(product, new_accounts, [])
                    state.accounts.extend(new_accounts)
                    retained = state.research_batch or ResearchBatch(revision=revision, prospects=[], competitors=[])
                    urls = {evidence.url for account in new_accounts for evidence in account.evidence}
                    additional = {source.id: source for source in retained.additional_prospects}
                    additional.update((source.id, source) for source in sources if source.url in urls)
                    state.research_batch = retained.model_copy(update={'additional_prospects': list(additional.values())[-24:]})
                if state.pending_discovery_expansion and state.pending_discovery_expansion.key == key:
                    state.pending_discovery_expansion = None
                add_activity(state, 'discovery_expanded', actor,
                             f'Added {len(new_accounts)} cited accounts. {len(state.accounts)} accounts are saved.', revision=revision)

            self.store.write(save)
            return self.workspace()

    def refresh_research_due(self) -> bool:
        interval = self.settings.research_refresh_minutes
        if not interval:
            return False

        def due(state: State) -> bool:
            schedule = research_schedule(state, interval)
            return bool(state.approved_icp_revision and schedule.next_due_at and schedule.next_due_at <= utcnow())

        def claim(graph: GraphTransaction, state: State):
            if not due(state):
                return None
            icp_current(state, state.approved_icp_revision)
            state.research_scheduled_attempt_at = utcnow()
            return state.approved_icp_revision, bool(state.research_batch and state.research_batch.deeper_sources)

        with self._discovery_lock:
            if not self.store.read(lambda graph, state: due(state)):
                return False
            if not (job := self.store.write(claim)):
                return False
            revision, deeper = job
            self._run_discovery(revision, 'system', refresh=True, deeper_sources=deeper)
            return True

    def graph_insights(self, account_id: str) -> list[GraphInsight]:
        return self.store.read(lambda graph, state: graph.insights(get_account(state, account_id)))

    def change_pipeline(self, account_id: str, request: PipelineChange, actor: str) -> Workspace:
        def change(graph: GraphTransaction, state: State) -> None:
            lead = state.leads.get(account_id)
            if not lead:
                raise SignalError('lead_not_found', 'This lead is not in the pipeline.', 404)
            if lead.stage != request.expected_stage:
                raise SignalError('stale_pipeline_stage', 'Refresh the pipeline and review the latest stage.')
            allowed = {'contacted': {'replied', 'closed_lost'}, 'replied': {'meeting_booked', 'closed_lost'},
                       'meeting_booked': {'closed_lost'}}
            if request.to_stage not in allowed.get(lead.stage, ()):
                raise SignalError('invalid_stage_transition', 'Select the next stage after the confirmed contact.', 422)
            if (request.to_stage == 'closed_lost') != bool(request.outcome):
                raise SignalError('pipeline_outcome_required', 'Choose a won or lost outcome when closing a lead.', 422)
            if request.outcome == 'won' and lead.stage != 'meeting_booked':
                raise SignalError('meeting_required', 'Book a meeting before marking the lead as won.', 422)
            action = {'replied': 'reply', 'meeting_booked': 'meeting', 'closed_lost': 'close'}[request.to_stage]
            event = PipelineEvent(id=str(uuid4()), account_id=account_id, from_stage=lead.stage,
                                  to_stage=request.to_stage, actor=actor, at=utcnow(), test_send=False, action=action,
                                  source='rep', note=clean_text(request.note, 250) or None, outcome=request.outcome)
            self._record_pipeline(graph, state, lead, event)

        self.store.write(change)
        return self.workspace()

    @staticmethod
    def _record_pipeline(graph: GraphTransaction, state: State, lead: Lead, event: PipelineEvent, prior_send: str | None = None) -> None:
        lead.stage = event.to_stage
        lead.actor = event.actor
        lead.updated_at = event.at
        lead.outcome = event.outcome or lead.outcome
        if event.action == 'bounce':
            lead.bounced = True
            lead.next_action = 'Review the test inbox bounce'
        else:
            lead.next_action = {
                'contacted': 'Review the test delivery', 'replied': 'Schedule a meeting',
                'meeting_booked': 'Record the outcome', 'closed_lost': 'Review the closed outcome',
            }[event.to_stage]
        if event.action != 'send':
            add_activity(state, f'pipeline_{event.action}', event.actor,
                         'A Gmail bounce was recorded.' if event.action == 'bounce' else f'Lead moved to {event.to_stage.replace("_", " ")}.',
                         account_id=lead.account_id, draft_id=event.draft_id, revision=event.revision)
        if event.action == 'reply' and prior_send is None:
            prior_send = next((item.id for item in reversed(state.pipeline_events) if item.account_id == lead.account_id and item.action == 'send'), None)
        graph.record_pipeline_event(event, prior_send)
        state.pipeline_events.append(event)

    def _gmail_feedback_snapshot(self) -> tuple[dict[str, PipelineEvent], dict[str, list[GmailFeedback]]]:
        def read_sends(graph: GraphTransaction, state: State) -> dict[str, PipelineEvent]:
            result = {}
            for event in reversed(state.pipeline_events):
                if event.action != 'send' or not event.draft_id:
                    continue
                draft = graph.draft(event.draft_id)
                if (draft and draft.dispatch and draft.dispatch.provider_message_id
                        and draft.current.channel == 'email' and draft.current.test_recipient == self.settings.test_recipient):
                    result[draft.dispatch.provider_message_id] = event
                if len(result) == 8:
                    break
            return result

        sends = self.store.read(read_sends)
        return sends, self.providers.gmail_feedback(list(sends)) if sends else {}

    def _save_gmail_feedback(self, graph: GraphTransaction, state: State, sends: dict[str, PipelineEvent],
                             feedback: dict[str, list[GmailFeedback]]) -> None:
        recorded = {event.id for event in state.pipeline_events}
        for message_id, items in feedback.items():
            send = sends.get(message_id)
            if not send or not (lead := state.leads.get(send.account_id)):
                continue
            for item in items:
                key = stable_id('feedback', item.id)
                if key in recorded:
                    continue
                to_stage = 'replied' if item.kind == 'reply' and lead.stage == 'contacted' else lead.stage
                event = PipelineEvent(id=key, account_id=lead.account_id, draft_id=send.draft_id,
                                      revision=send.revision, from_stage=lead.stage, to_stage=to_stage,
                                      actor='system', at=utcnow(), test_send=False, action=item.kind, source='gmail')
                self._record_pipeline(graph, state, lead, event, prior_send=send.id)
                recorded.add(key)

    def sync_gmail_feedback(self) -> Workspace:
        if not self.settings.gmail_feedback_configured:
            raise ProviderError('Gmail', 'requires the controlled mailbox metadata refresh token.', 503)
        with self._feedback_lock:
            sends, feedback = self._gmail_feedback_snapshot()
            if feedback:
                self.store.write(lambda graph, state: self._save_gmail_feedback(graph, state, sends, feedback))
        return self.workspace()

    def _gmail_watch_binding(self) -> str:
        return stable_id('gmail-watch', self.settings.gmail_pubsub_topic, self.settings.gmail_pubsub_subscription,
                         self.settings.gmail_pubsub_service_account or '', self.settings.gmail_sender or '',
                         self.settings.test_recipient or '')

    def gmail_watch_status(self) -> tuple[bool, datetime | None]:
        if not self.settings.gmail_push_configured:
            return False, None
        binding = self._gmail_watch_binding()
        watch = self.store.read(lambda _, state: state.gmail_watch)
        if not watch or watch.binding != binding:
            return False, None
        return watch.expires_at > utcnow(), watch.last_push_at

    def reconcile_gmail_watch(self) -> None:
        binding = self._gmail_watch_binding()
        with self._feedback_lock:
            watch = self.store.read(lambda _, state: state.gmail_watch)
            now = utcnow()
            initial = not watch or watch.binding != binding
            if initial or watch.renewed_at + timedelta(days=1) <= now or watch.expires_at <= now + timedelta(minutes=15):
                history_id, expires_at = self.providers.gmail_watch()
                sends, feedback = self._gmail_feedback_snapshot() if initial else ({}, {})

                def renew(graph: GraphTransaction, state: State) -> None:
                    current = state.gmail_watch
                    if current and current.binding == binding and current.renewed_at >= now:
                        return
                    self._save_gmail_feedback(graph, state, sends, feedback)
                    if current and current.binding == binding:
                        current.expires_at = expires_at
                        current.renewed_at = now
                    else:
                        state.gmail_watch = GmailWatch(binding=binding, history_id=history_id,
                                                       expires_at=expires_at, renewed_at=now)

                self.store.write(renew)
                if initial:
                    return
            self._sync_gmail_history(binding)

    def process_gmail_notification(self, history_id: int) -> None:
        with self._feedback_lock:
            self._sync_gmail_history(self._gmail_watch_binding(), history_id)

    def _sync_gmail_history(self, binding: str, notification_id: int = 0) -> None:
        watch = self.store.read(lambda _, state: state.gmail_watch)
        if not watch or watch.binding != binding:
            raise SignalError('gmail_watch_starting', 'The controlled Gmail watch is starting. Retry shortly.', 503)
        pushed_at = utcnow() if notification_id else None
        if notification_id and notification_id <= watch.history_id:
            if not watch.last_push_at:
                # The initial watch notification can carry the cursor we just saved.
                def acknowledge(_, state: State) -> None:
                    current = state.gmail_watch
                    if current and current.binding == binding and not current.last_push_at:
                        current.last_push_at = pushed_at
                self.store.write(acknowledge)
            return

        history_id, changed = self.providers.gmail_history_checkpoint(watch.history_id)
        if history_id < notification_id or history_id < watch.history_id:
            raise SignalError('gmail_history_pending', 'Gmail history is still updating. Retry shortly.', 503)
        if history_id == watch.history_id:
            return
        sends, feedback = self._gmail_feedback_snapshot() if changed else ({}, {})

        def save(graph: GraphTransaction, state: State) -> None:
            current = state.gmail_watch
            if not current or current.binding != binding:
                raise SignalError('gmail_watch_starting', 'The controlled Gmail watch is starting. Retry shortly.', 503)
            if current.history_id < history_id:
                self._save_gmail_feedback(graph, state, sends, feedback)
                current.history_id = history_id
            if pushed_at and (not current.last_push_at or pushed_at > current.last_push_at):
                current.last_push_at = pushed_at

        self.store.write(save)

    @staticmethod
    def _qualified_account(state: State, account_id: str) -> Account:
        account = get_account(state, account_id)
        icp_current(state, account.icp_revision)
        if account.recommendation != 'contact':
            raise SignalError('account_not_qualified', 'Resolve this lead’s research hold before enriching or drafting.')
        if not state.product or not account.buyer_role:
            raise SignalError('buyer_role_missing', 'Approve a buyer title before looking up a contact or drafting.')
        return account

    def _draft_inputs(self, graph: GraphTransaction, state: State, account_id: str):
        account = self._qualified_account(state, account_id)
        path = graph.graph_path(state.product.id, account)
        if len(path) != 3 or not path[-1].evidence_id:
            raise SignalError('graph_evidence_missing', 'This account has no usable graph-backed signal.')
        return state.product, account, path[-1].evidence_id, graph.draft(draft_id(account))

    def _reserve_credit(self, account: Account, actor: str) -> UsageEvent | None:
        if not self.settings.flexprice_enabled:
            return None
        try:
            balance = self.providers.flexprice_balance()
        except ProviderError:
            def mark_unavailable(graph: GraphTransaction, state: State) -> None:
                state.usage = state.usage or Usage(enrichment_cost=float(self.settings.flexprice_enrichment_cost))
                state.usage.status = 'unavailable'
                state.usage.checked_at = utcnow()
                add_activity(state, 'credit_check_unavailable', actor, 'Wallet balance was unavailable. Hunter was not called.', account_id=account.id)

            self.store.write(mark_unavailable)
            raise

        wallet_key = stable_id('wallet', self.settings.flexprice_customer_id, self.settings.flexprice_wallet_id)
        cost = self.settings.flexprice_enrichment_cost

        def reserve(graph: GraphTransaction, state: State) -> UsageEvent:
            current = self._qualified_account(state, account.id)
            if current.researched_at != account.researched_at:
                raise SignalError('discovery_changed', 'Refresh the account and use the current research.')
            usage = state.usage or Usage(enrichment_cost=float(cost))
            if state.billing_wallet != wallet_key or state.billing_remaining is None:
                state.billing_wallet = wallet_key
                state.billing_remaining = balance
            # Flexprice meters asynchronously. A fixed demo wallet cannot spend unposted credits twice.
            available = min(balance, state.billing_remaining)
            blocked = available < cost
            remaining = available if blocked else available - cost
            event = UsageEvent(id=str(uuid4()), account_id=account.id, operation='leads_enriched',
                               at=utcnow(), status='blocked' if blocked else 'pending')
            state.billing_remaining = remaining
            usage.balance = float(balance)
            usage.available_for_enrichment = float(max(remaining, 0))
            usage.enrichment_cost = float(cost)
            usage.checked_at = event.at
            usage.status = 'blocked' if blocked else 'ready'
            usage.events.append(event)
            state.usage = usage
            if blocked:
                add_activity(state, 'enrichment_credit_blocked', actor, 'Flexprice credits were insufficient. Hunter was not called.', account_id=account.id)
            return event

        event = self.store.write(reserve)
        if event.status == 'blocked':
            raise SignalError('insufficient_enrichment_credits', 'The sandbox wallet has insufficient enrichment credits.', 402)
        return event

    def _finish_enrichment(self, account: Account, enriched: Enriched, event: UsageEvent | None, actor: str) -> None:
        # Save the lookup outcome before charging an event or asking for copy. The provider is never inside a database retry.
        def save_contact(graph: GraphTransaction, state: State) -> None:
            current = next((item for item in state.accounts if item.id == account.id and item.icp_revision == account.icp_revision), None)
            if current:
                current.enrichment_status = enriched.status
                current.contact = enriched.contact
                if enriched.contact:
                    graph.save_contact(current.id, enriched.contact)
            add_activity(state, 'hunter_enrichment', actor, f'Hunter lookup status: {enriched.status}.', account_id=account.id)

        self.store.write(save_contact)
        if event:
            self._submit_meter(event, billable=enriched.status != 'failed')

    def _enrich_if_needed(self, account: Account, actor: str) -> Enriched:
        if account.enrichment_status != 'not_started':
            return Enriched(account.enrichment_status, account.contact)
        event = self._reserve_credit(account, actor)
        try:
            enriched = self.providers.enrich(account.domain, account.buyer_role)
        except ProviderError:
            enriched = Enriched('failed', None)
        self._finish_enrichment(account, enriched, event, actor)
        return enriched

    def enrich_account(self, account_id: str, actor: str) -> Workspace:
        with self._draft_generation_lock:
            account = self.store.read(lambda graph, state: self._qualified_account(state, account_id))
            self._enrich_if_needed(account, actor)
            return self.workspace()

    def _queue_extra_meter(self, state: State, operation: UsageOperation, account_id: str,
                           key: str, revision: int) -> UsageEvent | None:
        if not self.settings.flexprice_enabled or not self.settings.flexprice_meter_graph_and_outreach:
            return None
        event_id = str(uuid5(NAMESPACE_URL, f'signal:{self.store.workspace_id}:{operation}:{key}:{revision}'))
        state.usage = state.usage or Usage(enrichment_cost=float(self.settings.flexprice_enrichment_cost))
        if any(event.id == event_id for event in state.usage.events):
            return None
        event = UsageEvent(id=event_id, account_id=account_id, operation=operation, at=utcnow(), status='pending')
        state.usage.events.append(event)
        return event

    def _submit_meter(self, event: UsageEvent, *, billable: bool = True) -> None:
        status = 'failed'
        if billable:
            try:
                self.providers.meter(event)
                status = 'accepted'
            except ProviderError:
                status = 'pending'

        def save_usage(graph: GraphTransaction, state: State) -> None:
            for item in state.usage.events if state.usage else []:
                if item.id == event.id:
                    item.status = status
            if status == 'accepted':
                add_activity(state, 'flexprice_metered', 'system', f'Flexprice accepted the {event.operation} usage event.', account_id=event.account_id)
            elif status == 'pending':
                add_activity(state, 'flexprice_meter_pending', 'system', f'Flexprice acceptance is unconfirmed for {event.operation}.', account_id=event.account_id)

        self.store.write(save_usage)

    def create_draft(self, account_id: str, actor: str) -> Workspace:
        with self._draft_generation_lock:
            product, account, evidence_id, existing = self.store.read(lambda g, s: self._draft_inputs(g, s, account_id))
            if existing and (existing.dispatch or evidence_id in existing.current.evidence_ids and set(existing.current.evidence_ids) <= {ev.id for ev in account.evidence}):
                return self.workspace()

            enriched = self._enrich_if_needed(account, actor)

            role = enriched.contact.role if enriched.status == 'verified' and enriched.contact else account.buyer_role
            variant = 'A' if int(stable_id('variant', account.id)[-1], 16) % 2 == 0 else 'B'
            capability = product.capabilities[0 if variant == 'A' else -1] if product.capabilities else product.description
            proposition = clean_text(capability, 150)
            copy, synthesis_mode = write_copy(self.providers, product, account, evidence_id, role, variant, proposition)
            validate_copy(copy.subject, copy.body)

            def save(graph: GraphTransaction, state: State) -> UsageEvent | None:
                current = get_account(state, account_id)
                icp_current(state, account.icp_revision)
                if current.researched_at != account.researched_at:
                    raise SignalError('discovery_changed', 'The account was researched again. Generate the draft from the latest results.')
                key = draft_id(account)
                record = graph.draft(key, lock=True)
                if record:
                    require_open_draft(record)
                    if not existing or record.current.revision != existing.current.revision:
                        raise SignalError('draft_changed', 'The draft changed while copy was generated. Refresh and try again.')
                revision = record.current.revision + 1 if record else 1
                version = DraftRevision(
                    revision=revision, subject=copy.subject, body=copy.body, test_recipient=self.settings.test_recipient,
                    evidence_ids=list(dict.fromkeys(copy.evidence_ids)), role_based=enriched.status != 'verified',
                    synthesis_mode=synthesis_mode, actor='system', at=utcnow(),
                    message_variant=variant, value_proposition=proposition if synthesis_mode == 'claude' else None,
                )
                if record:
                    record.revisions.append(version)
                else:
                    record = Draft(id=key, account_id=account_id, icp_revision=account.icp_revision, revisions=[version])
                graph.save_draft(record)
                add_activity(state, 'graph_queried', 'system', 'A live Neo4j path supplied evidence for the draft.', account_id=account_id)
                if synthesis_mode == 'grounded_template':
                    add_activity(state, 'draft_validation_fallback', 'system', 'Copy review rejected an unsupported claim. A draft quoting the graph evidence directly was saved.', account_id=account_id)
                add_activity(state, 'draft_created', 'system', 'A source-backed draft was saved for human review.',
                             account_id=account_id, draft_id=key, revision=revision)
                return self._queue_extra_meter(state, 'graph_query_evaluated', account_id, key, revision)

            if meter := self.store.write(save):
                self._submit_meter(meter)
            return self.workspace()

    def create_sequence(self, account_id: str, actor: str) -> Workspace:
        with self._draft_generation_lock:
            def load(graph: GraphTransaction, state: State):
                account = get_account(state, account_id)
                icp_current(state, account.icp_revision)
                first = graph.draft(draft_id(account))
                if not first or not state.product:
                    raise SignalError('initial_draft_required', 'Write the initial email first.', 422)
                validate_account_evidence(account, first.current)
                return account, state.product, first, bool(graph.draft(draft_id(account, 2)))

            account, product, first, exists = self.store.read(load)
            if exists:
                return self.workspace()
            evidence = [item for item in account.evidence if item.id in first.current.evidence_ids]
            copy = draft_followups(self.providers, product, account, first.current.subject, first.current.body, evidence)
            validate_copy(copy.follow_up_subject, copy.follow_up_body)
            validate_copy('LinkedIn follow-up', copy.linkedin_body)
            if len(copy.follow_up_body.split()) > 90:
                raise SignalError('followup_too_long', 'The generated follow-up exceeded the 90-word limit. Try again.', 422)

            def save(graph: GraphTransaction, state: State) -> None:
                current = get_account(state, account_id)
                icp_current(state, account.icp_revision)
                version = graph.draft(first.id)
                if not version or version.current != first.current or current.researched_at != account.researched_at:
                    raise SignalError('draft_changed', 'Refresh and use the latest draft and research.')
                if graph.draft(draft_id(account, 2)):
                    return
                for step, subject, body, channel, recipient in (
                    (2, copy.follow_up_subject, copy.follow_up_body, 'email', self.settings.test_recipient),
                    (3, 'LinkedIn follow-up', copy.linkedin_body, 'linkedin', self.settings.linkedin_test_profile_url),
                ):
                    key = draft_id(account, step)
                    next_version = first.current.model_copy(update={
                        'revision': 1, 'subject': subject, 'body': body, 'channel': channel,
                        'test_recipient': recipient, 'actor': 'system', 'at': utcnow(), 'synthesis_mode': 'claude',
                    })
                    graph.save_draft(Draft(id=key, account_id=account_id, icp_revision=account.icp_revision,
                                           revisions=[next_version], sequence_step=step))
                    add_activity(state, 'sequence_step_drafted', actor, f'Outreach step {step} was saved for human review.',
                                 account_id=account_id, draft_id=key, revision=1)

            self.store.write(save)
            return self.workspace()

    def edit_draft(self, key: str, request: EditDraft, actor: str) -> Workspace:
        validate_copy(request.subject, request.body)

        def edit(graph: GraphTransaction, state: State) -> None:
            draft = current_draft(graph, state, key, request.expected_revision, lock=True)
            require_open_draft(draft)
            revision = draft.current.revision + 1
            recipient = self.settings.linkedin_test_profile_url if draft.current.channel == 'linkedin' else self.settings.test_recipient
            if draft.current.channel == 'linkedin' and len(request.body) > 450:
                raise SignalError('linkedin_message_too_long', 'Keep this LinkedIn message to 450 characters.', 422)
            draft.revisions.append(draft.current.model_copy(update={
                'revision': revision, 'subject': request.subject, 'body': request.body,
                'test_recipient': recipient, 'actor': actor, 'at': utcnow(),
            }))
            draft.scheduled_at = None
            graph.save_draft(draft)
            add_activity(state, 'draft_edited', actor, 'A new draft revision requires fresh approval.',
                         account_id=draft.account_id, draft_id=key, revision=revision)

        self.store.write(edit)
        return self.workspace()

    def review_draft(self, key: str, request: ReviewDraft, actor: str) -> Workspace:
        if request.decision == 'approve':
            def read_for_review(graph: GraphTransaction, state: State):
                draft = current_draft(graph, state, key, request.revision)
                require_open_draft(draft)
                account = get_account(state, draft.account_id)
                validate_account_evidence(account, draft.current)
                return draft, state.product, [item for item in account.evidence if item.id in draft.current.evidence_ids]

            draft, product, evidence = self.store.read(read_for_review)
            if (draft.current.actor != 'system' or draft.sequence_step > 1) and product:
                check_copy(self.providers, product, evidence, draft.current.subject, draft.current.body)

        def review(graph: GraphTransaction, state: State) -> None:
            draft = current_draft(graph, state, key, request.revision, lock=True)
            require_open_draft(draft)
            if request.decision == 'approve':
                validate_account_evidence(get_account(state, draft.account_id), draft.current)
                validate_copy(draft.current.subject, draft.current.body)
            entry = DraftReview(
                revision=request.revision, decision=request.decision, actor=actor, at=utcnow(),
                approved_snapshot=draft.current if request.decision == 'approve' else None,
            )
            draft.reviews.append(entry)
            if request.decision == 'reject':
                draft.scheduled_at = None
            graph.save_draft(draft)
            add_activity(state, 'draft_approved' if request.decision == 'approve' else 'draft_rejected', actor,
                         f'The current draft revision was {"approved" if request.decision == "approve" else "rejected"}.',
                         account_id=draft.account_id, draft_id=key, revision=request.revision)

        self.store.write(review)
        return self.workspace()

    @staticmethod
    def _require_approved(draft: Draft) -> None:
        review = draft.review
        if not review or review.decision != 'approve' or review.approved_snapshot != draft.current:
            raise SignalError('approval_required', 'Approve this exact draft revision before acting on it.')

    @staticmethod
    def _sequence_ready(graph: GraphTransaction, state: State, draft: Draft) -> None:
        if draft.sequence_step > 1:
            account = get_account(state, draft.account_id)
            previous = graph.draft(draft_id(account, draft.sequence_step - 1))
            if state.leads[draft.account_id].stage != 'contacted' or not previous or not previous.dispatch or previous.dispatch.status != 'sent':
                raise SignalError('followup_not_ready', 'Complete the previous touch first. The sequence pauses after a reply or close.')
        if draft.scheduled_at and draft.scheduled_at > utcnow():
            raise SignalError('followup_scheduled', 'This draft is scheduled for a later time.')

    def schedule_draft(self, key: str, request: ScheduleDraft, actor: str) -> Workspace:
        def schedule(graph: GraphTransaction, state: State) -> None:
            draft = current_draft(graph, state, key, request.revision, lock=True)
            require_open_draft(draft)
            self._require_approved(draft)
            if draft.sequence_step == 1:
                raise SignalError('followup_required', 'Scheduling is available for follow-up steps.', 422)
            if request.scheduled_at and request.scheduled_at <= utcnow():
                raise SignalError('schedule_in_past', 'Choose a time in the future.', 422)
            draft.scheduled_at = request.scheduled_at
            graph.save_draft(draft)
            add_activity(state, 'sequence_scheduled' if request.scheduled_at else 'sequence_unscheduled', actor,
                         'An approved follow-up schedule changed.', account_id=draft.account_id,
                         draft_id=key, revision=request.revision)

        self.store.write(schedule)
        return self.workspace()

    def prepare_linkedin(self, key: str, revision: int, actor: str) -> Workspace:
        def prepare(graph: GraphTransaction, state: State) -> None:
            draft = current_draft(graph, state, key, revision, lock=True)
            self._require_approved(draft)
            self._sequence_ready(graph, state, draft)
            validate_account_evidence(get_account(state, draft.account_id), draft.current)
            if draft.current.channel != 'linkedin' or not self.settings.linkedin_test_profile_url or draft.current.test_recipient != self.settings.linkedin_test_profile_url:
                raise SignalError('linkedin_test_profile_required', 'Set the controlled LinkedIn profile and approve the exact recipient.', 422)
            if state.leads[draft.account_id].bounced:
                raise SignalError('previous_bounce', 'Review the delivery failure before preparing another message.')
            if not draft.prepared_at:
                draft.prepared_at = utcnow()
                graph.save_draft(draft)
                add_activity(state, 'linkedin_handoff_prepared', actor,
                             'An approved LinkedIn message was prepared for the controlled profile.',
                             account_id=draft.account_id, draft_id=key, revision=revision)

        self.store.write(prepare)
        return self.workspace()

    def send_draft(self, key: str, revision: int, actor: str) -> Workspace:
        def reserve(graph: GraphTransaction, state: State) -> DraftRevision | None:
            draft = current_draft(graph, state, key, revision, lock=True)
            if draft.dispatch:
                return None
            self._require_approved(draft)
            if draft.current.channel != 'email':
                raise SignalError('linkedin_handoff_required', 'Use the LinkedIn action for this approved draft.', 422)
            self._sequence_ready(graph, state, draft)
            validate_account_evidence(get_account(state, draft.account_id), draft.current)
            recipient = self.settings.test_recipient
            if not recipient or draft.current.test_recipient != recipient:
                raise SignalError('test_recipient_changed', 'Configure the controlled recipient and review a new draft revision.')
            if recipient in self.settings.suppressed_recipients:
                raise SignalError('recipient_suppressed', 'The configured recipient is suppressed.')
            if not self.settings.gmail_configured:
                raise ProviderError('Gmail', 'OAuth settings or the controlled test recipient are missing.', 503)
            if state.leads[draft.account_id].bounced:
                raise SignalError('previous_bounce', 'Review the delivery failure before sending another message.')
            now = utcnow()
            window_start = now - timedelta(hours=1)
            reserved = sum(event.type == 'dispatch_reserved' and event.at > window_start for event in state.activity)
            if reserved >= self.settings.test_send_limit_per_hour:
                raise SignalError('send_rate_limit', 'The controlled test workspace reached its hourly send limit. Try again later.', 429)
            draft.dispatch = DispatchAttempt(revision=revision, actor=actor, at=now)
            graph.save_draft(draft)
            add_activity(state, 'dispatch_reserved', actor, 'One test send attempt was reserved.',
                         account_id=draft.account_id, draft_id=key, revision=revision)
            return draft.current

        approved = self.store.write(reserve)
        if approved is not None:
            delivery = self.providers.send(approved)
            self._finish_send(key, revision, delivery)
        return self.workspace()

    def _finish_send(self, key: str, revision: int, delivery: Delivery) -> None:
        def finish(graph: GraphTransaction, state: State) -> UsageEvent | None:
            draft = graph.draft(key, lock=True)
            if not draft or not draft.dispatch or draft.dispatch.revision != revision or draft.dispatch.status != 'pending_outcome':
                raise SignalError('dispatch_reservation_missing', 'The reserved attempt could not be reconciled.')
            attempt = draft.dispatch
            attempt.finished_at = utcnow()
            attempt.status = delivery.status
            attempt.provider_message_id = delivery.provider_message_id
            graph.save_draft(draft)
            descriptions = {
                'sent': 'Gmail accepted the approved test message.',
                'failed': 'The test send failed. The pipeline was not advanced.',
                'pending_outcome': 'The provider outcome is uncertain. Check the controlled inbox before taking any action.',
            }
            add_activity(state, f'dispatch_{delivery.status}', attempt.actor, descriptions[delivery.status],
                         account_id=draft.account_id, draft_id=key, revision=revision)
            if attempt.status == 'sent':
                lead = state.leads[draft.account_id]
                lead.test_send = True
                if lead.stage == 'matched':
                    lead.channel = 'email'
                    lead.message_variant = draft.current.message_variant
                    lead.value_proposition = draft.current.value_proposition
                self._record_pipeline(graph, state, lead, PipelineEvent(
                    id=stable_id('pipeline', key, str(revision)), account_id=lead.account_id, draft_id=key,
                    revision=revision, from_stage=lead.stage, to_stage='contacted' if lead.stage == 'matched' else lead.stage,
                    actor=attempt.actor, at=attempt.finished_at,
                ))
                return self._queue_extra_meter(state, 'outreach_sent', lead.account_id, key, revision)
            return None

        if event := self.store.write(finish):
            self._submit_meter(event)
