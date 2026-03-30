import {
  CYCLE_PHASES,
  classifyCyclePhaseId,
  getCyclePhase,
  getCyclePhaseIndex,
} from "./cycle-phase-utils.mjs";
import { loadLocalEnv } from "./load-env.mjs";

loadLocalEnv();

const PREFERRED_LLM_METRICS = [
  "mvrv",
  "puell-multiple",
  "pi-cycle-top",
  "mayer-multiple",
  "funding-rate",
  "open-interest",
  "hash-ribbon",
  "nvt-signal",
  "active-addresses",
  "ssr",
];

const PHASE_SUMMARY_TEMPLATES = {
  "deep-capitulation":
    "Stress-sensitive indicators still outweigh expansion signals, which keeps the read closer to damage repair than renewed upside enthusiasm.",
  "bottoming-and-reaccumulation":
    "The dashboard looks more like a repair phase than a clean breakout, with fear and damage fading but not enough broad confirmation for stronger expansion.",
  "early-recovery-under-disbelief":
    "Cycle signals are improving from lower-risk territory, but the mix still looks more skeptical and rebuilding than broadly euphoric.",
  "healthy-bull-expansion":
    "Trend, valuation, and participation look constructive without the kind of synchronized overheating that usually characterizes later-cycle extremes.",
  "late-cycle-acceleration":
    "The cycle read is still constructive, but several valuation and positioning indicators are moving into hotter territory than a plain mid-cycle expansion.",
  "euphoric-overheating":
    "Historically hot valuation and positioning inputs are clustering at elevated levels, which points to a market that looks increasingly stretched.",
  "distribution-and-top-formation":
    "The market still carries late-cycle heat, but positioning and valuation-sensitive inputs look more crowded and fragile than a clean expansion.",
  "post-top-unwind":
    "The dashboard no longer looks like a fresh bottom, but it also does not resemble a healthy expansion because damage-sensitive inputs still show unwind behavior.",
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function getQualityWeight(metric) {
  switch (metric?.dataMode) {
    case "live":
      return 1;
    case "derived":
      return 0.86;
    case "model":
      return 0.72;
    case "seeded":
    default:
      return 0.25;
  }
}

function getLatestNumericValue(metric) {
  if (!metric || !Array.isArray(metric.series) || metric.series.length === 0) {
    return null;
  }

  const value = metric.series.at(-1);
  return Number.isFinite(value) ? Number(value) : null;
}

function normalizeBetween(value, low, high) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (high === low) {
    return 0.5;
  }

  return clamp((value - low) / (high - low));
}

function normalizeWithinSeries(metric, invert = false) {
  if (!metric || !Array.isArray(metric.series) || metric.series.length < 3) {
    return null;
  }

  const values = metric.series.filter((value) => Number.isFinite(value));

  if (values.length < 3) {
    return null;
  }

  const latest = Number(values.at(-1));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalized = normalizeBetween(latest, min, max);

  if (normalized === null) {
    return null;
  }

  return invert ? 1 - normalized : normalized;
}

function summarizeMetric(metricId) {
  return metricId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeSeries(metric) {
  if (!metric || !Array.isArray(metric.series) || metric.series.length === 0) {
    return null;
  }

  const values = metric.series.filter((value) => Number.isFinite(value)).map((value) => Number(value));

  if (values.length === 0) {
    return null;
  }

  const latestValue = values.at(-1);
  const previousValue = values.at(-2) ?? latestValue;
  const earliestValue = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    latestValue,
    previousValue,
    earliestValue,
    min,
    max,
    observationCount: values.length,
    recentValues: values.slice(-6),
    absoluteChange: latestValue - previousValue,
    rangeChange: latestValue - earliestValue,
  };
}

function metricPromptPriority(metricId) {
  const preferredIndex = PREFERRED_LLM_METRICS.indexOf(metricId);
  return preferredIndex === -1 ? 99 : preferredIndex;
}

function buildSignal(metricId, metric, stageScore, explanation, family) {
  if (stageScore === null) {
    return null;
  }

  return {
    metricId,
    label: summarizeMetric(metricId),
    family,
    weight: getQualityWeight(metric),
    stageScore: clamp(stageScore),
    explanation,
    status: metric?.status ?? "neutral",
  };
}

function averageSignals(signals) {
  const usableSignals = signals.filter(Boolean);

  if (usableSignals.length === 0) {
    return null;
  }

  const totalWeight = usableSignals.reduce((sum, signal) => sum + signal.weight, 0);

  if (totalWeight <= 0) {
    return null;
  }

  return usableSignals.reduce((sum, signal) => sum + signal.stageScore * signal.weight, 0) / totalWeight;
}

