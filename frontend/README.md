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
| `/outreach/` | Company list with verdicts and draft status |
| `/outreach/?account=` | Draft review, Writing Agent, evidence, edit history, approval and send |
| `/pipeline/` | Stages, counts, stage changes |

The **Writing Agent** asks the authenticated workspace assistant about the selected saved draft. Suggested openings can be reviewed and saved as a new revision. The microphone dictates into the composer and the telephone starts a voice call in the live workspace. The Evidence tab links to the company graph. Edit History lists saved revisions of the selected draft.

## Open contract questions for the backend

- **Fit breakdown:** accounts only carry a total `fit_score`. Per-dimension points (industry, size, need, geography) would let the table show the breakdown from the design.
