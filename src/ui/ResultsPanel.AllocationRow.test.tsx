// @vitest-environment jsdom
//
// Issue #190: the drift cell in the household allocation table packed its
// signed-value + bar group left in a full-width flex container while the
// "Drift" column header is right-aligned, leaving a large dead gap at
// desktop width, and bar left edges never lined up down the column because
// the track width stretched with the flex container. This test locks in the
// fix: the value+bar group is right-aligned (justify-end) and the bar track
// has a fixed width rather than a flex-stretching one.
//
// Issue #216: Current/Target/Drift cells now show a household dollar amount
// alongside the percentage (percent leads for Current/Target, dollar leads
// for Drift). The drift bar moved to sit LEFT of the value so the value —
// now "+$49.6k (4.0%)" — stays flush-right under the header. These tests
// were updated for that layout; Projected and the tax-adjusted columns stay
// percent-only and are unchanged.
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AllocationRow } from './ResultsPanel';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const TOTAL = 1_240_000; // household total used across these fixtures

async function renderRow(props: {
  current: number; target: number; projected: number; total?: number;
  taCurrent?: number; taProjected?: number;
}): Promise<HTMLTableCellElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <table>
        <tbody>
          <AllocationRow ac="US_TOTAL_MARKET" total={TOTAL} {...props} />
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

  it('uses a fixed-width bar track (not flex-stretching) so bars align down the column, placed left of the value', async () => {
    // 5% drift => above the 0.5% show-bar threshold.
    const driftCell = await renderRow({ current: 0.25, target: 0.20, projected: 0.21 });
    // Issue #216: the bar now sits left of the value so the value stays
    // flush-right — the track is the group's first child div, not the last.
    const track = driftCell.querySelector('div > div:first-child') as HTMLElement;
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
    const overTrack = over.querySelector('div > div:first-child > div') as HTMLElement;
    const under = await renderRow({ current: 0.12, target: 0.20, projected: 0.19 });
    const underTrack = under.querySelector('div > div:first-child > div') as HTMLElement;
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
              ac="US_TOTAL_MARKET" current={0.25} target={0.20} projected={0.21} total={TOTAL}
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

// ─── Issue #216: dollar amounts alongside percentages ─────────────────────────

describe('AllocationRow dollar amounts (issue #216)', () => {
  it('shows the compact household dollar amount in parens after the percent in the Current cell', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <table>
          <tbody>
            <AllocationRow ac="US_TOTAL_MARKET" current={0.36} target={0.32} projected={0.33} total={TOTAL} />
          </tbody>
        </table>,
      );
    });
    const cells = container.querySelectorAll('td');
    // 0.36 * 1,240,000 = 446,400 => "$446.4k"
    expect(cells[1].textContent).toContain('36.0%');
    expect(cells[1].textContent).toContain('($446.4k)');
  });

  it('shows the compact household dollar amount in parens after the percent in the Target cell', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <table>
          <tbody>
            <AllocationRow ac="US_TOTAL_MARKET" current={0.36} target={0.32} projected={0.33} total={TOTAL} />
          </tbody>
        </table>,
      );
    });
    const cells = container.querySelectorAll('td');
    // 0.32 * 1,240,000 = 396,800 => "$396.8k"
    expect(cells[2].textContent).toContain('32.0%');
    expect(cells[2].textContent).toContain('($396.8k)');
  });

  it('leads the Drift cell with the dollar delta and puts the percent in parens', async () => {
    const driftCell = await renderRow({ current: 0.36, target: 0.32, projected: 0.33 });
    // drift = 0.04 * 1,240,000 = 49,600 => "+$49.6k (4.0%)"
    expect(driftCell.textContent).toContain('+$49.6k');
    expect(driftCell.textContent).toContain('(4.0%)');
  });

  it('formats an under-target drift with the sign carried on the dollar amount, not the percent', async () => {
    const driftCell = await renderRow({ current: 0.28, target: 0.32, projected: 0.30 });
    // drift = -0.04 * 1,240,000 = -49,600 => "-$49.6k (4.0%)"
    expect(driftCell.textContent).toContain('-$49.6k');
    expect(driftCell.textContent).toContain('(4.0%)');
    expect(driftCell.textContent).not.toContain('-4.0%');
  });

  it('keeps the Projected cell percent-only, with no dollar amount', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <table>
          <tbody>
            <AllocationRow ac="US_TOTAL_MARKET" current={0.36} target={0.32} projected={0.33} total={TOTAL} />
          </tbody>
        </table>,
      );
    });
    const cells = container.querySelectorAll('td');
    expect(cells[4].textContent).toBe('33.0%');
    expect(cells[4].textContent).not.toContain('$');
  });

  it('keeps the tax-adjusted columns percent-only, with no dollar amount', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <table>
          <tbody>
            <AllocationRow
              ac="US_TOTAL_MARKET" current={0.36} target={0.32} projected={0.33} total={TOTAL}
              taCurrent={0.35} taProjected={0.34}
            />
          </tbody>
        </table>,
      );
    });
    const cells = container.querySelectorAll('td');
    expect(cells[5].textContent).toBe('35.0%');
    expect(cells[6].textContent).toBe('34.0%');
    expect(cells[5].textContent).not.toContain('$');
    expect(cells[6].textContent).not.toContain('$');
  });

  it('computes dollar amounts for indented child rows the same way as parent rows', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <table>
          <tbody>
            <AllocationRow ac="US_LARGE_CAP" current={0.18} target={0.16} projected={0.17} total={TOTAL} depth={1} />
          </tbody>
        </table>,
      );
    });
    const cells = container.querySelectorAll('td');
    // 0.18 * 1,240,000 = 223,200 => "$223.2k"
    expect(cells[1].textContent).toContain('18.0%');
    expect(cells[1].textContent).toContain('($223.2k)');
  });
});
