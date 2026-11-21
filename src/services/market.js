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

const lastQuotes = {};
/** The last quote read for a market (the selected one by default). */
export const marketState = (symbol = selectedMarket()) => lastQuotes[symbol] || { status: 'idle', quote: null, message: null };

export async function getQuote(symbol = selectedMarket()) {
  let last;
  try {
    const res = await fetch(`/api/quote${symbol === 'XAUUSD' ? '' : `?symbol=${encodeURIComponent(symbol)}`}`, { headers: { Accept: 'application/json' } });
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
  lastQuotes[symbol] = last;
  return last;
}

// ---------- The signal ----------
// Worked out on the server and cut down to what the caller's plan allows, so
// entry, stop and target never reach a browser that is not entitled to them.

import { getAccessToken } from './backend.js';
import { MARKETS, DEFAULT_MARKET } from '../lib/markets.js';

// ---------- Which market the signal pages show (XAUUSD or BTCUSD) ----------
// Kept on this device. A Telegram link like #/signals?m=BTCUSD picks it once.
const MARKET_KEY = 'tt-market';

function marketFromLink() {
  const [path, query] = String(window.location.hash || '').split('?');
  if (!query) return null;
  const params = new URLSearchParams(query);
  const m = String(params.get('m') || '').toUpperCase();
  if (!params.has('m')) return null;
  params.delete('m');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${path}${rest ? `?${rest}` : ''}`);
  return MARKETS[m] ? m : null;
}

export function selectedMarket() {
  const linked = marketFromLink();
  if (linked) { setMarket(linked); return linked; }
  try {
    const saved = localStorage.getItem(MARKET_KEY);
    return MARKETS[saved] ? saved : DEFAULT_MARKET;
  } catch { return DEFAULT_MARKET; }
}

export function setMarket(symbol) {
  try { localStorage.setItem(MARKET_KEY, MARKETS[symbol] ? symbol : DEFAULT_MARKET); } catch { /* private mode */ }
}

const lastSignals = {};
/** The last reading of the selected market (null until it has been read). */
export const signalState = () => lastSignals[selectedMarket()] || null;
export const clearSignal = () => { for (const k of Object.keys(lastSignals)) delete lastSignals[k]; };

export async function getSignal(minRewardToRisk, symbol = selectedMarket()) {
  const market = MARKETS[symbol] ? symbol : DEFAULT_MARKET;
  let result;
  try {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    if (market !== DEFAULT_MARKET) params.set('symbol', market);
    if (minRewardToRisk > 3) params.set('minrr', String(minRewardToRisk));
    const query = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/signal${query}`, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('not json');
    const body = await res.json();
    if (!res.ok || typeof body.state !== 'string') throw new Error('bad signal');
    result = { symbol: market, ...body };
  } catch {
    result = { symbol: market, state: 'offline', access: 'anonymous', reason: 'The signal service could not be reached.', readAt: new Date().toISOString() };
  }
  lastSignals[market] = result;
  return result;
}
