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

// ---------------------------------------------------------------- bitcoin
// BTCUSD quote from public exchange data (free, no key). Kraken's "today" is
// the UTC day, so its high and low are the day range. Coinbase (the backup)
// only gives the last 24 hours, and says so.

const quoteOf = (fields, fetchedAt, source, rangeLabel) => {
  const { price, open, high, low } = fields;
  const change = open !== null ? price - open : null;
  return {
    symbol: 'BTCUSD', price, open, high, low, previousClose: open,
    change, percentChange: change !== null && open > 0 ? (change / open) * 100 : null,
    marketOpen: true, asOf: null, fetchedAt: new Date(fetchedAt).toISOString(), source, rangeLabel,
  };
};

/** Kraken /0/public/Ticker: { error: [], result: { XXBTZUSD: { c: [last], o: today's open, h: [today, 24h], l: [today, 24h] } } }. */
export function normalizeKrakenTicker(body, fetchedAt = Date.now()) {
  if (!body || typeof body !== 'object' || !body.result) return { ok: false, status: 502, error: 'bad_response' };
  if (Array.isArray(body.error) && body.error.length) return { ok: false, status: 502, error: 'provider_error' };
  const t = Object.values(body.result)[0];
  const price = num(t?.c?.[0]);
  if (price === null || price <= 0) return { ok: false, status: 502, error: 'bad_response' };
  return { ok: true, quote: quoteOf({ price, open: num(t.o), high: num(t.h?.[0]), low: num(t.l?.[0]) }, fetchedAt, 'Kraken', 'Day range (UTC day)') };
}

/** Coinbase Exchange /products/BTC-USD/stats: { open, high, low, last } over the last 24 hours. */
export function normalizeCoinbaseStats(body, fetchedAt = Date.now()) {
  const price = num(body?.last);
  if (price === null || price <= 0) return { ok: false, status: 502, error: 'bad_response' };
  return { ok: true, quote: quoteOf({ price, open: num(body.open), high: num(body.high), low: num(body.low) }, fetchedAt, 'Coinbase', '24-hour range') };
}
