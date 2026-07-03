import { describe, it, expect } from 'vitest';
import {
  fmtUsd,
  fmtUsdCents,
  fmtPct,
  fmtDelta,
  fmtShares,
  AC_LABEL,
  ACCT_TYPE_LABEL,
  ACCT_TYPE_COLOR,
  BUCKET_LABEL,
  BUCKET_COLOR,
  AC_COLOR,
  rollupFamilies,
  activeFamilies,
  FAMILY_OF,
  CASH_MATERIAL_THRESHOLD,
} from './fmt';
import { ALL_ASSET_CLASSES } from '../engine/types';

// ─── fmtUsd ───────────────────────────────────────────────────────────────────

describe('fmtUsd', () => {
  it('formats a normal positive value with no decimals', () => {
    expect(fmtUsd(1234)).toBe('$1,234');
  });

  it('formats zero', () => {
    expect(fmtUsd(0)).toBe('$0');
  });

  it('formats a negative value with a leading minus', () => {
    expect(fmtUsd(-500)).toBe('-$500');
  });

  it('formats a large value with thousands separators', () => {
    expect(fmtUsd(1_234_567)).toBe('$1,234,567');
  });

  it('rounds to the nearest whole dollar (drops cents)', () => {
    expect(fmtUsd(1234.49)).toBe('$1,234');
    expect(fmtUsd(1234.5)).toBe('$1,235'); // banker's/round-half-up via toLocaleString
  });

  it('rounds a value just under a thousand boundary correctly', () => {
    expect(fmtUsd(999.6)).toBe('$1,000');
  });
});

// ─── fmtUsdCents ──────────────────────────────────────────────────────────────

describe('fmtUsdCents', () => {
  it('formats a normal value with cents', () => {
    expect(fmtUsdCents(1234.5)).toBe('$1,234.50');
  });

  it('formats zero with cents', () => {
    expect(fmtUsdCents(0)).toBe('$0.00');
  });

  it('formats a negative value with cents', () => {
    expect(fmtUsdCents(-42.1)).toBe('-$42.10');
  });

  it('rounds to two decimal places', () => {
    expect(fmtUsdCents(1.005)).toBe('$1.01'); // toLocaleString rounding at the 3rd decimal
    expect(fmtUsdCents(1.004)).toBe('$1.00');
  });

  it('formats a large value with thousands separators and cents', () => {
    expect(fmtUsdCents(1_234_567.89)).toBe('$1,234,567.89');
  });
});

// ─── fmtPct ───────────────────────────────────────────────────────────────────

describe('fmtPct', () => {
  it('formats a fraction as a percentage with default 1 decimal', () => {
    expect(fmtPct(0.5)).toBe('50.0%');
  });

  it('formats zero', () => {
    expect(fmtPct(0)).toBe('0.0%');
  });

  it('formats a negative fraction', () => {
    expect(fmtPct(-0.05)).toBe('-5.0%');
  });

  it('formats a value greater than 1 (over 100%)', () => {
    expect(fmtPct(1.25)).toBe('125.0%');
  });

  it('respects a custom decimals argument', () => {
    expect(fmtPct(0.12345, 2)).toBe('12.35%');
    expect(fmtPct(0.12345, 0)).toBe('12%');
  });

  it('rounds at the boundary of the requested decimal precision', () => {
    expect(fmtPct(0.045, 1)).toBe('4.5%');
    expect(fmtPct(0.005, 0)).toBe('1%'); // 0.5 rounds up under toFixed
  });
});

// ─── fmtDelta ─────────────────────────────────────────────────────────────────

describe('fmtDelta', () => {
  it('prefixes a positive value with a plus sign', () => {
    expect(fmtDelta(1500)).toBe('+$1,500');
  });

  it('prefixes a negative value with a minus sign (unicode minus) and no double sign', () => {
    expect(fmtDelta(-1500)).toBe('−$1,500');
  });

  it('treats zero as non-negative (plus sign)', () => {
    expect(fmtDelta(0)).toBe('+$0');
  });

  it('formats a large magnitude delta', () => {
    expect(fmtDelta(2_000_000)).toBe('+$2,000,000');
    expect(fmtDelta(-2_000_000)).toBe('−$2,000,000');
  });
});

