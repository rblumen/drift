// Schwab positions-CSV adapter.
//
// How to export: Accounts → Positions tab → Export (top-right link).
// The exported file has exactly one metadata row (the "Positions for account …"
// timestamp line) followed by an empty line, then the column header.
// skipRows=1 drops the metadata line; papaparse's skipEmptyLines handles the
// blank gap before the header.
//
// Column names confirmed against the 2026-05 Schwab export format.
// If Schwab changes their export, adjust SCHWAB_COLUMNS and SCHWAB_SKIP_ROWS.
import { parseCsv, type CsvParseResult } from '../csv';

const SCHWAB_COLUMNS = {
  ticker:      'Symbol',
  marketValue: 'Mkt Val (Market Value)',
  description: 'Description',
  price:       'Price',
} as const;

const SCHWAB_SKIP_ROWS = 1;

export function parseSchwabCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, SCHWAB_COLUMNS, { skipRows: SCHWAB_SKIP_ROWS });
}
