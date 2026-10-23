# Spec & Implementation Plan: Account Linking (Closed Beta)

**Status:** Draft for review (revision 3: households data model and stack-review
fixes folded in) · **Target:** Appendix A of
[`plan-account-linking.md`](plan-account-linking.md) (closed beta, invited
friends & family, web-hosted) · **Background and rationale:** see that doc ·
**Household requirements:** [`spec-households.md`](spec-households.md).

This document turns the exploration into something buildable. It records the
decisions, specifies what gets built, and breaks it into PR-sized milestones
with exit criteria. `<domain>` stands for the custom domain, not yet chosen.

**Vocabulary** (defined in [`spec-households.md`](spec-households.md) §2):

| Term | Meaning |
|---|---|
| Drift account | A person's login |
| Household | A group of Drift accounts that share access to portfolios |
| Portfolio | Accounts plus one strategy (today's `AppState`) |
| Portfolio account | An `Account` inside a portfolio, which the engine rebalances |
| Brokerage login | One SnapTrade connection |
| Brokerage account | One real account inside a brokerage login |

---

## 1. Goals and non-goals

### Goals
1. A signed-in user can link brokerage logins through SnapTrade and have
   holdings sync into Drift **without CSV export/import**.
2. A portfolio syncs across devices, including phones.
3. Multi-user from day one: real auth, invite-only access, and **household**
   isolation enforced in the database. Several Drift accounts can jointly
   manage one household's portfolios.
4. The server owns synced brokerage data, so later features (scheduled syncs,
   drift alerts, LLM access) can work without a browser open.
5. Rollout in order: **you alone → you and your spouse as a household →
   invited friends & family**, with no re-architecture between steps.
6. **Local-only mode keeps working** exactly as today for anyone who doesn't
   sign in.

### Non-goals (this spec)
- Trading or any write action against a brokerage. Holdings are **read-only**.
- Public signup, billing, or charging money.
- Scheduled server syncs, drift alerts, email reminders, and the MCP server.
  These are planned follow-ups (§10); the design must keep them easy.
- The read-only viewer/adviser role in the UI (the schema supports it; see
  `spec-households.md` R7).
- Native mobile apps. "Mobile" means the existing web app working well on a
  phone browser.
- Users outside the US (no GDPR program yet).

---

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Data + auth | **Supabase**: Postgres, Supabase Auth, Row-Level Security (RLS). Auth and the database are one system, so RLS enforces household isolation in the database itself. Standard Postgres keeps data portable. Open source and self-hostable |
| D2 | Server code | **Vercel Functions** in `api/`: same project, repo, CI, and preview deploys as today. Vercel Cron available for later scheduled jobs. Function region co-located with the Supabase region |
| D3 | Aggregator | **SnapTrade**, Commercial key. Free tier (5 connected users) during the personal phase, pay-as-you-go (~$2 per connected Drift account/month) after. The Personal key is used only for the throwaway spike. **Conditional on M0 showing workplace 401(k) coverage**; see D20 |
| D4 | Brokerage access | Read-only holdings, balances, and positions. No trading endpoints are called, and the code must not include them |
| D5 | Login | **Email + password, plus magic link** (Supabase Auth). Password reset by email. **TOTP MFA available as an opt-in during the beta** (free in Supabase, and expected by the FTC Safeguards Rule; exploration §8). Required MFA is a public-launch decision |
| D6 | Invite gating | Public signups disabled in Supabase. Users are invited by email, either by you from the waitlist or by a household owner into their household (`spec-households.md` R2). The invite link lets them set a password. Non-invited visitors can join a **waitlist** |
| D7 | Who writes what | **One writer per column.** The server alone writes synced brokerage data (`brokerage_logins`, `brokerage_accounts`, `holdings`, `sync_runs`). Users write their decisions (portfolio state, account assignments, owner labels), always through the database functions in §4.3 that check household role. No table row has two writers |
| D8 | Composing positions | A shared **pure** function combines a portfolio's `AppState` with its assigned holdings into the engine's `Position[]`. Runs in the browser now; importable by server code for later features |
| D9 | Engine location | Browser for the interactive loop, unchanged. Server code must be able to import it (it's already pure) for scheduled syncs and MCP later |
| D10 | Secrets at rest | SnapTrade `userSecret` encrypted at the application level (AES-256-GCM) with a **versioned keyring** (`TOKEN_ENC_KEYS`), so the key can be rotated. Holdings stay plain rows, protected by RLS and Supabase's disk encryption, so they remain queryable. Threat model in §8 |
| D11 | Outgoing email | **Resend** as Supabase Auth's custom SMTP and for app email. SPF, DKIM, and DMARC on `<domain>`. **No portfolio data in any email**; open/click tracking off |
| D12 | Incoming email | **Cloudflare Email Routing** forwards `support@<domain>` to your inbox (free). Upgrade to a real mailbox if replying as support becomes awkward |
| D13 | Domain & DNS | Custom `<domain>` with DNS on Cloudflare; app served by Vercel. Records pointing at Vercel are **DNS-only** (Cloudflare proxy off). Auth emails link to `<domain>`, not `supabase.co` |
| D14 | LLM readiness | No MCP in the beta. Versioned server API (`/api/v1/…`), server-owned holdings, and server-importable compose/engine make a read-only MCP server a thin layer later. A client-side "Copy summary for AI" ships in the beta |
| D15 | Budget ceiling | $0/mo during the personal phase (plus domain ~$1/mo); up to ~$100/mo during the beta |
| D16 | Households | Access is granted per **household** (owner / editor / viewer). A Drift account can belong to several households. A hard privacy boundary means a separate household under the same Drift account. Mine/hers/joint is a label, never an access boundary. Requirements: `spec-households.md` |
| D17 | Supabase keys & tokens | Use the **new API keys** (`sb_publishable_…` in the browser, `sb_secret_…` on the server) and **asymmetric JWT signing keys** from day one. The legacy `anon`/`service_role` keys are being retired and can't be rotated. Functions verify access tokens locally against the project's JWKS (`jose`) |
| D18 | Least privilege on the server | Functions act **as the user** (a Supabase client carrying the caller's token, so RLS applies). The secret key is used only for `snaptrade_users`, `waitlist`, rate limits, and account deletion |
| D19 | Environments | Two Supabase projects: **staging** (local dev and Vercel preview deploys) and **production** (production deploys only). Preview URLs are allowed as auth redirects in staging only. Real brokerage data only in production |
| D20 | Aggregator fallback | **Plaid Investments** is the named second adapter, triggered if M0 shows SnapTrade can't read your workplace 401(k) (Empower, Fidelity NetBenefits). The pure-adapter design (§6.1) keeps this to a new adapter plus server routes. Until then, uncovered accounts stay on CSV |
| D21 | Error monitoring | **Sentry for `api/` only**, with `sendDefaultPii: false`, no request or response bodies, and a `beforeSend` that keeps only route, status, error type, and stack. No client-side SDK in the beta |

---

## 3. Architecture

```
Browser (existing SPA)
 ├─ Local-only mode: unchanged, localStorage only
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
| `name` | `text` not null | e.g. "Ryan & Partner", "Ryan (private)" |
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

#### `household_invites` (server-only)
`id`, `household_id`, `email` citext, `role`, `token_hash` (SHA-256),
`expires_at` (default 7 days), `invited_by`, `accepted_at`, `revoked_at`.
RLS with no policies. Owners list pending invites through `api/v1/`.

#### `household_people`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` → `households(id)` on delete cascade | |
| `name` | `text` not null | "Ryan", "Partner", "Kid" |
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
| `household_id` | `uuid` not null → `households(id)` on delete cascade | Indexed |
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

#### `brokerage_accounts` — one row per real account (server-written)
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

#### `account_assignments` — which portfolio a brokerage account feeds (user-written)
| Column | Type | Notes |
|---|---|---|
| `brokerage_account_id` | `text` **PK** → `brokerage_accounts(id)` on delete cascade | PK enforces **at most one portfolio** |
| `portfolio_id` | `uuid` not null → `portfolios(id)` on delete cascade | |
| `portfolio_account_id` | `text` null | The `Account.id` inside that portfolio's `AppState` that this feeds; null until mapped |
| `owner_person_ids` | `uuid[]` not null default `{}` | Owner labels (`household_people`); several ids means joint |
| `assigned_by` / `assigned_at` | | |

RLS: select if any role in the portfolio's household. Writes only through
`assign_account`, `move_account`, `unassign_account`, `map_account`, and
`save_portfolio`.
- Only the linker can assign an account into a household or unassign it.
- Any editor can move an account between portfolios of the same household,
  map it, or change its owner labels.
- A move clears `portfolio_account_id`. A move across households also clears
  `owner_person_ids`.

Whether several brokerage accounts may map to one portfolio account is an open
general import question, tracked in
[#234](https://github.com/rblumen/drift/issues/234). Linking follows whatever
that issue decides for CSV import.

#### `account_duplicates`
| Column | Type | Notes |
|---|---|---|
| `brokerage_account_id` | `text` → `brokerage_accounts(id)` on delete cascade | PK part; the duplicate |
| `duplicate_of` | `text` → `brokerage_accounts(id)` on delete cascade | PK part; the primary |
| `status` | `text` not null | `suggested`, `confirmed`, `rejected` |
| `decided_by` / `decided_at` | | |

Detection rules are in `spec-households.md` R5:
- Candidates must come from **different brokerage logins** (enforced by a
  trigger).
- A match needs the same institution and the same mask.
- `confirmed` duplicates can't be assigned and are excluded from composition.

RLS: select by any household member who can see both accounts. Decisions go
through `api/v1/`.

#### `holdings` — current positions per brokerage account (server-written)
| Column | Type | Notes |
|---|---|---|
| `brokerage_account_id` | `text` not null → `brokerage_accounts(id)` on delete cascade | PK part |
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
  `referral_code`, `created_at`, `invited_at`.
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
| `save_portfolio(portfolio_id, seen_revision, state, mappings jsonb)` | editor+ | Updates `state` only if `revision = seen_revision`, applies mapping changes (`portfolio_account_id` per brokerage account), sets `updated_by`, increments revision. Returns the new revision, or a conflict carrying the current row. Creating a portfolio account and mapping to it are one call, so no mapping is orphaned |
| `assign_account(brokerage_account_id, portfolio_id, owner_person_ids)` / `unassign_account(…)` | linker, editor+ in target | |
| `move_account(brokerage_account_id, portfolio_id)` | editor+ (same household) or linker | |
| `replace_holdings(brokerage_account_id, rows jsonb, as_of)` | server (user's token) | Checks the caller is the linker. Deletes the account's holdings and inserts the new set in one transaction |
| `begin_sync(trigger, portfolio_id)` / `finish_sync(run_id, …)` | server (user's token) | Returns an existing unexpired `running` run instead of starting another |

`composePositions` treats a `portfolio_account_id` that no longer exists in
`AppState` as unmapped. The account reappears in the mapping UI and isn't
dropped silently.

### 4.4 `AppState` changes
None to the schema version. All of these are optional with defaults:

```ts
// Per-position overrides on linked accounts (synced positions aren't in AppState.positions).
linkedPositionOverrides: z.record(z.string(), z.object({ locked: z.boolean() }))
  .optional().default({}),
  // key: `${portfolioAccountId}:${tickerOrSecKey}`
// Owner labels for CSV/manual portfolio accounts (linked ones use account_assignments).
// On accountSchema:
ownerPersonIds: z.array(z.string()).optional(),
// Local-only mode's list of people; signed-in mode uses household_people.
people: z.array(z.object({ id: z.string(), name: z.string() })).optional().default([]),
```

### 4.5 Composing positions: `src/ingest/compose.ts`
```ts
export function composePositions(
  state: AppState,
  linked: LinkedHolding[],   // the portfolio's assigned holdings (confirmed duplicates
                             // excluded), joined with portfolio_account_id
): Position[]
```
- A portfolio account with linked brokerage accounts takes its positions
  **only** from their `holdings`. `AppState.positions` rows for that account
  are ignored. Behavior when several brokerage accounts map to one portfolio
  account follows #234.
- Other accounts use `AppState.positions` (CSV/manual), as today.
- `lastUpdatedAt` = the holding's `as_of`, so the existing freshness indicator
  (`src/ingest/freshness.ts`) shows real sync times.
- Ticker-less holdings use `SEC:<security_id>` (§4.2).
- `linkedPositionOverrides` applies `locked`.
- Pure, no React or Supabase imports, unit-tested; importable by server code.

---

## 5. Client behavior

### 5.1 Landing page and sign-in
- The landing page (`src/ui/LandingPage.tsx`) keeps "Use Drift without an
  account" as today and adds **Sign in**.
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
- Settings → Security: enable/disable an authenticator app (TOTP).

### 5.2 Waitlist
- `POST /api/v1/waitlist` stores the email.
  - Duplicate emails succeed silently (no account-existence leak).
  - Spam protection: a hidden honeypot field and a per-IP rate limit
    (`rate_limits` table). Add Cloudflare Turnstile only if spam shows up.
- No confirmation email in the beta, so nothing to send or track.
- You invite from the waitlist through an admin script that sets
  `invited_at`. The admin view lists referred signups first.

### 5.2a Referrals (M7, once beta users exist)
- Each signed-in user sees a personal link, `https://<domain>/join?ref=<code>`,
  under Settings → "Invite a friend."
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
- A new Drift account gets a personal household with one empty portfolio.
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
2. **Assign:** each new brokerage account starts unassigned and is visible only
   to the linker. For each one, the user picks a portfolio (any household they
   edit), sets owner labels (default: themselves), or leaves it unassigned.
3. **Sync now:** call `POST /api/v1/snaptrade/sync`. The server stores holdings
   and returns the updated accounts and holdings, so the panel updates without
   a second request.
4. **Mapping:** any assigned account with no `portfolio_account_id` goes
   through the existing "Map accounts" UI. Options are an existing portfolio
   account, or "Create a new account" (pre-filled with institution and name;
   the user confirms the account type). Saved through `save_portfolio`, so
   creating and mapping are atomic. Later syncs need no mapping.
5. **Duplicates:** when a suggested duplicate exists, show "Schwab ••1234
   linked by <name> looks like this one. Same account?" (`spec-households.md`
   R5).
6. **Auto-sync on open:** if signed in and the oldest `last_synced_at` among
   the user's own logins is over 12 hours old, sync once in the background.
7. **Connection list:** the user's brokerage logins with status ("needs
   re-authentication" with a Reconnect action) and Remove. Other members'
   broken logins show "needs reconnection by <name>" with no actions.

CSV import stays available for accounts SnapTrade doesn't cover. Accounts with
a linked brokerage account show "Synced" instead of CSV import.

### 5.6 Households and portfolios
Portfolio switcher, household settings (members, invite form with role
dropdown defaulting to owner, leave/remove, copy portfolio), and owner
filters. Full requirements: `spec-households.md` R1–R8. Built in M5b.

### 5.7 "Copy summary for AI"
A Results-tab button that copies a plain-text summary (allocation vs targets,
drift, suggested trades) to the clipboard. Built next to
`src/ui/exportReport.ts`. Works in local-only and signed-in modes; nothing is
sent anywhere by Drift.

### 5.8 Account deletion
Settings gets "Delete my Drift account." `DELETE /api/v1/account`:
1. deletes the SnapTrade user, which removes all brokerage connections and
   stops billing;
2. removes the user's memberships, so their brokerage accounts leave every
   portfolio;
3. deletes households where they were the only member;
4. deletes the Supabase auth user, which cascades their remaining rows.

**Idempotent and retried.**
- If the SnapTrade call fails, the request fails and nothing else is deleted,
  so the user can retry.
- A pending-deletion flag records the attempt. A daily job retries flagged
  deletions, so no account stays half-deleted and SnapTrade doesn't keep
  billing.

`localStorage` is untouched.

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
| `POST /snaptrade/sync` | `begin_sync`; list the caller's logins and accounts; fetch holdings/balances (accounts in parallel, max 4 at a time); normalize (§6.1); upsert `brokerage_logins`/`brokerage_accounts` (server-written columns only); `replace_holdings` per account; refresh duplicate suggestions; `finish_sync`. Return `{ accounts, holdings, run }`. If the time budget (§6.2) runs out, finish as `partial`; the next run picks up the rest |
| `GET /snaptrade/connections` | The caller's brokerage logins with status |
| `DELETE /snaptrade/connections/:id` | Remove a login at SnapTrade, then delete its rows (cascades accounts, assignments, holdings) |
| `POST /households/:id/invites` | Owner only. Create invite (hashed token), send email. Body: `email`, `role` |
| `DELETE /households/:id/invites/:inviteId` | Owner only. Revoke |
| `POST /invites/accept` | Body: token. Validates, adds membership, admits to the beta if the user is new |
| `PATCH /households/:id/members/:userId` | Owner only. Change role (not the last owner) |
| `DELETE /households/:id/members/:userId` | Owner, or self (leave). Unassigns the member's brokerage accounts |
| `POST /portfolios/:id/copy` | Copy a portfolio's state into a household the caller edits |
| `POST /duplicates/decide` | Confirm or reject a duplicate suggestion |
| `DELETE /account` | Full deletion (§5.8) |
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
): { logins: BrokerageLoginRow[]; accounts: BrokerageAccountRow[];
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
| Support | Inbound to `support@<domain>` | Cloudflare Email Routing → your inbox |

DNS (Cloudflare):
- SPF and DKIM for Resend.
- DMARC starting at `p=none` with reports.
- MX for Cloudflare Email Routing.
- Sending from a subdomain (`mail.<domain>`) keeps app email reputation
  separate from support mail.

Check Supabase Auth's per-hour email rate limit with custom SMTP during M3, and
raise it if needed.

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
| Logs and errors | No bodies, emails, or amounts. Sentry on `api/` only, scrubbed (D21) |
| Environments | Real data only in the production Supabase project; previews use staging (D19) |
| Cost hygiene | `snaptrade_users.last_active_at`. An admin script lists or deletes SnapTrade users inactive for 60+ days (with notice), since each connected user is billed until deleted |
| Light beta posture | Privacy notice (accounts, households and sharing with members, waitlist, SnapTrade, email) and short ToS; US-only; free; breach-response note in `docs/` |

---

## 9. Testing

- **Unit (Vitest):**
  - `normalizeSnapTrade` with synthetic fixtures: several logins and accounts,
    cash in two currencies, multiple lots, ticker-less fund, missing cost
    basis, bad rows. Fixtures are synthetic only.
  - `composePositions`: linked vs CSV accounts, overrides, `SEC:` keys,
    excluded duplicates, stale `portfolio_account_id`, freshness timestamps.
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
  - A brokerage account can't be assigned to two portfolios.
  - Duplicates from the same login are rejected.
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
  - Delete the account and confirm the SnapTrade user is gone.
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
- **Public launch:** required MFA, abuse protection, legal review (exploration
  doc Phase 3).

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
  - Cloudflare Registrar supports the TLD;
  - `.app` and `.dev` force HTTPS (HSTS-preloaded), which is fine since Vercel
    serves HTTPS;
  - a USPTO trademark search for conflicts in finance/software;
  - an existing site, company, or app with a confusingly similar name;
  - matching social handles, if you'll want them for recruiting beta users.
- Register at Cloudflare Registrar (at-cost pricing; DNS needs to be on
  Cloudflare anyway for D12/D13). Enable auto-renew and registrar lock.
- **Exit:** domain registered; `<domain>` filled in throughout this spec.

### M0 — Spike (throwaway; not merged)
- SnapTrade **Personal** key, local script under `/private/` (git-ignored).
  Fetch your real holdings, hand-normalize, run `rebalance()`, and compare with
  a CSV import.
- **Pass/fail criteria, each recorded:**
  1. Schwab brokerage and IRA accounts: holdings, cash, cost basis.
  2. Fidelity brokerage/IRA accounts.
  3. **Empower workplace 401(k)** (recordkeeping, not Empower Personal
     Dashboard).
  4. **Fidelity NetBenefits** 401(k), if applicable.
  5. How ticker-less funds (collective trusts) come through: security ID,
     CUSIP, description.
  6. Whether any of your institutions must be enabled per developer account
     (search results mention ~2 business days), and the lead time.
- Read SnapTrade's developer terms and Commercial agreement for storage,
  display, and consent requirements.
- **Exit:** a coverage table. If 3 or 4 fails, decide: CSV for those accounts
  in the beta, or a Plaid Investments spike (D20) before M5.

### M1 — Guardrails and docs update
- Amend `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, and `README.md`:
  - *local-only mode sends nothing;*
  - *signed-in mode stores the user's portfolios, linked holdings, and
    SnapTrade credentials server-side, encrypted where sensitive;*
  - *data is visible only to members of the household it's assigned to.*
- **Changes rules `CLAUDE.md` calls inviolable: needs your explicit sign-off.
  No backend code merges before it.**
- **Exit:** docs merged; CHANGELOG notes the policy change.

### M2 — Pure modules
- `src/ingest/adapters/snaptrade.ts`, `src/ingest/compose.ts`,
  `src/sync/merge.ts`, synthetic fixtures, tests.
- Add `linkedPositionOverrides`, `Account.ownerPersonIds`, and `people` to
  `appStateSchema`.
- Owner labels and filter in the UI. This works in local-only mode.
- **Exit:** tests green; local-only behavior unchanged apart from the optional
  owner labels.

### M3 — Domain, email, backend foundation
- Cloudflare DNS for `<domain>` (DNS-only records to Vercel).
- Resend account; SPF/DKIM/DMARC; Supabase custom SMTP and its rate limit;
  custom auth templates.
- `support@<domain>` via Cloudflare Email Routing.
- Supabase **staging** and **production** projects, in the same region as the
  Vercel functions.
  - New API keys and asymmetric JWT signing keys.
  - Public signups disabled.
  - Preview-URL redirects allowed in staging only.
- `supabase/migrations/`: every §4 table, `private.household_role`, all §4.3
  RPCs, RLS. Each Drift account gets a personal household; only the owner role
  is used yet.
- `api/v1/` scaffolding:
  - `_lib/` helpers (JWKS auth, user-scoped client, admin client, crypto
    keyring, rate limit, Sentry);
  - `GET /health`.
- Vercel env vars per environment. CSP update. `vercel.json` rewrite excludes
  `api/`. Daily Vercel Cron ping to `/health` keeps the free-tier database from
  pausing.
- Confirm the Vercel plan's function duration limit.
- CI: database + API role-matrix job; `dist/` secret scan; secret-key import
  check.
- **Exit:**
  - role-matrix tests pass;
  - a test auth email lands in the inbox with SPF/DKIM/DMARC passing;
  - mail to support@ arrives;
  - a preview deploy talks to staging, not production.

### M4 — Sign-in and cross-device sync
- `src/sync/`.
- Sign-in UI: landing-page Sign in; sign-in page with closed-beta message,
  password, magic link, forgot password; set-password page; optional TOTP
  enrollment.
- Waitlist form and `POST /api/v1/waitlist`.
- URL scrubbing; analytics `beforeSend`.
- Remote save/load via `save_portfolio` with section merge; Realtime refresh;
  local upload on first sign-in; "Not synced" badge.
- **Exit:**
  - a portfolio edited on desktop shows up on a phone;
  - a forced conflict merges disjoint edits and asks on overlapping ones;
  - local-only mode unchanged (existing app tests pass);
  - waitlist entries arrive.
- Useful on its own: cross-device Drift with CSV import.

### M5 — Linking
- `api/v1/snaptrade/*` with sync leases, the time budget, and `sync_runs`
  logging.
- Positions tab "Linked accounts": connect, assign, sync, mapping, auto-sync on
  open, connection list, reconnect.
- Engine input switches to `composePositions(state, linked)`.
- **Exit:**
  - link → assign → sync → map → rebalance works end to end;
  - a second sync needs no mapping;
  - a broken connection shows "needs re-authentication";
  - holdings are in the database after a sync even if the browser is closed
    right after;
  - a killed sync doesn't block the next one past its lease.

### M6 — Deletion, notices, copy, AI summary
- `DELETE /api/v1/account` (idempotent, retried) and the Settings control.
- SnapTrade inactive-user admin script.
- Privacy notice (including sharing with household members) and ToS; landing
  and README copy so "no account required" describes local-only mode
  accurately.
- "Copy summary for AI" button.
- Breach-response note in `docs/`, including the encryption-key rotation
  procedure.
- **Exit:**
  - account deletion removes the auth user, all of the user's rows, their
    shares, and the SnapTrade user;
  - a forced SnapTrade failure leaves the account intact and retryable.

### Gate 1 — Personal phase (you only)
Only your email invited. Use it for a few weeks on desktop and phone. Cost
about $0 plus the domain. Check `sync_runs` and Sentry for errors and call
volume.

### M5b — Households (`spec-households.md`)
- Multiple households and portfolios with a switcher.
- Household settings: member list, invites with a role dropdown (owner
  default, editor), revoke, leave/remove, last-owner guard, copy portfolio.
- Invite endpoints and emails; beta admission via household invite.
- Moving accounts between portfolios and households.
- Owner labels on linked accounts (`household_people`, `owner_person_ids`).
- Duplicate detection and the confirm/reject prompt.
- "Last edited by"; `household_events` view.
- **Exit:** you and your spouse each link your own logins into one shared
  household, confirm the joint account as one, and both edit "Ours" from
  separate devices. Your private portfolio stays in your personal household,
  invisible to your spouse.

### M7 — Open the closed beta
- Supabase Pro on production (backups, no pausing); Vercel Pro if hosting must
  be commercial-safe.
- Invite from the waitlist; SnapTrade pay-as-you-go after 5 connected users.
- Referrals (§5.2a): `referral_codes` table, "Invite a friend" link,
  `/join?ref=` handling, referred-first ordering in the admin view.
- Confirm a database backup restores.
- **Exit:** invited users can sign up, link, and sync; costs track the
  ~$45–95/mo estimate (about $2 per Drift account that links, so about $4 per
  two-linker household).

### Gate 2 — Beta review
Decide among: stay closed, build §10 features (scheduled sync, alerts, MCP,
adviser role), or start public-launch work.

---

## 12. Open questions

1. Which domain? Settled by the M0a spike.
2. Should beta users get a small quota of **non-household** invites, or does
   every non-household invite stay with you? (Household invites are always
   allowed.)
3. Does SnapTrade cover your workplace 401(k)? Settled by M0. If not, decide
   on Plaid (D20) or CSV.
4. Household open questions: `spec-households.md` §7.
