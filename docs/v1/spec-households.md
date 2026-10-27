# Requirements: Households and Shared Portfolios

**Status:** Draft for review (revision 4) · **Builds on:**
[`spec-account-linking.md`](spec-account-linking.md) (closed-beta stack:
Supabase, Vercel Functions, SnapTrade).

Drift rebalances a *household's* portfolio, and most households have more than
one adult. This doc turns the household user story into requirements, the
data-model changes they force on the account-linking spec, and a phased plan.

---

## 1. User story

> I sign up and start importing and linking accounts. I invite my partner;
> they create their own login and can view and manage our finances with me. They
> link their 401(k). We mark each account as mine, theirs, or joint. I might keep
> two portfolios, "mine" and "ours". Later, our financial planner gets a
> read-only login to see the full picture.

Market reference: Origin supports a partner sharing one financial picture,
each with their own login. Empower has no such feature.

---

## 2. Concepts and vocabulary

**One vocabulary for docs, UI, and schema.** Each term below means exactly one
thing everywhere. The word "account" is reserved for brokerage accounts in a
portfolio, never for a Drift sign-in.

| Term | What it is | Belongs to | Schema |
|---|---|---|---|
| **Drift user** | A person who signs in to Drift: email, password, sessions | One person. Never shared | `auth.users` |
| **Profile** | Drift's record of a Drift user: sign-in identity, settings, preferences, and info (display name, MFA, referral link). Deleting it removes the record and all their data | The Drift user | `auth.users` + profile fields |
| **Household** | A group of Drift users that manage money together. Holds members, roles, and the list of people | Its members | `households`, `household_members` |
| **Portfolio** | What Drift rebalances: a set of accounts plus one strategy (targets, placement, overrides). "Mine" and "Ours" are two portfolios | One household | `portfolios` (`state` = today's `AppState`) |
| **Account** | A brokerage account as it appears in a portfolio, e.g. "Schwab Roth IRA". What the engine rebalances. Either **linked** or **manual** | One portfolio | `Account` in `AppState` |
| **Linked account** | An account whose holdings sync from a brokerage login (e.g. Schwab joint taxable ••1234). Has its own owner(s) | The Drift user who linked it. At most one portfolio per household | `linked_accounts` + `account_assignments` |
| **Manual account** | An account kept up to date by CSV import or hand entry | One portfolio | `Account` in `AppState` |
| **Brokerage login** | One connection to an institution through SnapTrade. Can contain several linked accounts | The Drift user who linked it. Only they can reconnect or remove it | `brokerage_logins` |
| **Person** | An owner label ("Alex", "Sam", "Kid"), kept per household. Can be tied to a member's Drift user, or not (a child's 529). Never controls access | One household | `household_people` |

UI wording follows the table:
- "Delete my Drift user profile" lives under **Profile**. It deletes Drift's
  record of the person and their data, not the person.
- The landing page says "Use Drift without signing in".
- "Account" always means a row in the portfolio's account list.
- When the account list needs to say how an account gets its data, it says
  "linked" or "manual".

Earlier drafts used "Drift account", meaning the account in a portfolio
(`drift_account_id`). It is now `account_id`.

```
Drift user ──member of──▶ Household ──contains──▶ Portfolio ("Ours")
     │                       │ people: Alex,          │ strategy, targets
     │ connects              │ Sam, Kid           ▼
     ▼                                              Accounts ◀── manual (CSV / hand entry)
Brokerage login (Schwab) ──contains──▶ Linked account ──feeds──▶ Account
                                         owners: [Alex, Sam]   (≤ 1 portfolio per household)
```

---

## 3. Requirements

### R1 — Households and membership
1. A Drift user can belong to several households. Creating a Drift user
   creates a personal household with one portfolio.
2. Each member has a role in the household:

   | Action | owner | editor | viewer *(deferred, R7)* |
   |---|---|---|---|
   | View the household's portfolios, accounts, holdings, results | ✓ | ✓ | ✓ |
   | Create, rename, delete portfolios. Edit strategy, accounts, CSV/manual positions, mappings, overrides | ✓ | ✓ | — |
   | Assign own linked accounts to the household's portfolios. Move accounts between its portfolios | ✓ | ✓ | — |
   | Trigger a sync | ✓ | ✓ | — |
   | Invite or remove members, change roles, rename or delete the household | ✓ | — | — |

