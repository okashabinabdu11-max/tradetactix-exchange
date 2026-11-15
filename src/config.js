const env = import.meta.env;

export const appConfig = {
  appName: 'TradeTactix Exchange',
  mode: env.MODE || 'development',
  supabaseUrl: env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
  demoMode: true,
  liveServicesEnabled: false,
  platform: {
    brand: 'TradeTactix',
    slogan: 'Trade Smart. Trade Tactix.',
    colors: {
      white: '#FFFFFF',
      black: '#111111',
      red: '#E32636',
    },
  },
};

export const isSupabaseConfigured = Boolean(
  appConfig.supabaseUrl && appConfig.supabaseAnonKey,
);

export const securityNotice =
  'Never embed secrets in the browser. Store keys server-side or use a secure backend/service layer for production compliance.';
