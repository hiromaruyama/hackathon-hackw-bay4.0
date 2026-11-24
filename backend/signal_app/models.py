from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=250)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
TextList = Annotated[list[ShortText], Field(max_length=12)]
Revision = Annotated[int, Field(strict=True, ge=1)]
Score = Annotated[int, Field(ge=0, le=100)]
Confidence = Annotated[float, Field(ge=0, le=1)]
DraftStatus = Literal['pending_review', 'approved', 'rejected']
DispatchStatus = Literal['not_sent', 'pending_outcome', 'sent', 'failed']
EnrichmentStatus = Literal['not_started', 'verified', 'uncertain', 'not_found', 'failed']
PipelineStage = Literal['matched', 'contacted', 'replied', 'meeting_booked', 'closed_lost']
SignalKind = Literal['direct', 'indirect', 'weak']
SynthesisMode = Literal['claude', 'grounded_template']


class InputModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ProductInput(InputModel):
    name: ShortText
    description: Description
    capabilities: TextList = Field(default_factory=list)
    constraints: TextList = Field(default_factory=list)
    customers_and_wins: TextList = Field(default_factory=list)
    pricing: ShortText | None = None
    contract_value: ShortText | None = None


class Product(ProductInput):
    id: str


class IcpFields(InputModel):
    industries: TextList = Field(default_factory=list)
    geography: TextList = Field(default_factory=list)
    headcount_band: ShortText | None = None
    revenue_band: ShortText | None = None
    buyer_titles: TextList = Field(default_factory=list)
    seniority: TextList = Field(default_factory=list)
    triggers: TextList = Field(default_factory=list)
    exclusions: TextList = Field(default_factory=list)


class Evidence(BaseModel):
    id: str
    url: str
    title: str
    excerpt: str
    source_type: Literal['company', 'filing', 'news', 'job', 'partner', 'web']
    published_at: date | None = None
    retrieved_at: datetime | None = None


@dataclass(frozen=True)
class Source:
    id: str
    url: str
    title: str
    text: str
    published_at: date | None
    provider: str

    def prompt_record(self) -> dict:
        return {
            'id': self.id, 'url': self.url, 'title': self.title, 'excerpt': self.text,
            'published_at': self.published_at.isoformat() if self.published_at else None,
        }


class ResearchBatch(BaseModel):
    revision: int
    prospects: list[Source]
    competitors: list[Source]
    nexla_status: str | None = None
    focused_search_used: bool = False


class Expansion(BaseModel):
    segment: str
    reason: str
    evidence: Evidence


class Icp(BaseModel):
    revision: int
    approved: bool
    fields: IcpFields
    confidence: dict[str, Confidence]
    expansion: Expansion | None = None
    expansion_decision: Literal['accept', 'edit', 'dismiss'] | None = None
    updated_at: datetime


class ApproveIcp(InputModel):
    revision: Revision
    fields: IcpFields
    expansion_decision: Literal['accept', 'edit', 'dismiss'] = 'dismiss'
    expansion_segment: ShortText | None = None


class RevisionInput(InputModel):
    revision: Revision


class DiscoverInput(RevisionInput):
    refresh: bool = False


class EditDraft(InputModel):
    expected_revision: Revision
    subject: ShortText
    body: Description


class ReviewDraft(RevisionInput):
    decision: Literal['approve', 'reject']


class Signal(BaseModel):
    id: str
    kind: SignalKind
    summary: str
    occurred_on: date | None
    evidence_id: str


class NegativeSignal(BaseModel):
    reason: str
    evidence_id: str
    hard_exclusion: bool


class GraphStep(BaseModel):
    id: str
    label: Literal['Product', 'Company', 'Signal']
    name: str
    relationship: Literal['MATCHED_TO', 'HAS_SIGNAL'] | None = None
    evidence_id: str | None = None


class Contact(BaseModel):
    id: str
    role: str
    email_masked: str
    verification_status: str | None = None
    mx_valid: bool | None = None
    headquarters: str | None = None
    linkedin_url: str | None = None


class Competitor(BaseModel):
    name: str
    positioning: str
    differentiator: str
    pricing: str | None = None
    evidence: list[Evidence]


class DraftView(BaseModel):
    id: str
    account_id: str
    revision: int
    subject: str
    body: str
    test_recipient: str | None
    evidence_ids: list[str]
    role_based: bool
    synthesis_mode: SynthesisMode = 'claude'
    review_status: DraftStatus
    dispatch_status: DispatchStatus
    updated_at: datetime


