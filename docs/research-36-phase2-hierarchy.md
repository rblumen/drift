# Research: Issue #36 Phase 2 — Expanded Static Hierarchy

Status: **research deliverable** (precedes implementation). No engine code changes are
proposed here — this document defines *what* to add and *why*, so the implementation PR(s)
can follow the mechanical Phase-1 pattern. Authored 2026-06-02.

> **Decisions locked (2026-06-02, user):** Scope = **Phase 2a only** (FIXED_INCOME sub-types
> + DEVELOPED_INTL sub-regions + REAL_ESTATE); style/sector tilts deferred. `REAL_ESTATE` is a
> **top-level standalone sleeve**, *not* a child of ALTERNATIVES. DEVELOPED_INTL splits
> **Europe + Pacific** (Canada rides the parent catch-all). These are reflected inline below.

---

## 1. What Phase 2 must deliver (recap from the plan)

A broader set of predefined leaf classes under the existing declarative
`CLASS_HIERARCHY`, covering US equity sub-types, sectors, international sub-regions,
fixed-income sub-types, and real estate — each with:

- a position in the parent/child tree,
- `defaultWeights` sourced from index composition data,
- a curated ticker map,
- placement rules justified against `PRINCIPLES.md`,
- the same **visibility rule** (hidden until referenced by a target or a holding).

No schema migration is required for new leaves under existing parents (Phase-1 migration
already leaves an un-subdivided parent target intact).

---

## 2. The binding structural constraint (read this first)

The Phase-1 mechanism is **strictly two-level and single-parent**:

- `PARENT_CLASS` is a `child → parent` map — every leaf has **exactly one** parent.
- The UI/engine invariant is **parent XOR children carry weight** (a parent is either
  "collapsed" and carries its own weight, or "expanded" with weight in its children).
  This drives rollup redistribution, `consolidateParentClasses`, the pie/HHI/gauge math,
  and the StrategyPanel split/merge widget.
- There are no grandchildren. A three-level tree would break the binary expanded/collapsed
  state model and the consolidation pass.

**Consequence:** any new group must be a *clean partition of one slicing dimension*. The
model cannot represent a leaf that belongs to two parents at once. This rules out, as
children, anything that slices a dimension already sliced elsewhere:

| Candidate | Why it does **not** fit the single-parent model |
|---|---|
| `US_LARGE_CAP_GROWTH` / `_VALUE` | Style is orthogonal to cap. A "large-cap growth" fund is simultaneously a child of `US_LARGE_CAP` (cap) and of a hypothetical `US_GROWTH` (style). Single-parent can't hold both. |
| GICS sectors (`TECH`, `HEALTHCARE`, …) | Sectors slice *across* cap and style. A sector fund is large-cap-heavy but not a cap child; mapping it under `US_LARGE_CAP` is wrong, under `US_TOTAL_MARKET` double-buckets with the existing cap children. |

These are **tilts/overlays**, not partitions. Forcing them into the two-level tree would
corrupt the rollup invariant (double-counting). They are therefore **deferred** — see §6.
What remains are the dimensions that *are* clean partitions: geography (intl sub-regions),
fixed-income sector, and real estate as its own sleeve.

---

## 3. Proposed tree (Phase 2 = clean partitions only)

```
US_TOTAL_MARKET            (existing parent)
├─ US_LARGE_CAP
├─ US_MID_CAP
└─ US_SMALL_CAP

DEVELOPED_INTL             (PROMOTE to parent)
├─ DEVELOPED_EUROPE
└─ DEVELOPED_PACIFIC       (Japan + Australasia + Hong Kong/Singapore)
                           (Canada rides the parent catch-all — decision locked, §4.2)

FIXED_INCOME               (PROMOTE to parent)
├─ US_TREASURY
├─ US_CORP_BOND
├─ MUNI_BOND
├─ TIPS
└─ INTL_BOND

ALTERNATIVES               (existing parent, unchanged)
├─ CRYPTO
└─ PRECIOUS_METALS

REAL_ESTATE                (NEW top-level leaf — REITs; decision locked, §4.3)
EMERGING_INTL              (leaf, unchanged — no sub-region split in v1)
CASH                       (leaf, unchanged)
```

