# TradeTactix AI

An AI-assisted XAUUSD (gold) trading platform built around one plan:

| Timeframe | Job |
| --- | --- |
| 4H | Line-chart support and resistance |
| 1H | Liquidity highs and lows |
| 15M | Retest and entry confirmation |
| 5M | Optional extra confirmation |

Every trade must offer at least 1:3 reward-to-risk.

## Status: Stage 7 of 10

Built so far: the frontend foundation, sign-in with saved risk limits, and the
trade journal. **No broker account is connected yet**, and the app shows empty states rather than sample numbers. Live trading
is switched off in `src/config.js` and cannot be enabled by an environment
variable.

What works today:

- App shell with phone tab bar and desktop sidebar.
- Dashboard layout: signal state, timeframe checklist, price, sessions, risk
  rules, connections, account.
- Risk calculator: XAUUSD position size and the minimum reward-to-risk check.
- Sign-in with email and password (Supabase Auth).
- Personal risk limits per user. The minimum reward-to-risk can be raised but
  never set below 1:3, in the app and in the database.
- Live XAUUSD price on the dashboard through `/api/quote`, a server function
  that keeps the Twelve Data key off the browser. Set `TWELVEDATA_API_KEY` in
  the host's environment variables.
- Signal engine (`src/lib/signals.js`): reads 4H levels, 1H liquidity and the
  15M sweep, retest and confirmation, and reports BUY, SELL, waiting, no setup
  or offline. A signal needs at least 1:3. It never places a trade.
- Fundamentals on the Analysis page: US economic calendar and gold news, from
  TradingView widgets. The signal engine does not read them.
- Chart: live XAUUSD from the TradingView widget, with a view per timeframe of
  the plan (4H line chart, then 1H, 15M and 5M candles).
- Journal: log, edit, close and delete trades, with the plan checks ticked
  per trade, notes, summary statistics and a P&L calendar.
- History (filterable), Analytics (running total, drawdown, breakdowns),
  Calendar and Discipline, all calculated from the journal.

Roadmap: see `src/data/plan.js` (`STAGES`) or the System page in the app.

## Plans and payments (Stage 7)

- **Free:** signal state, and for a BUY or SELL the direction and timeframe
  only, for 10 different signals a month. Basic journal.
- **Pro:** full signals with entry, stop-loss and take-profit, analysis and the
  advanced journal. 1 credit = 24 hours; a purchase is 30 credits for 10 USDT
  (all adjustable in Admin).
- Signals are gated on the server (`api/signal.js`, `api/_lib/gate.js`). The
  browser never receives entry, stop or target unless the plan allows it.
- **Payment flow:** the customer picks an open network and gets a unique exact
  amount (price plus a few cents), pays the stored address, then submits the
  transaction hash. An administrator runs the on-chain check
  (`api/verify-payment.js`, `api/_lib/chain.js`), which verifies the chain,
  token contract, recipient, exact amount, confirmations and timing, and only
  then can approve. Credits are added by the database on approval.
- **Test mode:** every network starts closed. A network can be opened only when
  it has an automatic check (BEP20, TRC20, Plasma; not Aptos yet), its token
  contract and decimals are set, and it is marked verified after a real test
  payment passes in Admin > Test a transaction.
- Server environment variables: `TWELVEDATA_API_KEY`, `CANDLES_KEY` (any long
  random string), optional `BSC_RPC_URL`, `PLASMA_RPC_URL`, `TRON_API_URL`,
  `TRONGRID_API_KEY`.

## Telegram alerts

- Pro members connect Telegram from the Plans page (a one-time code sent to
  the bot with `/start`). `/stop` turns alerts off.
- The database calls `/api/alerts-run` every 5 minutes (pg_cron + pg_net).
  A new BUY or SELL is recorded once in `alert_log` and sent to linked Pro
  members only. `api/telegram-webhook.js` handles the bot's messages.
- Server settings: `TELEGRAM_BOT_TOKEN` (from @BotFather) and `ALERTS_SECRET`
  (the same value is stored in the database table `server_secrets`). Then use
  Admin > Telegram alerts > Connect bot.

## Database setup (once)

1. In Supabase, open **SQL Editor** and run each file in
   `supabase/migrations/` in order.
2. In **Authentication > URL Configuration**, set **Site URL** to the deployed
   site address so email confirmation links return to the app.

The project URL and publishable key in `src/config.js` are public values.
Never commit a secret or service-role key.

## Project layout

```
index.html            entry page
src/main.js           boot and route handling
src/router.js         hash router
api/                  server functions (price feed); secrets live in env vars
src/config.js         app flags (live trading lock lives here)
src/data/plan.js      trading plan, signal states, sections, roadmap
src/lib/              pure logic: risk maths, limits, journal statistics, sessions
src/services/         backend.js, the only file that talks to Supabase
src/state/            signed-in user and saved limits
src/pages/            dashboard, risk calculator, other pages
src/ui/               shell and icons
src/styles/app.css    design system
tests/                unit tests (node --test), a Supabase test double, and
                      tests/db/ SQL behaviour tests for the migrations
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
