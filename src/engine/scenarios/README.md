# Scenario fixtures

A **scenario** is a self-contained spec written as JSON: *given this realistic
portfolio + strategy, the engine should produce these trades and flags.* Unlike
unit tests (which prove a function behaves), scenarios prove the **tool**
behaves, anchored to the goals in [`PRINCIPLES.md`](../../../PRINCIPLES.md).

Each fixture is one `*.scenario.json` file. The harness
([`scenarios.test.ts`](./scenarios.test.ts)) globs every fixture under this
directory, validates it against [`schema.ts`](./schema.ts), runs the engine, and
asserts each field present in `expected`.

## Adding a scenario — zero code changes

1. Pick (or create) a principle subfolder, named `NN-short-label` after the
   PRINCIPLES.md goal number — e.g. `01-locked-accounts/`, `05-tolerance-bands/`,
   `06-tax-placement/`.
2. Drop a `*.scenario.json` file in it. The glob picks it up automatically; it
   appears in the test run (and the HTML report from `npm run test:report`) as
   its own named test, nested under a `Scenarios — NN-short-label` block.
3. Run `npx vitest run src/engine/scenarios` (or `npm test`).

No TypeScript changes are ever required to add a fixture.

## Fixture format

```jsonc
{
  // Short kebab-case identifier (fallback test title).
  "name": "locked-account-guards-overweight-class",

  // A full sentence describing the behavior under verification. This is the
  // test name shown in the report and printed on failure — write it as a spec.
  "description": "Goal 1: an over-weight class held entirely in a locked account is left untouched",

  // The PRINCIPLES.md goal number(s). A single number, a list ([4, 6]), or a
  // free-text label for supporting concerns that aren't a numbered goal.
  "principle": 1,

  // ── Engine inputs ────────────────────────────────────────────────────────
  // Same shapes the app uses (see src/engine/types.ts). Validated by the
  // canonical Zod schemas in src/ingest/schema.ts.
  "accounts":  [ /* Account[] */ ],
  "holdings":  [ /* Position[] — the engine's `positions` argument */ ],
  "strategy":  { /* Strategy */ },

  // Optional engine inputs (defaulted when omitted):
  "tickerOverrides":   { "FOO": "US_LARGE_CAP" },
  "decompositions":    { "FDKLX": { "US_LARGE_CAP": 0.6, "FIXED_INCOME": 0.4 } },
  "freeCash":          0,
  "plannedWithdrawal": 0,

  // ── Assertions ───────────────────────────────────────────────────────────
  // Every field is optional; an assertion runs only for a field that's present.
  "expected": { /* … */ }
}
```

### Tips

- **Strategy `placement` can be `{}`.** The strategy schema backfills the full
  default placement map for any class you omit, so `"placement": {}` is the
  shortest way to use standard tax-placement rules. Override only the classes
  you care about.
- **`targets` must include** `US_TOTAL_MARKET`, `DEVELOPED_INTL`,
  `EMERGING_INTL`, `FIXED_INCOME`, `ALTERNATIVES`, and `CASH` (the rest default
  to `0`), and must sum to `1.0 ± 0.001`.
- **Unknown keys are rejected.** The top-level object and `expected` are strict —
  a typo'd field fails validation with a clear message rather than silently
  passing.

## The `expected` block

