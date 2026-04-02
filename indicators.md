# Indicator Notes

The dashboard is now intentionally limited to the retained free-source v1 metric set.

## Direct API metrics

- `fear-and-greed`
- `mvrv`
- `adjusted-transfer-volume`
- `active-addresses`
- `hashrate`
- `difficulty`
- `nvt-signal`
- `dxy`
- `10y-real-yield`
- `fed-balance-sheet`
- `on-rrp`

## Local derivations from free APIs

- `ssr`
- `funding-rate`
- `open-interest`
- `puell-multiple`
- `pi-cycle-top`
- `mayer-multiple`
- `2-year-ma-multiplier`
- `active-supply`
- `hash-ribbon`

## Local model overlays

- `power-law`
- `stock-to-flow`

## Deferred indicators

The removed metrics are documented in `Connector.md` under `Deferred metrics` and should remain out of v1 until we intentionally adopt a stronger data source.
