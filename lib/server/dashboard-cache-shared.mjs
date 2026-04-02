export const TOTAL_METRIC_COUNT = 23;

export const CACHE_GROUPS = {
  fast: {
    id: "fast",
    label: "Fast",
    ttlMs: 60 * 60 * 1000,
    staleAfterMs: 2 * 60 * 60 * 1000,
  },
  daily: {
    id: "daily",
    label: "Daily",
    ttlMs: 24 * 60 * 60 * 1000,
    staleAfterMs: 48 * 60 * 60 * 1000,
  },
  slow: {
    id: "slow",
    label: "Slow",
    ttlMs: 48 * 60 * 60 * 1000,
    staleAfterMs: 72 * 60 * 60 * 1000,
  },
  synthetic: {
    id: "synthetic",
    label: "Synthetic",
    ttlMs: 0,
    staleAfterMs: 48 * 60 * 60 * 1000,
  },
};

export const CACHE_GROUP_ORDER = ["fast", "daily", "slow", "synthetic"];
export const DASHBOARD_CACHE_SCHEDULER =
  "Daily cron plus stale-triggered refreshes with compact snapshots, source caching, and refresh locks";

export const METRIC_GROUP_IDS = {
  ssr: "fast",
  "funding-rate": "fast",
  "open-interest": "fast",
  "recent-reddit-sentiment": "fast",
  "fear-and-greed": "daily",
  "adjusted-transfer-volume": "daily",
  mvrv: "daily",
  "puell-multiple": "daily",
  "pi-cycle-top": "daily",
  "mayer-multiple": "daily",
  "2-year-ma-multiplier": "daily",
  "power-law": "daily",
  "stock-to-flow": "daily",
  "active-supply": "daily",
  "active-addresses": "daily",
  hashrate: "daily",
  difficulty: "daily",
  "hash-ribbon": "daily",
  "nvt-signal": "daily",
  dxy: "slow",
  "10y-real-yield": "slow",
  "fed-balance-sheet": "slow",
  "on-rrp": "slow",
};

