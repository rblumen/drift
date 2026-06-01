# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **5/25 relative tolerance band** ([#2](https://github.com/rblumen/drift/issues/2)) — `Strategy.toleranceRel` (default 25%) sets a second tolerance band as a fraction of each class's target. The engine now uses whichever band is tighter per class (Bogleheads / Swedroe rule): the absolute band dominates for large sleeves, the relative band dominates for small sleeves. Existing strategies without `toleranceRel` default to 25%.
- **Strategy panel** — new "Relative tolerance" input alongside absolute tolerance, with help-box explanation of the 5/25 rule.
- **"No preference" placement option** ([#21](https://github.com/rblumen/drift/issues/21)) — an asset class can now be set to "No preference" in the placement rules, letting the engine place it wherever account capacity is largest without flagging the result as a spillover. Useful for tax-efficient, broadly-held classes that work in any account type.
- **Retirement drawdown / spending mode** ([#14](https://github.com/rblumen/drift/issues/14)) — raise cash from the portfolio by selling. Total withdrawal = **Σ RMDs** (required minimum distributions, entered manually per account) **+ an additional discretionary amount**. The engine takes RMDs first, then drains withdrawal-eligible accounts in a per-account **drain-priority** order (taxable → traditional → Roth by default, editable), selling down toward the target allocation. Each account gains a three-way **withdrawal eligibility** control — **Restricted / Eligible / Required** (Required reveals an RMD input) — defaulting to Restricted for tax-advantaged accounts (early-withdrawal penalties) and Eligible for taxable. Planned deposits (free cash) and withdrawals run independently in the same pass, netting per account. The Accounts tab shows planned deposits and withdrawals side by side; the Results tab and exported report show a spending-plan table. A new `WITHDRAWAL_SHORTFALL` flag fires when the additional amount can't be fully raised.

### Changed

- **Strategy panel** — the Target allocation and Placement rules cards are now collapsible; click the section heading to show or hide the card.
- **Per-account deposit limits** ([#30](https://github.com/rblumen/drift/issues/30)) — account deposit eligibility is now a three-way choice: **Open** (any share of household free cash), **Limited** (capped at a dollar amount), or **Closed** (none). Use "Limited" when a contribution limit is partly consumed — e.g. a Roth IRA with room left this year. Each account is clamped at its limit, and overflow spills to accounts with remaining room; anything that still can't be placed surfaces as `EXCESS_CASH`. An account's own new cash always deploys in full regardless of the limit. The Accounts table, Add/Edit forms, Results cash-deployment table, and exported HTML report all show the new state.
- **Free-cash routing now concentrates instead of spreading** ([#37](https://github.com/rblumen/drift/issues/37)) — household free cash is deployed into the single largest-capacity eligible account first, spilling to additional accounts only when a deposit limit forces it. Previously it was split across all eligible accounts in proportion to their value, which touched more accounts and generated more trades without improving the allocation. This minimizes the number of accounts traded (in line with the tool's trade-minimization goals).

## [0.1.0] - 2026-05-29

### Added

- **Rebalancing engine** (`src/engine/`) — pure TypeScript, fully unit-tested household-level rebalancer covering target-weight drift detection, greedy asset-class placement across account tiers (taxable / tax-advantaged / education), new-cash deployment to underweight classes, and absolute tolerance / minimum-trade filtering.
- **Ingest layer** (`src/ingest/`) — CSV adapters for Empower, Schwab, and Fidelity brokerage exports normalised into a single `Position` schema; manual entry fallback; institution-aware field parsing.
- **Five-panel UI** — Import, Classify, Strategy, Results, and Overview tabs wired end-to-end to the engine.
- **Strategy panel** — editable target weights with linked US cap-class sub-allocation, per-asset-class placement rules, tolerance band and minimum-trade controls, and new-cash input.
- **Results panel** — household allocation before/after side-by-side pie charts, per-account trade cards, engine flag annotations (`TAXABLE_SALE`, `REVISIT_PLACEMENT`, `UNMAPPED_HOLDING`, `PROJECTED_OFF_TARGET`, `WASH_SALE_RISK`, etc.), and a downloadable HTML report.
- **Placement ordering** — placement tier preference derived dynamically from strategy constraints rather than a fixed hierarchy; greedy fill concentrates trades into the fewest accounts and drops marginal trades that fall within tolerance.
- **Persistence** — auto-save to localStorage on every change; JSON export/import for manual backup; full portfolio reset.
- **Demo mode** — `?demo` URL parameter loads a synthetic sample portfolio for exploration without real data.
- **Engine flag: `PROJECTED_OFF_TARGET`** — warns when post-rebalance weights are projected to remain outside tolerance, with a stress-test suite.
- **GitHub Actions CI** — Vitest runs on every push and pull request.
- **Vercel deployment** — preview and production deploy configuration.

### Architecture

- Engine is framework-free; UI and ingest depend on the engine, never the reverse.
- All computation is client-side — no backend, no network calls, no telemetry.
- Synthetic fixtures only; real financial data is git-ignored.

[Unreleased]: https://github.com/rblumen/drift/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rblumen/drift/releases/tag/v0.1.0
