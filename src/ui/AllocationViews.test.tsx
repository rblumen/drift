// @vitest-environment jsdom
//
// Render coverage for the issue-#98 allocation charts: the radar and bar SVGs
// expose a role="img" text alternative summarizing both series, draw the right
// number of drift marks for a known input, and the segmented toggle switches the
// active view (families ↔ sub-classes). Modeled on ConfirmDialog.test.tsx.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { RadarChart } from './RadarChart';
import type { RadarDatum } from './RadarChart';
import { BulletBars } from './BulletBars';
import type { BulletDatum } from './BulletBars';
import { AllocationViews } from './AllocationViews';
import type { ChartView } from './AllocationViews';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

async function render(node: React.ReactNode): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
});

// US over target, Intl/Bonds under, EM/Alts over. Two families are within ±0.2pp
// of nothing here, so all five carry drift.
const FAMILY: RadarDatum[] = [
  { label: 'US', a: 0.64, b: 0.575 },   // over
  { label: 'Intl', a: 0.12, b: 0.17 },  // under
  { label: 'EM', a: 0.05, b: 0.03 },    // over
  { label: 'Bonds', a: 0.15, b: 0.20 }, // under
  { label: 'Alts', a: 0.04, b: 0.025 }, // over
];

describe('RadarChart (issue #98)', () => {
  it('renders a role="img" with a two-series aria summary', async () => {
    await render(<RadarChart data={FAMILY} size={300} scaleMax={0.7} />);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg).toBeTruthy();
    const label = svg.getAttribute('aria-label')!;
    expect(label).toContain('Current');
    expect(label).toContain('Target');
    // both series' figures surface in the text alternative
    expect(label).toContain('64.0%');
    expect(label).toContain('57.5%');
  });

  it('draws one drift segment per spoke that is off target', async () => {
    await render(<RadarChart data={FAMILY} size={300} scaleMax={0.7} />);
    // Drift segments are 4px round-cap lines; the only other <line>s are the 5
    // spokes (1px) and the 4 grid rings are polygons. Count 4px-stroke lines.
    const driftLines = [...container.querySelectorAll('line')]
      .filter(l => l.getAttribute('stroke-width') === '4');
    expect(driftLines).toHaveLength(5);
  });

  it('colors over-target drift orange and under-target blue', async () => {
    await render(<RadarChart data={FAMILY} size={300} scaleMax={0.7} />);
    const driftLines = [...container.querySelectorAll('line')]
      .filter(l => l.getAttribute('stroke-width') === '4');
    const colors = driftLines.map(l => l.getAttribute('stroke'));
    expect(colors.filter(c => c === '#e8600a')).toHaveLength(3); // US, EM, Alts over
    expect(colors.filter(c => c === '#1a5fa0')).toHaveLength(2); // Intl, Bonds under
  });

  it('renders a current-vertex <title> tooltip per family', async () => {
    await render(<RadarChart data={FAMILY} size={300} scaleMax={0.7} />);
    const titles = [...container.querySelectorAll('title')].map(t => t.textContent);
    expect(titles.some(t => t?.includes('US — Current 64.0%, Target 57.5%'))).toBe(true);
  });
});

const SUB: BulletDatum[] = [
  { label: 'US Large Cap', short: 'US Lg', a: 0.42, b: 0.385 }, // over
  { label: 'Developed Intl', short: 'Intl', a: 0.12, b: 0.17 }, // under
  { label: 'Fixed Income', short: 'Bonds', a: 0.20, b: 0.20 },  // on target
];

describe('BulletBars (issue #98)', () => {
  it('renders a role="img" summarizing every bar', async () => {
    await render(<BulletBars data={SUB} />);
    const svg = container.querySelector('svg[role="img"]')!;
    const label = svg.getAttribute('aria-label')!;
    expect(label).toContain('US Large Cap');
    expect(label).toContain('current 42.0%');
    expect(label).toContain('target 38.5%');
  });

  it('draws an orange excess cap for over-target and a dashed shortfall box for under-target', async () => {
    await render(<BulletBars data={SUB} />);
    const rects = [...container.querySelectorAll('rect')];
    // one orange cap (US over)
    expect(rects.filter(r => r.getAttribute('fill') === '#e8600a')).toHaveLength(1);
    // one dashed hollow box (Intl under)
    expect(rects.filter(r => r.getAttribute('stroke-dasharray') === '3 2')).toHaveLength(1);
  });
});

// A stateful harness so clicking a toggle button actually swaps the view.
function Harness({ initial = 'radar' as ChartView }) {
  const [view, setView] = useState<ChartView>(initial);
  return (
    <AllocationViews
      view={view}
      onViewChange={setView}
      familyRows={FAMILY}
      subRows={SUB}
      familyColors={['#082855', '#0d3e7a', '#1a5fa0', '#2e72b4', '#e8600a']}
    />
  );
}

function tab(label: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === label) as HTMLButtonElement;
}

describe('AllocationViews toggle (issue #98)', () => {
  beforeEach(async () => {
    await render(<Harness />);
  });

  it('defaults to the radar view with the Family table header', () => {
    // radar aria-label present
    expect(container.querySelector('svg[aria-label*="radar"]')).toBeTruthy();
    expect(container.textContent).toContain('Family');
    expect(container.textContent).not.toContain('Asset class');
  });

  it('switching to Bar swaps in the sub-class table and the bar chart', async () => {
    await act(async () => { tab('Bar view').click(); });
    expect(container.querySelector('svg[aria-label*="radar"]')).toBeNull();
    expect(container.querySelector('svg[aria-label*="by asset class"]')).toBeTruthy();
    // first-column header swaps to "Asset class"; sub-class rows appear
    expect(container.textContent).toContain('Asset class');
    expect(container.textContent).toContain('US Large Cap');
  });

  it('switching to Donut renders the concentric donut', async () => {
    await act(async () => { tab('Donut view').click(); });
    expect(container.querySelector('svg[aria-label*="radar"]')).toBeNull();
    // DonutRings exposes "Current vs. target allocation" as its aria-label
    expect(container.querySelector('svg[aria-label*="Current vs. target"]')).toBeTruthy();
  });

  it('marks the active tab with aria-pressed', async () => {
    expect(tab('Radar view').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { tab('Donut view').click(); });
    expect(tab('Donut view').getAttribute('aria-pressed')).toBe('true');
    expect(tab('Radar view').getAttribute('aria-pressed')).toBe('false');
  });

  // Review revision: the donut encodes families purely by color, so its table
  // rows carry a color-key swatch; the radar/bar encodings don't need one.
  it('renders per-row color swatches in the donut view only', async () => {
    const swatches = () => container.querySelectorAll('[data-testid="drift-row-swatch"]');

    // radar (default): no row swatches
    expect(swatches()).toHaveLength(0);

    // donut: one swatch per family row
    await act(async () => { tab('Donut view').click(); });
    expect(swatches()).toHaveLength(FAMILY.length);

    // bar: no row swatches
    await act(async () => { tab('Bar view').click(); });
    expect(swatches()).toHaveLength(0);
  });
});
