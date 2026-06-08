# Plan: Issue #89 — Increased specificity for asset-class placement

Generalize the flat `PlacementBucket` enum into a declarative **placement-target tree**,
then let placement preferences be expressed at any level of that tree — at minimum
distinguishing tax-deferred (Traditional/401k) from tax-free (Roth/HSA). Directly
analogous to the asset-class hierarchy work of #36 (PRs #53, #58).

See `research-89-placement-specificity.md` for the tree, the asset-location defaults,
and the per-class rationale.

---

## Background

A placement preference today is one of three flat buckets
(`TAXABLE | TAX_ADVANTAGED | EDUCATION`). `accountBucket(type)` in `placement.ts`
collapses Traditional IRA, 401(k), Roth IRA, HSA, and OTHER into a single
`TAX_ADVANTAGED` pool, so the most valuable asset-location decision —
tax-deferred vs. tax-free — cannot be expressed.

`Strategy.placement` is `Record<AssetClass, PlacementBucket[]>`: an ordered preference
list per class. `greedyPlace` fills accounts whose `accountBucket(a.type)` equals the
preferred bucket, in order; filling any bucket past index 0 is a `PLACEMENT_SPILLOVER`.

### The analogy to #36 — and where it differs

#36 generalized a hardcoded 2-level asset-class tree into a declarative `CLASS_HIERARCHY`
and let targets be set at any level. #89 is the placement-side mirror: a declarative
`PLACEMENT_HIERARCHY` whose nodes range from a broad bucket down to a leaf account type.

**Simpler than #36:** #36's hard part was redistributing *holdings* across four value
maps (`rollup.ts`, `consolidateParentClasses`, the four-map invariant). #89 has none of
that — there is no value to redistribute. The placement tree only affects which accounts
are *eligible* during the greedy fill, plus the spillover flag. No `rollup.ts`, no
`resolve.ts`, no consolidation pass.

**Subtler than #36 — spillover semantics:** today a spill is "landed in a bucket past
index 0." With nesting, a narrow account satisfying a *broad* preference is **not** a
spill (Roth ⊆ TAX_ADVANTAGED). The test must change from bucket-identity equality to
"did an account satisfying the stated primary preference absorb it." This is the one
place a naive change silently regresses behavior; it gets dedicated tests.

### Key safety property

`PlacementBucket` (`TAXABLE | TAX_ADVANTAGED | EDUCATION`) and `accountBucket()` stay
exactly as they are — they are the *tax-treatment* vocabulary that the tax-sale logic,
`isWithdrawalEligible`, `REVISIT_PLACEMENT`, and the Classify/Results bucket charts all
key on (`rebalance.ts:190,262,354,999,1023,1289`; `ClassifyPanel.tsx`). None of that is
touched. The new tree is *additive*: a separate `PlacementTarget` vocabulary for the
*preference* a strategy expresses.

---

## Phase 1 — Generic mechanism + tax-treatment subdivision  *(this PR)*

Delivers the #89 "minimum" (Traditional vs. Roth specificity) plus the reusable tree.
Per-account targeting (Phase 2) and custom account types (Phase 3) are out of scope.

### New file: `src/engine/placementHierarchy.ts`

Single source of truth for the placement tree, analogous to `hierarchy.ts`.

```ts
import type { AccountType } from './types';

export interface PlacementGroup {
  readonly children: readonly PlacementTarget[];
}

// Parent → children. Leaves are AccountTypes; interior nodes are buckets.
export const PLACEMENT_HIERARCHY: Partial<Record<PlacementTarget, PlacementGroup>> = {
  TAXABLE:        { children: ['TAXABLE' /* the account type */] },
  TAX_ADVANTAGED: { children: ['TAX_DEFERRED', 'TAX_FREE', 'OTHER'] },
  TAX_DEFERRED:   { children: ['TRADITIONAL_IRA', 'FOUR_OH_ONE_K'] },
  TAX_FREE:       { children: ['ROTH_IRA', 'HSA'] },
  EDUCATION:      { children: ['FIVE_TWENTY_NINE'] },
};

// Flatten a target node to the leaf AccountTypes beneath it (memoized).
export function descendantAccountTypes(target: PlacementTarget): AccountType[];

// The membership primitive greedyPlace filters on.
export function accountSatisfiesTarget(type: AccountType, target: PlacementTarget): boolean;

// True when the target is an interior bucket vs. a leaf account type.
export function isPlacementBucket(target: PlacementTarget): boolean;
```

