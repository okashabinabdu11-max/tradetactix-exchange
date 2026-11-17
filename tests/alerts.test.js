import test from 'node:test';
import assert from 'node:assert/strict';
import { alertMessage, sameSecret, webhookSecret } from '../api/_lib/telegram.js';
import alertsRun from '../api/alerts-run.js';
import webhook from '../api/telegram-webhook.js';
import setup from '../api/telegram-setup.js';

const SECRET = 'alerts-secret-0123456789-0123456789-xyz';
const BUY = { state: 'buy', direction: 'buy', entry: 4008, stop: 3996.2, target: 4099.5, rr: 7.76, level: { price: 4000.5 }, confirmedAt: '2026-11-18T11:30:00.000Z', asOf: '2026-11-18T11:30:00.000Z' };

function fakeRes() {
  return { headers: {}, code: null, raw: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.raw = b; try { this.body = JSON.parse(b); } catch { this.body = b; } } };
}
function withFetch(router, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { const c = { url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} }; calls.push(c); return router(c); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = real; });
}
const json = (body, ok = true) => ({ ok, json: async () => body });

test('alert text carries the real levels and the disclaimer', () => {
  const t = alertMessage(BUY);
  assert.match(t, /XAUUSD BUY/);
  assert.match(t, /Entry: <b>4008.00<\/b>/);
  assert.match(t, /Stop-loss: <b>3996.20<\/b>/);
  assert.match(t, /Take-profit: <b>4099.50<\/b>/);
  assert.match(t, /1:7.7/);
  assert.match(t, /At 0.01 lot \(1 oz\): risk <b>\$11.80<\/b>, reward <b>\$91.50<\/b>/);
  assert.match(t, /4H support 4000.50/);
  assert.match(t, /confirmed at 11:45 UTC/);
  assert.match(t, /not financial advice/);
  assert.match(alertMessage({ ...BUY, state: 'sell' }), /XAUUSD SELL[\s\S]*4H resistance/);
});

test('secrets compare safely', () => {
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abd', 'abc'), false);
  assert.equal(sameSecret('ab', 'abc'), false);
  assert.equal(sameSecret('', ''), false, 'an unset secret never matches');
  process.env.ALERTS_SECRET = SECRET;
  assert.match(webhookSecret(), /^[0-9a-f]{64}$/);
});

test('alerts run is refused without the key', async () => {
  process.env.ALERTS_SECRET = SECRET;
  for (const key of [undefined, '', 'wrong', `${SECRET}x`]) {
    const res = fakeRes();
    await alertsRun({ headers: { host: 'example.test', 'x-alerts-key': key } }, res);
    assert.equal(res.code, 403);
  }
  delete process.env.ALERTS_SECRET;
  const res = fakeRes();
  await alertsRun({ headers: { host: 'example.test', 'x-alerts-key': '' } }, res);
  assert.equal(res.code, 403, 'no secret configured means closed');
});

test('alerts run with no signal sends nothing', async () => {
  process.env.ALERTS_SECRET = SECRET;
  process.env.CANDLES_KEY = 'candles-key-0123456789';
  await withFetch((c) => (c.url.includes('/api/candles') ? json({ candles: [] }) : json({})), async (calls) => {
    const res = fakeRes();
    await alertsRun({ headers: { host: 'example.test', 'x-alerts-key': SECRET } }, res);
    assert.equal(res.body.state, 'offline');
    assert.ok(!calls.some((c) => c.url.includes('telegram') || c.url.includes('alerts_claim')));
  });
});

test('webhook: wrong secret is refused; /start CODE links; /stop unlinks', async () => {
  process.env.ALERTS_SECRET = SECRET;
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  const hdr = { 'x-telegram-bot-api-secret-token': webhookSecret() };
  const msg = (text, type = 'private') => ({ message: { text, chat: { id: 42, type } } });
  const bad = fakeRes();
  await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'nope' }, body: msg('/start ABCDEFGHJK') }, bad);
  assert.equal(bad.code, 403);

  await withFetch((c) => {
    if (c.url.endsWith('/rpc/alerts_link_chat')) return json({ linked: true, pro: true });
    if (c.url.endsWith('/rpc/alerts_unlink_chat')) return json(null);
    return json({ ok: true, result: {} });
  }, async (calls) => {
    const r1 = fakeRes();
    await webhook({ method: 'POST', headers: hdr, body: msg('/start ABCDEFGHJK') }, r1);
    assert.equal(r1.code, 200);
    const link = calls.find((c) => c.url.endsWith('/rpc/alerts_link_chat'));
    assert.deepEqual(link.body, { p_secret: SECRET, p_code: 'ABCDEFGHJK', p_chat_id: 42 });
    assert.match(calls.find((c) => c.url.includes('sendMessage')).body.text, /^Connected\./);

    await webhook({ method: 'POST', headers: hdr, body: msg('/stop') }, fakeRes());
    assert.ok(calls.some((c) => c.url.endsWith('/rpc/alerts_unlink_chat') && c.body.p_chat_id === 42));

    const before = calls.length;
    await webhook({ method: 'POST', headers: hdr, body: msg('/start ABCDEFGHJK', 'group') }, fakeRes());
    assert.equal(calls.length, before, 'group chats are ignored');
  });
});

test('webhook: free user is linked but told alerts are Pro; expired code is explained', async () => {
  process.env.ALERTS_SECRET = SECRET;
  const hdr = { 'x-telegram-bot-api-secret-token': webhookSecret() };
  let answer = { linked: true, pro: false };
  await withFetch((c) => (c.url.endsWith('/rpc/alerts_link_chat') ? json(answer) : json({ ok: true, result: {} })), async (calls) => {
    await webhook({ method: 'POST', headers: hdr, body: { message: { text: '/start ABCDEFGHJK', chat: { id: 7, type: 'private' } } } }, fakeRes());
    assert.match(calls.at(-1).body.text, /alerts are for Pro members/);
    answer = { linked: false, reason: 'expired' };
    await webhook({ method: 'POST', headers: hdr, body: { message: { text: '/start ABCDEFGHJK', chat: { id: 7, type: 'private' } } } }, fakeRes());
    assert.match(calls.at(-1).body.text, /expired/);
  });
});

test('bot setup is for administrators only and registers the webhook with the secret', async () => {
  process.env.ALERTS_SECRET = SECRET;
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  const auth = { authorization: `Bearer ${'t'.repeat(40)}`, host: 'tradetactix.example' };
  let admin = false;
  await withFetch((c) => {
    if (c.url.endsWith('/rpc/my_entitlement')) return json({ signed_in: true, is_admin: admin });
    if (c.url.includes('/getMe')) return json({ ok: true, result: { username: 'TradeTactix_bot' } });
    if (c.url.includes('api.telegram.org')) return json({ ok: true, result: true });
    return json({});
  }, async (calls) => {
    const denied = fakeRes();
    await setup({ method: 'POST', headers: auth }, denied);
    assert.equal(denied.code, 403);
    admin = true;
    const r = fakeRes();
    await setup({ method: 'POST', headers: auth }, r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.username, 'TradeTactix_bot');
    const hook = calls.find((c) => c.url.endsWith('/setWebhook'));
    assert.equal(hook.body.url, 'https://tradetactix.example/api/telegram-webhook');
    assert.equal(hook.body.secret_token, webhookSecret());
    assert.ok(!JSON.stringify(r.body).includes('123:abc'), 'the bot token never leaves the server');
  });
});
