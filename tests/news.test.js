import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleFor, parseNumber, highImpactUsd, scenarios, ruleExpectation, parseExpectation, newsMessage, NEWS_SYSTEM } from '../api/_lib/news.js';

test('rule table: what a higher number does to the dollar', () => {
  assert.equal(ruleFor('CPI m/m').usd, 1);
  assert.equal(ruleFor('Non-Farm Employment Change').usd, 1);
  assert.equal(ruleFor('Unemployment Claims').usd, -1);
  assert.equal(ruleFor('Unemployment Rate').usd, -1);
  assert.equal(ruleFor('FOMC Press Conference').usd, 0);
  assert.equal(ruleFor('Federal Funds Rate').usd, 1);
});

test('numbers from the feed', () => {
  assert.deepEqual(['175K', '0.3%', '-1.2M', '<0.1%', '', 'n/a'].map(parseNumber), [175000, 0.3, -1200000, 0.1, null, null]);
});

test('only high-impact USD events, sorted', () => {
  const feed = [
    { title: 'CPI m/m', country: 'USD', date: '2026-11-20T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.2%' },
    { title: 'GDP', country: 'EUR', date: '2026-11-19T05:00:00-05:00', impact: 'High' },
    { title: 'Retail Sales', country: 'USD', date: '2026-11-19T08:30:00-05:00', impact: 'Medium' },
    { title: 'Unemployment Claims', country: 'USD', date: '2026-11-19T08:30:00-05:00', impact: 'High', forecast: '220K', previous: '215K' },
    { title: 'Bad', country: 'USD', date: 'not a date', impact: 'High' },
  ];
  const list = highImpactUsd(feed);
  assert.deepEqual(list.map((e) => e.title), ['Unemployment Claims', 'CPI m/m']);
  assert.equal(list[0].startsAt, '2026-11-19T13:30:00.000Z');
});

test('fallback expectation follows the forecast versus previous', () => {
  assert.equal(ruleExpectation({ title: 'CPI m/m', forecast: '0.4%', previous: '0.2%' }).bias, 'bearish'); // hotter inflation: stronger dollar
  assert.equal(ruleExpectation({ title: 'Unemployment Claims', forecast: '240K', previous: '215K' }).bias, 'bullish'); // more claims: weaker dollar
  assert.equal(ruleExpectation({ title: 'FOMC Statement', forecast: '', previous: '' }).bias, 'neutral');
  assert.equal(ruleExpectation({ title: 'CPI m/m', forecast: '0.3%', previous: '0.3%' }).bias, 'neutral');
  assert.match(scenarios('Unemployment Claims').ifHigher, /weaker dollar, gold usually rises/);
});

test('AI reply is accepted only as valid JSON with a known bias', () => {
  assert.deepEqual(parseExpectation('```json\n{"bias":"Bullish","confidence":"medium","reason":"Cooler inflation."}\n```'), { bias: 'bullish', confidence: 'medium', reason: 'Cooler inflation.', source: 'ai' });
  assert.equal(parseExpectation('{"bias":"to the moon","reason":"x"}'), null);
  assert.equal(parseExpectation('Gold will go up'), null);
  assert.match(NEWS_SYSTEM, /Never invent data/);
});

test('Telegram message: minutes, Ethiopia time, both scenarios, no dollar amounts of profit', () => {
  const now = Date.parse('2026-11-20T13:00:00Z');
  const t = newsMessage({ title: 'CPI m/m', starts_at: '2026-11-20T13:30:00Z', forecast: '0.3%', previous: '0.2%', bias: 'bearish', confidence: 'medium', reason: 'Hot <data>.', if_higher: 'Higher: gold falls.', if_lower: 'Lower: gold rises.' }, now);
  assert.match(t, /High-impact news in 30 min/); assert.match(t, /16:30/); assert.match(t, /Bearish for gold/); assert.match(t, /Hot &lt;data&gt;/);
  assert.match(t, /Higher: gold falls/); assert.match(t, /Lower: gold rises/); assert.doesNotMatch(t, /\$\d/);
});

