import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DASHBOARD_METRICS,
  DASHBOARD_METRICS_BY_PANEL,
  DASHBOARD_PANELS,
  type DashboardMetric,
  type DashboardPanelId,
} from "../lib/dashboard-definitions";
import { DASHBOARD_MESSAGES, fillMessage } from "../lib/dashboard-messages";
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
  "rule-based": DASHBOARD_MESSAGES.cycleEstimate.sourceRuleBased,
  "llm-assisted": DASHBOARD_MESSAGES.cycleEstimate.sourceLlmAssisted,
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

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) {
    return DASHBOARD_MESSAGES.common.noTimestamp;
  }

  const diffMs = Date.now() - timestamp;
  const isFuture = diffMs < 0;
  const diffMinutes = Math.max(Math.round(Math.abs(diffMs) / 60000), 0);

  if (diffMinutes < 1) {
    return isFuture ? DASHBOARD_MESSAGES.common.inUnderAMinute : DASHBOARD_MESSAGES.common.justNow;
  }

  if (diffMinutes < 60) {
    return fillMessage(
      isFuture ? DASHBOARD_MESSAGES.relativeTime.minutesFuture : DASHBOARD_MESSAGES.relativeTime.minutesPast,
      { value: diffMinutes },
    );
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 48) {
    return fillMessage(
      isFuture ? DASHBOARD_MESSAGES.relativeTime.hoursFuture : DASHBOARD_MESSAGES.relativeTime.hoursPast,
      { value: diffHours },
    );
  }

  const diffDays = Math.round(diffHours / 24);
  return fillMessage(
    isFuture ? DASHBOARD_MESSAGES.relativeTime.daysFuture : DASHBOARD_MESSAGES.relativeTime.daysPast,
    { value: diffDays },
  );
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
    return DASHBOARD_MESSAGES.cycleEstimate.changeLater;
  }

  if (change === "earlier") {
    return DASHBOARD_MESSAGES.cycleEstimate.changeEarlier;
  }

  return DASHBOARD_MESSAGES.cycleEstimate.changeUnchanged;
}

function groupStatusLabel(status?: DashboardCacheGroupMeta["status"]) {
  if (status === "fresh") {
    return DASHBOARD_MESSAGES.status.fresh;
  }

  if (status === "stale" || status === "expired") {
    return DASHBOARD_MESSAGES.status.stale;
  }

  return DASHBOARD_MESSAGES.status.unknown;
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
    return DASHBOARD_MESSAGES.cycleAnalog.datesPending;
  }

  const dateLabels = cycleAnalogTopDateLabels(cycleAnalog);

  if (dateLabels.length === 0) {
    return DASHBOARD_MESSAGES.cycleAnalog.datesWaiting;
  }

  return fillMessage(DASHBOARD_MESSAGES.cycleAnalog.datesTemplate, {
    value: dateLabels.join(", "),
  });
}

function cycleAnalogAgreementLabel(cycleAnalog?: DashboardCycleAnalog | null) {
  if (!cycleAnalog?.perCycleMatches?.length) {
    return DASHBOARD_MESSAGES.cycleAnalog.agreementPending;
  }

  return fillMessage(DASHBOARD_MESSAGES.cycleAnalog.agreementTemplate, {
    value: cycleAnalog.agreement,
  });
}

function formatDistance(value?: number) {
  if (!Number.isFinite(value)) {
    return DASHBOARD_MESSAGES.common.notAvailable;
  }

  return value!.toFixed(3);
}

function formatCoverage(value?: number) {
  if (!Number.isFinite(value)) {
    return DASHBOARD_MESSAGES.common.notAvailable;
  }

  return `${Math.round(value! * 100)}%`;
}

function formatWindowLabel(startDate?: string, endDate?: string) {
  const start = formatMonthYear(startDate);
  const end = formatMonthYear(endDate);

  if (!start && !end) {
    return DASHBOARD_MESSAGES.common.windowUnavailable;
  }

  if (start === end) {
    return start ?? DASHBOARD_MESSAGES.common.windowUnavailable;
  }

  return `${start ?? DASHBOARD_MESSAGES.common.unknown} to ${end ?? DASHBOARD_MESSAGES.common.unknown}`;
}

