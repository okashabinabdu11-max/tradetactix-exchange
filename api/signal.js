// GET /api/signal?symbol=XAUUSD|BTCUSD — the signal engine's reading, cut down to what the caller's
// plan allows. The engine runs here, on the server, so entry, stop and target
// never reach a browser that is not entitled to them. It never places a trade.

import { originOf, readMarket } from './_lib/engine.js';
import { marketOf } from '../src/lib/markets.js';
import { bearerToken, getEntitlement, useSignalPreview } from './_lib/access.js';
import { gateSignal, signalKey } from './_lib/gate.js';
import { serverRpc } from './_lib/telegram.js';
import { tradeView } from './_lib/tradeView.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Per-user content: never store it in a shared cache.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  const origin = originOf(req);
  if (!origin) return send(res, 400, { error: 'bad_host' });
  const readAt = new Date().toISOString();

  const token = bearerToken(req);
  const entitlement = await getEntitlement(token);

  const market = marketOf(req.query?.symbol);
  let signal;
  let m5 = [];
  try {
    const wanted = Number(req.query?.minrr);
    ({ signal, m5 } = await readMarket(origin, Number.isFinite(wanted) ? Math.min(Math.max(wanted, 3), 20) : 3, market.symbol));
  } catch (err) {
    return send(res, 200, { symbol: market.symbol, state: 'offline', access: entitlement.signed_in ? (entitlement.shows_levels ? 'full' : 'limited') : 'anonymous', reason: 'The market is closed or price data is unavailable.', readAt });
  }

  const isTrade = signal.state === 'buy' || signal.state === 'sell';
  let preview = null;
  if (isTrade && entitlement.signed_in && !entitlement.shows_levels) {
    preview = await useSignalPreview(token, signalKey(signal));
  }
  const body = gateSignal(signal, entitlement, preview);
  if (entitlement.signed_in && !entitlement.shows_levels && !body.previews) {
    body.previews = { used: entitlement.previews_used ?? null, limit: entitlement.previews_limit ?? null };
  }
  // Approved members also see the signal that is running now, or how the last one ended.
  if (entitlement.shows_levels) body.trade = await latestTrade(origin, market.symbol, signal.price, m5);
  return send(res, 200, { ...body, plan: entitlement.plan, readAt });
}

async function latestTrade(origin, symbol, fallbackPrice, m5) {
  try {
    // Gold calls the function as before, so it keeps working before the bitcoin database update.
    const rows = await serverRpc('alerts_latest_trade', symbol === 'XAUUSD' ? {} : { p_symbol: symbol });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || (row.symbol || 'XAUUSD') !== symbol) return null;
    let live = null;
    if (row.status === 'open' && symbol !== 'XAUUSD') {
      // Bitcoin: the newest exchange candle's price (the candles are cached for a few minutes).
      const last = m5[m5.length - 1];
      live = Number.isFinite(last?.c) ? last.c : Number.isFinite(fallbackPrice) ? fallbackPrice : null;
    } else if (row.status === 'open') {
      // The live quote (cached for 5 minutes); the last 15M close if it is unavailable.
      const q = await fetch(`${origin}/api/quote`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      live = Number.isFinite(q?.price) ? q.price : Number.isFinite(fallbackPrice) ? fallbackPrice : null;
    }
    return tradeView(row, live);
  } catch {
    return null; // tracking table not created yet, or the database is unreachable
  }
}
