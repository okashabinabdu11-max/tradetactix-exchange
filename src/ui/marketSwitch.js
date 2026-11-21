// The XAUUSD / BTCUSD switch above the signal. The choice is kept on this device.

import { MARKETS, MARKET_LIST } from '../lib/markets.js';
import { selectedMarket, setMarket } from '../services/market.js';
import { t } from '../lib/i18n.js';

export function marketSwitchMarkup() {
  const current = selectedMarket();
  return `
    <div class="market-switch" role="group" aria-label="${t('Market')}">
      ${MARKET_LIST.map((sym) => `<button type="button" class="market-btn" data-market="${sym}" aria-pressed="${sym === current}">
        <strong>${sym}</strong><span>${t(MARKETS[sym].name)}</span></button>`).join('')}
    </div>`;
}

/** Picking another market saves it and redraws the page (price, sessions, signal, calendar follow it). */
export function bindMarketSwitch(root, onChange = null) {
  const box = root.querySelector('.market-switch');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-market]');
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    const sym = btn.dataset.market;
    setMarket(sym);
    for (const b of box.querySelectorAll('[data-market]')) b.setAttribute('aria-pressed', String(b === btn));
    if (onChange) onChange(sym);
    else window.dispatchEvent(new CustomEvent('tt-market', { detail: sym }));
  });
}
