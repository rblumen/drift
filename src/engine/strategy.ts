// Default household strategy.
//
// Every value here is editable by the user in the Strategy panel. This file
// exists only to provide a sensible starting point.
//
// ALTERNATIVES is the parent class for CRYPTO and PRECIOUS_METALS. By default
// the allocation sits at the parent level (ALTERNATIVES: 0.025, sub-classes: 0),
// meaning the engine treats it as a single class. Users who hold specific sub-class
// funds (IBIT, GLD, etc.) will see the children surface automatically via the
// visibility rule in StrategyPanel.

import type { Strategy } from './types';

export const DEFAULT_STRATEGY: Strategy = {
  targets: {
    // US equity 57.5% expressed as Russell-weighted cap sub-classes:
    //   57.5% × 0.67 = 38.5% large,  × 0.25 = 14.375% → 14.4% mid,  × 0.08 = 4.6% small.
    // US_TOTAL_MARKET holdings are auto-redistributed in rollup via CLASS_HIERARCHY.
    US_TOTAL_MARKET:  0.000,
    US_LARGE_CAP:     0.385,
    US_MID_CAP:       0.144,
    US_SMALL_CAP:     0.046,
    DEVELOPED_INTL:   0.17,
    EMERGING_INTL:    0.03,
    FIXED_INCOME:     0.20,
    ALTERNATIVES:     0.025,
    CRYPTO:           0.0,
    PRECIOUS_METALS:  0.0,
    CASH:             0.0,
  },
  placement: {
    // FIXED_INCOME first — held as NY tax-free munis (e.g. MUNY) in taxable.
    FIXED_INCOME:     ['TAXABLE'],
    // Alternatives — crypto/metals; collectibles tax treatment favors IRA.
    ALTERNATIVES:     ['TAX_ADVANTAGED'],
    CRYPTO:           ['TAX_ADVANTAGED'],
    PRECIOUS_METALS:  ['TAX_ADVANTAGED'],
    // Equities prefer tax-advantaged; spill to taxable when capacity is exhausted.
    EMERGING_INTL:    ['TAX_ADVANTAGED', 'TAXABLE'],
    DEVELOPED_INTL:   ['TAX_ADVANTAGED', 'TAXABLE'],
    US_TOTAL_MARKET:  ['TAX_ADVANTAGED', 'TAXABLE'],
    US_LARGE_CAP:     ['TAX_ADVANTAGED', 'TAXABLE'],
    US_MID_CAP:       ['TAX_ADVANTAGED', 'TAXABLE'],
    US_SMALL_CAP:     ['TAX_ADVANTAGED', 'TAXABLE'],
    CASH:             ['TAXABLE', 'TAX_ADVANTAGED'],
  },
  toleranceAbs: 0.05,
  toleranceRel: 0.25,
  minTradeUsd:  250,
  // Exhaust tax-advantaged rebalancing before selling in taxable accounts.
  preferTaxAdvantagedRebalance: true,
};
