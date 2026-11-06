# Rebalancing Goals — Precedence Order

Goals and heuristics the engine applies when generating trade recommendations, listed from highest to lowest priority. When goals conflict, the higher-ranked goal wins.

---

## Hard Constraints (never overridden)

**1. Respect locked accounts and positions.**
Locked accounts generate zero trades. Individually locked positions are frozen in place and excluded from trade math.

**2. Respect per-account asset class restrictions.**
`allowedAssetClasses` (explicit) or `availableTickers` (derived) limit which classes can land in an account. No trade places a class in an account that can't hold it.

**3. Keep each account's trades balance-preserving.**
Buys and sells within an account must net to that account's `newCash` (zero if no contribution is being deployed). No phantom cash transfers in or out.

---

## Primary Objectives

**4. Hit the household-level target allocation.**
Target weights apply to all accounts combined, not per-account. This is the core design principle of the tool.

**5. Suppress trivial drift (Bogleheads 5/25 rule).**
Classes within their *effective* tolerance band are never sold. An in-band class is bought only when it is under target and money must land somewhere: idle or new cash, or proceeds from trimming an overweight out-of-band class, that no underweight out-of-band class can absorb. It then receives a buy-only top-up capped at its shortfall, so no surplus pushes an overweight class further above target (#252). The effective band is the tighter of two thresholds: an absolute band (`±toleranceAbs`) and a relative band (`±toleranceRel × target`). For large sleeves the absolute band wins; for small sleeves the relative band fires first. This band is the *trigger* — it decides **whether** a class has drifted enough to rebalance. How close to ideal the engine then lands is a separate, tighter *target* band (Goal 10).

**6. Place asset classes in their tax-preferred buckets.**
Most-constrained classes (fewest eligible bucket options) are placed first. If a preferred bucket is full, a class spills into the next preferred bucket, then into any eligible account. Spillover is flagged. A class configured with an empty bucket list ("no preference") is the least constrained — it is placed last, freely across whichever accounts have the most capacity, and its placement is never flagged as spillover.

---

## Secondary Objectives

**7. Minimize taxable sells.**
Sells in taxable accounts are avoided or redirected to tax-advantaged accounts wherever possible.

**8. Distribute by remaining capacity (largest first).**
Among equally eligible accounts within the same placement bucket, a class fills the account with the most remaining unfilled capacity first, then spills the remainder to the next-largest, and so on (`distributeConcentrate`, `placement.ts`). Capacity ties are broken deterministically by input order, so identical inputs always yield the same split. This concentrate-then-spill waterfall superseded the earlier proportional-spreading rule (backlog #17); it serves Goal 11 by keeping each class in as few accounts as possible.

**9. Fill `concentrateClasses` accounts before general accounts.**
Within the same placement bucket, accounts designated to concentrate a class are filled ahead of others.

---

## Low-Priority / Simplicity Objectives

**10. Minimize the number of trades.**
Prefer solutions that achieve the target allocation with fewer individual buy/sell orders. Dust trades below `minTradeUsd` are always suppressed. After balance correction, a consolidation pass greedily drops marginal trades whose removal keeps every projected weight within its *target* tolerance band (step 8.6, `rebalance.ts`). The target band is a tightened fraction of the trigger band from Goal 5 — `rebalanceTargetFraction × min(toleranceAbs, toleranceRel × target)` per class, defaulting to half. This deliberately keeps a few more trades than the trigger band would allow so a rebalance lands close to ideal, leaving drift headroom before it re-triggers (issue #42), rather than parking classes at the trigger edge.

**11. Minimize the number of accounts touched.**
Prefer concentrating trades in fewer accounts when the allocation outcome is otherwise equivalent. `greedyPlace` fills the largest-capacity eligible account first and spills to additional accounts only when that one is exhausted (concentrate-then-spill, `placement.ts`).
