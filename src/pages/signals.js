import { getSignal, signalState } from '../services/market.js';
import { session } from '../state/session.js';
import { MIN_REWARD_TO_RISK } from '../lib/risk.js';
import { ratio } from '../lib/format.js';
import { STAGE_OF } from '../data/plan.js';
import { verdictMarkup, levelsMarkup } from './signalView.js';

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
          <li><strong>Risk.</strong> The stop goes beyond the sweep. The next 4H level must be at least ${ratio(myMinimum())} away, or there is no signal.</li>
        </ol>
        <p class="panel-note">Signal history and alerts are not built yet. Prices are from Twelve Data and can differ slightly from Exness; MT5 prices arrive in Stage ${STAGE_OF.mt5}.</p>
      </section>`,
  });
}

export function analysisPage() {
  return livePage({
    title: 'Analysis',
    intro: 'The levels and liquidity the signal engine is reading right now.',
    body: (signal) => {
      if (!signal) return '<p class="result-empty">Reading the candles…</p>';
      if (signal.state === 'offline') return `<section class="panel"><p class="result-empty">${signal.reason}</p></section>`;
      return `${levelsMarkup(signal)}
        <section class="panel"><p class="result-empty">Fundamental analysis (economic calendar and gold news) arrives in Stage ${STAGE_OF.fundamentals}.</p></section>`;
    },
  });
}
