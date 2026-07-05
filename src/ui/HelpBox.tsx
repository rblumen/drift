import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo, IconChevronDown, IconChevronRight } from './icons';

interface Props {
  /** Label shown on the toggle button. Defaults to "About this step". */
  label?: string;
  children: React.ReactNode;
  /** Start expanded. Defaults to false. */
  defaultOpen?: boolean;
}

/**
 * A collapsible help section. Click the toggle to expand/collapse.
 * Keeps the UI clean by default while making detail accessible on demand.
 */
export function HelpBox({ label = 'About this step', children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-info-border rounded-lg bg-info-bg text-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-info hover:bg-brand-100 rounded-lg transition-colors"
      >
        <span className="text-brand-400 inline-flex select-none"><IconInfo size={15} /></span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] flex-1">{label}</span>
        <span className="text-brand-300 inline-flex select-none">{open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-muted-1 text-xs leading-relaxed border-t border-info-border">
          {children}
        </div>
      )}
    </div>
  );
}

/** A labelled section inside a HelpBox. */
export function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-gray-700 mb-1">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** A definition-style row: bold term, then description. */
export function HelpDef({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-medium text-gray-700">{term}</span>
      {' — '}
      {children}
    </p>
  );
}

// ── HelpTip ───────────────────────────────────────────────────────────────────

interface TipProps {
  /** The help text shown in the popover. Can be a string or JSX. */
  children: React.ReactNode;
  /**
   * Preferred opening direction.
   * 'up'   — popover opens above the button (default)
   * 'down' — popover opens below
   * 'left' — popover opens to the left (useful in table headers near the right edge)
   */
  dir?: 'up' | 'down' | 'left';
}

// Popover width, kept in sync with the `w-64` class below (16rem @ 16px root = 256px).
const POPOVER_WIDTH = 256;
const GAP = 8; // gap between trigger and popover, in px (mirrors the old mb-2/mr-2 = 0.5rem)

type Coords = { top: number; left: number };

/**
 * Compute fixed-position coordinates for the popover so it escapes any
 * scroll/overflow ancestor. Based on the trigger's viewport-relative
 * bounding rect (position: fixed is relative to the viewport, not an
 * ancestor, as long as no ancestor sets a transform/filter/contain — true
 * here since the popover is portaled to document.body).
 */
function computeCoords(trigger: HTMLElement, dir: 'up' | 'down' | 'left'): Coords {
  const rect = trigger.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  let top: number;
  let left: number;

  if (dir === 'left') {
    top = centerY;
    left = rect.left - GAP;
  } else if (dir === 'down') {
    top = rect.bottom + GAP;
    left = centerX;
  } else {
    // 'up' (default)
    top = rect.top - GAP;
    left = centerX;
  }

  return { top, left };
}

/**
 * A small inline "?" button that opens a floating popover on click.
 * Click anywhere outside (or press Escape) to dismiss.
 *
 * Designed to sit next to a label or table-header cell:
 *   <label>New cash <HelpTip>…explanation…</HelpTip></label>
 *
 * The popover is rendered via a portal to `document.body` and positioned
 * with `position: fixed` from the trigger's bounding rect, so it always
 * escapes ancestor scroll containers (e.g. the `overflow-x-auto` table
 * wrappers used for mobile — see issue #190).
 */
export function HelpTip({ children, dir = 'up' }: TipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Recompute position on open, and keep it in sync with scroll/resize
  // (e.g. scrolling the table's overflow-x-auto wrapper horizontally).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      if (triggerRef.current) setCoords(computeCoords(triggerRef.current, dir));
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, dir]);

  // Popover transform per direction: positions the popover box relative to
  // the anchor point returned by computeCoords (which sits at the trigger's
  // edge/center, not the popover's own corner).
  const popoverTransform: Record<string, string> = {
    up:   'translate(-50%, -100%)',
    down: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
  };
  // Arrow (caret) position per direction, relative to the popover box.
  const arrowPos: Record<string, string> = {
    up:   'top-full left-1/2 -translate-x-1/2 border-t-gray-700 border-x-transparent border-b-transparent border-4',
    down: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-700 border-x-transparent border-t-transparent border-4',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-700 border-y-transparent border-r-transparent border-4',
  };

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`
          ml-1 inline-flex items-center justify-center
          w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none
          select-none transition-colors
          ${open
            ? 'bg-brand-500 text-white'
            : 'bg-gray-200 text-gray-500 hover:bg-brand-400 hover:text-white'
          }
        `}
        aria-label="Help"
      >
        ?
      </button>

      {open && coords && createPortal(
        <span
          className="fixed z-50 w-64 bg-gray-800 text-white text-xs rounded-lg px-3 py-2.5 leading-relaxed shadow-lg pointer-events-none"
          style={{
            top: coords.top,
            left: coords.left,
            transform: popoverTransform[dir],
            width: POPOVER_WIDTH,
          }}
          role="tooltip"
        >
          {children}
          {/* Caret */}
          <span className={`absolute border ${arrowPos[dir]}`} />
        </span>,
        document.body,
      )}
    </span>
  );
}
