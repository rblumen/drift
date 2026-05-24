import type { Account, Position, AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';
import type { ClassifyFn } from './classify';

export interface RollupResult {
  // Only mapped positions + newCash. Unmapped positions are excluded so they
  // don't distort target sizes. The UNMAPPED_HOLDING flag alerts the user.
  householdValue: number;
  currentValue: Record<AssetClass, number>;
  currentValueByAccount: Record<string, Record<AssetClass, number>>;
  // Per-account investable value (mapped positions + newCash, excluding unmapped).
  accountValues: Record<string, number>;
  unmappedTickers: string[];
}

function zeroByClass(): Record<AssetClass, number> {
  return Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])) as Record<AssetClass, number>;
}

export function rollup(
  accounts: Account[],
  positions: Position[],
  classify: ClassifyFn,
): RollupResult {
  const currentValue = zeroByClass();
  const currentValueByAccount: Record<string, Record<AssetClass, number>> = {};
  const accountValues: Record<string, number> = {};
  const seenUnmapped = new Set<string>();
  const unmappedTickers: string[] = [];

  for (const acct of accounts) {
    currentValueByAccount[acct.id] = zeroByClass();
    accountValues[acct.id] = acct.newCash ?? 0;
  }

  for (const pos of positions) {
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
  }

  const householdValue = Object.values(accountValues).reduce((a, b) => a + b, 0);

  return { householdValue, currentValue, currentValueByAccount, accountValues, unmappedTickers };
}
