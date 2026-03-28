# Expansion Spec 1

This document proposes the next set of BTC dashboard indicators to add beyond the current implementation.

Goal:

- Add indicators that are widely followed in BTC communities.
- Improve cycle-positioning coverage.
- Improve local top / local bottom / leverage context.
- Fit the current app architecture:
  - frontend reads `dashboard-cache.json`
  - updater writes cached snapshots
  - `dashboard-history.json` stores historical points for sparkline and multi-period charts

## Selection Rules

An indicator is worth adding when at least one of these is true:

- It is widely recognized in BTC communities and helps users orient quickly.
- It adds genuinely new information that the current dashboard does not already cover.
- It can be implemented with a realistic public or low-friction source.
- It can be expressed clearly in simple UI copy.

## History Requirement

Every new indicator in this spec should support history, not just a latest value.

Required history behavior:

- If the upstream source already returns a historical series:
  - store the last `180` points in cache or history
  - expose the latest `12` points for the card sparkline
  - preserve the fuller series for expanded charts later
- If the upstream source only returns snapshots:
  - append each successful refresh to `dashboard-history.json`
  - dedupe points within a `30 minute` window
  - cap stored history at `180` points by default
- If the metric is meeting-based rather than time-series-based:
  - store the next `8-12` event points as the chart history
  - also store the current snapshot timestamp so freshness is clear

Implementation standard:

- Add each metric to the cache updater first.
- Persist `dataMode`, `sourceLabel`, `asOf`, `currentValue`, `deltaLabel`, and `series`.
- If the metric is not exact, mark it `approx`.

## Recommended Add Order

1. `FedWatch-style meeting probabilities`
2. `Pi Cycle Top`
3. `Mayer Multiple`
4. `NUPL`
5. `LTH-NUPL`
6. `STH-NUPL`
7. `RHODL Ratio`
8. `HODL Waves`
9. `Open Interest`
10. `Funding Rate`
11. `NVT Signal`
12. `Hash Ribbon`
13. `2-Year MA Multiplier`
14. `Power Law bands`
15. `Stock-to-Flow`

## Tier 1: High Priority

These are the strongest additions for the next iteration.

### 1. FedWatch-style meeting probabilities

- Why add it:
  - Your current `fed-rate-expectations` card is the weakest macro approximation.
  - A true meeting-by-meeting implied rate path is more useful and more recognizable than a yield spread proxy.
- Best data source:
  - Primary: `https://rateprobability.com/api/latest`
  - Fallback: current `FRED yield-curve proxy`
- Current source quality:
  - `rateprobability.com/api/latest` appears publicly readable and includes meeting dates, implied rates, and move probabilities.
- Implementation:
  - Add a new fetcher in the cache updater for the Rate Probability API.
  - Read:
    - `today.as_of`
    - `today.midpoint`
    - `today.rows[]`
    - `rows[].meeting`
    - `rows[].meeting_iso`
    - `rows[].implied_rate_post_meeting`
    - `rows[].prob_move_pct`
    - `rows[].prob_is_cut`
    - `rows[].change_bps`
  - Replace the current `fed-rate-expectations` proxy with:
    - current value: e.g. `16% cut odds`
    - delta label: e.g. `Sep 16, 2026 meeting`
    - series: implied post-meeting rate path for upcoming meetings
  - Mark as `scraped` if the API is stable.
- History:
  - Use the upcoming meeting path itself as the series.
  - Also store the full returned snapshot in history so we can compare how expectations changed day to day later.
- UI placement:
  - Keep in `Macro / Market Structure`
  - Chart type: `step-line`
  - Expanded view should show:
    - implied rate path
    - next meeting probability text
- Risk:
  - Third-party site, not official CME.
  - Still much better than the current proxy.

### 2. Pi Cycle Top

- Why add it:
  - Very recognizable in BTC communities.
  - Easy to compute from price alone.
  - Strong value-to-effort ratio.
- Best data source:
  - Primary: derive from BTC daily price series already in use
  - Source reference: Glassnode tutorial on market tops and bottoms
- Implementation:
  - Pull daily BTC price history.
  - Compute:
    - `111-day SMA`
    - `2 x 350-day SMA`
  - Current value:
    - distance between the two lines, or
    - binary state such as `not crossed` / `crossed`
  - Delta label:
    - `111DMA vs 2x350DMA`
  - Mark as `approx` or `derived`, depending on your naming convention.
