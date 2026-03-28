# Indicator Implementation Notes

This file documents how each dashboard indicator is currently produced in the prototype.

Status labels:

- `scraped`: pulled from a public feed or public chart data file and used directly.
- `approx`: computed from a proxy, derived series, or model overlay that is useful but not the exact target metric.
- `seeded`: placeholder sample data. As of this snapshot, no indicators remain seeded.

Current snapshot:

- Total indicators in the dashboard: `42`
- `scraped`: `25`
- `approx`: `17`
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
  - Exact exchange netflow endpoints were identified in provider docs, but stable public no-key access was not available.
- Main weakness:
  - Short-term holder supply change is not the same as verified BTC transfers into or out of exchanges.
- How to improve:
  - Replace with exact exchange netflow from `bitcoin-data.com`, Glassnode, CryptoQuant, or another authenticated provider.

### Exchange Balance / Exchange Reserve (`exchange-balance`)

- Panel: `Daily / Price Action`
- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Load `sth_supply.json` from BGeometrics.
  - Use current short-term holder supply as a proxy for liquid or exchange-adjacent BTC.
- Why we came to this:
  - We wanted a live directional stand-in rather than leaving the card blank.
- Main weakness:
  - STH supply is a liquidity proxy, not a custody-location metric.
- How to improve:
  - Replace with exact exchange reserve data from `bitcoin-data.com`, Glassnode, CryptoQuant, or another authenticated source.

### LTH-NUPL / STH-NUPL (`lth-nupl`, `sth-nupl`)

- Panel: `Cycle / Regime`
- Current status: `approx`
- Current source: `BGeometrics cohort MVRV proxy`
- How they are generated:
  - Load `lth_mvrv.json` and `sth_mvrv.json`.
  - Derive cohort NUPL as `1 - 1 / MVRV`.
- Why we came to this:
  - Exact public cohort NUPL series were not exposed, but public cohort MVRV series were.
- Main weakness:
  - These are derived cohort-profit proxies, not a direct vendor-supplied cohort NUPL feed.
- How to improve:
  - Replace with exact `LTH-NUPL` and `STH-NUPL` from Glassnode or another cohort-level provider.

## Daily / Price Action

### Price vs Realized Price (`price-vs-realized-price`)

- Current status: `scraped`
- Current source: `Blockchain.com market signals`
- How it is generated:
  - Pull Blockchain.com `mvrv`.
  - Treat the current MVRV ratio as the displayed `price vs realized price` multiple.
  - Infer realized price as `spot / MVRV` for the subtitle.
- Improve by:
  - Using a direct realized price series instead of inferring it from MVRV.

### aSOPR (`asopr`)

- Current status: `approx` or `scraped`, depending on feed availability
- Current source: `bitcoin-data.com` primary, `BGeometrics SOPR proxy` fallback
- How it is generated:
  - First try `https://bitcoin-data.com/v1/asopr`.
  - If unavailable or rate-limited, fall back to `sopr_7sma.json`.
- Improve by:
  - Persisting the exact aSOPR feed with a stronger cache or authenticated plan.

### Exchange Netflow (`exchange-netflow`)

- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Day-over-day delta of `sth_supply.json`.
- Improve by:
  - Replacing with exact exchange flow data.

### Exchange Balance / Exchange Reserve (`exchange-balance`)

- Current status: `approx`
- Current source: `BGeometrics liquid-supply proxy`
- How it is generated:
  - Current value from `sth_supply.json`.
- Improve by:
  - Replacing with exact exchange reserve data.

### Adjusted Transfer Volume (`adjusted-transfer-volume`)

- Current status: `scraped`
- Current source: `Blockchain.com`
- How it is generated:
  - Pull `estimated-transaction-volume-usd`.
- Improve by:
  - Replacing with a true change-adjusted transfer volume series from an on-chain provider.

## Cycle / Regime

### MVRV (`mvrv`)

- Current status: `scraped`
- Current source: `Blockchain.com market signals`
- How it is generated:
  - Pull the public Blockchain.com `mvrv` series directly.
- Improve by:
  - Moving to a documented provider API if stronger methodology guarantees are needed.

### Pi Cycle Top (`pi-cycle-top`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Pull long BTC price history.
  - Compute `111D SMA` and `2 x 350D SMA`.
  - Display the percentage buffer between them.
- Improve by:
  - Storing both moving-average series for expanded chart mode.

### Mayer Multiple (`mayer-multiple`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Compute `spot price / 200D moving average`.
- Improve by:
  - Adding exact model bands or richer zone logic if desired.

### 2-Year MA Multiplier (`2-year-ma-multiplier`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Pull long BTC price history.
  - Compute the `2-year moving average`.
  - Compute the `5x 2-year MA` upper band.
  - Display the current percentage buffer between spot price and that upper band.
- Why we came to this:
  - This is a community-followed cycle model derived entirely from price, so a public price series is enough for a useful prototype.
