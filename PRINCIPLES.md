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

**5. Suppress trivial drift.**
Classes within `±toleranceAbs` of target are left alone entirely — no trades are generated for them in any account.

**6. Place asset classes in their tax-preferred buckets.**
Most-constrained classes (fewest eligible bucket options) are placed first. If a preferred bucket is full, a class spills into the next preferred bucket, then into any eligible account. Spillover is flagged.

---

## Secondary Objectives

**7. Minimize taxable sells.**
Sells in taxable accounts are avoided or redirected to tax-advantaged accounts wherever possible.

**8. Distribute proportionally by remaining capacity.**
Among equally eligible accounts within the same placement bucket, dollars are split in proportion to each account's remaining unfilled capacity.

**9. Fill `concentrateClasses` accounts before general accounts.**
Within the same placement bucket, accounts designated to concentrate a class are filled ahead of others.

---

## Low-Priority / Simplicity Objectives

**10. Minimize the number of trades.**
Prefer solutions that achieve the target allocation with fewer individual buy/sell orders. Dust trades below `minTradeUsd` are always suppressed. *(Algorithmic enforcement of broader trade minimization is a planned enhancement — see `FEATURE_BACKLOG.md`.)*

**11. Minimize the number of accounts touched.**
Prefer concentrating trades in fewer accounts when the allocation outcome is otherwise equivalent. *(Not yet enforced algorithmically — see `FEATURE_BACKLOG.md`.)*
