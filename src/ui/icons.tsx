// src/ui/icons.tsx — the shared inline-SVG icon set (issue #150, then the
// #194 component-kit redesign).
//
// One small component per UI-chrome icon, replacing the raw emoji and text
// glyphs that used to stand in for them (🔒 ⏰ ☕ ✎ ℹ ↓ ↑ ✕ ▾ ▸ ✓ 📅 …).
//
// House style — the #194 "instrument panel" kit (section 1d of the app-shell
// handoff). The kit's icons are drawn on a tighter grid than the original set:
//   • 14×14 viewBox, rendered 12–16px (default 16)
//   • stroke="currentColor", fill="none" line style so icons inherit text color
//   • strokeWidth 1.3–1.5 with round caps/joins (per-icon, matched to the kit)
//   • aria-hidden by default — the buttons/links that host them carry the
//     accessible name (visible text or an aria-label from the #163 a11y pass)
//
// Path data is copied verbatim from the handoff's section 1d markup so the
// rendered geometry matches the design reference exactly. Icons the kit does
// not itself draw (lock-open, clock, coffee) are drawn to the same 14×14 grid
// and stroke weight so the whole set reads as one family.
//
// The component names and the { size, className, aria-label } API are stable —
// every existing call site keeps working unchanged.

interface IconProps {
  /** Rendered square size in px. Defaults to 16 (the kit's 12–16 band). */
  size?: number;
  className?: string;
  /**
   * Override the default aria-hidden. Icons are decorative by default because
   * their host carries the accessible name; pass a label only for the rare
   * standalone-icon case that needs its own name.
   */
  'aria-label'?: string;
}

function svgProps({ size = 16, className, 'aria-label': ariaLabel }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    className,
    ...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true }),
  } as const;
}

// The kit uses per-icon stroke weights in the 1.3–1.5 band. STROKE is the
// default (1.4); a few icons override strokeWidth to match section 1d exactly.
const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

// ── Lock toggles (🔒 / 🔓) ────────────────────────────────────────────────────

