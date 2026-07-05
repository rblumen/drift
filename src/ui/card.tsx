// src/ui/card.tsx — shared card anatomy + small tag/chip primitives (#194
// component kit, section 1d "Card anatomy" / "Chips & badges" / "Tables").
//
// Stage 2's Overview rework first drew these as panel-local helpers; stages 3+
// need the same card shell across Accounts / Import / Classify, so they are
// promoted here as the one source of truth, with two widenings for the new
// callers: Card gains an optional `action` slot (header-right button, e.g.
// "+ Add account"), and Stat's label/caption accept ReactNode — the label span
// becomes a flex row so a HelpTip can sit inline, and the caption is optional.
// For plain-string callers (OverviewPanel) the rendered result is unchanged.
//
// Card anatomy (from the handoff): white, border #e5e8ee, radius 12, shadow
// 0 1px 2px rgba(8,40,85,.04); tinted header (8px 16px, bg #f4f6f9, bottom
// hairline) with a mono 10px uppercase tracking .12em #6b7685 title on the left
// and an optional mono 10px #9aa3b0 meta on the right. The header right slot can
// also hold an action (e.g. "+ Add account") via `action`.

import type { ReactNode } from 'react';

/**
 * The standard tinted-header card. `title` is the mono eyebrow; `meta` is the
 * right-aligned mono caption; `action` (when given) replaces `meta` with an
 * interactive element (button) in the header's right slot.
 */
export function Card({
  title, meta, action, children, className = '',
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-line rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(8,40,85,.04)] ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-line bg-tint">
        <span className="font-mono text-[10px] tracking-[.12em] uppercase text-[#6b7685]">{title}</span>
        {action ? action : meta ? (
          <span className="font-mono text-[10px] text-muted-3">{meta}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A single stat cell in a 1px-gap grid strip. Mono uppercase label, a 19px
 * semibold value (tone-colored), and a mono caption. Wrap several in a
 * `grid gap-px bg-tint-cell` container to get the instrument-panel look.
 */
export function Stat({ label, value, caption, tone = 'ink' }: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  tone?: 'ink' | 'warn' | 'accent' | 'ok' | 'muted';
}) {
  const valCls =
    tone === 'warn'   ? 'text-warn' :
    tone === 'accent' ? 'text-accent' :
    tone === 'ok'     ? 'text-ok' :
    tone === 'muted'  ? 'text-faint' :
    'text-brand-ink';
  const capCls = tone === 'warn' ? 'text-warn' : 'text-muted-3';
  return (
    <div className="bg-white px-4 pt-2.5 pb-3 flex flex-col gap-px min-w-0">
      <span className="flex items-center gap-1 font-mono text-[9.5px] tracking-[.12em] uppercase text-muted-3">{label}</span>
      <span className={`text-[19px] font-semibold tracking-tight ${valCls}`}>{value}</span>
      {caption != null && <span className={`font-mono text-[10.5px] truncate ${capCls}`}>{caption}</span>}
    </div>
  );
}

/**
 * Account-type tag pill — brand ramp (#194 kit). Reads the per-type text color
 * from ACCT_TYPE_COLOR; Taxable is the accent-tinted background, every other
 * type the brand-50 (info) background.
 */
export function AcctTypeTag({ label, color, taxable }: {
  label: string; color: string; taxable: boolean;
}) {
  return (
    <span
      className="font-mono text-[10.5px] px-2 py-0.5 rounded-[5px]"
      style={{ color, background: taxable ? '#fff0e8' : '#e8f0f9' }}
    >
      {label}
    </span>
  );
}

/**
 * Small mono uppercase source/status chip used in table cells (Classify Source
 * column, Import auto-detect). Pass the semantic tone.
 */
export function StatusChip({ children, tone }: {
  children: ReactNode;
  tone: 'warn' | 'info' | 'idle' | 'ok';
}) {
  const cls =
    tone === 'warn' ? 'text-warn bg-warn-bg' :
    tone === 'info' ? 'text-info bg-info-bg' :
    tone === 'ok'   ? 'text-ok bg-ok-bg' :
    'text-muted-2 bg-tint';
  return (
    <span className={`font-mono text-[9.5px] tracking-[.08em] uppercase px-[7px] py-0.5 rounded-full ${cls}`}>
      {children}
    </span>
  );
}
