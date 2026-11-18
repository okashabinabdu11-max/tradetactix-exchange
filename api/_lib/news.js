// High-impact US news and what it usually means for gold. The pure parts are unit tested.
//
// Source: Forex Factory's free weekly calendar feed (title, country, date, impact,
// forecast, previous). The actual number is only known after the release, so the
// analysis is an expectation with both scenarios, never a promise.

export const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const SEND_BEFORE_MS = 60 * 60e3;   // Telegram: within the hour before the release
export const ANALYZE_BEFORE_MS = 24 * 3600e3;

// usd: what a HIGHER-than-forecast number usually does to the US dollar.
// +1 stronger dollar (gold usually falls), -1 weaker dollar (gold usually rises),
// 0 depends on the tone (Fed decisions and speeches). Order matters: first match wins.
const RULES = [
  { re: /unemployment claims|jobless claims|unemployment rate|continuing claims/i, usd: -1, kind: 'unemployment' },
  { re: /federal funds rate|interest rate decision|rate decision/i, usd: 1, kind: 'rates' },
  { re: /fomc|fed chair|powell|press conference|monetary policy|minutes|speaks|testimony/i, usd: 0, kind: 'fed' },
  { re: /\bcpi\b|\bppi\b|\bpce\b|inflation|price index|prices/i, usd: 1, kind: 'inflation' },
  { re: /hourly earnings|wage|employment cost/i, usd: 1, kind: 'wages' },
  { re: /non-?farm|\bnfp\b|\badp\b|employment change|payrolls|jolts|job openings/i, usd: 1, kind: 'jobs' },
  { re: /retail sales|\bgdp\b|\bism\b|\bpmi\b|durable goods|consumer (confidence|sentiment)|industrial production|housing starts|building permits|home sales/i, usd: 1, kind: 'growth' },
];

export function ruleFor(title) {
  return RULES.find((r) => r.re.test(String(title || ''))) || { usd: 0, kind: 'other' };
}

/** "175K" → 175000, "0.3%" → 0.3, "-1.2M" → -1200000, "<0.1%" → 0.1. Not a number → null. */
export function parseNumber(v) {
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  const unit = String(v).trim().slice(-1).toUpperCase();
  return unit === 'K' ? n * 1e3 : unit === 'M' ? n * 1e6 : unit === 'B' ? n * 1e9 : unit === 'T' ? n * 1e12 : n;
}

export const eventKey = (e) => `${e.date}|${e.title}`.slice(0, 160);

