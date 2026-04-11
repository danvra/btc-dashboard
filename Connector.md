# Connector Architecture

This document is the source of truth for the dashboard's connector layer after the free-source refactor.

## Goals

- Keep the dashboard strictly API-first on free documented sources.
- Stay inside Vercel Hobby cron constraints by using one daily cron plus stale-triggered refreshes.
- Delay paid hosting or paid data-provider pressure by keeping refresh cadence conservative and snapshots compact.
- Avoid scraper drift by removing unsupported cards from v1 instead of shipping misleading proxies.

## Retained v1 metrics

The dashboard keeps only metrics that can be sourced or derived from documented free APIs:

- `ssr`
- `fear-and-greed`
- `funding-rate`
- `open-interest`
- `adjusted-transfer-volume`
- `mvrv`
- `puell-multiple`
- `pi-cycle-top`
- `mayer-multiple`
- `2-year-ma-multiplier`
- `power-law`
- `stock-to-flow`
- `active-supply`
- `active-addresses`
- `hashrate`
- `difficulty`
- `hash-ribbon`
- `nvt-signal`
- `dxy`
- `10y-real-yield`
- `fed-balance-sheet`
- `on-rrp`

## Deferred metrics

The following cards are intentionally out of v1 and should stay out until we adopt a paid provider or a clearly documented free API:

- `recent-reddit-sentiment`
- `price-vs-realized-price`
- `asopr`
- `exchange-netflow`
- `exchange-balance`
- `nupl`
- `lth-nupl`
- `sth-nupl`
- `rhodl-ratio`
- `hodl-waves`
- `cdd`
- `dormancy`
- `fed-rate-expectations`
- `spot-btc-etf-flows`
- `spot-btc-etf-holdings`

## Source adapters

## Attribution

- CoinGecko-backed UI surfaces must keep a visible text attribution near the related dashboard data.
- Current implementation uses the linked copy `Price and market-cap data provided by CoinGecko API.` near the top-level price and market section.
- If the CoinGecko-powered scope expands, keep that attribution visible or add an equally prominent replacement close to the affected data.

### Fast cohort

- CoinGecko:
  - spot price summary
  - BTC + major stablecoin market caps for `ssr`
  - authenticated with `x-cg-demo-api-key` when `COINGECKO_DEMO_API_KEY` or `x_cg_demo_api_key` is present
- Binance, Bybit, OKX:
  - BTC perp funding history for the funding basket
- Binance:
  - BTCUSDT open interest snapshot, with local history for chart continuity
- mempool.space:
  - recommended fees for summary/debug context

### Daily cohort

- Blockchain.com Charts:
  - `market-price`
  - `mvrv`
  - `estimated-transaction-volume-usd`
  - `estimated-transaction-volume`
  - `total-bitcoins`
  - `n-unique-addresses`
  - `hash-rate`
  - `difficulty`
  - `miners-revenue`
  - `nvts`
- Alternative.me:
  - Fear & Greed
- BGeometrics MCP / Bitcoin API:
  - `long-term-hodler-supply-btc`
  - `short-term-hodler-supply-btc`
  - `lth-net-position-change-30d-btc` when the endpoint is healthy
  - `reserve-risk`
  - `liveliness`
  - `supply-profit` combined with circulating supply to derive `percent-supply-in-profit`
  - optional auth via `BGAPI_TOKEN`, but free tier works without a token
- mempool.space:
  - next difficulty adjustment subtitle context

### Slow cohort

- FRED:
  - `DTWEXBGS`
  - `DFII10`
  - `WALCL`
  - `RRPTSYD`
  - public CSV connector fallback via `fredgraph.csv`

## Cohorts and cadence

- `fast`
  - refresh floor: 1 hour
  - stale threshold: 2 hours
  - trigger: stale request only
  - owns `ssr`, `funding-rate`, `open-interest`, plus BTC price summary
- `daily`
  - refresh floor: 24 hours
  - stale threshold: 48 hours
  - trigger: single daily cron plus stale requests
  - owns Fear & Greed, Blockchain.com on-chain charts, and price-derived models
- `slow`
  - refresh floor: 48 hours
  - stale threshold: 72 hours
  - trigger: daily cron may check it, but the backend skips real fetches until it expires
  - owns the FRED macro block, using keyed JSON when available and CSV fallback otherwise
- `synthetic`
  - no independent schedule
  - recomputed whenever an upstream cohort changes

## Scheduler strategy

- Vercel Hobby cron is treated as daily-only.
- `vercel.json` keeps one daily warm route.
- `/api/dashboard-cache-warm` no longer force-refreshes daily and slow cohorts. It only refreshes stale groups.
- `/api/dashboard-cache` remains the main runtime entrypoint.
- The frontend still paints from the bundled static cache first, then asks the API for fresher data when any cohort is expired.
- Manual refresh uses `refresh=force` and bypasses TTL checks.

## Storage layout

### Public bootstrap artifacts

- `public/dashboard-cache.json`
- `public/dashboard-cache-groups/*.json`

These are first-paint and emergency fallback artifacts only.

### Server-side file-mode artifacts

- `.dashboard-cache-data/composite.json`
- `.dashboard-cache-data/groups/<group>.json`
- `.dashboard-cache-data/histories/<metric>.json`
- `.dashboard-cache-data/source-cache/<key>.json`
- `.dashboard-cache-data/watermarks.json`

### Redis key families

- `dashboard:composite`
- `dashboard:group:<groupId>`
- `dashboard:history:<metricId>`
- `dashboard:source-cache:<key>`
- `dashboard:watermark:<key>`
- `dashboard:lock:group:<groupId>`

## Capacity notes

- Group snapshots stay compact and API-facing.
- Long histories are stored separately and never embedded inside group snapshots.
- The old multi-megabyte `daily.json` pattern was removed by moving synthetic inputs into server-only histories.
- CoinGecko usage is intentionally conservative:
  - fast refresh: spot + market-cap calls on a 1-hour floor
  - daily refresh: CoinGecko is used only for fast spot and market-cap calls
- BGeometrics MCP usage is intentionally conservative:
  - daily cohort only
  - one cached pull per mapped metric on a 24-hour floor
  - free tier is treated as approximately `8 requests/hour` and `15/day`, so manual refreshes should still rely on cache whenever possible
- Daily model metrics use Blockchain.com `market-price` history to avoid depending on CoinGecko's authenticated long-history endpoint.
- Derivatives history is bounded and compact:
  - funding basket uses recent public venue history
  - open interest uses snapshots plus local history

## Optional env vars

- `BGAPI_TOKEN`
  - optional BGeometrics bearer token for higher-rate access
  - the app does not require it for the free MCP path

## Synthetic outputs

- `cycleEstimate` stays enabled and is now tuned to the retained free-only metric set.
- `cycleAnalog` only appears when at least 6 retained metrics have enough persisted history to produce a stable analog.

## Future work

- Add basis, liquidations, and fees cards from free exchange and mempool APIs.
- Add Deribit vol index as a free options-volatility block.
- Revisit unsupported cohort metrics only when we intentionally adopt a paid on-chain provider.
- Consider venue-weighted open-interest aggregation if a clean public multi-venue normalization path proves reliable.
