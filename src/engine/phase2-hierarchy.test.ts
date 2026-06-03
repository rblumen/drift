import { describe, it, expect } from 'vitest';
import type { Account, Position, Strategy, AssetClass } from './types';
import { DEFAULT_STRATEGY } from './strategy';
import { rebalance } from './rebalance';
import { rollup } from './rollup';
import { makeClassifier } from './classify';
import {
  CLASS_HIERARCHY, PARENT_CLASS, childrenOf, isParentClass, isChildClass,
  consolidateParentClasses,
} from './hierarchy';
import { resolveTradeVehicles } from './resolve';
import { parseStrategy } from '../ingest/schema';

// Phase 2a (issue #36): FIXED_INCOME and DEVELOPED_INTL promoted to parent classes;
// REAL_ESTATE added as a top-level leaf. These tests lock in the engine behaviors
// that the expansion depends on.

const classify = makeClassifier({});

// Build a complete targets map from a partial one (0 for omitted classes), matching
// what the schema produces and what the engine normalizes internally.
function targets(partial: Partial<Record<AssetClass, number>>): Record<AssetClass, number> {
  const base = Object.fromEntries(
    (Object.keys(DEFAULT_STRATEGY.targets) as AssetClass[]).map(ac => [ac, 0]),
  ) as Record<AssetClass, number>;
  return { ...base, ...partial };
}

function strat(partial: Partial<Record<AssetClass, number>>, over: Partial<Strategy> = {}): Strategy {
  return { ...DEFAULT_STRATEGY, targets: targets(partial), toleranceAbs: 0, minTradeUsd: 0, ...over };
}

// ─── hierarchy shape ───────────────────────────────────────────────────────────

describe('Phase 2 hierarchy shape', () => {
  it('FIXED_INCOME and DEVELOPED_INTL are parents; REAL_ESTATE is a standalone leaf', () => {
    expect(isParentClass('FIXED_INCOME')).toBe(true);
    expect(isParentClass('DEVELOPED_INTL')).toBe(true);
    expect(isParentClass('REAL_ESTATE')).toBe(false);
    expect(isChildClass('REAL_ESTATE')).toBe(false);
    expect(childrenOf('FIXED_INCOME')).toEqual(['US_TREASURY', 'US_CORP_BOND', 'MUNI_BOND', 'TIPS', 'INTL_BOND']);
    expect(childrenOf('DEVELOPED_INTL')).toEqual(['DEVELOPED_EUROPE', 'DEVELOPED_PACIFIC']);
  });

  it('every parent default-weight set sums to 1.0', () => {
    for (const [, group] of Object.entries(CLASS_HIERARCHY)) {
      const sum = group!.children.reduce((s, c) => s + (group!.defaultWeights[c] ?? 0), 0);
      expect(sum).toBeCloseTo(1.0, 6);
    }
  });

  it('only US_TOTAL_MARKET is flagged migrateSplit', () => {
    expect(CLASS_HIERARCHY.US_TOTAL_MARKET!.migrateSplit).toBe(true);
    expect(CLASS_HIERARCHY.FIXED_INCOME!.migrateSplit).toBeFalsy();
    expect(CLASS_HIERARCHY.DEVELOPED_INTL!.migrateSplit).toBeFalsy();
    expect(CLASS_HIERARCHY.ALTERNATIVES!.migrateSplit).toBeFalsy();
  });

  it('child→parent reverse map is correct for the new sleeves', () => {
    expect(PARENT_CLASS.MUNI_BOND).toBe('FIXED_INCOME');
    expect(PARENT_CLASS.US_TREASURY).toBe('FIXED_INCOME');
    expect(PARENT_CLASS.DEVELOPED_EUROPE).toBe('DEVELOPED_INTL');
    expect(PARENT_CLASS.REAL_ESTATE).toBeUndefined();
  });
});

// ─── rollup four-map propagation ─────────────────────────────────────────────────

