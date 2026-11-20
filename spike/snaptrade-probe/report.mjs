// Pure report builder for the SnapTrade coverage probe.
//
// Input: raw SnapTrade responses. Output: a coverage report that describes
// STRUCTURE ONLY. It never prints amounts, account names, account numbers,
// person names, tickers, security descriptions, or IDs. The only free-text
// values it prints are institution/brokerage names, enum-like fields
// (account type, category, status), currency codes, and security type codes.
// report.test.mjs enforces this with sentinel values.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Describe the shape of an identifier string without revealing it. */
export function idShape(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (typeof value !== 'string') return typeof value;
  const s = value.trim();
  if (s === '') return 'empty';
  if (UUID.test(s)) return 'uuid';
  if (/^BBG[A-Z0-9]{9}$/.test(s)) return 'FIGI-like';
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return 'ISIN-like';
  if (/^[0-9]{3}[A-Z0-9]{5}[0-9]$/i.test(s)) return 'CUSIP-like';
  if (/^[A-Z]{1,5}([.\-/][A-Z]{1,2})?$/.test(s)) return 'ticker-like';
  if (/^[A-Z0-9]{1,12}$/i.test(s)) return `short code (${s.length} chars)`;
  if (/\s/.test(s)) return `free text (${s.length} chars)`;
  return `other (${s.length} chars)`;
}

/**
 * Object keys are normally schema names, but a map keyed by an ID or account
 * number would leak that value through the path. Collapse anything that
 * doesn't look like a field name.
 */
export function safeKey(k) {
  return /^[A-Za-z_][A-Za-z_]*[0-9]{0,2}$/.test(k) && k.length <= 40 ? k : '<key>';
}

/**
 * Record the shape of a JSON value: for every key path, which value types
 * were seen and how often. Values themselves are never recorded.
 */
export function collectShape(value, acc = new Map(), path = '$') {
  const entry = acc.get(path) ?? { count: 0, types: new Map() };
  acc.set(path, entry);
  entry.count += 1;
  const t = value === null ? 'null'
    : Array.isArray(value) ? 'array'
    : value === '' ? 'empty-string'
    : typeof value;
  entry.types.set(t, (entry.types.get(t) ?? 0) + 1);
  if (Array.isArray(value)) {
    for (const item of value) collectShape(item, acc, `${path}[]`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectShape(v, acc, `${path}.${safeKey(k)}`);
  }
  return acc;
}

export function formatShape(acc) {
  const lines = [];
  for (const [path, { count, types }] of [...acc.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const t = [...types.entries()].map(([k, n]) => (n === count ? k : `${k}×${n}`)).join(' | ');
    lines.push(`  ${path}  ${t}${count > 1 ? `  (n=${count})` : ''}`);
  }
  return lines.join('\n');
}

const present = (v) => v !== null && v !== undefined && v !== '';
const tickerOf = (pos) => pos?.symbol?.symbol?.symbol;
const hasTicker = (pos) => idShape(tickerOf(pos)) === 'ticker-like';

/** "9/12" style presence count for a field across items. */
function presence(items, get) {
  const n = items.filter((x) => present(get(x))).length;
  return `${n}/${items.length}`;
}

function tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', ') || '(none)';
}

/**
 * Summarise one account's holdings response.
 * Returns plain data (no sensitive values) for both printing and tests.
 */
