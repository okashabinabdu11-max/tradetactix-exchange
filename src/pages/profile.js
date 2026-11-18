import { session } from '../state/session.js';
import { openAccount, signOut, signInWithGoogle, resendConfirmation, googleEnabled } from '../services/backend.js';
import { passwordChecks } from '../lib/password.js';
import { isSupabaseConfigured } from '../config.js';
import { escapeHtml } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const MIN_PASSWORD = 8;

const GOOGLE_MARK = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';

export function signedOutMarkup(notice) {
  return `
    <form class="panel auth" id="auth-form" novalidate>
      ${notice ? `<p class="form-status is-error" id="auth-notice">${escapeHtml(notice)}</p>` : ''}
      <div id="google-block" hidden>
        <button class="button button-google" type="button" id="google-signin">${GOOGLE_MARK}<span>Continue with Google</span></button>
        <p class="auth-divider"><span>or use email</span></p>
      </div>
      <label class="field" for="email">
        <span class="field-label">${t(`Email`)}</span>
        <input id="email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required />
      </label>
      <div class="field">
        <label class="field-label" for="password">${t(`Password`)}</label>
        <div class="password-wrap">
          <input id="password" name="password" type="password" autocomplete="current-password" minlength="${MIN_PASSWORD}" required />
          <button class="password-toggle" type="button" id="password-toggle" aria-controls="password" aria-pressed="false">${t(`Show`)}</button>
        </div>
        <p class="field-hint">${t(`New here? Your password needs:`)}</p>
        <ul class="pw-rules" id="pw-rules" aria-live="polite">
          ${passwordChecks('').map((c) => `<li data-rule="${c.id}">${t(c.text)}</li>`).join('')}
        </ul>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit" name="intent" value="signin">${t(`Open Account`)}</button>
      </div>
      <p class="field-hint">${t(`Already have an account? The same button opens it.`)}</p>
      <p id="auth-status" class="form-status" role="status"></p>
      <button class="link-button" type="button" id="resend" hidden>${t('Send the confirmation email again')}</button>
      <p class="panel-note">${t(`Your account stores your risk limits now, and your journal and trade history in later stages. Only you can read them.`)}</p>
    </form>`;
}

function signedInMarkup(user) {
  return `
    <section class="panel auth">
      <p class="field-label">${t(`Signed in as`)}</p>
      <p class="auth-email">${escapeHtml(user.email || 'your account')}</p>
      <div class="form-actions">
        <a class="button button-quiet" href="#/risk">Edit risk limits</a>
        <button class="button button-quiet" type="button" id="signout">${t(`Sign out`)}</button>
      </div>
      <p id="auth-status" class="form-status" role="status"></p>
    </section>`;
}

export function profilePage() {
  const { ready, user, authNotice } = session.get();
  let body;
  if (!isSupabaseConfigured) body = '<section class="panel auth"><p class="result-empty">The database is not set up, so sign-in is unavailable.</p></section>';
  else if (!ready) body = '<section class="panel auth"><p class="result-empty">Checking sign-in…</p></section>';
  else body = user ? signedInMarkup(user) : signedOutMarkup(authNotice);

  return {
    title: 'Profile',
    html: `
      <header class="page-head">
        <h1>${t(`Profile`)}</h1>
        <p>${user ? 'Your TradeTactix account.' : t('Enter your email and password, then tap Open Account.')}</p>
      </header>
      ${body}`,
    mount(root) {
      const status = root.querySelector('#auth-status');
      const setStatus = (text, tone = '') => {
        status.textContent = text;
        status.className = `form-status ${tone}`;
      };

      const out = root.querySelector('#signout');
      if (out) {
        out.addEventListener('click', async () => {
          out.disabled = true;
          const res = await signOut();
          if (!res.ok) { out.disabled = false; setStatus(res.message, 'is-error'); }
          // On success the session change re-renders this page.
        });
      }

      const form = root.querySelector('#auth-form');
      // Show Google only when it is switched on in Supabase.
      const googleBlock = root.querySelector('#google-block');
      if (googleBlock) googleEnabled().then((on) => { if (on === true) googleBlock.hidden = false; });
      const google = root.querySelector('#google-signin');
      if (google) {
        google.addEventListener('click', async () => {
          google.disabled = true;
          setStatus('Opening Google…');
          const res = await signInWithGoogle();
          if (!res.ok) { google.disabled = false; setStatus(res.message, 'is-error'); }
          // On success the browser leaves for Google and returns signed in.
        });
      }
      const resend = root.querySelector('#resend');
      if (resend) {
        resend.addEventListener('click', async () => {
          const email = resend.dataset.email;
          if (!email) return;
          resend.disabled = true;
          const res = await resendConfirmation(email);
          resend.disabled = false;
          setStatus(res.ok ? `Sent again to ${email}. Check your spam folder too.` : res.message, res.ok ? 'is-ok' : 'is-error');
        });
      }
      const pw = root.querySelector('#password');
      const toggle = root.querySelector('#password-toggle');
      if (pw && toggle) {
        toggle.addEventListener('click', () => {
          const show = pw.type === 'password';
          pw.type = show ? 'text' : 'password';
          toggle.textContent = show ? t('Hide') : t('Show');
          toggle.setAttribute('aria-pressed', String(show));
          toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
        const rules = root.querySelector('#pw-rules');
        const paint = () => passwordChecks(pw.value).forEach((c) => rules.querySelector(`[data-rule="${c.id}"]`)?.classList.toggle('is-ok', c.ok));
        pw.addEventListener('input', paint);
      }
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = form.elements.email.value.trim();
          const password = form.elements.password.value;
          if (!/^\S+@\S+\.\S+$/.test(email)) { setStatus(t('Enter a valid email address.'), 'is-error'); return; }
          if (password.length < MIN_PASSWORD) { setStatus(t('Password must be at least 8 characters.'), 'is-error'); return; }

          const buttons = form.querySelectorAll('button');
          buttons.forEach((b) => { b.disabled = true; });
          setStatus(t('Opening your account…'));
          const res = await openAccount(email, password);
          buttons.forEach((b) => { b.disabled = false; });

          if (!res.ok) {
            setStatus(t(res.message), 'is-error');
            if (res.code === 'weak') root.querySelector('#pw-rules')?.classList.add('is-attention');
            if (res.code === 'unconfirmed') { resend.dataset.email = email; resend.hidden = false; }
            return;
          }
          if (res.needsConfirmation) {
            form.elements.password.value = '';
            setStatus(`${t('Check your email to finish opening your account.')} ${t('We sent a confirmation link to')} ${email}. ${t('Tap it, then come back and tap Open Account. Check your spam folder too.')}`, 'is-ok');
            resend.dataset.email = email;
            resend.hidden = false;
          }
          // A successful sign-in re-renders this page through the session.
        });
      }
      return null;
    },
  };
}