describe('rollup redistributes promoted-parent holdings to children (four-map)', () => {
  it('a broad FIXED_INCOME fund (BND) splits into bond sub-classes by default weights', () => {
    const accounts: Account[] = [{ id: 'ira', name: 'IRA', institution: 'F', type: 'TRADITIONAL_IRA' }];
    const positions: Position[] = [{ accountId: 'ira', ticker: 'BND', marketValue: 100_000 }];
    const r = rollup(accounts, positions, classify);
    expect(r.currentValue.FIXED_INCOME).toBe(0);
    expect(r.currentValue.US_TREASURY).toBeCloseTo(35_000, 3);
    expect(r.currentValue.US_CORP_BOND).toBeCloseTo(25_000, 3);
    expect(r.currentValue.MUNI_BOND).toBeCloseTo(20_000, 3);
    expect(r.currentValue.TIPS).toBeCloseTo(10_000, 3);
    expect(r.currentValue.INTL_BOND).toBeCloseTo(10_000, 3);
    // Per-account map mirrors the household split.
    expect(r.currentValueByAccount.ira.US_TREASURY).toBeCloseTo(35_000, 3);
  });

  it('a broad DEVELOPED_INTL fund (VEA) splits into Europe/Pacific', () => {
    const accounts: Account[] = [{ id: 'ira', name: 'IRA', institution: 'F', type: 'TRADITIONAL_IRA' }];
    const positions: Position[] = [{ accountId: 'ira', ticker: 'VEA', marketValue: 100_000 }];
    const r = rollup(accounts, positions, classify);
    expect(r.currentValue.DEVELOPED_INTL).toBe(0);
    expect(r.currentValue.DEVELOPED_EUROPE).toBeCloseTo(62_000, 3);
    expect(r.currentValue.DEVELOPED_PACIFIC).toBeCloseTo(38_000, 3);
  });

  it('REAL_ESTATE (VNQ) is a leaf — never redistributed', () => {
    const accounts: Account[] = [{ id: 'ira', name: 'IRA', institution: 'F', type: 'TRADITIONAL_IRA' }];
    const positions: Position[] = [{ accountId: 'ira', ticker: 'VNQ', marketValue: 50_000 }];
    const r = rollup(accounts, positions, classify);
    expect(r.currentValue.REAL_ESTATE).toBe(50_000);
  });
});

// ─── consolidation: parent-held target absorbs child holdings, no spurious trades ─

describe('consolidation — sub-class holding against a parent FIXED_INCOME target', () => {
  it('holding a muni fund (MUB) against a parent FIXED_INCOME target produces no spurious trades', () => {
    const accounts: Account[] = [
      { id: 'tax', name: 'Taxable', institution: 'S', type: 'TAXABLE' },
      { id: 'ira', name: 'IRA', institution: 'F', type: 'TRADITIONAL_IRA' },
    ];
    // 80% LC / 20% FI, exactly on target. MUB (MUNI_BOND) held against the parent FI target.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 80_000 }, // US_LARGE_CAP
      { accountId: 'tax', ticker: 'MUB',   marketValue: 20_000 }, // MUNI_BOND
    ];
    const r = rebalance(accounts, positions, strat({ US_LARGE_CAP: 0.8, FIXED_INCOME: 0.2 }));
    // FI sleeve is on target via the muni holding — engine must not sell MUNI_BOND / buy FIXED_INCOME.
    const nonZero = r.trades.filter(t => Math.abs(t.deltaUsd) > 1);
    expect(nonZero).toHaveLength(0);
    expect(r.currentWeights.FIXED_INCOME).toBeCloseTo(0.2, 6);
    expect(r.currentWeights.MUNI_BOND).toBe(0);
  });
});

// ─── greenfield buy promotion ────────────────────────────────────────────────────

describe('greenfield buy promotion for promoted parents', () => {
  it('targeting FIXED_INCOME with no bond holdings yields one parent-level buy, not five', () => {
    const accounts: Account[] = [{ id: 'ira', name: 'IRA', institution: 'F', type: 'TRADITIONAL_IRA', newCash: 20_000 }];
    const positions: Position[] = [{ accountId: 'ira', ticker: 'FXAIX', marketValue: 80_000 }];
    // Want 80% LC / 20% FI. The $20k cash should buy FIXED_INCOME at the parent level.
    const r = rebalance(accounts, positions, strat({ US_LARGE_CAP: 0.8, FIXED_INCOME: 0.2 }));
    const buys = r.trades.filter(t => t.deltaUsd > 1);
    const resolved = resolveTradeVehicles(buys, positions, {}, classify);
    const fiBuys = resolved.filter(t => t.assetClass === 'FIXED_INCOME');
    const childBuys = resolved.filter(t => childrenOf('FIXED_INCOME').includes(t.assetClass));
    expect(fiBuys.length).toBe(1);
    expect(childBuys.length).toBe(0);
    expect(fiBuys[0].deltaUsd).toBeCloseTo(20_000, 0);
  });
});

