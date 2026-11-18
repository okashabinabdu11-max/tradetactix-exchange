// One way to ask the AI, shared by the support chat and the news outlook.
// Google Gemini (free key, no card) first when GEMINI_API_KEY is set, then
// Vercel AI Gateway. Both speak the same OpenAI-style chat format.

import { MODELS } from './support.js';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const geminiModels = () => [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'].filter(Boolean);

export function aiProviders(gatewayToken = null) {
  const list = [];
  if (process.env.GEMINI_API_KEY) for (const model of geminiModels()) list.push({ url: GEMINI_URL, key: process.env.GEMINI_API_KEY, model });
  const token = gatewayToken || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (token) for (const model of MODELS) list.push({ url: GATEWAY_URL, key: token, model });
  return list;
}

/**
 * Tries each model until one answers. A model that is not usable here
 * (400/403/404/429) moves on to the next; Vercel's "credit card" refusal and
 * outages stop. Returns the reply text, or null.
 */
export async function askAI({ system, messages, maxTokens = 450, temperature = 0.3, gatewayToken = null, timeoutMs = 25000 }) {
  for (const { url, key, model } of aiProviders(gatewayToken)) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      // Gemini models think before answering and that counts toward max_tokens: keep thinking low and leave room.
      body: JSON.stringify({ model, temperature, ...(url === GEMINI_URL ? { max_tokens: Math.max(1500, maxTokens), reasoning_effort: 'low' } : { max_tokens: maxTokens }), messages: [{ role: 'system', content: system }, ...messages] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await r.json().catch(() => null);
    const reply = data?.choices?.[0]?.message?.content;
    if (r.ok && typeof reply === 'string' && reply.trim()) return reply.trim();
    const why = String(data?.error?.message || data?.[0]?.error?.message || data?.error || '');
    console.error('ai failed', model, r.status, why.slice(0, 300));
    if (/credit card/i.test(why)) break;
    if (![400, 403, 404, 429].includes(r.status)) break;
  }
  return null;
}
