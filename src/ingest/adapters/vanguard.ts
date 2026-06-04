// Vanguard brokerage holdings-CSV adapter — two ingest paths:
//
// 1. parseVanguardCsv      — assigns every row to one supplied accountId.
// 2. parseVanguardMultiCsv — groups rows by the per-row "Account Number"
//    column and returns the discovered accounts so the caller can map each to
//    an app account ID (mirrors the Fidelity multi-account flow).
//
// How to export: Log in → My Accounts → Transaction History → Download → choose
// the spreadsheet-compatible CSV. The brokerage holdings section is laid out as:
//   Account Number,Investment Name,Symbol,Shares,Share Price,Total Value,
// with a blank line separating each account's block (papaparse's skipEmptyLines
// drops those). The settlement/money-market fund (e.g. VMFXX) is a real ticker
// that already classifies as CASH, so no cash re-labelling is needed.
//
// Note: Vanguard's holdings CSV has no account-NAME column — only the account
// number — so discovered accounts surface by number in the mapping step.
//
// Out of scope (issue #20): the legacy mutual-fund-only export
// (`Fund Account Number,Fund Name,Price,Shares,Total Value`) has no Symbol
// column; we detect its absence and return a friendly error rather than silently
// importing nothing.
//
// Column names confirmed against 2023–2026 brokerage-format samples.
import { parseCsv, parseCsvMultiByAccount } from '../csv';
import type { CsvParseResult, MultiAccountResult } from '../csv';

const VANGUARD_COLUMNS = {
  accountNumber: 'Account Number',
  ticker:        'Symbol',
  marketValue:   'Total Value',
  description:   'Investment Name',
  price:         'Share Price',
} as const;

// The modern brokerage export carries a Symbol column; the legacy mutual-fund
// export does not. Guard so a wrong-format file fails loudly instead of quietly.
function hasSymbolColumn(csvText: string): boolean {
  const firstLine = csvText.replace(/\r\n/g, '\n').split('\n', 1)[0] ?? '';
  return /(^|,)\s*"?Symbol"?\s*(,|$)/.test(firstLine);
}

const LEGACY_FORMAT_ERROR =
  'This looks like the legacy Vanguard mutual-fund export (no Symbol column). ' +
  'Download the brokerage holdings CSV, which includes ticker symbols.';

export function parseVanguardCsv(csvText: string, accountId: string): CsvParseResult {
  if (!hasSymbolColumn(csvText)) return { positions: [], errors: [LEGACY_FORMAT_ERROR] };
  return parseCsv(csvText, accountId, VANGUARD_COLUMNS);
}

export function parseVanguardMultiCsv(csvText: string): MultiAccountResult {
  if (!hasSymbolColumn(csvText)) {
    return { discovered: [], positionsByNumber: {}, errors: [LEGACY_FORMAT_ERROR] };
  }
  return parseCsvMultiByAccount(csvText, VANGUARD_COLUMNS);
}
