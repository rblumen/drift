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
  cx: number,
  cy: number,
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

  const innerSegs = buildRingSegments(inner, cx, cy, innerR, sw);
  const outerSegs = buildRingSegments(outer, cx, cy, outerR, sw);

  const hasInner = innerSegs.some(s => s.weight > 0);

  return (
    <div className="flex items-start gap-6">
      {/* SVG */}
      <div className="relative shrink-0">
        <svg width={size} height={size}>
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

        {/* Ring labels outside the SVG */}
        {hasInner && (
          <div className="absolute -right-1 top-1/2 -translate-y-1/2 flex flex-col gap-1 text-right pointer-events-none">
          </div>
        )}
      </div>

      {/* Legend — current vs target per asset class */}
      <div className="space-y-2 flex-1 min-w-0 self-center">
        {/* Header */}
        <div className="flex text-xs text-gray-400 gap-2 pb-0.5 border-b border-gray-100 mb-1">
          <span className="flex-1">Asset class</span>
          <span className="w-14 text-right">Now</span>
          <span className="w-4 text-center" />
          <span className="w-14 text-right">Target</span>
        </div>
        {outer.map((sl, i) => {
          const currentWeight = inner[i]?.weight ?? 0;
          const drift = currentWeight - sl.weight;
          const driftLabel =
            Math.abs(drift) < 0.001 ? null :
            drift > 0 ? `+${fmtPct(drift)}` : fmtPct(drift);
          const driftColor =
            Math.abs(drift) < 0.001 ? '' :
            drift > 0 ? 'text-red-400' : 'text-sky-500';
          return (
            <div key={sl.label} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: sl.color }} />
              <span className="text-gray-600 flex-1 truncate">{sl.label}</span>
              {hasInner ? (
                <>
                  <span className="w-14 text-right tabular-nums text-gray-500">
                    {fmtPct(currentWeight)}
                  </span>
                  <span className={`w-4 text-center text-gray-300`}>→</span>
                </>
              ) : (
                <span className="w-18" />
              )}
              <span className="w-14 text-right tabular-nums font-medium text-gray-700">
                {fmtPct(sl.weight)}
              </span>
              {driftLabel && (
                <span className={`w-12 text-right tabular-nums text-xs ${driftColor}`}>
                  {driftLabel}
                </span>
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-2 pt-2 text-xs text-gray-400 border-t border-gray-100">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-gray-300 shrink-0" />
          <span>inner = current</span>
          <span className="ml-3 w-2.5 h-2.5 rounded-full border-2 border-gray-400 shrink-0" />
          <span>outer = target</span>
        </div>
      </div>
    </div>
  );
}
