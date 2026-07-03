// src/ui/AllocationViews.tsx — the household-allocation card body (issue #98).
//
// A segmented icon toggle (donut / radar / bar) drives a chart pane and a
// companion drift table that is color-keyed to the plots. Radar and donut work
// at the family level (US / Intl / EM / Bonds / Alts, + Cash when material); the
// bar view drops to the active sub-classes. Ports section `2a` of the owner's
// design handoff.

import { DonutRings } from './DonutChart';
import type { DonutSlice } from './DonutChart';
import { RadarChart } from './RadarChart';
import type { RadarDatum } from './RadarChart';
import { BulletBars } from './BulletBars';
import type { BulletDatum } from './BulletBars';
import { fmtPct } from './fmt';

export type ChartView = 'donut' | 'radar' | 'bar';

const OVER = '#e8600a';
const UNDER = '#1a5fa0';
const NEUTRAL = '#9ca3af';
const CURRENT = '#0d3e7a';
const TARGET = '#8792a0';

interface Props {
  view: ChartView;
  onViewChange: (v: ChartView) => void;
  /** Family rows in spoke order (US → … → Cash), for radar + donut + their table. */
  familyRows: RadarDatum[];
  /** Sub-class rows for the bar view + its table. */
  subRows: BulletDatum[];
  /** Family donut ramp — same order/keys as familyRows. */
  familyColors: string[];
}

// ── Segmented icon toggle ─────────────────────────────────────────────────────

const TAB_ORDER: ChartView[] = ['donut', 'radar', 'bar'];
const TAB_LABEL: Record<ChartView, string> = {
  donut: 'Donut view',
  radar: 'Radar view',
  bar: 'Bar view',
};
const TAB_TITLE: Record<ChartView, string> = { donut: 'Donut', radar: 'Radar', bar: 'Bar' };

function TabIcon({ view }: { view: ChartView }) {
  if (view === 'donut') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="3" />
      </svg>
    );
  }
  if (view === 'radar') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <polygon points="8,1.5 14.2,6 11.8,13.3 4.2,13.3 1.8,6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="8" y1="8" x2="8" y2="1.5" stroke="currentColor" strokeWidth="1" />
        <line x1="8" y1="8" x2="14.2" y2="6" stroke="currentColor" strokeWidth="1" />
        <line x1="8" y1="8" x2="11.8" y2="13.3" stroke="currentColor" strokeWidth="1" />
        <line x1="8" y1="8" x2="4.2" y2="13.3" stroke="currentColor" strokeWidth="1" />
        <line x1="8" y1="8" x2="1.8" y2="6" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="6.5" width="3" height="7.5" rx="0.75" fill="currentColor" />
      <rect x="6.5" y="2" width="3" height="12" rx="0.75" fill="currentColor" />
      <rect x="11" y="9" width="3" height="5" rx="0.75" fill="currentColor" />
    </svg>
  );
}

function ChartToggle({ view, onViewChange }: { view: ChartView; onViewChange: (v: ChartView) => void }) {
  // Arrow-key roving focus across the three tabs (nice-to-have per handoff).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = TAB_ORDER.indexOf(view);
    const next = e.key === 'ArrowRight'
      ? TAB_ORDER[(idx + 1) % TAB_ORDER.length]
      : TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    onViewChange(next);
    e.preventDefault();
  }
  return (
    <div
      role="group"
      aria-label="Allocation chart view"
      onKeyDown={onKeyDown}
      style={{ display: 'inline-flex', background: '#eef1f5', padding: 3, borderRadius: 9, gap: 2 }}
    >
      {TAB_ORDER.map(v => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            aria-label={TAB_LABEL[v]}
            aria-pressed={active}
            title={TAB_TITLE[v]}
            tabIndex={active ? 0 : -1}
            onClick={() => onViewChange(v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
              padding: '7px 14px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 7,
              transition: 'all .12s',
              background: active ? CURRENT : 'transparent',
              color: active ? '#fff' : '#8792a0',
            }}
          >
            <TabIcon view={v} />
          </button>
        );
      })}
    </div>
  );
}

// ── Drift table (color-keyed to the plots) ────────────────────────────────────

interface DriftRow {
  label: string;
  cur: number;
  tgt: number;
}

function driftMarks(cur: number, tgt: number) {
  const drift = cur - tgt;
  const neutral = Math.abs(drift) < 0.001;
  const arrow = neutral ? '' : drift > 0 ? '▲' : '▼';
  const sign = drift >= 0 ? '+' : '−';
  const color = neutral ? NEUTRAL : drift > 0 ? OVER : UNDER;
  return { text: `${arrow} ${sign}${Math.abs(drift * 100).toFixed(1)}`, color };
}

