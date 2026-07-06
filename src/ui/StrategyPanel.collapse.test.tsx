// @vitest-environment jsdom
//
// Regression test for #194's stage-4 restyle (PR #198), which accidentally
// dropped the collapsibility of the Strategy tab's "Target allocation" and
// "Placement rules" cards (both were collapsible, default-open, since #31).
// Locks in that both sections still expose a header toggle button that
// flips `aria-expanded` and shows/hides the section body — mirroring the
// Results household-allocation collapse pattern. "Rebalance bands" is
// intentionally NOT collapsible (never was, pre- or post-redesign) and is
// asserted to have no toggle button.
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StrategyPanel } from './StrategyPanel';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { ALL_ASSET_CLASSES } from '../engine/types';
import type { AssetClass, Account } from '../engine/types';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS: Account[] = [
  { id: 'a1', name: 'Brokerage', institution: 'Schwab', type: 'TAXABLE' },
];

const ZERO_WEIGHTS = Object.fromEntries(
  ALL_ASSET_CLASSES.map(ac => [ac, 0]),
) as Record<AssetClass, number>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <StrategyPanel
        strategy={DEFAULT_STRATEGY}
        setStrategy={() => {}}
        accounts={ACCOUNTS}
        currentWeights={ZERO_WEIGHTS}
      />,
    );
  });
}

function headerButton(label: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll('button')].find(
    b => b.textContent?.trim().startsWith(label) && b.hasAttribute('aria-expanded'),
  );
  if (!btn) throw new Error(`No collapsible header button found for "${label}"`);
  return btn as HTMLButtonElement;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('StrategyPanel section collapsibility (#194 regression restore)', () => {
  it('Target allocation defaults open and collapses/expands via its header toggle', async () => {
    await render();
    const btn = headerButton('Target allocation');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // Body content — the "Sum ###%" footer — is visible while expanded.
    expect(container!.textContent).toContain('Sum ');
    expect(container!.textContent).toContain('Normalize to 100%');

    await act(async () => { btn.click(); });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(container!.textContent).not.toContain('Normalize to 100%');

    await act(async () => { btn.click(); });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(container!.textContent).toContain('Normalize to 100%');
  });

  it('Placement rules defaults open and collapses/expands via its header toggle', async () => {
    await render();
    const btn = headerButton('Placement rules');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(container!.textContent).toContain('Reset to recommended placement');

    await act(async () => { btn.click(); });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(container!.textContent).not.toContain('Reset to recommended placement');

    await act(async () => { btn.click(); });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(container!.textContent).toContain('Reset to recommended placement');
  });

  it('Rebalance bands stays non-collapsible (no header toggle button)', async () => {
    await render();
    const bandsHeading = [...container!.querySelectorAll('span')].find(
      s => s.textContent?.trim() === 'Rebalance bands',
    );
    expect(bandsHeading).toBeTruthy();
    // Its header is a plain span, not a toggle button — no aria-expanded anywhere
    // ties back to "Rebalance bands".
    const btn = [...container!.querySelectorAll('button')].find(
      b => b.textContent?.trim().startsWith('Rebalance bands') && b.hasAttribute('aria-expanded'),
    );
    expect(btn).toBeUndefined();
  });
});
