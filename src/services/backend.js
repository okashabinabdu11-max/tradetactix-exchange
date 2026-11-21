// The only file that talks to Supabase. Everything else goes through these
// functions, so the rest of the app never touches keys or tables directly.

import { createClient } from '@supabase/supabase-js';
import { isStrongPassword } from '../lib/password.js';
import { appConfig, isSupabaseConfigured } from '../config.js';
import { session, setSession } from '../state/session.js';
import { fromRow, toRow } from '../lib/riskSettings.js';
import { fromTradeRow, toTradeRow } from '../lib/journal.js';

let client = null;

const NOT_CONFIGURED = 'The database is not set up for this site.';

function friendly(error) {
  const msg = String(error?.message || error || 'Something went wrong.');
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent to your inbox. Check your spam folder too.';
  if (/already registered/i.test(msg)) return 'An account with this email already exists. Tap Open Account with your password.';
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

/** Plan, credits and feature access. Null when the plans tables are not set up or cannot be read. */
async function fetchEntitlement() {
  const { data, error } = await client.rpc('my_entitlement');
  return error || !data?.signed_in ? null : data;
}

async function applyUser(rawUser) {
  if (!rawUser) {
    setSession({ ready: true, user: null, riskSettings: null, settingsError: null, entitlement: null });
    return;
  }
  // Keep what the pages need: who it is, and how they registered (for the choose-password step).
  const user = { id: rawUser.id, email: rawUser.email, app_metadata: rawUser.app_metadata || {}, user_metadata: rawUser.user_metadata || {} };
  const [settings, entitlement] = await Promise.all([fetchRiskSettings(), fetchEntitlement()]);
  setSession({ ready: true, user, ...settings, entitlement });
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

/**
 * Opens an existing account with email and password. It never creates one:
 * new members register with Continue with Google, which proves the email is real.
 */
export async function openAccount(email, password) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return { ok: true };
  if (/email not confirmed/i.test(error.message || '')) return { ok: false, code: 'unconfirmed', message: friendly(error) };
  if (/invalid login credentials/i.test(error.message || '')) {
    return { ok: false, code: 'unknown', message: 'Wrong email or password. New here? Register with Continue with Google first.' };
  }
  return { ok: false, message: friendly(error) };
}

/** Someone who registered with Google and has not chosen a password yet. */
export function needsPassword(user) {
  if (!user) return false;
  const providers = user.app_metadata?.providers || [user.app_metadata?.provider].filter(Boolean);
  return providers.includes('google') && !providers.includes('email') && !user.user_metadata?.has_password;
}

/** Adds a password so the member can also log in with email and password. */
export async function setPassword(password) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  if (!isStrongPassword(password)) return { ok: false, message: 'Choose a strong password that meets every rule below.' };
  const { error } = await client.auth.updateUser({ password, data: { has_password: true } });
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
    return { ok: false, message: 'An account with this email already exists. Tap Open Account with your password.' };
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
export async function googleEnabled() {
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
    return { ok: false, message: 'Registration with Google is not switched on yet. Please try again later.' };
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
  if (!user) return { ok: false, message: 'Open your account to save your limits.' };
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
  if (!user) return { ok: false, message: 'Open your account to save trades.' };
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

// ---------- Plans, payments and administration ----------

/** The signed-in user's token, sent to our own server functions to prove who is asking. */
export async function getAccessToken() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session?.access_token ?? null;
}

/** Win rate of the signals the bot sent for one market: totals for the last 7 and 30 days. Readable by anyone. */
export async function getSignalStats(symbol = 'XAUUSD') {
  const res = await call('signal_stats', symbol === 'XAUUSD' ? {} : { p_symbol: symbol });
  return res.ok ? { ok: true, data: res.data || [] } : { ok: false };
}

async function call(name, args) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const missing = error.code === 'PGRST202' || /could not find the function/i.test(error.message || '');
    return { ok: false, message: missing ? 'The plans and payments tables have not been created in the database yet.' : friendly(error) };
  }
  return { ok: true, data };
}

