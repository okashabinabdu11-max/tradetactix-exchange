import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuote } from '../api/_lib/quote.js';
import handler from '../api/quote.js';

// The provider's documented /quote shape, with made-up numbers used only here.
const sample = {
  symbol: 'XAU/USD', name: 'Gold Spot / US Dollar', datetime: '2026-11-16', timestamp: 1794848400,
  open: '4100.10', high: '4125.50', low: '4090.00', close: '4112.35', previous_close: '4098.20',
  change: '14.15', percent_change: '0.3453', is_market_open: true,
};

test('a good quote is converted to numbers', () => {
  const r = normalizeQuote(sample, 0);
  assert.equal(r.ok, true);
  assert.equal(r.quote.price, 4112.35);
  assert.equal(r.quote.change, 14.15);
  assert.equal(r.quote.high, 4125.5);
  assert.equal(r.quote.marketOpen, true);
  assert.equal(r.quote.asOf, new Date(1794848400000).toISOString());
  assert.equal(r.quote.symbol, 'XAUUSD');
});

test('provider errors never become a price', () => {
  assert.deepEqual(normalizeQuote({ code: 429, message: 'run out of API credits', status: 'error' }), { ok: false, status: 429, error: 'rate_limited' });
  assert.equal(normalizeQuote({ code: 401, message: 'bad apikey', status: 'error' }).error, 'key_rejected');
  assert.equal(normalizeQuote({ code: 404, message: 'symbol not found', status: 'error' }).error, 'provider_error');
  assert.equal(normalizeQuote({ close: 'n/a' }).ok, false);
  assert.equal(normalizeQuote({ close: '0' }).ok, false);
  assert.equal(normalizeQuote(null).ok, false);
});

test('missing optional fields stay empty rather than zero', () => {
  const r = normalizeQuote({ close: '4000' });
  assert.equal(r.quote.change, null);
  assert.equal(r.quote.marketOpen, null);
  assert.equal(r.quote.asOf, null);
});

function fakeRes() {
  return { headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); } };
}

test('handler: no key configured', async () => {
  delete process.env.TWELVEDATA_API_KEY;
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, { error: 'not_configured' });
});

test('handler: success is cached and never leaks the key', async () => {
  process.env.TWELVEDATA_API_KEY = 'test-key-123';
  const realFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (url) => { calledUrl = String(url); return { json: async () => sample }; };
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  globalThis.fetch = realFetch;
  assert.equal(res.code, 200);
  assert.equal(res.body.price, 4112.35);
  assert.match(res.headers['Cache-Control'], /s-maxage=120/);
  assert.ok(calledUrl.includes('symbol=XAU%2FUSD') && calledUrl.includes('apikey=test-key-123'));
  assert.ok(!JSON.stringify(res.body).includes('test-key-123'));
});

test('handler: provider failure and wrong method', async () => {
  process.env.TWELVEDATA_API_KEY = 'test-key-123';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down test-key-123'); };
  const res = fakeRes();
  const realError = console.error; console.error = () => {};
  await handler({ method: 'GET' }, res);
  console.error = realError; globalThis.fetch = realFetch;
  assert.equal(res.code, 502);
  assert.deepEqual(res.body, { error: 'unreachable' });
  const res2 = fakeRes();
  await handler({ method: 'POST' }, res2);
  assert.equal(res2.code, 405);
});

// ---------- Candles ----------
import { normalizeSeries } from '../api/_lib/candles.js';
import candlesHandler from '../api/candles.js';

const seriesBody = {
  meta: { symbol: 'XAU/USD', interval: '15min' },
  values: [
    { datetime: '2026-11-16 17:45:00', open: '4110.1', high: '4113.0', low: '4109.0', close: '4112.3' },
    { datetime: '2026-11-16 17:30:00', open: '4108.0', high: '4111.0', low: '4107.5', close: '4110.1' },
  ],
  status: 'ok',
};

test('candles come back oldest first with UTC times', () => {
  const r = normalizeSeries(seriesBody);
  assert.equal(r.ok, true);
  assert.deepEqual(r.candles[0], { t: '2026-11-16T17:30:00.000Z', o: 4108, h: 4111, l: 4107.5, c: 4110.1 });
  assert.equal(r.candles[1].t, '2026-11-16T17:45:00.000Z');
});

test('a single bad candle rejects the whole series', () => {
  const bad = { values: [{ datetime: '2026-11-16 17:45:00', open: '4110', high: '4100', low: '4109', close: '4112' }] };
  assert.equal(normalizeSeries(bad).ok, false);
  assert.equal(normalizeSeries({ values: [] }).ok, false);
  assert.equal(normalizeSeries({ code: 429, status: 'error' }).error, 'rate_limited');
});

test('candles handler validates the timeframe and hides the key', async () => {
  process.env.TWELVEDATA_API_KEY = 'test-key-123';
  process.env.CANDLES_KEY = 'internal-secret-0123456789';
  const k = 'internal-secret-0123456789';
  const bad = fakeRes();
  await candlesHandler({ method: 'GET', query: { tf: '1min', k } }, bad);
  assert.equal(bad.code, 400);
  const proto = fakeRes();
  await candlesHandler({ method: 'GET', query: { tf: 'constructor', k } }, proto);
  assert.equal(proto.code, 400);

  const realFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (url) => { calledUrl = String(url); return { json: async () => seriesBody }; };
  const res = fakeRes();
  await candlesHandler({ method: 'GET', query: { tf: '15min', k } }, res);
  globalThis.fetch = realFetch;
  assert.equal(res.code, 200);
  assert.equal(res.body.candles.length, 2);
  assert.match(res.headers['Cache-Control'], /s-maxage=450/);
  assert.ok(calledUrl.includes('interval=15min') && calledUrl.includes('timezone=UTC'));
  assert.ok(!JSON.stringify(res.body).includes('test-key-123'));
});
