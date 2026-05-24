# Multi-Account Portfolio Rebalancer — Implementation Plan

> **Audience:** This document is the build spec for an AI coding agent (Claude Code) and any human reviewer. Work milestone by milestone, commit at each milestone boundary, and pause for review before starting the next one.

---

## 1. What we're building

A small, local, browser-based tool that ingests current investment positions from multiple accounts and institutions, classifies each holding into an asset class, compares the household's combined allocation against an editable target strategy, and produces concrete **buy/sell recommendations for each account**.

### Core design principle (read this twice)

This is **not** an account-by-account percentage matcher. It is a **household-level allocation engine with account-level placement rules.** The target weights apply to all accounts *combined*; the engine then decides *which account* each asset class should live in, steering asset classes into their tax-preferred accounts and minimizing trades in taxable accounts. Getting this household-vs-account distinction right is the whole point of the tool.

---

## 2. Goals and non-goals

**In scope (v1):**
- Ingest positions from multiple accounts at Empower, Schwab, and Fidelity via manual entry and CSV import, behind a pluggable adapter layer.
- Map holdings (tickers) to asset classes via an editable lookup, with a flow to classify anything unmapped.
- Compute current household allocation, drift vs. target, and a tolerance band to suppress trivial trades.
- Placement-aware, per-account rebalancing recommendations (dollar amounts; shares optional when a price is supplied).
- Fully editable strategy: target weights, placement rules, and tolerance — flexibility is a first-class requirement.

**Explicit non-goals (deferred):**
- Cost-basis / tax-lot tracking and exact realized-gain estimation. *(v1 only flags that a sale lands in a taxable account.)*
- Live price feeds. *(User enters current market values off statements.)*
- Automated brokerage/aggregator connections. *(A Plaid adapter is stubbed for the future; see §8.)*
- Any server, login, account creation, or transmission of financial data off the user's machine.

---

## 3. Tech stack and rationale

| Choice | Tool | Why |
|---|---|---|
| Language | TypeScript | Type safety for money math and domain invariants |
| Framework | React 18 | Stateful, recompute-on-edit UI |
| Build | Vite | Fast, zero-config local dev |
| Styling | Tailwind CSS | Quick, consistent layout |
| CSV | papaparse | Robust broker CSV parsing |
| Validation | zod | Validate imported data and config at the boundary |
| Tests | Vitest | Unit-test the engine |

**Hard architectural rule:** the rebalancing engine (`src/engine/`) is **pure TypeScript with no React imports** — pure functions over plain data, fully unit-tested. The UI and ingest adapters depend on the engine, never the reverse. This keeps the math correct, testable, and reusable, and makes the "adjust the plan as we go" requirement cheap to honor.

Everything runs client-side. No backend, no telemetry, no network calls in v1.

---

## 4. Repository setup (Milestone 0)

Run these in an empty project directory. **Do not create any GitHub/remote account or push on the user's behalf** — if the user wants a remote, they will create the empty repo themselves and add it (`git remote add origin …`) or use an already-authenticated `gh` CLI.

```bash
mkdir rebalancer && cd rebalancer
git init
npm create vite@latest . -- --template react-ts
npm install
npm install papaparse zod
npm install -D vitest @types/papaparse tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Then create the directory structure in §6, the `CLAUDE.md` (provided alongside this plan), a `README.md`, and a `.gitignore` that includes at minimum:

```
node_modules
dist
.env
.env.*
/private/
*.local.json
```

**Privacy convention (enforced via .gitignore):** real account balances are never committed. Anything under `/private/` or matching `*.local.json` is git-ignored and is where the user keeps their actual data. Only synthetic sample fixtures (`src/data/sample-portfolio.json`) are committed.

Finish M0 with an initial commit: `chore: scaffold project, tooling, and CLAUDE.md`.

**Branch/commit strategy:** `main` is always working. Do one branch per milestone (`feat/m1-engine`, etc.), with focused commits, and merge at the milestone boundary after review.

---

## 5. Domain model

Define in `src/engine/types.ts`:

```ts
export type AssetClass =
  | 'US_TOTAL_MARKET'
  | 'DEVELOPED_INTL'
  | 'EMERGING_INTL'
  | 'FIXED_INCOME'
  | 'ALTERNATIVES'
  | 'CASH';

export type AccountType =
  | 'TAXABLE'
  | 'TRADITIONAL_IRA'
  | 'ROTH_IRA'
  | 'FOUR_OH_ONE_K'
  | 'FIVE_TWENTY_NINE'
  | 'HSA'
  | 'OTHER';

