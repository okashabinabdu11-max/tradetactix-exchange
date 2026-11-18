// In-memory stand-in for @supabase/supabase-js, used only by browser tests.
// It copies the response shapes of the real client for the calls this app
// makes, including "only your own rows" access. It is never bundled into the site.

const accounts = new Map([['owner@example.com', { id: 'user-1', password: 'correct-horse' }]]);
const tables = { risk_settings: [], trades: [], app_settings: [], payment_networks: [], payment_claims: [], telegram_links: [], access_requests: [] };
const opts = new URLSearchParams(location.search);
// Plans state for browser tests: ?plan=free|pro|admin and ?networks=bep20,trc20 (open networks).
const PLAN = opts.get('plan') || 'free';
const OPEN = (opts.get('networks') || '').split(',').filter(Boolean);
tables.app_settings.push({ id: true, pro_price_usdt: 10, credits_per_purchase: 30, hours_per_credit: 24, free_previews_per_month: 10, free_shows_levels: false, free_analysis: false, free_advanced_journal: false, telegram_bot_username: opts.get('bot') || null });
for (const [id, label, addr, auto] of [
  ['bep20', 'USDT on BNB Smart Chain (BEP20)', '0x3030c068eca3e9d104ebb005564fa7a50231f9b9', true],
  ['trc20', 'USDT on TRON (TRC20)', 'TBPuZUcRgVSjqZ1vkvRqsKSAKs24aLgNWF', true],
  ['plasma', 'USDT on Plasma', '0x3030c068eca3e9d104ebb005564fa7a50231f9b9', true],
  ['aptos', 'USDT on Aptos', '0xe3f9f6deddf7bcfac6d7bb62a584cf8a024b94239d6ce07105f02a63287e10a0', false],
]) tables.payment_networks.push({ id, label, receiving_address: addr, auto_verify: auto, enabled: OPEN.includes(id), verified: OPEN.includes(id), token_contract: OPEN.includes(id) ? 'TOKEN' : null, token_decimals: OPEN.includes(id) ? 6 : null, explorer_tx_url: 'https://explorer.test/tx/', sort: tables.payment_networks.length });
window.__mock = tables;
const missing = new URLSearchParams(location.search).get('missingTable');
let nextId = 1;

