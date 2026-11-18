import { session } from '../state/session.js';
import { openAccount, signOut, signInWithGoogle, resendConfirmation, googleEnabled, needsPassword, setPassword } from '../services/backend.js';
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
      <div class="auth-register">
        <p class="field-label">${t('New here?')}</p>
        <button class="button button-google" type="button" id="google-signin">${GOOGLE_MARK}<span>${t('Continue with Google')}</span></button>
        <p class="field-hint" id="google-note">${t('Register with your Google account. It proves your email is real. Then you choose a password.')}</p>
      </div>
      <p class="auth-divider"><span>${t('Already registered?')}</span></p>
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
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit" name="intent" value="signin">${t(`Open Account`)}</button>
      </div>
      <p class="field-hint">${t('Use the email and password of your account.')}</p>
      <p id="auth-status" class="form-status" role="status"></p>
      <button class="link-button" type="button" id="resend" hidden>${t('Send the confirmation email again')}</button>
      <p class="panel-note">${t(`Your account stores your risk limits now, and your journal and trade history in later stages. Only you can read them.`)}</p>
    </form>`;
}

// After registering with Google: choose a password for email log-in.
export function setPasswordMarkup() {
  return `
    <form class="panel auth set-password" id="setpw-form" novalidate>
      <h2 class="panel-title">${t('Choose your password')}</h2>
      <p class="panel-note">${t('You registered with Google. Choose a password so you can also open your account with your email and password.')}</p>
      <div class="field">
        <label class="field-label" for="new-password">${t('Password')}</label>
        <div class="password-wrap">
          <input id="new-password" name="password" type="password" autocomplete="new-password" required />
          <button class="password-toggle" type="button" data-toggle-for="new-password" aria-pressed="false">${t('Show')}</button>
        </div>
        <ul class="pw-rules" id="newpw-rules" aria-live="polite">
          ${passwordChecks('').map((c) => `<li data-rule="${c.id}">${t(c.text)}</li>`).join('')}
        </ul>
      </div>
      <div class="form-actions"><button class="button button-primary" type="submit">${t('Save password')}</button></div>
      <p id="setpw-status" class="form-status" role="status"></p>
    </form>`;
}

export function mountSetPassword(root) {
  const form = root.querySelector('#setpw-form');
  if (!form) return;
  const pw = form.querySelector('#new-password');
  const rules = form.querySelector('#newpw-rules');
  const status = form.querySelector('#setpw-status');
  const toggle = form.querySelector('[data-toggle-for]');
  toggle.addEventListener('click', () => {
    const show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
    toggle.textContent = show ? t('Hide') : t('Show'); toggle.setAttribute('aria-pressed', String(show));
  });
  pw.addEventListener('input', () => passwordChecks(pw.value).forEach((c) => rules.querySelector(`[data-rule="${c.id}"]`)?.classList.toggle('is-ok', c.ok)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    status.textContent = t('Saving…'); status.className = 'form-status';
    const res = await setPassword(pw.value);
    btn.disabled = false;
    if (!res.ok) { status.textContent = t(res.message); status.className = 'form-status is-error'; rules.classList.add('is-attention'); return; }
    form.outerHTML = `<section class="panel auth"><p class="form-status is-ok">${t('Password saved. You can now open your account with your email and password, or with Google.')}</p></section>`;
  });
}

function signedInMarkup(user) {
  return `
    ${needsPassword(user) ? setPasswordMarkup() : ''}
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
        <p>${user ? 'Your TradeTactix account.' : t('New here? Register with Google. Already registered? Open your account with your email and password.')}</p>
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
      mountSetPassword(root);
      if (!status) return;
      // Until Google is switched on in Supabase, say registration is not open yet.
      const googleBtn = root.querySelector('#google-signin');
      if (googleBtn) googleEnabled().then((on) => {
        if (on === false) { googleBtn.disabled = true; root.querySelector('#google-note').textContent = t('Registration with Google opens soon.'); }
      });
      const google = root.querySelector('#google-signin');
      if (google) {
        google.addEventListener('click', async () => {
          google.disabled = true;
          setStatus(t('Opening Google…'));
          const res = await signInWithGoogle();
          if (!res.ok) { google.disabled = false; setStatus(t(res.message), 'is-error'); }
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
            if (res.code === 'unconfirmed') { resend.dataset.email = email; resend.hidden = false; }
            return;
          }
          // A successful sign-in re-renders this page through the session.
        });
      }
      return null;
    },
  };
}
