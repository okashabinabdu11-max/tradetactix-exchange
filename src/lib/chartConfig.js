// Chart settings that do not touch the page: views, indicators, colours and
// the TradingView widget configuration. Pure, so it is unit tested.

export const CHART_SYMBOL = 'OANDA:XAUUSD';

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

export function widgetConfig(view, { pro = false, colors = resolveColors(null), studies = [] } = {}) {
  return {
    autosize: true,
    symbol: CHART_SYMBOL,
    interval: view.interval,
    style: view.style,
    timezone: 'Africa/Addis_Ababa',
    theme: colors.theme,
    locale: 'en',
    backgroundColor: colors.bg,
    gridColor: colors.grid,
    allow_symbol_change: false,
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

