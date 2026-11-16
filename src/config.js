// In a Vite build `import.meta.env` holds the VITE_* variables. When the files
// are served directly (no build step) it is undefined, so fall back to {}.
const env = import.meta.env || {};

export const appConfig = Object.freeze({
  appName: 'TradeTactix AI',
  instrument: 'XAUUSD',
  mode: env.MODE || 'development',
  supabaseUrl: env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',

  // Live order execution is switched off in code. It must stay off until the
  // Exness MT5 integration exists and the account owner explicitly authorises
  // it. No environment variable can turn this on.
  liveTradingEnabled: false,

  // Nothing is connected in Stage 1. These flip only when a real integration
  // is built and verified; the UI never shows placeholder prices or balances.
  marketDataConnected: false,
  brokerConnected: false,
});

const looksLikePlaceholder = (v) => !v || v.includes('your-project') || v.includes('your-anon-key');

export const isSupabaseConfigured =
  !looksLikePlaceholder(appConfig.supabaseUrl) && !looksLikePlaceholder(appConfig.supabaseAnonKey);

export const securityNotice =
  'Never embed secrets in the browser. Store keys server-side or use a secure backend/service layer for production compliance.';
