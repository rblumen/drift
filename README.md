# Drift — DIY Portfolio Rebalancer

A local, browser-only tool for household-level investment rebalancing across multiple accounts (Empower, Schwab, Fidelity). Runs entirely in your browser — no server, no login, no data leaves your machine.

---

## Prerequisites

[Node.js](https://nodejs.org) 18 or later. Verify: `node --version`

---

## Launching the app

### Windows — one double-click

Double-click **`launch.bat`** in the project folder. It will:
1. Run `npm install` automatically on first launch (skipped after that)
2. Start the Vite dev server in a minimised taskbar window
3. Open **http://localhost:5173** in your browser when ready

**To stop:** close the "Portfolio Rebalancer — Server" taskbar window, or press `Ctrl+C` inside it.

### Any platform — manual

```bash
npm install      # first time only
npm run dev      # http://localhost:5173
```

### Other commands

```bash
npm test         # Vitest unit tests (engine + ingest), single run
npm run test:ui  # same tests in a live browser dashboard (watch mode)
npm run build    # production build → dist/
```

`npm run test:ui` starts a Vitest server and prints a local URL (e.g. `http://localhost:51204/__vitest__/`) — open it to browse and re-run tests visually. It stays running in watch mode and re-runs on file changes; press `q` in the terminal to quit. Keep the terminal open while you use it: if the server stops, the browser tab shows **"Disconnected."** Run it from your own terminal so it stays alive.

### Static HTML report

To generate a self-contained report you can save or share (a snapshot, not a live server), use Vitest's HTML reporter:

```bash
npx vitest run --reporter=html    # writes the report to html/
npx vite preview --outDir html    # open it in a browser
```

This produces a static `html/` folder — no watch mode, no live connection, so it never shows "Disconnected." The folder is git-ignored. Regenerate it any time by re-running the first command.

---

## Five-step workflow

| Step | Tab | What you do |
|---|---|---|
| — | **Overview** | Read the orientation (workflow, assumptions, privacy) |
| 1 | **Accounts** | Register each account with its name, institution, and tax type |
| 2 | **Import** | Load positions via CSV export or manual entry |
| 3 | **Classify** | Assign an asset class to any unrecognized tickers |
| 4 | **Strategy** | Review and adjust target allocation and placement rules |
| 5 | **Results** | See household drift, per-account trade recommendations, and flags |

Results recalculate live as you change anything. The tool only produces recommendations — nothing is submitted to a broker.

---

## How the engine works

### Household-level, not account-by-account

Target weights apply to all accounts **combined**. The engine computes the household's dollar need per asset class, then decides *which account* should hold each dollar. It does **not** try to match percentages inside each account independently — this household-first approach is the whole point of the tool.

### Greedy placement fill

Asset classes are processed most-constrained first: the engine counts how many placement buckets each class is allowed to use (per its placement rule), and places classes with fewer options before classes with more options. This ensures the classes with the least flexibility claim their preferred space before more flexible classes compete for it. Ties in constraint count are broken by a stable fallback order (Fixed Income → Alternatives → International → US equity → Cash), but the primary sort is always driven by the strategy config.

For each class, the engine fills the preferred bucket first, spills to the next bucket if the first is exhausted, then spills to any remaining account if all preferred buckets are full.

A class can also be set to **No preference** (an empty placement rule). Such a class is the least constrained, so it is placed last — after every class with a required home has claimed its preferred space — and is filled freely into whichever accounts have the most capacity, regardless of account type. Because it has no preferred home to overflow from, its placement is never flagged as spillover. This suits tax-efficient, broadly-held classes (e.g. a total-market index fund) that work well in any account.

### Taxable-sale redirect

Before finalising the trade list, the engine attempts to move equity *sells* out of taxable accounts. It does this via a 4-way swap: if a taxable account would sell equities and a tax-advantaged account has room to absorb that delta (by selling less of those equities and buying more of something else), the engine redirects the sell. This is best-effort and operates within the household-net-zero constraint.

### US equity cap-class split

Holdings classified as `US_TOTAL_MARKET` (e.g. VTI, FZROX, FSKAX) are automatically redistributed to Large/Mid/Small Cap using the Russell index methodology:

| Sub-class | Russell weight |
|---|---|
| US Large Cap | 67% |
| US Mid Cap | 25% |
| US Small Cap | 8% |

The Strategy tab lets you set a single "US Total Market" percentage that splits automatically, or unlock the sub-classes and set them individually.

### Tolerance band (Bogleheads 5/25 rule)

Each asset class has an *effective* tolerance band — the tighter of two thresholds:

- **Absolute** (`toleranceAbs`, default ±5pp) — dominates for large sleeves.
- **Relative** (`toleranceRel`, default ±25% of the class's own target) — dominates for small sleeves.

For example, a 20% target tolerates 15–25% under the relative band (tighter than the absolute ±5pp); a 60% target tolerates 55–65% under the absolute band (tighter than the relative ±15pp). A class is left alone — no trades generated — as long as it sits inside its own effective band. Set `toleranceRel` to 100% to disable the relative band.

### Locked positions and accounts

- **Locked position** — counted in totals and weights; excluded from trades. Only the unlocked portion of each (account, class) slot is rebalanced.
- **Locked account** — all positions frozen; excluded from trade generation entirely (but still counted in household totals).

---

## Default strategy

Defaults in `src/engine/strategy.ts` reflect a specific household situation. Every value is editable in the Strategy tab.

### Target weights

| Asset class | Default |
|---|---|
| US Large Cap | 38.5% |
| US Mid Cap | 14.4% |
| US Small Cap | 4.6% |
| Developed Intl | 17.0% |
| Emerging Intl | 3.0% |
| Fixed Income | 20.0% |
| Alternatives | 2.5% |
| Cash | 0.0% |

Total US equity = 57.5%, expressed through the Russell cap split.

### Default placement rules

_Derived from `DEFAULT_PLACEMENT` in `src/engine/strategy.ts` (post-#89: equities and alternatives prefer tax-free before tax-deferred; bond sub-classes are no longer one-size-fits-all)._

| Asset class | Placement order | Rationale |
|---|---|---|
| Fixed Income (parent) | Taxable | Held as NY tax-free munis (e.g. MUNY) — federal + state exempt |
| Muni Bond | Taxable | Same as above — munis are tax-exempt, so taxable is efficient |
| US Treasury | Tax-Deferred → Taxable | Ordinary-income coupon; shelter first, taxable as overflow |
| US Corp Bond | Tax-Deferred | Ordinary-income coupon |
| TIPS | Tax-Deferred | Ordinary-income coupon; avoids phantom-income drag in taxable |
| Intl Bond | Tax-Deferred | Ordinary-income coupon |
| Alternatives (parent), Crypto, Precious Metals | Tax-Free → Tax-Deferred | High-growth/high-vol; collectibles tax treatment favors Roth shelter |
| Real Estate | Tax-Free → Tax-Deferred | REIT dividends are largely non-qualified; shelter in Roth, then tax-deferred |
| US equities (Total Market, Large/Mid/Small Cap), Emerging Intl | Tax-Free → Tax-Deferred → Taxable | Long-term growth; Roth shelter is most valuable, tax deferral next, taxable as overflow |
| Developed Intl (parent, Europe, Pacific) | Tax-Deferred → Taxable | Long-term growth; foreign tax credit makes taxable placement less costly than for other equities |
| Cash | Taxable → Tax-Advantaged | Easiest to keep liquid in a brokerage |

"Tax-Free" = Roth IRA / HSA. "Tax-Deferred" = Traditional IRA / 401(k). Each class's full placement order (including further fallbacks) is user-editable in the Strategy tab.

### When taxable outgrows the bond sleeve

The default keeps bonds in taxable and equities in tax-advantaged accounts. Once **taxable assets > Fixed Income target**, taxable can no longer be bonds-only, so the overflow follows each class's placement order — the default lists Taxable as a fallback for equities. That overflow is reported as `PLACEMENT_SPILLOVER` when it happens; it is an expected consequence of account sizes, not an error.

---

## Flags reference

_Derived from the `Flag` union in `src/engine/types.ts`._

| Flag | What it means | Suggested action |
|---|---|---|
| `TAXABLE_SALE` | A recommended sell lands in a taxable account | Review for capital gain impact before executing |
| `PLACEMENT_SPILLOVER` | An asset class didn't fully fit its preferred bucket | Informational; the engine filled the next-best bucket |
| `NO_ELIGIBLE_ACCOUNT` | No account can hold a given asset class | Check account restrictions in Accounts tab |
| `UNMAPPED_HOLDING` | A ticker has no asset class | Go to Classify tab and assign one |
| `WITHIN_TOLERANCE` | A class is within ±tolerance of target | No trade generated for this class |
| `EXCESS_CASH` | Household free cash couldn't be deposited anywhere (no eligible account, or deposit limits exhausted) | Add an account that accepts deposits, or raise a `depositLimitUsd` |
| `TAXABLE_REBALANCE_AVOIDABLE` | Tax-advantaged-first rebalancing is disabled, and this taxable sale could have been reduced/avoided by redirecting it | Enable "prefer tax-advantaged rebalance" in Strategy tab |
| `PROJECTED_OFF_TARGET` | After trades, a class is still outside its tolerance band — a hard constraint (locked positions, no eligible account, or a min-trade floor) blocked full correction | Review locked positions, account restrictions, or lower `minTradeUsd` |
| `WITHDRAWAL_SHORTFALL` | In drawdown mode, the requested withdrawal couldn't be fully raised — every withdrawal-eligible account is restricted, locked, or out of sellable capacity | Allow withdrawals from another account, or reduce the requested amount |
| `BLENDED_FUND_OVERSELL` | Selling a sub-class forced a proportional sale of a blended fund (e.g. a target-date fund) that over-sold another sub-class, with no eligible account to buy back the excess | Review the blended-fund holding; consider locking it or splitting into single-class funds |
| `BLENDED_FUND_SOLD` | Informational: part of a blended fund (TDF, balanced fund) was sold this run. The engine can't symmetrically buy blended funds, so repeated rebalances trend away from this holding | Lock the position if you want this blended-fund holding preserved |
| `MISSING_COST_BASIS` | Tax-adjusted allocation is enabled and this taxable position has no cost basis, so the engine assumed no gain (conservative fallback) | Enter cost basis on the position for a more accurate after-tax view |
| `WASH_SALE_RISK` | The engine recommends selling a class in a taxable account while buying the same class elsewhere in the same run — if the sale is a loss, the IRS wash-sale rule may disallow it | Review before executing; consider substituting a similar (not identical) fund |
| `FIVE_TWENTY_NINE_REBALANCE_LIMIT` | One or more trades touch a 529 account. The IRS allows only two investment-direction changes per 529 account per calendar year | Confirm you haven't already used both changes for the year |

---

## Ingest adapters

_Derived from the header comments in `src/ingest/adapters/*.ts`._

| Source | How to export |
|---|---|
| **Schwab CSV** | Accounts → Positions tab → Export (top-right link) |
| **Fidelity CSV** | Accounts & Trade → Portfolio → Download (CSV). Supports multi-account files — the app maps each discovered account number to a registered account. |
| **Empower CSV** | Copy the "My Investments" table into a `.csv` file |
| **Empower Totals** | Enter dollar totals per asset class directly from Empower's Allocation/Holdings view. Fastest path when individual ticker detail isn't needed. |
| **Vanguard CSV** | Log in → My Accounts → Transaction History → Download → spreadsheet-compatible CSV. Supports multi-account files (grouped by the row-level Account Number column). |
| **E*TRADE CSV** | us.etrade.com → Portfolios → Positions tab → select an account → Download (CSV); choose "Collapsed View" and "All Positions". Single account per file. |
| **Merrill Edge CSV** | Accounts → Holdings → click the lot-detail icon next to the Symbol column (includes cost basis) → Export → "Export as Comma-Separated Spreadsheet (.CSV)". Supports multi-account files (grouped by the row-level Account # column). |
| **Manual entry** | Enter ticker + market value directly. Use for any position not covered by a CSV adapter. |

Format detection (`src/ingest/detect.ts`) reads a CSV's header region and picks the right adapter automatically, without relying on the file name.

Plaid (direct brokerage connection) is a planned future feature; not implemented in v1.

---

## Account constraints

Per-account options in the Accounts tab:

- **Restrict investable classes** — limits which asset classes the engine may place here. Auto-suggested for 401(k) accounts. Restricted classes spill to other eligible accounts.
- **Concentrate here** — fills this account first for the listed classes before distributing proportionally to other accounts in the same bucket. Useful for concentrating alternatives in a specific IRA.

---

## Saving and sharing

State saves automatically to `localStorage` on every change. A timestamped backup snapshot is written every 5 minutes.

- **↓ Export** — downloads `portfolio-YYYY-MM-DD.json`. Keep a copy as a backup.
- **↑ Import** — restores from a previously exported JSON file.
- **✕ Reset** — clears all data and returns to defaults (irreversible).

---

## Deploying (optional)

After `npm run build`, the `dist/` folder is a fully static site. Drag it to [Netlify Drop](https://app.netlify.com/drop), GitHub Pages, or any static host — no server configuration required.

---

## Privacy and guardrails

- **All client-side.** No backend, no server-side processing of your data.
- **Your data never leaves your browser.** Holdings, account details, and dollar amounts stay in `localStorage` and are never transmitted anywhere. The only network traffic is anonymous, cookieless pageview counting (no personal or financial data, no cross-site tracking).
- **No real data in the repo.** `/private/` and `*.local.json` are git-ignored. Only synthetic fixtures in `src/data/` are committed.
- **No credential automation.** CSV export and manual entry only; no scraping, no undocumented APIs.
- **Not investment advice.** This tool produces mechanical recommendations from your own inputs and strategy.

---

## Project structure

_Walked from the current `src/` tree; see `CONTEXT.md` for the fully-annotated version._

```
src/
├── engine/               # Pure TypeScript — no React. Fully unit-tested.
│   ├── types.ts          # Domain model (Account, Position, Strategy, Trade, Flag, AssetClass, …)
│   ├── strategy.ts       # DEFAULT_STRATEGY + DEFAULT_PLACEMENT
│   ├── classify.ts       # ticker → AssetClass lookup
│   ├── hierarchy.ts      # asset-class parent/child tree + split weights
│   ├── rollup.ts         # positions → allocation (parent-class redistribution via hierarchy.ts)
│   ├── placement.ts      # greedy placement fill algorithm
│   ├── placementHierarchy.ts # PlacementTarget tree helpers (bucket/tax-deferred/tax-free/account)
│   ├── cashfill.ts       # concentrate-then-spill fill for deposits/withdrawals
│   ├── taxAdjust.ts      # tax-adjusted (after-tax) balance haircuts
│   ├── taxableSale.ts    # what counts as a taxable capital-gains sale
│   ├── nativeAllocation.ts # holdings-lens (native) allocation views
│   ├── metrics.ts        # diversification() / aggressiveness() summary metrics
│   ├── resolve.ts        # match trades to specific fund tickers
│   ├── rebalance.ts      # orchestrator → RebalanceResult
│   └── scenarios/        # black-box scenario fixtures (*.scenario.json) + harness
├── ingest/               # CSV adapters + zod schema validation
│   ├── detect.ts         # content-based format detection
│   └── adapters/         # schwab, fidelity, empower, vanguard, etrade, merrill, plaid (stub)
└── ui/
    ├── LandingPage.tsx      # marketing / home screen
    ├── OverviewPanel.tsx    # orientation / cover-sheet tab
    ├── AccountsPanel.tsx
    ├── PositionsPanel.tsx
    ├── ClassifyPanel.tsx
    ├── StrategyPanel.tsx
    ├── ResultsPanel.tsx
    ├── ReminderPanel.tsx    # next-rebalance reminder (calendar links + .ics)
    ├── HowItWorksDrawer.tsx
    ├── AllocationPlot.tsx   # diversification/aggressiveness plot
    └── HelpBox.tsx          # reusable collapsible help section
```

See `IMPLEMENTATION_PLAN.md` for the full build spec and design decisions.
