// Fidelity positions-CSV adapter.
//
// How to export: Accounts & Trade → Portfolio → Download (CSV).
// The exported file begins directly with the column header on line 1 — no
// metadata preamble — followed by one row per position across ALL accounts
// visible in the current view (Account Number + Account Name columns identify
// each account).
//
// Single-account use: parseFidelityCsv(text, accountId) — same API as the
// Schwab/Empower adapters; all rows are assigned to the given accountId.
//
// Multi-account use: parseFidelityMultiCsv(text) — groups rows by Account
// Number and returns the discovered accounts so the caller can map each group
// to an app account ID before committing positions.
//
// Column names confirmed against the 2026-05 Fidelity export format.

import Papa from 'papaparse';
import { parseCsv, parseMoney } from '../csv';
import type { CsvParseResult } from '../csv';
import { positionSchema } from '../schema';
import type { Position } from '../../engine/types';

// ── Column name constants ─────────────────────────────────────────────────────

const COL = {
  accountNumber: 'Account Number',
  accountName:   'Account Name',
  ticker:        'Symbol',
  marketValue:   'Current Value',
  description:   'Description',
  price:         'Last Price',
} as const;

// ── Single-account adapter (backward-compatible) ──────────────────────────────

export function parseFidelityCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, {
    ticker:      COL.ticker,
    marketValue: COL.marketValue,
    description: COL.description,
    price:       COL.price,
  });
}

// ── Multi-account adapter ─────────────────────────────────────────────────────

/** One account discovered inside a Fidelity CSV. */
export interface FidelityDiscoveredAccount {
  accountNumber: string;
  accountName:   string;
}

/**
 * Result of parsing a Fidelity CSV that may contain multiple accounts.
 *
 * `positionsByNumber` keys are the raw Fidelity account numbers (e.g.
 * "X12-345678"). Each position has `accountId` set to that account number as
 * a placeholder — callers must remap to real app account IDs before storing.
 */
export interface FidelityMultiResult {
  /** Accounts found in the file, in order of first appearance. */
  discovered:        FidelityDiscoveredAccount[];
  /** Positions grouped by Fidelity account number (placeholder accountId). */
  positionsByNumber: Record<string, Position[]>;
  errors:            string[];
}

export function parseFidelityMultiCsv(csvText: string): FidelityMultiResult {
  const normalised = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(
    normalised, { header: true, skipEmptyLines: true },
  );

  const errors: string[] = parseErrors
    .filter(e => e.type !== 'FieldMismatch')
    .map(e => `CSV parse error: ${e.message}`);

  // Preserve account order of first appearance.
  const discoveredOrder: string[]           = [];
  const discoveredNames: Record<string, string>  = {};
  const positionsByNumber: Record<string, Position[]> = {};

  for (const [i, row] of data.entries()) {
    const accountNumber = row[COL.accountNumber]?.trim();
    const accountName   = row[COL.accountName]?.trim() ?? '';
    const ticker        = row[COL.ticker]?.trim().replace(/\*+$/, '');
    const marketValue   = parseMoney(row[COL.marketValue]);
    const price         = parseMoney(row[COL.price]);
    const description   = row[COL.description]?.trim();

    if (!accountNumber) continue;

    if (!positionsByNumber[accountNumber]) {
      discoveredOrder.push(accountNumber);
      discoveredNames[accountNumber] = accountName;
      positionsByNumber[accountNumber] = [];
    }

    // Same row filters as the generic parseCsv layer:
    // skip footer rows, pending activity, zero/negative values.
    if (
      !ticker || ticker === '--' || ticker.includes(' ') ||
      isNaN(marketValue) || marketValue <= 0
    ) continue;

    const result = positionSchema.safeParse({
      accountId: accountNumber,   // placeholder — remapped by caller
      ticker,
      description,
      marketValue,
      price: price && !isNaN(price) && price > 0 ? price : undefined,
    });

    if (result.success) {
      positionsByNumber[accountNumber].push(result.data as Position);
    } else {
      errors.push(`Row ${i + 1} (${ticker ?? '?'}): ${result.error.message}`);
    }
  }

  const discovered = discoveredOrder.map(num => ({
    accountNumber: num,
    accountName:   discoveredNames[num],
  }));

  return { discovered, positionsByNumber, errors };
}
