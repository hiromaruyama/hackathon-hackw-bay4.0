# Signal backend

Person 1 owns this FastAPI service and the [API contract](../docs/api-contract.md). The frontend can start with the explicitly synthetic [workspace example](../docs/workspace.example.json). The service reads and writes Neo4j. Live provider errors stay visible.

## Run locally

From the repo root:

```sh
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
cp -n .env.example .env
.venv/bin/python -m uvicorn signal_app.main:app --host 127.0.0.1 --port 8000
```

Fill `backend/.env` locally. The file is ignored by Git. Restart the service after changing credentials. Set a unique `SIGNAL_DEMO_PASSWORD` and a random `SIGNAL_SESSION_SECRET` of at least 32 characters. Leave `SIGNAL_PUBLIC_ORIGIN=http://localhost:8000` to use the static export or API docs locally. For Next dev, use `SIGNAL_PUBLIC_ORIGIN=http://localhost:3000` and send credentialed requests to `http://localhost:8000`.

| Provider | Required configuration and check |
| --- | --- |
| Claude | `ANTHROPIC_API_KEY` with credit and access to `claude-haiku-5-5`. Generate a GeoFlow profile as a smoke check. |
| Tavily | `TAVILY_API_KEY`. Check signed-in Discovery for real source URLs and exact excerpts. Optional `SIGNAL_DISCOVERY_DOMAINS` restricts prospective-company searches to up to ten comma-separated public hostnames. Leave it blank for open research. |
| Hunter | `HUNTER_API_KEY`. Draft for a Contact-tier account and verify the reported role and provider status. |
| Neo4j | `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD`. Aura's **Inspect → Overview → Connection URI** gives the `neo4j+s://` value. Leave `NEO4J_DATABASE` blank for the instance default. Set it only when a named database should be selected explicitly. |
| Gmail | Enable the Gmail API in a Google Cloud project. Authorize the controlled sender with `gmail.send` and offline OAuth access. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_ADDRESS`, and `SIGNAL_TEST_RECIPIENT`. The test recipient should be a mailbox the team controls. Use a comma-delimited `SIGNAL_SUPPRESSED_RECIPIENTS` to block configured addresses. |
| Gmail feedback | Authorize the same controlled sender separately with `https://www.googleapis.com/auth/gmail.metadata`. Save the new refresh token as `GMAIL_FEEDBACK_REFRESH_TOKEN`. The Pipeline sync action reads headers from recorded test threads and records matched replies and bounces. |
| LinkedIn handoff | Set `SIGNAL_LINKEDIN_TEST_PROFILE_URL` to the controlled test profile. Each LinkedIn draft is reviewed and scheduled independently. The UI records an approved handoff and opens the configured profile. Automated API delivery requires approved LinkedIn messaging access. |
| Flexprice | Follow the [Sandbox setup](#flexprice-sandbox) and enable it after the wallet and meters are ready. |
| Nexla | If provisioned, set `NEXLA_SYNC_URL` to the HTTPS Nexset Sync endpoint and `NEXLA_ACCESS_TOKEN` to its Sync API key. The source must be read-only and return a list, or a `data`/`records` list, with `url` or `source_url`, `title`, `content` or `excerpt`, and an optional `published_at`. Scope it to at most the small demo dataset. |

`GET /api/health` checks the process. Sign in with `POST /api/session` to read provider configuration flags and Neo4j connectivity at `/api/readiness`. Inspect requests and setup with `/api/docs`. For same-origin writes, supply the configured `Origin` header even when testing with an HTTP client.

For a one-off Gmail setup, create a Google OAuth web client for user data with `https://developers.google.com/oauthplayground` as its authorized redirect URI. In Testing, add the sender as a test user. In Google's OAuth Playground, use your own client credentials, authorize `https://www.googleapis.com/auth/gmail.send`, and exchange the code for a refresh token. Store the values in the ignored local environment file or Render secrets. The backend uses the Gmail REST endpoint after human approval. [Google OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server#offline)

In Nexla, open the transformed Nexset's **Details → Overview → Data API** and select **Copy cURL**. Save the HTTPS URL with its `api_key` parameter removed as `NEXLA_SYNC_URL`. Save the parameter value as `NEXLA_ACCESS_TOKEN`.

## Gmail feedback push

1. Use the Google Cloud project that owns the Gmail OAuth client. Create a Pub/Sub topic and give `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on that topic. [Gmail watch setup](https://developers.google.com/workspace/gmail/api/guides/push)
2. Create a dedicated push service account in the same project. Use it to create an authenticated push subscription with payload wrapping enabled. Set the endpoint and audience to the exact HTTPS app origin followed by `/api/webhooks/gmail`. If IAM does not already grant the Pub/Sub service agent permission to generate OIDC tokens, grant it **Service Account Token Creator** on the dedicated push account. [Pub/Sub authentication](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
3. Set `GMAIL_PUBSUB_TOPIC` to `projects/PROJECT_ID/topics/TOPIC_ID`, `GMAIL_PUBSUB_SUBSCRIPTION` to `projects/PROJECT_ID/subscriptions/SUBSCRIPTION_ID`, and `GMAIL_PUBSUB_SERVICE_ACCOUNT` to the push service account email. Configure the same controlled `GMAIL_SENDER_ADDRESS` and the separate `GMAIL_FEEDBACK_REFRESH_TOKEN` from the Gmail feedback row above. Use Render's Environment settings for the hosted service. The Google Cloud push identity uses managed signing keys.
4. Deploy and sign in. Check that `/api/readiness` reports `gmail_push_configured` and `gmail_watch_active` as true. A successful watch sends an initial notification. Check that `gmail_last_push_at` is populated and the subscription reports an acknowledged HTTP 204. The app renews the watch daily and checks for missed notification history every 15 minutes while it is running.

Feedback looks only at metadata for up to eight recent confirmed test-send threads. It attributes a reply or bounce only when the message headers bind it to the approved test recipient and the original send. Feedback from separately threaded delivery reports falls outside that correlation.

## Flexprice Sandbox

1. In **Sandbox → Developers → API Keys**, create a secret key for `FLEXPRICE_API_KEY`. Set `FLEXPRICE_BASE_URL` to the matching regional API if needed.
2. Create a synthetic customer with an external ID, such as `signal-hackathon-demo`. Create one active prepaid wallet and grant it free test credits. Set `FLEXPRICE_CUSTOMER_ID` to the Flexprice-generated customer ID, `FLEXPRICE_EXTERNAL_CUSTOMER_ID` to the external ID you chose, and `FLEXPRICE_WALLET_ID` to the generated wallet ID.
3. Create COUNT meters named `leads_enriched`, `graph_query_evaluated`, and `outreach_sent`. To see priced usage in Sandbox, attach the meters to a usage plan and subscribe the test customer. The demo prices are 1 credit for enrichment, 0.05 for a graph evaluation, and 0.10 for a confirmed send. Group analytics by `properties.account_id` to see each lead's costs. [Flexprice usage and pricing setup](https://docs.flexprice.io/docs/core-concepts/usage-events/connecting-to-billing)
4. Set `FLEXPRICE_ENABLED=true`, `FLEXPRICE_ENRICHMENT_COST=1`, and `FLEXPRICE_METER_GRAPH_AND_OUTREACH=true`. Restart the service. A separate QA wallet with 1.15 test credits can cover one full run and block a second enrichment with HTTP `402` before Hunter runs.

The workspace shows the most recent Flexprice balance and the remaining allowance for new enrichments. Signal reserves the allowance before each lookup because the wallet can lag while usage events are processed. Use a dedicated funded wallet during each demo run.

## Deployment handoff

Build Next.js with `output: 'export'`. For multiple page routes, set `trailingSlash: true` so FastAPI can serve each route's `index.html`. Copy the exported files into the backend runtime and set `SIGNAL_STATIC_DIR` to that directory at startup. FastAPI serves those files and the API on the same origin. Set the external HTTPS origin explicitly or let `RENDER_EXTERNAL_URL` supply it. Run Uvicorn with one worker on `0.0.0.0` and Render's assigned port. Set credentials as deployment secrets. Keep Neo4j as the persistent store and provide judge sign-in privately. [Next.js static export configuration](https://nextjs.org/docs/app/guides/static-exports#configuration)

The root Dockerfile builds both tiers. The Render setup uses a free web service and checks `/api/health`. Set `SIGNAL_RESEARCH_REFRESH_MINUTES` to `1440` for daily research. The scheduler claims due refreshes in Neo4j and records the result under the system actor. Free services sleep while idle. The repository workflow can wake a deployed service using the public `SIGNAL_RENDER_URL` variable. [Render free service limits](https://render.com/docs/free)

## Data flow and approval boundary

1. Claude generates a structured ICP. Rep approval creates a new version. Tavily supplies public excerpts for discovery. Backend code binds quoted evidence to the company and computes the fit and intent tiers. Discovery makes at most two initial searches and one focused follow-up if coverage is weak. The excerpts are saved before model analysis, so retries can use the same sources. Completed discovery uses the stored result unless explicitly refreshed.
2. The discovery transaction persists `Product`, `Company`, `Signal`, `Evidence`, and `Competitor` nodes alongside workspace state. The draft action runs `Product → MATCHED_TO → Company → HAS_SIGNAL → Signal → EVIDENCED_BY → Evidence`, persists the role-matched Hunter result as `Person → WORKS_AT → Company`, and asks Claude for cited copy. When copy review rejects generated personalization, the fallback attributes a literal graph excerpt and uses only supplied product facts. Workspace JSON and draft snapshots are stored in Neo4j. A missing Hunter contact is labeled in the resulting draft.
3. The rep approves the exact revision, recipient, subject, and body. A Neo4j write lock serializes competing actions before reserving dispatch. Gmail receives only the approved text and configured test recipient. Provider confirmation and the pipeline event are saved together. A failed or uncertain send leaves the lead at its previous stage. The draft stays locked after the first attempted dispatch.

## Verify

```sh
.venv/bin/python -m pytest -q
SIGNAL_TEST_NEO4J_URI=bolt://127.0.0.1:17687 .venv/bin/python -m pytest -q
```

The second command requires a disposable local Neo4j instance, with `SIGNAL_TEST_NEO4J_PASSWORD` when auth is enabled. Tests use isolated workspaces in the database and simulate third-party calls. They exercise the actual Neo4j traversal, version checks, edit/reapproval, duplicate send, confirmed pipeline update, failed/uncertain outcomes, provider-result labeling, and the Flexprice block before Hunter.