`EMERGING_INTL` stays a single leaf: most retail EM exposure is one fund (VWO/IEMG), and a
region split (China / India / Taiwan / LatAm) is rarely held discretely. Revisit if demand
appears.

---

## 4. Per-group detail

### 4.1 `FIXED_INCOME` → sub-types

Promote `FIXED_INCOME` from leaf to parent. This is the highest-value addition: fixed
income has the strongest *placement* differentiation (munis→taxable, the rest→tax-advantaged),
so sub-classing it lets the engine place each sleeve correctly instead of treating one
blended "fixed income" bucket.

**Children & default weights** — anchored on the Bloomberg US Aggregate (Treasury ~⅓ of the
Agg per Bloomberg; MBS and corporate the next-largest blocks), then adjusted for a typical
DIY allocation that adds munis (for taxable) and a TIPS sleeve the Agg omits:

| Leaf | defaultWeight | Rationale |
|---|---|---|
| `US_TREASURY` | 0.35 | Largest Agg component (~⅓ Treasuries). MBS folded in here for v1 (no separate MBS leaf — rarely held discretely by retail). |
| `US_CORP_BOND` | 0.25 | Investment-grade credit block of the Agg. |
| `MUNI_BOND` | 0.20 | Not in the Agg; carved out because it is the **taxable-account** fixed-income vehicle (see placement). |
| `TIPS` | 0.10 | Inflation-linked sleeve the Agg excludes; common DIY add. |
| `INTL_BOND` | 0.10 | Ex-US investment grade (BNDX-style, USD-hedged). |

Weights sum to 1.00. These are neutral starting points, fully user-editable.

**Ticker map** (extend `assetclass-map.json`; existing `FIXED_INCOME` tickers stay as the
parent-level catch-all):

| Leaf | Tickers |
|---|---|
| `US_TREASURY` | GOVT, VGIT, VGSH, VGLT, SCHO, SCHR, IEF, TLT, FUAMX |
| `US_CORP_BOND` | LQD, VCIT, VCSH, IGIB, FCBFX |
| `MUNI_BOND` | MUB, VTEB, VWITX, MUNY, TFI |
| `TIPS` | SCHP, VTIP, TIP, LTPZ, FIPDX |
| `INTL_BOND` | BNDX, BWX, IGOV, VTABX |

> Note: existing `MUNY → FIXED_INCOME` and `BND/AGG/FXNAX/SWAGX/VBTLX → FIXED_INCOME`
> mappings should be **re-pointed**: `MUNY → MUNI_BOND`; broad-Agg funds (BND/AGG/…)
> stay `FIXED_INCOME` (they ARE the blended parent — correct as parent-level holdings).

