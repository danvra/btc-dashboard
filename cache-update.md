# Cache Update Model

This file summarizes the runtime cache behavior. For source ownership and deferred metrics, see `Connector.md`.

## Core behavior

- The frontend loads `public/dashboard-cache.json` first for a fast first paint.
- The frontend then calls `/api/dashboard-cache` when any cache cohort is expired.
- Manual refresh uses `/api/dashboard-cache?refresh=force`.
- Production refreshes are server-side only. The client never talks to third-party APIs directly.

## Cohorts

- `fast`
  - TTL: 1 hour
  - stale-after: 2 hours
  - owns `ssr`, `funding-rate`, `open-interest`, and the BTC price summary
- `daily`
  - TTL: 24 hours
  - stale-after: 48 hours
  - owns Fear & Greed, Blockchain.com on-chain charts, and public price-history model metrics
- `slow`
  - TTL: 48 hours
  - stale-after: 72 hours
  - owns FRED macro series
- `synthetic`
  - dependency-driven
  - recomputed after an upstream cohort refreshes

## Persistence

- Redis is the preferred hosted source of truth.
- File mode stores runtime data in `.dashboard-cache-data/`.
- Public cache files are bootstrap artifacts, not the long-term production source of truth.

## Efficiency guards

- Long histories are stored separately from API snapshots.
- Source responses use a cache keyed by adapter endpoint + params.
- Redis-backed refresh locks prevent concurrent stale requests from refreshing the same group at once.
- The daily warm route is stale-aware and no longer force-refreshes groups that are still fresh.
