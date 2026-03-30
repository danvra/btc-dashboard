import { classifyCyclePhaseId, getCyclePhaseIndex } from "./cycle-phase-utils.mjs";

const ANALOG_METRICS = [
  { id: "mvrv", weight: 1.3, family: "heat", direction: "higher" },
  { id: "puell-multiple", weight: 1.05, family: "heat", direction: "higher" },
  { id: "pi-cycle-top", weight: 1.15, family: "heat", direction: "higher" },
  { id: "mayer-multiple", weight: 1.05, family: "heat", direction: "higher" },
  { id: "funding-rate", weight: 0.9, family: "distribution", direction: "higher" },
  { id: "open-interest", weight: 0.9, family: "distribution", direction: "higher" },
  { id: "hash-ribbon", weight: 1.0, family: "damage", direction: "lower" },
  { id: "active-addresses", weight: 1.0, family: "damage", direction: "lower" },
  { id: "active-supply", weight: 0.95, family: "damage", direction: "lower" },
  { id: "nvt-signal", weight: 0.9, family: "distribution", direction: "higher" },
  { id: "ssr", weight: 0.85, family: "distribution", direction: "lower" },
];

export const ANALOG_METRIC_IDS = ANALOG_METRICS.map((metric) => metric.id);

const SHORT_PHASE_LABELS = {
  "deep-capitulation": "Capitulation",
  "bottoming-and-reaccumulation": "Reaccumulation",
  "early-recovery-under-disbelief": "Early Bull",
  "healthy-bull-expansion": "Bull Expansion",
  "late-cycle-acceleration": "Late Bull",
  "euphoric-overheating": "Overheating",
  "distribution-and-top-formation": "Distribution",
  "post-top-unwind": "Unwind",
};

const SUMMARY_TEMPLATES = {
  "deep-capitulation":
    "Current conditions most closely resemble prior washout periods with high damage and limited expansion.",
  "bottoming-and-reaccumulation":
    "Current conditions most closely resemble prior repair phases where stress was fading but conviction was still rebuilding.",
  "early-recovery-under-disbelief":
    "Current conditions most closely resemble prior recovery periods before broad euphoric excess.",
  "healthy-bull-expansion":
    "Current conditions most closely resemble prior mid-cycle expansion periods with constructive but not extreme readings.",
  "late-cycle-acceleration":
    "Current conditions most closely resemble prior hotter expansion periods where momentum strengthened toward later-cycle territory.",
  "euphoric-overheating":
    "Current conditions most closely resemble historically stretched periods where valuation and positioning looked overheated.",
  "distribution-and-top-formation":
    "Current conditions most closely resemble prior periods where cycle heat remained elevated but distribution behavior was becoming more active.",
  "post-top-unwind":
    "Current conditions most closely resemble prior unwind periods after hotter conditions had already started to deteriorate.",
};

const ANALOG_SOURCE_CYCLES = [
  {
    id: "2012-2016",
    label: "2012-2016 cycle",
    startDate: "2011-11-28",
    endDate: "2016-07-08",
    includeInAnalog: true,
  },
  {
    id: "2016-2020",
    label: "2016-2020 cycle",
    startDate: "2016-07-09",
    endDate: "2020-05-10",
    includeInAnalog: true,
  },
  {
    id: "2020-2024",
    label: "2020-2024 cycle",
    startDate: "2020-05-11",
    endDate: "2024-04-19",
    includeInAnalog: true,
  },
  {
    id: "2024-current",
    label: "2024-current cycle",
    startDate: "2024-04-20",
    endDate: "9999-12-31",
    includeInAnalog: false,
  },
];

const MIN_HISTORY_POINTS = 120;
const MIN_CURRENT_METRICS = 6;
const MIN_COVERAGE_RATIO = 0.65;
const MIN_WINDOW_DAYS = 21;
const MIN_ANALOG_LOOKBACK_DAYS = 365;
const MAX_DATE_GAP_MS = 3 * 24 * 60 * 60 * 1000;

