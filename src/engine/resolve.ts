import type { AssetClass, FundDecomposition, Position, ResolvedTrade, Trade } from './types';
import type { ClassifyFn } from './classify';
import { CLASS_HIERARCHY, PARENT_CLASS, isChildClass, synthesizeImplicitDecompositions } from './hierarchy';

// Returns every asset class a ticker can satisfy a trade for, accounting for the
// hierarchy and explicit decompositions. A ticker covers its whole class *family*:
//   • the class itself (a FIXED_INCOME fund like BND satisfies a FIXED_INCOME trade);
//   • its children (a parent-class fund like VTI → US_TOTAL_MARKET satisfies the
//     US_LARGE/MID/SMALL_CAP sub-class trades, which then merge back to VTI);
//   • its parent (a child-class fund like MUNY → MUNI_BOND satisfies a parent-level
//     FIXED_INCOME trade when the sleeve is held at the parent level).
// Covering both directions lets a class be traded whether the user holds the broad
// parent fund or a specific sub-class fund. Blended funds (issue #40) expand via
// their decomposition instead — same merge path.
function coveredClasses(
  ticker: string,
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition>,
): AssetClass[] {
  const fam = new Set<AssetClass>();
  // A class is covered along with its whole family: itself, its children, and its
  // parent — so a broad fund satisfies its sub-class trades and a sub-class fund
  // satisfies a parent-level trade, in either direction.
  const addFamily = (ac: AssetClass) => {
    fam.add(ac);
    for (const child of CLASS_HIERARCHY[ac]?.children ?? []) fam.add(child);
    const parent = PARENT_CLASS[ac];
    if (parent) fam.add(parent);
  };
  const decomp = decompositions[ticker.toUpperCase()];
  if (decomp) {
    // Expand each decomposed class through the hierarchy — a blended fund covers
    // the families of every sleeve it holds. This keeps an implicit total-market
    // decomposition ({ US_TOTAL_MARKET: 1 }, issue #215) covering the cap children
    // exactly as the raw classify path did, so multi-sleeve trades still merge.
    for (const ac of Object.keys(decomp) as AssetClass[]) addFamily(ac);
    return [...fam];
  }
  const ac = classify(ticker);
  if (ac === null) return [];
  addFamily(ac);
  return [...fam];
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
//     Exception (#228): for a sub-class trade, if exactly one unlocked, non-blended
//     holding is classified as the trade's exact class, it wins over funds that
//     only cover the class via the hierarchy.
//
// strategyTargets — when provided, gates greenfield-buy promotion: child-class
// buys are only collapsed to the parent when the strategy targets the parent
// (all child weights are 0). When the strategy has individual child targets
// (e.g. CRYPTO: 1.5%, PRECIOUS_METALS: 1%), trades stay at child level so the
// trade list matches the granularity of the projected-weights pie chart.
export function resolveTradeVehicles(
  trades: Trade[],
  positions: Position[],
  decompositions: Record<string, FundDecomposition>,
  classify: ClassifyFn,
  strategyTargets?: Partial<Record<AssetClass, number>>,
): ResolvedTrade[] {
  // Issue #215 — mirror rebalance()'s implicit decompositions so a held broad fund
  // (e.g. SWTSX → US_TOTAL_MARKET) is recognized as a blended fund here too: its
  // sleeve trades merge into one fund-level ResolvedTrade labeled by the fund's own
  // class rather than a single sub-class. Explicit decompositions win; no-ops for
  // portfolios without parent-classified funds. Idempotent when the caller already
  // passed an augmented map (rebalance()'s internal call).
  decompositions = synthesizeImplicitDecompositions(positions, decompositions, classify);

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
    // Tickers with at least one unlocked position in this account. A ticker held
    // only as locked positions must not win the #228 exact-class preference —
    // locked positions are frozen (Goal 1).
    const tradeable = new Set(
      positions.filter(p => p.accountId === accountId && !p.locked).map(p => p.ticker),
    );
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
      // Issue #228 — a parent-class fund (SCHB → US_TOTAL_MARKET) covers its cap
      // children only via the hierarchy, and buying/selling it moves every sleeve
      // at once (#215). When a direct holding of the trade's exact sub-class is
      // also present (VO for a US_MID_CAP sell), that holding is the only
      // executable vehicle — prefer it rather than dropping the ticker as ambiguous.
      // Limited to:
      //   • sub-class trades — a parent-level trade (FIXED_INCOME with BND + MUNY)
      //     is a genuine choice between sleeves, e.g. munis in taxable;
      //   • non-blended, unlocked candidates — a blended fund (explicit or #215
      //     implicit) moves other sleeves too, and a locked position is frozen.
      if (tickers.length > 1 && isChildClass(trade.assetClass)) {
        const exact = tickers.filter(t =>
          classify(t) === trade.assetClass &&
          !decompositions[t.toUpperCase()] &&
          tradeable.has(t),
        );
        if (exact.length === 1) tickers = exact;
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
    // parent are unresolved in this account AND the strategy targets the class at
    // the parent level (no individual child targets), collapse them into one
    // parent-level unresolved buy.
    //
    // Mixed case (some siblings resolved, some not): leave as leaf-level trades —
    // the user has existing sub-class funds and there is no unambiguous parent ticker
    // to route the unresolved portion to.
    //
    // Child-targeted case (strategy has CRYPTO: X%, PRECIOUS_METALS: Y%): leave as
    // leaf-level trades so the trade list matches the granularity of the pie chart.
    const promoted = promoteGreenfieldBuys(unresolvable, strategyTargets);
    for (const t of promoted) resolved.push({ ...t });
  }

  return resolved;
}

function promoteGreenfieldBuys(
  unresolvable: Trade[],
  strategyTargets?: Partial<Record<AssetClass, number>>,
): Trade[] {
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
    // Promote only when (a) ALL siblings are unresolved — the user has no
    // sub-class holdings — AND (b) the strategy targets the parent class, not
    // the children individually. When child-level targets are set (e.g.
    // CRYPTO: 1.5%, PRECIOUS_METALS: 1%), trades must stay at child granularity
    // so the trade list matches the projected-weights pie chart.
    const childrenHaveTargets = strategyTargets != null &&
      siblings.some(c => (strategyTargets[c] ?? 0) > 0);
    if (group.length === siblings.length && !childrenHaveTargets) {
      // All siblings unresolved + parent-level targeting — promote.
      result.push({
        ...group[0],
        assetClass: parent,
        deltaUsd: group.reduce((s, t) => s + t.deltaUsd, 0),
        forceTicker: undefined,
        excludeTickers: undefined,
      });
    } else {
      // Partial coverage OR child-level targets set — leave as individual leaf trades.
      result.push(...group);
    }
  }
  return result;
}
