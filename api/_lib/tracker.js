// Follows a sent signal through the 15M candles that came after it.
// Pure, so it is unit tested. Gold pips: 1 pip = 0.10 dollars of price.
//
//   Before BE: stop hit -> "sl"; target hit -> "tp"; price reaches 1R in profit -> "be_move"
//   After BE:  price back at entry -> "be" (closed at breakeven); target hit -> "tp"
//   Nothing after 48 hours -> "expired"
// If one candle touches both the stop and the target, the stop is assumed first.

export const PIP = 0.1;
export const EXPIRE_MS = 48 * 3600e3;
export const pips = (priceDistance) => Math.round((priceDistance / PIP) * 10) / 10;

export function nextEvent(trade, candles, now = Date.now()) {
  const long = trade.direction === 'buy';
  const entry = Number(trade.entry);
  const stop = Number(trade.stop);
  const target = Number(trade.target);
  const risk = Math.abs(entry - stop);
  const opened = new Date(trade.opened_at).getTime();
  let beDone = Boolean(trade.be_sent_at);
  const beSince = beDone ? new Date(trade.be_sent_at).getTime() - 15 * 60e3 : null;

  const reached = (c, price) => (long ? c.h >= price : c.l <= price);
  const fellTo = (c, price) => (long ? c.l <= price : c.h >= price);

  for (const c of candles) {
    const t = new Date(c.t).getTime();
    if (t < opened) continue;
    if (!beDone) {
      if (fellTo(c, stop)) return { event: 'sl', pips: -pips(risk), price: stop };
      if (reached(c, target)) return { event: 'tp', pips: pips(Math.abs(target - entry)), price: target };
      if (reached(c, long ? entry + risk : entry - risk)) return { event: 'be_move', pips: pips(risk), price: entry };
    } else if (t >= beSince) {
      if (reached(c, target)) return { event: 'tp', pips: pips(Math.abs(target - entry)), price: target };
      if (fellTo(c, entry)) return { event: 'be', pips: 0, price: entry };
    }
  }
  if (now - opened > EXPIRE_MS) return { event: 'expired', pips: null, price: null };
  return null;
}

const p2 = (n) => Number(n).toFixed(2);

export function eventMessage(trade, ev) {
  const side = trade.direction === 'buy' ? 'BUY' : 'SELL';
  const head = `XAUUSD ${side} (entry ${p2(trade.entry)})`;
  switch (ev.event) {
    case 'be_move':
      return `🟡 <b>Put BE</b>: ${head}\n\nPrice is up ${ev.pips} pips (1:1). Move your stop-loss to breakeven at <b>${p2(trade.entry)}</b>, so this trade can no longer lose.`;
    case 'tp':
      return `✅ <b>TP Done</b>: ${head}\n\nTake-profit ${p2(trade.target)} hit. <b>+${ev.pips} pips smashed</b> 🎯`;
    case 'sl':
      return `❌ <b>SL hit</b>: ${head}\n\nStop-loss ${p2(trade.stop)} hit: <b>${ev.pips} pips</b>. The setup failed; wait for the next one.`;
    case 'be':
      return `⚪ <b>Closed at breakeven</b>: ${head}\n\nPrice came back to ${p2(trade.entry)} after BE: <b>0 pips</b>, no loss.`;
    case 'expired':
      return `⏱ <b>No result after 48 hours</b>: ${head}\n\nNeither the take-profit nor the stop-loss was hit. Manage this trade yourself.`;
    default:
      return '';
  }
}
