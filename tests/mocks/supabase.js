// In-memory stand-in for @supabase/supabase-js, used only by browser tests.
// It copies the response shapes of the real client for the calls this app
// makes, including "only your own rows" access. It is never bundled into the site.

const accounts = new Map([['owner@example.com', { id: 'user-1', password: 'correct-horse' }]]);
const tables = { risk_settings: [], trades: [] };
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
      const visible = () => rows.filter((r) => r.user_id === uid && q.filters.every(([c, v]) => r[c] === v));
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

  return {
    auth: {
      onAuthStateChange(cb) {
        listeners.add(cb);
        setTimeout(() => cb('INITIAL_SESSION', current), 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        const acct = accounts.get(email);
        if (!acct || acct.password !== password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        current = { access_token: 'test-token', user: { id: acct.id, email } };
        emit('SIGNED_IN');
        return { data: { user: current.user, session: current }, error: null };
      },
      async signUp({ email, password }) {
        // Like the real service: an existing email gets a look-alike success with no identities.
        if (accounts.has(email)) return { data: { user: { id: 'hidden', email, identities: [] }, session: null }, error: null };
        const id = `user-${accounts.size + 1}`;
        accounts.set(email, { id, password });
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
