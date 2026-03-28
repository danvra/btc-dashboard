import { useState } from "react";
import {
  DASHBOARD_METRICS,
  DASHBOARD_METRICS_BY_PANEL,
  type DashboardMetric,
  type DashboardPanelId,
} from "../lib/dashboard-definitions";
import { getMetricSample } from "../lib/dashboard-samples";
import { useDashboardData } from "../hooks/useDashboardData";
import type {
  DashboardCacheGroupMeta,
  DashboardCycleAnalog,
  DashboardCycleEstimate,
  DashboardMetricState,
} from "../lib/dashboard-data";

const panelAccent: Record<DashboardPanelId, string> = {
  "price-action": "from-orange-500/20 to-amber-300/10",
  "cycle-regime": "from-emerald-500/20 to-lime-300/10",
  "context-confirmation": "from-sky-500/20 to-cyan-300/10",
  "macro-market-structure": "from-rose-500/20 to-pink-300/10",
};

const sentimentClasses = {
  bullish: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  bearish: "bg-rose-50 text-rose-700 ring-rose-200",
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
};

const dataModeClasses = {
  live: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  scraped: "bg-sky-50 text-sky-700 ring-sky-200",
  approx: "bg-amber-50 text-amber-800 ring-amber-200",
  seeded: "bg-stone-100 text-stone-700 ring-stone-200",
};

const freshnessClasses = {
  fresh: "text-emerald-700",
  aging: "text-amber-700",
  stale: "text-rose-700",
  unknown: "text-stone-500",
};

const cycleSourceLabels = {
  "rule-based": "Rule engine",
  "llm-assisted": "LLM assisted",
};

const refreshNoticeClasses = {
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  fallback: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  error: "border-rose-400/20 bg-rose-400/10 text-rose-100",
};

function proxyNote(metricState: DashboardMetricState) {
  if (metricState.dataMode !== "approx") {
    return null;
  }

  return `Proxy note: this card uses a best-effort approximation from ${metricState.sourceLabel}.`;
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) {
    return "No timestamp";
  }

  const diffMs = Date.now() - timestamp;
  const isFuture = diffMs < 0;
  const diffMinutes = Math.max(Math.round(Math.abs(diffMs) / 60000), 0);

  if (diffMinutes < 1) {
    return isFuture ? "in under a minute" : "just now";
  }

  if (diffMinutes < 60) {
    return isFuture ? `in ${diffMinutes}m` : `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 48) {
    return isFuture ? `in ${diffHours}h` : `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return isFuture ? `in ${diffDays}d` : `${diffDays}d ago`;
}

function freshnessTone(timestamp?: number) {
  if (!timestamp) {
    return "unknown";
  }

  const diffHours = (Date.now() - timestamp) / 3_600_000;

  if (diffHours <= 6) {
    return "fresh";
  }

  if (diffHours <= 24) {
    return "aging";
  }

  return "stale";
}

function cycleChangeLabel(change?: DashboardCycleEstimate["change"]) {
  if (change === "later") {
    return "Shifted later";
  }

  if (change === "earlier") {
    return "Shifted earlier";
  }

  return "Unchanged";
}

function cycleAnalogDatesLabel(dateLabels?: string[]) {
  if (!dateLabels || dateLabels.length === 0) {
    return "Historical comparison appears once enough analog data is available";
  }

  return `Closest to ${dateLabels.slice(0, 2).join(", ")}`;
}

function cycleAnalogAgreementLabel(cycleAnalog?: DashboardCycleAnalog) {
  if (!cycleAnalog) {
    return "Waiting for cross-cycle matches";
  }

  return `${cycleAnalog.agreement}% of top ${cycleAnalog.matchCount} matches`;
}