// Placement buckets group account types by tax treatment.
export type PlacementBucket = 'TAXABLE' | 'TAX_ADVANTAGED' | 'EDUCATION';

export interface Account {
  id: string;
  name: string;          // e.g. "Schwab Brokerage"
  institution: string;   // "Schwab" | "Fidelity" | "Empower" | ...
  type: AccountType;
  newCash?: number;      // optional investable cash to deploy this rebalance
}

export interface Position {
  accountId: string;
  ticker: string;        // or a synthetic id for no-ticker holdings
  description?: string;
  marketValue: number;   // current $ value (required)
  price?: number;        // optional, enables share-count output
}

export interface Strategy {
  targets: Record<AssetClass, number>;          // weights summing to 1.0
  placement: Record<AssetClass, PlacementBucket[]>; // preferred buckets, in order
  toleranceAbs: number;  // e.g. 0.05 → ignore drift within ±5 percentage points
  minTradeUsd: number;   // suppress dust trades below this dollar amount
}

export interface Trade {
  accountId: string;
  assetClass: AssetClass;
  deltaUsd: number;      // + = buy, − = sell
  inTaxableAccount: boolean;
}

export interface RebalanceResult {
  householdValue: number;
  currentWeights: Record<AssetClass, number>;
  targetWeights: Record<AssetClass, number>;
  projectedWeights: Record<AssetClass, number>;
  trades: Trade[];
  flags: Flag[];
}

export type Flag =
  | { kind: 'WITHIN_TOLERANCE'; assetClass: AssetClass }
  | { kind: 'TAXABLE_SALE'; accountId: string; assetClass: AssetClass; amountUsd: number }
  | { kind: 'UNMAPPED_HOLDING'; ticker: string }
  | { kind: 'PLACEMENT_SPILLOVER'; assetClass: AssetClass; bucket: PlacementBucket; amountUsd: number }
  | { kind: 'REVISIT_PLACEMENT'; taxableShare: number; fixedIncomeTarget: number };
```

Map `AccountType → PlacementBucket`: `TAXABLE → TAXABLE`; `FIVE_TWENTY_NINE → EDUCATION`; everything else (`TRADITIONAL_IRA`, `ROTH_IRA`, `FOUR_OH_ONE_K`, `HSA`) `→ TAX_ADVANTAGED`.

---

## 6. Directory layout

```
rebalancer/
├── CLAUDE.md
├── IMPLEMENTATION_PLAN.md        # this file
├── README.md
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── engine/                   # PURE — no React
│   │   ├── types.ts
│   │   ├── strategy.ts           # DEFAULT_STRATEGY (see §7)
│   │   ├── classify.ts           # ticker → AssetClass
│   │   ├── rollup.ts             # positions → current allocation
│   │   ├── placement.ts          # greedy placement-aware allocation (§9)
│   │   ├── rebalance.ts          # orchestrator → RebalanceResult
│   │   └── rebalance.test.ts     # worked example from §9 as a test
│   ├── ingest/
│   │   ├── schema.ts             # zod schema for normalized Position
│   │   ├── manual.ts
│   │   ├── csv.ts                # generic CSV + column mapping
│   │   └── adapters/
│   │       ├── schwab.ts
│   │       ├── fidelity.ts
│   │       ├── empower.ts        # "enter asset-class totals from the dashboard" helper
│   │       └── plaid.ts          # STUB (future) — see §8
│   ├── ui/
│   │   ├── AccountsPanel.tsx
│   │   ├── ImportPanel.tsx
│   │   ├── ClassifyPanel.tsx
│   │   ├── StrategyPanel.tsx
│   │   └── ResultsPanel.tsx
│   └── data/
│       ├── assetclass-map.json   # seed ticker → asset class
│       └── sample-portfolio.json # SYNTHETIC fixture (never real data)
└── .gitignore
```

---

## 7. Default strategy configuration

Put this in `src/engine/strategy.ts` as `DEFAULT_STRATEGY`. Every value here is a default the user can edit in the UI.

**Target weights** (sum = 1.0):

| Asset class | Weight |
|---|---|
| US_TOTAL_MARKET | 0.575 |
| DEVELOPED_INTL | 0.17 |
| EMERGING_INTL | 0.03 |
| FIXED_INCOME | 0.20 |
| ALTERNATIVES | 0.025 |
| CASH | 0.0 |

**Placement preferences** (ordered; first bucket is filled first):

| Asset class | Preferred buckets |
|---|---|
| FIXED_INCOME | `['TAXABLE']` — held as NY tax-free munis (e.g. MUNY) |
| ALTERNATIVES | `['TAX_ADVANTAGED']` — crypto/metals; collectibles tax treatment favors IRA |
| US_TOTAL_MARKET | `['TAX_ADVANTAGED', 'TAXABLE']` |
| DEVELOPED_INTL | `['TAX_ADVANTAGED', 'TAXABLE']` |
| EMERGING_INTL | `['TAX_ADVANTAGED', 'TAXABLE']` |
| CASH | `['TAXABLE', 'TAX_ADVANTAGED']` |

**Other defaults:** `toleranceAbs = 0.05`, `minTradeUsd = 250`.

### The placement compromise + the revisit trigger

The current strategy is: keep taxable accounts focused on tax-free muni bonds near-term (manage tax liability while the taxable balance is still small relative to total), and concentrate growth assets in tax-advantaged accounts. That is exactly what the placement table above encodes.

This compromise has a built-in expiry that the engine must detect and surface. When the **taxable share of total assets exceeds the fixed-income target weight**, taxable accounts can no longer be bonds-only and equities must begin landing there. At that point emit a `REVISIT_PLACEMENT` flag:

```
if (taxableValue / householdValue) > strategy.targets.FIXED_INCOME
    → emit REVISIT_PLACEMENT { taxableShare, fixedIncomeTarget }
