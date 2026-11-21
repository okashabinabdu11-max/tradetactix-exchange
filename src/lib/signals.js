// Signal engine: a rules-based reading of the trading plan.
//
//   4H  support/resistance = a price where the line chart (closes) has turned
//       at least twice.
//   1H  liquidity = the most recent swing high and swing low.
//   15M entry = price sweeps the 1H liquidity, returns to the 4H level and
//       closes back in the trade direction.
//   Stop goes just beyond the 15M retest and the 4H level, never more than
//   PARAMS.maxStopUsd from the entry. The target must offer at least 1:3.
//
// When no support or resistance is in play, an order-block setup is used:
//   30M (or 15M) order block = the last opposite candle before a strong move.
//   Price comes back and touches it, then a 15M market structure shift (MSS)
//   breaks the last swing against the move. A Fib is drawn on that MSS leg
//   (1 = the leg's start, 0 = its end): entry in the 0.5-0.618 zone, stop at
//   0.786, take-profit at the -0.618 extension. Candle pressure (an estimated
//   delta, since spot gold has no exchange volume) must agree with the move.
//
// Pure functions over candle arrays ({ t, o, h, l, c }, oldest first), so the
// whole engine is unit tested. It reads prices; it never places a trade.

import { MIN_REWARD_TO_RISK } from './risk.js';
import { isGoldMarketOpen } from './sessions.js';

export const PARAMS = Object.freeze({
  pivotSpan: 2, // bars on each side that a swing point must beat
  levelToleranceAtr: 0.25, // turns closer than this (in 4H ATRs) are one level
  zoneAtr: 0.5, // "at the level" means within this many 4H ATRs
  minTouches: 2,
  lookback15: 16, // 15M candles examined for the sweep and retest (4 hours)
  freshBars: 2, // a confirmation older than this many candles is stale
  stopBufferAtr15: 0.1,
  // Largest stop-loss allowed, in US dollars of price. At 0.01 lot (1 oz) on a
  // standard account this is also the most one trade can lose. A setup whose
  // stop would be wider is not a signal.
  maxStopUsd: 9,
  // Order-block setup
  obDisplacementAtr: 0.8, // the move away from an order block must be this many ATRs
  obMaxAgeBars: 64, // order blocks older than this many 15M candles (16 hours) are ignored
  touchLookback: 24, // the order-block touch must be within this many 15M candles (6 hours)
  fibEntry: [0.5, 0.618], // entry zone, as Fib retracements of the MSS leg
  fibStop: 0.786,
  fibTarget: -0.618,
  minPressure: 0.1, // estimated delta of the MSS leg, from -1 (all selling) to 1 (all buying)
});

export const INTERVAL_MS = { '4h': 4 * 3600e3, '1h': 3600e3, '30min': 1800e3, '15min': 900e3 };

/** Drops the candle that is still forming. */
export function closedOnly(candles, intervalMs, now = Date.now()) {
  return candles.filter((c) => new Date(c.t).getTime() + intervalMs <= now);
}

/**
 * Drops candles from hours when gold does not trade. The data provider fills
 * weekends with flat placeholder candles, which would distort levels and ATR.
 */
export function tradingOnly(candles, intervalMs) {
  return candles.filter((c) => {
    const start = new Date(c.t).getTime();
    return isGoldMarketOpen(new Date(start)) || isGoldMarketOpen(new Date(start + intervalMs - 60e3));
  });
}

export function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const start = Math.max(1, candles.length - period);
  let sum = 0;
  for (let i = start; i < candles.length; i += 1) {
    const prev = candles[i - 1].c;
    sum += Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prev), Math.abs(candles[i].l - prev));
  }
  return sum / (candles.length - start);
}

