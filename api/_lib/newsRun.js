// The news step of the 5-minute alert job.
//   1. Reads this week's calendar and, for each high-impact US release in the next
//      24 hours without an outlook, asks the AI once (rules if the AI is unavailable)
//      and saves the outlook.
//   2. In the hour before a release, sends its outlook once to every member.

import { serverRpc } from './telegram.js';
import { askAI } from './ai.js';
import { CALENDAR_URL, ANALYZE_BEFORE_MS, highImpactUsd, NEWS_SYSTEM, newsPrompt, parseExpectation, ruleExpectation, scenarios, newsMessage } from './news.js';

// Use the rules instead of the AI only when the release is this close (the send window is 60 minutes).
export const RULES_ONLY_WITHIN_MS = 75 * 60e3;
const FEED_TTL_MS = 30 * 60e3; // the feed changes rarely; do not ask for it every 5 minutes
let cache = { at: 0, feed: null };

export async function calendar(now = Date.now()) {
  if (cache.feed && now - cache.at < FEED_TTL_MS) return cache.feed;
  const r = await fetch(CALENDAR_URL, { headers: { 'User-Agent': 'TradeTactix/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`calendar ${r.status}`);
  const feed = await r.json();
  if (!Array.isArray(feed)) throw new Error('calendar not a list');
  cache = { at: now, feed };
  return feed;
}

async function goldContext(origin) {
  try {
    const q = await fetch(`${origin}/api/quote`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null));
    return { price: Number.isFinite(q?.price) ? q.price : undefined, changePct: Number.isFinite(q?.percentChange) ? q.percentChange : undefined };
  } catch { return {}; }
}

export async function runNews({ origin, broadcast, now = Date.now(), maxAnalyses = 1 }) {
  const out = { analyzed: [], sent: [] };

  // 1. Outlooks for the next 24 hours
  try {
    const soon = highImpactUsd(await calendar(now)).filter((e) => {
      const t = Date.parse(e.startsAt);
      return t > now && t - now <= ANALYZE_BEFORE_MS;
    });
    if (soon.length) {
      const missing = new Set((await serverRpc('alerts_news_missing', { p_keys: soon.map((e) => e.key) })) || []);
      const todo = soon.filter((e) => missing.has(e.key)).slice(0, maxAnalyses);
      const ctx = todo.length ? await goldContext(origin) : {};
      for (const e of todo) {
        let text = null; let aiError = null;
        try { text = await askAI({ system: NEWS_SYSTEM, messages: [{ role: 'user', content: newsPrompt(e, ctx) }], maxTokens: 500, timeoutMs: 25000 }); } catch (err) { aiError = err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err); }
        const fromAi = parseExpectation(text);
        if (!fromAi) console.error('news ai unusable', e.title, aiError || (text ? `not JSON: ${text.slice(0, 200)}` : 'no reply'));
        // Busy AI and plenty of time left: ask again at the next run instead of settling for the rules.
        if (!fromAi && Date.parse(e.startsAt) - now > RULES_ONLY_WITHIN_MS) { out.retryLater = (out.retryLater || 0) + 1; continue; }
        const x = fromAi || ruleExpectation(e);
        const sc = scenarios(e.title);
        await serverRpc('alerts_news_save', {
          p_key: e.key, p_title: e.title, p_starts_at: e.startsAt, p_forecast: e.forecast, p_previous: e.previous,
          p_bias: x.bias, p_confidence: x.confidence, p_reason: x.reason, p_if_higher: sc.ifHigher, p_if_lower: sc.ifLower, p_source: x.source,
        });
        out.analyzed.push({ key: e.key, bias: x.bias, source: x.source });
        console.log('news outlook saved', e.title, e.startsAt, x.bias, x.source);
      }
    }
  } catch (err) {
    out.calendarError = String(err?.message || err).slice(0, 120);
    console.error('news calendar failed', out.calendarError);
  }

  // 2. Send what is due (works even if the calendar could not be read this time)
  const due = (await serverRpc('alerts_news_due', {}).catch((err) => { console.error('news due check failed', err?.message); return []; })) || [];
  let members = null;
  for (const a of due) {
    if (!(await serverRpc('alerts_news_claim', { p_key: a.event_key }).catch(() => false))) continue;
    if (!members) members = ((await serverRpc('alerts_member_chats', {})) || []).map((r) => r.chat_id);
    const n = members.length ? await broadcast(members, newsMessage(a, now)) : 0;
    await serverRpc('alerts_news_sent', { p_key: a.event_key, p_count: n }).catch(() => {});
    out.sent.push({ key: a.event_key, sent: n });
    console.log('news outlook sent', a.title, a.starts_at, `${n} of ${members.length} chats`);
  }
  return out;
}

export const _resetNewsCache = () => { cache = { at: 0, feed: null }; };
