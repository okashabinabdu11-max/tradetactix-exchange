// Shared rendering of the signal the server sent. The server has already
// removed whatever the viewer's plan does not include, so this file only
// draws what it is given and never fills gaps.

import { TIMEFRAMES, SIGNAL_STATES } from '../data/plan.js';
import { price, ratio, escapeHtml } from '../lib/format.js';

const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const DISCLAIMER = 'A rules-based reading of the plan from closed candles, not financial advice. Check it on the chart before acting. No order is placed.';

function rung(tf, check) {
  let status = 'No data';
  let cls = '';
  if (tf.optional) { status = 'Not checked automatically. Confirm on the chart.'; }
  else if (check) {
    cls = check.ok === true ? 'is-ok' : check.ok === false ? 'is-fail' : '';
    const word = check.ok === true ? 'Passed' : check.ok === false ? 'Not yet' : '';
    status = check.text ? `${word ? `${word}: ` : ''}${escapeHtml(check.text)}` : word || 'Read';
  } else if (check === null) { status = 'Not reached'; }
  return `
    <li class="rung ${cls}">
      <span class="rung-tf">${tf.tf}</span>
      <div class="rung-body">
        <h3>${tf.job}${tf.optional ? ' <span class="tag">Optional</span>' : ''}</h3>
        <p>${tf.how}</p>
      </div>
      <span class="rung-status">${status}</span>
    </li>`;
}

function tradeBlock(signal) {
  const isTrade = signal.state === 'buy' || signal.state === 'sell';
  if (isTrade && signal.entry != null) {
    return `
      <dl class="signal-levels">
        <div><dt>Entry</dt><dd>${price(signal.entry)}</dd></div>
        <div><dt>Stop-loss</dt><dd>${price(signal.stop)}</dd></div>
        <div><dt>Take-profit</dt><dd>${price(signal.target)}</dd></div>
        <div><dt>Reward-to-risk</dt><dd>${ratio(Math.floor(signal.rr * 10) / 10)}</dd></div>
      </dl>
      <p class="signal-basis"><strong>At 0.01 lot (1 oz): risk $${price(Math.abs(signal.entry - signal.stop))}, reward $${price(Math.abs(signal.target - signal.entry))}.</strong> Entry is the close of the confirming 15M candle at ${time(signal.confirmedAt)}. Target: ${escapeHtml(signal.targetBasis || '')}. If price has already moved away from the entry, the signal is no longer valid.</p>
      <a class="button button-primary" href="#/risk">Size this trade</a>`;
  }
  if (isTrade) {
    return `
      <dl class="signal-levels">
        <div><dt>Direction</dt><dd>${signal.direction === 'buy' ? 'Buy' : 'Sell'}</dd></div>
        <div><dt>Timeframe</dt><dd>${escapeHtml(signal.timeframe || '15M')}</dd></div>
        <div><dt>Entry</dt><dd class="is-locked">Pro</dd></div>
        <div><dt>Stop and target</dt><dd class="is-locked">Pro</dd></div>
      </dl>
      <a class="button button-primary" href="#/plans">Request access</a>`;
  }
  if (signal.state === 'locked') {
    return signal.access === 'anonymous'
      ? '<a class="button button-primary" href="#/profile">Sign in</a>'
      : '<a class="button button-primary" href="#/plans">Request access</a>';
  }
  return '';
}

export function verdictMarkup(signal) {
  const loading = !signal;
  const state = SIGNAL_STATES.find((s) => s.id === (signal?.state || 'offline')) || SIGNAL_STATES[0];
  const label = loading ? 'Checking' : state.label;
  // For "no setup" the headline already carries the fixed sentence; show only the detail under it.
  let reason = loading ? 'Reading the 4H, 1H and 15M candles…' : (signal.reason || state.meaning);
  if (!loading && signal.state === 'no-setup') reason = reason.replace(state.label, '').replace(/^[\s.—-]+/, '').trim() || state.meaning;
  const checks = signal?.checks || {};
  const keys = ['h4', 'h1', 'm15', null];
  const previews = signal?.previews && signal.previews.limit !== null && signal.previews.used !== null
    ? `Free previews used this month: ${signal.previews.used} of ${signal.previews.limit}. ` : '';

  return `
    <div class="verdict-head">
      <p class="panel-kicker">Signal engine</p>
      <p class="verdict-state ${label.length > 8 ? 'is-long' : ''} ${label.length > 20 ? 'is-sentence' : ''} tone-${loading ? 'muted' : state.tone}" id="verdict-state">${escapeHtml(label)}</p>
      <p class="verdict-meaning" id="verdict-reason">${escapeHtml(reason)}</p>
      ${loading ? '' : tradeBlock(signal)}
    </div>
    <ol class="ladder" aria-label="Timeframe checks, from highest to lowest">
      ${TIMEFRAMES.map((tf, i) => rung(tf, loading || !signal.checks ? undefined : keys[i] ? checks[keys[i]] : undefined)).join('')}
    </ol>
    <p class="verdict-foot">${previews}${signal?.readAt ? `Read at ${time(signal.readAt)}. ` : ''}${DISCLAIMER}</p>`;
}

export function upgradePanel(what) {
  return `
    <section class="panel upgrade">
      <h2>${what} is part of Pro</h2>
      <p>Pro includes full signals with entry, stop-loss and take-profit, the technical and fundamental analysis, and the advanced journal. Access is by approval.</p>
      <a class="button button-primary" href="#/plans">Request access</a>
    </section>`;
}

export function levelsMarkup(signal) {
  if (!signal) return '';
  if (!signal.levels) return upgradePanel('Technical analysis');
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