// ─── resolve family coverage ─────────────────────────────────────────────────────

describe('resolve — a held sub-class fund satisfies a parent-level trade', () => {
  it('a parent FIXED_INCOME sell resolves to the held muni ticker (MUNY → MUNI_BOND)', () => {
    const positions: Position[] = [{ accountId: 'tax', ticker: 'MUNY', marketValue: 300_000 }];
    const trades = [{ accountId: 'tax', assetClass: 'FIXED_INCOME' as AssetClass, deltaUsd: -100_000, inTaxableAccount: true }];
    const resolved = resolveTradeVehicles(trades, positions, {}, classify);
    expect(resolved[0].ticker).toBe('MUNY');
    expect(resolved[0].assetClass).toBe('FIXED_INCOME');
  });
});

// ─── migration: parent targets preserved unless migrateSplit ─────────────────────

describe('schema migration — held-at-parent targets are preserved', () => {
  it('a saved parent-level FIXED_INCOME target is NOT auto-split into bond children', () => {
    const saved = { ...DEFAULT_STRATEGY, targets: targets({ US_LARGE_CAP: 0.8, FIXED_INCOME: 0.2 }) };
    const parsed = parseStrategy(saved);
    expect(parsed.targets.FIXED_INCOME).toBeCloseTo(0.2, 6);
    expect(parsed.targets.US_TREASURY).toBe(0);
    expect(parsed.targets.MUNI_BOND).toBe(0);
  });

  it('a saved parent-level DEVELOPED_INTL target is preserved', () => {
    const saved = { ...DEFAULT_STRATEGY, targets: targets({ US_LARGE_CAP: 0.6, DEVELOPED_INTL: 0.2, FIXED_INCOME: 0.2 }) };
    const parsed = parseStrategy(saved);
    expect(parsed.targets.DEVELOPED_INTL).toBeCloseTo(0.2, 6);
    expect(parsed.targets.DEVELOPED_EUROPE).toBe(0);
  });

  it('US_TOTAL_MARKET still auto-splits into cap children (migrateSplit: true)', () => {
    const saved = { ...DEFAULT_STRATEGY, targets: targets({ US_TOTAL_MARKET: 0.6, FIXED_INCOME: 0.4 }) };
    const parsed = parseStrategy(saved);
    expect(parsed.targets.US_TOTAL_MARKET).toBe(0);
    expect(parsed.targets.US_LARGE_CAP).toBeGreaterThan(0);
    expect(parsed.targets.US_LARGE_CAP + parsed.targets.US_MID_CAP + parsed.targets.US_SMALL_CAP).toBeCloseTo(0.6, 3);
  });

  it('an explicitly subdivided FIXED_INCOME save is left untouched', () => {
    const saved = { ...DEFAULT_STRATEGY, targets: targets({ US_LARGE_CAP: 0.8, MUNI_BOND: 0.1, US_TREASURY: 0.1 }) };
    const parsed = parseStrategy(saved);
    expect(parsed.targets.MUNI_BOND).toBeCloseTo(0.1, 6);
    expect(parsed.targets.US_TREASURY).toBeCloseTo(0.1, 6);
    expect(parsed.targets.FIXED_INCOME).toBe(0);
  });
});

// ─── placement: muni in taxable, other bonds sheltered ───────────────────────────

