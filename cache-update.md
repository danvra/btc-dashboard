# Cache Update Model

This document explains how the dashboard cache is intended to work, how the updater is structured, which indicators belong to which refresh groups, and how freshness should be interpreted.

## Goals

The cache model is designed to solve four problems:

1. Avoid fetching every upstream source on every request.
2. Persist refreshed state so the next request sees the update immediately.
3. Keep the UI simple by making the server the source of truth for freshness.
4. Preserve synthetic outputs like cycle estimate and cycle analog whenever upstream groups change.

## Core Model

The dashboard cache is split into four refresh domains:

- `fast`
  Intended for intraday values that can move materially during the day.
- `daily`
  Intended for on-chain and derived indicators that are good enough with roughly daily cadence.
- `slow`
  Intended for macro or structural series that move slowly.
- `synthetic`
  No external fetches.
  This group is recomputed from the latest persisted upstream groups whenever `fast`, `daily`, or `slow` changes.

Each group owns:

- a set of metric ids
- a TTL (`ttlMs`)
- a looser freshness threshold for UI/debugging (`staleAfterMs`)
- its own persisted snapshot
- any warnings specific to that group
- the latest source timestamp seen inside that group

## Group TTLs

Current grouped defaults:

- `fast`
  TTL: `30 minutes`
  Stale-after: `3 hours`
- `daily`
  TTL: `24 hours`
  Stale-after: `36 hours`
- `slow`
  TTL: `72 hours`
  Stale-after: `7 days`
- `synthetic`
  TTL: `0`
  It is dependency-driven, not time-driven.
  Stale-after: `24 hours`

Interpretation:

- `expiresAt` controls whether a group should be refreshed on the next server request.
- `staleAfterMs` is for display/debug tone and should not be used as the server refresh trigger.

## Metric Ownership

### Fast

- `price-vs-realized-price`
- `fear-and-greed`
- `ssr`
- `fed-rate-expectations`

### Daily

- `asopr`
- `exchange-netflow`
- `exchange-balance`
- `adjusted-transfer-volume`
- `mvrv`
- `percent-supply-in-profit`
- `lth-supply`
- `sth-supply`
- `lth-net-position-change`
- `reserve-risk`
- `liveliness`
- `puell-multiple`
- `pi-cycle-top`
- `mayer-multiple`
- `2-year-ma-multiplier`
- `nupl`
- `lth-nupl`
- `sth-nupl`
- `rhodl-ratio`
- `hodl-waves`
- `active-supply`
- `active-addresses`
- `cdd`
- `dormancy`
- `hashrate`
- `difficulty`
- `hash-ribbon`
- `funding-rate`
- `open-interest`
- `nvt-signal`
- `power-law`
- `stock-to-flow`
- `spot-btc-etf-flows`
- `spot-btc-etf-holdings`

### Slow

- `dxy`
- `10y-real-yield`
- `fed-balance-sheet`
- `on-rrp`

### Synthetic

- `cycleEstimate`
- `cycleAnalog`

These are stored in the synthetic group summary rather than as metric cards.

## Source Ownership

The refresh split is source-driven, not just metric-driven.

### Fast fetcher

The fast refresher should only call:

- CoinGecko BTC price
- CoinGecko market caps used for SSR
- Alternative.me fear and greed
- Rate Probability
- minimal FRED fallback inputs only if Rate Probability is unavailable

The fast group must not fetch Blockchain.com or the BGeometrics on-chain bundle.

### Daily fetcher

The daily refresher should own:

- Blockchain.com on-chain price/network series
- mempool difficulty adjustment
- BGeometrics series
- bitcoin-data aSOPR
- BitInfo snapshot
- all daily derived indicators built from those sources

The daily group is also responsible for persisting any history-backed snapshot metrics that are generated from repeated refreshes rather than long native source series.

### Slow fetcher

The slow refresher should only call:

- FRED macro series

### Synthetic fetcher

The synthetic refresher should not call any external source.

It should read:

- the latest persisted `fast`, `daily`, and `slow` group snapshots
- persisted history used by synthetic inputs such as `dormancy`

It should then recompute:

- cycle estimate
- cycle analog

## Persistence Model

Production persistence should be durable key-value storage.

The intended production backend is an Upstash-compatible Redis REST store wired through the Vercel project environment, rather than relying on request-local memory or the ephemeral Vercel filesystem.

The storage interface is:

- `readGroupSnapshot(groupId)`
- `writeGroupSnapshot(groupId, snapshot)`
- `readAllGroupSnapshots(groupIds)`
- `readCompositeSnapshot()`
- `writeCompositeSnapshot(snapshot)`
- `readHistory(metricId)`
- `appendHistory(metricId, point, maxPoints)`

### Production keys

- `dashboard:group:<groupId>`
- `dashboard:composite`
- `dashboard:history:<metricId>`