/** Indexes where `values` makes a swing high or low against `span` bars each side. */
export function pivots(values, span = PARAMS.pivotSpan) {
  const out = [];
  for (let i = span; i < values.length - span; i += 1) {
    let high = true;
    let low = true;
    for (let k = 1; k <= span; k += 1) {
      if (!(values[i] > values[i - k] && values[i] > values[i + k])) high = false;
      if (!(values[i] < values[i - k] && values[i] < values[i + k])) low = false;
    }
    if (high) out.push({ i, v: values[i], kind: 'high' });
    if (low) out.push({ i, v: values[i], kind: 'low' });
  }
  return out;
}

/** 4H levels: prices where the closing line turned at least `minTouches` times. */
export function findLevels(h4, params = PARAMS) {
  const tolerance = atr(h4) * params.levelToleranceAtr;
  const turns = pivots(h4.map((c) => c.c), params.pivotSpan).sort((a, b) => a.v - b.v);
  const clusters = [];
  for (const turn of turns) {
    const last = clusters[clusters.length - 1];
    if (last && turn.v - last.sum / last.count <= tolerance) {
      last.sum += turn.v;
      last.count += 1;
      last.lastIndex = Math.max(last.lastIndex, turn.i);
    } else {
      clusters.push({ sum: turn.v, count: 1, lastIndex: turn.i });
    }
  }
  return clusters
    .filter((c) => c.count >= params.minTouches)
    .map((c) => ({ price: c.sum / c.count, touches: c.count, lastTouch: h4[c.lastIndex].t }));
}

/** Most recent 1H swing high and low that formed before `before` (ms). */
export function findLiquidity(h1, before = Infinity, params = PARAMS) {
  const formedBy = (p) => new Date(h1[p.i + params.pivotSpan].t).getTime() < before;
  const lastOf = (kind, values) => {
    const list = pivots(values, params.pivotSpan).filter((p) => p.kind === kind && formedBy(p));
    const p = list[list.length - 1];
    return p ? { price: p.v, t: h1[p.i].t } : null;
  };
  return { high: lastOf('high', h1.map((c) => c.h)), low: lastOf('low', h1.map((c) => c.l)) };
}


// ---------------------------------------------------------------- order blocks

/** Joins 15M candles into 30M candles on :00 and :30 boundaries. */
export function aggregate30(c15) {
  const out = [];
  for (const c of c15) {
    const t = new Date(c.t).getTime();
    const start = Math.floor(t / 1800e3) * 1800e3;
    const last = out[out.length - 1];
    if (last && last._s === start) {
      last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c;
    } else {
      out.push({ _s: start, t: new Date(start).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c });
    }
  }
  return out.map(({ _s, ...c }) => c);
}

/**
 * Estimated delta of candles, from -1 (sellers closed every candle at its low)
 * to 1 (buyers closed every candle at its high). Spot gold has no central
 * exchange volume, so this reads pressure from where each candle closed.
 */
export function pressure(candles) {
  if (!candles.length) return 0;
  let sum = 0;
  for (const c of candles) sum += c.h > c.l ? (c.c - c.o) / (c.h - c.l) : 0;
  return sum / candles.length;
}

/**
 * Order blocks: the last opposite candle before a strong move. A bullish block
 * is a red candle followed, within three candles, by a close at least
 * `obDisplacementAtr` ATRs above its high. A block that price later closed
 * through is spent and dropped.
 */
export function findOrderBlocks(candles, params = PARAMS, tf = '15M') {
  const a = atr(candles);
  const out = [];
  if (!(a > 0)) return out;
  for (let i = 1; i < candles.length - 1; i += 1) {
    const b = candles[i];
    for (const dir of ['buy', 'sell']) {
      const long = dir === 'buy';
      if (long ? !(b.c < b.o) : !(b.c > b.o)) continue;
      let formed = -1;
      for (let j = i + 1; j <= Math.min(i + 3, candles.length - 1); j += 1) {
        if (long ? candles[j].c - b.h >= a * params.obDisplacementAtr : b.l - candles[j].c >= a * params.obDisplacementAtr) { formed = j; break; }
      }
      if (formed === -1) continue;
      const spent = candles.slice(formed + 1).some((c) => (long ? c.c < b.l : c.c > b.h));
      if (spent) continue;
      out.push({ dir, tf, top: b.h, bottom: b.l, t: b.t, formedAt: candles[formed].t });
    }
  }
  return out;
}

