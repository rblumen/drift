# Multi-Account Portfolio Rebalancer — Reference

> Build instructions have been retired — all milestones are complete. This document now serves as a living design reference: principles, architecture rationale, domain model, and guardrails.

---

## Build status

| Milestone | Status |
|---|---|
| M0 — Scaffold | ✅ Complete |
| M1 — Engine | ✅ Complete |
| M2 — Ingest | ✅ Complete |
| M3 — UI | ✅ Complete |
| M4 — Persistence & polish | ✅ Complete |

**Shipped beyond original plan:**
- US equity split into `US_LARGE_CAP` / `US_MID_CAP` / `US_SMALL_CAP` with automatic Russell-weight redistribution of `US_TOTAL_MARKET` holdings
- `redirectTaxableSells()` — swaps equity sells out of taxable into tax-advantaged accounts when possible
- Per-account constraints: `locked`, `acceptsDeposits`, `concentrateClasses`, `allowedAssetClasses`, `availableTickers`
- Per-position `locked` flag (freezes individual holdings)
- `resolve.ts` — resolves engine trades to specific tickers for actionable output
- Household-level `freeCash` for new cash not yet attributed to a specific account
- Blended-fund decomposition (target-date funds, balanced funds) with automatic multi-class splitting (`targetDateFunds.ts` for TDF-specific glide-path detection); sellable as a whole during drawdowns (issue #40)
- `EXCESS_CASH`, `NO_ELIGIBLE_ACCOUNT`, and `PROJECTED_OFF_TARGET` flag types
- `appStateSchema` v1 with forward-migration logic

**Next work:** [GitHub Issues](https://github.com/rblumen/drift/issues) (labels: P0, P1, P2)

---

## Core design principle

This is **not** an account-by-account percentage matcher. It is a **household-level allocation engine with account-level placement rules.** Target weights apply to all accounts *combined*; the engine then decides *which account* each asset class lives in, steering asset classes into their tax-preferred accounts and minimizing trades in taxable accounts.

Getting this household-vs-account distinction right is the whole point of the tool.

---

## Goals and non-goals

**In scope:**
- Ingest positions from Empower, Schwab, and Fidelity via manual entry and CSV import, behind a pluggable adapter layer.
- Map holdings to asset classes via an editable lookup; classify anything unmapped.
- Compute household allocation, drift vs. target, and tolerance band.
- Placement-aware, per-account rebalancing recommendations in dollars (shares when price is available).
- Fully editable strategy: target weights, placement rules, tolerance, min-trade.

**Explicit non-goals (deferred):**
- Cost-basis / tax-lot tracking and realized-gain estimation. *(v1 only flags that a sale lands in taxable.)*
- Live price feeds. *(User enters current market values off statements.)*
- Automated brokerage connections. *(Plaid adapter stubbed for the future.)*
- Any server, login, or transmission of financial data off the user's machine.

---

## Architecture

| Layer | Tool | Why |
|---|---|---|
| Language | TypeScript | Type safety for money math and domain invariants |
| Framework | React 18 | Stateful, recompute-on-edit UI |
| Build | Vite | Fast, zero-config local dev |
| Styling | Tailwind CSS | Quick, consistent layout |
| CSV | papaparse | Robust broker CSV parsing |
| Validation | zod | Validate imported data and config at the boundary |
| Tests | Vitest | Unit-test the engine |

**Hard rule:** `src/engine/` is pure TypeScript with no React imports — pure functions over plain data, fully unit-tested. UI and ingest depend on the engine, never the reverse.

---

## Domain model (as built)

```ts
type AssetClass =
  | 'US_TOTAL_MARKET' | 'US_LARGE_CAP' | 'US_MID_CAP' | 'US_SMALL_CAP'
  | 'DEVELOPED_INTL' | 'EMERGING_INTL'
  | 'FIXED_INCOME' | 'ALTERNATIVES' | 'CASH';
// ALTERNATIVES is an extension point: split into CRYPTO + PRECIOUS_METALS in a future version.

type AccountType =
  | 'TAXABLE' | 'TRADITIONAL_IRA' | 'ROTH_IRA'
  | 'FOUR_OH_ONE_K' | 'FIVE_TWENTY_NINE' | 'HSA' | 'OTHER';

type PlacementBucket = 'TAXABLE' | 'TAX_ADVANTAGED' | 'EDUCATION';
// TAXABLE → TAXABLE; FIVE_TWENTY_NINE → EDUCATION; all others → TAX_ADVANTAGED.

// Key Account fields (see types.ts for full definition):
//   locked, acceptsDeposits, concentrateClasses, allowedAssetClasses, availableTickers

// Key Position fields: accountId, ticker, marketValue, price?, locked?

type Flag =
  | { kind: 'WITHIN_TOLERANCE'; assetClass }
  | { kind: 'TAXABLE_SALE'; accountId; assetClass; amountUsd }
  | { kind: 'UNMAPPED_HOLDING'; ticker }
  | { kind: 'PLACEMENT_SPILLOVER'; assetClass; bucket; amountUsd }
  | { kind: 'REVISIT_PLACEMENT'; taxableShare; fixedIncomeTarget }
  | { kind: 'NO_ELIGIBLE_ACCOUNT'; assetClass; amountUsd }
  | { kind: 'EXCESS_CASH'; amountUsd }
  | { kind: 'PROJECTED_OFF_TARGET'; assetClass; projectedWeight; targetWeight };
```

---

## Default strategy and placement rationale

**Target weights** (user-editable defaults):

| Asset class | Weight |
|---|---|
| US_TOTAL_MARKET | 0.575 |
| DEVELOPED_INTL | 0.17 |
| EMERGING_INTL | 0.03 |
| FIXED_INCOME | 0.20 |
| ALTERNATIVES | 0.025 |
| CASH | 0.0 |

**Placement preferences** (first bucket filled first):

| Asset class | Preferred buckets |
|---|---|
| FIXED_INCOME | `TAXABLE` — held as NY tax-free munis (e.g. MUNY) |
| ALTERNATIVES | `TAX_ADVANTAGED` — crypto/metals; collectibles tax treatment favors IRA |
| Equities | `TAX_ADVANTAGED`, then `TAXABLE` |
| CASH | `TAXABLE`, then `TAX_ADVANTAGED` |

**Other defaults:** `toleranceAbs = 0.05`, `toleranceRel = 0.25` (Bogleheads 5/25 rule — the engine uses whichever band is tighter per class), `minTradeUsd = 250`.

### The REVISIT_PLACEMENT heads-up

Placement preferences are user-configurable per asset class (and per account); the defaults above keep taxable focused on tax-free munis while concentrating growth assets in tax-advantaged accounts. Independent of that configuration, the engine emits a heads-up keyed on account values vs. the Fixed Income target:

```
if (taxableValue / householdValue) > strategy.targets.FIXED_INCOME
    → emit REVISIT_PLACEMENT { taxableShare, fixedIncomeTarget }
```

When taxable assets outgrow the fixed-income sleeve, bonds can no longer fill it exclusively and equities must begin landing in taxable. The flag is an automatic, measurable prompt to revisit the placement rules.

---

## Guardrails (permanent)

- All computation stays client-side — no backend, no network calls, no telemetry.
- Never commit real financial data. Only synthetic fixtures. `/private/` and `*.local.json` are git-ignored.
- No credential automation and no undocumented/reverse-engineered APIs. CSV export and manual entry only.
- Do not create remote repos or push on the user's behalf.
- Money math in a single currency; round only at display time.
- This tool produces mechanical recommendations from the user's own inputs and strategy. It is not investment advice.
