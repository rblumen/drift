import type { Account, Position, Strategy, RebalanceResult, AssetClass, Flag } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { makeClassifier } from './classify';
import { rollup } from './rollup';
import { accountBucket, greedyPlace } from './placement';

function zeroByClass(): Record<AssetClass, number> {
  return Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])) as Record<AssetClass, number>;
}

export function rebalance(
  accounts: Account[],
  positions: Position[],
  strategy: Strategy,
  tickerOverrides: Record<string, AssetClass> = {},
): RebalanceResult {
  const classify = makeClassifier(tickerOverrides);
  const { householdValue, currentValue, currentValueByAccount, accountValues, unmappedTickers } =
    rollup(accounts, positions, classify);

  const flags: Flag[] = [];

  for (const ticker of unmappedTickers) {
    flags.push({ kind: 'UNMAPPED_HOLDING', ticker });
  }

  if (householdValue === 0) {
    const zeros = zeroByClass();
    return {
      householdValue: 0,
      currentWeights: zeros,
      targetWeights: strategy.targets,
      projectedWeights: zeros,
      trades: [],
      flags,
    };
  }

  // Step 1 — Current weights.
  const currentWeights = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, currentValue[ac] / householdValue]),
  ) as Record<AssetClass, number>;

  // Step 2 — Tolerance check.
  const withinTolerance = new Set<AssetClass>();
  for (const ac of ALL_ASSET_CLASSES) {
    if (Math.abs(currentWeights[ac] - strategy.targets[ac]) <= strategy.toleranceAbs) {
      withinTolerance.add(ac);
      flags.push({ kind: 'WITHIN_TOLERANCE', assetClass: ac });
    }
  }

  if (withinTolerance.size === ALL_ASSET_CLASSES.length) {
    return {
      householdValue,
      currentWeights,
      targetWeights: strategy.targets,
      projectedWeights: currentWeights,
      trades: [],
      flags,
    };
  }

  // Step 3 — Target dollar values.
  const targetValue = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, strategy.targets[ac] * householdValue]),
  ) as Record<AssetClass, number>;

  // Step 4 — Derive per-account effective allowed classes from availableTickers.
  const effectiveAllowed: Record<string, Set<AssetClass>> = {};
  for (const acct of accounts) {
    if (acct.availableTickers === undefined) {
      effectiveAllowed[acct.id] = new Set(ALL_ASSET_CLASSES);
    } else {
      const allowed = new Set<AssetClass>();
      for (const ticker of acct.availableTickers) {
        const ac = classify(ticker);
        if (ac !== null) allowed.add(ac);
      }
      effectiveAllowed[acct.id] = allowed;
    }
  }

  // Step 5 — Placement-aware location.
  const { targetLocation, placementFlags } = greedyPlace(
    accounts,
    accountValues,
    targetValue,
    effectiveAllowed,
    strategy,
  );
  flags.push(...placementFlags);

  // Step 6 — Compute trades.
  const trades = [];
  for (const acct of accounts) {
    const inTaxable = accountBucket(acct.type) === 'TAXABLE';
    for (const ac of ALL_ASSET_CLASSES) {
      if (withinTolerance.has(ac)) continue;
      const current = currentValueByAccount[acct.id][ac];
      const target = targetLocation[acct.id]?.[ac] ?? 0;
      const delta = target - current;
      if (Math.abs(delta) < strategy.minTradeUsd) continue;
      trades.push({ accountId: acct.id, assetClass: ac, deltaUsd: delta, inTaxableAccount: inTaxable });
      if (delta < 0 && inTaxable) {
        flags.push({ kind: 'TAXABLE_SALE', accountId: acct.id, assetClass: ac, amountUsd: Math.abs(delta) });
      }
    }
  }

  // Step 7 — REVISIT_PLACEMENT check.
  const taxableValue = accounts
    .filter(a => accountBucket(a.type) === 'TAXABLE')
    .reduce((sum, a) => sum + (accountValues[a.id] ?? 0), 0);
  const taxableShare = taxableValue / householdValue;
  if (taxableShare > strategy.targets.FIXED_INCOME) {
    flags.push({ kind: 'REVISIT_PLACEMENT', taxableShare, fixedIncomeTarget: strategy.targets.FIXED_INCOME });
  }

  // Step 8 — Projected weights after trades.
  const projectedValue = { ...currentValue };
  for (const trade of trades) {
    projectedValue[trade.assetClass] += trade.deltaUsd;
  }
  const projectedWeights = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, projectedValue[ac] / householdValue]),
  ) as Record<AssetClass, number>;

  return { householdValue, currentWeights, targetWeights: strategy.targets, projectedWeights, trades, flags };
}
