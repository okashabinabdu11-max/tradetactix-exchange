import test from 'node:test';
import assert from 'node:assert/strict';
import { atr, pivots, closedOnly, tradingOnly, findLevels, findLiquidity, evaluate, INTERVAL_MS, PARAMS, findOrderBlocks, pressure, aggregate30, fifteenFromFive } from '../src/lib/signals.js';

// Synthetic candles for testing the rules only. They are never shown in the app.
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0); // a Wednesday
const candle = (t, o, h, l, c) => ({ t: new Date(t).toISOString(), o, h, l, c });
/** Start times of the last `count` candles before NOW, skipping hours when gold is closed. */
function tradingTimes(count, intervalMs) {
  const times = [];
  for (let t = NOW - intervalMs; times.length < count; t -= intervalMs) {
    if (tradingOnly([candle(t, 1, 1, 1, 1)], intervalMs).length) times.unshift(t);
  }
  return times;
}
/** Builds candles ending just before NOW from a list of closes (range +-1 around the body). */
function series(closes, intervalMs, shape = () => ({})) {
  const times = tradingTimes(closes.length, intervalMs);
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const extra = shape(i, closes.length) || {};
    return candle(times[i], extra.o ?? o, extra.h ?? Math.max(o, c) + 1, extra.l ?? Math.min(o, c) - 1, extra.c ?? c);
  });
}
// A 4H line that turns up at ~4000 twice and down at ~4100 twice, ending near 4000.
const wave = [4050, 4030, 4010, 4000, 4020, 4050, 4080, 4100, 4085, 4060, 4030, 4012, 4001, 4025, 4055, 4082, 4099, 4080, 4055, 4030];
const h4Closes = [...Array(12).fill(0).map((_, i) => 4060 - i), ...wave, 4018, 4008];
const H4 = series(h4Closes, INTERVAL_MS['4h']);

test('pivots find swing highs and lows', () => {
  const p = pivots([1, 2, 3, 2, 1, 0, 1, 2], 2);
  assert.deepEqual(p.map((x) => [x.i, x.kind]), [[2, 'high'], [5, 'low']]);
});

test('closedOnly drops the candle still forming', () => {
  const list = [candle(NOW - 2 * 900e3, 1, 1, 1, 1), candle(NOW - 900e3, 1, 1, 1, 1), candle(NOW - 300e3, 1, 1, 1, 1)];
  assert.equal(closedOnly(list, 900e3, NOW).length, 2);
});

test('atr is the average true range', () => {
  assert.equal(atr([candle(0, 10, 12, 9, 11), candle(1, 11, 13, 10, 12), candle(2, 12, 16, 11, 15)], 14), 4);
});

test('4H levels need at least two turns of the closing line', () => {
  const levels = findLevels(H4);
  assert.equal(levels.length, 2);
  assert.ok(Math.abs(levels[0].price - 4000.5) < 0.01 && levels[0].touches === 2);
  assert.ok(Math.abs(levels[1].price - 4099.5) < 0.01 && levels[1].touches === 2);
});

// 1H: a swing low at 4005 and a swing high at 4031, formed well before the 15M window.
const h1Closes = [...Array(14).fill(4020), 4014, 4009, 4007, 4012, 4018, 4024, 4029, 4024, 4018, 4014, 4012, 4011, 4010, 4010];
const H1 = series(h1Closes, INTERVAL_MS['1h'], (i) => (i === 16 ? { l: 4005 } : i === 20 ? { h: 4031 } : null));

test('1H liquidity is the latest swing high and low before the window', () => {
  const liq = findLiquidity(H1);
  assert.equal(liq.low.price, 4005);
  assert.equal(liq.high.price, 4031);
  assert.equal(findLiquidity(H1, new Date(H1[5].t).getTime()).low, null);
});

// 15M: drift down to the level, sweep under 4005 to 3997, then close back above 4000.5 and 4005.
const quiet = Array(30).fill(4010);
function m15With(tail, shape) {
  const closes = [...quiet, ...tail];
  return series(closes, INTERVAL_MS['15min'], (i, n) => shape?.(i - (n - tail.length)));
}
const longTail = [4009, 4008, 4007, 4004, 4001, 4003, 4008];
const longShape = (k) => (k === 4 ? { l: 3997 } : k === 6 ? { o: 4003, c: 4008 } : null);

