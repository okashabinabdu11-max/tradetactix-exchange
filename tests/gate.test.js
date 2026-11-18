import test from 'node:test';
import assert from 'node:assert/strict';
import { gateSignal, signalKey, NO_SETUP_TEXT } from '../api/_lib/gate.js';
import { bearerToken } from '../api/_lib/access.js';
import signalHandler from '../api/signal.js';
import candlesHandler from '../api/candles.js';

const BUY = {
  state: 'buy', direction: 'buy', reason: 'All checks passed at the 4H support 4000.50.', price: 4008, entry: 4008, stop: 3996.2, target: 4099.5, rr: 7.7,
  targetBasis: 'next 4H level', confirmedAt: '2026-11-18T11:45:00.000Z', asOf: '2026-11-18T11:45:00.000Z', minRR: 3,
  checks: { h4: { ok: true, text: 'At support 4000.50 (2 turns)' }, h1: { ok: true, text: 'Swept the low at 4005.00' }, m15: { ok: true, text: 'Retest confirmed' } },
  levels: [{ price: 4000.5, touches: 2, lastTouch: 'x' }, { price: 4099.5, touches: 2, lastTouch: 'y' }],
  liquidity: { high: { price: 4031, t: 'x' }, low: { price: 4005, t: 'y' } },
};
const NONE = { state: 'no-setup', reason: 'Price is 28.76 away from the nearest 4H level at 3872.69.', price: 3843.9, checks: { h4: { ok: false, text: 'Nearest level 3872.69, 28.76 away' }, h1: null, m15: null }, levels: BUY.levels, liquidity: BUY.liquidity, asOf: 'z' };
const PRO = { signed_in: true, plan: 'pro', shows_levels: true, shows_analysis: true };
const FREE = { signed_in: true, plan: 'free', shows_levels: false, shows_analysis: false };
const ANON = { signed_in: false, plan: 'none', shows_levels: false, shows_analysis: false };
const SECRETS = ['4008', '3996', '4099', '4000.5', '4005', '4031', '7.7', '3872', '28.76', '3843'];
const leaks = (body) => SECRETS.filter((s) => JSON.stringify(body).includes(s));

test('Pro sees the whole signal', () => {
  const g = gateSignal(BUY, PRO);
  assert.equal(g.access, 'full');
  assert.equal(g.entry, 4008);
  assert.equal(g.stop, 3996.2);
  assert.equal(g.target, 4099.5);
  assert.equal(g.levels.length, 2);
  assert.equal(g.checks.h1.text, 'Swept the low at 4005.00');
});

test('free preview: direction and timeframe only, no prices anywhere', () => {
  const g = gateSignal(BUY, FREE, { allowed: true, used: 3, limit: 10 });
  assert.equal(g.state, 'buy');
  assert.equal(g.direction, 'buy');
  assert.equal(g.timeframe, '15M');
  assert.deepEqual(g.previews, { used: 3, limit: 10 });
  assert.equal(g.entry, undefined);
  assert.deepEqual(g.checks, { h4: { ok: true }, h1: { ok: true }, m15: { ok: true } });
  assert.deepEqual(leaks(g), []);
});

test('free user out of previews does not learn the direction', () => {
  const g = gateSignal(BUY, FREE, { allowed: false, used: 10, limit: 10 });
  assert.equal(g.state, 'locked');
  assert.equal(g.direction, undefined);
  assert.match(g.reason, /used all 10 free previews/);
  assert.ok(!JSON.stringify(g).toLowerCase().includes('buy'));
  assert.deepEqual(leaks(g), []);
});

test('a failed preview check locks rather than reveals', () => {
  const g = gateSignal(BUY, FREE, { allowed: false, used: null, limit: null });
  assert.equal(g.state, 'locked');
  assert.equal(gateSignal(BUY, FREE, null).state, 'locked');
});

test('signed-out visitors never learn the direction', () => {
  const g = gateSignal(BUY, ANON);
  assert.equal(g.state, 'locked');
  assert.equal(g.access, 'anonymous');
  assert.ok(!JSON.stringify(g).toLowerCase().includes('buy'));
  assert.deepEqual(leaks(g), []);
});

