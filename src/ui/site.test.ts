import { describe, it, expect } from 'vitest';
import { DRIFT_URL } from './site';
import { DRIFT_URL as ICS_URL } from './ics';

// Regression guard for issue #116: share links and the calendar reminder must
// share one canonical URL, and it must never be the unowned `drift.app`.
describe('DRIFT_URL (canonical site URL)', () => {
  it('is a well-formed https URL', () => {
    expect(() => new URL(DRIFT_URL)).not.toThrow();
    expect(new URL(DRIFT_URL).protocol).toBe('https:');
  });

  it('is not the unowned drift.app domain', () => {
    expect(new URL(DRIFT_URL).hostname).not.toBe('drift.app');
  });

  it('is the same constant the ics module consumes', () => {
    expect(ICS_URL).toBe(DRIFT_URL);
  });
});
