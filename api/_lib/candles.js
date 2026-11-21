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

// ---------------------------------------------------------------- bitcoin
// BTCUSD candles come from public exchange data: Kraken first, Coinbase if
// Kraken cannot be read. Both are free and need no key, so they do not use the
// Twelve Data daily credits that gold relies on. Real exchange candles carry
// real traded volume (`v`).

export const CRYPTO_MINUTES = Object.freeze({ '4h': 240, '1h': 60, '15min': 15 });

const ok = (o, h, l, c) => [o, h, l, c].every((n) => Number.isFinite(n) && n > 0) && h >= l && h >= Math.max(o, c) - 1e-9 && l <= Math.min(o, c) + 1e-9;

/** Kraken /0/public/OHLC: { error: [], result: { XXBTZUSD: [[time, o, h, l, c, vwap, volume, count]], last } }. */
export function normalizeKraken(body, keep = 200) {
  if (!body || typeof body !== 'object' || !body.result) return { ok: false, status: 502, error: 'bad_response' };
  if (Array.isArray(body.error) && body.error.length) {
    const limited = body.error.some((e) => /rate|too many/i.test(String(e)));
    return { ok: false, status: limited ? 429 : 502, error: limited ? 'rate_limited' : 'provider_error' };
  }
  const key = Object.keys(body.result).find((k) => k !== 'last' && Array.isArray(body.result[k]));
  const rows = key ? body.result[key] : null;
  if (!rows || !rows.length) return { ok: false, status: 502, error: 'bad_response' };
  const candles = [];
  for (const r of rows) {
    const t = Number(r[0]); const o = Number(r[1]); const h = Number(r[2]); const l = Number(r[3]); const c = Number(r[4]); const v = Number(r[6]);
    if (!Number.isFinite(t) || !ok(o, h, l, c)) return { ok: false, status: 502, error: 'bad_response' };
    candles.push({ t: new Date(t * 1000).toISOString(), o, h, l, c, v: Number.isFinite(v) && v >= 0 ? v : 0 });
  }
  candles.sort((a, b) => (a.t < b.t ? -1 : 1));
  return { ok: true, candles: candles.slice(-keep) };
}

/** Coinbase Exchange /products/BTC-USD/candles: [[time, low, high, open, close, volume]], newest first. */
export function normalizeCoinbase(body, keep = 300) {
  if (!Array.isArray(body) || !body.length) {
    const limited = body && /rate/i.test(String(body.message || ''));
    return { ok: false, status: limited ? 429 : 502, error: limited ? 'rate_limited' : 'bad_response' };
  }
  const candles = [];
  for (const r of body) {
    if (!Array.isArray(r)) return { ok: false, status: 502, error: 'bad_response' };
    const t = Number(r[0]); const l = Number(r[1]); const h = Number(r[2]); const o = Number(r[3]); const c = Number(r[4]); const v = Number(r[5]);
    if (!Number.isFinite(t) || !ok(o, h, l, c)) return { ok: false, status: 502, error: 'bad_response' };
    candles.push({ t: new Date(t * 1000).toISOString(), o, h, l, c, v: Number.isFinite(v) && v >= 0 ? v : 0 });
  }
  candles.sort((a, b) => (a.t < b.t ? -1 : 1));
  return { ok: true, candles: candles.slice(-keep) };
}

/** Joins candles into larger ones on UTC boundaries (for example 1H into 4H). */
export function joinCandles(candles, minutes) {
  const size = minutes * 60e3;
  const out = [];
  for (const c of candles) {
    const start = Math.floor(Date.parse(c.t) / size) * size;
    const last = out[out.length - 1];
    if (last && last._s === start) {
      last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v || 0;
    } else {
      out.push({ _s: start, t: new Date(start).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 });
    }
  }
  return out.map(({ _s, ...c }) => c);
}

const UA = { 'User-Agent': 'TradeTactix/1.0 (+https://tradetactix-exchange.vercel.app)', Accept: 'application/json' };

/** Real BTCUSD candles for one engine timeframe. Throws { status, error } when neither exchange answers. */
export async function fetchBitcoinCandles(tf, fetcher = fetch) {
  const minutes = CRYPTO_MINUTES[tf];
  if (!minutes) throw Object.assign(new Error('tf'), { status: 400, error: 'bad_timeframe' });
  const keep = TIMEFRAMES[tf].outputsize;
  let first = null;
  try {
    const r = await fetcher(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${minutes}`, { headers: UA, signal: AbortSignal.timeout(7000) });
    const res = normalizeKraken(await r.json(), keep);
    if (res.ok) return { source: 'Kraken', candles: res.candles };
    first = res;
  } catch (err) { first = { status: 502, error: 'unreachable' }; }
  // Coinbase has no 4-hour candles: 1-hour candles are joined into 4-hour ones.
  try {
    const gran = minutes === 240 ? 3600 : minutes * 60;
    const r = await fetcher(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}`, { headers: UA, signal: AbortSignal.timeout(7000) });
    const res = normalizeCoinbase(await r.json());
    if (res.ok) return { source: 'Coinbase', candles: (minutes === 240 ? joinCandles(res.candles, 240) : res.candles).slice(-keep) };
  } catch { /* fall through */ }
  throw Object.assign(new Error('bitcoin candles'), { status: first?.status || 502, error: first?.error || 'unreachable' });
}
