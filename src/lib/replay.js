// Bar replay practice: candles appear one at a time and the trader opens
// practice trades at the latest close. Nothing here touches a real account.

// Pairs that can be replayed (data from Twelve Data). TradingView id -> data symbol.
export const REPLAY_SYMBOLS = {
  'OANDA:XAUUSD': 'XAU/USD', 'OANDA:XAGUSD': 'XAG/USD',
  'BITSTAMP:BTCUSD': 'BTC/USD', 'BITSTAMP:ETHUSD': 'ETH/USD', 'BINANCE:SOLUSDT': 'SOL/USD', 'BINANCE:XRPUSDT': 'XRP/USD', 'BINANCE:BNBUSDT': 'BNB/USD',
};
const FX = /^FX:([A-Z]{3})([A-Z]{3})$/;

/** Data symbol for a chart symbol, or null when it cannot be replayed. */
export function replaySymbol(chartSymbol) {
  if (REPLAY_SYMBOLS[chartSymbol]) return REPLAY_SYMBOLS[chartSymbol];
  const m = FX.exec(chartSymbol || '');
  return m ? `${m[1]}/${m[2]}` : null;
}

export const REPLAY_INTERVALS = [
  { id: '5min', label: '5M' }, { id: '15min', label: '15M' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '1day', label: '1D' },
];

/** Size of one pip in price for a data symbol. */
export function pipSize(symbol) {
  const s = String(symbol || '');
  if (s === 'XAU/USD') return 0.1;
  if (s === 'XAG/USD') return 0.01;
  if (/^(BTC|ETH|SOL|BNB|XRP)\//.test(s)) return s.startsWith('XRP') ? 0.0001 : 1;
  if (s.endsWith('/JPY')) return 0.01;
  return 0.0001;
}

export const decimals = (symbol) => {
  const p = pipSize(symbol);
  return p >= 1 ? 2 : Math.min(5, Math.round(-Math.log10(p)) + 1);
};

const round1 = (n) => Math.round(n * 10) / 10;

/** A practice trade at `price`. slPips / tpPips are optional (0 or empty = none). */
export function openTrade({ side, price, time, slPips, tpPips, symbol, id }) {
  const pip = pipSize(symbol);
  const dir = side === 'buy' ? 1 : -1;
  const sl = Number(slPips) > 0 ? price - dir * Number(slPips) * pip : null;
  const tp = Number(tpPips) > 0 ? price + dir * Number(tpPips) * pip : null;
  return { id, side, entry: price, sl, tp, openedAt: time, closedAt: null, exit: null, result: null, pips: null };
}

export const pipsBetween = (trade, price, symbol) => round1(((price - trade.entry) * (trade.side === 'buy' ? 1 : -1)) / pipSize(symbol));

/**
 * Check a new candle against an open trade. When one candle touches both the
 * stop-loss and the take-profit, the stop-loss is counted (the order inside a
 * candle is unknown, so the result is never flattered).
 */
export function checkCandle(trade, candle, symbol) {
  if (trade.result) return trade;
  const buy = trade.side === 'buy';
  const hitSl = trade.sl !== null && (buy ? candle.l <= trade.sl : candle.h >= trade.sl);
  const hitTp = trade.tp !== null && (buy ? candle.h >= trade.tp : candle.l <= trade.tp);
  if (hitSl) return close(trade, trade.sl, candle.t, 'sl', symbol);
  if (hitTp) return close(trade, trade.tp, candle.t, 'tp', symbol);
  return trade;
}

export function close(trade, price, time, result, symbol) {
  return { ...trade, exit: price, closedAt: time, result, pips: pipsBetween(trade, price, symbol) };
}

export function replayStats(trades) {
  const done = trades.filter((t) => t.result);
  const wins = done.filter((t) => t.pips > 0).length;
  const losses = done.filter((t) => t.pips < 0).length;
  const pips = round1(done.reduce((s, t) => s + t.pips, 0));
  return { closed: done.length, wins, losses, winRate: wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 10 : null, pips };
}

/** Index to start the replay at: the first candle at or after `date`, leaving some history on screen. */
export function startIndex(candles, date, minHistory = 60) {
  if (!candles.length) return 0;
  const max = Math.max(0, candles.length - 2);
  if (!date) return Math.min(max, Math.max(minHistory, Math.floor(candles.length * 0.5)));
  const t = new Date(date).getTime();
  const i = candles.findIndex((c) => new Date(c.t).getTime() >= t);
  return Math.min(max, Math.max(Math.min(minHistory, max), i < 0 ? max : i));
}
