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

interface GlassnodePoint {
  t: number;
  v: number;
}

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const GLASSNODE_API_BASE = "https://api.glassnode.com/v1/metrics";
const FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations";

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
    "percent-supply-in-profit",
    "lth-supply",
    "lth-net-position-change",
    "active-supply",
    "active-addresses",
    "hashrate",
    "difficulty",
    "spot-btc-etf-flows",
    "spot-btc-etf-holdings",
  ]);

  const lowerIsBullish = new Set([
    "exchange-netflow",
    "exchange-balance",
    "reserve-risk",
    "liveliness",
    "ssr",
    "dxy",
    "10y-real-yield",
    "fed-balance-sheet",
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
    dataMode: "live",
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

  const [priceSeries, activeAddresses, transferVolume, hashrate, difficulty, coingecko, markets] =
    await Promise.all([
      fetchBlockchainChart("market-price", `${LIVE_WINDOW_DAYS}days`),
      fetchBlockchainChart("n-unique-addresses", `${LIVE_WINDOW_DAYS}days`),
      fetchBlockchainChart("estimated-transaction-volume-usd", `${LIVE_WINDOW_DAYS}days`),
      fetchBlockchainChart("hash-rate", "90days"),
      fetchBlockchainChart("difficulty", "90days"),
      fetchCoinGeckoPrice(),
      fetchCoinGeckoMarkets(stablecoinIds),
    ]);

  const latestPrice = coingecko.bitcoin?.usd ?? lastPoint(priceSeries)?.value ?? 0;
  const dailyChange = coingecko.bitcoin?.usd_24h_change ?? 0;
  const lastUpdatedAt = (coingecko.bitcoin?.last_updated_at ?? 0) * 1000;

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
    warnings.push("Advanced on-chain metrics are using seeded placeholders until `VITE_GLASSNODE_API_KEY` is set.");
  } else {
    metrics = await fetchGlassnodeMetrics(metrics);
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
