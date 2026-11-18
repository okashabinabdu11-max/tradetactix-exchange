// Scheduled bot posts, run from the 5-minute alert job. Times are Ethiopia time (UTC+3).
//   Weekly results  Sunday 18:00 or later, once a week, to the Telegram channel
//   Daily report    21:00 or later, once a day, to the admin
//   Reminders       when a member's access has 24 hours or less left, once per access period
// Each post is claimed in the database first, so it goes out once.

import { serverRpc, telegram, SITE_URL } from './telegram.js';

export const CHANNEL = process.env.TELEGRAM_CHANNEL || '@Tradetactix';
export const ADMIN_TELEGRAM = 'Tradetactix1';
const ETH_OFFSET_MS = 3 * 3600e3;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ethiopia-time calendar fields for a moment. */
export function ethiopia(now) {
  const d = new Date(now + ETH_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay(), hour: d.getUTCHours(), date: d.toISOString().slice(0, 10) };
}
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Addis_Ababa' });
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' });
const pipsText = (p) => { const n = Math.round(Number(p) || 0); return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')} pips`; };

export function weeklyMessage(s, fromMs, toMs) {
  const decided = s.wins + s.losses;
  return [
    `📊 <b>TradeTactix weekly results</b> (${fmtDay(fromMs)} – ${fmtDay(toMs)})`,
    '',
    decided ? `Win rate: <b>${Math.round((s.wins / decided) * 100)}%</b>` : 'Win rate: —',
    `✅ TP: <b>${s.wins}</b> · ❌ SL: <b>${s.losses}</b>${s.breakeven ? ` · ⚪ BE: <b>${s.breakeven}</b>` : ''}`,
    `Pips: <b>${pipsText(s.pips)}</b>`,
    '',
    'Every signal is counted automatically when it hits TP, SL or breakeven. Past results do not guarantee future results.',
    `Get signals: ${esc(SITE_URL)}`,
  ].join('\n');
}

export function reminderMessage(row, now) {
  const hours = Math.max(1, Math.round((Date.parse(row.pro_until) - now) / 3600e3));
  return `⏳ Your TradeTactix signal access ends <b>in ${hours} hour${hours === 1 ? '' : 's'}</b> (${esc(fmtWhen(row.pro_until))}, Ethiopia time).\n\nTo keep getting signals, message the admin to renew: @${ADMIN_TELEGRAM}`;
}

export function dailyMessage(n, s, expiring, now) {
  const lines = [
    `🗓 <b>Daily report</b> · ${esc(fmtWhen(new Date(now).toISOString()).replace(/,? \d\d:\d\d$/, ''))}`,
    '',
    `Access requests waiting: <b>${n.pending_requests}</b>`,
    `Active members: <b>${n.active_members}</b> (${n.telegram_members} with Telegram)`,
    `New accounts (24h): <b>${n.new_accounts}</b>`,
    `Signals sent (24h): <b>${n.signals_sent}</b>`,
    `Results (24h): ✅ ${s.wins} · ❌ ${s.losses} · ⚪ ${s.breakeven} · ${pipsText(s.pips)}`,
  ];
  if (expiring.length) {
    lines.push('', `Access ending within 24h (${expiring.length}):`);
    for (const e of expiring.slice(0, 15)) lines.push(`• ${esc(e.email || 'member')}: ${esc(fmtWhen(e.pro_until))}`);
  }
  lines.push('', `${esc(SITE_URL)}/#/admin`);
  return lines.join('\n');
}

/** Monday-based week key in Ethiopia time, for example 2026-11-16. */
export function weekKey(now) {
  const e = ethiopia(now);
  const back = (e.weekday + 6) % 7; // days since Monday
  return new Date(Date.UTC(e.y, e.m, e.day - back)).toISOString().slice(0, 10);
}

const one = async (fn) => { try { return await fn(); } catch (err) { return { error: String(err?.message || err).slice(0, 120) }; } };

export async function runReports({ now = Date.now() } = {}) {
  const out = {};
  const e = ethiopia(now);

  // Weekly results: Sunday from 18:00 Ethiopia time.
  if (e.weekday === 0 && e.hour >= 18) {
    out.weekly = await one(async () => {
      const key = weekKey(now);
      if (!(await serverRpc('alerts_claim_post', { p_kind: 'weekly', p_key: key }))) return 'already sent';
      const from = now - 7 * 86400e3;
      const s = ((await serverRpc('alerts_period_stats', { p_since: new Date(from).toISOString() })) || [])[0] || { wins: 0, losses: 0, breakeven: 0, pips: 0 };
      if (s.wins + s.losses + s.breakeven === 0) return 'no closed signals this week';
      try {
        await telegram('sendMessage', { chat_id: CHANNEL, text: weeklyMessage(s, from, now), parse_mode: 'HTML', disable_web_page_preview: true });
        return 'sent';
      } catch (err) {
        await serverRpc('alerts_release_post', { p_kind: 'weekly', p_key: key }).catch(() => {}); // try again next run
        console.error('weekly post failed (is the bot an admin of the channel?)', err?.message);
        return `failed: ${err?.message}`;
      }
    });
  }

  // Reminders: access ending within 24 hours.
  out.reminders = await one(async () => {
    let sent = 0;
    for (const row of (await serverRpc('alerts_expiring', {})) || []) {
      if (!row.chat_id) continue;
      if (!(await serverRpc('alerts_claim_post', { p_kind: 'remind', p_key: `${row.user_id}|${row.pro_until}` }))) continue;
      await telegram('sendMessage', {
        chat_id: row.chat_id, text: reminderMessage(row, now), parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: `Message @${ADMIN_TELEGRAM}`, url: `https://t.me/${ADMIN_TELEGRAM}` }]] },
      }).then(() => { sent += 1; }).catch((err) => console.error('reminder failed', err?.message));
    }
    return sent;
  });

  // Daily report to the admin: from 21:00 Ethiopia time.
  if (e.hour >= 21) {
    out.daily = await one(async () => {
      if (!(await serverRpc('alerts_claim_post', { p_kind: 'daily', p_key: e.date }))) return 'already sent';
      const [n] = (await serverRpc('alerts_daily_numbers', {})) || [];
      const [s] = (await serverRpc('alerts_period_stats', { p_since: new Date(now - 86400e3).toISOString() })) || [];
      const expiring = (await serverRpc('alerts_expiring', {})) || [];
      const text = dailyMessage(n, s || { wins: 0, losses: 0, breakeven: 0, pips: 0 }, expiring, now);
      let sent = 0;
      for (const a of (await serverRpc('alerts_admin_chats', {})) || []) {
        await telegram('sendMessage', { chat_id: a.chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }).then(() => { sent += 1; }).catch(() => {});
      }
      return sent;
    });
  }
  return out;
}