- History:
  - Store both moving averages as full series.
  - Card sparkline can use the spread between the two lines.
  - Expanded chart should show both lines over time.
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`
- Risk:
  - Top-focused, not a complete cycle framework.
  - Should not be treated as a standalone signal.

### 3. Mayer Multiple

- Why add it:
  - Simple and popular macro-cycle tool.
  - Easy for non-technical users to understand.
- Best data source:
  - Primary: derive from BTC daily price
  - Formula reference: Glassnode market tops/bottoms tutorial
- Implementation:
  - Compute `price / 200-day moving average`
  - Current value: current multiple
  - Delta label: `Price vs 200DMA`
  - Mark as `approx` / `derived`
- History:
  - Store the full ratio series
  - Use the ratio for sparkline
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`
- Risk:
  - Price-only model, so it overlaps somewhat with Pi Cycle and MVRV
  - Still useful because it is simple and well-known

### 4. NUPL

- Why add it:
  - One of the best cycle-position indicators.
  - Strong complement to `MVRV` and `Percent Supply in Profit`.
- Best data source:
  - Preferred: authenticated provider like Glassnode or BGeometrics API if accessible
  - Fallback: none recommended unless a stable public chart source is found
- Implementation:
  - If a proper public series is found, ingest directly.
  - Avoid inventing a price-only approximation; that would be too lossy.
  - Current value: NUPL reading
  - Delta label: high-level regime such as `capitulation`, `hope`, `belief`, `euphoria` if you want richer UX later
- History:
  - Must use real series history
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`
- Risk:
  - Data availability is the main blocker

### 5. LTH-NUPL

- Why add it:
  - Excellent smart-money / conviction-holder read.
  - Strong pair with existing `LTH Supply`, `LTH Net Position Change`, and `Reserve Risk`.
- Best data source:
  - Preferred: Glassnode or another provider with cohort-level UTXO metrics
- Implementation:
  - Direct series only
  - No useful approximation recommended
- History:
  - Full historical series required
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`
- Risk:
  - Authenticated provider likely required

### 6. STH-NUPL

- Why add it:
  - Good for showing newer holder sentiment and local stress / froth.
  - Balances LTH-NUPL nicely.
- Best data source:
  - Preferred: Glassnode or equivalent provider
- Implementation:
  - Direct series only
  - No weak proxy recommended
- History:
  - Full historical series required
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`

## Tier 2: Strong Additions

### 7. RHODL Ratio

- Why add it:
  - Very respected BTC cycle tool.
  - Useful for overheating / top-risk framing.
- Best data source:
  - Preferred: Glassnode or another age-distribution provider
- Implementation:
  - Direct series preferred
  - No clean proxy recommended
- History:
  - Historical series required
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`

### 8. HODL Waves

- Why add it:
  - Very intuitive visual for BTC communities.
  - Explains holder behavior better than a single scalar metric.
- Best data source:
  - Preferred: Glassnode or BGeometrics if public age-band series can be found
- Implementation:
  - Store multiple age bands
  - Expanded chart should be stacked area
  - Card could show one simplified scalar:
    - e.g. `old supply share`
    - or `1y+ supply share`
- History:
  - Keep full banded series
- UI placement:
  - `Cycle / Regime`
  - Chart type: `area`
- Risk:
  - More complex to render cleanly than a single-line metric

### 9. Open Interest

- Why add it:
  - Very common in BTC trading communities.
  - Helps identify leverage buildup and squeeze risk.
- Best data source:
  - Preferred: derivatives provider or exchange aggregate source
  - Candidate providers: Glassnode derivatives endpoints, CoinGlass if authenticated access is acceptable
- Implementation:
  - Current value: aggregate BTC open interest
  - Delta label: daily change or `OI as % of market cap`
- History:
  - Direct historical series required
- UI placement:
  - `Macro / Market Structure` or add a future `Derivatives` panel later
  - For now: `Macro / Market Structure`
  - Chart type: `area`

### 10. Funding Rate

- Why add it:
  - Widely watched for crowded long / short conditions.
  - Strong near-term sentiment signal.
