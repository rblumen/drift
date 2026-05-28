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
  return (n >= 0 ? '+' : '−') + fmtUsd(Math.abs(n));
}

export function fmtShares(deltaUsd: number, price: number | undefined): string | null {
  if (!price || price <= 0) return null;
  const shares = Math.abs(deltaUsd) / price;
  return shares.toFixed(3) + ' sh';
}

// Human-readable asset class labels.
export const AC_LABEL: Record<string, string> = {
  US_TOTAL_MARKET: 'US Total Market',
  US_LARGE_CAP:    'US Large Cap',
  US_MID_CAP:      'US Mid Cap',
  US_SMALL_CAP:    'US Small Cap',
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

// Chart colours for account types.
export const ACCT_TYPE_COLOR: Record<string, string> = {
  TAXABLE:          '#fb923c', // orange-400
  TRADITIONAL_IRA:  '#60a5fa', // blue-400
  ROTH_IRA:         '#34d399', // emerald-400
  FOUR_OH_ONE_K:    '#818cf8', // indigo-400
  FIVE_TWENTY_NINE: '#f472b6', // pink-400
  HSA:              '#2dd4bf', // teal-400
  OTHER:            '#9ca3af', // gray-400
};

// Human-readable placement bucket labels and chart colours.
export const BUCKET_LABEL: Record<string, string> = {
  TAXABLE:       'Taxable',
  TAX_ADVANTAGED: 'Tax-Advantaged',
  EDUCATION:     'Education (529)',
};

export const BUCKET_COLOR: Record<string, string> = {
  TAXABLE:       '#fb923c', // orange-400
  TAX_ADVANTAGED: '#818cf8', // indigo-400
  EDUCATION:     '#f472b6', // pink-400
};

// Chart colours for asset classes.
export const AC_COLOR: Record<string, string> = {
  US_TOTAL_MARKET: '#818cf8', // indigo-400
  US_LARGE_CAP:    '#3b82f6', // blue-500
  US_MID_CAP:      '#60a5fa', // blue-400
  US_SMALL_CAP:    '#93c5fd', // blue-300
  DEVELOPED_INTL:  '#38bdf8', // sky-400
  EMERGING_INTL:   '#34d399', // emerald-400
  FIXED_INCOME:    '#fbbf24', // amber-400
  ALTERNATIVES:    '#f87171', // red-400
  CASH:            '#9ca3af', // gray-400
};
