# Drift v1.0 planning

Planning docs for **Drift v1.0**, which adds Drift users, cross-device sync,
brokerage account linking, and shared households. An internal alpha comes
first, then an open beta with hosted free accounts and linking offered as a
Premium waitlist; Premium opens only if demand justifies it (spec D24).
The current 0.x release series stays browser-only. Guest mode carries that
experience forward into v1.0.

| Doc | Purpose |
|---|---|
| [`study-account-linking.md`](study-account-linking.md) | Exploratory study: options, rationale, regulatory landscape, cost estimates. Historical record; the specs win where they differ |
| [`spec-account-linking.md`](spec-account-linking.md) | Product spec: decisions, data model, behavior, API, security |
| [`spec-households.md`](spec-households.md) | Household requirements and the shared vocabulary |
| [`build-plan-account-linking.md`](build-plan-account-linking.md) | Milestones, gates, and who does each step (agent vs. you) |
| [`runbook-m3-setup.md`](runbook-m3-setup.md) | M3 vendor setup, step by step: Supabase, Resend, Sentry, Cloudflare DNS, Vercel env vars, GitHub environments |

Read in this order: spec, then households, then build plan. Go to the study
when you want the "why".