3. Every household has at least one owner. The last owner can't leave without
   deleting the household or transferring ownership.
4. Every member can see the member list (names, emails, roles).
5. Access is household-wide: a member sees every portfolio in the household.
   Mine/hers/joint is a label (R3), never an access boundary.
   - **A hard privacy boundary is a separate household** under the same Drift
     user, with no other members. Example: a private "Mine" portfolio sits
     outside the shared household.
   - Switching between households and portfolios is one switcher.
   - Per-portfolio permissions are out of scope (§6).

### R2 — Invitations
1. An owner invites someone by email. The invite form has a **role dropdown
   that defaults to owner**. Editor is the other option; viewer joins the list
   when R7 ships.
2. The invite email contains no portfolio data (linking spec §7). It has the
   inviter's name, the household name, and a link.
3. An invite works whether or not the invitee already has a Drift user.
   **A household invite also admits the invitee to the closed beta,** skipping
   the waitlist.
4. Invites expire (default 7 days), are single-use, and can be revoked. Tokens
   are stored hashed.
5. Owners get an email when a member joins, leaves, or changes role.
6. **Beta users can invite household members only.** Anyone else comes
   through a referral link (linking spec §5.2a), and the Drift operator
   decides whom to invite.

### R3 — Brokerage logins, linked accounts, and ownership
1. Each person links their own brokerage logins. The login belongs to its
   Drift user, and other members never see its credentials or controls.
2. **Ownership is set per linked account, not per login.** One brokerage login
   might contain your joint taxable account (owners: you and your partner) and
   your Roth IRA (owner: you). After linking, each account defaults to "owned
   by the person who linked it" and can be changed.