Membership table is in research §2. `OTHER` is a direct leaf under `TAX_ADVANTAGED`
(satisfies `TAX_ADVANTAGED`, not `TAX_DEFERRED`/`TAX_FREE`) — preserves today's behavior.

### `src/engine/types.ts`

- `PlacementBucket` — **unchanged** (`TAXABLE | TAX_ADVANTAGED | EDUCATION`). Still what
  `accountBucket()` returns and what all tax logic keys on.
- New `PlacementTarget = PlacementBucket | 'TAX_DEFERRED' | 'TAX_FREE' | AccountType` —
  the closed union a `placement[ac]` entry may contain. Closed for Phase 1 (account-id
  leaves deferred to Phase 2), mirroring #36's "closed union now, open string later."
- `Strategy.placement` becomes `Record<AssetClass, PlacementTarget[]>`.
- `PLACEMENT_SPILLOVER` flag's `bucket` field is widened to `PlacementTarget` so it can
  report the narrower node a class actually spilled into.

### `src/engine/placement.ts`  *(the only engine logic change)*

1. **Eligibility filter (pass 1):** `accountBucket(a.type) === bucket` →
   `accountSatisfiesTarget(a.type, target)`.

2. **Spillover semantics (the subtle part):** a placed dollar is a spill **iff no
   account satisfying the *primary* preference `placement[ac][0]` absorbed it.** Track
   placement against the primary target's descendant set; anything landing outside it is
   the spill amount, flagged with the actual node it landed in. This makes
   "prefer TAX_ADVANTAGED, landed in Roth" emit no flag, while "prefer Roth, spilled into
   Traditional" flags correctly.

3. **`constraintCount` (refinement — deferred):** today it sorts by `placement[ac].length`.
   A narrow target (one account type) is more constrained than a broad bucket yet has the
   same list length, so Goal 6 ("most-constrained class placed first") could mis-order two
   single-element preferences. Switching the metric to the count of *household accounts
   that satisfy the primary target* is more faithful, but it reorders placement in
   existing scenarios and risked destabilizing the suite for no behavior the tier
   subdivision needs. **Left as list-length for Phase 1**; revisit if a real case surfaces.

`accountBucket()` is untouched and still used for the tax-treatment call sites. One
adjacent integration point did need updating: the taxable-sell redirect (Goal 7) hard-
checked `placement[ac][0] === 'TAX_ADVANTAGED'`, which stops matching once a class's
primary preference is the more specific `TAX_FREE`/`TAX_DEFERRED`. A new
`targetTaxTreatment(target)` helper (the target-level mirror of `accountBucket`) lets the
redirect fire for any sheltered-home preference regardless of tier.

### `src/ingest/schema.ts`

- Widen `PLACEMENT_BUCKETS` enum to the full `PlacementTarget` set
  (`+ TAX_DEFERRED, TAX_FREE, TRADITIONAL_IRA, ROTH_IRA, FOUR_OH_ONE_K, HSA,
  FIVE_TWENTY_NINE, OTHER`).
- Update `DEFAULT_PLACEMENT` to the asset-location defaults from research §3.
- **Migration & opt-in (critical):** the existing merge is
  `{ ...DEFAULT_PLACEMENT, ...savedPlacement }` — saved keys win. This already satisfies
  the user's constraint: an imported/saved strategy keeps every placement it specified;
  the new defaults only fill classes that strategy never gave a value for. **No forced
  upgrade.** A class saved as `['TAX_ADVANTAGED']` stays `['TAX_ADVANTAGED']`; it is
  *not* rewritten to the new `['TAX_FREE', …]` default. Add a regression test pinning
  this. The only path to the new defaults for an existing portfolio is the explicit
  reset control (below).

### `src/ui/StrategyPanel.tsx`

- **Hierarchical dropdowns:** placement options render as an `<optgroup>` labelled
  *Tax-Advantaged* containing the broad bucket plus the two tiers `Tax-Deferred
  (Traditional/401k)` and `Tax-Free (Roth/HSA)`, with `Taxable` and `Education (529)` as
  bare top-level options. Mirrors the `<optgroup>` pattern #36 added to Classify, and
  delivers the issue's "minimum" (the tier distinction).
