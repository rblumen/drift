// Fidelity positions-CSV adapter.
//
// How to export: Accounts & Trade → Portfolio → Download (CSV).
// The exported file begins directly with the column header on line 1 — no
// metadata preamble — followed by one row per position across all accounts in
// the view.  Rows with an empty Symbol (e.g. "BROKERAGELINK", "Pending
// Activity") and negative values (pending settlements) are filtered by the
// generic parseCsv layer.
//
// Column names confirmed against the 2026-05 Fidelity export format.
// If Fidelity changes their export, adjust FIDELITY_COLUMNS and FIDELITY_SKIP_ROWS.
import { parseCsv, type CsvParseResult } from '../csv';

const FIDELITY_COLUMNS = {
  ticker:      'Symbol',
  marketValue: 'Current Value',
  description: 'Description',
  price:       'Last Price',
} as const;

const FIDELITY_SKIP_ROWS = 0;

export function parseFidelityCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, FIDELITY_COLUMNS, { skipRows: FIDELITY_SKIP_ROWS });
}
