// Chart page: our own chart (TradingView's open-source chart library) with
// every pair and timeframe, indicators, colours and drawing tools.
//
// Drawings are saved for each pair as time and price, so they stay on every
// timeframe and after the page closes, until the member deletes them: on the
// account when signed in (and the database table exists), and on the device.
//
// Free: chart, all pairs and timeframes, colours, every drawing tool, MA and RSI.
// Chart Pro (paid in birr, separate from signal access): every indicator.

import { currentTheme } from '../ui/theme.js';
import { session } from '../state/session.js';
import { getChartAccess, getChartCandles, loadDrawings, saveDrawings } from '../services/backend.js';
import { escapeHtml } from '../lib/format.js';
import { createProChart } from '../ui/proChart.js';
import { TOOLS, DRAW_COLORS, cleanDrawings } from '../lib/drawings.js';
import { t } from '../lib/i18n.js';
import { CHART_VIEWS, MORE_VIEWS, ALL_VIEWS, INDICATORS, COLOR_PRESETS, SYMBOL_GROUPS, ALL_SYMBOLS, CHART_SYMBOL, cleanSymbol, resolveColors, allowedStudies } from '../lib/chartConfig.js';

export { CHART_SYMBOL, SYMBOL_GROUPS, cleanSymbol, CHART_VIEWS, INDICATORS, COLOR_PRESETS, resolveColors, allowedStudies } from '../lib/chartConfig.js';

const REFRESH_MS = 60e3;

// ---------- Saved choices (this device) ----------
const KEY = 'tt-chart';
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { symbol: cleanSymbol(p.symbol) || CHART_SYMBOL, view: ALL_VIEWS.some((v) => v.id === p.view) ? p.view : '4h', colors: p.colors || { preset: 'app' }, studies: Array.isArray(p.studies) ? p.studies : [], magnet: p.magnet !== false, color: DRAW_COLORS.includes(p.color) ? p.color : DRAW_COLORS[0] };
  } catch { return { symbol: CHART_SYMBOL, view: '4h', colors: { preset: 'app' }, studies: [], magnet: true, color: DRAW_COLORS[0] }; }
}
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

const drawKey = (symbol) => `tt-draw:${symbol}`;
function localDrawings(symbol) {
  try { const v = JSON.parse(localStorage.getItem(drawKey(symbol)) || 'null'); return v && Array.isArray(v.drawings) ? { drawings: cleanDrawings(v.drawings), updated_at: v.updated_at || null } : null; } catch { return null; }
}
function storeLocal(symbol, drawings, updatedAt) { try { localStorage.setItem(drawKey(symbol), JSON.stringify({ drawings, updated_at: updatedAt })); } catch { /* full or private */ } }

