// GET /api/chart-data?symbol=EUR/USD&interval=15min
// Public market data for the chart page: past candles from Twelve Data.
// Responses are cached by Vercel's CDN, shared by everyone, for a time that
// fits the timeframe. That keeps the free data plan (which the signal engine
// also uses) within its daily limit.

import { normalizeSeries } from './_lib/candles.js';

const PROVIDER_URL = 'https://api.twelvedata.com/time_series';
// Seconds each timeframe stays cached: short for small timeframes, long for big ones.
export const INTERVALS = {
  '1min': 60, '5min': 120, '15min': 300, '30min': 600, '45min': 600,
  '1h': 900, '2h': 1200, '4h': 1800, '1day': 3600, '1week': 21600, '1month': 43200,
};
const SYMBOL = /^[A-Z]{2,5}\/[A-Z]{3,4}$/;
const OUTPUT = 1500;

const send = (res, status, body, cacheSeconds = 0) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds
    ? `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
    : 'public, max-age=0, s-maxage=30');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { message: 'Use GET.' }); }
  const symbol = String(req.query?.symbol || '').toUpperCase();
  const interval = String(req.query?.interval || '');
  if (!SYMBOL.test(symbol) || !(interval in INTERVALS)) return send(res, 400, { message: 'This pair or timeframe is not available.' });
  const apikey = process.env.TWELVEDATA_API_KEY;
  if (!apikey) return send(res, 503, { message: 'Prices are not set up yet.' });
  try {
    const params = new URLSearchParams({ symbol, interval, outputsize: String(OUTPUT), timezone: 'UTC', apikey });
    const r = await fetch(`${PROVIDER_URL}?${params}`, { signal: AbortSignal.timeout(15000) });
    const out = normalizeSeries(await r.json());
    if (!out.ok) {
      if (out.status === 429) return send(res, 429, { message: 'The price data limit is reached for now. Try again in a minute.' });
      if (out.error !== 'provider_error') return send(res, 502, { message: 'Prices could not be loaded. Try again later.' });
      return send(res, 404, { message: `${symbol} is not on our price feed.` }, 3600);
    }
    return send(res, 200, { symbol, interval, source: 'Twelve Data', candles: out.candles }, INTERVALS[interval]);
  } catch (err) {
    console.error('chart data failed', err?.message);
    return send(res, 502, { message: 'Prices could not be loaded. Try again later.' });
  }
}
