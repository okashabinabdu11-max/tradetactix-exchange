// Shared rendering of the signal the server sent. The server has already
// removed whatever the viewer's plan does not include, so this file only
// draws what it is given and never fills gaps.

import { TIMEFRAMES, SIGNAL_STATES, TRADE_STATES } from '../data/plan.js';
import { price, ratio, escapeHtml } from '../lib/format.js';
import { t, lang } from '../lib/i18n.js';

// Status reasons are built from fixed sentences: translate each one that is known.
const translateReason = (r) => (lang() === 'am' ? String(r).split(/(?<=\.)\s+/).map((x) => t(x)).join(' ') : r);

const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const DISCLAIMER = 'A rules-based reading of the plan from closed candles, not financial advice. Check it on the chart before acting. No order is placed.';

function rung(tf, check) {
  let status = t('No data');
  let cls = '';
  if (tf.optional) { status = t('Not checked automatically. Confirm on the chart.'); }
  else if (check) {
    cls = check.ok === true ? 'is-ok' : check.ok === false ? 'is-fail' : '';
    const word = check.ok === true ? t('Passed') : check.ok === false ? t('Not yet') : '';
    status = check.text ? `${word ? `${word}: ` : ''}${escapeHtml(check.text)}` : word || 'Read';
  } else if (check === null) { status = t('Not reached'); }
  return `
    <li class="rung ${cls}">
      <span class="rung-tf">${tf.tf}</span>
      <div class="rung-body">
        <h3>${t(tf.job)}${tf.optional ? ` <span class="tag">${t('Optional')}</span>` : ''}</h3>
        <p>${t(tf.how)}</p>
      </div>
      <span class="rung-status">${status}</span>
    </li>`;
}

/** What the engine is looking for and what it sees now, in plain words. */
function watchMarkup(signal) {
  const w = signal?.watch;
  if (!w || (!w.looking?.length && !w.seeing?.length)) return '';
  const list = (items) => items.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  return `
    <div class="watch">
      ${w.looking?.length ? `<div class="watch-col"><h3>${t('Looking for')}</h3><ul>${list(w.looking)}</ul></div>` : ''}
      ${w.seeing?.length ? `<div class="watch-col"><h3>${t('Seeing now')}</h3><ul>${list(w.seeing)}</ul></div>` : ''}
    </div>`;
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
      <p class="signal-basis"><strong>Risk ${Math.round(Math.abs(signal.entry - signal.stop) * 10)} pips, reward ${Math.round(Math.abs(signal.target - signal.entry) * 10)} pips.</strong> ${signal.setup === 'order-block' && signal.entryZone
        ? `Entry is in the Fib 0.5–0.618 zone ${price(signal.entryZone[0])}–${price(signal.entryZone[1])}, filled at ${time(signal.confirmedAt)}. Stop at Fib 0.786.`
        : `Entry is the close of the confirming candle at ${time(signal.confirmedAt)}.`} Target: ${escapeHtml(signal.targetBasis || '')}. If price has already moved away from the entry, the signal is no longer valid.</p>
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
      ? '<a class="button button-primary" href="#/home">Open Account</a>'
      : '<a class="button button-primary" href="#/plans">Request access</a>';
  }
  return '';
}

const signedPips = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

