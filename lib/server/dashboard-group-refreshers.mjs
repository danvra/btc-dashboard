import { ANALOG_METRIC_IDS, estimateCycleAnalog } from "./cycle-analog.mjs";
import { estimateCyclePosition } from "./cycle-estimate.mjs";
import { CACHE_GROUPS, getMetricIdsForGroup } from "./dashboard-cache-shared.mjs";
import { fetchRecentRedditSentiment, redditSentimentStatus } from "./reddit-sentiment.mjs";
import {
  appendHistory,
  readHistories,
  readHistory,
  writeHistory,
} from "./dashboard-storage.mjs";
import {
  alignSeriesDivision,
  averageSeriesByBucket,
  buildMetric,
  combineSeries,
  fetchBinanceFundingHistory,
  fetchBinanceOpenInterest,
  fetchBlockchainChart,
  fetchBybitFundingHistory,
  fetchCoinGeckoMarkets,
  fetchCoinGeckoPrice,
  fetchFearAndGreedIndex,
  fetchFREDSeries,
  fetchMempoolDifficulty,
  fetchMempoolFees,
  fetchOkxFundingHistory,
  fitPowerLawModel,
  formatBtc,
  formatCompact,
  formatDifficulty,
  formatEhFromTh,
  formatPercent,
  formatRatio,
  formatUnsignedPercent,
  formatUsd,
  inferTrend,
  mergeSeries,
  rollingAverage,
  safePoints,
  toSeries,
} from "./dashboard-source-utils.mjs";

const LONG_HISTORY_LIMIT = 3650;
const SHORT_HISTORY_LIMIT = 720;

function dedupeStrings(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function createSnapshot(groupId, options = {}) {
  const config = CACHE_GROUPS[groupId];
  const previousSnapshot = options.previousSnapshot ?? null;
  const generatedAt = options.generatedAt ?? Date.now();
  const metricIds = options.metricIds ?? getMetricIdsForGroup(groupId);
  const previousMetrics = Object.fromEntries(
    Object.entries(previousSnapshot?.metrics ?? {}).filter(([metricId]) => metricIds.includes(metricId)),
  );
  const nextMetrics = {
    ...previousMetrics,
    ...(options.metrics ?? {}),
  };
  const nextSummary = {
    ...(previousSnapshot?.summary ?? {}),
    ...(options.summary ?? {}),
  };
  const warnings =
    options.warnings !== undefined
      ? dedupeStrings(options.warnings)
      : dedupeStrings(previousSnapshot?.warnings ?? []);
  const lastSourceUpdateAt = Object.values(nextMetrics).reduce((latest, metric) => {
    const asOf = Number(metric?.asOf ?? 0);
    return asOf > latest ? asOf : latest;
  }, Number(options.lastSourceUpdateAt ?? previousSnapshot?.lastSourceUpdateAt ?? 0));

  return {
    groupId,
    generatedAt,
    expiresAt: config.ttlMs > 0 ? generatedAt + config.ttlMs : 0,
    ttlMs: config.ttlMs,
    staleAfterMs: config.staleAfterMs,
    refreshedDuringRequest: false,
    refreshSource: "persisted",
    metricIds,
    warnings,
    lastSourceUpdateAt,
    metrics: nextMetrics,
    summary: nextSummary,
  };
}

function markSnapshotForResponse(snapshot, refreshSource = "cache") {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    refreshedDuringRequest: refreshSource === "refreshed",
    refreshSource,
  };
}

function metricsFromSnapshots(groupSnapshots, excludeGroupId = null) {
  const metrics = {};

  for (const snapshot of Object.values(groupSnapshots ?? {})) {
    if (!snapshot || snapshot.groupId === excludeGroupId) {
      continue;
    }

    Object.assign(metrics, snapshot.metrics ?? {});
  }

  return metrics;
}

async function storeHistory(metricId, points, options = {}) {
  const normalized = (points ?? []).slice(-LONG_HISTORY_LIMIT);

  if (options.persist !== false) {
    await writeHistory(metricId, normalized);
  }

  return normalized;
}

