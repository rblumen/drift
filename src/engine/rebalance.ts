import type { Account, Position, Strategy, RebalanceResult, AssetClass, Flag, FundDecomposition } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { makeClassifier } from './classify';
import { rollup } from './rollup';
import { accountBucket, greedyPlace } from './placement';
import { EPSILON, zeroByClass } from './utils';

/**
 * Step 7.7 — Tax-aware sell shaping.
 *
 * After greedyPlace and the gap-fill (steps 7–7.5), scan for taxable sells on
 * TAX_ADVANTAGED-preferred asset classes and redirect them to TA accounts where
 * possible by performing a 4-way swap of Δ dollars:
 *
 *   targetLocation[T][ac] += Δ   T sells Δ less of ac  (keeps the position)
 *   targetLocation[A][ac] -= Δ   A's ac target shrinks  (A "absorbs" the sell)
 *   targetLocation[T][Y]  -= Δ   T buys Δ less of Y    (the per-account offset)
 *   targetLocation[A][Y]  += Δ   A buys Δ more of Y    (restores A's balance)
 *
 * Invariants preserved:
 *   • Σ_ac targetLocation[acct][ac] = freeCapacity[acct]   (per-account net-zero)
 *   • Σ_acct targetLocation[acct][ac]                       (household class totals)
 *
 * Constraints:
 *   • Δ ≤ targetLocation[A][ac]  → A's target never goes negative
 *   • Δ ≤ tBuyY                  → T's buy of Y only shrinks, never flips to a sell
 *   • ac prefers TAX_ADVANTAGED  → don't redirect FIXED_INCOME / CASH sells
 *   • A must be eligible for both ac and Y
 */
function redirectTaxableSells(
  accounts: Account[],
  unlockedCurrent: Record<string, Record<AssetClass, number>>,
  targetLocation: Record<string, Record<AssetClass, number>>,
  effectiveAllowed: Record<string, Set<AssetClass>>,
  strategy: Strategy,
): void {
  const taxableAccounts = accounts.filter(a => accountBucket(a.type) === 'TAXABLE');
  const taAccounts      = accounts.filter(a => accountBucket(a.type) === 'TAX_ADVANTAGED');

  for (const T of taxableAccounts) {
    for (const ac of ALL_ASSET_CLASSES) {
      // Only redirect sells of classes whose primary home is TAX_ADVANTAGED.
      const prefBucket = (strategy.placement[ac] ?? ['TAX_ADVANTAGED', 'TAXABLE'])[0];
      if (prefBucket !== 'TAX_ADVANTAGED') continue;

      let toRedirect = unlockedCurrent[T.id][ac] - targetLocation[T.id][ac];
      if (toRedirect <= EPSILON) continue; // T is not selling this class

      for (const A of taAccounts) {
        if (toRedirect <= EPSILON) break;
        if (!effectiveAllowed[A.id].has(ac)) continue;
        // Quick pre-check: A must have some ac target to give up.
        if (targetLocation[A.id][ac] <= EPSILON) continue;

        // Iterate compensating classes Y: T has a net buy of Y and A can hold Y.
        for (const Y of ALL_ASSET_CLASSES) {
          if (toRedirect <= EPSILON) break;
          if (Y === ac) continue;

          // Re-read live value — earlier Y iterations may have reduced it.
          const aAbsorbNow = targetLocation[A.id][ac];
          if (aAbsorbNow <= EPSILON) break; // A is exhausted for this ac

          const tBuyY = targetLocation[T.id][Y] - unlockedCurrent[T.id][Y];
          if (tBuyY <= EPSILON) continue; // T has no net buy of Y to use as offset
          if (!effectiveAllowed[A.id].has(Y)) continue;

          const redirect = Math.min(toRedirect, aAbsorbNow, tBuyY);
          if (redirect <= EPSILON) continue;

          targetLocation[T.id][ac] += redirect;
          targetLocation[A.id][ac] -= redirect;
          targetLocation[T.id][Y]  -= redirect;
          targetLocation[A.id][Y]  += redirect;

          toRedirect -= redirect;
        }
      }
    }
  }
}

