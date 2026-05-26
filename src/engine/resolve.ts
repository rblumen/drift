import type { AssetClass, FundDecomposition, Position, ResolvedTrade, Trade } from './types';
import type { ClassifyFn } from './classify';

// US_TOTAL_MARKET positions are redistributed to these sub-classes in rollup.
// We expand them the same way so sell/buy targets map back to the blended ticker.
const TOTAL_MARKET_EXPANSION: AssetClass[] = ['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP'];

// Returns every asset class a ticker covers, accounting for US_TOTAL_MARKET
// expansion and explicit decompositions. Decomposed positions are always locked
// in rollup (they can't be traded as sub-components), so we skip them here —
// no trades will exist for them and they'd only create false ambiguity.
function coveredClasses(
  ticker: string,
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition>,
): AssetClass[] {
  if (decompositions[ticker.toUpperCase()]) return []; // always frozen — skip
  const ac = classify(ticker);
  if (ac === null) return [];
  return ac === 'US_TOTAL_MARKET' ? TOTAL_MARKET_EXPANSION : [ac];
}

// Annotates each Trade with the specific ticker to execute it against, where
// the account's current holdings make that unambiguous. Trades for multiple
// asset classes that all trace to a single blended fund are merged into one
// ResolvedTrade so the user is directed to trade the actual held fund rather
// than phantom sub-class slices.
//
// A trade is left without a ticker when:
//   - No position in the account covers the class (greenfield buy — user picks fund).
//   - Multiple positions in the account cover the class (ambiguous — user decides).
export function resolveTradeVehicles(
  trades: Trade[],
  positions: Position[],
  decompositions: Record<string, FundDecomposition>,
  classify: ClassifyFn,
): ResolvedTrade[] {
  const resolved: ResolvedTrade[] = [];

  // Group trades by account.
  const byAccount = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!byAccount.has(t.accountId)) byAccount.set(t.accountId, []);
    byAccount.get(t.accountId)!.push(t);
  }

  for (const [accountId, accountTrades] of byAccount) {
    // For each unique ticker in this account, compute which classes it covers.
    const tickerCoverage = new Map<string, AssetClass[]>();
    const seen = new Set<string>();
    for (const pos of positions) {
      if (pos.accountId !== accountId || seen.has(pos.ticker)) continue;
      seen.add(pos.ticker);
      const classes = coveredClasses(pos.ticker, classify, decompositions);
      if (classes.length > 0) tickerCoverage.set(pos.ticker, classes);
    }

    // Reverse map: assetClass → tickers that cover it in this account.
    const classTickers = new Map<AssetClass, string[]>();
    for (const [ticker, classes] of tickerCoverage) {
      for (const ac of classes) {
        if (!classTickers.has(ac)) classTickers.set(ac, []);
        classTickers.get(ac)!.push(ticker);
      }
    }

    // Assign each trade to a ticker, or mark it unresolvable.
    const tickerTrades = new Map<string, Trade[]>();
    const unresolvable: Trade[] = [];

    for (const trade of accountTrades) {
      const tickers = classTickers.get(trade.assetClass) ?? [];
      if (tickers.length === 1) {
        if (!tickerTrades.has(tickers[0])) tickerTrades.set(tickers[0], []);
        tickerTrades.get(tickers[0])!.push(trade);
      } else {
        // Zero (no holding covers it) or >1 (ambiguous) — emit without ticker.
        unresolvable.push(trade);
      }
    }

    // Emit: single-class funds pass through with a ticker; blended funds are merged.
    for (const [ticker, group] of tickerTrades) {
      if (group.length === 1) {
        resolved.push({ ...group[0], ticker });
      } else {
        // Multiple asset-class trades all trace to the same blended fund.
        // Use the ticker's own raw classification as the representative assetClass
        // (e.g. US_TOTAL_MARKET for VTI/FSKAX) so the merged trade is self-describing.
        const rawClass = classify(ticker) ?? group[0].assetClass;
        resolved.push({
          accountId,
          assetClass: rawClass,
          ticker,
          deltaUsd: group.reduce((s, t) => s + t.deltaUsd, 0),
          inTaxableAccount: group[0].inTaxableAccount,
          mergedFrom: group.map(t => ({ assetClass: t.assetClass, deltaUsd: t.deltaUsd })),
        });
      }
    }

    for (const t of unresolvable) {
      resolved.push({ ...t });
    }
  }

  return resolved;
}
