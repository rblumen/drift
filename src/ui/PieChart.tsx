import { fmtUsd } from './fmt';

export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

interface Props {
  slices: PieSlice[];
  /** Optional heading displayed above the chart. */
  title?: string;
  /** Diameter of the SVG in px (default 112). */
  size?: number;
}

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  // Full-circle edge-case: can't draw an arc from a point back to itself.
  if (end - start >= 359.999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
  }
  const s = polarXY(cx, cy, r, start);
  const e = polarXY(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

export function PieChart({ slices, title, size = 112 }: Props) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2 - 6;
  let cursor = 0;

  return (
    <div className="space-y-2">
      {title && (
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
      )}
      <div className="flex items-center gap-5">
        {/* SVG pie */}
        <svg width={size} height={size} className="shrink-0">
          {slices.map((sl, i) => {
            const deg  = (sl.value / total) * 360;
            const path = slicePath(cx, cy, r, cursor, cursor + deg);
            cursor += deg;
            return (
              <path key={i} d={path} fill={sl.color} stroke="white" strokeWidth={2}>
                <title>
                  {sl.label}: {fmtUsd(sl.value)} ({((sl.value / total) * 100).toFixed(1)}%)
                </title>
              </path>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="space-y-1.5 min-w-0 flex-1">
          {slices.map((sl, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: sl.color }} />
              <span className="text-gray-600 truncate">{sl.label}</span>
              <span className="ml-auto text-gray-400 tabular-nums shrink-0">
                {fmtUsd(sl.value)} ({((sl.value / total) * 100).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