class Account(BaseModel):
    id: str
    name: str
    domain: str
    industry: str | None
    company_size: str | None
    geography: str | None
    buyer_role: str | None
    fit_score: Score
    intent_score: Score
    tier: Literal['A', 'B', 'C']
    recommendation: Literal['contact', 'hold', 'reject']
    reason: str
    researched_at: datetime
    icp_revision: int
    evidence: list[Evidence]
    signal: Signal | None = None
    negative_signal: NegativeSignal | None = None
    graph_path: list[GraphStep] = Field(default_factory=list)
    enrichment_status: EnrichmentStatus = 'not_started'
    contact: Contact | None = None
    draft: DraftView | None = None


class Activity(BaseModel):
    id: str
    type: str
    actor: str
    at: datetime
    account_id: str | None = None
    draft_id: str | None = None
    revision: int | None = None
    message: str


class Lead(BaseModel):
    account_id: str
    company: str
    role: str | None
    fit_score: Score
    stage: PipelineStage = 'matched'
    test_send: bool = False
    actor: str
    updated_at: datetime
    next_action: str


class PipelineEvent(BaseModel):
    id: str
    account_id: str
    draft_id: str
    revision: int
    from_stage: PipelineStage
    to_stage: PipelineStage
    actor: str
    at: datetime
    test_send: bool = True


class Pipeline(BaseModel):
    leads: list[Lead]
    events: list[PipelineEvent]
    counts: dict[PipelineStage, int]
    enriched_count: int
    pending_approval_count: int
    matched_to_contacted_rate: float | None


class UsageEvent(BaseModel):
    id: str
    account_id: str
    operation: Literal['leads_enriched', 'graph_query_evaluated', 'outreach_sent']
    units: int = 1
    status: Literal['pending', 'accepted', 'blocked', 'failed']
    at: datetime


class Usage(BaseModel):
    balance: float | None = None
    available_for_enrichment: float | None = None
    enrichment_cost: float
    checked_at: datetime | None = None
    status: Literal['not_checked', 'ready', 'blocked', 'unavailable'] = 'not_checked'
    events: list[UsageEvent] = Field(default_factory=list)


class Workspace(BaseModel):
    product: Product | None
    icp: Icp | None
    approved_icp_revision: int | None
    accounts: list[Account]
    competitor: Competitor | None
    activity: list[Activity]
    pipeline: Pipeline
    usage: Usage | None


class DraftRevision(BaseModel):
    revision: int
    subject: str
    body: str
    test_recipient: str | None
    evidence_ids: list[str]
    role_based: bool
    synthesis_mode: SynthesisMode = 'claude'
    actor: str
    at: datetime


class DraftReview(BaseModel):
    revision: int
    decision: Literal['approve', 'reject']
    actor: str
    at: datetime
    approved_snapshot: DraftRevision | None = None


class DispatchAttempt(BaseModel):
    revision: int
    actor: str
    at: datetime
    status: Literal['pending_outcome', 'sent', 'failed'] = 'pending_outcome'
    finished_at: datetime | None = None
    provider_message_id: str | None = None


class Draft(BaseModel):
    id: str
    account_id: str
    icp_revision: int
    revisions: list[DraftRevision]
    reviews: list[DraftReview] = Field(default_factory=list)
    dispatch: DispatchAttempt | None = None

    @property
    def current(self) -> DraftRevision:
        return self.revisions[-1]

    @property
    def review(self) -> DraftReview | None:
        return next((item for item in reversed(self.reviews) if item.revision == self.current.revision), None)

    def view(self) -> DraftView:
        review = self.review
        review_status = 'approved' if review and review.decision == 'approve' else 'rejected' if review else 'pending_review'
        return DraftView(
            id=self.id, account_id=self.account_id, revision=self.current.revision,
            subject=self.current.subject, body=self.current.body, test_recipient=self.current.test_recipient,
            evidence_ids=self.current.evidence_ids, role_based=self.current.role_based,
            synthesis_mode=self.current.synthesis_mode,
            review_status=review_status, dispatch_status=self.dispatch.status if self.dispatch else 'not_sent',
            updated_at=(self.dispatch.finished_at or self.dispatch.at) if self.dispatch else review.at if review else self.current.at,
        )


class State(BaseModel):
    product: Product | None = None
    icp_versions: list[Icp] = Field(default_factory=list)
    approved_icp_revision: int | None = None
    discovery_revision: int | None = None
    research_batch: ResearchBatch | None = None
    accounts: list[Account] = Field(default_factory=list)
    competitor: Competitor | None = None
    activity: list[Activity] = Field(default_factory=list)
    leads: dict[str, Lead] = Field(default_factory=dict)
    pipeline_events: list[PipelineEvent] = Field(default_factory=list)
    usage: Usage | None = None
    billing_wallet: str | None = None
    billing_remaining: Decimal | None = None

    @property
    def latest_icp(self) -> Icp | None:
        return self.icp_versions[-1] if self.icp_versions else None
