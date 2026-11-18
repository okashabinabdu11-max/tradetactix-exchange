import test from 'node:test';
import assert from 'node:assert/strict';
import { backtest, summarize } from '../api/_lib/backtest.js';

test('summary counts results and pips, win rate over TP and SL only', () => {
  const s = summarize([{ result: 'tp', pips: 300 }, { result: 'sl', pips: -100 }, { result: 'be', pips: 0 }, { result: 'expired', pips: null }], 'a', 'b');
  assert.equal(s.wins, 1); assert.equal(s.losses, 1); assert.equal(s.breakeven, 1); assert.equal(s.expired, 1);
  assert.equal(s.winRate, 50); assert.equal(s.pips, 200);
  assert.equal(summarize([], null, null).winRate, null);
});

test('no candles: nothing traded, no invented results', () => {
  const s = backtest({ h4: [], h1: [], m15: [] });
  assert.equal(s.total, 0); assert.equal(s.winRate, null);
});

test('a flat market gives no trades', () => {
  const start = Date.UTC(2026, 9, 5, 0, 0);
  const mk = (n, step) => Array.from({ length: n }, (_, k) => ({ t: new Date(start + k * step).toISOString(), o: 2000, h: 2000.5, l: 1999.5, c: 2000 }));
  const s = backtest({ h4: mk(200, 4 * 3600e3), h1: mk(800, 3600e3), m15: mk(400, 15 * 60e3) });
  assert.equal(s.total, 0);
});

import handler, { _resetBacktestCache } from '../api/backtest.js';
function fakeRes() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.send = (b) => { r.body = JSON.parse(b); return r; };
  return r;
}
const TOKEN = 'Bearer abcdefghijklmnopqrstuvwxyz123456';

test('backtest API: needs an account, then Chart Pro', async () => {
  const real = globalThis.fetch;
  try {
    let res = fakeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.code, 401);
    globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ signed_in: true, chart_pro: false }) });
    res = fakeRes();
    await handler({ method: 'GET', headers: { authorization: TOKEN }, query: {} }, res);
    assert.equal(res.code, 403);
    assert.match(res.body.message, /Chart Pro/);
  } finally { globalThis.fetch = real; }
});

test('backtest API: Chart Pro member gets a labelled result from real candle data', async () => {
  const real = globalThis.fetch; const key = process.env.TWELVEDATA_API_KEY;
  process.env.TWELVEDATA_API_KEY = 'test'; _resetBacktestCache();
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/my_chart_access')) return { ok: true, json: async () => ({ signed_in: true, chart_pro: true }) };
      const now = Date.now();
      const values = Array.from({ length: 50 }, (_, k) => ({ datetime: new Date(now - k * 900e3).toISOString().slice(0, 19).replace('T', ' '), open: '2000', high: '2001', low: '1999', close: '2000' }));
      return { ok: true, json: async () => ({ values }) };
    };
    const res = fakeRes();
    await handler({ method: 'GET', headers: { authorization: TOKEN }, query: { days: '999' } }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(res.body.days, 50);
    assert.match(res.body.note, /not live results/);
    assert.equal(calls.filter((u) => u.includes('twelvedata')).length, 3);
  } finally { globalThis.fetch = real; process.env.TWELVEDATA_API_KEY = key; if (key === undefined) delete process.env.TWELVEDATA_API_KEY; }
});
