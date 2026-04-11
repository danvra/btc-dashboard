import { ANALOG_METRIC_IDS, estimateCycleAnalog } from "./cycle-analog.mjs";
import { estimateCyclePosition } from "./cycle-estimate.mjs";
import { CACHE_GROUPS, getMetricIdsForGroup } from "./dashboard-cache-shared.mjs";
import { evaluateMetricStatus } from "./dashboard-status-rules.mjs";
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
  deriveLaggedDelta,
  fetchBGeometricsCohortMetrics,
  fetchBGeometricsPlotlySeries,
  fetchBGeometricsSeries,
  fetchBitcoinDataSeries,
  fetchBitInfoSnapshot,
  fetchBinanceFundingHistory,
  fetchBinanceOpenInterest,
  fetchBlockchainChart,
  fetchBlockchainMvrvSeries,
  fetchBybitFundingHistory,
  fetchCoinGeckoMarkets,
  fetchCoinMetricsAssetMetrics,
  fetchCoinGeckoPrice,
  fetchFearAndGreedIndex,
  fetchFREDSeries,
  fetchGlassnodeMetricsBundle,
  fetchMempoolDifficulty,
  fetchMempoolFees,
  fetchOkxFundingHistory,
  fetchRateProbability,
  fitPowerLawModel,
  formatBtc,
  formatBtcDays,
  formatCompact,
  formatDifficulty,
  formatEhFromTh,
  formatPercent,
  formatRatio,
  formatUnsignedPercent,
  formatUsd,
  inferTrend,
  mergeSeries,
  normalizePercentValue,
  rollingAverage,
  safePoints,
  sumSeries,
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
  const previous = series.at(-2)?.value ?? latest;
  const latestClassification =
    latest < 25 ? "Extreme fear" : latest < 45 ? "Fear" : latest < 55 ? "Neutral" : latest < 75 ? "Greed" : "Extreme greed";
  const status = evaluateMetricStatus("fear-and-greed", latest, previous);

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
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("mvrv", latest, previous);

  return withStatus(
    buildMetric("mvrv", series, formatRatio(latest, 2), "Market value to realized value", "Blockchain.com", {
      dataMode: "live",
    }),
    status,
  );
}

