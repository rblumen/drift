# CLAUDE.md — Portfolio Rebalancer

Project memory for this repo. Keep it short; every line should change how you act.

## What this is
A tool that rebalances investment holdings across multiple accounts (Empower, Schwab, Fidelity). Household-level target allocation with account-level tax-placement rules. The 0.x series is browser-only; v1.0 keeps that as guest mode and adds signed-in mode with a server, accounts, households, and brokerage linking. Design reference: `IMPLEMENTATION_PLAN.md`; v1.0 plan: `docs/v1/`.

## Governing principles
- PRINCIPLES.md defines the logical objectives/constraints that the tool should respect, in priority order. Implemented logic must adhere to this statement of intent.

## Architecture rules
- `src/engine/` is **pure TypeScript, no React imports** — pure functions, fully unit-tested.
- UI and `src/ingest/` depend on the engine, never the reverse.
- Server code lives only in `api/` (Vercel Functions, v1.0 signed-in mode). It may import `src/engine/` and `src/ingest/`, which never import it, React, or Supabase. Plan and decisions: `docs/v1/`.
- Normalize every ingest source into the one `Position` shape (`src/ingest/schema.ts`).
- The engine works at the household level first, then assigns asset classes to accounts via the greedy placement fill. Do not rebalance each account independently.

## Domain invariants
- Target weights must sum to ~1.0; reject configs that don't.
- Fixed income → taxable (munis); equities + alternatives → tax-advantaged.
- v1 has no cost-basis tracking — only flag that a sale lands in a taxable account.
- Round only at display time.

## Hard guardrails (never violate)
- Never commit real financial data. Only synthetic fixtures. `/private/` and `*.local.json` are git-ignored. **Real user data never goes into PRs, issues, fixtures, logs, or AI coding tools** (this one included); reproduce bugs with synthetic fixtures.
- **Guest mode (no signup): no user data ever leaves the browser.** All computation is client-side. Holdings, account names/numbers, dollar amounts, asset classes, reminders, and any PII stay in `localStorage` and are never transmitted, logged, or sent anywhere. Treat this as inviolable.
- **Signed-in mode stores personal financial data on Drift's servers, and says so plainly.** Portfolios, linked holdings and market values, balances, account names, and drift history live in Supabase; SnapTrade credentials are encrypted at the application level (spec D10). Row-level security means other users see only what's assigned to a household they belong to. Never describe signed-in mode as "your data never leaves your browser."
- **Maintainer access is real, limited, and logged** (spec D22). Maintainers may read stored user data for debugging, support, security, and data repair, reading only what the task needs, and only through admin scripts that write every read to `support_access_log`. No impersonation or "view as user." The privacy notice discloses this.
- **Analytics:** a cookieless, no-PII tool may receive page-level traffic and product events (feature use, fake-door views and clicks, price-variant IDs). It never receives holdings, amounts, tickers, account names/numbers, or PII — not via URL, custom event, or props.
- **Logs, errors, and emails carry no financial data:** IDs, routes, status codes, error codes, and timings only (spec §7, §8, D21). For debugging, server logs and Sentry may carry a **ticker ref** instead of a ticker: a keyed hash (`TICKER_REF_KEY`, server-only) that the log vendors can't read but a maintainer can match locally (spec §8). Never raw tickers, amounts, or account names.
- **Brokerage access only through an authorized aggregator's documented API** (SnapTrade; Plaid as a named alternative), read-only, through the aggregator's own connection portal. Drift never sees or stores brokerage passwords and never calls trading endpoints. No credential automation, no scraping, no undocumented/reverse-engineered APIs. Everything else is CSV export + manual entry.
- **Secrets** (API keys, `TOKEN_ENC_KEYS`, `CRON_SECRET`, `TICKER_REF_KEY`) live only in vendor dashboards, Vercel env vars, and the password manager. Never in the repo, issues, PRs, or chat.
- Do not create remotes or push on the user's behalf — the user owns hosting.