function dedupeStrings(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

export function getMetricIdsForGroup(groupId) {
  return Object.entries(METRIC_GROUP_IDS)
    .filter(([, mappedGroupId]) => mappedGroupId === groupId)
    .map(([metricId]) => metricId);
}

export function getMetricGroupId(metricId) {
  return METRIC_GROUP_IDS[metricId] ?? "daily";
}

export function withMetricCacheInfo(metricId, metric, refreshedAt) {
  const groupId = getMetricGroupId(metricId);
  const group = CACHE_GROUPS[groupId];

  return {
    ...metric,
    groupId,
    refreshedAt: metric?.refreshedAt ?? refreshedAt,
    staleAfterMs: metric?.staleAfterMs ?? group.staleAfterMs,
  };
}

export function summarizeGroupSnapshot(snapshot, now = Date.now()) {
  const config = CACHE_GROUPS[snapshot.groupId];
  const generatedAt = snapshot.generatedAt ?? 0;
  const ttlMs = snapshot.ttlMs ?? config.ttlMs;
  const expiresAt = snapshot.expiresAt ?? (generatedAt && ttlMs > 0 ? generatedAt + ttlMs : 0);
  const staleAt = generatedAt && snapshot.staleAfterMs ? generatedAt + snapshot.staleAfterMs : 0;
  let status = "fresh";

  if (!generatedAt) {
    status = "missing";
  } else if (expiresAt && now >= expiresAt) {
    status = "expired";
  } else if (staleAt && now >= staleAt) {
    status = "stale";
  }

  return {
    groupId: snapshot.groupId,
    label: config.label,
    generatedAt,
    expiresAt,
    ttlMs,
    staleAfterMs: snapshot.staleAfterMs ?? config.staleAfterMs,
    refreshedDuringRequest: Boolean(snapshot.refreshedDuringRequest),
    refreshSource: snapshot.refreshSource ?? "cache",
    lastSourceUpdateAt: snapshot.lastSourceUpdateAt,
    warningCount: snapshot.warnings?.length ?? 0,
    metricIds: snapshot.metricIds ?? getMetricIdsForGroup(snapshot.groupId),
    status,
  };
}

export function buildGroupSnapshotsFromPayload(payload, options = {}) {
  const generatedAt = options.generatedAt ?? payload.meta?.generatedAt ?? Date.now();
  const refreshedGroupIds = new Set(options.refreshedGroupIds ?? CACHE_GROUP_ORDER);
  const refreshSource = options.refreshSource ?? "refreshed";
  const snapshots = {};

  for (const groupId of CACHE_GROUP_ORDER) {
    const config = CACHE_GROUPS[groupId];
    const metricIds = getMetricIdsForGroup(groupId);

    if (groupId === "synthetic") {
      snapshots[groupId] = {
        groupId,
        generatedAt,
        expiresAt: 0,
        ttlMs: config.ttlMs,
        staleAfterMs: config.staleAfterMs,
        refreshedDuringRequest: refreshedGroupIds.has(groupId),
        refreshSource,
        metricIds: [],
        warnings: [],
        lastSourceUpdateAt: generatedAt,
        metrics: {},
        summary: {
          cycleEstimate: payload.summary?.cycleEstimate ?? null,
          cycleAnalog: payload.summary?.cycleAnalog ?? null,
        },
      };
      continue;
    }

    const metrics = {};

    for (const metricId of metricIds) {
      if (payload.metrics?.[metricId]) {
        metrics[metricId] = withMetricCacheInfo(metricId, payload.metrics[metricId], generatedAt);
      }
    }

    const lastSourceUpdateAt = Object.values(metrics).reduce((latest, metric) => {
      const asOf = Number(metric?.asOf ?? 0);
      return asOf > latest ? asOf : latest;
    }, 0);

    snapshots[groupId] = {
      groupId,
      generatedAt,
      expiresAt: config.ttlMs > 0 ? generatedAt + config.ttlMs : generatedAt,
      ttlMs: config.ttlMs,
      staleAfterMs: config.staleAfterMs,
      refreshedDuringRequest: refreshedGroupIds.has(groupId),
      refreshSource,
      metricIds,
      warnings: [],
      lastSourceUpdateAt,
      metrics,
      summary:
        groupId === "fast"
          ? {
              btcPrice: payload.summary?.btcPrice,
              btcPriceChange: payload.summary?.btcPriceChange,
            }
          : {},
    };
  }

  return snapshots;
}

export function buildCompositePayloadFromGroupSnapshots(groupSnapshots, basePayload = {}, options = {}) {
  const now = options.now ?? Date.now();
  const metrics = {};
  const groupMeta = {};
  const warningBuckets = [...(options.extraWarnings ?? [])];
  const summary = {
    ...(basePayload.summary ?? {}),
  };
  const meta = {
    ...(basePayload.meta ?? {}),
  };

  let latestGeneratedAt = Number(basePayload.meta?.generatedAt ?? 0);
  let nextSuggestedRunAt = 0;

  for (const groupId of CACHE_GROUP_ORDER) {
    const snapshot = groupSnapshots[groupId];

    if (!snapshot) {
      continue;
    }

    for (const [metricId, metric] of Object.entries(snapshot.metrics ?? {})) {
      metrics[metricId] = withMetricCacheInfo(metricId, metric, snapshot.generatedAt);
    }

    if (snapshot.summary?.btcPrice) {
      summary.btcPrice = snapshot.summary.btcPrice;
    }

    if (snapshot.summary?.btcPriceChange) {
      summary.btcPriceChange = snapshot.summary.btcPriceChange;
    }

    if (hasOwn(snapshot.summary, "cycleEstimate")) {
      summary.cycleEstimate = snapshot.summary?.cycleEstimate ?? null;
    }

    if (hasOwn(snapshot.summary, "cycleAnalog")) {
      summary.cycleAnalog = snapshot.summary?.cycleAnalog ?? null;
    }

    warningBuckets.push(...(snapshot.warnings ?? []));
    latestGeneratedAt = Math.max(latestGeneratedAt, Number(snapshot.generatedAt ?? 0));
    const expiresAt = Number(snapshot.expiresAt ?? 0);
    const ttlMs = Number(snapshot.ttlMs ?? CACHE_GROUPS[groupId]?.ttlMs ?? 0);

    if (expiresAt > 0 && ttlMs > 0) {
      nextSuggestedRunAt = nextSuggestedRunAt > 0 ? Math.min(nextSuggestedRunAt, expiresAt) : expiresAt;
    }

    groupMeta[groupId] = summarizeGroupSnapshot(snapshot, now);
  }

  const liveMetricCount = Object.values(metrics).filter((metric) => metric?.isLive).length;

  meta.generatedAt = latestGeneratedAt || Number(basePayload.meta?.generatedAt ?? 0) || now;
  meta.nextSuggestedRunAt = nextSuggestedRunAt || basePayload.meta?.nextSuggestedRunAt;
  meta.scheduler = options.scheduler ?? basePayload.meta?.scheduler ?? DASHBOARD_CACHE_SCHEDULER;
  meta.groups = groupMeta;

  summary.liveMetricCount = liveMetricCount;
  summary.mode =
    liveMetricCount === TOTAL_METRIC_COUNT ? "live" : liveMetricCount > 0 ? "mixed" : "fallback";
  summary.warnings = dedupeStrings(warningBuckets);
  summary.lastUpdatedAt = meta.generatedAt;
  summary.cycleEstimate = summary.cycleEstimate ?? null;
  summary.cycleAnalog = summary.cycleAnalog ?? null;

  return {
    meta,
    summary,
    metrics,
  };
}
