// src/ui/Logo.tsx — Drift mark + wordmark (V1 lockup)
//
// The V1 wordmark: paddle mark with a short waterline stub,
// "Drift" text at the same baseline. Mark and type share a
// common ground — the waterline IS the text baseline.
//
// Usage:
//   <DriftWordmark height={32} />   full lockup (nav use)
//   <PaddleMark size={20} />        mark only (favicon, icon contexts)

type MarkProps = { size?: number; className?: string };

export function PaddleMark({ size = 28, className }: MarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <g transform="rotate(-38 32 36)">
        <path
          d="M27.5 18 C24 19 21 21.5 21 27 L21 53 Q21 59 28 59 L36 59 Q43 59 43 53 L43 27 C43 21.5 40 19 36.5 18 Z"
          fill="#e8600a"
        />
        <rect x="29" y="6" width="6" height="53" fill="#0d3e7a" />
        <line x1="32" y1="6" x2="32" y2="19" stroke="#0d3e7a" strokeWidth={6} strokeLinecap="round" />
      </g>
      <line x1="6" y1="26" x2="58" y2="26" stroke="#8aaccc" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}

type WordmarkProps = { height?: number; className?: string };

// DriftWordmark renders the full V1 lockup as a single SVG.
// height controls the overall size; width scales proportionally (~3.7×).
// The mark's waterline IS the text baseline — they share the same y.
//
// At height=32 (nav default): paddle ~32px tall, "Drift" at ~19px font-size.
// At height=48 (hero use):    paddle ~48px tall, "Drift" at ~28px font-size.
export function DriftWordmark({ height = 32, className }: WordmarkProps) {
  // The paddle in its 64×64 viewbox, after rotate(-38°), spans vertically
  // from roughly y=5 (shaft tip) to y=55 (blade corner) = 50 units.
  // Scale so the full paddle fits in `height` px.
  const s = height / 50;
  // Translate so the shaft tip lands at y=0
  const dy = -(5 * s);
  // Waterline in output coordinates
  const waterY = 26 * s + dy;
  // Stub width: just under the mark (~32 units in vb)
  const stubEnd = Math.round(32 * s + 2);
  // Text starts after a small gap
  const textX = Math.round(36 * s + 2);
  const fontSize = Math.round(height * 0.58);
  // Total width
  const width = Math.round(textX + fontSize * 3.2);

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-label="Drift"
      style={{ display: 'block', flex: 'none' }}
    >
      <g transform={`translate(2,${dy}) scale(${s})`}>
        <g transform="rotate(-38 32 36)">
          <path
            d="M27.5 18 C24 19 21 21.5 21 27 L21 53 Q21 59 28 59 L36 59 Q43 59 43 53 L43 27 C43 21.5 40 19 36.5 18 Z"
            fill="#e8600a"
          />
          <rect x="29" y="6" width="6" height="53" fill="#0d3e7a" />
          <line x1="32" y1="6" x2="32" y2="19" stroke="#0d3e7a" strokeWidth={6} strokeLinecap="round" />
        </g>
      </g>
      <line x1="2" y1={waterY} x2={stubEnd} y2={waterY} stroke="#8aaccc" strokeWidth={1.6} strokeLinecap="round" />
      <text
        x={textX}
        y={waterY}
        fontFamily="'Schibsted Grotesk', system-ui, sans-serif"
        fontWeight="600"
        fontSize={fontSize}
        letterSpacing="-0.5"
        fill="#2a3441"
      >
        Drift
      </text>
    </svg>
  );
}

// Legacy default export for backward compat
export function Logo({ size = 28 }: MarkProps) {
  return <DriftWordmark height={size} />;
}

export default DriftWordmark;
