import { estimateCycleAnalog } from "./cycle-analog.mjs";
import { estimateCyclePosition } from "./cycle-estimate.mjs";
import { CACHE_GROUPS, getMetricIdsForGroup } from "./dashboard-cache-shared.mjs";
import { fetchRecentRedditSentiment, redditSentimentStatus } from "./reddit-sentiment.mjs";
import { appendHistory, readHistory } from "./dashboard-storage.mjs";
import {
  buildMetric,
  combineSeries,
  deriveLaggedDelta,
  fetchBGeometricsPlotlySeries,
  fetchBGeometricsSeries,
  fetchGlassnodeMetricsBundle,
  fetchBitcoinDataSeries,
  fetchBitInfoSnapshot,
  fetchBlockchainChart,
  fetchBlockchainMvrvSeries,
  fetchCoinGeckoMarkets,
  fetchCoinGeckoPrice,
  fetchFearAndGreedIndex,
  fetchFREDSeries,
  fetchMempoolDifficulty,
  fetchRateProbability,
  formatBtc,
  formatBtcDays,
  formatCompact,
  formatDifficulty,
  formatEhFromTh,
  formatPercent,
  formatRatio,
  formatUnsignedPercent,
  formatUsd,
  inferStatus,
  inferTrend,
  normalizePercentValue,
  rollingAverage,
  safePoints,
  sumSeries,
  toSeries,
} from "./dashboard-source-utils.mjs";

const SNAPSHOT_HISTORY_LIMIT = 180;

const DAILY_BASE_WARNINGS = [
  "Some snapshot-style metrics build their sparkline history locally from repeated cache refreshes.",
];

function dedupeStrings(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function isPhaseWindowCycleAnalog(cycleAnalog) {
  return (
    cycleAnalog?.methodology === "phase-window-nearest-neighbor" &&
    Array.isArray(cycleAnalog?.perCycleMatches)
  );
}

function mergeHistoryPoints(points, point, maxPoints = SNAPSHOT_HISTORY_LIMIT) {
  if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.value)) {
    return points ?? [];
  }

  const nextPoints = [...(points ?? [])];
  const last = nextPoints.at(-1);

  if (last && Math.abs(last.timestamp - point.timestamp) < 30 * 60 * 1000) {
    nextPoints[nextPoints.length - 1] = point;
  } else {
    nextPoints.push(point);
  }

  return nextPoints.slice(-maxPoints);
}

function seriesFromHistoryPoints(points, fallbackPoint) {
  const normalized = points?.length ? points : fallbackPoint ? [fallbackPoint] : [];
  return normalized.slice(-12).map((point) => point.value);
}

async function recordHistoryPoint(metricId, point, options = {}) {
  const persist = options.persist !== false;
  const localHistory = options.localHistory ?? {};
  const current =
    localHistory[metricId] ??
    (options.existingHistory?.[metricId] ?? (await readHistory(metricId)));

  if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.value)) {
    localHistory[metricId] = current;
    return current;
  }

  if (persist) {
    const next = await appendHistory(metricId, point, options.maxPoints ?? SNAPSHOT_HISTORY_LIMIT);
    localHistory[metricId] = next;
    return next;
  }

  const next = mergeHistoryPoints(current, point, options.maxPoints ?? SNAPSHOT_HISTORY_LIMIT);
  localHistory[metricId] = next;
  return next;
}

function createSnapshot(groupId, options = {}) {
  const config = CACHE_GROUPS[groupId];
  const previousSnapshot = options.previousSnapshot ?? null;
  const generatedAt = options.generatedAt ?? Date.now();
  const nextMetrics = {
    ...(previousSnapshot?.metrics ?? {}),
    ...(options.metrics ?? {}),
  };
  const nextSummary = {
    ...(previousSnapshot?.summary ?? {}),
    ...(options.summary ?? {}),
  };
  const nextContext = {
    ...(previousSnapshot?.context ?? {}),
    ...(options.context ?? {}),
    syntheticInputs: {
      ...(previousSnapshot?.context?.syntheticInputs ?? {}),
      ...(options.context?.syntheticInputs ?? {}),
    },
  };
  const warnings =
    options.warnings !== undefined
      ? dedupeStrings(options.warnings)
      : dedupeStrings(previousSnapshot?.warnings ?? []);
  const metricIds = options.metricIds ?? previousSnapshot?.metricIds ?? getMetricIdsForGroup(groupId);
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
    context: nextContext,
  };
}