test('full long setup gives a BUY with stop beyond the 15M retest and at least 1:3', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: m15With(longTail, longShape), now: NOW });
  assert.equal(r.state, 'buy');
  assert.equal(r.entry, 4008);
  // The stop sits just below the 4000.50 level, not under the 3997 sweep wick.
  assert.ok(r.stop < 4000.5 && r.stop > 3999.5, `stop ${r.stop}`);
  assert.ok(r.entry - r.stop <= 9, 'never more than the 9-dollar maximum');
  assert.ok(Math.abs(r.target - 4099.5) < 0.01);
  assert.ok(r.rr >= 3);
  assert.equal(r.checks.h4.ok && r.checks.h1.ok && r.checks.m15.ok, true);
});

test('swept and retested but no confirming close is WAITING', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: m15With([4009, 4008, 4007, 4004, 4001, 4000, 3999], (k) => (k === 4 ? { l: 3997 } : null)), now: NOW });
  assert.equal(r.state, 'waiting');
  assert.equal(r.checks.h1.ok, true);
  assert.equal(r.checks.m15.ok, false);
  assert.equal(r.entry, undefined);
});

test('at the level without a sweep is WAITING', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: m15With([4010, 4009, 4009, 4008, 4008, 4009, 4009]), now: NOW });
  assert.equal(r.state, 'waiting');
  assert.equal(r.checks.h1.ok, false);
});

test('away from every level is NO SETUP', () => {
  const far = series(Array(40).fill(4050), INTERVAL_MS['15min']);
  const r = evaluate({ h4: H4, h1: H1, m15: far, now: NOW });
  assert.equal(r.state, 'no-setup');
  assert.equal(r.checks.h4.ok, false);
  assert.match(r.reason, /is [\d.]+ away/);
  assert.equal(r.route, 'order-block');
  assert.ok(r.watch.looking.length && r.watch.seeing.length);
  assert.ok(![...r.watch.looking, ...r.watch.seeing].some((x) => /\b(4H|1H|15M|30M|5M)\b/.test(x)), 'no timeframe names');
});

test('a confirmed setup with less than 1:3 to the next level is NO SETUP', () => {
  // An extra level at about 4025.5, just above the entry, leaves too little reward.
  const crowded = series([4060, 4045, 4025, 4045, 4060, 4045, 4026, 4045, 4060, 4058, 4056, 4054, ...wave, 4018, 4008], INTERVAL_MS['4h']);
  const r = evaluate({ h4: crowded, h1: H1, m15: m15With(longTail, longShape), now: NOW });
  assert.equal(r.state, 'no-setup');
  assert.match(r.reason, /below the 1:3 minimum/);
  assert.equal(r.entry, undefined);
});

test('a stricter personal minimum is respected', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: m15With(longTail, longShape), now: NOW, minRewardToRisk: 20 });
  assert.equal(r.state, 'no-setup');
});

test('an old confirmation is stale, not a signal', () => {
  // Three more candles hold just above the level after the confirmation.
  const r = evaluate({ h4: H4, h1: H1, m15: m15With([...longTail, 4009, 4010, 4009], (k) => longShape(k) || (k >= 7 ? { l: 4008 } : null)), now: NOW });
  assert.equal(r.state, 'no-setup');
  assert.match(r.reason, /entry has passed/);
  assert.equal(r.entry, undefined);
});

test('mirror image gives a SELL', () => {
  const flip = (list) => list.map((c) => ({ t: c.t, o: 8100 - c.o, h: 8100 - c.l, l: 8100 - c.h, c: 8100 - c.c }));
  const r = evaluate({ h4: flip(H4), h1: flip(H1), m15: flip(m15With(longTail, longShape)), now: NOW });
  assert.equal(r.state, 'sell');
  assert.equal(r.entry, 4092);
  assert.ok(r.stop > 4099.5 && r.stop < 4100.5 && r.target < r.entry && r.rr >= 3, `stop ${r.stop}`);
});

