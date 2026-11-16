# TradeTactix AI

An AI-assisted XAUUSD (gold) trading platform built around one plan:

| Timeframe | Job |
| --- | --- |
| 4H | Line-chart support and resistance |
| 1H | Liquidity highs and lows |
| 15M | Retest and entry confirmation |
| 5M | Optional extra confirmation |

Every trade must offer at least 1:3 reward-to-risk.

## Status: Stage 2 of 9

Stages 1 and 2 are built: the frontend foundation, sign-in and saved risk
limits. **No market data, broker account or signal engine is connected yet**,
and the app shows empty states rather than sample numbers. Live trading is
switched off in `src/config.js` and cannot be enabled by an environment
variable.

What works today:

- App shell with phone tab bar and desktop sidebar.
- Dashboard layout: signal state, timeframe checklist, price, sessions, risk
  rules, connections, account.
- Trading-session clock (Tokyo, London, New York) from the device clock.
- Risk calculator: XAUUSD position size and the minimum reward-to-risk check.
- Sign-in with email and password (Supabase Auth).
- Personal risk limits saved per user, protected by row-level security. The
  minimum reward-to-risk can be raised but never set below 1:3, in the app
  and in the database.
- System page with connection status and the build roadmap.

Roadmap: see `src/data/plan.js` (`STAGES`) or the System page in the app.

## Database setup (once)

1. In Supabase, open **SQL Editor**, paste
   `supabase/migrations/0001_risk_settings.sql` and run it.
2. In **Authentication > URL Configuration**, set **Site URL** to the deployed
   site address so email confirmation links return to the app.

The project URL and publishable key in `src/config.js` are public values.
Never commit a secret or service-role key.

## Project layout

```
index.html            entry page
src/main.js           boot and route handling
src/router.js         hash router
src/config.js         app flags (live trading lock lives here)
src/data/plan.js      trading plan, signal states, sections, roadmap
src/lib/              pure logic: risk maths, limits, sessions, formatting
src/services/         backend.js, the only file that talks to Supabase
src/state/            signed-in user and saved limits
src/pages/            dashboard, risk calculator, other pages
src/ui/               shell and icons
src/styles/app.css    design system
tests/                unit tests (node --test) and a Supabase test double
supabase/migrations/  database scripts
legacy/exchange-demo/ the earlier crypto-exchange demo, archived, not deployed
```

## Deploy from a phone (no computer needed)

Netlify or Vercel build straight from GitHub in the browser:

- Build command: `npm run build`
- Publish/output directory: `dist`

`netlify.toml` already contains these settings.

## Develop

```bash
npm install
npm run dev     # local preview
npm test        # unit tests
npm run build   # production build into dist/
```

## Safety rules for this codebase

- Never display simulated prices, balances or signals as if they were real.
- Never place secrets (API keys, MT5 passwords) in frontend code.
- Live execution stays locked until the Exness MT5 integration exists and the
  account owner explicitly authorises it.
