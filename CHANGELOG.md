# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
