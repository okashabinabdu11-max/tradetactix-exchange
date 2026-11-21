// The markets the signal engine reads. Shared by the server and the website.
//
//   XAUUSD  gold, Twelve Data candles, trades about 23 hours a day on weekdays.
//           1 pip = $0.10.
//   BTCUSD  bitcoin, Kraken exchange candles (free, no key), trades 24/7.
//           Moves are counted in dollars of price. No dollar limit on the stop:
//           it goes where the setup puts it.

export const MARKETS = Object.freeze({
  XAUUSD: Object.freeze({
    symbol: 'XAUUSD', name: 'Gold', long: 'Gold vs US dollar',
    alwaysOpen: false, maxStopUsd: 9, pip: 0.1, unit: 'pips', contract: 100, // oz per 1.00 lot
  }),
  BTCUSD: Object.freeze({
    symbol: 'BTCUSD', name: 'Bitcoin', long: 'Bitcoin vs US dollar',
    alwaysOpen: true, maxStopUsd: Infinity, pip: 1, unit: 'usd', contract: 1, // BTC per 1.00 lot
  }),
});

export const DEFAULT_MARKET = 'XAUUSD';
export const MARKET_LIST = Object.keys(MARKETS);

/** A known market symbol, or the default. Accepts "btcusd", "BTC/USD". */
export function marketOf(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  return MARKETS[s] || MARKETS[DEFAULT_MARKET];
}

/** A price distance in the market's own unit: gold pips, bitcoin dollars (rounded). */
export function moveUnits(market, distance) {
  const m = typeof market === 'string' ? marketOf(market) : market;
  return Math.round(distance / m.pip);
}

/** "123 pips" for gold, "$1,234" for bitcoin. Pass `signed` for "+" and "−". */
export function moveText(market, units, signed = false) {
  const m = typeof market === 'string' ? marketOf(market) : market;
  const n = Math.round(Number(units) || 0);
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : n < 0 ? '−' : '';
  const abs = Math.abs(n).toLocaleString('en-US');
  return m.unit === 'usd' ? `${sign}$${abs}` : `${sign}${abs} pips`;
}
