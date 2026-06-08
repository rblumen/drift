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
    // DEVELOPED_INTL held at the parent level (Europe/Pacific children stay 0 until
    // the user splits or holds a regional fund — see CLASS_HIERARCHY.migrateSplit).
    DEVELOPED_INTL:   0.17,
    DEVELOPED_EUROPE: 0.0,
    DEVELOPED_PACIFIC: 0.0,
    EMERGING_INTL:    0.03,
    // FIXED_INCOME held at the parent level; bond sub-classes stay 0 until opted into.
    FIXED_INCOME:     0.20,
    US_TREASURY:      0.0,
    US_CORP_BOND:     0.0,
    MUNI_BOND:        0.0,
    TIPS:             0.0,
    INTL_BOND:        0.0,
    // REAL_ESTATE — standalone top-level sleeve (REITs); off by default.
    REAL_ESTATE:      0.0,
    ALTERNATIVES:     0.025,
    CRYPTO:           0.0,
    PRECIOUS_METALS:  0.0,
    CASH:             0.0,
  },
  // Asset-location defaults (issue #89): high-growth sleeves prefer tax-free (Roth/HSA),
  // ordinary-income bond sleeves prefer tax-deferred (Traditional/401k), munis stay
  // taxable. Targets that don't exist in a given household are skipped without penalty.
  placement: {
    // FIXED_INCOME parent — held as NY tax-free munis (e.g. MUNY) in taxable.
    FIXED_INCOME:     ['TAXABLE'],
    // Bond sub-classes: munis stay taxable; ordinary-income coupons → tax-deferred.
    MUNI_BOND:        ['TAXABLE'],
    US_TREASURY:      ['TAX_DEFERRED', 'TAXABLE'],
    US_CORP_BOND:     ['TAX_DEFERRED'],
    TIPS:             ['TAX_DEFERRED'],
    INTL_BOND:        ['TAX_DEFERRED'],
    // Alternatives — high-growth/high-vol; prefer Roth, then tax-deferred.
    ALTERNATIVES:     ['TAX_FREE', 'TAX_DEFERRED'],
    CRYPTO:           ['TAX_FREE', 'TAX_DEFERRED'],
    PRECIOUS_METALS:  ['TAX_FREE', 'TAX_DEFERRED'],
    // REITs — non-qualified dividends + growth → Roth, then tax-deferred.
    REAL_ESTATE:      ['TAX_FREE', 'TAX_DEFERRED'],
    // Equities prefer tax-free; spill to tax-deferred then taxable as capacity is exhausted.
    EMERGING_INTL:    ['TAX_FREE', 'TAX_DEFERRED', 'TAXABLE'],
    DEVELOPED_INTL:   ['TAX_DEFERRED', 'TAXABLE'],
    DEVELOPED_EUROPE: ['TAX_DEFERRED', 'TAXABLE'],
    DEVELOPED_PACIFIC: ['TAX_DEFERRED', 'TAXABLE'],
    US_TOTAL_MARKET:  ['TAX_FREE', 'TAX_DEFERRED', 'TAXABLE'],
    US_LARGE_CAP:     ['TAX_FREE', 'TAX_DEFERRED', 'TAXABLE'],
    US_MID_CAP:       ['TAX_FREE', 'TAX_DEFERRED', 'TAXABLE'],
    US_SMALL_CAP:     ['TAX_FREE', 'TAX_DEFERRED', 'TAXABLE'],
    CASH:             ['TAXABLE', 'TAX_ADVANTAGED'],
  },
  toleranceAbs: 0.05,
  toleranceRel: 0.25,
  // Aim to land within half the trigger band once a rebalance fires (issue #42),
  // leaving drift headroom before the next one re-triggers.
  rebalanceTargetFraction: 0.5,
  minTradeUsd:  250,
  // Exhaust tax-advantaged rebalancing before selling in taxable accounts.
  preferTaxAdvantagedRebalance: true,
};
