# Build Plan: Account Linking

**Status:** Draft for review · **Builds:**
[`spec-account-linking.md`](spec-account-linking.md) and
[`spec-households.md`](spec-households.md) · **Background:**
[`study-account-linking.md`](study-account-linking.md).

The spec says *what* Drift becomes. This plan says *how and in what order* it
gets built, and **who does each step**: a coding agent, or you. Milestone IDs
(M0a–M9), gates (Gate 1–3), and decision IDs (D1–D24) match the spec.

---

## 1. Who does what

| Tag | Meaning |
|---|---|
| 🤖 **Agent** | A coding agent does it end to end on a branch and opens a PR. You review and merge. **Merging is always yours** |
| 👤 **You** | Only you can do it. Covers creating vendor accounts, entering payment details, handling production secrets, changing DNS, approving policy or legal text, using real financial data, inviting people, and testing on your own devices |
| 🤝 **Agent prepares, you act** | The agent drafts, researches, or writes the script or checklist. You run it, paste it, or approve it |

The split comes from a few hard lines, not from difficulty:
- **Identity and money:** agents never sign up for services, accept terms, or
  pay.
- **Secrets:** production keys exist only in vendor dashboards and Vercel env
  vars. Agents never see them.
- **Real data:** agents work only with synthetic fixtures (`CLAUDE.md`). Real
  brokerage connections and production data are yours.
- **Outward-facing changes:** DNS, sent email, invites, and anything a user
  sees in production go out under your hand.

---

## 2. Ground rules for agents

1. One milestone (or a slice of one) per branch: `feat/<issue>-<slug>`. Never
   push to `main`. PRs merge by squash after your review (`CLAUDE.md`).
2. Develop against **local Supabase** (`supabase start`) and mocked SnapTrade.
   Staging access only through env vars you've set; never production.
3. Synthetic fixtures only. No real holdings, account names, or masks in code,
   tests, logs, PRs, or chat.
4. Never write secrets to the repo. When a secret is needed, the PR lists the
   variable **name** and how to generate the value, and you set it.
5. Every PR: tests green, CHANGELOG entry for user-visible changes, and the
   spec sections it implements named in the description.
6. If the spec is unclear or wrong, raise a question in the PR rather than
   inventing behavior. Spec changes are separate, reviewed doc edits.
7. Nothing that loosens `CLAUDE.md`'s guardrails merges before M1 is signed
   off.
8. **The repo is public.** No personal details in docs, code, commits, or PRs:
   not the developer's institutions, household members, or account details.
   Use generic examples ("Alex", "Sam", "Brokerage A").

---

## 3. Your setup checklist

Every 👤 setup task in one place, in the order needed. Agents supply the exact
steps, settings, and DNS records for each.

| # | Task | Needed by | Cost |
|---|---|---|---|
| 1 | **Project Google account** (dedicated Gmail). Passkey or hardware-key 2FA, recovery codes stored offline. Use it as the owner login for every vendor below, and as the inbox support@ forwards to | M0a | Free |
| 2 | **Password manager** entry/vault for the project (vendor logins, recovery codes, encryption-key backup) | M0a | — |
| 3 | **Cloudflare** account; register the domain; auto-renew and registrar lock on | M0a | ~$10–15/yr |
| 4 | **SnapTrade** developer account; Personal key for the spike | M0 | Free |
| 5 | **Supabase** org: `drift-staging` and `drift-prod` projects (same region as Vercel functions), new API keys, asymmetric JWT keys, public signups off until Gate 2, redirect URLs (production: `https://drift.bayleaflabs.com`) | M3 | Free |
| 6 | **Resend** account; add and verify `mail.bayleaflabs.com`; Supabase custom SMTP settings | M3 | Free tier |
| 7 | **Cloudflare DNS** records for Vercel, Resend, DMARC, Email Routing; **Email Routing** `support@` → project Gmail | M3 | Free |
| 8 | **Sentry** project for `api/` | M3 | Free tier |
| 9 | **Vercel env vars** per environment (staging for previews, production): Supabase URL and keys, SnapTrade keys, `TOKEN_ENC_KEYS`, Resend key, Sentry DSN, `CRON_SECRET` (M6c). Generate `TOKEN_ENC_KEYS` locally with the command the agent provides; keep a backup in the password manager | M3, M5, M6c | — |
| 10 | **GitHub Actions secrets** for the manual migration workflow (staging and production database credentials) | M3 | — |
| 11 | **SnapTrade Personal key** for production (free; the key is your SnapTrade user, spec D3/§6.4). Used through alpha and beta | M5 | Free |
| 12 | Approve the **privacy notice and beta terms**; decide whether to buy a lawyer review (before Gate 2 at the latest, since the open beta admits strangers) | M6, M7 | $0–? |
| 13 | **Supabase Pro** on production; **Vercel Pro** (Hobby is non-commercial only) | M7 | ~$25 + $20/mo |
| 14 | **Postal address** for announcement emails (PO box or virtual mailbox) | M7 | ~$5–15/mo |
| 15 | `news.bayleaflabs.com` in Resend; Gmail **"Send mail as" support@** via Resend SMTP; **Cloudflare Turnstile** site key for signup and waitlist | M7 | Free |
| 16a | **GitHub:** secret scanning and push protection on; `production` environment with you as required reviewer for the migration workflow | Now / M3 | Free (public repo) |
| 16b | **Vercel Deployment Protection** on preview deployments (preview URLs are posted publicly on PRs) | M3 | Free tier |
| 16 | **Apple Developer** ($99/yr) and **Google Play Console** ($25 once) accounts | M8 | ~$9/mo |
| 17 | **Paid aggregator plan** (SnapTrade Commercial or Plaid) and its production approval; only if Gate 3 opens Premium | M9 | from $100/mo (SnapTrade) or usage (Plaid) |

