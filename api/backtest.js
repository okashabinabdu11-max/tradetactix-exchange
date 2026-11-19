// GET /api/backtest?days=7..50 — Chart Pro only. Replays the TradeTactix plan
// on real past XAUUSD candles from Twelve Data. Results are a backtest, not
// live results. One shared download per server for 30 minutes keeps the free
// data plan within its limits.

import { bearerToken, getChartAccess } from './_lib/access.js';
import { normalizeSeries } from './_lib/candles.js';
import { backtest } from './_lib/backtest.js';
import { replayHandler } from './_lib/replay.js';

export { _resetReplayCache } from './_lib/replay.js';

const PROVIDER_URL = 'https://api.twelvedata.com/time_series';
const SIZES = { '4h': 800, '1h': 1600, '15min': 5000 };
const CACHE_MS = 30 * 60e3;
let cache = { at: 0, data: null };

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).send(JSON.stringify(body));
};

async function history() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw Object.assign(new Error('not_configured'), { status: 503 });
  const load = async (tf) => {
    const params = new URLSearchParams({ symbol: 'XAU/USD', interval: tf, outputsize: String(SIZES[tf]), timezone: 'UTC', apikey: key });
    const r = await fetch(`${PROVIDER_URL}?${params}`, { signal: AbortSignal.timeout(15000) });
    const out = normalizeSeries(await r.json());
    if (!out.ok) throw Object.assign(new Error(out.error), { status: out.status });
    return out.candles;
  };
  const [h4, h1, m15] = await Promise.all([load('4h'), load('1h'), load('15min')]);
  cache = { at: Date.now(), data: { h4, h1, m15 } };
  return cache.data;
}

export const _resetBacktestCache = () => { cache = { at: 0, data: null }; };

export default async function handler(req, res) {
  // Bar replay candles share this function (?symbol=…&interval=…).
  if (req.query?.symbol !== undefined) return replayHandler(req, res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { message: 'Use GET.' }); }
  const token = bearerToken(req);
  if (!token) return send(res, 401, { message: 'Open your account first.' });
  const access = await getChartAccess(token);
  if (!access.chart_pro) return send(res, 403, { message: 'Backtesting is part of Chart Pro.' });
  const days = Math.min(50, Math.max(7, Math.round(Number(req.query?.days) || 30)));
  try {
    const all = await history();
    const since = Date.now() - days * 86400e3;
    // Warm-up candles before the chosen period so the engine starts with history.
    const firstIdx = all.m15.findIndex((c) => new Date(c.t).getTime() >= since);
    const start = Math.max(0, (firstIdx < 0 ? all.m15.length : firstIdx) - 120);
    const result = backtest({ h4: all.h4, h1: all.h1, m15: all.m15.slice(start), warmup: Math.min(120, firstIdx < 0 ? 0 : firstIdx - start) });
    return send(res, 200, { days, source: 'Twelve Data', note: 'Backtest on past candles, not live results. The news pause is not replayed.', ...result });
  } catch (err) {
    console.error('backtest failed', err?.message);
    const status = err?.status === 429 ? 429 : 502;
    return send(res, status, { message: status === 429 ? 'The price data limit is reached for now. Try again in a few minutes.' : 'Past prices could not be loaded. Try again later.' });
  }
}
