// GET /api/quote?symbol=XAUUSD|BTCUSD — the current quote and day range.
// Runs on the server so the Twelve Data key never reaches the browser.
// Responses are cached at Vercel's edge to stay inside the provider's limits.

import { normalizeQuote, normalizeKrakenTicker, normalizeCoinbaseStats } from './_lib/quote.js';

const UA = { 'User-Agent': 'TradeTactix/1.0 (+https://tradetactix-exchange.vercel.app)', Accept: 'application/json' };

/** Bitcoin: Kraken first, Coinbase if Kraken cannot be read. */
async function bitcoinQuote() {
  try {
    const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', { headers: UA, signal: AbortSignal.timeout(6000) });
    const res = normalizeKrakenTicker(await r.json());
    if (res.ok) return res;
  } catch { /* try the backup */ }
  try {
    const r = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/stats', { headers: UA, signal: AbortSignal.timeout(6000) });
    return normalizeCoinbaseStats(await r.json());
  } catch {
    return { ok: false, status: 502, error: 'unreachable' };
  }
}

const PROVIDER_URL = 'https://api.twelvedata.com/quote';
const send = (res, status, body, cacheSeconds) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${Math.floor(cacheSeconds / 2)}`);
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'method_not_allowed' }, 60);
  }
  const symbol = String(req.query?.symbol || 'XAUUSD').toUpperCase();
  if (symbol === 'BTCUSD') {
    const result = await bitcoinQuote();
    if (!result.ok) console.error('bitcoin quote failed', result.error);
    return result.ok ? send(res, 200, result.quote, 60) : send(res, result.status, { error: result.error }, 30);
  }
  if (symbol !== 'XAUUSD') return send(res, 400, { error: 'bad_symbol' }, 300);

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return send(res, 503, { error: 'not_configured' }, 30);

  try {
    const url = `${PROVIDER_URL}?symbol=${encodeURIComponent('XAU/USD')}&apikey=${encodeURIComponent(key)}`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await upstream.json();
    const result = normalizeQuote(body);
    if (!result.ok) {
      // Log the provider's own message for the owner; never send it (or the key) to visitors.
      console.error('quote provider error', body?.code, body?.message);
      return send(res, result.status, { error: result.error }, 60);
    }
    return send(res, 200, result.quote, 300); // 5 minutes keeps the provider's daily limit safe
  } catch (err) {
    console.error('quote fetch failed', err?.name);
    return send(res, 502, { error: 'unreachable' }, 30);
  }
}