export function summarizeHoldings(h) {
  const positions = h?.positions ?? [];
  const balances = h?.balances ?? [];
  const tickerless = positions.filter((p) => !hasTicker(p));
  const lots = positions.flatMap((p) => p.tax_lots ?? []);
  return {
    positionsField: h?.positions === null ? 'null' : h?.positions === undefined ? 'missing' : 'array',
    positionCount: positions.length,
    securityTypes: tally(positions.map((p) => p?.symbol?.symbol?.type?.code ?? '(no type)')),
    withTicker: positions.length - tickerless.length,
    tickerless: {
      count: tickerless.length,
      tickerShape: tally(tickerless.map((p) => idShape(tickerOf(p)))),
      rawSymbolShape: tally(tickerless.map((p) => idShape(p?.symbol?.symbol?.raw_symbol))),
      figiShape: tally(tickerless.map((p) => idShape(p?.symbol?.symbol?.figi_code))),
      localIdShape: tally(tickerless.map((p) => idShape(p?.symbol?.local_id))),
      descriptionShape: tally(tickerless.map((p) => idShape(p?.symbol?.description ?? p?.symbol?.symbol?.description))),
      securityTypes: tally(tickerless.map((p) => p?.symbol?.symbol?.type?.code ?? '(no type)')),
    },
    fields: {
      units: presence(positions, (p) => p.units),
      fractional_units: presence(positions, (p) => p.fractional_units),
      price: presence(positions, (p) => p.price),
      average_purchase_price: presence(positions, (p) => p.average_purchase_price),
      open_pnl: presence(positions, (p) => p.open_pnl),
      currency: presence(positions, (p) => p?.currency?.code),
      cash_equivalent_true: `${positions.filter((p) => p.cash_equivalent === true).length}/${positions.length}`,
      tax_lots_nonempty: presence(positions, (p) => (p.tax_lots?.length ? 1 : null)),
    },
    cashEquivalentTypes: tally(positions.filter((p) => p.cash_equivalent === true)
      .map((p) => p?.symbol?.symbol?.type?.code ?? '(no type)')),
    taxLotFields: lots.length === 0 ? '(no lots)' : {
      count: lots.length,
      original_purchase_date: presence(lots, (l) => l.original_purchase_date),
      quantity: presence(lots, (l) => l.quantity),
      purchased_price: presence(lots, (l) => l.purchased_price),
      cost_basis: presence(lots, (l) => l.cost_basis),
    },
    balances: balances.map((b) => ({
      currency: b?.currency?.code ?? '(no code)',
      cash: present(b?.cash) ? 'present' : 'null',
      buying_power: present(b?.buying_power) ? 'present' : 'null',
    })),
    optionPositions: (h?.option_positions ?? []).length,
    totalValue: present(h?.total_value?.value) ? 'present' : 'null',
    hints: {
      holdings: positions.length > 0 ? 'positions returned' : 'NO positions returned',
      costBasis: positions.length === 0 ? 'n/a'
        : positions.some((p) => present(p.average_purchase_price)) || lots.some((l) => present(l.cost_basis))
          ? 'available for some/all positions' : 'NOT available',
      cash: balances.some((b) => present(b?.cash)) ? 'cash balance reported'
        : positions.some((p) => p.cash_equivalent) ? 'cash only as cash-equivalent positions' : 'no cash reported',
    },
  };
}

export function summarizeAccount(acct) {
  return {
    institution: acct?.institution_name ?? '(none)',
    rawType: acct?.raw_type ?? '(null)',
    category: acct?.account_category ?? '(none)',
    status: acct?.status ?? '(none)',
    name: present(acct?.name) ? 'present (masked)' : 'null',
    number: present(acct?.number) ? `present (masked, ${String(acct.number).length} chars)` : 'null',
    totalBalance: present(acct?.balance?.total?.amount) ? `present (${acct.balance.total.currency ?? '?'})` : 'null',
    holdingsSync: {
      initial_sync_completed: acct?.sync_status?.holdings?.initial_sync_completed ?? '(missing)',
      holdings_unavailable: acct?.sync_status?.holdings?.holdings_unavailable ?? '(missing)',
      last_successful_sync: present(acct?.sync_status?.holdings?.last_successful_sync) ? 'present' : 'null',
    },
  };
}

export function summarizeConnection(conn) {
  const b = conn?.brokerage ?? {};
  return {
    brokerage: b.display_name ?? b.name ?? '(none)',
    slug: b.slug ?? '(none)',
    brokerageType: b?.brokerage_type?.name ?? '(none)',
    connectionType: conn?.type ?? '(none)',
    disabled: conn?.disabled ?? '(missing)',
    degraded: b.is_degraded ?? '(missing)',
    maintenance: b.maintenance_mode ?? '(missing)',
  };
}

