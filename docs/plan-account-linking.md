# Roadmap: Account Linking & the Server-Backed Stage of Drift

> **Status:** Exploration complete. The chosen direction is Appendix A (closed
> beta), started with you as the only user on the same multi-user stack. The
> buildable spec and milestones are in
> [`spec-account-linking.md`](spec-account-linking.md).

## Context

Drift today is a **fully static, browser-only** React/Vite SPA on Vercel. Its
defining promise — stated in `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`,
`PRINCIPLES.md`, the landing page, README, and enforced by a strict CSP
(`connect-src 'self'`) — is that **no user data ever leaves the browser**. All
state lives in `localStorage` (`rebalancer-v1`) via `src/store.ts`, which
declares "this module never makes network calls." The only network egress is
anonymous, no-PII Vercel Web Analytics. The rebalance engine (`src/engine/`) is
pure and consumes plain `Account[]`/`Position[]`/`Strategy` snapshots.

The user wants to level up capability with **automatic position syncing via an
account aggregator (Plaid/Yodlee/etc.)**, cutting out the manual CSV
export/import loop. This inherently requires server-side infrastructure,
user accounts, authentication, and a paid aggregator — a genuine departure from
the client-only model.

**Decisions captured from the user:**
- **Audience:** near-term = private beta with *invited* users (with the option
  to recruit beta testers publicly); long-term vision = public multi-user
  product. Design for #2 now, don't foreclose #3.
- **Privacy posture:** *pragmatic server-side storage* — encrypted-at-rest
  portfolio data in a server DB the app can read. The "no data leaves the
  browser" promise is knowingly rewritten (see §6).
- **Doc purpose:** *exploratory landscape* — "what would this take," not yet a
  build spec.
- **Aggregator:** no preference; recommend one.

This document is a thinking tool: it maps the components, costs, risks, a phased
path, and the decision points. It is **not** a build-now instruction; nothing
here should be implemented until the user says go.

---

## 1. The shape of the shift

Account linking is not one feature — it forces four new subsystems that Drift
has zero of today:

| New subsystem | Why it's forced | Today |
|---|---|---|
| **Backend / API** | Aggregator access tokens *must not touch the client* (per the existing `plaid.ts` stub note). Someone server-side must exchange tokens and call the aggregator. | None. Static bundle only. |
| **User identity & auth** | Server-stored data must be partitioned per person and access-controlled. | None. "Account" = brokerage account, never a user. No login anywhere. |
| **Database** | Store user records, aggregator item/token references, and (per the chosen posture) portfolio snapshots. | `localStorage` only. |
| **Aggregator integration** | The actual sync of holdings. Paid, KYC'd, contract-bound. | `plaid.ts` is an empty stub documenting the prerequisites. |

Everything else in Drift — the pure engine, the ingest normalization, the UI
tabs — can stay largely as-is. **That's the key architectural leverage:** the
engine already takes decomposed snapshots and is network-free, and `store.ts`
is the single, well-isolated persistence boundary. A sync layer slots in
*exactly* where the CSV adapters sit (producing the same `Position[]` shape with
`lastUpdatedAt` stamps), and a remote-persistence layer hooks in behind the
`saveState`/`loadState` seam. We are adding a new data *source* and a new data
*sink*, not rewriting the core.

---

## 2. Aggregator recommendation

The three realistic categories:

- **SnapTrade — recommended for the beta.** Purpose-built for *brokerage/
  investment* account connections (holdings, balances, positions, and even
  trading). Startup-friendly onboarding, usage-based pricing, and coverage
  aimed squarely at retail brokerages (Schwab, Fidelity, Vanguard, etc.) —
  which is precisely Drift's domain. Lowest friction to a working beta.
- **Plaid** — the mainstream default; excellent DX and docs. Its *Investments*
  product returns holdings, but Plaid's center of gravity is banking/ACH;
  full brokerage investment coverage (esp. Fidelity) has historically needed
  higher-tier/approved access. Great fallback and widely understood by users.