async function appendHistoryPoint(metricId, point, options = {}) {
  if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.value)) {
    return readHistory(metricId);
  }

  if (options.persist === false) {
    const existing = await readHistory(metricId);
    return mergeSeries(existing, [point], options.maxPoints ?? SHORT_HISTORY_LIMIT);
  }

  return appendHistory(metricId, point, options.maxPoints ?? SHORT_HISTORY_LIMIT);
}

async function ensurePriceHistory(options = {}) {
  const priceHistory = await fetchBlockchainChart("market-price", { timespan: "10years" });
  return storeHistory("btc-price-daily", priceHistory, options);
}

function withStatus(metric, status) {
  return {
    ...metric,
    status,
  };
}

function buildFearGreedMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const latestClassification =
    latest < 25 ? "Extreme fear" : latest < 45 ? "Fear" : latest < 55 ? "Neutral" : latest < 75 ? "Greed" : "Extreme greed";
  const status = latest < 30 ? "bullish" : latest < 60 ? "neutral" : "bearish";

  return withStatus(
    buildMetric(
      "fear-and-greed",
      series,
      String(Math.round(latest)),
      latestClassification,
      "Alternative.me",
      {
        dataMode: "live",
      },
    ),
    status,
  );
}

function buildMvrvMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest < 1 ? "bullish" : latest < 2.4 ? "neutral" : "bearish";

  return withStatus(
    buildMetric("mvrv", series, formatRatio(latest, 2), "Market value to realized value", "Blockchain.com", {
      dataMode: "live",
    }),
    status,
  );
}

function buildPuellMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest < 0.75 ? "bullish" : latest < 2.5 ? "neutral" : "bearish";

  return withStatus(
    buildMetric(
      "puell-multiple",
      series,
      formatRatio(latest, 2),
      "Miner revenue / 365D average",
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    ),
    status,
  );
}

function buildPiMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest > 25 ? "bullish" : latest > 10 ? "neutral" : "bearish";

  return withStatus(
    buildMetric(
      "pi-cycle-top",
      series,
      formatUnsignedPercent(latest, 1),
      latest >= 0 ? "111DMA buffer to 2x 350DMA" : "Past the classic trigger line",
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    ),
    status,
  );
}

function buildMayerMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest < 0.9 ? "bullish" : latest < 1.8 ? "neutral" : "bearish";

  return withStatus(
    buildMetric(
      "mayer-multiple",
      series,
      formatRatio(latest, 2),
      "BTC spot / 200D moving average",
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    ),
    status,
  );
}

function buildTwoYearMetric(series, spotRatio) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest > 70 ? "bullish" : latest > 35 ? "neutral" : "bearish";

  return withStatus(
    buildMetric(
      "2-year-ma-multiplier",
      series,
      formatUnsignedPercent(latest, 1),
      `Buffer to 5x band | spot / 2Y MA ${formatRatio(spotRatio, 2)}x`,
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    ),
    status,
  );
}

function buildHashRibbonMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest > 1.02 ? "bullish" : latest > 0.99 ? "neutral" : "bearish";

  return withStatus(
    buildMetric(
      "hash-ribbon",
      series,
      formatRatio(latest, 2),
      "30D hashrate average / 60D average",
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    ),
    status,
  );
}

function buildNvtMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest < 90 ? "bullish" : latest < 150 ? "neutral" : "bearish";

  return withStatus(
    buildMetric("nvt-signal", series, formatRatio(latest, 1), "Network value to transactions signal", "Blockchain.com", {
      dataMode: "live",
    }),
    status,
  );
}

function buildPowerLawMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const status = latest < 0.85 ? "bullish" : latest < 1.15 ? "neutral" : "bearish";

  return withStatus(
    buildMetric("power-law", series, `${formatRatio(latest, 2)}x`, "Spot / fitted power-law midline", "Local model", {
      dataMode: "model",
    }),
    status,
  );
}