const LOCK = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1.5 0h4V5a2 2 0 0 0-4 0z" fill="currentColor"/></svg>';
const ICONS = {
  cursor: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  hline: '<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',
  trend: '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>',
  ray: '<path d="M4 18L21 7"/><circle cx="4" cy="18" r="2"/><circle cx="11" cy="13.5" r="2"/>',
  rect: '<rect x="4" y="7" width="16" height="10" rx="1"/>',
  fib: '<path d="M3 5h18M3 9.5h18M3 13h18M3 19h18"/>',
  vline: '<path d="M12 3v18"/><circle cx="12" cy="12" r="2"/>',
  text: '<path d="M5 6h14M12 6v13"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

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
  const toolBtns = [`<button class="dtool" type="button" data-tool="" aria-pressed="true" title="${t('Move the chart')}">${icon('cursor')}<span>${t('Move')}</span></button>`]
    .concat(TOOLS.map((x) => `<button class="dtool" type="button" data-tool="${x.id}" aria-pressed="false" title="${t(x.label)}">${icon(x.id)}<span>${t(x.label)}</span></button>`)).join('');

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
              <input name="q" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('Other pair, e.g. USDZAR')}" aria-label="${t('Other pair')}" maxlength="20">
              <button class="ctool" type="submit">${t('Open')}</button>
            </form>
          </div>
          <div class="tf-tabs" role="tablist" aria-label="${t('Timeframe')}">${tabs}</div>
          <div class="tf-more" role="tablist" aria-label="${t('More timeframes')}">${MORE_VIEWS.map((v) => `<button class="tf-tab tf-chip" type="button" role="tab" data-view="${v.id}" aria-selected="${v.id === prefs.view}">${v.label}</button>`).join('')}</div>
          <div class="chart-tools">
            <button class="ctool" type="button" data-panel="studies" aria-expanded="false">${t('Indicators')}</button>
            <button class="ctool" type="button" data-panel="colors" aria-expanded="false">${t('Colors')}</button>
            <button class="ctool ctool-strong" type="button" data-full aria-pressed="false">${t('Full screen')}</button>
          </div>
        </div>
        <div class="chart-panel" data-panel-body="studies" hidden></div>
        <div class="chart-panel" data-panel-body="colors" hidden></div>
        <div class="draw-bar" role="toolbar" aria-label="${t('Drawing tools')}">
          <div class="draw-tools">${toolBtns}</div>
          <div class="draw-opts">
            <button class="dtool dtool-sm" type="button" data-magnet aria-pressed="${prefs.magnet}" title="${t('Magnet: snap to candle high, low, open or close')}">${icon('magnet')}<span>${t('Magnet')}</span></button>
            <div class="draw-colors" role="group" aria-label="${t('Drawing colour')}">${DRAW_COLORS.map((c) => `<button type="button" class="dcolor" data-dcolor="${c}" style="--c:${c}" aria-pressed="${c === prefs.color}" aria-label="${c}"></button>`).join('')}</div>
            <button class="dtool dtool-sm is-danger" type="button" data-del hidden>${icon('trash')}<span>${t('Delete')}</span></button>
            <button class="dtool dtool-sm" type="button" data-clear>${t('Delete all')}</button>
          </div>
          <p class="draw-hint" data-draw-hint></p>
        </div>
        <div class="chart-frame pro-frame">
          <div class="pro-chart" id="pro-chart"></div>
          <div class="pro-status" data-pro-status>${t('Loading prices…')}</div>
        </div>
      </section>
      <p class="panel-note" data-save-note></p>
      <p class="panel-note">${t('Prices come from Twelve Data and refresh about every minute, so they can differ slightly from your Exness quotes. Times are in Ethiopia time. The signal engine uses its own price feed.')}</p>`,
    mount(root) {
      const host = root.querySelector('#pro-chart');
      const shell = root.querySelector('[data-chart-shell]');
      const status = root.querySelector('[data-pro-status]');
      const hint = root.querySelector('[data-draw-hint]');
      let chart = null;
      let pro = false;
      let alive = true;
      let loadSeq = 0;
      let timer = null;
      let saveTimer = null;
      let drawingsSymbol = null;

      const view = () => ALL_VIEWS.find((v) => v.id === prefs.view) || CHART_VIEWS[0];
      const colorsNow = () => { const c = resolveColors(prefs.colors, currentTheme()); return { ...c, text: c.theme === 'light' ? '#555555' : '#9a9a9a' }; };
      const showStatus = (text) => { status.textContent = text || ''; status.hidden = !text; };
      const saveNote = (text) => { root.querySelector('[data-save-note]').textContent = text; };

      const HINTS = {
        '': t('Move: drag to scroll, pinch to zoom. Tap a drawing to select it, then drag it or its ends.'),
        hline: t('Tap where the line goes.'), vline: t('Tap where the line goes.'), text: t('Tap where the text goes.'),
        trend: t('Tap the first point, then the second (or drag).'), ray: t('Tap the first point, then the second (or drag).'),
        rect: t('Tap one corner of the zone, then the opposite corner (or drag).'), fib: t('Tap the swing start, then the swing end (or drag).'),
      };
      const setToolUi = (id) => {
        root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === (id || ''))));
        hint.textContent = HINTS[id || ''];
      };

      // ---------- drawings: device first, then the account ----------
      async function loadDrawingsFor(symbol) {
        drawingsSymbol = symbol;
        const local = localDrawings(symbol);
        chart?.setDrawings(local ? local.drawings : []);
        if (!session.get().user) { saveNote(t('Drawings are saved on this device. Open your account to keep them on every device.')); return; }
        const r = await loadDrawings(symbol);
        if (!alive || drawingsSymbol !== symbol) return;
        if (!r.ok) { saveNote(t('Drawings are saved on this device.')); return; }
        const row = Array.isArray(r.data) ? null : r.data;
        const serverAt = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
        const localAt = local?.updated_at ? new Date(local.updated_at).getTime() : 0;
        if (row && serverAt >= localAt) {
          const list = cleanDrawings(row.drawings);
          storeLocal(symbol, list, row.updated_at);
          chart?.setDrawings(list);
        } else if (local && localAt > serverAt) {
          saveDrawings(symbol, local.drawings);
        }
        saveNote(t('Drawings are saved to your account until you delete them.'));
      }
      function onDrawingsChange(list) {
        const symbol = prefs.symbol;
        const clean = cleanDrawings(list);
        storeLocal(symbol, clean, new Date().toISOString());
        clearTimeout(saveTimer);
        if (!session.get().user) return;
        saveTimer = setTimeout(async () => {
          const r = await saveDrawings(symbol, clean);
          if (alive) saveNote(r.ok ? t('Drawings are saved to your account until you delete them.') : t('Drawings are saved on this device.'));
        }, 700);
      }

      // ---------- prices ----------
      async function load(fresh = true) {
        const seq = ++loadSeq;
        const v = view(); const symbol = prefs.symbol;
        if (fresh) showStatus(t('Loading prices…'));
        const r = await getChartCandles(symbol, v.interval);
        if (!alive || seq !== loadSeq) return;
        if (!r.ok) { if (fresh) showStatus(r.message); return; }
        showStatus('');
        if (fresh) {
          chart.setData(r.data.candles, v, symbol);
          if (drawingsSymbol !== symbol) loadDrawingsFor(symbol);
        } else {
          chart.refresh(r.data.candles);
        }
      }
      const startRefresh = () => {
        clearInterval(timer);
        timer = setInterval(() => { if (!document.hidden) load(false); }, REFRESH_MS);
      };

      // ---------- panels ----------
      const studiesPanel = () => {
        const items = INDICATORS.map((i) => {
          const locked = !pro && !i.free;
          const on = prefs.studies.includes(i.id) && !locked;
          return `<label class="study ${locked ? 'is-locked' : ''}"><input type="checkbox" data-study="${i.id}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}> <span>${i.label}</span>${locked ? LOCK : ''}</label>`;
        }).join('');
        return `<div class="study-grid">${items}</div>${pro ? '' : `<p class="panel-note">${t('Free: moving average and RSI. Every indicator comes with Chart Pro.')} <a href="#/plans" data-chart-pro-link>${t('Get Chart Pro')}</a></p>`}`;
      };
      const colorsPanel = () => {
        const c = prefs.colors; const now = resolveColors(c, currentTheme());
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
        const badge = root.querySelector('[data-chart-plan]');
        badge.textContent = pro ? 'Chart Pro' : t('Free'); badge.classList.toggle('is-pro', pro);
      };
      const applyStudies = () => chart?.setStudies(allowedStudies(prefs.studies, pro));
      const applyColors = () => { chart?.setColors(colorsNow()); root.querySelector('.pro-frame').style.background = colorsNow().bg; };

      // ---------- events ----------
      const onClick = (e) => {
        if (e.target.closest('[data-chart-pro-link]')) { try { sessionStorage.setItem('tt-goto', 'chart-pro'); } catch { /* private mode */ } return; }
        const tab = e.target.closest('[data-view]');
        if (tab) {
          if (tab.dataset.view === prefs.view) return;
          prefs.view = tab.dataset.view; savePrefs(prefs);
          root.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === prefs.view)));
          if (chart) load(true);
          return;
        }
        const toolBtn = e.target.closest('[data-tool]');
        if (toolBtn) { const id = toolBtn.dataset.tool || null; chart?.setTool(id, prefs.color); setToolUi(id); return; }
        if (e.target.closest('[data-magnet]')) {
          prefs.magnet = !prefs.magnet; savePrefs(prefs); chart?.setMagnet(prefs.magnet);
          root.querySelector('[data-magnet]').setAttribute('aria-pressed', String(prefs.magnet));
          return;
        }
        const dc = e.target.closest('[data-dcolor]');
        if (dc) {
          prefs.color = dc.dataset.dcolor; savePrefs(prefs);
          root.querySelectorAll('[data-dcolor]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dcolor === prefs.color)));
          chart?.recolorSelected(prefs.color);
          const pressed = root.querySelector('[data-tool][aria-pressed="true"]');
          if (pressed?.dataset.tool) chart?.setTool(pressed.dataset.tool, prefs.color);
          return;
        }
        if (e.target.closest('[data-del]')) { chart?.deleteSelected(); return; }
        if (e.target.closest('[data-clear]')) {
          if (window.confirm(t('Delete every drawing on this pair?'))) chart?.clearAll();
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
          applyColors();
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
        chart?.setTool(null); setToolUi(null);
        if (chart) load(true);
      };
      const onChange = (e) => {
        if (e.target.matches('[data-symbol]')) { setSymbol(e.target.value); return; }
        const box = e.target.closest('[data-study]');
        if (box) {
          const id = box.dataset.study;
          prefs.studies = box.checked ? [...new Set([...prefs.studies, id])] : prefs.studies.filter((x) => x !== id);
          savePrefs(prefs); applyStudies();
          return;
        }
        const color = e.target.closest('[data-color]');
        if (color) {
          const now = resolveColors(prefs.colors, currentTheme());
          prefs.colors = { preset: 'custom', theme: now.theme, bg: now.bg, grid: now.grid, [color.dataset.color]: color.value };
          savePrefs(prefs);
          root.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          applyColors();
        }
      };
      const onSubmit = (e) => {
        const sform = e.target.closest('[data-symbol-form]');
        if (!sform) return;
        e.preventDefault();
        const sym = cleanSymbol(sform.q.value);
        if (!sym) { sform.q.setCustomValidity(t('Type a pair like EURUSD or BTCUSD.')); sform.q.reportValidity(); return; }
        sform.q.setCustomValidity(''); sform.q.value = '';
        setSymbol(sym);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { if (shell.classList.contains('is-full')) root.querySelector('[data-full]').click(); else { chart?.setTool(null); chart?.deselect(); setToolUi(null); } }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !/input|select|textarea/i.test(e.target.tagName)) chart?.deleteSelected();
      };
      const onVisible = () => { if (!document.hidden && chart) load(false); };
      const themeObserver = new MutationObserver(() => { if (prefs.colors.preset === 'app') { applyColors(); root.querySelector('[data-panel-body="colors"]').innerHTML = colorsPanel(); } });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('submit', onSubmit);
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisible);
      renderPanels();
      setToolUi(null);

      createProChart(host, {
        onDrawingsChange,
        onSelect: (d) => { const del = root.querySelector('[data-del]'); if (del) del.hidden = !d; },
        onToolDone: () => setToolUi(null),
      }).then((c) => {
        if (!alive) { c.destroy(); return; }
        chart = c;
        chart.setMagnet(prefs.magnet);
        applyColors(); applyStudies();
        load(true); startRefresh();
      }).catch(() => {
        if (alive) showStatus(t('The chart could not load. Check your connection and open the page again.'));
      });

      // Chart Pro check: administrators always have it.
      (session.get().user ? getChartAccess() : Promise.resolve({ chart_pro: false })).then((a) => {
        if (!alive) return;
        pro = Boolean(a.chart_pro);
        renderPanels(); applyStudies();
      });

      return () => {
        alive = false;
        clearInterval(timer);
        clearTimeout(saveTimer);
        themeObserver.disconnect();
        root.removeEventListener('click', onClick);
        root.removeEventListener('change', onChange);
        root.removeEventListener('submit', onSubmit);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisible);
        document.documentElement.classList.remove('chart-full-open');
        chart?.destroy();
      };
    },
  };
}
