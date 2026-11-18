// The first page everyone sees: what TradeTactix does, Open Account, and a
// Dashboard button that opens the app with all its sections. Nothing here is a
// live signal or a result: the colour row only explains what members will see.

import { session } from '../state/session.js';
import { isSupabaseConfigured } from '../config.js';
import { escapeHtml } from '../lib/format.js';
import { profilePage, signedOutMarkup, setPasswordMarkup, mountSetPassword } from './profile.js';
import { needsPassword, signInWithGoogle } from '../services/backend.js';
import { getSignalStats } from '../services/backend.js';
import { themeToggle } from '../ui/theme.js';
import { t, langToggle } from '../lib/i18n.js';

const CHANNEL = 'https://t.me/Tradetactix';

// One card per period. Win rate = TP / (TP + SL); breakeven closes are listed, not counted.
function statCard(title, s) {
  const decided = s.wins + s.losses;
  const pips = Math.round(Number(s.pips) || 0);
  const total = decided + s.breakeven;
  return `
    <div class="stat-card">
      <h3>${t(title)}</h3>
      ${total === 0
        ? `<p class="stat-rate is-empty">—</p><p class="stat-line">${t('No signals closed yet in this period.')}</p>`
        : `<p class="stat-rate">${decided ? `${Math.round((s.wins / decided) * 100)}%` : '—'}<span>${t('win rate')}</span></p>
           <p class="stat-line"><span class="tone-green">${s.wins} TP</span> · <span class="tone-red">${s.losses} SL</span>${s.breakeven ? ` · <span class="tone-blue">${s.breakeven} BE</span>` : ''}</p>
           <p class="stat-line">${pips > 0 ? '+' : pips < 0 ? '−' : ''}${Math.abs(pips)} pips</p>`}
    </div>`;
}

function statsMarkup(rows) {
  const by = Object.fromEntries((rows || []).map((r) => [r.period, { wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, breakeven: Number(r.breakeven) || 0, pips: r.pips }]));
  const zero = { wins: 0, losses: 0, breakeven: 0, pips: 0 };
  return statCard('Last 7 days', by.week || zero) + statCard('Last 30 days', by.month || zero);
}

const STAGES = [
  ['yellow', 'Analyzing'],
  ['orange', 'Signal running'],
  ['blue', 'Put BE'],
  ['green', 'TP Done'],
  ['red', 'SL hit'],
];

