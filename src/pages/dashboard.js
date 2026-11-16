import { TIMEFRAMES, SIGNAL_STATES, CURRENT_STAGE, STAGES, STAGE_OF } from '../data/plan.js';
import { appConfig, isSupabaseConfigured } from '../config.js';
import { MIN_REWARD_TO_RISK } from '../lib/risk.js';
import { sessionStatus } from '../lib/sessions.js';
import { icon } from '../ui/icons.js';
import { session } from '../state/session.js';
import { ratio } from '../lib/format.js';
import { listTrades } from '../services/backend.js';
import { localDateKey } from '../lib/journal.js';

function databaseStatus() {
  if (!isSupabaseConfigured) return { on: false, text: 'Not set up' };
  const { ready, user } = session.get();
  if (!ready) return { on: false, text: 'Checking…' };
  return user ? { on: true, text: 'Signed in' } : { on: false, text: 'Not signed in' };
}

// Until a price feed exists there is nothing to analyse, so the engine can only ever be offline.
const currentState = 'offline';

function verdictPanel() {
  const state = SIGNAL_STATES.find((s) => s.id === currentState);
  return `
    <section class="panel verdict" aria-labelledby="verdict-title">
      <div class="verdict-head">
        <p class="panel-kicker">Signal engine</p>
        <h1 id="verdict-title" class="verdict-state tone-${state.tone}">${state.label}</h1>
        <p class="verdict-meaning">${state.meaning} Real-time XAUUSD data is added in Stage ${STAGE_OF.data} and the signal engine in Stage ${STAGE_OF.signals}.</p>
      </div>

      <ol class="ladder" aria-label="Timeframe checks, from highest to lowest">
        ${TIMEFRAMES.map((t) => `
          <li class="rung">
            <span class="rung-tf">${t.tf}</span>
            <div class="rung-body">
              <h3>${t.job}${t.optional ? ' <span class="tag">Optional</span>' : ''}</h3>
              <p>${t.how}</p>
            </div>
            <span class="rung-status">No data</span>
          </li>`).join('')}
      </ol>

      <details class="states">
        <summary>The five states this panel can show</summary>
        <dl>
          ${SIGNAL_STATES.map((s) => `<div><dt class="tone-${s.tone}">${s.label}</dt><dd>${s.meaning}</dd></div>`).join('')}
        </dl>
      </details>
    </section>`;
}

function pricePanel() {
  return `
    <section class="panel price" aria-labelledby="price-title">
      <h2 id="price-title" class="panel-title">XAUUSD price</h2>
      <dl class="quote">
        <div><dt>Bid</dt><dd class="empty-value">—</dd></div>
        <div><dt>Ask</dt><dd class="empty-value">—</dd></div>
        <div><dt>Spread</dt><dd class="empty-value">—</dd></div>
      </dl>
      <p class="panel-note">No price feed is connected yet. This panel stays empty until a real feed is added in Stage ${STAGE_OF.data}. It never shows sample prices.</p>
    </section>`;
}

function sessionsMarkup() {
  const status = sessionStatus(new Date());
  const headline = !status.marketOpen
    ? 'Gold market is closed'
    : status.overlap
      ? `${status.overlap} overlap`
      : status.sessions.some((s) => s.open)
        ? `${status.sessions.find((s) => s.open).name} session`
        : 'Between sessions';
  return `
    <p class="session-headline">${headline}</p>
    <ul class="session-list">
      ${status.sessions.map((s) => `
        <li class="${s.open ? 'is-open' : ''}">
          <span class="dot" aria-hidden="true"></span>
          <span class="session-name">${s.name}</span>
          <span class="session-time">${s.localTime}</span>
          <span class="session-state">${s.open ? 'Open' : 'Closed'}</span>
        </li>`).join('')}
    </ul>`;
}

