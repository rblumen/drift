// @vitest-environment jsdom
//
// Regression coverage for issue #152: the beta banner must be dismissible and
// the dismissal remembered persistently (a plain `rebalancer-beta-banner-dismissed`
// localStorage flag, separate from the `rebalancer-v1` AppState slot) so it
// stays gone across sessions/reloads once dismissed — not just for the
// current render.
//
// App.tsx reads localStorage at module scope (loadState() runs on import), so
// each test seeds storage first and then dynamically imports a fresh App module.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildState, saveState } from './store';
import { DEFAULT_STRATEGY } from './engine/strategy';
import type { Account, Position } from './engine/types';
// Warm the App module graph at collect time — see App.demo-mode.test.tsx for
// why (avoids a first-import timeout under full-suite CPU contention, #175).
import './App';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BETA_BANNER_DISMISSED_KEY = 'rebalancer-beta-banner-dismissed';

const REAL_ACCOUNT: Account = {
  id: 'real1', name: 'My Real Brokerage', institution: 'Schwab', type: 'TAXABLE',
};
const REAL_POSITION: Position = { accountId: 'real1', ticker: 'VTI', marketValue: 1000 };

let container: HTMLDivElement;
let root: Root | null = null;

// A saved portfolio on the device skips the marketing landing page and goes
// straight to the app shell (#147), where the beta banner lives.
function seedRealPortfolio(): void {
  saveState(buildState([REAL_ACCOUNT], [REAL_POSITION], DEFAULT_STRATEGY, {}));
}

async function renderApp(): Promise<void> {
  const { default: App } = await import('./App');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<App />); });
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

describe('issue #152 — beta banner is dismissible and remembered', () => {
  it('shows the beta banner by default', async () => {
    seedRealPortfolio();
    await renderApp();
    expect(document.body.textContent).toContain('Drift is in early beta');
  });

  it('dismissing the beta banner hides it and sets the persistence flag', async () => {
    seedRealPortfolio();
    await renderApp();
    expect(document.body.textContent).toContain('Drift is in early beta');

    const dismissBtn = [...document.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') === 'Dismiss beta banner');
    expect(dismissBtn, 'expected beta banner dismiss button not found').toBeTruthy();
    await act(async () => { dismissBtn!.click(); });

    expect(document.body.textContent).not.toContain('Drift is in early beta');
    expect(localStorage.getItem(BETA_BANNER_DISMISSED_KEY)).toBe('1');
  });

  it('the dismiss flag suppresses the beta banner on next render', async () => {
    seedRealPortfolio();
    localStorage.setItem(BETA_BANNER_DISMISSED_KEY, '1');
    await renderApp();
    expect(document.body.textContent).not.toContain('Drift is in early beta');
  });
});
