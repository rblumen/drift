// Display formatting helpers — all rounding happens here, never in the engine.

export function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function fmtUsdCents(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function fmtPct(n: number, decimals = 1): string {
  return (n * 100).toFixed(decimals) + '%';
}

export function fmtDelta(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + fmtUsd(n);
}

export function fmtShares(deltaUsd: number, price: number | undefined): string | null {
  if (!price || price <= 0) return null;
  const shares = Math.abs(deltaUsd) / price;
  return shares.toFixed(3) + ' sh';
}

// Human-readable asset class labels.
export const AC_LABEL: Record<string, string> = {
  US_TOTAL_MARKET: 'US Total Market',
  DEVELOPED_INTL:  'Developed Intl',
  EMERGING_INTL:   'Emerging Intl',
  FIXED_INCOME:    'Fixed Income',
  ALTERNATIVES:    'Alternatives',
  CASH:            'Cash',
};

// Human-readable account type labels.
export const ACCT_TYPE_LABEL: Record<string, string> = {
  TAXABLE:         'Taxable',
  TRADITIONAL_IRA: 'Traditional IRA',
  ROTH_IRA:        'Roth IRA',
  FOUR_OH_ONE_K:   '401(k)',
  FIVE_TWENTY_NINE: '529',
  HSA:             'HSA',
  OTHER:           'Other',
};
