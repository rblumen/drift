// Merrill Edge holdings-CSV adapter — two ingest paths:
//
// 1. parseMerrillCsv      — assigns every row to one supplied accountId.
// 2. parseMerrillMultiCsv — groups rows by the per-row "Account #" column and
//    returns the discovered accounts so the caller can map each to an app
//    account ID (mirrors the Fidelity multi-account flow).
//
// How to export: Accounts menu → Holdings → click the lot-detail icon to the
// left of the Symbol column (so cost basis is included) → Export → "Export as
// Comma-Separated Spreadsheet (.CSV)".
//
// The export's column header is on line 1 and every field is fully quoted; the
// account is identified per row by "Account #" with a human-readable "Account
// Nickname". Dollar fields carry thousands separators inside quotes
// ("12,300.00") which parseMoney already strips. There is no direct cost-basis
// column (only Unrealized Gain/Loss), so cost basis is left unset.
//
// Column names confirmed against a 2023–2026 Merrill Edge holdings sample.
import { parseCsv, parseCsvMultiByAccount } from '../csv';
import type { CsvParseResult, MultiAccountResult } from '../csv';

const MERRILL_COLUMNS = {
  accountNumber: 'Account #',
  accountName:   'Account Nickname',
  ticker:        'Symbol',
  marketValue:   'Value ($)',
  description:   'Security Description',
  price:         'Price ($)',
} as const;

export function parseMerrillCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, MERRILL_COLUMNS);
}

export function parseMerrillMultiCsv(csvText: string): MultiAccountResult {
  return parseCsvMultiByAccount(csvText, MERRILL_COLUMNS);
}
