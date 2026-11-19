// Indicators computed from candles ({ c, h, l, ... } oldest first).
// Each returns an array the same length as the candles; null where there is
// not yet enough history. Standard textbook formulas (Wilder for RSI and ATR).

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i += 1) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function bollinger(values, n = 20, mult = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i += 1) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j += 1) v += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = mid[i] + mult * sd; lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= n; i += 1) { const d = values[i] - values[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast); const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] === null || s[i] === null ? null : f[i] - s[i]));
  const start = line.findIndex((v) => v !== null);
  const sig = new Array(values.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start), signal);
    e.forEach((v, i) => { sig[start + i] = v; });
  }
  const hist = line.map((v, i) => (v === null || sig[i] === null ? null : v - sig[i]));
  return { line, signal: sig, hist };
}

export function stochastic(candles, n = 14, smooth = 3) {
  const k = candles.map((c, i) => {
    if (i < n - 1) return null;
    let hi = -Infinity; let lo = Infinity;
    for (let j = i - n + 1; j <= i; j += 1) { hi = Math.max(hi, candles[j].h); lo = Math.min(lo, candles[j].l); }
    return hi === lo ? 50 : ((c.c - lo) / (hi - lo)) * 100;
  });
  const start = k.findIndex((v) => v !== null);
  const d = new Array(candles.length).fill(null);
  if (start >= 0) sma(k.slice(start), smooth).forEach((v, i) => { d[start + i] = v; });
  return { k, d };
}

export function atr(candles, n = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= n) return out;
  const tr = candles.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c))));
  let a = tr.slice(1, n + 1).reduce((x, y) => x + y, 0) / n;
  out[n] = a;
  for (let i = n + 1; i < candles.length; i += 1) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}
