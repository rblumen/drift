# Feature & Enhancement Backlog — Drift Rebalancer

> Sourced from r/Bogleheads, the Bogleheads wiki, and forum threads. Triaged against the existing `IMPLEMENTATION_PLAN.md`. Items already fully covered by the plan are omitted; items that extend or refine it are noted.

---

## P0 — Should reach v1 or v1.5 (direct core-logic gaps)

### 1. 5/25 Relative Tolerance Bands

**What:** The canonical Bogleheads rebalancing heuristic (Larry Swedroe) uses _two_ thresholds simultaneously:

- **Absolute band:** trigger if an asset class drifts ±5 percentage points from target.
- **Relative band:** trigger if an asset class drifts ±25% of its target weight (e.g., a 20% target triggers at 15% or 25%).

The rule is: whichever threshold is smaller wins. For small sleeves (targets < 20%), the relative band is tighter and fires first; for large sleeves (targets ≥ 20%), the absolute band fires first.

**Gap vs. plan:** The plan has only `toleranceAbs`. Add an optional `toleranceRel` field to `Strategy` (default `0.25`). Compute `effectiveTolerance[ac] = min(toleranceAbs, toleranceRel * targets[ac])` per class.

**Engine change:** Replace the single `toleranceAbs` comparison in Step 3 with a per-class effective tolerance. Backward-compatible if `toleranceRel` is optional.

---

### 2. Contribution-First Rebalancing Output

**What:** Bogleheads strongly prefer directing new contributions to underweight classes rather than selling appreciated assets. The plan correctly routes `newCash` to underweight classes in the engine, but the UI should surface a clear breakdown:

- How much rebalancing can be accomplished by deploying new cash alone.
- Which remaining drift still requires sells (and where those sells land).

**Gap vs. plan:** The engine computes this implicitly; the gap is in the Results panel — add an explicit "rebalanced by new money: $X" vs. "requires sales: $Y" summary row, along with a note that directing dividends in cash (not auto-reinvested) to underweight classes is a complementary no-sell strategy.

---

### 3. Tax-Advantaged-First Rebalancing Order (Explicit Flag)

**What:** Before recommending any taxable-account sale, the engine should exhaust rebalancing opportunities within tax-advantaged accounts. Bogleheads consistently note that you can exchange stock → bond in an IRA with zero tax consequence, whereas the same trade in taxable triggers capital gains.

**Gap vs. plan:** The placement algorithm already tends toward this, but the engine doesn't explicitly _sequence_ trade generation as "tax-advantaged first, taxable only as last resort." Add a `PREFER_TAX_ADVANTAGED_REBALANCE` flag (or make it the default) and a `TAXABLE_REBALANCE_AVOIDABLE` flag when the same imbalance could have been resolved entirely within tax-advantaged accounts.

---

### 4. Wash-Sale Cross-Account Warning

**What:** If the engine recommends selling an asset class at a loss in a taxable account while simultaneously buying the same (or substantially identical) fund in _any_ other account — including an IRA or 401k — the wash-sale rule disallows the loss. This applies across spouse accounts too.

**Gap vs. plan:** The plan flags `TAXABLE_SALE` but has no awareness of wash-sale risk. Add a `WASH_SALE_RISK` flag:

```ts
| { kind: 'WASH_SALE_RISK'; taxableAccountId: string; assetClass: AssetClass; buyAccountId: string }
```

Trigger when: a sell in a taxable account AND a buy of the same asset class occur in the same rebalance run. Add a note in the UI: "Selling in taxable and buying the same asset class in another account within 30 days may trigger a wash sale — consult your tax advisor."

---

### 5. 529 Biannual Rebalancing Limit Warning

**What:** 529 plans allow only two investment-option changes per calendar year. Any rebalance run that would touch a 529 account more than twice in a year should surface a warning.