function buildStockToFlowMetric(series) {
  return buildMetric(
    "stock-to-flow",
    series,
    formatRatio(series.at(-1)?.value ?? 0, 1),
    "Circulating supply / annual issuance",
    "Local model",
    {
      dataMode: "model",
    },
  );
}

export async function refreshFastGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const warnings = [];
  const [
    coingecko,
    markets,
    fundingBinance,
    fundingBybit,
    fundingOkx,
    openInterestPayload,
    mempoolFees,
    redditSentiment,
  ] = await Promise.all([
    fetchCoinGeckoPrice(),
    safePoints(() => fetchCoinGeckoMarkets()),
    safePoints(() => fetchBinanceFundingHistory()),
    safePoints(() => fetchBybitFundingHistory()),
    safePoints(() => fetchOkxFundingHistory()),
    fetchBinanceOpenInterest().catch(() => null),
    fetchMempoolFees().catch(() => null),
    fetchRecentRedditSentiment({ now: generatedAt }).catch(() => null),
  ]);

  const btcPrice = Number(coingecko?.bitcoin?.usd ?? 0);
  const btcChange = Number(coingecko?.bitcoin?.usd_24h_change ?? 0);
  const priceAsOf = Number(coingecko?.bitcoin?.last_updated_at ?? 0) * 1000 || generatedAt;
  const bitcoinMarketCap = markets.find((asset) => asset.id === "bitcoin")?.market_cap ?? 0;
  const stablecoinMarketCap = markets
    .filter((asset) => asset.id !== "bitcoin")
    .reduce((sum, asset) => sum + Number(asset.market_cap ?? 0), 0);
  const fundingComposite = averageSeriesByBucket([fundingBinance, fundingBybit, fundingOkx]);

  if ([fundingBinance, fundingBybit, fundingOkx].filter((series) => series.length > 0).length < 2) {
    warnings.push("Funding rate basket is running with reduced venue coverage.");
  }

  if (redditSentiment?.fallbackReason) {
    warnings.push(redditSentiment.fallbackReason);
  }

  if (fundingComposite.length > 0) {
    await storeHistory("funding-rate", fundingComposite.slice(-SHORT_HISTORY_LIMIT), options);
  }

  const latestFunding = fundingComposite.at(-1)?.value ?? 0;
  const fundingMetric = withStatus(
    buildMetric(
      "funding-rate",
      fundingComposite,
      formatPercent(latestFunding, 3),
      "Composite BTC perp funding basket",
      "Binance + Bybit + OKX",
      {
        dataMode: "derived",
      },
    ),
    latestFunding < 0 ? "bullish" : latestFunding < 0.03 ? "neutral" : "bearish",
  );

  const ssrValue = bitcoinMarketCap > 0 && stablecoinMarketCap > 0 ? bitcoinMarketCap / stablecoinMarketCap : 0;
  const ssrHistory = ssrValue
    ? await appendHistoryPoint(
        "ssr",
        {
          timestamp: priceAsOf,
          value: ssrValue,
        },
        {
          persist: options.persist,
          maxPoints: SHORT_HISTORY_LIMIT,
        },
      )
    : await readHistory("ssr");

  const metrics = {};

  if (ssrHistory.length > 0) {
    metrics.ssr = withStatus(
      buildMetric(
        "ssr",
        ssrHistory,
        formatRatio(ssrHistory.at(-1)?.value ?? 0, 2),
        "BTC market cap / major stablecoin market caps",
        "CoinGecko derived",
        {
          dataMode: "derived",
        },
      ),
      (ssrHistory.at(-1)?.value ?? 0) < 10 ? "bullish" : (ssrHistory.at(-1)?.value ?? 0) < 14 ? "neutral" : "bearish",
    );
  }

  if (fundingComposite.length > 0) {
    metrics["funding-rate"] = fundingMetric;
  }

  const openInterestValue = Number(openInterestPayload?.openInterest ?? 0);
  const openInterestTime = Number(openInterestPayload?.time ?? priceAsOf);
  const openInterestHistory = openInterestValue
    ? await appendHistoryPoint(
        "open-interest",
        {
          timestamp: openInterestTime,
          value: openInterestValue,
        },
        {
          persist: options.persist,
          maxPoints: SHORT_HISTORY_LIMIT,
        },
      )
    : await readHistory("open-interest");

  if (openInterestHistory.length > 0) {
    metrics["open-interest"] = withStatus(
      buildMetric(
        "open-interest",
        openInterestHistory,
        formatBtc(openInterestHistory.at(-1)?.value ?? 0, 1),
        "Binance BTCUSDT perp open interest",
        "Binance API + local history",
        {
          dataMode: "live",
        },
      ),
      latestFunding > 0.03 && inferTrend(openInterestHistory.at(-1)?.value ?? 0, openInterestHistory.at(-2)?.value ?? 0) === "up"
        ? "bearish"
        : "neutral",
    );
  }

  const redditPoint =
    redditSentiment && Number.isFinite(redditSentiment.score)
      ? {
          timestamp: Number(redditSentiment.sourceAsOf ?? redditSentiment.asOf ?? generatedAt),
          value: Number(redditSentiment.score),
        }
      : null;
  const redditHistory = redditPoint
    ? await appendHistoryPoint("recent-reddit-sentiment", redditPoint, {
        persist: options.persist,
        maxPoints: SHORT_HISTORY_LIMIT,
      })
    : await readHistory("recent-reddit-sentiment");

  if (redditSentiment && redditHistory.length > 0) {
    const status = redditSentimentStatus(Number(redditSentiment.score));
    const stats = [
      { label: "Window", value: "48 hours" },
      { label: "Posts sampled", value: String(redditSentiment.postCount ?? 0) },
      { label: "Comments sampled", value: String(redditSentiment.commentCount ?? 0) },
    ];

    metrics["recent-reddit-sentiment"] = {
      ...withStatus(
        buildMetric(
          "recent-reddit-sentiment",
          redditHistory,
          `${Math.round(Number(redditSentiment.score ?? 0))}/100`,
          `${redditSentiment.label} | ${redditSentiment.postCount ?? 0} posts • ${redditSentiment.commentCount ?? 0} comments`,
          redditSentiment.source === "llm"
            ? `PullPush + ${redditSentiment.model ?? "OpenAI"}`
            : "PullPush + heuristic synthesis",
          {
            dataMode: "derived",
            asOf: Number(redditSentiment.sourceAsOf ?? redditSentiment.asOf ?? generatedAt),
          },
        ),
        status,
      ),
      details: {
        summary: redditSentiment.summary,
        methodology: redditSentiment.methodology,
        drivers: redditSentiment.drivers,
        risks: redditSentiment.risks,
        opportunities: redditSentiment.opportunities,
        subreddits: redditSentiment.subreddits,
        stats,
        samplePosts: redditSentiment.samplePosts,
        sampleComments: redditSentiment.sampleComments,
      },
    };
  }

  if (Object.keys(metrics).length === 0 && !previousSnapshot?.metrics) {
    throw new Error("Fast group refresh produced no metrics.");
  }

  return createSnapshot("fast", {
    previousSnapshot,
    generatedAt,
    metrics,
    warnings,
    summary: {
      btcPrice: btcPrice > 0 ? formatUsd(btcPrice, 0) : previousSnapshot?.summary?.btcPrice ?? "$0",
      btcPriceChange:
        btcPrice > 0
          ? `${formatPercent(btcChange)} over 24h${mempoolFees?.fastestFee ? ` | mempool ${mempoolFees.fastestFee} sat/vB` : ""}`
          : previousSnapshot?.summary?.btcPriceChange ?? "Unavailable",
    },
  });
}

