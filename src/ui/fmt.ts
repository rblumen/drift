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
  US_TOTAL_MARKET:  'US Total Market',
  US_LARGE_CAP:     'US Large Cap',
  US_MID_CAP:       'US Mid Cap',
  US_SMALL_CAP:     'US Small Cap',
  DEVELOPED_INTL:   'Developed Intl',
  DEVELOPED_EUROPE: 'Developed Europe',
  DEVELOPED_PACIFIC: 'Developed Pacific',
  EMERGING_INTL:    'Emerging Intl',
  FIXED_INCOME:     'Fixed Income',
  US_TREASURY:      'US Treasury',
  US_CORP_BOND:     'US Corporate Bond',
  MUNI_BOND:        'Municipal Bond',
  TIPS:             'TIPS',
  INTL_BOND:        'International Bond',
  REAL_ESTATE:      'Real Estate',
  ALTERNATIVES:     'Alternatives',
  CRYPTO:           'Crypto',
  PRECIOUS_METALS:  'Precious Metals',
  CASH:             'Cash',
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

// Human-readable placement-target labels and chart colours. Beyond the three coarse
// tax-treatment buckets (used by the Classify/Results charts), the intermediate tiers and
// account-type leaves let placement rules name a specific home (issue #89).
export const BUCKET_LABEL: Record<string, string> = {
  TAXABLE:        'Taxable',
  TAX_ADVANTAGED: 'Tax-Advantaged',
  EDUCATION:      'Education (529)',
  // Issue #89 placement tiers and account-type leaves.
  TAX_DEFERRED:    'Tax-Deferred (Traditional/401k)',
  TAX_FREE:        'Tax-Free (Roth/HSA)',
  TRADITIONAL_IRA: 'Traditional IRA',
  ROTH_IRA:        'Roth IRA',
  FOUR_OH_ONE_K:   '401(k)',
  HSA:             'HSA',
  FIVE_TWENTY_NINE: '529 Plan',
  OTHER:           'Other',
};

export const BUCKET_COLOR: Record<string, string> = {
  TAXABLE:       '#fb923c', // orange-400
  TAX_ADVANTAGED: '#818cf8', // indigo-400
  EDUCATION:     '#f472b6', // pink-400
};

// Chart colours for asset classes — brand-tuned data-viz palette (issue #150).
//
// SOURCE OF TRUTH: this map is the per-asset-class palette. The five --dv-*
// family-anchor variables in src/index.css mirror the top-level family colours
// here (US, developed-intl, emerging, bond, alternatives) for CSS-only chrome;
// keep them in sync when these change.
//
// Design: each asset FAMILY keeps a distinct hue for legibility across up to 19
// slices, but every hue is retuned to sit with the landing-page brand — the navy
// ramp (#082855 → #2e72b4) plus burnt orange (#e8600a) on warm paper. Parents are
// darkest; children are lightness/hue steps within the family. Siblings and
// cross-family neighbours are kept perceptually distinct at 16px legend-dot sizes;
// every colour stays visible against white.
export const AC_COLOR: Record<string, string> = {
  // US equities — the brand navy ramp itself (parent darkest → children lighter).
  US_TOTAL_MARKET:  '#082855', // brand ink (navy, darkest)
  US_LARGE_CAP:     '#0d3e7a', // brand 600
  US_MID_CAP:       '#1a5fa0', // brand 500
  US_SMALL_CAP:     '#2e72b4', // brand 400
  // Developed intl — muted steel/slate-blue, separable from the US navy ramp.
  DEVELOPED_INTL:   '#3a6b8c', // steel blue (parent)
  DEVELOPED_EUROPE: '#5a8cab', // steel blue, lighter
  DEVELOPED_PACIFIC: '#7ba7c2', // steel blue, lightest
  // Emerging — its own desaturated blue-teal, distinct from both blue families.
  EMERGING_INTL:    '#2c8c85', // desaturated teal
  // Bonds — earthy ochre/gold/tan family with real lightness spread (six values).
  FIXED_INCOME:     '#8a6d1f', // deep ochre (parent)
  US_TREASURY:      '#a8842c', // ochre
  US_CORP_BOND:     '#c9a63f', // gold
  MUNI_BOND:        '#dcb851', // light gold
  TIPS:             '#e8ca73', // pale gold
  INTL_BOND:        '#ecd694', // tan (lightest — still visible on white)
  // Real estate — muted slate-green / olive.
  REAL_ESTATE:      '#5f7a54', // olive
  // Alternatives — the burnt-orange family anchored on the brand accent.
  ALTERNATIVES:     '#e8600a', // burnt orange (brand accent, parent)
  CRYPTO:           '#9c3408', // deep rust
  PRECIOUS_METALS:  '#c67f30', // golden-bronze (kept clear of the bond golds)
  // Cash — warm gray.
  CASH:             '#8a8175', // warm gray
};

