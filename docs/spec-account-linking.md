# Spec & Implementation Plan: Account Linking (Closed Beta)

**Status:** Draft for review · **Target:** Appendix A of
[`plan-account-linking.md`](plan-account-linking.md) (closed beta, invited
friends & family, web-hosted) · **Background and rationale:** see that doc.

This document turns the exploration into something buildable. It records the
decisions, specifies what gets built, and breaks it into PR-sized milestones
with exit criteria. `<domain>` stands for the custom domain, not yet chosen.

---

## 1. Goals and non-goals

### Goals
1. A signed-in user can link brokerage accounts through SnapTrade and have
   holdings sync into Drift **without CSV export/import**.
2. A signed-in user's portfolio syncs across devices, including phones.
3. Multi-user from day one: real auth, invite-only access, and per-user
   isolation enforced in the database.
4. The server owns synced brokerage data, so later features (scheduled syncs,
   drift alerts, LLM access) can work without a browser open.
5. Rollout in order: **you alone on the multi-user stack → invited friends &
   family**, with no re-architecture between the two.
6. **Local-only mode keeps working** exactly as today for anyone who doesn't
   sign in.

### Non-goals (this spec)
- Trading or any write action against a brokerage. Holdings are **read-only**.
- Public signup, billing, or charging money.
- Scheduled server syncs, drift alerts, email reminders, and the MCP server.
  These are planned follow-ups (§10); the design must keep them easy.
- Native mobile apps. "Mobile" means the existing web app working well on a
  phone browser.
- Users outside the US (no GDPR program yet).