export async function refreshDailyGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const warnings = [];
  const [
    priceHistory,
    fearGreedSeries,
    mvrvSeries,
    transferVolumeUsdSeries,
    transferVolumeBtcSeries,
    totalBitcoinsSeries,
    activeAddressesSeries,
    hashrateSeries,
    difficultySeries,
    minerRevenueSeries,
    nvtSignalSeries,
    mempoolDifficulty,
  ] = await Promise.all([
    ensurePriceHistory(options),
    safePoints(() => fetchFearAndGreedIndex()),
    safePoints(() => fetchBlockchainChart("mvrv", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("estimated-transaction-volume-usd", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("estimated-transaction-volume", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("total-bitcoins", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("n-unique-addresses", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("hash-rate", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("difficulty", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("miners-revenue", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("nvts", { timespan: "10years" })),
    fetchMempoolDifficulty().catch(() => null),
  ]);

  if (priceHistory.length > 0) {
    await storeHistory("btc-price-daily", priceHistory, options);
  }

  if (totalBitcoinsSeries.length > 0) {
    await storeHistory("btc-supply-daily", totalBitcoinsSeries, options);
  }

  const activeSupplySeries = alignSeriesDivision(transferVolumeBtcSeries, totalBitcoinsSeries, 100);
  const price200DayAverage = rollingAverage(priceHistory, 200);
  const price730DayAverage = rollingAverage(priceHistory, 730);
  const price111DayAverage = rollingAverage(priceHistory, 111);
  const price350DayAverage = rollingAverage(priceHistory, 350);
  const minerRevenueAverage = rollingAverage(minerRevenueSeries, 365);
  const puellSeries = minerRevenueSeries
    .map((point, index) => ({
      timestamp: point.timestamp,
      value: minerRevenueAverage[index]?.value > 0 ? point.value / minerRevenueAverage[index].value : 0,
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0);
  const piCycleTopBufferSeries = priceHistory
    .map((point, index) => {
      if (index < 349) {
        return null;
      }

      const triggerLine = (price350DayAverage[index]?.value ?? 0) * 2;

      if (triggerLine <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: ((triggerLine - (price111DayAverage[index]?.value ?? 0)) / triggerLine) * 100,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
  const mayerMultipleSeries = priceHistory
    .map((point, index) => {
      const average = price200DayAverage[index]?.value ?? 0;

      if (average <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: point.value / average,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
  const twoYearMaBufferSeries = priceHistory
    .map((point, index) => {
      if (index < 729) {
        return null;
      }

      const topBand = (price730DayAverage[index]?.value ?? 0) * 5;

      if (topBand <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: ((topBand - point.value) / topBand) * 100,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
  const hashrate30DayAverage = rollingAverage(hashrateSeries, 30);
  const hashrate60DayAverage = rollingAverage(hashrateSeries, 60);
  const hashRibbonSeries = hashrateSeries
    .map((point, index) => {
      const average60 = hashrate60DayAverage[index]?.value ?? 0;

      if (average60 <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: (hashrate30DayAverage[index]?.value ?? 0) / average60,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
  const powerLawModelSeries = fitPowerLawModel(priceHistory);
  const powerLawRatioSeries = combineSeries(priceHistory, powerLawModelSeries, (price, model) => price / model);
  const stockToFlowSeries = totalBitcoinsSeries
    .map((point, index) => {
      if (index < 365) {
        return null;
      }

      const annualIssuance = point.value - totalBitcoinsSeries[index - 365].value;

      if (annualIssuance <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: point.value / annualIssuance,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));

  await Promise.all([
    storeHistory("mvrv", mvrvSeries, options),
    storeHistory("puell-multiple", puellSeries, options),
    storeHistory("pi-cycle-top", piCycleTopBufferSeries, options),
    storeHistory("mayer-multiple", mayerMultipleSeries, options),
    storeHistory("2-year-ma-multiplier", twoYearMaBufferSeries, options),
    storeHistory("active-supply", activeSupplySeries, options),
    storeHistory("active-addresses", activeAddressesSeries, options),
    storeHistory("hash-ribbon", hashRibbonSeries, options),
    storeHistory("nvt-signal", nvtSignalSeries, options),
    storeHistory("power-law", powerLawRatioSeries, options),
    storeHistory("stock-to-flow", stockToFlowSeries, options),
  ]);

  const metrics = {};

  if (fearGreedSeries.length > 0) {
    metrics["fear-and-greed"] = buildFearGreedMetric(fearGreedSeries);
  }

  if (transferVolumeUsdSeries.length > 0) {
    metrics["adjusted-transfer-volume"] = buildMetric(
      "adjusted-transfer-volume",
      transferVolumeUsdSeries,
      formatUsd(transferVolumeUsdSeries.at(-1)?.value ?? 0, 1),
      "Estimated on-chain transfer value",
      "Blockchain.com",
      {
        dataMode: "live",
      },
    );
  }

  if (mvrvSeries.length > 0) {
    metrics.mvrv = buildMvrvMetric(mvrvSeries);
  }

  if (puellSeries.length > 0) {
    metrics["puell-multiple"] = buildPuellMetric(puellSeries);
  }

  if (piCycleTopBufferSeries.length > 0) {
    metrics["pi-cycle-top"] = buildPiMetric(piCycleTopBufferSeries);
  }

  if (mayerMultipleSeries.length > 0) {
    metrics["mayer-multiple"] = buildMayerMetric(mayerMultipleSeries);
  }

  if (twoYearMaBufferSeries.length > 0) {
    const latestSpot = priceHistory.at(-1)?.value ?? 0;
    const latestTwoYearAverage = price730DayAverage.at(-1)?.value ?? latestSpot;
    metrics["2-year-ma-multiplier"] = buildTwoYearMetric(
      twoYearMaBufferSeries,
      latestTwoYearAverage > 0 ? latestSpot / latestTwoYearAverage : 0,
    );
  }

  if (powerLawRatioSeries.length > 0) {
    metrics["power-law"] = buildPowerLawMetric(powerLawRatioSeries);
  }

  if (stockToFlowSeries.length > 0) {
    metrics["stock-to-flow"] = buildStockToFlowMetric(stockToFlowSeries);
  }

  if (activeSupplySeries.length > 0) {
    metrics["active-supply"] = buildMetric(
      "active-supply",
      activeSupplySeries,
      `${formatRatio(activeSupplySeries.at(-1)?.value ?? 0, 2)}%`,
      "BTC transfer volume / circulating supply",
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    );
  }

  if (activeAddressesSeries.length > 0) {
    metrics["active-addresses"] = buildMetric(
      "active-addresses",
      activeAddressesSeries,
      formatCompact(activeAddressesSeries.at(-1)?.value ?? 0, 0),
      "Unique active addresses",
      "Blockchain.com",
      {
        dataMode: "live",
      },
    );
  }

  if (hashrateSeries.length > 0) {
    metrics.hashrate = buildMetric(
      "hashrate",
      hashrateSeries,
      formatEhFromTh(hashrateSeries.at(-1)?.value ?? 0),
      "Estimated network hash rate",
      "Blockchain.com",
      {
        dataMode: "live",
      },
    );
  }

  if (difficultySeries.length > 0) {
    metrics.difficulty = buildMetric(
      "difficulty",
      difficultySeries,
      formatDifficulty(difficultySeries.at(-1)?.value ?? 0),
      mempoolDifficulty?.difficultyChange !== undefined
        ? `Next adjustment ${formatPercent(Number(mempoolDifficulty.difficultyChange), 2)}`
        : "Current network difficulty",
      "Blockchain.com + mempool.space",
      {
        dataMode: "live",
      },
    );
  }

  if (hashRibbonSeries.length > 0) {
    metrics["hash-ribbon"] = buildHashRibbonMetric(hashRibbonSeries);
  }

  if (nvtSignalSeries.length > 0) {
    metrics["nvt-signal"] = buildNvtMetric(nvtSignalSeries);
  }

  if (Object.keys(metrics).length === 0 && !previousSnapshot?.metrics) {
    throw new Error("Daily group refresh produced no metrics.");
  }

  if (fearGreedSeries.length === 0) {
    warnings.push("Fear & Greed was unavailable during the latest daily refresh.");
  }

  return createSnapshot("daily", {
    previousSnapshot,
    generatedAt,
    metrics,
    warnings,
  });
}

export async function refreshSlowGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const warnings = [];
  const [dxy, realYield, fedBalanceSheet, onRrp] = await Promise.all([
    safePoints(() => fetchFREDSeries("DTWEXBGS", { limit: 400 })),
    safePoints(() => fetchFREDSeries("DFII10", { limit: 400 })),
    safePoints(() => fetchFREDSeries("WALCL", { limit: 400 })),
    safePoints(() => fetchFREDSeries("RRPTSYD", { limit: 400 })),
  ]);
  const metrics = {};

  if (!process.env.FRED_API_KEY) {
    warnings.push("FRED_API_KEY is missing, so the slow macro cohort is using the public FRED CSV connector.");
  }

  if (dxy.length > 0) {
    metrics.dxy = buildMetric("dxy", dxy, formatRatio(dxy.at(-1)?.value ?? 0, 2), "Broad U.S. dollar index", "FRED", {
      dataMode: "live",
    });
  }

  if (realYield.length > 0) {
    metrics["10y-real-yield"] = buildMetric(
      "10y-real-yield",
      realYield,
      formatPercent(realYield.at(-1)?.value ?? 0, 2),
      "U.S. 10Y real yield",
      "FRED",
      {
        dataMode: "live",
      },
    );
  }

  if (fedBalanceSheet.length > 0) {
    metrics["fed-balance-sheet"] = buildMetric(
      "fed-balance-sheet",
      fedBalanceSheet,
      formatUsd((fedBalanceSheet.at(-1)?.value ?? 0) * 1_000_000, 1),
      "Federal Reserve total assets",
      "FRED",
      {
        dataMode: "live",
      },
    );
  }

  if (onRrp.length > 0) {
    metrics["on-rrp"] = buildMetric(
      "on-rrp",
      onRrp,
      formatUsd((onRrp.at(-1)?.value ?? 0) * 1_000_000_000, 1),
      "Overnight reverse repo usage",
      "FRED",
      {
        dataMode: "live",
      },
    );
  }

  if (Object.keys(metrics).length === 0 && !previousSnapshot?.metrics) {
    throw new Error("Slow group refresh produced no metrics.");
  }

  return createSnapshot("slow", {
    previousSnapshot,
    generatedAt,
    metrics,
    warnings,
  });
}

export async function refreshSyntheticGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const currentMetrics = metricsFromSnapshots(options.groupSnapshots, "synthetic");

  if (Object.keys(currentMetrics).length === 0) {
    throw new Error("Synthetic refresh requires upstream metric snapshots.");
  }

  const historicalSeries = await readHistories(ANALOG_METRIC_IDS);
  const previousEstimate = previousSnapshot?.summary?.cycleEstimate ?? options.baseComposite?.summary?.cycleEstimate;
  const cycleEstimate = await estimateCyclePosition(currentMetrics, generatedAt, previousEstimate);
  const cycleAnalog =
    estimateCycleAnalog({
      currentMetrics,
      generatedAt,
      historicalSeries,
    }) ??
    previousSnapshot?.summary?.cycleAnalog ??
    options.baseComposite?.summary?.cycleAnalog ??
    null;

  return createSnapshot("synthetic", {
    previousSnapshot,
    generatedAt,
    metrics: {},
    warnings: [],
    summary: {
      cycleEstimate: cycleEstimate ?? previousSnapshot?.summary?.cycleEstimate ?? null,
      cycleAnalog,
    },
    lastSourceUpdateAt: Math.max(
      generatedAt,
      ...Object.values(options.groupSnapshots ?? {}).map((snapshot) => Number(snapshot?.lastSourceUpdateAt ?? 0)),
    ),
  });
}

export function snapshotForResponse(snapshot, refreshed = false) {
  return markSnapshotForResponse(snapshot, refreshed ? "refreshed" : "cache");
}
