# AI GTM Engine sponsor requirements

This checklist maps the supplied sponsor specification to Signal. All three sponsor bonuses are included in the team's completion criteria. Live verification and tests with controlled provider responses are recorded separately.

## Core requirements

| Requirement | Implementation and evidence | Remaining verification |
| --- | --- | --- |
| Product intake | Profile has an editable form and iterative chat for capabilities, constraints, customer wins, pricing, and contract value. A live Haiku request returned structured form suggestions. The user applies them before generating an ICP. | The form and chat are ready for the submission flow. |
| ICP inference and expansion | Saved revisions include industries, validated NAICS/SIC codes, geography, headcount and revenue bands, titles, seniority, triggers, and field-level confidence. An adjacent segment includes a citation and can be accepted, edited, or dismissed. Discovery requires the current approved revision. | Browser and backend checks covered approval and code validation. |
| Account and buyer discovery | Tavily and Nexla supply source records. The approved ICP, cited fit and intent, hard exclusions, and negative signals determine Contact, Hold, or Reject. The primary search requests up to 16 pages and the append action adds unique, cited accounts under the same profile. | Ten basic Tavily searches returned 158 source hits. The initial Claude extraction failed on grammar complexity. The revised extraction saved five cited GeoFlow accounts from public developer pages fetched in Playwright. More live proof is needed for saved filing and job citations. |
| Competitive landscape | Direct, indirect, and alternative results include supported positioning and differentiation. Public plan names, pricing, and packaging excerpts carry source evidence. Unknown prices remain labeled. | The bounded live pass saved one cited direct competitor with unknown pricing. Indirect and alternative comparisons and pricing passed fixture checks. |
| Native graph and reasoning | Neo4j persists Company, Person, Product, Competitor, and Signal. Relationship queries cover matching, employment and education, competitors, outreach interactions, replies, possible introductions, buying evaluation, renewal, and churn. | Live graph paths supported a source-backed draft. The advanced paths passed tests with controlled sources. The bounded live pass queried the live graph and returned no advanced paths for its accounts. |
| Continuous ingestion | The daily Render graph refresh claims work in Neo4j and updates source evidence and relationship recency. The GitHub health check successfully wakes the service. | Verify the scheduled provider-backed refresh when due. |
| Contact enrichment | The qualified-account lookup saves a masked, role-matched Hunter result and the actual verification status before drafting. Repeat requests reuse the stored result. MX, headquarters, and validated LinkedIn links are shown when supported. | Two live lookups on the expanded GeoFlow profile produced one verified work contact and one no-match status. Provider-backed proof for the additional fields remains open. |
| Personalized multichannel outreach | Evidence-backed initial and follow-up email and LinkedIn drafts have separate revisions. The backend validates the copy and enforces approval of the bound snapshot, earliest follow-up time, and controlled recipient. | Live Gmail test receipt passed. LinkedIn manual handoff passed controlled testing. The release uses manual LinkedIn handoff because the application lacks a Messages API grant. Direct delivery is an outstanding sponsor capability. |
| Messaging feedback and throttling | Gmail metadata sync deduplicates replies and bounces for accepted test threads. A reserved draft can call Gmail once. The workspace rate limit also caps distinct hourly send attempts. | The hosted service accepted a signed Pub/Sub notification for the controlled mailbox watch on November 24 at 2:10 p.m. Pacific and returned HTTP 401 for an unauthenticated request. Renewal, binding, and deduplication passed controlled integration tests. A live correlated reply or bounce remains unverified. |
| Pipeline, attribution, and analytics | Kanban covers the five stages. Confirmation, provider feedback, and direct rep changes record timestamps. The UI shows Signal automation, Gmail automation, or rep action and includes the send requester and revision. Industry, tier, message variant, channel, and value proposition are available as funnel dimensions. | The email flow and rep changes have tests. Live LinkedIn outcomes require direct messaging access and remain outside this release. The shared demo identity attributes human actions to one rep identity. |
| Workspace UI | Accounts shows Fit, recommendation, and contact verification status. Home opens the workspace assistant with typed chat, dictation, and live voice. Outreach exposes Gmail and LinkedIn and offers inline revision review. The collapsible activity sheet shows recorded evidence, graph, review, and provider events. | The 1440px and 390px browser checks passed with controlled provider responses. |

Signal uses Neo4j, Claude, Tavily, Hunter, Gmail, and Next.js with Tailwind and shadcn. The specification lists interchangeable tools for those architectural tiers. [Architecture](architecture.md) · [API contract](api-contract.md)

## Sponsor bonuses

| Bonus | Evidence | Open work |
| --- | --- | --- |
| Band Desktop | Planner, Builder, Reviewer, and Security exchanged 27 routed mentions in 46 room messages. The room recorded decisions for the isolated mailbox checkpoint and the live dispatch hold. The fixture passed 12 assertions covering human approval, replay handling, source grounding, and blocked dispatch. Band captured per-session tokens and estimated cost. | Retain the private case evidence for judging. |
| Flexprice | Sandbox accepted Lead Enriched, Graph Query Evaluated, and Outreach Sent events. The lower-balance check blocked enrichment before Hunter. The ledger allocated 1.15 credits to one lead. | Retain the Sandbox proof for judging. |
| Snyk | After fixing the catalog and evidence link findings and using generated test credentials, authenticated backend SCA, frontend SCA, and Snyk Code passed in [GitHub Actions](https://github.com/hiromaruyama/hackathon-hackw-bay4.0/actions/runs/45497519171). | Retain the CI run as the submission evidence. |

Nexla also returned five records that saved as citations in Neo4j.

## Submission evidence

- [Hosted prototype](https://signal-gtm.onrender.com) passed health, authenticated workspace, and Neo4j checks. The team shares the demo password privately.
- [Public source repository](https://github.com/hiromaruyama/hackathon-hackw-bay4.0) includes setup instructions and the [system design](architecture.md).
- The 2:32 narrated video shows intake, graph matching, cited outreach, review, and pipeline updates with controlled provider responses. Retain the separately verified Gmail receipt and provider evidence for live claims.
