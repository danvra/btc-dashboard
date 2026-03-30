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

The app now uses a provider-based grouped cache:

- `redis`
  Durable Upstash Redis storage for Preview and Production when Redis credentials are configured
- `file`
  Local filesystem storage for local/dev by default
- `bootstrap-readonly`
  Bundled read-only fallback for hosted environments that do not have Redis configured

Bundled bootstrap assets still exist:

- `public/dashboard-cache.json`
- `public/dashboard-history.json`

Those files are now seed and emergency fallback artifacts, not the source of truth in Redis-backed environments.

Local file mode also keeps:

- `public/dashboard-cache-groups/`

These cache snapshot files are generated locally and are intentionally ignored by Git. Regenerate them with `npm run cache:update` when you need local bootstrap data.

The cache now uses grouped freshness domains:

- `fast`: intraday metrics like price, sentiment, and rate expectations
- `daily`: most on-chain and derived indicators
- `slow`: macro series with slower source cadence
- `synthetic`: cycle estimate and analog outputs derived from the current grouped snapshot

Frontend refresh policy:

- after loading the bundled/static snapshot, the app calls `/api/dashboard-cache` when `fast` data is older than `1 hour`
- it also calls `/api/dashboard-cache` when `daily`, `slow`, or `synthetic` data is older than `24 hours`
- manual refreshes call `/api/dashboard-cache?refresh=force` so the server bypasses group TTL checks

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
- That route manages grouped TTLs server-side, refreshes only stale groups on request, and persists successful updates immediately when storage is writable
- `/api/dashboard-cache-warm` is the authenticated daily cron warm route for `daily`, `slow`, and `synthetic`
- `DASHBOARD_CACHE_TTL_HOURS` controls the cache freshness window and defaults to `24`
- `vercel.json` warms the cache once per day with a cron request at `00:00 UTC`

Recommended storage setup on Vercel:

1. Install Upstash Redis through Vercel Marketplace.
2. Make sure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are available in Preview and Production.
3. Keep Redis in a region close to your Vercel project.
4. Keep `public/dashboard-cache.json` in the repo as the bootstrap fallback, but do not rely on runtime writes to `public/` in hosted environments.

This project intentionally targets Redis via Vercel Marketplace rather than the old Vercel KV path.

Storage mode resolution:

1. `DASHBOARD_STORAGE_MODE=redis|file|bootstrap` wins when explicitly set
2. otherwise Redis is used when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` exist
3. otherwise local/dev defaults to `file`
4. otherwise hosted environments fall back to `bootstrap-readonly`

Hosted fallback behavior without Redis:

- `/api/dashboard-cache` serves the bundled bootstrap snapshot
- `/api/dashboard-cache-warm` returns a safe no-op style response with fallback metadata
- the API exposes storage diagnostics in both headers and `payload.meta`

Optional environment variables:

- `DASHBOARD_CACHE_TTL_HOURS=24`
- `DASHBOARD_STORAGE_MODE=auto`
- `UPSTASH_REDIS_REST_URL=...`
- `UPSTASH_REDIS_REST_TOKEN=...`
- `CRON_SECRET=...`
- `OPENAI_API_KEY=...`
- `CYCLE_ESTIMATE_MODEL=gpt-4o-mini`
- `CYCLE_ESTIMATE_USE_LLM=true`

## DevSecOps CI/CD

GitHub Actions now protects merges into `main` with:

- `build` for `npm ci` and `npm run build`
- `sast` for Semgrep CE server-focused security checks
- `sca` for OSV-Scanner dependency scanning against `package-lock.json`
- `secrets` for full-history Gitleaks scanning

GitHub Code Scanning is the shared source of truth for findings:

- OSV uploads dependency results as SARIF
- Semgrep uploads SAST results as SARIF
- Gitleaks uploads secret-scan results as SARIF

The repo also includes a `Security Baseline` workflow for pushes to `main`, weekly scans, and manual runs.

See `docs/devsecops-ci.md` for the branch protection checklist and GitHub CLI notes.