/** High-impact USD events from the feed, sorted by time. */
export function highImpactUsd(feed) {
  return (Array.isArray(feed) ? feed : [])
    .filter((e) => e && e.country === 'USD' && /high/i.test(e.impact || '') && Number.isFinite(Date.parse(e.date)) && e.title)
    .map((e) => ({ key: eventKey(e), title: String(e.title), startsAt: new Date(e.date).toISOString(), forecast: e.forecast || null, previous: e.previous || null }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** US medium and high impact events, for the website's calendar. Pure. */
export function usCalendar(feed, now = Date.now()) {
  const from = now - 12 * 3600e3;
  return (Array.isArray(feed) ? feed : [])
    .filter((e) => e && e.country === 'USD' && /high|medium/i.test(e.impact || '') && e.title && Number.isFinite(Date.parse(e.date)))
    .map((e) => ({ key: eventKey(e), title: String(e.title), startsAt: new Date(e.date).toISOString(), impact: /high/i.test(e.impact) ? 'high' : 'medium', forecast: e.forecast || null, previous: e.previous || null }))
    .filter((e) => Date.parse(e.startsAt) >= from)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The two scenarios, from the rule table (not from the AI). */
export function scenarios(title) {
  const r = ruleFor(title);
  if (r.usd === 0) {
    return {
      ifHigher: 'Hawkish (rates higher for longer): stronger dollar and yields, gold usually falls.',
      ifLower: 'Dovish (rate cuts closer): weaker dollar and yields, gold usually rises.',
    };
  }
  const up = 'stronger dollar, gold usually falls';
  const down = 'weaker dollar, gold usually rises';
  return r.usd > 0
    ? { ifHigher: `Higher than forecast: ${up}.`, ifLower: `Lower than forecast: ${down}.` }
    : { ifHigher: `Higher than forecast: ${down}.`, ifLower: `Lower than forecast: ${up}.` };
}

/**
 * The fallback expectation when the AI is unavailable: if the forecast already
 * points to a stronger dollar than last time, lean bearish for gold, and the reverse.
 */
export function ruleExpectation(event) {
  const r = ruleFor(event.title);
  const f = parseNumber(event.forecast);
  const p = parseNumber(event.previous);
  if (r.usd === 0 || f === null || p === null || f === p) {
    return { bias: 'neutral', confidence: 'low', reason: 'No clear lean before the release. The move will depend on the actual number or the tone, so wait for it and watch the first reaction.', source: 'rules' };
  }
  const usdStronger = Math.sign(f - p) * r.usd > 0;
  return {
    bias: usdStronger ? 'bearish' : 'bullish',
    confidence: 'low',
    reason: `The forecast (${event.forecast}) is ${f > p ? 'above' : 'below'} the previous reading (${event.previous}), which points to a ${usdStronger ? 'stronger' : 'weaker'} dollar, usually ${usdStronger ? 'negative' : 'positive'} for gold. The real move depends on how the actual number compares with the forecast.`,
    source: 'rules',
  };
}

export const NEWS_SYSTEM = `You are a careful macro analyst for XAUUSD (gold priced in US dollars). Given one upcoming high-impact US economic release, give the most likely reaction of gold, with the reasoning a professional would use. Be honest about uncertainty.

Use these relationships:
- Gold moves opposite to the US dollar and US real yields most of the time.
- Stronger US data or hotter inflation than expected -> markets expect the Fed to keep rates higher -> dollar and yields rise -> gold usually falls.
- Weaker data, cooler inflation or higher unemployment than expected -> rate cuts more likely -> dollar and yields fall -> gold usually rises.
- Fed decisions and speeches: hawkish is bearish for gold, dovish is bullish.
- The surprise versus the forecast matters, not the number alone. Use the forecast versus the previous reading, and the recent gold move, to judge what the market already expects.
- If there is no clear edge, say neutral.

Reply with JSON only, no other text: {"bias":"bullish|bearish|neutral","confidence":"low|medium|high","reason":"2 to 4 short sentences in plain English"}. Never invent data you were not given. Never promise a result.`;

export function newsPrompt(event, context = {}) {
  const r = ruleFor(event.title);
  const lines = [
    `Release: ${event.title} (United States)`,
    `Time: ${event.startsAt}`,
    `Forecast: ${event.forecast ?? 'not given'}`,
    `Previous: ${event.previous ?? 'not given'}`,
    `Rule of thumb for this release: ${r.usd > 0 ? 'a higher number than forecast usually strengthens the dollar (bearish gold)' : r.usd < 0 ? 'a higher number than forecast usually weakens the dollar (bullish gold)' : 'the tone decides: hawkish is bearish gold, dovish is bullish gold'}.`,
  ];
  if (Number.isFinite(context.price)) lines.push(`Gold now: ${context.price.toFixed(2)}${Number.isFinite(context.changePct) ? `, ${context.changePct >= 0 ? '+' : ''}${context.changePct.toFixed(2)}% today` : ''}.`);
  return lines.join('\n');
}

/** Reads the AI reply. Anything that is not valid JSON with a valid bias is rejected. */
export function parseExpectation(text) {
  try {
    const raw = String(text || '').replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const bias = String(j.bias || '').toLowerCase();
    const confidence = String(j.confidence || '').toLowerCase();
    const reason = String(j.reason || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!['bullish', 'bearish', 'neutral'].includes(bias) || !reason) return null;
    return { bias, confidence: ['low', 'medium', 'high'].includes(confidence) ? confidence : 'low', reason, source: 'ai' };
  } catch { return null; }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const ethiopiaTime = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });
const BIAS = { bullish: '🟢 <b>Bullish for gold</b>', bearish: '🔴 <b>Bearish for gold</b>', neutral: '⚪ <b>Neutral, no clear lean</b>' };

export function newsMessage(a, now = Date.now()) {
  const mins = Math.max(0, Math.round((Date.parse(a.starts_at) - now) / 60e3));
  return [
    `📰 <b>High-impact news in ${mins} min</b>`,
    `🇺🇸 <b>${esc(a.title)}</b> at ${esc(ethiopiaTime(a.starts_at))} (Ethiopia time)`,
    `Forecast ${esc(a.forecast ?? '—')} · Previous ${esc(a.previous ?? '—')}`,
    '',
    `Expectation: ${BIAS[a.bias] || BIAS.neutral} (${esc(a.confidence)} confidence)`,
    `Why: ${esc(a.reason)}`,
    '',
    `⬆️ ${esc(a.if_higher)}`,
    `⬇️ ${esc(a.if_lower)}`,
    '',
    '⚠️ News can move gold fast both ways and hit stops. This is an expectation, not financial advice.',
  ].join('\n');
}