function sessionsPanel() {
  return `
    <section class="panel" aria-labelledby="sessions-title">
      <h2 id="sessions-title" class="panel-title">Trading sessions</h2>
      <div id="sessions-live">${sessionsMarkup()}</div>
      <p class="panel-note">From your device clock, using typical session hours. Exness's exact hours come from MT5 in Stage ${STAGE_OF.mt5}.</p>
    </section>`;
}

function connectionRow(label, ok, okText, offText) {
  return `<li><span class="dot ${ok ? 'dot-on' : ''}" aria-hidden="true"></span><span>${label}</span><span class="conn-state">${ok ? okText : offText}</span></li>`;
}

function connectionsPanel() {
  return `
    <section class="panel" aria-labelledby="conn-title">
      <h2 id="conn-title" class="panel-title">Connections</h2>
      <ul class="conn-list">
        ${connectionRow('Market data', appConfig.marketDataConnected, 'Connected', 'Not connected')}
        ${connectionRow('Exness MT5', appConfig.brokerConnected, 'Connected', 'Not connected')}
        ${connectionRow('Database', databaseStatus().on, databaseStatus().text, databaseStatus().text)}
      </ul>
      <a class="text-link" href="#/system">See build progress</a>
    </section>`;
}

function riskPanel() {
  const { user, riskSettings } = session.get();
  const mine = user ? riskSettings : null;
  const minimum = ratio(mine?.minRewardToRisk ?? MIN_REWARD_TO_RISK);
  const limits = mine
    ? `<li><strong>${mine.riskPercent}% risk per trade</strong><span>At most ${mine.maxTradesPerDay} trades and ${mine.maxDailyLossPercent}% loss per day. Your saved limits.</span></li>`
    : '';
  return `
    <section class="panel" aria-labelledby="risk-title">
      <h2 id="risk-title" class="panel-title">Risk rules</h2>
      <ul class="rule-list">
        <li><strong>${minimum} minimum</strong><span>A trade must target at least ${mine?.minRewardToRisk ?? MIN_REWARD_TO_RISK} times what it risks.</span></li>
        ${limits}
        <li><strong>Live trading locked</strong><span>${icon('lock', 14)} No order can be sent from this app.</span></li>
      </ul>
      <a class="button button-quiet" href="#/risk">Open risk calculator</a>
    </section>`;
}

function accountPanel() {
  return `
    <section class="panel" aria-labelledby="acct-title">
      <h2 id="acct-title" class="panel-title">Account and journal</h2>
      <dl class="quote quote-two">
        <div><dt>Balance</dt><dd class="empty-value">—</dd></div>
        <div><dt>Trades logged today</dt><dd class="empty-value" id="trades-today">—</dd></div>
      </dl>
      <p class="panel-note">Your balance and automatic trade import arrive with the Exness MT5 connection in Stage ${STAGE_OF.mt5}. Until then, log trades yourself in the journal.</p>
      <a class="text-link" href="#/journal">Open journal</a>
    </section>`;
}

export function dashboardPage() {
  return {
    title: 'Dashboard',
    html: `
      <div class="dash">
        <div class="dash-main">${verdictPanel()}</div>
        <div class="dash-side">
          ${pricePanel()}
          ${sessionsPanel()}
          ${riskPanel()}
          ${connectionsPanel()}
          ${accountPanel()}
        </div>
      </div>
      <p class="stage-footnote">Stage ${CURRENT_STAGE} of ${STAGES.length}. No market, broker or signal data is live yet.</p>`,
    mount(root) {
      const live = root.querySelector('#sessions-live');
      const timer = setInterval(() => { live.innerHTML = sessionsMarkup(); }, 30000);
      let alive = true;
      // A real count from the user's own journal; it stays empty when signed out.
      if (session.get().user) {
        listTrades().then((res) => {
          const cell = root.querySelector('#trades-today');
          if (!alive || !res.ok || !cell) return;
          const today = localDateKey(new Date());
          cell.textContent = String(res.trades.filter((t) => localDateKey(t.openedAt) === today).length);
          cell.classList.remove('empty-value');
        });
      }
      return () => { alive = false; clearInterval(timer); };
    },
  };
}
