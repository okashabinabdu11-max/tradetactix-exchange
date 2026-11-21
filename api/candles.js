// GET /api/candles?tf=4h|1h|15min|5min&symbol=XAUUSD|BTCUSD&k=… — candles for the signal engine.
// XAUUSD from Twelve Data (server-side so the key stays private); BTCUSD from
// public exchange data. Cached per timeframe so the free limits are not exceeded.

import { timingSafeEqual } from 'node:crypto';
import { normalizeSeries, TIMEFRAMES, fetchBitcoinCandles } from './_lib/candles.js';

const PROVIDER_URL = 'https://api.twelvedata.com/time_series';
const send = (res, status, body, cacheSeconds) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=60`);
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'method_not_allowed' }, 60);
  }
  // Raw candles are enough to rebuild every signal, so only our own signal
  // function may read them. It proves itself with a key held in the server's
  // environment. Without that key configured, nothing is served.
  const expected = process.env.CANDLES_KEY || '';
  const given = String(req.query?.k || '');
  const a = Buffer.from(given.padEnd(64).slice(0, 64));
  const b = Buffer.from(expected.padEnd(64).slice(0, 64));
  if (!expected || given.length !== expected.length || !timingSafeEqual(a, b)) return send(res, 403, { error: 'forbidden' }, 60);

  const tf = String(req.query?.tf || '');
  const config = Object.hasOwn(TIMEFRAMES, tf) ? TIMEFRAMES[tf] : null;
  if (!config) return send(res, 400, { error: 'bad_timeframe' }, 300);

  const symbol = String(req.query?.symbol || 'XAUUSD').toUpperCase();
  if (symbol === 'BTCUSD') {
    try {
      const { source, candles } = await fetchBitcoinCandles(tf);
      return send(res, 200, { symbol, timeframe: tf, source, fetchedAt: new Date().toISOString(), candles }, config.cacheSeconds);
    } catch (err) {
      console.error('bitcoin candles failed', tf, err?.error);
      return send(res, err?.status === 400 ? 400 : 502, { error: err?.error || 'unreachable' }, 30);
    }
  }
  if (symbol !== 'XAUUSD') return send(res, 400, { error: 'bad_symbol' }, 300);

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return send(res, 503, { error: 'not_configured' }, 30);

  try {
    const params = new URLSearchParams({ symbol: 'XAU/USD', interval: tf, outputsize: String(config.outputsize), timezone: 'UTC', apikey: key });
    const upstream = await fetch(`${PROVIDER_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
    const result = normalizeSeries(await upstream.json());
    if (!result.ok) {
      console.error('candles provider error', tf, result.error);
      return send(res, result.status, { error: result.error }, 60);
    }
    return send(res, 200, { symbol, timeframe: tf, source: 'Twelve Data', fetchedAt: new Date().toISOString(), candles: result.candles }, config.cacheSeconds);
  } catch (err) {
    console.error('candles fetch failed', tf, err?.name);
    return send(res, 502, { error: 'unreachable' }, 30);
  }
}