const fibAt = (one, zero, x) => zero + (one - zero) * x; // 1 = leg start, 0 = leg end

/**
 * One order-block setup in one direction, read on the 15M candles.
 * Returns how far it got: 1 found, 2 touched, 3 MSS, 4 in the entry zone.
 */
function obSetup(ob, c15, now, minRR, params) {
  const long = ob.dir === 'buy';
  const s = long ? 1 : -1;
  const ms = (c) => new Date(c.t).getTime();
  const formedEnd = new Date(ob.formedAt).getTime() + (ob.tf === '30M' ? 1800e3 : 900e3);
  const res = { ob, dir: ob.dir, stage: 1 };
  const startIdx = c15.findIndex((c) => ms(c) >= formedEnd);
  if (startIdx === -1) return res;
  const inZone = (c) => (long ? c.l <= ob.top : c.h >= ob.bottom);
  const broke = (c) => (long ? c.c < ob.bottom : c.c > ob.top);
  let touch = -1;
  for (let i = startIdx; i < c15.length; i += 1) {
    if (broke(c15[i])) return { ...res, spent: true };
    if (inZone(c15[i])) { touch = i; break; }
  }
  if (touch === -1) return res;
  if (touch < c15.length - params.touchLookback) return { ...res, stale: true };
  res.stage = 2; res.touchAt = c15[touch].t;

  // The swing the MSS must break: the last 15M swing against the move, before the touch.
  const swings = pivots(c15.map((c) => (long ? c.h : c.l)), params.pivotSpan).filter((p) => p.kind === (long ? 'high' : 'low') && p.i < touch);
  const swing = swings[swings.length - 1];
  if (!swing) return { ...res, note: 'no swing' };
  res.swing = swing.v;
  let mss = -1;
  for (let i = touch; i < c15.length; i += 1) {
    if (broke(c15[i])) return { ...res, spent: true };
    if (long ? c15[i].c > swing.v : c15[i].c < swing.v) { mss = i; break; }
  }
  if (mss === -1) return res;
  res.stage = 3; res.mssAt = c15[mss].t;

  // Fib on the MSS leg: 1 = the extreme reached in the order block, 0 = the end of the move.
  let one = c15[touch][long ? 'l' : 'h'];
  let oneIdx = touch;
  for (let i = touch; i <= mss; i += 1) if ((c15[i][long ? 'l' : 'h'] - one) * s < 0) { one = c15[i][long ? 'l' : 'h']; oneIdx = i; }
  let zero = one;
  for (let i = oneIdx; i <= mss; i += 1) zero = long ? Math.max(zero, c15[i].h) : Math.min(zero, c15[i].l);
  res.pressure = pressure(c15.slice(oneIdx, mss + 1));
  const [z1, z2] = params.fibEntry;
  for (let k = mss + 1; k < c15.length; k += 1) {
    const c = c15[k];
    const shallow = fibAt(one, zero, z1);
    const deep = fibAt(one, zero, z2);
    const stop = fibAt(one, zero, params.fibStop);
    if (long ? c.l <= shallow : c.h >= shallow) {
      if (long ? c.l <= stop : c.h >= stop) return { ...res, one, zero, failed: true };
      const entry = (long ? c.l <= deep : c.h >= deep) ? deep : shallow;
      const target = fibAt(one, zero, params.fibTarget);
      const risk = (entry - stop) * s;
      const rr = ((target - entry) * s) / risk;
      const after = c15.slice(k + 1);
      Object.assign(res, { stage: 4, one, zero, entry, stop, target, risk, rr, zone: [shallow, deep], confirmedAt: c.t });
      if (after.some((x) => (long ? x.l <= stop : x.h >= stop))) return { ...res, failed: true };
      if (k < c15.length - params.freshBars) return { ...res, expired: true };
      return res;
    }
    zero = long ? Math.max(zero, c.h) : Math.min(zero, c.l);
  }
  Object.assign(res, { one, zero, zone: [fibAt(one, zero, z1), fibAt(one, zero, z2)], stop: fibAt(one, zero, params.fibStop), target: fibAt(one, zero, params.fibTarget) });
  return res;
}

