// GET /api/signal — the signal engine's reading, cut down to what the caller's
// plan allows. The engine runs here, on the server, so entry, stop and target
// never reach a browser that is not entitled to them. It never places a trade.

import { originOf, readSignal } from './_lib/engine.js';
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
  const origin = originOf(req);
  if (!origin) return send(res, 400, { error: 'bad_host' });
  const readAt = new Date().toISOString();

  const token = bearerToken(req);
  const entitlement = await getEntitlement(token);

  let signal;
  try {
    const wanted = Number(req.query?.minrr);
    signal = await readSignal(origin, Number.isFinite(wanted) ? Math.min(Math.max(wanted, 3), 20) : 3);
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
