# Portfolio Rebalancer

A local, browser-only tool for household-level investment rebalancing across multiple accounts (Empower, Schwab, Fidelity).

## What it does

- Ingests positions from multiple accounts via manual entry or CSV export
- Classifies holdings into asset classes
- Compares the household's combined allocation against an editable target strategy
- Produces placement-aware buy/sell recommendations per account (tax-advantaged vs. taxable)
- Persists your setup automatically in the browser (localStorage) and supports JSON export/import for backup

## Prerequisites

[Node.js](https://nodejs.org) 18 or later. Verify your installation:

```bash
node --version   # should print v18.x or higher
```

## Running locally

```bash
npm install      # first time only — installs dependencies
npm run dev      # starts the dev server
```

Then open **http://localhost:5173** in your browser. The app reloads automatically when you save a file.

To stop the server, press `Ctrl+C` in the terminal.

## Typical workflow

1. **Accounts tab** — Add each brokerage account (name, institution, type). Account type drives tax-placement rules (taxable vs. tax-advantaged).

2. **Import tab** — Select an account, then pick the matching format and load a CSV:
   - **Schwab**: Accounts → Positions tab → Export (top-right link)
   - **Fidelity**: Accounts & Trade → Portfolio → Download (CSV)
   - **Empower**: Copy the "My Investments" table into a `.csv` file, or use "Empower Totals" to enter asset-class dollar amounts by hand from the Allocation view

3. **Classify tab** — Any ticker not in the built-in map appears here. Assign it an asset class; the engine re-runs immediately.

4. **Strategy tab** — Edit target weights (must sum to 100%), tolerance band, and minimum trade size.

5. **Results tab** — See household current vs. target allocation and per-account buy/sell recommendations. Flags surface important conditions (taxable sale, placement spillover, strategy revisit prompt).

## Saving and sharing your setup

State is saved automatically in your browser's localStorage — closing and reopening the tab restores everything.

For backup or moving to another machine:

- **↓ Export** (header) — downloads a `portfolio-YYYY-MM-DD.json` file
- **↑ Import** (header) — loads a previously exported JSON file
- **✕ Reset** — clears all data and returns to defaults

The exported file contains your accounts, positions, strategy, and any custom ticker classifications. It does **not** leave your machine unless you choose to share it.

## Other commands

```bash
npm test         # run the engine and ingest unit tests (78 tests)
npm run build    # production build → dist/
```

## Deploying (optional)

The production build is a fully static site — no server required. After `npm run build`, the `dist/` folder can be hosted anywhere:

- **Drag-and-drop**: upload `dist/` to [Netlify Drop](https://app.netlify.com/drop), GitHub Pages, or any static host
- **Local file**: open `dist/index.html` directly in a browser (note: some browsers restrict local file access — the dev server is easier)

Because everything runs client-side, there is nothing to configure on the server.

## Privacy

All computation runs in your browser. No data is sent anywhere.

Real account data is never committed to git. Keep personal files under `/private/` or named `*.local.json` — both patterns are git-ignored. Only synthetic fixtures in `src/data/fixtures/` are committed.

## Architecture

`src/engine/` is pure TypeScript (no React) — all rebalancing math lives here and is unit-tested independently. UI and ingest adapters depend on the engine; the engine has no UI dependencies.

See `IMPLEMENTATION_PLAN.md` for the full build spec and design decisions.
