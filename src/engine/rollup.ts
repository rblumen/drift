import type { Account, Position, AssetClass, FundDecomposition } from './types';
import type { ClassifyFn } from './classify';
import { CLASS_HIERARCHY } from './hierarchy';
import { zeroByClass } from './utils';

export interface RollupResult {
  // Only mapped positions + newCash. Unmapped positions are excluded so they
  // don't distort target sizes. The UNMAPPED_HOLDING flag alerts the user.
  householdValue: number;
  currentValue: Record<AssetClass, number>;
  currentValueByAccount: Record<string, Record<AssetClass, number>>;
  // Per-account investable value (mapped positions + newCash, excluding unmapped).
  accountValues: Record<string, number>;
  // Market value of individually-locked positions, keyed by account then class.
  // Does NOT include account-level locking (handled in rebalance).
  lockedValueByAccount: Record<string, Record<AssetClass, number>>;
  // Per-(account, class) value contributed by non-locked blended funds (issue #40).
  // Blended-fund value lives in BOTH this map AND lockedValueByAccount so callers
  // that don't know about #40 still see immovability. rebalance.ts subtracts this
  // back out of lockedValueByAccount before computing free capacity, treating
  // blended-fund value as tradeable, and Step 8.7 synthesizes the proportional
  // sells with composition-preserving compensation.
  blendedValueByAccount: Record<string, Record<AssetClass, number>>;
  unmappedTickers: string[];
}

export function rollup(
  accounts: Account[],
  positions: Position[],
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition> = {},
): RollupResult {
  const currentValue = zeroByClass();
  const currentValueByAccount: Record<string, Record<AssetClass, number>> = {};
  const lockedValueByAccount: Record<string, Record<AssetClass, number>> = {};
  const blendedValueByAccount: Record<string, Record<AssetClass, number>> = {};
  const accountValues: Record<string, number> = {};
  const seenUnmapped = new Set<string>();
  const unmappedTickers: string[] = [];

  for (const acct of accounts) {
    currentValueByAccount[acct.id] = zeroByClass();
    lockedValueByAccount[acct.id]  = zeroByClass();
    blendedValueByAccount[acct.id] = zeroByClass();
    accountValues[acct.id] = acct.newCash ?? 0;
  }

  for (const pos of positions) {
    // Check for decomposition first (blended funds: TDFs, balanced funds, etc.).
    const decomp = decompositions[pos.ticker.toUpperCase()];
    if (decomp) {
      // Split value across asset classes. The position is added to both
      // lockedValueByAccount and blendedValueByAccount (issue #40): rebalance.ts
      // lifts the lock by subtracting blendedValueByAccount, exposing the fund
      // to Step 8.7's composition-preserving sell synthesis. pos.locked = true
      // suppresses the blendedValueByAccount entry, restoring hard immovability.
      accountValues[pos.accountId] = (accountValues[pos.accountId] ?? 0) + pos.marketValue;
      for (const [ac, weight] of Object.entries(decomp) as [AssetClass, number][]) {
        const portion = pos.marketValue * weight;
        currentValue[ac] += portion;
        currentValueByAccount[pos.accountId][ac] += portion;
        lockedValueByAccount[pos.accountId][ac] += portion;
        if (!pos.locked) blendedValueByAccount[pos.accountId][ac] += portion;
      }
      continue; // skip the classify path
    }

    const ac = classify(pos.ticker);
    if (ac === null) {
      if (!seenUnmapped.has(pos.ticker)) {
        unmappedTickers.push(pos.ticker);
        seenUnmapped.add(pos.ticker);
      }
      // Excluded from capacity — user must resolve before running a rebalance.
      continue;
    }
    currentValue[ac] += pos.marketValue;
    currentValueByAccount[pos.accountId][ac] += pos.marketValue;
    accountValues[pos.accountId] = (accountValues[pos.accountId] ?? 0) + pos.marketValue;

    // Track locked position value separately (account-level locking is handled in rebalance).
    if (pos.locked) {
      lockedValueByAccount[pos.accountId][ac] += pos.marketValue;
    }
  }

  // Post-process: redistribute parent-class value into child classes for every
  // relationship defined in CLASS_HIERARCHY. Applies uniformly to all sources
  // (direct classifications, blended-fund decompositions, user decompositions).
  //
  // All four tracking maps must be updated together — see the four-map propagation
  // invariant in docs/plan-36-asset-class-hierarchy.md.
  for (const [parent, group] of Object.entries(CLASS_HIERARCHY)) {
    const ac = parent as AssetClass;
    const { children, defaultWeights } = group!;

    const total = currentValue[ac];
    if (total > 0) {
      for (const child of children) currentValue[child] += total * (defaultWeights[child] ?? 0);
      currentValue[ac] = 0;
    }

    for (const acctId of Object.keys(currentValueByAccount)) {
      const cv = currentValueByAccount[acctId][ac];
      if (cv > 0) {
        for (const child of children) currentValueByAccount[acctId][child] += cv * (defaultWeights[child] ?? 0);
        currentValueByAccount[acctId][ac] = 0;
      }

      const lv = lockedValueByAccount[acctId][ac];
      if (lv > 0) {
        for (const child of children) lockedValueByAccount[acctId][child] += lv * (defaultWeights[child] ?? 0);
        lockedValueByAccount[acctId][ac] = 0;
      }

      const bv = blendedValueByAccount[acctId][ac];
      if (bv > 0) {
        for (const child of children) blendedValueByAccount[acctId][child] += bv * (defaultWeights[child] ?? 0);
        blendedValueByAccount[acctId][ac] = 0;
      }
    }
  }

  const householdValue = Object.values(accountValues).reduce((a, b) => a + b, 0);

  return {
    householdValue, currentValue, currentValueByAccount,
    accountValues, lockedValueByAccount, blendedValueByAccount, unmappedTickers,
  };
}
