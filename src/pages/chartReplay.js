// Chart Pro backtest: bar replay on real past candles, like TradingView's
// Bar Replay. Practice only: no money and no orders.

import { createTvReplayChart } from '../ui/tvReplayChart.js';
import { loadReplayCandles } from '../services/backend.js';
import { REPLAY_INTERVALS, replaySymbol, openTrade, checkCandle, close, pipsBetween, replayStats, startIndex, decimals } from '../lib/replay.js';
import { escapeHtml } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const SPEEDS = [1, 2, 5, 10];
const fmtPips = (p) => `${p > 0 ? '+' : ''}${p}`;
const tone = (p) => (p > 0 ? 'tone-green' : p < 0 ? 'tone-red' : 'tone-blue');

export function replayMarkup(chartSymbol) {
  const sym = replaySymbol(chartSymbol);
  return `
    <div class="replay" data-replay>
      <p class="panel-note">${t('Bar replay, like TradingView: load the chart, tap the candle where you want to start (the cut), then press Play. Candles after the cut stay hidden and appear one by one while you practise BUY and SELL with stop-loss and take-profit.')}</p>
      <form class="replay-setup" data-replay-setup novalidate>
        <p class="replay-pair">${t('Pair')}: <strong data-replay-pair>${sym ? escapeHtml(sym) : escapeHtml(chartSymbol)}</strong> <span class="panel-note">${t('(change it with the pair list above)')}</span></p>
        <label>${t('Timeframe')} <select name="interval">${REPLAY_INTERVALS.map((i) => `<option value="${i.id}" ${i.id === '15min' ? 'selected' : ''}>${i.label}</option>`).join('')}</select></label>
        <label>${t('Start date (optional)')} <input name="start" type="date"></label>
        <button class="button button-primary" type="submit">✂ ${t('Load chart and choose start')}</button>
        <p class="panel-note" data-replay-msg>${sym ? t('Leave the date empty to choose the start by tapping a candle on the chart.') : t('This pair cannot be replayed. Choose a forex pair, gold, silver or crypto in the pair list above.')}</p>
      </form>
      <div class="replay-stage" data-replay-stage hidden>
        <div class="replay-top">
          <strong data-replay-title></strong>
          <span class="replay-time" data-replay-time></span>
          <button class="ctool" type="button" data-rp="full" aria-pressed="false">${t('Full screen')}</button>
        </div>
        <div class="replay-pick" data-replay-pick hidden>
          <p><strong>✂ ${t('Tap the candle where your replay should start.')}</strong> ${t('Everything after it will be hidden.')}</p>
          <div class="replay-pick-date"><label>${t('Or jump to a date')} <input type="date" data-rp-date></label><button class="ctool" type="button" data-rp="cut-date">${t('Cut here')}</button></div>
        </div>
        <div class="replay-canvas replay-tv" data-replay-tv hidden aria-label="${t('Bar replay chart')}"></div>
        <canvas class="replay-canvas" data-replay-canvas hidden aria-label="${t('Bar replay chart')}"></canvas>
        <div class="replay-controls">
          <button class="ctool ctool-strong-play" type="button" data-rp="play">▶ ${t('Play')}</button>
          <button class="ctool" type="button" data-rp="next">${t('Next candle')} ⏭</button>
          <label class="replay-speed">${t('Speed')} <select data-rp-speed>${SPEEDS.map((s) => `<option value="${s}">${s}×</option>`).join('')}</select></label>
          <button class="ctool" type="button" data-rp="zoom-in" aria-label="${t('Zoom in')}">＋</button>
          <button class="ctool" type="button" data-rp="zoom-out" aria-label="${t('Zoom out')}">－</button>
          <button class="ctool" type="button" data-rp="latest">${t('Back to replay point')}</button>
          <button class="ctool" type="button" data-rp="cut">✂ ${t('Choose new start')}</button>
          <button class="ctool" type="button" data-rp="stop">${t('New replay')}</button>
        </div>
        <div class="replay-trade">
          <label>SL <input data-rp-sl type="number" min="0" step="1" inputmode="decimal" placeholder="${t('pips')}"></label>
          <label>TP <input data-rp-tp type="number" min="0" step="1" inputmode="decimal" placeholder="${t('pips')}"></label>
          <button class="button rp-buy" type="button" data-rp="buy">BUY</button>
          <button class="button rp-sell" type="button" data-rp="sell">SELL</button>
        </div>
        <div data-replay-open></div>
        <div data-replay-stats></div>
        <p class="panel-note">${t('Practice on real past prices from Twelve Data. No money and no real orders. When one candle touches both SL and TP, the SL is counted.')}</p>
      </div>
    </div>`;
}

