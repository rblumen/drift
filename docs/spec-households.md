# Requirements: Households and Shared Portfolios

**Status:** Draft for review (revision 2) · **Builds on:**
[`spec-account-linking.md`](spec-account-linking.md) (closed-beta stack:
Supabase, Vercel Functions, SnapTrade).

Drift rebalances a *household's* portfolio, and most households have more than
one adult. This doc turns the household user story into requirements, the
data-model changes they force on the account-linking spec, and a phased plan.

---

## 1. User story

> I sign up and start importing and linking accounts. I invite my spouse; she
> creates her own login and can view and manage our finances with me. She
> links her 401(k). We mark each account as mine, hers, or joint. I might keep
> two portfolios, "mine" and "ours". Later, our financial planner gets a
> read-only login to see the full picture.

Market reference: Origin supports a partner sharing one financial picture,
each with their own login. Empower has no such feature.

---

## 2. Concepts and vocabulary

Five concepts that today's docs blur together. Each gets one name, used
consistently in the UI, the docs, and the schema.

| Term | What it is | Belongs to | Schema |
|---|---|---|---|
| **Drift account** | A person's login to Drift: email, password, sessions | One person. Never shared | `auth.users` |
| **Household** | A group of Drift accounts that manage money together. Holds members, roles, and the list of people | Its members | `households`, `household_members` |
| **Portfolio** | What Drift rebalances: a set of accounts plus one strategy (targets, placement, overrides). "Mine" and "Ours" are two portfolios | One household | `portfolios` (`state` = today's `AppState`) |
| **Brokerage login** | One linking session with an institution: a SnapTrade connection. Can contain several brokerage accounts | The Drift account that linked it. Only they can reconnect or remove it | `brokerage_logins` |
| **Brokerage account** | One real account at an institution (e.g. Schwab joint taxable ••1234, Schwab Roth IRA ••5678). Has its own owner(s) | Comes from one brokerage login. Assigned to **at most one portfolio** | `brokerage_accounts` |

Two more terms are needed to keep these straight:
- **Person**: an owner label ("Ryan", "Partner", "Kid"), kept per household.
  It can be tied to a member's Drift account, or not (e.g. a child's 529).
  Ownership is a label. It never controls access.
