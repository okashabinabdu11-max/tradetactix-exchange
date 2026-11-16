import { evaluateTrade, MIN_REWARD_TO_RISK, XAUUSD_CONTRACT_OZ } from '../lib/risk.js';
import { DEFAULT_RISK_SETTINGS, validateRiskSettings } from '../lib/riskSettings.js';
import { usd, price, ratio, escapeHtml } from '../lib/format.js';
import { session } from '../state/session.js';
import { saveRiskSettings } from '../services/backend.js';
import { isSupabaseConfigured } from '../config.js';
import { STAGE_OF } from '../data/plan.js';

const field = (id, label, hint, attrs = '') => `
  <label class="field" for="${id}">
    <span class="field-label">${label}</span>
    <input id="${id}" name="${id}" type="number" inputmode="decimal" step="any" min="0" autocomplete="off" ${attrs} />
    ${hint ? `<span class="field-hint">${hint}</span>` : ''}
  </label>`;

function resultMarkup(r) {
  if (!r) {
    return '<p class="result-empty">Fill in the trade to see the position size and whether it meets your minimum reward-to-risk.</p>';
  }
  if (!r.ok) {
    return `<ul class="result-errors">${r.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  }
  const minimum = ratio(r.minimumRatio);
  const verdictClass = r.allowed ? 'pass' : 'fail';
  const verdictText = r.allowed
    ? 'Meets the plan'
    : !r.meetsMinimum
      ? `Below the ${minimum} minimum`
      : 'Stop too wide for this risk';
  const fix = !r.meetsMinimum
    ? `<p class="result-fix">Move the take-profit to <strong>${price(r.minimumTarget)}</strong> or beyond to reach ${minimum}.</p>`
    : '';
  const size = r.belowMinLot
    ? `<div><dt>Position size</dt><dd>None</dd><dd class="sub">0.01 lot would risk ${usd(r.minLotRisk)} (${r.minLotRiskPercent.toFixed(2)}%)</dd></div>`
    : `<div><dt>Position size</dt><dd>${r.lots.toFixed(2)} lot</dd><dd class="sub">${(r.lots * XAUUSD_CONTRACT_OZ).toFixed(0)} oz</dd></div>`;

  return `
    <div class="result-verdict ${verdictClass}">
      <span class="result-ratio">${ratio(r.rewardToRisk)}</span>
      <span class="result-text">${verdictText}</span>
    </div>
    ${fix}
    <dl class="result-grid">
      ${size}
      <div><dt>Risk at stop</dt><dd>${usd(r.actualRisk)}</dd><dd class="sub">${r.actualRiskPercent.toFixed(2)}% of balance, limit ${usd(r.riskBudget)}</dd></div>
      <div><dt>Reward at target</dt><dd>${usd(r.potentialReward)}</dd><dd class="sub">${price(r.targetDistance)} per oz</dd></div>
      <div><dt>Stop distance</dt><dd>${price(r.stopDistance)}</dd><dd class="sub">USD per oz</dd></div>
    </dl>
    ${r.warnings.length ? `<ul class="result-warnings">${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}`;
}

function limitsPanel({ ready, user, riskSettings, settingsError }) {
  const head = '<h2 id="limits-title" class="panel-title">Your risk limits</h2>';
  if (!isSupabaseConfigured) {
    return `<section class="panel limits" aria-labelledby="limits-title">${head}<p class="result-empty">The database is not set up, so limits cannot be saved.</p></section>`;
  }
  if (!ready) {
    return `<section class="panel limits" aria-labelledby="limits-title">${head}<p class="result-empty">Checking sign-in…</p></section>`;
  }
  if (!user) {
    return `
      <section class="panel limits" aria-labelledby="limits-title">${head}
        <p class="result-empty">Sign in to save your own risk per trade, minimum reward-to-risk and daily limits.</p>
        <a class="button button-quiet" href="#/profile">Sign in</a>
      </section>`;
  }
  if (settingsError) {
    return `
      <section class="panel limits" aria-labelledby="limits-title">${head}
        <ul class="result-errors"><li>${escapeHtml(settingsError)}</li></ul>
        <p class="panel-note">Run the risk limits database script in Supabase, then reload this page.</p>
      </section>`;
  }
  const v = riskSettings || DEFAULT_RISK_SETTINGS;
  return `
    <form class="panel limits" id="limits-form" aria-labelledby="limits-title" novalidate>
      ${head}
      <div class="field-row field-row-4">
        ${field('riskPercentLimit', 'Risk per trade (%)', '', `value="${v.riskPercent}" max="100"`)}
        ${field('minRewardToRisk', 'Minimum reward-to-risk (1:x)', `Cannot go below ${MIN_REWARD_TO_RISK}.`, `value="${v.minRewardToRisk}" min="${MIN_REWARD_TO_RISK}"`)}
        ${field('maxTradesPerDay', 'Trades per day', '', `value="${v.maxTradesPerDay}" step="1" inputmode="numeric"`)}
        ${field('maxDailyLossPercent', 'Daily loss limit (%)', '', `value="${v.maxDailyLossPercent}" max="100"`)}
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit">Save limits</button>
        <span id="limits-status" class="form-status" role="status">${riskSettings ? '' : 'Not saved yet. These are suggested starting values.'}</span>
      </div>
      <p class="panel-note">Risk per trade and the minimum reward-to-risk are used by the calculator above. The daily limits are stored now and enforced once trades come from MT5 in Stage ${STAGE_OF.mt5}.</p>
    </form>`;
}

export function riskPage() {
  const state = session.get();
  const saved = state.user ? state.riskSettings : null;
  let minRewardToRisk = saved?.minRewardToRisk ?? MIN_REWARD_TO_RISK;
  const startRisk = saved?.riskPercent ?? DEFAULT_RISK_SETTINGS.riskPercent;

  return {
    title: 'Risk calculator',
    html: `
      <header class="page-head">
        <h1>Risk calculator</h1>
        <p>Size an XAUUSD position from your own numbers and check it against your <span id="min-ratio-text">${ratio(minRewardToRisk)}</span> minimum. The trade you type here is not saved or sent anywhere.</p>
      </header>
      <div class="calc">
        <form class="panel calc-form" id="risk-form" novalidate>
          <fieldset class="direction">
            <legend class="field-label">Direction</legend>
            <label><input type="radio" name="direction" value="buy" checked /><span class="dir dir-buy">Buy</span></label>
            <label><input type="radio" name="direction" value="sell" /><span class="dir dir-sell">Sell</span></label>
          </fieldset>
          <div class="field-row">
            ${field('balance', 'Account balance (USD)', `Type it in. It is read from MT5 from Stage ${STAGE_OF.mt5}.`)}
            ${field('riskPercent', 'Risk per trade (%)', '', `value="${startRisk}" max="100"`)}
          </div>
          <div class="field-row field-row-3">
            ${field('entry', 'Entry price', '')}
            ${field('stop', 'Stop-loss', '')}
            ${field('target', 'Take-profit', '')}
          </div>
          <p class="panel-note">Assumes the standard contract of ${XAUUSD_CONTRACT_OZ} oz per 1.00 lot and a 0.01 lot minimum. Spread, commission and swap are not included. These are confirmed against your Exness account in Stage ${STAGE_OF.mt5}.</p>
        </form>
        <section class="panel calc-result" aria-labelledby="result-title">
          <h2 id="result-title" class="panel-title">Result</h2>
          <div id="risk-result" aria-live="polite">${resultMarkup(null)}</div>
        </section>
      </div>
      ${limitsPanel(state)}`,
    mount(root) {
      const form = root.querySelector('#risk-form');
      const out = root.querySelector('#risk-result');
      const num = (name) => {
        const raw = form.elements[name].value.trim();
        return raw === '' ? NaN : Number(raw);
      };
      const update = () => {
        const tradeFields = ['balance', 'entry', 'stop', 'target'];
        const untouched = tradeFields.every((n) => form.elements[n].value.trim() === '');
        if (untouched) { out.innerHTML = resultMarkup(null); return; }
        out.innerHTML = resultMarkup(evaluateTrade({
          direction: form.elements.direction.value,
          balance: num('balance'),
          riskPercent: num('riskPercent'),
          entry: num('entry'),
          stop: num('stop'),
          target: num('target'),
          minRewardToRisk,
        }));
      };
      form.addEventListener('input', update);
      form.addEventListener('submit', (e) => e.preventDefault());

      const limits = root.querySelector('#limits-form');
      if (limits) {
        const status = limits.querySelector('#limits-status');
        const button = limits.querySelector('button[type="submit"]');
        const setStatus = (text, tone = '') => {
          status.textContent = text;
          status.className = `form-status ${tone}`;
        };
        limits.addEventListener('input', () => setStatus('Unsaved changes'));
        limits.addEventListener('submit', async (e) => {
          e.preventDefault();
          const check = validateRiskSettings({
            riskPercent: limits.elements.riskPercentLimit.value,
            minRewardToRisk: limits.elements.minRewardToRisk.value,
            maxTradesPerDay: limits.elements.maxTradesPerDay.value,
            maxDailyLossPercent: limits.elements.maxDailyLossPercent.value,
          });
          if (!check.ok) { setStatus(check.errors[0], 'is-error'); return; }
          button.disabled = true;
          setStatus('Saving…');
          const res = await saveRiskSettings(check.values);
          button.disabled = false;
          if (!res.ok) { setStatus(`Not saved. ${res.message}`, 'is-error'); return; }
          setStatus('Limits saved', 'is-ok');
          // Apply the saved limits to the calculator straight away.
          minRewardToRisk = res.values.minRewardToRisk;
          form.elements.riskPercent.value = res.values.riskPercent;
          root.querySelector('#min-ratio-text').textContent = ratio(minRewardToRisk);
          update();
        });
      }
      return () => form.removeEventListener('input', update);
    },
  };
}