// ─── fmtShares ────────────────────────────────────────────────────────────────

describe('fmtShares', () => {
  it('computes shares from a positive deltaUsd and price', () => {
    expect(fmtShares(1000, 100)).toBe('10.000 sh');
  });

  it('uses the absolute value for a negative (sell) deltaUsd', () => {
    expect(fmtShares(-1000, 100)).toBe('10.000 sh');
  });

  it('returns null when price is undefined', () => {
    expect(fmtShares(1000, undefined)).toBeNull();
  });

  it('returns null when price is zero', () => {
    expect(fmtShares(1000, 0)).toBeNull();
  });

  it('returns null when price is negative', () => {
    expect(fmtShares(1000, -5)).toBeNull();
  });

  it('formats to exactly three decimal places', () => {
    expect(fmtShares(100, 3)).toBe('33.333 sh');
  });

  it('handles a zero deltaUsd (zero shares)', () => {
    expect(fmtShares(0, 100)).toBe('0.000 sh');
  });
});

// ─── Label / color maps ───────────────────────────────────────────────────────

describe('AC_LABEL', () => {
  it('has a human-readable label for every asset class', () => {
    for (const ac of ALL_ASSET_CLASSES) {
      expect(AC_LABEL[ac]).toBeTruthy();
      expect(typeof AC_LABEL[ac]).toBe('string');
    }
  });

  it('labels a representative sample correctly', () => {
    expect(AC_LABEL.US_TOTAL_MARKET).toBe('US Total Market');
    expect(AC_LABEL.MUNI_BOND).toBe('Municipal Bond');
    expect(AC_LABEL.CASH).toBe('Cash');
  });
});