## Branch and PR hygiene
- `main` is the single trunk. All feature and bug fix work happens on a dedicated branch off `main`, never directly on `main`.
- **Naming:** `feat/ISSUE-NUMBER-short-description` for features, `fix/ISSUE-NUMBER-short-description` for bugs (e.g. `feat/2-relative-tolerance-bands`, `fix/37-taxable-spillover`). Linking to the issue number keeps branches traceable.
- Branches merge to `main` via PR — not direct push — unless the user explicitly grants override permission for a specific change.
- **Squash on merge** into `main`: collapses branch commits into one clean commit. Individual commits on the branch are preserved until the branch is deleted.
- Include `Closes #N` in the PR body. Because PRs target the default branch (`main`), GitHub creates the formal linked-issue relationship and auto-closes the issue on merge.
- CI (`.github/workflows/ci.yml`) runs the test suite on every PR to `main`; keep it green before merging.
- Delete the branch after merge. Keep the remote tidy.
- Use a **draft PR** for in-progress work that needs remote backup but isn't ready for merge.
- Never push directly to `main`. Releases reach `main` via the `/release` skill's PR.

## Changelog hygiene
- Keep the `[Unreleased]` section of `CHANGELOG.md` current. After any substantive change (new feature, bug fix, behavior change, notable refactor), add a brief entry under the appropriate subsection (`Added`, `Changed`, `Fixed`, `Removed`). Do this as part of the same commit as the code change — not as a separate step later.
- Follow [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format. Entries should describe user-visible impact, not implementation detail (e.g. "Add wash-sale warning flag to Results panel" not "added WASH_SALE_RISK to engine flags map").

## Test hygiene
- **Every engine bug fix adds a regression scenario.** When you fix an engine bug, add a `*.scenario.json` fixture under `src/engine/scenarios/regressions/`, named for the issue (e.g. `issue-57-projected-off-target.scenario.json`). It must fail on the pre-fix engine and pass after — the scenario encodes the corrected behavior so the bug can never silently return. Add it in the same commit/PR as the fix. See `src/engine/scenarios/README.md` for the fixture format.

## Permissions
- Read-only tools (grep, find, cat, file reads) within this repo require no permission prompt — use them freely.
- Read-only git commands (`git status`, `git log`, `git diff`, `git branch`) require no permission prompt.
- `npm test` and `npm run build` require no permission prompt — they produce only local artifacts.

## Commands
- `npm run dev` — local dev server
- `npm test` — Vitest (run once)
- `npm run test:watch` — Vitest in watch mode
- `npm run test:ui` — interactive Vitest UI dashboard with live reload
- `npm run test:report` — write a static HTML report to `html/index.html` (default reporter still prints)
- `npm run test:coverage` — write an engine coverage report to `coverage/index.html`
- `npm run build` — production build

## Preview server in worktrees
- The dev-server launcher has been observed resolving `cwd` to the main repo checkout instead of the active worktree, silently serving stale/wrong-branch code while claiming success. A "flag doesn't render" bug that reproduces against a passing test suite is a symptom of this, not necessarily a code bug.
- Before trusting a local preview result (pass or fail) while working in a worktree, confirm the served source matches the worktree: `fetch('/src/path/to/file.ts').then(r => r.text()).then(t => t.includes('the string you just added'))` in the browser console/`preview_eval`. If it's missing, the server is serving the wrong checkout — restart it, don't debug the "bug".
- To manually exercise a scenario in the UI (e.g. a specific account type + drift combo), load a fixture from `src/data/fixtures/` via the app's **↑ Load** button rather than hand-injecting `localStorage['rebalancer-v1']` — the `AppState` schema (`src/ingest/schema.ts`) has non-obvious required fields (e.g. `strategy.minTradeUsd`) that are easy to omit when writing state by hand, causing a silent fallback to defaults.
