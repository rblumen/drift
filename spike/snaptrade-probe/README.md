# SnapTrade coverage probe (spike, never merged)

Throwaway local tool for v1 milestone **M0** (#239, #246). It answers one
question: does SnapTrade return what Drift needs for real accounts,
especially workplace 401(k)s? It is a local dev tool, not part of the app.
It sits outside `src/`, the app's tests and its build, and lives only on the
`spike/snaptrade-probe` branch.

## What it does

| Command | Does |
|---|---|
| `brokerages [--filter text]` | Lists the institutions SnapTrade supports (public reference data) |
| `connect [--broker SLUG]` | Prints a **read-only** connection-portal link, waits while you link accounts, then runs `report` |
| `report [--raw]` | Fetches connections, accounts, and each account's positions and balances, and prints a **masked** coverage report |
| `cleanup [--yes]` | Removes the linked connections (Personal key) or deletes the probe user (Commercial key) |

The masked report prints structure only:
- institution, account type and category
- which fields are present or null
- security type codes
- how ticker-less funds are identified (shapes such as `CUSIP-like`, `FIGI-like`, `free text (41 chars)`)
- how cash is represented
- every key path seen in the responses

It never prints amounts, account names or numbers, person names, tickers,
fund descriptions, or IDs. `report.test.mjs` checks this against synthetic
data.

`--raw` also writes the full, unmasked responses to
`private/snaptrade-probe/raw-<timestamp>.json`. `private/` is git-ignored,
and the script refuses to write if it isn't. Use raw output to fill in the
private coverage list (#247), then delete it.

Connections are always requested as `connectionType: 'read'` (spec D4). The
script never calls trading endpoints.

## Setup

Needs Node 22.9+.

```bash
cd spike/snaptrade-probe
npm install --ignore-scripts
```

Credentials come from environment variables only and are never printed:

| Variable | Value |
|---|---|
| `SNAPTRADE_CLIENT_ID` | From the SnapTrade dashboard |
| `SNAPTRADE_CONSUMER_KEY` | From the SnapTrade dashboard. Secret |
| `SNAPTRADE_MODE` | `personal` (default) or `commercial` |

Either export them in your shell or put them in
`private/snaptrade-probe.env` at the repo root (git-ignored), which `npm run
probe` loads automatically:

```
SNAPTRADE_CLIENT_ID=...
SNAPTRADE_CONSUMER_KEY=...
```

The source of truth for the key is the project vault in the password manager.
Delete the `.env` file when the spike is done.

## Run

```bash
npm run probe -- brokerages --filter <name>
npm run probe -- connect
npm run probe -- report --raw
```

`connect` prints a single-use portal link that expires in a few minutes.
Treat it as a secret. Link one institution at a time if you want to see
per-institution errors clearly. Run `connect --broker <SLUG>` to jump straight
to one institution (slugs come from `brokerages`).

SnapTrade may rate-limit Personal keys at 10 requests per minute per account.
The script makes two calls per account (positions, balances) and backs off on 429.

## Clean up

```bash
npm run probe -- cleanup
```

Then delete `private/snaptrade-probe/` and `private/snaptrade-probe.env`. With
a Personal key the key itself remains; revoke it in the SnapTrade dashboard if
you no longer need it.

## Key types

- **Personal key (default):** the key is its own SnapTrade user. There is no
  user to register or delete, and calls carry no `userId`/`userSecret`.
- **Commercial key (`SNAPTRADE_MODE=commercial`):** registers a
  `drift-probe-<uuid>` user on first `connect`, stores its `userSecret` in
  `private/snaptrade-probe/commercial-user.json`, and deletes the user on
  `cleanup`. This mirrors how the beta will work (spec §6). It uses one of
  the 5 free connected users while the probe user exists.

## Public repo

Never paste raw output, or a masked report that names your institutions, into
an issue, PR or commit. Post only generic results to #247 (e.g. "taxable/IRA:
pass; 401(k) recordkeeper A: fail").

## Tests

```bash
npm test
```

These use `fixtures/synthetic.json`, which is synthetic data shaped like SDK
13.2.2 responses, with sentinel values the masked report must never contain.

## Notes for the spec (§6.1)

From the SDK 13.2.2 types and a first real run:
- **`getUserHoldings` is retired for new customers.** It returns HTTP 410 for
  anyone who signed up after 2026-05-11. Use `getAllAccountPositions`
  (positions) plus `getUserAccountBalance` (balances); `getAccountBalancesV2`
  is beta and needs enabling by SnapTrade.
- Positions are `results[]` with an `instrument.kind` discriminator: `stock`,
  `etf`, `mutualfund`, `cef`, `bond`, `other`, `cash`, `option` and others.
  Cash can arrive as a `kind: cash` position.
- `units`, `price` and `cost_basis` are **strings**, and so are the
  `tax_lots[]` fields. Tax lots appear only when tax-lot data is enabled for
  the account.
- **No CUSIP field.** Securities carry `symbol`, `raw_symbol`, `description`
  and `figi_instrument.figi_code`. Ticker-less funds may surface their CUSIP
  through `raw_symbol`; the probe reports which.
- Real accounts return fields the SDK types omit (e.g. top-level
  `is_paper`, `cash_restrictions`, `raw_data`), and `status` can be null.
  The adapter's minimal local type should tolerate both.
