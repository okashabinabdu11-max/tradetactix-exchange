import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, INTERVAL_MS, pressure, paramsFor, PARAMS } from '../src/lib/signals.js';
import { marketOf, moveText, moveUnits, MARKET_LIST } from '../src/lib/markets.js';
import { normalizeKraken, normalizeCoinbase, joinCandles, fetchBitcoinCandles } from '../api/_lib/candles.js';
import candlesHandler from '../api/candles.js';
import { signalKey, gateSignal } from '../api/_lib/gate.js';
import { alertMessage } from '../api/_lib/telegram.js';
import { nextEvent, eventMessage } from '../api/_lib/tracker.js';
import { tradeView } from '../api/_lib/tradeView.js';
import { weeklyMessage, dailyMessage } from '../api/_lib/reports.js';

// Synthetic candles for testing the rules only. They are never shown in the app.
const SAT = Date.UTC(2026, 10, 21, 12, 0, 0); // a Saturday: gold is closed, bitcoin trades
const WED = Date.UTC(2026, 10, 18, 12, 0, 0);

/** Continuous candles (no closed hours) ending just before `end`, prices times k, with volume. */
function cont(closes, intervalMs, end, k = 25, shape = () => null) {
  const n = closes.length;
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const x = shape(i) || {};
    return { t: new Date(end - (n - i) * intervalMs).toISOString(), o: (x.o ?? o) * k, h: (x.h ?? Math.max(o, c) + 1) * k, l: (x.l ?? Math.min(o, c) - 1) * k, c: (x.c ?? c) * k, v: 12 };
  });
}
// Same shapes as the gold engine tests, priced like bitcoin (x25: about 100,000).
const wave = [4050, 4030, 4010, 4000, 4020, 4050, 4080, 4100, 4085, 4060, 4030, 4012, 4001, 4025, 4055, 4082, 4099, 4080, 4055, 4030];
const h4Closes = [...Array(12).fill(0).map((_, i) => 4060 - i), ...wave, 4018, 4008];
const h1Closes = [...Array(14).fill(4020), 4014, 4009, 4007, 4012, 4018, 4024, 4029, 4024, 4018, 4014, 4012, 4011, 4010, 4010];
const h1Shape = (i) => (i === 16 ? { l: 4005 } : i === 20 ? { h: 4031 } : null);
const obCloses = [...Array(20).fill(4050), 4047, 4056, 4060, 4064, 4058, 4056, 4052, 4049, 4055, 4060, 4066, 4069, 4063, 4059];
const obShape = (i) => (i === 23 ? { h: 4066 } : null);
const btcAt = (end, k = 25) => ({
  h4: cont(h4Closes, INTERVAL_MS['4h'], end, k),
  h1: cont(h1Closes, INTERVAL_MS['1h'], end, k, h1Shape),
  m15: cont(obCloses, INTERVAL_MS['15min'], end, k, obShape),
});

test('markets: gold and bitcoin, with their own units and largest stop', () => {
  assert.deepEqual(MARKET_LIST, ['XAUUSD', 'BTCUSD']);
  assert.equal(marketOf('btc/usd').symbol, 'BTCUSD');
  assert.equal(marketOf('nonsense').symbol, 'XAUUSD');
  assert.equal(moveText('XAUUSD', moveUnits('XAUUSD', 8)), '80 pips');
  assert.equal(moveText('BTCUSD', moveUnits('BTCUSD', 1234.4)), '$1,234');
  assert.equal(moveText('BTCUSD', -450, true), '−$450');
  assert.equal(paramsFor('XAUUSD'), PARAMS);
  assert.equal(paramsFor('BTCUSD').maxStopUsd, 900);
});

