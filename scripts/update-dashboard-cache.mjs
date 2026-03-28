import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const cacheFile = path.join(publicDir, "dashboard-cache.json");

const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const MEMPOOL_API_BASE = "https://mempool.space/api/v1";
const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";

const jitterMinutes = 55 + Math.floor(Math.random() * 11);

function formatUsd(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCompact(value, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatRatio(value, digits = 2) {
  return value.toFixed(digits);
}

function formatBtc(value, digits = 1) {
  return `${formatCompact(value, digits)} BTC`;
}

function formatEhFromTh(value) {
  return `${formatCompact(value / 1_000_000, 0)} EH/s`;
}

function formatDifficulty(value) {
  return `${formatCompact(value / 1e12, 1)}T`;
}

function inferTrend(latest, previous) {
  if (Math.abs(latest - previous) < Number.EPSILON) {
    return "flat";
  }

  return latest > previous ? "up" : "down";
}

function inferStatus(metricId, latest, previous) {
  const trend = inferTrend(latest, previous);

  const higherIsBullish = new Set([
    "price-vs-realized-price",
    "adjusted-transfer-volume",
    "active-addresses",
    "hashrate",
    "difficulty",
    "spot-btc-etf-flows",
    "spot-btc-etf-holdings",
  ]);

  const lowerIsBullish = new Set([
    "dxy",
    "10y-real-yield",
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

  return "neutral";
}

function toSeries(points) {
  return points.slice(-12).map((point) => point.value);
}

function buildMetric(metricId, points, currentValue, deltaLabel, sourceLabel) {
  const latest = points.at(-1)?.value ?? 0;
  const previous = points.at(-2)?.value ?? latest;

  return {
    metricId,
    currentValue,
    deltaLabel,
    sourceLabel,
    trend: inferTrend(latest, previous),
    status: inferStatus(metricId, latest, previous),
    series: toSeries(points),
    isLive: true,
    asOf: points.at(-1)?.timestamp ?? Date.now(),
    dataMode: "scraped",
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

async function fetchBlockchainChart(chart, timespan) {
  const payload = await fetchJson(`${BLOCKCHAIN_API_BASE}/${chart}?timespan=${timespan}&format=json`);
  return payload.values.map((point) => ({
    timestamp: point.x * 1000,
    value: point.y,
  }));
}

async function fetchFREDSeries(seriesId) {
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

async function readExistingCache() {
  try {
    const existing = await readFile(cacheFile, "utf8");
    return JSON.parse(existing);
  } catch {
    return {
      meta: {},
      summary: {},
      metrics: {},
    };
  }
}

export async function updateDashboardCache() {
  const existing = await readExistingCache();
  const warnings = [
    "Prototype mode: several advanced on-chain metrics still use seeded placeholders until we add scrape recipes for them.",
    "ETF flows and holdings are still placeholders because the easy public source tested here is protected by anti-bot checks.",
  ];

  const [
    priceSeries,
    activeAddresses,
    transferVolume,
    hashrate,
    difficulty,
    coingecko,
    mempoolDifficulty,
    markets,
    dxy,
    realYield,
    fedBalanceSheet,
    onRrp,
  ] = await Promise.all([
    fetchBlockchainChart("market-price", "30days"),
    fetchBlockchainChart("n-unique-addresses", "30days"),
    fetchBlockchainChart("estimated-transaction-volume-usd", "30days"),
    fetchBlockchainChart("hash-rate", "90days"),
    fetchBlockchainChart("difficulty", "90days"),
    fetchJson(
      `${COINGECKO_API_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
    ),
    fetchJson(`${MEMPOOL_API_BASE}/difficulty-adjustment`),
    fetchJson(
      `${COINGECKO_API_BASE}/coins/markets?vs_currency=usd&ids=bitcoin,tether,usd-coin,ethena-usde,dai,first-digital-usd,usds,paypal-usd,frax,usdd`,
    ),
    fetchFREDSeries("DTWEXBGS"),
    fetchFREDSeries("DFII10"),
    fetchFREDSeries("WALCL"),
    fetchFREDSeries("RRPTSYD"),
  ]);

  const btcPrice = coingecko?.bitcoin?.usd ?? priceSeries.at(-1)?.value ?? 0;
  const btcChange = coingecko?.bitcoin?.usd_24h_change ?? 0;
  const bitcoinMarketCap = markets.find((asset) => asset.id === "bitcoin")?.market_cap ?? 0;
  const stablecoinMarketCap = markets
    .filter((asset) => asset.id !== "bitcoin")
    .reduce((sum, asset) => sum + (asset.market_cap ?? 0), 0);
  const ssrValue = bitcoinMarketCap > 0 && stablecoinMarketCap > 0 ? bitcoinMarketCap / stablecoinMarketCap : null;

  const metrics = {
    ...(existing.metrics ?? {}),
    "price-vs-realized-price": {
      metricId: "price-vs-realized-price",
      currentValue: formatUsd(btcPrice, 0),
      deltaLabel: `Proxy only: BTC spot ${formatPercent(btcChange)} over 24h`,
      sourceLabel: "CoinGecko proxy",
      trend: btcChange >= 0 ? "up" : "down",
      status: btcChange >= 0 ? "bullish" : "bearish",
      series: toSeries(priceSeries),
      isLive: true,
      asOf: (coingecko?.bitcoin?.last_updated_at ?? 0) * 1000,
      dataMode: "approx",
    },
    "adjusted-transfer-volume": buildMetric(
      "adjusted-transfer-volume",
      transferVolume,
      formatUsd(transferVolume.at(-1)?.value ?? 0, 1),
      "Estimated on-chain transfer value",
      "Blockchain.com",
    ),
    "active-addresses": buildMetric(
      "active-addresses",
      activeAddresses,
      formatCompact(activeAddresses.at(-1)?.value ?? 0, 0),
      "Unique active addresses",
      "Blockchain.com",
    ),
    hashrate: buildMetric(
      "hashrate",
      hashrate,
      formatEhFromTh(hashrate.at(-1)?.value ?? 0),
      "Estimated network hash rate",
      "Blockchain.com",
    ),
    difficulty: buildMetric(
      "difficulty",
      difficulty,
      formatDifficulty(difficulty.at(-1)?.value ?? 0),
      `Next adjustment ${formatPercent(mempoolDifficulty?.difficultyChange ?? 0)}`,
      "Blockchain.com + mempool.space",
    ),
    dxy: buildMetric(
      "dxy",
      dxy,
      formatRatio(dxy.at(-1)?.value ?? 0, 2),
      "Broad dollar index",
      "FRED CSV",
    ),
    "10y-real-yield": buildMetric(
      "10y-real-yield",
      realYield,
      `${formatRatio(realYield.at(-1)?.value ?? 0, 2)}%`,
      "10Y inflation-adjusted Treasury yield",
      "FRED CSV",
    ),
    "fed-balance-sheet": buildMetric(
      "fed-balance-sheet",
      fedBalanceSheet,
      formatUsd((fedBalanceSheet.at(-1)?.value ?? 0) * 1_000_000, 1),
      "Federal Reserve total assets",
      "FRED CSV",
    ),
    "on-rrp": buildMetric(
      "on-rrp",
      onRrp,
      formatUsd((onRrp.at(-1)?.value ?? 0) * 1_000_000_000, 1),
      "Overnight reverse repo usage",
      "FRED CSV",
    ),
    ...(ssrValue
      ? {
          ssr: {
            metricId: "ssr",
            currentValue: formatRatio(ssrValue, 2),
            deltaLabel: "Approx from major stablecoin market caps",
            sourceLabel: "CoinGecko proxy",
            trend: "flat",
            status: ssrValue < 10 ? "bullish" : ssrValue < 14 ? "neutral" : "bearish",
            series: existing.metrics?.ssr?.series ?? [ssrValue],
            isLive: true,
            asOf: (coingecko?.bitcoin?.last_updated_at ?? 0) * 1000,
            dataMode: "approx",
          },
        }
      : {}),
  };

  const liveMetricCount = Object.values(metrics).filter((metric) => metric?.isLive).length;
  const generatedAt = Date.now();
  const nextSuggestedRunAt = generatedAt + jitterMinutes * 60 * 1000;

  const payload = {
    meta: {
      generatedAt,
      nextSuggestedRunAt,
      scheduler: `55-65 minute jitter; next target in ~${jitterMinutes} minutes`,
    },
    summary: {
      btcPrice: formatUsd(btcPrice, 0),
      btcPriceChange: `${formatPercent(btcChange)} 24h`,
      liveMetricCount,
      mode: liveMetricCount > 0 ? "mixed" : "fallback",
      warnings,
      lastUpdatedAt: generatedAt,
    },
    metrics,
  };

  await mkdir(publicDir, { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return payload;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  updateDashboardCache()
    .then((payload) => {
      console.log(
        `Updated dashboard cache with ${payload.summary.liveMetricCount} live metrics at ${new Date(
          payload.meta.generatedAt,
        ).toISOString()}`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
