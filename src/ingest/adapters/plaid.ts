// STUB — Plaid Investments adapter (future, not implemented in v1).
//
// Plaid's /investments/holdings endpoint is the eventual push-button option,
// connecting underlying brokerages directly (not via Empower aggregation).
// Requirements before implementing:
//   - Plaid developer account and approved production access
//   - Fidelity access is behind a paid plan with a multi-week approval lead time
//   - A backend token-exchange server (Plaid Link tokens must not touch the client)
//
// Placeholder for a Plaid Investments adapter (spec-account-linking D20), if one is
// ever needed. Linking uses SnapTrade (src/ingest/adapters/snaptrade.ts). No credential automation.
export {}
