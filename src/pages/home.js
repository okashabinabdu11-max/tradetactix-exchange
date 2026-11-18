// The first page everyone sees: what TradeTactix does, Sign up / Sign in, and a
// Dashboard button that opens the app with all its sections. Nothing here is a
// live signal or a result: the colour row only explains what members will see.

import { session } from '../state/session.js';
import { isSupabaseConfigured } from '../config.js';
import { escapeHtml } from '../lib/format.js';
import { profilePage, signedOutMarkup } from './profile.js';
import { getSignalStats } from '../services/backend.js';
import { themeToggle } from '../ui/theme.js';

const CHANNEL = 'https://t.me/Tradetactix';

// One card per period. Win rate = TP / (TP + SL); breakeven closes are listed, not counted.
function statCard(title, s) {
  const decided = s.wins + s.losses;
  const pips = Math.round(Number(s.pips) || 0);
  const total = decided + s.breakeven;
  return `
    <div class="stat-card">
      <h3>${title}</h3>
      ${total === 0
        ? '<p class="stat-rate is-empty">—</p><p class="stat-line">No signals closed yet in this period.</p>'
        : `<p class="stat-rate">${decided ? `${Math.round((s.wins / decided) * 100)}%` : '—'}<span>win rate</span></p>
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
    account = `
      <section class="panel auth home-signed-in">
        <p class="field-label">Signed in as</p>
        <p class="auth-email">${escapeHtml(user.email || 'your account')}</p>
        <p class="panel-note">${approved ? 'Your signal access is active.' : 'Your account is waiting for signal access. Send your Telegram username on the Plans page.'}</p>
        <div class="form-actions">
          <a class="button button-primary" href="#/dashboard">Open dashboard</a>
          ${approved ? '' : '<a class="button button-quiet" href="#/plans">Request access</a>'}
        </div>
      </section>`;
  } else account = signedOutMarkup(authNotice);

  const authButtons = user
    ? '<a class="button button-primary" href="#/dashboard" id="home-dashboard">Dashboard</a>'
    : `<button class="button button-primary" type="button" data-auth="signup">Sign up</button>
       <button class="button button-quiet" type="button" data-auth="signin">Sign in</button>
       <a class="button button-quiet" href="#/dashboard" id="home-dashboard">Dashboard</a>`;

  return {
    title: 'Gold signals',
    html: `
      <header class="home-bar">
        <a class="brand" href="#/home" aria-label="TradeTactix AI home"><span class="brand-mark" aria-hidden="true">T</span><span class="brand-name">TradeTactix <span class="brand-ai">AI</span></span></a>
        <nav class="home-bar-links" aria-label="Account">
          ${themeToggle()}
          ${user ? '<a class="button button-primary" href="#/dashboard">Dashboard</a>' : '<button class="button button-quiet" type="button" data-auth="signin">Sign in</button><button class="button button-primary" type="button" data-auth="signup">Sign up</button>'}
        </nav>
      </header>
      <div class="home">
        <section class="home-hero">
          <p class="home-pair">XAUUSD gold</p>
          <h1>Gold signals, sent straight to your Telegram.</h1>
          <p class="home-lede">TradeTactix AI reads gold on the 4H, 1H and 15M charts and sends a signal only when every step of the plan lines up, with entry, stop-loss and take-profit.</p>
          <div class="form-actions home-cta">${authButtons}</div>
          <ul class="home-stages" aria-label="What the signal screen shows">
            ${STAGES.map(([tone, text]) => `<li class="tone-${tone}"><span class="home-dot"></span>${text}</li>`).join('')}
          </ul>
        </section>

        <section class="home-stats" aria-labelledby="stats-title">
          <h2 id="stats-title">Signal results</h2>
          <div class="stat-grid" id="stat-grid"><p class="result-empty">Loading results…</p></div>
          <p class="home-note">Counted automatically from every signal the bot sent, when it hit TP, SL or breakeven. Past results do not guarantee future results.</p>
        </section>

        <section class="home-channel">
          <div><h2>Join our Telegram channel</h2><p>News, updates and results from TradeTactix: <strong>@Tradetactix</strong></p></div>
          <a class="button button-primary" href="${CHANNEL}" target="_blank" rel="noopener" id="channel-link">Join @Tradetactix</a>
        </section>

        <section class="home-auth" id="home-auth" aria-labelledby="home-auth-title">
          <h2 id="home-auth-title">${user ? 'Your account' : 'Create your account or sign in'}</h2>
          ${account}
        </section>

        <section class="home-points">
          <div><h3>Full trade plan</h3><p>Every signal has entry, stop-loss and take-profit, aims for at least 1:3, and risks under $9 at 0.01 lot.</p></div>
          <div><h3>Updates while it runs</h3><p>Telegram tells you when to put your stop at breakeven, and when the trade hits TP or SL, with the pips.</p></div>
          <div><h3>Members only</h3><p>Access is approved by the admin for a set time and stops by itself when it ends.</p></div>
        </section>

        <section class="home-join">
          <h2>How to join</h2>
          <ol>
            <li><span><strong>Sign up</strong> with your email on this page.</span></li>
            <li><span><strong>Send your Telegram username</strong> on the Plans page.</span></li>
            <li><span><strong>Get approved</strong> and signals start arriving.</span></li>
          </ol>
        </section>

        <section class="home-help"><h2>Questions?</h2><p>Ask the support assistant, or message the admin on Telegram at @Tradetactix1.</p><div class="form-actions"><a class="button button-quiet" href="#/support">Contact support</a><a class="button button-quiet" href="https://t.me/Tradetactix1" target="_blank" rel="noopener">Telegram @Tradetactix1</a></div></section>

        <p class="home-foot">Signals are a rules-based reading of the chart, not financial advice. Trading gold carries a real risk of loss. Live trading is not connected.</p>
      </div>`,
    mount(root) {
      // Sign up / Sign in buttons jump to the form and make that choice the main button.
      const choose = (mode) => {
        const form = root.querySelector('#auth-form');
        if (!form) return;
        const up = form.querySelector('button[value="signup"]');
        const inn = form.querySelector('button[value="signin"]');
        const [first, second] = mode === 'signup' ? [up, inn] : [inn, up];
        first.className = 'button button-primary'; second.className = 'button button-quiet';
        first.parentNode.insertBefore(first, second); // Enter submits the chosen action
        root.querySelector('#home-auth-title').textContent = mode === 'signup' ? 'Create your account' : 'Sign in';
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form.querySelector('#email')?.focus({ preventScroll: true });
      };
      const onClick = (e) => { const b = e.target.closest('[data-auth]'); if (b) choose(b.dataset.auth); };
      root.addEventListener('click', onClick);
      let alive = true;
      getSignalStats().then((res) => {
        const grid = root.querySelector('#stat-grid');
        if (!alive || !grid) return;
        grid.innerHTML = res.ok ? statsMarkup(res.data) : '<p class="result-empty">Results are not available right now.</p>';
      });
      const formCleanup = root.querySelector('#auth-form') ? profilePage().mount(root) : null;
      return () => { alive = false; root.removeEventListener('click', onClick); if (typeof formCleanup === 'function') formCleanup(); };
    },
  };
}