test('missing or stale data is OFFLINE, never a guess', () => {
  assert.equal(evaluate({ h4: [], h1: [], m15: [], now: NOW }).state, 'offline');
  assert.equal(evaluate({ h4: H4, h1: H1, m15: m15With(longTail, longShape), now: NOW + 3 * 24 * 3600e3 }).state, 'offline');
});

test('weekend placeholder candles are dropped, session-edge candles are kept', () => {
  const at = (iso) => candle(Date.parse(iso), 1, 1, 1, 1);
  const list = [
    at('2026-11-13T20:00:00Z'), // Friday 15:00 New York: trading
    at('2026-11-14T00:00:00Z'), // Friday 19:00 New York: closed
    at('2026-11-14T12:00:00Z'), // Saturday
    at('2026-11-15T16:00:00Z'), // Sunday 11:00 to 15:00 New York: closed
    at('2026-11-15T20:00:00Z'), // Sunday 15:00 to 19:00 New York: covers the open
    at('2026-11-16T00:00:00Z'), // Sunday evening New York: trading
  ];
  assert.deepEqual(tradingOnly(list, INTERVAL_MS['4h']).map((c) => c.t.slice(0, 13)), ['2026-11-13T20', '2026-11-15T20', '2026-11-16T00']);
});

test('at the weekend the engine is offline rather than reading old candles', () => {
  const saturday = Date.UTC(2026, 10, 21, 12, 0, 0);
  const r = evaluate({ h4: H4, h1: H1, m15: m15With(longTail, longShape), now: saturday });
  assert.equal(r.state, 'offline');
});

test('the entry is the first close back after the retest, taken at the level', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: m15With(longTail, longShape), now: NOW });
  assert.ok(Math.abs(r.entry - r.level.price) < 10, 'entry is near the level, not a late chase');
  // One candle later it is still fresh; the entry does not move to the newer candle.
  const later = evaluate({ h4: H4, h1: H1, m15: m15With([...longTail, 4009], (k) => longShape(k) || (k >= 7 ? { l: 4008 } : null)), now: NOW });
  assert.equal(later.state, 'buy');
  assert.equal(later.entry, 4008);
});

test('a setup whose stop would be wider than the maximum is not a signal', () => {
  // Same setup, but the confirming candle dips far below the level before closing back up.
  const wide = m15With(longTail, (k) => (k === 4 ? { l: 3997 } : k === 6 ? { o: 4003, c: 4008, l: 3985 } : null));
  const r = evaluate({ h4: H4, h1: H1, m15: wide, now: NOW });
  assert.equal(r.state, 'no-setup');
  assert.match(r.reason, /stop-loss would be too wide/); assert.doesNotMatch(r.reason, /9/);
  assert.equal(r.entry, undefined);
  // A larger maximum lets the same setup through.
  const loose = evaluate({ h4: H4, h1: H1, m15: wide, now: NOW, params: { ...PARAMS, maxStopUsd: 30 } });
  assert.equal(loose.state, 'buy');
  assert.ok(loose.entry - loose.stop > 9);
});


// ---------------------------------------------------------------- order-block route
// Far from every 4H level: a red candle (the order block) before a strong move up,
// a pullback that touches it, a break of the last swing high (MSS), then a pullback
// into the Fib 0.5-0.618 zone of that move.
const obCloses = [...Array(20).fill(4050), 4047, 4056, 4060, 4064, 4058, 4056, 4052, 4049, 4055, 4060, 4066, 4069, 4063, 4057];
const obShape = (i) => (i === 23 ? { h: 4066 } : null);

test('order blocks, pressure and 30M candles', () => {
  const m15 = series(obCloses, INTERVAL_MS['15min'], obShape);
  const blocks = findOrderBlocks(m15);
  assert.ok(blocks.some((b) => b.dir === 'buy' && b.top === 4051 && b.bottom === 4046));
  assert.equal(pressure([{ o: 1, h: 2, l: 1, c: 2 }]), 1);
  assert.equal(pressure([{ o: 2, h: 2, l: 1, c: 1 }]), -1);
  assert.equal(aggregate30(m15).length <= Math.ceil(m15.length / 2) + 1, true);
});