function buildSnapshotMetric(metricId, metric, fallbackPoint) {
  const latest = fallbackPoint?.value ?? 0;
  const previous = fallbackPoint?.previous ?? latest;

  return {
    ...metric,
    metricId,
    currentValue: metric.currentValue,
    deltaLabel: metric.deltaLabel,
    sourceLabel: metric.sourceLabel,
    trend: metric.trend ?? inferTrend(latest, previous),
    status: metric.status ?? inferStatus(metricId, latest, previous),
    series: metric.series,
    isLive: true,
    asOf: metric.asOf,
    dataMode: metric.dataMode ?? "approx",
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

function buildHistoryTrend(points, fallbackValue) {
  const latest = points.at(-1)?.value ?? fallbackValue;
  const previous = points.at(-2)?.value ?? latest;

  return {
    latest,
    previous,
    trend: inferTrend(latest, previous),
  };
}

function normalizeRateProbabilityRows(rateProbability) {
  return (rateProbability?.today?.rows ?? rateProbability?.rows ?? [])
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
}

export async function refreshFastGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const dailySnapshot = options.groupSnapshots?.daily ?? null;
  const warnings = [];
  const localHistory = {};
  const [coingecko, markets, fearGreedSeries, rateProbability, redditSentiment] = await Promise.all([
    fetchCoinGeckoPrice(),
    safePoints(() => fetchCoinGeckoMarkets()),
    safePoints(() => fetchFearAndGreedIndex()),
    fetchRateProbability().catch(() => null),
    fetchRecentRedditSentiment({ now: generatedAt }).catch(() => null),
  ]);

  let oneYearTreasury = [];
  let fedFundsEffective = [];
  const rateProbabilityRows = normalizeRateProbabilityRows(rateProbability);

  if (!rateProbabilityRows.length) {
    warnings.push("Fed Rate Expectations fell back to a FRED proxy because the public meeting-probability feed was unavailable.");
    [oneYearTreasury, fedFundsEffective] = await Promise.all([
      safePoints(() => fetchFREDSeries("DGS1")),
      safePoints(() => fetchFREDSeries("DFF")),
    ]);
  }

  const btcPrice = Number(coingecko?.bitcoin?.usd ?? 0);
  const btcChange = Number(coingecko?.bitcoin?.usd_24h_change ?? 0);
  const priceAsOf = Number(coingecko?.bitcoin?.last_updated_at ?? 0) * 1000 || generatedAt;
  const dailyRealizedPrice = Number(dailySnapshot?.context?.realizedPriceUsd ?? 0) || null;
  const dailyMvrv = Number(dailySnapshot?.context?.latestMvrv ?? 0) || null;
  const priceVsRealizedValue = dailyRealizedPrice && btcPrice > 0 ? btcPrice / dailyRealizedPrice : dailyMvrv;
  const priceVsRealizedHistory = priceVsRealizedValue
    ? await recordHistoryPoint(
        "price-vs-realized-price",
        {
          timestamp: priceAsOf,
          value: priceVsRealizedValue,
        },
        {
          persist: options.persist,
          localHistory,
        },
      )
    : await readHistory("price-vs-realized-price");
  const priceHistoryContext = buildHistoryTrend(priceVsRealizedHistory, priceVsRealizedValue ?? btcPrice);
  const bitcoinMarketCap = markets.find((asset) => asset.id === "bitcoin")?.market_cap ?? 0;
  const stablecoinMarketCap = markets
    .filter((asset) => asset.id !== "bitcoin")
    .reduce((sum, asset) => sum + (asset.market_cap ?? 0), 0);
  const ssrValue = bitcoinMarketCap > 0 && stablecoinMarketCap > 0 ? bitcoinMarketCap / stablecoinMarketCap : null;
  const ssrHistory = ssrValue
    ? await recordHistoryPoint(
        "ssr",
        {
          timestamp: priceAsOf,
          value: ssrValue,
        },
        {
          persist: options.persist,
          localHistory,
        },
      )
    : await readHistory("ssr");
  const ssrHistoryContext = buildHistoryTrend(ssrHistory, ssrValue ?? 0);
  const fedRateExpectationSeries = combineSeries(oneYearTreasury, fedFundsEffective, (dgs1, dff) => dgs1 - dff);
  const metrics = {};

  if (btcPrice > 0) {
    metrics["price-vs-realized-price"] = buildSnapshotMetric(
      "price-vs-realized-price",
      {
        currentValue: priceVsRealizedValue ? `${formatRatio(priceVsRealizedValue, 2)}x` : formatUsd(btcPrice, 0),
        deltaLabel:
          priceVsRealizedValue && dailyRealizedPrice
            ? `Spot ${formatUsd(btcPrice, 0)} vs realized ${formatUsd(dailyRealizedPrice, 0)}`
            : `Proxy only: BTC spot ${formatPercent(btcChange)} over 24h`,
        sourceLabel: priceVsRealizedValue ? "CoinGecko spot + stored realized price" : "CoinGecko proxy",
        trend: priceVsRealizedValue ? priceHistoryContext.trend : btcChange >= 0 ? "up" : "down",
        status: priceVsRealizedValue
          ? priceVsRealizedValue >= 1
            ? "bullish"
            : "bearish"
          : btcChange >= 0
            ? "bullish"
            : "bearish",
        series: seriesFromHistoryPoints(
          priceVsRealizedHistory,
          priceVsRealizedValue
            ? {
                timestamp: priceAsOf,
                value: priceVsRealizedValue,
              }
            : null,
        ),
        asOf: priceAsOf,
        dataMode: priceVsRealizedValue ? "scraped" : "approx",
      },
      {
        value: priceHistoryContext.latest,
        previous: priceHistoryContext.previous,
      },
    );
  }

  if (fearGreedSeries.length > 0) {
    metrics["fear-and-greed"] = {
      metricId: "fear-and-greed",
      currentValue: formatCompact(fearGreedSeries.at(-1)?.value ?? 0, 0),
      deltaLabel: fearGreedSeries.at(-1)?.classification ?? "Sentiment index",
      sourceLabel: "Alternative.me",
      trend: inferTrend(
        fearGreedSeries.at(-1)?.value ?? 0,
        fearGreedSeries.at(-2)?.value ?? fearGreedSeries.at(-1)?.value ?? 0,
      ),
      status:
        (fearGreedSeries.at(-1)?.value ?? 0) < 25
          ? "bullish"
          : (fearGreedSeries.at(-1)?.value ?? 0) > 75
            ? "bearish"
            : "neutral",
      series: toSeries(fearGreedSeries),
      isLive: true,
      asOf: fearGreedSeries.at(-1)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (redditSentiment?.fallbackReason) {
    warnings.push(redditSentiment.fallbackReason);
  }

  if (redditSentiment?.score !== undefined) {
    const redditHistory = await recordHistoryPoint(
      "recent-reddit-sentiment",
      {
        timestamp: generatedAt,
        value: Number(redditSentiment.score),
      },
      {
        persist: options.persist,
        localHistory,
      },
    );
    const redditHistoryContext = buildHistoryTrend(redditHistory, Number(redditSentiment.score));

    metrics["recent-reddit-sentiment"] = buildSnapshotMetric(
      "recent-reddit-sentiment",
      {
        currentValue: `${Math.round(Number(redditSentiment.score))}/100`,
        deltaLabel: `${redditSentiment.label} | ${redditSentiment.postCount} posts • ${redditSentiment.commentCount} comments`,
        sourceLabel:
          redditSentiment.source === "llm"
            ? `PullPush + ${redditSentiment.model ?? "OpenAI"}`
            : "PullPush + heuristic synthesis",
        trend: redditHistoryContext.trend,
        status: redditSentimentStatus(Number(redditSentiment.score)),
        series: seriesFromHistoryPoints(redditHistory, {
          timestamp: generatedAt,
          value: Number(redditSentiment.score),
        }),
        asOf: redditSentiment.sourceAsOf ?? redditSentiment.asOf ?? generatedAt,
        dataMode: redditSentiment.source === "llm" ? "scraped" : "approx",
        details: {
          summary: redditSentiment.summary,
          methodology: redditSentiment.methodology,
          drivers: redditSentiment.drivers,
          risks: redditSentiment.risks,
          opportunities: redditSentiment.opportunities,
          subreddits: redditSentiment.subreddits,
          stats: [
            { label: "Window", value: "48 hours" },
            { label: "Posts sampled", value: String(redditSentiment.postCount) },
            { label: "Comments sampled", value: String(redditSentiment.commentCount) },
            ...(Number.isFinite(redditSentiment.freshestSourceAgeHours)
              ? [
                  {
                    label: "Newest source age",
                    value: `${redditSentiment.freshestSourceAgeHours}h`,
                  },
                ]
              : []),
          ],
          samplePosts: (redditSentiment.samplePosts ?? []).map((post) => ({
            subreddit: `r/${post.subreddit}`,
            title: post.title,
            score: post.score,
            url: post.permalink ?? post.url,
          })),
          sampleComments: (redditSentiment.sampleComments ?? []).map((comment) => ({
            subreddit: `r/${comment.subreddit}`,
            body: comment.body,
            score: comment.score,
            url: comment.permalink ?? comment.url,
          })),
        },
      },
      {
        value: redditHistoryContext.latest,
        previous: redditHistoryContext.previous,
      },
    );
  }

  if (ssrValue) {
    metrics.ssr = buildSnapshotMetric(
      "ssr",
      {
        currentValue: formatRatio(ssrValue, 2),
        deltaLabel: "Approx from major stablecoin market caps",
        sourceLabel: "CoinGecko proxy",
        status: ssrValue < 10 ? "bullish" : ssrValue < 14 ? "neutral" : "bearish",
        series: seriesFromHistoryPoints(ssrHistory, {
          timestamp: priceAsOf,
          value: ssrValue,
        }),
        asOf: priceAsOf,
        dataMode: "approx",
      },
      {
        value: ssrHistoryContext.latest,
        previous: ssrHistoryContext.previous,
      },
    );
  }

  if (rateProbabilityRows.length > 0) {
    const currentMidpoint = Number(rateProbability?.today?.midpoint ?? 0);
    const nextMeeting = rateProbabilityRows[0];
    const nextChangeBps = Number.isFinite(nextMeeting?.change_bps)
      ? Number(nextMeeting.change_bps)
      : ((nextMeeting?.impliedRate ?? currentMidpoint) - currentMidpoint) * 100;
    const cutOdds = normalizePercentValue(nextMeeting?.prob_is_cut);
    const moveOdds = normalizePercentValue(nextMeeting?.prob_move_pct);

    metrics["fed-rate-expectations"] = {
      metricId: "fed-rate-expectations",
      currentValue:
        nextChangeBps < 0
          ? `${Math.round(cutOdds || moveOdds)}% cut odds`
          : nextChangeBps > 0
            ? `${Math.round(moveOdds)}% hike odds`
            : "Hold favored",
      deltaLabel: `${rateProbabilityRows[0]?.meeting ?? "Next meeting"} | terminal ${formatRatio(rateProbabilityRows.at(-1)?.impliedRate ?? 0, 2)}%`,
      sourceLabel: "Rate Probability",
      trend: inferTrend(rateProbabilityRows.at(-1)?.impliedRate ?? 0, currentMidpoint),
      status:
        (rateProbabilityRows.at(-1)?.impliedRate ?? 0) < currentMidpoint - 0.125
          ? "bullish"
          : (rateProbabilityRows.at(-1)?.impliedRate ?? 0) > currentMidpoint + 0.125
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
    };
  } else if (fedRateExpectationSeries.length > 0) {
    metrics["fed-rate-expectations"] = {
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
      asOf: fedRateExpectationSeries.at(-1)?.timestamp ?? generatedAt,
      dataMode: "approx",
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
      btcPrice: btcPrice > 0 ? formatUsd(btcPrice, 0) : previousSnapshot?.summary?.btcPrice,
      btcPriceChange: btcPrice > 0 ? `${formatPercent(btcChange)} 24h` : previousSnapshot?.summary?.btcPriceChange,
    },
    context: {
      btcPriceUsd: btcPrice > 0 ? btcPrice : previousSnapshot?.context?.btcPriceUsd,
      btcPriceAsOf: btcPrice > 0 ? priceAsOf : previousSnapshot?.context?.btcPriceAsOf,
    },
  });
}

export async function refreshDailyGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const warnings = [...DAILY_BASE_WARNINGS];
  const localHistory = {};
  const [
    priceSeries,
    longPriceSeries,
    totalBitcoinsLongSeries,
    transactionVolumeBtc,
    totalBitcoins,
    activeAddresses,
    transferVolume,
    hashrate,
    difficultySeries,
    mempoolDifficulty,
    mvrvSeries,
    nuplSeries,
    minerRevenueSeries,
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
    nvtSignalSeries,
    nvtSignalHighSeries,
    nvtSignalLowSeries,
    openInterestSeries,
    powerLawSeries,
    powerLawFloorSeries,
    powerLawTopSeries,
    etfFlowSeries,
    etfHoldingsSeries,
    asoprSeries,
    soprProxySeries,
    fundingRateSeries,
    bitInfoSnapshot,
    glassnodeMetrics,
  ] = await Promise.all([
    safePoints(() => fetchBlockchainChart("market-price", "30days")),
    safePoints(() => fetchBlockchainChart("market-price", "730days")),
    safePoints(() => fetchBlockchainChart("total-bitcoins", "730days")),
    safePoints(() => fetchBlockchainChart("estimated-transaction-volume", "30days")),
    safePoints(() => fetchBlockchainChart("total-bitcoins", "30days")),
    safePoints(() => fetchBlockchainChart("n-unique-addresses", "30days")),
    safePoints(() => fetchBlockchainChart("estimated-transaction-volume-usd", "30days")),
    safePoints(() => fetchBlockchainChart("hash-rate", "90days")),
    safePoints(() => fetchBlockchainChart("difficulty", "90days")),
    fetchMempoolDifficulty().catch(() => null),
    safePoints(() => fetchBlockchainMvrvSeries()),
    safePoints(() => fetchBGeometricsPlotlySeries("/reports/bitcoin_nupl_g.html", "NUPL")),
    safePoints(() => fetchBlockchainChart("miners-revenue", "1year")),
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
    safePoints(() => fetchBGeometricsSeries("/files/nvts_bg.json")),
    safePoints(() => fetchBGeometricsSeries("/files/nvts_730dma_high_bg.json")),
    safePoints(() => fetchBGeometricsSeries("/files/nvts_730dma_low_bg.json")),
    safePoints(() => fetchBGeometricsSeries("/files/oi_total.json")),
    safePoints(() => fetchBGeometricsSeries("/files/power_law.json")),
    safePoints(() => fetchBGeometricsSeries("/files/power_law_floor.json")),
    safePoints(() => fetchBGeometricsSeries("/files/power_law_top.json")),
    safePoints(() => fetchBGeometricsSeries("/files/flow_btc_etf_btc.json")),
    safePoints(() => fetchBGeometricsSeries("/files/total_btc_etf_btc.json")),
    safePoints(() => fetchBitcoinDataSeries("/v1/asopr", "asopr")),
    safePoints(() => fetchBGeometricsSeries("/files/sopr_7sma.json")),
    safePoints(() => fetchBGeometricsSeries("/files/funding_rate_7sma.json")),
    fetchBitInfoSnapshot().catch(() => ({})),
    fetchGlassnodeMetricsBundle().catch(() => null),
  ]);

  const currentBtcPrice = priceSeries.at(-1)?.value ?? longPriceSeries.at(-1)?.value ?? 0;
  const effectiveMvrvSeries =
    glassnodeMetrics?.mvrvSeries?.length > 0 ? glassnodeMetrics.mvrvSeries : mvrvSeries;
  const effectivePercentSupplyInProfitSeries =
    glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0
      ? glassnodeMetrics.percentSupplyInProfitSeries.map((point) => ({
          timestamp: point.timestamp,
          value: point.value * 100,
        }))
      : percentSupplyInProfitSeries;
  const effectiveReserveRiskSeries =
    glassnodeMetrics?.reserveRiskSeries?.length > 0 ? glassnodeMetrics.reserveRiskSeries : reserveRiskSeries;
  const effectiveLivelinessSeries =
    glassnodeMetrics?.livelinessSeries?.length > 0 ? glassnodeMetrics.livelinessSeries : livelinessSeries;
  const effectiveLthSupplySeries =
    glassnodeMetrics?.lthSupplySeries?.length > 0 ? glassnodeMetrics.lthSupplySeries : lthSupplySeries;
  const effectiveSthSupplySeries =
    glassnodeMetrics?.sthSupplySeries?.length > 0 ? glassnodeMetrics.sthSupplySeries : sthSupplySeries;
  const effectiveAdjustedTransferVolumeSeries =
    glassnodeMetrics?.adjustedTransferVolumeSeries?.length > 0
      ? glassnodeMetrics.adjustedTransferVolumeSeries
      : transferVolume;
  const latestMvrv = effectiveMvrvSeries.at(-1)?.value ?? null;
  const realizedPriceUsd =
    glassnodeMetrics?.realizedPriceSeries?.at(-1)?.value ??
    (latestMvrv && currentBtcPrice > 0 ? currentBtcPrice / latestMvrv : null);
  const latestSupply = totalBitcoins.at(-1)?.value ?? null;
  const latestTxVolumeBtc = transactionVolumeBtc.at(-1)?.value ?? null;
  const currentBitcoinsSent = bitInfoSnapshot?.bitcoinsSent24h ?? latestTxVolumeBtc;
  const daysDestroyedPerBtc = bitInfoSnapshot?.daysDestroyedPerBtc ?? null;
  const cddValue = daysDestroyedPerBtc && latestSupply ? daysDestroyedPerBtc * latestSupply : null;
  const dormancyValue = cddValue && currentBitcoinsSent ? cddValue / currentBitcoinsSent : null;
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
    value: minerRevenueAverage[index]?.value > 0 ? point.value / minerRevenueAverage[index].value : 0,
  }));
  const latestPuell = puellSeries.at(-1)?.value ?? null;
  const lthNetPositionChangeSeries =
    glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0
      ? glassnodeMetrics.lthNetPositionChangeSeries
      : deriveLaggedDelta(effectiveLthSupplySeries, 30);
  const sthNetPositionChangeSeries = deriveLaggedDelta(effectiveSthSupplySeries, 1);
  const effectiveExchangeNetflowSeries =
    glassnodeMetrics?.exchangeNetflowSeries?.length > 0
      ? glassnodeMetrics.exchangeNetflowSeries
      : sthNetPositionChangeSeries;
  const effectiveExchangeBalanceSeries =
    glassnodeMetrics?.exchangeBalanceSeries?.length > 0
      ? glassnodeMetrics.exchangeBalanceSeries
      : effectiveSthSupplySeries;
  const effectiveAsoprSeries =
    glassnodeMetrics?.asoprSeries?.length > 0
      ? glassnodeMetrics.asoprSeries
      : asoprSeries.length > 0
        ? asoprSeries
        : soprProxySeries;
  const asoprIsExact = asoprSeries.length > 0;
  const fundingRatePercentSeries = fundingRateSeries.map((point) => ({
    timestamp: point.timestamp,
    value: point.value * 100,
  }));
  const price200DayAverage = rollingAverage(longPriceSeries, 200);
  const price730DayAverage = rollingAverage(longPriceSeries, 730);
  const price111DayAverage = rollingAverage(longPriceSeries, 111);
  const price350DayAverage = rollingAverage(longPriceSeries, 350);
  const mayerMultipleSeries = longPriceSeries
    .map((point, index) => {
      if (index < 199 || price200DayAverage[index]?.value <= 0) {
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
  const hashrate30DayAverage = rollingAverage(hashrate, 30);
  const hashrate60DayAverage = rollingAverage(hashrate, 60);
  const hashRibbonSeries = hashrate
    .map((point, index) => {
      if (index < 59 || hashrate60DayAverage[index]?.value <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: hashrate30DayAverage[index].value / hashrate60DayAverage[index].value,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));
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
  const nvtRelativeToHighSeries = combineSeries(
    nvtSignalSeries,
    nvtSignalHighSeries,
    (nvtValue, highValue) => (highValue > 0 ? nvtValue / highValue : 0),
  );
  const powerLawRatioSeries = combineSeries(
    longPriceSeries,
    powerLawSeries,
    (priceValue, modelValue) => (modelValue > 0 ? priceValue / modelValue : 0),
  );
  const powerLawFloorRatioSeries = combineSeries(
    longPriceSeries,
    powerLawFloorSeries,
    (priceValue, floorValue) => (floorValue > 0 ? priceValue / floorValue : 0),
  );
  const powerLawTopRatioSeries = combineSeries(
    longPriceSeries,
    powerLawTopSeries,
    (priceValue, topValue) => (topValue > 0 ? priceValue / topValue : 0),
  );
  const twoYearMaBufferSeries = longPriceSeries
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
  const stockToFlowSeries = totalBitcoinsLongSeries
    .map((point, index) => {
      if (index < 365) {
        return null;
      }

      const annualIssuance = point.value - totalBitcoinsLongSeries[index - 365].value;

      if (annualIssuance <= 0) {
        return null;
      }

      return {
        timestamp: point.timestamp,
        value: point.value / annualIssuance,
      };
    })
    .filter((point) => point !== null && Number.isFinite(point.value));

  if (lthNuplSeries.length || sthNuplSeries.length) {
    warnings.push("LTH-NUPL and STH-NUPL are currently derived from public cohort MVRV series.");
  }

  if (!glassnodeMetrics) {
    warnings.push("Exchange Netflow and Exchange Balance currently use approximation proxies.");
  }

  const cddHistory = cddValue
    ? await recordHistoryPoint(
        "cdd",
        {
          timestamp: generatedAt,
          value: cddValue,
        },
        {
          persist: options.persist,
          localHistory,
        },
      )
    : await readHistory("cdd");
  const dormancyHistory = dormancyValue
    ? await recordHistoryPoint(
        "dormancy",
        {
          timestamp: generatedAt,
          value: dormancyValue,
        },
        {
          persist: options.persist,
          localHistory,
        },
      )
    : await readHistory("dormancy");
  const metrics = {};

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
        dataMode: glassnodeMetrics?.adjustedTransferVolumeSeries?.length > 0 ? "live" : "scraped",
      },
    );
  }

  if (activeAddresses.length > 0) {
    metrics["active-addresses"] = buildMetric(
      "active-addresses",
      activeAddresses,
      formatCompact(activeAddresses.at(-1)?.value ?? 0, 0),
      "Unique active addresses",
      "Blockchain.com",
    );
  }

  if (activeSupplySeries.length > 0) {
    metrics["active-supply"] = {
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
    };
  }

  if (cddValue) {
    const context = buildHistoryTrend(cddHistory, cddValue);
    metrics.cdd = buildSnapshotMetric(
      "cdd",
      {
        currentValue: formatBtcDays(cddValue, 1),
        deltaLabel: `${formatRatio(daysDestroyedPerBtc ?? 0, 4)} days destroyed per BTC`,
        sourceLabel: "BitInfoCharts derived",
        series: seriesFromHistoryPoints(cddHistory, {
          timestamp: generatedAt,
          value: cddValue,
        }),
        asOf: generatedAt,
        dataMode: "scraped",
      },
      {
        value: context.latest,
        previous: context.previous,
      },
    );
  }

  if (dormancyValue) {
    const context = buildHistoryTrend(dormancyHistory, dormancyValue);
    metrics.dormancy = buildSnapshotMetric(
      "dormancy",
      {
        currentValue: `${formatRatio(dormancyValue, 1)}d`,
        deltaLabel: "Derived from days destroyed / BTC sent",
        sourceLabel: "BitInfoCharts derived",
        series: seriesFromHistoryPoints(dormancyHistory, {
          timestamp: generatedAt,
          value: dormancyValue,
        }),
        asOf: generatedAt,
        dataMode: "approx",
      },
      {
        value: context.latest,
        previous: context.previous,
      },
    );
  }

  if (hashrate.length > 0) {
    metrics.hashrate = buildMetric(
      "hashrate",
      hashrate,
      formatEhFromTh(hashrate.at(-1)?.value ?? 0),
      "Estimated network hash rate",
      "Blockchain.com",
    );
  }

  if (difficultySeries.length > 0) {
    metrics.difficulty = buildMetric(
      "difficulty",
      difficultySeries,
      formatDifficulty(difficultySeries.at(-1)?.value ?? 0),
      `Next adjustment ${formatPercent(mempoolDifficulty?.difficultyChange ?? 0)}`,
      "Blockchain.com + mempool.space",
    );
  }

  if (latestMvrv) {
    metrics.mvrv = {
      metricId: "mvrv",
      currentValue: formatRatio(latestMvrv, 2),
      deltaLabel: "Market value to realized value",
      sourceLabel: glassnodeMetrics?.mvrvSeries?.length > 0 ? "Glassnode" : "Blockchain.com market signals",
      trend: inferTrend(latestMvrv, effectiveMvrvSeries.at(-2)?.value ?? latestMvrv),
      status: inferStatus("mvrv", latestMvrv, effectiveMvrvSeries.at(-2)?.value ?? latestMvrv),
      series: toSeries(effectiveMvrvSeries),
      isLive: true,
      asOf: effectiveMvrvSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.mvrvSeries?.length > 0 ? "live" : "scraped",
    };
  }

  if (piCycleTopBufferSeries.length > 0) {
    metrics["pi-cycle-top"] = {
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
    };
  }

  if (mayerMultipleSeries.length > 0) {
    metrics["mayer-multiple"] = {
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
    };
  }

  if (twoYearMaBufferSeries.length > 0) {
    metrics["2-year-ma-multiplier"] = {
      metricId: "2-year-ma-multiplier",
      currentValue: formatUnsignedPercent(twoYearMaBufferSeries.at(-1)?.value ?? 0, 1),
      deltaLabel: `Buffer to 5x band | spot / 2Y MA ${formatRatio((currentBtcPrice / (price730DayAverage.at(-1)?.value ?? currentBtcPrice)) || 0, 2)}x`,
      sourceLabel: "Blockchain.com derived",
      trend: inferTrend(
        twoYearMaBufferSeries.at(-1)?.value ?? 0,
        twoYearMaBufferSeries.at(-2)?.value ?? twoYearMaBufferSeries.at(-1)?.value ?? 0,
      ),
      status:
        (twoYearMaBufferSeries.at(-1)?.value ?? 0) > 70
          ? "bullish"
          : (twoYearMaBufferSeries.at(-1)?.value ?? 0) > 35
            ? "neutral"
            : "bearish",
      series: toSeries(twoYearMaBufferSeries),
      isLive: true,
      asOf: twoYearMaBufferSeries.at(-1)?.timestamp,
      dataMode: "approx",
    };
  }

  if (nuplSeries.length > 0) {
    metrics.nupl = {
      metricId: "nupl",
      currentValue: formatRatio(nuplSeries.at(-1)?.value ?? 0, 2),
      deltaLabel: "Net unrealized profit / loss",
      sourceLabel: "BGeometrics",
      trend: inferTrend(nuplSeries.at(-1)?.value ?? 0, nuplSeries.at(-2)?.value ?? nuplSeries.at(-1)?.value ?? 0),
      status:
        (nuplSeries.at(-1)?.value ?? 0) > 0.75
          ? "bearish"
          : (nuplSeries.at(-1)?.value ?? 0) > 0.25
            ? "neutral"
            : "bullish",
      series: toSeries(nuplSeries),
      isLive: true,
      asOf: nuplSeries.at(-1)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (lthNuplSeries.length > 0) {
    metrics["lth-nupl"] = {
      metricId: "lth-nupl",
      currentValue: formatRatio(lthNuplSeries.at(-1)?.value ?? 0, 2),
      deltaLabel: "Derived from public LTH MVRV",
      sourceLabel: "BGeometrics cohort proxy",
      trend: inferTrend(
        lthNuplSeries.at(-1)?.value ?? 0,
        lthNuplSeries.at(-2)?.value ?? lthNuplSeries.at(-1)?.value ?? 0,
      ),
      status:
        (lthNuplSeries.at(-1)?.value ?? 0) > 0.6
          ? "bearish"
          : (lthNuplSeries.at(-1)?.value ?? 0) > 0.2
            ? "neutral"
            : "bullish",
      series: toSeries(lthNuplSeries),
      isLive: true,
      asOf: lthNuplSeries.at(-1)?.timestamp,
      dataMode: "approx",
    };
  }

  if (sthNuplSeries.length > 0) {
    metrics["sth-nupl"] = {
      metricId: "sth-nupl",
      currentValue: formatRatio(sthNuplSeries.at(-1)?.value ?? 0, 2),
      deltaLabel: "Derived from public STH MVRV",
      sourceLabel: "BGeometrics cohort proxy",
      trend: inferTrend(
        sthNuplSeries.at(-1)?.value ?? 0,
        sthNuplSeries.at(-2)?.value ?? sthNuplSeries.at(-1)?.value ?? 0,
      ),
      status:
        (sthNuplSeries.at(-1)?.value ?? 0) > 0.25
          ? "bearish"
          : (sthNuplSeries.at(-1)?.value ?? 0) > 0
            ? "neutral"
            : "bullish",
      series: toSeries(sthNuplSeries),
      isLive: true,
      asOf: sthNuplSeries.at(-1)?.timestamp,
      dataMode: "approx",
    };
  }

  if (rhodlRatioSeries.length > 0) {
    metrics["rhodl-ratio"] = {
      metricId: "rhodl-ratio",
      currentValue: formatCompact(rhodlRatioSeries.at(-1)?.value ?? 0, 1),
      deltaLabel: "1M smoothed RHODL ratio",
      sourceLabel: "BGeometrics",
      trend: inferTrend(
        rhodlRatioSeries.at(-1)?.value ?? 0,
        rhodlRatioSeries.at(-2)?.value ?? rhodlRatioSeries.at(-1)?.value ?? 0,
      ),
      status:
        (rhodlRatioSeries.at(-1)?.value ?? 0) > 2000
          ? "bearish"
          : (rhodlRatioSeries.at(-1)?.value ?? 0) > 700
            ? "neutral"
            : "bullish",
      series: toSeries(rhodlRatioSeries),
      isLive: true,
      asOf: rhodlRatioSeries.at(-1)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (oldSupplyShareSeries.length > 0) {
    metrics["hodl-waves"] = {
      metricId: "hodl-waves",
      currentValue: formatUnsignedPercent(oldSupplyShareSeries.at(-1)?.value ?? 0, 1),
      deltaLabel: "Share of supply dormant for 1 year or more",
      sourceLabel: "BGeometrics derived from age bands",
      trend: inferTrend(
        oldSupplyShareSeries.at(-1)?.value ?? 0,
        oldSupplyShareSeries.at(-2)?.value ?? oldSupplyShareSeries.at(-1)?.value ?? 0,
      ),
      status:
        (oldSupplyShareSeries.at(-1)?.value ?? 0) > 55
          ? "bullish"
          : (oldSupplyShareSeries.at(-1)?.value ?? 0) > 45
            ? "neutral"
            : "bearish",
      series: toSeries(oldSupplyShareSeries),
      isLive: true,
      asOf: oldSupplyShareSeries.at(-1)?.timestamp,
      dataMode: "approx",
    };
  }

  if (effectiveAsoprSeries.length > 0) {
    metrics.asopr = {
      metricId: "asopr",
      currentValue: formatRatio(effectiveAsoprSeries.at(-1)?.value ?? 0, 3),
      deltaLabel:
        glassnodeMetrics?.asoprSeries?.length > 0
          ? "Adjusted SOPR"
          : asoprIsExact
            ? "Adjusted SOPR"
            : "SOPR 7D proxy while aSOPR is unavailable",
      sourceLabel:
        glassnodeMetrics?.asoprSeries?.length > 0
          ? "Glassnode"
          : asoprIsExact
            ? "bitcoin-data.com"
            : "BGeometrics SOPR proxy",
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
      dataMode:
        glassnodeMetrics?.asoprSeries?.length > 0 ? "live" : asoprIsExact ? "scraped" : "approx",
    };
  }

  if (hashRibbonSeries.length > 0) {
    metrics["hash-ribbon"] = {
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
    };
  }

  if (nvtSignalSeries.length > 0) {
    metrics["nvt-signal"] = {
      metricId: "nvt-signal",
      currentValue: formatCompact(nvtSignalSeries.at(-1)?.value ?? 0, 0),
      deltaLabel: `Dynamic range ${formatCompact(nvtSignalLowSeries.at(-1)?.value ?? 0, 0)} to ${formatCompact(nvtSignalHighSeries.at(-1)?.value ?? 0, 0)}`,
      sourceLabel: "BGeometrics",
      trend: inferTrend(
        nvtSignalSeries.at(-1)?.value ?? 0,
        nvtSignalSeries.at(-2)?.value ?? nvtSignalSeries.at(-1)?.value ?? 0,
      ),
      status:
        (nvtSignalSeries.at(-1)?.value ?? 0) < (nvtSignalLowSeries.at(-1)?.value ?? 0)
          ? "bullish"
          : (nvtRelativeToHighSeries.at(-1)?.value ?? 0) > 1
            ? "bearish"
            : "neutral",
      series: toSeries(nvtSignalSeries),
      isLive: true,
      asOf: nvtSignalSeries.at(-1)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (effectiveExchangeNetflowSeries.length > 0) {
    metrics["exchange-netflow"] = {
      metricId: "exchange-netflow",
      currentValue: formatBtc(effectiveExchangeNetflowSeries.at(-1)?.value ?? 0, 1),
      deltaLabel:
        glassnodeMetrics?.exchangeNetflowSeries?.length > 0
          ? "Net BTC flow into and out of exchanges"
          : "STH supply day-over-day proxy for exchange flow",
      sourceLabel:
        glassnodeMetrics?.exchangeNetflowSeries?.length > 0 ? "Glassnode" : "BGeometrics liquid-supply proxy",
      trend: inferTrend(
        effectiveExchangeNetflowSeries.at(-1)?.value ?? 0,
        effectiveExchangeNetflowSeries.at(-2)?.value ?? effectiveExchangeNetflowSeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "exchange-netflow",
        effectiveExchangeNetflowSeries.at(-1)?.value ?? 0,
        effectiveExchangeNetflowSeries.at(-2)?.value ?? effectiveExchangeNetflowSeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectiveExchangeNetflowSeries),
      isLive: true,
      asOf: effectiveExchangeNetflowSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.exchangeNetflowSeries?.length > 0 ? "live" : "approx",
    };
  }

  if (effectiveExchangeBalanceSeries.length > 0) {
    metrics["exchange-balance"] = {
      metricId: "exchange-balance",
      currentValue: formatBtc(effectiveExchangeBalanceSeries.at(-1)?.value ?? 0, 1),
      deltaLabel:
        glassnodeMetrics?.exchangeBalanceSeries?.length > 0
          ? "BTC balance held on exchanges"
          : "STH supply proxy for exchange-ready BTC",
      sourceLabel:
        glassnodeMetrics?.exchangeBalanceSeries?.length > 0 ? "Glassnode" : "BGeometrics liquid-supply proxy",
      trend: inferTrend(
        effectiveExchangeBalanceSeries.at(-1)?.value ?? 0,
        effectiveExchangeBalanceSeries.at(-2)?.value ?? effectiveExchangeBalanceSeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "exchange-balance",
        effectiveExchangeBalanceSeries.at(-1)?.value ?? 0,
        effectiveExchangeBalanceSeries.at(-2)?.value ?? effectiveExchangeBalanceSeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectiveExchangeBalanceSeries),
      isLive: true,
      asOf: effectiveExchangeBalanceSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.exchangeBalanceSeries?.length > 0 ? "live" : "approx",
    };
  }

  if (effectivePercentSupplyInProfitSeries.length > 0) {
    metrics["percent-supply-in-profit"] = {
      metricId: "percent-supply-in-profit",
      currentValue: `${formatRatio(effectivePercentSupplyInProfitSeries.at(-1)?.value ?? 0, 1)}%`,
      deltaLabel: "Percent of BTC supply currently in profit",
      sourceLabel: glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0 ? "Glassnode" : "BGeometrics",
      trend: inferTrend(
        effectivePercentSupplyInProfitSeries.at(-1)?.value ?? 0,
        effectivePercentSupplyInProfitSeries.at(-2)?.value ?? effectivePercentSupplyInProfitSeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "percent-supply-in-profit",
        effectivePercentSupplyInProfitSeries.at(-1)?.value ?? 0,
        effectivePercentSupplyInProfitSeries.at(-2)?.value ?? effectivePercentSupplyInProfitSeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectivePercentSupplyInProfitSeries),
      isLive: true,
      asOf: effectivePercentSupplyInProfitSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.percentSupplyInProfitSeries?.length > 0 ? "live" : "scraped",
    };
  }

  if (effectiveReserveRiskSeries.length > 0) {
    metrics["reserve-risk"] = {
      metricId: "reserve-risk",
      currentValue: formatRatio(effectiveReserveRiskSeries.at(-1)?.value ?? 0, 4),
      deltaLabel: "Long-term holder opportunity-cost model",
      sourceLabel: glassnodeMetrics?.reserveRiskSeries?.length > 0 ? "Glassnode" : "BGeometrics",
      trend: inferTrend(
        effectiveReserveRiskSeries.at(-1)?.value ?? 0,
        effectiveReserveRiskSeries.at(-2)?.value ?? effectiveReserveRiskSeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "reserve-risk",
        effectiveReserveRiskSeries.at(-1)?.value ?? 0,
        effectiveReserveRiskSeries.at(-2)?.value ?? effectiveReserveRiskSeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectiveReserveRiskSeries),
      isLive: true,
      asOf: effectiveReserveRiskSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.reserveRiskSeries?.length > 0 ? "live" : "scraped",
    };
  }

  if (effectiveLthSupplySeries.length > 0) {
    metrics["lth-supply"] = {
      metricId: "lth-supply",
      currentValue: formatBtc(effectiveLthSupplySeries.at(-1)?.value ?? 0, 1),
      deltaLabel: "BTC held by long-term holders",
      sourceLabel: glassnodeMetrics?.lthSupplySeries?.length > 0 ? "Glassnode" : "BGeometrics",
      trend: inferTrend(
        effectiveLthSupplySeries.at(-1)?.value ?? 0,
        effectiveLthSupplySeries.at(-2)?.value ?? effectiveLthSupplySeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "lth-supply",
        effectiveLthSupplySeries.at(-1)?.value ?? 0,
        effectiveLthSupplySeries.at(-2)?.value ?? effectiveLthSupplySeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectiveLthSupplySeries),
      isLive: true,
      asOf: effectiveLthSupplySeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.lthSupplySeries?.length > 0 ? "live" : "scraped",
    };
  }

  if (effectiveSthSupplySeries.length > 0) {
    metrics["sth-supply"] = {
      metricId: "sth-supply",
      currentValue: formatBtc(effectiveSthSupplySeries.at(-1)?.value ?? 0, 1),
      deltaLabel: "BTC held by short-term holders",
      sourceLabel: glassnodeMetrics?.sthSupplySeries?.length > 0 ? "Glassnode" : "BGeometrics",
      trend: inferTrend(
        effectiveSthSupplySeries.at(-1)?.value ?? 0,
        effectiveSthSupplySeries.at(-2)?.value ?? effectiveSthSupplySeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "sth-supply",
        effectiveSthSupplySeries.at(-1)?.value ?? 0,
        effectiveSthSupplySeries.at(-2)?.value ?? effectiveSthSupplySeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectiveSthSupplySeries),
      isLive: true,
      asOf: effectiveSthSupplySeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.sthSupplySeries?.length > 0 ? "live" : "scraped",
    };
  }

  if (lthNetPositionChangeSeries.length > 0) {
    metrics["lth-net-position-change"] = {
      metricId: "lth-net-position-change",
      currentValue: formatBtc(lthNetPositionChangeSeries.at(-1)?.value ?? 0, 1),
      deltaLabel:
        glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0
          ? "30D change in long-term holder supply"
          : "Derived 30D change in long-term holder supply",
      sourceLabel: glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0 ? "Glassnode" : "BGeometrics derived",
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
      dataMode: glassnodeMetrics?.lthNetPositionChangeSeries?.length > 0 ? "live" : "approx",
    };
  }

  if (effectiveLivelinessSeries.length > 0) {
    metrics.liveliness = {
      metricId: "liveliness",
      currentValue: formatRatio(effectiveLivelinessSeries.at(-1)?.value ?? 0, 4),
      deltaLabel: "Old-coin spending vs holding behavior",
      sourceLabel: glassnodeMetrics?.livelinessSeries?.length > 0 ? "Glassnode" : "BGeometrics",
      trend: inferTrend(
        effectiveLivelinessSeries.at(-1)?.value ?? 0,
        effectiveLivelinessSeries.at(-2)?.value ?? effectiveLivelinessSeries.at(-1)?.value ?? 0,
      ),
      status: inferStatus(
        "liveliness",
        effectiveLivelinessSeries.at(-1)?.value ?? 0,
        effectiveLivelinessSeries.at(-2)?.value ?? effectiveLivelinessSeries.at(-1)?.value ?? 0,
      ),
      series: toSeries(effectiveLivelinessSeries),
      isLive: true,
      asOf: effectiveLivelinessSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.livelinessSeries?.length > 0 ? "live" : "scraped",
    };
  }

  if (etfFlowSeries.length > 0) {
    metrics["spot-btc-etf-flows"] = {
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
    };
  }

  if (etfHoldingsSeries.length > 0) {
    metrics["spot-btc-etf-holdings"] = {
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
    };
  }

  if (fundingRatePercentSeries.length > 0) {
    metrics["funding-rate"] = {
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
    };
  }

  if (openInterestSeries.length > 0) {
    metrics["open-interest"] = {
      metricId: "open-interest",
      currentValue: formatUsd(openInterestSeries.at(-1)?.value ?? 0, 1),
      deltaLabel: "Total BTC futures open interest",
      sourceLabel: "BGeometrics",
      trend: inferTrend(
        openInterestSeries.at(-1)?.value ?? 0,
        openInterestSeries.at(-2)?.value ?? openInterestSeries.at(-1)?.value ?? 0,
      ),
      status: "neutral",
      series: toSeries(openInterestSeries),
      isLive: true,
      asOf: openInterestSeries.at(-1)?.timestamp,
      dataMode: "scraped",
    };
  }

  if (powerLawRatioSeries.length > 0) {
    metrics["power-law"] = {
      metricId: "power-law",
      currentValue: formatRatio(powerLawRatioSeries.at(-1)?.value ?? 0, 2),
      deltaLabel:
        powerLawTopRatioSeries.length > 0
          ? `Floor ${formatRatio(powerLawFloorRatioSeries.at(-1)?.value ?? 0, 2)}x | Top ${formatRatio(powerLawTopRatioSeries.at(-1)?.value ?? 0, 2)}x`
          : `Floor ${formatRatio(powerLawFloorRatioSeries.at(-1)?.value ?? 0, 2)}x | Top band unavailable`,
      sourceLabel: "BGeometrics model",
      trend: inferTrend(
        powerLawRatioSeries.at(-1)?.value ?? 0,
        powerLawRatioSeries.at(-2)?.value ?? powerLawRatioSeries.at(-1)?.value ?? 0,
      ),
      status:
        (powerLawRatioSeries.at(-1)?.value ?? 0) < 0.75
          ? "bullish"
          : (powerLawRatioSeries.at(-1)?.value ?? 0) > 1.2
            ? "bearish"
            : "neutral",
      series: toSeries(powerLawRatioSeries),
      isLive: true,
      asOf: powerLawRatioSeries.at(-1)?.timestamp,
      dataMode: "approx",
    };
  }

  if (stockToFlowSeries.length > 0) {
    metrics["stock-to-flow"] = {
      metricId: "stock-to-flow",
      currentValue: formatCompact(stockToFlowSeries.at(-1)?.value ?? 0, 1),
      deltaLabel: "Circulating supply divided by trailing 1Y issuance",
      sourceLabel: "Blockchain.com derived",
      trend: inferTrend(
        stockToFlowSeries.at(-1)?.value ?? 0,
        stockToFlowSeries.at(-2)?.value ?? stockToFlowSeries.at(-1)?.value ?? 0,
      ),
      status:
        (stockToFlowSeries.at(-1)?.value ?? 0) > 80
          ? "bullish"
          : (stockToFlowSeries.at(-1)?.value ?? 0) > 40
            ? "neutral"
            : "bearish",
      series: toSeries(stockToFlowSeries),
      isLive: true,
      asOf: stockToFlowSeries.at(-1)?.timestamp,
      dataMode: "approx",
    };
  }

  if (glassnodeMetrics?.puellMultipleSeries?.length > 0 || latestPuell) {
    const effectivePuellSeries =
      glassnodeMetrics?.puellMultipleSeries?.length > 0 ? glassnodeMetrics.puellMultipleSeries : puellSeries;
    const latestEffectivePuell = effectivePuellSeries.at(-1)?.value ?? latestPuell;
    metrics["puell-multiple"] = {
      metricId: "puell-multiple",
      currentValue: formatRatio(latestEffectivePuell ?? 0, 2),
      deltaLabel: "Miner revenue vs 365D average",
      sourceLabel: glassnodeMetrics?.puellMultipleSeries?.length > 0 ? "Glassnode" : "Blockchain.com derived",
      trend: inferTrend(latestEffectivePuell ?? 0, effectivePuellSeries.at(-2)?.value ?? latestEffectivePuell ?? 0),
      status: inferStatus(
        "puell-multiple",
        latestEffectivePuell ?? 0,
        effectivePuellSeries.at(-2)?.value ?? latestEffectivePuell ?? 0,
      ),
      series: toSeries(effectivePuellSeries),
      isLive: true,
      asOf: effectivePuellSeries.at(-1)?.timestamp,
      dataMode: glassnodeMetrics?.puellMultipleSeries?.length > 0 ? "live" : "approx",
    };
  }

  if (Object.keys(metrics).length === 0 && !previousSnapshot?.metrics) {
    throw new Error("Daily group refresh produced no metrics.");
  }

  return createSnapshot("daily", {
    previousSnapshot,
    generatedAt,
    metrics,
    warnings,
    context: {
      latestMvrv,
      realizedPriceUsd,
      syntheticInputs: {
        mvrv: effectiveMvrvSeries.length > 0 ? effectiveMvrvSeries : previousSnapshot?.context?.syntheticInputs?.mvrv,
        "percent-supply-in-profit":
          effectivePercentSupplyInProfitSeries.length > 0
            ? effectivePercentSupplyInProfitSeries
            : previousSnapshot?.context?.syntheticInputs?.["percent-supply-in-profit"],
        "reserve-risk":
          effectiveReserveRiskSeries.length > 0
            ? effectiveReserveRiskSeries
            : previousSnapshot?.context?.syntheticInputs?.["reserve-risk"],
        "price-vs-realized-price":
          effectiveMvrvSeries.length > 0
            ? effectiveMvrvSeries
            : previousSnapshot?.context?.syntheticInputs?.["price-vs-realized-price"],
        asopr:
          effectiveAsoprSeries.length > 0 ? effectiveAsoprSeries : previousSnapshot?.context?.syntheticInputs?.asopr,
        nupl: nuplSeries.length > 0 ? nuplSeries : previousSnapshot?.context?.syntheticInputs?.nupl,
        liveliness:
          effectiveLivelinessSeries.length > 0
            ? effectiveLivelinessSeries
            : previousSnapshot?.context?.syntheticInputs?.liveliness,
        "lth-net-position-change":
          lthNetPositionChangeSeries.length > 0
            ? lthNetPositionChangeSeries
            : previousSnapshot?.context?.syntheticInputs?.["lth-net-position-change"],
      },
    },
  });
}

export async function refreshSlowGroup(options = {}) {
  const generatedAt = options.now ?? Date.now();
  const previousSnapshot = options.previousSnapshot ?? null;
  const warnings = [];
  const [dxy, realYield, fedBalanceSheet, onRrp] = await Promise.all([
    safePoints(() => fetchFREDSeries("DTWEXBGS")),
    safePoints(() => fetchFREDSeries("DFII10")),
    safePoints(() => fetchFREDSeries("WALCL")),
    safePoints(() => fetchFREDSeries("RRPTSYD")),
  ]);
  const metrics = {};

  if (dxy.length > 0) {
    metrics.dxy = buildMetric(
      "dxy",
      dxy,
      formatRatio(dxy.at(-1)?.value ?? 0, 2),
      "Broad dollar index",
      "FRED CSV",
    );
  }

  if (realYield.length > 0) {
    metrics["10y-real-yield"] = buildMetric(
      "10y-real-yield",
      realYield,
      `${formatRatio(realYield.at(-1)?.value ?? 0, 2)}%`,
      "10Y inflation-adjusted Treasury yield",
      "FRED CSV",
    );
  }

  if (fedBalanceSheet.length > 0) {
    metrics["fed-balance-sheet"] = buildMetric(
      "fed-balance-sheet",
      fedBalanceSheet,
      formatUsd((fedBalanceSheet.at(-1)?.value ?? 0) * 1_000_000, 1),
      "Federal Reserve total assets",
      "FRED CSV",
    );
  }

  if (onRrp.length > 0) {
    metrics["on-rrp"] = buildMetric(
      "on-rrp",
      onRrp,
      formatUsd((onRrp.at(-1)?.value ?? 0) * 1_000_000_000, 1),
      "Overnight reverse repo usage",
      "FRED CSV",
    );
  }

  if (Object.keys(metrics).length === 0 && !previousSnapshot?.metrics) {
    throw new Error("Slow group refresh produced no metrics.");
  }

  if (!dxy.length || !realYield.length || !fedBalanceSheet.length || !onRrp.length) {
    warnings.push("One or more macro series were unavailable during the latest slow-group refresh.");
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
  const dailySyntheticInputs = options.groupSnapshots?.daily?.context?.syntheticInputs ?? {};
  const dormancyHistory = (await readHistory("dormancy")) ?? [];

  if (Object.keys(currentMetrics).length === 0) {
    throw new Error("Synthetic refresh requires upstream metric snapshots.");
  }

  const previousEstimate = previousSnapshot?.summary?.cycleEstimate ?? options.baseComposite?.summary?.cycleEstimate;
  const computedCycleEstimate = await estimateCyclePosition(currentMetrics, generatedAt, previousEstimate);
  const computedCycleAnalog = estimateCycleAnalog({
    currentMetrics,
    generatedAt,
    historicalSeries: {
      ...dailySyntheticInputs,
      dormancy: dormancyHistory.length > 0 ? dormancyHistory : dailySyntheticInputs?.dormancy ?? [],
    },
  });
  const previousAnalog = isPhaseWindowCycleAnalog(previousSnapshot?.summary?.cycleAnalog)
    ? previousSnapshot.summary.cycleAnalog
    : null;
  const baseAnalog = isPhaseWindowCycleAnalog(options.baseComposite?.summary?.cycleAnalog)
    ? options.baseComposite.summary.cycleAnalog
    : null;
  const cycleEstimate =
    computedCycleEstimate ??
    previousSnapshot?.summary?.cycleEstimate ??
    options.baseComposite?.summary?.cycleEstimate ??
    null;
  const cycleAnalog =
    computedCycleAnalog ??
    previousAnalog ??
    baseAnalog ??
    null;

  if (!cycleEstimate && !cycleAnalog && !previousSnapshot?.summary?.cycleEstimate && !previousSnapshot?.summary?.cycleAnalog) {
    throw new Error("Synthetic refresh could not compute a cycle estimate or analog.");
  }

  return createSnapshot("synthetic", {
    previousSnapshot,
    generatedAt,
    metrics: {},
    warnings: [],
    summary: {
      cycleEstimate,
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
