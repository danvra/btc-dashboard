# BTC Dashboard

React + Vite dashboard for a compact Bitcoin monitoring stack built on free documented APIs and local derivations.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add `COINGECKO_DEMO_API_KEY` or the Vercel-native `x_cg_demo_api_key` if you want authenticated CoinGecko calls locally.
4. Add `FRED_API_KEY` if you want keyed FRED JSON access locally. Without it, the macro cohort falls back to the public FRED CSV connector.
5. Run `npm run dev`.

## Connector model

- `Connector.md`
  - canonical source adapter, cohort, storage, and deferred-metric plan
- `cache-update.md`
  - runtime cache behavior
- `indicators.md`
  - retained indicator inventory

## Runtime architecture

- The app paints from `public/dashboard-cache.json` first.
- The frontend then asks `/api/dashboard-cache` for fresher grouped data.
- The backend refreshes only stale cohorts and persists successful results immediately when storage is writable.
- Vercel cron warms stale daily and slow cohorts once per day.
- CoinGecko-backed price and market-cap data are attributed in the UI with a visible linked note near the top-level market summary.

## Cohorts

- `fast`
  - 1 hour TTL
  - spot summary, `ssr`, `funding-rate`, `open-interest`
- `daily`
  - 24 hour TTL
  - Fear & Greed, on-chain charts, and price-derived indicators
- `slow`
  - 48 hour TTL
  - FRED macro series
- `synthetic`
  - dependency-driven `cycleEstimate` and `cycleAnalog`

## Storage modes

- `redis`
  - preferred hosted mode using Upstash Redis
- `file`
  - local/dev runtime data in `.dashboard-cache-data/`
- `bootstrap-readonly`
  - hosted fallback when Redis is unavailable

Public files remain bootstrap artifacts only:

- `public/dashboard-cache.json`
- `public/dashboard-cache-groups/*.json`

Server-side histories, source caches, and watermarks are intentionally stored outside `public/` in file mode.

## Commands

- `npm run dev`
- `npm run build`
- `npm run cache:update`
- `npm run cache:watch`

`cache:update` forces a full grouped refresh and regenerates the local bootstrap cache.

## Environment variables

- `FRED_API_KEY`
- `COINGECKO_DEMO_API_KEY`
- `DASHBOARD_STORAGE_MODE=redis|file|bootstrap`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CRON_SECRET`
- `OPENAI_API_KEY`
- `CYCLE_ESTIMATE_MODEL`
- `CYCLE_ESTIMATE_USE_LLM=true|false`
