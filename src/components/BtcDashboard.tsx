import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DASHBOARD_METRICS,
  DASHBOARD_METRICS_BY_PANEL,
  DASHBOARD_PANELS,
  type DashboardMetric,
  type DashboardPanelId,
} from "../lib/dashboard-definitions";
import { getMetricSample } from "../lib/dashboard-samples";
import { useDashboardData } from "../hooks/useDashboardData";
import type {
  DashboardCacheGroupMeta,
  DashboardCycleAnalog,
  DashboardCycleAnalogWindow,
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
  derived: "bg-sky-50 text-sky-700 ring-sky-200",
  model: "bg-amber-50 text-amber-800 ring-amber-200",
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
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  fallback: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
};

const COINGECKO_ATTRIBUTION_URL =
  "https://www.coingecko.com/en/api?utm_source=btc-dashboard&utm_medium=referral";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function proxyNote(metricState: DashboardMetricState) {
  if (metricState.dataMode === "derived") {
    return `Derived note: this card is computed locally from ${metricState.sourceLabel}.`;
  }

  if (metricState.dataMode === "model") {
    return `Model note: this card is a local model overlay built from ${metricState.sourceLabel}.`;
  }

  return null;
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

function formatMonthYear(dateKey?: string) {
  if (!dateKey) {
    return null;
  }

  const date = new Date(`${dateKey}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function cycleAnalogTopDateLabels(cycleAnalog?: DashboardCycleAnalog | null) {
  if (cycleAnalog?.perCycleMatches?.length && cycleAnalog.topMatchDates?.length) {
    return cycleAnalog.topMatchDates
      .slice(0, 2)
      .map((dateKey) => formatMonthYear(dateKey))
      .filter(Boolean) as string[];
  }

  return [];
}

function cycleAnalogDatesLabel(cycleAnalog?: DashboardCycleAnalog | null) {
  if (!cycleAnalog?.perCycleMatches?.length) {
    return "Historical phase-window analog appears after the next synthetic refresh";
  }

  const dateLabels = cycleAnalogTopDateLabels(cycleAnalog);

  if (dateLabels.length === 0) {
    return "Historical comparison appears once enough analog data is available";
  }

  return `Analogous to prior-cycle ${dateLabels.join(", ")}`;
}

function cycleAnalogAgreementLabel(cycleAnalog?: DashboardCycleAnalog | null) {
  if (!cycleAnalog?.perCycleMatches?.length) {
    return "Phase-window analog pending refresh";
  }

  return `${cycleAnalog.agreement}% of prior cycles match this phase`;
}

function formatDistance(value?: number) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return value!.toFixed(3);
}

function formatCoverage(value?: number) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return `${Math.round(value! * 100)}%`;
}

function formatWindowLabel(startDate?: string, endDate?: string) {
  const start = formatMonthYear(startDate);
  const end = formatMonthYear(endDate);

  if (!start && !end) {
    return "Window unavailable";
  }

  if (start === end) {
    return start ?? "Window unavailable";
  }

  return `${start ?? "Unknown"} to ${end ?? "Unknown"}`;
}

function constructiveSummaryLabel(bullishCount: number, totalCount: number) {
  if (totalCount <= 0) {
    return "Signal summary appears once metric coverage is available";
  }

  return `${bullishCount} of ${totalCount} signals currently lean bullish`;
}

function constructiveToneLabel(bullishShare: number) {
  if (bullishShare >= 0.6) {
    return "Broadly constructive";
  }

  if (bullishShare >= 0.4) {
    return "Mixed but constructive";
  }

  if (bullishShare >= 0.25) {
    return "Selective strength";
  }

  return "Limited constructive breadth";
}

function constructiveSummaryText({
  bullishCount,
  neutralCount,
  bearishCount,
  totalCount,
}: {
  bullishCount: number;
  neutralCount: number;
  bearishCount: number;
  totalCount: number;
}) {
  if (totalCount <= 0) {
    return "Constructive breadth appears once the dashboard has live or fallback metric states.";
  }

  const bullishShare = bullishCount / totalCount;
  const tone = constructiveToneLabel(bullishShare);

  if (bullishCount === 0) {
    return `${tone}. None of the tracked dashboard signals currently lean bullish.`;
  }

  return `${tone}. ${bullishCount} signals lean bullish, ${neutralCount} sit in a neutral range, and ${bearishCount} still lean bearish.`;
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

const phaseTimelineOrder: Array<{
  id: DashboardCycleAnalogWindow["phaseId"];
  label: string;
}> = [
  { id: "deep-capitulation", label: "Capitulation" },
  { id: "bottoming-and-reaccumulation", label: "Reaccumulation" },
  { id: "early-recovery-under-disbelief", label: "Early Bull" },
  { id: "healthy-bull-expansion", label: "Bull Expansion" },
  { id: "late-cycle-acceleration", label: "Late Bull" },
  { id: "euphoric-overheating", label: "Overheating" },
  { id: "distribution-and-top-formation", label: "Distribution" },
  { id: "post-top-unwind", label: "Unwind" },
];

function CycleAnalogPhaseTimeline({
  dominantPhaseId,
  matches,
}: {
  dominantPhaseId?: DashboardCycleAnalog["phaseId"];
  matches: DashboardCycleAnalogWindow[];
}) {
  const width = 760;
  const height = Math.max(170, 96 + matches.length * 32);
  const leftColumn = 180;
  const rightPadding = 36;
  const xForIndex = (index: number) =>
    leftColumn + (index / Math.max(phaseTimelineOrder.length - 1, 1)) * (width - leftColumn - rightPadding);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      aria-label="Prior-cycle analog phases"
      role="img"
    >
      <line
        x1={leftColumn}
        y1={50}
        x2={width - rightPadding}
        y2={50}
        stroke="#d6d3d1"
        strokeWidth="2"
      />
      {phaseTimelineOrder.map((phase, index) => {
        const x = xForIndex(index);
        const isDominant = phase.id === dominantPhaseId;

        return (
          <g key={phase.id}>
            <circle
              cx={x}
              cy={50}
              r={isDominant ? 8 : 5}
              fill={isDominant ? "#f97316" : "#a8a29e"}
              stroke={isDominant ? "#fdba74" : "none"}
              strokeWidth={isDominant ? 2 : 0}
            />
            <text
              x={x}
              y={20}
              textAnchor="middle"
              fontSize="11"
              fill={isDominant ? "#f97316" : "#78716c"}
            >
              {phase.label}
            </text>
          </g>
        );
      })}
      {matches.map((match, index) => {
        const phaseIndex = phaseTimelineOrder.findIndex((phase) => phase.id === match.phaseId);
        const x = xForIndex(Math.max(phaseIndex, 0));
        const y = 86 + index * 32;

        return (
          <g key={`${match.cycleId}-${match.bestMatchDate}`}>
            <text
              x={16}
              y={y + 4}
              fontSize="12"
              fill="#44403c"
            >
              {match.cycleLabel}
            </text>
            <line
              x1={leftColumn}
              y1={y}
              x2={width - rightPadding}
              y2={y}
              stroke="#f5f5f4"
              strokeWidth="1"
            />
            <circle
              cx={x}
              cy={y}
              r="7"
              fill="#0f172a"
              stroke="#fdba74"
              strokeWidth="2"
            />
            <text
              x={x + 12}
              y={y + 4}
              fontSize="11"
              fill="#57534e"
            >
              {match.phaseLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CycleAnalogDistanceChart({
  matches,
}: {
  matches: DashboardCycleAnalogWindow[];
}) {
  const width = 760;
  const barWidth = 300;
  const leftColumn = 180;
  const rowHeight = 36;
  const height = Math.max(120, 28 + matches.length * rowHeight);
  const maxDistance = Math.max(...matches.map((match) => match.distance), 0.01);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      aria-label="Analog distance comparison by prior cycle"
      role="img"
    >
      {matches.map((match, index) => {
        const y = 24 + index * rowHeight;
        const normalized = clamp(match.distance / maxDistance, 0.08, 1);
        const fillWidth = normalized * barWidth;
        const isStrongest = index === 0;

        return (
          <g key={`${match.cycleId}-${match.distance}`}>
            <text
              x={16}
              y={y + 13}
              fontSize="12"
              fill="#44403c"
            >
              {match.cycleLabel}
            </text>
            <rect
              x={leftColumn}
              y={y}
              width={barWidth}
              height="14"
              rx="7"
              fill="#e7e5e4"
            />
            <rect
              x={leftColumn}
              y={y}
              width={fillWidth}
              height="14"
              rx="7"
              fill={isStrongest ? "#f97316" : "#57534e"}
              opacity={isStrongest ? 0.9 : 0.75}
            />
            <text
              x={leftColumn + barWidth + 16}
              y={y + 12}
              fontSize="11"
              fill="#57534e"
            >
              distance {formatDistance(match.distance)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CycleAnalogModal({
  cycleAnalog,
  closeButtonRef,
  onClose,
}: {
  cycleAnalog: DashboardCycleAnalog;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const matches = cycleAnalog.perCycleMatches ?? [];
  const phaseDistribution = cycleAnalog.phaseDistribution ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-stone-200 bg-stone-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cycle-analog-title"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50/95 px-6 py-5 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              Cycle Analog
            </p>
            <h2
              id="cycle-analog-title"
              className="mt-1 text-3xl font-semibold tracking-tight text-stone-950"
            >
              {cycleAnalog.label}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-8 px-6 py-6 lg:px-8">
          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-sm leading-7 text-stone-600">{cycleAnalog.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-700">
                  {cycleAnalog.agreement}% agreement
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {cycleAnalog.confidence}% confidence
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {cycleAnalog.methodology}
                </span>
              </div>
            </div>

            {phaseDistribution.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {phaseDistribution.map((phase) => (
                  <span
                    key={phase.phaseId}
                    className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600"
                  >
                    {phase.label}: {phase.cyclesMatched} cycles
                  </span>
                ))}
              </div>
            )}
          </section>

          {matches.length > 0 ? (
            <section className="grid gap-4 lg:grid-cols-3">
              {matches.map((match) => (
                <article
                  key={`${match.cycleId}-${match.bestMatchDate}`}
                  className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {match.cycleLabel}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-stone-950">{match.phaseLabel}</h3>
                  <p className="mt-1 text-sm text-stone-600">Best match {match.bestMatchDateLabel}</p>
                  <div className="mt-4 grid gap-3 text-sm text-stone-600">
                    <div className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Phase window</p>
                      <p className="mt-1 font-medium text-stone-900">
                        {formatWindowLabel(match.windowStartDate, match.windowEndDate)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Distance</p>
                      <p className="mt-1 font-medium text-stone-900">{formatDistance(match.distance)}</p>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Coverage</p>
                      <p className="mt-1 font-medium text-stone-900">{formatCoverage(match.coverage)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 text-sm text-stone-600 shadow-sm">
              Detailed prior-cycle matches will appear after the next synthetic refresh computes the new phase-window analog payload.
            </section>
          )}

          {matches.length > 0 && (
            <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                  Phase Ladder
                </p>
                <div className="mt-4">
                  <CycleAnalogPhaseTimeline
                    dominantPhaseId={cycleAnalog.phaseId}
                    matches={matches}
                  />
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                  Distance By Cycle
                </p>
                <div className="mt-4">
                  <CycleAnalogDistanceChart matches={matches} />
                </div>
              </div>
            </section>
          )}

          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Indicator Support
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {cycleAnalog.indicatorIds.map((indicatorId) => (
                <span
                  key={indicatorId}
                  className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm text-stone-700"
                >
                  {indicatorId}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ConstructiveSignalsModal({
  bullishMetrics,
  neutralMetrics,
  bearishMetrics,
  neutralCount,
  bearishCount,
  closeButtonRef,
  onClose,
}: {
  bullishMetrics: Array<{ metric: DashboardMetric; state: DashboardMetricState }>;
  neutralMetrics: Array<{ metric: DashboardMetric; state: DashboardMetricState }>;
  bearishMetrics: Array<{ metric: DashboardMetric; state: DashboardMetricState }>;
  neutralCount: number;
  bearishCount: number;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const totalCount = bullishMetrics.length + neutralCount + bearishCount;
  const bullishShare = totalCount > 0 ? bullishMetrics.length / totalCount : 0;
  const groupedBullishMetrics = DASHBOARD_PANELS.map((panel) => ({
    panel,
    metrics: bullishMetrics.filter((entry) => entry.metric.panelId === panel.id),
  })).filter((group) => group.metrics.length > 0);
  const groupedBearishMetrics = DASHBOARD_PANELS.map((panel) => ({
    panel,
    metrics: bearishMetrics.filter((entry) => entry.metric.panelId === panel.id),
  })).filter((group) => group.metrics.length > 0);
  const groupedNeutralMetrics = DASHBOARD_PANELS.map((panel) => ({
    panel,
    metrics: neutralMetrics.filter((entry) => entry.metric.panelId === panel.id),
  })).filter((group) => group.metrics.length > 0);
  const topBullishMetrics = [...bullishMetrics]
    .sort((left, right) => {
      const leftPriority = left.metric.mobilePriority ?? 99;
      const rightPriority = right.metric.mobilePriority ?? 99;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.metric.name.localeCompare(right.metric.name);
    })
    .slice(0, 6);
  const topBearishMetrics = [...bearishMetrics]
    .sort((left, right) => {
      const leftPriority = left.metric.mobilePriority ?? 99;
      const rightPriority = right.metric.mobilePriority ?? 99;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.metric.name.localeCompare(right.metric.name);
    })
    .slice(0, 6);
  const dataModeCounts = [...bullishMetrics, ...neutralMetrics, ...bearishMetrics].reduce<Record<string, number>>((acc, entry) => {
    const key = entry.state.dataMode ?? "seeded";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-stone-200 bg-stone-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="constructive-signals-title"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50/95 px-6 py-5 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
              Constructive Signals
            </p>
            <h2
              id="constructive-signals-title"
              className="mt-1 text-3xl font-semibold tracking-tight text-stone-950"
            >
              {constructiveToneLabel(bullishShare)}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-8 px-6 py-6 lg:px-8">
          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-sm leading-7 text-stone-600">
                  {constructiveSummaryText({
                    bullishCount: bullishMetrics.length,
                    neutralCount,
                    bearishCount,
                    totalCount,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                  {bullishMetrics.length} bullish
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {neutralCount} neutral
                </span>
                <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-700">
                  {bearishCount} bearish
                </span>
              </div>
            </div>
          </section>

          {topBullishMetrics.length > 0 && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                Leading constructive reads
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {topBullishMetrics.map(({ metric, state }) => (
                  <article
                    key={metric.id}
                    className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                          {metric.shortName ?? metric.name}
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-stone-950">{state.currentValue}</p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        {formatRelativeTime(state.asOf)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-stone-700">{metric.bullishInterpretation}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {topBearishMetrics.length > 0 && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                Main bearish pressure
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {topBearishMetrics.map(({ metric, state }) => (
                  <article
                    key={metric.id}
                    className="rounded-[1.25rem] border border-rose-200 bg-rose-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
                          {metric.shortName ?? metric.name}
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-stone-950">{state.currentValue}</p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                        {formatRelativeTime(state.asOf)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-stone-700">{metric.bearishInterpretation}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {groupedBullishMetrics.length > 0 ? (
            <section className="grid gap-4 lg:grid-cols-2">
              {groupedBullishMetrics.map(({ panel, metrics }) => (
                <article
                  key={panel.id}
                  className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {panel.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-600">{panel.description}</p>
                  <div className="mt-4 grid gap-3">
                    {metrics.map(({ metric, state }) => (
                      <div
                        key={metric.id}
                        className="rounded-[1.25rem] bg-stone-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-stone-950">{metric.name}</p>
                            <p className="mt-1 text-sm text-stone-600">{state.currentValue}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              Bullish
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${dataModeClasses[state.dataMode ?? "seeded"]}`}
                            >
                              {state.dataMode ?? "seeded"}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-stone-700">
                          {metric.bullishInterpretation}
                        </p>
                        <p className="mt-2 text-xs text-stone-500">
                          Source: {state.sourceLabel} • Updated {formatRelativeTime(state.asOf)}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 text-sm text-stone-600 shadow-sm">
              No tracked signals currently lean bullish.
            </section>
          )}

          {groupedBearishMetrics.length > 0 && (
            <section className="grid gap-4 lg:grid-cols-2">
              {groupedBearishMetrics.map(({ panel, metrics }) => (
                <article
                  key={panel.id}
                  className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {panel.title} bearish signals
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-600">{panel.description}</p>
                  <div className="mt-4 grid gap-3">
                    {metrics.map(({ metric, state }) => (
                      <div
                        key={metric.id}
                        className="rounded-[1.25rem] bg-stone-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-stone-950">{metric.name}</p>
                            <p className="mt-1 text-sm text-stone-600">{state.currentValue}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                              Bearish
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${dataModeClasses[state.dataMode ?? "seeded"]}`}
                            >
                              {state.dataMode ?? "seeded"}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-stone-700">
                          {metric.bearishInterpretation}
                        </p>
                        <p className="mt-2 text-xs text-stone-500">
                          Source: {state.sourceLabel} • Updated {formatRelativeTime(state.asOf)}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          )}

          {groupedNeutralMetrics.length > 0 && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                Neutral / watchlist signals
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groupedNeutralMetrics.flatMap(({ panel, metrics }) =>
                  metrics.map(({ metric, state }) => (
                    <div
                      key={metric.id}
                      className="rounded-[1.25rem] bg-stone-50 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-stone-950">{metric.name}</p>
                          <p className="mt-1 text-sm text-stone-600">{state.currentValue}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                            Neutral
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-200">
                            {panel.title}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">
                        Source: {state.sourceLabel} • Updated {formatRelativeTime(state.asOf)}
                      </p>
                    </div>
                  )),
                )}
              </div>
            </section>
          )}

          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Signal support by data mode
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(["live", "derived", "model", "seeded"] as const).map((dataMode) => (
                <span
                  key={dataMode}
                  className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${dataModeClasses[dataMode]}`}
                >
                  {dataMode}: {dataModeCounts[dataMode] ?? 0}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DebugPanel({
  metrics,
  generatedAt,
  nextSuggestedRunAt,
  scheduler,
  groups,
  warnings,
  dataMode,
  liveMetricCount,
  isRefreshing,
  refreshNotice,
  onRefresh,
}: {
  metrics: Record<string, DashboardMetricState>;
  generatedAt?: number;
  nextSuggestedRunAt?: number;
  scheduler?: string;
  groups?: Partial<Record<"fast" | "daily" | "slow" | "synthetic", DashboardCacheGroupMeta>>;
  warnings: string[];
  dataMode: string;
  liveMetricCount: number;
  isRefreshing: boolean;
  refreshNotice?: { kind: "success" | "fallback" | "error"; message: string; completedAt: number } | null;
  onRefresh: () => void;
}) {
  const counts = Object.values(metrics).reduce<Record<string, number>>((acc, metric) => {
    const key = metric.dataMode ?? "seeded";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="rounded-[1.5rem] bg-white/90 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Debug / Cache
          </p>
          <h3 className="mt-1 text-xl font-semibold text-stone-950">Connector cache health</h3>
        </div>
        <div className="text-sm text-stone-500">
          {generatedAt ? `Cache updated ${formatRelativeTime(generatedAt)}` : "Cache timestamp unavailable"}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
        >
          {isRefreshing ? "Refreshing..." : "Refresh data"}
        </button>
        <div className="rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600">
          Mode: <span className="font-semibold capitalize text-stone-950">{dataMode}</span>
        </div>
        <div className="rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600">
          Live metrics: <span className="font-semibold text-stone-950">{liveMetricCount}</span>
        </div>
        {refreshNotice && !isRefreshing && (
          <div
            className={`rounded-full border px-4 py-2 text-sm ${refreshNoticeClasses[refreshNotice.kind]}`}
          >
            {refreshNotice.message} {formatRelativeTime(refreshNotice.completedAt)}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-stone-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Seeded</p>
          <p className="mt-2 text-2xl font-semibold text-stone-950">{counts.seeded ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-sky-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-sky-700">Derived</p>
          <p className="mt-2 text-2xl font-semibold text-sky-950">{counts.derived ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-amber-700">Model</p>
          <p className="mt-2 text-2xl font-semibold text-amber-950">{counts.model ?? 0}</p>
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

function CoinGeckoAttribution() {
  return (
    <section className="mt-4 rounded-[1.25rem] border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950">
      <p className="leading-6">
        Price and market-cap data provided by{" "}
        <a
          href={COINGECKO_ATTRIBUTION_URL}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline decoration-emerald-400 underline-offset-2"
        >
          CoinGecko API
        </a>
        .
      </p>
    </section>
  );
}

export function BtcDashboard() {
  const [activePanelId, setActivePanelId] = useState<DashboardPanelId>("price-action");
  const [selectedMetricId, setSelectedMetricId] = useState<string>(DASHBOARD_METRICS[0].id);
  const [showDebug, setShowDebug] = useState(false);
  const [showConstructiveModal, setShowConstructiveModal] = useState(false);
  const [showCycleAnalogModal, setShowCycleAnalogModal] = useState(false);
  const constructiveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const constructiveCloseRef = useRef<HTMLButtonElement | null>(null);
  const cycleAnalogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cycleAnalogCloseRef = useRef<HTMLButtonElement | null>(null);
  const { snapshot, isLoading, isRefreshing, error, refreshNotice, refresh } = useDashboardData();

  const activePanel =
    DASHBOARD_METRICS_BY_PANEL.find((panel) => panel.id === activePanelId) ??
    DASHBOARD_METRICS_BY_PANEL[0];

  const selectedMetric =
    DASHBOARD_METRICS.find((metric) => metric.id === selectedMetricId) ?? activePanel.metrics[0];

  const metricEntries = DASHBOARD_METRICS.map((metric) => ({
    metric,
    state: snapshot?.metrics[metric.id] ?? getMetricSample(metric.id),
  })).filter((entry): entry is { metric: DashboardMetric; state: DashboardMetricState } => Boolean(entry.state));
  const bullishMetrics = metricEntries.filter((entry) => entry.state.status === "bullish");
  const neutralMetrics = metricEntries.filter((entry) => entry.state.status === "neutral");
  const bearishMetrics = metricEntries.filter((entry) => entry.state.status === "bearish");
  const bullishCount = bullishMetrics.length;
  const neutralCount = neutralMetrics.length;
  const bearishCount = bearishMetrics.length;

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
  const hasConstructiveSignals = metricEntries.length > 0;
  const hasPhaseWindowAnalog = Boolean(cycleAnalog?.perCycleMatches?.length);

  useEffect(() => {
    if (!cycleAnalog) {
      setShowCycleAnalogModal(false);
    }
  }, [cycleAnalog]);

  useEffect(() => {
    if (!showConstructiveModal || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(() => constructiveCloseRef.current?.focus())
        : 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowConstructiveModal(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(focusFrame);
        window.requestAnimationFrame(() => constructiveTriggerRef.current?.focus());
      }
    };
  }, [showConstructiveModal]);

  useEffect(() => {
    if (!showCycleAnalogModal || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(() => cycleAnalogCloseRef.current?.focus())
        : 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCycleAnalogModal(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(focusFrame);
        window.requestAnimationFrame(() => cycleAnalogTriggerRef.current?.focus());
      }
    };
  }, [showCycleAnalogModal]);

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
              <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Track price action, cycle regime, network health, and macro structure in one place.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300 sm:text-base">
                This dashboard now runs on a strict free, API-first connector layer with compact cache
                cohorts, local derivations, and graceful fallback snapshots.
              </p>
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
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">BTC price</p>
                <p className="mt-2 text-3xl font-semibold">{btcPrice}</p>
                <p className="mt-1 text-sm text-stone-300">{btcPriceChange}</p>
              </div>
              <button
                ref={constructiveTriggerRef}
                type="button"
                onClick={() => hasConstructiveSignals && setShowConstructiveModal(true)}
                disabled={!hasConstructiveSignals}
                aria-haspopup="dialog"
                aria-expanded={showConstructiveModal}
                className={[
                  "rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-left transition",
                  hasConstructiveSignals
                    ? "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    : "cursor-default opacity-80",
                ].join(" ")}
              >
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Constructive</p>
                <p className="mt-2 text-3xl font-semibold">{bullishCount}</p>
                <p className="mt-1 text-sm text-stone-300">
                  {constructiveSummaryLabel(bullishCount, metricEntries.length)}
                </p>
                <p className="mt-1 text-xs text-stone-400">
                  {constructiveSummaryText({
                    bullishCount,
                    neutralCount,
                    bearishCount,
                    totalCount: metricEntries.length,
                  })}
                </p>
              </button>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Coverage</p>
                <p className="mt-2 text-3xl font-semibold">{DASHBOARD_METRICS.length}</p>
                <p className="mt-1 text-sm text-stone-300">Metrics across 4 dashboard panels</p>
              </div>
              <button
                ref={cycleAnalogTriggerRef}
                type="button"
                onClick={() => hasPhaseWindowAnalog && setShowCycleAnalogModal(true)}
                disabled={!hasPhaseWindowAnalog}
                aria-haspopup="dialog"
                aria-expanded={showCycleAnalogModal}
                className={[
                  "rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-left transition",
                  hasPhaseWindowAnalog
                    ? "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                    : "cursor-default opacity-80",
                ].join(" ")}
              >
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Cycle analog</p>
                <p className="mt-2 text-3xl font-semibold">{cycleAnalog?.label ?? "Pending"}</p>
                <p className="mt-1 text-sm text-stone-300">
                  {cycleAnalogDatesLabel(cycleAnalog)}
                </p>
                <p className="mt-1 text-xs text-stone-400">
                  {cycleAnalogAgreementLabel(cycleAnalog)}
                </p>
              </button>
            </div>
          </div>
        </header>

        <CoinGeckoAttribution />

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

        <section className="mt-6 rounded-[1.5rem] border border-stone-200 bg-white/80 shadow-sm">
          <button
            type="button"
            onClick={() => setShowDebug((current) => !current)}
            aria-expanded={showDebug}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-stone-50"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Debug / Cache
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Inspect cache freshness, provenance counts, and connector health.
              </p>
            </div>
            <div className="shrink-0 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm font-semibold text-stone-700">
              {showDebug ? "Hide" : "Show"}
            </div>
          </button>

          {showDebug && (
            <div className="border-t border-stone-200 px-1 pb-1">
              <DebugPanel
                metrics={allMetricStates}
              generatedAt={cacheGeneratedAt}
              nextSuggestedRunAt={nextSuggestedRunAt}
              scheduler={scheduler}
              groups={groups}
              warnings={warnings}
              dataMode={dataMode}
              liveMetricCount={liveMetricCount}
              isRefreshing={isRefreshing}
              refreshNotice={refreshNotice}
              onRefresh={refresh}
            />
            </div>
          )}
        </section>

        {showConstructiveModal && (
          <ConstructiveSignalsModal
            bullishMetrics={bullishMetrics}
            neutralMetrics={neutralMetrics}
            bearishMetrics={bearishMetrics}
            neutralCount={neutralCount}
            bearishCount={bearishCount}
            closeButtonRef={constructiveCloseRef}
            onClose={() => setShowConstructiveModal(false)}
          />
        )}

        {showCycleAnalogModal && cycleAnalog && (
          <CycleAnalogModal
            cycleAnalog={cycleAnalog}
            closeButtonRef={cycleAnalogCloseRef}
            onClose={() => setShowCycleAnalogModal(false)}
          />
        )}
      </div>
    </div>
  );
}
