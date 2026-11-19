// Bar replay chart drawn with TradingView's open-source Lightweight Charts
// library, so candles, the price and time scales, the crosshair, zooming and
// dragging look and feel like TradingView. Only candles up to the replay point
// are given to the chart, so the future stays hidden.
//
// The library loads from a CDN the first time. If it cannot load, the small
// built-in canvas chart is used instead, with the same controls.

import { createReplayChart } from './replayChart.js';
import { decimals, pipSize } from '../lib/replay.js';

export const LWC_URL = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
const ETH_OFFSET = 3 * 3600; // the chart's time scale shows Ethiopia time (UTC+3)

let loading = null;
export function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LWC_URL; s.async = true;
      s.onload = () => (window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error('missing')));
      s.onerror = () => { loading = null; reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const toBar = (c) => ({ time: Math.floor(new Date(c.t).getTime() / 1000) + ETH_OFFSET, open: c.o, high: c.h, low: c.l, close: c.c });

/** Same interface as createReplayChart, plus pick mode for choosing the start (the cut). */
export async function createTvReplayChart(host, fallbackCanvas) {
  let LWC;
  try { LWC = await loadLightweightCharts(); } catch {
    fallbackCanvas.hidden = false;
    const c = createReplayChart(fallbackCanvas);
    return { ...c, kind: 'canvas' };
  }
  fallbackCanvas.hidden = true;
  host.hidden = false;
  const chart = LWC.createChart(host, {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#000000' }, textColor: '#aaaaaa', fontSize: 11 },
    grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0 },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });
  const series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });

  let state = null;
  let shown = { candles: null, end: -1 };
  let lines = [];
  let colorsKey = '';
  let zoomShown = null;
  let picking = false;
  let pickCb = null;
  let hover = null;

  const timeToIndex = (time) => {
    if (!state || time == null) return -1;
    const target = (time - ETH_OFFSET) * 1000;
    let lo = 0; let hi = state.candles.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (new Date(state.candles[mid].t).getTime() < target) lo = mid + 1; else hi = mid; }
    return lo;
  };

  function applyColors() {
    const key = [state.bg, state.grid, state.text, state.up, state.down].join('|');
    if (key === colorsKey) return;
    colorsKey = key;
    chart.applyOptions({ layout: { background: { type: 'solid', color: state.bg }, textColor: state.text }, grid: { vertLines: { color: state.grid }, horzLines: { color: state.grid } } });
    series.applyOptions({ upColor: state.up, downColor: state.down, wickUpColor: state.up, wickDownColor: state.down });
  }

  function markers() {
    const list = [];
    const at = (t) => Math.floor(new Date(t).getTime() / 1000) + ETH_OFFSET;
    const endTime = new Date(state.candles[shownEnd()].t).getTime();
    for (const tr of state.trades || []) {
      if (new Date(tr.openedAt).getTime() <= endTime) list.push({ time: at(tr.openedAt), position: tr.side === 'buy' ? 'belowBar' : 'aboveBar', color: tr.side === 'buy' ? state.up : state.down, shape: tr.side === 'buy' ? 'arrowUp' : 'arrowDown', text: tr.side.toUpperCase() });
      if (tr.closedAt && new Date(tr.closedAt).getTime() <= endTime) list.push({ time: at(tr.closedAt), position: 'inBar', color: tr.pips > 0 ? state.up : tr.pips < 0 ? state.down : '#4a90e2', shape: 'circle', text: `${tr.pips > 0 ? '+' : ''}${tr.pips}` });
    }
    if (picking && hover !== null && state.candles[hover]) list.push({ time: toBar(state.candles[hover]).time, position: 'aboveBar', color: '#4a90e2', shape: 'arrowDown', text: '✂' });
    list.sort((a, b) => a.time - b.time);
    series.setMarkers(list);
  }

  const shownEnd = () => (picking ? state.candles.length - 1 : state.end);

  function render(next) {
    if (next) state = { ...state, ...next };
    if (!state?.candles?.length) return;
    applyColors();
    const end = shownEnd();
    if (shown.candles !== state.candles || end < shown.end || end > shown.end + 1) {
      series.setData(state.candles.slice(0, end + 1).map(toBar));
    } else if (end === shown.end + 1) {
      series.update(toBar(state.candles[end]));
    }
    shown = { candles: state.candles, end };
    const dp = decimals(state.symbol);
    series.applyOptions({ priceFormat: { type: 'price', precision: dp, minMove: Number((10 ** -dp).toFixed(dp)) } });
    if (state.zoom !== zoomShown && host.clientWidth) {
      zoomShown = state.zoom;
      chart.timeScale().applyOptions({ barSpacing: Math.max(2, Math.min(40, (host.clientWidth - 70) / (state.zoom || 70))) });
    }
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    if (!picking) {
      for (const tr of (state.trades || []).filter((x) => !x.result)) {
        lines.push(series.createPriceLine({ price: tr.entry, color: '#4a90e2', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: tr.side.toUpperCase() }));
        if (tr.sl !== null) lines.push(series.createPriceLine({ price: tr.sl, color: state.down, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'SL' }));
        if (tr.tp !== null) lines.push(series.createPriceLine({ price: tr.tp, color: state.up, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP' }));
      }
    }
    markers();
  }

  const onClick = (param) => {
    if (!picking || !pickCb || param?.time == null) return;
    pickCb(timeToIndex(param.time));
  };
  const onMove = (param) => {
    if (!picking) return;
    const i = param?.time == null ? null : timeToIndex(param.time);
    if (i !== hover) { hover = i; markers(); }
  };
  chart.subscribeClick(onClick);
  chart.subscribeCrosshairMove(onMove);

  return {
    kind: 'tv',
    render,
    toLatest() { chart.timeScale().scrollToRealTime(); },
    /** Show every candle and wait for a tap on the candle where the replay should start. */
    setPicking(on, cb) {
      picking = on; pickCb = on ? cb : null; hover = null;
      host.classList.toggle('is-picking', on);
      render();
      if (on) chart.timeScale().fitContent();
    },
    pipSize: () => pipSize(state?.symbol),
    destroy() {
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    },
  };
}
