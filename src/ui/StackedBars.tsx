import { fmtUsd } from './fmt';

export interface StackedSegment {
  /** Legend / tooltip label for this segment. */
  label: string;
  value: number;
  color: string;
}

export interface StackedRow {
  /** Row label shown to the left of the bar. */
  label: string;
  /** Pre-computed total (sum of segments). */
  total: number;
  segments: StackedSegment[];
}

export interface LegendEntry {
  label: string;
  color: string;
}

interface Props {
  rows: StackedRow[];
  /** Colour-swatch legend entries rendered below the bars. */
  legend: LegendEntry[];
  /** Optional heading displayed above the bars. */
  title?: string;
}

export function StackedBars({ rows, legend, title }: Props) {
  if (rows.length === 0) return null;

  const maxTotal = Math.max(...rows.map(r => r.total));

  return (
    <div className="space-y-1">
      {title && (
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</p>
      )}

      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-3">
          {/* Label — right-aligned so it sits flush against the bar */}
          <span className="text-xs text-gray-600 w-28 shrink-0 text-right truncate" title={row.label}>
            {row.label}
          </span>

          {/* Bar track — full flex width; filled portion scales to maxTotal */}
          <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
            <div
              className="h-full flex"
              style={{ width: `${(row.total / maxTotal) * 100}%` }}
            >
              {row.segments.map((seg, j) => (
                <div
                  key={j}
                  className="h-full transition-[width]"
                  style={{
                    width:           `${(seg.value / row.total) * 100}%`,
                    backgroundColor: seg.color,
                  }}
                  title={`${seg.label}: ${fmtUsd(seg.value)} (${((seg.value / row.total) * 100).toFixed(1)}%)`}
                />
              ))}
            </div>
          </div>

          {/* Total value */}
          <span className="text-xs text-gray-400 tabular-nums w-16 text-right shrink-0">
            {fmtUsd(row.total)}
          </span>
        </div>
      ))}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 pt-3">
        {legend.map((entry, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </div>
        ))}
      </div>
    </div>
  );
}