/**
 * Build the full masked report.
 * @param {{connections: object[], accounts: object[], holdings: Record<string, object>, errors?: Record<string,string>}} data
 *   holdings is keyed by account id; errors by account id.
 */
export function buildReport({ connections = [], accounts = [], holdings = {}, errors = {} }) {
  const out = [];
  const connLabel = new Map(connections.map((c, i) => [c.id, `C${i + 1}`]));
  out.push('SnapTrade coverage report (masked: structure only)');
  out.push('='.repeat(52));
  out.push(`Connections: ${connections.length}   Accounts: ${accounts.length}`);
  out.push('');

  out.push('CONNECTIONS');
  connections.forEach((c, i) => {
    const s = summarizeConnection(c);
    out.push(`  C${i + 1}  ${s.brokerage} [${s.slug}]  type=${s.connectionType}  brokerage_type=${s.brokerageType}  disabled=${s.disabled}  degraded=${s.degraded}  maintenance=${s.maintenance}`);
  });
  out.push('');

  accounts.forEach((acct, i) => {
    const a = summarizeAccount(acct);
    const label = `A${i + 1}`;
    out.push(`ACCOUNT ${label}  (connection ${connLabel.get(acct.brokerage_authorization) ?? '?'})`);
    out.push(`  institution: ${a.institution}   raw_type: ${a.rawType}   category: ${a.category}   status: ${a.status}`);
    out.push(`  name: ${a.name}   number: ${a.number}   total balance: ${a.totalBalance}`);
    out.push(`  holdings sync: initial_sync_completed=${a.holdingsSync.initial_sync_completed}  holdings_unavailable=${a.holdingsSync.holdings_unavailable}  last_successful_sync=${a.holdingsSync.last_successful_sync}`);
    if (errors[acct.id]) {
      out.push(`  holdings: ERROR ${errors[acct.id]}`);
      out.push('');
      return;
    }
    const h = holdings[acct.id];
    if (!h) { out.push('  holdings: (not fetched)'); out.push(''); return; }
    const s = summarizeHoldings(h);
    out.push(`  => ${s.hints.holdings}; cost basis ${s.hints.costBasis}; ${s.hints.cash}`);
    out.push(`  positions: ${s.positionCount} (field: ${s.positionsField})   with ticker: ${s.withTicker}   ticker-less: ${s.tickerless.count}   options: ${s.optionPositions}`);
    out.push(`  security types: ${s.securityTypes}`);
    out.push(`  field presence: ${Object.entries(s.fields).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (s.tickerless.count > 0) {
      const t = s.tickerless;
      out.push(`  ticker-less funds: types ${t.securityTypes}`);
      out.push(`    symbol: ${t.tickerShape}   raw_symbol: ${t.rawSymbolShape}   figi: ${t.figiShape}`);
      out.push(`    local_id: ${t.localIdShape}   description: ${t.descriptionShape}`);
    }
    out.push(`  cash-equivalent positions by type: ${s.cashEquivalentTypes}`);
    out.push(`  tax lots: ${typeof s.taxLotFields === 'string' ? s.taxLotFields
      : Object.entries(s.taxLotFields).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    out.push(`  balances: ${s.balances.length === 0 ? '(none)'
      : s.balances.map((b) => `${b.currency} cash=${b.cash} buying_power=${b.buying_power}`).join('; ')}`);
    out.push(`  total_value: ${s.totalValue}`);
    out.push('');
  });

  const shape = new Map();
  connections.forEach((c) => collectShape(c, shape, 'connection'));
  accounts.forEach((a) => collectShape(a, shape, 'account'));
  Object.values(holdings).forEach((h) => collectShape(h, shape, 'holdings'));
  out.push('FIELD SHAPE (every key path seen, with value types; no values)');
  out.push(formatShape(shape));
  return out.join('\n');
}
