import { fmtPct } from './fmt';

export interface DonutSlice {
  label: string;
  /** Fractional weight 0–1. */
  weight: number;
  color: string;
}

interface Props {
  /** Inner ring — typically the current portfolio. */
  inner: DonutSlice[];
  /** Outer ring — typically the strategy target. */
  outer: DonutSlice[];
  /** SVG diameter in px (default 180). */
  size?: number;
}

/**
 * Build SVG stroke-dasharray props for each slice of a ring.
 * Uses a 1.5 px gap between adjacent slices for visual clarity.
 */
function buildRingSegments(
  slices: DonutSlice[],
  r: number,
  sw: number,
) {
  const circumference = 2 * Math.PI * r;
  let angle = 0;
  return slices
    .filter(sl => sl.weight > 0.0005) // skip slivers < 0.05%
    .map(sl => {
      const sweep   = sl.weight * 360;
      const dashLen = Math.max((sweep / 360) * circumference - 1.5, 0);
      const offset  = -(angle / 360) * circumference;
      angle += sweep;
      return { ...sl, r, sw, circumference, dashLen, offset };
    });
}

export function DonutChart({ inner, outer, size = 180 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const sw      = Math.round(size * 0.10);   // ring stroke width  (~18px @ 180)
  const innerR  = Math.round(size * 0.222);  // inner ring radius  (~40px @ 180)
  const outerR  = Math.round(size * 0.361);  // outer ring radius  (~65px @ 180)

  const innerSegs = buildRingSegments(inner, innerR, sw);
  const outerSegs = buildRingSegments(outer, outerR, sw);

  const hasInner = innerSegs.some(s => s.weight > 0);

  // Screen-reader summary: per-slice <title>s only surface on hover, so describe
  // both rings (current vs. target) in one text alternative.
  const targetSummary = outer
    .filter(s => s.weight > 0.0005)
    .map(s => `${s.label} ${fmtPct(s.weight)}`)
    .join(', ');
  const currentSummary = inner
    .filter(s => s.weight > 0.0005)
    .map(s => `${s.label} ${fmtPct(s.weight)}`)
    .join(', ');
  const ariaLabel = hasInner
    ? `Current vs. target allocation. Target: ${targetSummary}. Current: ${currentSummary}.`
    : `Target allocation: ${targetSummary}.`;

  return (
    <div className="flex items-start gap-6">
      {/* SVG */}
      <div className="relative shrink-0">
        <svg width={size} height={size} role="img" aria-label={ariaLabel}>
          {/* Gray tracks */}
          <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#e5e7eb" strokeWidth={sw} />
          <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#e5e7eb" strokeWidth={sw} />

          {/* Inner ring */}
          {innerSegs.map(seg => (
            <circle
              key={`in-${seg.label}`}
              cx={cx} cy={cy} r={seg.r}
              fill="none"
              stroke={seg.color}
              strokeWidth={seg.sw}
              strokeLinecap="butt"
              strokeDasharray={`${seg.dashLen} ${seg.circumference}`}
              strokeDashoffset={seg.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>{seg.label} (current): {fmtPct(seg.weight)}</title>
            </circle>
          ))}

          {/* Outer ring */}
          {outerSegs.map(seg => (
            <circle
              key={`out-${seg.label}`}
              cx={cx} cy={cy} r={seg.r}
              fill="none"
              stroke={seg.color}
              strokeWidth={seg.sw}
              strokeLinecap="butt"
              strokeDasharray={`${seg.dashLen} ${seg.circumference}`}
              strokeDashoffset={seg.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>{seg.label} (target): {fmtPct(seg.weight)}</title>
            </circle>
          ))}

          {/* Centre annotation */}
          <text x={cx} y={cy - 5} textAnchor="middle" fontSize={9} fill="#9ca3af">
            {hasInner ? 'current' : ''}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={9} fill="#9ca3af">
            {hasInner ? 'target ↑' : 'target'}
          </text>
        </svg>

      </div>

      {/* Legend — grid layout guarantees column alignment between header and rows */}
      <div className="flex-1 min-w-0 self-center space-y-0">

        {/* Header row */}
        <div className="grid text-xs text-gray-400 pb-1.5 mb-0.5 border-b border-gray-100"
             style={{ gridTemplateColumns: '1fr 3.5rem 3.5rem 3rem' }}>
          <span className="pl-4">Asset class</span>
          <span className="text-right">Now</span>
          <span className="text-right">Target</span>
          <span className="text-right">Change</span>
        </div>

        {/* Data rows */}
        {outer.map((sl, i) => {
          const currentWeight = inner[i]?.weight ?? 0;
          const drift = currentWeight - sl.weight;
          const significant = Math.abs(drift) >= 0.001;
          const driftLabel = significant
            ? (drift > 0 ? `+${fmtPct(drift)}` : fmtPct(drift))
            : '—';
          const driftColor = !significant    ? 'text-gray-300'
                           : drift > 0       ? 'text-red-400'
                           :                   'text-sky-500';
          return (
            <div
              key={sl.label}
              className="grid items-center text-xs py-[3px]"
              style={{ gridTemplateColumns: '1fr 3.5rem 3.5rem 3rem' }}
            >
              {/* Swatch + label live inside the first column */}
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: sl.color }} />
                <span className="text-gray-600 truncate">{sl.label}</span>
              </span>
              <span className="text-right tabular-nums text-gray-400">
                {hasInner ? fmtPct(currentWeight) : '—'}
              </span>
              <span className="text-right tabular-nums font-medium text-gray-700">
                {fmtPct(sl.weight)}
              </span>
              <span className={`text-right tabular-nums ${driftColor}`}>
                {hasInner ? driftLabel : '—'}
              </span>
            </div>
          );
        })}

        {/* Ring annotation */}
        <div className="flex items-center gap-4 pt-2.5 mt-1 text-xs text-gray-400 border-t border-gray-100">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-gray-300 shrink-0" />
            inner = current
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-gray-500 shrink-0" />
            outer = target
          </span>
        </div>
      </div>
    </div>
  );
}