async function rows(query) {
  if (!client) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await query(client);
  if (error) return { ok: false, message: isMissingTable(error) ? 'The plans and payments tables have not been created in the database yet.' : friendly(error) };
  return { ok: true, data: data || [] };
}

export async function refreshEntitlement() {
  if (!client || !session.get().user) return null;
  const entitlement = await fetchEntitlement();
  setSession({ entitlement }, { silent: true });
  return entitlement;
}

export const getPlanSettings = () => rows((c) => c.from('app_settings').select('*')).then((r) => (r.ok ? { ok: true, data: r.data[0] || null } : r));
/** Customers see only networks that are switched on; administrators see all. */
export const listNetworks = () => rows((c) => c.from('payment_networks').select('*').order('sort', { ascending: true }));
export const listMyClaims = () => rows((c) => c.from('payment_claims').select('*').eq('user_id', session.get().user?.id).order('created_at', { ascending: false }));
export const submitClaim = (claimId, txHash) => call('submit_payment_claim', { p_claim: claimId, p_tx_hash: txHash });

export const adminOverview = () => call('admin_overview');
export const adminListClaims = (status = 'pending') => call('admin_list_claims', { p_status: status });
export const adminReviewClaim = (id, approve, note = '') => call('admin_review_claim', { p_id: id, p_approve: approve, p_note: note });
export const adminListUsers = (search = '') => call('admin_list_users', { p_search: search });
export const adminGrantCredits = (userId, credits, note = '') => call('admin_grant_credits', { p_user: userId, p_credits: credits, p_note: note });
export const adminUpdateSettings = (patch) => call('admin_update_settings', { p: patch });
export const adminSetNetwork = (id, { enabled, verified, tokenContract, tokenDecimals, explorerTxUrl }) =>
  call('admin_set_network', { p_id: id, p_enabled: enabled, p_verified: verified, p_token_contract: tokenContract, p_token_decimals: tokenDecimals, p_explorer_tx_url: explorerTxUrl });
export const startPayment = (network) => call('start_payment', { p_network: network });

/** Runs the server's on-chain check. Administrators only; the server enforces it. */
export async function adminVerifyPayment(body) {
  const token = await getAccessToken();
  if (!token) return { ok: false, message: 'Open your account first.' };
  try {
    const res = await fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return { ok: false, message: data.message || ({ admins_only: 'Administrators only.', bad_hash: 'That is not a transaction hash.', not_pending: 'This claim is no longer waiting for review.' }[data.error] || 'The check could not run.') };
    return { ok: true, data };
  } catch {
    return { ok: false, message: 'The check service could not be reached.' };
  }
}

// ---------- Telegram alerts ----------

export const getMyTelegram = () => rows((c) => c.from('telegram_links').select('*').eq('user_id', session.get().user?.id)).then((r) => (r.ok ? { ok: true, data: r.data[0] || null } : r));
export const createTelegramCode = () => call('create_telegram_link_code');
export const unlinkTelegram = () => call('unlink_my_telegram');
export const adminRecentAlerts = () => call('admin_recent_alerts');

// ---------- Access requests ----------

export const getMyAccessRequest = () => rows((c) => c.from('access_requests').select('*').eq('user_id', session.get().user?.id).order('created_at', { ascending: false })).then((r) => (r.ok ? { ok: true, data: r.data[0] || null } : r));
export const requestAccess = (telegram, note) => call('request_access', { p_telegram: telegram, p_note: note || '' });
export const adminListAccessRequests = (status = 'pending') => call('admin_list_access_requests', { p_status: status });
export const adminReviewAccess = (id, approve, hours, note = '') => call('admin_review_access', { p_id: id, p_approve: approve, p_hours: hours, p_note: note });
export const adminGrantHours = (userId, hours, note = '') => call('admin_grant_hours', { p_user: userId, p_hours: hours, p_note: note });
export const adminEndAccess = (userId, note = '') => call('admin_end_access', { p_user: userId, p_note: note });