test('no level in play: order block, MSS and Fib pullback give a BUY with at least 1:3', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: series(obCloses, INTERVAL_MS['15min'], obShape), now: NOW });
  assert.equal(r.state, 'buy', r.reason);
  assert.equal(r.setup, 'order-block');
  assert.ok(r.entry <= r.entryZone[0] + 1e-9 && r.entry >= r.entryZone[1] - 1e-9, 'entry inside the 0.5-0.618 zone');
  assert.ok(r.stop < r.entry && r.target > r.entry);
  assert.ok(r.rr >= 3, `rr ${r.rr}`);
  const leg = r.fib.zero - r.fib.one;
  assert.equal(r.stop, r.fib.one, 'stop at Fib 1');
  assert.ok(Math.abs(r.target - (r.fib.zero + leg * 0.618)) < 1e-6, 'target at -0.618');
  assert.ok(Math.abs(r.entry - (r.fib.zero - leg * 0.618)) < 1e-6, 'entry at 0.618');
  assert.ok(Math.abs(r.rr - 1.236 / 0.382) < 1e-6, 'about 1:3.2');
  assert.ok(r.pressure > 0);
});

test('with the stop at Fib 1, a pullback that only reaches 0.5 (1:2.2) is skipped', () => {
  const shallow = [...obCloses.slice(0, -1), 4059];
  const r = evaluate({ h4: H4, h1: H1, m15: series(shallow, INTERVAL_MS['15min'], obShape), now: NOW, params: { ...PARAMS, maxStopUsd: 50 } });
  assert.notEqual(r.state, 'buy');
  assert.equal(r.state, 'waiting', 'it keeps waiting for 0.618');
  assert.match(r.watch.looking.join(' '), /Fib 0\.618/);
  assert.match(r.watch.seeing.join(' '), /reached Fib 0\.5/);
});

test('5M candles: the MSS and entry are read on 5M, and 15M is built from them', () => {
  // Each 15M candle of the fixture split into three 5M candles (open, extreme leg, close).
  const m15 = series(obCloses, INTERVAL_MS['15min'], obShape);
  const m5 = m15.flatMap((c) => {
    const t = Date.parse(c.t); const up = c.c >= c.o;
    const mid = up ? c.l : c.h;
    return [
      { t: new Date(t).toISOString(), o: c.o, h: Math.max(c.o, mid), l: Math.min(c.o, mid), c: mid },
      { t: new Date(t + 300e3).toISOString(), o: mid, h: up ? c.h : c.h, l: up ? c.l : c.l, c: (mid + c.c) / 2 },
      { t: new Date(t + 600e3).toISOString(), o: (mid + c.c) / 2, h: Math.max((mid + c.c) / 2, c.c), l: Math.min((mid + c.c) / 2, c.c), c: c.c },
    ];
  });
  const rebuilt = fifteenFromFive(m5);
  assert.equal(rebuilt.length, m15.length);
  assert.deepEqual([rebuilt[30].o, rebuilt[30].h, rebuilt[30].l, rebuilt[30].c], [m15[30].o, m15[30].h, m15[30].l, m15[30].c]);
  assert.equal(fifteenFromFive(m5.slice(0, -1)).length, m15.length - 1, 'an unfinished 15M candle is left out');
  const r = evaluate({ h4: H4, h1: H1, m5, now: NOW });
  assert.equal(r.route, 'order-block');
  assert.ok(['buy', 'waiting', 'no-setup'].includes(r.state));
  if (r.state === 'buy') { assert.equal(r.stop, r.fib.one); assert.ok(r.rr >= 3); assert.equal(Date.parse(r.filledAt) - Date.parse(r.confirmedAt), 300e3, 'filled on a 5M candle'); }
});

test('order block touched but no structure shift yet: WAITING, says what it is looking for', () => {
  const r = evaluate({ h4: H4, h1: H1, m15: series(obCloses.slice(0, 30), INTERVAL_MS['15min'], obShape), now: NOW });
  assert.equal(r.state, 'waiting', r.reason);
  assert.match(r.watch.looking.join(' '), /market structure shift/);
  assert.match(r.watch.seeing.join(' '), /touched/);
});