function selectStrongestSignals(signals, direction) {
  return signals
    .filter(Boolean)
    .map((signal) => ({
      ...signal,
      strength:
        direction === "late"
          ? signal.stageScore * signal.weight
          : (1 - signal.stageScore) * signal.weight,
    }))
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 3);
}

function buildDeterministicEstimate(metrics, generatedAt, previousEstimate) {
  const mvrv = buildSignal(
    "mvrv",
    metrics["mvrv"],
    normalizeBetween(getLatestNumericValue(metrics["mvrv"]), 0.8, 4),
    "Higher MVRV usually moves the cycle read toward hotter, later-stage territory.",
    "heat",
  );
  const puellMultiple = buildSignal(
    "puell-multiple",
    metrics["puell-multiple"],
    normalizeBetween(getLatestNumericValue(metrics["puell-multiple"]), 0.5, 3.5),
    "Higher miner profitability often appears later in stronger cycle expansions.",
    "heat",
  );
  const piCycleTop = buildSignal(
    "pi-cycle-top",
    metrics["pi-cycle-top"],
    normalizeBetween(getLatestNumericValue(metrics["pi-cycle-top"]), 0, 40) === null
      ? null
      : 1 - normalizeBetween(getLatestNumericValue(metrics["pi-cycle-top"]), 0, 40),
    "A shrinking Pi Cycle buffer increases late-cycle risk.",
    "heat",
  );
  const mayerMultiple = buildSignal(
    "mayer-multiple",
    metrics["mayer-multiple"],
    normalizeBetween(getLatestNumericValue(metrics["mayer-multiple"]), 0.8, 2.5),
    "A richer Mayer Multiple usually reflects a more extended market.",
    "heat",
  );
  const stockToFlow = buildSignal(
    "stock-to-flow",
    metrics["stock-to-flow"],
    normalizeWithinSeries(metrics["stock-to-flow"]),
    "Higher stock-to-flow generally aligns with a richer long-run scarcity regime.",
    "heat",
  );
  const powerLaw = buildSignal(
    "power-law",
    metrics["power-law"],
    normalizeBetween(getLatestNumericValue(metrics["power-law"]), 0.8, 1.35),
    "Trading above the fitted power-law midline tends to align with a richer long-term regime.",
    "heat",
  );

  const hashRibbon = buildSignal(
    "hash-ribbon",
    metrics["hash-ribbon"],
    normalizeBetween(getLatestNumericValue(metrics["hash-ribbon"]), 0.98, 1.02) === null
      ? null
      : 1 - normalizeBetween(getLatestNumericValue(metrics["hash-ribbon"]), 0.98, 1.02),
    "A compressed hash ribbon usually reflects more miner stress than a recovered ribbon.",
    "damage",
  );
  const adjustedTransferVolume = buildSignal(
    "adjusted-transfer-volume",
    metrics["adjusted-transfer-volume"],
    metrics["adjusted-transfer-volume"]?.status === "bearish"
      ? 0.72
      : metrics["adjusted-transfer-volume"]?.status === "neutral"
        ? 0.5
        : 0.28,
    "Weak transfer activity can reinforce a more damaged backdrop.",
    "damage",
  );
  const activeAddresses = buildSignal(
    "active-addresses",
    metrics["active-addresses"],
    metrics["active-addresses"]?.status === "bearish"
      ? 0.68
      : metrics["active-addresses"]?.status === "neutral"
        ? 0.5
        : 0.32,
    "Soft participation can confirm a weaker market state.",
    "damage",
  );
  const activeSupply = buildSignal(
    "active-supply",
    metrics["active-supply"],
    metrics["active-supply"]?.status === "bearish"
      ? 0.66
      : metrics["active-supply"]?.status === "neutral"
        ? 0.5
        : 0.34,
    "Fading active-supply participation can reinforce a slower repair regime.",
    "damage",
  );
  const fearAndGreedDamage = buildSignal(
    "fear-and-greed",
    metrics["fear-and-greed"],
    normalizeBetween(getLatestNumericValue(metrics["fear-and-greed"]), 20, 80) === null
      ? null
      : 1 - normalizeBetween(getLatestNumericValue(metrics["fear-and-greed"]), 20, 80),
    "Very low sentiment tends to align with weaker and more defensive conditions.",
    "damage",
  );
  const dxy = buildSignal(
    "dxy",
    metrics.dxy,
    normalizeWithinSeries(metrics.dxy),
    "A stronger dollar can reinforce a more difficult macro backdrop for risk assets.",
    "damage",
  );
  const realYield = buildSignal(
    "10y-real-yield",
    metrics["10y-real-yield"],
    normalizeWithinSeries(metrics["10y-real-yield"]),
    "Higher real yields usually tighten financial conditions for risk assets.",
    "damage",
  );

  const fundingRate = buildSignal(
    "funding-rate",
    metrics["funding-rate"],
    normalizeBetween(getLatestNumericValue(metrics["funding-rate"]), -0.01, 0.08),
    "More positive funding often lines up with crowded long positioning.",
    "distribution",
  );
  const openInterest = buildSignal(
    "open-interest",
    metrics["open-interest"],
    normalizeWithinSeries(metrics["open-interest"]),
    "Rising open interest can reinforce crowding and late-cycle fragility when it accelerates.",
    "distribution",
  );
  const fearAndGreedDistribution = buildSignal(
    "fear-and-greed",
    metrics["fear-and-greed"],
    normalizeBetween(getLatestNumericValue(metrics["fear-and-greed"]), 20, 85),
    "A greedier sentiment backdrop can align with hotter and more crowded conditions.",
    "distribution",
  );
  const nvtSignal = buildSignal(
    "nvt-signal",
    metrics["nvt-signal"],
    normalizeWithinSeries(metrics["nvt-signal"]),
    "A richer NVT Signal can reflect valuation running ahead of activity.",
    "distribution",
  );
  const ssr = buildSignal(
    "ssr",
    metrics.ssr,
    normalizeWithinSeries(metrics.ssr, true),
    "A lower SSR tends to be friendlier, while a rising SSR can align with thinner liquidity support.",
    "distribution",
  );

  const heatSignals = [mvrv, puellMultiple, piCycleTop, mayerMultiple, stockToFlow, powerLaw];
  const damageSignals = [hashRibbon, adjustedTransferVolume, activeAddresses, activeSupply, fearAndGreedDamage, dxy, realYield];
  const distributionSignals = [fundingRate, openInterest, fearAndGreedDistribution, nvtSignal, ssr];

  const heat = averageSignals(heatSignals) ?? 0.5;
  const damage = averageSignals(damageSignals) ?? 0.5;
  const distribution = averageSignals(distributionSignals) ?? 0.5;

  const phaseId = classifyCyclePhaseId({ heat, damage, distribution });
  const phase = getCyclePhase(phaseId);
  const supportDirection =
    phaseId === "deep-capitulation" || phaseId === "bottoming-and-reaccumulation" || phaseId === "early-recovery-under-disbelief"
      ? "early"
      : "late";
  const supportPool =
    phaseId === "distribution-and-top-formation" || phaseId === "post-top-unwind"
      ? [...distributionSignals, ...damageSignals]
      : [...heatSignals, ...damageSignals];
  const conflictPool =
    phaseId === "deep-capitulation" || phaseId === "bottoming-and-reaccumulation" || phaseId === "early-recovery-under-disbelief"
      ? [...heatSignals, ...distributionSignals]
      : [...damageSignals, ...distributionSignals];

  const supportingSignals = selectStrongestSignals(supportPool, supportDirection);
  const conflictingSignals = selectStrongestSignals(conflictPool, supportDirection === "late" ? "early" : "late");

  const usableCoreSignals = [...heatSignals, ...damageSignals, ...distributionSignals].filter(Boolean);
  const agreement =
    usableCoreSignals.length > 0
      ? 1 -
        usableCoreSignals.reduce((sum, signal) => {
          const target = signal.family === "heat" ? heat : signal.family === "damage" ? damage : distribution;
          return sum + Math.abs(signal.stageScore - target);
        }, 0) /
          usableCoreSignals.length
      : 0.45;
  const averageQuality =
    usableCoreSignals.length > 0
      ? usableCoreSignals.reduce((sum, signal) => sum + signal.weight, 0) / usableCoreSignals.length
      : 0.4;
  const confidence = Math.round(clamp(0.42 + agreement * 0.28 + averageQuality * 0.2, 0.35, 0.9) * 100);

  const previousPhaseIndex =
    previousEstimate?.phaseId ? getCyclePhaseIndex(previousEstimate.phaseId) : undefined;
  const currentPhaseIndex = getCyclePhaseIndex(phaseId);
  const change =
    previousPhaseIndex === undefined
      ? "unchanged"
      : currentPhaseIndex === previousPhaseIndex
        ? "unchanged"
        : currentPhaseIndex > previousPhaseIndex
          ? "later"
          : "earlier";

  return {
    asOfDate: new Date(generatedAt).toISOString().slice(0, 10),
    phaseId,
    label: phase.label,
    confidence,
    score: Math.round(heat * 100),
    heatScore: Math.round(heat * 100),
    damageScore: Math.round(damage * 100),
    distributionScore: Math.round(distribution * 100),
    summary: PHASE_SUMMARY_TEMPLATES[phaseId],
    rationale: `${phase.description} Supporting evidence leans most on ${
      supportingSignals.map((signal) => signal.label).join(", ") || "the current indicator mix"
    }.`,
    supportingMetricIds: supportingSignals.map((signal) => signal.metricId),
    conflictingMetricIds: conflictingSignals.map((signal) => signal.metricId),
    source: "rule-based",
    change,
  };
}

