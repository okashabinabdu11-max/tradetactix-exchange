// In-memory stand-in for @supabase/supabase-js, used only by browser tests.
// It copies the response shapes of the real client for the calls this app
// makes. It is never bundled into the site.

const accounts = new Map([['owner@example.com', { id: 'user-1', password: 'correct-horse' }]]);
const rows = new Map();
const opts = new URLSearchParams(location.search);

export function createClient(url, key) {
  if (!url || !key) throw new Error('supabaseUrl and supabaseKey are required');
  let current = null;
  const listeners = new Set();
  const emit = (event) => listeners.forEach((cb) => cb(event, current));
  const sessionFor = (email, id) => ({ access_token: 'test-token', user: { id, email } });

  const table = () => {
    const builder = {
      select: () => builder,
      upsert(row) { builder.pending = row; return builder; },
      async maybeSingle() {
        if (opts.has('missingTable')) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.risk_settings' in the schema cache" } };
        return { data: rows.get(current?.user.id) ?? null, error: null };
      },
      async single() {
        const row = builder.pending;
        if (!current || row.user_id !== current.user.id) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
        if (row.min_reward_to_risk < 3) return { data: null, error: { code: '23514', message: 'violates check constraint' } };
        rows.set(row.user_id, { ...row, updated_at: new Date().toISOString() });
        return { data: rows.get(row.user_id), error: null };
      },
    };
    return builder;
  };

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
        current = sessionFor(email, acct.id);
        emit('SIGNED_IN');
        return { data: { user: current.user, session: current }, error: null };
      },
      async signUp({ email, password }) {
        if (accounts.has(email)) return { data: { user: null, session: null }, error: { message: 'User already registered' } };
        const id = `user-${accounts.size + 1}`;
        accounts.set(email, { id, password });
        return { data: { user: { id, email }, session: null }, error: null }; // confirmation required
      },
      async signOut() {
        current = null;
        emit('SIGNED_OUT');
        return { error: null };
      },
    },
    from: () => table(),
  };
}
