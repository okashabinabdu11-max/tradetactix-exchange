import { TIMEFRAMES, SIGNAL_STATES, CURRENT_STAGE } from '../data/plan.js';
import { appConfig, isSupabaseConfigured } from '../config.js';
import { MIN_REWARD_TO_RISK } from '../lib/risk.js';
import { sessionStatus } from '../lib/sessions.js';
import { icon } from '../ui/icons.js';

// Stage 1 has no data feed, so the engine can only ever be offline.
const currentState = 'offline';

function verdictPanel() {
  const state = SIGNAL_STATES.find((s) => s.id === currentState);
  return `
    <section class="panel verdict" aria-labelledby="verdict-title">
      <div class="verdict-head">
        <p class="panel-kicker">Signal engine</p>
        <h1 id="verdict-title" class="verdict-state tone-${state.tone}">${state.label}</h1>
        <p class="verdict-meaning">${state.meaning} Real-time XAUUSD data is added in Stage 3 and the signal engine in Stage 4.</p>
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
      <p class="panel-note">No price feed is connected yet. This panel stays empty until a real feed is added in Stage 3. It never shows sample prices.</p>
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
      <p class="panel-note">From your device clock, using typical session hours. Exness's exact hours come from MT5 in Stage 6.</p>
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
        ${connectionRow('Database', isSupabaseConfigured, 'Keys set', 'Not set up')}
      </ul>
      <a class="text-link" href="#/system">See build progress</a>
    </section>`;
}

function riskPanel() {
  return `
    <section class="panel" aria-labelledby="risk-title">
      <h2 id="risk-title" class="panel-title">Risk rules</h2>
      <ul class="rule-list">
        <li><strong>1:${MIN_REWARD_TO_RISK} minimum</strong><span>A trade must target at least three times what it risks.</span></li>
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
        <div><dt>Trades today</dt><dd class="empty-value">—</dd></div>
      </dl>
      <p class="panel-note">Your balance and trades appear after the Exness MT5 connection in Stage 6. Until then nothing is shown here.</p>
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
      <p class="stage-footnote">Stage ${CURRENT_STAGE} of 9: layout and risk tools. No market, account or signal data is live yet.</p>`,
    mount(root) {
      const live = root.querySelector('#sessions-live');
      const timer = setInterval(() => { live.innerHTML = sessionsMarkup(); }, 30000);
      return () => clearInterval(timer);
    },
  };
}
