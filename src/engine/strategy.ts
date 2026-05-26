// Default household strategy.
//
// Every value here is editable by the user in the Strategy panel. This file
// exists only to provide a sensible starting point.
//
// ── Alts-split extension point ───────────────────────────────────────────────
// When ready to split ALTERNATIVES into sub-classes (e.g. CRYPTO and
// PRECIOUS_METALS), the migration path is:
//
//   1. Add 'CRYPTO' | 'PRECIOUS_METALS' to the AssetClass union in types.ts.
//   2. Add them to ALL_ASSET_CLASSES (preserves rollup + placement iteration).
//   3. Add default targets here (set ALTERNATIVES: 0 and split across the two).
//   4. Add placement entries for each new class (both → TAX_ADVANTAGED).
//   5. Extend assetclass-map.json with fund/ETF tickers for each sub-class.
//   6. The engine (rollup, placement, rebalance) requires no further changes —
//      it already iterates ALL_ASSET_CLASSES generically.
// ─────────────────────────────────────────────────────────────────────────────

import type { Strategy } from './types';

export const DEFAULT_STRATEGY: Strategy = {
  targets: {
    // US equity 57.5% expressed as Russell-weighted cap sub-classes:
    //   57.5% × 0.67 = 38.5% large,  × 0.25 = 14.375% → 14.4% mid,  × 0.08 = 4.6% small.
    // US_TOTAL_MARKET holdings are auto-redistributed in rollup via RUSSELL_CAP_SPLIT.
    US_TOTAL_MARKET: 0.000,
    US_LARGE_CAP:    0.385,
    US_MID_CAP:      0.144,
    US_SMALL_CAP:    0.046,
    DEVELOPED_INTL:  0.17,
    EMERGING_INTL:   0.03,
    FIXED_INCOME:    0.20,
    ALTERNATIVES:    0.025,
    CASH:            0.0,
  },
  placement: {
    // FIXED_INCOME first — held as NY tax-free munis (e.g. MUNY) in taxable.
    FIXED_INCOME:    ['TAXABLE'],
    // ALTERNATIVES next — crypto/metals; collectibles tax treatment favors IRA.
    ALTERNATIVES:    ['TAX_ADVANTAGED'],
    // Equities prefer tax-advantaged; spill to taxable when capacity is exhausted.
    EMERGING_INTL:   ['TAX_ADVANTAGED', 'TAXABLE'],
    DEVELOPED_INTL:  ['TAX_ADVANTAGED', 'TAXABLE'],
    US_TOTAL_MARKET: ['TAX_ADVANTAGED', 'TAXABLE'],
    US_LARGE_CAP:    ['TAX_ADVANTAGED', 'TAXABLE'],
    US_MID_CAP:      ['TAX_ADVANTAGED', 'TAXABLE'],
    US_SMALL_CAP:    ['TAX_ADVANTAGED', 'TAXABLE'],
    CASH:            ['TAXABLE', 'TAX_ADVANTAGED'],
  },
  toleranceAbs: 0.05,
  minTradeUsd:  250,
};