**Gap vs. plan:** The `EDUCATION` bucket is modeled, but there is no constraint on rebalancing frequency for it. Add a `FIVE_TWENTY_NINE_CHANGE_LIMIT` flag when a 529 account has a non-zero trade recommendation, and display a reminder in the UI that the user should track their annual change count manually.

---

## P1 — High-Value Enhancements (v2 scope)

### 6. Tax-Adjusted Asset Allocation Mode

**What:** Equal dollar amounts across account types have different after-tax values. The Bogleheads wiki ("Tax-adjusted asset allocation") describes:

- Roth accounts: worth 100% of face value (already post-tax).
- Traditional IRA / 401k / Empower: worth `(1 − marginalRateAtRetirement)` of face value.
- Taxable accounts: worth `(1 − estimatedCapitalGainsTax)` of face value (a smaller haircut than pre-tax accounts).

**Why it matters:** A portfolio that looks 60/40 in nominal terms may actually be 65/35 or 55/45 in after-tax terms. The distortion is most significant when a large Roth balance exists alongside a large Traditional IRA.

**Suggested implementation:** Add an optional `taxAdjustment` object to `Strategy`:

```ts
taxAdjustment?: {
  enabled: boolean;
  marginalRateOrdinary: number;   // e.g. 0.24
  marginalRateLTCG: number;       // e.g. 0.15
}
```

When enabled, scale each account's market value before running the allocation engine, and show both nominal and tax-adjusted allocation in the Results panel.

---

### 7. HSA as a Distinct Tier ("Triple-Tax-Advantaged")

**What:** The HSA is triple-tax-advantaged (contributions pre-tax, growth untaxed, withdrawals tax-free for qualified medical). Many Bogleheads treat it as the best account type in the hierarchy and prioritize filling it with the most tax-inefficient assets (e.g., bonds or REITs).

**Gap vs. plan:** HSA maps to `TAX_ADVANTAGED` today, losing this distinction. Add a `HEALTH_SAVINGS` placement bucket (or a per-account `tier` rank) and adjust placement preferences to fill HSA first for FIXED_INCOME (or ALTERNATIVES). Emit a `HSA_UNDERUTILIZED` informational flag if the HSA exists but isn't holding its tier-optimal asset class.

---

### 8. Institution-Aware Fund Recommendations

**What:** The engine currently recommends "buy $X of US_TOTAL_MARKET in your Fidelity IRA." Bogleheads consistently map asset classes to specific low-cost index funds by institution. A ticker suggestion layer would make recommendations immediately actionable:

| Asset Class | Fidelity | Schwab | Vanguard |
|---|---|---|---|
| US_TOTAL_MARKET | FZROX / FSKAX | SWTSX | VTI / VTSAX |
| DEVELOPED_INTL | FZILX / FSPSX | SWISX | VXUS / VTIAX |
| EMERGING_INTL | FPADX | SCHC | VWO |
| FIXED_INCOME (taxable) | FTABX | SCHP | VWIUX (munis) |
| FIXED_INCOME (tax-adv) | FXNAX | SWAGX | BND |

**Suggested implementation:** A `src/data/fund-suggestions.json` lookup keyed by `(institution, assetClass, accountType)`. Displayed as a "Suggested Fund" column in the Results trade list. User-editable.

---

### 9. Dividend / Distribution Directed Rebalancing Mode

**What:** Instead of selling to rebalance, many Bogleheads redirect dividends and capital gain distributions to underweight asset classes. This avoids triggering taxable events entirely.

**Suggested feature:** A "Distribution Rebalancing" view in Results that shows, for each account, the estimated annual dividends (based on yield assumptions or user-entered yields) and recommends how to redirect them to close drift — before recommending any sell trades.

---

### 10. RMD-Aware Rebalancing Input

**What:** Required Minimum Distributions from Traditional IRA and 401k accounts force annual withdrawals once the account holder reaches RMD age. These mandatory outflows can be used strategically to rebalance by choosing which asset class to sell when satisfying the RMD.

