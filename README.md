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
