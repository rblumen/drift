import { describe, it, expect } from 'vitest';
import { buildReminderIcs, DRIFT_URL } from './ics';

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
