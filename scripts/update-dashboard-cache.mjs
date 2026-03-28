import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const cacheFile = path.join(publicDir, "dashboard-cache.json");
const historyFile = path.join(publicDir, "dashboard-history.json");

const BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts";
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const MEMPOOL_API_BASE = "https://mempool.space/api/v1";
const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const BGEOMETRICS_BASE = "https://charts.bgeometrics.com";
const RATE_PROBABILITY_API = "https://rateprobability.com/api/latest";
const TOTAL_METRIC_COUNT = 31;

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

function formatUnsignedPercent(value, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

function formatRatio(value, digits = 2) {
  return value.toFixed(digits);
}

function formatBtc(value, digits = 1) {
  return `${formatCompact(value, digits)} BTC`;
}

function formatBtcDays(value, digits = 1) {
  return `${formatCompact(value, digits)} BTC-days`;
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
    "asopr",
    "adjusted-transfer-volume",
    "active-supply",
    "active-addresses",
    "mvrv",
    "pi-cycle-top",
    "percent-supply-in-profit",
    "lth-supply",
    "lth-net-position-change",
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

  return "neutral";
}

function toSeries(points) {
  return points.slice(-12).map((point) => point.value);
}

function rollingAverage(points, window) {
  return points.map((point, index) => {
    const slice = points.slice(Math.max(0, index - window + 1), index + 1);
    const average = slice.reduce((sum, entry) => sum + entry.value, 0) / slice.length;

    return {
      timestamp: point.timestamp,
      value: average,
    };
  });
}

function combineSeries(left, right, combiner) {
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

function normalizePercentValue(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.abs(value) <= 1 ? Number(value) * 100 : Number(value);
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

async function safePoints(fetcher) {
  try {
    return await fetcher();
  } catch {
    return [];
  }
}

async function fetchRateProbability() {
  return fetchJson(RATE_PROBABILITY_API);
}

async function fetchBlockchainChart(chart, timespan) {
  const payload = await fetchJson(`${BLOCKCHAIN_API_BASE}/${chart}?timespan=${timespan}&format=json`);
  return payload.values.map((point) => ({
    timestamp: point.x * 1000,
    value: point.y,
  }));
}

async function fetchBGeometricsSeries(path) {
  const payload = await fetchJson(`${BGEOMETRICS_BASE}${path}`);
  return payload
    .filter((point) => Array.isArray(point) && point.length >= 2 && point[1] !== null && Number.isFinite(point[1]))
    .map((point) => ({
      timestamp: Number(point[0]),
      value: Number(point[1]),
    }));
}

async function fetchBGeometricsPlotlySeries(path, traceName) {
  const html = await fetchText(`${BGEOMETRICS_BASE}${path}`);
  const escapedName = traceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`"name":"${escapedName}","x":(\\[[^\\]]+\\]),"y":(\\[[^\\]]+\\])`));

  if (!match) {
    throw new Error(`Unable to locate Plotly series ${traceName}`);
  }

  const dates = JSON.parse(match[1]);
  const values = JSON.parse(match[2]);

  return dates
    .map((date, index) => ({
      timestamp: new Date(date).getTime(),
      value: Number(values[index]),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
}

async function fetchBitcoinDataSeries(path, valueKey) {
  const payload = await fetchJson(`https://bitcoin-data.com${path}`);
  return payload
    .map((point) => ({
      timestamp: Number(point.unixTs) * 1000,
      value: Number(point[valueKey]),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value));
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

async function readExistingHistory() {
  try {
    const existing = await readFile(historyFile, "utf8");
    const parsed = JSON.parse(existing);

    return {
      metrics: parsed.metrics ?? {},
    };
  } catch {
    return {
      metrics: {},
    };
  }
}

function appendHistoryPoint(history, metricId, point, maxPoints = 180) {
  if (!Number.isFinite(point?.value) || !Number.isFinite(point?.timestamp)) {
    return;
  }

  const series = [...(history.metrics?.[metricId] ?? [])];
  const last = series.at(-1);

  if (last && Math.abs(last.timestamp - point.timestamp) < 30 * 60 * 1000) {
    series[series.length - 1] = point;
  } else {
    series.push(point);
  }

  history.metrics[metricId] = series.slice(-maxPoints);
}

function seriesFromHistory(history, metricId, fallbackPoint) {
  const points = history.metrics?.[metricId] ?? [];
  const normalized = points.length > 0 ? points : fallbackPoint ? [fallbackPoint] : [];
  return normalized.slice(-12).map((point) => point.value);
}

function deriveLaggedDelta(points, lag) {
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

async function fetchBitInfoSnapshot() {
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

export async function updateDashboardCache() {
  const existing = await readExistingCache();
  const history = await readExistingHistory();
  const warnings = [
    "Exchange Netflow and Exchange Balance currently use approximation proxies.",
    "Some snapshot-style metrics build their sparkline history locally from repeated cache refreshes.",
  ];

  const [
    priceSeries,
    longPriceSeries,
    transactionVolumeBtc,
    totalBitcoins,
    activeAddresses,
    transferVolume,
    hashrate,
    difficulty,
    coingecko,
    mempoolDifficulty,
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
    bitInfoSnapshot,
    dxy,
    realYield,
    fedBalanceSheet,
    onRrp,
    rateProbability,
    oneYearTreasury,
    fedFundsEffective,
  ] = await Promise.all([
    fetchBlockchainChart("market-price", "30days"),
    fetchBlockchainChart("market-price", "730days"),
    fetchBlockchainChart("estimated-transaction-volume", "30days"),
    fetchBlockchainChart("total-bitcoins", "30days"),
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
    safePoints(() =>
      fetchJson(
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
    fetchBitInfoSnapshot(),
    fetchFREDSeries("DTWEXBGS"),
    fetchFREDSeries("DFII10"),
    fetchFREDSeries("WALCL"),
    fetchFREDSeries("RRPTSYD"),
    fetchRateProbability().catch(() => null),
    fetchFREDSeries("DGS1"),
    fetchFREDSeries("DFF"),
  ]);

  const btcPrice = coingecko?.bitcoin?.usd ?? priceSeries.at(-1)?.value ?? 0;
  const btcChange = coingecko?.bitcoin?.usd_24h_change ?? 0;
  const bitcoinMarketCap = markets.find((asset) => asset.id === "bitcoin")?.market_cap ?? 0;
  const stablecoinMarketCap = markets
    .filter((asset) => asset.id !== "bitcoin")
    .reduce((sum, asset) => sum + (asset.market_cap ?? 0), 0);
  const ssrValue = bitcoinMarketCap > 0 && stablecoinMarketCap > 0 ? bitcoinMarketCap / stablecoinMarketCap : null;
  const latestMvrv = mvrvSeries.at(-1)?.value ?? null;
  const realizedPrice = latestMvrv ? btcPrice / latestMvrv : null;
  const latestSupply = totalBitcoins.at(-1)?.value ?? null;
  const latestTxVolumeBtc = transactionVolumeBtc.at(-1)?.value ?? null;
  const currentBitcoinsSent = bitInfoSnapshot.bitcoinsSent24h ?? latestTxVolumeBtc;
  const daysDestroyedPerBtc = bitInfoSnapshot.daysDestroyedPerBtc ?? null;
  const cddValue =
    daysDestroyedPerBtc && latestSupply ? daysDestroyedPerBtc * latestSupply : null;
  const dormancyValue =
    cddValue && currentBitcoinsSent ? cddValue / currentBitcoinsSent : null;
  const activeSupplySeries =
    latestSupply && latestSupply > 0
      ? transactionVolumeBtc.map((point) => ({
          timestamp: point.timestamp,
          value: (point.value / latestSupply) * 100,
        }))
      : [];
  const minerRevenueAverage = rollingAverage(minerRevenueSeries, 365);
  const puellSeries = minerRevenueSeries.map((point, index) => ({
    timestamp: point.timestamp,
    value: minerRevenueAverage[index].value > 0 ? point.value / minerRevenueAverage[index].value : 0,
  }));
  const latestPuell = puellSeries.at(-1)?.value ?? null;
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
    .filter((point) => point !== null && Number.isFinite(point.value));
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
    .filter((point) => point !== null && Number.isFinite(point.value));
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
    .filter((point) => point !== null && Number.isFinite(point.value));
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
  const generatedAt = Date.now();

  if (!rateProbabilityRows.length) {
    warnings.push("Fed Rate Expectations fell back to a FRED proxy because the public meeting-probability feed was unavailable.");
  }

  if (cddValue) {
    appendHistoryPoint(history, "cdd", { timestamp: generatedAt, value: cddValue });
  }

  if (dormancyValue) {
    appendHistoryPoint(history, "dormancy", { timestamp: generatedAt, value: dormancyValue });
  }

  if (ssrValue) {
    appendHistoryPoint(history, "ssr", { timestamp: generatedAt, value: ssrValue });
  }

  const metrics = {
    ...(existing.metrics ?? {}),
    "price-vs-realized-price": {
      metricId: "price-vs-realized-price",
      currentValue: latestMvrv ? `${formatRatio(latestMvrv, 2)}x` : formatUsd(btcPrice, 0),
      deltaLabel: latestMvrv && realizedPrice
        ? `Spot ${formatUsd(btcPrice, 0)} vs realized ${formatUsd(realizedPrice, 0)}`
        : `Proxy only: BTC spot ${formatPercent(btcChange)} over 24h`,
      sourceLabel: latestMvrv ? "Blockchain.com market signals" : "CoinGecko proxy",
      trend: latestMvrv
        ? inferTrend(latestMvrv, mvrvSeries.at(-2)?.value ?? latestMvrv)
        : btcChange >= 0
          ? "up"
          : "down",
      status: latestMvrv
        ? latestMvrv >= 1
          ? "bullish"
          : "bearish"
        : btcChange >= 0
          ? "bullish"
          : "bearish",
      series: latestMvrv ? toSeries(mvrvSeries) : toSeries(priceSeries),
      isLive: true,
      asOf: latestMvrv ? mvrvSeries.at(-1)?.timestamp : (coingecko?.bitcoin?.last_updated_at ?? 0) * 1000,
      dataMode: latestMvrv ? "scraped" : "approx",
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
    ...(activeSupplySeries.length > 0
      ? {
          "active-supply": {
            metricId: "active-supply",
            currentValue: `${formatRatio(activeSupplySeries.at(-1)?.value ?? 0, 2)}%`,
            deltaLabel: "Estimated BTC transfer volume / circulating supply",
            sourceLabel: "Blockchain.com derived",
            trend: inferTrend(
              activeSupplySeries.at(-1)?.value ?? 0,
              activeSupplySeries.at(-2)?.value ?? activeSupplySeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "active-supply",
              activeSupplySeries.at(-1)?.value ?? 0,
              activeSupplySeries.at(-2)?.value ?? activeSupplySeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(activeSupplySeries),
            isLive: true,
            asOf: activeSupplySeries.at(-1)?.timestamp ?? generatedAt,
            dataMode: "approx",
          },
        }
      : {}),
    ...(cddValue
      ? {
          cdd: {
            metricId: "cdd",
            currentValue: formatBtcDays(cddValue, 1),
            deltaLabel: `${formatRatio(daysDestroyedPerBtc ?? 0, 4)} days destroyed per BTC`,
            sourceLabel: "BitInfoCharts derived",
            trend: inferTrend(
              history.metrics?.cdd?.at(-1)?.value ?? cddValue,
              history.metrics?.cdd?.at(-2)?.value ?? history.metrics?.cdd?.at(-1)?.value ?? cddValue,
            ),
            status: inferStatus(
              "cdd",
              history.metrics?.cdd?.at(-1)?.value ?? cddValue,
              history.metrics?.cdd?.at(-2)?.value ?? history.metrics?.cdd?.at(-1)?.value ?? cddValue,
            ),
            series: seriesFromHistory(history, "cdd", {
              timestamp: generatedAt,
              value: cddValue,
            }),
            isLive: true,
            asOf: generatedAt,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(dormancyValue
      ? {
          dormancy: {
            metricId: "dormancy",
            currentValue: `${formatRatio(dormancyValue, 1)}d`,
            deltaLabel: "Derived from days destroyed / BTC sent",
            sourceLabel: "BitInfoCharts derived",
            trend: inferTrend(
              history.metrics?.dormancy?.at(-1)?.value ?? dormancyValue,
              history.metrics?.dormancy?.at(-2)?.value ??
                history.metrics?.dormancy?.at(-1)?.value ??
                dormancyValue,
            ),
            status: inferStatus(
              "dormancy",
              history.metrics?.dormancy?.at(-1)?.value ?? dormancyValue,
              history.metrics?.dormancy?.at(-2)?.value ??
                history.metrics?.dormancy?.at(-1)?.value ??
                dormancyValue,
            ),
            series: seriesFromHistory(history, "dormancy", {
              timestamp: generatedAt,
              value: dormancyValue,
            }),
            isLive: true,
            asOf: generatedAt,
            dataMode: "approx",
          },
        }
      : {}),
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
            series: seriesFromHistory(history, "ssr", {
              timestamp: generatedAt,
              value: ssrValue,
            }),
            isLive: true,
            asOf: (coingecko?.bitcoin?.last_updated_at ?? 0) * 1000,
            dataMode: "approx",
          },
        }
      : {}),
    ...(latestMvrv
      ? {
          mvrv: {
            metricId: "mvrv",
            currentValue: formatRatio(latestMvrv, 2),
            deltaLabel: "Market value to realized value",
            sourceLabel: "Blockchain.com market signals",
            trend: inferTrend(latestMvrv, mvrvSeries.at(-2)?.value ?? latestMvrv),
            status: inferStatus("mvrv", latestMvrv, mvrvSeries.at(-2)?.value ?? latestMvrv),
            series: toSeries(mvrvSeries),
            isLive: true,
            asOf: mvrvSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(piCycleTopBufferSeries.length > 0
      ? {
          "pi-cycle-top": {
            metricId: "pi-cycle-top",
            currentValue: formatUnsignedPercent(piCycleTopBufferSeries.at(-1)?.value ?? 0, 1),
            deltaLabel:
              (piCycleTopBufferSeries.at(-1)?.value ?? 0) >= 0
                ? "111DMA buffer to 2x 350DMA"
                : `${formatUnsignedPercent(Math.abs(piCycleTopBufferSeries.at(-1)?.value ?? 0), 1)} above Pi trigger`,
            sourceLabel: "Blockchain.com derived",
            trend: inferTrend(
              piCycleTopBufferSeries.at(-1)?.value ?? 0,
              piCycleTopBufferSeries.at(-2)?.value ?? piCycleTopBufferSeries.at(-1)?.value ?? 0,
            ),
            status:
              (piCycleTopBufferSeries.at(-1)?.value ?? 0) > 25
                ? "bullish"
                : (piCycleTopBufferSeries.at(-1)?.value ?? 0) > 10
                  ? "neutral"
                  : "bearish",
            series: toSeries(piCycleTopBufferSeries),
            isLive: true,
            asOf: piCycleTopBufferSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(mayerMultipleSeries.length > 0
      ? {
          "mayer-multiple": {
            metricId: "mayer-multiple",
            currentValue: formatRatio(mayerMultipleSeries.at(-1)?.value ?? 0, 2),
            deltaLabel: "BTC spot divided by 200D moving average",
            sourceLabel: "Blockchain.com derived",
            trend: inferTrend(
              mayerMultipleSeries.at(-1)?.value ?? 0,
              mayerMultipleSeries.at(-2)?.value ?? mayerMultipleSeries.at(-1)?.value ?? 0,
            ),
            status:
              (mayerMultipleSeries.at(-1)?.value ?? 0) > 2.4
                ? "bearish"
                : (mayerMultipleSeries.at(-1)?.value ?? 0) < 0.8
                  ? "bullish"
                  : "neutral",
            series: toSeries(mayerMultipleSeries),
            isLive: true,
            asOf: mayerMultipleSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(effectiveAsoprSeries.length > 0
      ? {
          asopr: {
            metricId: "asopr",
            currentValue: formatRatio(effectiveAsoprSeries.at(-1)?.value ?? 0, 3),
            deltaLabel: asoprIsExact ? "Adjusted SOPR" : "SOPR 7D proxy while aSOPR is unavailable",
            sourceLabel: asoprIsExact ? "bitcoin-data.com" : "BGeometrics SOPR proxy",
            trend: inferTrend(
              effectiveAsoprSeries.at(-1)?.value ?? 0,
              effectiveAsoprSeries.at(-2)?.value ?? effectiveAsoprSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "asopr",
              effectiveAsoprSeries.at(-1)?.value ?? 0,
              effectiveAsoprSeries.at(-2)?.value ?? effectiveAsoprSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(effectiveAsoprSeries),
            isLive: true,
            asOf: effectiveAsoprSeries.at(-1)?.timestamp,
            dataMode: asoprIsExact ? "scraped" : "approx",
          },
        }
      : {}),
    ...(hashRibbonSeries.length > 0
      ? {
          "hash-ribbon": {
            metricId: "hash-ribbon",
            currentValue:
              (hashRibbonSeries.at(-1)?.value ?? 0) > 1.01
                ? "Recovered"
                : (hashRibbonSeries.at(-1)?.value ?? 0) < 0.99
                  ? "Compressed"
                  : "Neutral",
            deltaLabel: `30D / 60D hash rate ratio: ${formatRatio(hashRibbonSeries.at(-1)?.value ?? 0, 3)}`,
            sourceLabel: "Blockchain.com derived",
            trend: inferTrend(
              hashRibbonSeries.at(-1)?.value ?? 0,
              hashRibbonSeries.at(-2)?.value ?? hashRibbonSeries.at(-1)?.value ?? 0,
            ),
            status:
              (hashRibbonSeries.at(-1)?.value ?? 0) > 1.01
                ? "bullish"
                : (hashRibbonSeries.at(-1)?.value ?? 0) < 0.99
                  ? "bearish"
                  : "neutral",
            series: toSeries(hashRibbonSeries),
            isLive: true,
            asOf: hashRibbonSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(sthNetPositionChangeSeries.length > 0
      ? {
          "exchange-netflow": {
            metricId: "exchange-netflow",
            currentValue: formatBtc(sthNetPositionChangeSeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "STH supply day-over-day proxy for exchange flow",
            sourceLabel: "BGeometrics liquid-supply proxy",
            trend: inferTrend(
              sthNetPositionChangeSeries.at(-1)?.value ?? 0,
              sthNetPositionChangeSeries.at(-2)?.value ?? sthNetPositionChangeSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "exchange-netflow",
              sthNetPositionChangeSeries.at(-1)?.value ?? 0,
              sthNetPositionChangeSeries.at(-2)?.value ?? sthNetPositionChangeSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(sthNetPositionChangeSeries),
            isLive: true,
            asOf: sthNetPositionChangeSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(sthSupplySeries.length > 0
      ? {
          "exchange-balance": {
            metricId: "exchange-balance",
            currentValue: formatBtc(sthSupplySeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "STH supply proxy for exchange-ready BTC",
            sourceLabel: "BGeometrics liquid-supply proxy",
            trend: inferTrend(
              sthSupplySeries.at(-1)?.value ?? 0,
              sthSupplySeries.at(-2)?.value ?? sthSupplySeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "exchange-balance",
              sthSupplySeries.at(-1)?.value ?? 0,
              sthSupplySeries.at(-2)?.value ?? sthSupplySeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(sthSupplySeries),
            isLive: true,
            asOf: sthSupplySeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(percentSupplyInProfitSeries.length > 0
      ? {
          "percent-supply-in-profit": {
            metricId: "percent-supply-in-profit",
            currentValue: `${formatRatio(percentSupplyInProfitSeries.at(-1)?.value ?? 0, 1)}%`,
            deltaLabel: "Percent of BTC supply currently in profit",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              percentSupplyInProfitSeries.at(-1)?.value ?? 0,
              percentSupplyInProfitSeries.at(-2)?.value ?? percentSupplyInProfitSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "percent-supply-in-profit",
              percentSupplyInProfitSeries.at(-1)?.value ?? 0,
              percentSupplyInProfitSeries.at(-2)?.value ?? percentSupplyInProfitSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(percentSupplyInProfitSeries),
            isLive: true,
            asOf: percentSupplyInProfitSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(reserveRiskSeries.length > 0
      ? {
          "reserve-risk": {
            metricId: "reserve-risk",
            currentValue: formatRatio(reserveRiskSeries.at(-1)?.value ?? 0, 4),
            deltaLabel: "Long-term holder opportunity-cost model",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              reserveRiskSeries.at(-1)?.value ?? 0,
              reserveRiskSeries.at(-2)?.value ?? reserveRiskSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "reserve-risk",
              reserveRiskSeries.at(-1)?.value ?? 0,
              reserveRiskSeries.at(-2)?.value ?? reserveRiskSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(reserveRiskSeries),
            isLive: true,
            asOf: reserveRiskSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(lthSupplySeries.length > 0
      ? {
          "lth-supply": {
            metricId: "lth-supply",
            currentValue: formatBtc(lthSupplySeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "BTC held by long-term holders",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              lthSupplySeries.at(-1)?.value ?? 0,
              lthSupplySeries.at(-2)?.value ?? lthSupplySeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "lth-supply",
              lthSupplySeries.at(-1)?.value ?? 0,
              lthSupplySeries.at(-2)?.value ?? lthSupplySeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(lthSupplySeries),
            isLive: true,
            asOf: lthSupplySeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(sthSupplySeries.length > 0
      ? {
          "sth-supply": {
            metricId: "sth-supply",
            currentValue: formatBtc(sthSupplySeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "BTC held by short-term holders",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              sthSupplySeries.at(-1)?.value ?? 0,
              sthSupplySeries.at(-2)?.value ?? sthSupplySeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "sth-supply",
              sthSupplySeries.at(-1)?.value ?? 0,
              sthSupplySeries.at(-2)?.value ?? sthSupplySeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(sthSupplySeries),
            isLive: true,
            asOf: sthSupplySeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(lthNetPositionChangeSeries.length > 0
      ? {
          "lth-net-position-change": {
            metricId: "lth-net-position-change",
            currentValue: formatBtc(lthNetPositionChangeSeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "Derived 30D change in long-term holder supply",
            sourceLabel: "BGeometrics derived",
            trend: inferTrend(
              lthNetPositionChangeSeries.at(-1)?.value ?? 0,
              lthNetPositionChangeSeries.at(-2)?.value ?? lthNetPositionChangeSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "lth-net-position-change",
              lthNetPositionChangeSeries.at(-1)?.value ?? 0,
              lthNetPositionChangeSeries.at(-2)?.value ?? lthNetPositionChangeSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(lthNetPositionChangeSeries),
            isLive: true,
            asOf: lthNetPositionChangeSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(livelinessSeries.length > 0
      ? {
          liveliness: {
            metricId: "liveliness",
            currentValue: formatRatio(livelinessSeries.at(-1)?.value ?? 0, 4),
            deltaLabel: "Old-coin spending vs holding behavior",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              livelinessSeries.at(-1)?.value ?? 0,
              livelinessSeries.at(-2)?.value ?? livelinessSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "liveliness",
              livelinessSeries.at(-1)?.value ?? 0,
              livelinessSeries.at(-2)?.value ?? livelinessSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(livelinessSeries),
            isLive: true,
            asOf: livelinessSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(etfFlowSeries.length > 0
      ? {
          "spot-btc-etf-flows": {
            metricId: "spot-btc-etf-flows",
            currentValue: formatBtc(etfFlowSeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "Daily net spot ETF flow",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              etfFlowSeries.at(-1)?.value ?? 0,
              etfFlowSeries.at(-2)?.value ?? etfFlowSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "spot-btc-etf-flows",
              etfFlowSeries.at(-1)?.value ?? 0,
              etfFlowSeries.at(-2)?.value ?? etfFlowSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(etfFlowSeries),
            isLive: true,
            asOf: etfFlowSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(etfHoldingsSeries.length > 0
      ? {
          "spot-btc-etf-holdings": {
            metricId: "spot-btc-etf-holdings",
            currentValue: formatBtc(etfHoldingsSeries.at(-1)?.value ?? 0, 1),
            deltaLabel: "Total BTC held by spot ETFs",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              etfHoldingsSeries.at(-1)?.value ?? 0,
              etfHoldingsSeries.at(-2)?.value ?? etfHoldingsSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "spot-btc-etf-holdings",
              etfHoldingsSeries.at(-1)?.value ?? 0,
              etfHoldingsSeries.at(-2)?.value ?? etfHoldingsSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(etfHoldingsSeries),
            isLive: true,
            asOf: etfHoldingsSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(rateProbabilityRows.length > 0
      ? {
          "fed-rate-expectations": {
            metricId: "fed-rate-expectations",
            currentValue:
              (() => {
                const currentMidpoint = Number(rateProbability?.today?.midpoint ?? fedFundsEffective.at(-1)?.value ?? 0);
                const nextMeeting = rateProbabilityRows[0];
                const nextChangeBps =
                  Number.isFinite(nextMeeting?.change_bps)
                    ? Number(nextMeeting.change_bps)
                    : ((nextMeeting?.impliedRate ?? currentMidpoint) - currentMidpoint) * 100;
                const cutOdds = normalizePercentValue(nextMeeting?.prob_is_cut);
                const moveOdds = normalizePercentValue(nextMeeting?.prob_move_pct);

                if (nextChangeBps < 0) {
                  return `${Math.round(cutOdds || moveOdds)}% cut odds`;
                }

                if (nextChangeBps > 0) {
                  return `${Math.round(moveOdds)}% hike odds`;
                }

                return "Hold favored";
              })(),
            deltaLabel: `${rateProbabilityRows[0]?.meeting ?? "Next meeting"} | terminal ${formatRatio(rateProbabilityRows.at(-1)?.impliedRate ?? 0, 2)}%`,
            sourceLabel: "Rate Probability",
            trend: inferTrend(
              rateProbabilityRows.at(-1)?.impliedRate ?? 0,
              Number(rateProbability?.today?.midpoint ?? fedFundsEffective.at(-1)?.value ?? 0),
            ),
            status:
              (rateProbabilityRows.at(-1)?.impliedRate ?? 0) <
              Number(rateProbability?.today?.midpoint ?? fedFundsEffective.at(-1)?.value ?? 0) - 0.125
                ? "bullish"
                : (rateProbabilityRows.at(-1)?.impliedRate ?? 0) >
                    Number(rateProbability?.today?.midpoint ?? fedFundsEffective.at(-1)?.value ?? 0) + 0.125
                  ? "bearish"
                  : "neutral",
            series: toSeries(
              rateProbabilityRows.map((row) => ({
                timestamp: row.timestamp,
                value: row.impliedRate,
              })),
            ),
            isLive: true,
            asOf: rateProbability?.today?.as_of ? new Date(rateProbability.today.as_of).getTime() : generatedAt,
            dataMode: "scraped",
          },
        }
      : fedRateExpectationSeries.length > 0
      ? {
          "fed-rate-expectations": {
            metricId: "fed-rate-expectations",
            currentValue:
              Math.round((fedRateExpectationSeries.at(-1)?.value ?? 0) * 100) < 0
                ? `${Math.abs(Math.round((fedRateExpectationSeries.at(-1)?.value ?? 0) * 100))} bps cuts priced`
                : `${Math.abs(Math.round((fedRateExpectationSeries.at(-1)?.value ?? 0) * 100))} bps hikes priced`,
            deltaLabel: "1Y Treasury minus effective fed funds proxy",
            sourceLabel: "FRED yield-curve proxy",
            trend: inferTrend(
              fedRateExpectationSeries.at(-1)?.value ?? 0,
              fedRateExpectationSeries.at(-2)?.value ?? fedRateExpectationSeries.at(-1)?.value ?? 0,
            ),
            status: inferStatus(
              "fed-rate-expectations",
              fedRateExpectationSeries.at(-1)?.value ?? 0,
              fedRateExpectationSeries.at(-2)?.value ?? fedRateExpectationSeries.at(-1)?.value ?? 0,
            ),
            series: toSeries(fedRateExpectationSeries),
            isLive: true,
            asOf: fedRateExpectationSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
    ...(fundingRatePercentSeries.length > 0
      ? {
          "funding-rate": {
            metricId: "funding-rate",
            currentValue: formatPercent(fundingRatePercentSeries.at(-1)?.value ?? 0, 4),
            deltaLabel: "7D average perpetual funding rate",
            sourceLabel: "BGeometrics",
            trend: inferTrend(
              fundingRatePercentSeries.at(-1)?.value ?? 0,
              fundingRatePercentSeries.at(-2)?.value ?? fundingRatePercentSeries.at(-1)?.value ?? 0,
            ),
            status:
              (fundingRatePercentSeries.at(-1)?.value ?? 0) < -0.01
                ? "bullish"
                : (fundingRatePercentSeries.at(-1)?.value ?? 0) > 0.01
                  ? "bearish"
                  : "neutral",
            series: toSeries(fundingRatePercentSeries),
            isLive: true,
            asOf: fundingRatePercentSeries.at(-1)?.timestamp,
            dataMode: "scraped",
          },
        }
      : {}),
    ...(latestPuell
      ? {
          "puell-multiple": {
            metricId: "puell-multiple",
            currentValue: formatRatio(latestPuell, 2),
            deltaLabel: "Miner revenue vs 365D average",
            sourceLabel: "Blockchain.com derived",
            trend: inferTrend(latestPuell, puellSeries.at(-2)?.value ?? latestPuell),
            status: inferStatus("puell-multiple", latestPuell, puellSeries.at(-2)?.value ?? latestPuell),
            series: toSeries(puellSeries),
            isLive: true,
            asOf: puellSeries.at(-1)?.timestamp,
            dataMode: "approx",
          },
        }
      : {}),
  };

  const liveMetricCount = Object.values(metrics).filter((metric) => metric?.isLive).length;
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
      mode: liveMetricCount === TOTAL_METRIC_COUNT ? "live" : liveMetricCount > 0 ? "mixed" : "fallback",
      warnings,
      lastUpdatedAt: generatedAt,
    },
    metrics,
  };

  await mkdir(publicDir, { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`, "utf8");

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
