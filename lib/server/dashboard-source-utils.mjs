import { createHash } from "node:crypto";
import { loadLocalEnv } from "./load-env.mjs";
import { readSourceCache, writeSourceCache, writeWatermark } from "./dashboard-storage.mjs";
import { evaluateMetricStatus } from "./dashboard-status-rules.mjs";

loadLocalEnv();

const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const MEMPOOL_API_BASE = "https://mempool.space/api/v1";
const FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations";
const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const GLASSNODE_API_BASE = "https://api.glassnode.com/v1/metrics";
const BGEOMETRICS_BASE = "https://charts.bgeometrics.com";
const RATE_PROBABILITY_API = "https://rateprobability.com/api/latest";
const FEAR_GREED_API = "https://api.alternative.me/fng/?limit=30&format=json";
const BINANCE_FUTURES_API_BASE = "https://fapi.binance.com";
const BYBIT_API_BASE = "https://api.bybit.com";
const OKX_API_BASE = "https://www.okx.com";
const FRED_API_KEY = process.env.FRED_API_KEY;
const GLASSNODE_API_KEY = process.env.GLASSNODE_API_KEY;
const COINGECKO_API_KEY =
  process.env.COINGECKO_DEMO_API_KEY ??
  process.env.COINGECKO_API_KEY ??
  process.env.X_CG_DEMO_API_KEY ??
  process.env.x_cg_demo_api_key ??
  "";

const STABLECOIN_MARKET_IDS = [
  "bitcoin",
  "tether",
  "usd-coin",
  "ethena-usde",
  "dai",
  "first-digital-usd",
  "usds",
  "paypal-usd",
  "frax",
  "usdd",
];

function toCacheKey(label) {
  return createHash("sha1").update(label).digest("hex");
}

function buildUrl(url, params = {}) {
  const nextUrl = new URL(url);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    nextUrl.searchParams.set(key, String(value));
  }

  return nextUrl.toString();
}

