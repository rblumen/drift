import type { Account, Position, AssetClass, FundDecomposition } from './types';
import { ALL_ASSET_CLASSES } from './types';
import type { ClassifyFn } from './classify';
import { zeroByClass } from './utils';

/**
 * Russell index cap-class weights used to redistribute US_TOTAL_MARKET holdings.
 *   US_LARGE_CAP  0.67  (Russell 1000 ex-Midcap, ~mega/large blend)
 *   US_MID_CAP    0.25  (Russell Midcap = bottom 800 of Russell 1000)
 *   US_SMALL_CAP  0.08  (Russell 2000)
 * Source: Russell US Index construction methodology.
 */
export const RUSSELL_CAP_SPLIT = {
  US_LARGE_CAP: 0.67,
  US_MID_CAP:   0.25,
  US_SMALL_CAP: 0.08,
} as const;

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
  const accountValues: Record<string, number> = {};
  const seenUnmapped = new Set<string>();
  const unmappedTickers: string[] = [];

  for (const acct of accounts) {
    currentValueByAccount[acct.id] = zeroByClass();
    lockedValueByAccount[acct.id]  = zeroByClass();
    accountValues[acct.id] = acct.newCash ?? 0;
  }

  for (const pos of positions) {
    // Check for decomposition first (target date funds, etc.).
    const decomp = decompositions[pos.ticker.toUpperCase()];
    if (decomp) {
      // Split value across asset classes; always treat as frozen.
      accountValues[pos.accountId] = (accountValues[pos.accountId] ?? 0) + pos.marketValue;
      for (const [ac, weight] of Object.entries(decomp) as [AssetClass, number][]) {
        const portion = pos.marketValue * weight;
        currentValue[ac] += portion;
        currentValueByAccount[pos.accountId][ac] += portion;
        lockedValueByAccount[pos.accountId][ac] += portion; // always frozen — can't trade sub-components
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

  // Post-process: redistribute any US_TOTAL_MARKET value into cap sub-classes.
  // This handles all sources uniformly: direct classifications, TDF decompositions
  // that emit US_TOTAL_MARKET, and user custom decompositions.
  const utmTotal = currentValue.US_TOTAL_MARKET;
  if (utmTotal > 0) {
    for (const [subClass, weight] of Object.entries(RUSSELL_CAP_SPLIT) as [AssetClass, number][]) {
      currentValue[subClass] += utmTotal * weight;
    }
    currentValue.US_TOTAL_MARKET = 0;

    for (const acctId of Object.keys(currentValueByAccount)) {
      const utmAcct = currentValueByAccount[acctId].US_TOTAL_MARKET;
      if (utmAcct > 0) {
        for (const [subClass, weight] of Object.entries(RUSSELL_CAP_SPLIT) as [AssetClass, number][]) {
          currentValueByAccount[acctId][subClass] += utmAcct * weight;
        }
        currentValueByAccount[acctId].US_TOTAL_MARKET = 0;
      }

      const utmLocked = lockedValueByAccount[acctId].US_TOTAL_MARKET;
      if (utmLocked > 0) {
        for (const [subClass, weight] of Object.entries(RUSSELL_CAP_SPLIT) as [AssetClass, number][]) {
          lockedValueByAccount[acctId][subClass] += utmLocked * weight;
        }
        lockedValueByAccount[acctId].US_TOTAL_MARKET = 0;
      }
    }
  }

  const householdValue = Object.values(accountValues).reduce((a, b) => a + b, 0);

  return {
    householdValue, currentValue, currentValueByAccount,
    accountValues, lockedValueByAccount, unmappedTickers,
  };
}
