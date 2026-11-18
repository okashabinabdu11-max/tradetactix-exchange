// POST /api/telegram-webhook — messages sent to the bot.
//   /start CODE   links this chat to the account that made the code
//   /stop         stops alerts to this chat
// Telegram proves each call with a secret header set when the webhook was registered.

import { sameSecret, webhookSecret, telegram, serverRpc, SITE_URL } from './_lib/telegram.js';

const ok = (res) => { res.setHeader('Content-Type', 'application/json'); res.status(200).send('{"ok":true}'); };
const reply = (chat, text) => telegram('sendMessage', { chat_id: chat, text, disable_web_page_preview: true }).catch((e) => console.error('reply failed', e.message));

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send(''); }
  if (!sameSecret(String(req.headers?.['x-telegram-bot-api-secret-token'] || ''), webhookSecret() || '')) return res.status(403).send('');

  let update = req.body;
  if (typeof update === 'string') { try { update = JSON.parse(update); } catch { update = null; } }
  const msg = update?.message;
  const chat = msg?.chat?.id;
  // Only private chats; ignore groups and anything without text.
  if (!msg || msg.chat?.type !== 'private' || !Number.isSafeInteger(chat) || typeof msg.text !== 'string') return ok(res);
  const text = msg.text.trim();

  try {
    const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z2-9]{10}))?$/.exec(text);
    if (start && start[1]) {
      const r = await serverRpc('alerts_link_chat', { p_code: start[1], p_chat_id: chat });
      if (!r?.linked) await reply(chat, `That link has expired. Open ${SITE_URL}/#/plans and tap Connect Telegram again.`);
      else if (r.pro) await reply(chat, 'Connected. You will get a message here when a BUY or SELL signal appears. Send /stop to turn alerts off.');
      else await reply(chat, `Connected, but alerts are for Pro members. You will start getting them once your account is on Pro: ${SITE_URL}/#/plans`);
    } else if (start) {
      await reply(chat, `To get alerts, open ${SITE_URL}/#/plans, sign in, and tap Connect Telegram.`);
    } else if (/^\/stop(?:@\w+)?$/.test(text)) {
      await serverRpc('alerts_unlink_chat', { p_chat_id: chat });
      await reply(chat, 'Alerts are off for this chat. Connect again from the Plans page any time.');
    } else {
      await reply(chat, 'This bot only sends TradeTactix alerts. Send /stop to turn them off.');
    }
  } catch (err) {
    console.error('webhook failed', err?.message);
  }
  return ok(res);
}
