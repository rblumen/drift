# CLAUDE.md — Portfolio Rebalancer

Project memory for this repo. Keep it short; every line should change how you act.

## What this is
A local, browser-only tool that rebalances investment holdings across multiple accounts (Empower, Schwab, Fidelity). Household-level target allocation with account-level tax-placement rules. Full build spec: `IMPLEMENTATION_PLAN.md` — follow it milestone by milestone.

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

## Commands
- `npm run dev` — local dev server
- `npm test` — Vitest
- `npm run build` — production build
