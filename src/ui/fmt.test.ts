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
