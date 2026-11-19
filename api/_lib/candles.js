// Turns a Twelve Data /time_series response into plain candles, oldest first.

export const TIMEFRAMES = Object.freeze({
  '4h': { outputsize: 150, cacheSeconds: 1800 },
  '1h': { outputsize: 120, cacheSeconds: 900 },
  '15min': { outputsize: 96, cacheSeconds: 450 },
});

export function normalizeSeries(body) {
  if (!body || typeof body !== 'object') return { ok: false, status: 502, error: 'bad_response' };
  if (body.status === 'error' || (body.code && body.code >= 400)) {
    const limited = body.code === 429;
    const denied = body.code === 401 || body.code === 403;
    return { ok: false, status: limited ? 429 : 502, error: limited ? 'rate_limited' : denied ? 'key_rejected' : 'provider_error' };
  }
  if (!Array.isArray(body.values) || body.values.length === 0) return { ok: false, status: 502, error: 'bad_response' };

  const candles = [];
  for (const v of body.values) {
    // Requested with timezone=UTC, so "2026-11-16 17:45:00" is a UTC time.
    const dt = String(v.datetime);
    const time = new Date(`${dt.length === 10 ? `${dt}T00:00:00` : dt.replace(' ', 'T')}Z`); // daily candles have a date only
    const o = Number(v.open); const h = Number(v.high); const l = Number(v.low); const c = Number(v.close);
    const valid = !Number.isNaN(time.getTime()) && [o, h, l, c].every((n) => Number.isFinite(n) && n > 0) && h >= l;
    if (!valid) return { ok: false, status: 502, error: 'bad_response' };
    candles.push({ t: time.toISOString(), o, h, l, c });
  }
  candles.sort((a, b) => (a.t < b.t ? -1 : 1));
  return { ok: true, candles };
}