| Field | Semantics |
|---|---|
| `trades` | **Exhaustive.** The engine must emit exactly these trades (order-independent). Match on `accountId` + `assetClass` + `deltaUsd` (within rounding). Zero-dollar placeholder trades are ignored, so `"trades": []` means "no actionable trades". `inTaxableAccount` is optional and asserted when present. |
| `requiredTrades` | **Presence (subset).** Each listed trade must appear (`deltaUsd` within tolerance) — pin a specific trade in a large set without enumerating all of them. The complement of `forbiddenTrades`. |
| `resolvedTrades` | **Exhaustive, as displayed.** The trade list after `resolveTradeVehicles` merges per-class trades onto held tickers (mirrors `App.tsx`). Each entry is `{ accountId, ticker, deltaUsd, assetClass? }`; `ticker: null` asserts a ticker-less row (greenfield / ambiguous) and is matched on `assetClass`. Rows are matched one-to-one; zero-dollar rows are ignored, so don't list one. Use to assert *which fund* a trade executes against ([#228](https://github.com/rblumen/drift/issues/228)). |
| `flags` | **Presence (subset).** Each listed flag must appear in the result. Specify `kind` plus any flag-specific fields you want matched (e.g. `{ "kind": "PLACEMENT_SPILLOVER", "bucket": "TAXABLE" }`); unlisted fields and other emitted flags are ignored. |
| `absentFlags` | **Absence.** None of these flags may appear — e.g. asserting a class is *not* `WITHIN_TOLERANCE` (the relative band fired) or that no `PLACEMENT_SPILLOVER` was raised. Same matcher shape as `flags`. |
| `projectedWeights` | **Partial.** Only the listed asset classes are checked against `result.projectedWeights` (post-trade household weights, as fractions of 1). |
| `currentWeights` | **Partial.** Only the listed asset classes are checked against `result.currentWeights` (pre-trade household weights). Idle/free cash surfaces under `CASH` here, so the weights sum to ~1.0 ([#83](https://github.com/rblumen/drift/issues/83)). |
| `nativeByAccount` | **Partial, per-account dollar breakdown BEFORE trades** (`result.nativeValueByAccount`). Each listed account checks only its listed classes; an account's idle/free cash (`newCash` + its share of distributed `freeCash`) appears under `CASH` alongside cash-classified holdings. This is what a per-account "Before" pie shows. |
| `projectedNativeByAccount` | **Partial, per-account dollar breakdown AFTER trades** (`result.projectedNativeValueByAccount`). Same shape as `nativeByAccount`; use to assert deployment (e.g. free cash consumed from `CASH`) and that "Before"/"After" reconcile. |
| `accountValueByAccount` | **Per-account total balance** in dollars — the sum of the holdings-lens breakdown (positions + idle cash), matching the account's investable value. Only listed accounts are checked. |
| `depositByAccount` | **Household free cash transferred into the account** in dollars (`result.depositByAccount`) — a transfer *in*, as opposed to in-account idle cash (whose deployment is balance-neutral). Only listed accounts are checked ([#84](https://github.com/rblumen/drift/issues/84)/[#87](https://github.com/rblumen/drift/issues/87)). |
| `withdrawalByAccount` | **Dollars withdrawn from the account** (`result.withdrawalByAccount`) — a transfer *out* (drawdown / RMD). The reported per-account **Net** change is `depositByAccount − withdrawalByAccount`. Only listed accounts are checked. |
| `projectedDriftWithinTolerance` | **Derived boolean.** `true` iff every class's post-trade weight sits within its effective band `min(toleranceAbs, toleranceRel × target)`. |
| `netByAccount` | **Per-account net trade delta** (sum of `deltaUsd`, within $2). The balance-preserving invariant: `0` for a pure rebalance, the account's contribution for a deployment. Only listed accounts are checked. |
| `tradeCountByAccount` | **Count of actionable (non-zero) trades per account.** Use to assert a locked account is untouched (`{ "ira": 0 }`) or that trades concentrate in one account. Only listed accounts are checked. |
| `forbiddenTrades` | **Account/class pairs that must NOT be traded.** Each `{ "accountId", "assetClass" }` must have no actionable trade — e.g. a class excluded from an account by `allowedAssetClasses`/`availableTickers`, or barred from a bucket. |

Numeric comparisons use a small tolerance (absolute `0.01` or `0.5%` of the
expected magnitude) to absorb floating-point noise.

## Authoring expected values

Write the scenario, set the `expected` fields to what you believe the engine
*should* do, and run it. On a mismatch the harness prints the scenario
description and a readable diff of actual vs expected — use that to either fix a
genuine bug or to read off the real values when your intent was vague. Keep
expected values **explicit** (no snapshots) so each fixture stays self-documenting.

## Principle coverage checklist

Tracks [#34](https://github.com/rblumen/drift/issues/34): every PRINCIPLES.md goal
should have at least one happy-path and one edge-case scenario. Keep this current
as fixtures land.

| Goal | Happy path | Edge case | Fixtures |
|---|:---:|:---:|---|
| 1. Locked accounts / positions | ✅ | ✅ | `01-locked-accounts/locked-account-zero-trades`, `…/mixed-locked-unlocked-positions`, `…/locked-account-guards-overweight-class` |
| 2. Per-account class restrictions | ✅ | ✅ | `02-class-restrictions/allowed-asset-classes-honored`, `…/available-tickers-derived-restriction` |
| 3. Balance-preserving per account | ✅ | ✅ | `03-balance-preserving/pure-rebalance-nets-to-zero`, `…/contribution-nets-to-newcash` |
| 4. Household target allocation | ✅ | ✅ | `04-household-target/multi-account-hits-target`, `…/locked-account-drags-others-compensate` |
| 5. Tolerance bands (5/25) | ✅ | ✅ | `05-tolerance-bands/on-target-portfolio-no-op`, `…/relative-band-fires-on-small-sleeve` |
| 6. Tax-preferred placement | ✅ | ✅ | `06-tax-placement/bonds-taxable-equities-tax-advantaged`, `…/taxable-exceeds-fi-equities-spill`, `…/no-preference-class-placed-by-capacity` |
| 7. Minimize taxable sells | ✅ | ✅ | `07-minimize-taxable-sells/equity-sell-redirected-to-tax-advantaged`, `…/forced-taxable-sell-when-no-alternative` |
| 8. Distribute by remaining capacity | ✅ | ✅ | `08-capacity-distribution/sleeve-splits-largest-account-first`, `…/capacity-tie-resolved-deterministically` |
| 9. `concentrateClasses` first | ✅ | ✅ | `09-concentrate-classes/concentrate-account-filled-first`, `…/concentrate-account-too-small-spills` |
| 10. Minimize trades | ✅ | ✅ | `10-minimize-trades/composite-buy-collapses-contribution`, `…/composite-buy-respects-target-band` (composite buys, #49; Step 8.6 consolidation still unfixtured) |
| 11. Minimize accounts touched | ⬜ | ⬜ | — |

### Regression vault

`regressions/` — every future bug fix should add a scenario here that fails
before the fix and passes after, named for the issue (e.g. `issue-57-….scenario.json`).