import test from 'node:test';
import assert from 'node:assert/strict';
import { timeToLogical, logicalToTime, hitTest, pick, cleanDrawings, magnetPrice, MAX_DRAWINGS } from '../src/lib/drawings.js';
import { sma, ema, rsi, macd, bollinger, stochastic, atr } from '../src/lib/indicators.js';
import handler from '../api/chart-data.js';

test('drawing times map to the same place on any timeframe', () => {
  const h1 = [0, 3600, 7200, 10800].map((x) => x + 1e9);
  const m15 = Array.from({ length: 13 }, (_, i) => 1e9 + i * 900);
  const t = 1e9 + 5400; // 01:30
  assert.equal(timeToLogical(h1, t, 3600), 1.5);
  assert.equal(timeToLogical(m15, t, 900), 6);
  assert.equal(logicalToTime(h1, 1.5, 3600), t);
  assert.equal(logicalToTime(m15, 6, 900), t);
  // beyond the last candle and before the first, it steps by the timeframe
  assert.equal(timeToLogical(h1, 1e9 + 18000, 3600), 5);
  assert.equal(logicalToTime(h1, -2, 3600), 1e9 - 7200);
  // weekend gaps: a time inside the gap sits between the two candles
  const gap = [1e9, 1e9 + 3600, 1e9 + 3600 * 50];
  assert.ok(timeToLogical(gap, 1e9 + 3600 * 20, 3600) > 1 && timeToLogical(gap, 1e9 + 3600 * 20, 3600) < 2);
});

test('hit testing: lines, zones, handles; last drawn wins', () => {
  const xy = (q) => ({ x: q.t, y: q.p });
  const size = { w: 500, h: 300 };
  const hl = { type: 'hline', points: [{ t: 100, p: 50 }] };
  const tr = { type: 'trend', points: [{ t: 0, p: 0 }, { t: 100, p: 100 }] };
  const zone = { type: 'rect', points: [{ t: 200, p: 100 }, { t: 300, p: 200 }] };
  assert.equal(hitTest(hl, { x: 400, y: 55 }, xy, size), 'body');
  assert.equal(hitTest(hl, { x: 400, y: 80 }, xy, size), null);
  assert.equal(hitTest(tr, { x: 50, y: 52 }, xy, size), 'body');
  assert.equal(hitTest(tr, { x: 100, y: 101 }, xy, size), 'point1');
  assert.equal(hitTest(zone, { x: 250, y: 150 }, xy, size), 'body');
  assert.equal(pick([hl, tr], { x: 50, y: 50 }, xy, size).drawing, tr);
});

test('stored drawings are checked before use', () => {
  const out = cleanDrawings([{ id: 'a', type: 'hline', points: [{ t: 1, p: 2 }], color: '#ff0000' }, { type: 'bad', points: [] }, { type: 'trend', points: [{ t: 1, p: 2 }] }, { type: 'text', points: [{ t: 1, p: 2 }], text: 'x'.repeat(200), color: 'red' }, null]);
  assert.equal(out.length, 2);
  assert.equal(out[1].text.length, 80); assert.equal(out[1].color, '#4a90e2');
  assert.equal(cleanDrawings(Array.from({ length: 999 }, () => ({ type: 'hline', points: [{ t: 1, p: 1 }] }))).length, MAX_DRAWINGS);
  assert.deepEqual(cleanDrawings('nope'), []);
});

test('magnet snaps to the nearest candle price within reach', () => {
  const c = { o: 10, h: 12, l: 9, c: 11 };
  const y = (p) => 100 - p * 5;
  assert.equal(magnetPrice(c, 11.9, y, y(11.9)), 12);
  assert.equal(magnetPrice(c, 20, y, y(20)), 20);
});

test('indicators: textbook values', () => {
  const v = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(sma(v, 3), [null, null, 2, 3, 4, 5]);
  assert.deepEqual(ema(v, 3).slice(2), [2, 3, 4, 5]);
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14)[15], 100);
  const up = Array.from({ length: 60 }, (_, i) => i);
  assert.ok(macd(up).line[59] > 0);
  const b = bollinger([2, 2, 2, 2], 4, 2); assert.equal(b.upper[3], 2); assert.equal(b.lower[3], 2);
  const cs = Array.from({ length: 20 }, (_, i) => ({ o: i, h: i + 1, l: i - 1, c: i + 0.5 }));
  assert.ok(stochastic(cs).k[19] > 50);
  assert.ok(atr(cs, 14)[19] > 0);
});

function fakeRes() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.send = (b) => { r.body = JSON.parse(b); return r; };
  return r;
}
test('chart data: public, checked inputs, cached by timeframe', async () => {
  const real = globalThis.fetch; const key = process.env.TWELVEDATA_API_KEY;
  process.env.TWELVEDATA_API_KEY = 'test';
  try {
    let res = fakeRes();
    await handler({ method: 'GET', query: { symbol: 'EUR/USD', interval: '3min' } }, res);
    assert.equal(res.code, 400);
    res = fakeRes();
    await handler({ method: 'GET', query: { symbol: '<x>', interval: '1h' } }, res);
    assert.equal(res.code, 400);
    let asked = '';
    globalThis.fetch = async (url) => { asked = String(url); return { ok: true, json: async () => ({ values: [{ datetime: '2026-11-18 10:00:00', open: '1.1', high: '1.2', low: '1.0', close: '1.15' }] }) }; };
    res = fakeRes();
    await handler({ method: 'GET', query: { symbol: 'eur/usd', interval: '1h' } }, res);
    assert.equal(res.code, 200);
    assert.match(asked, /symbol=EUR%2FUSD/);
    assert.equal(res.body.candles.length, 1);
    assert.match(res.headers['Cache-Control'], /s-maxage=900/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'error', code: 400, message: 'symbol not found' }) });
    res = fakeRes();
    await handler({ method: 'GET', query: { symbol: 'ABC/XYZ', interval: '1h' } }, res);
    assert.equal(res.code, 404);
  } finally { globalThis.fetch = real; if (key === undefined) delete process.env.TWELVEDATA_API_KEY; else process.env.TWELVEDATA_API_KEY = key; }
});