const P = (n) => Number(n).toFixed(2);

/** The order-block route: the most advanced setup, from 30M blocks first, then 15M. */
export function evaluateOrderBlocks({ c15, now, minRR, params = PARAMS }) {
  const price = c15[c15.length - 1].c;
  const recent = c15.slice(-params.obMaxAgeBars);
  const blocks = [
    ...findOrderBlocks(aggregate30(recent), params, '30M'),
    ...findOrderBlocks(recent, params, '15M'),
  ];
  const setups = blocks.map((ob) => obSetup(ob, c15, now, minRR, params)).filter((x) => !x.spent && !x.stale && !x.failed);
  const rank = (x) => x.stage * 10 + (x.ob.tf === '30M' ? 1 : 0) + (x.expired ? -5 : 0);
  // Among untouched blocks prefer the closest to price.
  const dist = (x) => Math.min(Math.abs(price - x.ob.top), Math.abs(price - x.ob.bottom));
  setups.sort((a, b) => rank(b) - rank(a) || dist(a) - dist(b));
  const best = setups[0];
  if (!best) {
    return { found: false, looking: ['A fresh order block: the last opposite candle before a strong move.'], seeing: [`Price ${P(price)}. No unused order block in the last 16 hours.`] };
  }
  const long = best.dir === 'buy';
  const side = long ? 'bullish' : 'bearish';
  const zoneTxt = `${P(Math.min(best.ob.top, best.ob.bottom))}–${P(Math.max(best.ob.top, best.ob.bottom))}`;
  const out = { found: true, setup: best };
  if (best.stage === 1) {
    out.looking = [`Price to come back to the ${side} order block at ${zoneTxt}.`, `Then a market structure shift ${long ? 'up' : 'down'} before any entry.`];
    out.seeing = [`Price ${P(price)}, ${P(dist(best))} away from the block.`];
  } else if (best.stage === 2) {
    out.looking = [`A market structure shift: a close ${long ? 'above' : 'below'} ${P(best.swing ?? price)}.`, 'Then a pullback into the Fib entry zone.'];
    out.seeing = [`Price touched the ${side} order block at ${zoneTxt}.`, `Price now ${P(price)}.`];
  } else if (best.stage === 3) {
    out.looking = [`A pullback into the entry zone ${P(best.zone[0])}–${P(best.zone[1])} (Fib 0.5–0.618).`, `Stop ${P(best.stop)} (0.786), target ${P(best.target)} (−0.618).`];
    out.seeing = [`Order block touched and structure shifted ${long ? 'up' : 'down'}.`, `Price now ${P(price)}. Candle pressure ${best.pressure >= 0 ? 'buying' : 'selling'} ${Math.round(Math.abs(best.pressure) * 100)}%.`];
  } else if (best.expired) {
    out.looking = ['A new order-block setup.'];
    out.seeing = [`A ${long ? 'buy' : 'sell'} entry filled at ${P(best.entry)} earlier; that entry has passed.`];
  } else {
    out.looking = [];
    out.seeing = [`Price pulled back into the entry zone ${P(best.zone[0])}–${P(best.zone[1])}.`];
  }
  return out;
}