function buildPromptPayload(metrics, deterministicEstimate) {
  const metricPayload = Object.entries(metrics)
    .map(([metricId, metric]) => {
      const seriesSummary = summarizeSeries(metric);

      if (!seriesSummary && !metric?.currentValue) {
        return null;
      }

      return {
        metricId,
        label: summarizeMetric(metricId),
        priority: metricPromptPriority(metricId),
        dataMode: metric?.dataMode ?? "seeded",
        status: metric?.status ?? "neutral",
        trend: metric?.trend ?? "flat",
        isLive: Boolean(metric?.isLive),
        asOf: metric?.asOf ?? null,
        sourceLabel: metric?.sourceLabel ?? "Unknown",
        currentValue: metric?.currentValue ?? "Unavailable",
        deltaLabel: metric?.deltaLabel ?? "Unavailable",
        latestValue: seriesSummary?.latestValue ?? null,
        previousValue: seriesSummary?.previousValue ?? null,
        earliestValue: seriesSummary?.earliestValue ?? null,
        recentValues: seriesSummary?.recentValues ?? [],
        observationCount: seriesSummary?.observationCount ?? 0,
        seriesMin: seriesSummary?.min ?? null,
        seriesMax: seriesSummary?.max ?? null,
        absoluteChange: seriesSummary?.absoluteChange ?? null,
        rangeChange: seriesSummary?.rangeChange ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.metricId.localeCompare(right.metricId);
    });

  return {
    deterministicEstimate,
    preferredMetricIds: PREFERRED_LLM_METRICS,
    metricCount: metricPayload.length,
    metricPayload,
    phases: CYCLE_PHASES.map(({ id, label, description }) => ({ id, label, description })),
  };
}

async function requestOpenAICycleEstimate(metrics, deterministicEstimate) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const model = process.env.CYCLE_ESTIMATE_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      input: [
        {
          role: "system",
          content:
            "You are a Bitcoin market cycle analyst. You will receive all currently available dashboard indicators, plus a preferred subset of free-source cycle-heavy indicators. Consider every available metric, but weight model-derived metrics less than direct API metrics. Prefer stability over daily flapping, and only disagree with the deterministic estimate when the broader evidence clearly supports it. You must choose exactly one allowed phase and return valid JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify(buildPromptPayload(metrics, deterministicEstimate)),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cycle_estimate",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              phaseId: {
                type: "string",
                enum: CYCLE_PHASES.map((phase) => phase.id),
              },
              confidence: {
                type: "integer",
                minimum: 0,
                maximum: 100,
              },
              summary: {
                type: "string",
              },
              rationale: {
                type: "string",
              },
              supportingMetricIds: {
                type: "array",
                items: {
                  type: "string",
                },
                minItems: 1,
                maxItems: 4,
              },
              conflictingMetricIds: {
                type: "array",
                items: {
                  type: "string",
                },
                minItems: 1,
                maxItems: 4,
              },
            },
            required: [
              "phaseId",
              "confidence",
              "summary",
              "rationale",
              "supportingMetricIds",
              "conflictingMetricIds",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text;

  if (typeof outputText !== "string" || outputText.length === 0) {
    throw new Error("OpenAI response did not include output_text");
  }

  const parsed = JSON.parse(outputText);
  const phase = getCyclePhase(parsed.phaseId);

  return {
    ...deterministicEstimate,
    phaseId: parsed.phaseId,
    label: phase.label,
    confidence: parsed.confidence,
    summary: parsed.summary,
    rationale: parsed.rationale,
    supportingMetricIds: parsed.supportingMetricIds,
    conflictingMetricIds: parsed.conflictingMetricIds,
    source: "llm-assisted",
    model,
  };
}

export async function estimateCyclePosition(metrics, generatedAt = Date.now(), previousEstimate = null) {
  const deterministicEstimate = buildDeterministicEstimate(metrics, generatedAt, previousEstimate);

  if (process.env.CYCLE_ESTIMATE_USE_LLM === "false") {
    return deterministicEstimate;
  }

  try {
    return (await requestOpenAICycleEstimate(metrics, deterministicEstimate)) ?? deterministicEstimate;
  } catch {
    return deterministicEstimate;
  }
}