export function createClient(url, key) {
  if (!url || !key) throw new Error('supabaseUrl and supabaseKey are required');
  let current = null;
  const listeners = new Set();
  const emit = (event) => listeners.forEach((cb) => cb(event, current));

  function from(name) {
    const q = { op: 'select', row: null, filters: [], single: null, order: null };
    const run = async () => {
      if (missing === name || (missing === '' && name === 'risk_settings')) {
        return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` } };
      }
      const uid = current?.user.id;
      const rls = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      const rows = tables[name];
      const shared = name === 'app_settings' || name === 'payment_networks';
      const visible = () => rows.filter((r) => (shared ? (name !== 'payment_networks' || r.enabled || PLAN === 'admin') : r.user_id === uid) && q.filters.every(([c, v]) => r[c] === v));
      let out;
      if (q.op === 'select') {
        out = visible();
        if (q.order) out.sort((a, b) => (a[q.order.col] < b[q.order.col] ? 1 : -1) * (q.order.ascending ? -1 : 1));
      } else if (q.op === 'insert') {
        if (!uid || q.row.user_id !== uid) return rls;
        const row = { id: `row-${nextId++}`, source: 'manual', ...q.row };
        rows.push(row);
        out = [row];
      } else if (q.op === 'upsert') {
        if (!uid || q.row.user_id !== uid) return rls;
        if (q.row.min_reward_to_risk < 3) return { data: null, error: { code: '23514', message: 'violates check constraint' } };
        const existing = rows.find((r) => r.user_id === uid);
        if (existing) Object.assign(existing, q.row); else rows.push({ ...q.row });
        out = [rows.find((r) => r.user_id === uid)];
      } else if (q.op === 'update') {
        out = visible();
        out.forEach((r) => Object.assign(r, q.row));
      } else if (q.op === 'delete') {
        out = visible();
        out.forEach((r) => rows.splice(rows.indexOf(r), 1));
      }
      if (q.single === 'maybe') return { data: out[0] ?? null, error: null };
      if (q.single === 'one') {
        return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      return { data: out, error: null };
    };
    const b = {
      select: () => b,
      insert(row) { q.op = 'insert'; q.row = row; return b; },
      upsert(row) { q.op = 'upsert'; q.row = row; return b; },
      update(row) { q.op = 'update'; q.row = row; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(col, val) { q.filters.push([col, val]); return b; },
      order(col, o = {}) { q.order = { col, ascending: o.ascending !== false }; return b; },
      maybeSingle() { q.single = 'maybe'; return run(); },
      single() { q.single = 'one'; return run(); },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    return b;
  }

  const entitlement = () => {
    if (!current) return null;
    const pro = PLAN !== 'free';
    return { signed_in: true, is_admin: PLAN === 'admin', unlimited: PLAN === 'admin', plan: pro ? 'pro' : 'free', credits: PLAN === 'pro' ? 12 : 0,
      pro_until: PLAN === 'pro' ? new Date(Date.now() + 11.5 * 86400e3).toISOString() : null, previews_used: 0, previews_limit: 0,
      shows_levels: pro, shows_analysis: pro, advanced_journal: pro, pro_price_usdt: 10, credits_per_purchase: 30, hours_per_credit: 24 };
  };
  const fail = (message) => ({ data: null, error: { message } });
  const rpcs = {
    my_entitlement: () => ({ data: entitlement(), error: null }),
    signal_stats: () => opts.get('stats') === 'missing' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.signal_stats' } }
      : { data: opts.get('stats') === 'some'
        ? [{ period: 'week', wins: 3, losses: 1, breakeven: 1, pips: 690 }, { period: 'month', wins: 7, losses: 3, breakeven: 2, pips: 1520.5 }]
        : [{ period: 'week', wins: 0, losses: 0, breakeven: 0, pips: 0 }, { period: 'month', wins: 0, losses: 0, breakeven: 0, pips: 0 }], error: null },
    start_payment: ({ p_network }) => {
      const net = tables.payment_networks.find((n) => n.id === p_network && n.enabled);
      if (!net) return fail('This payment network is not open.');
      const open = tables.payment_claims.find((c) => c.user_id === current.user.id && c.network === p_network && c.status === 'awaiting');
      if (open) return { data: open, error: null };
      const row = { id: `claim-${nextId++}`, user_id: current.user.id, network: p_network, amount_usdt: 10.37, credits: 30, receiving_address: net.receiving_address, tx_hash: null, status: 'awaiting', expires_at: new Date(Date.now() + 86400e3).toISOString(), created_at: new Date().toISOString(), submitted_at: null, admin_note: '' };
      tables.payment_claims.push(row);
      return { data: row, error: null };
    },
    submit_payment_claim: ({ p_claim, p_tx_hash }) => {
      const c = tables.payment_claims.find((x) => x.id === p_claim);
      const hash = String(p_tx_hash).trim();
      if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hash)) return fail('That does not look like a transaction hash for this network.');
      if (tables.payment_claims.some((x) => x.tx_hash && x.tx_hash.toLowerCase() === hash.toLowerCase())) return fail('This transaction has already been claimed.');
      Object.assign(c, { tx_hash: hash, status: 'pending', submitted_at: new Date().toISOString() });
      return { data: c, error: null };
    },
    admin_overview: () => (PLAN === 'admin' ? { data: { revenue_usdt: 10.37, approved_payments: 1, pending_claims: tables.payment_claims.filter((c) => c.status === 'pending').length, awaiting_payments: 0, active_subscribers: 1, users: 3 }, error: null } : fail('Administrators only.')),
    admin_list_claims: ({ p_status }) => ({ data: tables.payment_claims.filter((c) => p_status === 'all' ? c.status !== 'awaiting' : c.status === p_status).map((c) => ({ ...c, email: 'customer@example.com', explorer_tx_url: 'https://explorer.test/tx/' })), error: null }),
    admin_review_claim: ({ p_id, p_approve, p_note }) => {
      const c = tables.payment_claims.find((x) => x.id === p_id);
      if (p_approve && !c.onchain_verified_at) return fail('Credits can only be added after the on-chain check passes.');
      Object.assign(c, { status: p_approve ? 'approved' : 'rejected', admin_note: p_note });
      return { data: c, error: null };
    },
    request_access: ({ p_telegram, p_note }) => {
      const tg = String(p_telegram).trim().replace(/^@/, '');
      if (!/^[A-Za-z0-9_]{5,32}$/.test(tg)) return fail('Enter your Telegram username: 5 to 32 letters, numbers or underscores.');
      if (tables.access_requests.some((r) => r.user_id === current.user.id && r.status === 'pending')) return fail('Your request is already waiting for approval.');
      const row = { id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, user_id: current.user.id, email: current.user.email, telegram_username: tg, note: p_note || '', status: 'pending', created_at: new Date().toISOString(), admin_note: '' };
      tables.access_requests.push(row);
      return { data: row, error: null };
    },
    admin_list_access_requests: ({ p_status }) => (PLAN === 'admin' ? { data: tables.access_requests.filter((r) => p_status === 'all' || r.status === p_status).map((r) => ({ ...r, telegram_linked: false })), error: null } : fail('Administrators only.')),
    admin_review_access: ({ p_id, p_approve, p_hours, p_note }) => {
      const r = tables.access_requests.find((x) => x.id === p_id);
      if (p_approve && !(p_hours >= 1)) return fail('Choose an access time between 1 hour and 365 days.');
      Object.assign(r, { status: p_approve ? 'approved' : 'rejected', granted_hours: p_approve ? p_hours : null, granted_until: p_approve ? new Date(Date.now() + p_hours * 3600e3).toISOString() : null, admin_note: p_note || '' });
      window.__reviewed = { id: p_id, approve: p_approve, hours: p_hours };
      return { data: r, error: null };
    },
    admin_grant_hours: ({ p_hours }) => { window.__grantedHours = p_hours; return { data: new Date(Date.now() + p_hours * 3600e3).toISOString(), error: null }; },
    admin_end_access: ({ p_user }) => { window.__ended = p_user; return { data: null, error: null }; },
    create_telegram_link_code: () => ({ data: 'ABCDEFGHJK', error: null }),
    unlink_my_telegram: () => { tables.telegram_links.length = 0; return { data: null, error: null }; },
    admin_recent_alerts: () => ({ data: [{ signal_key: 'buy-x', state: 'buy', recipients: 3, sent_at: new Date().toISOString() }], error: null }),
    admin_list_users: () => ({ data: [{ user_id: 'user-9', email: 'customer@example.com', created_at: new Date().toISOString(), pro_until: null, is_admin: false }, { user_id: 'user-8', email: 'member@example.com', created_at: new Date().toISOString(), pro_until: new Date(Date.now() + 86400e3).toISOString(), is_admin: false }], error: null }),
    admin_grant_credits: ({ p_credits }) => { window.__granted = p_credits; return { data: new Date().toISOString(), error: null }; },
    admin_update_settings: ({ p }) => { Object.assign(tables.app_settings[0], p); return { data: tables.app_settings[0], error: null }; },
    admin_set_network: ({ p_id, p_enabled, p_verified, p_token_contract, p_token_decimals }) => {
      const n = tables.payment_networks.find((x) => x.id === p_id);
      const next = { ...n, verified: p_verified, token_contract: p_token_contract || null, token_decimals: p_token_decimals, enabled: p_enabled };
      if (next.enabled && !(next.verified && next.auto_verify && next.token_contract && next.token_decimals !== null)) return fail('A network can only be switched on when it has an automatic check, is marked verified, and has a token contract and decimals.');
      Object.assign(n, next);
      return { data: n, error: null };
    },
  };

  return {
    rpc: async (name, args = {}) => (rpcs[name] ? rpcs[name](args) : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }),
    auth: {
      async getSession() { return { data: { session: current }, error: null }; },
      onAuthStateChange(cb) {
        listeners.add(cb);
        setTimeout(() => cb('INITIAL_SESSION', current), 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        const acct = accounts.get(email);
        if (!acct || acct.password !== password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        if (opts.get('confirm') === 'on' && acct.unconfirmed) return { data: { user: null, session: null }, error: { message: 'Email not confirmed' } };
        current = { access_token: 'test-token', user: { id: acct.id, email } };
        emit('SIGNED_IN');
        return { data: { user: current.user, session: current }, error: null };
      },
      async signUp({ email, password }) {
        // Like the real service: an existing email gets a look-alike success with no identities.
        if (accounts.has(email)) return { data: { user: { id: 'hidden', email, identities: [] }, session: null }, error: null };
        const id = `user-${accounts.size + 1}`;
        accounts.set(email, { id, password, unconfirmed: opts.get('confirm') === 'on' });
        return { data: { user: { id, email, identities: [{ provider: 'email' }] }, session: null }, error: null }; // confirmation required
      },
      async resend({ email }) {
        window.__resent = email;
        return { data: {}, error: null };
      },
      async signInWithOAuth({ provider, options }) {
        window.__oauth = { provider, redirectTo: options?.redirectTo };
        return { data: { provider, url: 'https://accounts.google.com/' }, error: null };
      },
      async signOut() {
        current = null;
        emit('SIGNED_OUT');
        return { error: null };
      },
    },
    from,
  };
}
