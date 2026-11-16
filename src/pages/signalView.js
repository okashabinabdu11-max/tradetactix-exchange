// Shared rendering of the signal engine's result, used by the dashboard, the
// Signals page and the Analysis page.

import { TIMEFRAMES, SIGNAL_STATES } from '../data/plan.js';
import { price, ratio, escapeHtml } from '../lib/format.js';

const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const DISCLAIMER = 'A rules-based reading of your plan from closed candles, not financial advice. Check it on the chart before acting. No order is placed.';

function rung(tf, check) {
  let status = 'No data';
  let cls = '';
  if (tf.optional) { status = 'Not checked automatically. Confirm on the chart.'; }
  else if (check) {
    status = escapeHtml(check.text);
    cls = check.ok === true ? 'is-ok' : check.ok === false ? 'is-fail' : '';
  } else if (check === null) { status = 'Not reached'; }
  const mark = cls === 'is-ok' ? 'Passed: ' : cls === 'is-fail' ? 'Not yet: ' : '';
  return `
    <li class="rung ${cls}">
      <span class="rung-tf">${tf.tf}</span>
      <div class="rung-body">
        <h3>${tf.job}${tf.optional ? ' <span class="tag">Optional</span>' : ''}</h3>
        <p>${tf.how}</p>
      </div>
      <span class="rung-status">${mark}${status}</span>
    </li>`;
}

export function verdictMarkup(signal) {
  const loading = !signal;
  const state = SIGNAL_STATES.find((s) => s.id === (signal?.state || 'offline'));
  const label = loading ? 'Checking' : state.label;
  const reason = loading ? 'Reading the 4H, 1H and 15M candles…' : escapeHtml(signal.reason || state.meaning);
  const isTrade = signal && (signal.state === 'buy' || signal.state === 'sell');
  const checks = signal?.checks || {};
  const keys = ['h4', 'h1', 'm15', null];

  const trade = isTrade ? `
    <dl class="signal-levels">
      <div><dt>Entry</dt><dd>${price(signal.entry)}</dd></div>
      <div><dt>Stop-loss</dt><dd>${price(signal.stop)}</dd></div>
      <div><dt>Take-profit</dt><dd>${price(signal.target)}</dd></div>
      <div><dt>Reward-to-risk</dt><dd>${ratio(Math.floor(signal.rr * 10) / 10)}</dd></div>
    </dl>
    <p class="signal-basis">Entry is the close of the confirming 15M candle at ${time(signal.confirmedAt)}. Target: ${escapeHtml(signal.targetBasis)}. If price has already moved away from the entry, the signal is no longer valid.</p>
    <a class="button button-primary" href="#/risk">Size this trade</a>` : '';

  return `
    <div class="verdict-head">
      <p class="panel-kicker">Signal engine</p>
      <p class="verdict-state ${label.length > 8 ? 'is-long' : ''} tone-${loading ? 'muted' : state.tone}" id="verdict-state">${label}</p>
      <p class="verdict-meaning" id="verdict-reason">${reason}</p>
      ${trade}
    </div>
    <ol class="ladder" aria-label="Timeframe checks, from highest to lowest">
      ${TIMEFRAMES.map((tf, i) => rung(tf, loading ? undefined : keys[i] ? checks[keys[i]] : undefined)).join('')}
    </ol>
    <p class="verdict-foot">${signal?.readAt ? `Read at ${time(signal.readAt)}. ` : ''}${DISCLAIMER}</p>`;
}

export function levelsMarkup(signal) {
  if (!signal || !signal.levels) return '';
  const rows = [...signal.levels].sort((a, b) => b.price - a.price).map((l) => {
    const diff = l.price - signal.price;
    return `<tr><td>${diff > 0 ? 'Resistance' : 'Support'}</td><td class="num">${price(l.price)}</td><td class="num">${l.touches}</td><td class="num">${diff > 0 ? '+' : '−'}${price(Math.abs(diff))}</td></tr>`;
  }).join('');
  const liq = signal.liquidity || {};
  return `
    <section class="panel">
      <h2 class="panel-title">4H levels</h2>
      ${rows ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th scope="col">Role now</th><th scope="col" class="num">Level</th><th scope="col" class="num">Turns</th><th scope="col" class="num">From price</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="result-empty">No price has turned the 4H line chart twice in the last 25 days of candles.</p>'}
      <p class="panel-note">A level is a price where the 4H closing line turned at least twice. Price now: ${price(signal.price)}.</p>
    </section>
    <section class="panel">
      <h2 class="panel-title">1H liquidity</h2>
      <dl class="quote quote-two">
        <div><dt>Swing high</dt><dd>${liq.high ? price(liq.high.price) : '<span class="empty-value">—</span>'}</dd></div>
        <div><dt>Swing low</dt><dd>${liq.low ? price(liq.low.price) : '<span class="empty-value">—</span>'}</dd></div>
      </dl>
      <p class="panel-note">The most recent 1H swing high and low that formed before the last four hours. Stops tend to rest just beyond them.</p>
    </section>`;
}
