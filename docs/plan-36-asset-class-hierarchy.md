# Plan: Issue #36 — Asset Class Hierarchy

Generalize the existing US_TOTAL_MARKET → {LC, MC, SC} parent/child mechanism into a
reusable, declarative hierarchy, then expand the supported class list in phases.

---

## Background

The engine already implements one parent/child relationship:
- `US_TOTAL_MARKET` is redistributed to `US_LARGE_CAP / US_MID_CAP / US_SMALL_CAP` at
  rollup time (Russell weights), and child-class trades are merged back to the parent
  ticker at resolve time (e.g., LC+MC+SC trades on VTI → "buy $X VTI").
- This logic is currently hardcoded in three places: `rollup.ts` (`RUSSELL_CAP_SPLIT`),
  `resolve.ts` (`TOTAL_MARKET_EXPANSION`), and `schema.ts` (`migrateStrategyTargets`).

The goal is to make that pattern generic so any number of parent/child relationships can
be declared in one place, then have all three layers consume the declaration automatically.

### Key constraint

The engine must never recommend a buy at a more atomic level than the user currently
holds. If a user has no CRYPTO or PRECIOUS_METALS positions (greenfield), a buy
recommendation should say "buy $X ALTERNATIVES", not "buy $Y CRYPTO + buy $Z
PRECIOUS_METALS". The resolve layer's existing merge logic handles the *sell* side
(parent-ticker covers all children); Phase 1 adds symmetric **greenfield buy promotion**
for the *buy* side.

### Four-map propagation invariant

When a parent-class position is redistributed to its children at rollup time, the
redistribution must happen identically across **all four** tracking maps:

| Map | Purpose |
|---|---|
| `currentValue` | Household-level totals; drives drift/weight computation |
| `currentValueByAccount` | Per-account totals; drives placement and trade sizing |
| `lockedValueByAccount` | Immovable value; informs free capacity per (account, class) |
| `blendedValueByAccount` | Blended-fund sub-class value; read by Step 8.7 for proportional sells |

Omitting any map produces silent miscalculations (e.g., forgetting `lockedValueByAccount`
frees the engine to trade into a class that is actually locked).

---

## Phase 1 — Generic mechanism + initial expansion  *(this PR)*

Refactor the hardcoded UTM logic into a declarative hierarchy, add CRYPTO and
PRECIOUS_METALS as the first new leaf classes under ALTERNATIVES, and wire up the
greenfield-promotion pass.

### New file: `src/engine/hierarchy.ts`

Single source of truth for all parent/child relationships.

```ts
export interface ClassGroup {
  children: readonly AssetClass[];
  defaultWeights: Readonly<Partial<Record<AssetClass, number>>>;
}

export const CLASS_HIERARCHY: Partial<Record<AssetClass, ClassGroup>> = {
  US_TOTAL_MARKET: {
    children: ['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP'],
    defaultWeights: { US_LARGE_CAP: 0.67, US_MID_CAP: 0.25, US_SMALL_CAP: 0.08 },
  },
  ALTERNATIVES: {
    children: ['CRYPTO', 'PRECIOUS_METALS'],
    defaultWeights: { CRYPTO: 0.50, PRECIOUS_METALS: 0.50 },
  },
};

// Reverse map — derived, not hand-authored.
export const PARENT_CLASS: Partial<Record<AssetClass, AssetClass>>;
```

All other engine files import from here; no other file defines hierarchy relationships.

### `src/engine/types.ts`

Add `CRYPTO` and `PRECIOUS_METALS` to the `AssetClass` union and `ALL_ASSET_CLASSES`.

### `src/engine/rollup.ts`

Replace the hardcoded `RUSSELL_CAP_SPLIT` post-processing block with a generic loop over
`CLASS_HIERARCHY`. The loop must update all four tracking maps per the invariant above.
Remove the exported `RUSSELL_CAP_SPLIT` constant (callers should import from
`hierarchy.ts`).

### `src/engine/resolve.ts`

1. Replace `TOTAL_MARKET_EXPANSION` and the `ac === 'US_TOTAL_MARKET'` check in
   `coveredClasses()` with a generic `CLASS_HIERARCHY[ac]?.children ?? [ac]` lookup.

