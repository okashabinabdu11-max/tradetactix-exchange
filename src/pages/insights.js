// History, Analytics, Calendar and Discipline: four read-only views of the
// trades recorded in the journal.

import { session } from '../state/session.js';
import { listTrades } from '../services/backend.js';
import { isSupabaseConfigured } from '../config.js';
import { tradeMetrics, summarize, equityCurve, extremes, breakdown, disciplineReport, dailyResults } from '../lib/journal.js';
import { sessionStatus } from '../lib/sessions.js';
import { MIN_REWARD_TO_RISK } from '../lib/risk.js';
import { usd, price, escapeHtml } from '../lib/format.js';
import { signed, signedR, tone, statsMarkup, calendarMarkup, curveSvg } from './journal.js';
import { upgradePanel } from './signalView.js';

const none = '<span class="empty-value">—</span>';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dateTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const longDay = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function sessionLabel(trade) {
  const s = sessionStatus(new Date(trade.openedAt));
  if (s.overlap) return `${s.overlap} overlap`;
  const open = s.sessions.find((x) => x.open);
  return open ? open.name : 'Outside main sessions';
}

/** Shared frame: sign-in gate, loading, errors, then `render(ctx)` on every change. */
function tradesView({ title, intro, initial = {}, render, onAction }) {
  const { ready, user, riskSettings } = session.get();
  const head = `<header class="page-head"><h1>${title}</h1><p>${intro}</p></header>`;

  if (!isSupabaseConfigured || !ready || !user) {
    const text = !isSupabaseConfigured
      ? 'The database is not set up, so this page is unavailable.'
      : !ready ? 'Checking sign-in…' : `Open your account to see your ${title.toLowerCase()}. It is built from the trades in your journal.`;
    return {
      title,
      html: `${head}<section class="panel limits"><p class="result-empty">${text}</p>${isSupabaseConfigured && ready ? '<a class="button button-quiet" href="#/home">Open Account</a>' : ''}</section>`,
    };
  }

  // The advanced journal is a Pro feature. These pages only read the user's own
  // trades, so this is a product limit rather than a security boundary.
  if (session.get().entitlement && session.get().entitlement.advanced_journal === false) {
    return { title, html: `${head}${upgradePanel(title)}` };
  }

  return {
    title,
    html: `${head}<div id="view"><p class="result-empty">Loading trades…</p></div>`,
    mount(root) {
      const box = root.querySelector('#view');
      const ctx = {
        trades: [],
        minRR: riskSettings?.minRewardToRisk ?? MIN_REWARD_TO_RISK,
        maxTradesPerDay: riskSettings?.maxTradesPerDay ?? null,
        ui: { ...initial },
      };
      let alive = true;
      const draw = () => { if (alive) box.innerHTML = render(ctx); };

      listTrades().then((res) => {
        if (!alive) return;
        if (!res.ok) {
          box.innerHTML = `
            <section class="panel limits">
              <ul class="result-errors"><li>${escapeHtml(res.message)}</li></ul>
              ${res.missingTable ? '<p class="panel-note">Run the journal database script in Supabase, then reload this page.</p>' : ''}
            </section>`;
          return;
        }
        ctx.trades = res.trades;
        draw();
      });

      const handle = (e) => {
        const el = e.target.closest('[data-action]');
        if (!el || !onAction) return;
        if (e.type === 'change' && el.tagName !== 'SELECT') return;
        if (e.type === 'click' && el.tagName === 'SELECT') return;
        onAction(ctx, el.dataset.action, el);
        draw();
      };
      box.addEventListener('click', handle);
      box.addEventListener('change', handle);
      return () => { alive = false; };
    },
  };
}

const emptyJournal = (what) => `
  <section class="panel limits">
    <p class="result-empty">${what}</p>
    <a class="button button-quiet" href="#/journal">Open journal</a>
  </section>`;

// ---------- History ----------

