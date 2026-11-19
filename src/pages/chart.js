// Live XAUUSD chart from TradingView's free embeddable widget, in a full-page
// view. The chart and its prices are drawn by TradingView inside its own frame;
// this app does not read those prices.
//
// Free: the chart, timeframes, colours and two basic indicators.
// Chart Pro (paid in birr, separate from signals Pro): TradingView's full
// toolbars (every drawing tool and indicator), all indicator presets here, and
// a backtest of the TradeTactix plan on real past candles.

import { loadTradingViewWidget } from '../ui/tvWidget.js';
import { currentTheme } from '../ui/theme.js';
import { session } from '../state/session.js';
import { getChartAccess, runBacktest } from '../services/backend.js';
import { escapeHtml } from '../lib/format.js';
import { replayMarkup, mountReplay } from './chartReplay.js';
import { t } from '../lib/i18n.js';

import { CHART_VIEWS, INDICATORS, COLOR_PRESETS, SYMBOL_GROUPS, ALL_SYMBOLS, CHART_SYMBOL, cleanSymbol, resolveColors, widgetConfig } from '../lib/chartConfig.js';

export { CHART_SYMBOL, SYMBOL_GROUPS, cleanSymbol, CHART_VIEWS, INDICATORS, COLOR_PRESETS, resolveColors, allowedStudies, widgetConfig } from '../lib/chartConfig.js';

// ---------- Saved choices (this device only) ----------
const KEY = 'tt-chart';
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { symbol: cleanSymbol(p.symbol) || CHART_SYMBOL, view: CHART_VIEWS.some((v) => v.id === p.view) ? p.view : '4h', colors: p.colors || { preset: 'app' }, studies: Array.isArray(p.studies) ? p.studies : [] };
  } catch { return { symbol: CHART_SYMBOL, view: '4h', colors: { preset: 'app' }, studies: [] }; }
}
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

const LOCK = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1.5 0h4V5a2 2 0 0 0-4 0z" fill="currentColor"/></svg>';

const ETH_TIME = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });
const RESULT = { tp: ['TP Done', 'tone-green'], sl: ['SL hit', 'tone-red'], be: ['Breakeven', 'tone-blue'], expired: ['No result in 48h', 'tone-muted'], open: ['Still running', 'tone-orange'] };

export function backtestMarkup(r) {
  if (!r.total) return `<p class="panel-note">${t('No trade passed every check in this period. The plan waits for clean setups, so quiet weeks happen.')}</p>`;
  const rows = r.trades.slice().reverse().map((x) => {
    const [label, tone] = RESULT[x.result] || [x.result, 'tone-muted'];
    const pips = Number.isFinite(x.pips) ? `${x.pips > 0 ? '+' : ''}${x.pips}` : '–';
    return `<tr><td>${ETH_TIME(x.opened_at)}</td><td class="${x.direction === 'buy' ? 'is-buy' : 'is-sell'}">${x.direction.toUpperCase()}</td><td>${Number(x.entry).toFixed(2)}</td><td><span class="bt-result ${tone}">${t(label)}</span></td><td class="num">${pips}</td></tr>`;
  }).join('');
  return `
    <div class="bt-stats">
      <div><strong>${r.winRate === null ? '–' : `${r.winRate}%`}</strong><span>${t('Win rate')}</span></div>
      <div><strong class="tone-green">${r.wins}</strong><span>${t('TP Done')}</span></div>
      <div><strong class="tone-red">${r.losses}</strong><span>${t('SL hit')}</span></div>
      <div><strong class="tone-blue">${r.breakeven}</strong><span>${t('Breakeven')}</span></div>
      <div><strong>${r.pips > 0 ? '+' : ''}${r.pips}</strong><span>${t('Pips')}</span></div>
    </div>
    <div class="bt-table-wrap"><table class="bt-table">
      <thead><tr><th>${t('Opened')}</th><th>${t('Side')}</th><th>${t('Entry')}</th><th>${t('Result')}</th><th class="num">${t('Pips')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="panel-note">${t('Backtest on past candles from Twelve Data, not live results. Win rate counts TP and SL only. The news pause is not replayed. Past results do not promise future ones.')}</p>`;
}

