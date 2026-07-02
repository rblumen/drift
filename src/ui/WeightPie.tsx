import { fmtPct } from './fmt';

export interface WeightSlice {
  label: string;
  /** Fractional weight 0–1. */
  weight: number;
  color: string;
}

interface Props {
  slices: WeightSlice[];
  /** SVG diameter in px (default 180). */
  size?: number;
}

function polarToCart(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** SVG pie-slice path: centre → arc edge → close. */
function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  // Full-circle edge-case: can't draw an arc from a point back to itself.
  if (end - start >= 2 * Math.PI - 0.001) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
  }
  const s = polarToCart(cx, cy, r, start);
  const e = polarToCart(cx, cy, r, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`;
}

/**
 * Filled SVG pie chart for fractional weights (0–1).
 * Hover each slice for a native tooltip showing the label and percentage.
 * Used in the Strategy panel beside the target-allocation table.
 */
export function WeightPie({ slices, size = 180 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r  = Math.round(size * 0.46);  // nearly fills the viewport

  let angle = -Math.PI / 2;           // start at 12 o'clock

  const segments = slices
    .filter(s => s.weight > 0.001)    // skip invisible slivers
    .map(s => {
      const sweep = s.weight * 2 * Math.PI;
      const end   = angle + sweep;
      const d     = slicePath(cx, cy, r, angle, end);
      angle = end;
      return { ...s, d };
    });

  if (segments.length === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Target allocation: no targets set">
        <circle cx={cx} cy={cy} r={r} fill="#e5e7eb" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={10} fill="#9ca3af">
          no targets set
        </text>
      </svg>
    );
  }

  // Screen-reader summary: per-slice <title>s only surface on hover.
  const ariaLabel = `Target allocation: ${segments
    .map(seg => `${seg.label} ${fmtPct(seg.weight)}`)
    .join(', ')}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
      {segments.map(seg => (
        <path
          key={seg.label}
          d={seg.d}
          fill={seg.color}
          stroke="white"
          strokeWidth={1.5}
          strokeLinejoin="round"
        >
          <title>{seg.label}: {fmtPct(seg.weight)}</title>
        </path>
      ))}
    </svg>
  );
}
