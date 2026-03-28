# Indicator Implementation Notes

This file documents how each dashboard indicator is currently produced in the prototype.

Status labels:

- `scraped`: pulled from a public feed or public chart data file and used directly.
- `approx`: computed from a proxy, derived series, or fallback source that is directionally useful but not the exact target metric.
- `seeded`: placeholder sample data. As of this snapshot, no indicators are still seeded.

Current snapshot:

- Total indicators in the dashboard: `27`
- `scraped`: `18`
- `approx`: `9`
- `seeded`: `0`

## Priority Caveats

### Exchange Netflow (`exchange-netflow`)

- Panel: `Daily / Price Action`
- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Load `sth_supply.json` from BGeometrics.
  - Compute a 1-day delta of short-term holder supply.
  - Use that daily change as a proxy for coins becoming more exchange-ready or leaving liquid hands.
- Why we came to this:
  - Exact exchange netflow endpoints were found in provider docs, but the clean public API path was token-gated or rate-limited.
  - The prototype needed a live, directionally useful placeholder instead of remaining seeded.
- Main weakness:
  - Short-term holder supply is not the same thing as exchange flow.
  - It captures liquid-hand behavior, not verified transfers into or out of exchanges.
- How to improve:
  - Replace with exact exchange netflow from `bitcoin-data.com`, Glassnode, CryptoQuant, or another provider with authenticated access.
  - If a public chart file becomes available, scrape that directly instead of deriving from STH supply.

### Exchange Balance / Exchange Reserve (`exchange-balance`)

- Panel: `Daily / Price Action`
- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Load `sth_supply.json` from BGeometrics.
  - Use current short-term holder supply as a proxy for BTC that is more liquid and more likely to be exchange-adjacent.
- Why we came to this:
  - Exact exchange reserve endpoints were identified in provider docs, but not through a stable no-key public feed we could rely on.
  - We chose a liquid-supply stand-in rather than leaving the card blank.
- Main weakness:
  - STH supply is not the same as coins actually sitting on exchanges.
  - This is a market-liquidity proxy, not a custody-location metric.
- How to improve:
  - Replace with exact exchange reserve data from `bitcoin-data.com`, Glassnode, CryptoQuant, or another authenticated provider.
  - Prefer a direct exchange reserve series over any holder-supply approximation.

### Fed Rate Expectations / FedWatch (`fed-rate-expectations`)

- Panel: `Macro / Market Structure`
- Current status: `approx`
- Current source: `FRED yield-curve proxy`
- How it is generated:
  - Load `DGS1` from FRED for the 1-year Treasury yield.
  - Load `DFF` from FRED for the effective federal funds rate.
  - Compute `DGS1 - DFF`.
  - Convert that spread into a simple label such as `cuts priced` or `hikes priced`.
- Why we came to this:
  - CME FedWatch does not provide a clean free public API for this use.
  - We needed a public no-key macro expectations proxy.
- Main weakness:
  - This is not meeting-by-meeting policy probability data.
  - It is a curve-based expectations proxy, not a true FedWatch replacement.
- How to improve:
  - Replace with `https://rateprobability.com/api/latest`, which exposes meeting-level implied rates and move probabilities publicly.
  - If production reliability matters, move to an official or licensed futures-based source.

## Daily / Price Action

### Price vs Realized Price (`price-vs-realized-price`)

- Current status: `scraped`
- Current source: `Blockchain.com market signals`
- How it is generated:
  - Pull the public `mvrv` chart series from Blockchain.com.
  - Treat the latest MVRV ratio as the displayed `price vs realized price` multiple.
  - Infer realized price as `spot price / MVRV` for the subtitle.
- Improve by:
  - Using a direct realized price series from Glassnode or another authenticated provider instead of inferring it from MVRV.

### aSOPR (`asopr`)

- Current status: `approx`
- Current source: `BGeometrics SOPR proxy`
- How it is generated:
  - First try `https://bitcoin-data.com/v1/asopr`.
  - If that is unavailable or rate-limited, fall back to BGeometrics `sopr_7sma.json`.
  - The current saved snapshot is using the fallback proxy.
- Improve by:
  - Persisting the exact `asopr` feed through a better cache window or authenticated plan.
  - Replacing the SOPR fallback with exact aSOPR whenever possible.

### Exchange Netflow (`exchange-netflow`)

- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Day-over-day delta of BGeometrics `sth_supply.json`.
- Improve by:
  - Replacing with exact exchange netflow from an authenticated provider.

### Exchange Balance / Exchange Reserve (`exchange-balance`)

- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Current value from BGeometrics `sth_supply.json`.
- Improve by:
  - Replacing with exact exchange reserve data from an authenticated provider.

### Adjusted Transfer Volume (`adjusted-transfer-volume`)

- Current status: `scraped`
- Current source: `Blockchain.com`
- How it is generated:
  - Pull `estimated-transaction-volume-usd` from Blockchain.com.
  - Use it as the current dashboard implementation for adjusted transfer volume.
- Improve by:
  - Replacing with a true change-adjusted transfer volume series from Glassnode or CryptoQuant.

## Cycle / Regime

### MVRV (`mvrv`)

- Current status: `scraped`
- Current source: `Blockchain.com market signals`
- How it is generated:
  - Pull the public Blockchain.com `mvrv` series and chart it directly.
- Improve by:
  - Switching to a direct provider API if we need stronger guarantees around methodology and availability.

### Percent Supply in Profit (`percent-supply-in-profit`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load BGeometrics `profit_loss.json`.
  - Use the series as the current supply-in-profit implementation.
- Improve by:
  - Replacing with a documented provider API if we want a less brittle source than chart files.