function symbolOptions(current) {
  const known = ALL_SYMBOLS.some((x) => x.id === current);
  const groups = SYMBOL_GROUPS.map((g) => `<optgroup label="${t(g.label)}">${g.items.map((x) => `<option value="${x.id}" ${x.id === current ? 'selected' : ''}>${escapeHtml(x.label)}</option>`).join('')}</optgroup>`).join('');
  return (known ? '' : `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`) + groups;
}

export function chartPage() {
  const prefs = loadPrefs();
  const tabs = CHART_VIEWS.map((v) => `
    <button class="tf-tab" type="button" role="tab" data-view="${v.id}" aria-selected="${v.id === prefs.view}">
      <strong>${v.label}</strong><span>${t(v.job)}</span>
    </button>`).join('');

  return {
    title: 'Chart',
    html: `
      <header class="page-head chart-head">
        <h1>${t('Chart')}</h1>
        <span class="chart-plan" data-chart-plan>${t('Free')}</span>
      </header>
      <p class="pc-note">${t('For a better experience, use a PC.')}</p>
      <section class="chart-shell" data-chart-shell>
        <div class="chart-bar">
          <div class="symbol-row">
            <label class="sr-only" for="chart-symbol">${t('Pair')}</label>
            <select id="chart-symbol" class="symbol-select" data-symbol>${symbolOptions(prefs.symbol)}</select>
            <form class="symbol-search" data-symbol-form novalidate>
              <input name="q" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('Other pair, e.g. USDZAR')}" aria-label="${t('Other pair')}" maxlength="40">
              <button class="ctool" type="submit">${t('Open')}</button>
            </form>
          </div>
          <div class="tf-tabs" role="tablist" aria-label="${t('Timeframe')}">${tabs}</div>
          <div class="chart-tools">
            <button class="ctool" type="button" data-panel="studies" aria-expanded="false">${t('Indicators')}</button>
            <button class="ctool" type="button" data-panel="colors" aria-expanded="false">${t('Colors')}</button>
            <button class="ctool ctool-strong" type="button" data-full aria-pressed="false">${t('Full screen')}</button>
          </div>
        </div>
        <div class="chart-panel" data-panel-body="studies" hidden></div>
        <div class="chart-panel" data-panel-body="colors" hidden></div>
        <div class="chart-frame"><div class="tradingview-widget-container" id="tv-chart"></div></div>
      </section>
      <p class="panel-note" data-tools-note></p>

      <section class="panel backtest" data-backtest>
        <h2 class="panel-title">${t('Backtest')}</h2>
        <div data-backtest-body><p class="panel-note">${t('Checking your plan…')}</p></div>
      </section>
      <p class="panel-note">${t("Prices on this chart come from TradingView's data sources, so they can differ slightly from your Exness quotes. Times are in Ethiopia time. Drawings are not saved, and the app does not read this chart: the signal engine uses its own price feed.")}</p>`,
    mount(root) {
      const host = root.querySelector('#tv-chart');
      const shell = root.querySelector('[data-chart-shell]');
      let pro = false;
      let access = null;
      let drawTimer = null;

      const draw = () => {
        const view = CHART_VIEWS.find((v) => v.id === prefs.view) || CHART_VIEWS[0];
        loadTradingViewWidget(host, 'embed-widget-advanced-chart.js', widgetConfig(view, { pro, symbol: prefs.symbol, colors: resolveColors(prefs.colors, currentTheme()), studies: prefs.studies }), t('The TradingView chart could not load.'));
      };
      const redraw = () => { clearTimeout(drawTimer); drawTimer = setTimeout(() => { draw(); replay?.redraw(); }, 150); };

      const studiesPanel = () => {
        const items = INDICATORS.map((i) => {
          const locked = !pro && !i.free;
          const on = prefs.studies.includes(i.id) && !locked;
          return `<label class="study ${locked ? 'is-locked' : ''}"><input type="checkbox" data-study="${i.id}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}> <span>${i.label}</span>${locked ? LOCK : ''}</label>`;
        }).join('');
        return `<div class="study-grid">${items}</div>${pro
          ? `<p class="panel-note">${t('Chart Pro: every other TradingView indicator and drawing tool is in the toolbars on the chart.')}</p>`
          : `<p class="panel-note">${t('Free: moving average and RSI. All indicators, unlimited drawing tools and backtesting come with Chart Pro.')} <a href="#/plans" data-chart-pro-link>${t('Get Chart Pro')}</a></p>`}`;
      };
      const colorsPanel = () => {
        const c = prefs.colors;
        const now = resolveColors(c, currentTheme());
        const presets = COLOR_PRESETS.map((p) => {
          const sw = p.theme ? p : resolveColors({ preset: 'app' }, currentTheme());
          return `<button class="swatch" type="button" data-preset="${p.id}" aria-pressed="${c.preset === p.id}"><i style="background:${sw.bg};border-color:${sw.grid}"></i>${t(p.label)}</button>`;
        }).join('');
        return `<div class="swatches">${presets}</div>
          <div class="custom-colors">
            <label>${t('Background')} <input type="color" data-color="bg" value="${now.bg}"></label>
            <label>${t('Grid')} <input type="color" data-color="grid" value="${now.grid}"></label>
            <label>${t('Text')} <select data-color="theme"><option value="dark" ${now.theme === 'dark' ? 'selected' : ''}>${t('Light text')}</option><option value="light" ${now.theme === 'light' ? 'selected' : ''}>${t('Dark text')}</option></select></label>
          </div>`;
      };
      const renderPanels = () => {
        root.querySelector('[data-panel-body="studies"]').innerHTML = studiesPanel();
        root.querySelector('[data-panel-body="colors"]').innerHTML = colorsPanel();
        root.querySelector('[data-chart-plan]').textContent = pro ? 'Chart Pro' : t('Free');
        root.querySelector('[data-chart-plan]').classList.toggle('is-pro', pro);
        root.querySelector('[data-tools-note]').textContent = pro
          ? t('Use the left toolbar for drawing tools and the top toolbar for indicators. Tap Full screen to hide the menus.')
          : t('Free chart: timeframes, colours, moving average and RSI. Drawing tools and the full indicator list come with Chart Pro.');
      };

      const backtestBody = root.querySelector('[data-backtest-body]');
      let replay = null;
      const renderBacktest = () => {
        replay?.destroy(); replay = null;
        if (!pro) {
          backtestBody.innerHTML = `<div class="locked-card">${LOCK}<div><p>${t('Bar replay on real past candles: pick a pair and a start date, watch candles appear one by one, and practise BUY and SELL with SL and TP. Also: test the TradeTactix plan on gold.')}</p>
            <a class="button button-primary" href="#/plans" data-chart-pro-link>${t('Get Chart Pro')}</a></div></div>`;
          return;
        }
        backtestBody.innerHTML = `${replayMarkup(prefs.symbol)}
          <details class="plan-test">
            <summary>${t('Extra: test the TradeTactix plan on gold')}</summary>
            <p class="panel-note bt-scope">${t('The backtest runs the TradeTactix plan on XAUUSD (gold), the pair the strategy is built for.')}</p>
            <form class="bt-form" data-bt-form>
              <label>${t('Period')} <select name="days"><option value="7">${t('7 days')}</option><option value="14">${t('14 days')}</option><option value="30" selected>${t('30 days')}</option><option value="50">${t('50 days')}</option></select></label>
              <button class="button button-primary" type="submit">${t('Run backtest')}</button>
            </form>
            <div data-bt-out aria-live="polite"></div>
          </details>`;
        replay = mountReplay(backtestBody, () => prefs.symbol, () => resolveColors(prefs.colors, currentTheme()));
      };

      const onClick = (e) => {
        if (e.target.closest('[data-chart-pro-link]')) { try { sessionStorage.setItem('tt-goto', 'chart-pro'); } catch { /* private mode */ } return; }
        const tab = e.target.closest('.tf-tab');
        if (tab && tab.dataset.view !== prefs.view) {
          prefs.view = tab.dataset.view; savePrefs(prefs);
          root.querySelectorAll('.tf-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === prefs.view)));
          draw();
          return;
        }
        const panelBtn = e.target.closest('[data-panel]');
        if (panelBtn) {
          const name = panelBtn.dataset.panel;
          root.querySelectorAll('[data-panel]').forEach((b) => {
            const open = b.dataset.panel === name && b.getAttribute('aria-expanded') !== 'true';
            b.setAttribute('aria-expanded', String(open));
            root.querySelector(`[data-panel-body="${b.dataset.panel}"]`).hidden = !open;
          });
          return;
        }
        const preset = e.target.closest('[data-preset]');
        if (preset) {
          prefs.colors = { preset: preset.dataset.preset }; savePrefs(prefs);
          root.querySelector('[data-panel-body="colors"]').innerHTML = colorsPanel();
          redraw();
          return;
        }
        if (e.target.closest('[data-full]')) {
          const on = !shell.classList.contains('is-full');
          shell.classList.toggle('is-full', on);
          document.documentElement.classList.toggle('chart-full-open', on);
          const b = root.querySelector('[data-full]');
          b.setAttribute('aria-pressed', String(on));
          b.textContent = on ? t('Exit full screen') : t('Full screen');
        }
      };
      const setSymbol = (sym) => {
        prefs.symbol = sym; savePrefs(prefs);
        root.querySelector('[data-symbol]').innerHTML = symbolOptions(sym);
        replay?.pairChanged(sym);
        draw();
      };
      const onChange = (e) => {
        if (e.target.matches('[data-symbol]')) { setSymbol(e.target.value); return; }
        const box = e.target.closest('[data-study]');
        if (box) {
          const id = box.dataset.study;
          prefs.studies = box.checked ? [...new Set([...prefs.studies, id])] : prefs.studies.filter((x) => x !== id);
          savePrefs(prefs); redraw();
          return;
        }
        const color = e.target.closest('[data-color]');
        if (color) {
          const now = resolveColors(prefs.colors, currentTheme());
          prefs.colors = { preset: 'custom', theme: now.theme, bg: now.bg, grid: now.grid, [color.dataset.color]: color.value };
          savePrefs(prefs);
          root.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          redraw();
        }
      };
      const onSubmit = async (e) => {
        const sform = e.target.closest('[data-symbol-form]');
        if (sform) {
          e.preventDefault();
          const sym = cleanSymbol(sform.q.value);
          if (!sym) { sform.q.setCustomValidity(t('Type a pair like EURUSD or BINANCE:BTCUSDT.')); sform.q.reportValidity(); return; }
          sform.q.setCustomValidity(''); sform.q.value = '';
          setSymbol(sym);
          return;
        }
        const form = e.target.closest('[data-bt-form]');
        if (!form) return;
        e.preventDefault();
        const out = root.querySelector('[data-bt-out]');
        const btn = form.querySelector('button');
        btn.disabled = true;
        out.innerHTML = `<p class="panel-note">${t('Replaying the plan on past candles. This can take up to a minute…')}</p>`;
        const res = await runBacktest(form.days.value);
        btn.disabled = false;
        out.innerHTML = res.ok ? backtestMarkup(res.data) : `<p class="result-errors">${escapeHtml(res.message)}</p>`;
      };
      const onKey = (e) => { if (e.key === 'Escape' && shell.classList.contains('is-full')) root.querySelector('[data-full]').click(); };
      // Redraw in the new colours when the site theme changes and the chart follows it.
      const themeObserver = new MutationObserver(() => { if (prefs.colors.preset === 'app') { redraw(); replay?.redraw(); root.querySelector('[data-panel-body="colors"]').innerHTML = colorsPanel(); } });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('submit', onSubmit);
      document.addEventListener('keydown', onKey);
      renderPanels();
      renderBacktest();
      draw();

      // Chart Pro check: administrators always have it.
      let alive = true;
      (session.get().user ? getChartAccess() : Promise.resolve({ chart_pro: false })).then((a) => {
        if (!alive) return;
        access = a;
        if (access.chart_pro) { pro = true; renderPanels(); renderBacktest(); draw(); } else { renderBacktest(); }
      });

      return () => {
        alive = false;
        replay?.destroy();
        clearTimeout(drawTimer);
        themeObserver.disconnect();
        root.removeEventListener('click', onClick);
        root.removeEventListener('change', onChange);
        root.removeEventListener('submit', onSubmit);
        document.removeEventListener('keydown', onKey);
        document.documentElement.classList.remove('chart-full-open');
        host.innerHTML = '';
      };
    },
  };
}