- Improve by:
  - Adding the actual 2Y MA and 5x band lines in expanded chart mode.

### NUPL (`nupl`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Parse the `NUPL` Plotly trace from `bitcoin_nupl_g.html`.
- Improve by:
  - Replacing HTML trace parsing with a direct JSON series if a public file becomes available.

### LTH-NUPL (`lth-nupl`)

- Current status: `approx`
- Current source: `BGeometrics cohort proxy`
- How it is generated:
  - Load `lth_mvrv.json`.
  - Compute `1 - 1 / LTH MVRV`.
- Improve by:
  - Switching to an exact public or authenticated cohort NUPL series.

### STH-NUPL (`sth-nupl`)

- Current status: `approx`
- Current source: `BGeometrics cohort proxy`
- How it is generated:
  - Load `sth_mvrv.json`.
  - Compute `1 - 1 / STH MVRV`.
- Improve by:
  - Switching to an exact public or authenticated cohort NUPL series.

### Percent Supply in Profit (`percent-supply-in-profit`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `profit_loss.json`.
- Improve by:
  - Replacing chart-file scraping with a documented API if one becomes available.

### LTH Supply (`lth-supply`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `lth_supply.json`.
- Improve by:
  - Replacing chart-file scraping with a documented API if accessible.

### STH Supply (`sth-supply`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `sth_supply.json`.
- Improve by:
  - Replacing chart-file scraping with a documented API if accessible.

### LTH Net Position Change (`lth-net-position-change`)

- Current status: `approx`
- Current source: `BGeometrics derived`
- How it is generated:
  - Compute a 30-day lagged delta of `lth_supply.json`.
- Improve by:
  - Replacing with an exact LTH net position change series.

### Reserve Risk (`reserve-risk`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `reserve_risk.json`.
- Improve by:
  - Replacing with a direct API feed if available.

### Liveliness (`liveliness`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Parse the `Liveliness` Plotly trace from `bitcoin_liveliness_g.html`.
- Improve by:
  - Replacing HTML trace parsing with a direct JSON series.

### RHODL Ratio (`rhodl-ratio`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `rhodl_1m.json`.
  - Use the 1-month smoothed RHODL ratio as the dashboard value.
- Improve by:
  - Adding the unsmoothed `rhodl.json` in expanded views if needed.

### Fear and Greed (`fear-and-greed`)

- Current status: `scraped`
- Current source: `Alternative.me`
- How it is generated:
  - Pull `https://api.alternative.me/fng/?limit=30&format=json`.
  - Use the latest index value and classification directly.
  - Use the returned historical points for the sparkline series.
- Why we came to this:
  - It is a widely recognized cycle-sentiment overlay and the public API is easy to scrape reliably.
- Improve by:
  - None urgently needed for the prototype; this is already a straightforward public feed.

### HODL Waves (`hodl-waves`)

- Current status: `approx`
- Current source: `BGeometrics derived from age bands`
- How it is generated:
  - Load age-band files `hw_age_1y_2y`, `2y_3y`, `3y_4y`, `4y_8y`, and `8y_`.
  - Sum them into a simplified `1Y+ supply share` scalar.
- Why we came to this:
  - The full HODL Waves visualization is multi-band, but the current card system expects a single value and sparkline.
- Improve by:
  - Rendering the full stacked age-band chart in the expanded view while keeping the card scalar.

### Power Law (`power-law`)

- Current status: `approx`
- Current source: `BGeometrics model`
- How it is generated:
  - Load `power_law.json`, `power_law_floor.json`, and `power_law_top.json`.
  - Compare spot price with the power-law midline, floor, and top band.
  - Display the `spot / power-law midline` ratio.
- Why we came to this:
  - This is a model overlay rather than an on-chain truth metric, so it should stay marked `approx`.
- Improve by:
  - Adding fuller band context in expanded mode and keeping the UI explicit that this is a model.

### Stock-to-Flow (`stock-to-flow`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Pull long `total-bitcoins` history from Blockchain.com.
  - Compute trailing 1-year issuance as the change in circulating supply over 365 days.
  - Compute `stock / annual issuance`.
- Why we came to this:
  - Clean public no-key S2F feeds were either unavailable or protected, while the scarcity ratio itself can be derived transparently from public supply data.
- Main weakness:
  - This is the raw Stock-to-Flow ratio, not a vendor-supplied S2F price model.
  - It should be treated as a scarcity context metric rather than a standalone predictive signal.
- Improve by:
  - Adding a clearly separated S2F model-price overlay only if we can source it transparently and present it with strong caveats.

### Puell Multiple (`puell-multiple`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Pull `miners-revenue`.
  - Compute `current miner revenue / 365D average`.
- Improve by:
  - Replacing with a direct Puell Multiple feed.

## Context / Confirmation

### Active Supply (`active-supply`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Compute `estimated transaction volume BTC / circulating supply * 100`.
- Improve by:
  - Replacing with a dedicated active supply series.

