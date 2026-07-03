// src/ui/BulletBars.tsx — vertical bullet bars at the sub-class level (issue #98).
//
// One bar per active asset class. The solid bar rises to min(current, target);
// an orange cap above the target tick is excess, a dashed hollow box is the
// shortfall to fill, and a bold dark tick marks the target. Geometry is ported
// verbatim from the owner's design handoff (`barChart(cfg)`).
//
// Pure SVG; a11y matches DonutChart (role="img" + a two-series aria summary).

import { fmtPct } from './fmt';

export interface BulletDatum {
  /** Full asset-class label, used in the tooltip + aria summary. */
  label: string;
  /** Short label shown under the bar (e.g. "US Lg"). */
  short: string;
  /** Current weight, fractional 0–1. */
  a: number;
  /** Target weight, fractional 0–1. */
  b: number;
}

interface Props {
  data: BulletDatum[];
  /**
   * Fixed vertical scale (fraction at the top). When omitted, derived as the max
   * value across bars rounded up to the next 0.05.
   */
  scaleMax?: number;
}

const OVER    = '#e8600a';
const UNDER   = '#1a5fa0';
const TICK    = '#2a3441';
const GRIDLINE = '#eef1f5';
const BASELINE = '#d7dde5';
const AXIS_LABEL = '#c2cad4';
const NEUTRAL = '#c2cad4';
const INK     = '#082855';
const CUR_LABEL = '#9ca3af';

function deriveScaleMax(data: BulletDatum[]): number {
  const peak = data.reduce((m, d) => Math.max(m, d.a, d.b), 0);
  return Math.max(0.05, Math.ceil((peak - 1e-9) / 0.05) * 0.05);
}

export function BulletBars({ data, scaleMax }: Props) {
  const smax = scaleMax ?? deriveScaleMax(data);
  const n = data.length;
  const axisW = 34;
  const slot = 52;
  const barW = 28;
  const padTop = 28;
  const padBottom = 44;
  const W = axisW + n * slot + 12;
  // 264 (design file used 304): tightened per the #98 review pass so the bar
  // view no longer forces extra height onto the shared chart pane.
  const H = 264;
  const y0 = H - padBottom;
  const plotH = y0 - padTop;
  const yOf = (v: number) => y0 - (Math.max(v, 0) / smax) * plotH;

  // Gridlines every 10% up to scaleMax.
  const gridVals: number[] = [];
  for (let g = 0.1; g < smax - 1e-9; g += 0.1) gridVals.push(Math.round(g * 100) / 100);

  const ariaLabel =
    `Current vs. target allocation by asset class. ` +
    data.map(d => `${d.label} current ${fmtPct(d.a)}, target ${fmtPct(d.b)}`).join('; ') +
    '.';

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {/* gridlines + axis labels */}
      {gridVals.map((g, gi) => {
        const y = yOf(g);
        return (
          <g key={`g${gi}`}>
            <line x1={axisW} y1={y} x2={W - 8} y2={y} stroke={GRIDLINE} strokeWidth={1} />
            <text
              x={axisW - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={8.5}
              fontFamily="'IBM Plex Mono', monospace"
              fill={AXIS_LABEL}
            >
              {Math.round(g * 100)}%
            </text>
          </g>
        );
      })}
      {/* baseline */}
      <line x1={axisW} y1={y0} x2={W - 8} y2={y0} stroke={BASELINE} strokeWidth={1} />

      {data.map((d, i) => {
        const x = axisW + i * slot + (slot - barW) / 2;
        const drift = d.a - d.b;
        const neutral = Math.abs(drift) <= 0.002;
        const over = drift >= 0;
        const col = neutral ? NEUTRAL : over ? OVER : UNDER;
        const yA = yOf(d.a);
        const yB = yOf(d.b);
        const yBlueTop = Math.max(yA, yB); // top of solid portion = min(cur, tgt)
        const topY = Math.min(yA, yB);
        const arrow = neutral ? '' : over ? '▲' : '▼';
        const sign = over ? '+' : '−';
        return (
          <g key={`bar${i}`}>
            {/* solid current up to min(cur, tgt) */}
            <rect x={x} y={yBlueTop} width={barW} height={y0 - yBlueTop} rx={2} fill="rgba(13,62,122,0.9)">
              <title>
                {d.label} — current {fmtPct(d.a)}, target {fmtPct(d.b)}
              </title>
            </rect>
            {/* excess: orange cap */}
            {over && !neutral && (
              <rect x={x} y={yA} width={barW} height={yB - yA} rx={2} fill={OVER} />
            )}
            {/* shortfall: dashed hollow box */}
            {!over && !neutral && (
              <rect
                x={x + 0.75}
                y={yB + 0.75}
                width={barW - 1.5}
                height={yA - yB - 1.5}
                rx={2}
                fill="rgba(26,95,160,0.07)"
                stroke={UNDER}
                strokeWidth={1.2}
                strokeDasharray="3 2"
              />
            )}
            {/* bold target tick */}
            <line x1={x - 6} y1={yB} x2={x + barW + 6} y2={yB} stroke={TICK} strokeWidth={2.5} />
            {/* drift label above */}
            {!neutral && (
              <text
                x={x + barW / 2}
                y={topY - 8}
                textAnchor="middle"
                fontSize={10}
                fontFamily="'IBM Plex Mono', monospace"
                fill={col}
              >
                {`${arrow}${sign}${Math.abs(drift * 100).toFixed(1)}`}
              </text>
            )}
            {/* class label + current % below */}
            <text
              x={x + barW / 2}
              y={y0 + 16}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={600}
              fill={INK}
              fontFamily="'Schibsted Grotesk', sans-serif"
            >
              {d.short}
            </text>
            <text
              x={x + barW / 2}
              y={y0 + 30}
              textAnchor="middle"
              fontSize={9}
              fontFamily="'IBM Plex Mono', monospace"
              fill={CUR_LABEL}
            >
              {Math.round(d.a * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