**Suggested feature:** An optional `rmdRequired: number` field on `Account`. The engine should treat RMD amounts as mandatory sells from that account, preferentially liquidating overweight asset classes first. Surface a `RMD_REBALANCE_OPPORTUNITY` informational flag showing how much of the required RMD offsets drift.

---

## P2 — Longer-Term / Nice-to-Have

### 11. Glide Path / Scheduled Target Drift

**What:** A glide path gradually shifts the target allocation over time — typically reducing equity exposure as the investor approaches and enters retirement. Bogleheads debate the "to vs. through" retirement glide path and the counterintuitive "rising equity glidepath" in early retirement (to combat sequence-of-returns risk).

**Suggested feature:** An optional glide path schedule in `Strategy`:

```ts
glidePath?: Array<{ year: number; targets: Record<AssetClass, number> }>
```

The UI's Strategy panel would show where the user's current targets stand relative to their scheduled glide path and surface a `GLIDE_PATH_DEVIATION` flag if they've drifted from the schedule.

---

### 12. Spouse / Joint Household Account Grouping

**What:** Many households manage accounts for multiple people (spouses, partners). Bogleheads note that wash-sale rules apply across spouse accounts, and some couples prefer to track which accounts "belong" to whom for estate planning purposes, even while rebalancing at the household level.

**Suggested feature:** An optional `owner: 'primary' | 'spouse' | 'joint'` field on `Account`. The UI could show a sub-total by owner, and wash-sale checks should span both owners' accounts.

---

### 13. Retirement Drawdown / Spending Mode

**What:** Once in retirement, the user is spending from the portfolio rather than contributing. The tool should support a "drawdown mode" where the user enters annual spending needs and the engine recommends which accounts and asset classes to liquidate to fund expenses while maintaining the target allocation.

**Suggested feature:** A `annualSpending: number` input that the engine uses to compute a "spending-optimized sell list" — drawing from accounts in tax-optimal order (RMD-mandated first, then taxable, then traditional, then Roth).

---

### 14. Multi-Snapshot Drift History

**What:** The current tool is a one-shot calculator. Bogleheads who rebalance on a calendar (annual, semiannual) would benefit from seeing how their allocation has drifted across multiple saved snapshots — to understand whether drift is accelerating, which asset classes trend overweight, and whether their tolerance bands have been breached.

**Suggested feature:** Save each rebalance run to localStorage (or a JSON export) and display a simple allocation-over-time chart in the Results panel. This builds naturally on the M4 persistence milestone.

### 15. Aggressive/Diversification plot in Results
Add a simple 2d plot to the Household Allocation card of the "Results" pane showing points for before/after in conservative/aggressive and concentrated/diversified space, with a vector between them to show the impact of the rebalance.

---

### 16. Expense Ratio (Fee Load) Review and Flagging

**What:** Scan held funds for high expense ratios and surface a warning when a holding's fee exceeds a threshold.

**Open questions (TBD):**
- **Threshold approach:** fixed cutoff (e.g., > 0.50%), relative (above the median/average of held funds), or user-configured per strategy.
- **Data source:** expense ratio entered manually per ticker in config, or a bundled reference file keyed by ticker.
- **Flag level:** position-level, account-level, or both.
- **Severity:** hard advisory that annotates a recommended trade ("consider switching to a lower-cost equivalent"), or a standalone audit view separate from the rebalance results.
- **Engine flag:** a dedicated `HIGH_EXPENSE_RATIO` flag emitted per position, or a UI-layer concern only.

**Why it matters:** A well-allocated portfolio can be silently eroded by fund fees. This is especially relevant for funds held in legacy 401k plans (Empower) where cheap index options may not exist and the user needs explicit visibility.

---

### 17. UI Design Spruce-Up (Visual Polish + Logo/Icon)

**What:** A visual refresh pass once core functionality is stable — consistent spacing, typography, color palette, and a purpose-built logo/icon for the app.

