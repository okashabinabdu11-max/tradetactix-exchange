// Runs the signal engine on the server from the cached candle endpoints.
// Shared by /api/signal (per-user view) and /api/alerts-run (Telegram alerts).

import { evaluate } from '../../src/lib/signals.js';
import { marketOf } from '../../src/lib/markets.js';
import { serverRpc } from './telegram.js';

const ETH = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });

/**
 * News safety pause: a BUY or SELL found within 30 minutes before or after a
 * high-impact US release is not sent. If the news table cannot be read, the
 * signal goes ahead (the pause never invents a reason).
 */
export async function applyNewsPause(signal, now = new Date()) {
  if (signal.state !== 'buy' && signal.state !== 'sell') return signal;
  let near = null;
  try { near = ((await serverRpc('alerts_news_near', { p_at: now.toISOString() })) || [])[0] || null; } catch { return signal; }
  if (!near) return signal;
  const { entry, stop, target, rr, direction, confirmedAt, targetBasis, ...rest } = signal;
  return { ...rest, state: 'news-pause', pausedFor: { title: near.title, startsAt: near.starts_at }, reason: `High-impact news: ${near.title} at ${ETH(near.starts_at)} (Ethiopia time). No new signals 30 minutes before and after it.` };
}

export function originOf(req) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
}

/** Throws when candles are unavailable; callers decide what "offline" looks like. */
export async function readSignal(origin, minRewardToRisk = 3, symbol = 'XAUUSD') {
  return (await readMarket(origin, minRewardToRisk, symbol)).signal;
}

/** One market's signal plus its raw 15M candles (including the one still forming). */
export async function readMarket(origin, minRewardToRisk = 3, symbol = 'XAUUSD') {
  const market = marketOf(symbol);
  const key = process.env.CANDLES_KEY;
  if (!key) throw Object.assign(new Error('candles'), { code: 'not_configured' });
  const load = async (tf) => {
    const r = await fetch(`${origin}/api/candles?tf=${tf}&symbol=${market.symbol}&k=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(9000) });
    const body = await r.json();
    if (!r.ok || !Array.isArray(body.candles)) throw Object.assign(new Error('candles'), { code: body.error || 'unavailable' });
    return body.candles;
  };
  const [h4, h1, m15] = await Promise.all([load('4h'), load('1h'), load('15min')]);
  return { signal: await applyNewsPause(evaluate({ h4, h1, m15, minRewardToRisk, market: market.symbol })), m15, market };
}
