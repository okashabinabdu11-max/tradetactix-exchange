// GET /api/news — the gold outlook for upcoming high-impact US releases.
// Approved members only (the same rule as full signals).

import { bearerToken, getEntitlement } from './_lib/access.js';
import { serverRpc } from './_lib/telegram.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
  const ent = await getEntitlement(bearerToken(req));
  if (!ent.shows_levels) return send(res, 403, { error: 'members_only' });
  try {
    const rows = (await serverRpc('alerts_news_list', {})) || [];
    return send(res, 200, {
      items: rows.map((r) => ({ title: r.title, startsAt: r.starts_at, forecast: r.forecast, previous: r.previous, bias: r.bias, confidence: r.confidence, reason: r.reason, ifHigher: r.if_higher, ifLower: r.if_lower, source: r.source })),
    });
  } catch {
    return send(res, 200, { items: null }); // the news table is not created yet, or the database is unreachable
  }
}