function evaluateDirection(dir, { level, levels, liquidity, window, atr4, atr15, minRR, params }) {
  const long = dir === 'buy';
  const s = long ? 1 : -1;
  const pool = long ? liquidity.low : liquidity.high;
  const extreme = (c) => (long ? c.l : c.h); // the side of the candle that sweeps
  const beyond = (a, b) => (long ? a < b : a > b);
  const result = { direction: dir, sweep: false, retest: false, confirm: false, rrOk: false, passed: 0 };
  if (!pool) return { ...result, note: `No 1H swing ${long ? 'low' : 'high'} to sweep yet.` };
  result.pool = pool.price;

  const sweepIdx = window.findIndex((c) => beyond(extreme(c), pool.price));
  if (sweepIdx === -1) return { ...result, note: `Price has not swept the 1H ${long ? 'low' : 'high'} at ${pool.price.toFixed(2)}.` };
  result.sweep = true;
  result.passed = 1;

  // The retest is the latest candle, from the sweep onwards, whose range reaches the level.
  const band = atr4 * params.levelToleranceAtr;
  const touches = (c) => c.l <= level.price + band && c.h >= level.price - band;
  let retestIdx = -1;
  for (let j = window.length - 1; j >= sweepIdx; j -= 1) {
    if (touches(window[j])) { retestIdx = j; break; }
  }
  if (retestIdx === -1) return { ...result, note: 'Liquidity is swept; waiting for price to come back to the 4H level.' };
  result.retest = true;
  result.passed = 2;

  // The entry is the first candle, at or after that retest, that closes back in the trade direction.
  const confirms = (c) => (long ? c.c > c.o && c.c > level.price && c.c > pool.price : c.c < c.o && c.c < level.price && c.c < pool.price);
  const confirmIdx = window.findIndex((c, j) => j >= retestIdx && confirms(c));
  if (confirmIdx === -1) return { ...result, note: `Level retested; waiting for a 15M candle to close back ${long ? 'above' : 'below'} it.` };
  if (confirmIdx < window.length - params.freshBars) {
    const at = new Date(new Date(window[confirmIdx].t).getTime() + INTERVAL_MS['15min']).toISOString().slice(11, 16);
    return { ...result, expired: true, note: `A ${long ? 'buy' : 'sell'} setup confirmed at ${at} UTC and that entry has passed. Waiting for a new one.` };
  }

  const entry = window[confirmIdx].c;
  // The stop protects the 15M retest: just beyond the retest-and-confirmation
  // candles, and never inside the 4H level. Price trading back through the
  // level is what proves the setup wrong.
  const retestExtreme = window.slice(retestIdx, confirmIdx + 1)
    .reduce((m, c) => (long ? Math.min(m, c.l) : Math.max(m, c.h)), long ? level.price : level.price);
  const stop = retestExtreme - s * atr15 * params.stopBufferAtr15;
  const risk = (entry - stop) * s;
  const invalidated = window.slice(confirmIdx + 1).some((c) => beyond(extreme(c), stop));
  if (!(risk > 0) || invalidated) return { ...result, note: 'The confirmation was invalidated: price went back through the stop.' };
  result.confirm = true;
  result.passed = 3;
  Object.assign(result, { entry, stop, risk, confirmedAt: window[confirmIdx].t });
  if (risk > params.maxStopUsd + 1e-9) {
    return { ...result, tooWide: true, note: 'A setup confirmed, but its stop-loss would be too wide, so it was skipped.' };
  }

  // Target: the next 4H level in the trade direction, if it is at least 1:minRR away.
  const ahead = levels
    .map((l) => l.price)
    .filter((p) => (p - entry) * s > 0 && Math.abs(p - level.price) > 1e-9)
    .sort((a, b) => (a - b) * s)[0];
  if (ahead !== undefined) {
    const available = ((ahead - entry) * s) / risk;
    if (available < minRR - 1e-9) {
      return { ...result, target: ahead, rr: available, note: `The next 4H level at ${ahead.toFixed(2)} only allows 1:${available.toFixed(1)}, below the 1:${minRR} minimum.` };
    }
    Object.assign(result, { target: ahead, rr: available, targetBasis: 'next 4H level' });
  } else {
    Object.assign(result, { target: entry + s * risk * minRR, rr: minRR, targetBasis: `1:${minRR} from entry` });
  }
  result.rrOk = true;
  result.passed = 4;
  return result;
}

/**
 * Reads the three timeframes and returns the engine's state.
 * state: 'offline' | 'no-setup' | 'waiting' | 'buy' | 'sell'
 */