- **Portfolio account**: the account entry inside a portfolio that the engine
  rebalances (today's `Account` in `AppState`). A linked brokerage account maps
  to one. CSV/manual portfolio accounts have no brokerage account behind them.
  - **Naming collision:** `spec-account-linking.md` calls this a "Drift
    account" (`drift_account_id`). That name now means the login, so the
    linking spec must rename it to *portfolio account* (`portfolio_account_id`).

```
Drift account (login) ──member of──▶ Household ──contains──▶ Portfolio ("Ours")
        │                              │                         │ strategy, targets
        │ linked                       │ people: Ryan,           │
        ▼                              │ Partner, Kid            ▼
Brokerage login (Schwab) ──contains──▶ Brokerage account ──assigned to──▶ Portfolio account
                                         owners: [Ryan, Partner]        (at most one portfolio)
```

---

## 3. Requirements

### R1 — Households and membership
1. A Drift account can belong to several households. Creating a Drift account
   creates a personal household with one portfolio.
2. Each member has a role in the household:

   | Action | owner | editor | viewer *(deferred, R7)* |
   |---|---|---|---|
   | View the household's portfolios, accounts, holdings, results | ✓ | ✓ | ✓ |
   | Create, rename, delete portfolios. Edit strategy, portfolio accounts, CSV/manual positions, mappings, overrides | ✓ | ✓ | — |
   | Assign own brokerage accounts to the household's portfolios. Move accounts between its portfolios | ✓ | ✓ | — |
   | Trigger a sync | ✓ | ✓ | — |
   | Invite or remove members, change roles, rename or delete the household | ✓ | — | — |

3. Every household has at least one owner. The last owner can't leave without
   deleting the household or transferring ownership.
4. Every member can see the member list (names, emails, roles).
5. Access is household-wide: a member sees every portfolio in the household.
   - A portfolio you want private ("mine") goes in a household where you are
     the only member.
   - Per-portfolio permissions are out of scope (§6).

### R2 — Invitations
1. An owner invites someone by email. The invite form has a **role dropdown
   that defaults to owner**. Editor is the other option; viewer joins the list
   when R7 ships.
2. The invite email contains no portfolio data (linking spec §7). It has the
   inviter's name, the household name, and a link.
3. An invite works whether or not the invitee already has a Drift account.
   **A household invite also admits the invitee to the closed beta,** skipping
   the waitlist.
4. Invites expire (default 7 days), are single-use, and can be revoked. Tokens
   are stored hashed.
5. Owners get an email when a member joins, leaves, or changes role.

### R3 — Brokerage logins, brokerage accounts, and ownership
1. Each person links their own brokerage logins. The login belongs to its
   Drift account, and other members never see its credentials or controls.
2. **Ownership is set per brokerage account, not per login.** One Schwab login
   might contain your joint taxable account (owners: you and your spouse) and
   your Roth IRA (owner: you). After linking, each account defaults to "owned
   by the person who linked it" and can be changed.
3. CSV/manual portfolio accounts carry owner labels the same way.
4. The UI can filter and group by owner ("Ryan", "Partner", "Joint").
5. **The engine is unchanged.** It already keeps each account
   balance-preserving (`PRINCIPLES.md` constraint #3), so money never moves
   between spouses' accounts. Ownership is display and filtering in this
   phase. Engine uses come later (§6).

### R4 — Assigning brokerage accounts to portfolios
1. **A brokerage account belongs to at most one portfolio at a time.** The
   database enforces this. Portfolios never overlap.
2. After linking, the linker chooses a portfolio for each brokerage account,
   or leaves it unassigned. Nothing is assigned by default. Unassigned
   accounts are visible only to the linker, so a spouse can link an account
   and keep it private.
3. **Moving an account:**
   - Any editor can move an account between portfolios in the same household.
   - Only the linker can move it to a different household, or unassign it.
   - A move clears its portfolio-account mapping, so the user maps it again in
     the new portfolio.
4. Any editor of the portfolio can map an assigned brokerage account to a
   portfolio account.
5. If a brokerage login needs reconnecting, other members see "needs
   reconnection by <name>". Only the linker sees the reconnect button.

### R5 — Duplicate detection
Two spouses can each link the same real account (a joint account at the same
institution) through their own brokerage logins. Drift then holds two
brokerage-account records for one real account.

1. **Candidates come only from different brokerage logins.** Accounts inside
   one login are distinct by definition, even when they share an institution
   or owner. This avoids false positives such as a joint taxable account and
   a Roth IRA from the same Schwab login.
2. A candidate pair has the same institution and the same mask (last 4),
   across all brokerage accounts in the household. Account type and name
   strengthen the match when available. If either mask is missing, Drift
   makes no automatic suggestion.
3. **Drift asks, never merges on its own:** "Schwab ••1234 linked by Partner
   looks like Schwab ••1234 linked by you. Same account?"
   - **Yes:** one record becomes primary and feeds holdings. The other is
     marked a duplicate and can't be assigned to a portfolio. If the primary's
     login breaks, Drift offers to switch to the duplicate.
   - **No:** Drift remembers the answer and doesn't ask about that pair again.
4. Users can also mark or unmark a duplicate by hand.
5. The decision covers duplicate *brokerage accounts* only. Whether several
   brokerage accounts may map to one portfolio account is still
   [#234](https://github.com/rblumen/drift/issues/234).

### R6 — Concurrent editing
1. Two editors may change the same portfolio.
   - Saves use optimistic concurrency (linking spec §5.4).
   - On a conflict, merge non-overlapping changes by section (strategy,
     portfolio accounts, overrides).
   - When both people changed the same section, show "<Name> updated this
     portfolio" and let the user choose. Never overwrite silently.
2. Record `updated_by` on each save and show "Last edited by <name>, <time>".
3. Recommended: Supabase Realtime pushes another member's save without a
   reload. This needs `wss://<project>.supabase.co` in the CSP.

### R7 — Viewer / adviser access (deferred)
- The schema includes the `viewer` role, and the RLS role-matrix tests cover
  it from the start, but the UI doesn't offer it until after the beta.
- When it ships: read-only, scoped to one household, optional expiry, and
  revocation that applies on the viewer's next request. Copy must say plainly
  that data a viewer already exported can't be recalled.

### R8 — Leaving, removal, and deletion
1. A member who leaves or is removed loses access immediately. Every brokerage
   account they linked is unassigned from the household's portfolios. Those
   accounts go with them, and the remaining members see the gap.
2. Portfolios (strategy and `AppState`) stay with the household. Before
   leaving, a member may **copy** a portfolio into one of their own
   households. This covers separation without anyone losing their own data.
3. Deleting a Drift account (linking spec §5.7) removes its memberships and
   its brokerage logins. It also deletes households where it was the sole
   member, and notifies the remaining members of shared households.

### R9 — Local-only mode
- Unchanged: one portfolio, no household.
- Owner labels (R3.3) work locally, using a local list of people.
- On first sign-in, local data becomes the first portfolio of the user's
  personal household, and local people become household people.

### R10 — Security and testing
- Authorization is enforced in Postgres RLS through household membership,
  never only in the UI or API. Roles are never put in JWT claims, since claims
  go stale.
- The CI isolation job grows into a role matrix: non-member, viewer, editor,
  owner, and a former member, for every table and operation.
- Membership, assignment, and duplicate decisions are logged in an
  append-only `household_events` table that members can read.
- No emails, names, or portfolio data in `sync_runs` or logs.

---

## 4. Data-model changes to `spec-account-linking.md` §4

The linking spec keys everything by `user_id`. **Restructure before M3 creates
any tables.** It costs a few extra tables now. Retrofitting after the beta
has data would mean migrating live rows and rewriting every RLS policy.

| Table | Purpose / change |
|---|---|
| `households` *(new)* | `id`, `name`, `created_by`, `created_at` |
| `household_members` *(new)* | PK `(household_id, user_id)`. `role` (`owner`/`editor`/`viewer`), `invited_by`, `created_at`. Index on `user_id` |
| `household_invites` *(new, server-only)* | `id`, `household_id`, `email` citext, `role`, `token_hash`, `expires_at`, `invited_by`, `accepted_at`, `revoked_at` |
| `household_people` *(new)* | `id`, `household_id`, `name`, `user_id` null |
| `household_events` *(new)* | Append-only audit log |
| `portfolios` | PK becomes `id uuid`. Add `household_id`, `name`, `created_by`, `updated_by`. Drop `user_id` |
| `brokerage_logins` *(new)* | `id` (SnapTrade authorization ID), `user_id` (linker), `institution`, `status`, `created_at`. `status` moves here from the account |
| `brokerage_accounts` *(was `broker_accounts`)* | Drop `drift_account_id` and `authorization_id`. Add `login_id` → `brokerage_logins`. Keep `user_id` (linker), `institution`, `name`, `mask`, `last_synced_at`. Add `owner_person_ids uuid[]` |
| `account_assignments` *(new)* | **PK `brokerage_account_id`**: one portfolio at most, enforced. Columns: `portfolio_id`, `portfolio_account_id` null, `assigned_by`, `assigned_at` |
| `account_duplicates` *(new)* | PK `(brokerage_account_id, duplicate_of)`. `status` (`suggested`/`confirmed`/`rejected`), `decided_by`, `decided_at`. A check constraint keeps both sides in different brokerage logins |
| `holdings` | Keyed on `security_id` (ticker nullable; stack-review risk #1). RLS: the linker, or a member of the household whose portfolio has the account assigned |
| `sync_runs` | Add `portfolio_id` null |
| `AppState` | `Account.ownerPersonIds?: string[]` for CSV/manual accounts. A `people` list for local-only mode only. Optional fields with defaults, so no version bump |

RLS shape:
- A `security definer` helper in a private schema,
  `private.household_role(household_id) → role | null`, reads
  `household_members` for `auth.uid()`.
  - Policies call it as `(select private.household_role(...))` so it runs once
    per query, not once per row.
  - This avoids recursive policies on `household_members`.
- `portfolios`: select for any role; insert, update, and delete for editor
  and above.
- `account_assignments`:
  - insert/delete only by the brokerage account's linker, who must be editor
    or above in the target household;
  - update `portfolio_id` within the same household, or
    `portfolio_account_id`, by editor and above.
- Households, membership, invites, and duplicates are written through
  `api/v1/` using `security definer` functions. Email and token handling live
  there, and an RLS bug there would be privilege escalation.

`composePositions(state, linked)` doesn't change shape. `linked` is the
portfolio's assigned holdings, excluding confirmed duplicates, joined with
`account_assignments.portfolio_account_id`.

New API:
- `POST /households/:id/invites`
- `POST /invites/:token/accept`
- `DELETE /households/:id/members/:userId`
- `PATCH /households/:id/members/:userId` (role)
- `POST /portfolios/:id/copy`
- `POST /duplicates/:id/decide`

**Cost note:** SnapTrade bills per connected *Drift account*. A couple where
both link accounts counts as two, so budget about $4/household/month on
pay-as-you-go.

---

## 5. Phasing

| When | Scope |
|---|---|
| **Now (spec edit)** | Adopt §2 vocabulary and the §4 data model in `spec-account-linking.md`, including the *portfolio account* rename. Fold in the stack-review fixes |
| **M2 (pure modules)** | `ownerPersonIds` and local `people` in `appStateSchema`. Owner labels and filter in the UI, which also helps local-only users |
| **M3 (foundation)** | All §4 tables, `private.household_role()`, and the role-matrix CI. Each user has one personal household; only the owner role is used yet |
| **M5 (linking)** | `brokerage_logins` and `brokerage_accounts`, per-account ownership, assignment to a portfolio |
| **New M5b — Households** (after Gate 1, before M7) | Invites with role dropdown (owner default, editor), beta admission by invite, several portfolios and a switcher, moving accounts, duplicate detection and confirmation, section-merge conflict handling, `updated_by`, Realtime, leave/remove/copy. **Exit:** you and your spouse each link your own logins, confirm the shared joint account as one, and both edit "Ours" from separate devices |
| **After the beta** | Viewer/adviser role (R7), membership-change emails if not done in M5b |

Your spouse is the natural second beta user. M5b before M7 means the household
path is tested first, by the people it's for.

---

## 6. Out of scope (designed for later)
- **Engine use of ownership:** per-person contribution limits (IRA/401(k)
  limits are per person), "my share of the household", per-person withdrawal
  and RMD planning. The owner labels this design captures are the input.
- Per-portfolio permissions inside a household. Workaround: a separate
  household.
- Adviser features: one adviser across many households, notes, branding.
- Household-level billing.

---

## 7. Open questions

1. **Is the household the right access boundary?** This draft makes access
   household-wide (R1.5), so a private "mine" portfolio lives in your personal
   household rather than the shared one. The alternative is per-portfolio
   membership inside one household. That's more flexible, but every policy and
   the invite flow get more complex. Recommendation: household-wide.
2. **Name for the account inside a portfolio.** This draft uses *portfolio
   account*. The current UI just says "account". Keep "account" in the UI and
   use *portfolio account* only in docs and schema?
3. **Duplicate fallback.** When a confirmed duplicate's primary login breaks,
   should Drift switch to the other copy automatically, or ask (current
   draft)?
