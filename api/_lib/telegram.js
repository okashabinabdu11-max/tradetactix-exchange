// Telegram helpers. The bot token lives only in the server's environment.

import { createHash, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://htycjrdyoysnudasqdop.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SEn6hnam_lE5yzk0mZQrYg_eVrh42Fn';

export const SITE_URL = process.env.SITE_URL || 'https://tradetactix-exchange.vercel.app';

/** Constant-time string comparison that never throws on different lengths. */
export function sameSecret(given, expected) {
  if (!expected || typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** The secret Telegram echoes back on every webhook call, derived so no extra setting is needed. */
export function webhookSecret() {
  const base = process.env.ALERTS_SECRET;
  return base ? createHash('sha256').update(`${base}:telegram-webhook`).digest('hex') : null;
}

export async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw Object.assign(new Error('Telegram bot token is not set on the server.'), { code: 'no_bot' });
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw Object.assign(new Error(body.description || `telegram ${method} failed`), { code: 'telegram_error', status: body.error_code });
  return body.result;
}

/** Calls a database function as the server (anonymous role plus the alerts secret). */
export async function serverRpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: process.env.ALERTS_SECRET, ...args }),
    signal: AbortSignal.timeout(6000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.message || `rpc ${name} ${res.status}`), { code: 'db_error' });
  return body;
}

import { marketOf, moveUnits, moveText } from '../../src/lib/markets.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p2 = (n) => Number(n).toFixed(2);

/** The alert text. Only real engine output goes in; nothing is filled in. */
export function alertMessage(signal) {
  const buy = signal.state === 'buy';
  const when = (signal.filledAt || new Date(new Date(signal.confirmedAt).getTime() + 15 * 60e3).toISOString()).slice(11, 16);
  const role = buy ? 'support' : 'resistance';
  const m = marketOf(signal.symbol);
  const move = (d) => moveText(m, moveUnits(m, Math.abs(d)));
  return [
    `${buy ? '🟢' : '🔴'} <b>${m.symbol} ${buy ? 'BUY' : 'SELL'}</b>`,
    '',
    `Entry: <b>${p2(signal.entry)}</b>`,
    `Stop-loss: <b>${p2(signal.stop)}</b>`,
    `Take-profit: <b>${p2(signal.target)}</b>`,
    `Reward-to-risk: <b>1:${(Math.floor(signal.rr * 10) / 10).toFixed(1)}</b>`,
    '',
    `Risk: <b>${move(signal.entry - signal.stop)}</b> · Reward: <b>${move(signal.target - signal.entry)}</b>${m.unit === 'usd' ? ' (price move)' : ''}`,
    '',
    signal.setup === 'order-block'
      ? `Order block touched · 5M structure shifted ${buy ? 'up' : 'down'} · Fib pullback filled in the zone ${p2(signal.entryZone?.[0])}–${p2(signal.entryZone?.[1])} at ${when} UTC. Stop at Fib 1, target at −0.618.`
      : `4H ${role} ${p2(signal.level?.price)} · 1H liquidity swept · 15M close confirmed at ${when} UTC.`,
    'If price has already moved away from the entry, this signal is no longer valid.',
    '',
    `<i>A rules-based reading of the plan, not financial advice. Check the chart before acting. No order is placed.</i>`,
    esc(`${SITE_URL}/#/signals${m.symbol === 'XAUUSD' ? '' : `?m=${m.symbol}`}`),
  ].join('\n');
}
