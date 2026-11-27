# Runbook: M3 vendor setup

**For:** you (👤), the setup tasks in
[build plan](build-plan-account-linking.md) §3, rows 5–10 and 16a–16b ·
**Implements:** spec D11–D13, D17–D19, D21, §7, §8 · **Cost:** $0 (every vendor
here is on a free tier)

Work top to bottom: later steps need values from earlier ones. Each step ends
with a **Check** you can confirm on your own.

Ground rules for the whole runbook:
- **Log in as the project Gmail** for every vendor. Turn on 2FA wherever it's
  offered and save recovery codes in the Drift vault in Bitwarden.
- **Secrets go only to Bitwarden and the vendor or Vercel dashboard.** They
  never go into the repo, an issue, a PR, a terminal transcript you share, or chat (with
  Claude included). The key-generation commands below copy to the clipboard
  instead of printing.
- **Staging and production never share a secret.** Each gets its own value.
- Dashboard menus move around. If a setting isn't where it says, search the
  vendor's docs for the setting name in **bold**.

Env var names here are the plan of record. The M3 scaffolding PR reads exactly
these names; if it needs to change one, it updates this file.

---

## 0. Before you start

| Need | Notes |
|---|---|
| Bitwarden Drift vault | Create one folder per vendor: Supabase, Resend, Sentry, Vercel, GitHub, Keys |
| Cloudflare | `bayleaflabs.com` already registered, DNS on Cloudflare (M0a) |
| Vercel | The existing Drift project, still on Hobby. Pro comes at M7 (checklist 13) |
| Node 20+ | To run the key-generation commands in §6 |

---

## 1. Supabase: two projects (checklist 5)

### 1.1 Organization and projects
1. Create (or reuse) a Supabase organization on the **Free** plan, owned by the
   project Gmail. Turn on **MFA** for your Supabase user.
2. Create two projects in that org:

   | Setting | `drift-staging` | `drift-prod` |
   |---|---|---|
   | Region | **East US (North Virginia)** | **East US (North Virginia)** |
   | Database password | Generate it, save it in Bitwarden | Generate it, save it in Bitwarden |
   | Data API | On | On |

   The region must match the Vercel function region (`iad1`, §5.3), per spec §6.2.
3. Note each project's **Project URL** (`https://<ref>.supabase.co`) and
   **project ref** in Bitwarden. These aren't secrets, but keep them together.

> The free plan allows two active projects (exactly these two) and **pauses a
> project after 7 days with no activity**. The daily Vercel Cron to `/health`
> (M3) touches the database to keep production awake. If staging pauses,
> restore it from the dashboard.

### 1.2 API keys (D17), in each project
**Project Settings → API Keys:**
1. Create a **publishable key** (`sb_publishable_…`), for the browser.
2. Create a **secret key** (`sb_secret_…`) named `vercel-functions`, for the server.
3. Leave the legacy `anon` / `service_role` keys alone for now. After M4 ships
   and nothing uses them, **disable the legacy keys**. Drift never uses them.

### 1.3 JWT signing keys (D17), in each project
**Project Settings → JWT Keys:**
1. **Migrate to asymmetric JWT signing keys**, choosing **ECC (P-256)**.
2. Rotate so the new asymmetric key is **current**. The old shared secret stays
   as a "previously used" key until existing sessions expire. Then revoke it.
3. **Check:** `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` returns
   one key with `"kty":"EC"`. Functions verify tokens against this URL.

### 1.4 Auth settings, in each project
**Authentication → Sign In / Providers:**

