# Build Plan: Account Linking (Closed Beta)

**Status:** Draft for review · **Builds:**
[`spec-account-linking.md`](spec-account-linking.md) and
[`spec-households.md`](spec-households.md) · **Background:**
[`study-account-linking.md`](study-account-linking.md).

The spec says *what* Drift becomes. This plan says *how and in what order* it
gets built, and **who does each step**: a coding agent, or you. Milestone IDs
(M0a–M8) and decision IDs (D1–D23) match the spec.

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
| 5 | **Supabase** org: `drift-staging` and `drift-prod` projects (same region as Vercel functions), new API keys, asymmetric JWT keys, public signups off, redirect URLs | M3 | Free |
| 6 | **Resend** account; add and verify `mail.<domain>`; Supabase custom SMTP settings | M3 | Free tier |
| 7 | **Cloudflare DNS** records for Vercel, Resend, DMARC, Email Routing; **Email Routing** `support@` → project Gmail | M3 | Free |
| 8 | **Sentry** project for `api/` | M3 | Free tier |
| 9 | **Vercel env vars** per environment (staging for previews, production): Supabase URL and keys, SnapTrade keys, `TOKEN_ENC_KEYS`, Resend key, Sentry DSN. Generate `TOKEN_ENC_KEYS` locally with the command the agent provides; keep a backup in the password manager | M3, M5 | — |
| 10 | **GitHub Actions secrets** for the manual migration workflow (staging and production database credentials) | M3 | — |
| 11 | **SnapTrade Commercial key** (free tier, 5 connected users) | M5 | Free |
| 12 | Approve the **privacy notice and beta terms**; decide whether to buy a lawyer review | M6 | $0–? |
| 13 | **Supabase Pro** on production; **Vercel Pro** if needed; SnapTrade pay-as-you-go billing | M7 | ~$25 + $20/mo + usage |
| 14 | **Postal address** for announcement emails (PO box or virtual mailbox) | M7 | ~$5–15/mo |
| 15 | `news.<domain>` in Resend; Gmail **"Send mail as" support@** via Resend SMTP | M7 | Free |
| 16a | **GitHub:** secret scanning and push protection on; `production` environment with you as required reviewer for the migration workflow | Now / M3 | Free (public repo) |
| 16b | **Vercel Deployment Protection** on preview deployments (preview URLs are posted publicly on PRs) | M3 | Free tier |
| 16 | **Apple Developer** ($99/yr) and **Google Play Console** ($25 once) accounts | M8 | ~$9/mo |

---

## 4. Milestones

Order: M0a → M0 → M1 → M2 → M3 → M4 → M5 → M6 → M6b → **Gate 1** → M5b → M7
→ M8 → **Gate 2**. M2 can run in parallel with M0a/M0. M5b is numbered for
its topic but comes after Gate 1.

### M0a — Domain spike
| Owner | Task |
|---|---|
| 👤 | Create the project Google account and password-manager vault (checklist 1–2) |
| 👤 | Give the agent a shortlist of 5–10 names |
| 🤖 | For each name: availability and price **including renewal**; whether Cloudflare Registrar supports the TLD; TLD email reputation (prefer `.com`, `.app`, `.io`; avoid `.xyz`, `.top`); HSTS note for `.app`/`.dev`; USPTO trademark search in finance/software; similarly named sites or apps; social handles. Deliver a comparison table, marking anything the agent couldn't verify |
| 👤 | Choose and register at Cloudflare; auto-renew and registrar lock |
| 🤖 | Replace `<domain>` throughout the docs (PR) |

**Exit:** domain registered and filled in.

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

