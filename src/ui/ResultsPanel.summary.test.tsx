// @vitest-environment jsdom
//
// #194 stage 4 — Results tab tests:
//  1. computeTurnover: the summary-strip turnover math (total absolute trade
//     dollars ÷ household value).
//  2. FlagStrip: renders the short tracking tag and keeps the full advisory
//     message reachable behind "See reasoning" (no information may be lost).
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { computeTurnover, FlagStrip, FLAG_META } from './ResultsPanel';
import type { Flag } from '../engine/types';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('computeTurnover (#194 summary strip)', () => {
  it('sums the absolute trade dollars and divides by household value', () => {
    const trades = [{ deltaUsd: 12_610 }, { deltaUsd: -11_240 }, { deltaUsd: 6_890 }];
    const { usd, pct } = computeTurnover(trades, 100_000);
    expect(usd).toBe(30_740);
    expect(pct).toBeCloseTo(0.3074, 6);
  });

  it('counts sells and buys alike (absolute value)', () => {
    // A pure swap: one sell offset by one buy still churns 2× the amount.
    const { usd } = computeTurnover([{ deltaUsd: -5_000 }, { deltaUsd: 5_000 }], 50_000);
    expect(usd).toBe(10_000);
  });

  it('returns 0% when household value is 0 (no divide-by-zero)', () => {
    const { usd, pct } = computeTurnover([{ deltaUsd: 1_000 }], 0);
    expect(usd).toBe(1_000);
    expect(pct).toBe(0);
  });

  it('is 0 for an empty trade list', () => {
    expect(computeTurnover([], 100_000)).toEqual({ usd: 0, pct: 0 });
  });
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(flag: Flag) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FlagStrip flag={flag} accounts={[]} />);
  });
  return container;
}

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
  container = null;
});

describe('FlagStrip (#194 flag strips)', () => {
  const sale: Flag = { kind: 'TAXABLE_SALE', accountId: 'schwab', assetClass: 'US_LARGE_CAP', amountUsd: 12_345 };

  it('renders the short tracking tag for the flag kind', async () => {
    const el = await render(sale);
    expect(el.textContent).toContain(FLAG_META.TAXABLE_SALE.tag); // "GAIN"
  });

  it('collapses the full message behind a "See reasoning" control', async () => {
    const el = await render(sale);
    // Collapsed: the toggle is present and the full sentence is NOT yet shown.
    const btn = [...el.querySelectorAll('button')].find(b => /See reasoning/.test(b.textContent ?? ''));
    expect(btn).toBeTruthy();
    expect(el.textContent).not.toContain('may trigger a capital gain');
  });

  it('reveals the full advisory message when expanded (no information lost)', async () => {
    const el = await render(sale);
    const btn = [...el.querySelectorAll('button')].find(b => /See reasoning/.test(b.textContent ?? ''))!;
    await act(async () => { btn.click(); });
    // The complete FlagBanner text — figures and all — is now reachable.
    expect(el.textContent).toContain('may trigger a capital gain');
    expect(el.textContent).toContain('12,345');
  });

  it('maps a danger-severity flag to its own tag', async () => {
    const noAcct: Flag = { kind: 'NO_ELIGIBLE_ACCOUNT', assetClass: 'ALTERNATIVES', amountUsd: 5000 };
    const el = await render(noAcct);
    expect(el.textContent).toContain(FLAG_META.NO_ELIGIBLE_ACCOUNT.tag); // "NO ACCOUNT"
  });
});
