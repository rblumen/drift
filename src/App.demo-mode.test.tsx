// @vitest-environment jsdom
//
// Regression tests for issue #112: demo mode must never overwrite the user's
// real saved portfolio. The autosave effect and the 5-minute backup writer are
// both suspended while isDemoMode is true, and dismissing the demo banner puts
// the persisted portfolio back in memory.
//
// App.tsx reads localStorage at module scope (loadState() runs on import), so
// each test seeds storage first and then dynamically imports a fresh App module.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildState, saveState } from './store';
import { DEFAULT_STRATEGY } from './engine/strategy';
import type { Account, Position } from './engine/types';
// Warm the App module graph at collect time (side-effect import, instance
// unused). Without this, the first per-test `await import('./App')` pays the
// transform + evaluation cost of the entire app graph inside that test's 5s
// timeout, which intermittently times out under full-suite CPU contention
// (#175). vi.resetModules() clears the module registry but not the transform
// cache, so the per-test re-imports below stay cheap.
import './App';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'rebalancer-v1';
const BACKUP_KEY = 'rebalancer-v1-backups';

const REAL_ACCOUNT: Account = {
  id: 'real1', name: 'My Real Brokerage', institution: 'Schwab', type: 'TAXABLE',
};
const REAL_POSITION: Position = { accountId: 'real1', ticker: 'VTI', marketValue: 1000 };

let container: HTMLDivElement;
let root: Root | null = null;

function seedRealPortfolio(): string {
  saveState(buildState([REAL_ACCOUNT], [REAL_POSITION], DEFAULT_STRATEGY, {}));
  const raw = localStorage.getItem(STORAGE_KEY);
  expect(raw).toContain('My Real Brokerage');
  return raw!;
}

async function renderApp(): Promise<void> {
  const { default: App } = await import('./App');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<App />); });
}

function clickButton(matcher: (b: HTMLButtonElement) => boolean): Promise<void> {
  const btn = [...document.querySelectorAll('button')].find(matcher);
  expect(btn, 'expected button not found in DOM').toBeTruthy();
  return act(async () => { btn!.click(); });
}

const byText = (text: string) => (b: HTMLButtonElement) =>
  (b.textContent ?? '').includes(text);

async function enterDemoFromLanding(): Promise<void> {
  // With a saved portfolio already on this device, #147 skips the landing
  // page on first render and goes straight to the app shell. The wordmark
  // click affordance still returns to the landing page on demand, so use
  // that to reach the "Try the demo" button.
  await clickButton(b => b.title === 'Back to Drift home');
  await clickButton(byText('Try the demo'));
  // Demo banner confirms we're inside the app in demo mode.
  expect(document.body.textContent).toContain('Demo — showing a synthetic');
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
  vi.useRealTimers();
});

describe('issue #112 — demo mode must not touch the saved portfolio', () => {
  it('entering the demo and changing state does not overwrite the primary save', async () => {
    const savedRaw = seedRealPortfolio();
    await renderApp();
    await enterDemoFromLanding();

    // Loading the sample portfolio replaced every persisted state slice — on the
    // pre-fix App the autosave effect fired on that change and wrote demo state
    // over the real save. With the fix the slot is byte-identical.
    expect(localStorage.getItem(STORAGE_KEY)).toBe(savedRaw);

    // Still untouched after navigating around inside the demo.
    await clickButton(byText('Accounts'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(savedRaw);
  });

  it('dismissing the demo banner restores the saved portfolio in memory', async () => {
    seedRealPortfolio();
    await renderApp();
    await enterDemoFromLanding();

    await clickButton(b => b.getAttribute('aria-label') === 'Exit demo and restore your saved portfolio');
    expect(document.body.textContent).not.toContain('Demo — showing a synthetic');

    // The real portfolio is back: the Accounts tab lists the saved account.
    await clickButton(byText('Accounts'));
    expect(document.body.textContent).toContain('My Real Brokerage');
    expect(localStorage.getItem(STORAGE_KEY)).toContain('My Real Brokerage');
  });

  it('the 5-minute backup writer skips demo state', async () => {
    seedRealPortfolio();
    vi.useFakeTimers();
    await renderApp();
    await enterDemoFromLanding();

    await act(async () => { vi.advanceTimersByTime(5 * 60 * 1000 + 1_000); });

    // The only 5-minute tick so far fired while in demo mode — with the fix the
    // writer skips it entirely, so no backup slot exists. Pre-fix, this key
    // holds demo state and starts rotating the real portfolio out of recovery.
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });
});