### LTH Supply (`lth-supply`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load BGeometrics `lth_supply.json`.
- Improve by:
  - Replacing chart-file scraping with an API endpoint if one becomes accessible.

### STH Supply (`sth-supply`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load BGeometrics `sth_supply.json`.
- Improve by:
  - Replacing chart-file scraping with an API endpoint if one becomes accessible.

### LTH Net Position Change (`lth-net-position-change`)

- Current status: `approx`
- Current source: `BGeometrics derived`
- How it is generated:
  - Load `lth_supply.json`.
  - Compute a 30-day lagged delta of long-term holder supply.
- Improve by:
  - Replacing with the exact `lth-net-position-change-30d-btc` provider series.

### Reserve Risk (`reserve-risk`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load BGeometrics `reserve_risk.json`.
- Improve by:
  - Switching to a direct API feed if available, instead of scraping chart files.

### Liveliness (`liveliness`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Parse the `Liveliness` Plotly trace embedded in `bitcoin_liveliness_g.html`.
- Improve by:
  - Replacing HTML trace parsing with a direct JSON series.

### Puell Multiple (`puell-multiple`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Pull Blockchain.com `miners-revenue`.
  - Compute `current miner revenue / 365-day average miner revenue`.
- Improve by:
  - Replacing with a direct Puell Multiple feed from Glassnode or another exact source.

## Context / Confirmation

### Active Supply (`active-supply`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Pull Blockchain.com `estimated-transaction-volume`.
  - Pull Blockchain.com `total-bitcoins`.
  - Compute `transaction volume BTC / circulating supply * 100`.
- Improve by:
  - Replacing with an exact active supply metric from a dedicated on-chain provider.

### Active Addresses (`active-addresses`)

- Current status: `scraped`
- Current source: `Blockchain.com`
- How it is generated:
  - Pull Blockchain.com `n-unique-addresses`.
- Improve by:
  - Replacing with an entity-adjusted or provider-grade active address series if needed.

### CDD (`cdd`)

- Current status: `scraped`
- Current source: `BitInfoCharts derived`
- How it is generated:
  - Read `Days Destroyed / Total Bitcoins` from the BitInfoCharts BTC page.
  - Multiply by current circulating supply to reconstruct an absolute CDD-like reading.
- Improve by:
  - Replacing with an exact CDD series from `bitcoin-data.com`, Glassnode, or another provider.

### Dormancy (`dormancy`)

- Current status: `approx`
- Current source: `BitInfoCharts derived`
- How it is generated:
  - Compute `CDD / BTC sent in last 24h` from BitInfoCharts snapshot values.
- Improve by:
  - Replacing with an exact average dormancy series.

### Hashrate (`hashrate`)

- Current status: `scraped`
- Current source: `Blockchain.com`
- How it is generated:
  - Pull Blockchain.com `hash-rate`.
- Improve by:
  - Adding a secondary source or fallback from mempool.space for resiliency.

### Difficulty (`difficulty`)

- Current status: `scraped`
- Current source: `Blockchain.com + mempool.space`
- How it is generated:
  - Pull Blockchain.com `difficulty` for the chart.
  - Pull mempool.space `difficulty-adjustment` for the forward-looking delta label.
- Improve by:
  - Using a single documented source for both current level and next adjustment if consistency becomes important.

### SSR (`ssr`)

- Current status: `approx`
- Current source: `CoinGecko proxy`
- How it is generated:
  - Pull CoinGecko market caps for Bitcoin plus a basket of major stablecoins.
  - Compute `bitcoin market cap / stablecoin market cap`.
- Improve by:
  - Replacing with a true SSR series from an on-chain or market-structure provider.

## Macro / Market Structure

### U.S. Dollar Index (`dxy`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `DTWEXBGS` from FRED.
- Improve by:
  - Using the classic ICE DXY if that specific index is preferred over the broad trade-weighted dollar index.

### 10Y Real Yield (`10y-real-yield`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `DFII10` from FRED.
- Improve by:
  - Adding fallback handling for missing Treasury market days if desired.

### Fed Rate Expectations / FedWatch (`fed-rate-expectations`)

- Current status: `approx`
- Current source: `FRED yield-curve proxy`
- How it is generated:
  - Compute `DGS1 - DFF`.
- Improve by:
  - Replacing with `rateprobability.com/api/latest` or another meeting-by-meeting rate probability source.

### Fed Balance Sheet (`fed-balance-sheet`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `WALCL` from FRED.
- Improve by:
  - None urgently needed; this is already a strong public source for the prototype.

### ON RRP (`on-rrp`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `RRPTSYD` from FRED.
- Improve by:
  - None urgently needed; this is already a strong public source for the prototype.

### Spot BTC ETF Flows (`spot-btc-etf-flows`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load BGeometrics `flow_btc_etf_btc.json`.
- Improve by:
  - Replacing with a documented ETF API or issuer-level aggregation if we want less brittle sourcing.

### Spot BTC ETF Holdings (`spot-btc-etf-holdings`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load BGeometrics `total_btc_etf_btc.json`.
- Improve by:
  - Replacing with a documented ETF API or issuer-level aggregation if we want less brittle sourcing.

## Suggested Upgrade Order

- 1. `fed-rate-expectations`
  - Best near-term upgrade because `rateprobability.com/api/latest` is public and meaningfully better than the current proxy.
- 2. `exchange-netflow`
  - High-value indicator, but likely needs authenticated provider data to become exact.
- 3. `exchange-balance`
  - Same constraint as exchange netflow; best fixed with a direct provider feed.
- 4. `asopr`
  - Already has an exact endpoint, but free-plan rate limits make the proxy appear often.
- 5. `lth-net-position-change`, `puell-multiple`, `active-supply`, `dormancy`, `ssr`
  - These are useful now, but would benefit from more exact provider-native series over time.
