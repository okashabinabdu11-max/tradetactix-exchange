// POST /api/access-notify — Telegram notices for access requests.
//   { kind: 'request',  requestId }  sent by the requester: tells administrators
//   { kind: 'approved', requestId }  sent by an administrator: tells the member
//   { kind: 'payment',  requestId }  sent by the payer (requestId = the payment claim): tells administrators
//   { kind: 'chart_payment', requestId }  sent by the payer (requestId = the birr payment): tells administrators
// The caller's own sign-in decides what they may trigger; the database checks it.

import { bearerToken, getEntitlement } from './_lib/access.js';
import { telegram, serverRpc, SITE_URL } from './_lib/telegram.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://htycjrdyoysnudasqdop.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SEn6hnam_lE5yzk0mZQrYg_eVrh42Fn';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).send(JSON.stringify(body));
};
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  const token = bearerToken(req);
  const who = await getEntitlement(token);
  if (!who.signed_in) return send(res, 401, { error: 'sign_in' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const id = String(body?.requestId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['request', 'approved', 'payment', 'chart_payment'].includes(body?.kind)) return send(res, 400, { error: 'bad_request' });
  if (body.kind === 'approved' && !who.is_admin) return send(res, 403, { error: 'admins_only' });

  try {
    if (body.kind === 'chart_payment') {
      // Read the payment with the payer's own sign-in, so only its owner can trigger this.
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
      const [p] = await fetch(`${SUPABASE_URL}/rest/v1/etb_payments?id=eq.${id}&select=id,status,amount_etb,method,reference,plan_name,days`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => r.json());
      if (!p || p.status !== 'pending') return send(res, 404, { error: 'not_found' });
      const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => ({}));
      const text = `📈 New Chart Pro payment to review

Email: ${me?.email || 'member'}
Plan: ${p.plan_name} (${p.days} days)
Amount: ${Number(p.amount_etb).toFixed(2)} ETB
Method: ${p.method === 'cbe' ? 'CBE' : 'Telebirr'}
Reference: ${p.reference}

Check that the money arrived, then approve it in Admin: ${SITE_URL}/#/admin`;
      let sent = 0;
      for (const a of (await serverRpc('alerts_admin_chats', {})) || []) {
        await telegram('sendMessage', { chat_id: a.chat_id, text, disable_web_page_preview: true }).then(() => { sent += 1; }).catch(() => {});
      }
      return send(res, 200, { sent });
    }
    if (body.kind === 'payment') {
      // Read the claim with the payer's own sign-in, so only its owner can trigger this.
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
      const [claim] = await fetch(`${SUPABASE_URL}/rest/v1/payment_claims?id=eq.${id}&select=id,status,amount_usdt,network,tx_hash,user_id`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => r.json());
      if (!claim || claim.status !== 'pending') return send(res, 404, { error: 'not_found' });
      const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => ({}));
      const [net] = await fetch(`${SUPABASE_URL}/rest/v1/payment_networks?id=eq.${claim.network}&select=explorer_tx_url,label`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => []);
      const link = net?.explorer_tx_url ? `${net.explorer_tx_url}${claim.tx_hash}` : claim.tx_hash;
      const text = `💳 New Pro payment to review

Email: ${me?.email || 'member'}
Amount: ${Number(claim.amount_usdt).toFixed(2)} USDT
Network: ${net?.label || claim.network}
Transaction: ${link}

Check and approve it in Admin: ${SITE_URL}/#/admin`;
      let sent = 0;
      for (const a of (await serverRpc('alerts_admin_chats', {})) || []) {
        await telegram('sendMessage', { chat_id: a.chat_id, text, disable_web_page_preview: true }).then(() => { sent += 1; }).catch(() => {});
      }
      return send(res, 200, { sent });
    }
    // The caller must be able to see the request: its owner, or an administrator.
    const seen = await fetch(`${SUPABASE_URL}/rest/v1/access_requests?id=eq.${id}&select=id,status`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000),
    }).then((r) => r.json());
    if (!Array.isArray(seen) || !seen.length) return send(res, 404, { error: 'not_found' });

    const [info] = await serverRpc('alerts_request_info', { p_request: id });
    if (!info) return send(res, 404, { error: 'not_found' });
    let sent = 0;
    if (body.kind === 'request' && info.status === 'pending') {
      const admins = await serverRpc('alerts_admin_chats', {});
      for (const a of admins || []) {
        await telegram('sendMessage', { chat_id: a.chat_id, text: `New signal access request\n\nEmail: ${info.email}\nTelegram: @${info.telegram_username}\n\nApprove it in Admin: ${SITE_URL}/#/admin`, disable_web_page_preview: true }).then(() => { sent += 1; }).catch(() => {});
      }
    }
    if (body.kind === 'approved' && info.status === 'approved' && info.chat_id) {
      await telegram('sendMessage', { chat_id: info.chat_id, text: `Your TradeTactix signal access is approved until ${when(info.granted_until)} (Ethiopia time). You will get BUY and SELL alerts here until then.`, disable_web_page_preview: true }).then(() => { sent += 1; }).catch(() => {});
    }
    return send(res, 200, { sent });
  } catch (err) {
    console.error('access-notify failed', err?.message);
    return send(res, 200, { sent: 0 }); // a missed notice must never block the request itself
  }
}
