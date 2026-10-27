# Spec: Account Linking (Closed Beta)

**Status:** Draft for review · **Scope:** the product for the closed beta
(invited friends & family, web-hosted) · **Background and rationale:**
[`study-account-linking.md`](study-account-linking.md) · **Household
requirements:** [`spec-households.md`](spec-households.md) · **How it gets
built:** [`build-plan-account-linking.md`](build-plan-account-linking.md).

This document specifies what Drift becomes: decisions, data model, behavior,
API, and security requirements. Sequencing and ownership live in the build
plan. Milestone IDs mentioned here (M0a–M8) refer to it. `<domain>` stands for
the custom domain, not yet chosen.

**Vocabulary.** These terms are defined in
[`spec-households.md`](spec-households.md) §2 and mean the same thing in the
docs, the UI, and the schema:

| Term | Meaning |
|---|---|
| Drift user | A person who signs in to Drift |
| Profile | Drift's record of a Drift user: sign-in identity, settings, preferences, and info. What gets deleted when someone leaves Drift. Never "account" |
| Household | A group of Drift users that share access to portfolios |
| Portfolio | Accounts plus one strategy (today's `AppState`) |
| Account | A brokerage account as it appears in a portfolio (`Account` in `AppState`), e.g. "Schwab Roth IRA" |
| Linked account | An account whose holdings sync from a brokerage login (table `linked_accounts`). Otherwise the account is *manual* (CSV or hand entry) |
| Brokerage login | One SnapTrade connection to an institution; can contain several linked accounts |

---

## 1. Goals and non-goals

### Goals
1. A signed-in user can link brokerage logins through SnapTrade and have
   holdings sync into Drift **without CSV export/import**.
2. A portfolio syncs across devices, including phones.
3. Multi-user from day one: real auth, invite-only access, and **household**
   isolation enforced in the database. Several Drift users can jointly
   manage one household's portfolios.
4. The server owns synced brokerage data, so later features (scheduled syncs,
   drift alerts, LLM access) can work without a browser open.
5. Rollout in order: **the developer alone → the developer's household →
   invited friends & family**, with no re-architecture between steps.
6. **Guest mode (no signup) keeps working** exactly as today for anyone who doesn't
   sign in.

### Non-goals (this spec)
- Trading or any write action against a brokerage. Holdings are **read-only**.
- Public signup, billing, or charging money. These are post-beta (§10).
- Scheduled server syncs, drift alerts, email reminders, and the MCP server.
  These are planned follow-ups (§10); the design must keep them easy.
- The read-only viewer/adviser role in the UI (the schema supports it; see
  `spec-households.md` R7).
- A native mobile app **in the early beta**. It is in beta scope as a secondary
  priority (M8): after the other milestones, before any paid launch. Until
  then, "mobile" means the web app working well in a phone browser (§5.10).
- Users outside the US (no GDPR program yet).

---

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Data + auth | **Supabase**: Postgres, Supabase Auth, Row-Level Security (RLS). Auth and the database are one system, so RLS enforces household isolation in the database itself. Standard Postgres keeps data portable. Open source and self-hostable |
| D2 | Server code | **Vercel Functions** in `api/`: same project, repo, CI, and preview deploys as today. Vercel Cron available for later scheduled jobs. Function region co-located with the Supabase region |
| D3 | Aggregator | **SnapTrade**, Commercial key. Free tier (5 connected users) during the personal phase, pay-as-you-go (~$2 per connected Drift user/month) after. The Personal key is used only for the throwaway spike. **Conditional on M0 showing workplace 401(k) coverage**; see D20 |
| D4 | Brokerage access | Read-only holdings, balances, and positions. No trading endpoints are called, and the code must not include them |
| D5 | Login | **Email + password, plus magic link** (Supabase Auth). Password reset by email. **TOTP MFA available as an opt-in during the beta** (free in Supabase, and expected by the FTC Safeguards Rule; exploration §8). Required MFA is a public-launch decision |
| D6 | Invite gating | Public signups disabled in Supabase. Only two kinds of invite exist: **you** invite from the waitlist, and a **household owner** invites members into their own household (`spec-households.md` R2). Beta users can't invite anyone else; they can refer friends (§5.2a), and you decide whom to invite. The invite link lets them set a password. Non-invited visitors can join a **waitlist** |
| D7 | Who writes what | **One writer per column.** The server alone writes synced brokerage data (`brokerage_logins`, `linked_accounts`, `holdings`, `sync_runs`). Users write their decisions (portfolio state, account assignments, owner labels), always through the database functions in §4.3 that check household role. No table row has two writers |
| D8 | Composing positions | A shared **pure** function combines a portfolio's `AppState` with its assigned holdings into the engine's `Position[]`. Runs in the browser now; importable by server code for later features |
| D9 | Engine location | **One engine, one implementation, run in the browser.** `src/engine/` is pure TypeScript with no DOM or Node APIs. The browser bundles it; server code imports **the same module from the same commit** only when a §10 feature needs it, never a copy or a port. Browser because: guest mode needs it; interactive edits recompute in milliseconds, where a server round-trip would add ~100–500 ms per edit (more on cold starts); and it works offline. Guards against the two runtimes diverging: (1) CI fails if `src/engine/` imports anything environment-specific; (2) the scenario suite already runs in Node via Vitest, which is the server runtime; (3) browser bundle and functions deploy atomically from one commit, and server-computed results record the engine's git SHA; (4) an open tab on an older bundle gets a "new version — reload" prompt |
| D10 | Secrets at rest | SnapTrade `userSecret` encrypted at the application level (AES-256-GCM) with a **versioned keyring** (`TOKEN_ENC_KEYS`), so the key can be rotated. Holdings stay plain rows, protected by RLS and Supabase's disk encryption, so they remain queryable. Threat model in §8 |
| D11 | Outgoing email | **Resend** as Supabase Auth's custom SMTP and for app email. SPF, DKIM, and DMARC on `<domain>`. **No portfolio data in any email**; open/click tracking off |
| D12 | Incoming email | **Cloudflare Email Routing** forwards `support@<domain>` to your inbox (free). Upgrade to a real mailbox if replying as support becomes awkward |
| D13 | Domain & DNS | Custom `<domain>` with DNS on Cloudflare; app served by Vercel. Records pointing at Vercel are **DNS-only** (Cloudflare proxy off). Auth emails link to `<domain>`, not `supabase.co` |
| D14 | LLM readiness | No MCP in the beta. Versioned server API (`/api/v1/…`), server-owned holdings, and server-importable compose/engine make a read-only MCP server a thin layer later. A client-side "Copy summary for AI" ships in the beta |
| D15 | Budget ceiling | Up to **$20/mo** during the personal phase (domain, plus room for a paid tier if a free one pauses or limits); up to ~$100/mo during the beta |
| D16 | Households | Access is granted per **household** (owner / editor / viewer). A Drift user can belong to several households. A hard privacy boundary means a separate household under the same Drift user. Mine/hers/joint is a label, never an access boundary. Requirements: `spec-households.md` |
| D17 | Supabase keys & tokens | Use the **new API keys** (`sb_publishable_…` in the browser, `sb_secret_…` on the server) and **asymmetric JWT signing keys** from day one. The legacy `anon`/`service_role` keys are being retired and can't be rotated. Functions verify access tokens locally against the project's JWKS (`jose`) |
| D18 | Least privilege on the server | Functions act **as the user** (a Supabase client carrying the caller's token, so RLS applies). The secret key is used only for `snaptrade_users`, `waitlist`, rate limits, and profile deletion |
| D19 | Environments | Two Supabase projects: **staging** (local dev and Vercel preview deploys) and **production** (production deploys only). Preview URLs are allowed as auth redirects in staging only. Real brokerage data only in production |
| D20 | Aggregator fallback | **Plaid Investments** is the named second adapter, triggered if M0 shows SnapTrade can't read workplace 401(k)s at the major recordkeepers (e.g. Empower, Fidelity NetBenefits). The pure-adapter design (§6.1) keeps this to a new adapter plus server routes. Until then, uncovered accounts stay on CSV |
| D21 | Error monitoring | **Sentry for `api/` only**, with `sendDefaultPii: false`, no request or response bodies, and a `beforeSend` that keeps only route, status, error type, and stack. No client-side SDK in the beta |
| D22 | Support access | **No routine access to user data.** Bugs are investigated from logs and `sync_runs` (IDs, codes, timings only) and from **user-initiated problem reports** (§5.9) that the user reviews before sending. As Supabase project owner you can technically read the database; the policy is to do so only with the user's consent for a specific report, logged in `support_access_log`, and the privacy notice says so. No impersonation or "view as user" feature |
| D23 | Mobile | **Mobile web first:** every beta flow works in a phone browser and the app is installable as a PWA (§5.10). A **native app** is in beta scope as a secondary priority (M8). Default approach: wrap the same React app with Capacitor for iOS and Android, so there is one UI codebase; confirmed at the start of M8 |

---

## 3. Architecture

```
Browser (existing SPA)
 ├─ Guest mode: unchanged, localStorage only
 └─ Signed-in mode:
     ├─ Supabase JS client (publishable key + user session)
     │    ├─ read households, portfolios, assigned holdings (RLS by membership)
     │    ├─ write decisions via RPC: save_portfolio, assign_account, …
     │    └─ Realtime: subscribe to portfolio revisions
     ├─ fetch /api/v1/* with the Supabase access token
     └─ composePositions(AppState, linked) → rebalance(), locally
            │
Vercel Functions (api/v1/)
 ├─ verify the JWT locally (JWKS); act as the user (RLS applies)
 ├─ SnapTrade calls with the server-only consumer key
 ├─ write brokerage data via security-definer RPCs (replace_holdings, …)
 ├─ invites, membership, waitlist
 └─ Sentry (scrubbed)
            │
Supabase Postgres + Auth            SnapTrade API           Resend
 ├─ households, members, invites     ├─ register/delete user  └─ auth + app email
 ├─ portfolios                       ├─ connection portal
 ├─ brokerage_logins / _accounts     ├─ accounts, holdings     Cloudflare
 ├─ account_assignments              └─ authorizations          ├─ DNS
 ├─ holdings, sync_runs                                         └─ support@ forwarding
 ├─ snaptrade_users (server-only)
 └─ waitlist, rate_limits (server-only)
```

**Who talks to what:**
- The browser reads through Supabase directly; RLS limits it to households the
  user belongs to. Writes go through database functions (§4.3) that check the
  caller's household role and keep related changes in one transaction.
- Everything involving SnapTrade, invites, or other secrets goes through
  `api/v1/`.

---

## 4. Data model

SQL lives in `supabase/migrations/` and is applied with the Supabase CLI to
staging, then production. Every table has RLS enabled.

**Membership check.** `private.household_role(household_id uuid) → text | null`
is a `security definer` function in a schema not exposed to the API. It
returns the caller's role from `household_members`. Policies call it as
`(select private.household_role(…))`, so it runs once per query, not once
per row. This also avoids recursive policies on `household_members`. Roles
are never stored in JWT claims, since claims go stale.

### 4.1 Households and access

#### `households`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` not null | e.g. "Alex & Sam", "Alex (private)" |
| `created_by` | `uuid` → `auth.users(id)` on delete set null | |
| `created_at` | `timestamptz` not null default `now()` | |

RLS: select if any role. Rename by owner (through an RPC). Created through
`create_household` RPC, which also inserts the caller as owner.

#### `household_members`
| Column | Type | Notes |
|---|---|---|
| `household_id` | `uuid` → `households(id)` on delete cascade | PK part |
| `user_id` | `uuid` → `auth.users(id)` on delete cascade | PK part; indexed |
| `role` | `text` not null | `owner`, `editor`, `viewer` (viewer not offered in the beta UI) |
| `display_name` | `text` not null | Shown to other members |
| `invited_by` | `uuid` null | |
| `created_at` | `timestamptz` not null default `now()` | |

RLS: members can select all rows of their households. Writes only through
`api/v1/` membership endpoints. A trigger blocks removing the last owner.

#### `profiles`
| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK → `auth.users(id)` on delete cascade | |
| `display_name` | `text` not null | Shown to household members |
| `announcements_opt_in` | `boolean` not null default false | Beta news email (§7.1) |
| `terms_version` / `terms_accepted_at` | `text` / `timestamptz` null | Last accepted beta terms and privacy notice (§5.11) |
| `created_at` | `timestamptz` not null default `now()` | |

The Drift user's own settings and info (the **profile**). RLS: own row for
select and update; household members can select `display_name`.

#### `household_invites` (server-only)
`id`, `household_id`, `email` citext, `role`, `token_hash` (SHA-256),
`expires_at` (default 7 days), `invited_by`, `accepted_at`, `revoked_at`.
RLS with no policies. Owners list pending invites through `api/v1/`.

#### `household_people`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` → `households(id)` on delete cascade | |
| `name` | `text` not null | "Alex", "Sam", "Kid" |
| `user_id` | `uuid` null | When the person is a member |

Owner labels for accounts. RLS: select if any role; writes by editor or above.

#### `household_events`
Append-only audit log: `id`, `household_id`, `actor_id`, `kind` (`member_*`,
`invite_*`, `account_assigned`, `account_moved`, `duplicate_decided`, …),
`subject_id`, `created_at`. No amounts or tickers. RLS: select if any role;
inserts only from RPCs and `api/v1/`.

### 4.2 Portfolios and brokerage data

#### `portfolios` — a portfolio's decisions (`AppState`)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` not null → `households(id)` on delete cascade | Indexed. `unique (id, household_id)` backs the composite FK from `account_assignments` |
| `name` | `text` not null | "Ours", "Mine" |
| `state` | `jsonb` not null | The `AppState` that `appStateSchema` validates today |
| `schema_version` | `int` not null | Mirrors `AppState.version` (currently `1`) |
| `revision` | `bigint` not null default 0 | Incremented on every save; conflict detection |
| `created_by` / `updated_by` | `uuid` null | |
| `updated_at` | `timestamptz` not null default `now()` | |

RLS: select if any role. All writes through `save_portfolio` and
`create_portfolio` / `delete_portfolio` RPCs (editor or above).

#### `brokerage_logins` — one row per SnapTrade connection (server-written)
| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | SnapTrade authorization ID |
| `user_id` | `uuid` not null → `auth.users(id)` on delete cascade | The linker |
| `institution` | `text` not null | e.g. "Schwab" |
| `status` | `text` not null | `ok`, `needs_reauth`, `error` |
| `created_at` | `timestamptz` not null default `now()` | |

RLS: the linker can select. Household members can select logins that have an
account assigned in their household, so they can show "needs reconnection by
<name>". Writes server-only.

#### `linked_accounts` — one row per real account (server-written)
| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | SnapTrade account ID |
| `login_id` | `text` not null → `brokerage_logins(id)` on delete cascade | |
| `user_id` | `uuid` not null | The linker (denormalized for RLS) |
| `institution` | `text` not null | |
| `name` | `text` | Account name from the brokerage |
| `account_type` | `text` | From SnapTrade when available (helps dedupe) |
| `mask` | `text` | Last 4 of the account number |
| `last_synced_at` | `timestamptz` | Holdings timestamp from the last successful sync |

RLS: same visibility as `brokerage_logins`. Writes server-only.

#### `account_assignments` — which portfolio a linked account feeds (user-written)
| Column | Type | Notes |
|---|---|---|
| `linked_account_id` | `text` → `linked_accounts(id)` on delete cascade | PK part |
| `household_id` | `uuid` → `households(id)` on delete cascade | PK part. PK `(linked_account_id, household_id)` enforces **at most one portfolio per household**; the same account may be in several households |
| `portfolio_id` | `uuid` not null | Composite FK `(portfolio_id, household_id)` → `portfolios(id, household_id)`, so the portfolio must belong to that household |
| `account_id` | `text` null | The `Account.id` inside that portfolio's `AppState` that this feeds; null until mapped |
| `owner_person_ids` | `uuid[]` not null default `{}` | Owner labels (`household_people`); several ids means joint |
| `assigned_by` / `assigned_at` | | |

RLS: select if any role in the portfolio's household. Writes only through
`assign_account`, `move_account`, `unassign_account`, `map_account`, and
`save_portfolio`.
- Only the linker can add an account to a household or remove it from one.
  The linker can add it to every household they edit, one portfolio in each.
- Any editor can move an account between portfolios of the same household,
  map it, or change its owner labels.
- A move clears `account_id`.
- Assignments in different households are independent rows. Nothing in one
  household's rows reveals the account's other households to its members.

Whether several linked accounts may map to one account is an open
general import question, tracked in
[#234](https://github.com/rblumen/drift/issues/234). Linking follows whatever
that issue decides for CSV import.

#### `account_duplicates`
| Column | Type | Notes |
|---|---|---|
| `household_id` | `uuid` → `households(id)` on delete cascade | PK part. Detection and decisions are per household |
| `linked_account_id` | `text` → `linked_accounts(id)` on delete cascade | PK part |
| `other_linked_account_id` | `text` → `linked_accounts(id)` on delete cascade | PK part |
| `status` | `text` not null | `suggested` or `rejected` ("not the same account") |
| `decided_by` / `decided_at` | | |

Detection rules are in `spec-households.md` R5:
- **Scoped to one household.** Both accounts must be assigned in that
  household, and they must come from **different brokerage logins**. A
  trigger enforces both. Unassigned accounts, and accounts in other
  households, are never compared.
- A match needs the same institution and the same mask.
- **Confirming removes the duplicate.** The user picks which copy to keep
  (default: the one already mapped). The other copy's assignment in that
  household is deleted in the same transaction, and the suggestion row goes
  with it. A `household_events` row records the decision. The removed copy's
  assignments in other households, and the linker's own record, are
  unaffected. No backup copy is kept.

RLS: select by members of that household. Decisions go through `api/v1/`.

#### `holdings` — current positions per linked account (server-written)
| Column | Type | Notes |
|---|---|---|
| `linked_account_id` | `text` not null → `linked_accounts(id)` on delete cascade | PK part |
| `security_id` | `text` not null | PK part. SnapTrade's security ID, or `CASH:<currency>` for cash balances |
| `ticker` | `text` **null** | Many 401(k) funds (collective trusts) have none |
| `cusip` | `text` null | When available |
| `description` | `text` | |
| `units` | `numeric` | Summed across lots |
| `price` | `numeric` | |
| `market_value` | `numeric` not null | |
| `cost_basis` | `numeric` | Aggregate; when available |
| `as_of` | `timestamptz` not null | |

RLS: select if you're the linker, or the account is assigned to a portfolio in
a household you belong to. Writes only through `replace_holdings` (§4.3).
History is out of scope; a snapshot table can be added later without changing
this one.

A holding with no ticker gets a synthetic key `SEC:<security_id>` in
composition, so it can still be classified through `tickerOverrides` /
`decompositions` and the Classify tab. The description is shown so the user
can recognize the fund.

#### `sync_runs` — sync log for monitoring (server-written)
| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity PK | |
| `user_id` | `uuid` not null | Whose logins were synced |
| `portfolio_id` | `uuid` null | Portfolio that triggered it, if any |
| `trigger` | `text` not null | `manual`, `auto_on_open`, later `cron` |
| `started_at` / `finished_at` | `timestamptz` | |
| `lease_expires_at` | `timestamptz` not null | `started_at` + 2 min; an expired lease no longer blocks a new run |
| `status` | `text` not null | `running`, `ok`, `partial`, `error` |
| `accounts_synced` | `int` | |
| `snaptrade_calls` | `int` | |
| `error_code` | `text` | No messages that could contain holdings |

RLS: own rows for select. No dollar amounts or tickers.

#### Server-only tables
- `snaptrade_users`:
  - `user_id` PK → `auth.users` on delete cascade;
  - `snaptrade_user_id` (random, never the email);
  - `user_secret_enc` (`v<n>:` + base64 of iv + ciphertext + tag);
  - `created_at`, `last_active_at`.
- `waitlist`: `email` citext PK, `note`, `heard_from`, `heard_from_detail`,
  `referral_code`, `updates_opt_in` (default false), `created_at`,
  `invited_at`.
- `support_reports` (§5.9): `id`, `user_id`, `created_at`, `description`,
  `diagnostics` jsonb (no amounts or names), `portfolio_snapshot_enc` null
  (encrypted with the D10 keyring; present only if the user opted in),
  `status`, `closed_at`. Deleted 30 days after closing, or on request.
- `support_access_log`: `id`, `report_id`, `accessed_at`, `reason`. Written
  by the admin script whenever a snapshot is decrypted.
- `referral_codes` (M7): `code` PK, `user_id` unique, `created_at`. Owners can
  select their own.
- `rate_limits`: `key` (route + hashed IP), `window_start`, `count`. Updated by
  an RPC with the secret key. Old rows pruned daily.

These have RLS with no policies, except `referral_codes`.

### 4.3 Database functions (RPC)

Every multi-row or permission-sensitive write is a `security definer` function
that:
- takes the caller from `auth.uid()`, never from arguments;
- checks `private.household_role`;
- runs in one transaction.

This replaces the multi-statement writes the Supabase JS client can't make
atomically.

| Function | Caller | Does |
|---|---|---|
| `create_household(name)` | user | Household + owner membership + a "Me" person |
| `create_portfolio(household_id, name, state)` | editor+ | |
| `save_portfolio(portfolio_id, seen_revision, state, mappings jsonb)` | editor+ | Updates `state` only if `revision = seen_revision`, applies mapping changes (`account_id` per linked account), sets `updated_by`, increments revision. Returns the new revision, or a conflict carrying the current row. Creating an account and mapping to it are one call, so no mapping is orphaned |
| `assign_account(linked_account_id, portfolio_id, owner_person_ids)` / `unassign_account(…)` | linker, editor+ in target | |
| `move_account(linked_account_id, portfolio_id)` | editor+ (same household) or linker | |
| `replace_holdings(linked_account_id, rows jsonb, as_of)` | server (user's token) | Checks the caller is the linker. Deletes the account's holdings and inserts the new set in one transaction |
| `begin_sync(trigger, portfolio_id)` / `finish_sync(run_id, …)` | server (user's token) | Returns an existing unexpired `running` run instead of starting another |

`composePositions` treats a `account_id` that no longer exists in
`AppState` as unmapped. The account reappears in the mapping UI and isn't
dropped silently.

### 4.4 `AppState` changes
None to the schema version. All of these are optional with defaults:

```ts
// Per-position overrides on linked accounts (synced positions aren't in AppState.positions).
linkedPositionOverrides: z.record(z.string(), z.object({ locked: z.boolean() }))
  .optional().default({}),
  // key: `${accountId}:${tickerOrSecKey}`
// Owner labels for manual accounts (linked ones use account_assignments).
// On accountSchema:
ownerPersonIds: z.array(z.string()).optional(),
// Guest mode's list of people; signed-in mode uses household_people.
people: z.array(z.object({ id: z.string(), name: z.string() })).optional().default([]),
```

### 4.5 Composing positions: `src/ingest/compose.ts`
```ts
export function composePositions(
  state: AppState,
  linked: LinkedHolding[],   // the portfolio's assigned holdings, joined with account_id
): Position[]
```
- An account with linked accounts takes its positions
  **only** from their `holdings`. `AppState.positions` rows for that account
  are ignored. Behavior when several linked accounts map to one account
  follows #234.
- Other accounts use `AppState.positions` (CSV/manual), as today.
- `lastUpdatedAt` = the holding's `as_of`, so the existing freshness indicator
  (`src/ingest/freshness.ts`) shows real sync times.
- Ticker-less holdings use `SEC:<security_id>` (§4.2).
- `linkedPositionOverrides` applies `locked`.
- Pure, no React or Supabase imports, unit-tested; importable by server code.

---

## 5. Client behavior

### 5.1 Landing page and sign-in
- The landing page (`src/ui/LandingPage.tsx`) replaces "Use Drift without an
  account" with **"Continue as guest — no signup, your data stays in this
  browser"** (guest mode), and adds **Sign in**.
- The sign-in page:
  - states that Drift is in **closed beta**, invite-only;
  - offers email + password, "Email me a sign-in link," and "Forgot password";
  - asks for the TOTP code when the user has enabled MFA;
  - links new visitors to **Join the waitlist**: email, plus optional "Which
    brokerages do you use?" and "How did you hear about Drift?"
- Invited users get an email; the link lands on a "Set your password" page.
  Household invites then land in that household.
- All auth links use the PKCE flow and land on `<domain>`. The app exchanges
  the code and **strips it from the URL**, as it does with `?demo` today.
- Profile → Security: enable/disable an authenticator app (TOTP).

### 5.2 Waitlist
- `POST /api/v1/waitlist` stores the email.
  - Duplicate emails succeed silently (no user-existence leak).
  - Spam protection: a hidden honeypot field and a per-IP rate limit
    (`rate_limits` table). Add Cloudflare Turnstile only if spam shows up.
- No confirmation email in the beta, so nothing to send or track.
- You invite from the waitlist through an admin script that sets
  `invited_at`. The admin view lists referred signups first.

### 5.2a Referrals (M7, once beta users exist)
- Each signed-in user sees a personal link, `https://<domain>/join?ref=<code>`,
  under Profile → "Invite a friend."
- The link opens the waitlist form with the code attached; the signup is
  stored with `referral_code`. "How did you hear" is pre-set to
  `friend_family`.
- Referral **does not auto-invite**. You still choose whom to invite, which
  keeps control of SnapTrade connections and cost. Referred people are
  prioritized in your invite list. (Household invites are different: they
  admit the invitee directly; `spec-households.md` R2.)
- No rewards in the beta.
- The `ref` parameter is stripped from the URL on load (like `?demo` and auth
  codes) so it never reaches analytics.

### 5.3 First sign-in: migrating local data
- A new Drift user gets a personal household with one empty portfolio.
- If this browser has a local portfolio, offer "Upload this browser's
  portfolio," validated with `appStateSchema`. Local `people` become
  `household_people`.
- If the portfolio already has remote data, it wins. If local data differs,
  ask before overwriting, and keep a local backup either way (reuse
  `saveBackup`).

### 5.4 Saving a portfolio
- The existing autosave in `src/App.tsx` keeps writing `localStorage` as an
  offline cache of the selected portfolio. When signed in, it also schedules
  `save_portfolio`, debounced about 1.5 seconds.
- **Conflicts** (another device or another member saved first):
  - Merge by top-level section: `strategy`, `accounts`, `positions`,
    `tickerOverrides`, `decompositions`, `linkedPositionOverrides`, and the
    cash/withdrawal fields.
  - Sections only one side changed merge automatically, and the save is
    retried.
  - If both sides changed the same section, show "<Name> updated this
    portfolio" and let the user pick theirs or the other version for that
    section. Never discard edits silently.
  - The merge is a pure function in `src/sync/merge.ts`, unit-tested.
- **Realtime:** subscribe to the selected portfolio's row. When another member
  saves, the app loads the new revision if there are no local unsaved edits,
  or merges if there are.
- "Last edited by <name>, <time>" from `updated_by`.
- Offline saves queue and retry through the same merge path; a "Not synced"
  badge shows until they succeed.
- Network code lives in a new `src/sync/` (`supabaseClient.ts`,
  `remoteStore.ts`, `merge.ts`, `api.ts`). `src/store.ts` stays network-free.

### 5.5 Linked accounts (Positions tab)
A new "Linked accounts" source in `src/ui/PositionsPanel.tsx`:
1. **Connect a brokerage:** call `POST /api/v1/snaptrade/connect`, open the
   returned SnapTrade portal URL. On return, call sync.
2. **Assign:** each new linked account starts unassigned and is visible only
   to the linker. For each one, the user picks at most one portfolio in each
   household they edit, sets owner labels (default: themselves), or leaves it
   unassigned. The linker sees everywhere an account is assigned; other
   members see only their own household.
3. **Sync now:** call `POST /api/v1/snaptrade/sync`. The server stores holdings
   and returns the updated accounts and holdings, so the panel updates without
   a second request.
4. **Mapping:** any assigned account with no `account_id` goes
   through the existing "Map accounts" UI. Options are an existing account
   in the portfolio, or "Create a new account" (pre-filled with institution and name;
   the user confirms the account type). Saved through `save_portfolio`, so
   creating and mapping are atomic. Later syncs need no mapping.
5. **Duplicates:** when a suggested duplicate exists, show "Schwab ••1234
   linked by <name> looks like this one. Same account?" Yes asks which copy to
   keep and removes the other from this household (`spec-households.md` R5).
6. **Auto-sync on open:** if signed in and the oldest `last_synced_at` among
   the user's own logins is over 12 hours old, sync once in the background.
7. **Connection list:** the user's brokerage logins with status ("needs
   re-authentication" with a Reconnect action) and Remove. Other members'
   broken logins show "needs reconnection by <name>" with no actions.

CSV import stays available for accounts SnapTrade doesn't cover. Accounts with
a linked account show "Synced" instead of CSV import.

### 5.6 Households and portfolios
Portfolio switcher, household settings (members, invite form with role
dropdown defaulting to owner, leave/remove, copy portfolio), and owner
filters. Full requirements: `spec-households.md` R1–R8. Built in M5b.

### 5.7 "Copy summary for AI"
A Results-tab button that copies a plain-text summary (allocation vs targets,
drift, suggested trades) to the clipboard. Built next to
`src/ui/exportReport.ts`. Works in guest and signed-in modes; nothing is
sent anywhere by Drift.

### 5.8 Deleting a Drift user profile
Profile gets "Delete my Drift user profile and all my data." This deletes
Drift's record of the person, not the person. `DELETE /api/v1/me`:
1. deletes the SnapTrade user, which removes all brokerage connections and
   stops billing;
2. removes the user's memberships, so their linked accounts leave every
   portfolio;
3. deletes households where they were the only member;
4. deletes the Supabase auth user, which cascades their remaining rows.

**Idempotent and retried.**
- If the SnapTrade call fails, the request fails and nothing else is deleted,
  so the user can retry.
- A pending-deletion flag records the attempt. A daily job retries flagged
  deletions, so no profile stays half-deleted and SnapTrade doesn't keep
  billing.

`localStorage` is untouched.

### 5.9 Reporting a problem
- **Help → Report a problem**, in both modes.
- Signed in, it builds a report in the browser and **shows it to the user
  before sending**:
  - **Always included:** app and engine git SHA, browser/OS, current tab,
    recent client errors (messages and stacks, no values), request IDs of
    recent failed API calls, and the user's recent `sync_runs`.
  - **Optional, unchecked by default:** "Include my portfolio data so you can
    reproduce the problem." This adds the selected portfolio's `AppState` and
    linked holdings. Account names become "Account 1…", masks and household
    names are dropped, and amounts are kept, since results depend on them.
  - A free-text description.
- Sent to `POST /api/v1/support/reports` and stored in `support_reports`. You
  get an email ("New report #123", no contents) and read it with an admin
  script.
- The snapshot is a valid fixture for the app's **↑ Load** button. The
  engine is deterministic, so the problem reproduces locally.
- **Guest mode sends nothing.** There the report is a downloadable file
  the user can email to support@ if they choose.
- Every API error shown in the UI carries a short reference ("Error ref
  7F3K"). That is the request ID in server logs and Sentry, so a user's
  screenshot is enough to find the failing request.

### 5.10 Mobile web
- Target iPhone Safari and Android Chrome, from 375 px wide.
- Every beta flow works at phone width: sign-in, the household and portfolio
  switcher, Results (allocation and trades), Positions (linked accounts,
  mapping, CSV import), Strategy, household settings, Profile.
- Tables either reflow into cards or scroll inside their own container. The
  page itself never scrolls sideways.
- Touch targets are at least 44 px. Nothing depends on hover.
- The SnapTrade portal opens as a full-page navigation and returns to the
  app, with no pop-ups (mobile browsers block them).
- **Installable PWA:** web manifest and icons. The service worker caches only
  static assets, never API or Supabase responses, so portfolio data stays out
  of the cache. CSP gains `manifest-src 'self'` and `worker-src 'self'`.
- New screens (M4–M6) are built mobile-first. M6b brings the existing screens
  up to the same bar.
- CI runs a Playwright smoke test of the key flows at a phone viewport.

### 5.11 Terms and consent
- A web service doesn't need a separate EULA. Its **Terms of Service** do
  that job. The beta has short **Beta Terms** plus a **Privacy Notice**, both
  linked from the landing page, sign-in, and Profile.
- **Signed in:** on first sign-in, and whenever either document's version
  changes, the user must accept before continuing. `profiles.terms_version`
  and `terms_accepted_at` record it.
- **Guest mode:** a footer link ("By using Drift you agree to the Terms").
  Nothing is recorded, since nothing is sent.
- **Clauses the Beta Terms must cover:**
  - **Not investment, tax, or legal advice.** Drift is a calculator, and the
    user decides and places every trade. This also supports the publisher
    framing in the study's regulatory section.
  - Provided **as is**, with no warranty.
  - Beta software: features may change, break, or end, with notice where
    practical.
  - **Limitation of liability**, especially for trading decisions.
  - The user verifies all numbers before acting.
  - The beta is free and may become paid, with notice.
  - Acceptable use: one person per Drift user; no scraping; no reverse
    engineering of the service.
  - Data handling by reference to the Privacy Notice: what's stored,
    household sharing, SnapTrade, Resend, problem reports and support
    access, deletion.
  - US-only; governing law of your state.
  - Feedback may be used to improve Drift.
- **Native app (M8):** the App Store's standard EULA plus a link to the same
  terms. No custom EULA unless review requires one.
- Drafted from a reputable template. A lawyer review is recommended before a
  public launch, and optional for a friends-and-family beta. This spec is
  not legal advice.

---

## 6. Server API (`api/v1/`)

All endpoints except waitlist:
- require `Authorization: Bearer <Supabase access token>`. The token is
  verified locally against the project's JWKS (`jose`), checking issuer,
  audience, and expiry. The user ID comes from the token, never the body;
- create a per-request Supabase client **carrying the caller's token**, so RLS
  and the RPC role checks apply (D18);
- never return SnapTrade secrets, consumer keys, or tokens;
- never log bodies. Logs carry route, status, duration, and internal user ID.

| Endpoint | Behavior |
|---|---|
| `POST /snaptrade/connect` | Ensure a `snaptrade_users` row (register + store encrypted secret if missing; secret key). Return `{ url }` for the SnapTrade portal, read-only connection |
| `POST /snaptrade/sync` | `begin_sync`; list the caller's logins and accounts; fetch holdings/balances (accounts in parallel, max 4 at a time); normalize (§6.1); upsert `brokerage_logins`/`linked_accounts` (server-written columns only); `replace_holdings` per account; refresh duplicate suggestions; `finish_sync`. Return `{ accounts, holdings, run }`. If the time budget (§6.2) runs out, finish as `partial`; the next run picks up the rest |
| `GET /snaptrade/connections` | The caller's brokerage logins with status |
| `DELETE /snaptrade/connections/:id` | Remove a login at SnapTrade, then delete its rows (cascades accounts, assignments, holdings) |
| `POST /households/:id/invites` | Owner only. Create invite (hashed token), send email. Body: `email`, `role` |
| `DELETE /households/:id/invites/:inviteId` | Owner only. Revoke |
| `POST /invites/accept` | Body: token. Validates, adds membership, admits to the beta if the user is new |
| `PATCH /households/:id/members/:userId` | Owner only. Change role (not the last owner) |
| `DELETE /households/:id/members/:userId` | Owner, or self (leave). Unassigns the member's linked accounts |
| `POST /portfolios/:id/copy` | Copy a portfolio's state into a household the caller edits |
| `POST /duplicates/decide` | Confirm (body names the copy to keep; the other is removed from the household) or reject a suggestion |
| `POST /support/reports` | Store a problem report (§5.9); rate-limited |
| `DELETE /me` | Delete the caller's Drift user profile and all their data (§5.8) |
| `POST /waitlist` | Unauthenticated; honeypot + rate limit; insert into `waitlist` |
| `GET /health` | Verifies the token; also the target of a daily Vercel Cron ping |

Helpers in `api/_lib/`: `auth.ts` (JWKS verification), `supabase.ts` (user-scoped
client; separate `supabaseAdmin.ts` for the secret key, imported only by the
connect, waitlist, rate-limit, and deletion routes), `snaptrade.ts`,
`crypto.ts`, `rateLimit.ts`, `sentry.ts`.

### 6.1 Normalization: `src/ingest/adapters/snaptrade.ts`
Pure function, replacing the empty `plaid.ts` stub as the first real
aggregator adapter. Imported by `api/`.

```ts
export function normalizeSnapTrade(
  accounts: SnapTradeAccountHoldings[],
): { logins: BrokerageLoginRow[]; accounts: LinkedAccountRow[];
     holdings: HoldingRow[]; errors: string[] }
```

- `SnapTradeAccountHoldings` is a **minimal local type** with only the fields
  used, so `src/` doesn't depend on the SnapTrade SDK.
- `market_value` = units × price. `cost_basis` = average purchase price ×
  units, when present. Lots of the same security are summed.
- Cash balances become `CASH:<currency>` holdings that classify as CASH, the
  same approach the CSV adapters' `cashRow` option uses (#54).
- Securities with no ticker keep `security_id`, `cusip`, and `description`.
- Rows that would fail `positionSchema` go into `errors`.
- Asset classification is unchanged: unknown tickers flow through
  `tickerOverrides` / `decompositions` and the Classify tab.
- A Plaid adapter (D20), if needed, has the same output type.

Exact SnapTrade field names are confirmed during the spike (M0).

### 6.2 Runtime limits
- Function region = Supabase region (both US East unless M3 finds a reason
  otherwise).
- Sync time budget 45 s, checked between accounts. Confirm the Vercel plan's
  function duration limit in M3 and keep the budget under it.
- `vercel.json`'s SPA rewrite must exclude `api/`:
  `"source": "/((?!api/).*)"`.

---

## 7. Email

| Email | Sender | Content rule |
|---|---|---|
| Invite (beta or household), magic link, password reset, email change | Supabase Auth via Resend SMTP; household invites via Resend API | Custom templates on `<domain>`. Auth links use `{{ .TokenHash }}` to `<domain>/auth/confirm`. Household invites name the inviter and household only |
| Membership changes (join, leave, role) | Server via Resend API | Names and household name only |
| Reminders, drift alerts (later, §10) | Server via Resend API | "Open Drift to review." Never dollar amounts, tickers, or account names |
| Announcements (beta news, waitlist updates) | Resend Broadcasts to an Audience, from `news.<domain>` | Product news only. Unsubscribe link and postal address (CAN-SPAM). Never portfolio data |
| Support | Inbound to `support@<domain>` | Cloudflare Email Routing → your inbox. Replies go out as support@ (§7.1) |

DNS (Cloudflare):
- SPF and DKIM for Resend.
- DMARC starting at `p=none` with reports.
- MX for Cloudflare Email Routing.
- Separate sending subdomains: `mail.<domain>` for transactional email and
  `news.<domain>` for announcements. A spam complaint about news then can't
  hurt sign-in email.

Check Supabase Auth's per-hour email rate limit with custom SMTP during M3, and
raise it if needed.

### 7.1 Sending email yourself
- **Transactional email** (auth, invites, membership changes) is automatic.
  Users can't unsubscribe from it, because the service needs it.
- **Announcements** to the waitlist or beta users:
  - You write and send them in the Resend dashboard (Broadcasts).
  - An admin script, `scripts/admin/sync-audiences.ts`, keeps two Resend
    Audiences current: **Waitlist** (entries with `updates_opt_in`) and
    **Beta users** (profiles with `announcements_opt_in`).
  - Only the email address and display name go to Resend.
  - Before each sync, the script pulls Resend's unsubscribes and writes them
    back to the database, so an opt-out sticks.
  - Opt-in points: an unchecked "Email me Drift news" box on the waitlist
    form, and Profile → Email.
  - Waitlist sign-up alone covers only the invite email itself.
- **CAN-SPAM** for announcements:
  - a physical postal address (a PO box or virtual mailbox is fine);
  - a working unsubscribe, honored within 10 business days;
  - honest From and subject lines.
- **One-to-one email** (support replies, a note to one user): from your own
  inbox, **as support@**. Add support@ in Gmail as a "Send mail as" address,
  using Resend's SMTP. Same vendor, nothing new to run.
- Resend is a processor of email addresses and names. The privacy notice
  says so.

---

## 8. Security and privacy requirements

| Requirement | How |
|---|---|
| Household isolation | RLS on every table via `private.household_role`; writes through role-checking RPCs; CI role matrix (§9) |
| Least privilege | Functions act as the user (D18). The secret key is imported only by the connect, waitlist, rate-limit, and deletion routes, and a CI grep enforces it |
| Secrets never reach the browser | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are `VITE_`-prefixed. CI fails if `dist/` contains `sb_secret_`, a server env var name, or a key-shaped value |
| Token verification | Local JWKS verification (D17); asymmetric signing keys, so the signing key can be rotated |
| `userSecret` at rest | AES-256-GCM, random IV each time, versioned keyring `TOKEN_ENC_KEYS` (`v1:…,v2:…`). A re-encryption script runs on rotation. **Threat model:** this protects against a database-only leak (backups, dashboard access, SQL injection). It does **not** protect against a compromised Vercel project, which holds both the database secret and the encryption key |
| No trading | Read-only portal; no trade endpoints imported; a test greps `api/` for trading calls |
| MFA | TOTP opt-in (D5) |
| CSP | `connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co`. SnapTrade portal opens as top-level navigation. `form-action 'none'` and `frame-ancestors 'none'` stay |
| Analytics stays page-only | URL scrubbed after auth callbacks and invite links; `<Analytics beforeSend>` drops query strings and hashes; reported path stays `/` |
| Email | No portfolio data; tracking off (§7) |
| Logs and errors | Structured JSON logs per request: request ID, route, status, duration, user ID, error code. No bodies, emails, amounts, or tickers. Sentry on `api/` only, scrubbed (D21). Vercel's built-in log retention is short (confirm in M3), so `sync_runs`, Sentry, and problem reports are the durable record; add a log drain only if needed |
| Support access | D22: user-initiated problem reports; consent-gated, logged snapshot access; no impersonation |
| Environments | Real data only in the production Supabase project; previews use staging (D19) |
| Cost hygiene | `snaptrade_users.last_active_at`. An admin script lists or deletes SnapTrade users inactive for 60+ days (with notice), since each connected user is billed until deleted |
| Light beta posture | Beta Terms accepted at sign-in (§5.11); Privacy notice (accounts, households and sharing with members, waitlist, SnapTrade, email and Resend, problem reports and support access) and short ToS (the beta is free and may become paid, with notice); US-only; free; breach-response note in `docs/` |

---

## 9. Testing

- **Unit (Vitest):**
  - `normalizeSnapTrade` with synthetic fixtures: several logins and accounts,
    cash in two currencies, multiple lots, ticker-less fund, missing cost
    basis, bad rows. Fixtures are synthetic only.
  - `composePositions`: linked vs CSV accounts, overrides, `SEC:` keys,
    stale `account_id`, freshness timestamps.
  - `src/sync/merge.ts`: disjoint sections merge, same-section conflict
    surfaces, offline queue replay.
  - `remoteStore` save/conflict/retry with a mocked Supabase client.
  - URL scrubbing and the analytics `beforeSend` filter.
  - `api/_lib/crypto.ts`: round-trip, tamper detection, decrypt with an older
    key version.
  - `api/_lib/auth.ts`: valid, expired, wrong issuer, wrong audience.
- **Database + API (new CI job):** local Supabase, apply migrations, run the
  `api/v1/` handlers against it with SnapTrade mocked.
  - **Role matrix:** for every table and RPC, actors non-member, viewer,
    editor, owner, and former member get exactly the access in
    `spec-households.md` R1.
  - Nobody reads `snaptrade_users`, `waitlist`, `household_invites`, or
    `rate_limits`.
  - A linked account can't be assigned to two portfolios in one household,
    but can be assigned in two households.
  - Duplicates from the same login, or spanning households, are rejected.
  - A member of one household can't detect another household's assignment of
    the same account (no rows, counts, or duplicate suggestions).
  - Concurrent `save_portfolio` with the same revision: one wins, one gets a
    conflict.
  - `replace_holdings` is atomic, and only the linker may call it.
  - An expired sync lease doesn't block a new run.
  - Deletion is idempotent and unassigns the user's accounts from shared
    households.
- **Engine:** no engine changes; the scenario suite should pass untouched.
- **Manual before each gate:**
  - Sign up from an invite, set password, magic link, password reset, TOTP.
  - Link → assign → sync → map → rebalance on desktop and phone.
  - Check the network tab and `localStorage` for secrets.
  - Check that auth emails pass SPF, DKIM, and DMARC.
  - Delete the Drift user profile and confirm the SnapTrade user is gone.
  - Before M7: the household flow in M5b's exit criteria.

---

## 10. Designed for later (out of scope here)

- **Scheduled syncs + drift alerts:** Vercel Cron calls the same sync code,
  then runs `composePositions` + `rebalance()` server-side and emails when drift
  exceeds tolerance. Uses existing tables; `sync_runs.trigger = 'cron'`.
- **Email reminders:** server-side version of the existing reminder settings.
- **MCP server (read-only):** a remote MCP endpoint whose tools
  (`get_portfolio`, `get_drift`, `get_rebalance_plan`) call the same
  server-side compose + engine. Needs:
  - OAuth for MCP clients (check Supabase's OAuth-server support at the time);
  - an explicit user opt-in;
  - a privacy rule update, because portfolio data then goes to an AI provider.
- **Viewer/adviser role** in the UI (`spec-households.md` R7).
- **Holdings history:** snapshot table for performance and drift over time.
- **Public launch:** public signup, required MFA, abuse protection, legal
  review (exploration doc Phase 3).
- **Billing (post-beta).** Deferred. Expect an **additive** migration, with
  nothing to build now.
  - Billing attaches to a household or a Drift user (decide then; both work)
    through new tables: `billing_customers` (payer, Stripe customer ID) and
    `subscriptions` (mirrored from Stripe webhooks). Entitlements derive from
    the plan.
  - Today's schema already holds what pricing is likely to depend on:
    connected Drift users per household (`brokerage_logins`) and sync volume
    (`sync_runs`).
  - Beta grandfathering can key off `profiles.created_at`.
  - The only thing needed now is the ToS line that the beta is free and may
    become paid with notice (M6).

---

## 11. Open questions

1. Which domain? Settled by the domain spike (build plan M0a).
2. ~~Invite quotas for beta users?~~ **Resolved:** beta users invite
   household members only. Everyone else comes through referral and your
   invite (D6).
3. Does SnapTrade cover workplace 401(k)s? Settled by the SnapTrade spike
   (build plan M0). If not, decide on Plaid (D20) or CSV.
4. Household open questions: `spec-households.md` §7.
5. ~~Label for signed-out mode~~ **Resolved:** **guest mode**. The landing
   page says "Continue as guest — no signup, your data stays in this
   browser." ("Incognito" was rejected: in browsers it means nothing is kept
   after you close the window, which is the opposite of guest mode.)
