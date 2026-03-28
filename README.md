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

- `VITE_GLASSNODE_API_KEY`
- `VITE_FRED_API_KEY`

## Prototype cache mode

For a brittle but practical prototype, the app can read from a local cache file:

- App reads `public/dashboard-cache.json`
- Updater script refreshes that file from public sources
- Missing metrics stay on bundled placeholder values

Commands:

1. `npm run cache:update`
2. `npm run cache:watch`

`cache:watch` runs forever and refreshes the cache roughly every 55-65 minutes.

## Cycle estimate

The header now supports a daily BTC cycle estimate that is derived from the dashboard indicators.

- A deterministic first-pass estimator always runs
- An optional LLM refinement layer runs when `OPENAI_API_KEY` is present
- The estimator is designed to choose from a fixed set of verbose cycle positions instead of inventing labels

## Vercel deployment

Production should use the API cache route instead of the static `public/dashboard-cache.json` file:

- The app first tries `/api/dashboard-cache`
- That route rebuilds the payload server-side and returns CDN cache headers
- `DASHBOARD_CACHE_TTL_HOURS` controls the cache freshness window and defaults to `24`
- `vercel.json` warms the route once per day with a cron request at `00:00 UTC`

Optional environment variables:

- `DASHBOARD_CACHE_TTL_HOURS=24`
- `OPENAI_API_KEY=...`
- `CYCLE_ESTIMATE_MODEL=gpt-4o-mini`
- `CYCLE_ESTIMATE_USE_LLM=true`