---

## 4. Phases and gates at a glance

Drift v1 moves through four phases. Each one ends at a gate where you decide,
against criteria written down in advance, whether to go on. The idea: get the
product right on your own money first, then find out whether anyone else
wants it, and pay for account linking only once they've shown they do
(spec D24).

| Phase | Who uses it | Purpose | What's in it | Milestones | Cost | Ends at |
|---|---|---|---|---|---|---|
| **Alpha** (internal) | You | Get the functionality right: a hosted Drift you trust as your daily tool | Sign-in, cross-device sync, linking your own accounts (SnapTrade Personal key), deletion, terms, problem reports, mobile web, **drift history and alerts** for your portfolios | M0a–M6c | ≤ $20/mo | **Gate 1** |
| **Beta build-up** | You and your household | Make Drift ready for strangers, and for your household | Households, the native app (secondary), and open-beta readiness: open signup, the free-account tier, the Premium fake door and waitlist, feedback | M5b, M8, M7 | ≤ $20/mo, rising to the beta budget at M7 | **Gate 2** |
| **Open beta** (public MVP) | Anyone in the US | (a) **Validate demand** for paid linking; (b) **gather feedback** | Hosted free accounts (guest mode kept), CSV import and manual entry only. Linking appears as **Premium**, a priced waitlist; it isn't available yet. Your household keeps linking | — (runs for the period set at Gate 2) | ~$50–65/mo, no aggregator cost | **Gate 3** |
| **Premium** (full linking) | Premium users, in batches from the waitlist | Deliver account linking at a cost demand has justified | Aggregator chosen on real prices, Commercial mode, SnapTrade's consent step, entitlement and billing if paid | M9 | Set at Gate 3; aggregator from $100/mo or Plaid usage | Later: leaving beta (spec §10) |

### Gate criteria

**Gate 1 — Alpha exit.** Is the product right?
- You've used it as your daily tool for a few weeks on desktop and phone.
- Link → sync → map → rebalance is reliable. A broken connection recovers
  through re-authentication, and a killed sync doesn't block the next one.
- Drift history builds up daily, and your alerts email you when a portfolio
  has stayed outside its bands, not on one-day swings.
- `sync_runs` errors and Sentry are quiet or understood.
- Costs stay at or under $20/mo.

**Gate 2 — Open the beta.** Is it ready for strangers?
- A stranger's whole path works in production: sign up, free account, fake
  door, Premium waitlist, feedback, deletion.
- Your household uses a shared household day to day.
- Beta terms and the privacy notice are live. They say plainly that personal
  financial data is stored on Drift's servers and that maintainers may access
  it, with every access logged (spec D22). The lawyer-review decision is
  made.
- The beta budget is confirmed (D15).
- **Gate 3 criteria are written down before any data arrives:** the minimum
  beta length, and the Premium waitlist size and join rate that would justify
  the aggregator cost.

**Gate 3 — Demand decision.** Do enough people want linking, at a price,
to pay for it?
- The minimum beta period has passed.
- Compare Premium waitlist joins per price, and the share of fake-door
  viewers who join, against the Gate 2 criteria.
