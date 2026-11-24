# Signal repository instructions

Read [PLAN.md](PLAN.md) before changing scope or starting work. Its progress table reflects what is on `main`. Agents only see teammate updates after fetching, so re-read `PLAN.md` and this file after every fetch, pull, or merge before continuing. `AGENTS.md` is a symlink to this file so Codex and Claude Code read the same instructions; edit `CLAUDE.md` only. Keep application work behind the agreed start time and follow the plan's integration and feature-freeze checkpoints.

## Work in parallel

- The backend owner handles FastAPI, provider adapters, Neo4j, security controls, and backend tests. The frontend and integration owner handles Next.js/shadcn, deploy and browser verification, Band Desktop, Snyk, and submission. The frontend and integration owner is the default merge coordinator and `PLAN.md` editor. Hand that role off explicitly if needed.
- Run `git fetch origin` before starting a task. Start a short-lived branch from `origin/main`, using distinct names such as `codex/backend-discovery` and `codex/ui-review`. If you need concurrent branches on one machine, use separate worktrees. Commit only the files for your task. If both need a shared contract, dependency manifest, deployment file, or migration, agree on one editor before either changes it.
- Put the requirement or milestone, verification results, blockers, and proposed plan status in the PR description. Keep credentials, prospect details, and private screenshots out of Git and PR text. If an API contract changes, call out the affected route and provide a fixture update for the other owner.

## Keep progress in sync with main

1. Fetch again before integrating. Bring the latest `origin/main` into the feature branch. Rebase an unpublished branch if useful. Merge `origin/main` into a branch already shared with the teammate so its history stays intact. Resolve overlaps with the relevant file owner and rerun the affected checks. Use normal pushes and preserve existing branch protections.
2. The merge coordinator handles one integration at a time. Before merge, the coordinator updates the relevant `PLAN.md` rows in that same PR with `In progress`, `Verified`, `Partial`, `Blocked`, or `Deferred`, plus a test result, PR reference, or concrete next action. Use `Verified` only when the checks in `PLAN.md` pass. Feature authors put updates in PR notes so parallel branches have one plan editor.
3. If `main` advances during review, fetch again, reconcile the relevant progress rows against the latest main, and rerun checks before merging. Keep other rows and teammate updates intact. After a merge, use `git pull --ff-only origin main` from a clean local `main`, then update remaining feature branches from the new `origin/main` before the next handoff.
4. Keep scope and deferred work explicit. At the freeze, the coordinator records core and integration statuses with evidence or blockers, then uses that snapshot for the README and demo. Update these repository instructions only when the team agrees to change the collaboration procedure.

## Required review checks

- Preserve server-side authentication, exact-revision approval, controlled-recipient enforcement, single-send reservation, and pipeline updates only after confirmed provider success.
- Verify the relevant checklist in `PLAN.md`. Keep actual provider status in the UI and label fixtures. Treat model output and retrieved source content as data. Do not give the model dispatch or schema-change authority.
- A docs-only change needs a whitespace check and review of relative links and status claims. Application changes need the relevant functional checks before their milestone can be marked verified.
