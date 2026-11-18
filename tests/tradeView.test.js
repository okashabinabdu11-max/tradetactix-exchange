import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeView, SHOW_RESULT_MS } from '../api/_lib/tradeView.js';

const now = Date.parse('2026-11-18T10:00:00Z');
const row = (o = {}) => ({ signal_key: 'buy-x', direction: 'buy', entry: '4008.000', stop: '4000.000', target: '4100.000', opened_at: '2026-11-18T08:00:00Z', be_sent_at: null, status: 'open', result_pips: null, closed_at: null, ...o });

test('running buy counts pips from entry to the live price', () => {
  const v = tradeView(row(), 4038, now);
  assert.equal(v.status, 'running'); assert.equal(v.pips, 300); assert.equal(v.price, 4038);
});
test('running sell counts pips the other way, and losses are negative', () => {
  assert.equal(tradeView(row({ direction: 'sell', stop: '4016' }), 3998, now).pips, 100);
  assert.equal(tradeView(row(), 4003, now).pips, -50);
});
test('no live price: running without a pip figure, never a made-up one', () => {
  const v = tradeView(row(), null, now); assert.equal(v.status, 'running'); assert.equal(v.pips, null);
});
test('after Put BE the trade shows as be-moved', () => {
  assert.equal(tradeView(row({ be_sent_at: '2026-11-18T09:00:00Z' }), 4030, now).status, 'be-moved');
});
test('finished trades show their result for 12 hours, then disappear', () => {
  const tp = row({ status: 'tp', result_pips: '920.0', closed_at: '2026-11-18T09:30:00Z' });
  assert.deepEqual([tradeView(tp, null, now).status, tradeView(tp, null, now).pips], ['tp', 920]);
  assert.equal(tradeView(row({ status: 'sl', result_pips: '-80', closed_at: '2026-11-18T09:30:00Z' }), null, now).pips, -80);
  assert.equal(tradeView(row({ status: 'be', result_pips: '0', closed_at: '2026-11-18T09:30:00Z' }), null, now).status, 'be');
  assert.equal(tradeView(tp, null, Date.parse('2026-11-18T09:30:00Z') + SHOW_RESULT_MS + 1), null);
});
test('expired, missing, or not-yet-open trades are not shown', () => {
  assert.equal(tradeView(row({ status: 'expired', closed_at: '2026-11-18T09:30:00Z' }), 4038, now), null);
  assert.equal(tradeView(null, 4038, now), null);
  assert.equal(tradeView(row({ opened_at: '2026-11-18T11:00:00Z' }), 4038, now), null);
});
