// Chart drawings. Points are kept as (time in seconds, price), never as
// pixels or candle numbers, so a line drawn on 1H stays in the same place on
// 15M, 4H or any other timeframe, and after the page is closed.

export const TOOLS = [
  { id: 'hline', label: 'Horizontal line', points: 1 },
  { id: 'trend', label: 'Trend line', points: 2 },
  { id: 'ray', label: 'Ray', points: 2 },
  { id: 'rect', label: 'Zone (rectangle)', points: 2 },
  { id: 'fib', label: 'Fib retracement', points: 2 },
  { id: 'vline', label: 'Vertical line', points: 1 },
  { id: 'text', label: 'Text', points: 1 },
];
export const TOOL_POINTS = Object.fromEntries(TOOLS.map((t) => [t.id, t.points]));
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const DRAW_COLORS = ['#4a90e2', '#26a69a', '#ef5350', '#f5a623', '#b06ef3', '#ffffff', '#000000'];
export const MAX_DRAWINGS = 300;

/** Fractional candle number for a time, on the candles now shown. */
export function timeToLogical(times, t, stepSec) {
  const n = times.length;
  if (!n) return 0;
  if (t <= times[0]) return (t - times[0]) / stepSec;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / stepSec;
  let lo = 0; let hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

/** Time for a fractional candle number (beyond the last candle it steps on). */
export function logicalToTime(times, logical, stepSec) {
  const n = times.length;
  if (!n) return 0;
  if (logical <= 0) return Math.round(times[0] + logical * stepSec);
  if (logical >= n - 1) return Math.round(times[n - 1] + (logical - (n - 1)) * stepSec);
  const i = Math.floor(logical);
  return Math.round(times[i] + (logical - i) * (times[i + 1] - times[i]));
}

/** Nearest candle open/high/low/close within `px` pixels of y, else the price itself. */
export function magnetPrice(candle, price, priceToY, y, px = 14) {
  if (!candle) return price;
  let best = price; let bestD = px;
  for (const v of [candle.o, candle.h, candle.l, candle.c]) {
    const d = Math.abs(priceToY(v) - y);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

function segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let u = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** Where a ray from a through b leaves a box of width w (to the right or left). */
export function rayEnd(a, b, w) {
  if (b.x === a.x) return { x: b.x, y: b.y > a.y ? 1e6 : -1e6 };
  const x = b.x > a.x ? w : 0;
  return { x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) };
}

/**
 * Is pixel point p on drawing d? `xy` turns a stored point into pixels,
 * `size` is { w, h } of the chart. Returns 'point0' / 'point1' when on a
 * handle, 'body' when on the drawing, or null.
 */
export function hitTest(d, p, xy, size, tol = 12) {
  const pts = d.points.map(xy);
  for (let i = 0; i < pts.length; i += 1) {
    if (pts[i] && Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= tol + 2) return `point${i}`;
  }
  const [a, b] = pts;
  if (!a) return null;
  switch (d.type) {
    case 'hline': return Math.abs(p.y - a.y) <= tol ? 'body' : null;
    case 'vline': return Math.abs(p.x - a.x) <= tol ? 'body' : null;
    case 'trend': return b && segDist(p, a, b) <= tol ? 'body' : null;
    case 'ray': return b && segDist(p, a, rayEnd(a, b, size.w)) <= tol ? 'body' : null;
    case 'rect': {
      if (!b) return null;
      const x1 = Math.min(a.x, b.x); const x2 = Math.max(a.x, b.x); const y1 = Math.min(a.y, b.y); const y2 = Math.max(a.y, b.y);
      return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol ? 'body' : null;
    }
    case 'fib': {
      if (!b) return null;
      const x1 = Math.min(a.x, b.x); const x2 = Math.max(a.x, b.x);
      if (p.x < x1 - tol || p.x > Math.max(x2, size.w) + tol) return null;
      return FIB_LEVELS.some((lv) => Math.abs(p.y - (b.y + (a.y - b.y) * lv)) <= tol) ? 'body' : null;
    }
    case 'text': {
      const w = Math.max(30, String(d.text || '').length * 8);
      return p.x >= a.x - tol && p.x <= a.x + w + tol && p.y >= a.y - 20 - tol && p.y <= a.y + tol ? 'body' : null;
    }
    default: return null;
  }
}

/** The topmost drawing under p (last drawn wins), with the part that was hit. */
export function pick(drawings, p, xy, size) {
  for (let i = drawings.length - 1; i >= 0; i -= 1) {
    const part = hitTest(drawings[i], p, xy, size);
    if (part) return { drawing: drawings[i], part };
  }
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Only well-formed drawings survive loading from storage. */
export function cleanDrawings(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    if (!d || typeof d !== 'object' || !TOOL_POINTS[d.type] || !Array.isArray(d.points)) continue;
    const points = d.points.slice(0, TOOL_POINTS[d.type]).map((q) => ({ t: Number(q?.t), p: Number(q?.p) }));
    if (points.length !== TOOL_POINTS[d.type] || !points.every((q) => Number.isFinite(q.t) && Number.isFinite(q.p))) continue;
    out.push({
      id: String(d.id || '').slice(0, 40) || `d${out.length}`,
      type: d.type,
      points,
      color: HEX.test(d.color || '') ? d.color : DRAW_COLORS[0],
      ...(d.type === 'text' ? { text: String(d.text || '').slice(0, 80) } : {}),
    });
    if (out.length >= MAX_DRAWINGS) break;
  }
  return out;
}
