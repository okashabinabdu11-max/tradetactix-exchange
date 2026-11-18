// Replays the TradeTactix plan over real past candles, the way the live bot
// would have seen them: at each closed 15M candle the engine runs on only the
// candles that existed then. A BUY or SELL opens one trade at a time, and the
// same tracker as the live bot follows it to TP, SL, breakeven or 48 hours.
// The news pause is not replayed (past calendars are not stored).

import { evaluate } from '../../src/lib/signals.js';
import { nextEvent, EXPIRE_MS } from './tracker.js';

const M15 = 15 * 60e3;
const ms = (c) => new Date(c.t).getTime();

/** Index of the last candle that opened before `t` (candles sorted oldest first). */
function upto(list, t, from = 0) {
  let i = from;
  while (i < list.length && ms(list[i]) < t) i += 1;
  return i;
}

function follow(trade, m15, startIdx, endMs) {
  const live = { ...trade, be_sent_at: null };
  let moved = false;
  for (let j = startIdx; j < m15.length; j += 1) {
    const now = ms(m15[j]) + M15;
    const ev = nextEvent(live, m15.slice(startIdx, j + 1), now);
    if (!ev) continue;
    if (ev.event === 'be_move') { if (!moved) { moved = true; live.be_sent_at = new Date(now).toISOString(); } continue; }
    return { ...ev, closedAt: new Date(now).toISOString(), moved };
  }
  if (endMs - new Date(trade.opened_at).getTime() > EXPIRE_MS) return { event: 'expired', pips: null, closedAt: null, moved };
  return { event: 'open', pips: null, closedAt: null, moved };
}

export function backtest({ h4, h1, m15, warmup = 120, minRewardToRisk = 3 }) {
  const trades = [];
  if (!m15?.length || !h1?.length || !h4?.length) return summarize(trades, null, null);
  const endMs = ms(m15[m15.length - 1]) + M15;
  let i4 = 0; let i1 = 0; let busyUntil = 0; let lastKey = '';
  const firstIdx = Math.min(warmup, m15.length - 1);
  for (let i = firstIdx; i < m15.length; i += 1) {
    const now = ms(m15[i]) + M15 + 1000; // just after this candle closed
    if (now <= busyUntil) continue;
    i4 = upto(h4, now, i4); i1 = upto(h1, now, i1);
    const s = evaluate({ h4: h4.slice(Math.max(0, i4 - 200), i4), h1: h1.slice(Math.max(0, i1 - 200), i1), m15: m15.slice(Math.max(0, i - 200), i + 1), now, minRewardToRisk });
    if (s.state !== 'buy' && s.state !== 'sell') continue;
    const key = `${s.state}-${s.confirmedAt}`;
    if (key === lastKey) continue;
    lastKey = key;
    const trade = { direction: s.state, entry: s.entry, stop: s.stop, target: s.target, rr: s.rr, opened_at: new Date(now).toISOString() };
    const out = follow(trade, m15, i + 1, endMs);
    trades.push({ ...trade, result: out.event, pips: out.pips, beMoved: out.moved, closedAt: out.closedAt });
    if (out.event === 'open') break;
    busyUntil = out.closedAt ? new Date(out.closedAt).getTime() : new Date(trade.opened_at).getTime() + EXPIRE_MS;
  }
  return summarize(trades, m15[firstIdx].t, m15[m15.length - 1].t);
}

export function summarize(trades, from, to) {
  const count = (r) => trades.filter((t) => t.result === r).length;
  const wins = count('tp'); const losses = count('sl'); const breakeven = count('be');
  const decided = wins + losses;
  const pips = Math.round(trades.reduce((s, t) => s + (Number.isFinite(t.pips) ? t.pips : 0), 0) * 10) / 10;
  return { from, to, trades, total: trades.length, wins, losses, breakeven, expired: count('expired'), open: count('open'), winRate: decided ? Math.round((wins / decided) * 1000) / 10 : null, pips };
}
