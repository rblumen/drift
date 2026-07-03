// @vitest-environment jsdom
//
// Issue #190: HelpTip's popover used to be an absolutely-positioned sibling
// inside the trigger's own relative-positioned span, so any ancestor with
// `overflow-x-auto` (added by #142 for mobile table scrolling) clipped it —
// `overflow-x: auto` forces vertical clipping too per the CSS spec. The fix
// renders the popover via a portal to document.body with `position: fixed`
// coordinates computed from the trigger's bounding rect, so it always
// escapes ancestor scroll containers. These tests lock in that behavior.
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HelpTip } from './HelpBox';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderInScrollWrapper(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <div className="overflow-x-auto" data-testid="scroll-wrapper" style={{ overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>
                Drift
                <HelpTip dir="up">Help text content</HelpTip>
              </th>
            </tr>
          </thead>
        </table>
      </div>,
    );
  });
}

function openTip(): Promise<void> {
  return act(async () => {
    const btn = document.querySelector('button[aria-label="Help"]') as HTMLButtonElement;
    btn.click();
  });
}

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
  container = null;
});

describe('HelpTip popover portal (issue #190)', () => {
  it('renders the tooltip outside the scrollable ancestor (as a child of document.body)', async () => {
    await renderInScrollWrapper();
    await openTip();

    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).toBeTruthy();

    const scrollWrapper = document.querySelector('[data-testid="scroll-wrapper"]');
    expect(scrollWrapper!.contains(tooltip)).toBe(false);
    expect(document.body.contains(tooltip)).toBe(true);
  });

  it('positions the tooltip with position: fixed (escapes overflow clipping)', async () => {
    await renderInScrollWrapper();
    await openTip();
    const tooltip = document.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tooltip.className).toContain('fixed');
  });

  it('closes on outside click and unmounts the portaled tooltip', async () => {
    await renderInScrollWrapper();
    await openTip();
    expect(document.querySelector('[role="tooltip"]')).toBeTruthy();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('closes on Escape', async () => {
    await renderInScrollWrapper();
    await openTip();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
