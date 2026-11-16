// GET /api/signal — the signal engine's current reading, computed on the server
// from the same cached candles the site uses. Used to check the live reading
// and, later, for alerts and signal history. It never places a trade.

import { evaluate } from '../src/lib/signals.js';

const send = (res, status, body, cacheSeconds) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=30`);
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'method_not_allowed' }, 60);
  }
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return send(res, 400, { error: 'bad_host' }, 60);
  const proto = host.startsWith('localhost') ? 'http' : 'https';

  try {
    const load = async (tf) => {
      const r = await fetch(`${proto}://${host}/api/candles?tf=${tf}`, { signal: AbortSignal.timeout(9000) });
      const body = await r.json();
      if (!r.ok || !Array.isArray(body.candles)) throw Object.assign(new Error('candles'), { code: body.error || 'unavailable' });
      return body.candles;
    };
    const [h4, h1, m15] = await Promise.all([load('4h'), load('1h'), load('15min')]);
    const s = evaluate({ h4, h1, m15 });
    return send(res, 200, {
      state: s.state,
      reason: s.reason,
      direction: s.direction ?? null,
      price: s.price ?? null,
      entry: s.entry ?? null,
      stop: s.stop ?? null,
      target: s.target ?? null,
      rr: s.rr ?? null,
      checks: s.checks ?? null,
      levels: (s.levels || []).map((l) => ({ price: Number(l.price.toFixed(2)), touches: l.touches })),
      liquidity: s.liquidity ? { high: s.liquidity.high?.price ?? null, low: s.liquidity.low?.price ?? null } : null,
      asOf: s.asOf ?? null,
      readAt: new Date().toISOString(),
    }, 120);
  } catch (err) {
    return send(res, 200, { state: 'offline', reason: `Candle data unavailable (${err?.code || 'unreachable'}).`, readAt: new Date().toISOString() }, 60);
  }
}
