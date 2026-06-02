import type { AssetClass, FundDecomposition, Position, ResolvedTrade, Trade } from './types';
import type { ClassifyFn } from './classify';
import { CLASS_HIERARCHY, PARENT_CLASS } from './hierarchy';

// Returns every asset class a ticker covers, accounting for hierarchy expansion
// and explicit decompositions. Parent-class tickers (e.g. VTI → US_TOTAL_MARKET)
// expand to their children so sub-class trades can be merged back to the parent
// ticker. Blended funds (issue #40) expand via their decomposition — same merge path.
function coveredClasses(
  ticker: string,
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition>,
): AssetClass[] {
  const decomp = decompositions[ticker.toUpperCase()];
  if (decomp) return Object.keys(decomp) as AssetClass[];
  const ac = classify(ticker);
  if (ac === null) return [];
  return CLASS_HIERARCHY[ac]?.children.slice() ?? [ac];
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
      // Honor blended-fund routing hints (#40). forceTicker pins the trade to a
      // specific ticker (used for sub-class sells that must execute via a
      // specific blended fund). excludeTickers strips candidates (used on the
      // buy-back side so compensation doesn't loop back to the blended fund).
      if (trade.forceTicker) {
        const t = trade.forceTicker;
        if (!tickerTrades.has(t)) tickerTrades.set(t, []);
        tickerTrades.get(t)!.push(trade);
        continue;
      }
      let tickers = classTickers.get(trade.assetClass) ?? [];
      if (trade.excludeTickers && trade.excludeTickers.length > 0) {
        const ex = new Set(trade.excludeTickers);
        tickers = tickers.filter(t => !ex.has(t));
      }
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

    // Greenfield buy promotion: when ALL sibling child-class buys under a common
    // parent are unresolved in this account, collapse them into one parent-level
    // unresolved buy. This prevents the engine from recommending "buy $X CRYPTO +
    // buy $Y PRECIOUS_METALS" for a user who has no sub-class holdings and should
    // simply receive "buy $Z ALTERNATIVES".
    //
    // Mixed case (some siblings resolved, some not): leave as leaf-level trades —
    // the user has existing sub-class funds and there is no unambiguous parent ticker
    // to route the unresolved portion to.
    const promoted = promoteGreenfieldBuys(unresolvable);
    for (const t of promoted) resolved.push({ ...t });
  }

  return resolved;
}

function promoteGreenfieldBuys(unresolvable: Trade[]): Trade[] {
  // Only consider buy trades (deltaUsd > 0) for promotion.
  const buys = unresolvable.filter(t => t.deltaUsd > 0);
  const nonBuys = unresolvable.filter(t => t.deltaUsd <= 0);

  // Group buys by parent class.
  const byParent = new Map<AssetClass, Trade[]>();
  const noParent: Trade[] = [];
  for (const t of buys) {
    const parent = PARENT_CLASS[t.assetClass];
    if (parent) {
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(t);
    } else {
      noParent.push(t);
    }
  }

  const result: Trade[] = [...nonBuys, ...noParent];
  for (const [parent, group] of byParent) {
    const siblings = CLASS_HIERARCHY[parent]!.children;
    if (group.length === siblings.length) {
      // All siblings unresolved — promote to a single parent-level buy.
      result.push({
        ...group[0],
        assetClass: parent,
        deltaUsd: group.reduce((s, t) => s + t.deltaUsd, 0),
        forceTicker: undefined,
        excludeTickers: undefined,
      });
    } else {
      // Partial coverage — leave as individual leaf trades.
      result.push(...group);
    }
  }
  return result;
}
