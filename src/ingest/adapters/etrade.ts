// E*TRADE positions-CSV adapter (single account per file).
//
// How to export: us.etrade.com → Portfolios → Positions tab → select an account
// → Download (CSV); choose "Collapsed View" and "All Positions".
//
// The export is not a plain table: it opens with a variable-length preamble (an
// "Account Summary" block, then a "View Summary / Filters applied" block) before
// the real positions header. The preamble's *length differs between exports*, so
// a fixed skipRows won't do — we scan for the positions header line instead:
//
//   Symbol,Last Price $,Change $,Change %,Quantity,Price Paid $,Day's Gain $,Total Gain $,Total Gain %,Value $
//
// and slice from there. Two footer wrinkles the row filters must handle:
//   • a "TOTAL" subtotal row whose Symbol is space-free (so it survives the
//     generic filter) — dropped via dropTickers.
//   • a "CASH" sweep row carrying only Value $ — re-labelled to ETRADE_CASH so
//     the balance is captured (it classifies as CASH).
// The trailing "Generated at … ET" line is dropped by the space-in-ticker rule.
//
// Column names confirmed against 2023–2026 PortfolioDownload samples.
import { parseCsv, type CsvParseResult } from '../csv';

const ETRADE_COLUMNS = {
  ticker:      'Symbol',
  marketValue: 'Value $',
  price:       'Last Price $',
} as const;

// Unique prefix of the positions header. Distinguishes it from the preamble's
// filter row, which also starts with "Symbol," (Symbol,Security type(s),…).
const HEADER_PREFIX = 'Symbol,Last Price';

const ETRADE_CASH = { label: 'CASH', ticker: 'ETRADE_CASH' } as const;

export function parseEtradeCsv(csvText: string, accountId: string): CsvParseResult {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headerIdx = lines.findIndex(l => l.trim().startsWith(HEADER_PREFIX));

  if (headerIdx < 0) {
    return {
      positions: [],
      errors: ['E*TRADE: could not find the positions header row ' +
               '(expected a line starting with "Symbol,Last Price $").'],
    };
  }

  const body = lines.slice(headerIdx).join('\n');
  return parseCsv(body, accountId, ETRADE_COLUMNS, {
    cashRow:     ETRADE_CASH,
    dropTickers: ['TOTAL'],
  });
}
