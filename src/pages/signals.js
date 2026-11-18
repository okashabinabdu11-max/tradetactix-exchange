import { getSignal, signalState } from '../services/market.js';
import { session } from '../state/session.js';
import { MIN_REWARD_TO_RISK } from '../lib/risk.js';
import { ratio, escapeHtml } from '../lib/format.js';
import { getAccessToken } from '../services/backend.js';
import { STAGE_OF } from '../data/plan.js';
import { verdictMarkup, levelsMarkup } from './signalView.js';
import { loadTradingViewWidget } from '../ui/tvWidget.js';
import { CALENDAR_CONFIG, NEWS_CONFIG } from '../data/widgets.js';

const REFRESH_MS = 5 * 60e3;
const myMinimum = () => (session.get().user ? session.get().riskSettings?.minRewardToRisk : null) ?? MIN_REWARD_TO_RISK;

function livePage({ title, intro, body }) {
  return {
    title,
    html: `
      <header class="page-head"><h1>${title}</h1><p>${intro}</p></header>
      <div id="signal-view">${body(signalState())}</div>`,
    mount(root) {
      const box = root.querySelector('#signal-view');
      let alive = true;
      const refresh = async () => {
        const signal = await getSignal(myMinimum());
        if (alive) box.innerHTML = body(signal);
      };
      refresh();
      const timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
      return () => { alive = false; clearInterval(timer); };
    },
  };
}

export function signalsPage() {
  return livePage({
    title: 'Signals',
    intro: `The current reading of XAUUSD against your plan, refreshed every five minutes. A signal needs every check to pass and at least ${ratio(myMinimum())}.`,
    body: (signal) => `
      <section class="panel verdict">${verdictMarkup(signal)}</section>
      <section class="panel rules">
        <h2 class="panel-title">The rules being applied</h2>
        <ol class="rules-list">
          <li><strong>4H.</strong> A level is a price where the closing line has turned at least twice. Price must be at one.</li>
          <li><strong>1H.</strong> Liquidity is the most recent swing high and low. Price must sweep the one beyond the level.</li>
          <li><strong>15M.</strong> After the sweep, price must return to the level and a candle must close back in the trade direction.</li>
          <li><strong>Risk.</strong> The stop goes just beyond the 15M retest and the 4H level, and is kept tight. The next 4H level must be at least ${ratio(myMinimum())} away, or there is no signal.</li>
        </ol>
        <p class="panel-note">The engine reads price only. Check the <a class="inline-link" href="#/analysis">economic calendar</a> for high-impact US news before acting. Signal history and alerts are not built yet. Prices are from Twelve Data and can differ slightly from Exness; MT5 prices arrive in Stage ${STAGE_OF.mt5}.</p>
      </section>`,
  });
}

function levelsBody(signal) {
  if (!signal) return '<p class="result-empty">Reading the candles…</p>';
  if (signal.state === 'offline') return `<section class="panel"><p class="result-empty">${signal.reason}</p></section>`;
  return levelsMarkup(signal);
}

// Null entitlement means the plans tables are not readable; the server decides
// what the levels show either way, so only the widgets depend on this.
const analysisOpen = () => session.get().entitlement?.shows_analysis === true;

const BIAS = { bullish: ['Bullish for gold', 'tone-green'], bearish: ['Bearish for gold', 'tone-red'], neutral: ['Neutral, no clear lean', 'tone-yellow'] };
const localTime = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function outlookMarkup(items) {
  if (items === null) return '<p class="result-empty">The news outlook is not available right now.</p>';
  const now = Date.now();
  const upcoming = items.filter((i) => Date.parse(i.startsAt) > now - 2 * 3600e3);
  if (!upcoming.length) return '<p class="result-empty">No high-impact US news in the next 24 hours. When one is coming, its outlook appears here and on Telegram.</p>';
  return `<ul class="outlook-list">${upcoming.map((i) => {
    const [label, tone] = BIAS[i.bias] || BIAS.neutral;
    const past = Date.parse(i.startsAt) <= now;
    return `
      <li class="outlook">
        <p class="outlook-when">${escapeHtml(localTime(i.startsAt))}${past ? ' · released' : ''}</p>
        <h3>${escapeHtml(i.title)}</h3>
        <p class="outlook-nums">Forecast ${escapeHtml(i.forecast || '—')} · Previous ${escapeHtml(i.previous || '—')}</p>
        <p class="outlook-bias ${tone}">${label} <span>(${escapeHtml(i.confidence)} confidence)</span></p>
        <p>${escapeHtml(i.reason)}</p>
        <p class="outlook-case">⬆️ ${escapeHtml(i.ifHigher || '')}</p>
        <p class="outlook-case">⬇️ ${escapeHtml(i.ifLower || '')}</p>
      </li>`;
  }).join('')}</ul>`;
}

async function loadOutlook() {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch('/api/news', { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.items) ? body.items : null;
}

export function analysisPage() {
  return {
    title: 'Analysis',
    html: `
      <header class="page-head">
        <h1>Analysis</h1>
        <p>The technical picture the signal engine is reading, then the scheduled events and news that move gold.</p>
      </header>
      <div id="signal-view">${levelsBody(signalState())}</div>
${analysisOpen() ? `      <section class="panel fundamentals" aria-labelledby="outlook-h">
        <h2 id="outlook-h" class="panel-title">News outlook</h2>
        <div id="news-outlook"><p class="result-empty">Loading the outlook…</p></div>
        <p class="panel-note">For each high-impact US release in the next 24 hours: the expected effect on gold, why, and what a higher or lower number usually does. Members get it on Telegram in the hour before. It is an expectation, not a promise: news can move gold fast both ways.</p>
      </section>
      <section class="panel fundamentals" aria-labelledby="cal-h">
        <h2 id="cal-h" class="panel-title">US economic calendar</h2>
        <div class="widget-frame" id="tv-calendar"></div>
        <p class="panel-note">Medium and high impact United States releases, from TradingView. Gold often moves sharply around inflation, jobs and Federal Reserve announcements, so check this before acting on a signal.</p>
      </section>
      <section class="panel fundamentals" aria-labelledby="news-h">
        <h2 id="news-h" class="panel-title">Gold news</h2>
        <div class="widget-frame widget-frame-tall" id="tv-news"></div>
        <p class="panel-note">Headlines for XAUUSD from TradingView. The signal engine itself reads price only; the news outlook above is a separate analysis.</p>
      </section>` : ''}`,
    mount(root) {
      const box = root.querySelector('#signal-view');
      let alive = true;
      const refresh = async () => {
        const signal = await getSignal(myMinimum());
        if (alive) box.innerHTML = levelsBody(signal);
      };
      refresh();
      const timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
      // The widgets are loaded once and left alone; only the levels above refresh.
      const outlook = root.querySelector('#news-outlook');
      if (outlook) loadOutlook().then((items) => { if (alive) outlook.innerHTML = outlookMarkup(items); });
      if (root.querySelector('#tv-calendar')) {
        loadTradingViewWidget(root.querySelector('#tv-calendar'), 'embed-widget-events.js', CALENDAR_CONFIG, 'The economic calendar could not load.');
        loadTradingViewWidget(root.querySelector('#tv-news'), 'embed-widget-timeline.js', NEWS_CONFIG, 'The news feed could not load.');
      }
      return () => { alive = false; clearInterval(timer); };
    },
  };
}