---

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Data + auth | **Supabase**: Postgres, Supabase Auth, Row-Level Security (RLS). Chosen because auth and the database are one system, so RLS can enforce per-user isolation in the database itself; standard Postgres keeps data portable; free tier covers the personal phase; open source and self-hostable |
| D2 | Server code | **Vercel Functions** in `api/`, same project, repo, CI, and preview deploys as today. Vercel Cron available for later scheduled jobs |
| D3 | Aggregator | **SnapTrade**, Commercial key. Free tier (5 connections) during the personal phase, pay-as-you-go (~$2/connected user/month) after. The Personal key is used only for the throwaway spike |
| D4 | Brokerage access | Read-only holdings, balances, and positions. No trading endpoints are called, and the code must not include them |
| D5 | Login | **Email + password, plus magic link** (Supabase Auth). Password reset by email. TOTP MFA deferred to a public launch |
| D6 | Invite gating | Public signups disabled in Supabase. Users are invited by email; the invite link lets them set a password. Non-invited visitors can join a **waitlist** |
| D7 | Who writes what | **Split by owner.** The server alone writes synced brokerage data (linked accounts, holdings, sync log). The browser alone writes user decisions (`AppState` and account mappings). Nothing has two writers |
| D8 | Composing positions | A shared **pure** function combines `AppState` + synced holdings into the engine's `Position[]`. Runs in the browser now; importable by server code for later features |
| D9 | Engine location | Browser for the interactive loop, unchanged. Server code must be able to import it (it's already pure) for scheduled syncs and MCP later |
| D10 | Secrets at rest | SnapTrade `userSecret` encrypted at the application level (AES-256-GCM, key in a Vercel env var). Holdings stay plain rows, protected by RLS and Supabase's disk encryption, so they remain queryable |
| D11 | Outgoing email | **Resend** as Supabase Auth's custom SMTP and for app email. SPF, DKIM, and DMARC on `<domain>`. **No portfolio data in any email**; open/click tracking off |
| D12 | Incoming email | **Cloudflare Email Routing** forwards `support@<domain>` to your inbox (free). Upgrade to a real mailbox if replying as support becomes awkward |
| D13 | Domain & DNS | Custom `<domain>` with DNS on Cloudflare; app served by Vercel. Auth emails link to `<domain>`, not `supabase.co` |
| D14 | LLM readiness | No MCP in the beta, but versioned server API (`/api/v1/…`), server-owned holdings, and server-importable compose/engine so a read-only MCP server is a thin layer later. A client-side "Copy summary for AI" ships in the beta |
| D15 | Budget ceiling | $0/mo during the personal phase (plus domain ~$1/mo); up to ~$100/mo during the beta |

---

## 3. Architecture

```
Browser (existing SPA)
 ├─ Local-only mode: unchanged, localStorage only
 └─ Signed-in mode:
     ├─ Supabase JS client
     │    ├─ read/write own `portfolios` row (AppState)
     │    ├─ read own broker_accounts / holdings / sync_runs
     │    └─ update own broker_accounts.drift_account_id (mapping)
     ├─ fetch /api/v1/* with the Supabase access token
     └─ composePositions(AppState, holdings) → rebalance(), locally
            │
Vercel Functions (api/v1/)
 ├─ verify the Supabase JWT on every request
 ├─ SnapTrade calls with the server-only consumer key
 ├─ write broker_accounts, holdings, sync_runs (service role)
 └─ waitlist intake
            │
Supabase Postgres + Auth            SnapTrade API           Resend
 ├─ portfolios                       ├─ register/delete user  └─ auth + app email
 ├─ broker_accounts                  ├─ connection portal
 ├─ holdings                         ├─ accounts, holdings     Cloudflare
 ├─ sync_runs                        └─ authorizations          ├─ DNS
 ├─ snaptrade_users (server-only)                               └─ support@ forwarding
 └─ waitlist (server-only)
```

**Who talks to what:**
- The browser reads and writes its own rows directly through Supabase. RLS
  limits every user to their own data, so a pass-through API would add code
  without adding protection.
- Everything involving SnapTrade or other secrets goes through `api/v1/`.

---

## 4. Data model

SQL lives in `supabase/migrations/` and is applied with the Supabase CLI. All
user tables have RLS enabled. "Own" means `user_id = auth.uid()`.

### `portfolios` — the user's decisions (`AppState`)
| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK → `auth.users(id)` on delete cascade | |
| `state` | `jsonb` not null | The `AppState` that `appStateSchema` validates today |
| `schema_version` | `int` not null | Mirrors `AppState.version` (currently `1`) |
| `revision` | `bigint` not null default 0 | Incremented on every save; conflict detection |
| `updated_at` | `timestamptz` not null default `now()` | |

RLS: own row for select/insert/update/delete. Saves use optimistic concurrency:
`update … where user_id = auth.uid() and revision = $seen`. Zero rows updated
means another device saved first (§5.4).

### `broker_accounts` — one row per linked brokerage account
| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | SnapTrade account ID |
| `user_id` | `uuid` not null → `auth.users(id)` on delete cascade | |
| `authorization_id` | `text` not null | SnapTrade brokerage connection |
| `institution` | `text` not null | e.g. "Schwab" |
| `name` | `text` | Account name from the brokerage |
| `mask` | `text` | Last 4 of the account number |
| `status` | `text` not null | `ok`, `needs_reauth`, `error` |
| `drift_account_id` | `text` null | Which Drift `Account.id` this feeds; set by the user |
| `last_synced_at` | `timestamptz` | Holdings timestamp from the last successful sync |

RLS: own rows for select. Owners may **update only `drift_account_id`**
(column-level grant). All other writes are server-only.

**One brokerage account ↔ one Drift account.** A partial unique index on
`(user_id, drift_account_id) where drift_account_id is not null` stops two
brokerage accounts from feeding the same Drift account. The engine treats each
Drift account as one pool of cash whose trades must net to zero
(`PRINCIPLES.md`, hard constraint #3). Two brokerage accounts don't share cash,
so merging them would produce trades that can't be executed (a sell at one
brokerage funding a buy at another) and a trade list that doesn't say where to
act. Overlapping tickers across brokerage accounts are fine; each brokerage
account simply maps to its own Drift account. Grouping accounts for display is
a possible later feature that doesn't merge them for the engine.

### `holdings` — current positions per linked account
| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` not null → `auth.users(id)` on delete cascade | |
| `broker_account_id` | `text` not null → `broker_accounts(id)` on delete cascade | |
| `ticker` | `text` not null | Cash becomes a synthetic CASH-classified ticker |
| `description` | `text` | |
| `units` | `numeric` | |
| `price` | `numeric` | |
| `market_value` | `numeric` not null | |
| `cost_basis` | `numeric` | Aggregate; when available |
| `as_of` | `timestamptz` not null | |

Primary key `(broker_account_id, ticker)`. RLS: own rows for select; writes
server-only. Each sync **replaces** an account's holdings in one transaction.
History (snapshots over time) is out of scope but can be added as a separate
table later without changing this one.

### `sync_runs` — sync log for monitoring
| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity PK | |
| `user_id` | `uuid` not null | |
| `trigger` | `text` not null | `manual`, `auto_on_open`, later `cron` |
| `started_at` / `finished_at` | `timestamptz` | |
| `status` | `text` not null | `ok`, `partial`, `error` |
| `accounts_synced` | `int` | |
| `snaptrade_calls` | `int` | API calls made during the run |
| `error_code` | `text` | No messages that could contain holdings |

RLS: own rows for select; writes server-only. No dollar amounts or tickers.

### `snaptrade_users` — SnapTrade credentials (server-only)
| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK → `auth.users(id)` on delete cascade | |
| `snaptrade_user_id` | `text` not null unique | Random ID we generate; never the email |
| `user_secret_enc` | `text` not null | AES-256-GCM ciphertext (base64 of iv + ciphertext + tag) |
| `created_at` | `timestamptz` not null default `now()` | |

RLS enabled with **no policies**: the browser can't read or write it.

### `waitlist` (server-only)
| Column | Type | Notes |
|---|---|---|
| `email` | `citext` PK | |
| `note` | `text` | Optional "which brokerages do you use?" |
| `heard_from` | `text` | Optional: `friend_family`, `search`, `social`, `other` |
| `heard_from_detail` | `text` | Optional free text |
| `referral_code` | `text` → `referral_codes(code)` | Set when they arrived through a referral link |
| `created_at` | `timestamptz` not null default `now()` | |
| `invited_at` | `timestamptz` | Set when you invite them |

RLS with no policies; written only by `POST /api/v1/waitlist`.

### `referral_codes` (added in M7)
| Column | Type | Notes |
|---|---|---|
| `code` | `text` PK | Random, URL-safe; reveals nothing about the referrer |
| `user_id` | `uuid` not null unique → `auth.users(id)` on delete cascade | One code per user |
| `created_at` | `timestamptz` not null default `now()` | |

RLS: owners can select their own code; writes are server-only. On account
deletion the code is deleted and `waitlist.referral_code` is set to null.

### `AppState` changes
- **None to the schema version.** Account mappings live in
  `broker_accounts.drift_account_id`, not in `AppState`.
- Add one optional field for per-position overrides on linked accounts, since
  synced positions aren't stored in `AppState.positions`:

  ```ts
  linkedPositionOverrides: z.record(z.string(), z.object({ locked: z.boolean() }))
    .optional().default({}),
  // key: `${driftAccountId}:${ticker}`
  ```

### Composing positions: `src/ingest/compose.ts`
```ts
export function composePositions(
  state: AppState,
  linked: LinkedHolding[],   // holdings joined with drift_account_id
): Position[]
```
- A Drift account with a linked broker account takes its positions **only**
  from that account's `holdings`. `AppState.positions` rows for that account
  are ignored. (At most one broker account per Drift account; see
  `broker_accounts`.)
- Other accounts use `AppState.positions` (CSV/manual), as today.
- `lastUpdatedAt` = the holding's `as_of`, so the existing freshness indicator
  (`src/ingest/freshness.ts`) shows real sync times.
- `linkedPositionOverrides` applies `locked`.
- Pure, no React or Supabase imports, unit-tested; importable by server code.

---

## 5. Client behavior

### 5.1 Landing page and sign-in
- The landing page (`src/ui/LandingPage.tsx`) keeps "Use Drift without an
  account" as today and adds **Sign in**.
- The sign-in page:
  - states that Drift accounts are in **closed beta**, invite-only;
  - offers email + password, "Email me a sign-in link," and "Forgot password";
  - links new visitors to **Join the waitlist**: email, plus optional "Which
    brokerages do you use?" and "How did you hear about Drift?"
- Invited users get an email; the link lands on a "Set your password" page.
- All auth links use the PKCE flow and land on `<domain>`. The app exchanges the
  code and **strips it from the URL**, as it does with `?demo` today.

### 5.2 Waitlist
- `POST /api/v1/waitlist` stores the email. Duplicate emails succeed silently
  (no account-existence leak). Spam protection: a hidden honeypot field and a
  per-IP rate limit. Add Cloudflare Turnstile only if spam shows up.
- No confirmation email in the beta, so nothing to send or track.
- You invite from the waitlist through the Supabase dashboard or an admin
  script that sets `invited_at`. The admin view lists referred signups first.

### 5.2a Referrals (M7, once beta users exist)
- Each signed-in user sees a personal link, `https://<domain>/join?ref=<code>`,
  under Settings → "Invite a friend."
- The link opens the waitlist form with the code attached; the signup is
  stored with `referral_code`. "How did you hear" is pre-set to
  `friend_family`.
- Referral **does not auto-invite**. You still choose whom to invite, which
  keeps control of SnapTrade connections and cost. Referred people are
  prioritized in your invite list.
- No rewards in the beta.
- The `ref` parameter is stripped from the URL on load (like `?demo` and auth
  codes) so it never reaches analytics.

### 5.3 First sign-in: migrating local data
- No `portfolios` row and a local portfolio present: offer "Upload this
  browser's portfolio to your account," validated with `appStateSchema`.
- A remote row exists: it wins. If local data differs, ask before overwriting,
  and keep a local backup either way (reuse `saveBackup`).

### 5.4 Saving `AppState`
- The existing autosave in `src/App.tsx` keeps writing `localStorage` as an
  offline cache. When signed in, it also schedules a remote save, debounced
  about 1.5 seconds.
- On a revision conflict, reload the remote state and show "This portfolio was
  updated on another device. Loaded the latest version."
- Offline saves queue and retry; a small "Not synced" badge shows until they
  succeed.
- Network code lives in a new `src/sync/` (`supabaseClient.ts`,
  `remoteStore.ts`, `api.ts`). `src/store.ts` stays network-free.

### 5.5 Linked accounts (Positions tab)
A new "Linked accounts" source in `src/ui/PositionsPanel.tsx`:
1. **Connect a brokerage:** call `POST /api/v1/snaptrade/connect`, open the
   returned SnapTrade portal URL. On return, call sync.
2. **Sync now:** call `POST /api/v1/snaptrade/sync`. The server stores holdings
   and returns the updated linked accounts and holdings, so the panel updates
   without a second request.
3. **Mapping:** any broker account with no `drift_account_id` goes through the
   existing "Map accounts" UI; the choice is saved to
   `broker_accounts.drift_account_id`. Later syncs need no mapping. Options per
   broker account: an existing Drift account that isn't already linked, or
   "Create a new Drift account" (pre-filled with institution and name; the user
   confirms the account type).
4. **Auto-sync on open:** if signed in and the oldest linked `last_synced_at`
   is over 12 hours old, sync once in the background.
5. **Connection list:** brokerage, status (including "needs
   re-authentication" with a Reconnect action), and Remove.

CSV import stays available for brokerages SnapTrade doesn't cover. Accounts
with a linked broker account show "Synced" instead of CSV import.

### 5.6 "Copy summary for AI"
A Results-tab button that copies a plain-text summary (allocation vs targets,
drift, suggested trades) to the clipboard. Built next to
`src/ui/exportReport.ts`. Works in local-only and signed-in modes; nothing is
sent anywhere by Drift.

### 5.7 Account deletion
Settings gets "Delete my account." `DELETE /api/v1/account` deletes the
SnapTrade user (removing all brokerage connections), all database rows, and the
Supabase auth user. `localStorage` is untouched.

---

## 6. Server API (`api/v1/`)

All endpoints except waitlist:
- require `Authorization: Bearer <Supabase access token>`, verified
  server-side; the user ID comes from the token, never the body;
- never return SnapTrade secrets, consumer keys, or tokens;
- never log bodies. Logs carry route, status, duration, and internal user ID.

| Endpoint | Behavior |
|---|---|
| `POST /api/v1/snaptrade/connect` | Ensure a `snaptrade_users` row (register + store encrypted secret if missing). Return `{ url }` for the SnapTrade portal, read-only connection |
| `POST /api/v1/snaptrade/sync` | Record a `sync_runs` row; list accounts and fetch holdings/balances; normalize (§6.1); upsert `broker_accounts`, replace `holdings` per account in a transaction; finish the run. Return `{ accounts, holdings, run }` |
| `GET /api/v1/snaptrade/connections` | Brokerage connections with status, from SnapTrade |
| `DELETE /api/v1/snaptrade/connections/:id` | Remove a connection at SnapTrade, then delete its `broker_accounts` (cascades holdings) |
| `DELETE /api/v1/account` | Full deletion (§5.7) |
| `POST /api/v1/waitlist` | Unauthenticated; honeypot + rate limit; insert into `waitlist` |

Concurrency: a sync for a user that already has a run in progress returns the
in-progress run instead of starting another.

Helpers in `api/_lib/`: `auth.ts`, `supabaseAdmin.ts`, `snaptrade.ts`,
`crypto.ts`, `rateLimit.ts`.

### 6.1 Normalization: `src/ingest/adapters/snaptrade.ts`
Pure function, replacing the empty `plaid.ts` stub as the first real aggregator
adapter. Imported by `api/`.

```ts
export function normalizeSnapTrade(
  accounts: SnapTradeAccountHoldings[],
): { accounts: BrokerAccountRow[]; holdings: HoldingRow[]; errors: string[] }
```

- `SnapTradeAccountHoldings` is a **minimal local type** with only the fields
  used, so `src/` doesn't depend on the SnapTrade SDK.
- `market_value` = units × price; `cost_basis` = average purchase price × units
  when present.
- Cash balances become a synthetic ticker that classifies as CASH, the same
  approach the CSV adapters' `cashRow` option uses (#54).
- Rows that would fail `positionSchema` go into `errors`.
- Asset classification is unchanged: unknown tickers flow through
  `tickerOverrides` / `decompositions` and the Classify tab.

Exact SnapTrade field names are confirmed during the spike (M0).

---

## 7. Email

| Email | Sender | Content rule |
|---|---|---|
| Invite, magic link, password reset, email change | Supabase Auth via Resend SMTP | Custom templates on `<domain>`; link uses `{{ .TokenHash }}` to `<domain>/auth/confirm` |
| Reminders, drift alerts (later, §10) | Server via Resend API | "Open Drift to review." Never dollar amounts, tickers, or account names |
| Support | Inbound to `support@<domain>` | Cloudflare Email Routing → your inbox |

DNS (Cloudflare): SPF and DKIM for Resend, DMARC starting at `p=none` with
reports, MX for Cloudflare Email Routing. Sending from a subdomain
(`mail.<domain>`) keeps app email reputation separate from support mail.

---

## 8. Security and privacy requirements

| Requirement | How |
|---|---|
| Per-user isolation | RLS on every user table; column-level grant for mappings; CI test with two users (§9) |
| Secrets never reach the browser | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are `VITE_`-prefixed. CI fails if `dist/` contains a server secret name or value pattern |
| `userSecret` at rest | AES-256-GCM with `TOKEN_ENC_KEY`, random IV each time |
| No trading | Read-only portal; no trade endpoints imported; a test greps `api/` for trading calls |
| CSP | `connect-src 'self' https://<project>.supabase.co`. SnapTrade portal opens as top-level navigation; `form-action 'none'` and `frame-ancestors 'none'` stay |
| Analytics stays page-only | URL scrubbed after auth callbacks; `<Analytics beforeSend>` drops query strings and hashes; reported path stays `/` |
| Email | No portfolio data; tracking off (§7) |
| Logs | No bodies, emails, or amounts. No third-party error monitoring in this spec |
| Light beta posture | Privacy notice (covering accounts, waitlist, SnapTrade, email) and short ToS; US-only; free; breach-response note in `docs/` |

---

## 9. Testing

- **Unit (Vitest):**
  - `normalizeSnapTrade` with synthetic fixtures (several accounts, cash,
    missing cost basis, bad rows). Fixtures are synthetic only.
  - `composePositions`: linked vs CSV accounts, overrides, freshness
    timestamps.
  - Mapping UI refuses a Drift account that already has a linked broker
    account.
  - `remoteStore` save/conflict/retry with a mocked Supabase client.
  - URL scrubbing and the analytics `beforeSend` filter.
  - `api/_lib/crypto.ts` round-trip and tamper detection.
  - `api/v1/` handlers with mocked SnapTrade and Supabase: missing or invalid
    token → 401; sync writes only the caller's rows; concurrent sync returns
    the running run; waitlist honeypot and duplicates.
- **Database (new CI job):** local Supabase, apply migrations, two users.
  Assert neither can read or write the other's rows in any table; neither can
  read `snaptrade_users` or `waitlist`; an owner can update `drift_account_id`
  but no other `broker_accounts` column.
- **Engine:** no engine changes; the scenario suite should pass untouched.
- **Manual before each gate:** sign up from an invite, set password, magic link,
  password reset; link → sync → map → rebalance on desktop and phone; check the
  network tab and `localStorage` for secrets; check that auth emails pass SPF,
  DKIM, and DMARC; delete the account and confirm the SnapTrade user is gone.

---

## 10. Designed for later (out of scope here)

- **Scheduled syncs + drift alerts:** Vercel Cron calls the same sync code,
  then runs `composePositions` + `rebalance()` server-side and emails when drift
  exceeds tolerance. Uses existing tables; `sync_runs.trigger = 'cron'`.
- **Email reminders:** server-side version of the existing reminder settings.
- **MCP server (read-only):** a remote MCP endpoint whose tools
  (`get_portfolio`, `get_drift`, `get_rebalance_plan`) call the same
  server-side compose + engine. Needs OAuth for MCP clients (check Supabase's
  OAuth-server support at the time) and an explicit user opt-in, plus a privacy
  rule update, because portfolio data then goes to an AI provider.
- **Holdings history:** snapshot table for performance and drift over time.
- **Public launch:** TOTP MFA, rate limiting, abuse protection, legal review
  (exploration doc Phase 3).

---

## 11. Implementation plan

Each milestone is one PR to `main` on a `feat/<issue>-…` branch, per
`CLAUDE.md`. Issue numbers are created when work starts.

### M0a — Domain spike
- Shortlist 5–10 names. For each, check:
  - availability and price, **including renewal price** (some registries
    charge premium renewals);
  - TLD reputation for email delivery (prefer `.com`, `.app`, `.io`; avoid
    TLDs with poor spam reputation such as `.xyz`, `.top`);
  - `.app` and `.dev` force HTTPS (HSTS-preloaded), which is fine since Vercel
    serves HTTPS;
  - a USPTO trademark search (TESS) for conflicts in finance/software;
  - an existing site, company, or app with a confusingly similar name;
  - matching social handles, if you'll want them for recruiting beta users.
- Register at Cloudflare Registrar (at-cost pricing, and DNS needs to be on
  Cloudflare anyway for D12/D13). Enable auto-renew and registrar lock.
- **Exit:** domain registered; `<domain>` filled in throughout this spec.

### M0 — Spike (throwaway; not merged)
- SnapTrade **Personal** key, local script under `/private/` (git-ignored),
  fetch your real holdings, hand-normalize, run `rebalance()`, compare with a
  CSV import.
- **Exit:** your brokerages are covered (or noted for CSV); SnapTrade field
  names confirmed; connection portal flow understood.

### M1 — Guardrails and docs update
- Amend `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, and `README.md`: *local-only
  mode sends nothing; signed-in mode stores the user's portfolio, linked
  holdings, and SnapTrade credentials server-side, encrypted where sensitive,
  only for that user.*
- **Changes rules `CLAUDE.md` calls inviolable: needs your explicit sign-off.
  No backend code merges before it.**
- **Exit:** docs merged; CHANGELOG notes the policy change.

### M2 — Pure modules
- `src/ingest/adapters/snaptrade.ts`, `src/ingest/compose.ts`, synthetic
  fixtures, tests. Add `linkedPositionOverrides` to `appStateSchema`.
- **Exit:** tests green; no runtime behavior change.

### M3 — Domain, email, backend foundation
- Cloudflare DNS for `<domain>` (registered in M0a); point it at Vercel.
- Resend account; SPF/DKIM/DMARC; Supabase custom SMTP; custom auth templates.
- `support@<domain>` via Cloudflare Email Routing.
- Supabase project; `supabase/migrations/` with all tables, RLS, and the
  column grant; disable public signups.
- `api/v1/` scaffolding, `_lib/` helpers, `GET /api/v1/health` verifying the
  token. Vercel env vars; CSP update.
- CI: database isolation job and `dist/` secret scan.
- **Exit:** isolation test passes; a test auth email lands in the inbox with
  SPF/DKIM/DMARC passing; mail to support@ arrives.

### M4 — Sign-in and cross-device sync
- `src/sync/`; landing-page Sign in; sign-in page with closed-beta message,
  password, magic link, forgot password, set-password page; waitlist form and
  `POST /api/v1/waitlist`.
- URL scrubbing; analytics `beforeSend`.
- Remote save/load with revisions; local upload on first sign-in; "Not synced"
  badge.
- **Exit:** a portfolio edited on desktop shows up on a phone; local-only mode
  unchanged (existing app tests pass); waitlist entries arrive.
- Useful on its own: cross-device Drift with CSV import.

### M5 — Linking
- `api/v1/snaptrade/*` and `sync_runs` logging; Positions tab "Linked accounts":
  connect, sync, mapping, auto-sync on open, connection list, reconnect.
- Engine input switches to `composePositions(state, linked)`.
- **Exit:** link → sync → map → rebalance works end to end; second sync needs no
  mapping; a broken connection shows "needs re-authentication"; holdings are in
  the database after a sync even if the browser is closed right after.

### M6 — Deletion, notices, copy, AI summary
- `DELETE /api/v1/account` and the Settings control.
- Privacy notice and ToS; landing and README copy so "no account required"
  describes local-only mode accurately.
- "Copy summary for AI" button.
- Breach-response note in `docs/`.
- **Exit:** account deletion removes auth user, all rows, and SnapTrade user.

### Gate 1 — Personal phase (you only)
Only your email invited. Use it for a few weeks on desktop and phone. Cost about
$0 plus the domain. Check `sync_runs` for errors and call volume.

### M7 — Open the closed beta
- Supabase Pro (backups, no pausing); Vercel Pro if hosting must be
  commercial-safe.
- Invite from the waitlist; SnapTrade pay-as-you-go after 5 connections.
- Referrals (§5.2a): `referral_codes` table, "Invite a friend" link,
  `/join?ref=` handling, referred-first ordering in the admin view.
- Confirm a database backup restores.
- **Exit:** invited users can sign up, link, and sync; costs track the
  ~$45–95/mo estimate.

### Gate 2 — Beta review
Decide among: stay closed, build §10 features (scheduled sync, alerts, MCP), or
start public-launch work.

---

## 12. Open questions

1. Which domain? Settled by the M0a spike.
2. Should beta users also be able to invite directly (a small invite quota),
   or does every invite stay with you? (Spec assumes you invite everyone.)