2. Add **greenfield buy promotion**: after the main resolution pass, scan the unresolved
   (no-ticker) buy trades. For each child class `C` with parent `P`:
   - if *all* siblings of `C` under `P` in the same account are also unresolved buys,
     replace the sibling group with a single parent-level unresolved buy (sum of deltas,
     `assetClass: P`).
   - if only *some* siblings are unresolved (mixed — user holds some sub-class funds but
     not others), emit individual leaf-level unresolved trades as today.

   The mixed case is correct: there is no single parent-class fund to route to, and the
   user's existing sub-class holdings tell them which funds to top up.

### `src/ingest/schema.ts`

- Add `CRYPTO`, `PRECIOUS_METALS` to the `ASSET_CLASSES` const and Zod enums.
- Generalize `migrateStrategyTargets` to loop over `CLASS_HIERARCHY` instead of the
  hardcoded UTM block. Migration condition per parent: `parent > 0.001` AND all children
  sum to `< 0.001`.
- Add default placement entries for new classes:
  `CRYPTO: ['TAX_ADVANTAGED']`, `PRECIOUS_METALS: ['TAX_ADVANTAGED']`.

### `src/data/assetclass-map.json`

Add common tickers for new classes:

| Class | Tickers |
|---|---|
| `CRYPTO` | IBIT, FBTC, GBTC, ETHA |
| `PRECIOUS_METALS` | GLD, IAU, GLDM, SLV, SGOL |

### `src/ui/fmt.ts`

Add `AC_LABEL` and `AC_COLOR` entries for `CRYPTO` and `PRECIOUS_METALS`.

### `src/ui/StrategyPanel.tsx`

- Group sub-classes visually under their parent in the target-entry form, matching the
  existing cap-sub-class composite widget pattern.
- **Visibility rule**: a class is shown in the UI if and only if:
  (a) its target weight is non-zero in the saved strategy, *or*
  (b) at least one position in the current portfolio maps to that class.
  Parent classes with all-zero children and no holdings remain hidden. This applies to
  existing classes too (e.g., `US_TOTAL_MARKET` is already hidden when target = 0).

### Testing priorities (Phase 1)

- Rollup: four-map propagation correct for ALTERNATIVES → CRYPTO + PRECIOUS_METALS.
- Rollup: existing UTM redistribution produces identical results after refactor.
- Resolve: greenfield promotion — all-sibling-unresolved buys collapse to parent trade.
- Resolve: mixed case — partial coverage emits individual leaf trades, not parent.
- Resolve: existing-holder path unchanged — VTI + LC/MC/SC trades still merge.
- Schema migration: ALTERNATIVES target splits correctly on load when sub-classes absent.
- Schema migration: old saves with UTM > 0 still migrate correctly.

---

## Phase 2 — Expanded static hierarchy  *(future PR, depends on Phase 1)*

Research and add a broader set of predefined classes covering:

- US equity sub-types: growth vs. value (e.g., US_LARGE_CAP_GROWTH, US_LARGE_CAP_VALUE)
- US sector funds: TECH, HEALTHCARE, ENERGY, FINANCIALS, etc.
- International sub-regions: DEVELOPED_EUROPE, DEVELOPED_PACIFIC, etc.
- Fixed income sub-types: MUNI_BOND, TIPS, CORP_BOND, INTL_BOND
- Real estate: REITS (currently grouped under ALTERNATIVES)

**Research deliverable** (precedes implementation): a proposed hierarchy tree with
`defaultWeights` sourced from index composition data (MSCI, Russell, Bloomberg Barclays),
plus a curated ticker map for each new class. The research should also confirm placement
rules for each new class (tax treatment) against `PRINCIPLES.md`.

**Visibility**: the same rule as Phase 1 — classes are hidden until referenced in
holdings or targets. This keeps the default UI clean for simple portfolios.

**No schema migration required** for new leaf classes added under existing parents: if
a user's existing `ALTERNATIVES: 0.08` target has never been sub-divided, the migration
logic added in Phase 1 will leave it as `ALTERNATIVES: 0.08`. Sub-class targets only
appear when the user opts in (by setting a non-zero target) or when a holding surfaces
the class.

---

## Phase 3 — Custom user-defined classes  *(deferred indefinitely)*

True runtime-defined classes require widening `AssetClass` from a closed TypeScript union
to an open `string` type (or a two-tier `CoreAssetClass | CustomAssetClass` design),
schema versioning, and threading the change through every `Record<AssetClass, …>` map,
Zod enum, and flag type in the engine. This is a significant architectural change with
unclear user demand. Revisit only if Phase 2's static expansion proves insufficient.
