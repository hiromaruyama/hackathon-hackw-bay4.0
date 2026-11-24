// Mirrors docs/api-contract.md and docs/workspace.example.json on the backend branch.
// Keep these in step with the backend owner; contract changes need a fixture update.

export type Recommendation = "contact" | "hold" | "reject";
export type Tier = "A" | "B" | "C";
export type EnrichmentStatus = "not_started" | "verified" | "uncertain" | "not_found" | "failed";
export type ReviewStatus = "pending_review" | "approved" | "rejected" | "writing_only";
export type DispatchStatus = "not_sent" | "pending_outcome" | "sent" | "failed";
export type ExpansionDecision = "accept" | "edit" | "dismiss";
export type Stage = "matched" | "contacted" | "replied" | "meeting_booked" | "closed_lost";
export type Outcome = "won" | "lost";

export interface Product {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  constraints: string[];
  customers_and_wins: string[];
  pricing: string | null;
  contract_value: string | null;
}

export interface IcpFields {
  industries: string[];
  industry_codes?: IndustryCode[];
  geography: string[];
  headcount_band: string | null;
  revenue_band: string | null;
  buyer_titles: string[];
  seniority: string[];
  triggers: string[];
  exclusions: string[];
}

export interface IndustryCode {
  system: "NAICS" | "SIC";
  code: string;
  title?: string | null;
}

export type IcpFieldKey = keyof IcpFields;

export interface Evidence {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  source_type: string;
  published_at: string | null;
}

export interface IcpExpansion {
  segment: string;
  reason: string;
  evidence: Evidence;
}

export interface Icp {
  revision: number;
  approved: boolean;
  fields: IcpFields;
  confidence: Partial<Record<IcpFieldKey, number>>;
  expansion: IcpExpansion | null;
  expansion_decision: ExpansionDecision | null;
  updated_at: string;
}

export interface Signal {
  id: string;
  kind: string;
  summary: string;
  occurred_on: string | null;
  evidence_id: string | null;
}

export interface NegativeSignal {
  reason: string;
  evidence_id: string;
  hard_exclusion: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  name: string;
  relationship: string | null;
  evidence_id: string | null;
}

export interface GraphInsight {
  kind: "employment" | "education" | "warm_introduction" | "buying_evaluation" | "renewal" | "churn";
  path: string[];
  evidence: Evidence[];
}

export interface Contact {
  id: string;
  role: string;
  email_masked: string | null;
  verification_status: string | null;
  mx_valid: boolean | null;
  headquarters: string | null;
  linkedin_url: string | null;
}

export interface Draft {
  id: string;
  account_id: string;
  revision: number;
  subject: string;
  body: string;
  test_recipient: string | null;
  evidence_ids: string[];
  role_based: boolean;
  synthesis_mode: "claude" | "grounded_template" | "manual";
  review_status: ReviewStatus;
  dispatch_status: DispatchStatus;
  updated_at: string;
  channel?: "email" | "linkedin";
  sequence_step?: number;
  message_variant?: "A" | "B" | null;
  value_proposition?: string | null;
  scheduled_at?: string | null;
  prepared_at?: string | null;
}

export interface Account {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  company_size: string | null;
  geography: string | null;
  buyer_role: string | null;
  fit_score: number;
  intent_score: number;
  tier: Tier;
  recommendation: Recommendation;
  reason: string;
  researched_at: string;
  icp_revision: number;
  evidence: Evidence[];
  signal: Signal | null;
  negative_signal: NegativeSignal | null;
  graph_path: GraphNode[];
  enrichment_status: EnrichmentStatus;
  contact: Contact | null;
  draft: Draft | null;
  sequence?: Draft[];
}

export interface Competitor {
  name: string;
  positioning: string;
  differentiator: string;
  pricing: string | null;
  evidence: Evidence[];
  category?: "direct" | "indirect" | "alternative";
  plans?: { name: string; price: string | null; evidence_id: string }[];
}

export interface ActivityEvent {
  id: string;
  type: string;
  actor: string;
  at: string;
  account_id: string | null;
  draft_id: string | null;
  revision: number | null;
  message: string;
}

export interface Lead {
  account_id: string;
  company: string;
  role: string | null;
  fit_score: number;
  stage: Stage;
  test_send: boolean;
  actor: string;
  updated_at: string;
  next_action: string | null;
  industry?: string | null;
  tier?: Tier | null;
  outcome?: Outcome | null;
  bounced?: boolean;
  message_variant?: string | null;
  channel?: string | null;
  value_proposition?: string | null;
}

export interface PipelineEvent {
  id: string;
  account_id: string;
  revision?: number | null;
  from_stage?: Stage | null;
  to_stage: Stage;
  test_send: boolean;
  actor: string;
  at: string;
  action?: "send" | "reply" | "bounce" | "meeting" | "close";
  source?: "gmail" | "rep";
  note?: string | null;
  outcome?: Outcome | null;
}

export interface PipelineChange {
  expected_stage: Stage;
  to_stage: "replied" | "meeting_booked" | "closed_lost";
  note?: string;
  outcome?: Outcome;
}

export interface FunnelGroup {
  label: string;
  reached: Record<Stage, number>;
}

export interface Pipeline {
  leads: Lead[];
  events: PipelineEvent[];
  counts: Record<Stage, number>;
  enriched_count: number;
  pending_approval_count: number;
  matched_to_contacted_rate: number | null;
  analytics?: Record<string, FunnelGroup[]>;
  gmail_feedback_configured?: boolean;
}

export interface UsageEvent {
  id: string;
  account_id: string;
  operation: "leads_enriched" | "graph_query_evaluated" | "outreach_sent";
  units: number;
  status: "pending" | "accepted" | "blocked" | "failed";
  at: string;
}

export interface Usage {
  balance: number | null;
  available_for_enrichment: number | null;
  enrichment_cost: number | null;
  checked_at: string | null;
  status: string;
  events: UsageEvent[];
}

export interface Workspace {
  product: Product | null;
  icp: Icp | null;
  approved_icp_revision: number | null;
  accounts: Account[];
  competitor: Competitor | null;
  competitors?: Competitor[];
  activity: ActivityEvent[];
  pipeline: Pipeline;
  usage: Usage | null;
  research_schedule?: { interval_minutes: number; last_completed_at: string | null; next_due_at: string | null } | null;
  more_accounts_available?: boolean;
}

export interface IcpGenerateInput {
  name: string;
  description: string;
  capabilities: string[];
  constraints: string[];
  customers_and_wins: string[];
  pricing: string | null;
  contract_value: string | null;
}

export type IntakeFields = { [Key in keyof IcpGenerateInput]?: IcpGenerateInput[Key] | null };

export interface IntakeMessage {
  role: "user" | "assistant";
  text: string;
}

export interface IntakeReply {
  reply: string;
  proposal: IntakeFields;
}

export interface IcpApproveInput {
  revision: number;
  fields: IcpFields;
  expansion_decision: ExpansionDecision;
  expansion_segment?: string;
}
