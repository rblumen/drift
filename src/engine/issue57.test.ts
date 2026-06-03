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
import type { Account, Position, Strategy } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { rebalance } from './rebalance';
import { DEFAULT_STRATEGY } from './strategy';
import samplePortfolio from '../data/sample-portfolio.json';

describe('issue #57 — no spurious PROJECTED_OFF_TARGET', () => {
  it('does not flag the sole OOT class when its offsets are frozen by 5/25', () => {
    // LC 54% (target 50%, drift 4% > 3% tol → OOT). FI 28% and ALT 18% each drift
    // 2% < 3% tol → within tolerance, frozen. The only way to trim LC is to buy
    // FI/ALT, but they're untouchable, so LC correctly stays at 54%. No locked
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

    // The frozen classes mean no trades and LC stuck at 54% — expected, not an error.
    expect(r.trades).toHaveLength(0);
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
    const sp = samplePortfolio as {
      accounts: Account[];
      positions: Position[];
      strategy: Strategy;
      tickerOverrides?: Record<string, string>;
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
});
