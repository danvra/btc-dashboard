const CYCLE_PHASES = [
  {
    id: "deep-capitulation",
    label: "Deep Capitulation",
    description:
      "Market stress still dominates the backdrop, and the cycle looks closer to exhausted downside than renewed speculation.",
  },
  {
    id: "bottoming-and-reaccumulation",
    label: "Bottoming and Reaccumulation",
    description:
      "Selling pressure appears to be fading, but conviction is still rebuilding and broad participation remains tentative.",
  },
  {
    id: "early-recovery-under-disbelief",
    label: "Early Recovery Under Disbelief",
    description:
      "Trend conditions are improving without obvious late-cycle excess, and the market still feels more skeptical than euphoric.",
  },
  {
    id: "healthy-bull-expansion",
    label: "Healthy Bull Expansion",
    description:
      "Profitability, participation, and trend are aligned in a constructive way without clear historical overheating.",
  },
  {
    id: "late-cycle-acceleration",
    label: "Late-Cycle Acceleration",
    description:
      "Momentum and profitability are strengthening, and several cycle indicators are moving closer to late-stage territory.",
  },
  {
    id: "euphoric-overheating",
    label: "Euphoric Overheating",
    description:
      "Valuation and leverage signals suggest the market is becoming historically stretched and increasingly sensitive to a reset.",
  },
  {
    id: "distribution-and-top-formation",
    label: "Distribution and Top Formation",
    description:
      "Older supply is becoming more active, conviction looks less one-sided, and the market may be transitioning out of peak expansion.",
  },
  {
    id: "post-top-unwind",
    label: "Post-Top Unwind",
    description:
      "Speculative excess is being cleared, trend quality is deteriorating, and the market is retracing away from hotter conditions.",
  },
];

const PHASE_INDEX = new Map(CYCLE_PHASES.map((phase, index) => [phase.id, index]));

const CORE_SIGNAL_ORDER = [
  "mvrv",
  "percent-supply-in-profit",
  "reserve-risk",
  "pi-cycle-top",
  "mayer-multiple",
  "puell-multiple",
  "liveliness",
  "lth-net-position-change",
  "funding-rate",
  "hash-ribbon",
];