function DriftTable({ firstCol, rows }: { firstCol: string; rows: DriftRow[] }) {
  const cols = '1fr 4.2rem 4.2rem 4rem';
  return (
    <div>
      <div
        className="grid items-center pb-1.5 border-b"
        style={{ gridTemplateColumns: cols, fontSize: '10.5px', color: '#9ca3af', borderColor: '#f1f3f6' }}
      >
        <span>{firstCol}</span>
        <span className="flex items-center justify-end gap-1.5">
          <span className="shrink-0" style={{ width: 9, height: 9, borderRadius: 2, background: CURRENT }} />
          Current
        </span>
        <span className="flex items-center justify-end gap-1.5">
          <span className="shrink-0" style={{ width: 11, height: 0, borderTop: `2px dashed ${TARGET}` }} />
          Target
        </span>
        <span className="text-right">Drift</span>
      </div>
      {rows.map(r => {
        const d = driftMarks(r.cur, r.tgt);
        return (
          <div
            key={r.label}
            className="grid items-center border-b"
            style={{ gridTemplateColumns: cols, fontSize: '12.5px', padding: '5px 0', borderColor: '#f7f8fa' }}
          >
            <span style={{ color: '#4b5563', fontWeight: 500 }}>{r.label}</span>
            <span className="text-right tabular-nums font-mono" style={{ color: CURRENT, fontSize: 12 }}>{fmtPct(r.cur)}</span>
            <span className="text-right tabular-nums font-mono" style={{ color: TARGET, fontSize: 12 }}>{fmtPct(r.tgt)}</span>
            <span className="text-right tabular-nums font-mono" style={{ color: d.color, fontSize: 12 }}>{d.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── View captions (copied from the design file's three variants) ──────────────

function Caption({ view }: { view: ChartView }) {
  return (
    <div className="mt-3" style={{ fontSize: '11.5px', color: '#8a94a1', lineHeight: 1.5 }}>
      {view === 'donut' && (
        <span>Inner ring = current · outer ring = target. The table columns above key to the radar &amp; bar views.</span>
      )}
      {view === 'radar' && (
        <span>
          <strong style={{ color: CURRENT }}>Current</strong> is the shaded shape ·{' '}
          <strong style={{ color: TARGET }}>target</strong> the dashed outline · the{' '}
          <strong style={{ color: OVER }}>orange</strong>/<strong style={{ color: UNDER }}>blue</strong> spoke
          segment is the drift — same colors as the Drift column.
        </span>
      )}
      {view === 'bar' && (
        <span>
          <strong style={{ color: CURRENT }}>Current</strong> is the solid bar · the{' '}
          <strong style={{ color: '#2a3441' }}>bold tick</strong> is the target · an{' '}
          <strong style={{ color: OVER }}>orange cap</strong> is excess above target, a{' '}
          <strong style={{ color: UNDER }}>dashed box</strong> is the shortfall to fill. Full sub-class
          breakdown — more classes than a radar can comfortably hold.
        </span>
      )}
    </div>
  );
}

// ── Card body ─────────────────────────────────────────────────────────────────

export function AllocationViews({ view, onViewChange, familyRows, subRows, familyColors }: Props) {
  const isBar = view === 'bar';

  const donutInner: DonutSlice[] = familyRows.map((r, i) => ({ label: r.label, weight: r.a, color: familyColors[i] }));
  const donutOuter: DonutSlice[] = familyRows.map((r, i) => ({ label: r.label, weight: r.b, color: familyColors[i] }));

  const tableRows: DriftRow[] = isBar
    ? subRows.map(r => ({ label: r.label, cur: r.a, tgt: r.b }))
    : familyRows.map(r => ({ label: r.label, cur: r.a, tgt: r.b }));

  return (
    <div>
      <div className="flex items-center justify-between gap-4 flex-wrap mb-1.5">
        <div className="text-sm font-medium text-gray-700">Household allocation</div>
        <ChartToggle view={view} onViewChange={onViewChange} />
      </div>

      <div className="flex items-start gap-12 flex-wrap justify-center">
        {/* chart pane — fixed 300px min so switching views never reflows */}
        <div
          className="flex items-center justify-center shrink-0"
          style={{ minWidth: 300, minHeight: 300 }}
        >
          {view === 'donut' && <DonutRings inner={donutInner} outer={donutOuter} size={232} />}
          {view === 'radar' && <RadarChart data={familyRows} size={300} aName="Current" bName="Target" />}
          {view === 'bar' && <BulletBars data={subRows} />}
        </div>

        {/* table pane */}
        <div className="self-center" style={{ flex: '0 1 330px', minWidth: 270 }}>
          <DriftTable firstCol={isBar ? 'Asset class' : 'Family'} rows={tableRows} />
          <Caption view={view} />
        </div>
      </div>
    </div>
  );
}
