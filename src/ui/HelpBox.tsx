import { useState, useRef, useEffect } from 'react';

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
    <div className="border border-indigo-100 rounded-lg bg-indigo-50/40 text-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
      >
        <span className="text-indigo-400 text-base leading-none select-none">ℹ</span>
        <span className="font-medium text-xs tracking-wide flex-1">{label}</span>
        <span className="text-indigo-300 text-xs select-none">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-gray-600 text-xs leading-relaxed border-t border-indigo-100">
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

/**
 * A small inline "?" button that opens a floating popover on click.
 * Click anywhere outside (or press Escape) to dismiss.
 *
 * Designed to sit next to a label or table-header cell:
 *   <label>New cash <HelpTip>…explanation…</HelpTip></label>
 */
export function HelpTip({ children, dir = 'up' }: TipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

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

  // Positioning classes per direction.
  const popoverPos: Record<string, string> = {
    up:   'bottom-full mb-2 left-1/2 -translate-x-1/2',
    down: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
  };
  // Arrow (caret) position per direction.
  const arrowPos: Record<string, string> = {
    up:   'top-full left-1/2 -translate-x-1/2 border-t-gray-700 border-x-transparent border-b-transparent border-4',
    down: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-700 border-x-transparent border-t-transparent border-4',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-700 border-y-transparent border-r-transparent border-4',
  };

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`
          ml-1 inline-flex items-center justify-center
          w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none
          select-none transition-colors
          ${open
            ? 'bg-indigo-500 text-white'
            : 'bg-gray-200 text-gray-500 hover:bg-indigo-400 hover:text-white'
          }
        `}
        aria-label="Help"
      >
        ?
      </button>

      {open && (
        <span
          className={`
            absolute z-50 ${popoverPos[dir]}
            w-64 bg-gray-800 text-white text-xs rounded-lg px-3 py-2.5
            leading-relaxed shadow-lg pointer-events-none
          `}
          role="tooltip"
        >
          {children}
          {/* Caret */}
          <span className={`absolute border ${arrowPos[dir]}`} />
        </span>
      )}
    </span>
  );
}
