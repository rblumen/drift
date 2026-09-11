// @vitest-environment jsdom
//
// Stage 3 of #194 restructured the Import "Source" picker from three radio
// buttons into a segmented control in the SOURCE card header. These tests lock
// in that the segmented control still switches the input method (file → Empower
// totals → manual), which drives what the card body renders — the file drop
// zone vs. the per-class totals grid vs. the manual-entry row.
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PositionsPanel } from './PositionsPanel';
import type { Account, Position } from '../engine/types';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS: Account[] = [
  { id: 'a1', name: 'Brokerage', institution: 'Schwab', type: 'TAXABLE' },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(positions: Position[] = []): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PositionsPanel accounts={ACCOUNTS} positions={positions} setPositions={() => {}} />,
    );
  });
}

function segment(label: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll('button')].find(
    b => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`No segment button labelled "${label}"`);
  return btn as HTMLButtonElement;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

// React tracks an input's previous value on the DOM node itself, so setting
// `.value` directly and dispatching a plain 'input' event is a no-op from
// React's perspective. Go through the native setter to bypass that tracker,
// matching the standard React-without-testing-library typing shim.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
function typeInto(el: HTMLInputElement, value: string) {
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PositionsPanel per-account inline "+ Add position" (issue #222)', () => {
  it('adds a position to the correct account with a fresh lastUpdatedAt stamp, and supports rapid Enter entry', async () => {
    const existing: Position[] = [
      { accountId: 'a1', ticker: 'VTI', marketValue: 1000, lastUpdatedAt: 1 },
    ];
    let positions = existing;
    const setPositions = (p: Position[]) => { positions = p; };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PositionsPanel accounts={ACCOUNTS} positions={positions} setPositions={setPositions} />,
      );
    });

    // The trigger lives in the account header (issue #222); no entry row / ticker
    // input is shown until it's clicked.
    const toggle = [...container!.querySelectorAll('[role="button"]')].find(b => b.textContent?.trim() === '+ Position');
    expect(toggle).toBeTruthy();
    expect(container!.querySelector('input[aria-label^="Ticker for new position"]')).toBeNull();

    // Expand it.
    await act(async () => { (toggle as HTMLElement)!.click(); });
    const tickerInput = container!.querySelector('input[aria-label^="Ticker for new position"]') as HTMLInputElement;
    const mvInput = container!.querySelector('input[aria-label^="Market value for new position"]') as HTMLInputElement;
    expect(tickerInput).toBeTruthy();
    expect(mvInput).toBeTruthy();

    // Fill and commit via Enter.
    const before = Date.now();
    await act(async () => { typeInto(tickerInput, 'voo'); });
    await act(async () => { typeInto(mvInput, '5000'); });
    await act(async () => {
      mvInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const added = positions.find(p => p.ticker === 'VOO');
    expect(added).toBeTruthy();
    expect(added!.accountId).toBe('a1');
    expect(added!.marketValue).toBe(5000);
    expect(added!.lastUpdatedAt).toBeGreaterThanOrEqual(before);
    // The original VTI position is untouched.
    expect(positions.find(p => p.ticker === 'VTI')).toBeTruthy();

    // Rapid entry: the row stays open (draft cleared) after Enter — the
    // ticker input is still present and empty, ready for the next position.
    const tickerInputAfter = container!.querySelector('input[aria-label^="Ticker for new position"]') as HTMLInputElement;
    expect(tickerInputAfter).toBeTruthy();
    expect(tickerInputAfter.value).toBe('');
  });

  it('Escape collapses the inline row without adding anything', async () => {
    const existing: Position[] = [
      { accountId: 'a1', ticker: 'VTI', marketValue: 1000, lastUpdatedAt: 1 },
    ];
    let positions = existing;
    const setPositions = (p: Position[]) => { positions = p; };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PositionsPanel accounts={ACCOUNTS} positions={positions} setPositions={setPositions} />,
      );
    });

    const toggle = [...container!.querySelectorAll('[role="button"]')].find(b => b.textContent?.trim() === '+ Position')! as HTMLElement;
    await act(async () => { toggle.click(); });
    const tickerInput = container!.querySelector('input[aria-label^="Ticker for new position"]') as HTMLInputElement;
    await act(async () => { typeInto(tickerInput, 'VOO'); });
    await act(async () => {
      tickerInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container!.querySelector('input[aria-label^="Ticker for new position"]')).toBeNull();
    expect(positions).toBe(existing); // setPositions never called
  });
});

describe('PositionsPanel source segmented control', () => {
  it('defaults to the file method with a drop zone and format select', async () => {
    await render();
    // The file method shows the browse/drop affordance and the format select.
    expect(container!.textContent).toContain('Drop a broker CSV here');
    expect(container!.querySelector('input[type="file"]')).not.toBeNull();
    // The three segments are present with the file one selected.
    expect(segment('Import from file').getAttribute('aria-selected')).toBe('true');
    expect(segment('Class totals').getAttribute('aria-selected')).toBe('false');
    expect(segment('Manual entry').getAttribute('aria-selected')).toBe('false');
  });

  it('switches to the class-totals method when its segment is clicked', async () => {
    await render();
    await act(async () => { segment('Class totals').click(); });
    expect(segment('Class totals').getAttribute('aria-selected')).toBe('true');
    // Class-totals body shows its instructions + Load totals button; the drop zone is gone.
    expect(container!.textContent).toContain('Load totals');
    expect(container!.textContent).not.toContain('Drop a broker CSV here');
  });

  it('switches to the manual-entry method when its segment is clicked', async () => {
    await render();
    await act(async () => { segment('Manual entry').click(); });
    expect(segment('Manual entry').getAttribute('aria-selected')).toBe('true');
    // Manual body shows the ticker/value inputs and an Add button.
    const addBtn = [...container!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Add');
    expect(addBtn).toBeTruthy();
    expect(container!.textContent).not.toContain('Drop a broker CSV here');
  });
});
