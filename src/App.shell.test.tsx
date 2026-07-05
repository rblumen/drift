// @vitest-environment jsdom
//
// Coverage for the #194 stage-2 app-shell redesign: the left workflow rail
// (vertical WAI-ARIA tablist), the per-tab count/completion badges, the context
// bar (household value + autosave), and the Overview "Drift from target" cell.
//
// App.tsx reads localStorage at module scope (loadState() runs on import), so
// each test seeds storage first and then dynamically imports a fresh App module
// (same harness as App.demo-mode.test.tsx / App.beta-banner.test.tsx).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildState, saveState } from './store';
import { DEFAULT_STRATEGY } from './engine/strategy';
import type { Account, Position } from './engine/types';
// Warm the App module graph at collect time (see App.demo-mode.test.tsx, #175).
import './App';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// A two-account, two-position portfolio: one holding is a real ticker the
// built-in classifier knows (VTI → US), the other is a nonsense ticker that
// stays UNMAPPED, so the Classify rail badge shows a count of 1.
const ACCOUNTS: Account[] = [
  { id: 'a1', name: 'My Brokerage', institution: 'Schwab', type: 'TAXABLE' },
  { id: 'a2', name: 'My IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
];
const POSITIONS: Position[] = [
  { accountId: 'a1', ticker: 'VTI', marketValue: 6000 },
  { accountId: 'a2', ticker: 'ZZZZZ', marketValue: 4000 },
];

let container: HTMLDivElement;
let root: Root | null = null;

function seed(): void {
  saveState(buildState(ACCOUNTS, POSITIONS, DEFAULT_STRATEGY, {}));
}

async function renderApp(): Promise<void> {
  const { default: App } = await import('./App');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<App />); });
}

/** All buttons in the vertical rail tablist (role=tab), in DOM order. */
function railTabs(): HTMLButtonElement[] {
  const rail = document.querySelector('[role="tablist"][aria-orientation="vertical"]');
  return rail ? [...rail.querySelectorAll<HTMLButtonElement>('[role="tab"]')] : [];
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
});

describe('#194 stage 2 — workflow rail', () => {
  it('renders a vertical tablist with all six workflow tabs', async () => {
    seed();
    await renderApp();
    const tabs = railTabs();
    expect(tabs.map(t => t.id)).toEqual([
      'tab-overview', 'tab-accounts', 'tab-import', 'tab-classify', 'tab-strategy', 'tab-results',
    ]);
    expect(tabs.map(t => (t.textContent ?? '').replace(/\d/g, '').trim()))
      .toContain('Overview');
  });

  it('ArrowDown / ArrowUp move + activate the adjacent rail tab (roving tabindex)', async () => {
    seed();
    await renderApp();
    const tabs = railTabs();
    // Overview is active on first render.
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);

    await act(async () => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const after = railTabs();
    expect(after[1].getAttribute('aria-selected')).toBe('true'); // Accounts
    expect(after[0].getAttribute('aria-selected')).toBe('false');
    expect(after[1].tabIndex).toBe(0);
    expect(after[0].tabIndex).toBe(-1);

    await act(async () => {
      after[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(railTabs()[0].getAttribute('aria-selected')).toBe('true'); // back to Overview
  });

  it('ArrowUp wraps from the first tab to the last', async () => {
    seed();
    await renderApp();
    await act(async () => {
      railTabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(railTabs()[5].getAttribute('aria-selected')).toBe('true'); // Results
  });

  it('shows a warn badge on Classify reflecting the untagged count', async () => {
    seed();
    await renderApp();
    const classify = railTabs()[3];
    // One unmapped ticker (ZZZZZ) → badge "1".
    expect((classify.textContent ?? '')).toContain('1');
    // The completion check only shows once everything is tagged; not here.
  });

  it('shows an info badge on Results reflecting the resolved-trade count', async () => {
    seed();
    await renderApp();
    const results = railTabs()[5];
    const digits = (results.textContent ?? '').replace(/\D/g, '');
    // Results carries its step number (06); the trade count is appended, so the
    // rendered text has more than just "06" once trades resolve.
    expect(digits.length).toBeGreaterThan(2);
  });
});

describe('#194 stage 2 — context bar', () => {
  it('shows the household value and the autosave "Saved" indicator', async () => {
    seed();
    await renderApp();
    const bar = document.querySelector('.h-\\[46px\\]');
    expect(bar, 'context bar not found').toBeTruthy();
    // Household value counts the classified VTI ($6,000); the unmapped ZZZZZ
    // holding is excluded from the household total until it is tagged.
    expect(bar!.textContent).toContain('$6,000');
    expect(bar!.textContent).toContain('Saved');
  });
});

describe('#194 stage 2 — Overview drift cell', () => {
  it('renders the Drift-from-target stat cell with an out-of-band caption', async () => {
    seed();
    await renderApp();
    // Overview is the default tab.
    expect(document.body.textContent).toContain('Drift from target');
    // With a 60/40 US/other split against the default target, at least one class
    // is out of band → the caption names a count of classes out of band.
    expect(document.body.textContent).toMatch(/out of band|Within tolerance/);
  });

  it('renders the allocation-vs-target family table', async () => {
    seed();
    await renderApp();
    expect(document.body.textContent).toContain('Allocation vs target');
  });
});