- Feedback themes: what users ask for, what confuses them, whether linking
  is the thing they want.
- Outcomes: **open Premium** (→ M9), **stay free-only** and keep improving
  from feedback, or **hold** the hosted beta. Also choose which spec §10
  follow-ups come next (scheduled sync, alerts, MCP, adviser role).

**After M9.** Invited Premium users link and sync, and costs track the
Gate 3 budget. Leaving beta for a public launch (required MFA, legal review,
billing if not done yet) is a later decision (spec §10).

---

## 5. Milestones

Order: M0a → M0 → M1 → M2 → M3 → M4 → M5 → M6 → M6b → M6c → **Gate 1** → M5b →
M8 → M7 → **Gate 2** → *open beta* → **Gate 3** → M9. M2 can run in parallel
with M0a/M0. M5b and M8 are numbered for their topics but come after Gate 1.
M8 is secondary: if you'd rather open the beta sooner, it can follow Gate 2.

### M0a — Domain spike
| Owner | Task |
|---|---|
| 👤 | Create the project Google account and password-manager vault (checklist 1–2) |
| 👤 | Give the agent a shortlist of 5–10 names |
| 🤖 | For each name: availability and price **including renewal**; whether Cloudflare Registrar supports the TLD; TLD email reputation (prefer `.com`, `.app`, `.io`; avoid `.xyz`, `.top`); HSTS note for `.app`/`.dev`; USPTO trademark search in finance/software; similarly named sites or apps; social handles. Deliver a comparison table, marking anything the agent couldn't verify |
| 👤 | Choose and register at Cloudflare; auto-renew and registrar lock |
| 🤖 | Replace `<domain>` throughout the docs (PR) |

**Exit:** domain registered and filled in.

**Status:** done. `bayleaflabs.com` registered 2026-11-20 under the publisher name
Bay Leaf Labs; the app lives at `drift.bayleaflabs.com` (spec D13).

### M0 — SnapTrade spike (throwaway; not merged)
| Owner | Task |
|---|---|
| 👤 | SnapTrade developer account and Personal key (checklist 4) |
| 🤖 | Write a probe script: reads the key from env, connects via the SnapTrade portal, and prints a **coverage report** with structure and field names only. Amounts, names, and masks are masked by default |
| 👤 | Run it locally against your real accounts. Keep any raw output under `/private/` (git-ignored) |
| 👤 | Fill in pass/fail per institution on your private coverage list (kept under `/private/`, not in the repo): (1) taxable brokerage and IRA accounts: holdings, cash, cost basis; (2) **workplace 401(k)s** at each recordkeeper; (3) how ticker-less funds come through (security ID, CUSIP, description); (6) whether institutions need per-developer enablement, and the lead time |
| 🤝 | Agent summarizes SnapTrade's public developer terms (storage, display, consent obligations); you read and accept the actual terms |
| 👤 | If (2) fails, decide: CSV for those accounts, or a Plaid Investments spike (D20) before M5 |
| 🤖 | Record the decision in the spec, naming no institutions tied to you (the repo is public) |

**Exit:** coverage table and the 401(k) decision.

**Status:** done. Coverage passed, including workplace 401(k)s; no Plaid spike
(spec §6.3, D20). Terms review in #248; private coverage list in #247.
SnapTrade's pricing changed (free plans for testing and personal use only;
paid from $100/mo), which led to Personal-key linking through alpha and beta (spec D3)
and the demand gate, Gate 3 (spec D24).