test('news job: analyzes once with the AI, saves, then sends due outlooks once', async () => {
  process.env.ALERTS_SECRET = 's'; process.env.GEMINI_API_KEY = 'gk';
  const start = Date.parse('2026-11-20T12:00:00Z');
  const feed = [{ title: 'CPI m/m', country: 'USD', date: '2026-11-20T13:30:00Z', impact: 'High', forecast: '0.3%', previous: '0.2%' }];
  const saved = []; const calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url); calls.push(u);
    const body = opt.body ? JSON.parse(opt.body) : {};
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('ff_calendar')) return ok(feed);
    if (u.includes('/api/quote')) return ok({ price: 4100, percentChange: -0.4 });
    if (u.includes('generativelanguage')) return ok({ choices: [{ message: { content: '{"bias":"bearish","confidence":"medium","reason":"Forecast above previous points to hotter inflation."}' } }] });
    if (u.includes('/rpc/alerts_news_missing')) return ok(body.p_keys.filter((k) => !saved.some((s) => s.p_key === k)));
    if (u.includes('/rpc/alerts_news_save')) { saved.push(body); return ok(null); }
    if (u.includes('/rpc/alerts_news_due')) return ok(saved.length ? [{ event_key: saved[0].p_key, title: 'CPI m/m', starts_at: saved[0].p_starts_at, forecast: '0.3%', previous: '0.2%', bias: saved[0].p_bias, confidence: saved[0].p_confidence, reason: saved[0].p_reason, if_higher: saved[0].p_if_higher, if_lower: saved[0].p_if_lower }] : []);
    if (u.includes('/rpc/alerts_news_claim')) return ok(!calls.slice(0, -1).some((c) => c.includes('alerts_news_claim')));
    if (u.includes('/rpc/alerts_member_chats')) return ok([{ chat_id: 1 }, { chat_id: 2 }]);
    if (u.includes('/rpc/alerts_news_sent')) return ok(null);
    throw new Error(`unexpected ${u}`);
  };
  const { runNews, _resetNewsCache } = await import('../api/_lib/newsRun.js');
  _resetNewsCache();
  const sentTo = [];
  const broadcast = async (chats, text) => { sentTo.push({ chats, text }); return chats.length; };
  const first = await runNews({ origin: 'https://x.test', broadcast, now: start + 60 * 60e3 + 1 }); // 89 min before? no: 29 min before
  assert.equal(first.analyzed.length, 1); assert.equal(first.analyzed[0].source, 'ai'); assert.equal(saved[0].p_bias, 'bearish');
  assert.equal(first.sent.length, 1); assert.equal(sentTo[0].chats.length, 2); assert.match(sentTo[0].text, /Bearish for gold/);
  const second = await runNews({ origin: 'https://x.test', broadcast, now: start + 65 * 60e3 });
  assert.equal(second.analyzed.length, 0); assert.equal(second.sent.length, 0); assert.equal(calls.filter((c) => c.includes('ff_calendar')).length, 1); // cached
});

test('a busy model falls through to the next; a busy AI far from the release waits instead of using rules', async () => {
  process.env.ALERTS_SECRET = 's'; process.env.GEMINI_API_KEY = 'gk';
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  const models = [];
  globalThis.fetch = async (url, opt = {}) => {
    const b = opt.body ? JSON.parse(opt.body) : {};
    if (String(url).includes('generativelanguage')) { models.push(b.model); return models.length === 1 ? { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) } : ok({ choices: [{ message: { content: 'fine' } }] }); }
    throw new Error('unexpected');
  };
  const { askAI } = await import('../api/_lib/ai.js');
  assert.equal(await askAI({ system: 's', messages: [{ role: 'user', content: 'q' }] }), 'fine');
  assert.equal(models.length, 2); assert.notEqual(models[0], models[1]);

  const start = Date.parse('2026-11-20T08:00:00Z');
  const feed = [{ title: 'CPI m/m', country: 'USD', date: '2026-11-20T13:30:00Z', impact: 'High', forecast: '0.3%', previous: '0.2%' }];
  const saved = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url); const body = opt.body ? JSON.parse(opt.body) : {};
    if (u.includes('ff_calendar')) return ok(feed);
    if (u.includes('/api/quote')) return ok({});
    if (u.includes('generativelanguage')) return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) };
    if (u.includes('/rpc/alerts_news_missing')) return ok(body.p_keys.filter((k) => !saved.some((s) => s.p_key === k)));
    if (u.includes('/rpc/alerts_news_save')) { saved.push(body); return ok(null); }
    if (u.includes('/rpc/alerts_news_due')) return ok([]);
    throw new Error(`unexpected ${u}`);
  };
  const { runNews, _resetNewsCache } = await import('../api/_lib/newsRun.js');
  _resetNewsCache();
  const far = await runNews({ origin: 'https://x.test', broadcast: async () => 0, now: start }); // 5.5 hours before
  assert.equal(saved.length, 0); assert.equal(far.retryLater, 1);
  const near = await runNews({ origin: 'https://x.test', broadcast: async () => 0, now: Date.parse('2026-11-20T12:30:00Z') }); // 60 min before
  assert.equal(saved.length, 1); assert.equal(saved[0].p_source, 'rules'); assert.equal(near.analyzed[0].source, 'rules');
});
