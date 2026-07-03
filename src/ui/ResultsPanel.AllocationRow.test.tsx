// @vitest-environment jsdom
//
// Issue #190: the drift cell in the household allocation table packed its
// signed-value + bar group left in a full-width flex container while the
// "Drift" column header is right-aligned, leaving a large dead gap at
// desktop width, and bar left edges never lined up down the column because
// the track width stretched with the flex container. This test locks in the
// fix: the value+bar group is right-aligned (justify-end) and the bar track
// has a fixed width rather than a flex-stretching one.
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AllocationRow } from './ResultsPanel';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderRow(props: {
  current: number; target: number; projected: number;
  taCurrent?: number; taProjected?: number;
}): Promise<HTMLTableCellElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <table>
        <tbody>
          <AllocationRow ac="US_TOTAL_MARKET" {...props} />
        </tbody>
      </table>,
    );
  });
  // Drift is the 4th <td> (Asset class, Current, Target, Drift, ...).
  const cells = container.querySelectorAll('td');
  return cells[3] as HTMLTableCellElement;
}

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
  container = null;
});

describe('AllocationRow drift cell (issue #190)', () => {
  it('right-aligns the value+bar group under the right-aligned Drift header', async () => {
    const driftCell = await renderRow({ current: 0.25, target: 0.20, projected: 0.21 });
    const group = driftCell.querySelector('div');
    expect(group).toBeTruthy();
    expect(group!.className).toContain('justify-end');
  });

  it('uses a fixed-width bar track (not flex-stretching) so bars align down the column', async () => {
    // 5% drift => above the 0.5% show-bar threshold.
    const driftCell = await renderRow({ current: 0.25, target: 0.20, projected: 0.21 });
    const track = driftCell.querySelector('div > div:last-child') as HTMLElement;
    expect(track).toBeTruthy();
    expect(track.className).toContain('w-[72px]');
    expect(track.className).toContain('shrink-0');
    // Must not use the old flex-stretching classes.
    expect(track.className).not.toContain('flex-1');
    expect(track.className).not.toContain('min-w-[32px]');
    expect(track.className).not.toContain('max-w-[72px]');
  });

  it('omits the bar entirely when drift is within the 0.5% no-bar threshold', async () => {
    const driftCell = await renderRow({ current: 0.201, target: 0.20, projected: 0.20 });
    // Only the value span should be present, no second (track) div.
    const divs = driftCell.querySelectorAll('div > div');
    expect(divs.length).toBe(0);
  });

  it('colors the bar orange when over target and blue when under target', async () => {
    const over = await renderRow({ current: 0.28, target: 0.20, projected: 0.21 });
    const overTrack = over.querySelector('div > div:last-child > div') as HTMLElement;
    const under = await renderRow({ current: 0.12, target: 0.20, projected: 0.19 });
    const underTrack = under.querySelector('div > div:last-child > div') as HTMLElement;
    expect(overTrack.style.background).not.toBe(underTrack.style.background);
  });

  it('renders tax-adjusted columns when provided', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <table>
          <tbody>
            <AllocationRow
              ac="US_TOTAL_MARKET" current={0.25} target={0.20} projected={0.21}
              taCurrent={0.24} taProjected={0.22}
            />
          </tbody>
        </table>,
      );
    });
    const cells = container.querySelectorAll('td');
    // Asset class, Current, Target, Drift, After-trades, After-tax current, After-tax projected.
    expect(cells.length).toBe(7);
  });
});
