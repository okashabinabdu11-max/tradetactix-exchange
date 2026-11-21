// GET /api/alerts-run — called every 5 minutes by the database (pg_cron).
// Steps 1 and 2 run for every market (XAUUSD and BTCUSD); one market being
// unavailable (gold at the weekend) never stops the other.
//   1. A new BUY or SELL is sent once to every member with access.
//   2. Every open signal is followed: "Put BE", "TP Done", "SL hit",
//      "Closed at breakeven" or "no result after 48 hours", each sent once.
//   3. Before high-impact US news: an expectation for gold, sent once in the hour before.
//   4. Weekly results to the channel, access-ending reminders, the daily admin report.
// Members whose access has ended receive nothing.

import { originOf, readMarket } from './_lib/engine.js';
import { MARKET_LIST } from '../src/lib/markets.js';
import { signalKey } from './_lib/gate.js';
import { sameSecret, telegram, serverRpc, alertMessage } from './_lib/telegram.js';
import { nextEvent, eventMessage } from './_lib/tracker.js';
import { runNews } from './_lib/newsRun.js';
import { runReports } from './_lib/reports.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Telegram allows about 30 messages a second to different chats: send 25 at a time, a second apart. */
export async function broadcast(chats, text) {
  let sent = 0;
  for (let i = 0; i < chats.length; i += 25) {
    if (i) await pause(1100);
    const batch = chats.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map((chat) => telegram('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true })));
    for (let j = 0; j < results.length; j += 1) {
      const r = results[j];
      if (r.status === 'fulfilled') sent += 1;
      else if (r.reason?.status === 403) await serverRpc('alerts_unlink_chat', { p_chat_id: batch[j] }).catch(() => {});
      else console.error('send failed', r.reason?.message);
    }
  }
  return sent;
}

export default async function handler(req, res) {
  const given = req.headers?.['x-alerts-key'] || '';
  if (!sameSecret(String(given), process.env.ALERTS_SECRET || '')) return send(res, 403, { error: 'forbidden' });
  const origin = originOf(req);
  if (!origin) return send(res, 400, { error: 'bad_host' });

  const out = { markets: {}, updates: [] };
  const candles = {};
  const read = await Promise.allSettled(MARKET_LIST.map((symbol) => readMarket(origin, 3, symbol)));

  try {
    // 1. New signals, one market at a time
    for (let i = 0; i < MARKET_LIST.length; i += 1) {
      const symbol = MARKET_LIST[i];
      if (read[i].status !== 'fulfilled') { out.markets[symbol] = { state: 'offline', reason: read[i].reason?.code || 'unavailable' }; continue; }
      const { signal, m5 } = read[i].value;
      candles[symbol] = m5;
      const mk = { state: signal.state, sent: 0 };
      out.markets[symbol] = mk;
      if (signal.state !== 'buy' && signal.state !== 'sell') continue;
      const key = signalKey(signal);
      const opened = signal.filledAt || new Date(new Date(signal.confirmedAt).getTime() + 15 * 60e3).toISOString();
      // Tracking is optional: the signal still goes out. Gold uses the original call.
      const track = { p_key: key, p_direction: signal.state, p_entry: signal.entry, p_stop: signal.stop, p_target: signal.target, p_opened_at: opened };
      await serverRpc('alerts_open_trade', symbol === 'XAUUSD' ? track : { ...track, p_symbol: symbol }).catch(() => null);
      const rows = await serverRpc('alerts_claim_signal', { p_key: key, p_state: signal.state });
      const chats = (rows || []).map((r) => r.chat_id);
      if (chats.length) {
        mk.sent = await broadcast(chats, alertMessage(signal));
        await serverRpc('alerts_record_sent', { p_key: key, p_count: mk.sent }).catch(() => {});
      }
      mk.key = key;
    }

    out.state = out.markets.XAUUSD?.state ?? 'offline'; // gold's state, as before

    // 2. Follow open signals, each with its own market's candles
    const open = await serverRpc('alerts_open_trades', {}).catch(() => []);
    if (open?.length) {
      let members = null;
      for (const trade of open) {
        const m5 = candles[trade.symbol || 'XAUUSD'];
        if (!m5) continue; // that market's candles are unavailable this run
        const ev = nextEvent(trade, m5);
        if (!ev) continue;
        const first = await serverRpc('alerts_trade_event', { p_key: trade.signal_key, p_event: ev.event, p_pips: ev.pips });
        if (!first) continue;
        if (!members) members = ((await serverRpc('alerts_member_chats', {})) || []).map((r) => r.chat_id);
        const n = members.length ? await broadcast(members, eventMessage(trade, ev)) : 0;
        out.updates.push({ key: trade.signal_key, event: ev.event, pips: ev.pips, sent: n });
      }
    }
  } catch (err) {
    console.error('alerts run failed', err?.message);
    out.error = 'alerts_failed';
  }
  // 3. News (independent of the signal steps above)
  out.news = await runNews({ origin, broadcast }).catch((e) => ({ error: String(e?.message || e).slice(0, 120) }));
  // 4. Scheduled posts
  out.reports = await runReports().catch((e) => ({ error: String(e?.message || e).slice(0, 120) }));
  return send(res, out.error ? 502 : 200, out);
}
