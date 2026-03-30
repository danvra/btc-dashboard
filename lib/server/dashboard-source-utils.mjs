const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const MEMPOOL_API_BASE = "https://mempool.space/api/v1";
const FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations";
const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const GLASSNODE_API_BASE = "https://api.glassnode.com/v1/metrics";
const BGEOMETRICS_BASE = "https://charts.bgeometrics.com";
const RATE_PROBABILITY_API = "https://rateprobability.com/api/latest";
const FEAR_GREED_API = "https://api.alternative.me/fng/?limit=30&format=json";
const FRED_API_KEY = process.env.FRED_API_KEY;
const GLASSNODE_API_KEY = process.env.GLASSNODE_API_KEY;

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
  const trend = inferTrend(latest, previous);

  const higherIsBullish = new Set([
    "price-vs-realized-price",
    "asopr",
    "adjusted-transfer-volume",
    "active-supply",
    "active-addresses",
    "mvrv",
    "pi-cycle-top",
    "stock-to-flow",
    "percent-supply-in-profit",
    "lth-supply",
    "lth-net-position-change",
    "hodl-waves",
    "hashrate",
    "hash-ribbon",
    "difficulty",
    "fed-balance-sheet",
    "puell-multiple",
    "spot-btc-etf-flows",
    "spot-btc-etf-holdings",
  ]);

  const lowerIsBullish = new Set([
    "cdd",
    "dormancy",
    "exchange-netflow",
    "exchange-balance",
    "sth-supply",
    "reserve-risk",
    "liveliness",
    "ssr",
    "dxy",
    "10y-real-yield",
    "2-year-ma-multiplier",
    "nvt-signal",
    "fed-rate-expectations",
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

export function toSeries(points) {
  return (points ?? []).slice(-12).map((point) => point.value);
}

export function rollingAverage(points, window) {
  return points.map((point, index) => {
    const slice = points.slice(Math.max(0, index - window + 1), index + 1);
    const average = slice.reduce((sum, entry) => sum + entry.value, 0) / slice.length;

    return {
      timestamp: point.timestamp,
      value: average,
    };
  });
}

export function combineSeries(left, right, combiner) {
  const rightMap = new Map(right.map((point) => [point.timestamp, point.value]));

  return left
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
    for (const point of series) {
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

export function buildMetric(metricId, points, currentValue, deltaLabel, sourceLabel, options = {}) {
  const latest = points.at(-1)?.value ?? 0;
  const previous = points.at(-2)?.value ?? latest;

  return {
    metricId,
    currentValue,
    deltaLabel,
    sourceLabel,
    trend: options.trend ?? inferTrend(latest, previous),
    status: options.status ?? inferStatus(metricId, latest, previous),
    series: options.series ?? toSeries(points),
    isLive: true,
    asOf: options.asOf ?? points.at(-1)?.timestamp ?? Date.now(),
    dataMode: options.dataMode ?? "scraped",
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "btc-dashboard-prototype/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "btc-dashboard-prototype/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.text();
}

export async function safePoints(fetcher) {
  try {
    return await fetcher();
  } catch {
    return [];
  }
}

export async function fetchCoinGeckoPrice() {
  return fetchJson(
    `${COINGECKO_API_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
  );
}

export async function fetchCoinGeckoMarkets(ids = STABLECOIN_MARKET_IDS) {
  return fetchJson(`${COINGECKO_API_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}`);
}

export async function fetchMempoolDifficulty() {
  return fetchJson(`${MEMPOOL_API_BASE}/difficulty-adjustment`);
}

export async function fetchRateProbability() {
  return fetchJson(RATE_PROBABILITY_API);
}

export async function fetchFearAndGreedIndex() {
  const payload = await fetchJson(FEAR_GREED_API);

  return (payload.data ?? [])
    .map((point) => ({
      timestamp: Number(point.timestamp) * 1000,
      value: Number(point.value),
      classification: point.value_classification ?? "",
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export async function fetchBlockchainChart(chart, timespan) {
  const payload = await fetchJson(`${BLOCKCHAIN_API_BASE}/${chart}?timespan=${timespan}&format=json`);
  return payload.values.map((point) => ({
    timestamp: point.x * 1000,
    value: point.y,
  }));
}

export async function fetchBlockchainMvrvSeries() {
  const payload = await fetchJson(
    `${BLOCKCHAIN_API_BASE}/mvrv?timespan=10years&sampled=true&metadata=false&daysAverageString=1d&cors=true&format=json`,
  );

  return (payload.values ?? []).map((point) => ({
    timestamp: point.x * 1000,
    value: point.y,
  }));
}

export async function fetchBGeometricsSeries(path) {
  const payload = await fetchJson(`${BGEOMETRICS_BASE}${path}`);
  return payload
    .filter((point) => Array.isArray(point) && point.length >= 2 && point[1] !== null && Number.isFinite(point[1]))
    .map((point) => ({
      timestamp: Number(point[0]),
      value: Number(point[1]),
    }));
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
  const html = await fetchText(`${BGEOMETRICS_BASE}${path}`);
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

  return dates
    .map((date, index) => ({
      timestamp: new Date(date).getTime(),
      value: Number(values[index]),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
}

export async function fetchBitcoinDataSeries(path, valueKey) {
  const payload = await fetchJson(`https://bitcoin-data.com${path}`);
  return payload
    .map((point) => ({
      timestamp: Number(point.unixTs) * 1000,
      value: Number(point[valueKey]),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
}

export async function fetchFREDSeries(seriesId) {
  if (FRED_API_KEY) {
    const payload = await fetchJson(
      `${FRED_API_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&limit=90`,
    );

    return (payload.observations ?? [])
      .filter((row) => row.value && row.value !== ".")
      .map((row) => ({
        timestamp: new Date(row.date).getTime(),
        value: Number(row.value),
      }))
      .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.value));
  }

  const csv = await fetchText(`${FRED_CSV_BASE}?id=${seriesId}`);
  return csv
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
    .slice(-90)
    .map((row) => ({
      timestamp: row.timestamp,
      value: Number(row.value),
    }));
}

export async function fetchGlassnodeMetric(path, options = {}) {
  if (!GLASSNODE_API_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    a: "BTC",
    api_key: GLASSNODE_API_KEY,
    f: "json",
    i: options.interval ?? "24h",
    timestamp_format: "unix",
  });

  if (options.currency) {
    params.set("c", options.currency);
  }

  const payload = await fetchJson(`${GLASSNODE_API_BASE}/${path}?${params.toString()}`);

  return (payload ?? [])
    .map((point) => ({
      timestamp: Number(point.t) * 1000,
      value: Number(point.v),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
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

export function deriveLaggedDelta(points, lag) {
  return points
    .map((point, index) => {
      const baseline = points[Math.max(0, index - lag)]?.value;

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
  const html = await fetchText("https://bitinfocharts.com/bitcoin/");

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
