# Research: Issue #89 — Increased specificity for asset-class placement

Research deliverable preceding implementation, mirroring `research-36-phase2-hierarchy.md`.
Establishes the placement-target tree, the asset-location defaults we ship, and the
rationale for each — anchored to `PRINCIPLES.md` Goal 6 ("place asset classes in their
tax-preferred buckets") and Goal 7 ("minimize taxable sells").

---

## 1. The problem

Placement preferences today are one of three flat buckets:

```
TAXABLE | TAX_ADVANTAGED | EDUCATION
```

`accountBucket(type)` collapses five distinct account types into `TAX_ADVANTAGED`:

| Account type        | Today's bucket   |
|---------------------|------------------|
| `TAXABLE`           | `TAXABLE`        |
| `TRADITIONAL_IRA`   | `TAX_ADVANTAGED` |
| `FOUR_OH_ONE_K`     | `TAX_ADVANTAGED` |
| `ROTH_IRA`          | `TAX_ADVANTAGED` |
| `HSA`               | `TAX_ADVANTAGED` |
| `OTHER`             | `TAX_ADVANTAGED` |
| `FIVE_TWENTY_NINE`  | `EDUCATION`      |

That conflation makes the single most valuable asset-location decision inexpressible:
**tax-deferred (Traditional/401k) vs. tax-free (Roth/HSA).** The two are taxed
oppositely on the way out — Traditional withdrawals are ordinary income; Roth/HSA
qualified withdrawals are untaxed — so where a class sits inside "tax-advantaged"
materially changes after-tax wealth. The classic prescription:

- **Highest expected-growth assets → tax-free (Roth/HSA).** Every dollar of growth is
  never taxed again, so the most-appreciating sleeves get the most leverage from the
  Roth wrapper.
- **Taxable-coupon bonds and other ordinary-income sleeves → tax-deferred
  (Traditional/401k).** Their income would be taxed as ordinary income in a taxable
  account; sheltering them in a Traditional account defers that, and they have low
  expected growth so they "waste" little Roth space.
- **Munis and other tax-efficient income → taxable.** (Unchanged from today.)

## 2. The placement-target tree

We generalize the flat bucket into a tree whose nodes range from a broad tax-treatment
bucket down to a specific account type (Phase 1) and ultimately a specific account
(Phase 2, out of scope here).

```
TAXABLE
└── TAXABLE                       (account type; bucket == sole leaf)

TAX_ADVANTAGED
├── TAX_DEFERRED                  (intermediate)
│   ├── TRADITIONAL_IRA
│   └── FOUR_OH_ONE_K
├── TAX_FREE                      (intermediate)
│   ├── ROTH_IRA
│   └── HSA
└── (OTHER)                       (leaf directly under TAX_ADVANTAGED — see note)

EDUCATION
└── FIVE_TWENTY_NINE
```

Notes:
- **`OTHER`** has no clear tax-deferred/tax-free disposition, so it stays a direct child
  of `TAX_ADVANTAGED` — it satisfies a `TAX_ADVANTAGED` preference but neither
  `TAX_DEFERRED` nor `TAX_FREE`. This preserves today's behavior for `OTHER` accounts.
- **`HSA`** sits under `TAX_FREE`. A qualified HSA withdrawal is untaxed (and
  contributions were pre-tax), so for asset-location purposes it behaves like Roth —
  the most tax-advantaged wrapper available. This matches the tax-adjustment model
  already in `taxAdjust.ts`, which values Roth/HSA/529 at 100% of face.
- **`TAXABLE`** is both a bucket and its own sole leaf type. Harmless name reuse;
  membership resolves the same either way.

### Membership (the engine primitive)

An account *satisfies* a placement target when the account's type is a leaf descendant
of that target node:

| Target           | Satisfied by account types                                  |
|------------------|-------------------------------------------------------------|
| `TAXABLE`        | TAXABLE                                                     |
| `TAX_ADVANTAGED` | TRADITIONAL_IRA, FOUR_OH_ONE_K, ROTH_IRA, HSA, OTHER        |
| `TAX_DEFERRED`   | TRADITIONAL_IRA, FOUR_OH_ONE_K                             |
| `TAX_FREE`       | ROTH_IRA, HSA                                              |
| `EDUCATION`      | FIVE_TWENTY_NINE                                           |
| `TRADITIONAL_IRA`| TRADITIONAL_IRA (and so on for each leaf type)            |

A broad preference is satisfied by *any* descendant — so "prefer `TAX_ADVANTAGED`,
landed in Roth" is **not** a spillover; the preference was met. Only landing *outside*
the primary target's descendant set is a spill. This is the one behavioral subtlety the
implementation must get right (see plan §"Spillover semantics").

## 3. Asset-location defaults we ship

Per the user decision on #89, we ship opinionated defaults that encode the §1
prescription, **but they never overwrite a placement a saved or imported portfolio
already specifies** (see plan §"Migration & opt-in"). Defaults apply only to:
(a) brand-new strategies (`DEFAULT_STRATEGY`), and (b) classes a saved strategy never
gave a placement for.

Proposed `DEFAULT_PLACEMENT` deltas (only classes whose default changes are listed;
everything else keeps its current value):

| Class             | Today                          | Proposed                          | Rationale (Goal 6/7)                                   |
|-------------------|--------------------------------|-----------------------------------|-------------------------------------------------------|
| `US_TOTAL_MARKET` | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_FREE, TAX_DEFERRED, TAXABLE]`| Highest-growth core equity → Roth/HSA first.          |
| `US_LARGE_CAP`    | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_FREE, TAX_DEFERRED, TAXABLE]`| ″                                                     |
| `US_MID_CAP`      | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_FREE, TAX_DEFERRED, TAXABLE]`| Higher expected growth/vol → Roth.                    |
| `US_SMALL_CAP`    | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_FREE, TAX_DEFERRED, TAXABLE]`| ″                                                     |
| `EMERGING_INTL`   | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_FREE, TAX_DEFERRED, TAXABLE]`| Highest expected growth/vol sleeve → Roth.            |
| `REAL_ESTATE`     | `[TAX_ADVANTAGED]`             | `[TAX_FREE, TAX_DEFERRED]`         | Non-qualified REIT dividends; growth → Roth preferred.|
| `ALTERNATIVES`    | `[TAX_ADVANTAGED]`             | `[TAX_FREE, TAX_DEFERRED]`         | High-growth/high-vol → Roth.                          |
| `CRYPTO`          | `[TAX_ADVANTAGED]`             | `[TAX_FREE, TAX_DEFERRED]`         | Highest expected growth → Roth.                       |
| `PRECIOUS_METALS` | `[TAX_ADVANTAGED]`             | `[TAX_FREE, TAX_DEFERRED]`         | Collectibles rate in taxable; shelter → Roth.         |
| `US_CORP_BOND`    | `[TAX_ADVANTAGED]`             | `[TAX_DEFERRED]`                   | Ordinary-income coupons → Traditional/401k.           |
| `US_TREASURY`     | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_DEFERRED, TAXABLE]`          | Ordinary-income coupons → Traditional/401k.           |
| `TIPS`            | `[TAX_ADVANTAGED]`             | `[TAX_DEFERRED]`                   | Phantom-income accrual → Traditional/401k.            |
| `INTL_BOND`       | `[TAX_ADVANTAGED]`             | `[TAX_DEFERRED]`                   | Ordinary-income coupons → Traditional/401k.           |
| `DEVELOPED_INTL`  | `[TAX_ADVANTAGED, TAXABLE]`    | `[TAX_DEFERRED, TAXABLE]`          | Foreign-tax-credit value; modest growth → Traditional, but keep taxable as a tier so the credit isn't stranded.|

