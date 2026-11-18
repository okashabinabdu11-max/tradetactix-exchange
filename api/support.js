// POST /api/support — the support chat.
//   { action: 'ask',   messages: [{ role, content }] }        → { reply }
//   { action: 'human', contact, message, messages?, page? }   → { sent }  (Telegram to the admins)
// The AI runs through Vercel AI Gateway with this deployment's own OIDC token: no key to manage.

import { bearerToken, accountEmail } from './_lib/access.js';
import { telegram, serverRpc } from './_lib/telegram.js';
import { MODELS, SYSTEM_PROMPT, AI_PER_HOUR, HUMAN_PER_HOUR, MAX_CHARS, sanitizeMessages, makeLimiter, adminNotice } from './_lib/support.js';

const aiLimit = makeLimiter(AI_PER_HOUR);
const humanLimit = makeLimiter(HUMAN_PER_HOUR);

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).send(JSON.stringify(body));
};
const gatewayToken = (req) => req.headers['x-vercel-oidc-token'] || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

// Whether AI Gateway accepts this deployment and has credit left. Does not run the model.
async function aiReady(req) {
  const token = gatewayToken(req);
  if (!token) return false;
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/credits', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    const c = r.ok ? await r.json() : null;
    return Number(c?.balance) > 0;
  } catch { return false; }
}
// Google Gemini (free key from aistudio.google.com, no card) first when GEMINI_API_KEY is set,
// then Vercel AI Gateway. Both speak the same OpenAI-style chat format.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'].filter(Boolean);
function aiProviders(req) {
  const list = [];
  if (process.env.GEMINI_API_KEY) for (const model of GEMINI_MODELS) list.push({ url: GEMINI_URL, key: process.env.GEMINI_API_KEY, model });
  const token = gatewayToken(req);
  if (token) for (const model of MODELS) list.push({ url: 'https://ai-gateway.vercel.sh/v1/chat/completions', key: token, model });
  return list;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

export default async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { ai: process.env.GEMINI_API_KEY ? 'ready' : await aiReady(req) ? 'ready' : 'unavailable', provider: process.env.GEMINI_API_KEY ? 'gemini' : 'vercel' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_request' });
  const ip = ipOf(req);

  if (body.action === 'human') {
    const contact = String(body.contact || '').trim().slice(0, 100);
    const message = String(body.message || '').trim().slice(0, MAX_CHARS);
    if (!contact || !message) return send(res, 400, { error: 'missing_fields' });
    if (!humanLimit(ip)) return send(res, 429, { error: 'rate_limited' });
    const email = await accountEmail(bearerToken(req));
    const text = adminNotice({ contact, message, email, page: String(body.page || '').slice(0, 40), transcript: sanitizeMessages(body.messages) });
    try {
      const admins = await serverRpc('alerts_admin_chats', {});
      let sent = 0;
      for (const a of admins || []) {
        await telegram('sendMessage', { chat_id: a.chat_id, text, disable_web_page_preview: true }).then(() => { sent += 1; }).catch(() => {});
      }
      return send(res, sent ? 200 : 503, sent ? { sent } : { error: 'no_admin_chat' });
    } catch (err) {
      console.error('support human failed', err?.message);
      return send(res, 503, { error: 'unavailable' });
    }
  }

  if (body.action !== 'ask') return send(res, 400, { error: 'bad_request' });
  const messages = sanitizeMessages(body.messages);
  if (!messages.length) return send(res, 400, { error: 'empty' });
  if (!aiLimit(ip)) return send(res, 429, { error: 'rate_limited' });

  const providers = aiProviders(req);
  if (!providers.length) return send(res, 503, { error: 'ai_unavailable' });
  try {
    // Try each model until one answers. A model the account cannot use (not in the
    // free tier, unknown name) answers 400/403/404; move on to the next one.
    for (const { url, key, model } of providers) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        // Gemini models think before answering and that counts toward max_tokens: keep thinking low and leave room.
        body: JSON.stringify({ model, temperature: 0.3, ...(url === GEMINI_URL ? { max_tokens: 1500, reasoning_effort: 'low' } : { max_tokens: 450 }), messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages] }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await r.json().catch(() => null);
      const reply = data?.choices?.[0]?.message?.content;
      if (r.ok && typeof reply === 'string' && reply.trim()) return send(res, 200, { reply: reply.trim().slice(0, 4000) });
      const why = String(data?.error?.message || data?.[0]?.error?.message || data?.error || '');
      console.error('support ai failed', model, r.status, why.slice(0, 300));
      // 400/403/404/429: this model is not usable right now, try the next one.
      // Vercel's "credit card on file" refusal covers all its models, and they come last: stop.
      if (/credit card/i.test(why)) break;
      if (![400, 403, 404, 429].includes(r.status)) break;
    }
    return send(res, 503, { error: 'ai_unavailable' });
  } catch (err) {
    console.error('support ai error', err?.message);
    return send(res, 503, { error: 'ai_unavailable' });
  }
}
