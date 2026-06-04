// Content-based format detection for broker CSV exports.
//
// Each supported export carries a column-header (or first-cell) token that is
// unique among the formats we parse, so a single substring/line check picks the
// right adapter without relying on the file name or the account's institution.
// detectFormat() reads only the header region of the file. It returns null when
// nothing matches, so the caller can fall back to a manual choice.
//
// Signatures (token → format):
//   "Symbol,Last Price …"          → etrade   (positions header; preamble above it)
//   "COB Date"                     → merrill  (first quoted header column)
//   "Mkt Val (Market Value)"       → schwab   (distinctive market-value column)
//   "Investment Name"              → vanguard (brokerage holdings column)
//   "Account Number" + "Current Value" → fidelity
//   first cell "Holding"           → empower  (transposed layout)

export type DetectedFormat =
  | 'schwab' | 'fidelity' | 'vanguard' | 'etrade' | 'merrill' | 'empower';

export function detectFormat(csvText: string): DetectedFormat | null {
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = (text.split('\n', 1)[0] ?? '').trim();

  // E*TRADE: the positions header `Symbol,Last Price $,…` sits below a
  // variable-length preamble, so match it anywhere (not just line 1). The
  // `Symbol,Last Price` adjacency is unique — Schwab/Fidelity put Description
  // after Symbol, so they never produce this sequence.
  if (/(^|\n)\s*"?Symbol"?\s*,\s*"?Last Price/i.test(text)) return 'etrade';

  // Merrill Edge: "COB Date" is the first column and appears in no other export.
  if (text.includes('COB Date')) return 'merrill';

  // Schwab: the verbose market-value column header is unique to Schwab.
  if (text.includes('Mkt Val (Market Value)')) return 'schwab';

  // Vanguard: "Investment Name" is Vanguard's holding-description column
  // (Fidelity uses "Description", so there's no overlap).
  if (text.includes('Investment Name')) return 'vanguard';

  // Fidelity: per-row "Account Number" plus the "Current Value" column
  // (Vanguard uses "Total Value", Schwab "Mkt Val", so this pair is Fidelity).
  if (text.includes('Account Number') && text.includes('Current Value')) return 'fidelity';

  // Empower: transposed export whose first cell (row 0, col 0) is "Holding".
  if (/^"?Holding"?\s*,/.test(firstLine)) return 'empower';

  return null;
}
