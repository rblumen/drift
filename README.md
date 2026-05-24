# Portfolio Rebalancer

A local, browser-only tool for household-level investment rebalancing across multiple accounts (Empower, Schwab, Fidelity).

## What it does

- Ingests positions from multiple accounts via manual entry or CSV export
- Classifies holdings into asset classes
- Compares the household's combined allocation against an editable target strategy
- Produces placement-aware buy/sell recommendations per account (tax-advantaged vs. taxable)

## Setup

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev     # local dev server at http://localhost:5173
npm test        # run engine unit tests
npm run build   # production build → dist/
```

## Privacy

Real account data is never committed. Keep personal data under `/private/` or in `*.local.json` files — both are git-ignored. Only synthetic fixtures in `src/data/` are committed.

## Architecture

`src/engine/` is pure TypeScript (no React) — all rebalancing math lives here and is unit-tested independently. UI and ingest adapters depend on the engine; the engine has no UI dependencies.

See `IMPLEMENTATION_PLAN.md` for the full build spec.