**Placement** (`PRINCIPLES.md` §6 — tax-preferred buckets; domain invariant "fixed income →
taxable (munis); equities + alternatives → tax-advantaged"):

| Leaf | placement | Justification |
|---|---|---|
| `MUNI_BOND` | `['TAXABLE']` | Tax-free coupon is wasted in a tax-advantaged account; munis are *the* taxable-bond vehicle. Inherits today's `FIXED_INCOME: ['TAXABLE']` intent. |
| `US_TREASURY` | `['TAX_ADVANTAGED', 'TAXABLE']` | Taxable coupon → shelter first; Treasuries are state-tax-free so spilling to taxable is benign. |
| `US_CORP_BOND` | `['TAX_ADVANTAGED']` | Fully taxable coupon → strongest case for sheltering. |
| `TIPS` | `['TAX_ADVANTAGED']` | Phantom-income (inflation accretion taxed annually) → must shelter. |
| `INTL_BOND` | `['TAX_ADVANTAGED']` | Taxable coupon, no muni equivalent. |

This sharpens the existing `REVISIT_PLACEMENT` invariant: the "fixed-income target weight"
the flag compares against should be the **sum of all FI children** when subdivided.

### 4.2 `DEVELOPED_INTL` → sub-regions

Promote to parent. MSCI EAFE/developed-ex-US is conventionally sliced Europe / Pacific.

**Children & default weights** — MSCI EAFE is roughly Europe ~64% / Japan ~22% /
Pacific-ex-Japan ~14%; folding Japan into a single Pacific sleeve:

| Leaf | defaultWeight | Rationale |
|---|---|---|
| `DEVELOPED_EUROPE` | 0.62 | UK, Eurozone, Switzerland, Nordics. |
| `DEVELOPED_PACIFIC` | 0.38 | Japan (the bulk) + Australia + Hong Kong/Singapore. |

> **Decision locked (§4.2): two children (Europe + Pacific).** VEA/VXUS include Canada and
> MSCI EAFE excludes it; rather than add a rarely-held `DEVELOPED_AMERICAS` sleeve, Canada
> rides inside the parent-level holding (the common case — most VXUS holders never subdivide).

**Ticker map:**

| Leaf | Tickers |
|---|---|
| `DEVELOPED_EUROPE` | VGK, IEUR, FLEE, EZU, HEDJ |
| `DEVELOPED_PACIFIC` | VPL, EWJ, BBJP, FLJP, EWA |

Broad developed funds (VEA, VXUS, EFA, SCHF, FSPSX, …) **stay `DEVELOPED_INTL`** as the
parent-level holding. (VXUS technically includes EM; that nuance is out of scope — it is
already mapped to `DEVELOPED_INTL` today and we are not changing that.)

**Placement:** children inherit the parent's `['TAX_ADVANTAGED', 'TAXABLE']`. Equities →
shelter first, spill to taxable. No change in intent; the existing placement-inheritance UI
(Phase 1) handles this automatically.

### 4.3 `REAL_ESTATE` — new top-level leaf (REITs)

**Decision locked: top-level standalone sleeve**, peer to `FIXED_INCOME` / `ALTERNATIVES` /
`EMERGING_INTL` — *not* a child of ALTERNATIVES. It is a plain leaf: no entry in
`CLASS_HIERARCHY`, no children, no split widget. `ALTERNATIVES` is therefore **unchanged**
(CRYPTO / PRECIOUS_METALS stay 0.50 / 0.50).

Because it is top-level, REAL_ESTATE needs its own `DEFAULT_STRATEGY` entries — a target
weight and a placement rule — not a `defaultWeight` inside a parent:

| Property | Value | Rationale |
|---|---|---|
| `targets.REAL_ESTATE` | `0.0` (default) | Hidden until the user opts in (sets a target) or holds a REIT fund — same visibility rule as every other leaf. Keeps simple portfolios clean. Other targets are unaffected (no re-normalization needed; the user reallocates if they add a REIT sleeve). |
| `placement.REAL_ESTATE` | `['TAX_ADVANTAGED']` | REIT dividends are non-qualified (ordinary-income taxed) → strong shelter case. Consistent with the domain invariant "equities + alternatives → tax-advantaged." |

**Ticker map:**

| Leaf | Tickers |
|---|---|
| `REAL_ESTATE` | VNQ, VNQI, SCHH, IYR, USRT, FREL, FSRNX |

> Trade-off accepted: as a standalone leaf REAL_ESTATE is more prominent and models real
> estate as a first-class allocation sleeve, at the cost of not appearing inside the
> ALTERNATIVES split/merge widget. This matches how most allocation frameworks treat REITs.

---

## 5. Implementation checklist (per the Phase-1 pattern)

For **each** new leaf, the mechanical six-step change (identical to how CRYPTO/PRECIOUS_METALS
were added — no new mechanism required):

1. `src/engine/types.ts` — add leaf to the `AssetClass` union **and** `ALL_ASSET_CLASSES`.
2. `src/engine/hierarchy.ts` — promote `FIXED_INCOME` and `DEVELOPED_INTL` to
   `CLASS_HIERARCHY` parents with their `children` + `defaultWeights`. **`REAL_ESTATE` is NOT
   added here** — it is a top-level leaf with no children. `ALTERNATIVES` is untouched.
3. `src/data/assetclass-map.json` — add the ticker rows above; **re-point** `MUNY → MUNI_BOND`.
4. `src/ingest/schema.ts` — add leaves to `ASSET_CLASSES` const + Zod enums; add
   `DEFAULT_PLACEMENT` entries (§4 tables, incl. `REAL_ESTATE: ['TAX_ADVANTAGED']`); add the
   `REAL_ESTATE: 0.0` target to `DEFAULT_STRATEGY`; confirm `migrateStrategyTargets` handles
   the two newly-promoted parents (it loops `CLASS_HIERARCHY` generically — should be free,
   but **add a migration test**: an old save with `FIXED_INCOME: 0.20` and no children must
   stay intact). Note the strategy-sum Zod refinement must include `REAL_ESTATE` in its total.
5. `src/ui/fmt.ts` — `AC_LABEL` + `AC_COLOR` for every new leaf (pick hues adjacent to the
   parent's: amber family for FI children, sky family for intl, etc.).
6. `src/ui/StrategyPanel.tsx` / `ResultsPanel.tsx` / `ClassifyPanel.tsx` — **no code change
   expected.** All three already iterate `CLASS_HIERARCHY` generically (optgroups, split/merge,
   nested rows, visibility). Verify live, don't rebuild.

### Test priorities (new for Phase 2)

- Rollup four-map propagation for the two newly-promoted parents (FI, DEVELOPED_INTL).
- `consolidateParentClasses`: a user holding MUB (MUNI_BOND) against a `FIXED_INCOME: 0.20`
  parent target must **not** generate spurious "sell MUNI_BOND / buy FIXED_INCOME" trades.
- Greenfield buy promotion: targeting `FIXED_INCOME` with no FI holdings → one parent-level
  "buy FIXED_INCOME", not five sub-class buys.
- Migration: old saves with leaf-level `FIXED_INCOME`/`DEVELOPED_INTL` targets unchanged.
- `REVISIT_PLACEMENT` uses the summed FI-children weight when subdivided.

---

## 6. Recommended phasing within Phase 2

Ship the clean partitions; defer the orthogonal tilts. **Scope locked to Phase 2a.**

- **Phase 2a (this PR) — clean partitions, zero new mechanism:**
  `FIXED_INCOME` sub-types, `DEVELOPED_INTL` sub-regions, and a top-level `REAL_ESTATE` leaf.
  Pure data + label additions on the Phase-1 rails. Highest value (FI placement), lowest risk.

- **Phase 2b (separate, only if wanted) — style & sector tilts:** growth/value and GICS
  sectors. These do **not** fit the single-parent two-level model (§2). Supporting them
  properly requires either (a) a multi-parent / tag-based taxonomy, or (b) treating tilts as
  *overlays* on top of a base class rather than children. That is a mechanism change closer in
  spirit to **Phase 3** (open taxonomy) than to Phase 2's "more leaves on the same rails."
  Recommend **not** attempting it inside the two-level model — document the limitation and
  gather demand first.

---

## 7. Decisions — resolved

1. **Canada in DEVELOPED_INTL** (§4.2): ✅ two children (Europe + Pacific); Canada rides the
   parent catch-all.
2. **REAL_ESTATE modeling** (§4.3): ✅ **own top-level sleeve** (not under ALTERNATIVES).
3. **Scope** (§6): ✅ **Phase 2a only** (FI sub-types + intl sub-regions + REAL_ESTATE);
   style/sector deferred.
4. **Treasury vs. MBS** (§4.1): fold MBS into `US_TREASURY` for v1 (*default; revisit only if
   a user wants a discrete `US_MBS` leaf*).

---

## Sources

- [S&P 500 sector weights (2026) — Westmount Fundamentals](https://westmountfundamentals.com/sp500-sector-weights)
- [S&P 500 GICS sector weightings (monthly) — MacroMicro](https://en.macromicro.me/charts/121244/sp-500-gics-sectors-weightings-monthly)
- [MSCI EAFE Index — MSCI](https://www.msci.com/indexes/index/990300)
- [MSCI EAFE — Wikipedia (region breakdown)](https://en.wikipedia.org/wiki/MSCI_EAFE)
- [Bloomberg US Aggregate Bond Index — Bogleheads](https://www.bogleheads.org/wiki/Bloomberg_US_Aggregate_Bond_Index)
- [Bloomberg US Aggregate Bond Index — Wikipedia](https://en.wikipedia.org/wiki/Bloomberg_US_Aggregate_Bond_Index)