test('no setup shows the exact waiting message and never a made-up signal', () => {
  for (const who of [ANON, FREE]) {
    const g = gateSignal(NONE, who);
    assert.equal(g.state, 'no-setup');
    assert.equal(g.reason, 'NO VALID SETUP — AI IS WAITING.');
    assert.equal(g.direction, undefined);
    assert.deepEqual(leaks(g), []);
  }
  const pro = gateSignal(NONE, PRO);
  assert.ok(pro.reason.startsWith(NO_SETUP_TEXT));
  assert.equal(pro.entry, null);
});

test('analysis can be withheld separately from levels', () => {
  const g = gateSignal(BUY, { ...PRO, shows_analysis: false });
  assert.equal(g.entry, 4008);
  assert.equal(g.levels, null);
  assert.equal(g.liquidity, null);
});

test('the preview key is stable for one signal and differs between signals', () => {
  assert.equal(signalKey(BUY), signalKey({ ...BUY, price: 1 }));
  assert.notEqual(signalKey(BUY), signalKey({ ...BUY, confirmedAt: '2026-11-18T12:00:00.000Z' }));
  assert.notEqual(signalKey(BUY), signalKey({ ...BUY, state: 'sell' }));
});

test('only well-formed bearer tokens are accepted', () => {
  const t = 'a'.repeat(40);
  assert.equal(bearerToken({ headers: { authorization: `Bearer ${t}` } }), t);
  assert.equal(bearerToken({ headers: {} }), null);
  assert.equal(bearerToken({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(bearerToken({ headers: { authorization: 'Bearer short' } }), null);
  assert.equal(bearerToken({ headers: { authorization: `Bearer ${t}\r\nX-Evil: 1` } }), null);
});

function fakeRes() {
  return { headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); } };
}

test('candles are refused without the internal key', async () => {
  process.env.TWELVEDATA_API_KEY = 'provider-key';
  process.env.CANDLES_KEY = 'internal-secret-0123456789';
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return { json: async () => ({}) }; };
  for (const k of [undefined, '', 'wrong', 'internal-secret-012345678', 'internal-secret-0123456789x']) {
    const res = fakeRes();
    await candlesHandler({ method: 'GET', query: { tf: '4h', k } }, res);
    assert.equal(res.code, 403, `k=${k}`);
  }
  delete process.env.CANDLES_KEY;
  const res = fakeRes();
  await candlesHandler({ method: 'GET', query: { tf: '4h', k: '' } }, res);
  assert.equal(res.code, 403, 'no key configured means closed');
  globalThis.fetch = realFetch;
  assert.equal(called, false);
});

test('signal endpoint: per-user responses are never shared-cached, and fail closed', async () => {
  delete process.env.CANDLES_KEY;
  const res = fakeRes();
  await signalHandler({ method: 'GET', headers: { host: 'example.test' }, query: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.state, 'offline');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.body.entry, undefined);
});

test('signal endpoint: a broken entitlement check is treated as signed out', async () => {
  process.env.CANDLES_KEY = 'internal-secret-0123456789';
  const realFetch = globalThis.fetch;
  const realError = console.error; console.error = () => {};
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/rest/v1/rpc/')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({ candles: [] }) };
  };
  const res = fakeRes();
  await signalHandler({ method: 'GET', headers: { host: 'example.test', authorization: `Bearer ${'t'.repeat(40)}` }, query: {} }, res);
  globalThis.fetch = realFetch; console.error = realError;
  assert.equal(res.body.access, 'anonymous');
  assert.ok(urls.some((u) => u.includes('/api/candles?tf=4h&k=internal-secret-0123456789')));
});

test('with free previews switched off, a free user is pointed to requesting access', () => {
  const g = gateSignal(BUY, FREE, { allowed: false, used: 0, limit: 0 });
  assert.equal(g.state, 'locked');
  assert.match(g.reason, /request access on the Plans page/);
  assert.deepEqual(leaks(g), []);
});
