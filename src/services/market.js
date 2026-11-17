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

// ---------- The signal ----------
// Worked out on the server and cut down to what the caller's plan allows, so
// entry, stop and target never reach a browser that is not entitled to them.

import { getAccessToken } from './backend.js';

let lastSignal = null;
export const signalState = () => lastSignal;
export const clearSignal = () => { lastSignal = null; };

export async function getSignal(minRewardToRisk) {
  try {
    const token = await getAccessToken();
    const query = minRewardToRisk > 3 ? `?minrr=${encodeURIComponent(minRewardToRisk)}` : '';
    const res = await fetch(`/api/signal${query}`, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('not json');
    const body = await res.json();
    if (!res.ok || typeof body.state !== 'string') throw new Error('bad signal');
    lastSignal = body;
  } catch {
    lastSignal = { state: 'offline', access: 'anonymous', reason: 'The signal service could not be reached.', readAt: new Date().toISOString() };
  }
  return lastSignal;
}