export function mountReplay(root, getChartSymbol, getColors) {
  const box = root.querySelector('[data-replay]');
  if (!box) return null;
  const stage = box.querySelector('[data-replay-stage]');
  const setup = box.querySelector('[data-replay-setup]');
  const msg = box.querySelector('[data-replay-msg]');
  let chart = null; let timer = null;
  let s = null; // { symbol, interval, candles, end, trades, zoom, nextId }

  const colors = () => {
    const c = getColors();
    const light = c.theme === 'light';
    return { bg: c.bg, grid: c.grid, up: '#26a69a', down: '#ef5350', text: light ? '#555' : '#aaa' };
  };
  const draw = () => {
    if (!s) return;
    chart.render({ candles: s.candles, end: s.end, trades: s.trades, symbol: s.symbol, zoom: s.zoom, ...colors() });
    stage.classList.toggle('is-picking', Boolean(s.picking));
    box.querySelector('[data-replay-pick]').hidden = !s.picking;
    if (s.picking) { box.querySelector('[data-replay-time]').textContent = t('Choose the start'); box.querySelector('[data-replay-open]').innerHTML = ''; box.querySelector('[data-replay-stats]').innerHTML = ''; return; }
    const c = s.candles[s.end];
    box.querySelector('[data-replay-time]').textContent = new Date(c.t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });
    const dp = decimals(s.symbol);
    const open = s.trades.filter((x) => !x.result);
    box.querySelector('[data-replay-open]').innerHTML = open.length ? `<ul class="rp-list">${open.map((x) => {
      const p = pipsBetween(x, c.c, s.symbol);
      return `<li><span class="${x.side === 'buy' ? 'is-buy' : 'is-sell'}">${x.side.toUpperCase()}</span> ${x.entry.toFixed(dp)}${x.sl !== null ? ` · SL ${x.sl.toFixed(dp)}` : ''}${x.tp !== null ? ` · TP ${x.tp.toFixed(dp)}` : ''} <strong class="${tone(p)}">${fmtPips(p)} ${t('pips')}</strong> <button class="link-button" type="button" data-rp-close="${x.id}">${t('Close')}</button></li>`;
    }).join('')}</ul>` : '';
    const st = replayStats(s.trades);
    const done = s.trades.filter((x) => x.result).slice().reverse();
    box.querySelector('[data-replay-stats]').innerHTML = st.closed ? `
      <div class="bt-stats">
        <div><strong>${st.winRate === null ? '–' : `${st.winRate}%`}</strong><span>${t('Win rate')}</span></div>
        <div><strong class="tone-green">${st.wins}</strong><span>${t('Wins')}</span></div>
        <div><strong class="tone-red">${st.losses}</strong><span>${t('Losses')}</span></div>
        <div><strong class="${tone(st.pips)}">${fmtPips(st.pips)}</strong><span>${t('Pips')}</span></div>
      </div>
      <ul class="rp-list rp-done">${done.map((x) => `<li><span class="${x.side === 'buy' ? 'is-buy' : 'is-sell'}">${x.side.toUpperCase()}</span> ${x.entry.toFixed(dp)} → ${x.exit.toFixed(dp)} <em>${x.result === 'tp' ? 'TP' : x.result === 'sl' ? 'SL' : t('Closed')}</em> <strong class="${tone(x.pips)}">${fmtPips(x.pips)}</strong></li>`).join('')}</ul>` : '';
  };
  const pause = () => {
    clearInterval(timer); timer = null;
    const b = box.querySelector('[data-rp="play"]'); if (b) b.textContent = `▶ ${t('Play')}`;
  };
  const step = () => {
    if (!s || s.picking) return false;
    if (s.end >= s.candles.length - 1) {
      pause(); msg.textContent = t('The replay reached the latest candle.');
      return false;
    }
    s.end += 1;
    const c = s.candles[s.end];
    s.trades = s.trades.map((x) => checkCandle(x, c, s.symbol));
    chart.toLatest();
    draw();
    return true;
  };
  const play = () => {
    const speed = Number(box.querySelector('[data-rp-speed]').value) || 1;
    clearInterval(timer);
    timer = setInterval(() => { if (!step()) pause(); }, 1000 / speed);
    box.querySelector('[data-rp="play"]').textContent = `⏸ ${t('Pause')}`;
  };

  const onSubmit = async (e) => {
    if (!e.target.closest('[data-replay-setup]')) return;
    e.preventDefault();
    const symbol = replaySymbol(getChartSymbol());
    if (!symbol) { msg.textContent = t('This pair cannot be replayed. Choose a forex pair, gold, silver or crypto in the pair list above.'); return; }
    const btn = setup.querySelector('button'); btn.disabled = true;
    msg.textContent = t('Loading past prices…');
    const res = await loadReplayCandles(symbol, setup.interval.value);
    btn.disabled = false;
    if (!res.ok) { msg.textContent = res.message; return; }
    const candles = res.data.candles || [];
    if (candles.length < 30) { msg.textContent = t('Not enough past prices for this pair and timeframe.'); return; }
    const chosen = setup.start.value || null;
    s = { symbol, interval: setup.interval.value, candles, end: startIndex(candles, chosen), trades: [], zoom: 70, nextId: 1, picking: !chosen };
    const label = REPLAY_INTERVALS.find((i) => i.id === s.interval)?.label || s.interval;
    box.querySelector('[data-replay-title]').textContent = `${symbol} · ${label}`;
    const first = new Date(candles[0].t).toISOString().slice(0, 10); const last = new Date(candles[candles.length - 1].t).toISOString().slice(0, 10);
    setup.start.min = first; setup.start.max = last;
    const jump = box.querySelector('[data-rp-date]'); jump.min = first; jump.max = last; jump.value = '';
    msg.textContent = `${t('History available')}: ${first} – ${last}`;
    setup.hidden = true; stage.hidden = false;
    if (!chart) chart = await createTvReplayChart(box.querySelector('[data-replay-tv]'), box.querySelector('[data-replay-canvas]'));
    if (!s) return; // closed while loading
    if (s.picking) startPicking(); else { chart.toLatest(); draw(); }
  };

  // The cut: replay starts after the chosen candle; everything later is hidden.
  const cut = (idx) => {
    if (!s || !Number.isInteger(idx) || idx < 0) return;
    const minHistory = Math.min(20, s.candles.length - 2);
    s.end = Math.max(minHistory, Math.min(idx, s.candles.length - 2));
    s.picking = false; s.trades = [];
    chart.setPicking(false);
    chart.toLatest();
    draw();
  };
  const startPicking = () => {
    pause();
    s.picking = true; s.trades = [];
    draw();
    chart.setPicking(true, cut);
  };

  const onClick = (e) => {
    const closeBtn = e.target.closest('[data-rp-close]');
    if (closeBtn && s) {
      const c = s.candles[s.end];
      s.trades = s.trades.map((x) => (String(x.id) === closeBtn.dataset.rpClose && !x.result ? close(x, c.c, c.t, 'manual', s.symbol) : x));
      draw(); return;
    }
    const b = e.target.closest('[data-rp]');
    if (!b || !s) return;
    const act = b.dataset.rp;
    if (act === 'cut') { startPicking(); return; }
    if (act === 'cut-date') {
      const v = box.querySelector('[data-rp-date]').value;
      if (!v) { box.querySelector('[data-rp-date]').focus(); return; }
      cut(startIndex(s.candles, v, 0));
      return;
    }
    if (s.picking) return;
    if (act === 'play') { if (timer) pause(); else play(); }
    if (act === 'next') { pause(); step(); }
    if (act === 'zoom-in') { s.zoom = Math.max(20, Math.round(s.zoom / 1.4)); draw(); }
    if (act === 'zoom-out') { s.zoom = Math.min(300, Math.round(s.zoom * 1.4)); draw(); }
    if (act === 'latest') { chart.toLatest(); draw(); }
    if (act === 'buy' || act === 'sell') {
      const c = s.candles[s.end];
      const sl = box.querySelector('[data-rp-sl]').value; const tp = box.querySelector('[data-rp-tp]').value;
      s.trades = [...s.trades, openTrade({ side: act, price: c.c, time: c.t, slPips: sl, tpPips: tp, symbol: s.symbol, id: s.nextId++ })];
      draw();
    }
    if (act === 'full') {
      const on = !box.classList.contains('is-full');
      box.classList.toggle('is-full', on);
      document.documentElement.classList.toggle('chart-full-open', on);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? t('Exit full screen') : t('Full screen');
      requestAnimationFrame(draw);
    }
    if (act === 'stop') {
      pause();
      if (box.classList.contains('is-full')) box.querySelector('[data-rp="full"]').click();
      chart?.setPicking?.(false);
      s = null; stage.hidden = true; setup.hidden = false;
      msg.textContent = t('Leave the date empty to choose the start by tapping a candle on the chart.');
    }
  };
  const onSpeed = (e) => { if (e.target.matches('[data-rp-speed]') && timer) play(); };

  box.addEventListener('submit', onSubmit);
  box.addEventListener('click', onClick);
  box.addEventListener('change', onSpeed);
  return {
    pairChanged(chartSymbol) {
      const sym = replaySymbol(chartSymbol);
      const el = box.querySelector('[data-replay-pair]'); if (el) el.textContent = sym || chartSymbol;
      if (!s) msg.textContent = sym ? t('Leave the date empty to choose the start by tapping a candle on the chart.') : t('This pair cannot be replayed. Choose a forex pair, gold, silver or crypto in the pair list above.');
    },
    redraw: draw,
    destroy() {
      pause(); chart?.destroy();
      box.removeEventListener('submit', onSubmit);
      box.removeEventListener('click', onClick);
      box.removeEventListener('change', onSpeed);
      document.documentElement.classList.remove('chart-full-open');
    },
  };
}