**Scope ideas:**
- App logo/favicon (wordmark or icon — something that reads at 16px and 512px).
- Cohesive color system: brand accent, semantic colors for overweight/underweight/warning states.
- Typography scale cleanup (headings, table values, labels all feeling intentional).
- Card and panel layout tightening — reduce visual noise in the Results pane.
- Dark mode polish if not already consistent.

**When:** After M4 (persistence + full feature set). Polish last, not first.

---

### 18. Next-Rebalance Reminder Scheduler

**What:** Let the user set a reminder for when to run the next rebalance, displayed on the app's home screen and optionally exported to their calendar.

**Scope ideas:**
- User picks a date or interval (e.g., "remind me in 6 months", "next January 1st").
- Reminder stored in localStorage alongside the saved portfolio snapshot.
- On app load, show a banner if the reminder date has passed or is within N days: "Your last rebalance was X days ago — time to check drift."
- Optional: generate an `.ics` file the user can import into any calendar app (no external API calls, purely client-side).
- Pairs naturally with backlog #14 (multi-snapshot drift history).

---

## Already Covered by the Implementation Plan

The following commonly-discussed Bogleheads considerations are already handled in `IMPLEMENTATION_PLAN.md` and need no additional work:

- **Household-level (not per-account) rebalancing** — core design principle (§1).
- **Muni bonds in taxable** — encoded in `DEFAULT_STRATEGY` placement (§7).
- **Absolute tolerance band to suppress small trades** — `toleranceAbs` and `minTradeUsd` (§9).
- **Taxable sale warning** — `TAXABLE_SALE` flag (§5, §9).
- **REVISIT_PLACEMENT trigger** — fires when taxable outgrows the fixed income sleeve (§7, §9).
- **New cash deployed to underweight classes** — `newCash` field and engine Step 4 (§9).
- **Unmapped holding handling** — `UNMAPPED_HOLDING` flag (§9).
- **Alternatives split (crypto / precious metals)** — extension point noted for v2 (§7, §12).
- **No cost-basis tracking in v1** — explicitly deferred (§2).
- **Client-side only, no telemetry** — hard guardrail (§13).
- **Account-count minimization** — `greedyPlace` uses concentrate-then-spill: fills the largest-capacity eligible account first, spilling to additional accounts only when capacity is exhausted (backlog #17, `placement.ts`).
- **Trade-count minimization** — step 8.6 post-placement consolidation: greedily drops marginal trades (smallest first) whose removal keeps projected weights within `toleranceAbs`, with a compensating adjustment to the opposite-sign partner trade to preserve per-account net (backlog #16, `rebalance.ts`).

---

## Sources

- [Rebalancing — Bogleheads wiki](https://www.bogleheads.org/wiki/Rebalancing)
- [Tax-efficient fund placement — Bogleheads wiki](https://www.bogleheads.org/wiki/Tax-efficient_fund_placement)
- [Tax-adjusted asset allocation — Bogleheads wiki](https://www.bogleheads.org/wiki/Tax-adjusted_asset_allocation)
- [Wash sale — Bogleheads wiki](https://www.bogleheads.org/wiki/Wash_sale)
- [Tax loss harvesting — Bogleheads wiki](https://www.bogleheads.org/wiki/Tax_loss_harvesting)
- [Glide paths — Bogleheads wiki](https://www.bogleheads.org/wiki/Glide_paths)
- [5/25 Rebalancing Rule — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=463265)
- [Rebalancing bands, current drift discussion — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=184483)
- [Rebalancing with new contributions — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=365572)
- [Asset location among tax-advantaged accounts — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=299481)
- [Rebalancing in taxable isn't so simple — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=188848)
- [Wash sale rules apply to IRA — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=9997)
- [Rising equity glidepath in retirement — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=147318)
- [Rebalancing tools thread — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=171698)
- [Fancy rebalancing spreadsheet with many features — Bogleheads forum](https://www.bogleheads.org/forum/viewtopic.php?t=383677)
