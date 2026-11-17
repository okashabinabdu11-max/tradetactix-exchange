// GET /api/alerts-run — called on a schedule by the database (pg_cron).
// Reads the signal; for a new BUY or SELL, sends one Telegram message to each
// linked Pro member. The database guarantees each signal is sent only once.

import { originOf, readSignal } from './_lib/engine.js';
import { signalKey } from './_lib/gate.js';
import { sameSecret, telegram, serverRpc, alertMessage } from './_lib/telegram.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  const given = req.headers?.['x-alerts-key'] || '';
  if (!sameSecret(String(given), process.env.ALERTS_SECRET || '')) return send(res, 403, { error: 'forbidden' });
  const origin = originOf(req);
  if (!origin) return send(res, 400, { error: 'bad_host' });

  let signal;
  try {
    signal = await readSignal(origin);
  } catch (err) {
    return send(res, 200, { state: 'offline', reason: err?.code || 'unavailable' });
  }
  if (signal.state !== 'buy' && signal.state !== 'sell') return send(res, 200, { state: signal.state, sent: 0 });

  const key = signalKey(signal);
  try {
    const rows = await serverRpc('alerts_claim_signal', { p_key: key, p_state: signal.state });
    const chats = (rows || []).map((r) => r.chat_id);
    if (!chats.length) return send(res, 200, { state: signal.state, key, sent: 0, note: 'already sent or no linked Pro members' });
    const text = alertMessage(signal);
    let sent = 0;
    for (const chat of chats) {
      try {
        await telegram('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });
        sent += 1;
      } catch (err) {
        // A user who blocked the bot is unlinked so we stop trying.
        if (err.status === 403) await serverRpc('alerts_unlink_chat', { p_chat_id: chat }).catch(() => {});
        else console.error('alert send failed', err.message);
      }
    }
    await serverRpc('alerts_record_sent', { p_key: key, p_count: sent }).catch(() => {});
    return send(res, 200, { state: signal.state, key, sent });
  } catch (err) {
    console.error('alerts run failed', err?.message);
    return send(res, 502, { error: 'alerts_failed' });
  }
}
