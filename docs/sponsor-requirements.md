# AI GTM Engine sponsor requirements

This checklist maps the supplied sponsor specification to Signal. All three sponsor bonuses are included in the team's completion criteria. Live verification and tests with controlled provider responses are recorded separately.

## Core requirements

| Requirement | Implementation and evidence | Remaining verification |
| --- | --- | --- |
| Product intake | Profile has an editable form and iterative chat for capabilities, constraints, customer wins, pricing, and contract value. A live Haiku request returned structured form suggestions. The user applies them before generating an ICP. | The form and chat are ready for the submission flow. |
| ICP inference and expansion | Saved revisions include industries, validated NAICS/SIC codes, geography, headcount and revenue bands, titles, seniority, triggers, and field-level confidence. An adjacent segment includes a citation and can be accepted, edited, or dismissed. Discovery requires the current approved revision. | Browser and backend checks covered approval and code validation. |
| Account and buyer discovery | Tavily and Nexla supply company records. The approved ICP, cited fit and intent, hard exclusions, and negative signals determine Contact, Hold, or Reject. Hunter looks up the target role for a qualified account. | Live discovery saved three cited leads. The expanded filings and jobs path needs a bounded live run. |
| Competitive landscape | Direct, indirect, and alternative results include supported positioning and differentiation. Public plan names, pricing, and packaging excerpts carry source evidence. Unknown prices remain labeled. | Fixture tests cover the category and pricing output. A live run should verify all three categories and any published packages it finds. |
| Native graph and reasoning | Neo4j persists Company, Person, Product, Competitor, and Signal. Relationship queries cover matching, employment and education, competitors, outreach interactions, replies, possible introductions, buying evaluation, renewal, and churn. | Live graph paths supported a source-backed draft. The advanced paths passed tests with controlled sources and need live evidence. |
| Continuous ingestion | The daily Render graph refresh claims work in Neo4j and updates source evidence and relationship recency. The GitHub health check successfully wakes the service. | Verify the scheduled provider-backed refresh when due. |
| Contact enrichment | Hunter returns role-matched business contact and verification status. Addresses are masked in the workspace. MX, headquarters, and validated LinkedIn links are shown when supported. | Live business-email verification passed. A provider-backed example of the additional fields is open. |
| Personalized multichannel outreach | Evidence-backed initial and follow-up email and LinkedIn drafts have separate revisions. The backend validates the copy and enforces approval of the bound snapshot, earliest follow-up time, and controlled recipient. | Live Gmail test receipt passed. LinkedIn manual handoff passed controlled testing. Direct LinkedIn delivery needs approved Messages API access and a controlled test profile. |
| Messaging feedback and throttling | Gmail metadata sync deduplicates replies and bounces for accepted test threads. A reserved draft can call Gmail once. The workspace rate limit also caps distinct hourly send attempts. | Metadata access was verified with the controlled inbox. Real reply/bounce events and authenticated Gmail push with Google Pub/Sub remain open. |
| Pipeline, attribution, and analytics | Kanban covers the five stages. Confirmation, provider feedback, and direct rep changes record timestamps. The UI shows Signal automation, Gmail automation, or rep action and includes the send requester and revision. Industry, tier, message variant, channel, and value proposition are available as funnel dimensions. | The email flow and rep changes have tests. Live LinkedIn outcome attribution is gated on messaging access. The shared demo identity attributes human actions to one rep identity. |
| Workspace UI | The account table shows fit, intent, tier, recommendation, and verification status. Outreach exposes Gmail and LinkedIn and offers inline revision review. The collapsible activity sheet shows recorded evidence, graph, review, and provider events. | The 1440px and 390px browser checks passed with controlled provider responses. |

Signal uses Neo4j, Claude, Tavily, Hunter, Gmail, and Next.js with Tailwind and shadcn. The specification lists interchangeable tools for those architectural tiers. [Architecture](architecture.md) · [API contract](api-contract.md)

## Sponsor bonuses

| Bonus | Evidence | Open work |
| --- | --- | --- |
| Band Desktop | The signed-in daemon and three connected Express agents were verified. | Four specialized Planner, Builder, Reviewer, and Security roles must work a case through `@mention` handoffs. Capture human decisions for schema changes and dispatch, plus shared messages, session tokens, and cost telemetry. |
| Flexprice | Sandbox accepted Lead Enriched, Graph Query Evaluated, and Outreach Sent events. The lower-balance check blocked enrichment before Hunter. The ledger allocated 1.15 credits to one lead. | Retain the Sandbox proof for judging. |
| Snyk | Local dependency scanning returned zero findings for 26 backend dependencies and the frontend lockfile. GitHub Actions contains SCA and Snyk Code steps. | Snyk Code access for the configured organization and a repository scanner secret are needed for verified SAST and SCA in CI/CD. |

Nexla also returned five records that saved as citations in Neo4j.

## Submission evidence

- [Hosted prototype](https://signal-gtm.onrender.com) passed health, authenticated workspace, and Neo4j checks. The team shares the demo password privately.
- [Public source repository](https://github.com/hiromaruyama/hackathon-hackw-bay4.0) includes setup instructions and the [system design](architecture.md).
- The 2:32 narrated video shows intake, graph matching, cited outreach, review, and pipeline updates with controlled provider responses. Retain the separately verified Gmail receipt and provider evidence for live claims.
