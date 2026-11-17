// GET /api/signal — the signal engine's reading, cut down to what the caller's
// plan allows. The engine runs here, on the server, so entry, stop and target
// never reach a browser that is not entitled to them. It never places a trade.

import { evaluate } from '../src/lib/signals.js';
import { bearerToken, getEntitlement, useSignalPreview } from './_lib/access.js';
import { gateSignal, signalKey } from './_lib/gate.js';

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
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return send(res, 400, { error: 'bad_host' });
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  const readAt = new Date().toISOString();

  const token = bearerToken(req);
  const entitlement = await getEntitlement(token);

  const key = process.env.CANDLES_KEY;
  let signal;
  try {
    if (!key) throw Object.assign(new Error('candles'), { code: 'not_configured' });
    const load = async (tf) => {
      const r = await fetch(`${proto}://${host}/api/candles?tf=${tf}&k=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(9000) });
      const body = await r.json();
      if (!r.ok || !Array.isArray(body.candles)) throw Object.assign(new Error('candles'), { code: body.error || 'unavailable' });
      return body.candles;
    };
    const [h4, h1, m15] = await Promise.all([load('4h'), load('1h'), load('15min')]);
    const wanted = Number(req.query?.minrr);
    signal = evaluate({ h4, h1, m15, minRewardToRisk: Number.isFinite(wanted) ? Math.min(Math.max(wanted, 3), 20) : 3 });
  } catch (err) {
    return send(res, 200, { state: 'offline', access: entitlement.signed_in ? (entitlement.shows_levels ? 'full' : 'limited') : 'anonymous', reason: 'The market is closed or price data is unavailable.', readAt });
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
  return send(res, 200, { ...body, plan: entitlement.plan, readAt });
}
