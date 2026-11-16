// The site's own price feed: asks our server function, which holds the
// provider key. Nothing here invents a price; failures are reported as such.

const MESSAGES = {
  not_configured: 'The price feed key has not been added to the server yet.',
  key_rejected: 'The price provider rejected the key.',
  rate_limited: 'The price provider limit was reached. It resets shortly.',
  provider_error: 'The price provider returned an error.',
  bad_response: 'The price provider sent an unreadable answer.',
  unreachable: 'The price provider could not be reached.',
};

let last = { status: 'idle', quote: null, message: null };
export const marketState = () => last;

export async function getQuote() {
  try {
    const res = await fetch('/api/quote', { headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('not json');
    const body = await res.json();
    if (!res.ok || !(body.price > 0)) {
      last = { status: 'error', quote: null, message: MESSAGES[body.error] || 'The price feed is unavailable.' };
    } else {
      last = { status: 'ok', quote: body, message: null };
    }
  } catch {
    last = { status: 'error', quote: null, message: 'The price feed could not be reached.' };
  }
  return last;
}

// ---------- Candles and the signal ----------

import { evaluate } from '../lib/signals.js';

const CANDLE_TTL_MS = { '4h': 30 * 60e3, '1h': 15 * 60e3, '15min': 5 * 60e3 };
const candleCache = new Map();

async function getCandles(tf) {
  const hit = candleCache.get(tf);
  if (hit && Date.now() - hit.at < CANDLE_TTL_MS[tf]) return hit.result;
  let result;
  try {
    const res = await fetch(`/api/candles?tf=${tf}`, { headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('not json');
    const body = await res.json();
    result = res.ok && Array.isArray(body.candles)
      ? { ok: true, candles: body.candles }
      : { ok: false, message: MESSAGES[body.error] || 'The candle data is unavailable.' };
  } catch {
    result = { ok: false, message: 'The candle data could not be reached.' };
  }
  if (result.ok) candleCache.set(tf, { at: Date.now(), result });
  return result;
}

let lastSignal = null;
export const signalState = () => lastSignal;

/** Fetches the three timeframes and runs the engine. Failures come back as "offline". */
export async function getSignal(minRewardToRisk) {
  const [h4, h1, m15] = await Promise.all([getCandles('4h'), getCandles('1h'), getCandles('15min')]);
  const failed = [h4, h1, m15].find((r) => !r.ok);
  lastSignal = failed
    ? { state: 'offline', reason: failed.message, checks: null }
    : evaluate({ h4: h4.candles, h1: h1.candles, m15: m15.candles, minRewardToRisk });
  lastSignal.readAt = new Date().toISOString();
  return lastSignal;
}
