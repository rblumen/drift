// Schwab positions-CSV adapter.
//
// How to export: Accounts → Positions tab → Export (top-right link).
// The file starts with two metadata rows (account name and as-of timestamp)
// before the column header, which is why skipRows is 2.
//
// If Schwab changes their export format, adjust SCHWAB_COLUMNS and SCHWAB_SKIP_ROWS.
import { parseCsv, type CsvParseResult } from '../csv';

const SCHWAB_COLUMNS = {
  ticker:      'Symbol',
  marketValue: 'Market Value',
  description: 'Description',
  price:       'Price',
} as const;

const SCHWAB_SKIP_ROWS = 2;

export function parseSchwabCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, SCHWAB_COLUMNS, { skipRows: SCHWAB_SKIP_ROWS });
}
