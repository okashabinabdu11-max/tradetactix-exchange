// Administrator dashboard. Every action here is checked again by the database
// (is_admin) or by the server; hiding this page from others is only a convenience.

import { session } from '../state/session.js';
import {
  adminOverview, adminListClaims, adminReviewClaim, adminListUsers, adminGrantCredits,
  adminUpdateSettings, adminSetNetwork, adminVerifyPayment, listNetworks, getPlanSettings,
  adminSetupTelegram, adminRecentAlerts,
} from '../services/backend.js';
import { escapeHtml } from '../lib/format.js';

const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const money = (n) => Number(n).toFixed(2);
const short = (h) => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h || '');

// Candidate token contracts to check, with where they were found. They are
// NOT applied automatically: confirm each on the chain's explorer first.
export const TOKEN_HINTS = Object.freeze({
  bep20: { contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, explorer: 'https://bscscan.com/token/0x55d398326f99059fF775485246999027B3197955', note: 'Binance-Peg USDT (shown as BSC-USD). Binance issues it, not Tether. Beware look-alike tokens with the same name.' },
  trc20: { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6, explorer: 'https://tronscan.org/#/contract/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', note: 'Listed on Tether’s supported protocols page.' },
  plasma: { contract: '0xB8CE59FC3717Ada4C02eadf9682A9e934F625ebb', decimals: null, explorer: 'https://plasmascan.to/token/0xB8CE59FC3717Ada4C02eadf9682A9e934F625ebb', note: 'USDT0, as announced by an exchange. Not confirmed by Tether. Read the decimals on Plasmascan.' },
  aptos: { contract: null, decimals: null, explorer: null, note: 'No automatic check exists for Aptos yet, so it cannot be switched on.' },
});

function checkResult(r) {
  if (!r) return '<span class="chk chk-none">Not checked</span>';
  if (r.ok) return `<span class="chk chk-ok">Passed: ${escapeHtml(r.received)} USDT, ${r.confirmations} confirmations</span>`;
  return `<span class="chk chk-fail">Failed: ${escapeHtml((r.problems || []).join(' '))}</span>`;
}

function claimsSection(claims, tab) {
  const tabBtn = (id, label) => `<button type="button" class="tab-btn" data-tab="${id}" aria-pressed="${tab === id}">${label}</button>`;
  const rows = claims.map((c) => `
    <li class="admin-claim" data-claim="${c.id}">
      <div class="admin-claim-top"><strong>${escapeHtml(c.email)}</strong><span>${money(c.amount_usdt)} USDT · ${c.credits} credits · ${escapeHtml(c.network.toUpperCase())}</span><span class="claim-status is-${c.status}">${c.status}</span></div>
      <div class="admin-claim-hash">${c.tx_hash ? (c.explorer_tx_url ? `<a class="inline-link" href="${escapeHtml(c.explorer_tx_url + c.tx_hash)}" target="_blank" rel="noopener">${escapeHtml(short(c.tx_hash))}</a>` : escapeHtml(short(c.tx_hash))) : 'No hash yet'} · submitted ${dateTime(c.submitted_at)}</div>
      ${c.status === 'pending' ? `
        <div>${checkResult(c.onchain)}</div>
        <div class="admin-actions">
          <button class="button button-quiet" type="button" data-act="check">Check on chain</button>
          <button class="button button-primary" type="button" data-act="approve" ${c.onchain_verified_at ? '' : 'disabled title="Run a passing on-chain check first"'}>Approve and add credits</button>
          <button class="button button-quiet is-danger" type="button" data-act="reject">Reject</button>
        </div>` : c.admin_note ? `<div class="claim-note">${escapeHtml(c.admin_note)}</div>` : ''}
    </li>`).join('');
  return `
    <section class="panel admin-section">
      <h2 class="panel-title">Payment claims</h2>
      <div class="tab-row">${tabBtn('pending', 'Waiting for review')}${tabBtn('all', 'All submitted')}${tabBtn('awaiting', 'Not paid yet')}</div>
      ${rows ? `<ul class="admin-claims">${rows}</ul>` : '<p class="result-empty">Nothing here.</p>'}
    </section>`;
}