### Production env vars

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CRON_SECRET`

### Local fallback

When durable KV is not configured, the local/dev fallback remains filesystem-backed:

- `public/dashboard-cache.json`
- `public/dashboard-cache-groups/<group>.json`
- `public/dashboard-history.json`

`public/dashboard-cache.json` is still useful as the bundled bootstrap artifact for first paint, but it should not be treated as the long-term production source of truth.

## Snapshot Shape

Each group snapshot should carry:

- `groupId`
- `generatedAt`
- `expiresAt`
- `ttlMs`
- `staleAfterMs`
- `metricIds`
- `warnings`
- `lastSourceUpdateAt`
- `metrics`
- `summary`
- optional internal fields needed for later recomputation, such as synthetic inputs or derived context

The composite snapshot returned to the UI should carry:

- merged `metrics`
- `summary`
- `meta.generatedAt`
- `meta.nextSuggestedRunAt`
- `meta.scheduler`
- `meta.groups`

`meta.groups` is the grouped freshness/debug view shown by the app.

## History-Backed Metrics

Some metrics do not have a native historical series in the same format we want to display.
Those are built from repeated refreshes and must be persisted separately so the sparkline survives process restarts.

Current history-backed metrics:

- `cdd`
- `dormancy`
- `price-vs-realized-price`
- `ssr`

It is also acceptable to use the same history mechanism for other fast snapshot-style series if needed.

History rules:

- append on successful refresh of the owning group
- replace the latest point if the new point is within `30 minutes` of the last timestamp
- keep only the latest `180` points unless the cap is intentionally changed

## Updater Entry Points

### `npm run cache:update`

This is the manual full refresh path.

Expected behavior:

- refresh `fast`
- refresh `daily`
- refresh `slow`
- recompute `synthetic`
- persist all successful snapshots
- rebuild and persist the composite snapshot

### `npm run cache:watch`

This is the local long-running refresher.

Expected behavior:

- loop forever
- call the grouped refresh manager
- let TTLs decide which upstream groups are actually stale
- persist any successful updates immediately

## Request-Time API Flow

`/api/dashboard-cache` behaves like this:

1. Read persisted grouped snapshots.
2. Bootstrap from bundled `public/dashboard-cache.json` if persistent storage is empty.
3. Determine which upstream groups are stale based on `expiresAt`.
4. Refresh only those stale groups.
5. If any upstream group changed, recompute `synthetic`.
6. Persist any successful group snapshots immediately.
7. Rebuild and persist the composite snapshot.
8. Return the composite payload to the client.

Failure behavior:

- if one group refresh fails but a previous persisted snapshot exists, keep the old snapshot
- add a warning to the composite payload
- do not wipe out synthetic outputs just because one upstream refresh failed

## Warm Route and Cron

Because the deployment target is Vercel Hobby, the design should not depend on sub-daily cron frequency.

The intended cron strategy is:

- one daily cron
- a dedicated warm route
- warm only `daily` and `slow`
- recompute `synthetic`
- leave `fast` request-driven

The warm route currently lives at `/api/dashboard-cache-warm` and should:

- authenticate via `CRON_SECRET`
- reject unauthenticated requests
- persist all successful updates the same way as the normal grouped updater

## Client Behavior

The client should stay simple:

1. Load `public/dashboard-cache.json` for a fast initial render.
2. Immediately fetch `/api/dashboard-cache`.
3. Promote the API snapshot if it is newer.
4. Trust server freshness metadata instead of making refresh decisions in the browser.

Important timestamp semantics:

- `metric.asOf`
  Source publish time or source datapoint time.
- `metric.refreshedAt`
  When the server refreshed that metric’s owning group.
- `summary.lastUpdatedAt`
  Composite snapshot generation time.
- `meta.generatedAt`
  Cache generation time for the returned payload.

The card-level `Updated ...` UI should continue to use `metric.asOf`.
The debug/cache panel should use grouped cache metadata and composite generation time.

## Synthetic Dependency Rules

Synthetic outputs should recompute whenever:

- `fast` refresh succeeds
- `daily` refresh succeeds
- `slow` refresh succeeds

Synthetic should not overwrite itself with empty or partial data.

If recomputation fails:

- keep the last persisted synthetic snapshot
- keep the last persisted composite synthetic fields
- add a warning rather than clearing the output

## Why This Model Exists

Without grouped refresh:

- every stale request forces a full upstream rebuild
- intraday metrics cause needless refetching of slow and daily data
- request-time updates can disappear between invocations if persistence is not durable

With grouped refresh plus durable persistence:

- the app only calls the sources that actually need updating
- refreshed data survives the current process and the current CDN response
- synthetic outputs stay in sync with the last successful upstream refreshes
- the UI can show both source freshness and cache freshness clearly