describe('AC_COLOR', () => {
  it('has a hex color for every asset class', () => {
    for (const ac of ALL_ASSET_CLASSES) {
      expect(AC_COLOR[ac]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('ACCT_TYPE_LABEL / ACCT_TYPE_COLOR', () => {
  const types = ['TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K', 'FIVE_TWENTY_NINE', 'HSA', 'OTHER'] as const;

  it('has a label for every account type', () => {
    for (const t of types) {
      expect(ACCT_TYPE_LABEL[t]).toBeTruthy();
    }
  });

  it('has a color for every account type', () => {
    for (const t of types) {
      expect(ACCT_TYPE_COLOR[t]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('labels 401(k) and 529 with their conventional shorthand', () => {
    expect(ACCT_TYPE_LABEL.FOUR_OH_ONE_K).toBe('401(k)');
    expect(ACCT_TYPE_LABEL.FIVE_TWENTY_NINE).toBe('529');
  });
});

describe('BUCKET_LABEL / BUCKET_COLOR', () => {
  it('labels the three coarse tax-treatment buckets', () => {
    expect(BUCKET_LABEL.TAXABLE).toBe('Taxable');
    expect(BUCKET_LABEL.TAX_ADVANTAGED).toBe('Tax-Advantaged');
    expect(BUCKET_LABEL.EDUCATION).toBe('Education (529)');
  });

  it('has colors only for the three coarse buckets (per §89 comment), not the intermediate tiers', () => {
    expect(BUCKET_COLOR.TAXABLE).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BUCKET_COLOR.TAX_ADVANTAGED).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BUCKET_COLOR.EDUCATION).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BUCKET_COLOR.TAX_DEFERRED).toBeUndefined();
  });

  it('labels the intermediate placement tiers and account-type leaves (issue #89)', () => {
    expect(BUCKET_LABEL.TAX_DEFERRED).toContain('Tax-Deferred');
    expect(BUCKET_LABEL.TAX_FREE).toContain('Tax-Free');
    expect(BUCKET_LABEL.TRADITIONAL_IRA).toBe('Traditional IRA');
    expect(BUCKET_LABEL.ROTH_IRA).toBe('Roth IRA');
    expect(BUCKET_LABEL.FOUR_OH_ONE_K).toBe('401(k)');
    expect(BUCKET_LABEL.HSA).toBe('HSA');
    expect(BUCKET_LABEL.FIVE_TWENTY_NINE).toBe('529 Plan');
    expect(BUCKET_LABEL.OTHER).toBe('Other');
  });
});

// ─── rollupFamilies (issue #98) ───────────────────────────────────────────────

describe('rollupFamilies', () => {
  it('returns all-zero families for an empty weight map', () => {
    expect(rollupFamilies({})).toEqual({ US: 0, INTL: 0, EM: 0, BONDS: 0, ALTS: 0, CASH: 0 });
  });

  it('every asset class maps into exactly one of the six families', () => {
    for (const ac of ALL_ASSET_CLASSES) {
      expect(FAMILY_OF[ac], `${ac} should have a family`).toBeDefined();
    }
  });

  it('sums each family from its member classes', () => {
    const fam = rollupFamilies({
      US_LARGE_CAP: 0.4,
      US_MID_CAP: 0.1,
      DEVELOPED_INTL: 0.12,
      EMERGING_INTL: 0.05,
      FIXED_INCOME: 0.15,
      US_TREASURY: 0.05,
      REAL_ESTATE: 0.04,
      ALTERNATIVES: 0.04,
    });
    expect(fam.US).toBeCloseTo(0.5, 10);
    expect(fam.INTL).toBeCloseTo(0.12, 10);
    expect(fam.EM).toBeCloseTo(0.05, 10);
    expect(fam.BONDS).toBeCloseTo(0.2, 10);
    expect(fam.ALTS).toBeCloseTo(0.08, 10);
    expect(fam.CASH).toBe(0);
  });

  it('folds a parent class and its children into the same family without double counting', () => {
    // A weight map may carry weight on the parent OR its leaves; both land in US
    // and are simply summed — the rollup never double-counts the same dollars.
    const viaParent = rollupFamilies({ US_TOTAL_MARKET: 0.6 });
    const viaChildren = rollupFamilies({ US_LARGE_CAP: 0.4, US_MID_CAP: 0.15, US_SMALL_CAP: 0.05 });
    expect(viaParent.US).toBeCloseTo(0.6, 10);
    expect(viaChildren.US).toBeCloseTo(0.6, 10);
    // Combined (as a fund that reports both) still just sums — no leaf is derived
    // from the parent, so there is nothing to subtract.
    const mixed = rollupFamilies({ US_TOTAL_MARKET: 0.3, US_LARGE_CAP: 0.3 });
    expect(mixed.US).toBeCloseTo(0.6, 10);
  });

  it('ignores unknown keys', () => {
    expect(rollupFamilies({ NOT_A_CLASS: 0.5, US_LARGE_CAP: 0.5 }).US).toBeCloseTo(0.5, 10);
  });
});

// ─── activeFamilies (issue #98) ───────────────────────────────────────────────

describe('activeFamilies', () => {
  const zero = { US: 0, INTL: 0, EM: 0, BONDS: 0, ALTS: 0, CASH: 0 } as const;

  it('always shows the five equity/bond/alt families, in spoke order', () => {
    expect(activeFamilies({ ...zero }, { ...zero })).toEqual(['US', 'INTL', 'EM', 'BONDS', 'ALTS']);
  });

  it('appends Cash when the current series has material cash', () => {
    const cur = { ...zero, CASH: CASH_MATERIAL_THRESHOLD + 0.001 };
    expect(activeFamilies(cur, { ...zero })).toContain('CASH');
  });

  it('appends Cash when the target series has material cash', () => {
    const tgt = { ...zero, CASH: 0.03 };
    expect(activeFamilies({ ...zero }, tgt)).toEqual(['US', 'INTL', 'EM', 'BONDS', 'ALTS', 'CASH']);
  });

  it('hides Cash when it is immaterial on both sides (at or below the threshold)', () => {
    const a = { ...zero, CASH: CASH_MATERIAL_THRESHOLD };
    const b = { ...zero, CASH: CASH_MATERIAL_THRESHOLD };
    expect(activeFamilies(a, b)).not.toContain('CASH');
  });
});
