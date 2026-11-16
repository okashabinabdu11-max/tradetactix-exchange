// Turns a Twelve Data /quote response into the small object the site uses.
// Pure, so it is unit tested without calling the provider.

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
};

export function normalizeQuote(body, fetchedAt = Date.now()) {
  if (!body || typeof body !== 'object') return { ok: false, status: 502, error: 'bad_response' };
  if (body.status === 'error' || (body.code && body.code >= 400)) {
    const limited = body.code === 429;
    const denied = body.code === 401 || body.code === 403;
    return {
      ok: false,
      status: limited ? 429 : 502,
      error: limited ? 'rate_limited' : denied ? 'key_rejected' : 'provider_error',
    };
  }
  const price = num(body.close);
  if (price === null || price <= 0) return { ok: false, status: 502, error: 'bad_response' };
  const ts = num(body.timestamp);
  return {
    ok: true,
    quote: {
      symbol: 'XAUUSD',
      price,
      open: num(body.open),
      high: num(body.high),
      low: num(body.low),
      previousClose: num(body.previous_close),
      change: num(body.change),
      percentChange: num(body.percent_change),
      marketOpen: typeof body.is_market_open === 'boolean' ? body.is_market_open : null,
      asOf: ts ? new Date(ts * 1000).toISOString() : null,
      fetchedAt: new Date(fetchedAt).toISOString(),
      source: 'Twelve Data',
    },
  };
}
