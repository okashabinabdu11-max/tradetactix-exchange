// Plans: what Free and Pro include, the signed-in user's credits, and paying
// for Pro with USDT. Credits are added only by the database after an
// administrator approves a payment whose on-chain check passed.

import { session } from '../state/session.js';
import { getPlanSettings, listNetworks, listMyClaims, startPayment, submitClaim, refreshEntitlement, getMyTelegram, createTelegramCode, unlinkTelegram, getMyAccessRequest, requestAccess, notifyAccess, listChartPlans, listEtbMethods, listMyEtbPayments, submitEtbPayment, getChartAccess } from '../services/backend.js';
import { t } from '../lib/i18n.js';
import { isSupabaseConfigured } from '../config.js';
import { escapeHtml } from '../lib/format.js';

const dateTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const money = (n) => Number(n).toFixed(2);

const FREE = ['Signal state only: no direction, entry, stop-loss or take-profit', 'Basic personal trading journal', 'No Telegram alerts or automatic trading'];
const PRO = ['Full BUY and SELL signals', 'Exact entry, stop-loss and take-profit, at least 1:3', 'Telegram alerts the moment a signal appears', 'Technical and fundamental analysis', 'Advanced journal: history, analytics, calendar, discipline'];

function compare(price, credits, hours) {
  const days = Math.round((credits * hours) / 24);
  const list = (items) => `<ul class="plan-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return `
    <div class="plan-grid">
      <section class="panel plan-card"><h2>Free</h2><p class="plan-price">Open to all</p>${list(FREE)}</section>
      <section class="panel plan-card is-pro"><h2>Pro</h2><p class="plan-price">${money(price)} USDT · ${days} days</p>${list(PRO)}
        <p class="panel-note">Pay with USDT and wait for the admin's approval, or request access. It ends automatically. When no setup meets the plan, it shows “Wait — the market setup is analyzing” until one does. Signals are never made up.</p></section>
    </div>`;
}

function statusPanel(e) {
  if (!e) return '';
  if (e.unlimited) return '<section class="panel status-card"><p class="panel-kicker">Your plan</p><p class="status-plan">Pro, unlimited</p><p class="panel-note">Administrator account.</p></section>';
  if (e.plan === 'pro') {
    return `<section class="panel status-card"><p class="panel-kicker">Your plan</p><p class="status-plan">Pro</p>
      <dl class="quote quote-two"><div><dt>Days left</dt><dd>${e.credits}</dd></div><div><dt>Access until</dt><dd class="status-date">${dateTime(e.pro_until)}</dd></div></dl>
      <p class="panel-note">Signals and alerts stop automatically at this time unless your access is extended.</p></section>`;
  }
  return `<section class="panel status-card"><p class="panel-kicker">Your plan</p><p class="status-plan">Free</p>
    <p class="panel-note">No signal access yet.</p></section>`;
}

function accessPanel(request, email) {
  const head = '<h2 class="panel-title">Signal access</h2>';
  if (request?.status === 'pending') {
    return `<section class="panel access">${head}
      <p class="access-wait">Request sent. Wait until the admin approves you.</p>
      <dl class="kv"><dt>Email</dt><dd>${escapeHtml(request.email)}</dd><dt>Telegram</dt><dd>@${escapeHtml(request.telegram_username)}</dd><dt>Sent</dt><dd>${dateTime(request.created_at)}</dd></dl>
      <p class="panel-note">You'll see full signals here and get Telegram alerts as soon as you're approved. Connect Telegram below now so alerts can reach you.</p>
    </section>`;
  }
  const before = request?.status === 'rejected'
    ? `<p class="form-status is-error">Your last request was not approved${request.admin_note ? `: ${escapeHtml(request.admin_note)}` : '.'} You can send a new one.</p>`
    : request?.status === 'approved' ? '<p class="panel-note">Your previous access has ended. Send a new request to continue.</p>' : '';
  return `<section class="panel access">${head}
    <p class="panel-note">Signals are for approved members. Send your details and the admin will choose how long your access lasts.</p>
    ${before}
    <form id="access-form" class="access-form" novalidate>
      <div class="field"><span class="field-label">Email</span><p class="access-email">${escapeHtml(email || '')}</p></div>
      <label class="field" for="tg-user"><span class="field-label">Telegram username</span>
        <input id="tg-user" name="tg" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@yourname" />
        <span class="field-hint">In Telegram: Settings → your profile → Username.</span></label>
      <label class="field" for="access-note"><span class="field-label">Message to the admin (optional)</span>
        <input id="access-note" name="note" type="text" maxlength="300" autocomplete="off" /></label>
      <button class="button button-primary" type="submit">Request access</button>
      <p id="access-status" class="form-status" role="status"></p>
    </form>
  </section>`;
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
  return `<section class="panel alerts">${head}
    <p class="panel-note">${pro ? 'Get a Telegram message the moment a BUY or SELL signal appears.' : 'Connect now so BUY and SELL alerts reach you as soon as your access is approved. Nothing is sent before that.'}</p>
    ${code ? `<a class="button button-primary" href="https://t.me/${escapeHtml(bot)}?start=${escapeHtml(code)}" target="_blank" rel="noopener">Open Telegram and tap Start</a>
      <p class="panel-note">The link works for 15 minutes. After tapping Start in Telegram, come back and reload this page.</p>`
      : '<button class="button button-primary" type="button" data-telegram="link">Connect Telegram</button>'}
    </section>`;
}

const STATUS = { awaiting: 'Waiting for your payment', pending: 'Waiting for approval', approved: 'Approved, Pro added', rejected: 'Rejected', expired: 'Expired' };

function claimsList(claims) {
  const shown = claims.filter((c) => c.status !== 'awaiting');
  if (!shown.length) return '';
  return `<section class="panel"><h2 class="panel-title">Your payments</h2><ul class="claim-list">
    ${shown.map((c) => `<li><span>${dateTime(c.submitted_at || c.created_at)}</span><span>${money(c.amount_usdt)} USDT, ${escapeHtml(c.network.toUpperCase())}</span><span class="claim-status is-${c.status}">${STATUS[c.status]}</span>${c.admin_note && c.status === 'rejected' ? `<span class="claim-note">${escapeHtml(c.admin_note)}</span>` : ''}</li>`).join('')}
  </ul></section>`;
}

const NET_NAME = { bep20: 'USDT · BEP20 (BNB Chain)', trc20: 'USDT · TRC20 (TRON)', plasma: 'USDT · Plasma', aptos: 'USDT · Aptos' };
const shortHash = (h) => (h && h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h || '');

// Get Pro: button → payment methods → exact amount and address → (after copying) hash → waiting for approval.
function proPanel({ settings, networks, open, claims, ui }) {
  const days = Math.round((settings.credits_per_purchase * settings.hours_per_credit) / 24);
  const price = money(settings.pro_price_usdt);
  const pending = claims.find((c) => c.status === 'pending');
  if (pending) {
    return `
      <section class="panel pay pay-wait" id="pro-panel">
        <h2 class="panel-title">Waiting for approval</h2>
        <p class="pay-amount"><span>${escapeHtml(NET_NAME[pending.network] || pending.network)}</span><strong>${money(pending.amount_usdt)} USDT</strong></p>
        <p class="panel-note">Transaction <code>${escapeHtml(shortHash(pending.tx_hash))}</code>, sent ${dateTime(pending.submitted_at)}.</p>
        <p>The admin checks your payment on the blockchain, then approves it. Pro starts as soon as it is approved, and you get a Telegram message if your Telegram is connected.</p>
        <p class="panel-note">Question about your payment? Message <a class="inline-link" href="https://t.me/Tradetactix1" target="_blank" rel="noopener">@Tradetactix1</a>.</p>
      </section>`;
  }
  if (!ui.showPay) {
    return `
      <section class="panel pay pro-offer" id="pro-panel">
        <h2 class="panel-title">Get Pro</h2>
        <p class="pay-amount"><span>${days} days of full signals</span><strong>${price} USDT</strong></p>
        <p class="panel-note">Pay with USDT. After the admin approves your payment, signals and Telegram alerts start, and stop automatically after ${days} days.</p>
        <div class="form-actions"><button class="button button-primary" type="button" data-pay="start">Get Pro</button></div>
      </section>`;
  }
  if (!networks.length) {
    return `
      <section class="panel pay" id="pro-panel">
        <h2 class="panel-title">Get Pro</h2>
        <p class="result-empty">Payments are not open right now. Message <a class="inline-link" href="https://t.me/Tradetactix1" target="_blank" rel="noopener">@Tradetactix1</a> on Telegram to get Pro.</p>
      </section>`;
  }
  const methods = networks.map((n) => `<button class="pay-method ${open?.network === n.id ? 'is-on' : ''}" type="button" data-net="${n.id}" aria-pressed="${open?.network === n.id}">${escapeHtml(NET_NAME[n.id] || n.label)}</button>`).join('');
  const net = open ? networks.find((n) => n.id === open.network) : null;
  return `
    <section class="panel pay" id="pro-panel">
      <h2 class="panel-title">Get Pro · ${price} USDT for ${days} days</h2>
      <p class="field-label">1. Choose how to pay</p>
      <div class="pay-methods">${methods}</div>
      ${open && net ? `
        <div class="pay-box">
          <p class="field-label">2. Send exactly this amount</p>
          <p class="pay-amount"><span>${escapeHtml(NET_NAME[net.id] || net.label)}</span><strong id="pay-amount">${money(open.amount_usdt)} USDT</strong></p>
          <p class="pay-warn">The extra cents identify your payment, so send <strong>exactly ${money(open.amount_usdt)} USDT</strong>, and only on <strong>${escapeHtml(net.label)}</strong>. If your exchange takes its fee from the amount, add the fee so the full amount arrives. USDT sent on another network cannot be recovered.</p>
          <div class="field"><span class="field-label">To this address</span>
            <div class="copy-row"><code id="pay-address">${escapeHtml(open.receiving_address)}</code><button class="button ${ui.copied ? 'button-quiet' : 'button-primary'}" type="button" data-copy="${escapeHtml(open.receiving_address)}">${ui.copied ? 'Copied' : 'Copy address'}</button></div>
          </div>
          ${ui.copied ? `
          <form id="hash-form" class="hash-form" novalidate>
            <p class="field-label">3. After sending, paste the transaction hash</p>
            <label class="field" for="tx-hash"><span class="sr-only">Transaction hash</span>
              <input id="tx-hash" name="tx" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${open.network === 'trc20' ? '64 letters and numbers' : '0x followed by 64 letters and numbers'}" />
              <span class="field-hint">Find it in your wallet or exchange, in the details of this withdrawal (also called TxID). A screenshot is not accepted.</span></label>
            <button class="button button-primary" type="submit">I've paid</button>
          </form>` : '<button class="link-button" type="button" data-pay="show-hash">I already sent it</button>'}
          <p class="panel-note">This payment stays open until ${dateTime(open.expires_at)}.</p>
        </div>` : ''}
      <p id="pay-status" class="form-status" role="status"></p>
    </section>`;
}

// ---------- Chart Pro: paid in birr (Telebirr or CBE), separate from signals Pro ----------
const birr = (n) => `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ETB`;
const daysText = (d) => (d === 1 ? t('1 day') : `${d} ${t('days')}`);
const CHART_FEATURES = ['Every indicator on the chart: EMA 50 and 200, Bollinger Bands, MACD, Stochastic, ATR', 'Works on every pair and timeframe', 'Drawing tools stay free for everyone'];
const ETB_STATUS = { pending: 'Waiting for approval', approved: 'Approved, Chart Pro added', rejected: 'Not approved' };

export function chartProPanel({ chart, user, cui }) {
  const head = `<h2 class="panel-title">${t('Chart Pro')}</h2>`;
  const features = `<ul class="plan-list">${CHART_FEATURES.map((f) => `<li>${t(f)}</li>`).join('')}</ul>`;
  if (!chart) return `<section class="panel pay chart-pro" id="chart-pro">${head}<p class="result-empty">${t('Chart Pro is not set up in the database yet.')}</p></section>`;
  const { plans, methods, payments, access } = chart;
  const from = plans.length ? Math.min(...plans.map((p) => Number(p.price_etb))) : null;
  if (!user) {
    return `<section class="panel pay chart-pro" id="chart-pro">${head}${features}
      ${from !== null ? `<p class="pay-amount"><span>${t('Paid in birr')}</span><strong>${t('from')} ${birr(from)}</strong></p>` : ''}
      <p class="panel-note">${t('Open your account to get Chart Pro.')}</p><a class="button button-quiet" href="#/home">${t('Open Account')}</a></section>`;
  }
  if (access?.unlimited) return `<section class="panel pay chart-pro" id="chart-pro">${head}<p class="alerts-on">${t('Chart Pro is always on for administrators.')}</p></section>`;
  const active = access?.chart_pro && access.chart_until ? `<p class="alerts-on">${t('Chart Pro active until')} ${dateTime(access.chart_until)}</p>` : '';
  const pending = payments.find((x) => x.status === 'pending');
  const history = payments.length ? `<ul class="claim-list">${payments.map((x) => `<li><span>${dateTime(x.created_at)}</span><span>${escapeHtml(x.plan_name || '')} · ${birr(x.amount_etb)} · ${x.method === 'cbe' ? 'CBE' : 'Telebirr'}</span><span class="claim-status is-${x.status}">${t(ETB_STATUS[x.status] || x.status)}</span>${x.admin_note && x.status === 'rejected' ? `<span class="claim-note">${escapeHtml(x.admin_note)}</span>` : ''}</li>`).join('')}</ul>` : '';
  if (pending) {
    return `<section class="panel pay pay-wait chart-pro" id="chart-pro"><h2 class="panel-title">${t('Chart Pro: waiting for approval')}</h2>${active}
      <p class="pay-amount"><span>${escapeHtml(pending.plan_name)} · ${pending.method === 'cbe' ? 'CBE' : 'Telebirr'}</span><strong>${birr(pending.amount_etb)}</strong></p>
      <p class="panel-note">${t('Reference')} <code>${escapeHtml(pending.reference)}</code>, ${t('sent')} ${dateTime(pending.created_at)}.</p>
      <p>${t('The admin checks that the money arrived, then approves. Chart Pro opens on the Chart page as soon as it is approved.')}</p>
      <p class="panel-note">${t('Question about your payment? Message')} <a class="inline-link" href="https://t.me/Tradetactix1" target="_blank" rel="noopener">@Tradetactix1</a>.</p>
      ${history}</section>`;
  }
  if (!cui.show) {
    return `<section class="panel pay pro-offer chart-pro" id="chart-pro">${head}${active}${features}
      ${from !== null ? `<p class="pay-amount"><span>${t('Paid in birr: Telebirr or CBE')}</span><strong>${t('from')} ${birr(from)}</strong></p>` : ''}
      <div class="form-actions"><button class="button button-primary" type="button" data-cp="start">${access?.chart_pro ? t('Extend Chart Pro') : t('Get Chart Pro')}</button></div>
      ${history}</section>`;
  }
  if (!plans.length || !methods.length) {
    return `<section class="panel pay chart-pro" id="chart-pro">${head}
      <p class="result-empty">${t('Chart Pro payments are not open yet. Message')} <a class="inline-link" href="https://t.me/Tradetactix1" target="_blank" rel="noopener">@Tradetactix1</a>.</p></section>`;
  }
  const plan = plans.find((p) => p.id === cui.plan);
  const method = methods.find((m) => m.id === cui.method);
  const planBtns = plans.map((p) => `<button class="pay-method ${cui.plan === p.id ? 'is-on' : ''}" type="button" data-cp-plan="${p.id}" aria-pressed="${cui.plan === p.id}"><strong>${escapeHtml(p.name)}</strong> · ${daysText(p.days)} · ${birr(p.price_etb)}</button>`).join('');
  const methodBtns = methods.map((m) => `<button class="pay-method ${cui.method === m.id ? 'is-on' : ''}" type="button" data-cp-method="${m.id}" aria-pressed="${cui.method === m.id}">${escapeHtml(m.label)}</button>`).join('');
  return `<section class="panel pay chart-pro" id="chart-pro">
    <h2 class="panel-title">${t('Get Chart Pro')}</h2>
    <p class="field-label">${t('1. Choose a plan')}</p><div class="pay-methods">${planBtns}</div>
    ${plan ? `<p class="field-label">${t('2. Choose how to pay')}</p><div class="pay-methods">${methodBtns}</div>` : ''}
    ${plan && method ? `
      <div class="pay-box">
        <p class="field-label">${t('3. Send exactly this amount')}</p>
        <p class="pay-amount"><span>${escapeHtml(plan.name)} · ${daysText(plan.days)}</span><strong>${birr(plan.price_etb)}</strong></p>
        <dl class="kv"><dt>${t('Method')}</dt><dd>${escapeHtml(method.label)}</dd><dt>${t('Account name')}</dt><dd>${escapeHtml(method.account_name)}</dd></dl>
        <div class="field"><span class="field-label">${method.id === 'cbe' ? t('Account number') : t('Telebirr number')}</span>
          <div class="copy-row"><code>${escapeHtml(method.account_number)}</code><button class="button ${cui.copied ? 'button-quiet' : 'button-primary'}" type="button" data-cp-copy="${escapeHtml(method.account_number)}">${cui.copied ? t('Copied') : t('Copy number')}</button></div>
        </div>
        <p class="pay-warn">${t('Check that the account name matches before you send. Send the full amount in one payment.')}</p>
        ${cui.copied ? `
        <form id="etb-form" class="hash-form" novalidate>
          <p class="field-label">${t('4. After paying, enter the transaction reference')}</p>
          <label class="field" for="etb-ref"><span class="sr-only">${t('Transaction reference')}</span>
            <input id="etb-ref" name="ref" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${method.id === 'cbe' ? 'FT…' : t('Transaction number')}" maxlength="40" />
            <span class="field-hint">${method.id === 'cbe' ? t('The FT reference on your CBE receipt or SMS.') : t('The transaction number in your Telebirr SMS or receipt.')}</span></label>
          <button class="button button-primary" type="submit">${t("I've paid")}</button>
        </form>` : `<button class="link-button" type="button" data-cp="show-ref">${t('I already paid')}</button>`}
      </div>` : ''}
    <p id="etb-status" class="form-status" role="status"></p>
  </section>`;
}

export function plansPage() {
  const { ready, user, entitlement } = session.get();
  const head = '<header class="page-head"><h1>Plans</h1><p>Get Pro with USDT, or request access. Signals start after the admin approves.</p></header>';
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
      let accessRequest = null;
      const ui = { showPay: false, copied: false };
      const cui = { show: false, plan: null, method: null, copied: false };
      let chart = null;

      const draw = () => {
        if (!alive) return;
        if (!settings) { box.innerHTML = `<section class="panel"><p class="result-empty">Plans are not set up in the database yet.</p></section>${chartProPanel({ chart, user, cui })}`; return; }
        const price = settings.pro_price_usdt; const credits = settings.credits_per_purchase; const hours = settings.hours_per_credit;
        let body = compare(price, credits, hours);
        if (!user) body = `${body}<section class="panel"><p class="result-empty">Open your account to request signal access.</p><a class="button button-quiet" href="#/home">Open Account</a></section>`;
        else if (entitlement?.unlimited) body = statusPanel(entitlement) + alertsPanel(settings, entitlement, telegramLink, telegramCode) + body;
        else {
          const isPro = entitlement?.plan === 'pro';
          // Members can extend Pro too; a payment adds days after the current end.
          body = statusPanel(entitlement) + proPanel({ settings, networks, open, claims, ui })
            + (isPro ? '' : accessPanel(accessRequest, user.email)) + alertsPanel(settings, entitlement, telegramLink, telegramCode) + claimsList(claims) + body;
        }
        box.innerHTML = body + chartProPanel({ chart, user, cui });
        let goto = null;
        try { goto = sessionStorage.getItem('tt-goto'); sessionStorage.removeItem('tt-goto'); } catch { /* private mode */ }
        if (goto === 'chart-pro') root.querySelector('#chart-pro')?.scrollIntoView({ block: 'start' });
      };

      const loadChart = async () => {
        const p = await listChartPlans();
        if (!p.ok) { chart = null; return; }
        if (!user) { chart = { plans: p.data, methods: [], payments: [], access: null }; return; }
        const [m, pay, access] = await Promise.all([listEtbMethods(), listMyEtbPayments(), getChartAccess()]);
        chart = { plans: p.data, methods: m.ok ? m.data.filter((x) => x.enabled) : [], payments: pay.ok ? pay.data : [], access };
      };
      const cstatus = (text, tone = '') => { const el = root.querySelector('#etb-status'); if (el) { el.textContent = text; el.className = `form-status ${tone}`; } };

      const load = async () => {
        if (!isSupabaseConfigured || !ready) { box.innerHTML = '<p class="result-empty">Checking sign-in…</p>'; return; }
        const [s] = await Promise.all([getPlanSettings(), loadChart()]);
        settings = s.ok ? s.data : null;
        if (user) {
          const [n, c, t, a] = await Promise.all([listNetworks(), listMyClaims(), getMyTelegram(), getMyAccessRequest()]);
          telegramLink = t.ok ? t.data : null;
          accessRequest = a.ok ? a.data : null;
          networks = n.ok ? n.data : [];
          claims = c.ok ? c.data : [];
          open = claims.find((x) => x.status === 'awaiting' && new Date(x.expires_at) > new Date()) || null;
          if (open) ui.showPay = true; // continue a payment that was started earlier
        }
        draw();
      };

      const status = (text, tone = '') => { const el = root.querySelector('#pay-status'); if (el) { el.textContent = text; el.className = `form-status ${tone}`; } };

      const chooseNetwork = async (id) => {
        ui.copied = false;
        const existing = claims.find((x) => x.status === 'awaiting' && x.network === id && new Date(x.expires_at) > new Date());
        if (existing) { open = existing; draw(); return; }
        status('Preparing your payment…');
        const res = await startPayment(id);
        if (!res.ok) { status(res.message, 'is-error'); return; }
        open = res.data;
        claims = [res.data, ...claims.filter((x) => x.id !== res.data.id)];
        draw();
      };

      box.addEventListener('click', async (e) => {
        const cp = e.target.closest('[data-cp]');
        if (cp) {
          if (cp.dataset.cp === 'start') { cui.show = true; if (chart?.plans.length === 1) cui.plan = chart.plans[0].id; draw(); root.querySelector('#chart-pro')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          if (cp.dataset.cp === 'show-ref') { cui.copied = true; draw(); root.querySelector('#etb-ref')?.focus(); }
          return;
        }
        const cpPlan = e.target.closest('[data-cp-plan]');
        if (cpPlan) { cui.plan = cpPlan.dataset.cpPlan; cui.copied = false; draw(); return; }
        const cpMethod = e.target.closest('[data-cp-method]');
        if (cpMethod) { cui.method = cpMethod.dataset.cpMethod; cui.copied = false; draw(); return; }
        const cpCopy = e.target.closest('[data-cp-copy]');
        if (cpCopy) {
          let ok = true;
          try { await navigator.clipboard.writeText(cpCopy.dataset.cpCopy); } catch { ok = false; }
          cui.copied = true; draw();
          cstatus(ok ? t('Number copied. Pay the exact amount, then enter the transaction reference here.') : t('Copy the number by hand, pay the exact amount, then enter the transaction reference here.'), ok ? 'is-ok' : '');
          return;
        }
        const pay = e.target.closest('[data-pay]');
        if (pay) {
          if (pay.dataset.pay === 'start') { ui.showPay = true; draw(); root.querySelector('#pro-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          if (pay.dataset.pay === 'show-hash') { ui.copied = true; draw(); root.querySelector('#tx-hash')?.focus(); }
          return;
        }
        const netBtn = e.target.closest('[data-net]');
        if (netBtn) { await chooseNetwork(netBtn.dataset.net); return; }
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
        let copied = true;
        try { await navigator.clipboard.writeText(btn.dataset.copy); } catch { copied = false; }
        // After copying, the next step (paste the hash) opens by itself.
        ui.copied = true; draw();
        status(copied ? 'Address copied. Send the exact amount, then paste the transaction hash here.' : 'Copy the address by hand, send the exact amount, then paste the transaction hash here.', copied ? 'is-ok' : '');
      });

      box.addEventListener('submit', async (e) => {
        if (e.target.id === 'etb-form') {
          e.preventDefault();
          const ref = e.target.elements.ref.value.trim().toUpperCase();
          if (!/^[A-Z0-9-]{6,40}$/.test(ref)) { cstatus(t('Enter the transaction reference from your receipt (6 to 40 letters and numbers).'), 'is-error'); return; }
          const button = e.target.querySelector('button');
          button.disabled = true;
          cstatus(t('Submitting…'));
          const res = await submitEtbPayment(cui.plan, cui.method, ref);
          button.disabled = false;
          if (!res.ok) { cstatus(res.message, 'is-error'); return; }
          chart.payments = [res.data, ...chart.payments];
          Object.assign(cui, { show: false, plan: null, method: null, copied: false });
          draw(); // shows "waiting for approval"
          notifyAccess('chart_payment', res.data.id);
          root.querySelector('#chart-pro')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        if (e.target.id === 'access-form') {
          e.preventDefault();
          const f = e.target;
          const st = f.querySelector('#access-status');
          const tg = f.elements.tg.value.trim().replace(/^@/, '');
          if (!/^[A-Za-z0-9_]{5,32}$/.test(tg)) { st.textContent = 'Enter your Telegram username: 5 to 32 letters, numbers or underscores.'; st.className = 'form-status is-error'; return; }
          f.querySelector('button').disabled = true;
          st.textContent = 'Sending…'; st.className = 'form-status';
          const r = await requestAccess(tg, f.elements.note.value);
          if (!r.ok) { f.querySelector('button').disabled = false; st.textContent = r.message; st.className = 'form-status is-error'; return; }
          accessRequest = r.data;
          draw();
          notifyAccess('request', r.data.id);
          return;
        }
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
        open = null; ui.showPay = false; ui.copied = false;
        draw(); // shows "Waiting for approval"
        notifyAccess('payment', res.data.id);
        root.querySelector('#pro-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      load();
      return () => { alive = false; };
    },
  };
}