| Setting | Value | Why |
|---|---|---|
| **Allow new users to sign up** | **Off** | Invite-only until Gate 2 (D6) |
| **Email** provider | On | Password + magic link (D5) |
| **Confirm email** | On | |
| **Secure email change** | On | Confirms both the old and the new address |
| **Secure password change** | On | |
| Minimum password length | 10 | |
| **Leaked password protection** | On if your plan offers it (it's a Pro feature); skip otherwise | |
| Phone, OAuth, anonymous sign-ins | Off | |

**Authentication → Multi-Factor:** **TOTP** enabled (opt-in, D5). Other factors off.

**Authentication → URL Configuration:**

| Setting | `drift-staging` | `drift-prod` |
|---|---|---|
| **Site URL** | `http://localhost:5173` | `https://drift.bayleaflabs.com` |
| **Redirect URLs** | `http://localhost:5173/**` and `https://*-<your-vercel-team-slug>.vercel.app/**` | `https://drift.bayleaflabs.com/**` only |

Preview URLs are allowed in staging only (D19). Production never accepts a
`vercel.app` or `localhost` redirect.

**Authentication → Sessions:** leave the defaults. Auth cookies and storage are
scoped to `drift.bayleaflabs.com` by the client code, not here (D13).

### 1.5 Data API exposure, in each project
**Project Settings → Data API → Exposed schemas:** `public` only. The `private`
schema (where `private.household_role` lives) must **not** be exposed.

### 1.6 Database connection string (for the migration workflow, §7)
**Connect → Session pooler** (not the transaction pooler, which doesn't suit
migrations). Copy the URI, insert the database password, and save it in
Bitwarden as `drift-staging DB URL` / `drift-prod DB URL`. It goes into
GitHub in §7 and nowhere else.

**Check (Supabase):** both projects exist in East US, signups are off, the JWKS URL
returns an EC key, and production's redirect list has only the `drift.` URL.

---

## 2. Resend: transactional email (checklist 6)

1. Create a Resend account with the project Gmail and turn on 2FA.
2. **Domains → Add domain:** `mail.bayleaflabs.com`, region **us-east-1**.
   Resend shows three or four DNS records (MX + TXT for `send.mail`, and a
   DKIM TXT at `resend._domainkey.mail`). Keep the tab open for §4.
3. On the domain's settings: **Click tracking off, Open tracking off** (D11).
4. **API Keys → Create:** two keys, each **Sending access**, restricted to
   `mail.bayleaflabs.com`:
   - `drift-staging-smtp-and-api`
   - `drift-prod-smtp-and-api`

   Save both in Bitwarden. Each serves as both the SMTP password (§2.5) and
   `RESEND_API_KEY` (§6) for its environment.
5. Once the domain verifies (after §4), in **each Supabase project →
   Authentication → Emails → SMTP Settings → Enable custom SMTP**:

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@mail.bayleaflabs.com` |
   | Sender name | `Drift` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | that environment's Resend key |

6. **Authentication → Rate Limits:** after custom SMTP is on, set **emails sent
   per hour** to `30` (default is low; Resend's free tier allows 100/day, 3,000/month).
   Spec §7 asks you to confirm this in M3.

`news.bayleaflabs.com` (announcements) waits until M7 (checklist 15).

**Check (Resend):** after §4, the domain shows **Verified** and both Supabase projects
show custom SMTP enabled.

---

## 3. Sentry: server errors (checklist 8)

1. Create a Sentry account (Developer plan, free) with the project Gmail; turn
   on 2FA. Organization data region: **US**.
2. **Create project:** platform **Node.js**, name `drift-api`. One project for both
   environments; events carry an `environment` tag (`staging` / `production`).
3. **Project Settings → Security & Privacy:**

   | Setting | Value |
   |---|---|
   | **Data Scrubber** | On |
   | **Use Default Scrubbers** | On |
   | **Prevent Storing of IP Addresses** | On |
   | **Additional sensitive fields** | `ticker`, `symbol`, `market_value`, `units`, `balance`, `cost_basis`, `account_name`, `email` |

   This backs up the code-side `beforeSend` (D21). It doesn't replace it.
4. **Alerts:** keep the default "new issue" email alert to the project Gmail.
5. Copy the **DSN** (Project Settings → Client Keys). It's low-sensitivity, but
   it still goes in env vars, not the repo.

**Check (Sentry):** the project exists and the scrubbing settings are saved. The first real
event arrives when the M3 `/health` scaffolding deploys.

---

## 4. Cloudflare: DNS and Email Routing (checklist 7)

### 4.1 Records
**Cloudflare → bayleaflabs.com → DNS → Records.** Every record is **DNS only**
(grey cloud). Copy exact values from the vendor dashboards where noted.

| Type | Name | Value | Source |
|---|---|---|---|
| CNAME | `drift` | Target shown by Vercel when you add the domain (§5.2), e.g. `….vercel-dns-0xx.com` | Vercel |
| MX | `send.mail` | `feedback-smtp.us-east-1.amazonses.com`, priority 10 | Resend |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | Resend |
| TXT | `resend._domainkey.mail` | `p=MIIB…` (long DKIM key) | Resend |
| TXT | `_dmarc` | From **Cloudflare → Email → DMARC Management** (see below) | Cloudflare |
| MX / TXT | `@` | Added automatically by Email Routing (§4.2) | Cloudflare |

If Resend's dashboard shows different values from this table, **use Resend's**.
The table shows the expected shape, not the authority.

**DMARC:** enable **DMARC Management** (free). It creates the `_dmarc` record
with a Cloudflare reporting address. Make sure the policy reads
`v=DMARC1; p=none; rua=mailto:<cloudflare address>` (spec §7: start at `p=none`
with reports). It applies to `mail.` and `news.` as subdomains. Tighten to
`p=quarantine` after a few weeks of clean reports (a later task, not M3).

### 4.2 Email Routing: `support@` (D12)
1. **Email → Email Routing → Get started.** Let it add its MX and SPF records
   at the apex.
2. **Destination addresses:** add the project Gmail and click the verification
   link it receives.
3. **Routing rules → Custom address:** `support@bayleaflabs.com` → project Gmail.
4. Leave **Catch-all** off.

**Check (Cloudflare):**
- Resend's domain page turns **Verified** (allow up to an hour);
- `support@bayleaflabs.com` mail from a different account lands in the project
  Gmail (M3 exit criterion).

---

## 5. Vercel (checklists 9 and 16b)

### 5.1 Account security
Turn on 2FA for the Vercel account if it isn't already on, and save the recovery codes in Bitwarden.

### 5.2 Domain
**Project → Settings → Domains → Add** `drift.bayleaflabs.com` (production).
Vercel shows the CNAME target. Add it in Cloudflare (§4.1, **DNS only**), then
wait for **Valid Configuration** and the certificate. Leave the existing
`*.vercel.app` production URL as is.

### 5.3 Functions region
**Project → Settings → Functions → Function Region:** **Washington, D.C., USA
(iad1)**, matching Supabase East US. The M3 PR may also pin it in
`vercel.json`. Either place is fine, as long as they agree.

### 5.4 Deployment Protection (16b)
**Project → Settings → Deployment Protection → Vercel Authentication:** on, for
**Standard Protection** (all previews protected; production stays public).
Preview URLs appear publicly on PRs, so this matters once previews hold a staging
login.

### 5.5 Environment variables
**Project → Settings → Environment Variables.** Mark every non-`VITE_` value
**Sensitive** (Vercel then never shows it again; Bitwarden is the copy).

| Name | Preview (→ staging) | Production (→ prod) | Browser? | Needed by |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | staging Project URL | prod Project URL | yes | M3 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | staging `sb_publishable_…` | prod `sb_publishable_…` | yes | M3 |
| `SUPABASE_URL` | staging Project URL | prod Project URL | no | M3 |
| `SUPABASE_SECRET_KEY` | staging `sb_secret_…` | prod `sb_secret_…` | no | M3 |
| `DRIFT_ENV` | `staging` | `production` | no | M3 (`/health` reports it) |
| `RESEND_API_KEY` | staging Resend key | prod Resend key | no | M3 |
| `SENTRY_DSN` | the DSN | the DSN | no | M3 |
| `TICKER_REF_KEY` | generate (§6) | generate (§6) | no | M3 |
| `TOKEN_ENC_KEYS` | generate (§6) | generate (§6) | no | M3 (used from M5) |
| `CRON_SECRET` | generate (§6) | generate (§6) | no | M3 (`/health` cron), M6c |
| `SNAPTRADE_MODE` | `personal` | `personal` | no | M5 |
| `SNAPTRADE_CLIENT_ID` | — | Personal key client ID | no | M5 |
| `SNAPTRADE_CONSUMER_KEY` | — | Personal key consumer key | no | M5 |
| `SNAPTRADE_PERSONAL_OWNER` | — | your production Drift user ID | no | M5, after M4 creates your user |

Rules:
- **Only the two `VITE_` names may be `VITE_`-prefixed** (spec §8). Anything
  `VITE_` ships to every browser.
- **Development** environment: leave it empty. Local dev uses `supabase start`
  and a git-ignored `.env.local` the M3 PR documents.
- SnapTrade stays **production-only**. Previews talk to a mocked SnapTrade, and real
  brokerage data lives only in production (D19). The SnapTrade rows can wait until M5.

### 5.6 Plan limits to confirm (M3 🤝 row)
On the Hobby plan's **Usage** / docs page, note the following in a PR comment on the M3 scaffolding PR:
- **max function duration** (the sync budget of 45 s must sit under it, §6.2);
- **runtime log retention** (expected to be short, §8);
- **Cron frequency** (Hobby allows daily jobs, which is all M3 and M6c need).

**Check (Vercel):** `https://drift.bayleaflabs.com` serves today's app over HTTPS; a
preview URL asks for Vercel login; the env var list matches the table, with
nothing secret in a `VITE_` name.

---

## 6. Generating keys (checklist 9)

Run each command **once per environment** in PowerShell. Each one puts the
value on your clipboard without printing it. Paste it straight into Vercel,
then into Bitwarden, then clear the clipboard. Bitwarden entries: `TOKEN_ENC_KEYS
(staging)`, `TOKEN_ENC_KEYS (prod)`, and so on.

`TOKEN_ENC_KEYS` (versioned keyring, starts at `v1`):

```powershell
node -e "process.stdout.write('v1:' + require('crypto').randomBytes(32).toString('base64'))" | Set-Clipboard
```

`TICKER_REF_KEY`:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | Set-Clipboard
```

`CRON_SECRET`:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | Set-Clipboard
```

What each key means for you:
- **`TOKEN_ENC_KEYS` (prod):** if this key is lost, every stored SnapTrade
  secret is unreadable and you have to re-link. **Its only backup is in Bitwarden.**
  Rotation adds `v2:…` after `v1:…` (comma-separated) and runs the
  re-encryption script. Never delete a version that is still in use.
- **`TICKER_REF_KEY` (prod):** keep it stable. Changing it changes every ref, so
  old logs and Sentry issues stop matching new ones. `scripts/admin/ticker-ref.ts`
  reads it from your local environment when you run it.
- **`CRON_SECRET`:** Vercel Cron sends it as `Authorization: Bearer …`. Safe to
  rotate any time.

---

## 7. GitHub (checklists 10 and 16a)

**Repo → Settings → Environments:**

| Environment | Protection | Secret |
|---|---|---|
| `staging` | none | `SUPABASE_DB_URL` = staging session-pooler URI (§1.6) |
| `production` | **Required reviewers: you**; **Deployment branches: `main` only**; **Prevent self-review** off (you're the only reviewer) | `SUPABASE_DB_URL` = prod session-pooler URI |

- Put these as **environment secrets**, not repository secrets, so the
  production URI is released only after your approval.
- Use database URIs, not a Supabase personal access token. A token reaches every
  project in the account, while a URI reaches one database.
- Secret scanning and push protection are already on (#251). This step
  finishes #251's `production` environment item.

**Check (GitHub):** both environments exist; `production` shows you as required reviewer.
The migration workflow itself arrives in an M3 PR, and you trigger it for staging,
then production.

---

## 8. Done when

- [ ] Supabase: both projects in East US; signups off; asymmetric JWT keys current; TOTP on; custom SMTP on; email rate limit set
- [ ] Resend: `mail.bayleaflabs.com` verified; tracking off; two sending keys
- [ ] Cloudflare: Vercel CNAME, Resend records, DMARC `p=none`, Email Routing `support@` → project Gmail
- [ ] Sentry: `drift-api` project with scrubbing on
- [ ] Vercel: `drift.bayleaflabs.com` live; region `iad1`; preview protection on; M3 env vars set for Preview and Production
- [ ] Keys generated per environment and backed up in Bitwarden
- [ ] GitHub: `staging` and `production` environments with `SUPABASE_DB_URL`
- [ ] Bitwarden holds every value from this runbook, and nothing is anywhere else

Then tell the agent "M3 setup done". The M3 PRs (migrations, `api/v1/`
scaffolding, templates, CI) take it from there. The remaining 👤 exit checks
(a test auth email with SPF/DKIM/DMARC passing, and `/health` naming the right
environment) happen once those PRs land.
