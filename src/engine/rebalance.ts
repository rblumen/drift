import type { Account, AccountType, Position, Strategy, RebalanceResult, AssetClass, Flag, FundDecomposition, Trade } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { makeClassifier } from './classify';
import { rollup } from './rollup';
import { accountBucket, greedyPlace } from './placement';
import { fillOrdered } from './cashfill';
import { EPSILON, effectiveTolerance, zeroByClass } from './utils';

/**
 * Contribution-first funding breakdown (backlog #2 / issue #3).
 *
 * Decomposes the recommended trades into the share funded by new contributions
 * versus the share that requires selling existing holdings. Because per-account
 * net flow equals new cash, household-wide buysUsd = sellsUsd + newCashDeployed.
 */
function summarizeContributions(trades: Trade[]): RebalanceResult['contributionSummary'] {
  let buysUsd = 0;
  let sellsUsd = 0;
  for (const t of trades) {
    if (t.deltaUsd > 0) buysUsd += t.deltaUsd;
    else sellsUsd += -t.deltaUsd;
  }
  return {
    newCashDeployed: Math.max(0, buysUsd - sellsUsd),
    buysUsd,
    sellsUsd,
    withdrawalRaised: Math.max(0, sellsUsd - buysUsd),
  };
}

// ── Drawdown / withdrawal helpers (issue #14) ────────────────────────────────

/**
 * Default drain order seeded from account type: taxable first, then tax-deferred,
 * then HSA, then Roth, then 529, then other. Users override per account via
 * withdrawalPriority to deviate from the default tax order.
 */
const WITHDRAWAL_PRIORITY_SEED: Record<AccountType, number> = {
  TAXABLE: 10,
  TRADITIONAL_IRA: 20,
  FOUR_OH_ONE_K: 20,
  HSA: 30,
  ROTH_IRA: 40,
  FIVE_TWENTY_NINE: 50,
  OTHER: 60,
};

export function defaultWithdrawalPriority(type: AccountType): number {
  return WITHDRAWAL_PRIORITY_SEED[type] ?? 60;
}

export function withdrawalPriorityOf(a: Account): number {
  return a.withdrawalPriority ?? defaultWithdrawalPriority(a.type);
}

/**
 * Default eligibility when acceptsWithdrawals is unset: taxable accounts are
 * eligible; tax-advantaged accounts are restricted (early-withdrawal penalties).
 * Locked accounts never fund withdrawals. RMDs bypass this — see below.
 */
export function isWithdrawalEligible(a: Account): boolean {
  if (a.locked) return false;
  if (a.acceptsWithdrawals !== undefined) return a.acceptsWithdrawals;
  return accountBucket(a.type) === 'TAXABLE';
}

/**
 * Resolve how much each account funds toward a withdrawal. The total raised is
 * Σ RMD + the additional (discretionary) amount — RMDs are always additive, never
 * a ceiling:
 *   1. Forced RMDs first — mandatory, so they ignore eligibility (bounded only by
 *      the account's sellable value).
 *   2. The additional amount drains withdrawal-eligible accounts (which includes
 *      "Required" accounts that also carry an RMD) in ascending withdrawalPriority
 *      via fillOrdered, each capped at its remaining sellable value.
 * Emits WITHDRAWAL_SHORTFALL when eligible capacity can't cover the additional need.
 */
function computeWithdrawalAllocations(
  accounts: Account[],
  sellable: Record<string, number>,
  additionalWithdrawal: number,
): { alloc: Record<string, number>; flags: Flag[] } {
  const flags: Flag[] = [];

  const forced: Record<string, number> = {};
  for (const a of accounts) {
    const rmd = Math.min(a.rmdDueUsd ?? 0, sellable[a.id] ?? 0);
    if (rmd > EPSILON) forced[a.id] = rmd;
  }

  const order = accounts
    .filter(isWithdrawalEligible)
    .sort((a, b) => withdrawalPriorityOf(a) - withdrawalPriorityOf(b) || a.id.localeCompare(b.id))
    .map(a => a.id);
  const roomOf = (id: string): number => Math.max(0, (sellable[id] ?? 0) - (forced[id] ?? 0));
  const { alloc: disc, residual } = fillOrdered(order, roomOf, Math.max(0, additionalWithdrawal));
  if (residual > EPSILON) flags.push({ kind: 'WITHDRAWAL_SHORTFALL', amountUsd: residual });

  const alloc: Record<string, number> = {};
  for (const a of accounts) {
    const v = (forced[a.id] ?? 0) + (disc[a.id] ?? 0);
    if (v > EPSILON) alloc[a.id] = v;
  }
  return { alloc, flags };
}

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

          // For TAXABLE-preferred classes (e.g. FIXED_INCOME), only allow as Y when
          // A already has a greedyPlace allocation for Y. That means FI was already
          // being put in A as a spillover — extending it is acceptable. Creating a
          // brand-new FI-in-TA position would silently undo the placement intent.
          const yPrefBucket = (strategy.placement[Y] ?? ['TAX_ADVANTAGED', 'TAXABLE'])[0];
          if (yPrefBucket !== 'TAX_ADVANTAGED' && targetLocation[A.id][Y] <= EPSILON) continue;

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