function Sparkline({
  values,
  tone,
}: {
  values: number[];
  tone: "bullish" | "bearish" | "neutral";
}) {
  const normalizedValues =
    values.length > 1 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0];
  const width = 220;
  const height = 84;
  const min = Math.min(...normalizedValues);
  const max = Math.max(...normalizedValues);
  const range = max - min || 1;
  const points = normalizedValues
    .map((value, index) => {
      const x = (index / (normalizedValues.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  const stroke =
    tone === "bullish" ? "#059669" : tone === "bearish" ? "#e11d48" : "#57534e";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-24 w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`fill-${tone}`} x1="0" x2="0" y1="0" y2="1">
          <stop
            offset="0%"
            stopColor={stroke}
            stopOpacity="0.28"
          />
          <stop
            offset="100%"
            stopColor={stroke}
            stopOpacity="0.02"
          />
        </linearGradient>
      </defs>
      <polyline
        fill={`url(#fill-${tone})`}
        points={`${points} ${width},${height} 0,${height}`}
      />
      <polyline
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        points={points}
      />
    </svg>
  );
}

function MetricCard({
  metric,
  metricState,
  selected,
  onSelect,
}: {
  metric: DashboardMetric;
  metricState: DashboardMetricState;
  selected: boolean;
  onSelect: (metric: DashboardMetric) => void;
}) {
  const note = proxyNote(metricState);

  return (
    <button
      type="button"
      onClick={() => onSelect(metric)}
      className={[
        "group rounded-[1.5rem] border bg-white/90 p-4 text-left shadow-panel transition",
        "hover:-translate-y-0.5 hover:border-stone-300 hover:bg-white",
        selected ? "border-stone-900 ring-2 ring-orange-300" : "border-stone-200",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
            {metricState.sourceLabel}
          </p>
          <h3 className="mt-1 text-base font-semibold text-stone-950">
            {metric.shortName ?? metric.name}
          </h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
            sentimentClasses[metricState.status]
          }`}
        >
          {metricState.status}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ring-1 ${
              dataModeClasses[metricState.dataMode ?? "seeded"]
            }`}
          >
            {metricState.dataMode ?? "seeded"}
          </span>
          <span
            className={`text-xs font-medium ${freshnessClasses[freshnessTone(metricState.asOf)]}`}
          >
            {metricState.asOf ? `Updated ${formatRelativeTime(metricState.asOf)}` : "No live timestamp"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-stone-950">
            {metricState.currentValue}
          </p>
          <p className="mt-1 text-sm text-stone-600">{metricState.deltaLabel}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-stone-50 px-3 py-2">
        <Sparkline values={metricState.series} tone={metricState.status} />
      </div>

      <div className="mt-4 grid gap-2 text-sm text-stone-600">
        <p>
          <span className="font-medium text-stone-900">Measures:</span> {metric.tooltip.what}
        </p>
        <p>
          <span className="font-medium text-stone-900">Matters because:</span> {metric.tooltip.why}
        </p>
        {note && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            {note}
          </p>
        )}
      </div>
    </button>
  );
}

function LearnPanel({
  metric,
  metricState,
}: {
  metric: DashboardMetric;
  metricState: DashboardMetricState;
}) {
  const note = proxyNote(metricState);

  return (
    <aside className="rounded-[1.75rem] border border-stone-200 bg-white/95 p-6 shadow-panel lg:sticky lg:top-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
        Selected metric
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
        {metric.name}
      </h2>
      <p className="mt-3 text-sm leading-6 text-stone-600">{metric.learnMore}</p>

      <dl className="mt-6 grid gap-4">
        <div className="rounded-2xl bg-stone-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
            Current snapshot
          </dt>
          <dd className="mt-2 text-2xl font-semibold text-stone-950">
            {metricState.currentValue}
          </dd>
          <p className="mt-1 text-sm text-stone-600">{metricState.deltaLabel}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700">
              {metricState.dataMode ?? "seeded"}
            </div>
            <div className={`text-xs font-medium ${freshnessClasses[freshnessTone(metricState.asOf)]}`}>
              {metricState.asOf ? `Updated ${formatRelativeTime(metricState.asOf)}` : "No live timestamp"}
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-stone-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
            Source
          </dt>
          <dd className="mt-2 text-sm leading-6 text-stone-700">{metricState.sourceLabel}</dd>
        </div>
        {note && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
              Proxy note
            </dt>
            <dd className="mt-2 text-sm leading-6 text-amber-900">{note}</dd>
          </div>
        )}
        <div className="rounded-2xl bg-emerald-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Bullish read
          </dt>
          <dd className="mt-2 text-sm leading-6 text-emerald-950">
            {metric.bullishInterpretation}
          </dd>
        </div>
        <div className="rounded-2xl bg-rose-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
            Bearish read
          </dt>
          <dd className="mt-2 text-sm leading-6 text-rose-950">
            {metric.bearishInterpretation}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function DebugPanel({
  metrics,
  generatedAt,
  nextSuggestedRunAt,
  scheduler,
  groups,
  warnings,
}: {
  metrics: Record<string, DashboardMetricState>;
  generatedAt?: number;
  nextSuggestedRunAt?: number;
  scheduler?: string;
  groups?: Partial<Record<"fast" | "daily" | "slow" | "synthetic", DashboardCacheGroupMeta>>;
  warnings: string[];
}) {
  const counts = Object.values(metrics).reduce<Record<string, number>>((acc, metric) => {
    const key = metric.dataMode ?? "seeded";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="mt-6 rounded-[1.5rem] border border-stone-200 bg-white/90 p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Debug / Cache
          </p>
          <h3 className="mt-1 text-xl font-semibold text-stone-950">Prototype source health</h3>
        </div>
        <div className="text-sm text-stone-500">
          {generatedAt ? `Cache updated ${formatRelativeTime(generatedAt)}` : "Cache timestamp unavailable"}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-stone-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Seeded</p>
          <p className="mt-2 text-2xl font-semibold text-stone-950">{counts.seeded ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-sky-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-sky-700">Scraped</p>
          <p className="mt-2 text-2xl font-semibold text-sky-950">{counts.scraped ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-amber-700">Approx</p>
          <p className="mt-2 text-2xl font-semibold text-amber-950">{counts.approx ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-emerald-700">Live</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-950">{counts.live ?? 0}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Scheduler</p>
          <p className="mt-2 text-sm text-stone-700">{scheduler ?? "Unknown"}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Next suggested run</p>
          <p className="mt-2 text-sm text-stone-700">
            {nextSuggestedRunAt ? formatRelativeTime(nextSuggestedRunAt) : "Not scheduled"}
          </p>
        </div>
      </div>

      {groups && Object.keys(groups).length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.values(groups).map((group) => {
            if (!group) {
              return null;
            }

            return (
              <div
                key={group.groupId}
                className="rounded-2xl border border-stone-200 p-4"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{group.label}</p>
                <p className="mt-2 text-lg font-semibold text-stone-950">{group.status ?? "unknown"}</p>
                <p className="mt-1 text-sm text-stone-700">
                  {group.generatedAt ? `Cache ${formatRelativeTime(group.generatedAt)}` : "No cache snapshot"}
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  {group.lastSourceUpdateAt
                    ? `Source ${formatRelativeTime(group.lastSourceUpdateAt)}`
                    : "No source timestamp"}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {group.refreshedDuringRequest
                    ? "Refreshed during request"
                    : group.refreshSource === "bootstrap"
                      ? "Bootstrapped from bundled cache"
                      : "Served from grouped cache"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-amber-800">Implementation notes</p>
          <div className="mt-3 grid gap-2">
            {warnings.map((warning) => (
              <p
                key={warning}
                className="text-sm leading-6 text-amber-900"
              >
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function BtcDashboard() {
  const [activePanelId, setActivePanelId] = useState<DashboardPanelId>("price-action");
  const [selectedMetricId, setSelectedMetricId] = useState<string>(DASHBOARD_METRICS[0].id);
  const [showDebug, setShowDebug] = useState(false);
  const { snapshot, isLoading, isRefreshing, error, refreshNotice, refresh } = useDashboardData();

  const activePanel =
    DASHBOARD_METRICS_BY_PANEL.find((panel) => panel.id === activePanelId) ??
    DASHBOARD_METRICS_BY_PANEL[0];

  const selectedMetric =
    DASHBOARD_METRICS.find((metric) => metric.id === selectedMetricId) ?? activePanel.metrics[0];

  const bullishCount = DASHBOARD_METRICS.filter(
    (metric) => (snapshot?.metrics[metric.id] ?? getMetricSample(metric.id))?.status === "bullish",
  ).length;

  const selectedMetricState = snapshot?.metrics[selectedMetric.id] ?? {
    ...getMetricSample(selectedMetric.id)!,
    isLive: false,
    dataMode: "seeded",
  };
  const liveMetricCount = snapshot?.summary.liveMetricCount ?? 0;
  const dataMode = snapshot?.summary.mode ?? "fallback";
  const btcPrice = snapshot?.summary.btcPrice ?? "Loading";
  const btcPriceChange = snapshot?.summary.btcPriceChange ?? "Connecting...";
  const warnings = snapshot?.summary.warnings ?? [];
  const allMetricStates = snapshot?.metrics ?? {};
  const cacheGeneratedAt = snapshot?.meta?.generatedAt;
  const nextSuggestedRunAt = snapshot?.meta?.nextSuggestedRunAt;
  const scheduler = snapshot?.meta?.scheduler;
  const groups = snapshot?.meta?.groups;
  const cycleEstimate = snapshot?.summary.cycleEstimate;
  const cycleAnalog = snapshot?.summary.cycleAnalog;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.14),transparent_30%),linear-gradient(180deg,#fafaf9_0%,#f5f5f4_100%)] text-stone-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="overflow-hidden rounded-[2rem] border border-stone-200 bg-stone-950 text-stone-50 shadow-panel">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.6fr_1fr] lg:px-8">
            <div>
              <div className="flex items-center gap-4">
                <img
                  src="/brand-mark.svg"
                  alt="BTC Dashboard logo"
                  className="h-14 w-14 rounded-[1.25rem] ring-1 ring-white/10 shadow-[0_18px_45px_rgba(249,115,22,0.18)]"
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-orange-300">
                    BTC Dashboard
                  </p>
                  <p className="mt-1 text-sm text-stone-400">Bitcoin market intelligence</p>
                </div>
              </div>
              <div className="mt-6 max-w-3xl rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
                      Daily cycle estimate
                    </p>
                    <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                      {cycleEstimate?.label ?? "Estimate pending"}
                    </h1>
                  </div>
                  {cycleEstimate && (
                    <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs font-semibold text-stone-100">
                      {cycleEstimate.confidence}% confidence
                    </div>
                  )}
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-200 sm:text-base">
                  {cycleEstimate?.summary ??
                    "Cycle estimation appears once the dashboard has a synthesized indicator snapshot."}
                </p>
                {cycleEstimate && (
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-200">
                    <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">
                      Score {cycleEstimate.score}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">
                      {cycleSourceLabels[cycleEstimate.source]}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">
                      {cycleChangeLabel(cycleEstimate.change)}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">
                      {cycleEstimate.asOfDate}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={refresh}
                  className="rounded-full bg-orange-400 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-orange-300"
                >
                  {isRefreshing ? "Refreshing..." : "Refresh data"}
                </button>
                {refreshNotice && !isRefreshing && (
                  <div
                    className={`rounded-full border px-4 py-2 text-sm ${refreshNoticeClasses[refreshNotice.kind]}`}
                  >
                    {refreshNotice.message} {formatRelativeTime(refreshNotice.completedAt)}
                  </div>
                )}
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200">
                  Mode: <span className="font-semibold capitalize text-white">{dataMode}</span>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200">
                  Live metrics: <span className="font-semibold text-white">{liveMetricCount}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDebug((current) => !current)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200 transition hover:bg-white/10"
                >
                  {showDebug ? "Hide debug" : "Show debug"}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">BTC price</p>
                <p className="mt-2 text-3xl font-semibold">{btcPrice}</p>
                <p className="mt-1 text-sm text-stone-300">{btcPriceChange}</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Constructive</p>
                <p className="mt-2 text-3xl font-semibold">{bullishCount}</p>
                <p className="mt-1 text-sm text-stone-300">Sample signals currently leaning bullish</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Coverage</p>
                <p className="mt-2 text-3xl font-semibold">{DASHBOARD_METRICS.length}</p>
                <p className="mt-1 text-sm text-stone-300">Metrics across 4 dashboard panels</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Cycle analog</p>
                <p className="mt-2 text-3xl font-semibold">{cycleAnalog?.label ?? "Pending"}</p>
                <p className="mt-1 text-sm text-stone-300">
                  {cycleAnalogDatesLabel(cycleAnalog?.closestDateLabels)}
                </p>
                <p className="mt-1 text-xs text-stone-400">
                  {cycleAnalogAgreementLabel(cycleAnalog)}
                </p>
              </div>
            </div>
          </div>
        </header>

        {(error || isLoading) && (
          <section className="mt-6 grid gap-3">
            {isLoading && (
              <div className="rounded-[1.25rem] border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-600">
                Loading live dashboard data...
              </div>
            )}
            {error && (
              <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}
          </section>
        )}

        <nav className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {DASHBOARD_METRICS_BY_PANEL.map((panel) => {
            const isActive = panel.id === activePanelId;

            return (
              <button
                key={panel.id}
                type="button"
                onClick={() => {
                  setActivePanelId(panel.id);
                  setSelectedMetricId(panel.metrics[0].id);
                }}
                className={[
                  "rounded-[1.5rem] border p-4 text-left transition",
                  "bg-gradient-to-br shadow-sm",
                  panelAccent[panel.id],
                  isActive
                    ? "border-stone-900 bg-white shadow-panel"
                    : "border-stone-200 bg-white/70 hover:border-stone-300 hover:bg-white",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-stone-950">{panel.title}</h2>
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-stone-700">
                    {panel.metrics.length}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-600">{panel.description}</p>
              </button>
            );
          })}
        </nav>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_360px]">
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Active panel
                </p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight text-stone-950">
                  {activePanel.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">{activePanel.description}</p>
              </div>
              <div className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600">
                {activePanel.metrics.length} cards
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {activePanel.metrics.map((metric) => (
                <MetricCard
                  key={metric.id}
                  metric={metric}
                  metricState={
                    snapshot?.metrics[metric.id] ?? {
                      ...getMetricSample(metric.id)!,
                      isLive: false,
                      dataMode: "seeded",
                    }
                  }
                  selected={selectedMetric.id === metric.id}
                  onSelect={(nextMetric) => setSelectedMetricId(nextMetric.id)}
                />
              ))}
            </div>
          </div>

          <LearnPanel metric={selectedMetric} metricState={selectedMetricState} />
        </section>

        {showDebug && (
          <DebugPanel
            metrics={allMetricStates}
            generatedAt={cacheGeneratedAt}
            nextSuggestedRunAt={nextSuggestedRunAt}
            scheduler={scheduler}
            groups={groups}
            warnings={warnings}
          />
        )}
      </div>
    </div>
  );
}