- **Yodlee** — deepest wealth/investment history, but enterprise-oriented:
  heavier contracts, sales-led onboarding, higher minimums. Overkill for a beta.

**Recommendation:** prototype against **SnapTrade** for the beta because its
investment-holdings coverage and self-serve onboarding match Drift's needs and
budget best. Keep the aggregator behind an **adapter interface** (mirroring the
existing per-broker adapter pattern in `src/ingest/adapters/`) so Plaid or
Yodlee can be swapped/added later without touching the engine or UI.

**SnapTrade tiers (as of Oct 2026 — re-verify before committing):**

| Tier | Price | Limits | Who it serves |
|---|---|---|---|
| **Personal** | Free | 20 brokerage connections; your own accounts only; key must not be shared or shipped in an app | Appendix B (just you) |
| **Commercial — free** | $0 | 5 brokerage connections total; positions, balances, orders | Phase 0 spike; a very small closed beta |
| **Commercial — pay-as-you-go** | ~$2 per connected user / month | Unlimited connections; ~250 req/min default rate limit | Closed beta beyond 5 connections; public product |

The Personal/Commercial split matters: as soon as *anyone other than you*
links an account, you need a Commercial key, which uses SnapTrade's per-user
model (`userId` + `userSecret` per end user — store these server-side,
encrypted, per §3).

> The old caveat that every aggregator needs a contract and per-account fees
> from day one is softened by SnapTrade's free tiers, but still applies to
> Plaid/Yodlee and to SnapTrade at scale. Coverage still varies by
> institution, so keep CSV import as a permanent fallback (§7).

---

## 3. Target architecture (pragmatic server-side model)

```
        Browser SPA (existing, hardened)
        ─ login UI, "Link account" (aggregator Link widget)
        ─ still runs the PURE engine client-side
        ─ localStorage becomes a cache, not the source of truth
                    │  HTTPS (authenticated, CSP relaxed to allow our API)
                    ▼
        Backend API  (new)
        ─ auth / session issuance & verification
        ─ aggregator token exchange + refresh (tokens NEVER sent to client)
        ─ sync jobs: pull holdings → normalize to Position[] → persist
        ─ serves the user their own AppState
                    │
                    ▼
        Database (new)          Aggregator (SnapTrade/Plaid/Yodlee)
        ─ users, sessions       ─ Link, holdings/investments endpoints
        ─ aggregator item refs  ─ webhooks (holdings updated)
        ─ access tokens (encrypted / KMS)
        ─ portfolio snapshots (encrypted at rest)
```

**Where the engine runs — treat it as isomorphic, not "client-only":** the
engine is pure, network-free TypeScript, so the *same module* runs unchanged in
the browser **and** on the server. Pick the location per feature, not by
default:
- **Browser** for the interactive loop — nudge a target, change tolerance,
  toggle tax-adjustment, and see trades recompute instantly, offline, with no
  round-trip. This latency/interactivity win is the real reason to keep it
  client-side; it is *not* a privacy reason (see below).
- **Server** for anything a synced product wants that a browser tab can't do:
  scheduled drift checks, "your allocation drifted past tolerance"
  email/push reminders, a future mobile app or public API. These need the
  engine server-side, and its purity makes that a free port.

**Be honest about the privacy rationale:** in the *pragmatic server-side
storage* posture, the server already stores and can read the holdings, so
running the arithmetic in the browser buys essentially **no** additional
privacy — the sensitive data is in the DB regardless. Do not justify
client-side execution on privacy grounds in this model; justify it on latency
and reuse. (Client-side execution *would* be a real privacy lever only under the
end-to-end-encrypted posture we did not choose.) The trap to avoid is
*confining* the engine to the client out of inertia because it's already built —
keep it interactive in the browser, and plan to run the identical module
server-side the moment automation features arrive.

### Concrete tech options (to decide at build time, not now)
- **Backend:** Vercel Serverless/Edge Functions (an `api/` dir — no new host,
  same deploy pipeline) is the lowest-friction start and fits the existing
  Vercel deployment. If sync jobs/cron/queues grow, graduate to a dedicated
  service (Fly.io / Render / Railway) or Supabase Edge Functions.
