/**
 * ics.ts — Build an iCalendar (.ics) file for the next-rebalance reminder.
 *
 * Pure client-side; no network calls. Conforms to RFC 5545 well enough for
 * Google Calendar, Apple Calendar, and Outlook to ingest.
 *
 * Event design:
 *  - All-day VEVENT on the reminder date (DTSTART;VALUE=DATE).
 *  - 9 AM local-time reminder one day before via VALARM.
 *  - DESCRIPTION includes the tool URL so the user can re-open Drift directly.
 */

import { DRIFT_URL } from './site';
export { DRIFT_URL };

const APP_NAME = 'Drift Rebalancer';

/** YYYYMMDD for an all-day VEVENT DTSTART. */
function fmtDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** YYYYMMDDTHHMMSSZ for DTSTAMP / DTEND of all-day events. */
function fmtDateTimeUTC(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Escape commas, semicolons, newlines, and backslashes per RFC 5545 § 3.3.11. */
function escText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Fold long lines at 75 octets per RFC 5545 § 3.1 — most parsers accept lines as-is,
 *  but Outlook is stricter. Folding uses CRLF + single space continuation. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
    parts.push(chunk);
    i += chunk.length;
  }
  return parts.join('\r\n ');
}

export interface BuildReminderIcsOptions {
  /** Reminder date (local time interpreted as the all-day date). */
  date: Date;
  /** Stable UID for the event. Reusing the same UID lets calendar apps update
   *  rather than duplicate when the user re-imports after changing the date. */
  uid?: string;
  /** Optional summary override. */
  summary?: string;
}

export function buildReminderIcs(opts: BuildReminderIcsOptions): string {
  const { date } = opts;
  const dtstart = fmtDateYMD(date);
  // DTEND for an all-day event is exclusive — set to the next day.
  const endDate = new Date(date);
  endDate.setDate(endDate.getDate() + 1);
  const dtend = fmtDateYMD(endDate);
  const dtstamp = fmtDateTimeUTC(new Date());
  const uid = opts.uid ?? `drift-rebalance-${dtstart}@drift-rebalance.vercel.app`;
  const summary = opts.summary ?? 'Rebalance portfolio (Drift)';
  const description = escText(
    `Time to check portfolio drift and run a rebalance.\n\n`
    + `Open Drift: ${DRIFT_URL}`,
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    `SUMMARY:${escText(summary)}`,
    `DESCRIPTION:${description}`,
    `URL:${DRIFT_URL}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escText(summary)}`,
    // 1 day before the all-day event, at the start (midnight local).
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Trigger a browser download of the .ics file. */
export function downloadReminderIcs(date: Date): void {
  const ics = buildReminderIcs({ date });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `drift-rebalance-${fmtDateYMD(date)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Calendar-provider deep links ────────────────────────────────────────────
//
// Each builder returns a URL the user can open in a new tab to pre-fill an
// event-creation form on the provider's web UI. Apple Calendar has no web
// compose endpoint, so for Apple we fall back to the .ics download (macOS/iOS
// register .ics with Calendar.app, so opening the file adds the event).

const REMINDER_TITLE = 'Rebalance portfolio (Drift)';
const REMINDER_BODY  = `Time to check portfolio drift and run a rebalance.\n\nOpen Drift: ${DRIFT_URL}`;

/** Next day after `d`, used as the exclusive end of an all-day event. */
function nextDay(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  return x;
}

/** ISO local date string `YYYY-MM-DD` (no time component). */
function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Google Calendar event-create URL.
 *  Docs: https://support.google.com/calendar/answer/41207 (action=TEMPLATE). */
export function googleCalendarUrl(date: Date): string {
  const start = fmtDateYMD(date);
  const end   = fmtDateYMD(nextDay(date));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text:   REMINDER_TITLE,
    dates:  `${start}/${end}`,
    details: REMINDER_BODY,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook.com (personal) compose URL. */
export function outlookLiveCalendarUrl(date: Date): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: REMINDER_TITLE,
    body:    REMINDER_BODY,
    startdt: `${fmtIsoDate(date)}T00:00:00`,
    enddt:   `${fmtIsoDate(nextDay(date))}T00:00:00`,
    allday:  'true',
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Office 365 / Microsoft 365 (work or school) compose URL. */
export function office365CalendarUrl(date: Date): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: REMINDER_TITLE,
    body:    REMINDER_BODY,
    startdt: `${fmtIsoDate(date)}T00:00:00`,
    enddt:   `${fmtIsoDate(nextDay(date))}T00:00:00`,
    allday:  'true',
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Yahoo Calendar compose URL. */
export function yahooCalendarUrl(date: Date): string {
  const params = new URLSearchParams({
    v: '60',
    title: REMINDER_TITLE,
    desc:  REMINDER_BODY,
    st:    fmtDateYMD(date),
    dur:   'allday',
  });
  return `https://calendar.yahoo.com/?${params.toString()}`;
}
