// Runs the signal engine on the server from the cached candle endpoints.
// Shared by /api/signal (per-user view) and /api/alerts-run (Telegram alerts).

import { evaluate } from '../../src/lib/signals.js';

export function originOf(req) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
}

/** Throws when candles are unavailable; callers decide what "offline" looks like. */
export async function readSignal(origin, minRewardToRisk = 3) {
  const key = process.env.CANDLES_KEY;
  if (!key) throw Object.assign(new Error('candles'), { code: 'not_configured' });
  const load = async (tf) => {
    const r = await fetch(`${origin}/api/candles?tf=${tf}&k=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(9000) });
    const body = await r.json();
    if (!r.ok || !Array.isArray(body.candles)) throw Object.assign(new Error('candles'), { code: body.error || 'unavailable' });
    return body.candles;
  };
  const [h4, h1, m15] = await Promise.all([load('4h'), load('1h'), load('15min')]);
  return evaluate({ h4, h1, m15, minRewardToRisk });
}
