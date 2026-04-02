import { DASHBOARD_METRICS, type DashboardMetric } from "./dashboard-definitions";
import { DASHBOARD_MESSAGES } from "./dashboard-messages";
import { METRIC_SAMPLES, type MetricSample } from "./dashboard-samples";

export type DashboardCacheGroupId = "fast" | "daily" | "slow" | "synthetic";

export interface DashboardMetricState extends MetricSample {
  isLive: boolean;
  asOf?: number;
  dataMode?: "seeded" | "live" | "derived" | "model";
  groupId?: DashboardCacheGroupId;
  refreshedAt?: number;
  staleAfterMs?: number;
}

export interface DashboardCacheGroupMeta {
  groupId: DashboardCacheGroupId;
  label: string;
  generatedAt?: number;
  expiresAt?: number;
  ttlMs?: number;
  staleAfterMs?: number;
  refreshedDuringRequest?: boolean;
  refreshSource?: "cache" | "refreshed" | "bootstrap";
  lastSourceUpdateAt?: number;
  warningCount?: number;
  metricIds: string[];
  status?: "fresh" | "stale" | "expired" | "missing";
}

export type DashboardCyclePhaseId =
  | "deep-capitulation"
  | "bottoming-and-reaccumulation"
  | "early-recovery-under-disbelief"
  | "healthy-bull-expansion"
  | "late-cycle-acceleration"
  | "euphoric-overheating"
  | "distribution-and-top-formation"
  | "post-top-unwind";

export interface DashboardCycleEstimate {
  asOfDate: string;
  phaseId: DashboardCyclePhaseId;
  label: string;
  confidence: number;
  score: number;
  heatScore: number;
  damageScore: number;
  distributionScore: number;
  summary: string;
  rationale: string;
  supportingMetricIds: string[];
  conflictingMetricIds: string[];
  source: "rule-based" | "llm-assisted";
  model?: string;
  change: "earlier" | "later" | "unchanged";
}

export interface DashboardCycleAnalog {
  asOfDate: string;
  phaseId: DashboardCyclePhaseId;
  label: string;
  agreement: number;
  confidence: number;
  summary: string;
  methodology: "phase-window-nearest-neighbor";
  indicatorIds: string[];
  phaseDistribution: Array<{
    phaseId: DashboardCyclePhaseId;
    label: string;
    cyclesMatched: number;
    averageDistance: number;
  }>;
  perCycleMatches: DashboardCycleAnalogWindow[];
  topMatchDates: string[];
}

export interface DashboardCycleAnalogWindow {
  cycleId: string;
  cycleLabel: string;
  phaseId: DashboardCyclePhaseId;
  phaseLabel: string;
  windowStartDate: string;
  windowEndDate: string;
  bestMatchDate: string;
  bestMatchDateLabel: string;
  distance: number;
  coverage: number;
}

export interface DashboardDataSummary {
  btcPrice: string;
  btcPriceChange: string;
  liveMetricCount: number;
  mode: "fallback" | "mixed" | "live";
  warnings: string[];
  lastUpdatedAt?: number;
  cycleEstimate?: DashboardCycleEstimate | null;
  cycleAnalog?: DashboardCycleAnalog | null;
}

export interface DashboardDataSnapshot {
  metrics: Record<string, DashboardMetricState>;
  summary: DashboardDataSummary;
  meta?: {
    generatedAt?: number;
    nextSuggestedRunAt?: number;
    scheduler?: string;
    groups?: Partial<Record<DashboardCacheGroupId, DashboardCacheGroupMeta>>;
  };
}

export interface DashboardCachePayload {
  meta?: DashboardDataSnapshot["meta"];
  metrics?: Record<string, Partial<DashboardMetricState>>;
  summary?: Partial<DashboardDataSummary>;
}

const METRIC_GROUP_IDS: Partial<Record<DashboardMetric["id"], DashboardCacheGroupId>> = {
  ssr: "fast",
  "funding-rate": "fast",
  "open-interest": "fast",
  "fear-and-greed": "daily",
  dxy: "slow",
  "10y-real-yield": "slow",
  "fed-balance-sheet": "slow",
  "on-rrp": "slow",
};

const DEFAULT_BTC_PRICE = "$85.2K";
const DEFAULT_BTC_PRICE_CHANGE = "+0.8% over 24h";

function metricGroupId(metricId: DashboardMetric["id"]) {
  return METRIC_GROUP_IDS[metricId] ?? "daily";
}

const FALLBACK_METRICS: Record<string, DashboardMetricState> = Object.fromEntries(
  METRIC_SAMPLES.map((sample) => [
    sample.metricId,
    {
      ...sample,
      isLive: false,
      dataMode: "seeded",
      groupId: metricGroupId(sample.metricId),
    },
  ]),
);

export function buildFallbackSnapshot(): DashboardDataSnapshot {
  return {
    metrics: { ...FALLBACK_METRICS },
    summary: {
      btcPrice: DEFAULT_BTC_PRICE,
      btcPriceChange: DEFAULT_BTC_PRICE_CHANGE,
      liveMetricCount: 0,
      mode: "fallback",
      warnings: [DASHBOARD_MESSAGES.fallback.warnings],
      cycleEstimate: null,
      cycleAnalog: null,
    },
    meta: {
      scheduler: DASHBOARD_MESSAGES.fallback.scheduler,
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
      groupId:
        metric.groupId ??
        mergedMetrics[metricId].groupId ??
        metricGroupId(metricId as DashboardMetric["id"]),
      refreshedAt: metric.refreshedAt ?? mergedMetrics[metricId].refreshedAt,
      staleAfterMs: metric.staleAfterMs ?? mergedMetrics[metricId].staleAfterMs,
      asOf: metric.asOf ?? mergedMetrics[metricId].asOf,
    };
  }

  const liveMetricCount = Object.values(mergedMetrics).filter((metric) => metric.isLive).length;
  const mode =
    liveMetricCount === DASHBOARD_METRICS.length ? "live" : liveMetricCount > 0 ? "mixed" : "fallback";

  return {
    metrics: mergedMetrics,
    summary: {
      btcPrice: payload.summary?.btcPrice ?? fallback.summary.btcPrice,
      btcPriceChange: payload.summary?.btcPriceChange ?? fallback.summary.btcPriceChange,
      liveMetricCount: payload.summary?.liveMetricCount ?? liveMetricCount,
      mode: payload.summary?.mode ?? mode,
      warnings: payload.summary?.warnings ?? fallback.summary.warnings,
      lastUpdatedAt: payload.summary?.lastUpdatedAt ?? payload.meta?.generatedAt,
      cycleEstimate: payload.summary?.cycleEstimate ?? fallback.summary.cycleEstimate,
      cycleAnalog: payload.summary?.cycleAnalog ?? fallback.summary.cycleAnalog,
    },
    meta: payload.meta ?? fallback.meta,
  };
}
