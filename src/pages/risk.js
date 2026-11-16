import { evaluateTrade, MIN_REWARD_TO_RISK, XAUUSD_CONTRACT_OZ } from '../lib/risk.js';
import { usd, price, ratio, escapeHtml } from '../lib/format.js';

const field = (id, label, hint, attrs = '') => `
  <label class="field" for="${id}">
    <span class="field-label">${label}</span>
    <input id="${id}" name="${id}" type="number" inputmode="decimal" step="any" min="0" autocomplete="off" ${attrs} />
    ${hint ? `<span class="field-hint">${hint}</span>` : ''}
  </label>`;

function resultMarkup(r) {
  if (!r) {
    return '<p class="result-empty">Fill in the trade to see the position size and whether it meets the 1:3 rule.</p>';
  }
  if (!r.ok) {
    return `<ul class="result-errors">${r.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  }
  const verdictClass = r.allowed ? 'pass' : 'fail';
  const verdictText = r.allowed
    ? 'Meets the plan'
    : !r.meetsMinimum
      ? `Below the 1:${MIN_REWARD_TO_RISK} minimum`
      : 'Stop too wide for this risk';
  const fix = !r.meetsMinimum
    ? `<p class="result-fix">Move the take-profit to <strong>${price(r.minimumTarget)}</strong> or beyond to reach 1:${MIN_REWARD_TO_RISK}.</p>`
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

export function riskPage() {
  return {
    title: 'Risk calculator',
    html: `
      <header class="page-head">
        <h1>Risk calculator</h1>
        <p>Size an XAUUSD position from your own numbers and check it against the 1:${MIN_REWARD_TO_RISK} rule. Nothing here is sent anywhere or saved.</p>
      </header>
      <div class="calc">
        <form class="panel calc-form" id="risk-form" novalidate>
          <fieldset class="direction">
            <legend class="field-label">Direction</legend>
            <label><input type="radio" name="direction" value="buy" checked /><span class="dir dir-buy">Buy</span></label>
            <label><input type="radio" name="direction" value="sell" /><span class="dir dir-sell">Sell</span></label>
          </fieldset>
          <div class="field-row">
            ${field('balance', 'Account balance (USD)', 'Type it in. It is read from MT5 from Stage 6.')}
            ${field('riskPercent', 'Risk per trade (%)', '', 'value="1" max="100"')}
          </div>
          <div class="field-row field-row-3">
            ${field('entry', 'Entry price', '')}
            ${field('stop', 'Stop-loss', '')}
            ${field('target', 'Take-profit', '')}
          </div>
          <p class="panel-note">Assumes the standard contract of ${XAUUSD_CONTRACT_OZ} oz per 1.00 lot and a 0.01 lot minimum. Spread, commission and swap are not included. These are confirmed against your Exness account in Stage 6.</p>
        </form>
        <section class="panel calc-result" aria-labelledby="result-title">
          <h2 id="result-title" class="panel-title">Result</h2>
          <div id="risk-result" aria-live="polite">${resultMarkup(null)}</div>
        </section>
      </div>`,
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
        }));
      };
      form.addEventListener('input', update);
      form.addEventListener('submit', (e) => e.preventDefault());
      return () => form.removeEventListener('input', update);
    },
  };
}
