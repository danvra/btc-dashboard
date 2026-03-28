import {
  DASHBOARD_METRICS_BY_PANEL,
  type ChartType,
  type DashboardMetric,
  type UpdateFrequency,
} from "../lib/dashboard-definitions";

const chartTypeLabels: Record<ChartType, string> = {
  line: "Line",
  area: "Area",
  bar: "Bar",
  histogram: "Histogram",
  "step-line": "Step line",
  gauge: "Gauge",
  "line-with-zones": "Line + zones",
  "bars-plus-line": "Bars + cumulative line",
};

const updateFrequencyLabels: Record<UpdateFrequency, string> = {
  "real-time": "Real-time",
  daily: "Daily",
  weekly: "Weekly",
};

function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-stone-900">{metric.name}</h3>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            <span className="font-medium text-stone-800">{metric.tooltip.what}</span>
            {" "}
            {metric.tooltip.why}
          </p>
        </div>
        <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
          {updateFrequencyLabels[metric.updateFrequency]}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
          {chartTypeLabels[metric.chartType]}
        </span>
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
          {metric.valueFormat ?? "number"}
        </span>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-emerald-700">Bullish read</dt>
          <dd className="mt-1 text-stone-600">{metric.bullishInterpretation}</dd>
        </div>
        <div>
          <dt className="font-medium text-rose-700">Bearish read</dt>
          <dd className="mt-1 text-stone-600">{metric.bearishInterpretation}</dd>
        </div>
        <div>
          <dt className="font-medium text-stone-800">Learn more</dt>
          <dd className="mt-1 text-stone-600">{metric.learnMore}</dd>
        </div>
      </dl>
    </article>
  );
}

export function BtcDashboardDefinitionsPreview() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.12),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#f5f5f4_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-700">
            BTC Monitoring Dashboard
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-950">
            React/Tailwind-ready metric definitions
          </h1>
          <p className="mt-4 text-base leading-7 text-stone-600">
            A presentational layer for the dashboard spec, with grouped panels,
            short tooltip copy, chart preferences, update frequencies, and simple bullish or bearish reads.
          </p>
        </header>

        <div className="mt-10 space-y-10">
          {DASHBOARD_METRICS_BY_PANEL.map((panel) => (
            <section key={panel.id}>
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-stone-900">{panel.title}</h2>
                  <p className="text-sm text-stone-600">{panel.description}</p>
                </div>
                <p className="text-sm text-stone-500">{panel.metrics.length} metrics</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {panel.metrics.map((metric) => (
                  <MetricCard key={metric.id} metric={metric} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
