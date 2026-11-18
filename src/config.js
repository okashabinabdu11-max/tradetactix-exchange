// In a Vite build `import.meta.env` holds the VITE_* variables. When the files
// are served directly (no build step) it is undefined, so fall back to {}.
const env = import.meta.env || {};

export const appConfig = Object.freeze({
  appName: 'TradeTactix',
  instrument: 'XAUUSD',
  mode: env.MODE || 'development',
  // The project URL and the publishable key are public by design: they only
  // identify the project. Row-level security in the database decides what a
  // signed-in user may read or write. Secret keys never belong in this file.
  supabaseUrl: env.VITE_SUPABASE_URL || 'https://htycjrdyoysnudasqdop.supabase.co',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_SEn6hnam_lE5yzk0mZQrYg_eVrh42Fn',

  // Live order execution is switched off in code. It must stay off until the
  // Exness MT5 integration exists and the account owner explicitly authorises
  // it. No environment variable can turn this on.
  liveTradingEnabled: false,

  // No broker is connected yet. This flips only when a real integration is
  // built and verified; the UI never shows placeholder balances.
  brokerConnected: false,
});

const looksLikePlaceholder = (v) => !v || v.includes('your-project') || v.includes('your-anon-key');

export const isSupabaseConfigured =
  !looksLikePlaceholder(appConfig.supabaseUrl) && !looksLikePlaceholder(appConfig.supabaseAnonKey);

export const securityNotice =
  'Never embed secrets in the browser. Store keys server-side or use a secure backend/service layer for production compliance.';
