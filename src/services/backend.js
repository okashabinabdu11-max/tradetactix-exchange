// The only file that talks to Supabase. Everything else goes through these
// functions, so the rest of the app never touches keys or tables directly.

import { createClient } from '@supabase/supabase-js';
import { appConfig, isSupabaseConfigured } from '../config.js';
import { session, setSession } from '../state/session.js';
import { fromRow, toRow } from '../lib/riskSettings.js';

let client = null;

const NOT_CONFIGURED = 'The database is not set up for this site.';

function friendly(error) {
  const msg = String(error?.message || error || 'Something went wrong.');
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link in the message Supabase sent you.';
  if (/already registered/i.test(msg)) return 'An account with this email already exists. Sign in instead.';
  if (/signups? (are |is )?(not allowed|disabled)/i.test(msg)) return 'New accounts are switched off for this site.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the database. Check your connection and try again.';
  return msg;
}

async function fetchRiskSettings() {
  const { data, error } = await client.from('risk_settings').select('*').maybeSingle();
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || '');
    return {
      riskSettings: null,
      settingsError: missing
        ? 'The risk_settings table has not been created in the database yet.'
        : friendly(error),
    };
  }
  return { riskSettings: data ? fromRow(data) : null, settingsError: null };
}

async function applyUser(rawUser) {
  if (!rawUser) {
    setSession({ ready: true, user: null, riskSettings: null, settingsError: null });
    return;
  }
  const user = { id: rawUser.id, email: rawUser.email };
  const settings = await fetchRiskSettings();
  setSession({ ready: true, user, ...settings });
}

export function initBackend() {
  if (!isSupabaseConfigured) {
    setSession({ ready: true });
    return;
  }
  client = createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey);

  // Fires once on load with the stored session (or none), then on every
  // sign-in, sign-out and token refresh.
  client.auth.onAuthStateChange((_event, authSession) => {
    const next = authSession?.user ?? null;
    const current = session.get();
    const sameUser = (next?.id ?? null) === (current.user?.id ?? null);
    if (current.ready && sameUser) return; // token refresh or tab focus: nothing changed
    // Supabase must not be called from inside this callback, so defer.
    setTimeout(() => applyUser(next), 0);
  });

  // If the first check never reports back, stop showing "checking".
  setTimeout(() => {
    if (!session.get().ready) setSession({ ready: true });
  }, 5000);
}

export async function signIn(email, password) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? { ok: false, message: friendly(error) } : { ok: true };
}

export async function signUp(email, password) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) return { ok: false, message: friendly(error) };
  // With email confirmation on, there is a user but no session yet.
  return { ok: true, needsConfirmation: !data.session };
}

export async function signOut() {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await client.auth.signOut();
  return error ? { ok: false, message: friendly(error) } : { ok: true };
}

export async function saveRiskSettings(values) {
  const { user } = session.get();
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  if (!user) return { ok: false, message: 'Sign in to save your limits.' };
  const { data, error } = await client
    .from('risk_settings')
    .upsert(toRow(values, user.id), { onConflict: 'user_id' })
    .select()
    .single();
  if (error) return { ok: false, message: friendly(error) };
  const saved = fromRow(data);
  setSession({ riskSettings: saved, settingsError: null }, { silent: true });
  return { ok: true, values: saved };
}
