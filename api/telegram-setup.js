// POST /api/telegram-setup — administrators only. Registers this site as the
// bot's webhook and saves the bot's username so users can find it.

import { bearerToken, getEntitlement } from './_lib/access.js';
import { originOf } from './_lib/engine.js';
import { telegram, webhookSecret } from './_lib/telegram.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://htycjrdyoysnudasqdop.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SEn6hnam_lE5yzk0mZQrYg_eVrh42Fn';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  const token = bearerToken(req);
  const who = await getEntitlement(token);
  if (!who.is_admin) return send(res, 403, { error: 'admins_only' });
  if (!process.env.TELEGRAM_BOT_TOKEN) return send(res, 422, { error: 'no_bot', message: 'Add TELEGRAM_BOT_TOKEN to the server settings first.' });
  if (!webhookSecret()) return send(res, 422, { error: 'no_secret', message: 'Add ALERTS_SECRET to the server settings first.' });
  const origin = originOf(req);
  if (!origin) return send(res, 400, { error: 'bad_host' });

  try {
    const me = await telegram('getMe', {});
    await telegram('setWebhook', { url: `${origin}/api/telegram-webhook`, secret_token: webhookSecret(), allowed_updates: ['message'], drop_pending_updates: true });
    await telegram('setMyCommands', { commands: [{ command: 'stop', description: 'Turn alerts off' }] }).catch(() => {});
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_set_telegram_bot`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_username: me.username }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      const detail = await r.json().catch(() => null);
      return send(res, 502, { error: 'db_error', message: `The bot works, but saving its name failed: ${String(detail?.message || r.status).slice(0, 200)}` });
    }
    return send(res, 200, { username: me.username, webhook: `${origin}/api/telegram-webhook` });
  } catch (err) {
    return send(res, 502, { error: 'telegram_error', message: `Telegram said: ${String(err?.message || 'unknown error').slice(0, 200)}` });
  }
}