### M1 — Guardrails and docs update
| Owner | Task |
|---|---|
| 🤖 | Draft amendments to `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, and `README.md`: *guest mode sends nothing; signed-in mode stores the user's portfolios, linked holdings, and SnapTrade credentials server-side, encrypted where sensitive; data is visible only to members of the household it's assigned to.* Plus a CHANGELOG entry |
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
| 🤖 | Sign-in page with closed-beta message, password, magic link, forgot password; set-password page; TOTP enrollment in Profile |
| 🤖 | Waitlist form (unchecked "Email me Drift news") and `POST /api/v1/waitlist` |
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
| 👤 | SnapTrade Commercial key into Vercel env vars (checklist 11) |
| 🤖 | `api/v1/snaptrade/*` with sync leases, the time budget, `sync_runs` logging (§6) |
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
| 🤖 | Admin scripts: SnapTrade inactive-user report and prune; problem-report reader that writes `support_access_log` |
| 🤖 | Report a problem (§5.9) and error references in the UI |
| 🤖 | "Copy summary for AI" (§5.7) |
| 🤖 | Terms acceptance gate (§5.11) |
| 🤝 | Agent drafts the privacy notice and beta terms from the spec's data inventory and §5.11 clause list; **you approve the text** and decide on a lawyer review |
| 🤖 | Landing and README copy for guest mode vs signed-in mode |
| 🤝 | Agent drafts the breach-response note and the encryption-key rotation runbook; you review them |
| 👤 | Delete a throwaway test profile in production; confirm its SnapTrade user is gone |

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

### Gate 1 — Personal phase (you only) 👤
Use it for a few weeks on desktop and phone. Cost up to $20/mo (D15). Review
`sync_runs`, Sentry, and costs weekly. Ask an agent to fix what you find.

### M5b — Households
| Owner | Task |
|---|---|
| 🤖 | Households and portfolios with a switcher; household settings (members, invites with role dropdown defaulting to owner, revoke, leave/remove, last-owner guard, copy portfolio) |
| 🤖 | Invite and membership endpoints and emails; beta admission via household invite |
| 🤖 | Moving accounts within a household; adding an account to several households; owner labels on linked accounts |
| 🤖 | Duplicate detection; confirming removes the other copy |
| 🤖 | "Last edited by"; `household_events` view |
| 🤖 | Role-matrix tests for editor and former member |
| 👤 | Invite a second member of your household; both of you run the exit scenario |

**Exit:** 👤 you and the second member each link your own logins into one
shared household, confirm a joint account as one, and both edit "Ours" from
separate devices. Your private portfolio stays in your personal household,
invisible to them.

### M7 — Open the closed beta
| Owner | Task |
|---|---|
| 👤 | Supabase Pro, Vercel Pro if needed, SnapTrade billing, postal address, `news.<domain>`, Gmail "Send mail as" (checklist 13–15) |
| 🤖 | Referrals (§5.2a): `referral_codes`, "Invite a friend", `/join?ref=`, referred-first admin view |
| 🤖 | `scripts/admin/sync-audiences.ts`; Profile → Email toggle (§7.1) |
| 🤝 | Agent writes the backup-restore drill; you run it (restore production's backup into a scratch project) |
| 👤 | Triage the waitlist and send invites |

**Exit:** 👤 invited users can sign up, link, and sync; costs track the
~$45–95/mo estimate (about $2 per Drift user who links).

### M8 — Native mobile app (secondary priority; before any paid launch)
| Owner | Task |
|---|---|
| 🤝 | Agent prototypes Capacitor around the same app and reports gaps; you confirm the approach (D23) |
| 👤 | Apple Developer and Google Play accounts (checklist 16) |
| 🤖 | Deep links for magic links and PKCE; SnapTrade portal in an in-app browser; tokens in Keychain/Keystore |
| 🤝 | Agent drafts Apple's privacy label and Google's data-safety answers from the privacy notice; you submit them |
| 👤 | Store listings, review submissions, TestFlight/internal-testing invites |

**Exit:** 👤 beta households use a TestFlight / internal-testing build.

### Gate 2 — Beta review 👤
Decide among: stay closed, build spec §10 features (scheduled sync, alerts,
MCP, adviser role), or start public-launch and billing work.

---

## 5. Ongoing during the beta

| Owner | Task | Cadence |
|---|---|---|
| 👤 | Triage the waitlist; send invites | As needed |
| 👤 | Answer support@ (as support@ from the project Gmail) | As needed |
| 👤 | Read problem reports. Decrypt a snapshot only with the user's consent (D22) | As needed |
| 🤝 | Fix reported bugs: you load the consented snapshot locally and turn it into a synthetic regression fixture with the agent. Real data never enters a PR | As needed |
| 👤 | Check costs (Supabase, Vercel, SnapTrade, Resend), Sentry, and `sync_runs` errors | Monthly |
| 👤 | Run the SnapTrade inactive-user prune | Monthly |
| 👤 | Rotate `TOKEN_ENC_KEYS` (agent-written runbook) | Yearly, or on suspicion |
| 👤 | Send announcements | As needed |
