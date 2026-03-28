export const CYCLE_PHASES = [
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

export function getCyclePhase(phaseId) {
  return CYCLE_PHASES.find((phase) => phase.id === phaseId) ?? CYCLE_PHASES[0];
}

export function getCyclePhaseIndex(phaseId) {
  return PHASE_INDEX.get(phaseId) ?? 0;
}

export function classifyCyclePhaseId({ heat = 0.5, damage = 0.5, distribution = 0.5 }) {
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
