/**
 * Regression test for issue #57 — spurious "target not reachable" banner.
 *
 * Root cause: Step 11 compared each out-of-tolerance class's projected weight
 * against its *nominal* target. When within-tolerance classes are frozen
 * (Principle 5), the engine can only distribute free capacity across OOT classes
 * in proportion to their targets, so a fully-placeable class settles at
 * target × scale — not the nominal target. A sole OOT class whose offsetting
 * classes are all within tolerance therefore cannot be rebalanced (correct 5/25
 * behavior), yet the old check flagged it PROJECTED_OFF_TARGET and the UI showed
 * a misleading "a locked position likely exceeds the target" banner with no lock
 * present. The fix compares against the reachable target (target × scale).
 */
import { describe, it, expect } from 'vitest';
import type { Account, AssetClass, Position, Strategy } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { rebalance } from './rebalance';
import { DEFAULT_STRATEGY } from './strategy';
import samplePortfolio from '../data/sample-portfolio.json';

describe('Goal 5: PROJECTED_OFF_TARGET suppresses dust / un-actionable drift (issue #57)', () => {
  it('trims the sole OOT class into its in-band offsets without flagging', () => {
    // LC 54% (target 50%, drift 4% > 3% tol → OOT). FI 28% and ALT 18% each drift
    // 2% < 3% tol → within tolerance. Before #252 they were untouchable and LC stayed
    // stuck at 54%; now in-band underweight classes take buy-only top-ups, so LC is
    // trimmed to target and the proceeds split between FI and ALT. No locked
    // positions, no account restrictions, no min-trade suppression → nothing to flag.
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 54_000 }, // US_LARGE_CAP
      { accountId: 'ira', ticker: 'MUNY', marketValue: 28_000 },  // FIXED_INCOME
      { accountId: 'ira', ticker: 'GLD', marketValue: 18_000 },   // PRECIOUS_METALS → ALTERNATIVES
    ];
    const strategy: Strategy = {
      ...DEFAULT_STRATEGY,
      targets: {
        ...DEFAULT_STRATEGY.targets,
        US_LARGE_CAP: 0.50, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.30, ALTERNATIVES: 0.20,
      },
      toleranceAbs: 0.03,
    };

    const r = rebalance(accts, positions, strategy);

    // LC trimmed to target; in-band classes are only ever bought, never sold.
    expect(r.projectedWeights.US_LARGE_CAP).toBeCloseTo(0.50, 3);
    const byClass = Object.fromEntries(r.trades.map(t => [t.assetClass, t.deltaUsd]));
    expect(byClass.US_LARGE_CAP).toBeCloseTo(-4_000, 0);
    expect(byClass.FIXED_INCOME).toBeCloseTo(2_000, 0);
    expect(byClass.ALTERNATIVES).toBeCloseTo(2_000, 0);
    expect(r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')).toHaveLength(0);
  });

  // Second face of #57: a zero-target class (e.g. CASH) makes the relative band
  // collapse to 0.25 × 0 = 0, so the engine sweeps it toward zero but any residual
  // it can't trade away spuriously trips PROJECTED_OFF_TARGET. The flag must ignore
  // deviations smaller than the user's own minTradeUsd "ignore trades below"
  // threshold — a residual that small isn't actionable, so it's not a constraint.
  const cashStrategy = (overrides: Partial<Strategy>): Strategy => ({
    ...DEFAULT_STRATEGY,
    targets: {
      ...DEFAULT_STRATEGY.targets,
      US_LARGE_CAP: 0.60, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.40, ALTERNATIVES: 0, CASH: 0,
    },
    toleranceAbs: 0.05,
    ...overrides,
  });

  it('does not flag a sub-minTradeUsd cash residual that cannot be swept (0% target)', () => {
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 60_000 },
      { accountId: 'ira', ticker: 'MUNY', marketValue: 39_950 },
      { accountId: 'ira', ticker: 'VMFXX', marketValue: 50 }, // $50 cash < minTradeUsd, unsweepable
    ];
    const r = rebalance(accts, positions, cashStrategy({ minTradeUsd: 100 }));
    expect(r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')).toHaveLength(0);
  });

  it('does not flag a locked cash sliver below minTradeUsd (0% target)', () => {
    // $80 of locked cash on a $100k household = $80 deviation < $100 minTradeUsd.
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 60_000 },
      { accountId: 'ira', ticker: 'MUNY', marketValue: 39_920 },
      { accountId: 'ira', ticker: 'VMFXX', marketValue: 80, locked: true },
    ];
    const r = rebalance(accts, positions, cashStrategy({ minTradeUsd: 100 }));
    expect(r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')).toHaveLength(0);
  });

  it('still flags a locked cash position above minTradeUsd (0% target)', () => {
    // The minTradeUsd floor must not silence a genuinely material stuck deviation:
    // $1,000 of locked cash (≥ minTradeUsd) at a 0% target is a real "can't reach
    // target" constraint and should surface, like a locked equity above target.
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 60_000 },
      { accountId: 'ira', ticker: 'MUNY', marketValue: 39_000 },
      { accountId: 'ira', ticker: 'VMFXX', marketValue: 1_000, locked: true },
    ];
    const r = rebalance(accts, positions, cashStrategy({ minTradeUsd: 100 }));
    expect(
      r.flags.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'CASH'),
    ).toBe(true);
  });

  it('still sweeps tradeable cash to zero (fix suppresses only the dust flag)', () => {
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 55_000 },
      { accountId: 'ira', ticker: 'MUNY', marketValue: 40_000 },
      { accountId: 'ira', ticker: 'VMFXX', marketValue: 5_000 }, // 5% cash, tradeable
    ];
    const r = rebalance(accts, positions, cashStrategy({ toleranceAbs: 0.02, minTradeUsd: 100 }));
    expect(r.projectedWeights.CASH).toBeCloseTo(0, 6);
    expect(r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')).toHaveLength(0);
  });

  it('emits zero PROJECTED_OFF_TARGET flags for the sample portfolio', () => {
    // Exercise the same path the UI takes: fill any target keys the fixture omits
    // with 0, matching schema normalization (z ... .default(0)). Without this the
    // engine sees `undefined` targets and NaN comparisons mask the real behavior.
    // The imported JSON's inferred literal type doesn't overlap the domain
    // types (string vs union enums), so route the cast through unknown. The
    // fixture is schema-valid — App.tsx parses this exact file on ?demo.
    const sp = samplePortfolio as unknown as {
      accounts: Account[];
      positions: Position[];
      strategy: Strategy;
      tickerOverrides?: Record<string, AssetClass>;
      decompositions?: Record<string, Record<string, number>>;
      freeCash?: number;
    };
    const targets = {
      ...Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])),
      ...sp.strategy.targets,
    } as Strategy['targets'];
    const strategy: Strategy = { ...sp.strategy, targets };

    const result = rebalance(
      sp.accounts,
      sp.positions,
      strategy,
      sp.tickerOverrides ?? {},
      sp.decompositions ?? {},
      sp.freeCash ?? 0,
    );

    const potFlags = result.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET');

    if (potFlags.length > 0) {
      for (const f of potFlags) {
        if (f.kind === 'PROJECTED_OFF_TARGET') {
          console.error(
            `PROJECTED_OFF_TARGET: ${f.assetClass} projected=${(f.projectedWeight * 100).toFixed(3)}% target=${(f.targetWeight * 100).toFixed(3)}%`,
          );
        }
      }
    }

    expect(potFlags, 'No PROJECTED_OFF_TARGET flags should fire for the sample portfolio').toHaveLength(0);
  });

  // Issue #117: Step 11's reachable target must be the immovable-adjusted, scaled
  // resting point Step 5 sizes toward — immovable + (target − immovable) × scale —
  // NOT target × scale. When a class carries immovable (locked) value `i` and the
  // frozen-class scale ≠ 1, the two differ by exactly i × (1 − scale); the old
  // formula spuriously raised or masked the flag for portfolios that mix locked
  // positions with within-tolerance (frozen) classes.
  //
  // Household $100k, scale = 0.4:
  //   • FIXED_INCOME $50k, target 50% → within tolerance, frozen (this forces scale ≠ 1).
  //   • US_LARGE_CAP: target 40% ($40k), immovable $15k locked in the IRA (< target,
  //     un-clamped). Reachable = 15k + (40k − 15k)×0.4 = $25k = 25% = its projected
  //     weight → NOT off target. Old target × scale = 40%×0.4 = 16%, off by 9% > the
  //     5% band → the pre-#117 engine flagged it spuriously.
  //   • DEVELOPED_INTL: target 10% ($10k), immovable $25k locked in the IRA (> target).
  //     Reachable = 25k + (10k − 25k)×0.4 = $19k = 19%; projected 25% is 6% > band, a
  //     genuine "locked above target" miss that MUST still flag. The un-floored trade
  //     term is what preserves this — flooring at 0 (as Step 5 does for buys) would
  //     make reachable = immovable = 25% and wrongly silence it.
  it('#117: measures reachable target as immovable + (target − immovable) × scale', () => {
    const accts: Account[] = [
      { id: 'brokerage', name: 'Taxable', institution: 'Schwab', type: 'TAXABLE' },
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'VOO', marketValue: 15_000 },   // US_LARGE_CAP, immovable < target
      { accountId: 'ira', ticker: 'FZILX', marketValue: 25_000 }, // DEVELOPED_INTL, immovable > target
      { accountId: 'brokerage', ticker: 'BND', marketValue: 50_000 },  // FIXED_INCOME, frozen
      { accountId: 'brokerage', ticker: 'VOO', marketValue: 5_000 },   // tradeable US_LARGE_CAP
      { accountId: 'brokerage', ticker: 'FZILX', marketValue: 5_000 }, // tradeable DEVELOPED_INTL
    ];
    const strategy: Strategy = {
      ...DEFAULT_STRATEGY,
      targets: {
        ...Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])),
        US_LARGE_CAP: 0.40, DEVELOPED_INTL: 0.10, FIXED_INCOME: 0.50,
      } as Strategy['targets'],
      toleranceAbs: 0.05,
      toleranceRel: 0.25,
      minTradeUsd: 250,
    };

    const r = rebalance(accts, positions, strategy);

    // Sanity: scale ≠ 1 setup — FIXED_INCOME frozen, IRA untouched, weights as designed.
    expect(r.flags.some(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'FIXED_INCOME')).toBe(true);
    expect(r.trades.filter(t => t.accountId === 'ira' && Math.abs(t.deltaUsd) > 0.01)).toHaveLength(0);
    expect(r.projectedWeights.US_LARGE_CAP).toBeCloseTo(0.25, 6);
    expect(r.projectedWeights.DEVELOPED_INTL).toBeCloseTo(0.25, 6);

    const pot = r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET');
    // Underweight class locked below target settles at its reachable point → no flag.
    expect(pot.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'US_LARGE_CAP')).toBe(false);
    // Overweight class locked above target is genuinely stuck → still flags.
    expect(pot.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'DEVELOPED_INTL')).toBe(true);
  });
});
