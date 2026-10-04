# Spec & Implementation Plan: Account Linking (Closed Beta)

**Status:** Draft for review · **Target:** Appendix A of
[`plan-account-linking.md`](plan-account-linking.md) (closed beta, invited
friends & family, web-hosted) · **Background and rationale:** see that doc.

This document turns the exploration into something buildable. It records the
decisions, specifies what gets built, and breaks it into PR-sized milestones
with exit criteria.

---

## 1. Goals and non-goals

### Goals
1. A signed-in user can link brokerage accounts through SnapTrade and pull
   current holdings into Drift **without CSV export/import**.
2. A signed-in user's portfolio (the whole `AppState`) syncs across devices,
   including phones.
3. Multi-user from day one: real auth, invite-only access, and per-user
   isolation enforced in the database.
4. Rollout in order: **you alone on the multi-user stack → invited friends &
   family**, with no re-architecture between the two.
5. **Local-only mode keeps working** exactly as today for anyone who doesn't
   sign in.

### Non-goals (this spec)
- Trading or any write action against a brokerage. Holdings are **read-only**.
- Public signup, billing, or charging money.
- Server-side scheduled syncs, drift alerts, and push notifications. These are
  planned follow-ups (§9); the design keeps them possible.
- Native mobile apps. "Mobile" means the existing web app working well on a
  phone browser.
- Users outside the US (no GDPR program yet).

---

## 2. Decisions

These settle the open decisions from the exploration doc. Each can be revisited,
but the plan below assumes them.

| # | Decision | Choice |
|---|---|---|
| D1 | Stack | **Supabase** (Postgres + Auth + Row-Level Security) for data and auth; **Vercel Functions** (`api/`) for server code; same Vercel project as today |
| D2 | Aggregator | **SnapTrade**, Commercial key. Free tier (5 connections) during the personal phase, pay-as-you-go (~$2/connected user/month) once the beta exceeds it. The Personal key is used only for the throwaway spike |
| D3 | Brokerage access | Read-only holdings, balances, and positions. No trading endpoints are called, and the code must not include them |
| D4 | Local-only mode | Stays as the default, no-account way to use Drift |
| D5 | Login method | Email magic link via Supabase Auth (no passwords). TOTP MFA is deferred to a public launch |
| D6 | Invite gating | Public signups disabled in Supabase. Users are invited by email from the Supabase dashboard or an admin script |
| D7 | Who writes `AppState` | **Only the client.** The server returns normalized sync results; the browser merges them through the existing import path and saves. This keeps one writer and avoids server/client merge conflicts. Server-side writes arrive with scheduled sync (§9) |
| D8 | Engine location | Client-side, unchanged. Not run on the server in this spec |
| D9 | Secrets at rest | SnapTrade `userSecret` encrypted at the application level (AES-256-GCM, key in a Vercel env var), on top of Supabase's disk encryption |
| D10 | Budget ceiling | $0/mo during the personal phase; up to ~$100/mo during the beta (exploration doc §9) |

---

## 3. Architecture

```
Browser (existing SPA)
 ├─ Local-only mode: unchanged, localStorage only
 └─ Signed-in mode:
     ├─ Supabase JS client ── reads/writes own `portfolios` row (RLS-protected)
     ├─ fetch /api/* with the Supabase access token
     └─ runs rebalance() locally, as today
            │
Vercel Functions (api/)
 ├─ verify the Supabase JWT on every request
 ├─ SnapTrade calls with the server-only consumer key
 ├─ read/write `snaptrade_users` with the service-role key
 └─ normalize holdings → MultiAccountResult (shared pure adapter)
            │
Supabase Postgres                     SnapTrade API
 ├─ portfolios (RLS: own row only)     ├─ registerUser / deleteUser
 └─ snaptrade_users (no client access) ├─ connection portal login link
                                       ├─ list accounts, holdings
                                       └─ list/remove authorizations
```

**Why the client talks to Supabase directly for portfolio data:** RLS already
limits each user to their own row, so a portfolio read/write API would add code
without adding protection. Only SnapTrade calls go through `api/`, because they
need the secret consumer key and the encrypted `userSecret`.

---

## 4. Data model

SQL lives in `supabase/migrations/` and is applied with the Supabase CLI.

### `portfolios` — one `AppState` per user
| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK, FK → `auth.users(id)` on delete cascade | |
| `state` | `jsonb` not null | The same `AppState` that `appStateSchema` validates today |
| `schema_version` | `int` not null | Mirrors `AppState.version` (currently `1`) |
| `revision` | `bigint` not null default 0 | Incremented on every save; used for conflict detection |
| `updated_at` | `timestamptz` not null default `now()` | |