// The signal that was sent, followed until it ends.
function tradeHead(tr) {
  const st = TRADE_STATES[tr.status];
  const dir = tr.direction === 'buy' ? 'BUY' : 'SELL';
  const label = tr.status === 'running' ? `${dir} ${t('running')}` : t(st.label);
  let line;
  if (tr.status === 'running') line = tr.pips == null ? t('Live price unavailable right now.') : `${signedPips(tr.pips)} ${t('pips running')}`;
  else if (tr.status === 'be-moved') line = tr.pips == null ? `Stop → ${price(tr.entry)}` : `${signedPips(tr.pips)} ${t('pips running')}`;
  else if (tr.status === 'tp') line = `${signedPips(tr.pips ?? 0)} ${t('pips smashed')}`;
  else if (tr.status === 'sl') line = `${signedPips(tr.pips ?? 0)} ${t('pips')}`;
  else line = `0 ${t('pips')}`;
  const live = tr.status === 'running' || tr.status === 'be-moved';
  return `
      <p class="verdict-state is-long tone-${st.tone}" id="verdict-state">${escapeHtml(label)}</p>
      <p class="trade-pips tone-${st.tone}" id="trade-pips">${escapeHtml(line)}</p>
      <dl class="signal-levels">
        <div><dt>Direction</dt><dd>${dir === 'BUY' ? 'Buy' : 'Sell'}</dd></div>
        <div><dt>Entry</dt><dd>${price(tr.entry)}</dd></div>
        <div><dt>Stop-loss</dt><dd>${tr.status === 'be-moved' ? `${price(tr.entry)} (BE)` : price(tr.stop)}</dd></div>
        <div><dt>Take-profit</dt><dd>${price(tr.target)}</dd></div>
      </dl>
      <p class="verdict-meaning" id="verdict-reason">${tr.status === 'be-moved' ? `<strong>${t('Move your stop-loss to breakeven at')} ${price(tr.entry)}.</strong> ` : ''}${live
        ? `Signal sent at ${time(tr.openedAt)}.${tr.price != null ? ` Price now ${price(tr.price)}; it updates about every 5 minutes.` : ''}`
        : `Signal sent at ${time(tr.openedAt)}, ended at ${time(tr.closedAt)}. The page returns to analyzing after 12 hours or when a new signal is sent.`}</p>`;
}

export function verdictMarkup(signal) {
  const loading = !signal;
  const state = SIGNAL_STATES.find((s) => s.id === (signal?.state || 'offline')) || SIGNAL_STATES[0];
  const label = loading ? t('Checking') : t(state.label);
  // For "no setup" the headline already carries the fixed sentence; show only the detail under it.
  let reason = loading ? t('Reading the candles…') : (signal.reason || state.meaning);
  if (!loading && signal.state === 'no-setup') reason = reason.replace('Wait — the market setup is analyzing.', '').replace(state.label, '').replace(/^[\s.—-]+/, '').trim() || state.meaning;
  const waitingNow = !loading && ['no-setup', 'waiting'].includes(signal.state) && signal.watch;
  // A running or just-finished signal takes the headline, unless the engine has a newer one.
  const fresh = signal && (signal.state === 'buy' || signal.state === 'sell');
  const trd = signal?.trade;
  const showTrade = !!trd && TRADE_STATES[trd.status] && (!fresh || trd.status === 'running' || trd.status === 'be-moved');
  const checks = signal?.checks || {};
  const keys = ['h4', 'h1', 'm15', null];
  const previews = signal?.previews && signal.previews.limit !== null && signal.previews.used !== null
    ? `Free previews used this month: ${signal.previews.used} of ${signal.previews.limit}. ` : '';

  return `
    <div class="verdict-head">
      <p class="panel-kicker">${t('Signal engine')}</p>
      ${showTrade ? tradeHead(signal.trade) : `
      <p class="verdict-state ${label.length > 8 ? 'is-long' : ''} ${label.length > 20 ? 'is-sentence' : ''} tone-${loading ? 'yellow' : state.tone}" id="verdict-state">${escapeHtml(label)}</p>
      ${waitingNow ? watchMarkup(signal) : `<p class="verdict-meaning" id="verdict-reason">${escapeHtml(translateReason(reason))}</p>`}
      ${loading ? '' : tradeBlock(signal)}`}
    </div>
    ${waitingNow || signal?.setup === 'order-block' || showTrade ? '' : `<ol class="ladder" aria-label="Timeframe checks, from highest to lowest">
      ${TIMEFRAMES.map((tf, i) => rung(tf, loading || !signal.checks ? undefined : keys[i] ? checks[keys[i]] : undefined)).join('')}
    </ol>`}
    <p class="verdict-foot">${previews}${signal?.readAt ? `Read at ${time(signal.readAt)}. ` : ''}${t(DISCLAIMER)}</p>`;
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