export function homePage() {
  const { ready, user, authNotice, entitlement } = session.get();
  const approved = entitlement?.plan === 'pro';

  let account;
  if (!isSupabaseConfigured) account = '<section class="panel auth"><p class="result-empty">Sign-in is unavailable right now.</p></section>';
  else if (!ready) account = '<section class="panel auth"><p class="result-empty">Checking sign-in…</p></section>';
  else if (user) {
    account = `${needsPassword(user) ? setPasswordMarkup() : ''}
      <section class="panel auth home-signed-in">
        <p class="field-label">${t(`Signed in as`)}</p>
        <p class="auth-email">${escapeHtml(user.email || 'your account')}</p>
        <p class="panel-note">${approved ? t('Your signal access is active.') : t('Your account is waiting for signal access. Send your Telegram username on the Plans page.')}</p>
        <div class="form-actions">
          <a class="button button-primary" href="#/dashboard">${t(`Open dashboard`)}</a>
          ${approved ? '' : `<a class="button button-quiet" href="#/plans">${t('Request access')}</a>`}
        </div>
      </section>`;
  } else account = signedOutMarkup(authNotice);

  const authButtons = user
    ? '<a class="button button-primary" href="#/dashboard" id="home-dashboard">${t(`Dashboard`)}</a>'
    : `<button class="button button-primary" type="button" data-auth="google">${t('Register with Google')}</button>
       <button class="button button-quiet" type="button" data-auth="open">${t('Open Account')}</button>
       <a class="button button-quiet" href="#/dashboard" id="home-dashboard">${t(`Dashboard`)}</a>`;

  return {
    title: 'Gold signals',
    html: `
      <header class="home-bar">
        <a class="brand" href="#/home" aria-label="TradeTactix home"><span class="brand-mark" aria-hidden="true">T</span><span class="brand-name">TradeTactix</span></a>
        <nav class="home-bar-links" aria-label="Account">
          ${langToggle()}
          ${themeToggle()}
          ${user ? `<a class="button button-primary" href="#/dashboard">${t('Dashboard')}</a>` : `<button class="button button-primary" type="button" data-auth="open">${t('Open Account')}</button>`}
        </nav>
      </header>
      <div class="home">
        <section class="home-hero">
          <p class="home-pair">${t(`XAUUSD gold`)}</p>
          <h1>${t(`Gold signals, sent straight to your Telegram.`)}</h1>
          <p class="home-lede">${t(`TradeTactix reads gold on the 4H, 1H and 15M charts and sends a signal only when every step of the plan lines up, with entry, stop-loss and take-profit.`)}</p>
          <div class="form-actions home-cta">${authButtons}</div>
          <ul class="home-stages" aria-label="What the signal screen shows">
            ${STAGES.map(([tone, text]) => `<li class="tone-${tone}"><span class="home-dot"></span>${t(text)}</li>`).join('')}
          </ul>
        </section>

        <section class="home-stats" aria-labelledby="stats-title">
          <h2 id="stats-title">${t(`Signal results`)}</h2>
          <div class="stat-grid" id="stat-grid"><p class="result-empty">${t(`Loading results…`)}</p></div>
          <p class="home-note">${t(`Counted automatically from every signal the bot sent, when it hit TP, SL or breakeven. Past results do not guarantee future results.`)}</p>
        </section>

        <section class="home-app" id="home-app">
          <img src="/icons/icon-192.png" alt="" width="56" height="56" />
          <div>
            <h2>${t(`Get the TradeTactix app`)}</h2>
            <p>${t('On iPhone: open this site in Safari, tap <strong>Share</strong> <span aria-hidden="true">⬆️</span>, then <strong>Add to Home Screen</strong>. It opens full screen like an app.')}</p>
            <button class="button button-primary" type="button" id="install-app" hidden>${t(`Install app`)}</button>
          </div>
        </section>

        <section class="home-channel">
          <div><h2>${t(`Join our Telegram channel`)}</h2><p>${t('News, updates and results from TradeTactix:')} <strong>@Tradetactix</strong></p></div>
          <a class="button button-primary" href="${CHANNEL}" target="_blank" rel="noopener" id="channel-link">${t(`Join @Tradetactix`)}</a>
        </section>

        <section class="home-auth" id="home-auth" aria-labelledby="home-auth-title">
          <h2 id="home-auth-title">${user ? t('Your account') : t('Open your account')}</h2>
          ${account}
        </section>

        <section class="home-points">
          <div><h3>${t(`Full trade plan`)}</h3><p>${t(`Every signal has entry, stop-loss and take-profit, aims for at least 1:3, and keeps the stop-loss tight.`)}</p></div>
          <div><h3>${t(`Updates while it runs`)}</h3><p>${t(`Telegram tells you when to put your stop at breakeven, and when the trade hits TP or SL, with the pips.`)}</p></div>
          <div><h3>${t(`Members only`)}</h3><p>${t(`Access is approved by the admin for a set time and stops by itself when it ends.`)}</p></div>
        </section>

        <section class="home-join">
          <h2>${t(`How to join`)}</h2>
          <ol>
            <li><span>${t('<strong>Register with Google</strong> on this page, then choose a password.')}</span></li>
            <li><span>${t('<strong>Send your Telegram username</strong> on the Plans page.')}</span></li>
            <li><span>${t('<strong>Get approved</strong> and signals start arriving.')}</span></li>
          </ol>
        </section>

        <section class="home-help"><h2>${t(`Questions?`)}</h2><p>${t('Ask the AI assistant, or message the admin on Telegram at @Tradetactix1.')}</p><div class="form-actions"><a class="button button-quiet" href="#/support">${t(`Contact support`)}</a><a class="button button-quiet" href="https://t.me/Tradetactix1" target="_blank" rel="noopener">Telegram @Tradetactix1</a></div></section>

        <p class="home-foot">${t(`Signals are a rules-based reading of the chart, not financial advice. Trading gold carries a real risk of loss. Live trading is not connected.`)}</p>
      </div>`,
    mount(root) {
      // Open Account buttons jump to the form.
      const choose = () => {
        const form = root.querySelector('#auth-form');
        if (!form) return;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form.querySelector('#email')?.focus({ preventScroll: true });
      };
      const onClick = (e) => {
        const b = e.target.closest('[data-auth]');
        if (!b) return;
        if (b.dataset.auth === 'google') { b.disabled = true; signInWithGoogle().then((r) => { if (!r.ok) { b.disabled = false; choose(); const st = root.querySelector('#auth-status'); if (st) { st.textContent = t(r.message); st.className = 'form-status is-error'; } } }); return; }
        choose(b.dataset.auth);
      };
      mountSetPassword(root);
      root.addEventListener('click', onClick);
      let alive = true;
      // Hide the app card when already opened from the home screen; offer the
      // install button where the browser supports it (Android, desktop Chrome).
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
      if (standalone) root.querySelector('#home-app')?.remove();
      const installBtn = root.querySelector('#install-app');
      if (installBtn && window.__installPrompt) installBtn.hidden = false;
      installBtn?.addEventListener('click', async () => {
        const ev = window.__installPrompt; if (!ev) return;
        ev.prompt(); await ev.userChoice.catch(() => null); window.__installPrompt = null; installBtn.hidden = true;
      });
      getSignalStats().then((res) => {
        const grid = root.querySelector('#stat-grid');
        if (!alive || !grid) return;
        grid.innerHTML = res.ok ? statsMarkup(res.data) : `<p class="result-empty">${t('Results are not available right now.')}</p>`;
      });
      const formCleanup = root.querySelector('#auth-form') ? profilePage().mount(root) : null;
      return () => { alive = false; root.removeEventListener('click', onClick); if (typeof formCleanup === 'function') formCleanup(); };
    },
  };
}
