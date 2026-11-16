// Signal engine: a rules-based reading of the trading plan.
//
//   4H  support/resistance = a price where the line chart (closes) has turned
//       at least twice.
//   1H  liquidity = the most recent swing high and swing low.
//   15M entry = price sweeps the 1H liquidity, returns to the 4H level and
//       closes back in the trade direction.
//   Stop goes beyond the sweep. The target must offer at least 1:3.
//
// Pure functions over candle arrays ({ t, o, h, l, c }, oldest first), so the
// whole engine is unit tested. It reads prices; it never places a trade.

import { MIN_REWARD_TO_RISK } from './risk.js';

export const PARAMS = Object.freeze({
  pivotSpan: 2, // bars on each side that a swing point must beat
  levelToleranceAtr: 0.25, // turns closer than this (in 4H ATRs) are one level
  zoneAtr: 0.5, // "at the level" means within this many 4H ATRs
  minTouches: 2,
  lookback15: 16, // 15M candles examined for the sweep and retest (4 hours)
  freshBars: 2, // a confirmation older than this many candles is stale
  stopBufferAtr15: 0.1,
});

export const INTERVAL_MS = { '4h': 4 * 3600e3, '1h': 3600e3, '15min': 900e3 };

/** Drops the candle that is still forming. */
export function closedOnly(candles, intervalMs, now = Date.now()) {
  return candles.filter((c) => new Date(c.t).getTime() + intervalMs <= now);
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

  const touch = level.price + s * atr4 * params.levelToleranceAtr;
  const retested = window.slice(sweepIdx).some((c) => (long ? c.l <= touch : c.h >= touch));
  if (!retested) return { ...result, note: 'Liquidity is swept; waiting for price to come back to the 4H level.' };
  result.retest = true;
  result.passed = 2;

  // Newest candle (within the freshness limit) that closes back in the trade direction.
  let confirmIdx = -1;
  for (let j = window.length - 1; j >= Math.max(sweepIdx, window.length - params.freshBars); j -= 1) {
    const c = window[j];
    const directional = long ? c.c > c.o : c.c < c.o;
    const reclaimed = long ? c.c > level.price && c.c > pool.price : c.c < level.price && c.c < pool.price;
    if (directional && reclaimed) { confirmIdx = j; break; }
  }
  if (confirmIdx === -1) return { ...result, note: `Level retested; waiting for a 15M candle to close back ${long ? 'above' : 'below'} it.` };

  const entry = window[confirmIdx].c;
  const sweepExtreme = window.slice(sweepIdx, confirmIdx + 1).reduce((m, c) => (long ? Math.min(m, c.l) : Math.max(m, c.h)), long ? Infinity : -Infinity);
  const stop = sweepExtreme - s * atr15 * params.stopBufferAtr15;
  const risk = (entry - stop) * s;
  const invalidated = window.slice(confirmIdx + 1).some((c) => beyond(extreme(c), stop));
  if (!(risk > 0) || invalidated) return { ...result, note: 'The confirmation was invalidated: price went back through the stop.' };
  result.confirm = true;
  result.passed = 3;
  Object.assign(result, { entry, stop, risk, confirmedAt: window[confirmIdx].t });

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
  const c4 = closedOnly(h4 || [], INTERVAL_MS['4h'], now);
  const c1 = closedOnly(h1 || [], INTERVAL_MS['1h'], now);
  const c15 = closedOnly(m15 || [], INTERVAL_MS['15min'], now);
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
  if (!nearest) {
    return { ...base, state: 'no-setup', reason: 'The 4H line chart has no level that price has turned at twice.', checks: { h4: { ok: false, text: 'No level with two turns' }, h1: null, m15: null } };
  }
  const distance = Math.abs(nearest.price - price);
  if (distance > zone) {
    return {
      ...base,
      state: 'no-setup',
      level: nearest,
      reason: `Price is ${distance.toFixed(2)} away from the nearest 4H level at ${nearest.price.toFixed(2)}.`,
      checks: {
        h4: { ok: false, text: `Nearest level ${nearest.price.toFixed(2)}, ${distance.toFixed(2)} away` },
        h1: liquidity.high || liquidity.low ? { ok: null, text: `High ${liquidity.high ? liquidity.high.price.toFixed(2) : 'n/a'}, low ${liquidity.low ? liquidity.low.price.toFixed(2) : 'n/a'}` } : null,
        m15: null,
      },
    };
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

  if (best.passed === 4) {
    return { ...base, state: best.direction, level: nearest, checks, direction: best.direction, entry: best.entry, stop: best.stop, target: best.target, rr: best.rr, targetBasis: best.targetBasis, confirmedAt: best.confirmedAt, reason: `All checks passed at the 4H ${role} ${nearest.price.toFixed(2)}.` };
  }
  if (best.passed === 3) {
    // Setup confirmed but the reward is too small: by the plan this is not a trade.
    return { ...base, state: 'no-setup', level: nearest, checks, direction: best.direction, reason: best.note };
  }
  return { ...base, state: 'waiting', level: nearest, checks, direction: best.direction, reason: best.note };
}
