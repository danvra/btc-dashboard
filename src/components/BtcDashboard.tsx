import { useState } from "react";
import {
  DASHBOARD_METRICS,
  DASHBOARD_METRICS_BY_PANEL,
  type DashboardMetric,
  type DashboardPanelId,
} from "../lib/dashboard-definitions";
import { getMetricSample } from "../lib/dashboard-samples";
import { useDashboardData } from "../hooks/useDashboardData";
import type { DashboardMetricState } from "../lib/dashboard-data";

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

function Sparkline({
  values,
  tone,
}: {
  values: number[];
  tone: "bullish" | "bearish" | "neutral";
}) {
  const width = 220;
  const height = 84;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
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
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ring-1 ${
            dataModeClasses[metricState.dataMode ?? "seeded"]
          }`}
        >
          {metricState.dataMode ?? "seeded"}
        </span>
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
          <div className="mt-3 inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700">
            {metricState.dataMode ?? "seeded"}
          </div>
        </div>
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

export function BtcDashboard() {
  const [activePanelId, setActivePanelId] = useState<DashboardPanelId>("price-action");
  const [selectedMetricId, setSelectedMetricId] = useState<string>(DASHBOARD_METRICS[0].id);
  const { snapshot, isLoading, isRefreshing, error, refresh } = useDashboardData();

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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.14),transparent_30%),linear-gradient(180deg,#fafaf9_0%,#f5f5f4_100%)] text-stone-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="overflow-hidden rounded-[2rem] border border-stone-200 bg-stone-950 text-stone-50 shadow-panel">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.6fr_1fr] lg:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-orange-300">
                BTC Monitoring Dashboard
              </p>
              <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
                Track price action, cycle regime, network health, and macro structure in one place.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300 sm:text-base">
                This dashboard now mixes live market and network data with graceful fallbacks for metrics
                that still need a dedicated on-chain or macro provider key.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={refresh}
                  className="rounded-full bg-orange-400 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-orange-300"
                >
                  {isRefreshing ? "Refreshing..." : "Refresh data"}
                </button>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200">
                  Mode: <span className="font-semibold capitalize text-white">{dataMode}</span>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200">
                  Live metrics: <span className="font-semibold text-white">{liveMetricCount}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
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
            </div>
          </div>
        </header>

        {(warnings.length > 0 || error || isLoading) && (
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
            {warnings.map((warning) => (
              <div
                key={warning}
                className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              >
                {warning}
              </div>
            ))}
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
      </div>
    </div>
  );
}
