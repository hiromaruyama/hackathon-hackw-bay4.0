# Signal frontend

Next.js 16 static export with Tailwind and shadcn/ui. FastAPI serves the built `out/` folder and `/api` on the same origin on Render.

## Run

```bash
npm install
npm run dev
```

Data modes:

- **Sample data:** set `NEXT_PUBLIC_SAMPLE_DATA=1` in `.env.local`. Uses `src/lib/fixture.ts` (synthetic, contract-shaped) and simulates the backend routes in the browser with the same rules: exact-revision edits and reviews, edits clear approval, one send per approved revision. The top bar shows **Sample data**.
- **Live:** leave it unset. With uvicorn on port 8000, set `NEXT_PUBLIC_API_BASE=http://localhost:8000` and make the backend's `SIGNAL_PUBLIC_ORIGIN` match the Next dev origin (see `docs/api-contract.md` on the backend branch). Production uses same-origin `/api`.

## Build

```bash
npm run lint
npm run build   # writes out/
```

## Screens

| Route | Purpose |
| --- | --- |
| `/` | Next action, workflow steps, accounts, pipeline and activity |
| `/profile/` | Product intake, editable customer profile, approval |
| `/accounts/` | Discovery, accounts table, competitor |
| `/accounts/view/?id=` | Account evidence, signals, contact, graph path |
| `/outreach/?account=` | Draft review, approval, send, and the Ask panel |
| `/pipeline/` | Stages, counts, stage changes |

## Open contract questions for the backend

- **Ask:** the UI calls a proposed `POST /api/accounts/{id}/ask` with `{ "question": "…" }` and expects `{ "answer", "evidence_ids", "suggested_edit": { "before", "after" } | null }`. Until it exists, the panel shows "Ask isn't connected yet". Applying a suggestion uses the existing `PATCH /api/drafts/{id}`, so it creates a new revision that needs approval.
- **Fit breakdown:** accounts only carry a total `fit_score`. Per-dimension points (industry, size, need, geography) would let the table show the breakdown from the design.