function testSection(networks) {
  const options = networks.filter((n) => n.auto_verify).map((n) => `<option value="${n.id}">${escapeHtml(n.label)}</option>`).join('');
  return `
    <section class="panel admin-section">
      <h2 class="panel-title">Test a transaction</h2>
      <p class="panel-note">Before switching a network on, send a small real USDT payment to its address and check it here. This records nothing and adds no credits. It uses the contract and decimals typed in the network's form below, even before they are saved.</p>
      <form id="test-form" class="admin-form" novalidate>
        <label class="field"><span class="field-label">Network</span><select name="network">${options}</select></label>
        <label class="field"><span class="field-label">Transaction hash</span><input name="hash" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" /></label>
        <label class="field"><span class="field-label">Amount sent (USDT, optional)</span><input name="amount" type="number" step="0.01" min="0" inputmode="decimal" /></label>
        <button class="button button-primary" type="submit">Run check</button>
      </form>
      <div id="test-result" aria-live="polite"></div>
    </section>`;
}

function networksSection(networks) {
  return `
    <section class="panel admin-section">
      <h2 class="panel-title">Payment networks</h2>
      <p class="panel-note">Receiving addresses are fixed in the database exactly as you supplied them. A network can only be switched on after it is marked verified, with its token contract and decimals set.</p>
      ${networks.map((n) => {
        const hint = TOKEN_HINTS[n.id] || {};
        return `
        <form class="net-form" data-net="${n.id}" novalidate>
          <div class="net-head"><strong>${escapeHtml(n.label)}</strong><span class="claim-status ${n.enabled ? 'is-approved' : 'is-expired'}">${n.enabled ? 'Open' : 'Closed'}</span></div>
          <p class="net-address"><span class="field-label">Receiving address</span><code>${escapeHtml(n.receiving_address)}</code></p>
          ${n.auto_verify ? `
          <label class="field"><span class="field-label">USDT token contract</span><input name="contract" type="text" value="${escapeHtml(n.token_contract || '')}" autocomplete="off" autocapitalize="none" spellcheck="false" /></label>
          <label class="field"><span class="field-label">Token decimals</span><input name="decimals" type="number" min="0" max="30" step="1" value="${n.token_decimals ?? ''}" /></label>
          ${hint.contract ? `<p class="net-hint">Candidate to check: <code>${escapeHtml(hint.contract)}</code>${hint.decimals !== null ? `, ${hint.decimals} decimals` : ''}. ${escapeHtml(hint.note)} <a class="inline-link" href="${escapeHtml(hint.explorer)}" target="_blank" rel="noopener">Open on explorer</a> <button class="link-button" type="button" data-hint>Fill in</button></p>` : ''}
          <label class="check"><input type="checkbox" name="verified" ${n.verified ? 'checked' : ''} /><span>I checked the contract on the explorer and a test payment to this address passed</span></label>
          <label class="check"><input type="checkbox" name="enabled" ${n.enabled ? 'checked' : ''} /><span>Open this network to customers</span></label>
          <button class="button button-quiet" type="submit">Save network</button>` : `<p class="net-hint">${escapeHtml(hint.note || 'No automatic check for this network.')}</p>`}
          <p class="form-status" role="status"></p>
        </form>`;
      }).join('')}
    </section>`;
}

