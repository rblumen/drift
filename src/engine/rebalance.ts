import type { Account, Position, Strategy, RebalanceResult, AssetClass, Flag, FundDecomposition } from './types';
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
  decompositions: Record<string, FundDecomposition> = {},
): RebalanceResult {
  const classify = makeClassifier(tickerOverrides);
  const {
    householdValue, currentValue, currentValueByAccount,
    accountValues, lockedValueByAccount, unmappedTickers,
  } = rollup(accounts, positions, classify, decompositions);

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
      currentValueByAccount,
      trades: [],
      flags,
    };
  }

  // Step 1 — Current weights (locked positions/accounts still count in weights).
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
      currentValueByAccount,
      trades: [],
      flags,
    };
  }

  // Step 3 — Target dollar values (based on full household value including locked).
  const targetValue = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, strategy.targets[ac] * householdValue]),
  ) as Record<AssetClass, number>;

  // Step 4 — Compute free (tradeable) capacity per account.
  //
  // For each account slot (acct, ac), the "frozen" amount is:
  //   - locked account:         entire currentValueByAccount[acct][ac]  (no trading at all)
  //   - within-tolerance class: entire currentValueByAccount[acct][ac]  (class is fine, don't touch)
  //   - otherwise:              only the sum of individually-locked positions in this slot
  //
  // freeCapacity[acct] = accountValues[acct] − Σ_ac frozenAmount[acct][ac]
  //
  // This guarantees Σ_ac trade_delta[acct][ac] = freeCapacity[acct] − freeCapacity[acct] = 0
  // per account (excluding new-cash deployment), so trades are balance-preserving.

  const freeCapacity: Record<string, number> = {};
  // Per-slot unlocked current: the portion of currentValueByAccount that can be traded.
  const unlockedCurrent: Record<string, Record<AssetClass, number>> = {};

  for (const acct of accounts) {
    unlockedCurrent[acct.id] = zeroByClass();

    if (acct.locked) {
      // Locked account: zero tradeable capacity; all positions frozen.
      freeCapacity[acct.id] = 0;
      // unlockedCurrent stays 0 — trades will be skipped anyway.
      continue;
    }

    let frozen = 0;
    for (const ac of ALL_ASSET_CLASSES) {
      const current = currentValueByAccount[acct.id][ac];
      if (withinTolerance.has(ac)) {
        // Entire class is frozen at current value — no trades wanted here.
        frozen += current;
        unlockedCurrent[acct.id][ac] = 0;
      } else {
        // Only individually-locked positions are frozen.
        const lockedPos = lockedValueByAccount[acct.id][ac];
        frozen += lockedPos;
        unlockedCurrent[acct.id][ac] = current - lockedPos;
      }
    }
    freeCapacity[acct.id] = Math.max(0, accountValues[acct.id] - frozen);
  }

  // Step 5 — Scale out-of-tolerance targets to exactly fill total free capacity.
  //
  // Sum of OOT target values ≠ total free capacity in general (tolerance offsets the
  // current values from their targets, and locked accounts remove capacity). Scaling
  // preserves relative proportions while ensuring the placed total equals the available
  // capacity, so net trade deltas balance to 0 per account.

  const totalFreeCapacity = Object.values(freeCapacity).reduce((a, b) => a + b, 0);
  const totalOOTTarget = ALL_ASSET_CLASSES
    .filter(ac => !withinTolerance.has(ac))
    .reduce((s, ac) => s + targetValue[ac], 0);

  const scale = totalOOTTarget > 0 ? totalFreeCapacity / totalOOTTarget : 0;
  const adjustedTarget = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [
      ac,
      withinTolerance.has(ac) ? 0 : targetValue[ac] * scale,
    ]),
  ) as Record<AssetClass, number>;

  // Step 6 — Derive per-account effective allowed classes.
  //           Priority: allowedAssetClasses (explicit) > availableTickers (derived) > unrestricted.
  //           Only for non-locked accounts (locked accounts don't participate).
  const nonLockedAccounts = accounts.filter(a => !a.locked);
  const effectiveAllowed: Record<string, Set<AssetClass>> = {};
  for (const acct of nonLockedAccounts) {
    if (acct.allowedAssetClasses !== undefined) {
      effectiveAllowed[acct.id] = new Set(acct.allowedAssetClasses);
    } else if (acct.availableTickers === undefined) {
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

  // Step 7 — Placement-aware location (runs only on non-locked accounts & OOT classes).
  const { targetLocation, placementFlags } = greedyPlace(
    nonLockedAccounts,
    freeCapacity,
    adjustedTarget,
    effectiveAllowed,
    strategy,
  );
  flags.push(...placementFlags);

  // Step 8 — Compute trades.
  //   delta = targetLocation[acct][ac] − unlockedCurrent[acct][ac]
  //   Because Σ_ac targetLocation[acct][ac] = freeCapacity[acct]
  //                                         = Σ_{OOT ac} unlockedCurrent[acct][ac] + newCash
  //   the net delta per account equals newCash (buys exceed sells by exactly the new-cash
  //   amount, which is the correct behaviour for deployment).

  const trades = [];
  for (const acct of nonLockedAccounts) {
    const inTaxable = accountBucket(acct.type) === 'TAXABLE';
    for (const ac of ALL_ASSET_CLASSES) {
      if (withinTolerance.has(ac)) continue;
      const current = unlockedCurrent[acct.id][ac];
      const target  = targetLocation[acct.id]?.[ac] ?? 0;
      const delta   = target - current;
      if (Math.abs(delta) < strategy.minTradeUsd) continue;
      trades.push({ accountId: acct.id, assetClass: ac, deltaUsd: delta, inTaxableAccount: inTaxable });
      if (delta < 0 && inTaxable) {
        flags.push({ kind: 'TAXABLE_SALE', accountId: acct.id, assetClass: ac, amountUsd: Math.abs(delta) });
      }
    }
  }

  // Step 9 — REVISIT_PLACEMENT check (uses all accounts, including locked).
  const taxableValue = accounts
    .filter(a => accountBucket(a.type) === 'TAXABLE')
    .reduce((sum, a) => sum + (accountValues[a.id] ?? 0), 0);
  const taxableShare = taxableValue / householdValue;
  if (taxableShare > strategy.targets.FIXED_INCOME) {
    flags.push({ kind: 'REVISIT_PLACEMENT', taxableShare, fixedIncomeTarget: strategy.targets.FIXED_INCOME });
  }

  // Step 10 — Projected weights after trades (applied to full current value).
  const projectedValue = { ...currentValue };
  for (const trade of trades) {
    projectedValue[trade.assetClass] += trade.deltaUsd;
  }
  const projectedWeights = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, projectedValue[ac] / householdValue]),
  ) as Record<AssetClass, number>;

  return {
    householdValue, currentWeights, targetWeights: strategy.targets,
    projectedWeights, currentValueByAccount, trades, flags,
  };
}