const QUALITY_MULTIPLIER = {
  live: 1,
  derived: 0.86,
  model: 0.72,
  seeded: 0,
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function roundMetric(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function toDateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function toTimestamp(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`).getTime();
}

function dayDiff(leftTimestamp, rightTimestamp) {
  return Math.round(Math.abs(leftTimestamp - rightTimestamp) / (24 * 60 * 60 * 1000));
}

function formatMonthYear(dateKey) {
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

function getCycleLabel(phaseId) {
  return SHORT_PHASE_LABELS[phaseId] ?? "Unknown";
}

function getCycleWindow(dateKey) {
  return ANALOG_SOURCE_CYCLES.find(
    (cycle) => dateKey >= cycle.startDate && dateKey <= cycle.endDate,
  ) ?? null;
}

function latestNumericValue(series) {
  const latest = (series ?? []).filter((point) => Number.isFinite(point?.value)).at(-1);
  return Number.isFinite(latest?.value) ? Number(latest.value) : null;
}

function buildSortedValues(series) {
  return (series ?? [])
    .map((point) => Number(point?.value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
}

function percentileRank(sortedValues, value) {
  if (!Number.isFinite(value) || !Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }

  if (sortedValues.length === 1) {
    return 0.5;
  }

  let low = 0;
  let high = sortedValues.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (sortedValues[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return clamp((low - 1) / (sortedValues.length - 1));
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function valueMapForSeries(series) {
  const map = new Map();

  for (const point of series ?? []) {
    if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.value)) {
      continue;
    }

    map.set(toDateKey(point.timestamp), Number(point.value));
  }

  return map;
}

function computeStageScore(metric, normalizedValue) {
  if (!Number.isFinite(normalizedValue)) {
    return null;
  }

  return metric.direction === "higher" ? normalizedValue : 1 - normalizedValue;
}

function computePhaseScores(metricContexts, normalizedValues) {
  const buckets = {
    heat: [],
    damage: [],
    distribution: [],
  };

  for (const metric of metricContexts) {
    const normalizedValue = normalizedValues[metric.id];
    const stageScore = computeStageScore(metric, normalizedValue);

    if (stageScore === null) {
      continue;
    }

    buckets[metric.family].push({
      value: stageScore,
      weight: metric.weight * metric.quality,
    });
  }

  const scoreFamily = (family) => {
    const entries = buckets[family].filter((entry) => Number.isFinite(entry.value) && entry.weight > 0);

    if (!entries.length) {
      return 0.5;
    }

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    return totalWeight > 0
      ? entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight
      : 0.5;
  };

  return {
    heat: scoreFamily("heat"),
    damage: scoreFamily("damage"),
    distribution: scoreFamily("distribution"),
  };
}

function computeDistance(metricContexts, currentVector, candidateValues) {
  let weightedDistance = 0;
  let totalWeight = 0;
  let overlapCount = 0;

  for (const metric of metricContexts) {
    const currentValue = currentVector[metric.id];
    const candidateValue = candidateValues[metric.id];

    if (!Number.isFinite(currentValue) || !Number.isFinite(candidateValue)) {
      continue;
    }

    const weight = metric.weight * metric.quality;
    weightedDistance += weight * (currentValue - candidateValue) ** 2;
    totalWeight += weight;
    overlapCount += 1;
  }

  const overlapRatio = metricContexts.length > 0 ? overlapCount / metricContexts.length : 0;
  const distance =
    totalWeight > 0 ? Math.sqrt(weightedDistance / totalWeight) + (1 - overlapRatio) * 0.18 : Number.POSITIVE_INFINITY;

  return {
    distance,
    overlapCount,
    overlapRatio,
  };
}

function averageMetricValues(records, metricId) {
  const values = records
    .map((record) => record.normalizedValues[metricId])
    .filter((value) => Number.isFinite(value));

  return average(values);
}

function createWindowStats(window, metricContexts, currentVector) {
  const centroidValues = {};

  for (const metric of metricContexts) {
    const averageValue = averageMetricValues(window.records, metric.id);

    if (averageValue !== null) {
      centroidValues[metric.id] = averageValue;
    }
  }

  const centroidDistance = computeDistance(metricContexts, currentVector, centroidValues);
  const bestRecord = window.records
    .map((record) => ({
      ...record,
      distance: computeDistance(metricContexts, currentVector, record.normalizedValues).distance,
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  const startTimestamp = window.records[0]?.timestamp ?? 0;
  const endTimestamp = window.records.at(-1)?.timestamp ?? startTimestamp;

  return {
    ...window,
    centroidValues,
    centroidDistance: centroidDistance.distance,
    centroidOverlapCount: centroidDistance.overlapCount,
    centroidCoverageRatio: centroidDistance.overlapRatio,
    averageCoverage: average(window.records.map((record) => record.coverage)) ?? 0,
    durationDays: Math.max(dayDiff(startTimestamp, endTimestamp) + 1, 1),
    bestMatchDate: bestRecord?.dateKey ?? window.records[0]?.dateKey,
    bestMatchDateLabel: bestRecord?.dateKey ? formatMonthYear(bestRecord.dateKey) : formatMonthYear(window.records[0]?.dateKey),
    bestMatchDistance: bestRecord?.distance ?? centroidDistance.distance,
    windowStartDate: window.records[0]?.dateKey ?? "",
    windowEndDate: window.records.at(-1)?.dateKey ?? "",
  };
}

function buildRawWindows(records) {
  const windows = [];

  for (const record of records) {
    const previousWindow = windows.at(-1);
    const previousRecord = previousWindow?.records?.at(-1);

    if (
      previousWindow &&
      previousRecord &&
      previousWindow.phaseId === record.phaseId &&
      record.timestamp - previousRecord.timestamp <= MAX_DATE_GAP_MS
    ) {
      previousWindow.records.push(record);
      continue;
    }

    windows.push({
      cycleId: record.cycleId,
      cycleLabel: record.cycleLabel,
      phaseId: record.phaseId,
      phaseLabel: record.phaseLabel,
      phaseIndex: record.phaseIndex,
      records: [record],
    });
  }

  return windows;
}

function chooseMergeTarget(windows, index) {
  const current = windows[index];
  const left = index > 0 ? windows[index - 1] : null;
  const right = index < windows.length - 1 ? windows[index + 1] : null;

  if (!left && !right) {
    return null;
  }

  const rankNeighbor = (neighbor) => {
    if (!neighbor) {
      return null;
    }

    const currentTimestamp = current.records[0]?.timestamp ?? 0;
    const neighborTimestamp =
      neighbor === left
        ? neighbor.records.at(-1)?.timestamp ?? currentTimestamp
        : neighbor.records[0]?.timestamp ?? currentTimestamp;

    return {
      neighbor,
      phaseDistance: Math.abs(current.phaseIndex - neighbor.phaseIndex),
      gapDays: dayDiff(currentTimestamp, neighborTimestamp),
      durationDays: Math.max(
        dayDiff(neighbor.records[0]?.timestamp ?? 0, neighbor.records.at(-1)?.timestamp ?? 0) + 1,
        1,
      ),
    };
  };

  const ranked = [rankNeighbor(left), rankNeighbor(right)].filter(Boolean);

  ranked.sort((leftNeighbor, rightNeighbor) => {
    if (leftNeighbor.phaseDistance !== rightNeighbor.phaseDistance) {
      return leftNeighbor.phaseDistance - rightNeighbor.phaseDistance;
    }

    if (leftNeighbor.gapDays !== rightNeighbor.gapDays) {
      return leftNeighbor.gapDays - rightNeighbor.gapDays;
    }

    return rightNeighbor.durationDays - leftNeighbor.durationDays;
  });

  return windows.indexOf(ranked[0].neighbor);
}

function mergeShortWindows(rawWindows, metricContexts, currentVector) {
  let windows = rawWindows.map((window) => createWindowStats(window, metricContexts, currentVector));
  let changed = true;

  while (changed) {
    changed = false;

    for (let index = 0; index < windows.length; index += 1) {
      if (windows[index].durationDays >= MIN_WINDOW_DAYS || windows.length === 1) {
        continue;
      }

      const targetIndex = chooseMergeTarget(windows, index);

      if (targetIndex === null || targetIndex === index) {
        continue;
      }

      const source = windows[index];
      const target = windows[targetIndex];
      const mergedWindow = createWindowStats(
        {
          cycleId: target.cycleId,
          cycleLabel: target.cycleLabel,
          phaseId: target.phaseId,
          phaseLabel: target.phaseLabel,
          phaseIndex: target.phaseIndex,
          records: [...target.records, ...source.records].sort((left, right) => left.timestamp - right.timestamp),
        },
        metricContexts,
        currentVector,
      );

      const firstIndex = Math.min(index, targetIndex);
      const secondIndex = Math.max(index, targetIndex);
      windows.splice(firstIndex, 1, mergedWindow);
      windows.splice(secondIndex, 1);
      changed = true;
      break;
    }
  }

  return windows;
}

function buildCurrentMetricContexts({ currentMetrics, historicalSeries }) {
  return ANALOG_METRICS.map((metric) => {
    const metricState = currentMetrics?.[metric.id];

    if (!metricState || metricState.dataMode === "seeded") {
      return null;
    }

    const quality = QUALITY_MULTIPLIER[metricState.dataMode ?? "derived"] ?? QUALITY_MULTIPLIER.derived;

    if (quality <= 0) {
      return null;
    }

    const series = historicalSeries?.[metric.id] ?? [];
    const sortedValues = buildSortedValues(series);

    if (sortedValues.length < MIN_HISTORY_POINTS) {
      return null;
    }

    const currentRawValue = latestNumericValue(series);
    const currentNormalized = percentileRank(sortedValues, currentRawValue);

    if (currentNormalized === null) {
      return null;
    }

    return {
      ...metric,
      quality,
      sortedValues,
      currentNormalized,
      valueMap: valueMapForSeries(series),
    };
  }).filter(Boolean);
}

function buildHistoricalRecords(metricContexts, generatedAt) {
  const currentVector = Object.fromEntries(
    metricContexts.map((metric) => [metric.id, metric.currentNormalized]),
  );
  const candidateDates = new Set();
  const cutoffDateKey = toDateKey(generatedAt - MIN_ANALOG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  for (const metric of metricContexts) {
    for (const dateKey of metric.valueMap.keys()) {
      const cycle = getCycleWindow(dateKey);

      if (!cycle?.includeInAnalog || dateKey > cutoffDateKey) {
        continue;
      }

      candidateDates.add(dateKey);
    }
  }

  const records = [];

  for (const dateKey of candidateDates) {
    const cycle = getCycleWindow(dateKey);

    if (!cycle?.includeInAnalog) {
      continue;
    }

    const normalizedValues = {};
    let overlapCount = 0;

    for (const metric of metricContexts) {
      const rawValue = metric.valueMap.get(dateKey);

      if (!Number.isFinite(rawValue)) {
        continue;
      }

      const normalizedValue = percentileRank(metric.sortedValues, rawValue);

      if (normalizedValue === null) {
        continue;
      }

      normalizedValues[metric.id] = normalizedValue;
      overlapCount += 1;
    }

    const coverage = metricContexts.length > 0 ? overlapCount / metricContexts.length : 0;

    if (overlapCount < MIN_CURRENT_METRICS || coverage < MIN_COVERAGE_RATIO) {
      continue;
    }

    const { heat, damage, distribution } = computePhaseScores(metricContexts, normalizedValues);
    const phaseId = classifyCyclePhaseId({ heat, damage, distribution });

    records.push({
      dateKey,
      timestamp: toTimestamp(dateKey),
      cycleId: cycle.id,
      cycleLabel: cycle.label,
      coverage,
      normalizedValues,
      heat,
      damage,
      distribution,
      phaseId,
      phaseLabel: getCycleLabel(phaseId),
      phaseIndex: getCyclePhaseIndex(phaseId),
      distance: computeDistance(metricContexts, currentVector, normalizedValues).distance,
    });
  }

  return {
    currentVector,
    records: records.sort((left, right) => left.timestamp - right.timestamp),
  };
}

function buildBestWindowsPerCycle(metricContexts, currentVector, records) {
  const grouped = records.reduce((acc, record) => {
    acc[record.cycleId] = acc[record.cycleId] ?? [];
    acc[record.cycleId].push(record);
    return acc;
  }, {});

  return ANALOG_SOURCE_CYCLES.filter((cycle) => cycle.includeInAnalog)
    .map((cycle) => {
      const cycleRecords = grouped[cycle.id] ?? [];

      if (cycleRecords.length === 0) {
        return null;
      }

      const rawWindows = buildRawWindows(cycleRecords);
      const mergedWindows = mergeShortWindows(rawWindows, metricContexts, currentVector).filter(
        (window) =>
          window.durationDays >= MIN_WINDOW_DAYS &&
          window.averageCoverage >= MIN_COVERAGE_RATIO &&
          window.centroidOverlapCount >= MIN_CURRENT_METRICS &&
          window.centroidCoverageRatio >= MIN_COVERAGE_RATIO,
      );

      if (!mergedWindows.length) {
        return null;
      }

      const bestWindow = mergedWindows.sort((left, right) => {
        if (left.centroidDistance !== right.centroidDistance) {
          return left.centroidDistance - right.centroidDistance;
        }

        return left.bestMatchDistance - right.bestMatchDistance;
      })[0];

      return {
        cycleId: cycle.id,
        cycleLabel: cycle.label,
        phaseId: bestWindow.phaseId,
        phaseLabel: bestWindow.phaseLabel,
        windowStartDate: bestWindow.windowStartDate,
        windowEndDate: bestWindow.windowEndDate,
        bestMatchDate: bestWindow.bestMatchDate,
        bestMatchDateLabel: bestWindow.bestMatchDateLabel,
        distance: roundMetric(bestWindow.centroidDistance),
        coverage: roundMetric(bestWindow.averageCoverage, 3),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance);
}

function buildPhaseDistribution(perCycleMatches) {
  const grouped = perCycleMatches.reduce((acc, match) => {
    acc[match.phaseId] = acc[match.phaseId] ?? [];
    acc[match.phaseId].push(match);
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([phaseId, matches]) => ({
      phaseId,
      label: getCycleLabel(phaseId),
      cyclesMatched: matches.length,
      averageDistance: roundMetric(average(matches.map((match) => match.distance)) ?? 0),
    }))
    .sort((left, right) => {
      if (left.cyclesMatched !== right.cyclesMatched) {
        return right.cyclesMatched - left.cyclesMatched;
      }

      return left.averageDistance - right.averageDistance;
    });
}

export function estimateCycleAnalog({ currentMetrics, historicalSeries, generatedAt }) {
  const metricContexts = buildCurrentMetricContexts({ currentMetrics, historicalSeries });

  if (metricContexts.length < MIN_CURRENT_METRICS) {
    return null;
  }

  const averageQuality = average(metricContexts.map((metric) => metric.quality)) ?? 0.6;
  const { currentVector, records } = buildHistoricalRecords(metricContexts, generatedAt);

  if (!records.length) {
    return null;
  }

  const perCycleMatches = buildBestWindowsPerCycle(metricContexts, currentVector, records);

  if (!perCycleMatches.length) {
    return null;
  }

  const phaseDistribution = buildPhaseDistribution(perCycleMatches);
  const dominantPhase = phaseDistribution[0];

  if (!dominantPhase) {
    return null;
  }

  const agreement = Math.round((dominantPhase.cyclesMatched / perCycleMatches.length) * 100);
  const averageCoverage = average(perCycleMatches.map((match) => match.coverage)) ?? MIN_COVERAGE_RATIO;
  const cycleCoverage =
    perCycleMatches.length / ANALOG_SOURCE_CYCLES.filter((cycle) => cycle.includeInAnalog).length;
  const runnerUp = phaseDistribution[1];
  const phaseSeparation = runnerUp
    ? clamp(1 - dominantPhase.averageDistance / Math.max(runnerUp.averageDistance, dominantPhase.averageDistance + 0.001))
    : 0.4;
  const confidence = Math.round(
    clamp(
      0.22 +
        agreement / 100 * 0.28 +
        averageCoverage * 0.18 +
        averageQuality * 0.12 +
        cycleCoverage * 0.14 +
        phaseSeparation * 0.08,
      0.25,
      0.92,
    ) * 100,
  );

  return {
    asOfDate: toDateKey(generatedAt),
    phaseId: dominantPhase.phaseId,
    label: dominantPhase.label,
    agreement,
    confidence,
    summary: SUMMARY_TEMPLATES[dominantPhase.phaseId] ?? "Historical phase analog comparison is available.",
    methodology: "phase-window-nearest-neighbor",
    indicatorIds: metricContexts.map((metric) => metric.id),
    phaseDistribution,
    perCycleMatches,
    topMatchDates: perCycleMatches.map((match) => match.bestMatchDate),
  };
}