- **Account-type leaves + household-driven visibility — deferred to Phase 2.** Offering
  *specific* account types (and only those the household holds) is most useful alongside
  per-account targeting and needs `accounts` threaded into the panel (a prop it doesn't
  currently receive). Phase 1 stops at the tier level; the engine and schema already
  accept account-type leaves, so Phase 2 is purely additive UI.
- **Explicit opt-in control:** a "Reset to recommended placement" button in the
  Placement-rules section overwrites `strategy.placement` with `DEFAULT_STRATEGY.placement`.
  This is the *only* way an existing portfolio adopts the new asset-location defaults.
- Child-class placement inheritance (`placementBuckets()` falling back to the parent
  *asset class*'s preference) is unchanged. `updatePlacement` keeps the 1st/2nd-choice
  slot model; the slot values are now `PlacementTarget`, not `PlacementBucket`.

### `src/ui/fmt.ts`

Add `BUCKET_LABEL` / `BUCKET_COLOR` entries for `TAX_DEFERRED`, `TAX_FREE`, and each
leaf account type (`TRADITIONAL_IRA`, `ROTH_IRA`, `FOUR_OH_ONE_K`, `HSA`,
`FIVE_TWENTY_NINE`, `OTHER`). Rename the map to reflect it now labels placement targets,
or add a parallel `PLACEMENT_TARGET_LABEL` and keep `BUCKET_LABEL` for the coarse charts.

### Testing priorities (Phase 1)

Per test hygiene this feature gets both unit and scenario coverage.

`src/engine/placement.test.ts` (extend or new):
- `accountSatisfiesTarget` membership for every node (research §2 table).
- Bonds preferring `TAX_DEFERRED` land only in Traditional/401k, never Roth.
- Equities preferring `TAX_FREE` land only in Roth/HSA.
- **Nested-spillover cases:** prefer `TAX_ADVANTAGED`, land in Roth → *no* flag;
  prefer `ROTH_IRA`, spill into Traditional → flag with the right node + amount.
- `NO_ELIGIBLE_ACCOUNT` when the household lacks the targeted type entirely.
- `constraintCount` ordering: a narrow-target class is placed before a broad one.

`src/engine/scenarios/10-placement-specificity/` (mirrors `06-tax-placement`):
- `roth-concentrates-growth.scenario.json` — equities target TAX_FREE, fill Roth first.
- `traditional-holds-taxable-coupon-bonds.scenario.json` — corp/treasury → tax-deferred.
- `narrow-target-spills-and-flags.scenario.json` — Roth too small, spill + flag.

Schema:
- `schema.test.ts` — saved `['TAX_ADVANTAGED']` placement survives migration unchanged
  (the no-overwrite guarantee); a strategy missing a class gets the new default.

`npm test` green, `tsc` clean, `npm run build` clean. UI smoke-tested in preview:
optgroup drill-down, visibility gated by household account types, reset-to-recommended.

### Changelog

`CHANGELOG.md` `[Unreleased] / Added`:
> Placement rules can now target tax-deferred (Traditional/401k) vs. tax-free (Roth/HSA)
> accounts, not just the broad tax-advantaged bucket. New portfolios get asset-location
> defaults (growth → Roth, taxable-coupon bonds → Traditional); existing saved
> placements are preserved — adopt the new defaults via "Reset to recommended placement."

---

## Phase 2 — Down to the specific account  *(future PR, depends on Phase 1)*

The #89 "preferred" tier. Let a `placement[ac]` entry name a specific account.

- Model account-id leaves as a tagged shape (e.g. `{ accountId: string }`) rather than
  widening the union to bare `string`, so the Zod schema stays validating and
  `accountSatisfiesTarget` gains one `target.accountId === account.id` branch.
- UI: the dropdown's leaf level lists the household's actual account names under each
  type group.
- **Graceful degradation:** a placement referencing a since-deleted account must fall
  back to its parent bucket and never silently drop the class. Visibility hides stale
  account leaves; the engine treats an unresolvable account target as its parent bucket.

---

## Phase 3 — Custom account types  *(the #89 "TBD"; deferred indefinitely)*

Same disposition as #36's custom-class Phase 3: runtime-defined account types require an
open type system, schema versioning, and threading through every `Record<…>` map and Zod
enum. Defer until demand is proven. `placementHierarchy.ts` is the single place it would
extend.