/** Best effort: a Telegram notice about a request. Never blocks or fails the action itself. */
export async function notifyAccess(kind, requestId) {
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch('/api/access-notify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind, requestId }) });
  } catch { /* ignore */ }
}

export async function adminSetupTelegram() {
  const token = await getAccessToken();
  if (!token) return { ok: false, message: 'Open your account first.' };
  try {
    const res = await fetch('/api/telegram-setup', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return res.ok ? { ok: true, data } : { ok: false, message: data.message || 'Setup failed.' };
  } catch {
    return { ok: false, message: 'The setup service could not be reached.' };
  }
}

// ---------- Chart Pro (paid in birr) ----------
const CHART_MISSING = 'Chart Pro is not set up in the database yet.';
const chartCall = (name, args) => call(name, args).then((r) => (r.ok || !/tables have not been created/.test(r.message) ? r : { ok: false, message: CHART_MISSING }));
const chartRows = (q) => rows(q).then((r) => (r.ok || !/tables have not been created/.test(r.message) ? r : { ok: false, message: CHART_MISSING }));
/** { signed_in, chart_pro, chart_until?, unlimited? } — false for everyone when not set up. */
export async function getChartAccess() {
  if (!client) return { signed_in: false, chart_pro: false };
  const r = await call('my_chart_access', {});
  return r.ok && r.data ? r.data : { signed_in: !!session.get().user, chart_pro: false };
}
export const listChartPlans = () => chartRows((c) => c.from('chart_plans').select('*').order('sort', { ascending: true }).order('price_etb', { ascending: true }));
export const listEtbMethods = () => chartRows((c) => c.from('etb_methods').select('*').order('sort', { ascending: true }));
export const listMyEtbPayments = () => chartRows((c) => c.from('etb_payments').select('*').eq('user_id', session.get().user?.id).order('created_at', { ascending: false }).limit(5));
export const submitEtbPayment = (plan, method, reference) => chartCall('submit_etb_payment', { p_plan: plan, p_method: method, p_reference: reference });
export const adminSaveChartPlan = ({ id = null, name, days, price, enabled = true, sort = 0 }) =>
  chartCall('admin_save_chart_plan', { p_id: id, p_name: name, p_days: days, p_price: price, p_enabled: enabled, p_sort: sort });
export const adminSetEtbMethod = (id, name, number, enabled) => chartCall('admin_set_etb_method', { p_id: id, p_account_name: name, p_account_number: number, p_enabled: enabled });
export const adminListEtbPayments = (status = 'pending') => chartCall('admin_list_etb_payments', { p_status: status });
export const adminReviewEtbPayment = (id, approve, note = '') => chartCall('admin_review_etb_payment', { p_id: id, p_approve: approve, p_note: note });

/** Candles for the chart (public market data, cached by the server). */
export async function getChartCandles(symbol, interval) {
  try {
    const res = await fetch(`/api/chart-data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
    const data = await res.json().catch(() => ({}));
    return res.ok && Array.isArray(data.candles) ? { ok: true, data } : { ok: false, message: data.message || 'Prices could not be loaded.' };
  } catch {
    return { ok: false, message: 'The price service could not be reached.' };
  }
}

/** Saved chart drawings for one pair: { drawings, updated_at } or null. */
export async function loadDrawings(symbol) {
  if (!client || !session.get().user) return { ok: false, message: 'signed out' };
  return rows((c) => c.from('chart_drawings').select('drawings,updated_at').eq('user_id', session.get().user.id).eq('symbol', symbol).maybeSingle());
}
export async function saveDrawings(symbol, drawings) {
  if (!client || !session.get().user) return { ok: false, message: 'signed out' };
  return rows((c) => c.from('chart_drawings').upsert({ user_id: session.get().user.id, symbol, drawings, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' }).select('updated_at').maybeSingle());
}
