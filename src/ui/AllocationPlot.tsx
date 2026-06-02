import type { AssetClass } from '../engine/types';
import { aggressiveness, diversification } from '../engine/metrics';
import { fmtPct } from './fmt';

interface Props {
  currentWeights:   Record<AssetClass, number>;
  targetWeights:    Record<AssetClass, number>;
  projectedWeights: Record<AssetClass, number>;
  size?: number;
}

export function AllocationPlot({
  currentWeights, targetWeights, projectedWeights, size = 280,
}: Props) {
  const pad = 36;
  const plot = size - pad * 2;

  // Axes: x = diversification (0=concentrated → 1=diversified)
  //       y = aggressiveness  (0=conservative → 1=aggressive)
  const toXY = (w: Record<AssetClass, number>) => ({
    x: pad + diversification(w) * plot,
    y: pad + (1 - aggressiveness(w)) * plot,
  });

  const before    = toXY(currentWeights);
  const after     = toXY(projectedWeights);
  const targetXY  = toXY(targetWeights);

  // Suppress the arrow when before/after are visually indistinguishable.
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const moved = Math.hypot(dx, dy) > 2;

  // Arrowhead at the "after" endpoint.
  const arrowId = 'alloc-arrow';

  return (
    <div className="flex items-start gap-5">
      <svg
        width={size}
        height={size}
        className="shrink-0"
        role="img"
        aria-label="Allocation plot: aggressiveness vs diversification"
        data-testid="allocation-plot"
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="8" refY="5"
            markerWidth="6" markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
          </marker>
        </defs>

        {/* Plot background + axes */}
        <rect x={pad} y={pad} width={plot} height={plot}
          fill="#fafafa" stroke="#e5e7eb" strokeWidth={1} />

        {/* Center cross-hair */}
        <line x1={pad + plot / 2} y1={pad} x2={pad + plot / 2} y2={pad + plot}
          stroke="#f1f5f9" strokeWidth={1} />
        <line x1={pad} y1={pad + plot / 2} x2={pad + plot} y2={pad + plot / 2}
          stroke="#f1f5f9" strokeWidth={1} />

        {/* Axis labels */}
        <text x={pad + plot / 2} y={size - 6} textAnchor="middle"
          fontSize="10" fill="#6b7280">diversification →</text>
        <text x={pad - 4} y={pad - 8} textAnchor="start"
          fontSize="10" fill="#6b7280">aggressive</text>
        <text x={pad - 4} y={size - pad + 14} textAnchor="start"
          fontSize="10" fill="#6b7280">conservative</text>
        <text x={pad} y={size - 6} textAnchor="end"
          fontSize="10" fill="#9ca3af">concentrated</text>
        <text x={pad + plot} y={size - 6} textAnchor="end"
          fontSize="10" fill="#9ca3af">diversified</text>

        {/* Target reference (small star) */}
        <g>
          <circle cx={targetXY.x} cy={targetXY.y} r={9}
            fill="none" stroke="#10b981" strokeWidth={1.5} strokeDasharray="2 2" />
          <circle cx={targetXY.x} cy={targetXY.y} r={2.5} fill="#10b981">
            <title>
              Target — aggressiveness {fmtPct(aggressiveness(targetWeights))},
              diversification {fmtPct(diversification(targetWeights))}
            </title>
          </circle>
        </g>

        {/* Before → After vector */}
        {moved && (
          <line
            x1={before.x} y1={before.y} x2={after.x} y2={after.y}
            stroke="#2563eb" strokeWidth={1.75}
            markerEnd={`url(#${arrowId})`}
          />
        )}

        {/* Before point */}
        <circle cx={before.x} cy={before.y} r={5}
          fill="#fff" stroke="#6b7280" strokeWidth={2}>
          <title>
            Before — aggressiveness {fmtPct(aggressiveness(currentWeights))},
            diversification {fmtPct(diversification(currentWeights))}
          </title>
        </circle>

        {/* After point */}
        <circle cx={after.x} cy={after.y} r={5} fill="#2563eb">
          <title>
            After — aggressiveness {fmtPct(aggressiveness(projectedWeights))},
            diversification {fmtPct(diversification(projectedWeights))}
          </title>
        </circle>
      </svg>

      <div className="flex-1 min-w-0 text-xs text-gray-600 space-y-2">
        <div className="space-y-1">
          <LegendRow color="#fff" stroke="#6b7280" label="Before"
            x={diversification(currentWeights)} y={aggressiveness(currentWeights)} />
          <LegendRow color="#2563eb" label="After trades"
            x={diversification(projectedWeights)} y={aggressiveness(projectedWeights)} />
          <LegendRow color="#10b981" label="Target" dashed
            x={diversification(targetWeights)} y={aggressiveness(targetWeights)} />
        </div>
        <p className="text-gray-400 leading-snug">
          Aggressiveness = share in equities &amp; alternatives. Diversification = how evenly the
          allocation is spread across asset classes (normalized inverse Herfindahl).
        </p>
      </div>
    </div>
  );
}

function LegendRow({
  color, stroke, label, x, y, dashed,
}: {
  color: string; stroke?: string; label: string;
  x: number; y: number; dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{
          backgroundColor: color,
          border: stroke ? `1.5px solid ${stroke}` : undefined,
          borderStyle: dashed ? 'dashed' : undefined,
        }}
      />
      <span className="text-gray-600 flex-1">{label}</span>
      <span className="tabular-nums text-gray-500">
        agg {fmtPct(y)} · div {fmtPct(x)}
      </span>
    </div>
  );
}
