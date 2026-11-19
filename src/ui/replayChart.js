// Small canvas candlestick chart for bar replay. Draws only candles up to the
// replay point, so the future stays hidden. Drag sideways to look back.

import { decimals } from '../lib/replay.js';

const TIME = (iso, daily) => new Date(iso).toLocaleString('en-GB', daily
  ? { day: 'numeric', month: 'short', timeZone: 'Africa/Addis_Ababa' }
  : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });

export function createReplayChart(canvas) {
  const ctx = canvas.getContext('2d');
  let state = null;
  let offset = 0; // candles scrolled back from the replay point
  let drag = null;
  let picking = false; let pickCb = null; let layout = null; // pick mode: tap a candle to cut there

  const css = (name, fallback) => getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;

  function render(next) {
    if (next) state = { ...state, ...next };
    if (!state?.candles?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { candles, trades: allTrades = [], symbol, zoom = 70, bg, grid, up, down, text } = state;
    const end = picking ? candles.length - 1 : state.end;
    const trades = picking ? [] : allTrades;
    const axisW = 64; const axisH = 22; const plotW = w - axisW; const plotH = h - axisH;
    const count = Math.max(10, Math.min(zoom, end + 1));
    offset = Math.max(0, Math.min(offset, end + 1 - count));
    const last = end - offset; const first = Math.max(0, last - count + 1);
    const view = candles.slice(first, last + 1);
    const open = trades.filter((t) => !t.result);
    let lo = Math.min(...view.map((c) => c.l)); let hi = Math.max(...view.map((c) => c.h));
    for (const t of open) for (const p of [t.entry, t.sl, t.tp]) if (p !== null) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const y = (p) => plotH - ((p - lo) / (hi - lo)) * plotH;
    const step = plotW / count; const bodyW = Math.max(1, step * 0.66);
    const x = (i) => (i - first) * step + step / 2;
    const dp = decimals(symbol);
    layout = { first, step, plotW };

    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    // grid and price axis
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = text;
    for (let k = 0; k <= 5; k += 1) {
      const p = lo + ((hi - lo) * k) / 5; const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillText(p.toFixed(dp), plotW + 6, yy);
    }
    // time labels
    const daily = view.length > 1 && new Date(view[1].t) - new Date(view[0].t) >= 86400e3;
    const every = Math.max(1, Math.round(90 / step));
    ctx.textAlign = 'center';
    for (let i = first; i <= last; i += every) {
      const xx = Math.round(x(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, plotH); ctx.stroke();
      if (xx > 30 && xx < plotW - 30) ctx.fillText(TIME(candles[i].t, daily), xx, plotH + axisH / 2);
    }
    ctx.textAlign = 'left';
    // candles
    for (let i = first; i <= last; i += 1) {
      const c = candles[i]; const col = c.c >= c.o ? up : down; const xx = x(i);
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, y(c.h)); ctx.lineTo(Math.round(xx) + 0.5, y(c.l)); ctx.stroke();
      const top = y(Math.max(c.o, c.c)); const bh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
      ctx.fillRect(xx - bodyW / 2, top, bodyW, bh);
    }
    // trade lines and markers
    const line = (p, color, label) => {
      const yy = Math.round(y(p)) + 0.5;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.fillRect(plotW, yy - 9, axisW, 18);
      ctx.fillStyle = '#fff'; ctx.fillText(label, plotW + 4, yy);
    };
    for (const t of open) {
      line(t.entry, '#4a90e2', t.side === 'buy' ? 'BUY' : 'SELL');
      if (t.sl !== null) line(t.sl, down, 'SL');
      if (t.tp !== null) line(t.tp, up, 'TP');
    }
    const at = (time) => candles.findIndex((c) => c.t === time);
    for (const t of trades) {
      const i = at(t.openedAt);
      if (i >= first && i <= last) { ctx.fillStyle = t.side === 'buy' ? up : down; tri(x(i), y(t.entry), t.side === 'buy'); }
      const j = t.closedAt ? at(t.closedAt) : -1;
      if (j >= first && j <= last) { ctx.fillStyle = text; ctx.beginPath(); ctx.arc(x(j), y(t.exit), 4, 0, Math.PI * 2); ctx.fill(); }
    }
    // last price
    const lastC = candles[end];
    if (offset === 0) line(lastC.c, lastC.c >= lastC.o ? up : down, lastC.c.toFixed(dp));
    if (offset > 0) { ctx.fillStyle = text; ctx.fillText(`◀ ${offset}`, 8, 12); }
  }
  function tri(cx, cy, upward) {
    ctx.beginPath();
    if (upward) { ctx.moveTo(cx, cy + 4); ctx.lineTo(cx - 6, cy + 14); ctx.lineTo(cx + 6, cy + 14); } else { ctx.moveTo(cx, cy - 4); ctx.lineTo(cx - 6, cy - 14); ctx.lineTo(cx + 6, cy - 14); }
    ctx.fill();
  }

  const onDown = (e) => { drag = { x: e.clientX, offset }; canvas.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    if (!drag || !state) return;
    const step = (canvas.clientWidth - 64) / Math.max(10, state.zoom || 70);
    offset = Math.max(0, drag.offset + Math.round((e.clientX - drag.x) / step));
    render();
  };
  const onUp = (e) => {
    const moved = drag ? Math.abs(e.clientX - drag.x) : 99;
    drag = null;
    if (picking && pickCb && layout && moved < 6) {
      const r = canvas.getBoundingClientRect(); const xx = e.clientX - r.left;
      if (xx >= 0 && xx < layout.plotW) pickCb(layout.first + Math.floor(xx / layout.step));
    }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => render()) : null;
  ro?.observe(canvas);

  return {
    render,
    toLatest() { offset = 0; },
    setPicking(on, cb) { picking = on; pickCb = on ? cb : null; offset = 0; render(); },
    css,
    destroy() {
      ro?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
