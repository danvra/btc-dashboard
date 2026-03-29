# BTC Dashboard

React + Tailwind scaffold for a Bitcoin monitoring dashboard with typed metric definitions and a preview UI for the initial panel structure.

## Included

- Vite + React + TypeScript app structure
- Tailwind configuration
- Typed dashboard panel and metric definitions
- Presentational preview component for the full dashboard spec

## Run locally

1. Install Node.js and npm.
2. Run `npm install`.
3. Run `npm run dev`.

## Current entry points

- `src/lib/dashboard-definitions.ts`
- `src/lib/dashboard-data.ts`
- `src/components/BtcDashboardDefinitionsPreview.tsx`
- `src/components/BtcDashboard.tsx`
- `src/App.tsx`

## Live data

The dashboard now uses a mixed live-data model:

- Public sources without keys for BTC price and several network metrics
- Optional Glassnode for deeper on-chain metrics
- Optional FRED for macro series

Copy `.env.example` to `.env` and add keys if you want the full set:

- `GLASSNODE_API_KEY`
- `FRED_API_KEY`

## Prototype cache mode

The app can run in a grouped cache mode with a local filesystem fallback:

- `public/dashboard-cache.json` is the bundled bootstrap snapshot for first paint
- Group snapshots live under `public/dashboard-cache-groups/`
- `public/dashboard-history.json` stores snapshot-style sparkline history in local/dev mode
- In production, the same grouped snapshots can persist to Redis-style storage through `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

The cache now uses grouped freshness domains:

- `fast`: intraday metrics like price, sentiment, and rate expectations
- `daily`: most on-chain and derived indicators
- `slow`: macro series with slower source cadence
- `synthetic`: cycle estimate and analog outputs derived from the current grouped snapshot

Commands:

1. `npm run cache:update`
2. `npm run cache:watch`

`cache:update` forces a full grouped refresh.

`cache:watch` runs forever, wakes up roughly every 55-65 minutes, and lets server TTLs decide which groups are actually stale.

## Cycle estimate

The header now supports a daily BTC cycle estimate that is derived from the dashboard indicators.

- A deterministic first-pass estimator always runs
- An optional LLM refinement layer runs when `OPENAI_API_KEY` is present
- The estimator is designed to choose from a fixed set of verbose cycle positions instead of inventing labels

## Vercel deployment

Production should use the API cache route instead of treating the static `public/dashboard-cache.json` file as the source of truth:

- The app first tries `/api/dashboard-cache`
- That route manages grouped TTLs server-side, refreshes only stale groups on request, and persists successful updates immediately
- `/api/dashboard-cache-warm` is the authenticated daily cron warm route for `daily`, `slow`, and `synthetic`
- `DASHBOARD_CACHE_TTL_HOURS` controls the cache freshness window and defaults to `24`
- `vercel.json` warms the cache once per day with a cron request at `00:00 UTC`

Optional environment variables:

- `DASHBOARD_CACHE_TTL_HOURS=24`
- `UPSTASH_REDIS_REST_URL=...`
- `UPSTASH_REDIS_REST_TOKEN=...`
- `CRON_SECRET=...`
- `OPENAI_API_KEY=...`
- `CYCLE_ESTIMATE_MODEL=gpt-4o-mini`
- `CYCLE_ESTIMATE_USE_LLM=true`
