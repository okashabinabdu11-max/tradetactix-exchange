import test from 'node:test';
import assert from 'node:assert/strict';
import { ethiopia, weekKey, weeklyMessage, reminderMessage, dailyMessage, runReports } from '../api/_lib/reports.js';

test('Ethiopia time and week keys', () => {
  const sun1800 = Date.parse('2026-11-22T15:00:00Z'); // Sunday 18:00 in Addis Ababa
  assert.deepEqual([ethiopia(sun1800).weekday, ethiopia(sun1800).hour], [0, 18]);
  assert.equal(weekKey(sun1800), '2026-11-16'); // that week's Monday
  assert.equal(weekKey(Date.parse('2026-11-16T00:30:00Z')), '2026-11-16'); // Monday 03:30 local
  assert.equal(weekKey(Date.parse('2026-11-15T20:59:00Z')), '2026-11-09'); // still Sunday 23:59 local
});

test('messages', () => {
  const w = weeklyMessage({ wins: 4, losses: 2, breakeven: 1, pips: 1240 }, Date.parse('2026-11-15T15:00:00Z'), Date.parse('2026-11-22T15:00:00Z'));
  assert.match(w, /weekly results<\/b> \(15 Nov – 22 Nov\)/); assert.match(w, /Win rate: <b>67%/); assert.match(w, /TP: <b>4<\/b> · ❌ SL: <b>2<\/b> · ⚪ BE: <b>1/); assert.match(w, /\+1,240 pips/); assert.doesNotMatch(w, /\$\d/);
  const r = reminderMessage({ pro_until: '2026-11-20T23:00:00Z' }, Date.parse('2026-11-20T18:00:00Z'));
  assert.match(r, /in 5 hours/); assert.match(r, /02:00/); assert.match(r, /@Tradetactix1/);
  const d = dailyMessage({ pending_requests: 2, active_members: 5, telegram_members: 4, new_accounts: 3, signals_sent: 1 }, { wins: 1, losses: 0, breakeven: 0, pips: 300 }, [{ email: 'a@x.com', pro_until: '2026-11-21T10:00:00Z' }], Date.parse('2026-11-20T18:05:00Z'));
  assert.match(d, /waiting: <b>2/); assert.match(d, /Active members: <b>5<\/b> \(4 with Telegram\)/); assert.match(d, /\+300 pips/); assert.match(d, /a@x\.com/);
});

function fakeWorld({ claims = new Set(), stats = { wins: 2, losses: 1, breakeven: 0, pips: 500 }, expiring = [], tgFail = false } = {}) {
  const sent = []; const released = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url); const b = opt.body ? JSON.parse(opt.body) : {};
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('api.telegram.org')) {
      if (tgFail) return ok({ ok: false, description: 'Bad Request: chat not found', error_code: 400 });
      sent.push(b); return ok({ ok: true, result: {} });
    }
    if (u.includes('alerts_claim_post')) { const k = `${b.p_kind}|${b.p_key}`; if (claims.has(k)) return ok(false); claims.add(k); return ok(true); }
    if (u.includes('alerts_release_post')) { claims.delete(`${b.p_kind}|${b.p_key}`); released.push(b.p_kind); return ok(null); }
    if (u.includes('alerts_period_stats')) return ok([stats]);
    if (u.includes('alerts_expiring')) return ok(expiring);
    if (u.includes('alerts_daily_numbers')) return ok([{ pending_requests: 1, active_members: 3, telegram_members: 2, new_accounts: 0, signals_sent: 2 }]);
    if (u.includes('alerts_admin_chats')) return ok([{ chat_id: 999 }]);
    throw new Error(`unexpected ${u}`);
  };
  return { sent, released, claims };
}

test('Sunday evening: weekly post to the channel once; daily report after 21:00; reminders once', async () => {
  process.env.ALERTS_SECRET = 's'; process.env.TELEGRAM_BOT_TOKEN = 't';
  const w = fakeWorld({ expiring: [{ user_id: 'u1', chat_id: 111, pro_until: '2026-11-23T03:00:00Z', email: 'm@x.com' }, { user_id: 'u2', chat_id: null, pro_until: '2026-11-23T05:00:00Z' }] });
  const at = Date.parse('2026-11-22T18:10:00Z'); // Sunday 21:10 Ethiopia
  const a = await runReports({ now: at });
  assert.equal(a.weekly, 'sent'); assert.equal(a.reminders, 1); assert.equal(a.daily, 1);
  assert.equal(w.sent.find((m) => m.chat_id === '@Tradetactix') !== undefined, true);
  assert.ok(w.sent.find((m) => m.chat_id === 111).reply_markup.inline_keyboard[0][0].url.endsWith('/Tradetactix1'));
  const b = await runReports({ now: at + 5 * 60e3 });
  assert.equal(b.weekly, 'already sent'); assert.equal(b.reminders, 0); assert.equal(b.daily, 'already sent');
});

test('weekday afternoon: no weekly or daily post', async () => {
  fakeWorld();
  const r = await runReports({ now: Date.parse('2026-11-18T10:00:00Z') }); // Wednesday 13:00 Ethiopia
  assert.equal(r.weekly, undefined); assert.equal(r.daily, undefined);
});

test('bot not in the channel yet: weekly post is released to try again', async () => {
  const w = fakeWorld({ tgFail: true });
  const r = await runReports({ now: Date.parse('2026-11-22T15:30:00Z') });
  assert.match(r.weekly, /failed/); assert.deepEqual(w.released, ['weekly']); assert.equal(w.claims.has('weekly|2026-11-16'), false);
});

test('a week with no closed signals posts nothing', async () => {
  const w = fakeWorld({ stats: { wins: 0, losses: 0, breakeven: 0, pips: 0 } });
  const r = await runReports({ now: Date.parse('2026-11-22T15:30:00Z') });
  assert.equal(r.weekly, 'no closed signals this week'); assert.equal(w.sent.filter((m) => m.chat_id === '@Tradetactix').length, 0);
});