- **Auth:** use a managed provider (Clerk, Auth0, or Supabase Auth) rather than
  rolling your own — password storage, MFA, email verification, and session
  management are exactly where hand-rolled auth goes wrong for a financial tool.
- **Database:** managed Postgres (Supabase / Neon / Vercel Postgres). Supabase
  is attractive because it bundles Postgres + Auth + row-level security in one,
  collapsing two decisions into one for the beta.
- **Secret/token storage:** aggregator access tokens encrypted with a KMS-held
  key (or provider vault), never in the same readable column as normal data,
  never returned to the client.

---

## 4. The four workstreams

### A. Backend + hosting foundation
- Stand up an authenticated API surface (start as Vercel functions in `api/`).
- Introduce environment/secret management (aggregator keys, DB URL, KMS key).
- Add a real CI deploy story for the backend (today CI only builds/tests).

### B. Identity & auth
- Introduce a **User** concept — brand new; today "account" means brokerage
  account. Naming discipline needed to avoid collision (e.g. `User` vs
  `Account`/brokerage account).
- Login/signup UI + session handling in the SPA.
- Gate the invited beta with an **invite/allowlist** mechanism so it isn't open
  signup, while leaving room to flip to public later.

### C. Data model & persistence migration
- Decide the **source of truth**: server DB, with `localStorage` demoted to an
  offline cache. `store.ts`'s `saveState`/`loadState` become a sync client.
- Extend the persisted model for linked accounts: new fields for aggregator
  `item`/`connection` references and per-brokerage-account mapping (Drift
  currently persists **no** broker account numbers and **no** tokens). Likely a
  new server-side table rather than stuffing into `AppState`.
- **Schema versioning:** `appStateSchema` is a hard `version: z.literal(1)` with
  no migration framework (only an in-schema `migrateStrategyTargets`
  preprocess). Server-backed state needs a real, forward-compatible migration
  strategy and a version bump.
- Preserve the local-only mode: existing users' `localStorage` data should
  import cleanly into their new server account (reuse `loadJson` / the
  `appStateSchema` parse path).

### D. Aggregator sync
- Implement an **aggregator adapter** behind the same interface shape as
  `src/ingest/adapters/*`, producing the existing `MultiAccountResult` /
  `Position[]` output so the engine and account-mapping UI are unchanged.
- Server-side: token exchange, holdings pull, normalization to `Position` (reuse
  `buildPosition` normalization concepts), `lastUpdatedAt` stamping (the
  freshness indicator in `src/ingest/freshness.ts` already surfaces this).
- Handle sync lifecycle: initial link, refresh, webhooks for updates,
  re-auth when a connection breaks, and mapping aggregator asset data onto
  Drift's 19-member `AssetClass` taxonomy (reuse `tickerOverrides` /
  `decompositions` for anything the aggregator can't classify).

---

## 5. Phased path

**Phase 0 — Decisions & spikes (no user-facing change).**
Pick auth + DB + host stack. Sign up for the aggregator sandbox (SnapTrade).
Throwaway spike: link a real brokerage in sandbox, pull holdings, map to
`Position[]`, and confirm the *existing* engine rebalances them unchanged. This
de-risks the whole effort cheaply and validates coverage of *your* brokerages.

**Phase 1 — Server foundation + auth, still CSV-only.**
Stand up API + DB + managed auth + invite gating. Move persistence to the server
(portfolio data encrypted at rest); `localStorage` becomes a cache; migrate the
existing local JSON in. No aggregator yet — this proves the account/sync plumbing
with the data source you already trust. Cross-device sync is the visible win.

**Phase 2 — Aggregator linking (the headline feature).**
Add the "Link account" flow, server-side token handling, holdings sync, and the
aggregator adapter. CSV import stays as fallback for uncovered institutions.
Ship to the invited beta.