function constructiveSummaryLabel(bullishCount: number, totalCount: number) {
  if (totalCount <= 0) {
    return DASHBOARD_MESSAGES.constructive.summaryPending;
  }

  return fillMessage(DASHBOARD_MESSAGES.constructive.summaryLabel, {
    bullish: bullishCount,
    total: totalCount,
  });
}

function constructiveToneLabel(bullishShare: number) {
  if (bullishShare >= 0.6) {
    return DASHBOARD_MESSAGES.constructive.toneBroadlyConstructive;
  }

  if (bullishShare >= 0.4) {
    return DASHBOARD_MESSAGES.constructive.toneMixedButConstructive;
  }

  if (bullishShare >= 0.25) {
    return DASHBOARD_MESSAGES.constructive.toneSelectiveStrength;
  }

  return DASHBOARD_MESSAGES.constructive.toneLimitedBreadth;
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
    return DASHBOARD_MESSAGES.constructive.summaryNoMetrics;
  }

  const bullishShare = bullishCount / totalCount;
  const tone = constructiveToneLabel(bullishShare);

  if (bullishCount === 0) {
    return fillMessage(DASHBOARD_MESSAGES.constructive.summaryNoneBullish, {
      tone,
    });
  }

  return fillMessage(DASHBOARD_MESSAGES.constructive.summaryWithCounts, {
    tone,
    bullish: bullishCount,
    neutral: neutralCount,
    bearish: bearishCount,
  });
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
  const dataModeLabel = DASHBOARD_MESSAGES.status[metricState.dataMode ?? "seeded"];
  const sentimentLabel = DASHBOARD_MESSAGES.status[metricState.status];

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
          {sentimentLabel}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ring-1 ${
              dataModeClasses[metricState.dataMode ?? "seeded"]
            }`}
          >
            {dataModeLabel}
          </span>
          <span
            className={`text-xs font-medium ${freshnessClasses[freshnessTone(metricState.asOf)]}`}
          >
            {metricState.asOf
              ? fillMessage(DASHBOARD_MESSAGES.card.updatedPrefix, {
                  value: formatRelativeTime(metricState.asOf),
                })
              : DASHBOARD_MESSAGES.common.noLiveTimestamp}
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
          <span className="font-medium text-stone-900">{DASHBOARD_MESSAGES.card.measuresLabel}</span> {metric.tooltip.what}
        </p>
        <p>
          <span className="font-medium text-stone-900">{DASHBOARD_MESSAGES.card.mattersLabel}</span> {metric.tooltip.why}
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
  const dataModeLabel = DASHBOARD_MESSAGES.status[metricState.dataMode ?? "seeded"];

  return (
    <aside className="rounded-[1.75rem] border border-stone-200 bg-white/95 p-6 shadow-panel lg:sticky lg:top-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
        {DASHBOARD_MESSAGES.learnPanel.selectedMetricLabel}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
        {metric.name}
      </h2>
      <p className="mt-3 text-sm leading-6 text-stone-600">{metric.learnMore}</p>

      <dl className="mt-6 grid gap-4">
        <div className="rounded-2xl bg-stone-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
            {DASHBOARD_MESSAGES.learnPanel.currentSnapshotLabel}
          </dt>
          <dd className="mt-2 text-2xl font-semibold text-stone-950">
            {metricState.currentValue}
          </dd>
          <p className="mt-1 text-sm text-stone-600">{metricState.deltaLabel}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700">
              {dataModeLabel}
            </div>
            <div className={`text-xs font-medium ${freshnessClasses[freshnessTone(metricState.asOf)]}`}>
              {metricState.asOf
                ? fillMessage(DASHBOARD_MESSAGES.card.updatedPrefix, {
                    value: formatRelativeTime(metricState.asOf),
                  })
                : DASHBOARD_MESSAGES.common.noLiveTimestamp}
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-stone-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
            {DASHBOARD_MESSAGES.learnPanel.sourceLabel}
          </dt>
          <dd className="mt-2 text-sm leading-6 text-stone-700">{metricState.sourceLabel}</dd>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            {DASHBOARD_MESSAGES.learnPanel.bullishReadLabel}
          </dt>
          <dd className="mt-2 text-sm leading-6 text-emerald-950">
            {metric.bullishInterpretation}
          </dd>
        </div>
        <div className="rounded-2xl bg-rose-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
            {DASHBOARD_MESSAGES.learnPanel.bearishReadLabel}
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
  { id: "deep-capitulation", label: DASHBOARD_MESSAGES.cycleAnalog.phaseCapitulation },
  { id: "bottoming-and-reaccumulation", label: DASHBOARD_MESSAGES.cycleAnalog.phaseReaccumulation },
  { id: "early-recovery-under-disbelief", label: DASHBOARD_MESSAGES.cycleAnalog.phaseEarlyBull },
  { id: "healthy-bull-expansion", label: DASHBOARD_MESSAGES.cycleAnalog.phaseBullExpansion },
  { id: "late-cycle-acceleration", label: DASHBOARD_MESSAGES.cycleAnalog.phaseLateBull },
  { id: "euphoric-overheating", label: DASHBOARD_MESSAGES.cycleAnalog.phaseOverheating },
  { id: "distribution-and-top-formation", label: DASHBOARD_MESSAGES.cycleAnalog.phaseDistribution },
  { id: "post-top-unwind", label: DASHBOARD_MESSAGES.cycleAnalog.phaseUnwind },
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
      aria-label={DASHBOARD_MESSAGES.cycleAnalog.timelineAria}
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
      aria-label={DASHBOARD_MESSAGES.cycleAnalog.distanceChartAria}
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
              {DASHBOARD_MESSAGES.cycleAnalog.eyebrow}
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
            {DASHBOARD_MESSAGES.common.close}
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
                  {fillMessage(DASHBOARD_MESSAGES.cycleAnalog.agreementBadge, {
                    value: cycleAnalog.agreement,
                  })}
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {fillMessage(DASHBOARD_MESSAGES.cycleAnalog.confidenceBadge, {
                    value: cycleAnalog.confidence,
                  })}
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
                    {phase.label}: {phase.cyclesMatched} {DASHBOARD_MESSAGES.app.coverageSuffix}
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
                  <p className="mt-1 text-sm text-stone-600">
                    {fillMessage(DASHBOARD_MESSAGES.cycleAnalog.bestMatchPrefix, {
                      value: match.bestMatchDateLabel,
                    })}
                  </p>
                  <div className="mt-4 grid gap-3 text-sm text-stone-600">
                    <div className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">
                        {DASHBOARD_MESSAGES.cycleAnalog.phaseWindowLabel}
                      </p>
                      <p className="mt-1 font-medium text-stone-900">
                        {formatWindowLabel(match.windowStartDate, match.windowEndDate)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">
                        {DASHBOARD_MESSAGES.cycleAnalog.distanceLabel}
                      </p>
                      <p className="mt-1 font-medium text-stone-900">{formatDistance(match.distance)}</p>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">
                        {DASHBOARD_MESSAGES.cycleAnalog.coverageLabel}
                      </p>
                      <p className="mt-1 font-medium text-stone-900">{formatCoverage(match.coverage)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 text-sm text-stone-600 shadow-sm">
              {DASHBOARD_MESSAGES.cycleAnalog.noMatches}
            </section>
          )}

          {matches.length > 0 && (
            <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {DASHBOARD_MESSAGES.cycleAnalog.phaseLadderLabel}
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
                  {DASHBOARD_MESSAGES.cycleAnalog.distanceByCycleLabel}
                </p>
                <div className="mt-4">
                  <CycleAnalogDistanceChart matches={matches} />
                </div>
              </div>
            </section>
          )}

          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              {DASHBOARD_MESSAGES.cycleAnalog.indicatorSupportLabel}
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
              {DASHBOARD_MESSAGES.constructive.eyebrow}
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
            {DASHBOARD_MESSAGES.common.close}
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
                  {fillMessage(DASHBOARD_MESSAGES.constructive.bullishBadge, {
                    value: bullishMetrics.length,
                  })}
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {fillMessage(DASHBOARD_MESSAGES.constructive.neutralBadge, {
                    value: neutralCount,
                  })}
                </span>
                <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-700">
                  {fillMessage(DASHBOARD_MESSAGES.constructive.bearishBadge, {
                    value: bearishCount,
                  })}
                </span>
              </div>
            </div>
          </section>

          {topBullishMetrics.length > 0 && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                {DASHBOARD_MESSAGES.constructive.leadingConstructiveReads}
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
                {DASHBOARD_MESSAGES.constructive.mainBearishPressure}
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
                              {DASHBOARD_MESSAGES.status.bullish}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${dataModeClasses[state.dataMode ?? "seeded"]}`}
                            >
                              {DASHBOARD_MESSAGES.status[state.dataMode ?? "seeded"]}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-stone-700">
                          {metric.bullishInterpretation}
                        </p>
                        <p className="mt-2 text-xs text-stone-500">
                          {fillMessage(DASHBOARD_MESSAGES.constructive.sourceUpdated, {
                            source: state.sourceLabel,
                            relative: formatRelativeTime(state.asOf),
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 text-sm text-stone-600 shadow-sm">
              {DASHBOARD_MESSAGES.constructive.noBullishSignals}
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
                    {fillMessage(DASHBOARD_MESSAGES.constructive.panelBearishSuffix, {
                      value: panel.title,
                    })}
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
                              {DASHBOARD_MESSAGES.status.bearish}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${dataModeClasses[state.dataMode ?? "seeded"]}`}
                            >
                              {DASHBOARD_MESSAGES.status[state.dataMode ?? "seeded"]}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-stone-700">
                          {metric.bearishInterpretation}
                        </p>
                        <p className="mt-2 text-xs text-stone-500">
                          {fillMessage(DASHBOARD_MESSAGES.constructive.sourceUpdated, {
                            source: state.sourceLabel,
                            relative: formatRelativeTime(state.asOf),
                          })}
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
                {DASHBOARD_MESSAGES.constructive.neutralWatchlist}
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
                            {DASHBOARD_MESSAGES.status.neutral}
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-200">
                            {panel.title}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">
                        {fillMessage(DASHBOARD_MESSAGES.constructive.sourceUpdated, {
                          source: state.sourceLabel,
                          relative: formatRelativeTime(state.asOf),
                        })}
                      </p>
                    </div>
                  )),
                )}
              </div>
            </section>
          )}

          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              {DASHBOARD_MESSAGES.constructive.signalSupportByDataMode}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(["live", "derived", "model", "seeded"] as const).map((dataMode) => (
                <span
                  key={dataMode}
                  className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${dataModeClasses[dataMode]}`}
                >
                  {DASHBOARD_MESSAGES.status[dataMode]}: {dataModeCounts[dataMode] ?? 0}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function RedditSentimentModal({
  metric,
  metricState,
  closeButtonRef,
  onClose,
}: {
  metric: DashboardMetric;
  metricState: DashboardMetricState;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const details = metricState.details;
  const stats = details?.stats ?? [];
  const drivers = details?.drivers ?? [];
  const risks = details?.risks ?? [];
  const opportunities = details?.opportunities ?? [];
  const subreddits = details?.subreddits ?? [];
  const samplePosts = details?.samplePosts ?? [];
  const sampleComments = details?.sampleComments ?? [];

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
        aria-labelledby="reddit-sentiment-title"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50/95 px-6 py-5 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              {DASHBOARD_MESSAGES.redditSentiment.eyebrow}
            </p>
            <h2
              id="reddit-sentiment-title"
              className="mt-1 text-3xl font-semibold tracking-tight text-stone-950"
            >
              {metricState.currentValue}
            </h2>
            <p className="mt-2 text-sm text-stone-600">{metricState.deltaLabel}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
          >
            {DASHBOARD_MESSAGES.common.close}
          </button>
        </div>

        <div className="space-y-8 px-6 py-6 lg:px-8">
          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-sm leading-7 text-stone-600">
                  {details?.summary ?? DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${sentimentClasses[metricState.status]}`}
                >
                  {DASHBOARD_MESSAGES.status[metricState.status]}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${dataModeClasses[metricState.dataMode ?? "seeded"]}`}
                >
                  {DASHBOARD_MESSAGES.status[metricState.dataMode ?? "seeded"]}
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {fillMessage(DASHBOARD_MESSAGES.redditSentiment.sourceUpdated, {
                    source: metricState.sourceLabel,
                    relative: formatRelativeTime(metricState.asOf),
                  })}
                </span>
              </div>
            </div>
          </section>

          {stats.length > 0 && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                {DASHBOARD_MESSAGES.redditSentiment.statsLabel}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {stats.map((stat) => (
                  <div
                    key={`${stat.label}-${stat.value}`}
                    className="rounded-[1.25rem] bg-stone-50 p-4"
                  >
                    <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{stat.label}</p>
                    <p className="mt-2 text-lg font-semibold text-stone-950">{stat.value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {details?.methodology && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                {DASHBOARD_MESSAGES.redditSentiment.methodologyLabel}
              </p>
              <p className="mt-3 text-sm leading-7 text-stone-600">{details.methodology}</p>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-3">
            <article className="rounded-[1.5rem] border border-emerald-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                {DASHBOARD_MESSAGES.redditSentiment.driversLabel}
              </p>
              <div className="mt-4 grid gap-3">
                {drivers.length > 0 ? (
                  drivers.map((driver) => (
                    <p key={driver} className="rounded-[1.25rem] bg-emerald-50/70 p-4 text-sm leading-6 text-stone-700">
                      {driver}
                    </p>
                  ))
                ) : (
                  <p className="rounded-[1.25rem] bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                    {DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                  </p>
                )}
              </div>
            </article>

            <article className="rounded-[1.5rem] border border-rose-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
                {DASHBOARD_MESSAGES.redditSentiment.risksLabel}
              </p>
              <div className="mt-4 grid gap-3">
                {risks.length > 0 ? (
                  risks.map((risk) => (
                    <p key={risk} className="rounded-[1.25rem] bg-rose-50/70 p-4 text-sm leading-6 text-stone-700">
                      {risk}
                    </p>
                  ))
                ) : (
                  <p className="rounded-[1.25rem] bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                    {DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                  </p>
                )}
              </div>
            </article>

            <article className="rounded-[1.5rem] border border-sky-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                {DASHBOARD_MESSAGES.redditSentiment.opportunitiesLabel}
              </p>
              <div className="mt-4 grid gap-3">
                {opportunities.length > 0 ? (
                  opportunities.map((opportunity) => (
                    <p
                      key={opportunity}
                      className="rounded-[1.25rem] bg-sky-50/70 p-4 text-sm leading-6 text-stone-700"
                    >
                      {opportunity}
                    </p>
                  ))
                ) : (
                  <p className="rounded-[1.25rem] bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                    {DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                  </p>
                )}
              </div>
            </article>
          </section>

          {subreddits.length > 0 && (
            <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                {DASHBOARD_MESSAGES.redditSentiment.communitiesLabel}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {subreddits.map((subreddit) => (
                  <span
                    key={subreddit}
                    className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm text-stone-700"
                  >
                    {subreddit}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                {DASHBOARD_MESSAGES.redditSentiment.postsLabel}
              </p>
              <div className="mt-4 grid gap-3">
                {samplePosts.length > 0 ? (
                  samplePosts.map((post) => {
                    const content = (
                      <>
                        <p className="text-sm font-medium leading-6 text-stone-900">{post.title}</p>
                        <p className="mt-1 text-xs text-stone-500">
                          {post.subreddit}
                          {typeof post.score === "number" ? ` • score ${post.score}` : ""}
                        </p>
                      </>
                    );

                    return post.url ? (
                      <a
                        key={`${post.subreddit}-${post.title}`}
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 transition hover:border-stone-300 hover:bg-stone-100"
                      >
                        {content}
                      </a>
                    ) : (
                      <div
                        key={`${post.subreddit}-${post.title}`}
                        className="rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3"
                      >
                        {content}
                      </div>
                    );
                  })
                ) : (
                  <p className="rounded-[1.25rem] bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                    {DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                  </p>
                )}
              </div>
            </article>

            <article className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                {DASHBOARD_MESSAGES.redditSentiment.commentsLabel}
              </p>
              <div className="mt-4 grid gap-3">
                {sampleComments.length > 0 ? (
                  sampleComments.map((comment) => {
                    const content = (
                      <>
                        <p className="text-sm leading-6 text-stone-700">{comment.body}</p>
                        <p className="mt-1 text-xs text-stone-500">
                          {comment.subreddit}
                          {typeof comment.score === "number" ? ` • score ${comment.score}` : ""}
                        </p>
                      </>
                    );

                    return comment.url ? (
                      <a
                        key={`${comment.subreddit}-${comment.body}`}
                        href={comment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 transition hover:border-stone-300 hover:bg-stone-100"
                      >
                        {content}
                      </a>
                    ) : (
                      <div
                        key={`${comment.subreddit}-${comment.body}`}
                        className="rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3"
                      >
                        {content}
                      </div>
                    );
                  })
                ) : (
                  <p className="rounded-[1.25rem] bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                    {DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                  </p>
                )}
              </div>
            </article>
          </section>

          <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              {metric.name}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-[1.25rem] bg-emerald-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  {DASHBOARD_MESSAGES.learnPanel.bullishReadLabel}
                </p>
                <p className="mt-3 text-sm leading-6 text-stone-700">{metric.bullishInterpretation}</p>
              </div>
              <div className="rounded-[1.25rem] bg-rose-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
                  {DASHBOARD_MESSAGES.learnPanel.bearishReadLabel}
                </p>
                <p className="mt-3 text-sm leading-6 text-stone-700">{metric.bearishInterpretation}</p>
              </div>
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
            {DASHBOARD_MESSAGES.debug.sectionTitle}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-stone-950">{DASHBOARD_MESSAGES.debug.cacheHealthTitle}</h3>
        </div>
        <div className="text-sm text-stone-500">
          {generatedAt
            ? fillMessage(DASHBOARD_MESSAGES.debug.cacheUpdated, {
                value: formatRelativeTime(generatedAt),
              })
            : DASHBOARD_MESSAGES.debug.cacheUnavailable}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
        >
          {isRefreshing ? DASHBOARD_MESSAGES.debug.refreshing : DASHBOARD_MESSAGES.debug.refresh}
        </button>
        <div className="rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600">
          {DASHBOARD_MESSAGES.debug.modeLabel}{" "}
          <span className="font-semibold text-stone-950">{dataMode}</span>
        </div>
        <div className="rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600">
          {DASHBOARD_MESSAGES.debug.liveMetricsLabel}{" "}
          <span className="font-semibold text-stone-950">{liveMetricCount}</span>
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
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{DASHBOARD_MESSAGES.debug.seededLabel}</p>
          <p className="mt-2 text-2xl font-semibold text-stone-950">{counts.seeded ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-sky-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-sky-700">{DASHBOARD_MESSAGES.debug.derivedLabel}</p>
          <p className="mt-2 text-2xl font-semibold text-sky-950">{counts.derived ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-amber-700">{DASHBOARD_MESSAGES.debug.modelLabel}</p>
          <p className="mt-2 text-2xl font-semibold text-amber-950">{counts.model ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-emerald-700">{DASHBOARD_MESSAGES.debug.liveLabel}</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-950">{counts.live ?? 0}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{DASHBOARD_MESSAGES.debug.schedulerLabel}</p>
          <p className="mt-2 text-sm text-stone-700">{scheduler ?? DASHBOARD_MESSAGES.common.unknown}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{DASHBOARD_MESSAGES.debug.nextRunLabel}</p>
          <p className="mt-2 text-sm text-stone-700">
            {nextSuggestedRunAt ? formatRelativeTime(nextSuggestedRunAt) : DASHBOARD_MESSAGES.common.notScheduled}
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
                <p className="mt-2 text-lg font-semibold text-stone-950">
                  {groupStatusLabel(group.status)}
                </p>
                <p className="mt-1 text-sm text-stone-700">
                  {group.generatedAt
                    ? `Cache ${formatRelativeTime(group.generatedAt)}`
                    : DASHBOARD_MESSAGES.debug.noCacheSnapshot}
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  {group.lastSourceUpdateAt
                    ? `Source ${formatRelativeTime(group.lastSourceUpdateAt)}`
                    : DASHBOARD_MESSAGES.debug.noSourceTimestamp}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {group.refreshedDuringRequest
                    ? DASHBOARD_MESSAGES.debug.refreshedDuringRequest
                    : group.refreshSource === "bootstrap"
                      ? DASHBOARD_MESSAGES.debug.bootstrappedCache
                      : DASHBOARD_MESSAGES.debug.servedFromGroupedCache}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-amber-800">{DASHBOARD_MESSAGES.debug.implementationNotes}</p>
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
        {DASHBOARD_MESSAGES.app.coingeckoAttributionPrefix}{" "}
        <a
          href={COINGECKO_ATTRIBUTION_URL}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline decoration-emerald-400 underline-offset-2"
        >
          {DASHBOARD_MESSAGES.app.coingeckoAttributionLinkLabel}
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
  const [showRedditSentimentModal, setShowRedditSentimentModal] = useState(false);
  const constructiveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const constructiveCloseRef = useRef<HTMLButtonElement | null>(null);
  const cycleAnalogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cycleAnalogCloseRef = useRef<HTMLButtonElement | null>(null);
  const redditSentimentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const redditSentimentCloseRef = useRef<HTMLButtonElement | null>(null);
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
  const btcPrice = snapshot?.summary.btcPrice ?? DASHBOARD_MESSAGES.common.loadingValue;
  const btcPriceChange = snapshot?.summary.btcPriceChange ?? DASHBOARD_MESSAGES.common.connectingValue;
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
  const redditSentimentMetric =
    DASHBOARD_METRICS.find((metric) => metric.id === "recent-reddit-sentiment") ?? null;
  const redditSentimentState =
    (redditSentimentMetric &&
      (snapshot?.metrics[redditSentimentMetric.id] ?? {
        ...getMetricSample(redditSentimentMetric.id)!,
        isLive: false,
        dataMode: "seeded",
      })) ||
    null;
  const hasRedditSentimentDetails = Boolean(redditSentimentMetric && redditSentimentState?.details);

  useEffect(() => {
    if (!cycleAnalog) {
      setShowCycleAnalogModal(false);
    }
  }, [cycleAnalog]);

  useEffect(() => {
    if (!hasRedditSentimentDetails) {
      setShowRedditSentimentModal(false);
    }
  }, [hasRedditSentimentDetails]);

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

  useEffect(() => {
    if (!showRedditSentimentModal || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(() => redditSentimentCloseRef.current?.focus())
        : 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRedditSentimentModal(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(focusFrame);
        window.requestAnimationFrame(() => redditSentimentTriggerRef.current?.focus());
      }
    };
  }, [showRedditSentimentModal]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.14),transparent_30%),linear-gradient(180deg,#fafaf9_0%,#f5f5f4_100%)] text-stone-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="overflow-hidden rounded-[2rem] border border-stone-200 bg-stone-950 text-stone-50 shadow-panel">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.6fr_1fr] lg:px-8">
            <div>
              <div className="flex items-center gap-4">
                <img
                  src="/brand-mark.svg"
                  alt={DASHBOARD_MESSAGES.app.logoAlt}
                  className="h-14 w-14 rounded-[1.25rem] ring-1 ring-white/10 shadow-[0_18px_45px_rgba(249,115,22,0.18)]"
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-orange-300">
                    {DASHBOARD_MESSAGES.app.brand}
                  </p>
                  <p className="mt-1 text-sm text-stone-400">{DASHBOARD_MESSAGES.app.subtitle}</p>
                </div>
              </div>
              <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {DASHBOARD_MESSAGES.app.heroTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300 sm:text-base">
                {DASHBOARD_MESSAGES.app.heroBody}
              </p>
              <div className="mt-6 max-w-3xl rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
                      {DASHBOARD_MESSAGES.cycleEstimate.eyebrow}
                    </p>
                    <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                      {cycleEstimate?.label ?? DASHBOARD_MESSAGES.cycleEstimate.pendingTitle}
                    </h1>
                  </div>
                  {cycleEstimate && (
                    <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs font-semibold text-stone-100">
                      {fillMessage(DASHBOARD_MESSAGES.cycleEstimate.confidenceSuffix, {
                        value: cycleEstimate.confidence,
                      })}
                    </div>
                  )}
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-200 sm:text-base">
                  {cycleEstimate?.summary ??
                    DASHBOARD_MESSAGES.cycleEstimate.pendingSummary}
                </p>
                {cycleEstimate && (
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-200">
                    <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">
                      {fillMessage(DASHBOARD_MESSAGES.cycleEstimate.scorePrefix, {
                        value: cycleEstimate.score,
                      })}
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
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">{DASHBOARD_MESSAGES.app.btcPriceLabel}</p>
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
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">{DASHBOARD_MESSAGES.constructive.summaryCardLabel}</p>
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
              <button
                ref={redditSentimentTriggerRef}
                type="button"
                onClick={() => hasRedditSentimentDetails && setShowRedditSentimentModal(true)}
                disabled={!hasRedditSentimentDetails}
                aria-haspopup="dialog"
                aria-expanded={showRedditSentimentModal}
                className={[
                  "rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-left transition",
                  hasRedditSentimentDetails
                    ? "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    : "cursor-default opacity-80",
                ].join(" ")}
              >
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">
                  {DASHBOARD_MESSAGES.redditSentiment.summaryCardLabel}
                </p>
                <p className="mt-2 text-3xl font-semibold">
                  {redditSentimentState?.currentValue ?? DASHBOARD_MESSAGES.redditSentiment.summaryCardPending}
                </p>
                <p className="mt-1 text-sm text-stone-300">
                  {redditSentimentState?.deltaLabel ?? DASHBOARD_MESSAGES.redditSentiment.summaryCardWaiting}
                </p>
                <p className="mt-1 text-xs text-stone-400">
                  {redditSentimentState?.details?.summary ?? DASHBOARD_MESSAGES.redditSentiment.summaryCardFallback}
                </p>
              </button>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">{DASHBOARD_MESSAGES.app.coverageLabel}</p>
                <p className="mt-2 text-3xl font-semibold">{DASHBOARD_METRICS.length}</p>
                <p className="mt-1 text-sm text-stone-300">
                  {fillMessage(DASHBOARD_MESSAGES.app.coverageSummary, {
                    value: DASHBOARD_METRICS_BY_PANEL.length,
                  })}
                </p>
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
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">{DASHBOARD_MESSAGES.cycleAnalog.summaryCardLabel}</p>
                <p className="mt-2 text-3xl font-semibold">{cycleAnalog?.label ?? DASHBOARD_MESSAGES.cycleAnalog.pendingTitle}</p>
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
                {DASHBOARD_MESSAGES.app.loadingLiveData}
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
                  {DASHBOARD_MESSAGES.app.activePanelLabel}
                </p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight text-stone-950">
                  {activePanel.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">{activePanel.description}</p>
              </div>
              <div className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600">
                {activePanel.metrics.length} {DASHBOARD_MESSAGES.app.cardsSuffix}
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
                {DASHBOARD_MESSAGES.debug.sectionTitle}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {DASHBOARD_MESSAGES.debug.sectionDescription}
              </p>
            </div>
            <div className="shrink-0 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm font-semibold text-stone-700">
              {showDebug ? DASHBOARD_MESSAGES.common.hide : DASHBOARD_MESSAGES.common.show}
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

        {showRedditSentimentModal && redditSentimentMetric && redditSentimentState && (
          <RedditSentimentModal
            metric={redditSentimentMetric}
            metricState={redditSentimentState}
            closeButtonRef={redditSentimentCloseRef}
            onClose={() => setShowRedditSentimentModal(false)}
          />
        )}
      </div>
    </div>
  );
}
