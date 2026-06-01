import { useEffect, useMemo, useRef, useState } from 'react';
import type { Reminder } from '../ingest/schema';
import {
  downloadReminderIcs,
  googleCalendarUrl,
  outlookLiveCalendarUrl,
  office365CalendarUrl,
  yahooCalendarUrl,
} from './ics';

interface Props {
  reminder: Reminder;
  setReminder: (r: Reminder) => void;
}

const INTERVAL_PRESETS: { label: string; months: number }[] = [
  { label: '3 months',  months: 3  },
  { label: '6 months',  months: 6  },
  { label: '12 months', months: 12 },
];

/** Day count between two midnight-local timestamps, positive if `to` is in the future. */
export function daysUntil(nowMs: number, targetMs: number): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const now = new Date(nowMs);
  const target = new Date(targetMs);
  const a = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const b = Date.UTC(now.getFullYear(),    now.getMonth(),    now.getDate());
  return Math.round((a - b) / MS_PER_DAY);
}

/** Convert a unix ms timestamp to a YYYY-MM-DD string for <input type="date">. */
function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string (from <input type="date">) into a local-midnight unix ms. */
function fromDateInputValue(s: string): number | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d).getTime();
}

/** Add `months` to a Date, clamping the day to the last day of the target month. */
function addMonths(d: Date, months: number): Date {
  const result = new Date(d);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  // If month overflowed (e.g. Jan 31 + 1 month → Mar 3), clamp to end of intended month.
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0); // last day of previous month
  }
  return result;
}

/** Format a unix ms as "Jan 15, 2027". */
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ReminderPanel({ reminder, setReminder }: Props) {
  const now = Date.now();
  const due = reminder.nextDueAt;

  // Calendar-provider dropdown state. Closes on outside click and Escape.
  const [calMenuOpen, setCalMenuOpen] = useState(false);
  const calMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!calMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (calMenuRef.current && !calMenuRef.current.contains(e.target as Node)) {
        setCalMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCalMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [calMenuOpen]);

  const status = useMemo(() => {
    if (!due) return null;
    const d = daysUntil(now, due);
    if (d < 0)  return { kind: 'overdue'  as const, days: -d };
    if (d === 0) return { kind: 'today'   as const, days: 0  };
    if (d <= 7) return { kind: 'soon'     as const, days: d  };
    return       { kind: 'scheduled' as const, days: d  };
  }, [due, now]);

  function handleDateChange(s: string) {
    const ms = fromDateInputValue(s);
    setReminder({ ...reminder, nextDueAt: ms });
  }

  function handlePreset(months: number) {
    const next = addMonths(new Date(now), months);
    setReminder({ ...reminder, nextDueAt: next.getTime(), intervalMonths: months });
  }

  function handleMarkRebalanced() {
    const interval = reminder.intervalMonths;
    const update: Reminder = { ...reminder, lastRebalancedAt: now };
    if (interval) {
      update.nextDueAt = addMonths(new Date(now), interval).getTime();
    } else {
      update.nextDueAt = undefined;
    }
    setReminder(update);
  }

  function handleClear() {
    setReminder({});
  }

  function openCalendarUrl(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
    setCalMenuOpen(false);
  }

  function handleDownloadIcs() {
    if (!due) return;
    downloadReminderIcs(new Date(due));
    setCalMenuOpen(false);
  }

  return (
    <div className="border border-sky-200 rounded-lg px-4 py-3 bg-sky-50">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-sky-900 flex items-center gap-1.5">
          <span aria-hidden="true">⏰</span>
          Next rebalance reminder
        </p>
        {due && (
          <button
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-red-500 underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>

      {status && (
        <div className="text-xs mb-3">
          {status.kind === 'overdue' && (
            <span className="text-red-700">
              <span className="font-semibold">Overdue by {status.days} day{status.days === 1 ? '' : 's'}.</span>{' '}
              Was due {fmtDate(due!)}.
            </span>
          )}
          {status.kind === 'today' && (
            <span className="text-orange-700 font-semibold">Due today.</span>
          )}
          {status.kind === 'soon' && (
            <span className="text-amber-700">
              <span className="font-semibold">Due in {status.days} day{status.days === 1 ? '' : 's'}</span>{' '}
              ({fmtDate(due!)}).
            </span>
          )}
          {status.kind === 'scheduled' && (
            <span className="text-gray-600">
              Scheduled for <span className="font-medium text-gray-800">{fmtDate(due!)}</span>{' '}
              ({status.days} days from now).
            </span>
          )}
        </div>
      )}

      {!status && (
        <p className="text-xs text-gray-500 mb-3">
          Set a date to remind yourself when to check drift again. Stored locally — no account required.
        </p>
      )}

      {reminder.lastRebalancedAt && (
        <p className="text-xs text-gray-400 mb-3">
          Last marked rebalanced on {fmtDate(reminder.lastRebalancedAt)}.
        </p>
      )}

      {/* Interval presets */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-xs text-gray-500 mr-1">Remind me in:</span>
        {INTERVAL_PRESETS.map(p => (
          <button
            key={p.months}
            onClick={() => handlePreset(p.months)}
            className={`text-xs px-2 py-1 rounded border transition-colors
              ${reminder.intervalMonths === p.months && due
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-sky-200 bg-white text-gray-600 hover:border-sky-300 hover:bg-white'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Explicit date picker */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-xs text-gray-500" htmlFor="reminder-date">Or pick a date:</label>
        <input
          id="reminder-date"
          type="date"
          value={due ? toDateInputValue(due) : ''}
          min={toDateInputValue(now)}
          onChange={e => handleDateChange(e.target.value)}
          className="text-xs border border-sky-200 bg-white rounded px-2 py-1 text-gray-700"
        />
      </div>

      {/* Actions */}
      {due && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleMarkRebalanced}
            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 transition-colors"
          >
            Mark rebalanced today
          </button>

          {/* Add-to-calendar dropdown */}
          <div className="relative" ref={calMenuRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={calMenuOpen}
              onClick={() => setCalMenuOpen(o => !o)}
              className="text-xs border border-sky-200 bg-white text-gray-700 px-3 py-1.5 rounded hover:border-sky-300 transition-colors flex items-center gap-1"
            >
              📅 Add to calendar
              <span className="text-gray-400" aria-hidden="true">▾</span>
            </button>
            {calMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 mt-1 z-20 w-48 bg-white border border-gray-200 rounded shadow-md py-1"
              >
                <button
                  role="menuitem"
                  onClick={() => openCalendarUrl(googleCalendarUrl(new Date(due)))}
                  className="block w-full text-left text-xs px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  Google Calendar
                </button>
                <button
                  role="menuitem"
                  onClick={() => openCalendarUrl(outlookLiveCalendarUrl(new Date(due)))}
                  className="block w-full text-left text-xs px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  Outlook.com
                </button>
                <button
                  role="menuitem"
                  onClick={() => openCalendarUrl(office365CalendarUrl(new Date(due)))}
                  className="block w-full text-left text-xs px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  Office 365
                </button>
                <button
                  role="menuitem"
                  onClick={() => openCalendarUrl(yahooCalendarUrl(new Date(due)))}
                  className="block w-full text-left text-xs px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  Yahoo Calendar
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button
                  role="menuitem"
                  onClick={handleDownloadIcs}
                  title="Works with Apple Calendar (macOS/iOS) and any app that imports .ics"
                  className="block w-full text-left text-xs px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  Apple Calendar / .ics
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
