// src/ui/Logo.tsx — Drift mark + wordmark
// The mark is fixed indigo + amber (the brand stays stable regardless of theme).
// Usage:
//   <Logo size={26} />              full lockup (mark + "Drift")
//   <Logo size={26} wordmark={false} />   mark only
//   <PaddleMark size={20} />        just the tile mark

type MarkProps = { size?: number; className?: string };

export function PaddleMark({ size = 28, className }: MarkProps) {
  const radius = Math.round(size * 0.28);
  const inner = Math.round(size * 0.74);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: size,
        height: size,
        borderRadius: radius,
        background: '#eef0fb',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flex: 'none',
      }}
      aria-hidden="true"
    >
      <svg width={inner} height={inner} viewBox="0 0 64 64" fill="none">
        <g transform="rotate(-15 32 36)">
          <path
            d="M27.5 18 C24 19 21 21.5 21 27 L21 53 Q21 59 28 59 L36 59 Q43 59 43 53 L43 27 C43 21.5 40 19 36.5 18 Z"
            fill="#f59e0b"
          />
          <rect x="29" y="6" width="6" height="53" fill="#4f46e5" />
          <line x1="32" y1="6" x2="32" y2="19" stroke="#4f46e5" strokeWidth={6} strokeLinecap="round" />
        </g>
        <line x1="6" y1="20" x2="58" y2="20" stroke="#aeb8f0" strokeWidth={2.4} strokeLinecap="round" />
        <path d="M23 20 q4 -2 8 0" fill="none" stroke="#aeb8f0" strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
      </svg>
    </span>
  );
}

type LogoProps = MarkProps & { wordmark?: boolean };

export function Logo({ size = 28, wordmark = true, className }: LogoProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.34) }}
    >
      <PaddleMark size={size} />
      {wordmark && (
        <span
          style={{
            fontWeight: 600,
            fontSize: Math.round(size * 0.74),
            letterSpacing: '-0.02em',
            color: '#11161d',
            lineHeight: 1,
          }}
        >
          Drift
        </span>
      )}
    </span>
  );
}

export default Logo;
