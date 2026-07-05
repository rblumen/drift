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
import { ImportPanel } from './ImportPanel';
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
      <ImportPanel accounts={ACCOUNTS} positions={positions} setPositions={() => {}} />,
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

describe('ImportPanel source segmented control', () => {
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
