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
npm test         # Vitest unit tests (engine + ingest)
npm run build    # production build → dist/
```

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

| Asset class | 1st choice | Rationale |
|---|---|---|
| Fixed Income | Taxable | Held as NY tax-free munis (e.g. MUNY) — federal + state exempt |
| Alternatives | Tax-Advantaged | Crypto/metals attract collectibles treatment; IRA shelter is valuable |
| Equities (all) | Tax-Advantaged | Long-term growth; tax deferral compounds over time |
| Cash | Taxable | Easiest to keep liquid in a brokerage |

### The placement compromise and its expiry trigger

The default strategy keeps bonds in taxable accounts and equities in tax-advantaged. This only holds while the taxable balance is small enough to be fully absorbed by the fixed-income sleeve (20% of household).

Once **taxable assets > Fixed Income target**, the taxable accounts can no longer be bonds-only. The engine detects this and emits a `REVISIT_PLACEMENT` flag. When you see it, update the placement rules to allow equities as a 2nd-choice for the taxable bucket.

---

## Flags reference

| Flag | What it means | Suggested action |
|---|---|---|
| `REVISIT_PLACEMENT` | Taxable share of household > Fixed Income target weight | Update placement rules in Strategy tab |
| `TAXABLE_SALE` | A recommended sell lands in a taxable account | Review for capital gain impact before executing |
| `PLACEMENT_SPILLOVER` | An asset class didn't fully fit its preferred bucket | Informational; the engine filled the next-best bucket |
| `NO_ELIGIBLE_ACCOUNT` | No account can hold a given asset class | Check account restrictions in Accounts tab |
| `UNMAPPED_HOLDING` | A ticker has no asset class | Go to Classify tab and assign one |
| `WITHIN_TOLERANCE` | A class is within ±tolerance of target | No trade generated for this class |

---

## Ingest adapters

| Source | How to export |
|---|---|
| **Schwab CSV** | Accounts → Positions tab → Export (top-right link) |
| **Fidelity CSV** | Accounts & Trade → Portfolio → Download (CSV). Supports multi-account files — the app maps each discovered account number to a registered account. |
| **Empower CSV** | Copy the "My Investments" table into a `.csv` file |
| **Empower Totals** | Enter dollar totals per asset class directly from Empower's Allocation/Holdings view. Fastest path when individual ticker detail isn't needed. |
| **Manual entry** | Enter ticker + market value directly. Use for any position not covered by a CSV adapter. |

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

- **All client-side.** No network calls, no telemetry, no backend.
- **No real data in the repo.** `/private/` and `*.local.json` are git-ignored. Only synthetic fixtures in `src/data/` are committed.
- **No credential automation.** CSV export and manual entry only; no scraping, no undocumented APIs.
- **Not investment advice.** This tool produces mechanical recommendations from your own inputs and strategy.

---

## Project structure

```
src/
├── engine/          # Pure TypeScript — no React. Fully unit-tested.
│   ├── types.ts     # Domain model (Account, Position, Strategy, Trade, …)
│   ├── strategy.ts  # DEFAULT_STRATEGY
│   ├── classify.ts  # ticker → AssetClass lookup
│   ├── rollup.ts    # positions → allocation (includes Russell cap split)
│   ├── placement.ts # greedy placement fill algorithm
│   ├── resolve.ts   # match trades to specific fund tickers
│   └── rebalance.ts # orchestrator → RebalanceResult
├── ingest/          # CSV adapters + zod schema validation
│   └── adapters/    # schwab, fidelity, empower, plaid (stub)
└── ui/
    ├── OverviewPanel.tsx   # orientation / cover-sheet tab
    ├── AccountsPanel.tsx
    ├── ImportPanel.tsx
    ├── ClassifyPanel.tsx
    ├── StrategyPanel.tsx
    ├── ResultsPanel.tsx
    └── HelpBox.tsx         # reusable collapsible help section
```

See `IMPLEMENTATION_PLAN.md` for the full build spec and design decisions.
