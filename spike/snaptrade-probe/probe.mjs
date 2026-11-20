#!/usr/bin/env node
// SnapTrade coverage probe (v1 spike M0, issue #246). THROWAWAY: never merged.
//
//   npm run probe -- brokerages [--filter <text>]   list institutions SnapTrade supports
//   npm run probe -- connect [--broker <slug>]      print a read-only connection-portal URL
//   npm run probe -- report [--raw]                 masked coverage report (raw JSON only with --raw)
//   npm run probe -- cleanup [--yes]                remove connections (and the user, commercial mode)
//
// Credentials come from env vars only and are never printed. See README.md.

import { Snaptrade, SnaptradeAuth } from 'snaptrade-typescript-sdk';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { buildReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PRIVATE_DIR = join(REPO_ROOT, 'private', 'snaptrade-probe');
const USER_FILE = join(PRIVATE_DIR, 'commercial-user.json');

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

function fail(msg) { console.error(`error: ${msg}`); process.exit(1); }

// ---------------------------------------------------------------- client

const MODE = (process.env.SNAPTRADE_MODE ?? 'personal').toLowerCase();
if (!['personal', 'commercial'].includes(MODE)) fail('SNAPTRADE_MODE must be "personal" or "commercial"');

function client() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) {
    fail('set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY (env vars or private/snaptrade-probe.env)');
  }
  const auth = MODE === 'commercial'
    ? SnaptradeAuth.commercialApiKey({ clientId, consumerKey })
    : SnaptradeAuth.personalApiKey({ clientId, consumerKey });
  return new Snaptrade({ auth });
}

/** Commercial mode needs a SnapTrade user; personal keys are their own user. */
async function userCreds(st, { create = false } = {}) {
  if (MODE === 'personal') return {};
  if (existsSync(USER_FILE)) return JSON.parse(readFileSync(USER_FILE, 'utf8'));
  if (!create) fail('no probe user yet; run `connect` first');
  const { data } = await call(() => st.authentication.registerSnapTradeUser({ userId: `drift-probe-${randomUUID()}` }));
  ensurePrivateDir();
  writeFileSync(USER_FILE, JSON.stringify({ userId: data.userId, userSecret: data.userSecret }, null, 2));
  console.log(`Registered a SnapTrade probe user (credentials saved under private/; not printed).`);
  return { userId: data.userId, userSecret: data.userSecret };
}

