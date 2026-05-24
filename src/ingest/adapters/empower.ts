// Empower asset-class totals helper — implemented in M2.
//
// Fastest ingest path: Empower's dashboard already groups holdings by asset
// class, so the user reads dollar totals per account directly off the
// Allocation/Holdings view instead of exporting a CSV.
//
// Tradeoff: Empower's taxonomy may not map 1-to-1 to our asset classes, and
// per-account detail can blur when Empower aggregates across sub-accounts.
export {}