Unchanged defaults (kept verbatim):
- `FIXED_INCOME` (parent): `[TAXABLE]` — muni intent at the blended-bond level.
- `MUNI_BOND`: `[TAXABLE]`.
- `CASH`: `[TAXABLE, TAX_ADVANTAGED]`.

`DEVELOPED_INTL` placement is the one genuinely debatable call (foreign tax credit is
only usable in a taxable account, which argues for taxable; but its growth argues for
sheltering). We resolve it as **tax-deferred first, taxable second** so the credit is
captured on any spillover; flagged here for review.

These defaults are *starting points*, not prescriptions — exactly as the #36 hierarchy
default weights are described.

## 4. Explicit opt-in for existing portfolios

Because defaults must not silently rewrite a user's saved placement, the only way an
existing portfolio adopts the new asset-location defaults is an explicit action:
a **"Reset to recommended placement"** control in the Strategy panel's Placement-rules
section that overwrites the current `placement` map with `DEFAULT_PLACEMENT`. Absent
that click, migration preserves every existing entry (see plan §"Migration & opt-in").

## 5. Out of scope (this issue's deferred tiers)

- **Per-account targeting** (drill to a named account) — Phase 2.
- **Custom account types** (the issue's "TBD") — Phase 3, deferred indefinitely, same
  disposition as #36's custom-class Phase 3.
- **Style/sector-driven placement** — no tax-location rationale; not pursued.
