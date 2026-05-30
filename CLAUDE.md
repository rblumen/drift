# CLAUDE.md — Portfolio Rebalancer

Project memory for this repo. Keep it short; every line should change how you act.

## What this is
A local, browser-only tool that rebalances investment holdings across multiple accounts (Empower, Schwab, Fidelity). Household-level target allocation with account-level tax-placement rules. Design reference: `IMPLEMENTATION_PLAN.md`.

## Governing principles
- PRINCIPLES.md defines the logical objectives/constraints that the tool should respect, in priority order. Implemented logic must adhere to this statement of intent.

## Architecture rules
- `src/engine/` is **pure TypeScript, no React imports** — pure functions, fully unit-tested.
- UI and `src/ingest/` depend on the engine, never the reverse.
- Normalize every ingest source into the one `Position` shape (`src/ingest/schema.ts`).
- The engine works at the household level first, then assigns asset classes to accounts via the greedy placement fill. Do not rebalance each account independently.

## Domain invariants
- Target weights must sum to ~1.0; reject configs that don't.
- Fixed income → taxable (munis); equities + alternatives → tax-advantaged.
- Emit `REVISIT_PLACEMENT` when taxable share of total > the fixed-income target weight.
- v1 has no cost-basis tracking — only flag that a sale lands in a taxable account.
- Round only at display time.

## Hard guardrails (never violate)
- Never commit real financial data. Only synthetic fixtures. `/private/` and `*.local.json` are git-ignored.
- All client-side. No backend, no network calls, no telemetry in v1.
- No credential automation, no scraping, no undocumented/reverse-engineered APIs. CSV export + manual entry only.
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

## Commands
- `npm run dev` — local dev server
- `npm test` — Vitest
- `npm run build` — production build
