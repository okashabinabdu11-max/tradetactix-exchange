// Chart settings that do not touch the page: views, indicators, colours and
// the TradingView widget configuration. Pure, so it is unit tested.

export const CHART_SYMBOL = 'OANDA:XAUUSD';

// Pairs to pick from. Any other TradingView symbol can be typed in too.
const fx = (list) => list.map((p) => ({ id: `FX:${p}`, label: `${p.slice(0, 3)}/${p.slice(3)}` }));
export const SYMBOL_GROUPS = [
  { label: 'Metals', items: [{ id: 'OANDA:XAUUSD', label: 'XAU/USD (Gold)' }, { id: 'OANDA:XAGUSD', label: 'XAG/USD (Silver)' }, { id: 'OANDA:XPTUSD', label: 'XPT/USD (Platinum)' }] },
  { label: 'Major pairs', items: fx(['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD']) },
  { label: 'Cross pairs', items: fx(['EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'EURAUD', 'EURCAD', 'EURNZD', 'GBPCHF', 'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDJPY', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'NZDJPY', 'NZDCAD', 'NZDCHF', 'CADJPY', 'CADCHF', 'CHFJPY']) },
  { label: 'Exotic pairs', items: fx(['USDZAR', 'USDTRY', 'USDMXN', 'USDSGD', 'USDHKD', 'USDNOK', 'USDSEK', 'USDPLN', 'EURTRY']) },
  { label: 'Indices', items: [{ id: 'OANDA:NAS100USD', label: 'US Tech 100' }, { id: 'OANDA:SPX500USD', label: 'US 500' }, { id: 'OANDA:US30USD', label: 'US 30' }, { id: 'OANDA:DE30EUR', label: 'Germany 40' }, { id: 'OANDA:UK100GBP', label: 'UK 100' }, { id: 'OANDA:JP225USD', label: 'Japan 225' }] },
  { label: 'Oil', items: [{ id: 'TVC:USOIL', label: 'US Oil (WTI)' }, { id: 'TVC:UKOIL', label: 'UK Oil (Brent)' }] },
  { label: 'Crypto', items: [{ id: 'BITSTAMP:BTCUSD', label: 'BTC/USD' }, { id: 'BITSTAMP:ETHUSD', label: 'ETH/USD' }, { id: 'BINANCE:SOLUSDT', label: 'SOL/USDT' }, { id: 'BINANCE:XRPUSDT', label: 'XRP/USDT' }, { id: 'BINANCE:BNBUSDT', label: 'BNB/USDT' }] },
];
export const ALL_SYMBOLS = SYMBOL_GROUPS.flatMap((g) => g.items);

/** A symbol as typed: "EURUSD", "fx:eurusd" or "BINANCE:BTCUSDT". Null when it cannot be a symbol. */
export function cleanSymbol(input) {
  const s = String(input || '').trim().toUpperCase().replace(/\s+/g, '').replace('/', '');
  if (!/^([A-Z0-9_]{1,20}:)?[A-Z0-9._!]{2,30}$/.test(s)) return null;
  if (s.includes(':')) return s;
  const known = ALL_SYMBOLS.find((x) => x.id.split(':')[1] === s);
  return known ? known.id : s;
}

// One view per step of the plan. 4H is a line chart because that is how the
// levels are drawn; the others are candles.
export const CHART_VIEWS = [
  { id: '4h', label: '4H', job: 'Support and resistance', interval: '240', style: '2' },
  { id: '1h', label: '1H', job: 'Liquidity highs and lows', interval: '60', style: '1' },
  { id: '15m', label: '15M', job: 'Retest and entry', interval: '15', style: '1' },
  { id: '5m', label: '5M', job: 'Extra confirmation', interval: '5', style: '1' },
];

// TradingView indicator ids. The free plan gets the first two.
export const INDICATORS = [
  { id: 'MASimple@tv-basicstudies', label: 'Moving average', free: true },
  { id: 'RSI@tv-basicstudies', label: 'RSI', free: true },
  { id: 'MAExp@tv-basicstudies', label: 'EMA', free: false },
  { id: 'MACD@tv-basicstudies', label: 'MACD', free: false },
  { id: 'BB@tv-basicstudies', label: 'Bollinger Bands', free: false },
  { id: 'StochasticRSI@tv-basicstudies', label: 'Stochastic RSI', free: false },
  { id: 'IchimokuCloud@tv-basicstudies', label: 'Ichimoku Cloud', free: false },
  { id: 'ATR@tv-basicstudies', label: 'ATR', free: false },
  { id: 'VWAP@tv-basicstudies', label: 'VWAP', free: false },
  { id: 'PivotPointsStandard@tv-basicstudies', label: 'Pivot points', free: false },
];

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

/** Indicators actually drawn: the free plan keeps only free ones. */
export function allowedStudies(selected, pro) {
  const ids = new Set(INDICATORS.filter((i) => pro || i.free).map((i) => i.id));
  return (selected || []).filter((id) => ids.has(id));
}

export function widgetConfig(view, { pro = false, colors = resolveColors(null), studies = [], symbol = CHART_SYMBOL } = {}) {
  return {
    autosize: true,
    symbol: cleanSymbol(symbol) || CHART_SYMBOL,
    interval: view.interval,
    style: view.style,
    timezone: 'Africa/Addis_Ababa',
    theme: colors.theme,
    locale: 'en',
    backgroundColor: colors.bg,
    gridColor: colors.grid,
    // Chart Pro can also search any symbol from TradingView's own toolbar.
    allow_symbol_change: pro,
    // Chart Pro: TradingView's own toolbars with every drawing tool and indicator.
    hide_top_toolbar: !pro,
    hide_side_toolbar: !pro,
    hide_legend: false,
    withdateranges: true,
    save_image: pro,
    calendar: false,
    studies: allowedStudies(studies, pro),
    support_host: 'https://www.tradingview.com',
  };
}

