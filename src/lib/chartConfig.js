// Chart settings that do not touch the page: pairs, timeframes, indicators
// and colours. Pure, so it is unit tested. Prices come from Twelve Data
// through /api/chart-data, so symbols use its "BASE/QUOTE" form.

export const CHART_SYMBOL = 'XAU/USD';

const fx = (list) => list.map((p) => ({ id: `${p.slice(0, 3)}/${p.slice(3)}`, label: `${p.slice(0, 3)}/${p.slice(3)}` }));
export const SYMBOL_GROUPS = [
  { label: 'Metals', items: [{ id: 'XAU/USD', label: 'XAU/USD (Gold)' }, { id: 'XAG/USD', label: 'XAG/USD (Silver)' }] },
  { label: 'Major pairs', items: fx(['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD']) },
  { label: 'Cross pairs', items: fx(['EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'EURAUD', 'EURCAD', 'EURNZD', 'GBPCHF', 'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDJPY', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'NZDJPY', 'NZDCAD', 'NZDCHF', 'CADJPY', 'CADCHF', 'CHFJPY']) },
  { label: 'Exotic pairs', items: fx(['USDZAR', 'USDTRY', 'USDMXN', 'USDSGD', 'USDHKD', 'USDNOK', 'USDSEK', 'USDPLN', 'EURTRY']) },
  { label: 'Crypto', items: [{ id: 'BTC/USD', label: 'BTC/USD' }, { id: 'ETH/USD', label: 'ETH/USD' }, { id: 'SOL/USD', label: 'SOL/USD' }, { id: 'XRP/USD', label: 'XRP/USD' }, { id: 'BNB/USD', label: 'BNB/USD' }] },
];
export const ALL_SYMBOLS = SYMBOL_GROUPS.flatMap((g) => g.items);

// Old saved choices used TradingView ids ("OANDA:XAUUSD", "FX:EURUSD").
const OLD_IDS = { 'OANDA:XAUUSD': 'XAU/USD', 'OANDA:XAGUSD': 'XAG/USD', 'BITSTAMP:BTCUSD': 'BTC/USD', 'BITSTAMP:ETHUSD': 'ETH/USD', 'BINANCE:SOLUSDT': 'SOL/USD', 'BINANCE:XRPUSDT': 'XRP/USD', 'BINANCE:BNBUSDT': 'BNB/USD' };

/** A pair as typed: "EURUSD", "eur/usd", "BTCUSD". Null when it cannot be a pair. */
export function cleanSymbol(input) {
  let s = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  if (OLD_IDS[s]) return OLD_IDS[s];
  if (s.includes(':')) s = s.split(':')[1];
  if (/^[A-Z]{2,5}\/[A-Z]{3,4}$/.test(s)) return s;
  if (/^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(3)}`;
  if (/^[A-Z]{3,4}USDT?$/.test(s)) return `${s.replace(/USDT?$/, '')}/USD`;
  return null;
}

/** Size of one pip in price. */
export function pipSize(symbol) {
  const s = String(symbol || '');
  if (s === 'XAU/USD') return 0.1;
  if (s === 'XAG/USD') return 0.01;
  if (/^(BTC|ETH|SOL|BNB)\//.test(s)) return 1;
  if (s.startsWith('XRP/')) return 0.0001;
  if (s.endsWith('/JPY')) return 0.01;
  return 0.0001;
}
export const decimals = (symbol) => {
  const p = pipSize(symbol);
  return p >= 1 ? 2 : Math.min(5, Math.round(-Math.log10(p)) + 1);
};

// The four timeframes of the plan (4H is a line chart because that is how
// the levels are drawn), then every other timeframe.
export const CHART_VIEWS = [
  { id: '4h', label: '4H', job: 'Support and resistance', interval: '4h', style: 'line', sec: 14400 },
  { id: '1h', label: '1H', job: 'Liquidity highs and lows', interval: '1h', style: 'candles', sec: 3600 },
  { id: '15m', label: '15M', job: 'Retest and entry', interval: '15min', style: 'candles', sec: 900 },
  { id: '5m', label: '5M', job: 'Extra confirmation', interval: '5min', style: 'candles', sec: 300 },
];
export const MORE_VIEWS = [
  { id: '1m', label: '1m', interval: '1min', style: 'candles', sec: 60 },
  { id: '30m', label: '30m', interval: '30min', style: 'candles', sec: 1800 },
  { id: '45m', label: '45m', interval: '45min', style: 'candles', sec: 2700 },
  { id: '2h', label: '2H', interval: '2h', style: 'candles', sec: 7200 },
  { id: '1d', label: '1D', interval: '1day', style: 'candles', sec: 86400 },
  { id: '1w', label: '1W', interval: '1week', style: 'candles', sec: 604800 },
  { id: '1mo', label: '1M', interval: '1month', style: 'candles', sec: 2592000 },
];
export const ALL_VIEWS = [...CHART_VIEWS, ...MORE_VIEWS];

// Indicators drawn by the app. The free plan gets the first two.
export const INDICATORS = [
  { id: 'sma', label: 'Moving average (20)', free: true, pane: 'price' },
  { id: 'rsi', label: 'RSI (14)', free: true, pane: 'osc' },
  { id: 'ema', label: 'EMA (50)', free: false, pane: 'price' },
  { id: 'ema200', label: 'EMA (200)', free: false, pane: 'price' },
  { id: 'bb', label: 'Bollinger Bands (20, 2)', free: false, pane: 'price' },
  { id: 'macd', label: 'MACD (12, 26, 9)', free: false, pane: 'osc' },
  { id: 'stoch', label: 'Stochastic (14, 3)', free: false, pane: 'osc' },
  { id: 'atr', label: 'ATR (14)', free: false, pane: 'osc' },
];

/** Indicators actually drawn: the free plan keeps only free ones. */
export function allowedStudies(selected, pro) {
  const ids = new Set(INDICATORS.filter((i) => pro || i.free).map((i) => i.id));
  return (selected || []).filter((id) => ids.has(id));
}

export const COLOR_PRESETS = [
  { id: 'app', label: 'Match the site', theme: null },
  { id: 'black', label: 'Black', theme: 'dark', bg: '#000000', grid: '#161616' },
  { id: 'classic', label: 'Classic dark', theme: 'dark', bg: '#131722', grid: '#1f2433' },
  { id: 'navy', label: 'Navy', theme: 'dark', bg: '#0b1a2e', grid: '#14263f' },
  { id: 'white', label: 'White', theme: 'light', bg: '#ffffff', grid: '#f0f0f0' },
  { id: 'paper', label: 'Paper', theme: 'light', bg: '#f7f3ea', grid: '#ebe5d6' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** The colours to draw with: a preset, or the person's own background and grid. */
export function resolveColors(choice, siteTheme = 'dark') {
  const c = choice || { preset: 'app' };
  if (c.preset === 'custom' && HEX.test(c.bg || '') && HEX.test(c.grid || '')) {
    return { theme: c.theme === 'light' ? 'light' : 'dark', bg: c.bg, grid: c.grid };
  }
  const p = COLOR_PRESETS.find((x) => x.id === c.preset && x.theme);
  if (p) return { theme: p.theme, bg: p.bg, grid: p.grid };
  return siteTheme === 'light' ? { theme: 'light', bg: '#ffffff', grid: '#f0f0f0' } : { theme: 'dark', bg: '#000000', grid: '#161616' };
}
