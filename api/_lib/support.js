// Support chat helpers. Pure where possible, so they are unit tested.

// Tried in order: if one is not available on this account (for example not in the
// free tier), the next is used. SUPPORT_MODEL in Vercel can put a preferred model first.
export const MODELS = [process.env.SUPPORT_MODEL, 'anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-4.5', 'google/gemini-3.7-flash', 'openai/gpt-5-nano', 'deepseek/deepseek-v4-flash'].filter(Boolean);
export const MODEL = MODELS[0];
export const ADMIN_TELEGRAM = 'Tradetactix1';
export const MAX_TURNS = 12;      // messages of history sent to the AI
export const MAX_CHARS = 800;     // per message
export const AI_PER_HOUR = 30;    // per visitor (best effort, per server instance)
export const HUMAN_PER_HOUR = 3;

export const SYSTEM_PROMPT = `You are the support assistant for TradeTactix AI, a website that sends XAUUSD (gold) trading signals to approved members on Telegram. Answer questions about using the website and the service. Be short, friendly and clear (2-6 sentences, or short steps). Reply in the language the person writes in (for example English or Amharic).

Facts you can rely on:
- Website: https://tradetactix-exchange.vercel.app . It opens on a homepage with Sign up, Sign in and Dashboard. Light/dark theme: the sun/moon button at the top.
- How to join: 1) Sign up with email and password (at least 8 characters) on the homepage. 2) Open Plans, enter your Telegram username and tap Request access. 3) Connect Telegram on the Plans page (open the bot and press Start). 4) The admin approves you for a set time (24 hours, 7 days, 30 days or a custom time). Access stops automatically when the time ends. There is no online payment on the site; access is only by admin approval.
- Until approved, people see a "Get approved to receive signals" screen instead of the signal pages.
- The method: 4H line-chart support and resistance, 1H liquidity highs/lows, 15M retest and entry confirmation; 5M is an optional extra check. A signal is only sent when all required steps line up, with at least 1:3 reward-to-risk and a stop-loss of 9 dollars or less at 0.01 lot.
- Each signal has entry, stop-loss and take-profit. Gold: 1 pip = 0.10 dollars.
- Dashboard colours: yellow = "Wait — the market setup is analyzing" (no signal now); orange = signal sent / running with live pips; blue = "Put BE" (move stop-loss to the entry price) or closed at breakeven; green = "TP Done" with pips smashed; red = "SL hit". Results stay for 12 hours. The live price updates about every 5 minutes.
- Telegram sends the signal, then "Put BE", then "TP Done" or "SL hit".
- The journal (Journal, History, Analytics, Calendar, Discipline) is for approved members to log their own trades. The Risk page sizes a position from balance and risk percent.
- The site never places trades and is not connected to anyone's broker account. Live trading is locked.

Rules:
- Never say whether to buy or sell now, never predict price, and never invent a current signal, price or result: you cannot see the market. Point people to the Dashboard and Telegram.
- Not financial advice: if asked for personal investment advice, say you cannot give it and that trading gold carries a real risk of loss.
- You cannot see or change accounts, approvals or Telegram links. For big problems (approval or access problems, cannot sign in, missing or wrong Telegram messages, anything about money, a bug on the site, or anything you cannot answer), tell them to message the admin directly on Telegram at @Tradetactix1 (https://t.me/Tradetactix1), or to use the "Message the admin" form below the chat.
- Do not make up features, prices or promises. If you do not know, say so and point them to @Tradetactix1 on Telegram.`;

const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, MAX_CHARS);

/** Keeps only valid user/assistant turns, the last MAX_TURNS, starting with a user turn. */
export function sanitizeMessages(list) {
  if (!Array.isArray(list)) return [];
  const out = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: clean(m.content) }))
    .filter((m) => m.content)
    .slice(-MAX_TURNS);
  while (out.length && out[0].role !== 'user') out.shift();
  return out.length && out[out.length - 1].role === 'user' ? out : [];
}

/** A tiny per-key sliding window. Not shared between server instances: a speed bump, not a wall. */
export function makeLimiter(limit, windowMs = 3600e3) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= limit) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

export function adminNotice({ contact, message, email, page, transcript }) {
  const lines = ['🆘 Support request', ''];
  if (email) lines.push(`Account: ${email}`);
  lines.push(`Contact: ${contact}`);
  if (page) lines.push(`Page: ${page}`);
  lines.push('', message);
  const asked = (transcript || []).filter((m) => m.role === 'user').slice(-3).map((m) => `• ${m.content.slice(0, 200)}`);
  if (asked.length) lines.push('', 'Asked the AI:', ...asked);
  return lines.join('\n').slice(0, 3500);
}
