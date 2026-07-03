// src/ui/RadarChart.tsx — allocation radar (issue #98).
//
// Two overlaid polygons on fixed family spokes: a shaded "a" series (current /
// before) and a dashed "b" outline (target / after). The gap on each spoke is
// drawn as a colored drift segment — orange when a is over b, blue when under —
// which is the hero of the chart. Geometry is ported verbatim from the owner's
// design handoff (`radar(cfg)` in "Radar allocations.dc.html").
//
// Pure SVG, no engine imports. a11y follows the DonutChart pattern: role="img"
// plus an aria-label summarizing both series, since the per-vertex <title>s only
// surface on hover.

import { fmtPct } from './fmt';

export interface RadarDatum {
  /** Family label shown at the spoke tip (e.g. "US", "Bonds"). */
  label: string;
  /** Series a — the shaded polygon (current / before), fractional 0–1. */
  a: number;
  /** Series b — the dashed outline (target / after), fractional 0–1. */
  b: number;
}

interface Props {
  data: RadarDatum[];
  /** SVG side length in px. Household 300, per-account 320 in the design. */
  size?: number;
  /**
   * Fixed radial scale (fraction at the rim). When omitted, derived as
   * max(a, b) across spokes rounded up to the next 0.1 (min 0.5) so the shape
   * stays stable across small edits.
   */
  scaleMax?: number;
  /** Legend name for the a series (default "Current"). */
  aName?: string;
  /** Legend name for the b series (default "Target"). */
  bName?: string;
}

const CURRENT = '#0d3e7a';       // shaded polygon / current vertex
const OVER    = '#e8600a';       // drift over  (accent orange)
const UNDER   = '#1a5fa0';       // drift under (blue)
const TARGET_STROKE = '#8792a0'; // dashed outline + target vertex stroke
const GRID    = '#e5e8ee';
const RING_FILL = '#fbfcfd';
const AXIS_LABEL = '#c2cad4';
const NEUTRAL = '#9ca3af';
const INK     = '#082855';
const FILL_OP = 0.15;

/** Round max(a,b) up to the next 0.1, floored at 0.5 — keeps the shape stable. */
function deriveScaleMax(data: RadarDatum[]): number {
  const peak = data.reduce((m, d) => Math.max(m, d.a, d.b), 0);
  return Math.max(0.5, Math.ceil((peak - 1e-9) / 0.1) * 0.1);
}

export function RadarChart({
  data,
  size = 300,
  scaleMax,
  aName = 'Current',
  bName = 'Target',
}: Props) {
  const smax = scaleMax ?? deriveScaleMax(data);
  const cx = size / 2;
  const cy = size / 2;
  const Rad = size * 0.30;
  const labelR = Rad + size * 0.088;
  const n = data.length;

  const ang = (i: number) => ((-90 + (i * 360) / n) * Math.PI) / 180;
  const pt = (i: number, v: number): [number, number] => {
    const r = (Math.max(v, 0) / smax) * Rad;
    return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  };
  const ptStr = (i: number, v: number) => {
    const p = pt(i, v);
    return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  };

  const fracs = [0.25, 0.5, 0.75, 1];
  const bPts = data.map((d, i) => ptStr(i, d.b)).join(' ');
  const aPts = data.map((d, i) => ptStr(i, d.a)).join(' ');

  // Screen-reader summary (both series), matching the DonutChart approach.
  const summary = (pick: (d: RadarDatum) => number) =>
    data.map(d => `${d.label} ${fmtPct(pick(d))}`).join(', ');
  const ariaLabel =
    `${aName} vs. ${bName} allocation radar. ` +
    `${aName}: ${summary(d => d.a)}. ${bName}: ${summary(d => d.b)}.`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      style={{ overflow: 'visible' }}
    >
      {/* grid rings */}
      {fracs.map((f, fi) => (
        <polygon
          key={`ring${fi}`}
          points={data.map((_, i) => ptStr(i, f * smax)).join(' ')}
          fill={fi === 3 ? 'none' : fi % 2 ? RING_FILL : 'none'}
          stroke={GRID}
          strokeWidth={1}
        />
      ))}
      {/* ring % labels along the top spoke */}
      {fracs.map((f, fi) => (
        <text
          key={`rl${fi}`}
          x={cx + 5}
          y={cy - f * Rad + 3}
          fontSize={8.5}
          fontFamily="'IBM Plex Mono', monospace"
          fill={AXIS_LABEL}
        >
          {Math.round(f * smax * 100)}%
        </text>
      ))}
      {/* spokes */}
      {data.map((_, i) => {
        const p = pt(i, smax);
        return (
          <line key={`sp${i}`} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke={GRID} strokeWidth={1} />
        );
      })}

      {/* target / after outline (drawn first) */}
      <polygon
        points={bPts}
        fill="none"
        stroke={TARGET_STROKE}
        strokeWidth={1.6}
        strokeDasharray="4 3"
        strokeLinejoin="round"
      />
      {/* current / before shaded polygon */}
      <polygon
        points={aPts}
        fill={`rgba(13,62,122,${FILL_OP})`}
        stroke={CURRENT}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* drift segments + vertices */}
      {data.map((d, i) => {
        const pa = pt(i, d.a);
        const pb = pt(i, d.b);
        const over = d.a >= d.b;
        const col = over ? OVER : UNDER;
        const segment =
          Math.abs(d.a - d.b) > 0.002 ? (
            <line
              x1={pb[0]}
              y1={pb[1]}
              x2={pa[0]}
              y2={pa[1]}
              stroke={col}
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.92}
            />
          ) : null;
        return (
          <g key={`v${i}`}>
            {segment}
            <circle cx={pb[0]} cy={pb[1]} r={2.4} fill="#fff" stroke={TARGET_STROKE} strokeWidth={1.4} />
            <circle cx={pa[0]} cy={pa[1]} r={3.2} fill={CURRENT}>
              <title>
                {d.label} — {aName} {fmtPct(d.a)}, {bName} {fmtPct(d.b)}
              </title>
            </circle>
          </g>
        );
      })}

      {/* tip labels: family name + signed drift */}
      {data.map((d, i) => {
        const a = ang(i);
        const lx = cx + labelR * Math.cos(a);
        const ly = cy + labelR * Math.sin(a);
        const cos = Math.cos(a);
        const anchor: 'start' | 'end' | 'middle' =
          cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
        const drift = d.a - d.b;
        const over = drift >= 0;
        const neutral = Math.abs(drift) <= 0.002;
        const col = neutral ? NEUTRAL : over ? OVER : UNDER;
        const arrow = neutral ? '' : over ? '▲ ' : '▼ ';
        const sign = over ? '+' : '−';
        return (
          <g key={`ln${i}`}>
            <text
              x={lx}
              y={ly - 3}
              textAnchor={anchor}
              fontSize={12.5}
              fontWeight={600}
              fill={INK}
              fontFamily="'Schibsted Grotesk', sans-serif"
            >
              {d.label}
            </text>
            <text
              x={lx}
              y={ly + 11}
              textAnchor={anchor}
              fontSize={11}
              fontFamily="'IBM Plex Mono', monospace"
              fill={col}
            >
              {`${arrow}${sign}${Math.abs(drift * 100).toFixed(1)}`}
            </text>
          </g>
        );
      })}

      {/* center dot */}
      <circle cx={cx} cy={cy} r={1.6} fill={AXIS_LABEL} />
    </svg>
  );
}
