import { session } from '../state/session.js';
import { listTrades, saveTrade, deleteTrade } from '../services/backend.js';
import { isSupabaseConfigured } from '../config.js';
import { tradeMetrics, summarize, dailyResults, monthGrid, validateTrade, localDateKey, equityCurve, winRateWindows } from '../lib/journal.js';
import { MIN_REWARD_TO_RISK } from '../lib/risk.js';
import { usd, price, ratio, escapeHtml } from '../lib/format.js';
import { STAGE_OF } from '../data/plan.js';
import { t as tr } from '../lib/i18n.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${usd(Math.abs(n))}`;
export const signedR = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}R`;
export const tone = (n) => (n > 0 ? 'is-profit' : n < 0 ? 'is-loss' : '');
const compact = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}k` : Math.abs(n) < 10 ? Math.abs(n).toFixed(1) : Math.round(Math.abs(n))}`;

const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let curveCount = 0;
// Thin line fading from purple (left) to blue (right), no fill or dots.
export function curveSvg(points) {
  const W = 640; const H = 220; const padX = 6; const padY = 16;
  const values = [0, ...points.map((p) => p.total)];
  const min = Math.min(...values); const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => padX + (i / (values.length - 1)) * (W - padX * 2);
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const gid = `curve-grad-${(curveCount += 1)}`; // unique per chart on the page
  return `
    <svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running total of closed trades, ending at ${signed(last)}">
      <defs>
        <linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${padX}" y1="0" x2="${W - padX}" y2="0">
          <stop offset="0" stop-color="#8a3ce6" /><stop offset="1" stop-color="#4a90e2" />
        </linearGradient>
      </defs>
      <line class="curve-zero" x1="${padX}" x2="${W - padX}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" />
      <polyline class="curve-line" points="${line}" stroke="url(#${gid})" />
    </svg>`;
}

// Journal performance: the running total of closed trades and the win rate over time.
export function performanceMarkup(trades, minRR) {
  const curve = equityCurve(trades);
  if (!curve.points.length) {
    return `<section class="panel perf"><h2 class="panel-title">${tr('Performance')}</h2><p class="result-empty">${tr('Your chart and win rate appear here after your first closed trade.')}</p></section>`;
  }
  const last = curve.points[curve.points.length - 1].total;
  const windows = winRateWindows(trades, minRR);
  const card = (w) => {
    const rate = w.winRate === null ? null : Math.round(w.winRate);
    return `
      <div class="wr-card">
        <p class="wr-label">${tr(w.label)}</p>
        ${rate === null ? `<p class="wr-rate is-empty">—</p><p class="wr-sub">${tr('No closed trades')}</p>` : `
          <p class="wr-rate">${rate}%</p>
          <div class="wr-bar" role="img" aria-label="${w.wins} won, ${w.losses} lost${w.breakeven ? `, ${w.breakeven} flat` : ''}">
            <span class="wr-win" style="width:${(w.wins / w.closed) * 100}%"></span><span class="wr-flat" style="width:${(w.breakeven / w.closed) * 100}%"></span><span class="wr-loss" style="width:${(w.losses / w.closed) * 100}%"></span>
          </div>
          <p class="wr-sub">${w.wins} ${tr('won')} · ${w.losses} ${tr('lost')}${w.breakeven ? ` · ${w.breakeven} ${tr('flat')}` : ''}</p>
          <p class="wr-sub ${tone(w.netPnl)}">${signed(w.netPnl)}</p>`}
      </div>`;
  };
  return `
    <section class="panel perf" aria-labelledby="perf-title">
      <h2 class="panel-title" id="perf-title">${tr('Performance')}</h2>
      <p class="perf-total">${tr('Running total')} <strong class="${tone(last)}">${signed(last)}</strong></p>
      ${curveSvg(curve.points)}
      <p class="panel-note">${tr('Each point is a closed trade. The dashed line is $0. Deepest fall from a peak:')} ${usd(curve.maxDrawdown)}.</p>
      <h3 class="perf-sub">${tr('Win rate')}</h3>
      <div class="wr-grid">${windows.map(card).join('')}</div>
      <a class="text-link" href="#/analytics">${tr('Full analytics')}</a>
    </section>`;
}

export function statsMarkup(s) {
  const stat = (label, value, sub = '', cls = '') => `<div class="stat"><dt>${label}</dt><dd class="${cls}">${value}</dd>${sub ? `<dd class="sub">${sub}</dd>` : ''}</div>`;
  const none = '<span class="empty-value">—</span>';
  return `
    <dl class="panel stats" aria-label="Journal summary">
      ${stat('Net P&amp;L', s.closed ? signed(s.netPnl) : none, `${s.closed} closed, ${s.open} open`, s.closed ? tone(s.netPnl) : '')}
      ${stat('Win rate', s.winRate === null ? none : `${s.winRate.toFixed(0)}%`, s.closed ? `${s.wins} won, ${s.losses} lost${s.breakeven ? `, ${s.breakeven} flat` : ''}` : '')}
      ${stat('Profit factor', s.profitFactor === null ? none : s.profitFactor.toFixed(2), s.closed && s.profitFactor === null ? 'Needs a losing trade' : '')}
      ${stat('Average R', s.averageR === null ? none : signedR(s.averageR), '', s.averageR === null ? '' : tone(s.averageR))}
      ${stat('Plan followed', s.planFollowedRate === null ? none : `${s.planFollowedRate.toFixed(0)}%`, s.total ? `of ${s.total} trades` : '')}
    </dl>`;
}

export function calendarMarkup(trades, view) {
  const days = dailyResults(trades);
  const today = localDateKey(new Date());
  const monthKey = `${view.year}-${pad(view.month + 1)}`;
  let monthPnl = 0;
  let monthCount = 0;
  days.forEach((d, key) => { if (key.startsWith(monthKey)) { monthPnl += d.pnl; monthCount += d.count; } });

  return `
    <section class="panel calendar" aria-labelledby="cal-title">
      <div class="cal-head">
        <button class="icon-button" type="button" data-action="prev-month" aria-label="Previous month">‹</button>
        <h2 id="cal-title">${MONTHS[view.month]} ${view.year}</h2>
        <button class="icon-button" type="button" data-action="next-month" aria-label="Next month">›</button>
        <span class="cal-total ${monthCount ? tone(monthPnl) : ''}">${monthCount ? `${signed(monthPnl)} in ${monthCount} trade${monthCount === 1 ? '' : 's'}` : 'No closed trades'}</span>
      </div>
      <div class="cal-grid" role="grid" aria-labelledby="cal-title">
        ${WEEKDAYS.map((d) => `<span class="cal-weekday" role="columnheader">${d}</span>`).join('')}
        ${monthGrid(view.year, view.month).flat().map((cell) => {
          if (!cell) return '<span class="cal-cell is-blank"></span>';
          const d = days.get(cell.key);
          const cls = d ? tone(d.pnl) || 'is-flat' : '';
          const label = d ? `${cell.day} ${MONTHS[view.month]}: ${signed(d.pnl)}, ${d.count} trade${d.count === 1 ? '' : 's'}` : `${cell.day} ${MONTHS[view.month]}: no trades`;
          return `<span class="cal-cell ${cls} ${cell.key === today ? 'is-today' : ''}" role="gridcell" aria-label="${label}"><span class="cal-day">${cell.day}</span>${d ? `<span class="cal-pnl">${compact(d.pnl)}</span><span class="cal-count">${d.count}</span>` : ''}</span>`;
        }).join('')}
      </div>
    </section>`;
}

function formMarkup(trade) {
  const t = trade || {};
  const val = (v) => (v === null || v === undefined ? '' : escapeHtml(v));
  const numField = (id, label, value, hint = '', extra = '') => `
    <label class="field" for="t-${id}">
      <span class="field-label">${label}</span>
      <input id="t-${id}" name="${id}" type="number" inputmode="decimal" step="any" autocomplete="off" value="${val(value)}" ${extra} />
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
    </label>`;
  const timeField = (id, label, value, hint = '') => `
    <label class="field" for="t-${id}">
      <span class="field-label">${label}</span>
      <input id="t-${id}" name="${id}" type="datetime-local" value="${toLocalInput(value)}" />
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
    </label>`;
  const check = (id, label, on) => `<label class="check"><input type="checkbox" name="${id}" ${on ? 'checked' : ''} /><span>${label}</span></label>`;
  const sell = t.direction === 'sell';

  return `
    <form class="panel trade-form" id="trade-form" novalidate>
      <h2 class="panel-title">${trade ? 'Edit trade' : 'Log a trade'}</h2>
      <fieldset class="direction">
        <legend class="field-label">Direction</legend>
        <label><input type="radio" name="direction" value="buy" ${sell ? '' : 'checked'} /><span class="dir dir-buy">Buy</span></label>
        <label><input type="radio" name="direction" value="sell" ${sell ? 'checked' : ''} /><span class="dir dir-sell">Sell</span></label>
      </fieldset>
      <div class="field-row">
        ${timeField('openedAt', 'Opened', t.openedAt || new Date().toISOString())}
        ${numField('lots', 'Size (lots)', t.lots, '', 'min="0"')}
      </div>
      <div class="field-row field-row-3">
        ${numField('entryPrice', 'Entry price', t.entryPrice, '', 'min="0"')}
        ${numField('stopLoss', 'Stop-loss', t.stopLoss, '', 'min="0"')}
        ${numField('takeProfit', 'Take-profit', t.takeProfit, '', 'min="0"')}
      </div>
      <fieldset class="checks">
        <legend class="field-label">Which checks did this trade pass?</legend>
        ${check('level4h', '4H support or resistance level', t.level4h)}
        ${check('liquidity1h', '1H liquidity high or low', t.liquidity1h)}
        ${check('retest15m', '15M retest and confirmation', t.retest15m)}
        ${check('confirm5m', '5M extra confirmation (optional)', t.confirm5m)}
      </fieldset>
      <fieldset class="closing">
        <legend class="field-label">Closing the trade</legend>
        <p class="field-hint">Leave these empty while the trade is still open. Or tap how it ended:</p>
        <div class="close-quick" role="group" aria-label="How the trade ended">
          <button class="button button-quiet close-tp" type="button" data-action="close-tp">${tr('TP hit')}</button>
          <button class="button button-quiet close-sl" type="button" data-action="close-sl">${tr('SL hit')}</button>
          <button class="button button-quiet close-be" type="button" data-action="close-be">${tr('Breakeven')}</button>
        </div>
        <p class="field-hint" id="close-quick-status" role="status"></p>
        <div class="field-row field-row-3">
          ${timeField('closedAt', 'Closed', t.closedAt)}
          ${numField('exitPrice', 'Exit price', t.exitPrice, '', 'min="0"')}
          ${numField('pnl', 'Net result in USD', t.pnl, 'Optional. Copy it from MT5 to include commission and swap.')}
        </div>
      </fieldset>
      <label class="field" for="t-notes">
        <span class="field-label">Notes</span>
        <textarea id="t-notes" name="notes" rows="3" maxlength="4000">${val(t.notes)}</textarea>
      </label>
      <div class="form-actions">
        <button class="button button-primary" type="submit">Save trade</button>
        <button class="button button-quiet" type="button" data-action="cancel-form">Cancel</button>
        <span id="trade-status" class="form-status" role="status"></span>
      </div>
    </form>`;
}

// How a closed trade ended, when its exit matches the take-profit, stop-loss or entry.
function outcomeBadge(t) {
  if (t.exitPrice == null || !t.closedAt) return '';
  const same = (a, b) => a != null && Math.abs(Number(a) - Number(b)) < 1e-6;
  if (same(t.takeProfit, t.exitPrice)) return '<span class="badge badge-tp">TP hit</span>';
  if (same(t.stopLoss, t.exitPrice)) return '<span class="badge badge-sl">SL hit</span>';
  if (same(t.entryPrice, t.exitPrice)) return '<span class="badge badge-be">Breakeven</span>';
  return '';
}

function tradeMarkup(t, minRR, confirmingDelete) {
  const m = tradeMetrics(t, minRR);
  const result = m.closed
    ? `<span class="trade-pnl ${tone(m.pnl)}">${signed(m.pnl)}</span>`
    : '<span class="trade-pnl is-open">Open</span>';
  const facts = [
    `${price(t.entryPrice)} to ${m.closed ? price(t.exitPrice) : '…'}`,
    `${t.lots.toFixed(2)} lot`,
    m.rMultiple !== null ? signedR(m.rMultiple) : m.plannedRR !== null ? `planned ${ratio(m.plannedRR)}` : '',
  ].filter(Boolean);
  const planBadge = m.followedPlan
    ? '<span class="badge badge-ok">Plan followed</span>'
    : m.offPlan.map((r) => `<span class="badge badge-warn">${escapeHtml(r)}</span>`).join('');

  return `
    <li class="trade" data-id="${escapeHtml(t.id)}">
      <div class="trade-top">
        <span class="trade-dir dir-text-${t.direction}">${t.direction === 'buy' ? 'Buy' : 'Sell'}</span>
        <span class="trade-when">${when(t.openedAt)}</span>
        ${result}
      </div>
      <p class="trade-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</p>
      <div class="trade-badges">${outcomeBadge(t)}${planBadge}${t.confirm5m ? '<span class="badge">5M confirmed</span>' : ''}</div>
      ${t.notes ? `<p class="trade-notes">${escapeHtml(t.notes)}</p>` : ''}
      <div class="trade-actions">
        <button class="link-button" type="button" data-action="edit" data-id="${escapeHtml(t.id)}">${m.closed ? 'Edit' : 'Edit or close'}</button>
        ${confirmingDelete
          ? `<button class="link-button is-danger" type="button" data-action="confirm-delete" data-id="${escapeHtml(t.id)}">Confirm delete</button><button class="link-button" type="button" data-action="cancel-delete">Keep</button>`
          : `<button class="link-button" type="button" data-action="delete" data-id="${escapeHtml(t.id)}">Delete</button>`}
      </div>
    </li>`;
}

export function journalPage() {
  const { ready, user, riskSettings } = session.get();
  const head = `
    <header class="page-head">
      <h1>Journal</h1>
      <p>Your real trades, logged by you for now. From Stage ${STAGE_OF.mt5} they are imported from MT5 automatically.</p>
    </header>`;

  if (!isSupabaseConfigured || !ready || !user) {
    const text = !isSupabaseConfigured
      ? 'The database is not set up, so the journal is unavailable.'
      : !ready ? 'Checking sign-in…' : 'Open your account to keep a journal. Your trades are stored in your account and only you can read them.';
    return {
      title: 'Journal',
      html: `${head}<section class="panel limits"><p class="result-empty">${text}</p>${isSupabaseConfigured && ready ? '<a class="button button-quiet" href="#/home">Open Account</a>' : ''}</section>`,
    };
  }

  const minRR = riskSettings?.minRewardToRisk ?? MIN_REWARD_TO_RISK;

  return {
    title: 'Journal',
    html: `${head}<div id="journal"><p class="result-empty">Loading trades…</p></div>`,
    mount(root) {
      const box = root.querySelector('#journal');
      const now = new Date();
      const ui = {
        trades: [],
        view: { year: now.getFullYear(), month: now.getMonth() },
        editing: null, // null, 'new' or a trade id
        deleting: null,
        error: null,
        missingTable: false,
        alive: true,
      };

      const draw = () => {
        if (!ui.alive) return;
        if (ui.error) {
          box.innerHTML = `
            <section class="panel limits">
              <ul class="result-errors"><li>${escapeHtml(ui.error)}</li></ul>
              ${ui.missingTable ? '<p class="panel-note">Run the journal database script in Supabase, then reload this page.</p>' : '<button class="button button-quiet" type="button" data-action="reload">Try again</button>'}
            </section>`;
          return;
        }
        const editingTrade = ui.editing && ui.editing !== 'new' ? ui.trades.find((t) => t.id === ui.editing) : null;
        box.innerHTML = `
          ${statsMarkup(summarize(ui.trades, minRR))}
          ${performanceMarkup(ui.trades, minRR)}
          ${calendarMarkup(ui.trades, ui.view)}
          ${ui.editing ? formMarkup(editingTrade) : '<button class="button button-primary log-button" type="button" data-action="new">Log a trade</button>'}
          <section class="panel trades" aria-labelledby="trades-title">
            <h2 id="trades-title" class="panel-title">Trades</h2>
            ${ui.trades.length
              ? `<ul class="trade-list">${ui.trades.map((t) => tradeMarkup(t, minRR, ui.deleting === t.id)).join('')}</ul>`
              : '<p class="result-empty">No trades yet. Log your first trade to start the statistics and the calendar.</p>'}
          </section>`;
      };

      const load = async () => {
        const res = await listTrades();
        if (res.ok) { ui.trades = res.trades; ui.error = null; }
        else { ui.error = res.message; ui.missingTable = Boolean(res.missingTable); }
        draw();
      };

      const onClick = async (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const { action, id } = el.dataset;
        if (action === 'close-tp' || action === 'close-sl' || action === 'close-be') {
          // Fills the exit price from the take-profit, stop-loss or entry, and the closing time if empty.
          const f = root.querySelector('#trade-form');
          const from = { 'close-tp': ['#t-takeProfit', 'take-profit'], 'close-sl': ['#t-stopLoss', 'stop-loss'], 'close-be': ['#t-entryPrice', 'entry price'] }[action];
          const value = f.querySelector(from[0]).value;
          const note = f.querySelector('#close-quick-status');
          if (!value) { note.textContent = `Enter the ${from[1]} first.`; note.className = 'field-hint is-error'; return; }
          f.querySelector('#t-exitPrice').value = value;
          const closed = f.querySelector('#t-closedAt');
          if (!closed.value) { const d = new Date(); d.setSeconds(0, 0); closed.value = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); }
          note.textContent = `Exit price set to ${value}. Check the closing time, then save.`; note.className = 'field-hint';
          return;
        }
        if (action === 'prev-month' || action === 'next-month') {
          const d = new Date(ui.view.year, ui.view.month + (action === 'next-month' ? 1 : -1), 1);
          ui.view = { year: d.getFullYear(), month: d.getMonth() };
          const keepForm = ui.editing; // do not wipe a half-filled form
          if (keepForm) { box.querySelector('.calendar').outerHTML = calendarMarkup(ui.trades, ui.view); return; }
        } else if (action === 'new') { ui.editing = 'new'; ui.deleting = null; }
        else if (action === 'edit') { ui.editing = id; ui.deleting = null; }
        else if (action === 'cancel-form') ui.editing = null;
        else if (action === 'delete') { if (ui.editing) return; ui.deleting = id; }
        else if (action === 'cancel-delete') ui.deleting = null;
        else if (action === 'reload') { box.innerHTML = '<p class="result-empty">Loading trades…</p>'; await load(); return; }
        else if (action === 'confirm-delete') {
          el.disabled = true;
          const res = await deleteTrade(id);
          ui.deleting = null;
          if (res.ok) ui.trades = ui.trades.filter((t) => t.id !== id);
          else { ui.error = res.message; ui.missingTable = Boolean(res.missingTable); }
        }
        draw();
        if (action === 'new' || action === 'edit') box.querySelector('#trade-form')?.scrollIntoView({ block: 'start' });
      };

      const onSubmit = async (e) => {
        if (e.target.id !== 'trade-form') return;
        e.preventDefault();
        const f = e.target.elements;
        const status = box.querySelector('#trade-status');
        const setStatus = (text, cls = '') => { status.textContent = text; status.className = `form-status ${cls}`; };
        const check = validateTrade({
          direction: f.direction.value,
          openedAt: f.openedAt.value,
          closedAt: f.closedAt.value,
          entryPrice: f.entryPrice.value,
          stopLoss: f.stopLoss.value,
          takeProfit: f.takeProfit.value,
          exitPrice: f.exitPrice.value,
          lots: f.lots.value,
          pnl: f.pnl.value,
          level4h: f.level4h.checked,
          liquidity1h: f.liquidity1h.checked,
          retest15m: f.retest15m.checked,
          confirm5m: f.confirm5m.checked,
          notes: f.notes.value,
        });
        if (!check.ok) { setStatus(check.errors[0], 'is-error'); return; }
        const button = e.target.querySelector('button[type="submit"]');
        button.disabled = true;
        setStatus('Saving…');
        const id = ui.editing === 'new' ? null : ui.editing;
        const res = await saveTrade(check.values, id);
        if (!ui.alive) return;
        if (!res.ok) { button.disabled = false; setStatus(`Not saved. ${res.message}`, 'is-error'); return; }
        ui.trades = (id ? ui.trades.map((t) => (t.id === id ? res.trade : t)) : [res.trade, ...ui.trades])
          .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
        ui.editing = null;
        // Show the month the trade landed in.
        const shown = new Date(res.trade.closedAt || res.trade.openedAt);
        ui.view = { year: shown.getFullYear(), month: shown.getMonth() };
        draw();
      };

      box.addEventListener('click', onClick);
      box.addEventListener('submit', onSubmit);
      load();
      return () => { ui.alive = false; };
    },
  };
}
