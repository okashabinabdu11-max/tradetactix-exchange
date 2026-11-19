// GET /api/backtest?symbol=EUR/USD&interval=15min — Chart Pro only.
// (Served by api/backtest.js: the Hobby plan allows 12 server functions.)
// Real past candles (Twelve Data) for bar replay practice on the chart page.
// Each pair and timeframe is downloaded at most once per server every 30 minutes.

import { bearerToken, getChartAccess } from './access.js';
import { normalizeSeries } from './candles.js';

const PROVIDER_URL = 'https://api.twelvedata.com/time_series';
const INTERVALS = new Set(['5min', '15min', '1h', '4h', '1day']);
const SYMBOL = /^[A-Z]{3,4}\/[A-Z]{3}$/;
const CACHE_MS = 30 * 60e3;
const cache = new Map();

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).send(JSON.stringify(body));
};

export const _resetReplayCache = () => cache.clear();

export async function replayHandler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { message: 'Use GET.' }); }
  const symbol = String(req.query?.symbol || '').toUpperCase();
  const interval = String(req.query?.interval || '');
  if (!SYMBOL.test(symbol) || !INTERVALS.has(interval)) return send(res, 400, { message: 'This pair or timeframe cannot be replayed.' });
  const token = bearerToken(req);
  if (!token) return send(res, 401, { message: 'Open your account first.' });
  const access = await getChartAccess(token);
  if (!access.chart_pro) return send(res, 403, { message: 'Backtesting is part of Chart Pro.' });

  const key = `${symbol}|${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.body);
  const apikey = process.env.TWELVEDATA_API_KEY;
  if (!apikey) return send(res, 503, { message: 'Past prices are not set up yet.' });
  try {
    const params = new URLSearchParams({ symbol, interval, outputsize: '5000', timezone: 'UTC', apikey });
    const r = await fetch(`${PROVIDER_URL}?${params}`, { signal: AbortSignal.timeout(15000) });
    const out = normalizeSeries(await r.json());
    if (!out.ok) {
      if (out.status === 429) return send(res, 429, { message: 'The price data limit is reached for now. Try again in a minute.' });
      return send(res, 404, { message: `No past prices for ${symbol} on this timeframe.` });
    }
    const body = { symbol, interval, source: 'Twelve Data', candles: out.candles };
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), body });
    return send(res, 200, body);
  } catch (err) {
    console.error('replay candles failed', err?.message);
    return send(res, 502, { message: 'Past prices could not be loaded. Try again later.' });
  }
}
