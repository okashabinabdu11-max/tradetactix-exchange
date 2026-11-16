import { session } from '../state/session.js';
import { signIn, signUp, signOut } from '../services/backend.js';
import { isSupabaseConfigured } from '../config.js';
import { escapeHtml } from '../lib/format.js';

const MIN_PASSWORD = 8;

function signedOutMarkup() {
  return `
    <form class="panel auth" id="auth-form" novalidate>
      <label class="field" for="email">
        <span class="field-label">Email</span>
        <input id="email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required />
      </label>
      <label class="field" for="password">
        <span class="field-label">Password</span>
        <input id="password" name="password" type="password" autocomplete="current-password" minlength="${MIN_PASSWORD}" required />
        <span class="field-hint">At least ${MIN_PASSWORD} characters.</span>
      </label>
      <div class="form-actions">
        <button class="button button-primary" type="submit" name="intent" value="signin">Sign in</button>
        <button class="button button-quiet" type="submit" name="intent" value="signup">Create account</button>
      </div>
      <p id="auth-status" class="form-status" role="status"></p>
      <p class="panel-note">Your account stores your risk limits now, and your journal and trade history in later stages. Only you can read them.</p>
    </form>`;
}

function signedInMarkup(user) {
  return `
    <section class="panel auth">
      <p class="field-label">Signed in as</p>
      <p class="auth-email">${escapeHtml(user.email || 'your account')}</p>
      <div class="form-actions">
        <a class="button button-quiet" href="#/risk">Edit risk limits</a>
        <button class="button button-quiet" type="button" id="signout">Sign out</button>
      </div>
      <p id="auth-status" class="form-status" role="status"></p>
    </section>`;
}

export function profilePage() {
  const { ready, user } = session.get();
  let body;
  if (!isSupabaseConfigured) body = '<section class="panel auth"><p class="result-empty">The database is not set up, so sign-in is unavailable.</p></section>';
  else if (!ready) body = '<section class="panel auth"><p class="result-empty">Checking sign-in…</p></section>';
  else body = user ? signedInMarkup(user) : signedOutMarkup();

  return {
    title: 'Profile',
    html: `
      <header class="page-head">
        <h1>Profile</h1>
        <p>${user ? 'Your TradeTactix AI account.' : 'Sign in, or create your account the first time.'}</p>
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
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const intent = e.submitter?.value === 'signup' ? 'signup' : 'signin';
          const email = form.elements.email.value.trim();
          const password = form.elements.password.value;
          if (!/^\S+@\S+\.\S+$/.test(email)) { setStatus('Enter a valid email address.', 'is-error'); return; }
          if (password.length < MIN_PASSWORD) { setStatus(`Password must be at least ${MIN_PASSWORD} characters.`, 'is-error'); return; }

          const buttons = form.querySelectorAll('button');
          buttons.forEach((b) => { b.disabled = true; });
          setStatus(intent === 'signup' ? 'Creating account…' : 'Signing in…');
          const res = intent === 'signup' ? await signUp(email, password) : await signIn(email, password);
          buttons.forEach((b) => { b.disabled = false; });

          if (!res.ok) { setStatus(res.message, 'is-error'); return; }
          if (res.needsConfirmation) {
            form.elements.password.value = '';
            setStatus(`Account created. Open the confirmation link sent to ${email}, then sign in here.`, 'is-ok');
          }
          // A successful sign-in re-renders this page through the session.
        });
      }
      return null;
    },
  };
}
