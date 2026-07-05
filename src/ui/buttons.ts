// src/ui/buttons.ts — shared button classname constants (#194 component kit,
// section 1d "Buttons").
//
// The app had the same handful of button className strings copy-pasted across
// panels. The kit defines one canonical set of variants; centralising them here
// keeps every call site on-spec and makes future retunes a one-line change.
// These are plain className constants (not a Button component) so existing
// <button> markup — handlers, refs, aria-labels, disabled logic — is untouched;
// only the `className` string is swapped.
//
// Kit spec: 13px (12px compact), weight 600 primary / 500 others, radius 7–8px.
//   • Primary        #0d3e7a → hover #082855, white text
//   • Payoff         #e8600a → hover #b84a06 (Results CTAs)
//   • Ghost          white, border #e5e8ee → hover border #9aa3b0
//   • Tinted info    #0d3e7a on #e8f0f9, border #ccdcf0
//   • Destructive-quiet  ghost w/ muted text; hover border #e8b4b4, text #b3403a
//   • Text link      #5b6673 → hover #2a3441
//
// Tokens (tailwind.config.js): brand/brand-ink, accent/accent-ink, line,
// muted-1/2, info, danger.

/** Primary action — solid brand, white text, weight 600. */
export const btnPrimary =
  'inline-flex items-center gap-1.5 font-semibold text-[13px] text-white ' +
  'bg-brand-600 hover:bg-brand-700 rounded-lg px-4 py-2 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** Compact primary — same, 12px / tighter padding (inline table/form actions). */
export const btnPrimaryCompact =
  'inline-flex items-center gap-1 font-semibold text-[12px] text-white ' +
  'bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** Payoff — accent orange, white text (Results download/CTA steps). */
export const btnPayoff =
  'inline-flex items-center gap-1.5 font-semibold text-[13px] text-white ' +
  'bg-accent hover:bg-accent-ink rounded-lg px-4 py-2 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** Ghost — white, hairline border, weight 500 body ink. */
export const btnGhost =
  'inline-flex items-center gap-1.5 font-medium text-[13px] text-ink ' +
  'bg-white border border-line hover:border-muted-2 rounded-lg px-3.5 py-2 ' +
  'transition-colors';

/** Compact ghost — 12px, tighter (secondary table/form actions, "Cancel"). */
export const btnGhostCompact =
  'inline-flex items-center gap-1 font-medium text-[12px] text-muted-1 ' +
  'bg-white border border-line hover:border-muted-2 rounded-md px-3 py-1.5 ' +
  'transition-colors';

/** Tinted info — brand text on brand-50, brand-100 border. */
export const btnTintedInfo =
  'inline-flex items-center gap-1.5 font-medium text-[12px] text-info ' +
  'bg-info-bg hover:bg-brand-100 border border-info-border rounded-lg px-3 py-1.5 ' +
  'transition-colors';

/**
 * Destructive-quiet — reads as a muted ghost until hover, where it turns
 * danger-red. Used for Reset / Remove triggers that shouldn't shout.
 */
export const btnDestructiveQuiet =
  'inline-flex items-center gap-1 font-medium text-[12px] text-muted-2 ' +
  'bg-white border border-line hover:border-danger-hover-border hover:text-danger ' +
  'rounded-md px-3 py-1.5 transition-colors';

/** Solid danger — for the confirm side of a destructive dialog. */
export const btnDanger =
  'inline-flex items-center gap-1.5 font-semibold text-[13px] text-white ' +
  'bg-danger-solid hover:bg-danger-solid-hover rounded-lg px-4 py-2 transition-colors';

/** Text link — quiet by default, darkens on hover. No box. */
export const btnTextLink =
  'font-medium text-[13px] text-muted-1 hover:text-ink transition-colors';

/** Underlined text link (in banners / captions). */
export const btnTextLinkUnderline =
  'font-medium underline underline-offset-2 text-info hover:text-brand-ink transition-colors';