async function fetchCachedValue(url, options = {}) {
  const cacheKey = toCacheKey(options.cacheKey ?? url);
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const parser = options.parser ?? "json";
  const cached = ttlMs > 0 ? await readSourceCache(cacheKey) : null;

  if (cached !== null) {
    return cached;
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "btc-dashboard/connector-refactor",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  const payload = parser === "text" ? await response.text() : await response.json();

  if (ttlMs > 0) {
    await Promise.all([
      writeSourceCache(cacheKey, payload, ttlMs),
      writeWatermark(`source:${cacheKey}`, {
        url,
        cacheKey: options.cacheKey ?? url,
        lastSuccessfulFetchAt: Date.now(),
        ttlMs,
      }),
    ]);
  }

  return payload;
}

function getCoinGeckoHeaders() {
  if (!COINGECKO_API_KEY) {
    return {};
  }

  return {
    "x-cg-demo-api-key": COINGECKO_API_KEY,
  };
}

function toFiniteSeries(points) {
  return (points ?? [])
    .filter((point) => Number.isFinite(point?.timestamp) && Number.isFinite(point?.value))
    .map((point) => ({
      timestamp: Number(point.timestamp),
      value: Number(point.value),
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function bucketTimestamp(timestamp, bucketMs) {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

export function formatUsd(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompact(value, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatUnsignedPercent(value, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

export function formatRatio(value, digits = 2) {
  return value.toFixed(digits);
}

export function formatBtc(value, digits = 1) {
  return `${formatCompact(value, digits)} BTC`;
}

export function formatBtcDays(value, digits = 1) {
  return `${formatCompact(value, digits)} BTC-days`;
}

export function formatEhFromTh(value) {
  return `${formatCompact(value / 1_000_000, 0)} EH/s`;
}

export function formatDifficulty(value) {
  return `${formatCompact(value / 1e12, 1)}T`;
}

export function inferTrend(latest, previous) {
  if (Math.abs(latest - previous) < Number.EPSILON) {
    return "flat";
  }

  return latest > previous ? "up" : "down";
}

export function inferStatus(metricId, latest, previous) {
  return evaluateMetricStatus(metricId, latest, previous);
}

export function toSeries(points, maxPoints = 12) {
  return (points ?? []).slice(-maxPoints).map((point) => point.value);
}

export function rollingAverage(points, window) {
  return toFiniteSeries(points).map((point, index, series) => {
    const slice = series.slice(Math.max(0, index - window + 1), index + 1);
    const average = slice.reduce((sum, entry) => sum + entry.value, 0) / slice.length;

    return {
      timestamp: point.timestamp,
      value: average,
    };
  });
}

export function combineSeries(left, right, combiner) {
  const rightMap = new Map(toFiniteSeries(right).map((point) => [point.timestamp, point.value]));

  return toFiniteSeries(left)
    .map((point) => {
      const rightValue = rightMap.get(point.timestamp);

      if (!Number.isFinite(rightValue)) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: combiner(point.value, Number(rightValue)),
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
}

export function sumSeries(seriesList) {
  if (seriesList.length === 0) {
    return [];
  }

  const timestampMap = new Map();

  for (const series of seriesList) {
    for (const point of toFiniteSeries(series)) {
      timestampMap.set(point.timestamp, (timestampMap.get(point.timestamp) ?? 0) + point.value);
    }
  }

  return Array.from(timestampMap.entries())
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function normalizePercentValue(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.abs(value) <= 1 ? Number(value) * 100 : Number(value);
}

export function deriveLaggedDelta(points, lag) {
  return toFiniteSeries(points)
    .map((point, index, normalized) => {
      const baseline = normalized[Math.max(0, index - lag)]?.value;

      if (!Number.isFinite(baseline)) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: point.value - Number(baseline),
      };
    })
    .filter((point) => point !== null);
}

export function averageSeriesByBucket(seriesList, bucketMs = 8 * 60 * 60 * 1000) {
  const buckets = new Map();

  for (const series of seriesList) {
    for (const point of toFiniteSeries(series)) {
      const key = bucketTimestamp(point.timestamp, bucketMs);
      const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
      bucket.sum += point.value;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
  }

  return Array.from(buckets.entries())
    .map(([timestamp, bucket]) => ({
      timestamp,
      value: bucket.count > 0 ? bucket.sum / bucket.count : 0,
    }))
    .filter((point) => Number.isFinite(point.value))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function alignSeriesDivision(numeratorSeries, denominatorSeries, multiplier = 1) {
  const denominatorMap = new Map(toFiniteSeries(denominatorSeries).map((point) => [point.timestamp, point.value]));

  return toFiniteSeries(numeratorSeries)
    .map((point) => {
      const denominator = denominatorMap.get(point.timestamp);

      if (!Number.isFinite(denominator) || Number(denominator) === 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: (point.value / Number(denominator)) * multiplier,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
}

export function mergeSeries(existingPoints, incomingPoints, maxPoints = 3650) {
  const merged = new Map();

  for (const point of [...toFiniteSeries(existingPoints), ...toFiniteSeries(incomingPoints)]) {
    merged.set(point.timestamp, point);
  }

  return Array.from(merged.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-maxPoints);
}

export function fitPowerLawModel(points) {
  const normalized = toFiniteSeries(points);

  if (normalized.length < 90) {
    return [];
  }

  const originTimestamp = normalized[0].timestamp;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let count = 0;

  for (const point of normalized) {
    const days = Math.max((point.timestamp - originTimestamp) / 86_400_000, 1);
    const x = Math.log10(days);
    const y = Math.log10(Math.max(point.value, 1e-8));

    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    count += 1;
  }

  const denominator = count * sumXX - sumX * sumX;

  if (denominator === 0) {
    return [];
  }

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;

  return normalized.map((point) => {
    const days = Math.max((point.timestamp - originTimestamp) / 86_400_000, 1);
    const predicted = 10 ** (intercept + slope * Math.log10(days));

    return {
      timestamp: point.timestamp,
      value: predicted,
    };
  });
}

export function buildMetric(metricId, points, currentValue, deltaLabel, sourceLabel, options = {}) {
  const normalized = toFiniteSeries(points);
  const latest = normalized.at(-1)?.value ?? 0;
  const previous = normalized.at(-2)?.value ?? latest;

  return {
    metricId,
    currentValue,
    deltaLabel,
    sourceLabel,
    trend: options.trend ?? inferTrend(latest, previous),
    status: options.status ?? inferStatus(metricId, latest, previous),
    series: options.series ?? toSeries(normalized),
    isLive: true,
    asOf: options.asOf ?? normalized.at(-1)?.timestamp ?? Date.now(),
    dataMode: options.dataMode ?? "live",
  };
}

async function fetchText(url, options = {}) {
  return fetchCachedValue(url, {
    ...options,
    parser: "text",
  });
}

export async function safePoints(fetcher) {
  try {
    return await fetcher();
  } catch {
    return [];
  }
}

export async function fetchCoinGeckoPrice() {
  const url = buildUrl(`${COINGECKO_API_BASE}/simple/price`, {
    ids: "bitcoin",
    vs_currencies: "usd",
    include_24hr_change: "true",
    include_last_updated_at: "true",
  });

  return fetchCachedValue(url, {
    cacheKey: "coingecko:simple-price:bitcoin-usd",
    headers: getCoinGeckoHeaders(),
    ttlMs: 5 * 60 * 1000,
  });
}

export async function fetchCoinGeckoMarkets(ids = STABLECOIN_MARKET_IDS) {
  const url = buildUrl(`${COINGECKO_API_BASE}/coins/markets`, {
    vs_currency: "usd",
    ids: ids.join(","),
    per_page: ids.length,
    page: 1,
    sparkline: false,
  });

  return fetchCachedValue(url, {
    cacheKey: `coingecko:markets:${ids.join(",")}`,
    headers: getCoinGeckoHeaders(),
    ttlMs: 10 * 60 * 1000,
  });
}

export async function fetchCoinGeckoMarketChart(days = 3650) {
  const url = buildUrl(`${COINGECKO_API_BASE}/coins/bitcoin/market_chart`, {
    vs_currency: "usd",
    days,
    interval: "daily",
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `coingecko:market-chart:bitcoin:${days}:daily`,
    headers: getCoinGeckoHeaders(),
    ttlMs: days > 365 ? 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000,
  });

  return {
    prices: toFiniteSeries(
      (payload?.prices ?? []).map(([timestamp, value]) => ({
        timestamp,
        value,
      })),
    ),
    marketCaps: toFiniteSeries(
      (payload?.market_caps ?? []).map(([timestamp, value]) => ({
        timestamp,
        value,
      })),
    ),
  };
}

export async function fetchMempoolDifficulty() {
  const url = `${MEMPOOL_API_BASE}/difficulty-adjustment`;
  return fetchCachedValue(url, {
    cacheKey: "mempool:difficulty-adjustment",
    ttlMs: 60 * 60 * 1000,
  });
}

export async function fetchMempoolFees() {
  const url = `${MEMPOOL_API_BASE}/fees/recommended`;
  return fetchCachedValue(url, {
    cacheKey: "mempool:fees-recommended",
    ttlMs: 10 * 60 * 1000,
  });
}

export async function fetchFearAndGreedIndex() {
  const payload = await fetchCachedValue(FEAR_GREED_API, {
    cacheKey: "alternative-me:fng",
    ttlMs: 6 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload?.data ?? []).map((point) => ({
      timestamp: Number(point.timestamp) * 1000,
      value: Number(point.value),
      classification: point.value_classification ?? "",
    })),
  );
}

export async function fetchRateProbability() {
  return fetchCachedValue(RATE_PROBABILITY_API, {
    cacheKey: "rate-probability:latest",
    ttlMs: 6 * 60 * 60 * 1000,
  });
}

export async function fetchBlockchainChart(chart, options = {}) {
  const url = buildUrl(`${BLOCKCHAIN_API_BASE}/${chart}`, {
    timespan: options.timespan ?? "365days",
    sampled: options.sampled ?? "true",
    rollingAverage: options.rollingAverage,
    format: "json",
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `blockchain:${chart}:${options.timespan ?? "365days"}:${options.rollingAverage ?? "none"}`,
    ttlMs: 6 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload?.values ?? []).map((point) => ({
      timestamp: Number(point.x) * 1000,
      value: Number(point.y),
    })),
  );
}

export async function fetchBlockchainMvrvSeries() {
  const url = buildUrl(`${BLOCKCHAIN_API_BASE}/mvrv`, {
    timespan: "10years",
    sampled: "true",
    metadata: "false",
    daysAverageString: "1d",
    cors: "true",
    format: "json",
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: "blockchain:mvrv:10years",
    ttlMs: 6 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload?.values ?? []).map((point) => ({
      timestamp: Number(point.x) * 1000,
      value: Number(point.y),
    })),
  );
}

export async function fetchBGeometricsSeries(path) {
  const payload = await fetchCachedValue(`${BGEOMETRICS_BASE}${path}`, {
    cacheKey: `bgeometrics:json:${path}`,
    ttlMs: 12 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload ?? []).map((point) => ({
      timestamp: Number(point?.[0]),
      value: Number(point?.[1]),
    })),
  );
}

function extractJsonArraySegment(source, startIndex) {
  const openIndex = source.indexOf("[", startIndex);

  if (openIndex === -1) {
    throw new Error("Unable to locate JSON array segment");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }

  throw new Error("Unable to parse JSON array segment");
}

export async function fetchBGeometricsPlotlySeries(path, traceName) {
  const html = await fetchText(`${BGEOMETRICS_BASE}${path}`, {
    cacheKey: `bgeometrics:plotly:${path}:${traceName}`,
    ttlMs: 12 * 60 * 60 * 1000,
  });
  const traceMarker = `"name":${JSON.stringify(traceName)},"x":`;
  const traceIndex = html.indexOf(traceMarker);

  if (traceIndex === -1) {
    throw new Error(`Unable to locate Plotly series ${traceName}`);
  }

  const datesSegment = extractJsonArraySegment(html, traceIndex + traceMarker.length);
  const valuesMarker = ",\"y\":";
  const valuesIndex = html.indexOf(valuesMarker, traceIndex + traceMarker.length + datesSegment.length);

  if (valuesIndex === -1) {
    throw new Error(`Unable to locate Plotly values ${traceName}`);
  }

  const valuesSegment = extractJsonArraySegment(html, valuesIndex + valuesMarker.length);
  const dates = JSON.parse(datesSegment);
  const values = JSON.parse(valuesSegment);

  return toFiniteSeries(
    dates.map((date, index) => ({
      timestamp: new Date(date).getTime(),
      value: Number(values[index]),
    })),
  );
}

export async function fetchBitcoinDataSeries(path, valueKey) {
  const payload = await fetchCachedValue(`https://bitcoin-data.com${path}`, {
    cacheKey: `bitcoin-data:${path}:${valueKey}`,
    ttlMs: 12 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload ?? []).map((point) => ({
      timestamp: Number(point.unixTs) * 1000,
      value: Number(point[valueKey]),
    })),
  );
}

export async function fetchFREDSeries(seriesId, options = {}) {
  const limit = options.limit ?? 400;

  if (FRED_API_KEY) {
    try {
      const url = buildUrl(FRED_API_BASE, {
        series_id: seriesId,
        api_key: FRED_API_KEY,
        file_type: "json",
        sort_order: "asc",
        limit,
      });
      const payload = await fetchCachedValue(url, {
        cacheKey: `fred:json:${seriesId}:${limit}`,
        ttlMs: 24 * 60 * 60 * 1000,
      });

      const apiSeries = toFiniteSeries(
        (payload?.observations ?? [])
          .filter((row) => row.value && row.value !== ".")
          .map((row) => ({
            timestamp: new Date(row.date).getTime(),
            value: Number(row.value),
          })),
      );

      if (apiSeries.length > 0) {
        return apiSeries;
      }
    } catch {
      // Fall back to the public CSV connector when the keyed API is unavailable.
    }
  }

  const csvUrl = buildUrl(FRED_CSV_BASE, {
    id: seriesId,
  });
  const csv = await fetchCachedValue(csvUrl, {
    cacheKey: `fred:csv:${seriesId}:${limit}`,
    ttlMs: 24 * 60 * 60 * 1000,
    parser: "text",
  });

  return toFiniteSeries(
    String(csv)
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const [date, rawValue] = line.split(",");
        return {
          timestamp: new Date(date).getTime(),
          value: rawValue,
        };
      })
      .filter((row) => row.value && row.value !== ".")
      .slice(-limit)
      .map((row) => ({
        timestamp: row.timestamp,
        value: Number(row.value),
      })),
  );
}

export async function fetchGlassnodeMetric(path, options = {}) {
  if (!GLASSNODE_API_KEY) {
    return [];
  }

  const url = buildUrl(`${GLASSNODE_API_BASE}/${path}`, {
    a: "BTC",
    api_key: GLASSNODE_API_KEY,
    f: "json",
    i: options.interval ?? "24h",
    timestamp_format: "unix",
    c: options.currency,
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `glassnode:${path}:${options.currency ?? "native"}:${options.interval ?? "24h"}`,
    ttlMs: 12 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload ?? []).map((point) => ({
      timestamp: Number(point.t) * 1000,
      value: Number(point.v),
    })),
  );
}

export async function fetchGlassnodeMetricsBundle() {
  if (!GLASSNODE_API_KEY) {
    return null;
  }

  const [
    realizedPriceSeries,
    asoprSeries,
    exchangeNetflowSeries,
    exchangeBalanceSeries,
    adjustedTransferVolumeSeries,
    mvrvSeries,
    percentSupplyInProfitSeries,
    lthSupplySeries,
    sthSupplySeries,
    lthNetPositionChangeSeries,
    reserveRiskSeries,
    livelinessSeries,
    puellMultipleSeries,
  ] = await Promise.all([
    fetchGlassnodeMetric("market/price_realized_usd", { currency: "USD" }),
    fetchGlassnodeMetric("indicators/sopr_adjusted"),
    fetchGlassnodeMetric("transactions/transfers_volume_exchanges_net"),
    fetchGlassnodeMetric("distribution/balance_exchanges", { currency: "NATIVE" }),
    fetchGlassnodeMetric("transactions/transfers_volume_adjusted_sum", { currency: "USD" }),
    fetchGlassnodeMetric("market/mvrv"),
    fetchGlassnodeMetric("supply/profit_relative"),
    fetchGlassnodeMetric("supply/lth_sum", { currency: "NATIVE" }),
    fetchGlassnodeMetric("supply/sth_sum", { currency: "NATIVE" }),
    fetchGlassnodeMetric("supply/lth_net_change", { currency: "NATIVE" }),
    fetchGlassnodeMetric("indicators/reserve_risk"),
    fetchGlassnodeMetric("indicators/liveliness_account_based"),
    fetchGlassnodeMetric("indicators/puell_multiple"),
  ]);

  return {
    realizedPriceSeries,
    asoprSeries,
    exchangeNetflowSeries,
    exchangeBalanceSeries,
    adjustedTransferVolumeSeries,
    mvrvSeries,
    percentSupplyInProfitSeries,
    lthSupplySeries,
    sthSupplySeries,
    lthNetPositionChangeSeries,
    reserveRiskSeries,
    livelinessSeries,
    puellMultipleSeries,
  };
}

function parseFirstNumber(value) {
  if (!value) {
    return null;
  }

  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractBitInfoValue(html, pattern) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

export async function fetchBitInfoSnapshot() {
  const html = await fetchText("https://bitinfocharts.com/bitcoin/", {
    cacheKey: "bitinfocharts:bitcoin:snapshot",
    ttlMs: 12 * 60 * 60 * 1000,
  });

  const daysDestroyedPerBtc = parseFirstNumber(
    extractBitInfoValue(
      html,
      /Days Destroyed[\s\S]{0,500}?Total Bitcoins\s*<\/td>\s*<td[^>]*>\s*([^<]+)/i,
    ),
  );

  const bitcoinsSent24h = parseFirstNumber(
    extractBitInfoValue(
      html,
      /Bitcoins sent<\/a>\s*last 24h<\/td>\s*<td[^>]*>\s*(?:<span[^>]*>)?([^<]+)/i,
    ),
  );

  return {
    daysDestroyedPerBtc,
    bitcoinsSent24h,
  };
}

export async function fetchBinanceFundingHistory(limit = 60) {
  const url = buildUrl(`${BINANCE_FUTURES_API_BASE}/fapi/v1/fundingRate`, {
    symbol: "BTCUSDT",
    limit,
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `binance:funding-history:${limit}`,
    ttlMs: 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload ?? []).map((point) => ({
      timestamp: Number(point.fundingTime),
      value: Number(point.fundingRate) * 100,
    })),
  );
}

export async function fetchBybitFundingHistory(limit = 60) {
  const url = buildUrl(`${BYBIT_API_BASE}/v5/market/funding/history`, {
    category: "linear",
    symbol: "BTCUSDT",
    limit,
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `bybit:funding-history:${limit}`,
    ttlMs: 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload?.result?.list ?? []).map((point) => ({
      timestamp: Number(point.fundingRateTimestamp),
      value: Number(point.fundingRate) * 100,
    })),
  );
}

export async function fetchOkxFundingHistory(limit = 60) {
  const url = buildUrl(`${OKX_API_BASE}/api/v5/public/funding-rate-history`, {
    instId: "BTC-USDT-SWAP",
    limit,
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `okx:funding-history:${limit}`,
    ttlMs: 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload?.data ?? []).map((point) => ({
      timestamp: Number(point.fundingTime ?? point.ts),
      value: Number(point.fundingRate) * 100,
    })),
  );
}

export async function fetchBinanceOpenInterest() {
  const url = buildUrl(`${BINANCE_FUTURES_API_BASE}/fapi/v1/openInterest`, {
    symbol: "BTCUSDT",
  });

  return fetchCachedValue(url, {
    cacheKey: "binance:open-interest:btcusdt",
    ttlMs: 15 * 60 * 1000,
  });
}