### Active Addresses (`active-addresses`)

- Current status: `scraped`
- Current source: `Blockchain.com`
- How it is generated:
  - Pull `n-unique-addresses`.
- Improve by:
  - Replacing with entity-adjusted addresses if that becomes important.

### CDD (`cdd`)

- Current status: `scraped`
- Current source: `BitInfoCharts derived`
- How it is generated:
  - Read `Days Destroyed / Total Bitcoins` from BitInfoCharts.
  - Multiply by current circulating supply.
- Improve by:
  - Replacing with an exact CDD time series.

### Dormancy (`dormancy`)

- Current status: `approx`
- Current source: `BitInfoCharts derived`
- How it is generated:
  - Compute `CDD / BTC sent in last 24h`.
- Improve by:
  - Replacing with an exact dormancy series.

### Hashrate (`hashrate`)

- Current status: `scraped`
- Current source: `Blockchain.com`
- How it is generated:
  - Pull `hash-rate`.
- Improve by:
  - Adding a second source for resiliency.

### Difficulty (`difficulty`)

- Current status: `scraped`
- Current source: `Blockchain.com + mempool.space`
- How it is generated:
  - Pull current difficulty from Blockchain.com.
  - Pull next adjustment from mempool.space.
- Improve by:
  - Using one documented source for both if consistency becomes important.

### Hash Ribbon (`hash-ribbon`)

- Current status: `approx`
- Current source: `Blockchain.com derived`
- How it is generated:
  - Compute `30D hash rate average / 60D hash rate average`.
- Improve by:
  - Replacing with a direct ribbon or miner-capitulation feed if available.

### NVT Signal (`nvt-signal`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `nvts_bg.json` plus dynamic high and low bands.
  - Compare the latest NVT reading with its public dynamic range.
- Improve by:
  - Storing the mean, high, and low bands together for richer expanded charts.

### SSR (`ssr`)

- Current status: `approx`
- Current source: `CoinGecko proxy`
- How it is generated:
  - Compute `bitcoin market cap / major stablecoin market cap`.
- Improve by:
  - Replacing with a true SSR series from a market-structure provider.

## Macro / Market Structure

### U.S. Dollar Index (`dxy`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `DTWEXBGS`.
- Improve by:
  - Switching to classic ICE DXY if that version is preferred.

### 10Y Real Yield (`10y-real-yield`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `DFII10`.
- Improve by:
  - Adding handling for missing Treasury-market days if desired.

### Fed Rate Expectations / FedWatch (`fed-rate-expectations`)

- Current status: `scraped`
- Current source: `Rate Probability`
- How it is generated:
  - Pull `https://rateprobability.com/api/latest`.
  - Use meeting rows, implied post-meeting rates, and move probabilities.
  - Fall back to the old `DGS1 - DFF` proxy only if the public rate feed is unavailable.
- Improve by:
  - Persisting full returned snapshots in `dashboard-history.json` if we want to compare expectation shifts over time.

### Fed Balance Sheet (`fed-balance-sheet`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `WALCL`.
- Improve by:
  - No urgent change needed.

### ON RRP (`on-rrp`)

- Current status: `scraped`
- Current source: `FRED CSV`
- How it is generated:
  - Pull `RRPTSYD`.
- Improve by:
  - No urgent change needed.

### Funding Rate (`funding-rate`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `funding_rate_7sma.json`.
  - Convert the raw series into a displayed percent.
- Improve by:
  - Adding exchange splits in expanded mode if we want more derivatives detail.

### Open Interest (`open-interest`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `oi_total.json`.
  - Use the aggregated total futures open interest series.
- Improve by:
  - Adding exchange breakdowns from the companion `oi_*` files in expanded mode.

### Spot BTC ETF Flows (`spot-btc-etf-flows`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `flow_btc_etf_btc.json`.
- Improve by:
  - Replacing with a documented ETF API or issuer-level aggregation if we want less brittle sourcing.

### Spot BTC ETF Holdings (`spot-btc-etf-holdings`)

- Current status: `scraped`
- Current source: `BGeometrics`
- How it is generated:
  - Load `total_btc_etf_btc.json`.
- Improve by:
  - Replacing with a documented ETF API or issuer-level aggregation if we want less brittle sourcing.

## Suggested Upgrade Order

1. `exchange-netflow`
   - Highest-value exact-data gap still left in the dashboard.
2. `exchange-balance`
   - Same constraint as exchange netflow; best solved with direct provider data.
3. `lth-nupl`, `sth-nupl`
   - Useful now, but still cohort-derived rather than exact.
4. `asopr`
   - Exact endpoint exists, but free-plan rate limits still force the proxy path sometimes.
5. `lth-net-position-change`, `puell-multiple`, `active-supply`, `dormancy`, `ssr`, `hodl-waves`, `power-law`, `stock-to-flow`, `2-year-ma-multiplier`
  - These are already useful, but they remain derived/model-style implementations rather than direct canonical series.
