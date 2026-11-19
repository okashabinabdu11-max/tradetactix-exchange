// The chart page's own chart: TradingView's open-source Lightweight Charts
// library (candles, price and time scales, crosshair, pinch zoom, drag)
// plus our drawing layer on top. Drawings are stored as time and price, so
// they stay put on every timeframe and are saved until the member deletes them.

import { timeToLogical, logicalToTime, magnetPrice, pick, rayEnd, FIB_LEVELS, TOOL_POINTS } from '../lib/drawings.js';
import { sma, ema, bollinger, rsi, macd, stochastic, atr } from '../lib/indicators.js';
import { decimals } from '../lib/chartConfig.js';

export const LWC_URL = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
const SHOW_OFFSET = 3 * 3600; // the time scale shows Ethiopia time (UTC+3)
const UP = '#26a69a'; const DOWN = '#ef5350';

let loading = null;
export function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LWC_URL; s.async = true;
      s.onload = () => (window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error('missing')));
      s.onerror = () => { loading = null; s.remove(); reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const secs = (c) => Math.floor(new Date(c.t).getTime() / 1000);
const hexA = (hex, a) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

export async function createProChart(host, hooks = {}) {
  const LWC = await loadLightweightCharts();
  host.innerHTML = '<div class="pc-lwc"></div><canvas class="pc-overlay"></canvas>';
  const box = host.querySelector('.pc-lwc');
  const canvas = host.querySelector('.pc-overlay');
  const ctx = canvas.getContext('2d');

  const chart = LWC.createChart(box, {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#000000' }, textColor: '#9a9a9a', fontSize: 11 },
    grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: 0 },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
  });

  let main = null; let style = null;
  let candles = []; let times = []; let step = 900; let symbol = 'XAU/USD';
  let colors = { bg: '#000000', grid: '#161616', text: '#9a9a9a' };
  let studies = []; let studySeries = [];
  let drawings = []; let selected = null; let tool = null; let magnet = true;
  let pending = null; let preview = null; let drag = null;

  // ---------- coordinates ----------
  const ts = () => chart.timeScale();
  const xOf = (t) => ts().logicalToCoordinate(timeToLogical(times, t, step));
  const tOf = (x) => { const l = ts().coordinateToLogical(x); return l === null ? null : logicalToTime(times, l, step); };
  const yOf = (p) => main?.priceToCoordinate(p) ?? null;
  const pOf = (y) => main?.coordinateToPrice(y) ?? null;
  const xy = (q) => { const x = xOf(q.t); const y = yOf(q.p); return x === null || y === null ? null : { x, y }; };
  const paneSize = () => ({ w: ts().width() || host.clientWidth - 60, h: (host.clientHeight - (ts().height() || 26)) });
  const candleAt = (t) => { if (!times.length) return null; const i = Math.round(timeToLogical(times, t, step)); return candles[Math.max(0, Math.min(candles.length - 1, i))]; };
  function toPoint(x, y, snap = magnet) {
    const t = tOf(x); let p = pOf(y);
    if (t === null || p === null) return null;
    if (snap) p = magnetPrice(candleAt(t), p, (v) => yOf(v) ?? -1e9, y);
    return { t, p };
  }

  // ---------- drawing layer ----------
  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth; const h = host.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function line(a, b, color, width = 1.5, dash = []) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  function label(text, x, y, color, align = 'left') {
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = align; ctx.textBaseline = 'bottom';
    ctx.fillStyle = color; ctx.fillText(text, x, y - 2);
  }
  function drawOne(d, isSel) {
    const { w } = paneSize();
    const pts = d.points.map(xy);
    const [a, b] = pts;
    if (!a) return;
    const c = d.color; const dp = decimals(symbol);
    switch (d.type) {
      case 'hline': line({ x: 0, y: a.y }, { x: w, y: a.y }, c); label(d.points[0].p.toFixed(dp), w - 4, a.y, c, 'right'); break;
      case 'vline': line({ x: a.x, y: 0 }, { x: a.x, y: paneSize().h }, c); break;
      case 'trend': if (b) line(a, b, c); break;
      case 'ray': if (b) line(a, rayEnd(a, b, w), c); break;
      case 'rect': {
        if (!b) break;
        const x1 = Math.min(a.x, b.x); const y1 = Math.min(a.y, b.y);
        ctx.fillStyle = hexA(c, 0.16); ctx.fillRect(x1, y1, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.strokeRect(x1, y1, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        break;
      }
      case 'fib': {
        if (!b) break;
        const x1 = Math.min(a.x, b.x);
        line(a, b, hexA(c, 0.5), 1, [4, 4]);
        for (const lv of FIB_LEVELS) {
          const price = d.points[1].p + (d.points[0].p - d.points[1].p) * lv;
          const y = yOf(price); if (y === null) continue;
          line({ x: x1, y }, { x: w, y }, c, lv === 0.5 || lv === 0.618 ? 1.4 : 1);
          label(`${lv} (${price.toFixed(dp)})`, x1 + 4, y, c);
        }
        break;
      }
      case 'text':
        ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = c; ctx.fillText(d.text || '', a.x, a.y);
        break;
      default:
    }
    if (isSel) {
      for (const q of pts) {
        if (!q) continue;
        ctx.fillStyle = colors.bg; ctx.strokeStyle = c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }
  function redraw() {
    sizeCanvas();
    ctx.clearRect(0, 0, host.clientWidth, host.clientHeight);
    if (!main || !times.length) return;
    const { w, h } = paneSize();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    for (const d of drawings) drawOne(d, d === selected);
    if (preview) drawOne(preview, true);
    ctx.restore();
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); };
  // While the chart is being dragged or zoomed (including the price scale), follow every frame.
  let followUntil = 0;
  const follow = () => { followUntil = performance.now() + 600; const loop = () => { redraw(); if (performance.now() < followUntil) requestAnimationFrame(loop); }; requestAnimationFrame(loop); };

  // ---------- interaction ----------
  const active = () => Boolean(tool || selected);
  const setActive = () => {
    canvas.classList.toggle('is-active', active());
    chart.applyOptions({ handleScroll: !active() ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true } : false, handleScale: !active() ? { axisPressedMouseMove: true, mouseWheel: true, pinch: true } : false });
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const changed = () => { hooks.onDrawingsChange?.(drawings.map((d) => ({ ...d, points: d.points.map((q) => ({ ...q })) }))); };
  const select = (d) => { selected = d; setActive(); hooks.onSelect?.(d); schedule(); };
  const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let toolColor = '#4a90e2';

  function finish(d) {
    if (d.type === 'text') {
      const text = window.prompt ? window.prompt('Text on the chart:', '') : '';
      if (!text) { pending = null; preview = null; schedule(); return; }
      d.text = text.slice(0, 80);
    }
    drawings.push(d); pending = null; preview = null;
    tool = null; hooks.onToolDone?.();
    changed(); select(d);
  }

  const onDown = (e) => {
    if (!active()) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const p = local(e);
    if (tool) {
      const q = toPoint(p.x, p.y);
      if (!q) return;
      const n = TOOL_POINTS[tool];
      if (n === 1) { finish({ id: newId(), type: tool, points: [q], color: toolColor }); return; }
      if (!pending) { pending = { start: p, a: q }; preview = { id: 'preview', type: tool, points: [q, q], color: toolColor }; schedule(); }
      return;
    }
    const hit = pick(selected ? [selected] : [], p, xy, paneSize()) || pick(drawings, p, xy, paneSize());
    if (!hit) { select(null); return; }
    if (hit.drawing !== selected) select(hit.drawing);
    drag = { part: hit.part, start: toPoint(p.x, p.y, false), orig: hit.drawing.points.map((q) => ({ ...q })), moved: false };
  };
  const onMove = (e) => {
    if (!active()) return;
    const p = local(e);
    if (tool && pending) {
      const q = toPoint(p.x, p.y);
      if (q) { preview.points = [pending.a, q]; schedule(); }
      return;
    }
    if (drag && selected) {
      const now = toPoint(p.x, p.y, drag.part !== 'body' && magnet);
      if (!now || !drag.start) return;
      drag.moved = true;
      if (drag.part === 'body') {
        const dt = now.t - drag.start.t; const dpx = now.p - drag.start.p;
        selected.points = drag.orig.map((q) => ({ t: q.t + dt, p: q.p + dpx }));
      } else {
        const i = Number(drag.part.slice(5));
        selected.points[i] = now;
      }
      schedule();
    }
  };
  const onUp = (e) => {
    if (!active()) return;
    const p = local(e);
    if (tool && pending) {
      const far = Math.hypot(p.x - pending.start.x, p.y - pending.start.y) > 8;
      if (far || pending.second) {
        const q = toPoint(p.x, p.y);
        if (q) finish({ id: newId(), type: tool, points: [pending.a, q], color: toolColor });
      } else {
        pending.second = true; // tap-tap: the next tap places the second point
      }
      return;
    }
    if (drag) { const moved = drag.moved; drag = null; if (moved) changed(); }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  // Tap on a drawing while no tool is chosen selects it.
  const onChartClick = (param) => {
    if (active() || !param?.point) return;
    const hit = pick(drawings, param.point, xy, paneSize());
    if (hit) select(hit.drawing);
  };
  chart.subscribeClick(onChartClick);
  ts().subscribeVisibleLogicalRangeChange(schedule);
  const onHostDown = () => follow();
  host.addEventListener('pointerdown', onHostDown);
  host.addEventListener('wheel', follow, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  ro?.observe(host);

  // ---------- data, colours, indicators ----------
  function makeMain() {
    if (main) chart.removeSeries(main);
    const dp = decimals(symbol);
    const priceFormat = { type: 'price', precision: dp, minMove: Number((10 ** -dp).toFixed(dp)) };
    main = style === 'line'
      ? chart.addLineSeries({ color: '#4a90e2', lineWidth: 2, priceFormat })
      : chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, priceFormat });
  }
  const bar = (c) => (style === 'line' ? { time: secs(c) + SHOW_OFFSET, value: c.c } : { time: secs(c) + SHOW_OFFSET, open: c.o, high: c.h, low: c.l, close: c.c });

  function drawStudies() {
    for (const s of studySeries) chart.removeSeries(s);
    studySeries = [];
    if (!candles.length) return;
    const t = candles.map((c) => secs(c) + SHOW_OFFSET);
    const close = candles.map((c) => c.c);
    const pts = (arr) => arr.map((v, i) => (v === null ? null : { time: t[i], value: v })).filter(Boolean);
    const osc = studies.filter((id) => ['rsi', 'macd', 'stoch', 'atr'].includes(id));
    const band = 0.2;
    main.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: osc.length ? Math.min(0.7, osc.length * band + 0.04) : 0.06 } });
    const addLine = (data, color, opts = {}) => {
      const s = chart.addLineSeries({ color, lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...opts });
      s.setData(data); studySeries.push(s); return s;
    };
    for (const id of studies) {
      if (id === 'sma') addLine(pts(sma(close, 20)), '#f5a623');
      if (id === 'ema') addLine(pts(ema(close, 50)), '#4a90e2');
      if (id === 'ema200') addLine(pts(ema(close, 200)), '#b06ef3');
      if (id === 'bb') { const b = bollinger(close, 20, 2); addLine(pts(b.upper), '#7e8aa2'); addLine(pts(b.mid), '#7e8aa2', { lineStyle: 2 }); addLine(pts(b.lower), '#7e8aa2'); }
    }
    osc.forEach((id, k) => {
      const scaleId = `osc-${id}`;
      const top = 1 - (osc.length - k) * band + 0.02;
      const opts = { priceScaleId: scaleId };
      if (id === 'rsi') {
        const s = addLine(pts(rsi(close, 14)), '#b06ef3', opts);
        s.createPriceLine({ price: 70, color: '#555', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: '#555', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      }
      if (id === 'macd') {
        const m = macd(close);
        const h = chart.addHistogramSeries({ ...opts, lastValueVisible: false, priceLineVisible: false });
        h.setData(m.hist.map((v, i) => (v === null ? null : { time: t[i], value: v, color: v >= 0 ? hexA(UP, 0.6) : hexA(DOWN, 0.6) })).filter(Boolean));
        studySeries.push(h);
        addLine(pts(m.line), '#4a90e2', opts); addLine(pts(m.signal), '#f5a623', opts);
      }
      if (id === 'stoch') { const s = stochastic(candles); addLine(pts(s.k), '#4a90e2', opts); addLine(pts(s.d), '#f5a623', opts); }
      if (id === 'atr') addLine(pts(atr(candles, 14)), '#26a69a', opts);
      chart.priceScale(scaleId).applyOptions({ scaleMargins: { top, bottom: Math.max(0, 1 - top - band + 0.03) }, borderVisible: false });
    });
  }

  return {
    /** New pair or timeframe: replace everything. */
    setData(list, view, sym) {
      const restyle = view.style !== style || sym !== symbol;
      symbol = sym; style = view.style; step = view.sec;
      candles = list; times = list.map(secs);
      if (restyle || !main) makeMain();
      main.setData(list.map(bar));
      drawStudies();
      ts().scrollToRealTime();
      redraw();
    },
    /** Fresh prices for the same pair and timeframe: keep the view where it is. */
    refresh(list) {
      if (!main || !list.length) return;
      const sameStart = candles.length && list[0].t === candles[0].t;
      const grew = list.length - candles.length;
      if (sameStart && grew >= 0 && grew <= 3) {
        for (let i = Math.max(0, candles.length - 1); i < list.length; i += 1) main.update(bar(list[i]));
      } else {
        const range = ts().getVisibleLogicalRange();
        main.setData(list.map(bar));
        if (range) ts().setVisibleLogicalRange(range);
      }
      candles = list; times = list.map(secs);
      drawStudies(); schedule();
    },
    setColors(c) {
      colors = c;
      chart.applyOptions({ layout: { background: { type: 'solid', color: c.bg }, textColor: c.text }, grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } } });
      schedule();
    },
    setStudies(ids) { studies = ids; if (main) drawStudies(); },
    setTool(id, color) { tool = id; toolColor = color || toolColor; pending = null; preview = null; if (id) selected = null; setActive(); hooks.onSelect?.(null); schedule(); },
    setMagnet(on) { magnet = on; },
    setDrawings(list) { drawings = list; selected = null; setActive(); redraw(); },
    recolorSelected(color) { if (selected) { selected.color = color; changed(); schedule(); } },
    deleteSelected() { if (!selected) return; drawings = drawings.filter((d) => d !== selected); select(null); changed(); },
    clearAll() { drawings = []; select(null); changed(); },
    deselect() { select(null); },
    toLatest() { ts().scrollToRealTime(); },
    destroy() {
      ro?.disconnect();
      host.removeEventListener('pointerdown', onHostDown);
      host.removeEventListener('wheel', follow);
      chart.unsubscribeClick(onChartClick);
      ts().unsubscribeVisibleLogicalRangeChange(schedule);
      chart.remove();
    },
  };
}
