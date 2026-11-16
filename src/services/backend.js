// The only file that talks to Supabase. Everything else goes through these
// functions, so the rest of the app never touches keys or tables directly.

import { createClient } from '@supabase/supabase-js';
import { appConfig, isSupabaseConfigured } from '../config.js';
import { session, setSession } from '../state/session.js';
import { fromRow, toRow } from '../lib/riskSettings.js';
import { fromTradeRow, toTradeRow } from '../lib/journal.js';

let client = null;

const NOT_CONFIGURED = 'The database is not set up for this site.';

function friendly(error) {
  const msg = String(error?.message || error || 'Something went wrong.');
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link in the message Supabase sent you.';
  if (/already registered/i.test(msg)) return 'An account with this email already exists. Sign in instead.';
  if (/signups? (are |is )?(not allowed|disabled)/i.test(msg)) return 'New accounts are switched off for this site.';
  if (/rate limit|too many requests|security purposes/i.test(msg)) return 'Too many attempts. Wait a few minutes, then try again.';
  if (/error sending confirmation/i.test(msg)) return 'The confirmation email could not be sent. Try Continue with Google, or try again later.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the database. Check your connection and try again.';
  return msg;
}

const isMissingTable = (error) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|could not find the table/i.test(error?.message || '');

async function fetchRiskSettings() {
  const { data, error } = await client.from('risk_settings').select('*').maybeSingle();
  if (error) {
    const missing = isMissingTable(error);
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
  // For an email that is already registered Supabase reports success with an
  // empty identity list instead of an error, so say so plainly.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { ok: false, message: 'An account with this email already exists. Sign in instead, or use Continue with Google.' };
  }
  // With email confirmation on, there is a user but no session yet.
  return { ok: true, needsConfirmation: !data.session };
}

export async function resendConfirmation(email) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await client.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  return error ? { ok: false, message: friendly(error) } : { ok: true };
}

/** Asks the project which sign-in methods are switched on. */
async function googleEnabled() {
  try {
    const res = await fetch(`${appConfig.supabaseUrl}/auth/v1/settings`, { headers: { apikey: appConfig.supabaseAnonKey } });
    if (!res.ok) return null;
    const settings = await res.json();
    return Boolean(settings?.external?.google);
  } catch {
    return null; // could not check; let the sign-in attempt speak for itself
  }
}

/** Leaves the site for Google and comes back signed in. */
export async function signInWithGoogle() {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  if ((await googleEnabled()) === false) {
    return { ok: false, message: 'Google sign-in is not switched on for this site yet. Use email and password for now.' };
  }
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return error ? { ok: false, message: friendly(error) } : { ok: true, redirecting: true };
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

// ---------- Journal ----------

const tradeError = (error) => ({
  ok: false,
  missingTable: isMissingTable(error),
  message: isMissingTable(error)
    ? 'The trades table has not been created in the database yet.'
    : friendly(error),
});

export async function listTrades() {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await client.from('trades').select('*').order('opened_at', { ascending: false });
  if (error) return tradeError(error);
  return { ok: true, trades: (data || []).map(fromTradeRow) };
}

/** Creates a trade, or updates the one with `id`. */
export async function saveTrade(values, id = null) {
  const { user } = session.get();
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  if (!user) return { ok: false, message: 'Sign in to save trades.' };
  const row = toTradeRow(values);
  const query = id
    ? client.from('trades').update(row).eq('id', id)
    : client.from('trades').insert({ ...row, user_id: user.id });
  const { data, error } = await query.select().single();
  if (error) return tradeError(error);
  return { ok: true, trade: fromTradeRow(data) };
}

export async function deleteTrade(id) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await client.from('trades').delete().eq('id', id);
  return error ? tradeError(error) : { ok: true };
}
