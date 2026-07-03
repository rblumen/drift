import type { Account, Position, AssetClass, Flag, FundDecomposition, Trade } from './types';
import type { ClassifyFn } from './classify';
import { taxableClassSaleIsKnownGain } from './taxAdjust';
import { isTaxableSale } from './taxableSale';

/**
 * Advisory-flag derivation (extracted, #128).
 *
 * The advisory flags computed near the end of a rebalance run — TAXABLE_SALE,
 * FIVE_TWENTY_NINE_REBALANCE_LIMIT, WASH_SALE_RISK, and
 * TAXABLE_REBALANCE_AVOIDABLE — all key off the final (corrected, nominal) trade
 * list rather than the placement math. Extracting them into one function means
 * every result path shares ONE advisory-flag derivation: the main path passes its
 * real trades, and the early returns pass an empty trade list (which correctly
 * yields no trade-derived advisories). This is the structural point of the seam —
 * a future trade-independent advisory can be added here in one place and cannot be
 * accidentally skipped by an early return, which is exactly how bug #114 (a dropped
 * REVISIT_PLACEMENT on balanced portfolios) happened.
 *
 * NOTE: REVISIT_PLACEMENT itself is NOT derived here. It is deliberately hoisted
 * above the early returns (Step 0.9 in rebalance.ts, #114) because it depends on
 * account values, not trades — a perfectly balanced portfolio must still surface
 * it. The flags below genuinely require the trade list, so they belong on every
 * path that produces trades and are no-ops on the empty-trade early returns.
 *
 * Pure: reads its inputs, returns a fresh Flag[]. Does not mutate.
 */
export function deriveAdvisoryFlags(args: {
  trades: Trade[];
  accounts: Account[];
  /** Nominal-basis original positions — wash-sale gain detection reads real basis. */
  originalPositions: Position[];
  classify: ClassifyFn;
  decompositions: Record<string, FundDecomposition>;
  /** Populated only when preferTaxAdvantagedRebalance is disabled and the redirect
   *  would have reduced taxable selling; empty otherwise. */
  avoidableSells: { accountId: string; assetClass: AssetClass; amountUsd: number }[];
}): Flag[] {
  const { trades, accounts, originalPositions, classify, decompositions, avoidableSells } = args;
  const flags: Flag[] = [];

  // Generate TAXABLE_SALE flags from the corrected trade list.
  // Cash position reductions are not real trades; they don't generate capital-gains exposure.
  for (const trade of trades) {
    if (isTaxableSale(trade)) {
      flags.push({ kind: 'TAXABLE_SALE', accountId: trade.accountId, assetClass: trade.assetClass, amountUsd: Math.abs(trade.deltaUsd) });
    }
  }

  // 529 rebalance limit warning (issue #6). The IRS allows only two investment-direction
  // changes per 529 account per calendar year. Flag whenever any trade touches a 529.
  const fiveTwentyNineIds = [...new Set(
    trades
      .filter(t => accounts.find(a => a.id === t.accountId)?.type === 'FIVE_TWENTY_NINE')
      .map(t => t.accountId),
  )];
  if (fiveTwentyNineIds.length > 0) {
    flags.push({ kind: 'FIVE_TWENTY_NINE_REBALANCE_LIMIT', accountIds: fiveTwentyNineIds });
  }

  // Wash-sale cross-account warning (issue #5). Selling an asset class at a loss
  // in a taxable account while buying the *same* class in any other account in the
  // same run disallows the loss under the IRS wash-sale rule (across IRA/401k and
  // spouse accounts too). We flag conservatively: emit unless cost basis is known
  // for the sold class and the sale is a gain (no loss to disallow). Exact-class
  // match only — parent/child "substantially identical" matching is out of scope
  // for v1. Uses originalPositions (nominal basis & value). De-duped to one flag
  // per taxable-account × class × buy-account triple.
  const washSeen = new Set<string>();
  for (const sell of trades) {
    if (sell.deltaUsd >= 0 || !sell.inTaxableAccount || sell.assetClass === 'CASH') continue;
    if (taxableClassSaleIsKnownGain(sell.accountId, sell.assetClass, originalPositions, classify, decompositions)) {
      continue;   // realizes a gain — no loss for the wash-sale rule to disallow
    }
    for (const buy of trades) {
      if (buy.deltaUsd <= 0 || buy.assetClass !== sell.assetClass) continue;
      if (buy.accountId === sell.accountId) continue;   // same account — not cross-account
      const key = `${sell.accountId}|${sell.assetClass}|${buy.accountId}`;
      if (washSeen.has(key)) continue;
      washSeen.add(key);
      flags.push({
        kind: 'WASH_SALE_RISK',
        taxableAccountId: sell.accountId,
        assetClass: sell.assetClass,
        buyAccountId: buy.accountId,
      });
    }
  }

  // Surface avoidable taxable sells (only populated when preferTaxAdvantagedRebalance
  // is disabled and the redirect would have reduced taxable selling).
  for (const a of avoidableSells) {
    flags.push({ kind: 'TAXABLE_REBALANCE_AVOIDABLE', accountId: a.accountId, assetClass: a.assetClass, amountUsd: a.amountUsd });
  }

  return flags;
}
