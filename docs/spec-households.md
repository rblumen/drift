# Requirements: Households and Shared Portfolios

**Status:** Draft for review · **Builds on:**
[`spec-account-linking.md`](spec-account-linking.md) (closed-beta stack:
Supabase, Vercel Functions, SnapTrade).

Drift rebalances a *household's* portfolio, and most households have more than
one adult. This doc turns the household user story into requirements, the
data-model changes they force on the account-linking spec, and a phased plan.

---

## 1. User story

> I sign up and start importing and linking accounts. I invite my spouse; she
> creates her own login and can view and manage the portfolio with me. She
> links her 401(k). We mark each account as mine, hers, or joint. I might keep
> two portfolios ("mine" and "ours"). Our financial planner gets a read-only
> login to see the full picture.

Market reference: Origin supports a partner sharing one financial picture,
each with their own login. Empower has no such feature.

---

## 2. Concepts

| Concept | What it is | Key point |
|---|---|---|
| **User** | A login (Supabase `auth.users`). One per person | Never shared. Each spouse has their own |
| **Portfolio** | What Drift rebalances: accounts, strategy, targets, overrides (today's `AppState`) | **The unit of sharing.** A user can belong to several |
| **Member** | A user's role in one portfolio: `owner`, `editor`, or `viewer` | Permissions live here, not on the user |
| **Brokerage connection** | A SnapTrade link to one institution login | **Belongs to the user who linked it**, and stays theirs. Only they can reconnect or remove it |
| **Account share** | One linked brokerage account added to one portfolio | An explicit, per-account opt-in by the account's owner. The same brokerage account can be in several portfolios |
| **Person** | A label naming who owns an account ("Ryan", "Partner", "Kid") | A per-portfolio list in `AppState`. Optionally tied to a member's login. Works without logins, including local-only mode |

The distinctions that matter:
- **Credentials vs. data.** Your spouse can *see* your 401(k) in a shared
  portfolio. She can never act on, reconnect, or unlink your brokerage
  connection.
- **Ownership vs. access.** "This account is hers" is a label (a *person*).
  "She can edit this portfolio" is a role (a *member*). The two are
  independent. You can label an account as belonging to someone with no login
  (a child's 529), and an adviser can view without owning anything.

---

## 3. Requirements

### R1 — Portfolios and membership
1. A user can create several portfolios, name them, and switch between them.
2. Every portfolio has at least one `owner`. The last owner can't leave without
   deleting the portfolio or transferring ownership.
3. Each role can do the following:

   | Action | owner | editor | viewer |
   |---|---|---|---|
   | View accounts, holdings, results, history | ✓ | ✓ | ✓ |
   | Edit strategy, targets, accounts, manual/CSV positions, mappings, overrides | ✓ | ✓ | — |
   | Share own linked accounts into the portfolio | ✓ | ✓ | — |
   | Trigger a sync of the portfolio's linked accounts | ✓ | ✓ | — |
   | Invite or remove members, change roles | ✓ | — | — |
   | Rename or delete the portfolio | ✓ | — | — |

4. Every member can see the member list (names and emails, with roles), so
   access is never invisible to the people whose data is shown.

### R2 — Invitations
1. An owner invites by email and picks a role. The invite email has no
   portfolio data (spec §7), only the inviter's name and a link.
2. An invite works whether or not the invitee already has a Drift login. **A
   portfolio invite also admits the invitee to the closed beta**, skipping the
   waitlist. This partly answers spec §12 Q2: household invites are always
   allowed, and general invite quotas stay a separate decision.
3. Invites expire (default 7 days), are single-use, and can be revoked. The
   token is stored hashed.
4. Existing owners get an email when a member joins, leaves, or changes role.

### R3 — Account ownership labels
1. Each portfolio has a `people` list. Each account has `ownerIds`: one person,
   or two or more for joint. Accounts can also be unassigned.
2. A person can be linked to a member's login. When that member shares a linked
   account, it defaults to them as owner.
3. The UI can filter or group by owner: "Ryan's accounts", "Joint", and so on.
4. **The engine is unchanged.** It already treats each account as its own unit
   and preserves its balance (`PRINCIPLES.md` constraint #3), so money never
   moves between spouses' accounts. Ownership is for display and filtering in
   this phase. §6 lists engine uses that may come later.

### R4 — Shared linked accounts
1. Linking stays per user. Each spouse connects their own brokerages through
   their own SnapTrade user.
2. After linking, the user chooses which portfolios each account goes into,
   **per account**. Nothing is shared by default, so a spouse can link an
   account and keep it private.
3. Any editor of the portfolio can map a shared account to a Drift account
   (the mapping is per portfolio).
4. The account's owner can withdraw it from a portfolio at any time. Its
   holdings disappear from that portfolio immediately. Removing a member
   withdraws all of that member's accounts from the portfolio.
5. If a shared account's connection breaks, other members see "needs
   reconnection by <name>". Only the connection owner sees the reconnect
   button.

### R5 — Overlapping portfolios ("mine" and "ours")
1. The same linked account may belong to several portfolios.
2. **The UI must warn** when an account is in more than one portfolio: "Also in
   'Ours'. Trades suggested here may conflict with trades suggested there."
   Each portfolio has its own strategy, so two portfolios containing one
   account can recommend opposite trades for it.
3. Manual and CSV accounts are per portfolio. Putting one in two portfolios
   means keeping two copies. Known limitation; see open question Q1.

### R6 — Concurrent editing
1. Two editors may change the same portfolio. Saves keep optimistic
   concurrency (spec §5.4). A conflict shows "<Name> updated this portfolio" and
   offers reload, never a silent overwrite.
2. Record `updated_by` on each save and show "Last edited by <name>, <time>".
3. Recommended: subscribe to portfolio changes (Supabase Realtime) so another
   member's save appears without a reload. This makes conflicts rare.

### R7 — Viewer / adviser access
1. A `viewer` sees everything in the portfolio (balances, holdings, masks,
   results) and can export the report. Nothing else.
2. A viewer sees only the portfolios they were invited to, never the inviting
   user's other portfolios or unshared accounts.
3. Optional expiry on viewer membership (e.g. "access for 30 days"), shown to
   owners.
4. Revocation takes effect on the viewer's next request, enforced by RLS. Copy
   must say plainly that what a viewer already saw or exported can't be
   recalled.

### R8 — Leaving, removal, and deletion
1. A member who leaves or is removed loses access immediately, and their
   shared accounts are withdrawn (R4.4).
2. The portfolio's decisions (`AppState`) stay with the remaining owners. The
   departing member may **duplicate** the portfolio into one of their own
   before leaving. Their own linked accounts come with them; others' do not.
   This covers separation and divorce without anyone losing their own data.
3. Deleting a user account (spec §5.7) removes their memberships, withdraws
   their shares, and deletes portfolios where they were the sole owner. Other
   members are notified.

### R9 — Local-only mode
- Unchanged and single-portfolio. People labels (R3) work locally too. Sharing
  needs sign-in. On first sign-in, local data becomes the user's first
  portfolio ("My portfolio").

### R10 — Security and testing
- Authorization is enforced in Postgres RLS through membership, never only in
  the UI or API.
- The CI isolation job (spec §9) grows into a role matrix with five actors per
  table and operation: non-member, viewer, editor, owner, and a former member.
- No emails, names, or portfolio data in `sync_runs` or logs.
- Invite and membership changes are recorded in an append-only
  `portfolio_events` table (who, what, when) that members can read.

---

## 4. Data-model changes to `spec-account-linking.md` §4

The linking spec keys everything by `user_id`. Sharing needs portfolio-keyed
rows plus a membership check. **Make this change before M3 creates any
tables.** It costs a few extra tables and policies now. Retrofitting it after
the beta has data would mean migrating live rows and rewriting every RLS
policy.

| Table | Change |
|---|---|
| `portfolios` | PK becomes `id uuid`. Add `name`, `created_by`, `updated_by`. Drop `user_id` |
| `portfolio_members` *(new)* | `(portfolio_id, user_id)` PK, `role` (`owner`/`editor`/`viewer`), `expires_at` null, `created_at`, `invited_by` |
| `portfolio_invites` *(new, server-only)* | `id`, `portfolio_id`, `email` citext, `role`, `token_hash`, `expires_at`, `invited_by`, `accepted_at`, `revoked_at` |
| `portfolio_accounts` *(new)* | `(portfolio_id, broker_account_id)` PK, `drift_account_id` null, `shared_by`, `created_at`. Replaces `broker_accounts.drift_account_id` |
| `portfolio_events` *(new)* | Append-only audit of membership and share changes |
| `broker_accounts` | Drop `drift_account_id`. `user_id` keeps meaning *connection owner* |
| `holdings` | Unchanged columns. RLS: select if own **or** the broker account is shared into a portfolio you're a current member of |
| `sync_runs` | Add `portfolio_id` null (which portfolio triggered it) |
| `AppState` | Add optional `people: {id, name, userId?}[]` and `Account.ownerIds?: string[]`. Optional with defaults, so no version bump |

RLS shape:
- A `security definer` helper, `portfolio_role(portfolio_id) → role | null`,
  reads `portfolio_members` for `auth.uid()` (ignoring expired rows). Every
  policy calls it. This avoids recursive policies on `portfolio_members`.
- `portfolios`: select if any role. Update (`state`, `name`) if editor or
  above. Delete if owner.
- `portfolio_accounts`: insert only if you own the broker account **and** are
  an editor or above. Update `drift_account_id` if editor or above. Delete if
  you shared it or are an owner.
- Membership and invites are written only through `api/v1/` (service role).
  They involve email and token handling, and an RLS bug there would be
  privilege escalation.

`composePositions(state, linked)` doesn't change. `linked` becomes the
portfolio's shared holdings joined with `portfolio_accounts.drift_account_id`.

New API: `POST /portfolios/:id/invites`, `POST /invites/:token/accept`,
`DELETE /portfolios/:id/members/:userId`, `PATCH …/members/:userId` (role),
`POST /portfolios/:id/duplicate`.

**Cost note:** SnapTrade bills per connected *user*. A couple where both link
accounts counts as two. Budget about $4/household/month on pay-as-you-go.

---

## 5. Phasing

| When | Scope |
|---|---|
| **Now (spec edit)** | Adopt the §4 data model in `spec-account-linking.md`. M3 creates portfolio-keyed tables, membership, and `portfolio_role()`. Only the `owner` role is used at first |
| **M2 (pure modules)** | `people` and `ownerIds` in `appStateSchema`. Owner labels and filter in the UI, which also helps local-only users |
| **M5 (linking)** | Account shares via `portfolio_accounts`. Per-account "add to portfolio" step after linking (one portfolio at first) |
| **New M5b — Households** (after Gate 1, before M7) | Multiple portfolios and a switcher. Invites with owner and editor roles. Beta admission via portfolio invite. Conflict UX with `updated_by`. Realtime refresh. Leave, remove, and duplicate. Overlap warning. Role-matrix CI. **Exit:** you and your spouse each link your own accounts into one shared portfolio and both edit it from separate devices |
| **M7 or after** | `viewer` role with expiry (adviser). Membership-change emails. `portfolio_events` view |
| **Later** | §6 |

Your spouse is the natural second beta user. Shipping M5b before M7 means the
household path gets tested first, by the people it's for.

---

## 6. Out of scope (designed for later)
- **Engine use of ownership:** per-person contribution limits (IRA/401(k)
  limits are per person), per-owner allocation views ("my share of the
  household"), and per-person withdrawal and RMD planning. All of these need
  `ownerIds`, which this design already captures.
- Field-level privacy inside a shared portfolio (e.g. hide one account's
  balance from a viewer).
- Adviser-side features: one adviser managing many households, adviser
  branding, notes.
- Household-level billing.

---

## 7. Open questions

1. **"Mine and ours": separate portfolios, or one portfolio with owner views?**
   Recommendation: support both (the model allows it). Steer most couples to
   one shared portfolio with an owner filter, since overlapping portfolios
   can give conflicting advice (R5.2). Should manual/CSV accounts ever be
   shared across portfolios, or stay per-portfolio copies?
2. **Can editors invite?** The spec says owners only. Some couples will want
   both spouses as owners. Is that the default for a partner invite?
3. **Adviser timing:** is the read-only adviser role needed in the beta, or
   after it?
4. **Joint accounts linked twice:** if both spouses link the same joint
   account through their own logins, two broker accounts exist for one real
   account. Detect duplicates (same institution and mask) and warn, or leave
   it to the user? Related to
   [#234](https://github.com/rblumen/drift/issues/234).
5. **Regulatory:** sharing with an adviser is user-directed disclosure, so
   it's likely fine under GLBA. Confirm that the privacy notice (M6) covers
   sharing with other members.
