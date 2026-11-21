// Turns the latest followed signal into what the website shows. Pure, so it is unit tested.
//
//   running   signal sent, still open             "+300 pips running"
//   be-moved  open, stop should be at breakeven    "Put BE"
//   tp        target reached                       "TP Done"
//   sl        stop-loss reached                    "SL hit"
//   be        came back to entry after Put BE      "Closed at breakeven"
//
// A finished trade stays on screen for 12 hours, then the page goes back to
// "Wait — the market setup is analyzing". Expired trades are never shown.

import { marketOf } from '../../src/lib/markets.js';

export const SHOW_RESULT_MS = 12 * 3600e3;

export function tradeView(row, livePrice, now = Date.now()) {
  if (!row || !['open', 'tp', 'sl', 'be'].includes(row.status)) return null;
  const symbol = marketOf(row.symbol).symbol;
  const base = {
    symbol,
    key: row.signal_key,
    direction: row.direction,
    entry: Number(row.entry),
    stop: Number(row.stop),
    target: Number(row.target),
    openedAt: row.opened_at,
  };
  if (row.status === 'open') {
    if (Date.parse(row.opened_at) > now) return null; // not live yet
    const dir = row.direction === 'buy' ? 1 : -1;
    const ok = Number.isFinite(livePrice);
    return {
      ...base,
      status: row.be_sent_at ? 'be-moved' : 'running',
      price: ok ? livePrice : null,
      pips: ok ? Math.round(((livePrice - base.entry) * dir) / marketOf(symbol).pip) : null,
    };
  }
  const closed = Date.parse(row.closed_at);
  if (!Number.isFinite(closed) || now - closed > SHOW_RESULT_MS) return null;
  return { ...base, status: row.status, pips: row.result_pips == null ? null : Math.round(Number(row.result_pips)), closedAt: row.closed_at };
}