### M1 — Guardrails and docs update
| Owner | Task |
|---|---|
| 🤖 | Draft amendments to `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, and `README.md`, replacing "no user data ever leaves the browser": *guest mode sends nothing. Signed-in mode **stores the user's personal financial data on Drift's servers** (portfolios, linked holdings, balances, account names) and SnapTrade credentials, encrypted where sensitive. Other users see only what's assigned to a household they belong to. **Maintainers can access stored data** for debugging, support, and security; every access is logged (spec D22), and real data never goes into PRs, fixtures, or AI coding tools. **Analytics:** product events (feature use, fake-door views and clicks, price variant ID) are allowed; holdings, amounts, account names or numbers, and PII never reach the analytics tool.* Plus a CHANGELOG entry |
| 👤 | **Explicit sign-off** and merge. These are rules `CLAUDE.md` calls inviolable |

**Exit:** merged. No backend code merges before this.

### M2 — Pure modules
| Owner | Task |
|---|---|
| 🤖 | `src/ingest/adapters/snaptrade.ts` (§6.1), `src/ingest/compose.ts` (§4.5), `src/sync/merge.ts` (§5.4), synthetic fixtures, tests |
| 🤖 | `appStateSchema`: `linkedPositionOverrides`, `Account.ownerPersonIds`, `people` (§4.4) |
| 🤖 | Owner labels and owner filter in the UI (works in guest mode) |
| 🤖 | CI check that `src/engine/` imports nothing environment-specific (D9) |
| 👤 | Review and merge |

**Exit:** tests green; guest mode unchanged apart from optional owner labels.

### M3 — Domain, email, backend foundation
| Owner | Task |
|---|---|
| 🤖 | Write the setup runbook: every dashboard setting for Supabase (both projects), Resend, Sentry, and Vercel; the full DNS record list; the env var names per environment; the key-generation command |
| 👤 | Execute the runbook (checklist 5–10) |
| 🤖 | `supabase/migrations/`: every §4 table, `private.household_role`, all §4.3 RPCs, RLS. Each Drift user gets a personal household; only the owner role is used yet |
| 🤖 | Manually-triggered GitHub Actions workflow that applies migrations to staging or production |
| 👤 | Trigger it for staging, then production |
| 🤖 | `api/v1/` scaffolding: `_lib/` helpers (JWKS auth, user-scoped client, admin client, crypto keyring, rate limit, Sentry), `GET /health` |
| 🤖 | CSP update; `vercel.json` rewrite excluding `api/`; daily Vercel Cron to `/health` |
| 🤖 | Custom auth email templates (HTML) |
| 👤 | Paste the templates into both Supabase projects |
| 🤖 | CI: database + API role-matrix job, `dist/` secret scan, secret-key import check |
| 🤝 | Agent looks up the Vercel plan's function duration limit and log retention; you confirm on your plan's dashboard |

**Exit (who checks):**
- 🤖 role-matrix tests pass in CI;
- 👤 a test auth email lands in your inbox with SPF/DKIM/DMARC passing;
- 👤 mail to support@ arrives in the project Gmail;
- 🤝 a preview deploy talks to staging, not production (agent adds a
  `/health` field naming the environment; you check it).

### M4 — Sign-in and cross-device sync
| Owner | Task |
|---|---|
| 🤖 | `src/sync/` (client, remote store, merge wiring, API client) |
| 🤖 | Landing page: **"Continue as guest — no signup, your data stays in this browser"** and **Sign in** |
| 🤖 | Sign-in page with the alpha (invite-only) message, password, magic link, forgot password; set-password page; TOTP enrollment in Profile |
| 🤖 | "Tell me when the beta opens" waitlist form (`interest = beta`, unchecked "Email me Drift news") and `POST /api/v1/waitlist` |
| 🤖 | URL scrubbing; analytics `beforeSend` |
| 🤖 | `save_portfolio` with section merge; Realtime refresh; first-sign-in upload; "Not synced" badge |
| 👤 | Invite yourself in the production Supabase dashboard; sign in on desktop and phone |

**Exit:**
- 👤 a portfolio edited on desktop shows up on your phone;
- 🤖 a forced conflict merges disjoint edits and asks on overlapping ones
  (automated test);
- 🤖 guest mode unchanged (existing app tests pass);
- 👤 a waitlist entry arrives.

Useful on its own: cross-device Drift with CSV import.

### M5 — Linking
| Owner | Task |
|---|---|
| 👤 | SnapTrade Personal key into Vercel env vars, plus `SNAPTRADE_MODE=personal` and `SNAPTRADE_PERSONAL_OWNER` (checklist 11) |
| 🤖 | `api/v1/snaptrade/*` with sync leases, the time budget, `sync_runs` logging (§6); Personal-key mode with the single linking owner (§6.4), Commercial mode kept behind tests |
| 🤖 | Positions tab "Linked accounts": connect, assign, sync, mapping, auto-sync on open, connection list, reconnect (§5.5) |
| 🤖 | Engine input switches to `composePositions(state, linked)` |
| 🤖 | Handler tests with mocked SnapTrade, including a killed sync and lease expiry |
| 👤 | End to end in production with your real brokerages |

**Exit:**
- 👤 link → assign → sync → map → rebalance works; a second sync needs no
  mapping; holdings are in the database even if you close the browser right
  after syncing;
- 🤝 a broken connection shows "needs re-authentication" (agent tests it with
  mocks; you see it if one of your connections lapses);
- 🤖 a killed sync doesn't block the next one past its lease.

### M6 — Deletion, terms, support, AI summary
| Owner | Task |
|---|---|
| 🤖 | `DELETE /api/v1/me` (idempotent, retried) and the Profile control (§5.8) |
| 🤖 | Admin scripts: SnapTrade inactive-user report and prune; a data-access script (read a user's data or a problem-report snapshot) that writes `support_access_log` on every read (D22) |
| 🤖 | Report a problem (§5.9) and error references in the UI |
| 🤖 | "Copy summary for AI" (§5.7) |
| 🤖 | Terms acceptance gate (§5.11) |
| 🤝 | Agent drafts the privacy notice and beta terms from the spec's data inventory and §5.11 clause list; **you approve the text** and decide on a lawyer review |
| 🤖 | Landing and README copy for guest mode vs signed-in mode |
| 🤝 | Agent drafts the breach-response note and the encryption-key rotation runbook; you review them |
| 👤 | Delete a throwaway test profile in production; confirm its rows are gone (Personal-key mode has no SnapTrade user per profile, §6.4) |

**Exit:**
- 👤 deleting a Drift user profile removes the auth user, the user's rows and
  shares, and the SnapTrade user;
- 🤖 a forced SnapTrade failure leaves the profile intact and retryable;
- 👤 terms and privacy notice approved and live.

### M6b — Mobile web pass
| Owner | Task |
|---|---|
| 🤖 | Apply §5.10 to existing screens (Results, Positions, Strategy, Classify, Accounts, charts) |
| 🤖 | PWA manifest, icons, assets-only service worker; CSP update |
| 🤖 | Playwright phone-viewport smoke tests in CI |
| 👤 | Real-device pass on an iPhone and an Android phone |

**Exit:** 👤 the whole Gate 1 loop works on both phones: sign in, link, sync,
map, read results, edit strategy, report a problem.

### M6c — Drift history and alerts (yours)
| Owner | Task |
|---|---|
| 🤖 | Migrations: `portfolio_snapshots`, `alert_checks` (spec §4.2) |
| 🤖 | `src/alerts/evaluate.ts`: pure rule evaluation (instant, persistence, average; episodes) with synthetic-sequence tests (spec §5.13) |
| 🤖 | Daily (weekday) Vercel Cron → `POST /api/v1/cron/alerts` with `CRON_SECRET`: cron sync → server-side compose + `rebalance()` → snapshot → evaluate → neutral email |
| 🤖 | Strategy → Alerts UI and `/api/v1/alerts`; Results → History chart and `/api/v1/portfolios/:id/history`; owner only (spec §5.14) |
| 🤖 | Tests: one snapshot per day, a one-day spike stays quiet, persistent drift emails once per episode, failure email throttled, non-owner gets 403, email body has no amounts or tickers |
| 👤 | `CRON_SECRET` into Vercel env vars (checklist 9); turn on an alert for your portfolio |

**Exit:**
- 🤖 the rule tests pass, including the spike, the 3-of-5, and re-arm cases;
- 👤 after a week, History shows a line per class with its band;
- 👤 with bands tightened on purpose, the alert emails you once after the
  rule is met (not on day one); loosened again, the episode closes and it
  stays quiet; the email carries no amounts, tickers, or account names.

### Gate 1 — Alpha exit (you only) 👤
Use it for a few weeks on desktop and phone. Cost up to $20/mo (D15). Review
`sync_runs`, Sentry, and costs weekly. Ask an agent to fix what you find.
When it holds up as your daily tool, alpha is done.

### M5b — Households
| Owner | Task |
|---|---|
| 🤖 | Households and portfolios with a switcher; household settings (members, invites with role dropdown defaulting to owner, revoke, leave/remove, last-owner guard, copy portfolio) |
| 🤖 | Invite and membership endpoints and emails; a household invite admits the invitee even while signup is closed |
| 🤖 | Moving accounts within a household; adding an account to several households; owner labels on linked accounts |
| 🤖 | Duplicate detection; confirming removes the other copy |
| 🤖 | "Last edited by"; `household_events` view |
| 🤖 | Role-matrix tests for editor and former member |
| 👤 | Invite a second member of your household; both of you run the exit scenario |

**Exit:** 👤 the second member's logins are linked through your Personal key
(they enter their own credentials) and assigned to one shared household; you both confirm a joint account as one and edit "Ours" from
separate devices. Your private portfolio stays in your personal household,
invisible to them.

### M8 — Native mobile app (secondary priority; your household first)
| Owner | Task |
|---|---|
| 🤝 | Agent prototypes Capacitor around the same app and reports gaps; you confirm the approach (D23) |
| 👤 | Apple Developer and Google Play accounts (checklist 16) |
| 🤖 | Deep links for magic links and PKCE; SnapTrade portal in an in-app browser; tokens in Keychain/Keystore |
| 🤝 | Agent drafts Apple's privacy label and Google's data-safety answers from the privacy notice; you submit them |
| 👤 | Store listings, review submissions, TestFlight/internal-testing invites |

**Exit:** 👤 you and your household use a TestFlight / internal-testing build.

### M7 — Open-beta readiness
| Owner | Task |
|---|---|
| 👤 | Supabase Pro, Vercel Pro, postal address, `news.bayleaflabs.com`, Gmail "Send mail as", Turnstile (checklist 13–15) |
| 🤖 | Open signup flow: "Create an account", email confirmation, Turnstile, rate limit (D6) |
| 🤖 | Free-account tier: linking hidden for everyone but the Personal-key owner (§6.4) |
| 🤖 | Premium fake door with a shown price → Premium waitlist; per-variant view and join counts on the server; admin report (spec §5.12) |
| 🤖 | "Send feedback" on the problem-report path (§5.12) |
| 🤖 | Referrals (§5.2a): `referral_codes`, "Share Drift", `/join?ref=` |
| 🤖 | `scripts/admin/sync-audiences.ts`; Profile → Email toggle (§7.1) |
| 🤝 | Agent updates the beta terms and privacy notice for open signup and the Premium waitlist; you approve them and decide on a lawyer review (checklist 12) |
| 🤝 | Agent writes the backup-restore drill; you run it (restore production's backup into a scratch project) |

**Exit:**
- 🤖 open signup (confirmation email, Turnstile, rate limit) works on staging;
- 👤 in production, with signup still closed, a test profile you invite gets
  a stranger's experience: a free account, the fake door, the Premium
  waitlist, and feedback; the counts show up in the admin report.

### Gate 2 — Open the beta 👤
- Confirm the beta budget (D15) and that terms and privacy notice are live.
- Set the **Gate 3 criteria** now, before data arrives: how long the beta
  runs at minimum, and the Premium waitlist size and join rate that would
  justify the aggregator cost (spec §10).
- Turn on public signup in production Supabase; announce to the `beta`
  waitlist (§7.1).

### Gate 3 — Demand decision 👤
After the minimum beta period, read the Premium waitlist per price, the join
rate, feedback themes, and costs against the Gate 2 criteria. Decide:
- **Open Premium** → M9;
- **stay free-only** and keep improving from feedback;
- or **hold** the hosted beta.

Also choose among spec §10 follow-ups (scheduled sync, alerts, MCP, adviser
role).

### M9 — Premium linking (only if Gate 3 says go)
| Owner | Task |
|---|---|
| 🤝 | Agent runs a short Plaid spike (coverage, production-access review, real per-login rate) and computes the break-even against SnapTrade (spec §10); you pick the provider |
| 👤 | Buy the plan, request production access, keys into Vercel env vars (checklist 17) |
| 🤖 | Commercial mode: per-user SnapTrade registration (or the Plaid adapter, D20); SnapTrade end-user consent step (§10); Premium entitlement on the profile |
| 🤖 | If Premium is paid from day one: billing (spec §10) |
| 👤 | Invite the Premium waitlist in batches; re-link your own logins under the new key |

**Exit:** 👤 an invited Premium user links and syncs; costs track the Gate 3
budget.

---

## 6. Ongoing during the beta (from Gate 2)

| Owner | Task | Cadence |
|---|---|---|
| 👤 | Read feedback; review the Premium waitlist and per-price counts | Weekly |
| 👤 | Answer support@ (as support@ from the project Gmail) | As needed |
| 👤 | Read problem reports and feedback. Read user data only through the logging admin script, and only what the task needs (D22) | As needed |
| 🤝 | Fix reported bugs: you reproduce locally from the report (or a logged read) and turn it into a synthetic regression fixture with the agent. Real data never enters a PR or the agent's context | As needed |
| 👤 | Check costs (Supabase, Vercel, SnapTrade, Resend), Sentry, and `sync_runs` errors | Monthly |
| 👤 | Run the SnapTrade inactive-user prune (Commercial mode, after M9), before month-end | Monthly |
| 👤 | Rotate `TOKEN_ENC_KEYS` (agent-written runbook) | Yearly, or on suspicion |
| 👤 | Send announcements | As needed |