```

This turns "we'll reconsider as the taxable balance grows" into an automatic, measurable prompt rather than a someday-maybe.

Leave a clear extension point to later split `ALTERNATIVES` into `CRYPTO` and `PRECIOUS_METALS` sub-targets without changing the engine's interface.

---

## 8. Ingest adapters

All adapters normalize into the same `Position[]` shape validated by `src/ingest/schema.ts`. The UI should never depend on a specific source format.

- **`manual.ts`** — form entry of account + positions. Lowest-friction path; build first.
- **`csv.ts`** — generic CSV import with a column-mapping step (user maps "this column = ticker, that column = market value"). Remember mappings per institution.
- **`adapters/schwab.ts`, `adapters/fidelity.ts`** — thin wrappers over `csv.ts` preconfigured for each broker's native positions export. These are the most robust real-data path and carry zero credential risk.
- **`adapters/empower.ts`** — a helper for the fastest path: Empower's dashboard already classifies holdings by asset class, so this adapter lets the user enter **asset-class dollar totals per account** read straight off Empower's Allocation/Holdings view. Note the tradeoff in code comments: Empower's taxonomy may not map 1:1 to our buckets and per-account detail can blur.
- **`adapters/plaid.ts`** — **STUB ONLY** in v1. Document that Plaid's Investments holdings endpoint is the eventual push-button option, that it connects the underlying brokerages directly (not Empower), requires a developer account, and that Fidelity access there is gated behind paid plans with a multi-week lead time. Do not implement live calls in v1.

> Do not build, suggest, or scaffold any flow that automates entry of brokerage or Empower login credentials or reverse-engineers a private/undocumented API. CSV export and manual entry only.

---

## 9. The rebalancing engine (the core)

Implement as pure functions, orchestrated by `rebalance(accounts, positions, strategy): RebalanceResult`.

**Step 1 — Roll up.** Classify every position; sum market values by asset class across all accounts. Compute `householdValue` (all positions + any `newCash`), `currentValue[ac]`, and `currentWeights[ac]`. Any unclassified ticker → `UNMAPPED_HOLDING` flag (and exclude from trade math until resolved).

**Step 2 — Targets.** `targetValue[ac] = targets[ac] * householdValue`.

**Step 3 — Tolerance.** For each class within `±toleranceAbs` of target, emit `WITHIN_TOLERANCE` and treat it as on-target (no trades generated for it). If *all* classes are within band, return early with no trades.

**Step 4 — Placement-aware location (greedy fill).** Decide a target dollar amount for each `(account, assetClass)` pair such that each class's household target is met *and* each account stays fully invested at its own value. Algorithm:

```
remainingNeed[ac]      = targetValue[ac]           // how much of each class to place
remainingCapacity[acct]= account value (+ newCash) // how much $ each account can hold

// Process classes most-placement-constrained first:
order = [FIXED_INCOME, ALTERNATIVES, EMERGING_INTL, DEVELOPED_INTL, US_TOTAL_MARKET, CASH]

for ac in order:
  for bucket in strategy.placement[ac]:           // preferred buckets, in order
    accts = accounts with this bucket AND remainingCapacity > 0
    distribute min(remainingNeed[ac], Σ capacity) across accts
        proportional to each acct's remainingCapacity
    decrement remainingNeed[ac] and remainingCapacity[acct]
  if remainingNeed[ac] > 0:                        // preferred buckets full
    spill into ANY remaining-capacity account (proportional)
    emit PLACEMENT_SPILLOVER { ac, bucket, amount }
