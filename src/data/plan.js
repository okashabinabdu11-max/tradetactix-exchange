// Single source of truth for the trading plan, the signal states, the app's
// sections and the build roadmap. Nothing in here is market data.

export const CURRENT_STAGE = 3;

export const STAGES = [
  { n: 1, title: 'Frontend foundation and dashboard', detail: 'App shell, navigation, dashboard layout and the risk calculator.' },
  { n: 2, title: 'Secure backend, sign-in and database', detail: 'Sign-in and saved risk limits, with access rules so only you can read them.' },
  { n: 3, title: 'Trade journal, history, analytics, calendar and discipline', detail: 'Log your trades yourself and see statistics, a P&L calendar and how well you kept your rules.' },
  { n: 4, title: 'Real-time XAUUSD price and TradingView chart', detail: 'A real price feed and the TradingView chart on the dashboard.' },
  { n: 5, title: 'Multi-timeframe analysis and signal engine', detail: '4H, 1H, 15M and 5M analysis producing BUY, SELL, waiting and no-setup states.' },
  { n: 6, title: 'Fundamental analysis', detail: 'Economic calendar and news events that affect gold.' },
  { n: 7, title: 'Free month, Pro plan, credits, USDT payments and admin site', detail: 'Plans for other users, payment by USDT with admin approval, and credits you can grant.' },
  { n: 8, title: 'Exness MT5 connection and automatic journal', detail: 'Read-only link to your account: balance, positions, and trades imported into the journal.' },
  { n: 9, title: 'AI trade reviews', detail: 'A written review of each closed trade against the plan.' },
  { n: 10, title: 'Authorised live execution', detail: 'Automatic order placement, only after you explicitly switch it on.' },
];

// Stage numbers by feature, so page text never hardcodes them.
export const STAGE_OF = Object.freeze({ data: 4, signals: 5, fundamentals: 6, plans: 7, mt5: 8, reviews: 9, live: 10 });

// Top-down order matters: each timeframe is checked after the one above it.
export const TIMEFRAMES = [
  { tf: '4H', job: 'Support and resistance', how: 'Drawn on the line chart to mark the zones price is trading between.', optional: false },
  { tf: '1H', job: 'Liquidity highs and lows', how: 'Finds the swing highs and lows where stop orders are resting.', optional: false },
  { tf: '15M', job: 'Retest and entry confirmation', how: 'Waits for price to retest the level and confirm before an entry.', optional: false },
  { tf: '5M', job: 'Extra confirmation', how: 'A finer look at the entry when the 15M picture is not decisive.', optional: true },
];

export const SIGNAL_STATES = [
  { id: 'offline', label: 'Offline', tone: 'muted', meaning: 'No market data is connected, so nothing is being analysed.' },
  { id: 'no-setup', label: 'No setup', tone: 'muted', meaning: 'Price is not at a 4H level or the timeframes disagree.' },
  { id: 'waiting', label: 'Waiting for confirmation', tone: 'gold', meaning: 'A level is in play and the 15M retest has not confirmed yet.' },
  { id: 'buy', label: 'Buy', tone: 'buy', meaning: 'All required timeframes agree on a long with at least 1:3.' },
  { id: 'sell', label: 'Sell', tone: 'sell', meaning: 'All required timeframes agree on a short with at least 1:3.' },
];

export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', stage: 1 },
  { id: 'chart', label: 'Chart', icon: 'chart', stage: 4, summary: 'The TradingView XAUUSD chart with your 4H levels and 1H liquidity marked on it.' },
  { id: 'analysis', label: 'Analysis', icon: 'layers', stage: 5, summary: 'The 4H, 1H, 15M and 5M read of the market, followed in Stage 6 by the economic calendar and news that move gold.' },
  { id: 'signals', label: 'Signals', icon: 'signal', stage: 5, summary: 'BUY and SELL signals with entry, stop-loss and take-profit, plus the waiting and no-setup states. Nothing below 1:3 is shown as a signal.' },
  { id: 'risk', label: 'Risk', icon: 'shield', stage: 1 },
  { id: 'journal', label: 'Journal', icon: 'book', stage: 3 },
  { id: 'history', label: 'History', icon: 'clock', stage: 3 },
  { id: 'analytics', label: 'Analytics', icon: 'bars', stage: 3 },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', stage: 3 },
  { id: 'reviews', label: 'AI reviews', icon: 'spark', stage: 9, summary: 'A written review of each closed trade: what followed the plan and what did not.' },
  { id: 'discipline', label: 'Discipline', icon: 'target', stage: 3 },
  { id: 'account', label: 'Exness MT5', icon: 'link', stage: 8, summary: 'Connect your Exness MT5 account to show balance, open positions and trade history. The connection starts read-only.' },
  { id: 'profile', label: 'Profile', icon: 'user', stage: 2 },
  { id: 'system', label: 'System', icon: 'gear', stage: 1 },
];

export const sectionById = (id) => SECTIONS.find((s) => s.id === id);
