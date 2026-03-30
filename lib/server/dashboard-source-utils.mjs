import { createHash } from "node:crypto";
import { loadLocalEnv } from "./load-env.mjs";
import { readSourceCache, writeSourceCache, writeWatermark } from "./dashboard-storage.mjs";

loadLocalEnv();

const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const MEMPOOL_API_BASE = "https://mempool.space/api/v1";
const FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations";
const FEAR_GREED_API = "https://api.alternative.me/fng/?limit=30&format=json";
const BINANCE_FUTURES_API_BASE = "https://fapi.binance.com";
const BYBIT_API_BASE = "https://api.bybit.com";
const OKX_API_BASE = "https://www.okx.com";
const FRED_API_KEY = process.env.FRED_API_KEY;
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
  const trend = inferTrend(latest, previous);

  const higherIsBullish = new Set([
    "adjusted-transfer-volume",
    "active-supply",
    "active-addresses",
    "hashrate",
    "difficulty",
    "hash-ribbon",
    "puell-multiple",
    "stock-to-flow",
  ]);

  const lowerIsBullish = new Set([
    "ssr",
    "nvt-signal",
    "dxy",
    "10y-real-yield",
    "on-rrp",
    "power-law",
  ]);

  if (trend === "flat") {
    return "neutral";
  }

  if (higherIsBullish.has(metricId)) {
    return trend === "up" ? "bullish" : "bearish";
  }

  if (lowerIsBullish.has(metricId)) {
    return trend === "down" ? "bullish" : "bearish";
  }

  return "neutral";
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

export async function fetchFREDSeries(seriesId, options = {}) {
  if (!FRED_API_KEY) {
    return [];
  }

  const url = buildUrl(FRED_API_BASE, {
    series_id: seriesId,
    api_key: FRED_API_KEY,
    file_type: "json",
    sort_order: "asc",
    limit: options.limit ?? 400,
  });
  const payload = await fetchCachedValue(url, {
    cacheKey: `fred:${seriesId}:${options.limit ?? 400}`,
    ttlMs: 24 * 60 * 60 * 1000,
  });

  return toFiniteSeries(
    (payload?.observations ?? [])
      .filter((row) => row.value && row.value !== ".")
      .map((row) => ({
        timestamp: new Date(row.date).getTime(),
        value: Number(row.value),
      })),
  );
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
