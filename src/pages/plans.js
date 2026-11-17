// Plans: what Free and Pro include, the signed-in user's credits, and paying
// for Pro with USDT. Credits are added only by the database after an
// administrator approves a payment whose on-chain check passed.

import { session } from '../state/session.js';
import { getPlanSettings, listNetworks, listMyClaims, startPayment, submitClaim, refreshEntitlement, getMyTelegram, createTelegramCode, unlinkTelegram } from '../services/backend.js';
import { isSupabaseConfigured } from '../config.js';
import { escapeHtml } from '../lib/format.js';

const dateTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const money = (n) => Number(n).toFixed(2);

const FREE = ['10 signal previews a month: direction and timeframe only', 'No entry price, stop-loss or take-profit', 'Basic personal trading journal', 'No premium alerts or automatic trading'];
const PRO = ['Full BUY and SELL signals', 'Exact entry, stop-loss and take-profit, at least 1:3', 'Technical and fundamental analysis', 'Advanced journal: history, analytics, calendar, discipline', 'Premium alerts and AI trade reviews, as they launch'];

function compare(price, credits, hours) {
  const days = Math.round((credits * hours) / 24);
  const list = (items) => `<ul class="plan-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return `
    <div class="plan-grid">
      <section class="panel plan-card"><h2>Free</h2><p class="plan-price">0 USDT</p>${list(FREE)}</section>
      <section class="panel plan-card is-pro"><h2>Pro</h2><p class="plan-price">${money(price)} USDT <small>for ${days} days</small></p>${list(PRO)}
        <p class="panel-note">${credits} credits. One credit is ${hours} hours of Pro. If no setup meets the plan, Pro shows “NO VALID SETUP — AI IS WAITING.” Signals are never made up.</p></section>
    </div>`;
}

function statusPanel(e) {
  if (!e) return '';
  if (e.unlimited) return '<section class="panel status-card"><p class="panel-kicker">Your plan</p><p class="status-plan">Pro, unlimited</p><p class="panel-note">Administrator account.</p></section>';
  if (e.plan === 'pro') {
    return `<section class="panel status-card"><p class="panel-kicker">Your plan</p><p class="status-plan">Pro</p>
      <dl class="quote quote-two"><div><dt>Credits left</dt><dd>${e.credits}</dd></div><div><dt>Pro until</dt><dd class="status-date">${dateTime(e.pro_until)}</dd></div></dl>
      <p class="panel-note">Buying more adds days on top of what you have.</p></section>`;
  }
  return `<section class="panel status-card"><p class="panel-kicker">Your plan</p><p class="status-plan">Free</p>
    <dl class="quote quote-two"><div><dt>Credits</dt><dd>0</dd></div><div><dt>Previews this month</dt><dd>${e.previews_used} of ${e.previews_limit}</dd></div></dl></section>`;
}

function alertsPanel(settings, entitlement, link, code) {
  const bot = settings?.telegram_bot_username;
  const head = '<h2 class="panel-title">Telegram alerts</h2>';
  if (!bot) return `<section class="panel alerts">${head}<p class="result-empty">Telegram alerts are not switched on yet.</p></section>`;
  const pro = entitlement?.plan === 'pro';
  if (link) {
    return `<section class="panel alerts">${head}
      <p class="alerts-on">Connected to Telegram${pro ? '' : ', but alerts are only sent to Pro members'}.</p>
      <p class="panel-note">You get a message from @${escapeHtml(bot)} when a BUY or SELL signal appears, with entry, stop-loss and take-profit.</p>
      <button class="button button-quiet" type="button" data-telegram="off">Turn off alerts</button></section>`;
  }
  if (!pro) return `<section class="panel alerts">${head}<p class="result-empty">Instant BUY and SELL alerts on Telegram are part of Pro.</p></section>`;
  return `<section class="panel alerts">${head}
    <p class="panel-note">Get a Telegram message the moment a BUY or SELL signal appears.</p>
    ${code ? `<a class="button button-primary" href="https://t.me/${escapeHtml(bot)}?start=${escapeHtml(code)}" target="_blank" rel="noopener">Open Telegram and tap Start</a>
      <p class="panel-note">The link works for 15 minutes. After tapping Start in Telegram, come back and reload this page.</p>`
      : '<button class="button button-primary" type="button" data-telegram="link">Connect Telegram</button>'}
    </section>`;
}

const STATUS = { awaiting: 'Waiting for your payment', pending: 'Paid, being checked', approved: 'Approved, credits added', rejected: 'Rejected', expired: 'Expired' };

function claimsList(claims) {
  const shown = claims.filter((c) => c.status !== 'awaiting');
  if (!shown.length) return '';
  return `<section class="panel"><h2 class="panel-title">Your payments</h2><ul class="claim-list">
    ${shown.map((c) => `<li><span>${dateTime(c.submitted_at || c.created_at)}</span><span>${money(c.amount_usdt)} USDT, ${escapeHtml(c.network.toUpperCase())}</span><span class="claim-status is-${c.status}">${STATUS[c.status]}</span>${c.admin_note && c.status === 'rejected' ? `<span class="claim-note">${escapeHtml(c.admin_note)}</span>` : ''}</li>`).join('')}
  </ul></section>`;
}

function payPanel(networks, open) {
  if (!networks.length) {
    return `<section class="panel pay"><h2 class="panel-title">Pay with USDT</h2>
      <p class="result-empty">Crypto payments are in test mode. No network is open yet: each one is switched on only after a real test payment passes the automatic check.</p></section>`;
  }
  const options = networks.map((n) => `<option value="${n.id}" ${open?.network === n.id ? 'selected' : ''}>${escapeHtml(n.label)}</option>`).join('');
  const net = open ? networks.find((n) => n.id === open.network) : null;
  return `
    <section class="panel pay">
      <h2 class="panel-title">Pay with USDT</h2>
      <label class="field"><span class="field-label">Network</span><select id="pay-network"><option value="">Choose a network</option>${options}</select></label>
      ${open && net ? `
        <div class="pay-box">
          <p class="pay-amount"><span>Send exactly</span><strong id="pay-amount">${money(open.amount_usdt)} USDT</strong></p>
          <p class="pay-warn">The extra cents identify your payment. Send this exact amount on <strong>${escapeHtml(net.label)}</strong> only. If your exchange takes its fee out of the amount sent, the payment will not match. USDT sent on another network cannot be recovered.</p>
          <div class="field"><span class="field-label">To this address</span>
            <div class="copy-row"><code id="pay-address">${escapeHtml(open.receiving_address)}</code><button class="button button-quiet" type="button" data-copy="${escapeHtml(open.receiving_address)}">Copy address</button></div>
          </div>
          <form id="hash-form" class="hash-form" novalidate>
            <label class="field" for="tx-hash"><span class="field-label">Transaction hash</span>
              <input id="tx-hash" name="tx" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${open.network === 'trc20' ? '64 letters and numbers' : '0x followed by 64 letters and numbers'}" />
              <span class="field-hint">Copy it from your wallet or exchange after sending. A screenshot is not accepted as proof.</span></label>
            <button class="button button-primary" type="submit">Submit payment</button>
          </form>
          <p class="panel-note">Open until ${dateTime(open.expires_at)}. Credits are added after the payment is confirmed on chain and approved.</p>
        </div>` : ''}
      <p id="pay-status" class="form-status" role="status"></p>
    </section>`;
}

export function plansPage() {
  const { ready, user, entitlement } = session.get();
  const head = '<header class="page-head"><h1>Plans</h1><p>Free to start. Pro unlocks full signals.</p></header>';
  return {
    title: 'Plans',
    html: `${head}<div id="plans-view"><p class="result-empty">Loading plans…</p></div>`,
    mount(root) {
      const box = root.querySelector('#plans-view');
      let alive = true;
      let open = null;
      let networks = [];
      let claims = [];
      let settings = null;
      let telegramLink = null;
      let telegramCode = null;

      const draw = () => {
        if (!alive) return;
        if (!settings) { box.innerHTML = '<section class="panel"><p class="result-empty">Plans are not set up in the database yet.</p></section>'; return; }
        const price = settings.pro_price_usdt; const credits = settings.credits_per_purchase; const hours = settings.hours_per_credit;
        let body = compare(price, credits, hours);
        if (!user) body = `${body}<section class="panel"><p class="result-empty">Sign in to see your credits and buy Pro.</p><a class="button button-quiet" href="#/profile">Sign in</a></section>`;
        else if (entitlement?.unlimited) body = statusPanel(entitlement) + alertsPanel(settings, entitlement, telegramLink, telegramCode) + body;
        else body = statusPanel(entitlement) + alertsPanel(settings, entitlement, telegramLink, telegramCode) + body + payPanel(networks, open) + claimsList(claims);
        box.innerHTML = body;
      };

      const load = async () => {
        if (!isSupabaseConfigured || !ready) { box.innerHTML = '<p class="result-empty">Checking sign-in…</p>'; return; }
        const s = await getPlanSettings();
        settings = s.ok ? s.data : null;
        if (user) {
          const [n, c, t] = await Promise.all([listNetworks(), listMyClaims(), getMyTelegram()]);
          telegramLink = t.ok ? t.data : null;
          networks = n.ok ? n.data : [];
          claims = c.ok ? c.data : [];
          open = claims.find((x) => x.status === 'awaiting' && new Date(x.expires_at) > new Date()) || null;
        }
        draw();
      };

      const status = (text, tone = '') => { const el = root.querySelector('#pay-status'); if (el) { el.textContent = text; el.className = `form-status ${tone}`; } };

      box.addEventListener('change', async (e) => {
        if (e.target.id !== 'pay-network') return;
        const id = e.target.value;
        if (!id) { open = null; draw(); return; }
        const existing = claims.find((x) => x.status === 'awaiting' && x.network === id && new Date(x.expires_at) > new Date());
        if (existing) { open = existing; draw(); return; }
        status('Preparing your payment…');
        const res = await startPayment(id);
        if (!res.ok) { status(res.message, 'is-error'); return; }
        open = res.data;
        claims = [res.data, ...claims.filter((x) => x.id !== res.data.id)];
        draw();
      });

      box.addEventListener('click', async (e) => {
        const tg = e.target.closest('[data-telegram]');
        if (tg) {
          tg.disabled = true;
          if (tg.dataset.telegram === 'link') {
            const r = await createTelegramCode();
            if (r.ok) telegramCode = r.data;
          } else {
            const r = await unlinkTelegram();
            if (r.ok) telegramLink = null;
          }
          draw();
          return;
        }
        const btn = e.target.closest('[data-copy]');
        if (!btn) return;
        try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = 'Copied'; }
        catch { btn.textContent = 'Copy it by hand'; }
        setTimeout(() => { btn.textContent = 'Copy address'; }, 2500);
      });

      box.addEventListener('submit', async (e) => {
        if (e.target.id !== 'hash-form') return;
        e.preventDefault();
        const hash = e.target.elements.tx.value.trim();
        if (!hash) { status('Paste the transaction hash first.', 'is-error'); return; }
        const button = e.target.querySelector('button');
        button.disabled = true;
        status('Submitting…');
        const res = await submitClaim(open.id, hash);
        button.disabled = false;
        if (!res.ok) { status(res.message, 'is-error'); return; }
        claims = [res.data, ...claims.filter((x) => x.id !== res.data.id)];
        open = null;
        draw();
        status('Payment submitted. Credits are added once it is confirmed on chain and approved.', 'is-ok');
        refreshEntitlement();
      });

      load();
      return () => { alive = false; };
    },
  };
}