- Best data source:
  - Preferred: derivatives provider or exchange aggregate source
  - Candidate providers: BGeometrics chart pages already mention funding rate pages
- Implementation:
  - Current value: aggregate funding rate
  - Delta label: `perpetual futures positioning pressure`
- History:
  - Historical series required
- UI placement:
  - `Macro / Market Structure`
  - Chart type: `line`

### 11. NVT Signal

- Why add it:
  - Adds a valuation-vs-network-usage angle not fully covered today.
- Best data source:
  - Preferred: direct provider metric
  - Fallback:
    - derive from price / transfer volume if methodology is documented and acceptable
- Implementation:
  - If derived, document formula clearly in source metadata and `indicators.md`
- History:
  - Historical series required
- UI placement:
  - `Context / Confirmation`
  - Chart type: `line-with-zones`

### 12. Hash Ribbon

- Why add it:
  - Popular miner capitulation / recovery signal.
  - Nice complement to `Hashrate`, `Difficulty`, and `Puell Multiple`.
- Best data source:
  - Derive from hashrate
- Implementation:
  - Compute short-term and long-term moving averages of hashrate
  - Detect compression / recovery / buy-signal style states
- History:
  - Store both moving averages and optionally a derived signal series
- UI placement:
  - `Context / Confirmation`
  - Chart type: `line-with-zones`

## Tier 3: Nice-to-Have

### 13. 2-Year MA Multiplier

- Why add it:
  - Good longer-cycle framing.
  - Easy to compute from price.
- Best data source:
  - Price history
- Implementation:
  - Compute `2-year moving average`
  - Optionally overlay multiplier bands
- History:
  - Full series and band series
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`

### 14. Power Law Bands

- Why add it:
  - Popular in BTC communities right now.
  - Useful as a model overlay if presented carefully.
- Best data source:
  - Derived from a documented model
- Implementation:
  - Add only as a model-based indicator
  - Must be clearly labeled as a model, not an on-chain metric
- History:
  - Full modeled band series
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line-with-zones`
- Risk:
  - Can mislead if presented as more authoritative than it is

### 15. Stock-to-Flow

- Why add it:
  - Still recognizable in BTC communities
  - Mostly useful as an optional model layer
- Best data source:
  - Derived from supply and issuance
- Implementation:
  - Add only if clearly framed as a scarcity model
- History:
  - Full model history
- UI placement:
  - `Cycle / Regime`
  - Chart type: `line`
- Risk:
  - More controversial than most of the other additions

## Suggested UI Placement Summary

### Cycle / Regime

- `Pi Cycle Top`
- `Mayer Multiple`
- `NUPL`
- `LTH-NUPL`
- `STH-NUPL`
- `RHODL Ratio`
- `HODL Waves`
- `2-Year MA Multiplier`
- `Power Law Bands`
- `Stock-to-Flow`

### Context / Confirmation

- `NVT Signal`
- `Hash Ribbon`

### Macro / Market Structure

- `FedWatch-style meeting probabilities`
- `Open Interest`
- `Funding Rate`

## Data Source Quality Guidance

Preferred order:

1. Exact public API
2. Public chart JSON
3. Public HTML with stable embedded data
4. Derived metric from reliable public raw inputs
5. Proxy approximation

Rules:

- If a metric is derived from exact raw inputs but not identical to the canonical metric, mark it `approx`.
- If a metric is model-based, label it explicitly as a model.
- If a metric is visually popular but methodologically weak, keep it optional.

## Implementation Template For Each New Metric

For each metric added:

- Add dashboard definition entry
- Add tooltip copy
- Add learn-more copy
- Add cache updater fetch / derive logic
- Add `dataMode`, `sourceLabel`, `asOf`, `currentValue`, `deltaLabel`, `series`
- Add history persistence rules
- Add warning text if the metric is `approx`
- Add `indicators.md` entry

## Recommendation

If we build the next batch immediately, the best sequence is:

1. Replace `fed-rate-expectations` with Rate Probability meeting data
2. Add `Pi Cycle Top`
3. Add `Mayer Multiple`
4. Add `Open Interest`
5. Add `Funding Rate`
6. Add `Hash Ribbon`
7. Add `NUPL` family once a reliable source is secured

This order gives the best balance between:

- user recognition
- implementation effort
- cycle usefulness
- availability of historical series