function buildPuellMetric(series) {
  const latest = series.at(-1)?.value ?? 0;
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("puell-multiple", latest, previous);

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
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("pi-cycle-top", latest, previous);

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
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("mayer-multiple", latest, previous);

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
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("2-year-ma-multiplier", latest, previous);

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
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("hash-ribbon", latest, previous);

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
  const previous = series.at(-2)?.value ?? latest;
  const status = evaluateMetricStatus("nvt-signal", latest, previous);

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

function redditRetentionWarning(reason, hasPreviousSnapshot) {
  if (hasPreviousSnapshot) {
    return `${reason} Retaining the previous cached Reddit sentiment snapshot.`;
  }

  return `${reason} No previous cached Reddit sentiment snapshot was available to retain.`;
}

export async function refreshFastGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const shouldRefreshRedditSentiment = options.refreshRedditSentiment === true;
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
    shouldRefreshRedditSentiment ? fetchRecentRedditSentiment({ now: generatedAt }).catch(() => null) : null,
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

  if (shouldRefreshRedditSentiment && redditSentiment && !redditSentiment.ok) {
    warnings.push(
      redditRetentionWarning(
        redditSentiment.reason ?? "Reddit sentiment refresh failed.",
        Boolean(previousSnapshot?.metrics?.["recent-reddit-sentiment"]),
      ),
    );
  }

  if (fundingComposite.length > 0) {
    await storeHistory("funding-rate", fundingComposite.slice(-SHORT_HISTORY_LIMIT), options);
  }

  const latestFunding = fundingComposite.at(-1)?.value ?? 0;
  const previousFunding = fundingComposite.at(-2)?.value ?? latestFunding;
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
    evaluateMetricStatus("funding-rate", latestFunding, previousFunding),
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
    const latestSsr = ssrHistory.at(-1)?.value ?? 0;
    const previousSsr = ssrHistory.at(-2)?.value ?? latestSsr;
    metrics.ssr = withStatus(
      buildMetric(
        "ssr",
        ssrHistory,
        formatRatio(latestSsr, 2),
        "BTC market cap / major stablecoin market caps",
        "CoinGecko derived",
        {
          dataMode: "derived",
        },
      ),
      evaluateMetricStatus("ssr", latestSsr, previousSsr),
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
    const latestOpenInterest = openInterestHistory.at(-1)?.value ?? 0;
    const previousOpenInterest = openInterestHistory.at(-2)?.value ?? latestOpenInterest;
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
      evaluateMetricStatus("open-interest", latestOpenInterest, previousOpenInterest, {
        fundingRate: latestFunding,
      }),
    );
  }

  const redditPoint =
    redditSentiment?.ok && Number.isFinite(redditSentiment.score)
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

  if (redditSentiment?.ok && redditHistory.length > 0) {
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
          `PullPush + ${redditSentiment.model ?? "OpenAI"}`,
          {
            dataMode: "scraped",
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
    rateProbability,
    oneYearTreasury,
    fedFundsEffective,
    nuplSeries,
    percentSupplyInProfitSeries,
    reserveRiskSeries,
    livelinessSeries,
    lthSupplySeries,
    sthSupplySeries,
    lthMvrvSeries,
    sthMvrvSeries,
    rhodlRatioSeries,
    hodl1y2ySeries,
    hodl2y3ySeries,
    hodl3y4ySeries,
    hodl4y8ySeries,
    hodl8ySeries,
    etfFlowSeries,
    etfHoldingsSeries,
    asoprSeries,
    soprProxySeries,
    bitInfoSnapshot,
    glassnodeMetrics,
    coinMetricsDailyMetrics,
    bgeometricsCohortMetrics,
  ] = await Promise.all([
    ensurePriceHistory(options),
    safePoints(() => fetchFearAndGreedIndex()),
    safePoints(() => fetchBlockchainMvrvSeries()),
    safePoints(() => fetchBlockchainChart("estimated-transaction-volume-usd", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("estimated-transaction-volume", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("total-bitcoins", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("n-unique-addresses", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("hash-rate", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("difficulty", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("miners-revenue", { timespan: "10years" })),
    safePoints(() => fetchBlockchainChart("nvts", { timespan: "10years" })),
    fetchMempoolDifficulty().catch(() => null),
    fetchRateProbability().catch(() => null),
    safePoints(() => fetchFREDSeries("DGS1", { limit: 400 })),
    safePoints(() => fetchFREDSeries("DFF", { limit: 400 })),
    safePoints(() => fetchBGeometricsPlotlySeries("/reports/bitcoin_nupl_g.html", "NUPL")),
    safePoints(() => fetchBGeometricsSeries("/files/profit_loss.json")),
    safePoints(() => fetchBGeometricsSeries("/files/reserve_risk.json")),
    safePoints(() => fetchBGeometricsPlotlySeries("/reports/bitcoin_liveliness_g.html", "Liveliness")),
    safePoints(() => fetchBGeometricsSeries("/files/lth_supply.json")),
    safePoints(() => fetchBGeometricsSeries("/files/sth_supply.json")),
    safePoints(() => fetchBGeometricsSeries("/files/lth_mvrv.json")),
    safePoints(() => fetchBGeometricsSeries("/files/sth_mvrv.json")),
    safePoints(() => fetchBGeometricsSeries("/files/rhodl_1m.json")),
    safePoints(() => fetchBGeometricsSeries("/files/hw_age_1y_2y.json")),
    safePoints(() => fetchBGeometricsSeries("/files/hw_age_2y_3y.json")),
    safePoints(() => fetchBGeometricsSeries("/files/hw_age_3y_4y.json")),
    safePoints(() => fetchBGeometricsSeries("/files/hw_age_4y_8y.json")),
    safePoints(() => fetchBGeometricsSeries("/files/hw_age_8y_.json")),
    safePoints(() => fetchBGeometricsSeries("/files/flow_btc_etf_btc.json")),
    safePoints(() => fetchBGeometricsSeries("/files/total_btc_etf_btc.json")),
    safePoints(() => fetchBitcoinDataSeries("/v1/asopr", "asopr")),
    safePoints(() => fetchBGeometricsSeries("/files/sopr_7sma.json")),
    fetchBitInfoSnapshot().catch(() => ({})),
    fetchGlassnodeMetricsBundle().catch(() => null),
    fetchCoinMetricsAssetMetrics(["AdrActCnt", "CapMVRVCur", "SplyCur", "SplyExNtv", "FlowInExNtv", "FlowOutExNtv"]).catch(
      () => null,
    ),
    fetchBGeometricsCohortMetrics().catch(() => null),
  ]);

  if (priceHistory.length > 0) {
    await storeHistory("btc-price-daily", priceHistory, options);
  }

  const coinMetricsSupplySeries = coinMetricsDailyMetrics?.SplyCur ?? [];
  const coinMetricsMvrvSeries = coinMetricsDailyMetrics?.CapMVRVCur ?? [];
  const coinMetricsActiveAddressesSeries = coinMetricsDailyMetrics?.AdrActCnt ?? [];
  const coinMetricsExchangeBalanceSeries = coinMetricsDailyMetrics?.SplyExNtv ?? [];
  const coinMetricsExchangeInflowSeries = coinMetricsDailyMetrics?.FlowInExNtv ?? [];
  const coinMetricsExchangeOutflowSeries = coinMetricsDailyMetrics?.FlowOutExNtv ?? [];
  const effectiveSupplySeries = coinMetricsSupplySeries.length > 0 ? coinMetricsSupplySeries : totalBitcoinsSeries;

  if (effectiveSupplySeries.length > 0) {
    await storeHistory("btc-supply-daily", effectiveSupplySeries, options);
  }

  const effectiveMvrvSeries =
    coinMetricsMvrvSeries.length > 0
      ? coinMetricsMvrvSeries
      : glassnodeMetrics?.mvrvSeries?.length > 0
        ? glassnodeMetrics.mvrvSeries
        : mvrvSeries;
  const latestMvrv = effectiveMvrvSeries.at(-1)?.value ?? null;
  const latestSpot = priceHistory.at(-1)?.value ?? 0;
  const realizedPriceUsd =
    glassnodeMetrics?.realizedPriceSeries?.at(-1)?.value ??
    (latestMvrv && latestSpot > 0 ? latestSpot / latestMvrv : null);
  const effectiveAdjustedTransferVolumeSeries =
    glassnodeMetrics?.adjustedTransferVolumeSeries?.length > 0
      ? glassnodeMetrics.adjustedTransferVolumeSeries
      : transferVolumeUsdSeries;
  const effectivePercentSupplyInProfitSeries =
    glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0
      ? glassnodeMetrics.percentSupplyInProfitSeries.map((point) => ({
          timestamp: point.timestamp,
          value: point.value * 100,
        }))
      : bgeometricsCohortMetrics?.supplyProfitSeries?.length > 0
        ? alignSeriesDivision(bgeometricsCohortMetrics.supplyProfitSeries, effectiveSupplySeries, 100)
        : percentSupplyInProfitSeries;
  const effectiveReserveRiskSeries =
    glassnodeMetrics?.reserveRiskSeries?.length > 0
      ? glassnodeMetrics.reserveRiskSeries
      : bgeometricsCohortMetrics?.reserveRiskSeries?.length > 0
        ? bgeometricsCohortMetrics.reserveRiskSeries
        : reserveRiskSeries;
  const effectiveLivelinessSeries =
    glassnodeMetrics?.livelinessSeries?.length > 0
      ? glassnodeMetrics.livelinessSeries
      : bgeometricsCohortMetrics?.livelinessSeries?.length > 0
        ? bgeometricsCohortMetrics.livelinessSeries
        : livelinessSeries;
  const effectiveLthSupplySeries =
    glassnodeMetrics?.lthSupplySeries?.length > 0
      ? glassnodeMetrics.lthSupplySeries
      : bgeometricsCohortMetrics?.lthSupplySeries?.length > 0
        ? bgeometricsCohortMetrics.lthSupplySeries
        : lthSupplySeries;
  const effectiveSthSupplySeries =
    glassnodeMetrics?.sthSupplySeries?.length > 0
      ? glassnodeMetrics.sthSupplySeries
      : bgeometricsCohortMetrics?.sthSupplySeries?.length > 0
        ? bgeometricsCohortMetrics.sthSupplySeries
        : sthSupplySeries;
  const effectiveAsoprSeries =
    glassnodeMetrics?.asoprSeries?.length > 0
      ? glassnodeMetrics.asoprSeries
      : asoprSeries.length > 0
        ? asoprSeries
        : soprProxySeries;
  const asoprIsExact = asoprSeries.length > 0;
  const activeSupplySeries = alignSeriesDivision(transferVolumeBtcSeries, effectiveSupplySeries, 100);
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
  const stockToFlowSeries = effectiveSupplySeries
    .map((point, index) => {
      if (index < 365) {
        return null;
      }

      const annualIssuance = point.value - effectiveSupplySeries[index - 365].value;

      if (annualIssuance <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: point.value / annualIssuance,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
  const lthNetPositionChangeSeries =
    glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0
      ? glassnodeMetrics.lthNetPositionChangeSeries
      : bgeometricsCohortMetrics?.lthNetPositionChangeSeries?.length > 0
        ? bgeometricsCohortMetrics.lthNetPositionChangeSeries
      : deriveLaggedDelta(effectiveLthSupplySeries, 30);
  const sthNetPositionChangeSeries = deriveLaggedDelta(effectiveSthSupplySeries, 1);
  const effectiveActiveAddressesSeries =
    coinMetricsActiveAddressesSeries.length > 0 ? coinMetricsActiveAddressesSeries : activeAddressesSeries;
  const coinMetricsExchangeNetflowSeries =
    coinMetricsExchangeInflowSeries.length > 0 && coinMetricsExchangeOutflowSeries.length > 0
      ? combineSeries(coinMetricsExchangeInflowSeries, coinMetricsExchangeOutflowSeries, (inflow, outflow) => inflow - outflow)
      : [];
  const effectiveExchangeNetflowSeries =
    coinMetricsExchangeNetflowSeries.length > 0
      ? coinMetricsExchangeNetflowSeries
      : glassnodeMetrics?.exchangeNetflowSeries?.length > 0
      ? glassnodeMetrics.exchangeNetflowSeries
      : sthNetPositionChangeSeries;
  const effectiveExchangeBalanceSeries =
    coinMetricsExchangeBalanceSeries.length > 0
      ? coinMetricsExchangeBalanceSeries
      : glassnodeMetrics?.exchangeBalanceSeries?.length > 0
      ? glassnodeMetrics.exchangeBalanceSeries
      : effectiveSthSupplySeries;
  const hasGlassnodeCohortMetrics = Boolean(
      glassnodeMetrics?.exchangeNetflowSeries?.length > 0 ||
      glassnodeMetrics?.exchangeBalanceSeries?.length > 0 ||
      glassnodeMetrics?.reserveRiskSeries?.length > 0 ||
      glassnodeMetrics?.lthSupplySeries?.length > 0 ||
      glassnodeMetrics?.sthSupplySeries?.length > 0 ||
      glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0 ||
      glassnodeMetrics?.livelinessSeries?.length > 0 ||
      glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0,
  );
  const hasBGeometricsLiveCohortMetrics = Boolean(
    bgeometricsCohortMetrics?.lthSupplySeries?.length > 0 ||
      bgeometricsCohortMetrics?.sthSupplySeries?.length > 0 ||
      bgeometricsCohortMetrics?.lthNetPositionChangeSeries?.length > 0 ||
      bgeometricsCohortMetrics?.reserveRiskSeries?.length > 0 ||
      bgeometricsCohortMetrics?.livelinessSeries?.length > 0 ||
      bgeometricsCohortMetrics?.supplyProfitSeries?.length > 0,
  );
  const hasCoinMetricsExchangeMetrics = Boolean(
    coinMetricsExchangeNetflowSeries.length > 0 || coinMetricsExchangeBalanceSeries.length > 0,
  );
  const lthNuplSeries = lthMvrvSeries
    .map((point) => ({
      timestamp: point.timestamp,
      value: point.value > 0 ? 1 - 1 / point.value : 0,
    }))
    .filter((point) => Number.isFinite(point.value));
  const sthNuplSeries = sthMvrvSeries
    .map((point) => ({
      timestamp: point.timestamp,
      value: point.value > 0 ? 1 - 1 / point.value : 0,
    }))
    .filter((point) => Number.isFinite(point.value));
  const oldSupplyShareSeries = sumSeries([
    hodl1y2ySeries,
    hodl2y3ySeries,
    hodl3y4ySeries,
    hodl4y8ySeries,
    hodl8ySeries,
  ]);
  const latestSupply = effectiveSupplySeries.at(-1)?.value ?? null;
  const latestTxVolumeBtc = transferVolumeBtcSeries.at(-1)?.value ?? null;
  const currentBitcoinsSent = bitInfoSnapshot?.bitcoinsSent24h ?? latestTxVolumeBtc;
  const daysDestroyedPerBtc = bitInfoSnapshot?.daysDestroyedPerBtc ?? null;
  const cddValue = daysDestroyedPerBtc && latestSupply ? daysDestroyedPerBtc * latestSupply : null;
  const dormancyValue = cddValue && currentBitcoinsSent ? cddValue / currentBitcoinsSent : null;
  const cddHistory = cddValue
    ? await appendHistoryPoint(
        "cdd",
        {
          timestamp: generatedAt,
          value: cddValue,
        },
        {
          persist: options.persist,
          maxPoints: SHORT_HISTORY_LIMIT,
        },
      )
    : await readHistory("cdd");
  const dormancyHistory = dormancyValue
    ? await appendHistoryPoint(
        "dormancy",
        {
          timestamp: generatedAt,
          value: dormancyValue,
        },
        {
          persist: options.persist,
          maxPoints: SHORT_HISTORY_LIMIT,
        },
      )
    : await readHistory("dormancy");
  const rateProbabilityRows = (rateProbability?.today?.rows ?? rateProbability?.rows ?? [])
    .map((row) => ({
      ...row,
      timestamp: row.meeting_iso ? new Date(row.meeting_iso).getTime() : Number.NaN,
      impliedRate: Number(row.implied_rate_post_meeting),
    }))
    .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.impliedRate));
  const fedRateExpectationSeries = combineSeries(oneYearTreasury, fedFundsEffective, (dgs1, dff) => dgs1 - dff);

  await Promise.all([
    storeHistory("mvrv", effectiveMvrvSeries, options),
    storeHistory("puell-multiple", puellSeries, options),
    storeHistory("pi-cycle-top", piCycleTopBufferSeries, options),
    storeHistory("mayer-multiple", mayerMultipleSeries, options),
    storeHistory("2-year-ma-multiplier", twoYearMaBufferSeries, options),
    storeHistory("active-supply", activeSupplySeries, options),
    storeHistory("active-addresses", effectiveActiveAddressesSeries, options),
    storeHistory("hash-ribbon", hashRibbonSeries, options),
    storeHistory("nvt-signal", nvtSignalSeries, options),
    storeHistory("power-law", powerLawRatioSeries, options),
    storeHistory("stock-to-flow", stockToFlowSeries, options),
  ]);

  const resolvedMvrvSeries = effectiveMvrvSeries.length > 0 ? effectiveMvrvSeries : await readHistory("mvrv");
  const resolvedPuellSeries = puellSeries.length > 0 ? puellSeries : await readHistory("puell-multiple");
  const resolvedPiCycleSeries = piCycleTopBufferSeries.length > 0 ? piCycleTopBufferSeries : await readHistory("pi-cycle-top");
  const resolvedMayerSeries = mayerMultipleSeries.length > 0 ? mayerMultipleSeries : await readHistory("mayer-multiple");
  const resolvedTwoYearSeries =
    twoYearMaBufferSeries.length > 0 ? twoYearMaBufferSeries : await readHistory("2-year-ma-multiplier");
  const resolvedActiveSupplySeries = activeSupplySeries.length > 0 ? activeSupplySeries : await readHistory("active-supply");
  const resolvedActiveAddressesSeries =
    effectiveActiveAddressesSeries.length > 0
      ? effectiveActiveAddressesSeries
      : await readHistory("active-addresses");
  const resolvedHashRibbonSeries = hashRibbonSeries.length > 0 ? hashRibbonSeries : await readHistory("hash-ribbon");
  const resolvedNvtSignalSeries = nvtSignalSeries.length > 0 ? nvtSignalSeries : await readHistory("nvt-signal");
  const resolvedPowerLawSeries = powerLawRatioSeries.length > 0 ? powerLawRatioSeries : await readHistory("power-law");
  const resolvedStockToFlowSeries = stockToFlowSeries.length > 0 ? stockToFlowSeries : await readHistory("stock-to-flow");

  const metrics = {};

  if (fearGreedSeries.length > 0) {
    metrics["fear-and-greed"] = buildFearGreedMetric(fearGreedSeries);
  }

  if (effectiveAdjustedTransferVolumeSeries.length > 0) {
    metrics["adjusted-transfer-volume"] = buildMetric(
      "adjusted-transfer-volume",
      effectiveAdjustedTransferVolumeSeries,
      formatUsd(effectiveAdjustedTransferVolumeSeries.at(-1)?.value ?? 0, 1),
      glassnodeMetrics?.adjustedTransferVolumeSeries?.length > 0
        ? "Adjusted on-chain transfer volume"
        : "Estimated on-chain transfer value",
      glassnodeMetrics?.adjustedTransferVolumeSeries?.length > 0 ? "Glassnode" : "Blockchain.com",
      {
        dataMode: "live",
      },
    );
  }

  if (resolvedMvrvSeries.length > 0) {
    metrics.mvrv = buildMvrvMetric(resolvedMvrvSeries);
    metrics.mvrv.sourceLabel =
      coinMetricsMvrvSeries.length > 0
        ? "Coin Metrics Community"
        : glassnodeMetrics?.mvrvSeries?.length > 0
          ? "Glassnode"
          : "Blockchain.com";
  }

  if (resolvedMvrvSeries.length > 0) {
    metrics["price-vs-realized-price"] = buildMetric(
      "price-vs-realized-price",
      resolvedMvrvSeries,
      `${formatRatio(resolvedMvrvSeries.at(-1)?.value ?? 0, 2)}x`,
      realizedPriceUsd ? `Spot ${formatUsd(latestSpot, 0)} vs realized ${formatUsd(realizedPriceUsd, 0)}` : "Spot / realized price proxy",
      glassnodeMetrics?.realizedPriceSeries?.length > 0
        ? "Glassnode"
        : coinMetricsMvrvSeries.length > 0
          ? "Coin Metrics Community + CoinGecko derived"
          : "Blockchain.com proxy",
      {
        dataMode:
          glassnodeMetrics?.realizedPriceSeries?.length > 0 || coinMetricsMvrvSeries.length > 0 ? "derived" : "approx",
      },
    );
  }

  if (resolvedPuellSeries.length > 0) {
    metrics["puell-multiple"] = buildPuellMetric(resolvedPuellSeries);
  }

  if (resolvedPiCycleSeries.length > 0) {
    metrics["pi-cycle-top"] = buildPiMetric(resolvedPiCycleSeries);
  }

  if (resolvedMayerSeries.length > 0) {
    metrics["mayer-multiple"] = buildMayerMetric(resolvedMayerSeries);
  }

  if (resolvedTwoYearSeries.length > 0) {
    const latestTwoYearAverage = price730DayAverage.at(-1)?.value ?? latestSpot;
    metrics["2-year-ma-multiplier"] = buildTwoYearMetric(
      resolvedTwoYearSeries,
      latestTwoYearAverage > 0 ? latestSpot / latestTwoYearAverage : 0,
    );
  }

  if (resolvedPowerLawSeries.length > 0) {
    metrics["power-law"] = buildPowerLawMetric(resolvedPowerLawSeries);
  }

  if (resolvedStockToFlowSeries.length > 0) {
    metrics["stock-to-flow"] = buildStockToFlowMetric(resolvedStockToFlowSeries);
  }

  if (resolvedActiveSupplySeries.length > 0) {
    metrics["active-supply"] = buildMetric(
      "active-supply",
      resolvedActiveSupplySeries,
      `${formatRatio(resolvedActiveSupplySeries.at(-1)?.value ?? 0, 2)}%`,
      "BTC transfer volume / circulating supply",
      "Blockchain.com derived",
      {
        dataMode: "derived",
      },
    );
  } else if (previousSnapshot?.metrics?.["active-supply"]) {
    metrics["active-supply"] = {
      ...previousSnapshot.metrics["active-supply"],
      metricId: "active-supply",
      deltaLabel: "BTC transfer volume / circulating supply",
      sourceLabel: "Blockchain.com derived",
      dataMode: "derived",
    };
  }

  if (resolvedActiveAddressesSeries.length > 0) {
    metrics["active-addresses"] = buildMetric(
      "active-addresses",
      resolvedActiveAddressesSeries,
      formatCompact(resolvedActiveAddressesSeries.at(-1)?.value ?? 0, 0),
      "Unique active addresses",
      coinMetricsActiveAddressesSeries.length > 0 ? "Coin Metrics Community" : "Blockchain.com",
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

  if (resolvedHashRibbonSeries.length > 0) {
    metrics["hash-ribbon"] = buildHashRibbonMetric(resolvedHashRibbonSeries);
  }

  if (resolvedNvtSignalSeries.length > 0) {
    metrics["nvt-signal"] = buildNvtMetric(resolvedNvtSignalSeries);
  } else if (previousSnapshot?.metrics?.["nvt-signal"]) {
    metrics["nvt-signal"] = {
      ...previousSnapshot.metrics["nvt-signal"],
      metricId: "nvt-signal",
      deltaLabel: "Network value to transactions signal",
      sourceLabel: "Blockchain.com",
      dataMode: "live",
    };
  }

  if (rateProbabilityRows.length > 0) {
    const currentMidpoint = Number(rateProbability?.today?.midpoint ?? 0);
    const nextMeeting = rateProbabilityRows[0];
    const nextChangeBps = Number.isFinite(nextMeeting?.change_bps)
      ? Number(nextMeeting.change_bps)
      : ((nextMeeting?.impliedRate ?? currentMidpoint) - currentMidpoint) * 100;
    const cutOdds = normalizePercentValue(nextMeeting?.prob_is_cut);
    const moveOdds = normalizePercentValue(nextMeeting?.prob_move_pct);
    const latestRate = rateProbabilityRows.at(-1)?.impliedRate ?? currentMidpoint;

    metrics["fed-rate-expectations"] = buildMetric(
      "fed-rate-expectations",
      rateProbabilityRows.map((row) => ({
        timestamp: row.timestamp,
        value: row.impliedRate,
      })),
      nextChangeBps < 0 ? `${Math.round(cutOdds || moveOdds)}% cut odds` : nextChangeBps > 0 ? `${Math.round(moveOdds)}% hike odds` : "Hold favored",
      `${rateProbabilityRows[0]?.meeting ?? "Next meeting"} | terminal ${formatRatio(latestRate, 2)}%`,
      "Rate Probability",
      {
        status: evaluateMetricStatus("fed-rate-expectations", latestRate, currentMidpoint || latestRate, {
          currentMidpoint,
        }),
        dataMode: "live",
      },
    );
  } else if (fedRateExpectationSeries.length > 0) {
    warnings.push("Fed Rate Expectations fell back to a FRED proxy because the public meeting-probability feed was unavailable.");
    metrics["fed-rate-expectations"] = buildMetric(
      "fed-rate-expectations",
      fedRateExpectationSeries,
      Math.round((fedRateExpectationSeries.at(-1)?.value ?? 0) * 100) < 0
        ? `${Math.abs(Math.round((fedRateExpectationSeries.at(-1)?.value ?? 0) * 100))} bps cuts priced`
        : `${Math.abs(Math.round((fedRateExpectationSeries.at(-1)?.value ?? 0) * 100))} bps hikes priced`,
      "1Y Treasury minus effective fed funds proxy",
      "FRED yield-curve proxy",
      {
        dataMode: "approx",
      },
    );
  }

  if (effectiveAsoprSeries.length > 0) {
    metrics.asopr = buildMetric(
      "asopr",
      effectiveAsoprSeries,
      formatRatio(effectiveAsoprSeries.at(-1)?.value ?? 0, 3),
      glassnodeMetrics?.asoprSeries?.length > 0
        ? "Adjusted SOPR"
        : asoprIsExact
          ? "Adjusted SOPR"
          : "SOPR 7D proxy while aSOPR is unavailable",
      glassnodeMetrics?.asoprSeries?.length > 0 ? "Glassnode" : asoprIsExact ? "bitcoin-data.com" : "BGeometrics SOPR proxy",
      {
        dataMode: glassnodeMetrics?.asoprSeries?.length > 0 ? "live" : asoprIsExact ? "live" : "approx",
      },
    );
  }

  if (effectiveExchangeNetflowSeries.length > 0) {
    metrics["exchange-netflow"] = buildMetric(
      "exchange-netflow",
      effectiveExchangeNetflowSeries,
      formatBtc(effectiveExchangeNetflowSeries.at(-1)?.value ?? 0, 1),
      coinMetricsExchangeNetflowSeries.length > 0
        ? "Net BTC flow into and out of exchanges"
        : glassnodeMetrics?.exchangeNetflowSeries?.length > 0
        ? "Net BTC flow into and out of exchanges"
        : "STH supply day-over-day proxy for exchange flow",
      coinMetricsExchangeNetflowSeries.length > 0
        ? "Coin Metrics Community"
        : glassnodeMetrics?.exchangeNetflowSeries?.length > 0
        ? "Glassnode"
        : "BGeometrics liquid-supply proxy (Glassnode unavailable)",
      {
        dataMode: coinMetricsExchangeNetflowSeries.length > 0 || glassnodeMetrics?.exchangeNetflowSeries?.length > 0 ? "live" : "approx",
      },
    );
  }

  if (effectiveExchangeBalanceSeries.length > 0) {
    metrics["exchange-balance"] = buildMetric(
      "exchange-balance",
      effectiveExchangeBalanceSeries,
      formatBtc(effectiveExchangeBalanceSeries.at(-1)?.value ?? 0, 1),
      coinMetricsExchangeBalanceSeries.length > 0
        ? "BTC balance held on exchanges"
        : glassnodeMetrics?.exchangeBalanceSeries?.length > 0
        ? "BTC balance held on exchanges"
        : "STH supply proxy for exchange-ready BTC",
      coinMetricsExchangeBalanceSeries.length > 0
        ? "Coin Metrics Community"
        : glassnodeMetrics?.exchangeBalanceSeries?.length > 0
        ? "Glassnode"
        : "BGeometrics liquid-supply proxy (Glassnode unavailable)",
      {
        dataMode:
          coinMetricsExchangeBalanceSeries.length > 0 || glassnodeMetrics?.exchangeBalanceSeries?.length > 0
            ? "live"
            : "approx",
      },
    );
  }

  if (effectivePercentSupplyInProfitSeries.length > 0) {
    metrics["percent-supply-in-profit"] = buildMetric(
      "percent-supply-in-profit",
      effectivePercentSupplyInProfitSeries,
      `${formatRatio(effectivePercentSupplyInProfitSeries.at(-1)?.value ?? 0, 1)}%`,
      "Percent of BTC supply currently in profit",
      glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0
        ? "Glassnode"
        : bgeometricsCohortMetrics?.supplyProfitSeries?.length > 0
          ? "BGeometrics MCP"
        : "BGeometrics fallback (Glassnode unavailable)",
      {
        dataMode:
          glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0
            ? "live"
            : bgeometricsCohortMetrics?.supplyProfitSeries?.length > 0
              ? "derived"
              : "scraped",
      },
    );
  }

  if (effectiveReserveRiskSeries.length > 0) {
    metrics["reserve-risk"] = buildMetric(
      "reserve-risk",
      effectiveReserveRiskSeries,
      formatRatio(effectiveReserveRiskSeries.at(-1)?.value ?? 0, 4),
      "Long-term holder opportunity-cost model",
      glassnodeMetrics?.reserveRiskSeries?.length > 0
        ? "Glassnode"
        : bgeometricsCohortMetrics?.reserveRiskSeries?.length > 0
          ? "BGeometrics MCP"
        : "BGeometrics fallback (Glassnode unavailable)",
      {
        dataMode:
          glassnodeMetrics?.reserveRiskSeries?.length > 0 || bgeometricsCohortMetrics?.reserveRiskSeries?.length > 0
            ? "live"
            : "scraped",
      },
    );
  }

  if (effectiveLthSupplySeries.length > 0) {
    metrics["lth-supply"] = buildMetric(
      "lth-supply",
      effectiveLthSupplySeries,
      formatBtc(effectiveLthSupplySeries.at(-1)?.value ?? 0, 1),
      "BTC held by long-term holders",
      glassnodeMetrics?.lthSupplySeries?.length > 0
        ? "Glassnode"
        : bgeometricsCohortMetrics?.lthSupplySeries?.length > 0
          ? "BGeometrics MCP"
        : "BGeometrics fallback (Glassnode unavailable)",
      {
        dataMode:
          glassnodeMetrics?.lthSupplySeries?.length > 0 || bgeometricsCohortMetrics?.lthSupplySeries?.length > 0
            ? "live"
            : "scraped",
      },
    );
  }

  if (effectiveSthSupplySeries.length > 0) {
    metrics["sth-supply"] = buildMetric(
      "sth-supply",
      effectiveSthSupplySeries,
      formatBtc(effectiveSthSupplySeries.at(-1)?.value ?? 0, 1),
      "BTC held by short-term holders",
      glassnodeMetrics?.sthSupplySeries?.length > 0
        ? "Glassnode"
        : bgeometricsCohortMetrics?.sthSupplySeries?.length > 0
          ? "BGeometrics MCP"
        : "BGeometrics fallback (Glassnode unavailable)",
      {
        dataMode:
          glassnodeMetrics?.sthSupplySeries?.length > 0 || bgeometricsCohortMetrics?.sthSupplySeries?.length > 0
            ? "live"
            : "scraped",
      },
    );
  }

  if (lthNetPositionChangeSeries.length > 0) {
    metrics["lth-net-position-change"] = buildMetric(
      "lth-net-position-change",
      lthNetPositionChangeSeries,
      formatBtc(lthNetPositionChangeSeries.at(-1)?.value ?? 0, 1),
      glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0 || bgeometricsCohortMetrics?.lthNetPositionChangeSeries?.length > 0
        ? "30D change in long-term holder supply"
        : "Derived 30D change in long-term holder supply",
      glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0
        ? "Glassnode"
        : bgeometricsCohortMetrics?.lthNetPositionChangeSeries?.length > 0
          ? "BGeometrics MCP"
        : "BGeometrics derived proxy (Glassnode unavailable)",
      {
        dataMode:
          glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0 || bgeometricsCohortMetrics?.lthNetPositionChangeSeries?.length > 0
            ? "live"
            : "approx",
      },
    );
  }

  if (effectiveLivelinessSeries.length > 0) {
    metrics.liveliness = buildMetric(
      "liveliness",
      effectiveLivelinessSeries,
      formatRatio(effectiveLivelinessSeries.at(-1)?.value ?? 0, 4),
      "Old-coin spending vs holding behavior",
      glassnodeMetrics?.livelinessSeries?.length > 0
        ? "Glassnode"
        : bgeometricsCohortMetrics?.livelinessSeries?.length > 0
          ? "BGeometrics MCP"
        : "BGeometrics fallback (Glassnode unavailable)",
      {
        dataMode:
          glassnodeMetrics?.livelinessSeries?.length > 0 || bgeometricsCohortMetrics?.livelinessSeries?.length > 0
            ? "live"
            : "scraped",
      },
    );
  }

  if (nuplSeries.length > 0) {
    metrics.nupl = buildMetric(
      "nupl",
      nuplSeries,
      formatRatio(nuplSeries.at(-1)?.value ?? 0, 2),
      "Net unrealized profit / loss",
      "BGeometrics",
      {
        dataMode: "scraped",
      },
    );
  }

  if (lthNuplSeries.length > 0) {
    metrics["lth-nupl"] = buildMetric(
      "lth-nupl",
      lthNuplSeries,
      formatRatio(lthNuplSeries.at(-1)?.value ?? 0, 2),
      "Derived from public LTH MVRV",
      "BGeometrics cohort proxy",
      {
        dataMode: "approx",
      },
    );
  }

  if (sthNuplSeries.length > 0) {
    metrics["sth-nupl"] = buildMetric(
      "sth-nupl",
      sthNuplSeries,
      formatRatio(sthNuplSeries.at(-1)?.value ?? 0, 2),
      "Derived from public STH MVRV",
      "BGeometrics cohort proxy",
      {
        dataMode: "approx",
      },
    );
  }

  if (rhodlRatioSeries.length > 0) {
    metrics["rhodl-ratio"] = buildMetric(
      "rhodl-ratio",
      rhodlRatioSeries,
      formatCompact(rhodlRatioSeries.at(-1)?.value ?? 0, 1),
      "1M smoothed RHODL ratio",
      "BGeometrics",
      {
        dataMode: "scraped",
      },
    );
  }

  if (oldSupplyShareSeries.length > 0) {
    metrics["hodl-waves"] = buildMetric(
      "hodl-waves",
      oldSupplyShareSeries,
      formatUnsignedPercent(oldSupplyShareSeries.at(-1)?.value ?? 0, 1),
      "Share of supply dormant for 1 year or more",
      "BGeometrics derived from age bands",
      {
        dataMode: "approx",
      },
    );
  }

  if (cddHistory.length > 0) {
    metrics.cdd = buildMetric(
      "cdd",
      cddHistory,
      formatBtcDays(cddHistory.at(-1)?.value ?? 0, 1),
      `${formatRatio(daysDestroyedPerBtc ?? 0, 4)} days destroyed per BTC`,
      "BitInfoCharts derived",
      {
        asOf: generatedAt,
        dataMode: "scraped",
      },
    );
  }

  if (dormancyHistory.length > 0) {
    metrics.dormancy = buildMetric(
      "dormancy",
      dormancyHistory,
      `${formatRatio(dormancyHistory.at(-1)?.value ?? 0, 1)}d`,
      "Derived from days destroyed / BTC sent",
      "BitInfoCharts derived",
      {
        asOf: generatedAt,
        dataMode: "approx",
      },
    );
  }

  if (etfFlowSeries.length > 0) {
    metrics["spot-btc-etf-flows"] = buildMetric(
      "spot-btc-etf-flows",
      etfFlowSeries,
      formatBtc(etfFlowSeries.at(-1)?.value ?? 0, 1),
      "Daily net spot ETF flow",
      "BGeometrics",
      {
        dataMode: "scraped",
      },
    );
  }

  if (etfHoldingsSeries.length > 0) {
    metrics["spot-btc-etf-holdings"] = buildMetric(
      "spot-btc-etf-holdings",
      etfHoldingsSeries,
      formatBtc(etfHoldingsSeries.at(-1)?.value ?? 0, 1),
      "Total BTC held by spot ETFs",
      "BGeometrics",
      {
        dataMode: "scraped",
      },
    );
  }

  if (Object.keys(metrics).length === 0 && !previousSnapshot?.metrics) {
    throw new Error("Daily group refresh produced no metrics.");
  }

  if (fearGreedSeries.length === 0) {
    warnings.push("Fear & Greed was unavailable during the latest daily refresh.");
  }
  if (lthNuplSeries.length > 0 || sthNuplSeries.length > 0) {
    warnings.push("LTH-NUPL and STH-NUPL are currently derived from public cohort MVRV series.");
  }
  if (!hasGlassnodeCohortMetrics && !hasCoinMetricsExchangeMetrics && !hasBGeometricsLiveCohortMetrics) {
    warnings.push(
      "Glassnode cohort metrics are unavailable, so Exchange Netflow, Exchange Reserve, LTH Supply, STH Supply, LTH Net Position Change, Reserve Risk, Liveliness, and Percent Supply in Profit are currently using fallback proxy or scraped sources.",
    );
  } else if (!hasGlassnodeCohortMetrics && hasCoinMetricsExchangeMetrics && !hasBGeometricsLiveCohortMetrics) {
    warnings.push(
      "Coin Metrics Community is now supplying Exchange Netflow and Exchange Reserve, but LTH Supply, STH Supply, LTH Net Position Change, Reserve Risk, Liveliness, and Percent Supply in Profit still require fallback sources while Glassnode cohort metrics are unavailable.",
    );
  } else if (!hasGlassnodeCohortMetrics && hasBGeometricsLiveCohortMetrics) {
    warnings.push(
      "BGeometrics MCP is now supplying LTH Supply, STH Supply, Reserve Risk, Liveliness, and the supply-in-profit input series, while any remaining cohort gaps continue to use fallback sources when Glassnode is unavailable.",
    );
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
