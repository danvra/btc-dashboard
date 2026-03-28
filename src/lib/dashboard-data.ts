import { DASHBOARD_METRICS, type DashboardMetric } from "./dashboard-definitions";
import { METRIC_SAMPLES, type MetricSample } from "./dashboard-samples";

export interface DashboardMetricState extends MetricSample {
  isLive: boolean;
  asOf?: number;
  dataMode?: "seeded" | "live" | "scraped" | "approx";
}

export interface DashboardDataSummary {
  btcPrice: string;
  btcPriceChange: string;
  liveMetricCount: number;
  mode: "fallback" | "mixed" | "live";
  warnings: string[];
  lastUpdatedAt?: number;
}

export interface DashboardDataSnapshot {
  metrics: Record<string, DashboardMetricState>;
  summary: DashboardDataSummary;
  meta?: {
    generatedAt?: number;
    nextSuggestedRunAt?: number;
    scheduler?: string;
  };
}

export interface DashboardCachePayload {
  meta?: {
    generatedAt?: number;
    nextSuggestedRunAt?: number;
    scheduler?: string;
  };
  metrics?: Record<string, Partial<DashboardMetricState>>;
  summary?: Partial<DashboardDataSummary>;
}

interface NumericPoint {
  timestamp: number;
  value: number;
}

interface BlockchainChartResponse {
  name: string;
  values: Array<{ x: number; y: number }>;
}

interface CoinGeckoSimplePriceResponse {
  bitcoin?: {
    usd?: number;
    usd_24h_change?: number;
    last_updated_at?: number;
  };
}

interface CoinGeckoMarketAsset {
  id: string;
  market_cap: number;
}

interface FredObservationsResponse {
  observations?: Array<{ date: string; value: string }>;
}

interface RateProbabilityRow {
  meeting?: string;
  meeting_iso?: string;
  implied_rate_post_meeting?: number;
  prob_move_pct?: number;
  prob_is_cut?: number;
  change_bps?: number;
}

interface RateProbabilityPayload {
  today?: {
    as_of?: string;
    midpoint?: number;
    rows?: RateProbabilityRow[];
  };
  rows?: RateProbabilityRow[];
}

interface GlassnodePoint {
  t: number;
  v: number;
}

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const GLASSNODE_API_BASE = "https://api.glassnode.com/v1/metrics";
const FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations";
const BGEOMETRICS_BASE = "https://charts.bgeometrics.com";
const RATE_PROBABILITY_API = "https://rateprobability.com/api/latest";

const GLASSNODE_API_KEY = import.meta.env.VITE_GLASSNODE_API_KEY;
const FRED_API_KEY = import.meta.env.VITE_FRED_API_KEY;

const LIVE_WINDOW_DAYS = 30;

const FALLBACK_METRICS: Record<string, DashboardMetricState> = Object.fromEntries(
  METRIC_SAMPLES.map((sample) => [
    sample.metricId,
    {
      ...sample,
      isLive: false,
      dataMode: "seeded",
    },
  ]),
);

export function buildFallbackSnapshot(): DashboardDataSnapshot {
  const priceSample = FALLBACK_METRICS["price-vs-realized-price"];

  return {
    metrics: { ...FALLBACK_METRICS },
    summary: {
      btcPrice: priceSample.currentValue,
      btcPriceChange: priceSample.deltaLabel,
      liveMetricCount: 0,
      mode: "fallback",
      warnings: ["Using bundled sample data."],
    },
    meta: {
      scheduler: "bundled samples",
    },
  };
}

export function mergeCachePayload(payload: DashboardCachePayload): DashboardDataSnapshot {
  const fallback = buildFallbackSnapshot();
  const mergedMetrics = { ...fallback.metrics };

  for (const [metricId, metric] of Object.entries(payload.metrics ?? {})) {
    if (!mergedMetrics[metricId]) {
      continue;
    }

    mergedMetrics[metricId] = {
      ...mergedMetrics[metricId],
      ...metric,
      metricId,
      series: metric.series ?? mergedMetrics[metricId].series,
      sourceLabel: metric.sourceLabel ?? mergedMetrics[metricId].sourceLabel,
      currentValue: metric.currentValue ?? mergedMetrics[metricId].currentValue,
      deltaLabel: metric.deltaLabel ?? mergedMetrics[metricId].deltaLabel,
      trend: metric.trend ?? mergedMetrics[metricId].trend,
      status: metric.status ?? mergedMetrics[metricId].status,
      isLive: metric.isLive ?? mergedMetrics[metricId].isLive,
      dataMode: metric.dataMode ?? mergedMetrics[metricId].dataMode,
    };
  }

  const liveMetricCount = Object.values(mergedMetrics).filter((metric) => metric.isLive).length;
  const mode =
    liveMetricCount === DASHBOARD_METRICS.length
      ? "live"
      : liveMetricCount > 0
        ? "mixed"
        : "fallback";

  return {
    metrics: mergedMetrics,
    summary: {
      ...fallback.summary,
      ...payload.summary,
      liveMetricCount: payload.summary?.liveMetricCount ?? liveMetricCount,
      mode: payload.summary?.mode ?? mode,
      warnings: payload.summary?.warnings ?? fallback.summary.warnings,
    },
    meta: payload.meta ?? fallback.meta,
  };
}

