# Signal

Signal is a GTM workspace for turning a plain-language product description into a sourced buyer profile, researching prospects, and reviewing personalized outreach. The HackwithBay demo uses GeoFlow, a site-analysis product for utility-scale solar development.

Open the [hosted Signal demo](https://signal-gtm.onrender.com) and sign in with the demo password shared by the team. The Render service passed sign-in, secure session cookie, and Neo4j workspace checks.

## Run locally

Use Python 3.12, Node.js 22, and a Neo4j database. From the repo root, install the backend and create the ignored environment file.

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
cp -n backend/.env.example backend/.env
```

Fill the local environment file using the [provider setup](backend/README.md). Set a demo password, session secret, and Neo4j connection before opening the workspace. Build the frontend and start the app.

```sh
(cd frontend && npm ci && npm run build)
(cd backend && .venv/bin/python -m uvicorn signal_app.main:app --host 127.0.0.1 --port 8000)
```

Open [Signal on localhost](http://localhost:8000) and sign in. On the Profile page, start with the intake chat or enter the product directly. Approve the proposed profile, then open Accounts and include targeted regulatory filings and job postings if needed. Account details show the supporting sources and Neo4j paths. Generate and independently review each outreach step. The Pipeline page tracks Gmail confirmations, controlled-mailbox feedback, rep actions, and conversion data.

## Verify and deploy

- [Architecture and safety controls](docs/architecture.md) explains the graph, reasoning, scheduling, approval, and attribution.
- [API contract and fixture](docs/api-contract.md) describe the request and response shapes.
- [Backend tests and Render setup](backend/README.md) cover disposable Neo4j, provider configuration, and the single-service deployment.
- [PLAN.md](PLAN.md) tracks the sponsor requirements and verification evidence.

Set Render secrets through the service's environment settings. The Blueprint uses free Docker compute, the `/api/health` endpoint, and a daily research interval. Set `SIGNAL_RENDER_URL` as a GitHub Actions repository variable to wake a sleeping free service for its scheduled research. Give judges the demo password privately.

The expanded workflow was browser-tested against FastAPI and Neo4j with simulated provider responses. Separate live tests confirmed cited discovery and enrichment, one approved Gmail message in the controlled inbox, Gmail metadata access, Nexla citations, and all three Flexprice Sandbox meters. LinkedIn uses an approved manual handoff to a configured test profile while messaging access is pending. [Release checks](https://github.com/hiromaruyama/hackathon-hackw-bay4.0/actions/runs/45485778785)


### Snyk CI

Enable Snyk Code in the scanner organization and set `SNYK_ORG` to its ID or slug under the repository's **Settings → Secrets and variables → Actions → Variables**. Save the organization's CI scanner credential as the `SNYK_TOKEN` Actions repository secret. [Snyk CLI authentication](https://docs.snyk.io/developer-tools/snyk-cli/authenticate-to-use-the-cli) · [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

Run **Verify Signal** from the Actions tab. Its Snyk job reports backend and frontend dependency scans and Snyk Code in separate steps. Finding-related scan failures remain visible in the check results.