**Phase 3 — Hardening for (optional) public launch.**
Rate limiting, abuse/fraud surface, ToS + privacy policy rewrite, security
review/pentest, incident response, backups/DR, cost controls on aggregator
usage, and the compliance posture a public financial tool needs.

---

## 6. The promise rewrite — treat as a first-class task, not a footnote

"No account required / no data leaves your browser" is **load-bearing marketing
and trust copy**: it appears on `LandingPage.tsx`, `README.md`, meta/OG tags,
and `ReminderPanel.tsx`, and is codified as an "inviolable" guardrail in
`CLAUDE.md` and a non-goal in `IMPLEMENTATION_PLAN.md`. Account linking directly
contradicts it. This is a deliberate, documented renegotiation:

- Update `CLAUDE.md`, `PRINCIPLES.md`, `IMPLEMENTATION_PLAN.md` guardrails to the
  new data-classification model (Drift already set this precedent with the
  analytics reframing in issue #168: "user data never leaves except where the
  user explicitly links and we encrypt at rest").
- Preserve a **local-only mode** as a first-class product tier so the original
  promise still holds for users who want it — linking becomes opt-in, not
  mandatory. This is both a trust move and a graceful-degradation story for
  uncovered brokerages.
- Rewrite public copy, add a real **privacy policy and ToS** (now legally
  necessary — you're a data controller handling financial PII), and be explicit
  about what the server can and cannot see.
- Relax the CSP (`connect-src`, `form-action`) *minimally* — allowlist only your
  own API origin and the aggregator's Link widget, nothing broader.

---

## 7. Costs, risks, and things that bite

- **Recurring cost from day one:** aggregator per-connection/per-user fees + DB +
  auth provider + hosting. Model this before the beta; aggregator costs scale
  with linked accounts.
- **Coverage gaps:** not every brokerage is supported by any single aggregator,
  and Fidelity in particular has been historically gated. CSV import must remain
  permanently — it's the fallback, not legacy.
- **You become a custodian of financial PII.** That's a security, legal, and
  operational responsibility Drift has deliberately avoided. Encryption at rest,
  token isolation, least-privilege DB access, audit logging, and a breach plan
  are table stakes, not phase-3 niceties.
- **Auth is where financial apps get breached** — use a managed provider; do not
  hand-roll.
- **Scope creep into custody/trading:** SnapTrade *can* place trades. Drift's
  principles are advice-only (it emits trade suggestions, never executes).
  Explicitly decide to stay read-only for the foreseeable future — executing
  trades is a categorically larger regulatory burden (potential
  broker-dealer/RIA implications). Recommend: **holdings read-only**, no trading.
- **Regulatory surface** grows sharply toward public launch and is arguably the
  biggest gating factor — bigger than the engineering. See §8.

---

## 8. Regulatory & compliance landscape

> Not legal advice. This maps the terrain; a fintech/securities lawyer must be
> consulted before charging money or opening public signups.

**The defining question — investment-adviser status.** Advice about securities,
for compensation, as a business can make Drift an **Investment Adviser** under
the Investment Advisers Act of 1940 (SEC) or state securities law. Rebalancing
recommendations are advice about securities. What decides it:
- *Personalized vs. generic.* The publisher's exemption (*Lowe v. SEC*) covers
  impersonal, general-audience publications — but advice tailored to a user's
  specific holdings cuts against it. Framing Drift as a "calculator the user
  drives" is a weaker advice claim than "Drift tells you what to trade," but
  **substance controls, not the label** — disclaimers don't cure functioning as
  an adviser.
- *For compensation.* A free beta doesn't meet this prong; a paid subscription
  does — a concrete reason to keep the beta free.
- *Where to register.* Roughly <$100M managed → state; ≥$100M → SEC. But
  "regulatory AUM" generally means assets managed/under discretion — a
  read-only, non-discretionary tool may have little or none, changing the
  analysis. This nuance is exactly what counsel is for.

**Cheapest risk-reducer — stay read-only & non-discretionary** (already a plan
boundary). It keeps Drift out of the heaviest regimes entirely:
- *Broker-dealer registration & custody rules* — triggered by executing trades
  or holding assets. Don't.
- *Money-transmitter / AML / KYC* — triggered by moving money. A non-custodial
  advice tool doesn't trigger these — a large burden skipped for free.

**Data-handling regulation (triggers the moment you store financial data):**
- *GLBA + FTC Safeguards Rule* — a fintech handling consumer financial data is
  likely a covered "financial institution." The 2023 Safeguards Rule mandates
  specifics: written infosec program, a designated qualified individual, access
  controls, **encryption**, **MFA**, incident response. Build-time table stakes
  — it directly shapes the auth/DB/token design in §3–4, not a Phase-3 add-on.
- *State privacy laws* — CCPA/CPRA and the growing patchwork (VA, CO, …):
  privacy-policy duties, access/deletion rights. GLBA-covered data is exempt
  from *some* but not all — don't assume blanket exemption.
- *State breach-notification laws* — all 50 states; need a breach response plan.
- *GDPR/UK GDPR* — much heavier. **Geofence the beta to US-only** to defer it.

**Contractual (flows down from the aggregator).** Plaid/Yodlee/SnapTrade impose
their own data-use limits, required consumer-consent language, security
standards, and deletion-on-request — binding regardless of statute, often
requiring specific in-UI disclosures.

**Consumer protection / truthfulness — FTC Act §5.** This is *why* the
privacy-promise rewrite (§6) is a legal matter: shipping account linking while
keeping "no data leaves your browser" copy is a textbook deceptive claim.
Privacy policy, ToS, and any performance language must be accurate. Standard
"informational only / not individualized advice / consult a professional"
disclaimers are necessary but not a substitute for correct adviser
classification.

**On the horizon.** CFPB §1033 (Personal Financial Data Rights / open banking)
is reshaping consumer-permissioned data access and consent — watch it; not
urgent for a beta.

**Practical posture for the invited beta:** free · US-only (geofenced) ·
read-only, non-discretionary · accurate privacy policy + ToS + disclaimers ·
FTC-Safeguards-grade security from day one · securities/fintech counsel engaged
on the adviser question before charging or opening signups. The free, invited,
read-only beta is the lowest-risk way to validate the product before taking on
the heavier obligations of a paid public launch.

---

## 9. Cost estimates

> Rough list-price estimates as of Oct 2026, for planning only. Free-tier
> limits and prices change often — check each vendor before committing. The
> assumed stack is Vercel + Supabase (Postgres + Auth + RLS) + SnapTrade.

### Fixed costs (paid whether you have 1 user or 1,000)

| Item | Free option | Paid tier | Notes |
|---|---|---|---|
| Hosting — Vercel | Hobby $0 | Pro ~$20/mo per seat | Hobby is for **non-commercial** use only; fine for B and A, move to Pro before charging or launching publicly |
| DB + Auth — Supabase | Free $0 | Pro ~$25/mo | Free tier: ~500 MB DB, ~50k MAU auth, **pauses after ~1 week of inactivity**, no automatic backups. Pro adds backups and no pausing — worth it once other people's data lives there |
| Separate auth (if not Supabase Auth) | Clerk free (~10k MAU) | ~$25/mo+ | Not needed if you use Supabase Auth |
| Domain | — | ~$12–20/yr | Optional for B; desirable for A |
| Transactional email (login links, drift alerts) | Resend/Postmark free tiers (~3k emails/mo) | ~$15–20/mo | Only matters once you send reminders |
| Error monitoring | Sentry free tier | ~$26/mo | Free tier is plenty for a beta |

### Scaling costs (grow with users)

| Driver | Unit cost | Notes |
|---|---|---|
| **SnapTrade Commercial** | ~$2 / connected user / month after the 5-connection free tier | The dominant scaling cost — about 90% of variable spend at any size |
| Supabase overages | Small | Portfolio state is tiny (KB per user); you hit pricing on MAU or compute well before storage |
| Vercel function invocations / bandwidth | Small | Pro includes generous quotas; scheduled sync jobs are the main consumer |
| Email | ~$0.001 / email | Scales with reminder frequency |

### What each scenario costs

| Scenario | Users | Est. monthly cost | What drives it |
|---|---|---|---|
| **Appendix B** — just you, hosted | 1 | **~$0** (+ domain ~$1/mo) | SnapTrade Personal free; Vercel Hobby; Supabase Free (accept pausing) |
| **Appendix A** — closed beta, tiny | ≤ 5 connections | **~$0–25** | SnapTrade free tier; $25 if you upgrade Supabase to Pro for backups (recommended once friends' data is in it) |
| **Appendix A** — closed beta, realistic | ~10–25 users | **~$45–95** | Supabase Pro $25 + Vercel Pro $20 (if you want commercial-safe hosting) + SnapTrade ~$20–50 |
| **Public product, early** | ~250 users | **~$600–700** | SnapTrade ~$500 + fixed ~$100 |
| **Public product, growing** | ~1,000 users | **~$2,100–2,300** | SnapTrade ~$2,000 + fixed ~$100–300 |

**Takeaways:**
- **Fixed infra is cheap:** about $0–100/mo across every scenario. The free
  tiers carry B and a tiny A.
- **SnapTrade is the cost curve:** about $2 per active user per month. If Drift
  ever charges, pricing has to clear that plus processor fees. A $3–5/mo plan
  leaves a thin margin; annual billing or a free tier with CSV-only import would
  help.
- **One-time and non-infra costs show up at the public step, not before:**
  securities/fintech counsel (est. a few thousand dollars for an initial
  opinion), a privacy policy and ToS review, and possibly cyber/E&O insurance
  (est. ~$1–3k/yr). None of these are needed for B, and only the lightweight
  versions are needed for A (§8).
- **Cost control levers:** invite caps, only syncing connected users who were
  active recently, and keeping CSV import as a free path.

---

## 10. What stays unchanged (the good news)

- `src/engine/` — pure, network-free, unchanged. Its purity is now an *asset*:
  the same module runs client-side (interactive) and server-side (automation).
- The ingest normalization pattern and per-broker adapter structure — reused as
  the template for the aggregator adapter.
- `src/store.ts` as the single persistence seam — becomes a sync client behind
  the same interface, so UI callers barely change.
- The whole tab-based UI workflow — gains a login gate and a "Link account"
  entry point, but the six panels and their logic are untouched.
- CSV import — stays as a first-class, permanent input path.

---

## Verification (for when a build phase actually begins)

This is an exploratory doc, so "verification" here means how to prove each phase
before moving on — not test commands to run now:

- **Phase 0 spike:** in aggregator sandbox, link a test brokerage → pull
  holdings → transform to `Position[]` → feed to `rebalance(...)` → confirm the
  result matches what the same holdings produce via CSV import today. Existing
  `npm test` engine suite must stay green with the new adapter output.
- **Phase 1:** create two beta users, confirm strict per-user data isolation
  (user A can never read user B's `AppState`), confirm `localStorage` → server
  migration round-trips an existing portfolio, confirm CSP allows only the API
  origin. Add auth/isolation integration tests.
- **Phase 2:** end-to-end link → sync → rebalance in the real UI; confirm access
  tokens never appear in any client response or browser storage (inspect network
  + `localStorage`); confirm `lastUpdatedAt` freshness reflects real sync times;
  confirm CSV fallback still works for an unlinked account.
- **Cross-cutting:** run the existing `security-review` skill on each backend PR;
  keep `.github/workflows/ci.yml` green; add regression scenarios per the repo's
  test-hygiene rule for any engine-visible behavior change.

## Open decisions to settle before Phase 0 → 1

1. Stack: Supabase-all-in-one vs. Vercel-functions + separate auth/DB.
2. Confirm **read-only holdings, no trading** as a hard product boundary.
3. Confirm **local-only mode stays** as a permanent opt-in tier.
4. Budget ceiling for aggregator + infra during the beta (drives connection
   caps / invite count).
5. Engage securities/fintech counsel on the investment-adviser question (§8)
   before charging money or opening public signups; confirm the beta stays
   **free, US-only (geofenced), read-only** to minimize regulatory exposure
   during validation.

---

## Appendix A: Closed-beta MVP (invited friends & family, web-hosted)

The smallest version worth building that still proves the real thing:
**web-hosted, multi-user, but invitation-only** — a handful of people you know,
not a public product. Web-hosted (not local) because it unlocks a mobile
interface and multi-device access, which need a server. This is the **lean floor
of the §1–§5 plan**, not a different architecture: it builds the genuine
multi-user foundation (auth + per-user isolation) so the path to a public
product later is "harden and scale," not "re-architect."

### What makes it "closed beta," not "just me"
The defining difference from a true single-user instance: **other real people's
financial data lives in your database.** That one fact is why you build actual
multi-user support now — and why a *light* version of the data-handling
obligations (not the single-user "skip entirely") applies.

### What you build now (the real multi-user basics)
- **A user concept + managed auth.** Use a provider (Clerk / Supabase Auth /
  Auth0) — do not hand-roll (§7). Email login + MFA is enough; no need for
  org/team/role complexity.
- **Invite gating.** An allowlist (or invite codes) so it is *closed* — not open
  signup. This is the single most important scoping lever: it caps users,
  aggregator cost, and exposure while you learn.
- **Per-user data isolation in the DB — the core of this MVP.** Every row keyed
  by `user_id`; enforce isolation at the database layer, not just in app code.
  If using Supabase/Postgres, **Row-Level Security policies** so a user can only
  ever read/write their own `AppState`, linked-account refs, and tokens. This is
  the piece that must be correct from day one and is the hardest to retrofit —
  get it right now.
- **Per-user aggregator tokens, server-side**, isolated by the same `user_id`
  scoping and encrypted at rest (§3). Never returned to any client.

### What stays light (because it's small, free & invited)
- **Regulatory (§8) stays low, not zero.** Free + no compensation keeps you
  clear of the investment-adviser "for compensation" prong; invited + US-only
  (geofence) defers GDPR and public-launch scrutiny. But with others' data you
  should still do a *basic* version of: a short **privacy notice + light ToS**,
  FTC-Safeguards-*style* security hygiene (encryption, MFA, access control — you
  largely get these from the managed auth + RLS above), and a breach-response
  plan in note form. Treat these as prudent, lightweight, and explicitly *not*
  the full §8 public-launch program — which still waits until you charge or open
  signups, and still needs counsel then.
- **Skip for now:** org/role models, rate-limiting/abuse surface, horizontal
  scale, SSO, audit-grade logging, formal compliance attestations. Add in
  Phase 3 if you go public.

### What's identical to the main plan
- The **aggregator adapter** producing the existing `Position[]` shape (§4D) —
  engine and UI untouched. (Individual-access friction and the
  official-broker-API alternative from §2/§7 apply unchanged.)
- The **engine** runs client-side for interactivity; the server now also runs
  the identical module for scheduled drift checks / mobile push (§3).
- **CSV import** stays as a permanent fallback for uncovered brokerages.

### Scope
This is essentially a **lean Phase 1 + scoped Phase 2**: the server + DB + auth
foundation (Phase 1), with per-user isolation done properly, plus aggregator
linking (Phase 2) — all behind an invite wall. You defer Phase 3's
public-hardening and the paid-launch legal review. Because the multi-user
foundation is real (not a single-tenant shortcut), going public later is an
extension of this, not a rewrite.

### Even-lighter option, deliberately set aside
A true *single-user* instance (Appendix B: lock the whole deployment to you via
Cloudflare Access / a single credential, single-tenant DB, no user table) would
be smaller still — but it builds none of the multi-user foundation, so friends/family and
a later public product would mean re-architecting. Recorded here as the path
*not* taken, since the goal is a beta others can use.

---

## Appendix B: Personal-use-only variant (single-user, web-hosted)

> **Aggregator fit:** this is exactly what **SnapTrade Personal** is for — free,
> up to 20 brokerage connections, your own accounts only. Its Personal key must
> not be shared with or used for anyone else, so this variant cannot grow into
> Appendix A without switching to a Commercial key (see §2, costs in §9).

A distinct, much smaller target: Drift synced with **your own** accounts, for
**you alone**, but still **web-hosted** so you get a mobile interface and
multi-device access. This is not a step on the path to the public product — it's
an alternative endpoint. It can also serve as a *personal dogfooding instance*
that de-risks the beta later.

### Why most of the main plan's weight disappears
The heavy parts of §1–§8 come from *multi-tenancy*, *public exposure*, and being
*a business advising others for compensation*. With exactly one user (you) and
no compensation, these fall away:
- **Investment-adviser regulation (§8):** you advise only yourself — not an
  adviser. Gone.
- **GLBA/FTC Safeguards, CCPA/GDPR, breach-notification, ToS, privacy policy:**
  all concern *other people's* data. No other data subjects → not applicable.
- **The public promise rewrite (§6):** it's your own copy on your own instance;
  no one to mislead. Adjust the wording for yourself, or drop it.
- **Managed auth, multi-tenant isolation, invite gating, abuse surface:** no
  other users to authenticate, isolate, or rate-limit.

### What you still need (because it's hosted, not local)
Choosing web-hosted over the local-first option (which would need none of a
hosted server/DB) is a deliberate trade: you accept a little infra to unlock
mobile + multi-device. What that requires:
- **A server** — small: aggregator token custody + token exchange + holdings
  pull + serving your `AppState`. Vercel functions (`api/`) fit the existing
  deploy; a single small service (Fly/Render) also works.
- **A database** — one managed Postgres/SQLite-in-the-cloud, but **single-tenant**:
  no per-user partitioning, row-level security, or user table needed. Just your
  rows. Encrypt at rest anyway (cheap, sensible).
- **"Auth" = lock the instance to you, not a user system.** No signup, no
  password reset, no accounts. Options, simplest first: Cloudflare Access /
  Vercel password protection / Tailscale-only exposure in front of the whole
  app, or a single hardcoded credential. The engine and UI don't change.
- **Aggregator tokens still server-side** — same as the main plan (contractual +
  hygiene), which the hosted server already provides a home for.

### What stays identical to the main plan
- The **aggregator adapter** producing the existing `Position[]` shape (§4D) —
  engine and UI untouched.
- The **engine** runs client-side for interactivity; the hosted server lets you
  *also* run the identical module for scheduled drift checks / mobile push
  reminders (§3) — a natural fit once a server exists.
- **CSV import** stays as a permanent fallback for uncovered brokerages.

### Aggregator access: largely solved by SnapTrade Personal
Individual access used to be the real gate, because most aggregators target
businesses. SnapTrade Personal removes it for this variant: free, 20
connections, built for software you run for yourself. The remaining risks are
coverage of your specific brokerages (check during the Phase 0 spike) and tier
terms changing. The **direct-broker-API** route (official, documented broker
APIs such as Schwab's individual API — never reverse-engineered, per CLAUDE.md)
remains a fallback for any brokerage SnapTrade doesn't cover.

### Scope vs. the main plan
Effectively **Phase 0 (spike) + a scoped Phase 2 (linking)**, hosted. You skip
Phase 1's auth/user system and Phase 3's compliance/hardening almost entirely.
Residual cost is about $0/mo (§9). The residual risk is brokerage coverage, not
law or engineering.

### Local-first alternative (for contrast)
If mobile/multi-device weren't required, a **local helper process** (SPA +
~100-line local Node service holding tokens in the OS keychain / a gitignored
`*.local.json`, already git-ignored by the repo) would need *no* hosted server,
DB, or auth at all, and keep all data on your machine. Recorded here as the
even-lighter option deliberately set aside in favor of web-hosted access.