describe('placement — subdivided fixed income places by tax treatment', () => {
  it('munis land in taxable while treasuries shelter in tax-advantaged', () => {
    const accounts: Account[] = [
      { id: 'tax', name: 'Taxable', institution: 'S', type: 'TAXABLE',         newCash: 50_000 },
      { id: 'ira', name: 'IRA',     institution: 'F', type: 'TRADITIONAL_IRA',  newCash: 50_000 },
    ];
    const positions: Position[] = [];
    // Greenfield: 50% MUNI_BOND, 50% US_TREASURY. Muni → taxable, treasury → IRA.
    const r = rebalance(accounts, positions, strat({ MUNI_BOND: 0.5, US_TREASURY: 0.5 }));
    const muniInTax = r.trades.find(t => t.accountId === 'tax' && t.assetClass === 'MUNI_BOND');
    const trsInIra  = r.trades.find(t => t.accountId === 'ira' && t.assetClass === 'US_TREASURY');
    expect(muniInTax?.deltaUsd).toBeCloseTo(50_000, 0);
    expect(trsInIra?.deltaUsd).toBeCloseTo(50_000, 0);
    // No non-trivial muni buy in the IRA (the engine may emit a zero-delta entry).
    const muniInIra = r.trades.find(t => t.accountId === 'ira' && t.assetClass === 'MUNI_BOND');
    expect(Math.abs(muniInIra?.deltaUsd ?? 0)).toBeLessThan(1);
  });
});

// ─── REVISIT_PLACEMENT sums FI children ──────────────────────────────────────────

describe('REVISIT_PLACEMENT uses the summed fixed-income target', () => {
  it('does not fire when the subdivided FI target covers the taxable share', () => {
    // All wealth in a taxable account; FI target expressed at the child level summing to 1.0.
    const accounts: Account[] = [{ id: 'tax', name: 'Taxable', institution: 'S', type: 'TAXABLE' }];
    const positions: Position[] = [{ accountId: 'tax', ticker: 'MUNY', marketValue: 100_000 }];
    const r = rebalance(accounts, positions, strat({ MUNI_BOND: 0.6, US_TREASURY: 0.4 }));
    const revisit = r.flags.find(f => f.kind === 'REVISIT_PLACEMENT');
    // taxableShare (1.0) ≤ fixedIncomeTarget (0.6 + 0.4 = 1.0) → no flag.
    expect(revisit).toBeUndefined();
  });
});

// ─── robustness: partial targets must not zero out trades ─────────────────────────

describe('rebalance is robust to a partial targets object', () => {
  it('a targets object missing the new keys still rebalances (no NaN poisoning)', () => {
    const accounts: Account[] = [{ id: 'ira', name: 'IRA', institution: 'F', type: 'TRADITIONAL_IRA' }];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 60_000 },
      { accountId: 'ira', ticker: 'BND',   marketValue: 40_000 },
    ];
    // Legacy-shaped targets: only the pre-Phase-2 keys present.
    const legacyTargets = {
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0,
      CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    } as Record<AssetClass, number>;
    const strategy: Strategy = { ...DEFAULT_STRATEGY, targets: legacyTargets, toleranceAbs: 0, minTradeUsd: 0 };
    const r = rebalance(accounts, positions, strategy);
    const lc = r.trades.find(t => t.assetClass === 'US_LARGE_CAP');
    const fi = r.trades.find(t => t.assetClass === 'FIXED_INCOME');
    expect(lc?.deltaUsd).toBeCloseTo(-10_000, 0);
    expect(fi?.deltaUsd).toBeCloseTo(10_000, 0);
  });
});

// ─── standalone consolidation unit ───────────────────────────────────────────────

describe('consolidateParentClasses folds promoted-parent children', () => {
  it('folds MUNI_BOND into FIXED_INCOME when the target is at the parent level', () => {
    const t = targets({ FIXED_INCOME: 0.2, US_LARGE_CAP: 0.8 });
    const cv = { ...Object.fromEntries((Object.keys(t) as AssetClass[]).map(ac => [ac, 0])) } as Record<AssetClass, number>;
    cv.MUNI_BOND = 20_000;
    const byAcct = { a: { ...cv } };
    const locked = { a: Object.fromEntries((Object.keys(t) as AssetClass[]).map(ac => [ac, 0])) as Record<AssetClass, number> };
    const blended = { a: Object.fromEntries((Object.keys(t) as AssetClass[]).map(ac => [ac, 0])) as Record<AssetClass, number> };
    consolidateParentClasses(t, cv, byAcct, locked, blended);
    expect(cv.FIXED_INCOME).toBe(20_000);
    expect(cv.MUNI_BOND).toBe(0);
    expect(byAcct.a.FIXED_INCOME).toBe(20_000);
  });
});
