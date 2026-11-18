import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNewsPause } from '../api/_lib/engine.js';
import { gateSignal } from '../api/_lib/gate.js';

const buy = { state: 'buy', direction: 'buy', entry: 4008, stop: 4000, target: 4100, rr: 11.5, confirmedAt: '2026-11-20T13:15:00Z', checks: { h4: { ok: true } }, price: 4008, asOf: '2026-11-20T13:15:00Z' };
const rpc = (rows, fail = false) => { globalThis.fetch = async () => (fail ? { ok: false, status: 500, json: async () => ({ message: 'down' }) } : { ok: true, status: 200, json: async () => rows }); };

test('a signal next to high-impact news becomes a pause with no levels', async () => {
  process.env.ALERTS_SECRET = 's';
  rpc([{ title: 'CPI m/m', starts_at: '2026-11-20T13:30:00Z' }]);
  const s = await applyNewsPause(buy, new Date('2026-11-20T13:20:00Z'));
  assert.equal(s.state, 'news-pause'); assert.equal(s.entry, undefined); assert.equal(s.stop, undefined);
  assert.match(s.reason, /CPI m\/m at 16:30/); assert.match(s.reason, /30 minutes before and after/);
  const pro = gateSignal(s, { signed_in: true, shows_levels: true, shows_analysis: true });
  assert.equal(pro.state, 'news-pause'); assert.equal(pro.entry, null);
  assert.equal(gateSignal(s, { signed_in: false, shows_levels: false }).state, 'news-pause');
});

test('no news nearby, or the news table unreadable: the signal is unchanged', async () => {
  rpc([]); assert.equal((await applyNewsPause(buy)).state, 'buy');
  rpc(null, true); assert.equal((await applyNewsPause(buy)).entry, 4008);
  rpc([{ title: 'CPI', starts_at: 'x' }]); assert.equal((await applyNewsPause({ state: 'no-setup' })).state, 'no-setup');
});