function formatUsd(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCompactNumber(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function formatSignedPercent(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatRatio(value: number, digits = 2) {
  return value.toFixed(digits);
}

function formatBtc(value: number, digits = 0) {
  return `${formatCompactNumber(value, digits)} BTC`;
}

function formatEh(value: number) {
  return `${formatCompactNumber(value / 1e6, 0)} EH/s`;
}

function formatDifficulty(value: number) {
  return `${formatCompactNumber(value / 1e12, 1)}T`;
}

function toSeries(points: NumericPoint[]) {
  return points.slice(-12).map((point) => point.value);
}

function rollingAverage(points: NumericPoint[], window: number) {
  return points.map((point, index) => {
    const slice = points.slice(Math.max(0, index - window + 1), index + 1);
    const average = slice.reduce((sum, entry) => sum + entry.value, 0) / slice.length;

    return {
      timestamp: point.timestamp,
      value: average,
    };
  });
}

function combineSeries(
  left: NumericPoint[],
  right: NumericPoint[],
  combiner: (leftValue: number, rightValue: number) => number,
) {
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
    .filter((point): point is NumericPoint => point !== null && Number.isFinite(point.value));
}

function normalizePercentValue(value: number | undefined) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue;
}

function lastPoint(points: NumericPoint[]) {
  return points[points.length - 1];
}

function previousPoint(points: NumericPoint[]) {
  return points[points.length - 2] ?? points[points.length - 1];
}

function inferTrend(latest: number, previous: number): MetricSample["trend"] {
  if (Math.abs(latest - previous) < Number.EPSILON) {
    return "flat";
  }

  return latest > previous ? "up" : "down";
}

function inferStatus(metricId: string, latest: number, previous: number): MetricSample["status"] {
  const trend = inferTrend(latest, previous);

  const higherIsBullish = new Set([
    "price-vs-realized-price",
    "asopr",
    "adjusted-transfer-volume",
    "mvrv",
    "pi-cycle-top",
    "percent-supply-in-profit",
    "lth-supply",
    "lth-net-position-change",
    "active-supply",
    "active-addresses",
    "hashrate",
    "hash-ribbon",
    "difficulty",
    "fed-balance-sheet",
    "spot-btc-etf-flows",
    "spot-btc-etf-holdings",
  ]);

  const lowerIsBullish = new Set([
    "exchange-netflow",
    "exchange-balance",
    "sth-supply",
    "reserve-risk",
    "liveliness",
    "ssr",
    "dxy",
    "10y-real-yield",
    "fed-rate-expectations",
    "on-rrp",
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

  return FALLBACK_METRICS[metricId]?.status ?? "neutral";
}

function buildMetricState(
  metricId: DashboardMetric["id"],
  points: NumericPoint[],
  options: {
    currentValue: string;
    deltaLabel: string;
    sourceLabel: string;
    valueDirectionMetric?: string;
    asOf?: number;
    dataMode?: DashboardMetricState["dataMode"];
  },
): DashboardMetricState {
  const latest = lastPoint(points)?.value ?? 0;
  const previous = previousPoint(points)?.value ?? latest;

  return {
    metricId,
    currentValue: options.currentValue,
    deltaLabel: options.deltaLabel,
    trend: inferTrend(latest, previous),
    status: inferStatus(options.valueDirectionMetric ?? metricId, latest, previous),
    series: toSeries(points),
    sourceLabel: options.sourceLabel,
    isLive: true,
    asOf: options.asOf ?? lastPoint(points)?.timestamp,
    dataMode: options.dataMode ?? "live",
  };
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.text();
}

async function fetchRateProbability() {
  return fetchJson<RateProbabilityPayload>(RATE_PROBABILITY_API);
}

async function safePoints(fetcher: () => Promise<NumericPoint[]>) {
  try {
    return await fetcher();
  } catch {
    return [];
  }
}

async function fetchBlockchainChart(path: string, timespan: string) {
  const url = `${BLOCKCHAIN_API_BASE}/${path}?timespan=${timespan}&format=json`;
  const payload = await fetchJson<BlockchainChartResponse>(url);

  return payload.values.map((point) => ({
    timestamp: point.x * 1000,
    value: point.y,
  }));
}

async function fetchCoinGeckoPrice() {
  const url =
    `${COINGECKO_API_BASE}/simple/price?ids=bitcoin&vs_currencies=usd` +
    "&include_24hr_change=true&include_last_updated_at=true";

  return fetchJson<CoinGeckoSimplePriceResponse>(url);
}

async function fetchCoinGeckoMarkets(ids: string[]) {
  const url = `${COINGECKO_API_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}`;
  return fetchJson<CoinGeckoMarketAsset[]>(url);
}

async function fetchFredSeries(seriesId: string) {
  if (FRED_API_KEY) {
    const url =
      `${FRED_API_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}` +
      "&file_type=json&sort_order=asc&limit=90";

    const payload = await fetchJson<FredObservationsResponse>(url);

    return (payload.observations ?? [])
      .filter((observation) => observation.value !== ".")
      .map((observation) => ({
        timestamp: new Date(observation.date).getTime(),
        value: Number(observation.value),
      }));
  }

  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`);
  const lines = csv.trim().split("\n").slice(1);

  return lines
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

async function fetchGlassnodeMetric(
  path: string,
  options?: { currency?: "USD" | "NATIVE"; interval?: "24h" | "1h" },
) {
  if (!GLASSNODE_API_KEY) {
    return null;
  }

  const params = new URLSearchParams({
    a: "BTC",
    api_key: GLASSNODE_API_KEY,
    f: "json",
    i: options?.interval ?? "24h",
    timestamp_format: "unix",
  });

  if (options?.currency) {
    params.set("c", options.currency);
  }

  const url = `${GLASSNODE_API_BASE}/${path}?${params.toString()}`;
  const payload = await fetchJson<GlassnodePoint[]>(url);

  return payload.map((point) => ({
    timestamp: point.t * 1000,
    value: point.v,
  }));
}

async function fetchBGeometricsSeries(path: string) {
  const payload = await fetchJson<Array<[number, number | null]>>(`${BGEOMETRICS_BASE}${path}`);

  return payload
    .filter((point) => Array.isArray(point) && point.length >= 2 && point[1] !== null && Number.isFinite(point[1]))
    .map((point) => ({
      timestamp: Number(point[0]),
      value: Number(point[1]),
    }));
}

async function fetchBGeometricsPlotlySeries(path: string, traceName: string) {
  const html = await fetchText(`${BGEOMETRICS_BASE}${path}`);
  const escapedName = traceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`"name":"${escapedName}","x":(\\[[^\\]]+\\]),"y":(\\[[^\\]]+\\])`));

  if (!match) {
    throw new Error(`Unable to locate Plotly series ${traceName}`);
  }

  const dates = JSON.parse(match[1]) as string[];
  const values = JSON.parse(match[2]) as number[];

  return dates
    .map((date, index) => ({
      timestamp: new Date(date).getTime(),
      value: Number(values[index]),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
}

async function fetchBitcoinDataSeries(path: string, valueKey: string) {
  const payload = await fetchJson<Array<Record<string, number | string | null>>>(`https://bitcoin-data.com${path}`);

  return payload
    .map((point) => ({
      timestamp: Number(point.unixTs) * 1000,
      value: Number(point[valueKey]),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
}

function deriveLaggedDelta(points: NumericPoint[], lag: number) {
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
    .filter((point): point is NumericPoint => point !== null);
}

async function fetchPublicMetrics(metrics: Record<string, DashboardMetricState>) {
  const stablecoinIds = [
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

  const [
    priceSeries,
    longPriceSeries,
    activeAddresses,
    transferVolume,
    hashrate,
    difficulty,
    coingecko,
    markets,
    mvrvSeries,
    minerRevenueSeries,
    percentSupplyInProfitSeries,
    reserveRiskSeries,
    livelinessSeries,
    lthSupplySeries,
    sthSupplySeries,
    etfFlowSeries,
    etfHoldingsSeries,
    asoprSeries,
    soprProxySeries,
    fundingRateSeries,
    rateProbability,
    oneYearTreasury,
    fedFundsEffective,
  ] =
    await Promise.all([
      fetchBlockchainChart("market-price", `${LIVE_WINDOW_DAYS}days`),
      fetchBlockchainChart("market-price", "730days"),
      fetchBlockchainChart("n-unique-addresses", `${LIVE_WINDOW_DAYS}days`),
      fetchBlockchainChart("estimated-transaction-volume-usd", `${LIVE_WINDOW_DAYS}days`),
      fetchBlockchainChart("hash-rate", "90days"),
      fetchBlockchainChart("difficulty", "90days"),
      fetchCoinGeckoPrice(),
      fetchCoinGeckoMarkets(stablecoinIds),
      safePoints(() =>
        fetchJson<BlockchainChartResponse>(
        `${BLOCKCHAIN_API_BASE}/mvrv?timespan=1year&sampled=true&metadata=false&daysAverageString=1d&cors=true&format=json`,
      ).then((payload) =>
          payload.values.map((point) => ({
            timestamp: point.x * 1000,
            value: point.y,
          })),
        ),
      ),
      safePoints(() => fetchBlockchainChart("miners-revenue", "1year")),
      safePoints(() => fetchBGeometricsSeries("/files/profit_loss.json")),
      safePoints(() => fetchBGeometricsSeries("/files/reserve_risk.json")),
      safePoints(() => fetchBGeometricsPlotlySeries("/reports/bitcoin_liveliness_g.html", "Liveliness")),
      safePoints(() => fetchBGeometricsSeries("/files/lth_supply.json")),
      safePoints(() => fetchBGeometricsSeries("/files/sth_supply.json")),
      safePoints(() => fetchBGeometricsSeries("/files/flow_btc_etf_btc.json")),
      safePoints(() => fetchBGeometricsSeries("/files/total_btc_etf_btc.json")),
      safePoints(() => fetchBitcoinDataSeries("/v1/asopr", "asopr")),
      safePoints(() => fetchBGeometricsSeries("/files/sopr_7sma.json")),
      safePoints(() => fetchBGeometricsSeries("/files/funding_rate_7sma.json")),
      fetchRateProbability().catch(() => null),
      safePoints(() => fetchFredSeries("DGS1")),
      safePoints(() => fetchFredSeries("DFF")),
    ]);

  const latestPrice = coingecko.bitcoin?.usd ?? lastPoint(priceSeries)?.value ?? 0;
  const dailyChange = coingecko.bitcoin?.usd_24h_change ?? 0;
  const lastUpdatedAt = (coingecko.bitcoin?.last_updated_at ?? 0) * 1000;
  const lthNetPositionChangeSeries = deriveLaggedDelta(lthSupplySeries, 30);
  const sthNetPositionChangeSeries = deriveLaggedDelta(sthSupplySeries, 1);
  const fedRateExpectationSeries = combineSeries(oneYearTreasury, fedFundsEffective, (dgs1, dff) => dgs1 - dff);
  const effectiveAsoprSeries = asoprSeries.length > 0 ? asoprSeries : soprProxySeries;
  const asoprIsExact = asoprSeries.length > 0;
  const fundingRatePercentSeries = fundingRateSeries.map((point) => ({
    timestamp: point.timestamp,
    value: point.value * 100,
  }));
  const price200DayAverage = rollingAverage(longPriceSeries, 200);
  const price111DayAverage = rollingAverage(longPriceSeries, 111);
  const price350DayAverage = rollingAverage(longPriceSeries, 350);
  const mayerMultipleSeries = longPriceSeries
    .map((point, index) => {
      if (index < 199 || price200DayAverage[index].value <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: point.value / price200DayAverage[index].value,
      };
    })
    .filter((point): point is NumericPoint => point !== null && Number.isFinite(point.value));
  const piCycleTopBufferSeries = longPriceSeries
    .map((point, index) => {
      if (index < 349) {
        return null;
      }

      const triggerLine = price350DayAverage[index].value * 2;

      if (triggerLine <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: ((triggerLine - price111DayAverage[index].value) / triggerLine) * 100,
      };
    })
    .filter((point): point is NumericPoint => point !== null && Number.isFinite(point.value));
  const hashrate30DayAverage = rollingAverage(hashrate, 30);
  const hashrate60DayAverage = rollingAverage(hashrate, 60);
  const hashRibbonSeries = hashrate
    .map((point, index) => {
      if (index < 59 || hashrate60DayAverage[index].value <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: hashrate30DayAverage[index].value / hashrate60DayAverage[index].value,
      };
    })
    .filter((point): point is NumericPoint => point !== null && Number.isFinite(point.value));
  const rateProbabilityRows = (rateProbability?.today?.rows ?? rateProbability?.rows ?? [])
    .map((row) => ({
      ...row,
      timestamp: row.meeting_iso ? new Date(row.meeting_iso).getTime() : Number.NaN,
      impliedRate: Number(row.implied_rate_post_meeting),
    }))
    .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.impliedRate))
    .map((row) => ({
      ...row,
      timestamp: Number(row.timestamp),
      impliedRate: Number(row.impliedRate),
    }));

  const publicUpdates: Record<string, DashboardMetricState> = {
    "active-addresses": buildMetricState("active-addresses", activeAddresses, {
      currentValue: formatCompactNumber(lastPoint(activeAddresses)?.value ?? 0, 0),
      deltaLabel: `${formatPercent(
        (((lastPoint(activeAddresses)?.value ?? 0) - (previousPoint(activeAddresses)?.value ?? 0)) /
          Math.max(previousPoint(activeAddresses)?.value ?? 1, 1)) *
          100,
      )} vs prior day`,
      sourceLabel: "Blockchain.com",
    }),
    "adjusted-transfer-volume": buildMetricState("adjusted-transfer-volume", transferVolume, {
      currentValue: formatUsd(lastPoint(transferVolume)?.value ?? 0, 1),
      deltaLabel: "Estimated on-chain settlement value",
      sourceLabel: "Blockchain.com",
    }),
    hashrate: buildMetricState("hashrate", hashrate, {
      currentValue: formatEh(lastPoint(hashrate)?.value ?? 0),
      deltaLabel: "Estimated network hash rate",
      sourceLabel: "Blockchain.com",
    }),
    difficulty: buildMetricState("difficulty", difficulty, {
      currentValue: formatDifficulty(lastPoint(difficulty)?.value ?? 0),
      deltaLabel: "Current network mining difficulty",
      sourceLabel: "Blockchain.com",
    }),
    "price-vs-realized-price": {
      ...metrics["price-vs-realized-price"],
      currentValue: formatUsd(latestPrice, 0),
      deltaLabel: `Proxy only: BTC spot ${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}% over 24h`,
      trend: dailyChange >= 0 ? "up" : "down",
      status: dailyChange >= 0 ? "bullish" : "bearish",
      series: toSeries(priceSeries),
      sourceLabel: "CoinGecko + Blockchain.com",
      isLive: true,
      asOf: lastUpdatedAt || lastPoint(priceSeries)?.timestamp,
      dataMode: "approx",
    },
  };

  if (effectiveAsoprSeries.length > 0) {
    publicUpdates.asopr = buildMetricState("asopr", effectiveAsoprSeries, {
      currentValue: formatRatio(lastPoint(effectiveAsoprSeries)?.value ?? 0, 3),
      deltaLabel: asoprIsExact ? "Adjusted SOPR" : "SOPR 7D proxy while aSOPR is unavailable",
      sourceLabel: asoprIsExact ? "bitcoin-data.com" : "BGeometrics SOPR proxy",
      dataMode: asoprIsExact ? "scraped" : "approx",
    });
  }

  if (mvrvSeries.length > 0) {
    const latestMvrv = lastPoint(mvrvSeries)?.value ?? 0;
    const realizedPrice = latestMvrv > 0 ? latestPrice / latestMvrv : 0;

    publicUpdates.mvrv = {
      ...metrics.mvrv,
      currentValue: formatRatio(latestMvrv, 2),
      deltaLabel: "Market value to realized value",
      trend: inferTrend(latestMvrv, previousPoint(mvrvSeries)?.value ?? latestMvrv),
      status: inferStatus("mvrv", latestMvrv, previousPoint(mvrvSeries)?.value ?? latestMvrv),
      series: toSeries(mvrvSeries),
      sourceLabel: "Blockchain.com market signals",
      isLive: true,
      asOf: lastPoint(mvrvSeries)?.timestamp,
      dataMode: "scraped",
    };

    publicUpdates["price-vs-realized-price"] = {
      ...publicUpdates["price-vs-realized-price"],
      currentValue: `${formatRatio(latestMvrv, 2)}x`,
      deltaLabel: `Spot ${formatUsd(latestPrice, 0)} vs realized ${formatUsd(realizedPrice, 0)}`,
      trend: inferTrend(latestMvrv, previousPoint(mvrvSeries)?.value ?? latestMvrv),
      status: latestMvrv >= 1 ? "bullish" : "bearish",
      series: toSeries(mvrvSeries),
      sourceLabel: "Blockchain.com market signals",
      isLive: true,
      asOf: lastPoint(mvrvSeries)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (piCycleTopBufferSeries.length > 0) {
    const latestBuffer = lastPoint(piCycleTopBufferSeries)?.value ?? 0;
    const previousBuffer = previousPoint(piCycleTopBufferSeries)?.value ?? latestBuffer;

    publicUpdates["pi-cycle-top"] = {
      ...metrics["pi-cycle-top"],
      currentValue: formatPercent(latestBuffer, 1),
      deltaLabel:
        latestBuffer >= 0
          ? "111DMA buffer to 2x 350DMA"
          : `${formatPercent(Math.abs(latestBuffer), 1)} above Pi trigger`,
      trend: inferTrend(latestBuffer, previousBuffer),
      status: latestBuffer > 25 ? "bullish" : latestBuffer > 10 ? "neutral" : "bearish",
      series: toSeries(piCycleTopBufferSeries),
      sourceLabel: "Blockchain.com derived",
      isLive: true,
      asOf: lastPoint(piCycleTopBufferSeries)?.timestamp,
      dataMode: "approx",
    };
  }

  if (mayerMultipleSeries.length > 0) {
    const latestMayerMultiple = lastPoint(mayerMultipleSeries)?.value ?? 0;
    const previousMayerMultiple = previousPoint(mayerMultipleSeries)?.value ?? latestMayerMultiple;

    publicUpdates["mayer-multiple"] = {
      ...metrics["mayer-multiple"],
      currentValue: formatRatio(latestMayerMultiple, 2),
      deltaLabel: "BTC spot divided by 200D moving average",
      trend: inferTrend(latestMayerMultiple, previousMayerMultiple),
      status:
        latestMayerMultiple > 2.4
          ? "bearish"
          : latestMayerMultiple < 0.8
            ? "bullish"
            : "neutral",
      series: toSeries(mayerMultipleSeries),
      sourceLabel: "Blockchain.com derived",
      isLive: true,
      asOf: lastPoint(mayerMultipleSeries)?.timestamp,
      dataMode: "approx",
    };
  }

  if (minerRevenueSeries.length > 0) {
    const movingAverage = rollingAverage(minerRevenueSeries, 365);
    const puellSeries = minerRevenueSeries.map((point, index) => ({
      timestamp: point.timestamp,
      value: movingAverage[index].value > 0 ? point.value / movingAverage[index].value : 0,
    }));

    publicUpdates["puell-multiple"] = {
      ...metrics["puell-multiple"],
      currentValue: formatRatio(lastPoint(puellSeries)?.value ?? 0, 2),
      deltaLabel: "Miner revenue vs 365D average",
      trend: inferTrend(
        lastPoint(puellSeries)?.value ?? 0,
        previousPoint(puellSeries)?.value ?? lastPoint(puellSeries)?.value ?? 0,
      ),
      status: inferStatus(
        "puell-multiple",
        lastPoint(puellSeries)?.value ?? 0,
        previousPoint(puellSeries)?.value ?? lastPoint(puellSeries)?.value ?? 0,
      ),
      series: toSeries(puellSeries),
      sourceLabel: "Blockchain.com derived",
      isLive: true,
      asOf: lastPoint(puellSeries)?.timestamp,
      dataMode: "approx",
    };
  }

  if (percentSupplyInProfitSeries.length > 0) {
    publicUpdates["percent-supply-in-profit"] = {
      ...metrics["percent-supply-in-profit"],
      currentValue: `${formatRatio(lastPoint(percentSupplyInProfitSeries)?.value ?? 0, 1)}%`,
      deltaLabel: "Percent of BTC supply currently in profit",
      trend: inferTrend(
        lastPoint(percentSupplyInProfitSeries)?.value ?? 0,
        previousPoint(percentSupplyInProfitSeries)?.value ?? lastPoint(percentSupplyInProfitSeries)?.value ?? 0,
      ),
      status: inferStatus(
        "percent-supply-in-profit",
        lastPoint(percentSupplyInProfitSeries)?.value ?? 0,
        previousPoint(percentSupplyInProfitSeries)?.value ?? lastPoint(percentSupplyInProfitSeries)?.value ?? 0,
      ),
      series: toSeries(percentSupplyInProfitSeries),
      sourceLabel: "BGeometrics",
      isLive: true,
      asOf: lastPoint(percentSupplyInProfitSeries)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (reserveRiskSeries.length > 0) {
    publicUpdates["reserve-risk"] = {
      ...metrics["reserve-risk"],
      currentValue: formatRatio(lastPoint(reserveRiskSeries)?.value ?? 0, 4),
      deltaLabel: "Long-term holder opportunity-cost model",
      trend: inferTrend(
        lastPoint(reserveRiskSeries)?.value ?? 0,
        previousPoint(reserveRiskSeries)?.value ?? lastPoint(reserveRiskSeries)?.value ?? 0,
      ),
      status: inferStatus(
        "reserve-risk",
        lastPoint(reserveRiskSeries)?.value ?? 0,
        previousPoint(reserveRiskSeries)?.value ?? lastPoint(reserveRiskSeries)?.value ?? 0,
      ),
      series: toSeries(reserveRiskSeries),
      sourceLabel: "BGeometrics",
      isLive: true,
      asOf: lastPoint(reserveRiskSeries)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (livelinessSeries.length > 0) {
    publicUpdates.liveliness = {
      ...metrics.liveliness,
      currentValue: formatRatio(lastPoint(livelinessSeries)?.value ?? 0, 4),
      deltaLabel: "Old-coin spending vs holding behavior",
      trend: inferTrend(
        lastPoint(livelinessSeries)?.value ?? 0,
        previousPoint(livelinessSeries)?.value ?? lastPoint(livelinessSeries)?.value ?? 0,
      ),
      status: inferStatus(
        "liveliness",
        lastPoint(livelinessSeries)?.value ?? 0,
        previousPoint(livelinessSeries)?.value ?? lastPoint(livelinessSeries)?.value ?? 0,
      ),
      series: toSeries(livelinessSeries),
      sourceLabel: "BGeometrics",
      isLive: true,
      asOf: lastPoint(livelinessSeries)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (hashRibbonSeries.length > 0) {
    const latestHashRibbon = lastPoint(hashRibbonSeries)?.value ?? 0;
    const previousHashRibbon = previousPoint(hashRibbonSeries)?.value ?? latestHashRibbon;

    publicUpdates["hash-ribbon"] = {
      ...metrics["hash-ribbon"],
      currentValue: latestHashRibbon > 1.01 ? "Recovered" : latestHashRibbon < 0.99 ? "Compressed" : "Neutral",
      deltaLabel: `30D / 60D hash rate ratio: ${formatRatio(latestHashRibbon, 3)}`,
      trend: inferTrend(latestHashRibbon, previousHashRibbon),
      status: latestHashRibbon > 1.01 ? "bullish" : latestHashRibbon < 0.99 ? "bearish" : "neutral",
      series: toSeries(hashRibbonSeries),
      sourceLabel: "Blockchain.com derived",
      isLive: true,
      asOf: lastPoint(hashRibbonSeries)?.timestamp,
      dataMode: "approx",
    };
  }

  if (lthSupplySeries.length > 0) {
    publicUpdates["lth-supply"] = buildMetricState("lth-supply", lthSupplySeries, {
      currentValue: formatBtc(lastPoint(lthSupplySeries)?.value ?? 0, 1),
      deltaLabel: "BTC held by long-term holders",
      sourceLabel: "BGeometrics",
      dataMode: "scraped",
    });
  }

  if (sthSupplySeries.length > 0) {
    publicUpdates["sth-supply"] = buildMetricState("sth-supply", sthSupplySeries, {
      currentValue: formatBtc(lastPoint(sthSupplySeries)?.value ?? 0, 1),
      deltaLabel: "BTC held by short-term holders",
      sourceLabel: "BGeometrics",
      dataMode: "scraped",
    });
  }

  if (lthNetPositionChangeSeries.length > 0) {
    publicUpdates["lth-net-position-change"] = buildMetricState(
      "lth-net-position-change",
      lthNetPositionChangeSeries,
      {
        currentValue: formatBtc(lastPoint(lthNetPositionChangeSeries)?.value ?? 0, 1),
        deltaLabel: "Derived 30D change in long-term holder supply",
        sourceLabel: "BGeometrics derived",
        dataMode: "approx",
      },
    );
  }

  if (sthNetPositionChangeSeries.length > 0) {
    publicUpdates["exchange-netflow"] = buildMetricState("exchange-netflow", sthNetPositionChangeSeries, {
      currentValue: formatBtc(lastPoint(sthNetPositionChangeSeries)?.value ?? 0, 1),
      deltaLabel: "STH supply day-over-day proxy for exchange flow",
      sourceLabel: "BGeometrics liquid-supply proxy",
      dataMode: "approx",
    });
  }

  if (sthSupplySeries.length > 0) {
    publicUpdates["exchange-balance"] = buildMetricState("exchange-balance", sthSupplySeries, {
      currentValue: formatBtc(lastPoint(sthSupplySeries)?.value ?? 0, 1),
      deltaLabel: "STH supply proxy for exchange-ready BTC",
      sourceLabel: "BGeometrics liquid-supply proxy",
      dataMode: "approx",
    });
  }

  if (etfFlowSeries.length > 0) {
    publicUpdates["spot-btc-etf-flows"] = buildMetricState("spot-btc-etf-flows", etfFlowSeries, {
      currentValue: formatBtc(lastPoint(etfFlowSeries)?.value ?? 0, 1),
      deltaLabel: "Daily net spot ETF flow",
      sourceLabel: "BGeometrics",
      dataMode: "scraped",
    });
  }

  if (rateProbabilityRows.length > 0) {
    const currentMidpoint = Number(rateProbability?.today?.midpoint ?? lastPoint(fedFundsEffective)?.value ?? 0);
    const nextMeeting = rateProbabilityRows[0];
    const terminalMeeting = rateProbabilityRows[rateProbabilityRows.length - 1];
    const nextChangeBps =
      Number.isFinite(nextMeeting.change_bps) && nextMeeting.change_bps !== undefined
        ? Number(nextMeeting.change_bps)
        : (nextMeeting.impliedRate - currentMidpoint) * 100;
    const cutOdds = normalizePercentValue(nextMeeting.prob_is_cut);
    const moveOdds = normalizePercentValue(nextMeeting.prob_move_pct);
    const currentValue =
      nextChangeBps < 0
        ? `${Math.round(cutOdds || moveOdds)}% cut odds`
        : nextChangeBps > 0
          ? `${Math.round(moveOdds)}% hike odds`
          : "Hold favored";
    const impliedSeries = rateProbabilityRows.map((row) => ({
      timestamp: row.timestamp,
      value: row.impliedRate,
    }));

    publicUpdates["fed-rate-expectations"] = {
      ...metrics["fed-rate-expectations"],
      currentValue,
      deltaLabel: `${nextMeeting.meeting ?? "Next meeting"} | terminal ${formatRatio(terminalMeeting.impliedRate, 2)}%`,
      trend: inferTrend(terminalMeeting.impliedRate, currentMidpoint),
      status:
        terminalMeeting.impliedRate < currentMidpoint - 0.125
          ? "bullish"
          : terminalMeeting.impliedRate > currentMidpoint + 0.125
            ? "bearish"
            : "neutral",
      series: toSeries(impliedSeries),
      sourceLabel: "Rate Probability",
      isLive: true,
      asOf: rateProbability?.today?.as_of ? new Date(rateProbability.today.as_of).getTime() : Date.now(),
      dataMode: "scraped",
    };
  } else if (fedRateExpectationSeries.length > 0) {
    const latestSpread = lastPoint(fedRateExpectationSeries)?.value ?? 0;
    const spreadBps = Math.round(latestSpread * 100);
    const directionLabel =
      spreadBps < 0 ? `${Math.abs(spreadBps)} bps cuts priced` : `${Math.abs(spreadBps)} bps hikes priced`;

    publicUpdates["fed-rate-expectations"] = buildMetricState(
      "fed-rate-expectations",
      fedRateExpectationSeries,
      {
        currentValue: directionLabel,
        deltaLabel: "1Y Treasury minus effective fed funds proxy",
        sourceLabel: "FRED yield-curve proxy",
        dataMode: "approx",
      },
    );
  }

  if (fundingRatePercentSeries.length > 0) {
    const latestFundingRate = lastPoint(fundingRatePercentSeries)?.value ?? 0;
    const previousFundingRate = previousPoint(fundingRatePercentSeries)?.value ?? latestFundingRate;

    publicUpdates["funding-rate"] = {
      ...metrics["funding-rate"],
      currentValue: formatSignedPercent(latestFundingRate, 4),
      deltaLabel: "7D average perpetual funding rate",
      trend: inferTrend(latestFundingRate, previousFundingRate),
      status: latestFundingRate < -0.01 ? "bullish" : latestFundingRate > 0.01 ? "bearish" : "neutral",
      series: toSeries(fundingRatePercentSeries),
      sourceLabel: "BGeometrics",
      isLive: true,
      asOf: lastPoint(fundingRatePercentSeries)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (etfHoldingsSeries.length > 0) {
    publicUpdates["spot-btc-etf-holdings"] = buildMetricState("spot-btc-etf-holdings", etfHoldingsSeries, {
      currentValue: formatBtc(lastPoint(etfHoldingsSeries)?.value ?? 0, 1),
      deltaLabel: "Total BTC held by spot ETFs",
      sourceLabel: "BGeometrics",
      dataMode: "scraped",
    });
  }

  const bitcoinMarketCap = markets.find((asset) => asset.id === "bitcoin")?.market_cap ?? 0;
  const stablecoinMarketCap = markets
    .filter((asset) => asset.id !== "bitcoin")
    .reduce((sum, asset) => sum + (asset.market_cap ?? 0), 0);

  if (bitcoinMarketCap > 0 && stablecoinMarketCap > 0) {
    const ssrValue = bitcoinMarketCap / stablecoinMarketCap;

    publicUpdates.ssr = {
      ...metrics.ssr,
      currentValue: formatRatio(ssrValue, 2),
      deltaLabel: "Approx from major stablecoin market caps",
      trend: "flat",
      status: ssrValue < 10 ? "bullish" : ssrValue < 14 ? "neutral" : "bearish",
      series: metrics.ssr.series,
      sourceLabel: "CoinGecko proxy",
      isLive: true,
      asOf: lastUpdatedAt,
      dataMode: "approx",
    };
  }

  return {
    metrics: {
      ...metrics,
      ...publicUpdates,
    },
    summary: {
      btcPrice: formatUsd(latestPrice, 0),
      btcPriceChange: `${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}% 24h`,
      lastUpdatedAt,
    },
  };
}

async function fetchGlassnodeMetrics(metrics: Record<string, DashboardMetricState>) {
  if (!GLASSNODE_API_KEY) {
    return metrics;
  }

  const [
    realizedPrice,
    asopr,
    exchangeNetflow,
    exchangeBalance,
    adjustedTransferVolume,
    mvrv,
    percentSupplyInProfit,
    lthSupply,
    sthSupply,
    lthNetChange,
    reserveRisk,
    liveliness,
    puellMultiple,
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

  const merged = { ...metrics };

  if (realizedPrice) {
    const livePrice = metrics["price-vs-realized-price"];
    const latestRealized = lastPoint(realizedPrice)?.value ?? 0;
    const latestSpot = Number(livePrice.currentValue.replace(/[$,KMBT]/g, "")) || 0;
    const ratio = latestRealized > 0 && latestSpot > 0 ? latestSpot / latestRealized : 0;

    merged["price-vs-realized-price"] = {
      ...livePrice,
      currentValue: `${ratio.toFixed(2)}x`,
      deltaLabel: `Spot ${livePrice.currentValue} vs realized ${formatUsd(latestRealized, 0)}`,
      status: ratio >= 1 ? "bullish" : "bearish",
      sourceLabel: "Glassnode",
      isLive: true,
      asOf: lastPoint(realizedPrice)?.timestamp,
      dataMode: "live",
    };
  }

  const glassnodeEntries: Array<[DashboardMetric["id"], NumericPoint[] | null, (points: NumericPoint[]) => DashboardMetricState]> =
    [
      [
        "asopr",
        asopr,
        (points) =>
          buildMetricState("asopr", points, {
            currentValue: formatRatio(lastPoint(points)?.value ?? 0),
            deltaLabel: "Adjusted SOPR",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "exchange-netflow",
        exchangeNetflow,
        (points) =>
          buildMetricState("exchange-netflow", points, {
            currentValue: formatBtc(lastPoint(points)?.value ?? 0, 1),
            deltaLabel: "Net exchange flow",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "exchange-balance",
        exchangeBalance,
        (points) =>
          buildMetricState("exchange-balance", points, {
            currentValue: formatBtc(lastPoint(points)?.value ?? 0, 1),
            deltaLabel: "BTC held on exchanges",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "adjusted-transfer-volume",
        adjustedTransferVolume,
        (points) =>
          buildMetricState("adjusted-transfer-volume", points, {
            currentValue: formatUsd(lastPoint(points)?.value ?? 0, 1),
            deltaLabel: "Change-adjusted transfer volume",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "mvrv",
        mvrv,
        (points) =>
          buildMetricState("mvrv", points, {
            currentValue: formatRatio(lastPoint(points)?.value ?? 0),
            deltaLabel: "Market value to realized value",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "percent-supply-in-profit",
        percentSupplyInProfit,
        (points) =>
          buildMetricState("percent-supply-in-profit", points, {
            currentValue: formatPercent((lastPoint(points)?.value ?? 0) * 100),
            deltaLabel: "Circulating supply in profit",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "lth-supply",
        lthSupply,
        (points) =>
          buildMetricState("lth-supply", points, {
            currentValue: formatBtc(lastPoint(points)?.value ?? 0, 1),
            deltaLabel: "Long-term holder supply",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "sth-supply",
        sthSupply,
        (points) =>
          buildMetricState("sth-supply", points, {
            currentValue: formatBtc(lastPoint(points)?.value ?? 0, 1),
            deltaLabel: "Short-term holder supply",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "lth-net-position-change",
        lthNetChange,
        (points) =>
          buildMetricState("lth-net-position-change", points, {
            currentValue: formatBtc(lastPoint(points)?.value ?? 0, 1),
            deltaLabel: "30D long-term holder change",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "reserve-risk",
        reserveRisk,
        (points) =>
          buildMetricState("reserve-risk", points, {
            currentValue: formatRatio(lastPoint(points)?.value ?? 0, 4),
            deltaLabel: "Long-term holder conviction model",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "liveliness",
        liveliness,
        (points) =>
          buildMetricState("liveliness", points, {
            currentValue: formatRatio(lastPoint(points)?.value ?? 0, 2),
            deltaLabel: "Entity-adjusted liveliness",
            sourceLabel: "Glassnode",
          }),
      ],
      [
        "puell-multiple",
        puellMultiple,
        (points) =>
          buildMetricState("puell-multiple", points, {
            currentValue: formatRatio(lastPoint(points)?.value ?? 0, 2),
            deltaLabel: "Miner revenue vs yearly average",
            sourceLabel: "Glassnode",
          }),
      ],
    ];

  for (const [metricId, points, buildState] of glassnodeEntries) {
    if (points?.length) {
      merged[metricId] = buildState(points);
    }
  }

  return merged;
}

async function fetchFredMetrics(metrics: Record<string, DashboardMetricState>) {
  const [dxy, realYield, fedBalanceSheet, onRrp] = await Promise.all([
    fetchFredSeries("DTWEXBGS"),
    fetchFredSeries("DFII10"),
    fetchFredSeries("WALCL"),
    fetchFredSeries("RRPTSYD"),
  ]);

  const merged = { ...metrics };

  if (dxy?.length) {
    merged.dxy = buildMetricState("dxy", dxy, {
      currentValue: formatRatio(lastPoint(dxy)?.value ?? 0, 2),
      deltaLabel: "Trade-weighted dollar index",
      sourceLabel: "FRED",
    });
  }

  if (realYield?.length) {
    merged["10y-real-yield"] = buildMetricState("10y-real-yield", realYield, {
      currentValue: formatPercent(lastPoint(realYield)?.value ?? 0, 2),
      deltaLabel: "10-year inflation-adjusted Treasury yield",
      sourceLabel: "FRED",
    });
  }

  if (fedBalanceSheet?.length) {
    merged["fed-balance-sheet"] = buildMetricState("fed-balance-sheet", fedBalanceSheet, {
      currentValue: formatUsd((lastPoint(fedBalanceSheet)?.value ?? 0) * 1_000_000, 1),
      deltaLabel: "Federal Reserve total assets",
      sourceLabel: "FRED",
      valueDirectionMetric: "fed-balance-sheet",
    });
  }

  if (onRrp?.length) {
    merged["on-rrp"] = buildMetricState("on-rrp", onRrp, {
      currentValue: formatUsd((lastPoint(onRrp)?.value ?? 0) * 1_000_000_000, 1),
      deltaLabel: "Reverse repo usage",
      sourceLabel: "FRED",
      valueDirectionMetric: "on-rrp",
    });
  }

  return merged;
}

function countLiveMetrics(metrics: Record<string, DashboardMetricState>) {
  return Object.values(metrics).filter((metric) => metric.isLive).length;
}

export async function fetchDashboardData(): Promise<DashboardDataSnapshot> {
  const warnings: string[] = [];

  let metrics = { ...FALLBACK_METRICS };
  const publicData = await fetchPublicMetrics(metrics);
  metrics = publicData.metrics;

  if (!GLASSNODE_API_KEY) {
    warnings.push("Exchange Netflow and Exchange Balance currently use approximation proxies.");
  } else {
    metrics = await fetchGlassnodeMetrics(metrics);
  }

  if (metrics["fed-rate-expectations"]?.dataMode === "approx") {
    warnings.push("Fed Rate Expectations fell back to a FRED proxy because the public meeting-probability feed was unavailable.");
  }

  metrics = await fetchFredMetrics(metrics);

  if (!FRED_API_KEY) {
    warnings.push("Macro series are loading from FRED public CSV downloads; adding `VITE_FRED_API_KEY` would let us switch to the official JSON API instead.");
  }

  const liveMetricCount = countLiveMetrics(metrics);
  const mode =
    liveMetricCount === DASHBOARD_METRICS.length
      ? "live"
      : liveMetricCount > 0
        ? "mixed"
        : "fallback";

  return {
    metrics,
    summary: {
      btcPrice: publicData.summary.btcPrice,
      btcPriceChange: publicData.summary.btcPriceChange,
      liveMetricCount,
      mode,
      warnings,
      lastUpdatedAt: publicData.summary.lastUpdatedAt,
    },
    meta: {
      generatedAt: publicData.summary.lastUpdatedAt,
      scheduler: "direct fetch",
    },
  };
}
