const ANALOG_METRICS = [
  { id: "mvrv", weight: 1.3, family: "heat", direction: "higher" },
  { id: "percent-supply-in-profit", weight: 1.2, family: "heat", direction: "higher" },
  { id: "reserve-risk", weight: 1.1, family: "heat", direction: "higher" },
  { id: "price-vs-realized-price", weight: 1.1, family: "damage", direction: "lower" },
  { id: "asopr", weight: 1, family: "damage", direction: "lower" },
  { id: "nupl", weight: 1.1, family: "heat", direction: "higher" },
  { id: "liveliness", weight: 0.95, family: "distribution", direction: "higher" },
  { id: "dormancy", weight: 0.7, family: "distribution", direction: "higher" },
  { id: "lth-net-position-change", weight: 1, family: "distribution", direction: "lower" },
];

const DISPLAY_LABELS = {
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

const QUALITY_MULTIPLIER = {
  live: 1,
  scraped: 1,
  approx: 0.72,
  seeded: 0.35,
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function toDateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
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

function latestNumericValue(series) {
  const point = (series ?? []).filter((entry) => Number.isFinite(entry?.value)).at(-1);
  return Number.isFinite(point?.value) ? Number(point.value) : null;
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

function averageWeighted(entries) {
  const usable = entries.filter((entry) => Number.isFinite(entry?.value) && Number.isFinite(entry?.weight) && entry.weight > 0);

  if (!usable.length) {
    return null;
  }

  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  return usable.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

function classifyPhase({ heat, damage, distribution }) {
  if (heat < 0.22 && damage > 0.72) {
    return "deep-capitulation";
  }

  if (heat < 0.32 && damage > 0.5) {
    return "bottoming-and-reaccumulation";
  }

  if (heat < 0.45 && damage <= 0.5) {
    return "early-recovery-under-disbelief";
  }

  if (heat < 0.62 && distribution < 0.55 && damage <= 0.45) {
    return "healthy-bull-expansion";
  }

  if (heat < 0.78 && distribution < 0.58 && damage <= 0.5) {
    return "late-cycle-acceleration";
  }

  if (heat >= 0.78 && distribution < 0.6 && damage <= 0.55) {
    return "euphoric-overheating";
  }

  if (heat >= 0.62 && distribution >= 0.55) {
    return "distribution-and-top-formation";
  }

  if (damage > 0.56) {
    return "post-top-unwind";
  }

  return "healthy-bull-expansion";
}

function scoreFamily(metric, normalizedValue) {
  if (!Number.isFinite(normalizedValue)) {
    return null;
  }

  if (metric.direction === "higher") {
    return normalizedValue;
  }

  return 1 - normalizedValue;
}

function computeHistoricalPhase(candidateValues) {
  const heat = averageWeighted(
    ANALOG_METRICS.filter((metric) => metric.family === "heat").map((metric) => ({
      value: scoreFamily(metric, candidateValues[metric.id]),
      weight: metric.weight,
    })),
  );
  const damage = averageWeighted(
    ANALOG_METRICS.filter((metric) => metric.family === "damage").map((metric) => ({
      value: scoreFamily(metric, candidateValues[metric.id]),
      weight: metric.weight,
    })),
  );
  const distribution = averageWeighted(
    ANALOG_METRICS.filter((metric) => metric.family === "distribution").map((metric) => ({
      value: scoreFamily(metric, candidateValues[metric.id]),
      weight: metric.weight,
    })),
  );

  return classifyPhase({
    heat: heat ?? 0.5,
    damage: damage ?? 0.5,
    distribution: distribution ?? 0.5,
  });
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

export function estimateCycleAnalog({ currentMetrics, historicalSeries, generatedAt }) {
  const metricContexts = ANALOG_METRICS.map((metric) => {
    const series = historicalSeries?.[metric.id] ?? [];
    const sortedValues = buildSortedValues(series);

    if (sortedValues.length < 120) {
      return null;
    }

    const currentRawValue = latestNumericValue(series);
    const currentNormalized = percentileRank(sortedValues, currentRawValue);
    const quality = QUALITY_MULTIPLIER[currentMetrics?.[metric.id]?.dataMode ?? "approx"] ?? QUALITY_MULTIPLIER.approx;

    if (currentNormalized === null) {
      return null;
    }

    return {
      ...metric,
      quality,
      valueMap: valueMapForSeries(series),
      sortedValues,
      currentNormalized,
    };
  }).filter(Boolean);

  if (metricContexts.length < 5) {
    return null;
  }

  const candidateDateCounts = new Map();
  const currentDateKey = toDateKey(generatedAt);
  const cutoffTimestamp = generatedAt - 45 * 24 * 60 * 60 * 1000;
  const cutoffDateKey = toDateKey(cutoffTimestamp);

  for (const metric of metricContexts) {
    for (const dateKey of metric.valueMap.keys()) {
      if (dateKey >= cutoffDateKey) {
        continue;
      }

      candidateDateCounts.set(dateKey, (candidateDateCounts.get(dateKey) ?? 0) + 1);
    }
  }

  const minMetricsRequired = Math.max(5, Math.ceil(metricContexts.length * 0.65));
  const candidates = [];

  for (const [dateKey, count] of candidateDateCounts.entries()) {
    if (count < minMetricsRequired || dateKey === currentDateKey) {
      continue;
    }

    let totalWeight = 0;
    let weightedDistance = 0;
    const candidateValues = {};
    let usedMetrics = 0;

    for (const metric of metricContexts) {
      const rawValue = metric.valueMap.get(dateKey);

      if (!Number.isFinite(rawValue)) {
        continue;
      }

      const normalizedValue = percentileRank(metric.sortedValues, rawValue);

      if (normalizedValue === null) {
        continue;
      }

      const weight = metric.weight * metric.quality;
      candidateValues[metric.id] = normalizedValue;
      weightedDistance += weight * (metric.currentNormalized - normalizedValue) ** 2;
      totalWeight += weight;
      usedMetrics += 1;
    }

    if (totalWeight <= 0 || usedMetrics < minMetricsRequired) {
      continue;
    }

    const coverage = usedMetrics / metricContexts.length;
    const distance = Math.sqrt(weightedDistance / totalWeight) + (1 - coverage) * 0.18;
    const phaseId = computeHistoricalPhase(candidateValues);

    candidates.push({
      dateKey,
      distance,
      coverage,
      phaseId,
    });
  }

  if (!candidates.length) {
    return null;
  }

  const topMatches = candidates
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 20);

  const phaseVotes = topMatches.reduce((acc, match) => {
    acc[match.phaseId] = (acc[match.phaseId] ?? 0) + 1;
    return acc;
  }, {});

  const [phaseId, dominantVotes] =
    Object.entries(phaseVotes).sort((left, right) => right[1] - left[1])[0] ?? [];

  if (!phaseId || !dominantVotes) {
    return null;
  }

  const agreement = Math.round((dominantVotes / topMatches.length) * 100);
  const averageCoverage = average(topMatches.map((match) => match.coverage)) ?? 0.7;
  const averageQuality = average(metricContexts.map((metric) => metric.quality)) ?? 0.7;
  const bestDistance = topMatches[0]?.distance ?? 1;
  const midpointDistance = topMatches[Math.min(topMatches.length - 1, Math.floor(topMatches.length / 2))]?.distance ?? bestDistance;
  const separation = midpointDistance > 0 ? clamp(1 - bestDistance / midpointDistance) : 0;
  const confidence = Math.round(
    clamp(0.34 + agreement / 100 * 0.34 + averageCoverage * 0.16 + averageQuality * 0.1 + separation * 0.06, 0.3, 0.92) * 100,
  );

  const closestDates = [];
  const closestPhaseIds = [];

  for (const match of topMatches) {
    if (closestDates.length < 3) {
      closestDates.push(match.dateKey);
      closestPhaseIds.push(match.phaseId);
    } else {
      break;
    }
  }

  return {
    asOfDate: currentDateKey,
    label: DISPLAY_LABELS[phaseId] ?? "Analog pending",
    phaseId,
    agreement,
    confidence,
    closestDates,
    closestDateLabels: closestDates.map((dateKey) => formatMonthYear(dateKey)),
    closestPhaseIds,
    summary: SUMMARY_TEMPLATES[phaseId] ?? "Historical analog comparison is available.",
    methodology: "historical-nearest-neighbor",
    matchCount: topMatches.length,
    indicatorIds: metricContexts.map((metric) => metric.id),
  };
}
