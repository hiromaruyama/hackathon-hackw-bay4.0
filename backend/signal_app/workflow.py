from collections import Counter
from threading import Lock
from uuid import NAMESPACE_URL, uuid4, uuid5

from .config import EMAIL_PATTERN, Settings
from .errors import ProviderError, SignalError
from .models import (
    Account, Activity, ApproveIcp, DispatchAttempt, Draft, DraftReview, DraftRevision, EditDraft, Icp,
    Lead, Pipeline, PipelineEvent, Product, ProductInput, ReviewDraft, State, Usage, UsageEvent, UsageOperation, Workspace,
)
from .providers import Delivery, Enriched, Providers, stable_id, utcnow
from .research import analyze_research, check_copy, focus_research, gather_research, make_profile, write_copy
from .store import GraphTransaction, Neo4jStore


PIPELINE_STAGES = ('matched', 'contacted', 'replied', 'meeting_booked', 'closed_lost')


def add_activity(state: State, event: str, actor: str, message: str, *, account_id=None, draft_id=None, revision=None) -> None:
    state.activity.append(Activity(
        id=str(uuid4()), type=event, actor=actor, at=utcnow(), message=message,
        account_id=account_id, draft_id=draft_id, revision=revision,
    ))


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


def draft_id(account: Account) -> str:
    return stable_id('draft', account.id, str(account.icp_revision))


def current_draft(graph: GraphTransaction, state: State, key: str, revision: int, *, lock: bool = False) -> Draft:
    draft = graph.draft(key, lock=lock)
    if not draft:
        raise SignalError('draft_not_found', 'The requested draft was not found.', 404)
    if draft.current.revision != revision:
        raise SignalError('stale_draft_revision', 'Refresh and use the current draft revision.')
    icp_current(state, draft.icp_revision)
    return draft


