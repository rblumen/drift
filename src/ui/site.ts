/**
 * site.ts — Canonical, deployment-wide constants.
 *
 * `DRIFT_URL` is the single source of truth for the app's public URL. Share
 * links (ResultsPanel) and calendar reminders (ics.ts) both consume it so they
 * can never drift apart or point at an unowned domain (issue #116).
 */

export const DRIFT_URL = 'https://drift-rebalance.vercel.app/';
