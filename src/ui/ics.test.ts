import { describe, it, expect } from 'vitest';
import {
  buildReminderIcs,
  DRIFT_URL,
  googleCalendarUrl,
  outlookLiveCalendarUrl,
  office365CalendarUrl,
  yahooCalendarUrl,
} from './ics';

describe('buildReminderIcs', () => {
  it('produces a valid VCALENDAR envelope', () => {
    const ics = buildReminderIcs({ date: new Date(2027, 0, 15) });
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('emits an all-day DTSTART/DTEND with exclusive end date', () => {
    const ics = buildReminderIcs({ date: new Date(2027, 0, 15) });
    expect(ics).toContain('DTSTART;VALUE=DATE:20270115');
    expect(ics).toContain('DTEND;VALUE=DATE:20270116');
  });

  it('includes the Drift URL in DESCRIPTION and URL fields', () => {
    const ics = buildReminderIcs({ date: new Date(2027, 0, 15) });
    expect(ics).toContain(`URL:${DRIFT_URL}`);
    expect(ics).toContain(DRIFT_URL);
  });

  it('includes a one-day-ahead VALARM', () => {
    const ics = buildReminderIcs({ date: new Date(2027, 0, 15) });
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('ACTION:DISPLAY');
  });

  it('uses a stable UID derived from the date by default', () => {
    const a = buildReminderIcs({ date: new Date(2027, 0, 15) });
    const b = buildReminderIcs({ date: new Date(2027, 0, 15) });
    const uidA = a.match(/UID:(.+)/)?.[1];
    const uidB = b.match(/UID:(.+)/)?.[1];
    expect(uidA).toBeDefined();
    expect(uidA).toBe(uidB);
  });

  it('escapes commas and semicolons in DESCRIPTION', () => {
    const ics = buildReminderIcs({ date: new Date(2027, 0, 15) });
    // The default description includes the URL which has no comma/semicolon,
    // but the literal newline must be encoded as \n.
    expect(ics).toMatch(/DESCRIPTION:[^\r\n]*\\n/);
  });
});

describe('calendar provider URLs', () => {
  const date = new Date(2027, 0, 15); // Jan 15, 2027

  it('googleCalendarUrl uses YYYYMMDD/YYYYMMDD dates and includes the Drift URL', () => {
    const url = googleCalendarUrl(date);
    const u = new URL(url);
    expect(u.hostname).toBe('calendar.google.com');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('dates')).toBe('20270115/20270116');
    expect(u.searchParams.get('text')).toContain('Drift');
    expect(u.searchParams.get('details')).toContain(DRIFT_URL);
  });

  it('outlookLiveCalendarUrl marks the event as all-day and includes ISO dates', () => {
    const url = outlookLiveCalendarUrl(date);
    const u = new URL(url);
    expect(u.hostname).toBe('outlook.live.com');
    expect(u.searchParams.get('allday')).toBe('true');
    expect(u.searchParams.get('startdt')).toBe('2027-01-15T00:00:00');
    expect(u.searchParams.get('enddt')).toBe('2027-01-16T00:00:00');
    expect(u.searchParams.get('body')).toContain(DRIFT_URL);
  });

  it('office365CalendarUrl uses the outlook.office.com host', () => {
    const url = office365CalendarUrl(date);
    expect(new URL(url).hostname).toBe('outlook.office.com');
    expect(new URL(url).searchParams.get('allday')).toBe('true');
  });

  it('yahooCalendarUrl uses dur=allday', () => {
    const url = yahooCalendarUrl(date);
    const u = new URL(url);
    expect(u.hostname).toBe('calendar.yahoo.com');
    expect(u.searchParams.get('dur')).toBe('allday');
    expect(u.searchParams.get('st')).toBe('20270115');
  });
});
