# CONTEXT.md — Drift Portfolio Rebalancer

**Last Updated:** 2026-07-02

---

## What this is

**Drift** is a browser-only household rebalancing tool for multi-account portfolios (Empower, Schwab, Fidelity). It ingests positions from CSVs or manual entry, computes drift against an editable target allocation, and produces per-account buy/sell recommendations.

Currently a personal tool tuned to one household. Designed to be sharable — but the defaults in `src/engine/strategy.ts` reflect a specific household's strategy and must be reviewed before sharing with others.

**It is not investment advice.** It is a mechanical calculator over user-provided inputs.

---

## Status (as of 2026-07-02)

All milestones (M0–M4) are complete. The project is well past MVP, with 495 passing tests across 20 test files. There are no open P0 items — active development is tracked in [GitHub Issues](https://github.com/rblumen/drift/issues) and is currently focused on post-audit cleanup and design polish:

- **UI/design-system polish** — icon set consistency, data-viz palette, semantic status colors (#150), banner layout/copy cleanup (#146, #152), styled confirmation dialogs to replace native `confirm()` (#151)
- **Engine hardening and readability** — decompose the 1,400+ line `rebalance.ts` (#128), dedupe the per-account balance-correction pass (#126), fix `PROJECTED_OFF_TARGET` vs. Step 5 inconsistency (#117)
- **Ingest coverage** — `EMPOWER_TICKER` only maps 6 of 19 asset classes (#118); `parseMoney` doesn't support parenthesized negatives (#129)
- **Housekeeping** — dependency currency (Vite/Vitest/Zod/React/Tailwind/TS majors, #132), `npm audit` findings in the dev-dependency chain (#122), CSP security headers via `vercel.json` (#133), this docs-sync pass (#121)

Bugs are tracked as GitHub Issues (label: `bug`).

Current version: **0.1.0** (see `CHANGELOG.md`).

---

## Tech stack

| Layer | Tool |
|---|---|
| Language | TypeScript 5 |
| UI | React 18, Tailwind CSS |
| Build | Vite |
| CSV parsing | papaparse |
| Schema validation | zod |
| Tests | Vitest |

No backend. Your data never leaves the browser. The only network traffic is anonymous, cookieless pageview analytics (no PII, no financial data). Everything else runs in the browser.

---

## Architecture

```
src/
├── engine/                  # Pure TypeScript — no React imports. Pure functions, fully unit-tested.
│   ├── types.ts             # All domain types (Account, Position, Strategy, Trade, Flag, AssetClass…)
│   ├── strategy.ts          # DEFAULT_STRATEGY + DEFAULT_PLACEMENT (household-specific defaults)
│   ├── classify.ts          # ticker → AssetClass lookup
│   ├── hierarchy.ts         # CLASS_HIERARCHY — parent/child asset-class tree + split weights
│   ├── rollup.ts            # positions → current allocation; redistributes parent-class holdings via hierarchy.ts
│   ├── placement.ts         # greedyPlace() — most-constrained-first placement fill
│   ├── placementHierarchy.ts # PlacementTarget tree helpers (bucket/TAX_DEFERRED/TAX_FREE/account-type/specific-account)
│   ├── cashfill.ts          # sequential concentrate-then-spill fill for deposits/withdrawals
│   ├── taxAdjust.ts         # tax-adjusted (after-tax) balance haircuts, issue #7
│   ├── taxableSale.ts       # single source of truth for what counts as a taxable capital-gains sale
│   ├── nativeAllocation.ts  # holdings-lens (native, unredistributed) allocation views, issue #78
│   ├── metrics.ts           # diversification() / aggressiveness() summary metrics
│   ├── resolve.ts           # matches engine trades to specific fund tickers
│   ├── rebalance.ts         # orchestrator → RebalanceResult
│   ├── utils.ts             # shared engine utilities
│   ├── scenarios/           # black-box scenario harness — JSON fixtures anchored to PRINCIPLES.md
│   │   ├── README.md        # fixture format + how to add a scenario
│   │   ├── schema.ts        # zod schema each *.scenario.json is validated against
│   │   ├── scenarios.test.ts # globs every fixture, runs the engine, asserts expected trades/flags
│   │   ├── 01-locked-accounts/ … 10-placement-specificity/  # one folder per PRINCIPLES.md priority
│   │   └── regressions/     # one fixture per fixed engine bug, named issue-N-*.scenario.json
│   ├── rebalance.test.ts
│   └── resolve.test.ts
├── ingest/
│   ├── schema.ts             # zod AppState schema + migration; validates all external data
│   ├── csv.ts                # generic CSV parser with column mapping
│   ├── detect.ts              # content-based format detection — picks the right adapter from a CSV's header
│   ├── ingest.test.ts
│   └── adapters/              # schwab.ts, fidelity.ts, empower.ts, vanguard.ts, etrade.ts, merrill.ts, plaid.ts (stub)
├── ui/                        # React components; depends on engine, never the reverse
│   ├── LandingPage.tsx         # marketing / home screen shown before the tab shell
│   ├── AccountsPanel.tsx
│   ├── ClassifyPanel.tsx
│   ├── ImportPanel.tsx
│   ├── StrategyPanel.tsx
│   ├── ResultsPanel.tsx
│   ├── OverviewPanel.tsx
│   ├── ReminderPanel.tsx       # next-rebalance reminder UI (calendar links + .ics download)
│   ├── HowItWorksDrawer.tsx    # slide-out explainer drawer
│   ├── DonutChart.tsx          # concentric donut (before/after by account type)
│   ├── PieChart.tsx            # shared pie chart primitive
│   ├── WeightPie.tsx           # asset-class allocation pie
│   ├── AllocationPlot.tsx      # diversification/aggressiveness scatter plot
│   ├── StackedBars.tsx         # asset class × account type stacked bars
│   ├── HelpBox.tsx             # contextual help tooltips
│   ├── Logo.tsx                # Drift mark + wordmark
│   ├── exportReport.ts         # generates downloadable HTML report
│   ├── ics.ts                  # builds the .ics calendar file for rebalance reminders
│   ├── site.ts                 # canonical deployment-wide constants (e.g. DRIFT_URL)
│   └── fmt.ts                  # ALL display formatting — rounding happens ONLY here
├── store.ts                   # localStorage save/load, rolling backups, JSON export/import
├── store.test.ts
├── App.tsx
└── data/
    ├── assetclass-map.json      # seed ticker → AssetClass (committed; no real data)
    ├── targetDateFunds.ts       # TDF-specific detection (glide-path estimates for blended-fund decomposition)
    ├── sample-portfolio.json    # synthetic fixture for demo mode (?demo URL param)
    └── fixtures/                # synthetic CSV exports (schwab, fidelity, empower, vanguard, etrade, merrill samples)
```

**Dependency rule:** `engine/` ← `ingest/` ← `ui/`. Engine never imports from UI or ingest. Never violate this.

---

## Key domain invariants

**Household-level, not per-account.**
Target weights apply to all accounts combined. The engine computes household dollar needs per asset class, then assigns them to accounts via placement rules. Never rebalance each account independently.

**US_TOTAL_MARKET is an ingest/display concept — not an engine target.**
In `Strategy.targets`, `US_TOTAL_MARKET` is always stored as `0`. The three cap sub-classes (`US_LARGE_CAP`, `US_MID_CAP`, `US_SMALL_CAP`) carry the weight. In ingest, tickers like VTI/FZROX are classified as `US_TOTAL_MARKET` and then redistributed to cap sub-classes in `rollup.ts` using the Russell split (Large 67%, Mid 25%, Small 8%). The user can override these proportions per-household in the Strategy tab.

**Money math is precise until display.**
All intermediate calculations use raw decimals. Rounding and `toFixed()` live exclusively in `src/ui/fmt.ts`. Engine math never rounds.

**Targets must sum to ~1.0.**
`zod` enforces this at the schema boundary. The Strategy UI enforces it live. Reject configs that don't comply.

**Fixed income → taxable (munis). Equities + alternatives → tax-advantaged.**
This is the *default* placement; preferences are user-configurable per asset class and per account. Independent of that config, the engine emits `REVISIT_PLACEMENT` when taxable assets > fixed income target weight — a standing heads-up that taxable can no longer be bonds-only, signaling a need to revisit placement rules.

---

## Engine priority order (abbreviated)

1. Respect locked accounts and positions (hard constraint)
2. Respect per-account asset class restrictions (hard constraint)
3. Keep each account's trades balance-preserving (hard constraint)
4. Hit the household-level target allocation
5. Suppress classes within the effective tolerance band — `min(toleranceAbs, toleranceRel × target)` per class (Bogleheads 5/25 rule; defaults ±5pp absolute, ±25% relative)
6. Place classes in tax-preferred buckets (most-constrained first)
7. Minimize taxable sells (`redirectTaxableSells` in `rebalance.ts`)
8. Distribute proportionally by remaining capacity
9. Minimize trades and accounts touched (consolidation pass + concentrate-then-spill)

Full spec: `PRINCIPLES.md`.

---

## Data and privacy

- **`/private/`** and **`*.local.json`** are gitignored. All real financial data lives there. Never commit anything from `/private/`.
- Only **synthetic fixtures** (`src/data/`) are committed.
- No scraping, no credential automation, no undocumented APIs. CSV export + manual entry only.

---

## Persistence

- State autosaves to `localStorage` on every change (`STORAGE_KEY = 'rebalancer-v1'`).
- 3-slot rolling backup written every 5 minutes. If the primary slot fails schema validation on load, the most recent valid backup is used automatically.
- **↓ Save / ↑ Load** in the header: JSON file export/import for portable backups.
- **Demo mode:** append `?demo` to the URL to load `sample-portfolio.json` without touching `localStorage`.

---

## Commands

```bash
npm run dev     # dev server → http://localhost:5173
npm test        # Vitest (495 tests across 20 files)
npm run build   # production build → dist/
```

Windows: double-click `launch.bat` — installs deps on first run, opens browser.

---

## Branching and release workflow

- **`main`** is the single trunk. Feature and bug-fix work happens on a dedicated branch off `main` and merges back via PR (squash). PRs targeting `main` (the default branch) get GitHub's native linked-issue + auto-close behavior from `Closes #N`, and CI runs on each PR.
- To cut a release, use the `/release` skill (`.claude/skills/release/SKILL.md`). It handles: preflight checks, semver reasoning, CHANGELOG update, `package.json` bump, release-branch PR, merge, git tag, and GitHub Release.
- Keep the `[Unreleased]` section of `CHANGELOG.md` current with each substantive change (same commit as the code).

---

## Hard guardrails (never violate)

- No user data leaves the browser (PII, holdings, account details, dollar amounts). Anonymous, cookieless, aggregate pageview analytics are the only permitted network traffic.
- No backend, no server-side processing of user data.
- Never commit real financial data.
- No credential automation or reverse-engineered APIs.
- Do not push or create remotes on the user's behalf.
- `src/engine/` must remain pure TypeScript — zero React imports.
- Round only at display time (`src/ui/fmt.ts`).

---

## Reference files

| File | Purpose |
|---|---|
| `CLAUDE.md` | Short working instructions for Claude (read first) |
| `IMPLEMENTATION_PLAN.md` | Design reference: principles, architecture rationale, domain model, guardrails |
| `PRINCIPLES.md` | Engine priority order, fully annotated |
| `CHANGELOG.md` | Version history; `[Unreleased]` section is kept current |
| `.claude/skills/release/` | `/release` skill — step-by-step release automation |
| [GitHub Issues](https://github.com/rblumen/drift/issues) | P0–P2 enhancements and bugs (labels: P0/P1/P2, bug) |
