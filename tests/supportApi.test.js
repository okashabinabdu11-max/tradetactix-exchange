import test from 'node:test';
import assert from 'node:assert/strict';

const fakeRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, send(b) { r.body = JSON.parse(b); return r; } }; return r; };
const ask = { method: 'POST', headers: { 'x-vercel-oidc-token': 'oidc', 'x-forwarded-for': '1.2.3.4' }, body: { action: 'ask', messages: [{ role: 'user', content: 'How do I get approved?' }] } };
const reply = (status, body) => Promise.resolve({ ok: status === 200, status, json: async () => body });

test('Gemini is tried first, and a model it lacks falls through to the next Gemini model', async () => {
  process.env.GEMINI_API_KEY = 'gk';
  const calls = [];
  globalThis.fetch = (url, opt) => { const b = JSON.parse(opt.body); calls.push([url, b.model, opt.headers.Authorization, b.reasoning_effort]);
    return calls.length === 1 ? reply(404, { error: { message: 'model not found' } }) : reply(200, { choices: [{ message: { content: 'Open Plans.' } }] }); };
  const { default: handler } = await import('../api/support.js?gemini');
  const res = fakeRes(); await handler({ ...ask, headers: { ...ask.headers, 'x-forwarded-for': '9.9.9.1' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.reply, 'Open Plans.');
  assert.match(calls[0][0], /generativelanguage/); assert.equal(calls[0][2], 'Bearer gk'); assert.equal(calls[0][3], 'low');
  assert.match(calls[1][0], /generativelanguage/); assert.notEqual(calls[1][1], calls[0][1]);
});

test('without a Gemini key, Vercel is used, and its credit-card refusal stops after one try', async () => {
  delete process.env.GEMINI_API_KEY;
  const calls = [];
  globalThis.fetch = (url, opt) => { calls.push(url); return reply(403, { error: { message: 'AI Gateway requires a valid credit card on file to service requests.' } }); };
  const { default: handler } = await import('../api/support.js?vercel');
  const res = fakeRes(); await handler({ ...ask, headers: { ...ask.headers, 'x-forwarded-for': '9.9.9.2' } }, res);
  assert.equal(res.code, 503); assert.equal(res.body.error, 'ai_unavailable');
  assert.equal(calls.length, 1); assert.match(calls[0], /ai-gateway\.vercel\.sh/);
});