export function evaluate({ h4, h1, m15, now = Date.now(), minRewardToRisk = MIN_REWARD_TO_RISK, params = PARAMS }) {
  const minRR = Math.max(MIN_REWARD_TO_RISK, Number(minRewardToRisk) || MIN_REWARD_TO_RISK);
  const c4 = tradingOnly(closedOnly(h4 || [], INTERVAL_MS['4h'], now), INTERVAL_MS['4h']);
  const c1 = tradingOnly(closedOnly(h1 || [], INTERVAL_MS['1h'], now), INTERVAL_MS['1h']);
  const c15 = tradingOnly(closedOnly(m15 || [], INTERVAL_MS['15min'], now), INTERVAL_MS['15min']);
  if (c4.length < 30 || c1.length < 20 || c15.length < params.lookback15 + 14) {
    return { state: 'offline', reason: 'Not enough candle history to analyse yet.', checks: null };
  }
  const lastClose = new Date(c15[c15.length - 1].t).getTime() + INTERVAL_MS['15min'];
  if (now - lastClose > 2 * 3600e3) {
    return { state: 'offline', reason: 'The market is closed or the candle data is out of date.', checks: null, asOf: c15[c15.length - 1].t };
  }

  const price = c15[c15.length - 1].c;
  const atr4 = atr(c4);
  const atr15 = atr(c15);
  const levels = findLevels(c4, params);
  const window = c15.slice(-params.lookback15);
  const liquidity = findLiquidity(c1, new Date(window[0].t).getTime(), params);
  const base = { price, levels, liquidity, asOf: c15[c15.length - 1].t, minRR };

  const nearest = [...levels].sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
  const zone = atr4 * params.zoneAtr;
  const distance = nearest ? Math.abs(nearest.price - price) : Infinity;
  if (!nearest || distance > zone) {
    // No support or resistance in play: use the order-block route.
    const levelNote = nearest ? `Nearest ${nearest.price > price ? 'resistance' : 'support'} ${nearest.price.toFixed(2)} is ${distance.toFixed(2)} away.` : 'No support or resistance level with two turns.';
    const ob = evaluateOrderBlocks({ c15, now, minRR, params });
    const srChecks = {
      h4: { ok: false, text: nearest ? `Nearest level ${nearest.price.toFixed(2)}, ${distance.toFixed(2)} away` : 'No level with two turns' },
      h1: liquidity.high || liquidity.low ? { ok: null, text: `High ${liquidity.high ? liquidity.high.price.toFixed(2) : 'n/a'}, low ${liquidity.low ? liquidity.low.price.toFixed(2) : 'n/a'}` } : null,
      m15: null,
    };
    const watch = { looking: ob.looking || [], seeing: [...(ob.seeing || []), levelNote] };
    const common = { ...base, level: nearest || null, checks: srChecks, watch, route: 'order-block' };
    if (!ob.found) return { ...common, state: 'no-setup', reason: `${levelNote} No order-block setup either.` };
    const x = ob.setup;
    const long = x.dir === 'buy';
    if (x.stage === 4 && !x.expired) {
      const agrees = long ? x.pressure >= params.minPressure : x.pressure <= -params.minPressure;
      if (!agrees) return { ...common, state: 'no-setup', direction: x.dir, reason: 'An order-block entry formed, but candle pressure did not agree with the move, so it was skipped.' };
      if (x.risk > params.maxStopUsd + 1e-9) return { ...common, state: 'no-setup', direction: x.dir, reason: 'An order-block entry formed, but its stop-loss would be too wide, so it was skipped.' };
      if (!(x.rr >= minRR - 1e-9)) return { ...common, state: 'no-setup', direction: x.dir, reason: `An order-block entry formed, but it only offers 1:${x.rr.toFixed(1)}.` };
      return {
        ...common, state: x.dir, direction: x.dir, setup: 'order-block',
        entry: x.entry, stop: x.stop, target: x.target, rr: x.rr, confirmedAt: x.confirmedAt,
        targetBasis: 'the −0.618 Fib extension of the structure-shift move',
        entryZone: x.zone, fib: { one: x.one, zero: x.zero }, pressure: x.pressure, orderBlock: { top: x.ob.top, bottom: x.ob.bottom, tf: x.ob.tf },
        reason: `Order block touched, structure shifted ${long ? 'up' : 'down'}, and price pulled back into the Fib entry zone.`,
      };
    }
    return { ...common, state: x.stage >= 2 && !x.expired ? 'waiting' : 'no-setup', direction: x.dir, reason: [...watch.seeing.slice(0, 1), ...watch.looking.slice(0, 1).map((l) => `Looking for ${l.charAt(0).toLowerCase()}${l.slice(1)}`)].join(' ') };
  }

  const ctx = { level: nearest, levels, liquidity, window, atr4, atr15, minRR, params };
  const buy = evaluateDirection('buy', ctx);
  const sell = evaluateDirection('sell', ctx);
  const preferBuy = price >= nearest.price;
  const best = buy.passed === sell.passed ? (preferBuy ? buy : sell) : buy.passed > sell.passed ? buy : sell;

  const role = best.direction === 'buy' ? 'support' : 'resistance';
  const checks = {
    h4: { ok: true, text: `At ${role} ${nearest.price.toFixed(2)} (${nearest.touches} turns)` },
    h1: { ok: best.sweep, text: best.pool === undefined ? 'No swing to sweep yet' : best.sweep ? `Swept the ${best.direction === 'buy' ? 'low' : 'high'} at ${best.pool.toFixed(2)}` : `${best.direction === 'buy' ? 'Low' : 'High'} at ${best.pool.toFixed(2)} not swept` },
    m15: { ok: best.confirm, text: best.confirm ? 'Retest confirmed' : best.retest ? 'Retested, no confirming close yet' : 'No retest yet' },
  };

  const lvl = nearest.price.toFixed(2);
  const watch = { looking: [], seeing: [`Price ${price.toFixed(2)} at ${role} ${lvl} (${nearest.touches} turns).`] };
  if (best.pool !== undefined) watch.seeing.push(best.sweep ? `Liquidity ${best.direction === 'buy' ? 'below' : 'above'} ${best.pool.toFixed(2)} was swept.` : `Liquidity ${best.direction === 'buy' ? 'below' : 'above'} ${best.pool.toFixed(2)} is not swept yet.`);
  if (!best.sweep) watch.looking.push(best.pool === undefined ? 'A clear swing high or low to form near the level.' : `Price to sweep the liquidity ${best.direction === 'buy' ? 'below' : 'above'} ${best.pool.toFixed(2)}.`);
  else if (!best.retest) watch.looking.push(`Price to come back to the ${role} at ${lvl}.`);
  else if (!best.confirm) watch.looking.push(`A candle to close back ${best.direction === 'buy' ? 'above' : 'below'} ${lvl}.`);
  watch.looking.push('Then an entry with at least 1:3.');
  base.watch = watch;
  base.route = 'support-resistance';

  if (best.passed === 4) {
    return { ...base, state: best.direction, setup: 'support-resistance', level: nearest, checks, direction: best.direction, entry: best.entry, stop: best.stop, target: best.target, rr: best.rr, targetBasis: best.targetBasis, confirmedAt: best.confirmedAt, reason: `All checks passed at the 4H ${role} ${nearest.price.toFixed(2)}.` };
  }
  if (best.expired) {
    checks.m15 = { ok: false, text: 'Confirmed earlier; that entry has passed' };
    return { ...base, state: 'no-setup', level: nearest, checks, direction: best.direction, reason: best.note };
  }
  if (best.passed === 3) {
    // Setup confirmed but the reward is too small: by the plan this is not a trade.
    return { ...base, state: 'no-setup', level: nearest, checks, direction: best.direction, reason: best.note };
  }
  return { ...base, state: 'waiting', level: nearest, checks, direction: best.direction, reason: best.note };
}