// FAMILY-level chart colours (issue #150). Distinct from the per-class AC_COLOR
// map above: this is the strict landing-page CLS ramp (see src/ui/LandingPage.tsx),
// the official family-level dataviz palette for family-rollup charts. It mirrors
// the --dv-* variables in src/index.css — keep the two in sync.
// Consumed by the radar/bar/donut family-allocation charts landing in issue #98.
export const FAMILY_COLOR: Record<string, string> = {
  US:    '#082855', // US equities family (brand navy, landing CLS[0])
  INTL:  '#0d3e7a', // developed intl family (landing CLS[1])
  EM:    '#1a5fa0', // emerging intl family (landing CLS[2])
  BONDS: '#2e72b4', // fixed-income family (landing CLS[3])
  ALTS:  '#e8600a', // alternatives family (brand accent, landing CLS[4])
  CASH:  '#8a8175', // cash — warm gray (matches AC_COLOR.CASH)
};

// ── Family rollup (issue #98) ─────────────────────────────────────────────────
// The radar and donut allocation views collapse the 19-way AssetClass breakdown
// into five brand families (+ cash when material). This is the pure mapping the
// design handoff calls for: Record<AssetClass, number> → per-family weights.

// The five stable families the radar/donut always show, in spoke order
// (US → Intl → EM → Bonds → Alts). Cash is appended only when material.
export const ALLOCATION_FAMILIES = ['US', 'INTL', 'EM', 'BONDS', 'ALTS', 'CASH'] as const;
export type AllocationFamily = (typeof ALLOCATION_FAMILIES)[number];

// Which family each asset class rolls up into. Parent classes and their children
// map to the same family, so summing every class into its family double-counts
// nothing: a valid weight map carries weight on the parent OR its leaves, never
// both for the same dollars.
export const FAMILY_OF: Record<string, AllocationFamily> = {
  US_TOTAL_MARKET:  'US',
  US_LARGE_CAP:     'US',
  US_MID_CAP:       'US',
  US_SMALL_CAP:     'US',
  DEVELOPED_INTL:   'INTL',
  DEVELOPED_EUROPE: 'INTL',
  DEVELOPED_PACIFIC: 'INTL',
  EMERGING_INTL:    'EM',
  FIXED_INCOME:     'BONDS',
  US_TREASURY:      'BONDS',
  US_CORP_BOND:     'BONDS',
  MUNI_BOND:        'BONDS',
  TIPS:             'BONDS',
  INTL_BOND:        'BONDS',
  REAL_ESTATE:      'ALTS',
  ALTERNATIVES:     'ALTS',
  CRYPTO:           'ALTS',
  PRECIOUS_METALS:  'ALTS',
  CASH:             'CASH',
};

// Short family labels shown on radar spokes / donut legend.
export const FAMILY_LABEL: Record<AllocationFamily, string> = {
  US: 'US', INTL: 'Intl', EM: 'EM', BONDS: 'Bonds', ALTS: 'Alts', CASH: 'Cash',
};

// Short asset-class labels for the bar view's cramped x-axis (issue #98). Falls
// back to AC_LABEL when a class isn't listed.
export const AC_SHORT_LABEL: Record<string, string> = {
  US_TOTAL_MARKET:  'US Mkt',
  US_LARGE_CAP:     'US Lg',
  US_MID_CAP:       'US Mid',
  US_SMALL_CAP:     'US Sm',
  DEVELOPED_INTL:   'Intl',
  DEVELOPED_EUROPE: 'Europe',
  DEVELOPED_PACIFIC: 'Pacific',
  EMERGING_INTL:    'EM',
  FIXED_INCOME:     'Bonds',
  US_TREASURY:      'Treas',
  US_CORP_BOND:     'Corp',
  MUNI_BOND:        'Muni',
  TIPS:             'TIPS',
  INTL_BOND:        'Intl Bd',
  REAL_ESTATE:      'REIT',
  ALTERNATIVES:     'Alts',
  CRYPTO:           'Crypto',
  PRECIOUS_METALS:  'Metals',
  CASH:             'Cash',
};

export type FamilyWeights = Record<AllocationFamily, number>;

// Cash appears as a sixth spoke/bar only when its weight in either series is
// material; below this it is folded away (design: > 0.5%).
export const CASH_MATERIAL_THRESHOLD = 0.005;

/**
 * Roll a per-asset-class weight map up to the five brand families (US / Intl /
 * EM / Bonds / Alts). Missing classes count as 0. Weight on a parent class and
 * on its children both land in the same family, so no dollars are double-counted.
 * Pure — safe to call from render.
 */
export function rollupFamilies(weights: Partial<Record<string, number>>): FamilyWeights {
  const out: FamilyWeights = { US: 0, INTL: 0, EM: 0, BONDS: 0, ALTS: 0, CASH: 0 };
  for (const [ac, w] of Object.entries(weights)) {
    const fam = FAMILY_OF[ac];
    if (fam && w) out[fam] += w;
  }
  return out;
}

/**
 * The families to plot for a current/target (or before/after) pair, in spoke
 * order. Always the five equity/bond/alt families; CASH is appended only when
 * either series carries a material cash weight (> {@link CASH_MATERIAL_THRESHOLD}).
 */
export function activeFamilies(a: FamilyWeights, b: FamilyWeights): AllocationFamily[] {
  const base: AllocationFamily[] = ['US', 'INTL', 'EM', 'BONDS', 'ALTS'];
  if (a.CASH > CASH_MATERIAL_THRESHOLD || b.CASH > CASH_MATERIAL_THRESHOLD) base.push('CASH');
  return base;
}