def require_open_draft(draft: Draft) -> None:
    if draft.dispatch:
        raise SignalError('dispatch_already_reserved', 'This draft is locked because a send was already reserved.')


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

    def workspace(self) -> Workspace:
        def view(graph: GraphTransaction, state: State) -> Workspace:
            accounts = []
            for account in state.accounts:
                draft = graph.draft(draft_id(account))
                path = graph.graph_path(state.product.id, account) if state.product else []
                accounts.append(account.model_copy(update={'graph_path': path, 'draft': draft.view() if draft else None}))

            leads = []
            drafts_by_account = {account.id: account.draft for account in accounts}
            for lead in state.leads.values():
                draft = drafts_by_account.get(lead.account_id)
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
                leads.append(lead)
            stage_counts = Counter(lead.stage for lead in leads)
            reached_contacted = sum(lead.stage != 'matched' for lead in leads)
            usage = state.usage if self.settings.flexprice_enabled else None
            if self.settings.flexprice_enabled and usage is None:
                usage = Usage(enrichment_cost=float(self.settings.flexprice_enrichment_cost))
            return Workspace(
                product=state.product, icp=state.latest_icp, approved_icp_revision=state.approved_icp_revision,
                accounts=accounts, competitor=state.competitor, activity=list(reversed(state.activity[-60:])),
                pipeline=Pipeline(
                    leads=leads, events=state.pipeline_events, counts={stage: stage_counts[stage] for stage in PIPELINE_STAGES},
                    enriched_count=sum(account.enrichment_status == 'verified' for account in accounts),
                    pending_approval_count=sum(bool(a.draft and a.draft.review_status == 'pending_review') for a in accounts),
                    matched_to_contacted_rate=reached_contacted / len(leads) if leads else None,
                ),
                usage=usage,
            )

        return self.store.read(view)

    def generate_icp(self, request: ProductInput, actor: str) -> Workspace:
        product = Product(id=stable_id('product', request.name, request.description), **request.model_dump())
        output, expansion = make_profile(self.providers, product)
        confidence = {name: value if getattr(output.fields, name) else 0 for name, value in output.confidence.model_dump().items()}

        def save(graph: GraphTransaction, state: State) -> None:
            revision = state.latest_icp.revision + 1 if state.latest_icp else 1
            state.product = product
            state.icp_versions.append(Icp(revision=revision, approved=False, fields=output.fields,
                                          confidence=confidence, expansion=expansion, updated_at=utcnow()))
            state.approved_icp_revision = None
            state.discovery_revision = None
            state.research_batch = None
            state.accounts = []
            state.competitor = None
            add_activity(state, 'icp_generated', actor, 'An editable ICP was generated with source-backed expansion where available.', revision=revision)

        self.store.write(save)
        return self.workspace()

    def approve_icp(self, request: ApproveIcp, actor: str) -> Workspace:
        def approve(graph: GraphTransaction, state: State) -> None:
            current = state.latest_icp
            if not current or current.revision != request.revision:
                raise SignalError('stale_icp_revision', 'Refresh and approve the current ICP revision.')
            fields = request.fields.model_copy(deep=True)
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
            state.accounts = []
            state.competitor = None
            add_activity(state, 'icp_approved', actor, 'The edited ICP revision was approved.', revision=revision)

        self.store.write(approve)
        return self.workspace()

    def discover(self, revision: int, actor: str, *, refresh: bool = False) -> Workspace:
        with self._discovery_lock:
            completed = self.store.read(lambda graph, state: state.discovery_revision == icp_current(state, revision).revision)
            if completed and not refresh:
                return self.workspace()
            return self._run_discovery(revision, actor, refresh=refresh)

    def _run_discovery(self, revision: int, actor: str, *, refresh: bool) -> Workspace:
        product, icp, batch = self.store.read(lambda graph, state: (state.product, icp_current(state, revision), state.research_batch))
        if not product:
            raise SignalError('product_missing', 'Generate an ICP from a product first.')
        def cache(graph: GraphTransaction, state: State) -> None:
            icp_current(state, revision)
            state.research_batch = batch
            state.discovery_revision = None

        if refresh or not batch or batch.revision != revision:
            batch = gather_research(self.providers, product, icp, bool(self.settings.nexla_sync_url), self.settings.discovery_domains)
            self.store.write(cache)

        accounts, competitor = analyze_research(self.providers, product, icp, batch)
        if not batch.focused_search_used and (len(accounts) < 2 or not any(a.recommendation == 'contact' for a in accounts)):
            previous_sources = batch.prospects
            batch = focus_research(self.providers, product, icp, batch, accounts, self.settings.discovery_domains)
            self.store.write(cache)
            if batch.prospects != previous_sources:
                accounts, competitor = analyze_research(self.providers, product, icp, batch)

        def save(graph: GraphTransaction, state: State) -> None:
            icp_current(state, revision)
            previous = {account.id: account for account in state.accounts}
            for account in accounts:
                if old := previous.get(account.id):
                    account.enrichment_status = old.enrichment_status
                    account.contact = old.contact
                if account.recommendation == 'contact':
                    lead = state.leads.get(account.id)
                    if not lead or lead.stage == 'matched':
                        state.leads[account.id] = Lead(
                            account_id=account.id, company=account.name, role=account.buyer_role, fit_score=account.fit_score,
                            actor='system', updated_at=account.researched_at, next_action='Enrich this matched account',
                        )
                elif account.id in state.leads and state.leads[account.id].stage == 'matched':
                    state.leads[account.id].next_action = 'Review the current research before outreach'
            graph.save_discovery(product, accounts, competitor)
            state.accounts = accounts
            state.competitor = competitor
            state.discovery_revision = revision
            add_activity(state, 'discovery_completed', actor, f'Saved {len(accounts)} sourced accounts for the approved ICP.', revision=revision)
            if competitor:
                add_activity(state, 'competitor_sourced', 'system', 'A competitor comparison was saved with public citations.')
            if batch.nexla_status:
                add_activity(state, 'nexla_discovery', 'system', batch.nexla_status)

        self.store.write(save)
        return self.workspace()

    def _draft_inputs(self, graph: GraphTransaction, state: State, account_id: str):
        account = get_account(state, account_id)
        icp_current(state, account.icp_revision)
        if account.recommendation != 'contact':
            raise SignalError('account_not_qualified', 'Resolve this lead’s research hold before enriching or drafting.')
        if not state.product or not account.buyer_role:
            raise SignalError('buyer_role_missing', 'Approve a buyer title before drafting.')
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
            current = get_account(state, account.id)
            icp_current(state, current.icp_revision)
            if current.researched_at != account.researched_at:
                raise SignalError('discovery_changed', 'Refresh and draft from the current research.')
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

            if account.enrichment_status == 'not_started':
                event = self._reserve_credit(account, actor)
                try:
                    enriched = self.providers.enrich(account.domain, account.buyer_role)
                except ProviderError:
                    enriched = Enriched('failed', None)
                self._finish_enrichment(account, enriched, event, actor)
            else:
                enriched = Enriched(account.enrichment_status, account.contact)

            role = enriched.contact.role if enriched.status == 'verified' and enriched.contact else account.buyer_role
            copy, synthesis_mode = write_copy(self.providers, product, account, evidence_id, role)
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

    def edit_draft(self, key: str, request: EditDraft, actor: str) -> Workspace:
        validate_copy(request.subject, request.body)

        def edit(graph: GraphTransaction, state: State) -> None:
            draft = current_draft(graph, state, key, request.expected_revision, lock=True)
            require_open_draft(draft)
            revision = draft.current.revision + 1
            draft.revisions.append(draft.current.model_copy(update={
                'revision': revision, 'subject': request.subject, 'body': request.body,
                'test_recipient': self.settings.test_recipient, 'actor': actor, 'at': utcnow(),
            }))
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
            if draft.current.actor != 'system' and product:
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
            graph.save_draft(draft)
            add_activity(state, 'draft_approved' if request.decision == 'approve' else 'draft_rejected', actor,
                         f'The current draft revision was {"approved" if request.decision == "approve" else "rejected"}.',
                         account_id=draft.account_id, draft_id=key, revision=request.revision)

        self.store.write(review)
        return self.workspace()

    def send_draft(self, key: str, revision: int, actor: str) -> Workspace:
        def reserve(graph: GraphTransaction, state: State) -> DraftRevision | None:
            draft = current_draft(graph, state, key, revision, lock=True)
            if draft.dispatch:
                return None
            review = draft.review
            if not review or review.decision != 'approve' or review.approved_snapshot != draft.current:
                raise SignalError('approval_required', 'Approve this exact draft revision before sending.')
            validate_account_evidence(get_account(state, draft.account_id), draft.current)
            recipient = self.settings.test_recipient
            if not recipient or draft.current.test_recipient != recipient:
                raise SignalError('test_recipient_changed', 'Configure the controlled recipient and review a new draft revision.')
            if recipient in self.settings.suppressed_recipients:
                raise SignalError('recipient_suppressed', 'The configured recipient is suppressed.')
            if not self.settings.gmail_configured:
                raise ProviderError('Gmail', 'OAuth settings or the controlled test recipient are missing.', 503)
            draft.dispatch = DispatchAttempt(revision=revision, actor=actor, at=utcnow())
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
                stage = lead.stage
                lead.stage = 'contacted'
                lead.test_send = True
                lead.actor = attempt.actor
                lead.updated_at = attempt.finished_at
                lead.next_action = 'Review the test delivery'
                state.pipeline_events.append(PipelineEvent(
                    id=stable_id('pipeline', key, str(revision)), account_id=lead.account_id, draft_id=key,
                    revision=revision, from_stage=stage, to_stage='contacted', actor=attempt.actor, at=attempt.finished_at,
                ))
                return self._queue_extra_meter(state, 'outreach_sent', lead.account_id, key, revision)
            return None

        if event := self.store.write(finish):
            self._submit_meter(event)