3. Manual accounts carry owner labels the same way.
4. The UI can filter and group by owner ("Alex", "Sam", "Joint").
5. **The engine is unchanged.** It already keeps each account
   balance-preserving (`PRINCIPLES.md` constraint #3), so money never moves
   between partners' accounts. Ownership is display and filtering in this
   phase. Engine uses come later (§6).

### R4 — Assigning linked accounts to portfolios
1. **Within a household, a linked account belongs to at most one
   portfolio.** The database enforces this, so a household's portfolios never
   overlap.
   - **Across privacy boundaries there is no restriction.** The linker may add
     the same account to a portfolio in each household they edit, e.g. the
     Roth IRA in both "Mine" (private household) and "Ours" (shared
     household).
   - Each household sees only its own assignment. Members of one household
     can't tell whether the account also appears elsewhere.
   - The linker, who can see both, gets an "also in <portfolio>" note, since
     the two portfolios may suggest different trades for it.
2. After linking, the linker chooses a portfolio for each linked account,
   or leaves it unassigned. Nothing is assigned by default. Unassigned
   accounts are visible only to the linker, so a partner can link an account
   and keep it private.
3. **Moving an account:**
   - Any editor can move an account between portfolios in the same household.
   - Only the linker can add it to or remove it from a household.
   - A move clears its mapping, so the user maps it again in the new
     portfolio.
4. Any editor of the portfolio can map an assigned linked account to an
   account in the portfolio (usually by creating it).
5. If a brokerage login needs reconnecting, other members see "needs
   reconnection by <name>". Only the linker sees the reconnect button.

### R5 — Duplicate detection
Two partners can each link the same real account (a joint account at the same
institution) through their own brokerage logins. Drift then holds two linked
accounts for one real account.

1. **Candidates come only from different brokerage logins.** Accounts inside
   one login are distinct by definition, even when they share an institution
   or owner. This avoids false positives such as a joint taxable account and
   a Roth IRA from the same brokerage login.
2. **Detection never crosses a privacy boundary.** It compares only accounts
   assigned within the same household. Unassigned accounts and other
   households' assignments are never compared, and a suggestion never
   reveals that an account exists outside the household.
3. A candidate pair has the same institution and the same mask (last 4),
   among the accounts assigned in that household. Account type and name
   strengthen the match when available. If either mask is missing, Drift
   makes no automatic suggestion.
4. **Drift asks, never merges on its own:** "Schwab ••1234 linked by Sam
   looks like Schwab ••1234 linked by you. Same account?"
   - **Yes:** the user picks which copy to keep (default: the one already
     mapped). **The other copy is removed from this household.** No backup
     copy is kept. If the kept copy's login later breaks, it shows "needs
     reconnection" like any other. The removed copy's place in any other
     household, and its linker's own record, are unaffected.
   - **No:** Drift remembers the answer and doesn't ask about that pair again.
5. Users can also mark a pair as duplicates by hand, with the same result.
6. The decision covers duplicate *linked accounts* only. Whether several
   linked accounts may map to one account is still
   [#234](https://github.com/rblumen/drift/issues/234).

### R6 — Concurrent editing
1. Two editors may change the same portfolio.
   - Saves use optimistic concurrency (linking spec §5.4).
   - On a conflict, merge non-overlapping changes by section (strategy,
     accounts, overrides).
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
1. A member who leaves or is removed loses access immediately. Every linked
   account they own is unassigned from the household's portfolios. Those
   accounts go with them, and the remaining members see the gap.
2. Portfolios (strategy and `AppState`) stay with the household. Before
   leaving, a member may **copy** a portfolio into one of their own
   households. This covers separation without anyone losing their own data.
3. Deleting a Drift user profile (linking spec §5.8) removes its memberships and
   its brokerage logins. It also deletes households where it was the sole
   member, and notifies the remaining members of shared households.

### R9 — Guest mode
- Unchanged: one portfolio, no household.
- Owner labels (R3.3) work in guest mode, using a local list of people.
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

## 4. Data model

The schema, RLS, and database functions now live in
[`spec-account-linking.md`](spec-account-linking.md) §4, which is the single
source of truth. In summary:

- **Households and access:** `households`, `household_members` (role per
  household), `household_invites`, `household_people`, and
  `household_events`. Every policy checks `private.household_role()`.
- **Portfolios** belong to a household (`portfolios.household_id`).
- **Brokerage data:** `brokerage_logins` and `linked_accounts` are
  server-written and owned by the linker.
- **Assignments:** `account_assignments` has its primary key on (linked
  account, household): at most one portfolio per household, any number of
  households. It holds the mapping to the portfolio's account and
  the owner labels (`owner_person_ids`). Labels live on the assignment because
  `household_people` are scoped to a household.
- **Duplicates:** `account_duplicates` holds open suggestions and "not the
  same" answers, scoped per household. A trigger requires both accounts to be
  assigned in that household and to come from different brokerage logins.
  Confirming deletes the removed copy's assignment.
- **User-side writes** go through role-checking RPCs (`save_portfolio`,
  `assign_account`, `move_account`, …).

**Cost note:** SnapTrade bills per connected *Drift user*. A couple where
both link accounts counts as two, so budget about $4/household/month on
pay-as-you-go.

---

## 5. Phasing

Sequencing and ownership are in
[`build-plan-account-linking.md`](build-plan-account-linking.md). In short:
owner labels arrive in M2, the household schema in M3, per-account assignment
with linking in M5, and the rest of R1–R8 in **M5b**, after Gate 1 and before
the beta opens (M7). The viewer/adviser role (R7) comes after the beta.

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

1. ~~Is the household the right access boundary?~~ **Resolved:** yes.
   Ownership is a label. A hard privacy boundary is a separate household under
   the same Drift user (R1.5).
2. ~~Naming~~ **Resolved:** one vocabulary across docs, UI, and schema (§2).
   "Account" means a brokerage account in a portfolio. A Drift user's own
   settings are their "profile".
3. ~~Duplicate fallback~~ **Resolved:** confirming a duplicate removes the
   other copy from the household. No backup copy is kept (R5.4).
4. ~~Invites beyond the household~~ **Resolved:** beta users invite household
   members only (R2.6).