const PHASE_SUMMARY_TEMPLATES = {
  "deep-capitulation":
    "Stress-sensitive indicators still outweigh expansion signals, which keeps the read close to deep-cycle damage rather than renewed upside enthusiasm.",
  "bottoming-and-reaccumulation":
    "The dashboard looks more like a repair phase than a clean breakout, with some stress easing but not enough broad confirmation for a stronger recovery label.",
  "early-recovery-under-disbelief":
    "Cycle signals are improving from lower-risk territory, but the mix still looks more skeptical and rebuilding than broadly euphoric.",
  "healthy-bull-expansion":
    "Trend, profitability, and participation look constructive without the kind of synchronized overheating that usually characterizes later-cycle extremes.",
  "late-cycle-acceleration":
    "The cycle read is still constructive, but several valuation and speculation indicators are moving into hotter territory than a plain mid-cycle expansion.",
  "euphoric-overheating":
    "Historically hot cycle indicators are clustered at elevated levels, which points to a market that looks increasingly stretched rather than simply healthy.",
  "distribution-and-top-formation":
    "The market still carries late-cycle heat, but distribution-sensitive signals are becoming more active and make the backdrop look less cleanly expansionary.",
  "post-top-unwind":
    "The dashboard no longer looks like a fresh bottom, but it also does not resemble a healthy expansion because damage-sensitive signals still show unwind behavior.",
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function getCyclePhase(phaseId) {
  return CYCLE_PHASES.find((phase) => phase.id === phaseId) ?? CYCLE_PHASES[0];
}

function getQualityWeight(metric) {
  switch (metric?.dataMode) {
    case "live":
    case "scraped":
      return 1;
    case "approx":
      return 0.6;
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
  const usableSignals = signals.filter(Boolean);

  if (usableSignals.length === 0) {
    return [];
  }

  const scoredSignals = usableSignals.map((signal) => ({
    ...signal,
    strength:
      direction === "late"
        ? signal.stageScore * signal.weight
        : (1 - signal.stageScore) * signal.weight,
  }));

  return scoredSignals
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
  const supplyInProfit = buildSignal(
    "percent-supply-in-profit",
    metrics["percent-supply-in-profit"],
    normalizeBetween(getLatestNumericValue(metrics["percent-supply-in-profit"]), 45, 98),
    "A larger share of supply in profit usually aligns with more mature cycle conditions.",
    "heat",
  );
  const reserveRisk = buildSignal(
    "reserve-risk",
    metrics["reserve-risk"],
    normalizeWithinSeries(metrics["reserve-risk"]),
    "Higher reserve risk tends to align with more expensive long-term conditions.",
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
  const puellMultiple = buildSignal(
    "puell-multiple",
    metrics["puell-multiple"],
    normalizeBetween(getLatestNumericValue(metrics["puell-multiple"]), 0.5, 3.5),
    "High miner profitability often appears later in stronger cycle expansions.",
    "heat",
  );
  const fundingRate = buildSignal(
    "funding-rate",
    metrics["funding-rate"],
    normalizeBetween(getLatestNumericValue(metrics["funding-rate"]), -0.02, 0.06),
    "More positive funding often lines up with crowded long positioning.",
    "heat",
  );

  const priceVsRealized = buildSignal(
    "price-vs-realized-price",
    metrics["price-vs-realized-price"],
    normalizeBetween(getLatestNumericValue(metrics["price-vs-realized-price"]), 0.85, 1.2) === null
      ? null
      : 1 - normalizeBetween(getLatestNumericValue(metrics["price-vs-realized-price"]), 0.85, 1.2),
    "Trading back toward or below realized price usually increases cycle damage.",
    "damage",
  );
  const asopr = buildSignal(
    "asopr",
    metrics["asopr"],
    normalizeBetween(getLatestNumericValue(metrics["asopr"]), 0.95, 1.02) === null
      ? null
      : 1 - normalizeBetween(getLatestNumericValue(metrics["asopr"]), 0.95, 1.02),
    "Spending coins at lower profitability tends to appear in weaker conditions.",
    "damage",
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

  const liveliness = buildSignal(
    "liveliness",
    metrics["liveliness"],
    normalizeWithinSeries(metrics["liveliness"]),
    "Rising liveliness can mean older supply is becoming more active.",
    "distribution",
  );
  const cdd = buildSignal(
    "cdd",
    metrics["cdd"],
    normalizeWithinSeries(metrics["cdd"]),
    "Higher coin-days destroyed can reinforce distribution risk.",
    "distribution",
  );
  const dormancy = buildSignal(
    "dormancy",
    metrics["dormancy"],
    normalizeWithinSeries(metrics["dormancy"]),
    "Higher dormancy suggests older coins are contributing more to activity.",
    "distribution",
  );
  const lthNetPositionChange = buildSignal(
    "lth-net-position-change",
    metrics["lth-net-position-change"],
    normalizeWithinSeries(metrics["lth-net-position-change"], true),
    "Fading long-term holder accumulation can suggest stronger distribution behavior.",
    "distribution",
  );

  const heatSignals = [mvrv, supplyInProfit, reserveRisk, piCycleTop, mayerMultiple, puellMultiple, fundingRate];
  const damageSignals = [priceVsRealized, asopr, hashRibbon, adjustedTransferVolume, activeAddresses];
  const distributionSignals = [liveliness, cdd, dormancy, lthNetPositionChange];

  const heat = averageSignals(heatSignals) ?? 0.5;
  const damage = averageSignals(damageSignals) ?? 0.5;
  const distribution = averageSignals(distributionSignals) ?? 0.5;

  let phaseId = "healthy-bull-expansion";

  if (heat < 0.22 && damage > 0.72) {
    phaseId = "deep-capitulation";
  } else if (heat < 0.32 && damage > 0.5) {
    phaseId = "bottoming-and-reaccumulation";
  } else if (heat < 0.45 && damage <= 0.5) {
    phaseId = "early-recovery-under-disbelief";
  } else if (heat < 0.62 && distribution < 0.55 && damage <= 0.45) {
    phaseId = "healthy-bull-expansion";
  } else if (heat < 0.78 && distribution < 0.58 && damage <= 0.5) {
    phaseId = "late-cycle-acceleration";
  } else if (heat >= 0.78 && distribution < 0.6 && damage <= 0.55) {
    phaseId = "euphoric-overheating";
  } else if (heat >= 0.62 && distribution >= 0.55) {
    phaseId = "distribution-and-top-formation";
  } else if (damage > 0.56) {
    phaseId = "post-top-unwind";
  }

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
      ? heatSignals
      : [...damageSignals, ...distributionSignals];

  const supportingSignals = selectStrongestSignals(supportPool, supportDirection);
  const conflictingSignals = selectStrongestSignals(conflictPool, supportDirection === "late" ? "early" : "late");

  const usableCoreSignals = [...heatSignals, ...damageSignals, ...distributionSignals].filter(Boolean);
  const agreement =
    usableCoreSignals.length > 0
      ? 1 -
        usableCoreSignals.reduce((sum, signal) => sum + Math.abs(signal.stageScore - (signal.family === "heat" ? heat : signal.family === "damage" ? damage : distribution)), 0) /
          usableCoreSignals.length
      : 0.45;
  const averageQuality =
    usableCoreSignals.length > 0
      ? usableCoreSignals.reduce((sum, signal) => sum + signal.weight, 0) / usableCoreSignals.length
      : 0.4;
  const confidence = Math.round(clamp(0.42 + agreement * 0.28 + averageQuality * 0.2, 0.35, 0.9) * 100);

  const previousPhaseIndex = PHASE_INDEX.get(previousEstimate?.phaseId);
  const currentPhaseIndex = PHASE_INDEX.get(phaseId) ?? 0;
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
    rationale: `${phase.description} Supporting evidence leans most on ${supportingSignals
      .map((signal) => signal.label)
      .join(", ") || "the current indicator mix"}.`,
    supportingMetricIds: supportingSignals.map((signal) => signal.metricId),
    conflictingMetricIds: conflictingSignals.map((signal) => signal.metricId),
    source: "rule-based",
    change,
  };
}

function buildPromptPayload(metrics, deterministicEstimate) {
  const metricPayload = CORE_SIGNAL_ORDER.map((metricId) => {
    const metric = metrics[metricId];

    return {
      metricId,
      dataMode: metric?.dataMode ?? "seeded",
      status: metric?.status ?? "neutral",
      currentValue: metric?.currentValue ?? "Unavailable",
      deltaLabel: metric?.deltaLabel ?? "Unavailable",
      latestValue: getLatestNumericValue(metric),
      sourceLabel: metric?.sourceLabel ?? "Unknown",
    };
  }).filter((metric) => metric.latestValue !== null || metric.currentValue !== "Unavailable");

  return {
    deterministicEstimate,
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
            "You are a Bitcoin market cycle analyst. You must choose exactly one allowed phase. Weight approximate metrics less than scraped or live metrics. Prefer stability over daily flapping. Return valid JSON only.",
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

export async function estimateCyclePosition(metrics, generatedAt, previousEstimate) {
  const deterministicEstimate = buildDeterministicEstimate(metrics, generatedAt, previousEstimate);

  if (process.env.CYCLE_ESTIMATE_USE_LLM === "false") {
    return deterministicEstimate;
  }

  try {
    const llmEstimate = await requestOpenAICycleEstimate(metrics, deterministicEstimate);
    return llmEstimate ?? deterministicEstimate;
  } catch {
    return deterministicEstimate;
  }
}
