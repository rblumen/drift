import type { Strategy } from './types';

export const DEFAULT_STRATEGY: Strategy = {
  targets: {
    US_TOTAL_MARKET: 0.575,
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
    CASH:            ['TAXABLE', 'TAX_ADVANTAGED'],
  },
  toleranceAbs: 0.05,
  minTradeUsd: 250,
};