RLS: `select`, `insert`, `update`, `delete` allowed only where
`user_id = auth.uid()`.

Saves use optimistic concurrency: the client sends the `revision` it last saw,
and the update only applies when it still matches
(`update … where user_id = auth.uid() and revision = $seen`). A zero-row result
means another device saved first (§5.3).

### `snaptrade_users` — SnapTrade credentials, server-only
| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK, FK → `auth.users(id)` on delete cascade | |
| `snaptrade_user_id` | `text` not null unique | Random ID we generate; never the user's email |
| `user_secret_enc` | `text` not null | AES-256-GCM ciphertext (base64 of iv + ciphertext + tag) |
| `created_at` | `timestamptz` not null default `now()` | |

RLS enabled with **no policies**, so the browser can't read or write it at all.
Only the service-role key in `api/` can.

### `AppState` addition: `brokerLinks`
Add one optional field to `appStateSchema` in `src/ingest/schema.ts`:

```ts
brokerLinks: z.record(z.string(), z.string()).optional().default({}),
// SnapTrade account id → Drift Account.id
```

This remembers which SnapTrade account feeds which Drift account so later syncs
map automatically. It holds IDs only, never credentials, so it's safe in
`localStorage` and JSON exports. As an optional field with a default, it doesn't
need a schema version bump, which matches how `reminder` and `decompositions`
were added.

No table stores connections or holdings. Connection status comes live from
SnapTrade, and holdings only live in `AppState.positions`, as today.

---

## 5. Client behavior

### 5.1 Modes and sign-in
- With no session, the app behaves exactly as today (local-only).
- A "Sign in (beta)" entry point opens an email form. Supabase sends a magic
  link. The callback uses the PKCE flow (`?code=…`), which the app exchanges
  for a session and then **strips from the URL**, the same way `?demo` is
  stripped today. That keeps auth codes away from analytics (see §7).
- Signed-in state shows the user's email and a "Sign out" control.

### 5.2 First sign-in: migrating local data
On the first sign-in on a device:
- If the user has no `portfolios` row and `localStorage` has a portfolio, offer
  "Upload this browser's portfolio to your account." It goes through
  `appStateSchema.safeParse`, the same path as `loadJson`.
- If a remote row exists, it wins. If local data also exists and differs, ask
  before overwriting the local copy, and keep a local backup either way
  (reuse `saveBackup`).

### 5.3 Saving and conflicts
- The existing autosave effect in `src/App.tsx` (which calls `saveState`)
  keeps writing `localStorage` as an offline cache. When signed in, it also
  schedules a remote save, debounced about 1.5 seconds.
- On a revision conflict, the client reloads the remote state and shows "This
  portfolio was updated on another device. Loaded the latest version." Edits
  are coarse and infrequent, so last-writer-wins with a reload is enough; no
  field-level merging.
- When offline, saves queue and retry. The UI shows a small "Not synced" badge
  until a save succeeds.