test('bitcoin trades at the weekend: the order-block route gives a BUY', () => {
  const r = evaluate({ ...btcAt(SAT), now: SAT, market: 'BTCUSD' });
  assert.equal(r.symbol, 'BTCUSD');
  assert.equal(r.state, 'buy', r.reason);
  assert.equal(r.setup, 'order-block');
  assert.ok(r.rr >= 3 && r.entry > 90000, `rr ${r.rr}, entry ${r.entry}`);
  assert.ok(r.entry - r.stop <= 900, 'stop within $900');
});

test('the same weekend candles read as gold are offline (gold is closed)', () => {
  const r = evaluate({ ...btcAt(SAT), now: SAT });
  assert.equal(r.symbol, 'XAUUSD');
  assert.equal(r.state, 'offline');
});

test('a bitcoin stop wider than $900 is skipped', () => {
  const r = evaluate({ ...btcAt(WED, 250), now: WED, market: 'BTCUSD' });
  assert.notEqual(r.state, 'buy');
  assert.match(r.reason, /too wide/);
});

test('pressure counts busier candles more when every candle has volume', () => {
  const up = { o: 1, h: 2, l: 1, c: 2 }; const down = { o: 2, h: 2, l: 1, c: 1 };
  assert.equal(pressure([up, down]), 0);
  assert.equal(pressure([{ ...up, v: 3 }, { ...down, v: 1 }]), 0.5);
  assert.equal(pressure([{ ...up, v: 3 }, down]), 0, 'missing volume: equal weights');
});

const kraken = { error: [], result: { XXBTZUSD: [
  [1763715600, '98000.0', '98200.5', '97900.0', '98100.0', '98050.0', '12.5', 300],
  [1763716500, '98100.0', '98300.0', '98050.0', '98250.0', '98200.0', '8.25', 210],
], last: 1763716500 } };

test('Kraken candles: oldest first, UTC times, real volume', () => {
  const r = normalizeKraken(kraken);
  assert.equal(r.ok, true);
  assert.deepEqual(r.candles[1], { t: new Date(1763716500e3).toISOString(), o: 98100, h: 98300, l: 98050, c: 98250, v: 8.25 });
  assert.equal(normalizeKraken({ error: ['EGeneral:Too many requests'], result: {} }).error, 'rate_limited');
  assert.equal(normalizeKraken({ error: [], result: { XXBTZUSD: [[1, '10', '9', '11', '10', '0', '1', 1]] } }).ok, false, 'high below low is rejected');
});

test('Coinbase candles (newest first) and joining 1H into 4H', () => {
  const r = normalizeCoinbase([[1763719200, 97950, 98300, 98000, 98250, 4], [1763715600, 97900, 98200, 98000, 98100, 5]]);
  assert.equal(r.ok, true);
  assert.equal(r.candles[0].c, 98100);
  const hours = [0, 1, 2, 3, 4].map((i) => ({ t: new Date(Date.UTC(2026, 10, 21, i)).toISOString(), o: 100 + i, h: 110 + i, l: 90 - i, c: 101 + i, v: 1 }));
  const four = joinCandles(hours, 240);
  assert.equal(four.length, 2);
  assert.deepEqual(four[0], { t: '2026-11-21T00:00:00.000Z', o: 100, h: 113, l: 87, c: 104, v: 4 });
});

test('bitcoin candles fall back to Coinbase when Kraken fails', async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(String(url));
    if (String(url).includes('kraken')) return { json: async () => ({ error: ['EService:Unavailable'], result: {} }) };
    return { json: async () => [[1763719200, 97950, 98300, 98000, 98250, 4], [1763715600, 97900, 98200, 98000, 98100, 5]] };
  };
  const r = await fetchBitcoinCandles('4h', fetcher);
  assert.equal(r.source, 'Coinbase');
  assert.ok(urls[1].includes('granularity=3600'), '4H is built from 1H');
  await assert.rejects(fetchBitcoinCandles('4h', async () => ({ json: async () => ({}) })), (e) => e.status === 502);
});