/**
 * Step 8.7 — Composite-sell synthesis for blended funds (issue #40).
 *
 * See the call site in `rebalance` for the high-level intent. Implementation notes:
 *
 *  • `nonBlendedSellable[ac]` is what non-blended unlocked positions in A can
 *    absorb for sub-class `ac`. It equals `unlockedCurrent[A][ac]` minus the
 *    blended-fund contribution to that slot.
 *  • `residual[ac]` is the part of the engine's existing sell demand for `ac`
 *    that non-blended positions can't cover. That's what the blended fund must
 *    sell.
 *  • The binding sub-class — the one with the largest `residual / weight` ratio —
 *    sets the fund sale rate `r`. Other sub-classes get over-sold by
 *    `r·w[ac]·V - residual[ac]`.
 *  • Each over-sell gets a compensating buy in the same slot, tagged so the
 *    resolver routes it to a non-blended ticker. Net per-account delta is
 *    preserved, satisfying Principle #3.
 *  • Multiple blended funds in one account are processed largest-first; each
 *    one's contribution decrements the remaining sell demand seen by later funds.
 */
function synthesizeBlendedFundSells(
  accounts: Account[],
  positions: Position[],
  decompositions: Record<string, FundDecomposition>,
  trades: Trade[],
  unlockedCurrent: Record<string, Record<AssetClass, number>>,
  effectiveAllowed: Record<string, Set<AssetClass>>,
  strategy: Strategy,
): Flag[] {
  const flags: Flag[] = [];

  for (const A of accounts) {
    if (A.locked) continue;

    const blendedFunds = positions
      .filter(p => p.accountId === A.id && decompositions[p.ticker.toUpperCase()] && !p.locked)
      .sort((a, b) => b.marketValue - a.marketValue);
    if (blendedFunds.length === 0) continue;

    const inTaxable = accountBucket(A.type) === 'TAXABLE';

    // Total non-locked blended-fund contribution per sub-class in A.
    const blendedContrib = zeroByClass();
    for (const B of blendedFunds) {
      const w = decompositions[B.ticker.toUpperCase()]!;
      for (const [ac, weight] of Object.entries(w) as [AssetClass, number][]) {
        blendedContrib[ac] += B.marketValue * weight;
      }
    }

    // Slot value that does NOT come from a blended fund and isn't locked.
    const nonBlendedSellable = zeroByClass();
    for (const ac of ALL_ASSET_CLASSES) {
      nonBlendedSellable[ac] = Math.max(0, unlockedCurrent[A.id][ac] - blendedContrib[ac]);
    }

    // Current sell demand per sub-class from the engine's existing trades.
    const sellDemand = zeroByClass();
    for (const t of trades) {
      if (t.accountId !== A.id) continue;
      if (t.deltaUsd < 0) sellDemand[t.assetClass] += -t.deltaUsd;
    }

    for (const B of blendedFunds) {
      const decomp = decompositions[B.ticker.toUpperCase()]!;
      const subClasses = Object.keys(decomp) as AssetClass[];

      // Demand that lands on B for each sub-class.
      const residual: Record<AssetClass, number> = zeroByClass();
      for (const ac of subClasses) {
        const w = decomp[ac] ?? 0;
        if (w <= 0) continue;
        residual[ac] = Math.max(0, sellDemand[ac] - nonBlendedSellable[ac]);
      }

      // Fund-level sale rate (binding sub-class wins).
      let r = 0;
      for (const ac of subClasses) {
        const w = decomp[ac] ?? 0;
        if (w <= 0) continue;
        const ratio = residual[ac] / (w * B.marketValue);
        if (ratio > r) r = ratio;
      }
      r = Math.min(1, r);
      if (r * B.marketValue < strategy.minTradeUsd) continue;

      // Emit forced sells and compensating buys per sub-class.
      for (const ac of subClasses) {
        const w = decomp[ac] ?? 0;
        if (w <= 0) continue;
        const forcedAmt = r * w * B.marketValue;
        const blendedPart = Math.min(residual[ac], forcedAmt);
        const overAmt = Math.max(0, forcedAmt - residual[ac]);

        // Re-route the residual portion of the engine's existing sell trade to B
        // (so the resolver pins it to B's ticker rather than guessing). If the
        // existing sell trade is fully satisfied by non-blended capacity, no
        // re-route is needed — it routes to a non-blended ticker as before.
        if (blendedPart > EPSILON) {
          const nonBlendedPart = Math.max(0, sellDemand[ac] - blendedPart);
          // Find the engine's plain sell trade for this slot (one or none — Step 8
          // emits at most one per slot, and we haven't pushed any yet for this slot).
          const existingIdx = trades.findIndex(t =>
            t.accountId === A.id && t.assetClass === ac && t.deltaUsd < 0 && !t.forceTicker
          );
          if (existingIdx >= 0) {
            if (nonBlendedPart > EPSILON) {
              trades[existingIdx] = { ...trades[existingIdx], deltaUsd: -nonBlendedPart };
            } else {
              trades.splice(existingIdx, 1);
            }
          }
          trades.push({
            accountId: A.id, assetClass: ac, deltaUsd: -blendedPart,
            inTaxableAccount: inTaxable, forceTicker: B.ticker,
          });
        }

        // Over-sells: B forced to liquidate more of ac than the engine wanted.
        // Pair each over-sell with a compensating buy in the same slot. The buy
        // is tagged to exclude B from candidate tickers so the user actually
        // executes the buy-back against a different fund.
        if (overAmt > EPSILON) {
          trades.push({
            accountId: A.id, assetClass: ac, deltaUsd: -overAmt,
            inTaxableAccount: inTaxable, forceTicker: B.ticker,
          });
          if (effectiveAllowed[A.id]?.has(ac)) {
            trades.push({
              accountId: A.id, assetClass: ac, deltaUsd: overAmt,
              inTaxableAccount: inTaxable, excludeTickers: [B.ticker],
            });
          } else {
            flags.push({
              kind: 'BLENDED_FUND_OVERSELL',
              accountId: A.id, ticker: B.ticker, assetClass: ac, amountUsd: overAmt,
            });
          }
        }
      }

      // Decrement remaining demand seen by subsequent (smaller) blended funds.
      for (const ac of subClasses) {
        const w = decomp[ac] ?? 0;
        if (w <= 0) continue;
        const forcedAmt = r * w * B.marketValue;
        sellDemand[ac] = Math.max(0, sellDemand[ac] - Math.min(forcedAmt, sellDemand[ac]));
      }
    }
  }

  return flags;
}