→ targetLocation[acct][ac]
```

This greedy fill produces the intended behavior automatically: bonds fill taxable first (munis), alts and equities fill tax-advantaged; if taxable is larger than the bond sleeve, leftover taxable capacity is filled by spillover equities **and** the §7 `REVISIT_PLACEMENT` flag fires.

**Step 5 — Trades.** `delta = targetLocation[acct][ac] − currentValue[acct][ac]`. Positive = buy, negative = sell. Drop any `|delta| < minTradeUsd`. Mark `inTaxableAccount` and emit `TAXABLE_SALE` for sells in taxable accounts (no gain estimate in v1 — just the warning). If a position has a `price`, also report share counts.

**Step 6 — Project & return.** Compute `projectedWeights` after trades (should match targets within rounding) and return the full `RebalanceResult`.

### Worked example (encode this as `rebalance.test.ts`)

Accounts: Schwab **Taxable** $200k · Fidelity **Traditional IRA** $300k · Empower **401k** $500k → household **$1,000k**.

Target values: US 575k · DevIntl 170k · EM 30k · FI 200k · Alts 25k.

Expected target *location* from the greedy fill:

| | Taxable (200k) | Trad IRA (300k) | 401k (500k) |
|---|---|---|---|
| FIXED_INCOME | **200k** | — | — |
| ALTERNATIVES | — | **25k** | — |
| US_TOTAL_MARKET | — | ~204k | ~371k |
| DEVELOPED_INTL | — | ~60k | ~110k |
| EMERGING_INTL | — | ~11k | ~19k |

FI fully fills taxable (capacity exactly meets the 200k sleeve), alts go to the IRA, and the three equity classes split across the IRA's remaining 275k and the 401k's 500k in a 275:500 ratio. Taxable share = 200k/1,000k = 20%, exactly at the FI target — the boundary case, so `REVISIT_PLACEMENT` does **not** fire here. Add a second test where taxable = $300k to confirm spillover equities land in taxable **and** the flag fires.

---

## 10. UI

Five panels, all driven off engine output, everything editable (recompute on change):

1. **Accounts** — add/edit accounts (name, institution, type, optional new cash).
2. **Import** — choose adapter (manual / CSV / Schwab / Fidelity / Empower-totals), map columns, load positions.
3. **Classify** — resolve any `UNMAPPED_HOLDING`; edits persist to the ticker map.
4. **Strategy** — edit target weights (with a live "sums to 100%" check), placement order, tolerance, min-trade. This panel is where the "tweak as we go" requirement lives.
5. **Results** — household current-vs-target chart, per-account trade list (buy/sell, dollars, shares if available), and all flags rendered prominently (especially `REVISIT_PLACEMENT` and `TAXABLE_SALE`).

---

## 11. Testing

- Unit-test the engine thoroughly: the §9 worked example, the taxable-spillover/revisit case, tolerance-band suppression, unmapped-holding handling, and new-cash deployment (cash should preferentially buy underweight classes).
- Validate all imported data and the strategy config through zod at the boundary; reject targets that don't sum to ~1.0.
- Commit a synthetic `sample-portfolio.json` for demos and tests. Never commit real figures.

---

## 12. Milestones (each = one branch, one review, one merge)

- **M0 — Scaffold:** repo, tooling, Tailwind, `CLAUDE.md`, `.gitignore`, sample fixture. *(§4)*
- **M1 — Engine:** types, default strategy, rollup, placement, rebalance, plus the §9 tests. Pure logic, no UI. This is the heart; get it green before any UI.
- **M2 — Ingest:** manual + generic CSV + Schwab/Fidelity + Empower-totals adapters, normalized schema, fixtures.
- **M3 — UI:** all five panels wired to the engine.
- **M4 — Persistence & polish:** save/load setup via localStorage and JSON file export/import; surface flags; "sums to 100%" guard; alts-split extension point.
- **Future:** Plaid adapter; optional cost-basis + realized-gain estimates; crypto/metals sub-targets.

---

## 13. Guardrails (apply throughout)

- All computation stays client-side; no network calls in v1; no telemetry.
- Never commit real financial data — only synthetic fixtures; keep `/private/` and `*.local.json` git-ignored.
- No credential automation and no undocumented/reverse-engineered APIs; CSV + manual entry only.
- Do not create remote repos or push on the user's behalf; leave hosting to the user.
- Money math in a single currency; round only at display time.
- This tool produces mechanical recommendations from the user's own inputs and strategy. It is not investment advice.