test('candles handler serves bitcoin without the Twelve Data key', async () => {
  const k = 'internal-secret-0123456789';
  process.env.CANDLES_KEY = k;
  const saved = process.env.TWELVEDATA_API_KEY;
  delete process.env.TWELVEDATA_API_KEY;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => kraken });
  const res = { headers: {}, setHeader(n, v) { this.headers[n] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); } };
  await candlesHandler({ method: 'GET', query: { tf: '15min', symbol: 'BTCUSD', k } }, res);
  const bad = { ...res, headers: {} };
  await candlesHandler({ method: 'GET', query: { tf: '15min', symbol: 'EURUSD', k } }, bad);
  globalThis.fetch = realFetch;
  if (saved !== undefined) process.env.TWELVEDATA_API_KEY = saved;
  assert.equal(res.code, 200);
  assert.equal(res.body.source, 'Kraken');
  assert.equal(res.body.candles.length, 2);
  assert.equal(bad.code, 400);
});

const btcBuy = { symbol: 'BTCUSD', state: 'buy', direction: 'buy', entry: 98000, stop: 97600, target: 99800, rr: 4.5, confirmedAt: '2026-11-21T10:00:00Z', setup: 'order-block', entryZone: [98100, 97950] };

test('bitcoin signals have their own key and alert text', () => {
  assert.equal(signalKey(btcBuy), 'BTCUSD-buy-2026-11-21T10:00:00Z');
  assert.equal(signalKey({ ...btcBuy, symbol: 'XAUUSD' }), 'buy-2026-11-21T10:00:00Z', 'gold keys unchanged');
  const text = alertMessage(btcBuy);
  assert.match(text, /BTCUSD BUY/);
  assert.match(text, /Risk: <b>\$400<\/b> · Reward: <b>\$1,800<\/b> \(price move\)/);
  assert.match(text, /signals\?m=BTCUSD/);
  assert.equal(gateSignal(btcBuy, { shows_levels: true }).symbol, 'BTCUSD');
});

test('bitcoin trades are followed in dollars of price', () => {
  const trade = { symbol: 'BTCUSD', direction: 'buy', entry: 98000, stop: 97600, target: 99800, opened_at: '2026-11-21T10:15:00Z', be_sent_at: null };
  const ev = nextEvent(trade, [{ t: '2026-11-21T10:30:00Z', o: 98000, h: 99900, l: 97900, c: 99850 }], Date.parse('2026-11-21T11:00:00Z'));
  assert.deepEqual([ev.event, ev.pips], ['tp', 1800]);
  assert.match(eventMessage(trade, ev), /BTCUSD BUY[\s\S]*\+\$1,800 smashed/);
  const v = tradeView({ ...trade, signal_key: 'k', status: 'open' }, 98450, Date.parse('2026-11-21T11:00:00Z'));
  assert.deepEqual([v.symbol, v.pips], ['BTCUSD', 450]);
});

test('weekly results list bitcoin separately; gold-only weeks look as before', () => {
  const from = Date.parse('2026-11-15T15:00:00Z'); const to = Date.parse('2026-11-22T15:00:00Z');
  const gold = { wins: 4, losses: 2, breakeven: 1, pips: 1240 };
  assert.equal(weeklyMessage(gold, from, to, { wins: 0, losses: 0, breakeven: 0, pips: 0 }), weeklyMessage(gold, from, to));
  const both = weeklyMessage(gold, from, to, { wins: 2, losses: 1, breakeven: 0, pips: 3100 });
  assert.match(both, /XAUUSD[\s\S]*1,240 pips[\s\S]*BTCUSD[\s\S]*Win rate: <b>67%<\/b>[\s\S]*\+\$3,100/);
  const d = dailyMessage({ pending_requests: 0, active_members: 1, telegram_members: 1, new_accounts: 0, signals_sent: 2 }, gold, [], Date.parse('2026-11-20T18:05:00Z'), { wins: 1, losses: 0, breakeven: 0, pips: 900 });
  assert.match(d, /BTCUSD \(24h\): ✅ 1 · ❌ 0 · ⚪ 0 · \+\$900/);
});