function settingsSection(s) {
  const num = (name, label, value, attrs) => `<label class="field"><span class="field-label">${label}</span><input name="${name}" type="number" value="${value}" ${attrs} /></label>`;
  const box = (name, label, on) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} /><span>${label}</span></label>`;
  return `
    <section class="panel admin-section">
      <h2 class="panel-title">Plans and features</h2>
      <form id="settings-form" class="admin-form" novalidate>
        <div class="field-row">
          ${num('pro_price_usdt', 'Pro price (USDT)', s.pro_price_usdt, 'step="0.01" min="0.01" inputmode="decimal"')}
          ${num('credits_per_purchase', 'Credits per purchase', s.credits_per_purchase, 'step="1" min="1" max="3650"')}
          ${num('hours_per_credit', 'Hours of Pro per credit', s.hours_per_credit, 'step="1" min="1" max="720"')}
          ${num('free_previews_per_month', 'Free signal previews a month', s.free_previews_per_month, 'step="1" min="0" max="1000"')}
        </div>
        <fieldset class="checks"><legend class="field-label">Also give Free users</legend>
          ${box('free_shows_levels', 'Full signals with entry, stop-loss and take-profit', s.free_shows_levels)}
          ${box('free_analysis', 'Technical and fundamental analysis', s.free_analysis)}
          ${box('free_advanced_journal', 'Advanced journal pages', s.free_advanced_journal)}
        </fieldset>
        <button class="button button-primary" type="submit">Save settings</button>
        <p class="form-status" role="status"></p>
        <p class="panel-note">A new price applies to payments started after saving.</p>
      </form>
    </section>`;
}

function telegramSection(settings, alerts) {
  const bot = settings?.telegram_bot_username;
  return `
    <section class="panel admin-section">
      <h2 class="panel-title">Telegram alerts</h2>
      <p class="panel-note">${bot ? `Bot: @${escapeHtml(bot)}. Pro members who connect it get one message per new BUY or SELL.` : 'Not connected. Add the bot token to the server settings, then tap Connect bot.'}</p>
      <div class="admin-actions"><button class="button button-quiet" type="button" data-telegram-setup>${bot ? 'Reconnect bot' : 'Connect bot'}</button></div>
      <p class="form-status" id="tg-status" role="status"></p>
      ${alerts.length ? `<ul class="claim-list">${alerts.map((a) => `<li><span>${dateTime(a.sent_at)}</span><span>${a.state.toUpperCase()}</span><span>${a.recipients} sent</span></li>`).join('')}</ul>` : '<p class="result-empty">No alerts sent yet.</p>'}
    </section>`;
}

function usersSection(users) {
  return `
    <section class="panel admin-section">
      <h2 class="panel-title">Users and subscriptions</h2>
      <form id="user-search" class="search-row" novalidate><input name="q" type="search" placeholder="Search by email" autocapitalize="none" /><button class="button button-quiet" type="submit">Search</button></form>
      <ul class="admin-users">
        ${users.map((u) => `
          <li data-user="${u.user_id}">
            <div><strong>${escapeHtml(u.email || '(no email)')}</strong>${u.is_admin ? ' <span class="tag">Admin</span>' : ''}</div>
            <div class="user-meta">Joined ${dateTime(u.created_at)} · ${u.is_admin ? 'Unlimited' : u.pro_until && new Date(u.pro_until) > new Date() ? `Pro until ${dateTime(u.pro_until)}` : 'Free'}</div>
            ${u.is_admin ? '' : `<form class="grant-form" novalidate><input name="credits" type="number" step="1" min="-3650" max="3650" placeholder="Credits, e.g. 30 or -5" /><input name="note" type="text" placeholder="Note" maxlength="200" /><button class="button button-quiet" type="submit">Apply</button><span class="form-status" role="status"></span></form>`}
          </li>`).join('') || '<li class="result-empty">No users found.</li>'}
      </ul>
    </section>`;
}

export function adminPage() {
  const { ready, user, entitlement } = session.get();
  const head = '<header class="page-head"><h1>Admin</h1><p>Payments, plans, networks and users.</p></header>';
  if (!ready) return { title: 'Admin', html: `${head}<p class="result-empty">Checking sign-in…</p>` };
  if (!user || !entitlement?.is_admin) {
    return { title: 'Admin', html: `${head}<section class="panel"><p class="result-empty">This page is for administrators.</p></section>` };
  }
  return {
    title: 'Admin',
    html: `${head}<div id="admin-view"><p class="result-empty">Loading…</p></div>`,
    mount(root) {
      const box = root.querySelector('#admin-view');
      let alive = true;
      const state = { tab: 'pending', claims: [], networks: [], settings: null, users: [], overview: null, error: null, alerts: [] };

      const draw = () => {
        if (!alive) return;
        if (state.error) { box.innerHTML = `<section class="panel"><ul class="result-errors"><li>${escapeHtml(state.error)}</li></ul><p class="panel-note">Run the plans and payments database script in Supabase, then reload.</p></section>`; return; }
        const o = state.overview;
        box.innerHTML = `
          <dl class="panel stats admin-stats">
            <div class="stat"><dt>Revenue</dt><dd>${money(o.revenue_usdt)}</dd><dd class="sub">USDT approved</dd></div>
            <div class="stat"><dt>Active Pro</dt><dd>${o.active_subscribers}</dd></div>
            <div class="stat"><dt>To review</dt><dd>${o.pending_claims}</dd></div>
            <div class="stat"><dt>Not paid yet</dt><dd>${o.awaiting_payments}</dd></div>
            <div class="stat"><dt>Users</dt><dd>${o.users}</dd></div>
          </dl>
          ${claimsSection(state.claims, state.tab)}
          ${testSection(state.networks)}
          ${networksSection(state.networks)}
          ${settingsSection(state.settings)}
          ${telegramSection(state.settings, state.alerts)}
          ${usersSection(state.users)}`;
      };

      const loadClaims = async () => { const r = await adminListClaims(state.tab); state.claims = r.ok ? r.data : []; };
      const loadAll = async () => {
        const [o, n, s, u] = await Promise.all([adminOverview(), listNetworks(), getPlanSettings(), adminListUsers('')]);
        if (!o.ok) { state.error = o.message; draw(); return; }
        state.overview = o.data; state.networks = n.ok ? n.data : []; state.settings = s.ok ? s.data : {}; state.users = u.ok ? u.data : [];
        const al = await adminRecentAlerts(); state.alerts = al.ok ? al.data : [];
        await loadClaims();
        draw();
      };
      const refreshOverview = async () => { const o = await adminOverview(); if (o.ok) state.overview = o.data; };
      const formStatus = (form, text, tone = '') => { const el = form.querySelector('.form-status'); if (el) { el.textContent = text; el.className = `form-status ${tone}`; } };

      box.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) { state.tab = tab.dataset.tab; await loadClaims(); draw(); return; }

        const tgSetup = e.target.closest('[data-telegram-setup]');
        if (tgSetup) {
          const out = root.querySelector('#tg-status');
          tgSetup.disabled = true; out.textContent = 'Connecting…'; out.className = 'form-status';
          const r = await adminSetupTelegram();
          if (!r.ok) { tgSetup.disabled = false; out.textContent = r.message; out.className = 'form-status is-error'; return; }
          const s = await getPlanSettings(); state.settings = s.ok ? s.data : state.settings;
          draw();
          const again = root.querySelector('#tg-status');
          if (again) { again.textContent = `Connected to @${r.data.username}.`; again.className = 'form-status is-ok'; }
          return;
        }

        const hint = e.target.closest('[data-hint]');
        if (hint) {
          const form = hint.closest('form'); const h = TOKEN_HINTS[form.dataset.net];
          form.elements.contract.value = h.contract;
          if (h.decimals !== null) form.elements.decimals.value = h.decimals;
          formStatus(form, 'Filled in. Check it on the explorer before marking verified.');
          return;
        }

        const act = e.target.closest('[data-act]');
        if (!act) return;
        const li = act.closest('[data-claim]'); const id = li.dataset.claim;
        act.disabled = true;
        if (act.dataset.act === 'check') {
          act.textContent = 'Checking…';
          const r = await adminVerifyPayment({ claimId: id });
          if (!r.ok) { act.disabled = false; act.textContent = 'Check on chain'; li.querySelector('div:nth-of-type(3)').innerHTML = `<span class="chk chk-fail">${escapeHtml(r.message)}</span>`; return; }
        } else if (act.dataset.act === 'approve') {
          const r = await adminReviewClaim(id, true, 'Verified on chain');
          if (!r.ok) { act.disabled = false; alertIn(li, r.message); return; }
          await refreshOverview();
        } else if (act.dataset.act === 'reject') {
          const note = window.prompt ? window.prompt('Reason shown to the customer (optional):', '') : '';
          if (note === null) { act.disabled = false; return; }
          const r = await adminReviewClaim(id, false, note || 'Payment could not be verified.');
          if (!r.ok) { act.disabled = false; alertIn(li, r.message); return; }
          await refreshOverview();
        }
        await loadClaims();
        draw();
      });

      const alertIn = (li, text) => { li.insertAdjacentHTML('beforeend', `<p class="form-status is-error">${escapeHtml(text)}</p>`); };

      box.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        if (f.id === 'test-form') {
          const out = root.querySelector('#test-result');
          const net = root.querySelector(`.net-form[data-net="${f.elements.network.value}"]`);
          const decimals = net?.elements.decimals.value === '' ? null : Number(net?.elements.decimals.value);
          out.innerHTML = '<p class="result-empty">Checking on chain…</p>';
          const r = await adminVerifyPayment({ network: f.elements.network.value, txHash: f.elements.hash.value.trim(), amount: f.elements.amount.value === '' ? null : Number(f.elements.amount.value), tokenContract: net?.elements.contract.value.trim() || undefined, decimals: Number.isInteger(decimals) ? decimals : undefined });
          if (!r.ok) { out.innerHTML = `<ul class="result-errors"><li>${escapeHtml(r.message)}</li></ul>`; return; }
          const d = r.data;
          out.innerHTML = `
            <div class="test-out ${d.problems.length ? 'is-fail' : 'is-ok'}">
              <p><strong>${d.problems.length ? 'Did not pass' : 'Passed'}</strong></p>
              <dl class="kv"><dt>Received at our address</dt><dd>${escapeHtml(d.received)} USDT</dd><dt>Confirmations</dt><dd>${d.confirmations} (needs ${d.minConfirmations})</dd><dt>Time</dt><dd>${dateTime(d.txTime)}</dd><dt>Token contract</dt><dd><code>${escapeHtml(d.tokenContract)}</code></dd><dt>Recipient</dt><dd><code>${escapeHtml(d.recipient)}</code></dd></dl>
              ${d.problems.length ? `<ul class="result-errors">${d.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
            </div>`;
          return;
        }
        if (f.classList.contains('net-form')) {
          const decimals = f.elements.decimals.value === '' ? null : Number(f.elements.decimals.value);
          const net = state.networks.find((n) => n.id === f.dataset.net);
          if (net && f.elements.contract.value.trim().toLowerCase() === net.receiving_address.toLowerCase()) {
            formStatus(f, 'That is your receiving address. The token contract is the address of the USDT token itself; tap Fill in.', 'is-error');
            return;
          }
          formStatus(f, 'Saving…');
          const r = await adminSetNetwork(f.dataset.net, { enabled: f.elements.enabled.checked, verified: f.elements.verified.checked, tokenContract: f.elements.contract.value.trim(), tokenDecimals: Number.isInteger(decimals) ? decimals : null, explorerTxUrl: null });
          if (!r.ok) { formStatus(f, r.message, 'is-error'); return; }
          const n = await listNetworks(); state.networks = n.ok ? n.data : state.networks;
          draw();
          const again = root.querySelector(`.net-form[data-net="${f.dataset.net}"]`);
          if (again) formStatus(again, r.data.enabled ? 'Saved. This network is open to customers.' : 'Saved.', 'is-ok');
          return;
        }
        if (f.id === 'settings-form') {
          const v = (n) => f.elements[n].value;
          formStatus(f, 'Saving…');
          const r = await adminUpdateSettings({
            pro_price_usdt: Number(v('pro_price_usdt')), credits_per_purchase: Number(v('credits_per_purchase')), hours_per_credit: Number(v('hours_per_credit')),
            free_previews_per_month: Number(v('free_previews_per_month')), free_shows_levels: f.elements.free_shows_levels.checked,
            free_analysis: f.elements.free_analysis.checked, free_advanced_journal: f.elements.free_advanced_journal.checked,
          });
          if (!r.ok) { formStatus(f, r.message, 'is-error'); return; }
          state.settings = r.data;
          formStatus(f, 'Settings saved.', 'is-ok');
          return;
        }
        if (f.id === 'user-search') {
          const r = await adminListUsers(f.elements.q.value.trim());
          state.users = r.ok ? r.data : [];
          draw();
          return;
        }
        if (f.classList.contains('grant-form')) {
          const credits = Number(f.elements.credits.value);
          if (!Number.isInteger(credits) || credits === 0) { formStatus(f, 'Enter a whole number of credits, not zero.', 'is-error'); return; }
          const id = f.closest('[data-user]').dataset.user;
          const r = await adminGrantCredits(id, credits, f.elements.note.value.trim());
          if (!r.ok) { formStatus(f, r.message, 'is-error'); return; }
          const u = await adminListUsers(root.querySelector('#user-search').elements.q.value.trim());
          state.users = u.ok ? u.data : state.users;
          await refreshOverview();
          draw();
        }
      });

      loadAll();
      return () => { alive = false; };
    },
  };
}