export function historyPage() {
  return tradesView({
    title: 'History',
    intro: 'Every closed trade from your journal, newest first.',
    initial: { direction: 'all', result: 'all' },
    onAction(ctx, action, el) {
      if (action === 'filter-direction') ctx.ui.direction = el.value;
      if (action === 'filter-result') ctx.ui.result = el.value;
    },
    render({ trades, minRR, ui }) {
      const closed = trades
        .map((t) => ({ t, m: tradeMetrics(t, minRR) }))
        .filter((x) => x.m.closed)
        .sort((a, b) => new Date(b.t.closedAt) - new Date(a.t.closedAt));
      if (!closed.length) return emptyJournal('No closed trades yet. Close a trade in the journal and it appears here.');

      const shown = closed.filter((x) => (ui.direction === 'all' || x.t.direction === ui.direction) && (ui.result === 'all' || x.m.result === ui.result));
      const net = shown.reduce((a, x) => a + x.m.pnl, 0);
      const option = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;

      return `
        <section class="panel history">
          <div class="filters">
            <label class="field"><span class="field-label">Direction</span>
              <select data-action="filter-direction">${option('all', 'Buy and sell', ui.direction)}${option('buy', 'Buy only', ui.direction)}${option('sell', 'Sell only', ui.direction)}</select></label>
            <label class="field"><span class="field-label">Result</span>
              <select data-action="filter-result">${option('all', 'All results', ui.result)}${option('win', 'Wins', ui.result)}${option('loss', 'Losses', ui.result)}${option('breakeven', 'Breakeven', ui.result)}</select></label>
            <p class="filters-total" id="history-total">${plural(shown.length, 'trade')}${shown.length ? `, <span class="${tone(net)}">${signed(net)}</span>` : ''}</p>
          </div>
          ${shown.length ? `
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th scope="col">Closed</th><th scope="col">Market</th><th scope="col">Side</th><th scope="col" class="num">Lots</th><th scope="col" class="num">Entry</th><th scope="col" class="num">Exit</th><th scope="col" class="num">Net</th><th scope="col" class="num">R</th><th scope="col">Session</th><th scope="col">Plan</th></tr></thead>
              <tbody>
                ${shown.map(({ t, m }) => `
                  <tr>
                    <td>${dateTime(t.closedAt)}</td>
                    <td>${escapeHtml(t.symbol || 'XAUUSD')}</td>
                    <td class="dir-text-${t.direction}">${t.direction === 'buy' ? 'Buy' : 'Sell'}</td>
                    <td class="num">${t.lots.toFixed(2)}</td>
                    <td class="num">${price(t.entryPrice)}</td>
                    <td class="num">${price(t.exitPrice)}</td>
                    <td class="num ${tone(m.pnl)}">${signed(m.pnl)}</td>
                    <td class="num">${m.rMultiple === null ? '—' : signedR(m.rMultiple)}</td>
                    <td>${sessionLabel(t)}</td>
                    <td>${m.followedPlan ? 'Followed' : 'Off plan'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<p class="result-empty">No trades match these filters.</p>'}
        </section>`;
    },
  });
}

// ---------- Analytics ----------

function breakdownTable(title, rows) {
  if (!rows.length) return '';
  return `
    <section class="panel">
      <h2 class="panel-title">${title}</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th scope="col">Group</th><th scope="col" class="num">Trades</th><th scope="col" class="num">Win rate</th><th scope="col" class="num">Net</th></tr></thead>
          <tbody>${rows.sort((a, b) => b.pnl - a.pnl).map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.count}</td><td class="num">${r.winRate.toFixed(0)}%</td><td class="num ${tone(r.pnl)}">${signed(r.pnl)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`;
}

export function analyticsPage() {
  return tradesView({
    title: 'Analytics',
    intro: 'Performance worked out from the closed trades in your journal. Nothing here is estimated.',
    render({ trades, minRR }) {
      const s = summarize(trades, minRR);
      if (!s.closed) return emptyJournal('No closed trades yet. Analytics start with your first closed trade.');
      const curve = equityCurve(trades);
      const x = extremes(trades);
      const stat = (label, value, cls = '') => `<div class="stat"><dt>${label}</dt><dd class="${cls}">${value}</dd></div>`;
      return `
        ${statsMarkup(s)}
        <section class="panel">
          <h2 class="panel-title">Running total</h2>
          ${curveSvg(curve.points)}
          <p class="panel-note">From $0.00 to <span class="${tone(s.netPnl)}">${signed(s.netPnl)}</span> over ${plural(s.closed, 'closed trade')}. The dashed line is zero. Deepest fall from a peak: ${usd(curve.maxDrawdown)}.</p>
        </section>
        <dl class="panel stats" aria-label="Trade sizes">
          ${stat('Average win', s.averageWin === null ? none : signed(s.averageWin), s.averageWin === null ? '' : 'is-profit')}
          ${stat('Average loss', s.averageLoss === null ? none : signed(s.averageLoss), s.averageLoss === null ? '' : 'is-loss')}
          ${stat('Best trade', signed(x.best), tone(x.best))}
          ${stat('Worst trade', signed(x.worst), tone(x.worst))}
          ${stat('Average per trade', signed(x.expectancy), tone(x.expectancy))}
        </dl>
        <div class="insight-grid">
          ${breakdownTable('By session opened in', breakdown(trades, (t) => sessionLabel(t)))}
          ${breakdownTable('By market', breakdown(trades, (t) => t.symbol || 'XAUUSD'))}
          ${breakdownTable('By direction', breakdown(trades, (t) => (t.direction === 'buy' ? 'Buy' : 'Sell')))}
          ${breakdownTable('Plan followed or not', breakdown(trades, (t) => (tradeMetrics(t, minRR).followedPlan ? 'Plan followed' : 'Off plan')))}
        </div>`;
    },
  });
}

// ---------- Calendar ----------

export function calendarPage() {
  const now = new Date();
  return tradesView({
    title: 'Calendar',
    intro: 'Your result for each trading day, by the day the trade closed.',
    initial: { year: now.getFullYear(), month: now.getMonth() },
    onAction(ctx, action) {
      if (action !== 'prev-month' && action !== 'next-month') return;
      const d = new Date(ctx.ui.year, ctx.ui.month + (action === 'next-month' ? 1 : -1), 1);
      ctx.ui.year = d.getFullYear();
      ctx.ui.month = d.getMonth();
    },
    render({ trades, ui }) {
      const prefix = `${ui.year}-${String(ui.month + 1).padStart(2, '0')}`;
      const days = [...dailyResults(trades).entries()].filter(([key]) => key.startsWith(prefix)).sort((a, b) => (a[0] < b[0] ? 1 : -1));
      return `
        ${calendarMarkup(trades, ui)}
        <section class="panel">
          <h2 class="panel-title">Days traded this month</h2>
          ${days.length
            ? `<ul class="day-list">${days.map(([key, d]) => `<li><span>${longDay(key)}</span><span class="day-count">${plural(d.count, 'trade')}</span><span class="day-pnl ${tone(d.pnl)}">${signed(d.pnl)}</span></li>`).join('')}</ul>`
            : '<p class="result-empty">No trades closed in this month.</p>'}
        </section>`;
    },
  });
}

// ---------- Discipline ----------

export function disciplinePage() {
  return tradesView({
    title: 'Discipline',
    intro: 'How closely your logged trades followed your own plan and limits.',
    render({ trades, minRR, maxTradesPerDay }) {
      if (!trades.length) return emptyJournal('No trades yet. Discipline is measured from the checks you tick when logging a trade.');
      const r = disciplineReport(trades, { minRewardToRisk: minRR, maxTradesPerDay });
      return `
        <section class="panel score">
          <p class="panel-kicker">Rules kept</p>
          <p class="score-value">${r.score.toFixed(0)}%</p>
          <p class="panel-note">${r.fullyOnPlan} of ${plural(r.total, 'trade')} kept every rule.</p>
        </section>
        <section class="panel">
          <h2 class="panel-title">Rule by rule</h2>
          <ul class="rule-bars">
            ${r.rules.map((rule) => `
              <li>
                <div class="rule-bar-head"><span>${escapeHtml(rule.label)}</span><span>${rule.passed} of ${rule.total}</span></div>
                <div class="bar" role="img" aria-label="${rule.rate.toFixed(0)}%"><span style="width:${rule.rate.toFixed(1)}%"></span></div>
              </li>`).join('')}
          </ul>
          <p class="panel-note">${maxTradesPerDay ? '' : 'Save a trades-per-day limit on the Risk page to track it here. '}The daily loss limit is checked once your balance comes from MT5.</p>
        </section>
        ${r.overDays.length ? `
        <section class="panel">
          <h2 class="panel-title">Days over your ${plural(maxTradesPerDay, 'trade')} limit</h2>
          <ul class="day-list">${r.overDays.map((d) => `<li><span>${longDay(d.key)}</span><span class="day-pnl is-loss">${plural(d.count, 'trade')}</span></li>`).join('')}</ul>
        </section>` : ''}`;
    },
  });
}
