// Who is calling, and what their plan allows. The answer comes from the
// database function my_entitlement(), called with the caller's own sign-in
// token, so it cannot be forged from the browser.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://htycjrdyoysnudasqdop.supabase.co';
// Public by design; it identifies the project and grants nothing by itself.
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SEn6hnam_lE5yzk0mZQrYg_eVrh42Fn';

export const ANONYMOUS = Object.freeze({ signed_in: false, plan: 'none', shows_levels: false, shows_analysis: false });

export function bearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header);
  return match ? match[1] : null;
}

async function rpc(name, token, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}`);
  return res.json();
}

/** Never throws: any failure means "treat as not entitled". */
export async function getEntitlement(token) {
  if (!token) return ANONYMOUS;
  try {
    const e = await rpc('my_entitlement', token);
    return e && e.signed_in ? e : ANONYMOUS;
  } catch (err) {
    console.error('entitlement check failed', err?.message);
    return { ...ANONYMOUS, check_failed: true };
  }
}

export async function useSignalPreview(token, key) {
  try {
    return await rpc('use_signal_preview', token, { p_key: key });
  } catch (err) {
    console.error('preview check failed', err?.message);
    return { allowed: false, used: null, limit: null };
  }
}

/** The signed-in caller's email, verified by Supabase from their own token. Never throws. */
export async function accountEmail(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    const user = res.ok ? await res.json() : null;
    return typeof user?.email === 'string' ? user.email : null;
  } catch { return null; }
}