export function IconLock(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.4" y="6.2" width="7.2" height="5.6" rx="1" {...STROKE} strokeWidth={1.3} />
      <path d="M4.9 6.2V4.6a2.1 2.1 0 0 1 4.2 0v1.6" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

export function IconLockOpen(props: IconProps) {
  // Not in the kit card; drawn to the same 14×14 grid / weight as IconLock so
  // the lock/unlock pair stays visually matched.
  return (
    <svg {...svgProps(props)}>
      <rect x="3.4" y="6.2" width="7.2" height="5.6" rx="1" {...STROKE} strokeWidth={1.3} />
      <path d="M4.9 6.2V4.6a2.1 2.1 0 0 1 4.05-.65" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── Lock-split toggles — lock over pie (issue #43) ────────────────────────────
//
// The Strategy tab's sub-class proportion toggle: a lock superimposed on a
// pie chart. Geometry is verbatim from the #43 design handoff (final glyph 3c).
// The lock sits over the pie with a knockout halo — the hasp re-stroked at 3.2
// and a padded body rect, both painted in the host chip's background color —
// so the pie reads through the gap. `knockout` is required: pass the chip's
// current background (a CSS var like 'var(--knock)' lets hover tints track).

export function IconLockSplit({ knockout, ...props }: IconProps & { knockout: string }) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="5.4" cy="5.4" r="4.4" stroke="currentColor" strokeWidth={1.3} />
      <path d="M5.4 5.4 L5.4 1 A4.4 4.4 0 0 0 1.59 3.2 Z" fill="currentColor" />
      <path d="M8.95 8.6 V7.7 a1.35 1.35 0 0 1 2.7 0 V8.6" stroke={knockout} strokeWidth={3.2} strokeLinecap="round" fill="none" />
      <rect x="6.25" y="7.65" width="8.1" height="6.7" rx="1.95" fill={knockout} />
      <rect x="7.2" y="8.6" width="6.2" height="4.8" rx="1" fill="currentColor" />
      <path d="M8.95 8.6 V7.7 a1.35 1.35 0 0 1 2.7 0 V8.6" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

export function IconLockSplitOpen({ knockout, ...props }: IconProps & { knockout: string }) {
  // Hasp pivots up with exaggerated daylight under the right leg. Butt caps are
  // intentional — round caps (0.6 unit overhang each end) swallow the open gap.
  return (
    <svg {...svgProps(props)}>
      <circle cx="5.4" cy="5.4" r="4.4" stroke="currentColor" strokeWidth={1.3} />
      <path d="M5.4 5.4 L5.4 1 A4.4 4.4 0 0 0 1.59 3.2 Z" fill="currentColor" />
      <path d="M8.95 8.6 V6.7 a1.35 1.35 0 0 1 2.7 0 V6.9" stroke={knockout} strokeWidth={3.2} strokeLinecap="butt" fill="none" />
      <rect x="6.25" y="7.65" width="8.1" height="6.7" rx="1.95" fill={knockout} />
      <rect x="7.2" y="8.6" width="6.2" height="4.8" rx="1" fill="currentColor" />
      <path d="M8.95 8.6 V6.7 a1.35 1.35 0 0 1 2.7 0 V6.9" stroke="currentColor" strokeWidth={1.3} strokeLinecap="butt" />
    </svg>
  );
}

// ── File actions (↓ Save / ↑ Load / ↓ report / ↓ file) ────────────────────────

export function IconDownload(props: IconProps) {
  // Kit "save" — ↓ into a tray.
  return (
    <svg {...svgProps(props)}>
      <path d="M7 2.2v6.2" {...STROKE} />
      <path d="M4.4 5.8L7 8.4 9.6 5.8" {...STROKE} />
      <path d="M2.6 11.4h8.8" {...STROKE} />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  // Kit "load" — ↑ out of a tray.
  return (
    <svg {...svgProps(props)}>
      <path d="M7 8.4V2.2" {...STROKE} />
      <path d="M4.4 4.8L7 2.2 9.6 4.8" {...STROKE} />
      <path d="M2.6 11.4h8.8" {...STROKE} />
    </svg>
  );
}

// ── Dismiss / reset / remove (✕) ──────────────────────────────────────────────

export function IconX(props: IconProps) {
  // Kit "close".
  return (
    <svg {...svgProps(props)}>
      <path d="M3.8 3.8L10.2 10.2" {...STROKE} />
      <path d="M10.2 3.8L3.8 10.2" {...STROKE} />
    </svg>
  );
}

// ── Expand / collapse chevrons (▾ / ▸) ────────────────────────────────────────

export function IconChevronDown(props: IconProps) {
  // Kit "expand" chevron.
  return (
    <svg {...svgProps(props)}>
      <path d="M3.5 5.5L7 9l3.5-3.5" {...STROKE} />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  // Collapsed state: the kit rotates the expand chevron -90°. Same path,
  // rotated so callers keep a distinct right-pointing component.
  return (
    <svg {...svgProps(props)}>
      <g transform="rotate(-90 7 7)">
        <path d="M3.5 5.5L7 9l3.5-3.5" {...STROKE} />
      </g>
    </svg>
  );
}

// ── Reminder banner + panel (⏰) ───────────────────────────────────────────────

export function IconClock(props: IconProps) {
  // Not in the kit card; drawn to the same 14×14 grid / weight.
  return (
    <svg {...svgProps(props)}>
      <circle cx="7" cy="7.4" r="4.4" {...STROKE} strokeWidth={1.3} />
      <path d="M7 5V7.4l1.55 1.1" {...STROKE} strokeWidth={1.3} />
      <path d="M3.5 2.2 2 3.5M10.5 2.2 12 3.5" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── Add-to-calendar / remind (📅) ─────────────────────────────────────────────

export function IconCalendar(props: IconProps) {
  // Kit "remind".
  return (
    <svg {...svgProps(props)}>
      <rect x="2.2" y="3" width="9.6" height="8.6" rx="1" {...STROKE} strokeWidth={1.3} />
      <path d="M2.2 5.8h9.6" {...STROKE} strokeWidth={1.3} />
      <path d="M4.6 1.6v2" {...STROKE} strokeWidth={1.3} />
      <path d="M9.4 1.6v2" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── Report / trade doc (↓ report) ─────────────────────────────────────────────

export function IconReport(props: IconProps) {
  // Kit "report" — a document with ruled lines.
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="1.8" width="8" height="10.4" rx="1" {...STROKE} strokeWidth={1.3} />
      <path d="M4.8 4.8h4.4" {...STROKE} strokeWidth={1.3} />
      <path d="M4.8 7h4.4" {...STROKE} strokeWidth={1.3} />
      <path d="M4.8 9.2h2.6" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── External link (↗) ─────────────────────────────────────────────────────────

export function IconExternal(props: IconProps) {
  // Kit "external" — box with an arrow leaving the top-right.
  return (
    <svg {...svgProps(props)}>
      <path d="M5.8 3H3v8h8V8.2" {...STROKE} strokeWidth={1.3} />
      <path d="M8.6 2.4h3v3" {...STROKE} strokeWidth={1.3} />
      <path d="M11.4 2.6L6.8 7.2" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── Ko-fi / support (☕) ───────────────────────────────────────────────────────

export function IconCoffee(props: IconProps) {
  // Not in the kit card; restyled to the 14×14 grid / kit stroke weight so it
  // sits with the rest of the family on the landing "buy me a coffee" link.
  return (
    <svg {...svgProps(props)}>
      <path d="M2.6 5.6h7v2.9A2.4 2.4 0 0 1 7.2 10.9H5A2.4 2.4 0 0 1 2.6 8.5V5.6Z" {...STROKE} strokeWidth={1.3} />
      <path d="M9.6 6h1.1a1.5 1.5 0 0 1 0 3H9.6" {...STROKE} strokeWidth={1.3} />
      <path d="M4.6 2.2v1.3M6.8 2.2v1.3" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── Manually-edited indicator (✎) ──────────────────────────────────────────────

export function IconPencil(props: IconProps) {
  // Kit "edit".
  return (
    <svg {...svgProps(props)}>
      <path d="M3 11l.6-2.4 5.8-5.8 1.8 1.8-5.8 5.8L3 11z" {...STROKE} strokeWidth={1.3} />
    </svg>
  );
}

// ── Help toggle (ℹ) ────────────────────────────────────────────────────────────

export function IconInfo(props: IconProps) {
  // Kit "help" — circle with an i.
  return (
    <svg {...svgProps(props)}>
      <circle cx="7" cy="7" r="5.4" {...STROKE} strokeWidth={1.3} />
      <path d="M7 6.4v3" {...STROKE} strokeWidth={1.3} />
      <circle cx="7" cy="4.3" r="0.4" fill="currentColor" />
    </svg>
  );
}

// ── Status checkmark (✓) ───────────────────────────────────────────────────────

export function IconCheck(props: IconProps) {
  // Not in the kit card; the rail's completion check. Drawn to the 14×14 grid.
  return (
    <svg {...svgProps(props)}>
      <path d="M3 7.4 5.6 10 11 3.8" {...STROKE} />
    </svg>
  );
}
