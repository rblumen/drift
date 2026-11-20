// node --test: checks the masked report never leaks values from responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReport, idShape, safeKey, summarizeHoldings } from './report.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/synthetic.json', import.meta.url), 'utf8'));
const report = buildReport(fx);

test('masked report contains no sentinel values', () => {
  for (const s of fx.sentinels) {
    assert.ok(!report.includes(s), `report leaked "${s}"`);
  }
});

test('report keeps the coverage facts', () => {
  assert.match(report, /Brokerage A \[BROKERAGE-A\]/);
  assert.match(report, /raw_type: Roth IRA/);
  assert.match(report, /raw_type: 401k/);
  assert.match(report, /holdings: ERROR HTTP 400/);
  assert.match(report, /ticker-less: 1/);
  assert.match(report, /raw_symbol: CUSIP-like×1/);
  assert.match(report, /cost basis available/);
  assert.match(report, /USD cash=present/);
  assert.match(report, /cash-equivalent positions by type: mmf×1/);
  assert.match(report, /account\.meta\.<key>/, 'ID-like object keys are collapsed');
});

test('summarizeHoldings counts field presence', () => {
  const s = summarizeHoldings(Object.values(fx.holdings)[0]);
  assert.equal(s.positionCount, 3);
  assert.equal(s.withTicker, 2);
  assert.equal(s.fields.average_purchase_price, '2/3');
  assert.equal(s.fields.tax_lots_nonempty, '1/3');
  assert.equal(s.taxLotFields.cost_basis, '1/1');
});

test('idShape classifies without echoing', () => {
  assert.equal(idShape('VTI'), 'ticker-like');
  assert.equal(idShape('BRK.B'), 'ticker-like');
  assert.equal(idShape('922908769'), 'CUSIP-like');
  assert.equal(idShape('US9229087690'), 'ISIN-like');
  assert.equal(idShape('BBG000BDTBL9'), 'FIGI-like');
  assert.equal(idShape(''), 'empty');
  assert.equal(idShape(null), 'null');
  assert.equal(idShape('Some Fund Name'), 'free text (14 chars)');
});

test('safeKey collapses ID-like keys', () => {
  assert.equal(safeKey('average_purchase_price'), 'average_purchase_price');
  assert.equal(safeKey('X12345678'), '<key>');
  assert.equal(safeKey('33333333-3333-4333-8333-333333333333'), '<key>');
});