// Print only status/code/detail from API errors. The full error object holds
// request config (signed URL, headers), so it is never logged.
async function call(fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      if (status === 429 && attempt < retries) {
        const wait = 15 * (attempt + 1);
        console.error(`  rate limited (429); waiting ${wait}s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new ProbeError(describeError(e));
    }
  }
}
class ProbeError extends Error {}
function describeError(e) {
  const status = e?.status ?? e?.response?.status ?? '?';
  const body = e?.responseBody ?? e?.response?.data;
  const code = body?.code ?? e?.code ?? '';
  const detail = typeof body?.detail === 'string' ? body.detail
    : typeof body?.message === 'string' ? body.message : '';
  return `HTTP ${status}${code ? ` ${code}` : ''}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
}

// ---------------------------------------------------------------- raw output

function ensurePrivateDir() {
  // Refuse to write anywhere that git could pick up.
  const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  if (!/^\/private\/\s*$/m.test(gitignore)) fail('/private/ is not in .gitignore; refusing to write output');
  mkdirSync(PRIVATE_DIR, { recursive: true });
}

function writeRaw(data) {
  ensurePrivateDir();
  const file = join(PRIVATE_DIR, `raw-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

// ---------------------------------------------------------------- commands

async function brokerages() {
  const st = client();
  const { data } = await call(() => st.referenceData.listAllBrokerages());
  const filter = opt('filter')?.toLowerCase();
  const rows = data
    .filter((b) => !filter || `${b.display_name} ${b.name} ${b.slug}`.toLowerCase().includes(filter))
    .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''));
  console.log(`${rows.length} of ${data.length} brokerages\n`);
  for (const b of rows) {
    const flags = [b.enabled ? 'enabled' : 'DISABLED', b.maintenance_mode && 'maintenance', b.is_degraded && 'degraded',
      b.has_reporting === false && 'no-reporting'].filter(Boolean).join(', ');
    console.log(`  ${b.display_name}  [${b.slug}]  type=${b.brokerage_type?.name ?? '?'}  ${flags}`);
  }
}

async function connect() {
  const st = client();
  const creds = await userCreds(st, { create: true });
  const broker = opt('broker');
  // connectionType 'read': read-only access (spec D4). Never request trading.
  const { data } = await call(() => st.authentication.loginSnapTradeUser({
    ...creds, connectionType: 'read', ...(broker ? { broker } : {}),
  }));
  const url = data?.redirectURI;
  if (!url) fail('no redirectURI in the response');
  console.log('\nOpen this link in your browser and link one or more accounts (read-only):\n');
  console.log(`  ${url}\n`);
  console.log('The link is single-use and expires in a few minutes. Treat it as a secret.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('\nPress Enter once you have finished linking... ');
  rl.close();
  await report();
}

async function report() {
  const st = client();
  const creds = await userCreds(st);
  const { data: connections } = await call(() => st.connections.listBrokerageAuthorizations({ ...creds }));
  const { data: accounts } = await call(() => st.accountInformation.listUserAccounts({ ...creds }));
  const holdings = {};
  const errors = {};
  for (const [i, acct] of accounts.entries()) {
    process.stderr.write(`  fetching holdings for account ${i + 1}/${accounts.length}...\n`);
    try {
      ({ data: holdings[acct.id] } = await call(() => st.accountInformation.getUserHoldings({ ...creds, accountId: acct.id })));
    } catch (e) {
      if (!(e instanceof ProbeError)) throw e;
      errors[acct.id] = e.message;
    }
  }
  console.log('\n' + buildReport({ connections, accounts, holdings, errors }));
  if (flag('raw')) {
    const file = writeRaw({ fetchedAt: new Date().toISOString(), mode: MODE, connections, accounts, holdings, errors });
    console.log(`\nRAW (unmasked) responses written to ${file}`);
    console.log('This file contains real account data. Keep it under private/ and delete it when done.');
  } else {
    console.log('\nMasked output. Re-run with --raw to also save unmasked JSON under private/.');
  }
}

async function cleanup() {
  const st = client();
  if (MODE === 'commercial' && !existsSync(USER_FILE)) { console.log('No probe user to clean up.'); return; }
  const creds = await userCreds(st);
  const { data: connections } = await call(() => st.connections.listBrokerageAuthorizations({ ...creds }));
  const what = MODE === 'commercial'
    ? `delete the probe user and its ${connections.length} connection(s)`
    : `remove ${connections.length} connection(s) from this Personal key`;
  if (!flag('yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`This will ${what}. Type "yes" to continue: `);
    rl.close();
    if (ans.trim().toLowerCase() !== 'yes') { console.log('Cancelled.'); return; }
  }
  if (MODE === 'commercial') {
    await call(() => st.authentication.deleteSnapTradeUser({ userId: creds.userId }));
    rmSync(USER_FILE);
    console.log('Deletion of the probe user requested (SnapTrade removes it asynchronously). Local credentials removed.');
  } else {
    for (const [i, c] of connections.entries()) {
      await call(() => st.connections.deleteConnection({ connectionId: c.id }));
      console.log(`  removed connection C${i + 1} (${c?.brokerage?.display_name ?? '?'})`);
    }
    console.log('Done. The Personal key itself stays; revoke it in the SnapTrade dashboard if you no longer need it.');
  }
  console.log('Remember to delete any raw-*.json files under private/snaptrade-probe/.');
}

// ---------------------------------------------------------------- main

const commands = { brokerages, connect, report, cleanup };
if (!commands[command]) {
  console.log('usage: npm run probe -- <brokerages [--filter text] | connect [--broker slug] | report [--raw] | cleanup [--yes]>');
  console.log(`mode: ${MODE} (set SNAPTRADE_MODE=commercial for a Commercial key)`);
  process.exit(command ? 1 : 0);
}
try {
  await commands[command]();
} catch (e) {
  if (e instanceof ProbeError) fail(`SnapTrade API ${e.message}`);
  fail(e?.message ?? String(e)); // message only: never dump the error object
}