export function rebalance(
  accounts: Account[],
  positions: Position[],
  strategy: Strategy,
  tickerOverrides: Record<string, AssetClass> = {},
  decompositions: Record<string, FundDecomposition> = {},
  freeCash: number = 0,
): RebalanceResult {
  const classify = makeClassifier(tickerOverrides);

  const flags: Flag[] = [];

  // Step 0 — Distribute household free cash to deposit-eligible accounts.
  // Proportional to each account's current position value (pre-rollup sum).
  // Locked accounts and accounts with acceptsDeposits === false are excluded.
  if (freeCash > 0) {
    const baseValue: Record<string, number> = {};
    for (const acct of accounts) baseValue[acct.id] = acct.newCash ?? 0;
    for (const pos of positions) baseValue[pos.accountId] = (baseValue[pos.accountId] ?? 0) + pos.marketValue;

    const eligible = accounts.filter(a => !a.locked && a.acceptsDeposits !== false);
    const eligibleTotal = eligible.reduce((s, a) => s + (baseValue[a.id] ?? 0), 0);

    if (eligible.length === 0) {
      flags.push({ kind: 'EXCESS_CASH', amountUsd: freeCash });
    } else {
      const perAccount: Record<string, number> = {};
      for (const a of eligible) {
        perAccount[a.id] = eligibleTotal > 0
          ? freeCash * ((baseValue[a.id] ?? 0) / eligibleTotal)
          : freeCash / eligible.length;
      }
      accounts = accounts.map(a =>
        perAccount[a.id] !== undefined
          ? { ...a, newCash: (a.newCash ?? 0) + perAccount[a.id] }
          : a,
      );
    }
  }

  const {
    householdValue, currentValue, currentValueByAccount,
    accountValues, lockedValueByAccount, unmappedTickers,
  } = rollup(accounts, positions, classify, decompositions);

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

  // Step 7.5 — Per-account net-zero enforcement.
  //
  // greedyPlace guarantees Σ_ac targetLocation[acct][ac] ≤ freeCapacity[acct], but when
  // NO_ELIGIBLE_ACCOUNT fires the unplaced dollars are never assigned to any account,
  // leaving some accounts with a gap (placed total < freeCapacity). Without correction
  // those accounts produce net-negative trades — selling assets with no intra-account buy
  // to absorb the proceeds, implying cash that must leave the account. For tax-advantaged
  // accounts (Roth, 401k) that cash can't simply be redeployed elsewhere.
  //
  // Fix: distribute the gap back proportionally to the account's own OOT unlocked
  // holdings. This tells step 8 "sell less of what you already own" rather than
  // generating an unmatched sell that would require an external cash transfer.
  for (const acct of nonLockedAccounts) {
    const placed = ALL_ASSET_CLASSES.reduce(
      (s, ac) => s + (targetLocation[acct.id][ac] ?? 0), 0,
    );
    const gap = freeCapacity[acct.id] - placed;
    if (gap < EPSILON) continue;

    const totalOOT = ALL_ASSET_CLASSES.reduce(
      (s, ac) => s + unlockedCurrent[acct.id][ac], 0,
    );
    if (totalOOT < EPSILON) continue;

    for (const ac of ALL_ASSET_CLASSES) {
      targetLocation[acct.id][ac] += gap * (unlockedCurrent[acct.id][ac] / totalOOT);
    }
  }

  // Step 7.7 — Redirect taxable equity sells to tax-advantaged accounts.
  redirectTaxableSells(
    nonLockedAccounts, unlockedCurrent, targetLocation, effectiveAllowed, strategy,
  );

  // Step 8 — Compute raw trades (before minTradeUsd filtering is balanced out).
  //   delta = targetLocation[acct][ac] − unlockedCurrent[acct][ac]
  //   After step 7.5, Σ_ac targetLocation[acct][ac] = freeCapacity[acct]
  //                                                  = Σ_{OOT ac} unlockedCurrent[acct][ac] + newCash
  //   so the pre-filter net delta per account equals newCash.
  //
  //   However, minTradeUsd filtering can drop small trades on one side of the ledger
  //   without dropping the matching trade on the other side, re-introducing a net imbalance.
  //   Step 8.5 corrects this after filtering.

  const rawTrades = [];
  for (const acct of nonLockedAccounts) {
    const inTaxable = accountBucket(acct.type) === 'TAXABLE';
    for (const ac of ALL_ASSET_CLASSES) {
      if (withinTolerance.has(ac)) continue;
      const current = unlockedCurrent[acct.id][ac];
      const target  = targetLocation[acct.id]?.[ac] ?? 0;
      const delta   = target - current;
      if (Math.abs(delta) < strategy.minTradeUsd) continue;
      rawTrades.push({ accountId: acct.id, assetClass: ac, deltaUsd: delta, inTaxableAccount: inTaxable });
    }
  }

  // Step 8.5 — Post-filter per-account balance correction.
  //
  // For each account: compute net = Σ deltaUsd across all kept trades.
  // A non-zero net means small trades were filtered asymmetrically.
  // The expected net is newCash (zero when no contributions are being deployed).
  //
  // Fix: find the largest kept trade on the imbalanced side and shrink it by the
  // residual imbalance. If the adjustment would push it below minTradeUsd, drop it
  // entirely and apply the residual to the next-largest, repeating as needed.

  const trades = [...rawTrades];
  for (const acct of nonLockedAccounts) {
    const expectedNet = acct.newCash ?? 0;
    const acctTrades = trades.filter(t => t.accountId === acct.id);
    const net = acctTrades.reduce((s, t) => s + t.deltaUsd, 0);
    const residual = net - expectedNet;
    if (Math.abs(residual) < EPSILON) continue;

    // residual > 0 means we sold too much (or bought too little) → shrink the largest buy
    // residual < 0 means we bought too much (or sold too little) → shrink the largest sell
    const targetSign = residual > 0 ? 1 : -1;
    const candidates = acctTrades
      .filter(t => Math.sign(t.deltaUsd) === targetSign)
      .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));

    let remaining = Math.abs(residual);
    for (const cand of candidates) {
      if (remaining < EPSILON) break;
      const idx = trades.indexOf(cand);
      const adjust = Math.min(remaining, Math.abs(cand.deltaUsd));
      const newDelta = cand.deltaUsd - targetSign * adjust;
      remaining -= adjust;
      if (Math.abs(newDelta) < strategy.minTradeUsd) {
        trades.splice(idx, 1);
      } else {
        trades[idx] = { ...cand, deltaUsd: newDelta };
      }
    }
  }

  // Generate TAXABLE_SALE flags from the corrected trade list.
  for (const trade of trades) {
    if (trade.deltaUsd < 0 && trade.inTaxableAccount) {
      flags.push({ kind: 'TAXABLE_SALE', accountId: trade.accountId, assetClass: trade.assetClass, amountUsd: Math.abs(trade.deltaUsd) });
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
