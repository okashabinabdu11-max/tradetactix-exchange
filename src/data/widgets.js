// Settings for the TradingView widgets on the Analysis page.

export const CALENDAR_CONFIG = Object.freeze({
  colorTheme: 'dark',
  isTransparent: true,
  locale: 'en',
  width: '100%',
  height: '100%',
  importanceFilter: '0,1', // medium and high impact only
  countryFilter: 'us', // gold is priced in US dollars
});

export const NEWS_CONFIG = Object.freeze({
  feedMode: 'symbol',
  symbol: 'OANDA:XAUUSD',
  displayMode: 'regular',
  colorTheme: 'dark',
  isTransparent: true,
  locale: 'en',
  width: '100%',
  height: '100%',
});
