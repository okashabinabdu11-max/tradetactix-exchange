# TradeTactix Exchange

A responsive cryptocurrency exchange **demo** built with Vite and vanilla JavaScript. It includes a branded homepage, sample market overview, P2P advertisement/order workflow, simulated spot trading chart, watchlist, and user, merchant, and admin dashboard views.

## Run locally

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Create and preview a production build:

```bash
npm run build
npm run preview
```

Vite configuration, `package.json`, and `index.html` are at the repository root. The production output is `dist/`.

## Deploy on Vercel

Import this repository and use the following project settings (or leave the framework preset as Vite):

- Root Directory: `.` (repository root)
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

## Deploy on Netlify

Import the repository and set the base directory to the repository root. Build command: `npm run build`; publish directory: `dist`. The included `netlify.toml` configures these values.

## Demo safety and architecture

- Prices, chart points, balances, advertisements, and order records are sample/simulated data. Nothing here is a live market feed or payment confirmation.
- P2P order actions create local demo records only; the escrow workflow is informational and does not hold assets.
- No real-money trading, deposits, withdrawals, custody, or Ethiopian Birr payment processing is implemented.
- There is no authentication or backend in this frontend-only demo, and no secret/API key is embedded. Do not use client-side demo state for real accounts, balances, orders, or authorization. A compliant production integration requires a trusted server, secure authentication, database authorization policies, and regulatory approval before any live financial features are enabled.