New module: `src/sync/` (`supabaseClient.ts`, `remoteStore.ts`, `api.ts`).
`src/store.ts` keeps its local-only promise ("this module never makes network
calls") because the network code lives in `src/sync/`, not in `store.ts`.

### 5.4 Linking and syncing (Positions panel)
A new "Linked accounts" source in `src/ui/PositionsPanel.tsx`:
1. **Connect a brokerage:** calls `POST /api/snaptrade/connect`, then opens the
   returned SnapTrade connection portal URL in a new window or tab. When the
   user returns, the panel refreshes the connection list.
2. **Sync now:** calls `POST /api/snaptrade/sync`, which returns a
   `MultiAccountResult`. Accounts already in `brokerLinks` map automatically.
   New ones go through the existing "Map accounts" UI, and the user's choices
   are saved into `brokerLinks`. Positions merge through the same
   `mergePositions` + `lastUpdatedAt` stamping used by `confirmMultiImport`.
3. **Auto-sync on open:** if signed in and the newest linked position is older
   than 12 hours, sync once in the background.
4. **Connection list:** shows each brokerage, its status (including "needs
   re-authentication"), and a Remove action.

CSV import stays available next to linked accounts for any brokerage SnapTrade
doesn't cover.

### 5.5 Account deletion
Settings gets a "Delete my account" control. It calls `DELETE /api/account`,
which removes the SnapTrade user (and with it all their brokerage
authorizations), deletes the database rows, and deletes the Supabase auth user.
`localStorage` is left alone, so the user can keep using local-only mode.

---

## 6. Server API (`api/`)

All endpoints:
- require `Authorization: Bearer <Supabase access token>` and verify it
  server-side; the user ID comes from the verified token, never from the request
  body;
- return JSON; never return SnapTrade secrets, consumer keys, or raw tokens;
- never log request or response bodies (they contain holdings and dollar
  amounts). Log only route, status, duration, and an internal user ID.

| Endpoint | Behavior |
|---|---|
| `POST /api/snaptrade/connect` | Ensure the user has a `snaptrade_users` row (call `registerUser` and store the encrypted secret if not). Return `{ url }`, a SnapTrade connection portal login link, configured for **read-only** connections |
| `POST /api/snaptrade/sync` | List the user's SnapTrade accounts and fetch holdings and balances for each. Normalize with the shared adapter (§6.1). Return `MultiAccountResult` |
| `GET /api/snaptrade/connections` | List brokerage authorizations: `{ id, brokerage, status, accounts: [{ id, name, mask }] }` |
| `DELETE /api/snaptrade/connections/:id` | Remove one brokerage authorization |
| `DELETE /api/account` | Full deletion, as in §5.5 |

Shared server helpers in `api/_lib/`: `auth.ts` (JWT verification),
`supabaseAdmin.ts` (service-role client), `snaptrade.ts` (SDK client),
`crypto.ts` (AES-GCM encrypt/decrypt of `userSecret`).

### 6.1 Normalization: `src/ingest/adapters/snaptrade.ts`
A pure function that replaces the empty `plaid.ts` stub as the first real
aggregator adapter:

```ts
export function normalizeSnapTrade(
  accounts: SnapTradeAccountHoldings[],
): MultiAccountResult
```

- `SnapTradeAccountHoldings` is a **minimal local type** describing only the
  fields used, so `src/` doesn't depend on the SnapTrade SDK.
- Each SnapTrade account becomes a `DiscoveredAccount`. `accountNumber` is the
  SnapTrade account ID; `accountName` is the institution name plus the masked
  number.
- Each position becomes a `Position`: ticker from the symbol, `marketValue` =
  units × price, `price`, `description`, and `costBasis` = average purchase
  price × units when present.
- Cash balances become a synthetic ticker that classifies as CASH, the same
  approach the CSV adapters' `cashRow` option uses (#54).
- Rows that fail `positionSchema.safeParse` go into `errors`, like the CSV
  adapters.
- Asset classification is unchanged: unknown tickers flow through
  `tickerOverrides` / `decompositions` and the Classify tab as today.

The exact SnapTrade field names are confirmed during the spike (M0) before this
is written.

---

## 7. Security and privacy requirements

| Requirement | How |
|---|---|
| Per-user isolation | RLS on every user-data table; tested with two real users (§8) |
| Secrets never reach the browser | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are `VITE_`-prefixed. CI fails if the built `dist/` contains any server secret name or value pattern |
| `userSecret` at rest | AES-256-GCM with `TOKEN_ENC_KEY`; random IV per encryption |
| No trading | The SnapTrade connection portal is requested read-only; no trade endpoints are imported. A test greps `api/` for trading calls |
| CSP | `connect-src 'self' https://<project>.supabase.co`. Everything else unchanged. The SnapTrade portal opens as a top-level navigation, so it doesn't need a CSP entry; `form-action 'none'` and `frame-ancestors 'none'` stay |
| Analytics stays page-only | The URL is scrubbed after the auth callback, and `<Analytics>` gets a `beforeSend` that drops all query strings and hashes. Signed-in pages still report the path `/` only |
| No PII in logs | Server logs carry no bodies, emails, or dollar amounts. Third-party error monitoring is **not** added in this spec; if added later, it must scrub payloads |
| Light beta posture (exploration doc §8) | Privacy notice and short ToS pages; US-only beta; free; breach-response note in `docs/` |

---

## 8. Testing

- **Unit (Vitest, existing suite):**
  - `normalizeSnapTrade` with synthetic fixtures (multiple accounts, cash,
    missing cost basis, invalid rows). Fixtures are synthetic only, as the repo
    rules require.
  - `remoteStore` save/conflict/retry logic with a mocked Supabase client.
  - `brokerLinks` auto-mapping in the Positions panel.
  - URL scrubbing and the analytics `beforeSend` filter.
  - `api/_lib/crypto.ts` round-trip and tamper detection.
  - `api/` handlers with mocked SnapTrade and Supabase: missing or invalid token
    → 401; a user can only touch their own data.
- **Database (new CI job):** start local Supabase in CI, apply migrations,
  create two users, and assert user A can't read or write user B's
  `portfolios` row, and neither user can read `snaptrade_users`.
- **Engine:** no engine changes, so the scenario suite should pass untouched.
  If sync output ever changes engine-visible behavior, add a regression
  scenario per the repo's test rules.
- **Manual before each rollout gate:** link → sync → map → rebalance on a
  desktop and a phone; check the browser's network tab and `localStorage` for
  any secrets; delete the account and confirm the SnapTrade user is gone.

---

## 9. Out of scope, designed for later

- **Scheduled server sync + drift alerts:** a Vercel Cron job runs the same
  adapter, runs `rebalance()` server-side (the engine is pure, so it ports
  as-is), and emails when drift exceeds tolerance. This is where D7 changes:
  the server becomes a second writer of `AppState`, and the revision column
  already supports that.
- TOTP MFA, rate limiting, abuse protection, legal review, public signup: the
  exploration doc's Phase 3.
- Additional aggregators: a second adapter next to `snaptrade.ts`.

---

## 10. Implementation plan

Each milestone is one PR to `main` on a `feat/<issue>-…` branch, per
`CLAUDE.md`. Issue numbers are created when work starts.

### M0 — Spike (throwaway; not merged)
- Use the SnapTrade **Personal** key in a local script under `/private/`
  (git-ignored) to fetch your real holdings.
- Hand-normalize them and run `rebalance()`; compare against a CSV import of the
  same accounts.
- **Exit:** every brokerage you use is covered (or you've noted which need CSV);
  SnapTrade's holdings field names are confirmed for §6.1; you have a feel for
  the connection portal flow.

### M1 — Guardrails and docs update
- Amend `CLAUDE.md`, `IMPLEMENTATION_PLAN.md` (the "no server" non-goal), and
  `README.md` to the new rule: *local-only mode sends nothing; signed-in mode
  stores the user's portfolio and SnapTrade credentials server-side, encrypted,
  and only for that user.*
- **This changes rules `CLAUDE.md` calls inviolable, so it needs your explicit
  sign-off. No backend code merges before it.**
- **Exit:** docs merged; CHANGELOG notes the policy change.

### M2 — SnapTrade adapter (pure)
- `src/ingest/adapters/snaptrade.ts` + synthetic fixtures + tests.
- Add `brokerLinks` to `appStateSchema` (optional, default `{}`).
- **Exit:** tests green; no runtime behavior change yet.

### M3 — Backend foundation
- Create the Supabase project; add `supabase/migrations/` with both tables and
  RLS; disable public signups.
- Add `api/` with `_lib/` helpers and a `GET /api/health` that verifies the
  token.
- Configure Vercel env vars; update CSP in `vercel.json`.
- Add the database isolation CI job and the `dist/` secret scan.
- **Exit:** two-user isolation test passes in CI; health check works on a
  preview deploy.

### M4 — Sign-in and cross-device sync
- `src/sync/` (Supabase client, remote store, API wrapper).
- Sign-in UI, magic-link callback with URL scrubbing, analytics `beforeSend`.
- Remote load/save with revision conflicts, local-to-remote upload on first
  sign-in, and a "Not synced" indicator.
- **Exit:** the same portfolio edited on desktop shows up on a phone; local-only
  mode is unchanged (existing app tests pass); a conflict reloads cleanly.
- This alone is useful: cross-device Drift with CSV import.

### M5 — Linking
- `api/snaptrade/*` endpoints and the Positions panel's "Linked accounts"
  source, connection list, sync, auto-sync on open, and `brokerLinks` mapping.
- **Exit:** link → sync → map → rebalance works end to end; a second sync maps
  automatically; a broken connection shows "needs re-authentication."

### M6 — Deletion, notices, copy
- `DELETE /api/account` and the Settings control.
- Privacy notice and ToS pages; update landing page and README copy so the
  "no account required" claims accurately describe local-only mode.
- Breach-response note in `docs/`.
- **Exit:** deleting an account removes the auth user, the database rows, and
  the SnapTrade user.

### Gate 1 — Personal phase (you only)
Only your email is invited. Use it for a few weeks on desktop and phone.
Cost: about $0 (Supabase Free, Vercel Hobby, SnapTrade free tier). Fix what you
find before inviting anyone.

### M7 — Open the closed beta
- Upgrade Supabase to Pro (backups, no pausing). Move Vercel to Pro if hosting
  needs to be commercial-safe.
- Invite friends and family. Switch SnapTrade to pay-as-you-go once you pass 5
  connections.
- Confirm a database backup restores.
- **Exit:** invited users can sign in, link, and sync; costs are tracking the
  ~$45–95/mo estimate.

### Gate 2 — Beta review
Decide whether to stay closed, add §9 features, or start the public-launch work
(Phase 3 in the exploration doc, including legal review).

---

## 11. Open questions

1. Magic link only, or also offer passwords? (Spec assumes magic link only.)
2. Custom domain for the beta, or the existing `drift-rebalance.vercel.app`?
3. Should signed-in mode be offered from the landing page, or only via a direct
   beta link until Gate 2?