export function rebalance(
  accounts: Account[],
  positions: Position[],
  strategy: Strategy,
  tickerOverrides: Record<string, AssetClass> = {},
  decompositions: Record<string, FundDecomposition> = {},
  freeCash: number = 0,
  plannedWithdrawal: number = 0,
): RebalanceResult {
  const classify = makeClassifier(tickerOverrides);

  const flags: Flag[] = [];

  // Are we in drawdown mode? A planned withdrawal or any forced RMD turns the run
  // into a net cash-raising rebalance. This disables the within-tolerance skip
  // below so the engine actually sells down to the (reduced) post-withdrawal
  // targets rather than leaving balanced classes untouched.
  const inDrawdown = plannedWithdrawal > EPSILON || accounts.some(a => (a.rmdDueUsd ?? 0) > 0);
  // Per-account dollars withdrawn (RMD + discretionary), surfaced in the result.
  const withdrawalByAccount: Record<string, number> = {};

  // Step 0a — Drawdown: raise the withdrawal (Σ RMD + the additional amount) by
  // assigning a NEGATIVE net flow to the chosen accounts. A withdrawal is just a
  // negative newCash — Principle #3 (per-account net = newCash) already supports
  // it, and Step 8.5's net-correction enforces it exactly. The class-level split
  // is left to greedyPlace targeting the reduced post-withdrawal weights, which is
  // what keeps the sells allocation-preserving; account selection is controlled
  // entirely by which accounts receive the negative newCash (RMD-first, then
  // priority order). sellable = unlocked, mapped position value (the only
  // holdings the engine can actually trade to raise cash). Blended funds (issue
  // #40) count toward sellable — they're sold as a unit, with the proportional
  // sub-class deltas synthesized by Step 8.7 below.
  //
  // Runs BEFORE the deposit pass so free cash can offset the resulting sells
  // (minimizing net cash movement — see Step 0b).
  if (inDrawdown) {
    const sellable: Record<string, number> = {};
    for (const a of accounts) sellable[a.id] = 0;
    for (const pos of positions) {
      if (pos.locked) continue;
      const acct = accounts.find(a => a.id === pos.accountId);
      if (!acct || acct.locked) continue;
      if (decompositions[pos.ticker.toUpperCase()]) {
        // Blended fund — sellable as a whole; Step 8.7 enforces proportionality.
        sellable[pos.accountId] += pos.marketValue;
        continue;
      }
      if (classify(pos.ticker) === null) continue;            // unmapped — not tradeable
      sellable[pos.accountId] += pos.marketValue;
    }
    const { alloc, flags: withdrawalFlags } = computeWithdrawalAllocations(accounts, sellable, plannedWithdrawal);
    flags.push(...withdrawalFlags);
    Object.assign(withdrawalByAccount, alloc);
    accounts = accounts.map(a =>
      alloc[a.id] !== undefined
        ? { ...a, newCash: (a.newCash ?? 0) - alloc[a.id] }
        : a,
    );
  }

  // Step 0b — Distribute household free cash to deposit-eligible accounts.
  // Concentrate-then-spill (backlog #37): deploy the cash into the single
  // largest-capacity eligible account first, spilling to the next only when that
  // account's depositLimitUsd cap is reached. This minimizes the number of
  // accounts touched (PRINCIPLES.md #10/#11) — spreading cash pro-rata would
  // force every funded account to a net buy without improving the allocation,
  // since greedyPlace already places each class in its tax-correct account.
  //
  // Deposits and withdrawals are independent passes that net through each
  // account's newCash (issue #14 review). Capacity ordering adds back any
  // withdrawal allocation so deposit routing is identical to a no-withdrawal run
  // — a withdrawing account is still ranked by its real (pre-withdrawal) size.
  //
  // Whatever can't be placed (free cash exceeds the sum of all caps) surfaces as
  // EXCESS_CASH. Locked accounts and accounts with acceptsDeposits === false are
  // excluded; an account with depositLimitUsd === 0 is treated as closed.
  if (freeCash > 0) {
    const baseValue: Record<string, number> = {};
    for (const acct of accounts) baseValue[acct.id] = (acct.newCash ?? 0) + (withdrawalByAccount[acct.id] ?? 0);
    for (const pos of positions) baseValue[pos.accountId] = (baseValue[pos.accountId] ?? 0) + pos.marketValue;

    const eligible = accounts.filter(a =>
      !a.locked &&
      a.acceptsDeposits !== false &&
      (a.depositLimitUsd === undefined || a.depositLimitUsd > 0),
    );

    if (eligible.length === 0) {
      flags.push({ kind: 'EXCESS_CASH', amountUsd: freeCash });
    } else {
      // Largest capacity first; tie-break by id for determinism.
      const order = [...eligible]
        .sort((a, b) => (baseValue[b.id] ?? 0) - (baseValue[a.id] ?? 0) || a.id.localeCompare(b.id))
        .map(a => a.id);
      const capOf: Record<string, number> = {};
      for (const a of eligible) capOf[a.id] = a.depositLimitUsd ?? Infinity;

      const { alloc, residual } = fillOrdered(order, id => capOf[id], freeCash);

      if (residual > 0) flags.push({ kind: 'EXCESS_CASH', amountUsd: residual });
      accounts = accounts.map(a =>
        alloc[a.id] !== undefined
          ? { ...a, newCash: (a.newCash ?? 0) + alloc[a.id] }
          : a,
      );
    }
  }

  const {
    householdValue, currentValue, currentValueByAccount,
    accountValues, lockedValueByAccount, blendedValueByAccount, unmappedTickers,
  } = rollup(accounts, positions, classify, decompositions);

  // Drawdown unlocks blended-fund value (issue #40) so it can fund withdrawals.
  // We subtract it from the per-slot locked total before computing free capacity;
  // Step 8.7 later enforces the composition constraint when synthesizing the
  // actual sells. Outside drawdown the lock stays so normal rebalancing won't
  // tear a TDF apart to satisfy a small placement preference.
  const effectiveLocked: Record<string, Record<AssetClass, number>> = {};
  for (const acct of accounts) {
    effectiveLocked[acct.id] = zeroByClass();
    for (const ac of ALL_ASSET_CLASSES) {
      const locked = lockedValueByAccount[acct.id][ac] ?? 0;
      const blended = blendedValueByAccount[acct.id][ac] ?? 0;
      effectiveLocked[acct.id][ac] = inDrawdown ? Math.max(0, locked - blended) : locked;
    }
  }

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
      withdrawalByAccount,
      trades: [],
      flags,
      contributionSummary: summarizeContributions([]),
    };
  }

  // Step 1 — Current weights (locked positions/accounts still count in weights).
  const currentWeights = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, currentValue[ac] / householdValue]),
  ) as Record<AssetClass, number>;

  // Step 2 — Tolerance check (Bogleheads 5/25 rule).
  // A class is within tolerance when drift is within the *tighter* of the two bands:
  //   absolute (toleranceAbs) or relative (toleranceRel × target).
  // For small targets the relative band fires first; for large targets the absolute band wins.
  //
  // Skipped entirely in drawdown mode: raising cash means we must sell down to the
  // reduced post-withdrawal targets, so no class may be frozen as "close enough."
  // With withinTolerance empty, every class participates in placement and the net
  // per account (= the negative newCash from Step 0.5) is realized as sells.
  const withinTolerance = new Set<AssetClass>();
  if (!inDrawdown) {
    for (const ac of ALL_ASSET_CLASSES) {
      if (Math.abs(currentWeights[ac] - strategy.targets[ac]) <= effectiveTolerance(ac, strategy)) {
        withinTolerance.add(ac);
        flags.push({ kind: 'WITHIN_TOLERANCE', assetClass: ac });
      }
    }
  }

  if (withinTolerance.size === ALL_ASSET_CLASSES.length) {
    return {
      householdValue,
      currentWeights,
      targetWeights: strategy.targets,
      projectedWeights: currentWeights,
      currentValueByAccount,
      withdrawalByAccount,
      trades: [],
      flags,
      contributionSummary: summarizeContributions([]),
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
        const lockedPos = effectiveLocked[acct.id][ac];
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
  //
  // Immovable correction: positions in locked accounts and individually-locked positions
  // in non-locked accounts cannot be changed by any trade. Only (target − immovable)
  // needs to be supplied via trades; the rest is already on the books. Without this
  // subtraction, classes with locked-but-underweight positions are over-bought, causing
  // projectedWeights to exceed targets by exactly the immovable amount.

  const immovableByClass = zeroByClass();
  for (const acct of accounts) {
    for (const ac of ALL_ASSET_CLASSES) {
      if (withinTolerance.has(ac)) continue;
      immovableByClass[ac] += acct.locked
        ? (currentValueByAccount[acct.id]?.[ac] ?? 0)
        : (effectiveLocked[acct.id]?.[ac] ?? 0);
    }
  }

  const totalFreeCapacity = Object.values(freeCapacity).reduce((a, b) => a + b, 0);
  const totalOOTTarget = ALL_ASSET_CLASSES
    .filter(ac => !withinTolerance.has(ac))
    .reduce((s, ac) => s + Math.max(0, targetValue[ac] - immovableByClass[ac]), 0);

  const scale = totalOOTTarget > 0 ? totalFreeCapacity / totalOOTTarget : 0;
  const adjustedTarget = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [
      ac,
      withinTolerance.has(ac) ? 0 : Math.max(0, targetValue[ac] - immovableByClass[ac]) * scale,
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

  // Step 7.7 — Tax-advantaged-first rebalancing (backlog #3 / issue #4).
  //
  // By default, exhaust rebalancing inside tax-advantaged accounts before any
  // taxable sale — redirectTaxableSells moves taxable equity sells into TA
  // accounts via balance-preserving swaps. Set strategy.preferTaxAdvantagedRebalance
  // = false to opt out.
  //
  // When the preference is OFF we run the redirect on a throwaway clone purely to
  // measure how much taxable selling it *would* have eliminated, then surface that
  // per (account, class) as TAXABLE_REBALANCE_AVOIDABLE — telling the user the
  // capital gains are avoidable if they re-enable the preference.
  const preferTA = strategy.preferTaxAdvantagedRebalance !== false;
  const avoidableSells: { accountId: string; assetClass: AssetClass; amountUsd: number }[] = [];

  if (preferTA) {
    redirectTaxableSells(
      nonLockedAccounts, unlockedCurrent, targetLocation, effectiveAllowed, strategy,
    );
  } else {
    const clone: Record<string, Record<AssetClass, number>> = {};
    for (const id of Object.keys(targetLocation)) clone[id] = { ...targetLocation[id] };
    redirectTaxableSells(
      nonLockedAccounts, unlockedCurrent, clone, effectiveAllowed, strategy,
    );
    for (const acct of nonLockedAccounts) {
      if (accountBucket(acct.type) !== 'TAXABLE') continue;
      for (const ac of ALL_ASSET_CLASSES) {
        const sellNow   = unlockedCurrent[acct.id][ac] - targetLocation[acct.id][ac];
        const sellAfter = unlockedCurrent[acct.id][ac] - clone[acct.id][ac];
        const reduction = sellNow - sellAfter;
        if (reduction > strategy.minTradeUsd) {
          avoidableSells.push({ accountId: acct.id, assetClass: ac, amountUsd: reduction });
        }
      }
    }
  }

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

  // Step 8.6 — Trade-count minimization (backlog #16).
  //
  // After balance correction, greedily drop the smallest remaining trades whose
  // removal keeps all projected weights within toleranceAbs.  When a trade is
  // dropped, the per-account net invariant is restored by shrinking the largest
  // opposite-sign trade in the same account by the same amount (the "comp"
  // trade).  Both the dropped class and the comp class are checked against
  // toleranceAbs before committing.  The loop repeats until no more trades can
  // be dropped (convergence is guaranteed because the trade list strictly shrinks
  // each successful iteration).
  //
  // Only runs when toleranceAbs > 0 — with zero tolerance every trade is needed
  // to hit the exact target weights. (Effective per-class tolerance can still be 0
  // when toleranceRel × target evaluates to 0, but that's handled per-class below.)
  if (strategy.toleranceAbs > 0 && trades.length > 0) {
    // Build projected-value map: currentValue + sum of all kept trade deltas.
    const projVal: Record<AssetClass, number> = {} as Record<AssetClass, number>;
    for (const ac of ALL_ASSET_CLASSES) projVal[ac] = currentValue[ac];
    for (const t of trades) projVal[t.assetClass] += t.deltaUsd;

    let changed = true;
    while (changed) {
      changed = false;
      // Process smallest trades first — most likely to be droppable.
      trades.sort((a, b) => Math.abs(a.deltaUsd) - Math.abs(b.deltaUsd));

      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];

        // Would dropping t push t's class out of tolerance (5/25 rule, per-class)?
        const newProjAC = projVal[t.assetClass] - t.deltaUsd;
        if (
          Math.abs(newProjAC / householdValue - strategy.targets[t.assetClass]) >
          effectiveTolerance(t.assetClass, strategy)
        ) continue;

        // Find the largest opposite-sign trade in the same account to absorb the
        // balance gap left by removing t.
        const compCandidates = trades
          .filter((c, j) => j !== i && c.accountId === t.accountId &&
            Math.sign(c.deltaUsd) === -Math.sign(t.deltaUsd))
          .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));

        if (compCandidates.length === 0) continue; // Nothing to compensate with.

        const comp = compCandidates[0];
        // comp.deltaUsd + t.deltaUsd: shrinks comp toward zero (opposite signs).
        const compNewDelta = comp.deltaUsd + t.deltaUsd;

        // Skip if the adjusted comp would fall in the minTradeUsd dead zone.
        if (
          Math.abs(compNewDelta) > EPSILON &&
          Math.abs(compNewDelta) < strategy.minTradeUsd
        ) continue;

        // Would adjusting comp push its class out of tolerance (5/25 rule, per-class)?
        // Adjusting comp by t.deltaUsd shifts projected[comp.assetClass] by t.deltaUsd.
        const newProjComp = projVal[comp.assetClass] + t.deltaUsd;
        if (
          Math.abs(newProjComp / householdValue - strategy.targets[comp.assetClass]) >
          effectiveTolerance(comp.assetClass, strategy)
        ) continue;

        // Commit the drop.
        projVal[t.assetClass]    -= t.deltaUsd;
        projVal[comp.assetClass] += t.deltaUsd;
        trades.splice(i, 1); // remove t
        const compIdx = trades.indexOf(comp);
        if (Math.abs(compNewDelta) <= EPSILON) {
          trades.splice(compIdx, 1); // comp also cancels out entirely
        } else {
          trades[compIdx] = { ...comp, deltaUsd: compNewDelta };
        }
        changed = true;
        break; // Restart with the updated list and projVal.
      }
    }
  }

  // Step 8.7 — Composite-sell synthesis for blended funds (issue #40).
  //
  // The engine emits per-(account, sub-class) deltas. A blended fund (TDF, balanced
  // fund) is a single position whose composition is fixed — selling N% of it sells
  // N% of every sub-class proportionally. Sub-class trades that route to a blended
  // fund must therefore reflect that constraint, or the user can't execute them.
  //
  // Scope: only runs in drawdown mode. Outside drawdown the blended fund stays
  // locked (see effectiveLocked above), so the engine never generates sells against
  // it in the first place — and the user keeps their TDF intact instead of having
  // it torn apart for a small placement preference.
  //
  // For each non-locked account A with non-locked blended funds in it:
  //   1. Attribute existing sell demand per sub-class to non-blended positions first
  //      (the engine prefers selling them — they have no composition lock).
  //   2. For each blended fund B, compute the rate r at which B must be sold to
  //      satisfy the binding sub-class (the one whose residual / w_B[ac] is largest).
  //   3. Emit per-sub-class sells tagged with forceTicker = B.ticker for B's share.
  //      The resolver merges these into a single "sell N% of B" ResolvedTrade.
  //   4. Where r forces selling more of a sub-class than the engine wanted (over-sell),
  //      emit a compensating buy tagged with excludeTickers = [B.ticker] so the
  //      buy-back routes to another ticker in A. Net per-account delta is preserved.
  //   5. If A's effectiveAllowed excludes the over-sold class, no in-place buy-back
  //      is possible — emit BLENDED_FUND_OVERSELL and let the over-sell stand.
  if (inDrawdown) {
    flags.push(...synthesizeBlendedFundSells(
      accounts, positions, decompositions, trades,
      unlockedCurrent, effectiveAllowed, strategy,
    ));
  }

  // Generate TAXABLE_SALE flags from the corrected trade list.
  for (const trade of trades) {
    if (trade.deltaUsd < 0 && trade.inTaxableAccount) {
      flags.push({ kind: 'TAXABLE_SALE', accountId: trade.accountId, assetClass: trade.assetClass, amountUsd: Math.abs(trade.deltaUsd) });
    }
  }

  // Surface avoidable taxable sells (only populated when preferTaxAdvantagedRebalance
  // is disabled and the redirect would have reduced taxable selling).
  for (const a of avoidableSells) {
    flags.push({ kind: 'TAXABLE_REBALANCE_AVOIDABLE', accountId: a.accountId, assetClass: a.assetClass, amountUsd: a.amountUsd });
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

  // Step 11 — Post-trade accuracy validation (5/25 rule, per-class).
  //
  // For every class that was out-of-tolerance before trades, check that the
  // projected weight now falls within the effective per-class tolerance of the
  // target. If it doesn't, a hard constraint prevented the engine from reaching
  // the target:
  //   • NO_ELIGIBLE_ACCOUNT — no account can hold this class
  //   • Locked positions exceed the class target — cannot reduce below the lock
  //   • minTradeUsd suppressed the needed trade — threshold is too large
  //
  // Emits PROJECTED_OFF_TARGET so the UI can surface this visibly rather than
  // leaving the user to notice the "After trades" column is still off.
  for (const ac of ALL_ASSET_CLASSES) {
    if (withinTolerance.has(ac)) continue;
    if (Math.abs(projectedWeights[ac] - strategy.targets[ac]) > effectiveTolerance(ac, strategy)) {
      flags.push({
        kind: 'PROJECTED_OFF_TARGET',
        assetClass: ac,
        projectedWeight: projectedWeights[ac],
        targetWeight: strategy.targets[ac],
      });
    }
  }

  return {
    householdValue, currentWeights, targetWeights: strategy.targets,
    projectedWeights, currentValueByAccount, withdrawalByAccount, trades, flags,
    contributionSummary: summarizeContributions(trades),
  };
}
