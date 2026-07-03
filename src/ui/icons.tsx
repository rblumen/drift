// src/ui/icons.tsx — the shared inline-SVG icon set (issue #150, part 2).
//
// One small component per UI-chrome icon, replacing the raw emoji and text
// glyphs that used to stand in for them (🔒 ⏰ ☕ ✎ ℹ ↓ ↑ ✕ ▾ ▸ ✓ 📅 …).
//
// House style — matched to the existing drawn icons on the landing page, the
// Overview steps, the #189 allocation-chart toggle (src/ui/AllocationViews.tsx,
// the freshest reference), and the How-it-works drawer's close button:
//   • 16×16 viewBox, rendered 14–18px
//   • stroke="currentColor", fill="none" line style so icons inherit text color
//   • strokeWidth 1.5 with round caps/joins (the toggle's weight/character)
//   • aria-hidden by default — the buttons/links that host them carry the
//     accessible name (visible text or an aria-label from the #163 a11y pass)
//
// A couple of icons (bar-view-style fills, the coffee cup) use fills where a
// stroke-only rendering reads poorly at 16px, matching how the toggle's bar
// icon is drawn.

interface IconProps {
  /** Rendered square size in px. Defaults to 16 (the design's 14–18 band). */
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
    viewBox: '0 0 16 16',
    fill: 'none',
    className,
    ...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true }),
  } as const;
}

const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

// ── Lock toggles (🔒 / 🔓) ────────────────────────────────────────────────────

export function IconLock(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" {...STROKE} />
      <path d="M5.25 7V4.75a2.75 2.75 0 0 1 5.5 0V7" {...STROKE} />
    </svg>
  );
}

export function IconLockOpen(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" {...STROKE} />
      <path d="M5.25 7V4.75a2.75 2.75 0 0 1 5.35-.85" {...STROKE} />
    </svg>
  );
}

// ── File actions (↓ Save / ↑ Load / ↓ report / ↓ file) ────────────────────────

export function IconDownload(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8 2.5v7.5" {...STROKE} />
      <path d="M4.75 7 8 10.25 11.25 7" {...STROKE} />
      <path d="M3 13h10" {...STROKE} />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8 10.5V3" {...STROKE} />
      <path d="M4.75 6.25 8 3l3.25 3.25" {...STROKE} />
      <path d="M3 13h10" {...STROKE} />
    </svg>
  );
}

// ── Dismiss / reset / remove (✕) ──────────────────────────────────────────────

export function IconX(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 4l8 8M12 4l-8 8" {...STROKE} />
    </svg>
  );
}

// ── Expand / collapse chevrons (▾ / ▸) ────────────────────────────────────────

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 6l4 4 4-4" {...STROKE} />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 4l4 4-4 4" {...STROKE} />
    </svg>
  );
}

// ── Reminder banner + panel (⏰) ───────────────────────────────────────────────

export function IconClock(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="8" cy="8.5" r="5" {...STROKE} />
      <path d="M8 5.75V8.5l1.75 1.25" {...STROKE} />
      <path d="M4 2.5 2 4M12 2.5 14 4" {...STROKE} />
    </svg>
  );
}

// ── Add-to-calendar (📅) ───────────────────────────────────────────────────────

export function IconCalendar(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="2.75" y="3.5" width="10.5" height="9.5" rx="1.5" {...STROKE} />
      <path d="M2.75 6.25h10.5M5.5 2.25v2.5M10.5 2.25v2.5" {...STROKE} />
    </svg>
  );
}

// ── Ko-fi / support (☕) ───────────────────────────────────────────────────────

export function IconCoffee(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 6.5h8v3.25A2.75 2.75 0 0 1 8.25 12.5h-2.5A2.75 2.75 0 0 1 3 9.75V6.5Z" {...STROKE} />
      <path d="M11 7h1.25a1.75 1.75 0 0 1 0 3.5H11" {...STROKE} />
      <path d="M5.25 2.5v1.5M8 2.5v1.5" {...STROKE} />
    </svg>
  );
}

// ── Manually-edited indicator (✎) ──────────────────────────────────────────────

export function IconPencil(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M10.5 2.75 13.25 5.5 6 12.75l-3.25.5.5-3.25 7.25-7.25Z" {...STROKE} />
      <path d="M9.25 4 12 6.75" {...STROKE} />
    </svg>
  );
}

// ── Help toggle (ℹ) ────────────────────────────────────────────────────────────

export function IconInfo(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="8" cy="8" r="6" {...STROKE} />
      <path d="M8 7.25v3.5" {...STROKE} />
      <circle cx="8" cy="5.15" r="0.9" fill="currentColor" />
    </svg>
  );
}

// ── Status checkmark (✓) ───────────────────────────────────────────────────────

export function IconCheck(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...STROKE} />
    </svg>
  );
}
