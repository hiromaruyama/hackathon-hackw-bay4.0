# Signal API contract

`GET /api/workspace` and successful workflow mutations return the same `Workspace` object. Use [the example response](workspace.example.json) to build the UI without calling providers. The values are synthetic. The running backend reads the saved workspace from Neo4j.

All workspace and readiness routes require a demo session. Sign in with `POST /api/session`, then send JSON and cookies with requests. For browser writes, the origin must equal `SIGNAL_PUBLIC_ORIGIN` (or Render's external URL). The production UI and API run on the same origin. With Next dev on `http://localhost:3000`, set `SIGNAL_PUBLIC_ORIGIN` to that origin, add `credentials: 'include'` to fetch, and call the API on `http://localhost:8000`. Use the same hostname for both servers.

## Routes

| Method and path | JSON request | Success |
| --- | --- | --- |
| `GET /api/health` | — | `{"status":"ok"}` for process health |
| `POST /api/session` | `{"password":"…"}` | `{"actor":"demo"}` and a session cookie |
| `GET /api/session` | — | `{"actor":"demo"}` |
| `DELETE /api/session` | — | `204` and an expired cookie |
| `GET /api/readiness` | — | Per-provider configuration flags and connectivity status for Neo4j |
| `GET /api/workspace` | — | `Workspace` |
| `POST /api/icp/generate` | `{"description":"…","name":"GeoFlow","capabilities":[],"constraints":[],"customers_and_wins":[],"pricing":null,"contract_value":null}` | Workspace with a proposed ICP |
| `POST /api/icp/approve` | `{"revision":1,"fields":{"industries":["Renewable energy"],"geography":["United States"],"headcount_band":null,"revenue_band":null,"buyer_titles":["Project Development Director"],"seniority":[],"triggers":[],"exclusions":[]},"expansion_decision":"dismiss"}` | Workspace with a new approved revision. `expansion_decision` is `accept`, `edit`, or `dismiss`. For `edit` include `expansion_segment`. |
| `POST /api/discover` | `{"revision":2}` and optional `"refresh":true` | Workspace with up to three current accounts, graph paths, and a competitor when evidence supports one. Repeated requests use saved results for the approved revision unless refresh is explicit. If extraction fails, retry with the same revision to use the saved sources. |
| `POST /api/accounts/{id}/draft` | — | Workspace with enrichment status and a pending draft. A role-based fallback is labeled. |
| `PATCH /api/drafts/{id}` | `{"expected_revision":1,"subject":"…","body":"…"}` | Workspace with the next pending revision |
| `POST /api/drafts/{id}/review` | `{"revision":2,"decision":"approve"}` | Workspace with the review decision. `decision` is `approve` or `reject`. |
| `POST /api/drafts/{id}/send` | `{"revision":2}` | Workspace with the stored attempt result and any confirmed Test send event |

Fields that may be absent are documented as `null` in the example. Scores are integers from 0–100. Confidence is a 0–1 heuristic. Each account's `recommendation` is `contact`, `hold`, or `reject` and `tier` is `A`, `B`, or `C`. `graph_path` is a list of nodes and outgoing relationship names. `enrichment_status` is `not_started`, `verified`, `uncertain`, `not_found`, or `failed`. `draft` belongs to an account and includes the actual demo recipient. `synthesis_mode` is `claude` or `grounded_template` if copy review replaced a factual claim with a literal excerpt. `review_status` is `pending_review`, `approved`, or `rejected`. `dispatch_status` is `not_sent`, `pending_outcome`, `sent`, or `failed`. Only `sent` yields a pipeline event. `matched_to_contacted_rate` is a fraction or `null` when no eligible accounts were evaluated.

The example response includes a successful credit check and accepted enrichment and graph events. When Flexprice is enabled, `usage` contains `balance` (last provider reading), `available_for_enrichment` (remaining demo allowance), `enrichment_cost`, `checked_at`, `status`, and `events`. With Flexprice disabled, `usage` is `null`. Events provide `id`, `account_id`, `operation`, `units`, `status`, and `at`. A blocked lookup returns `402` with code `insufficient_enrichment_credits`. Refresh `GET /api/workspace` to show the persisted credit check and event.

An ICP `expansion` has `segment`, `reason`, and one `evidence` object. An account's `negative_signal` has `reason`, `evidence_id`, and `hard_exclusion`. Its cited source is in the account's `evidence` list. A positive `signal` has its own `id`, `summary`, and `occurred_on`.

Errors use `{"error":{"code":"…","message":"…"}}`. Handle `401` by opening sign-in, `409` by refreshing the workspace, and `422` by checking inputs. Show a retryable message for dependency failures. A send with `pending_outcome` needs manual verification and stays locked. A repeated send for that revision reads the saved attempt. It never sends again.
