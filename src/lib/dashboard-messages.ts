import messagesRaw from "../config/config-messages.conf?raw";
import { parseConf, type ConfScalar } from "./conf-parser";

function indexSections() {
  return Object.fromEntries(parseConf(messagesRaw).map((section) => [section.name, section.values]));
}

function getString(section: Record<string, ConfScalar> | undefined, key: string) {
  const value = section?.[key];

  if (typeof value !== "string") {
    throw new Error(`Missing dashboard message: ${key}`);
  }

  return value;
}

const sections = indexSections();

export interface DashboardMessages {
  common: {
    show: string;
    hide: string;
    close: string;
    loadingValue: string;
    connectingValue: string;
    noTimestamp: string;
    noLiveTimestamp: string;
    justNow: string;
    inUnderAMinute: string;
    unknown: string;
    notScheduled: string;
    windowUnavailable: string;
    notAvailable: string;
  };
  relativeTime: {
    minutesFuture: string;
    minutesPast: string;
    hoursFuture: string;
    hoursPast: string;
    daysFuture: string;
    daysPast: string;
  };
  app: {
    brand: string;
    subtitle: string;
    heroTitle: string;
    heroBody: string;
    logoAlt: string;
    btcPriceLabel: string;
    coverageLabel: string;
    coingeckoAttributionPrefix: string;
    coingeckoAttributionLinkLabel: string;
    loadingLiveData: string;
    activePanelLabel: string;
    coverageSuffix: string;
    cardsSuffix: string;
    coverageSummary: string;
  };
  card: {
    updatedPrefix: string;
    measuresLabel: string;
    mattersLabel: string;
  };
  learnPanel: {
    selectedMetricLabel: string;
    currentSnapshotLabel: string;
    sourceLabel: string;
    bullishReadLabel: string;
    bearishReadLabel: string;
  };
  cycleEstimate: {
    eyebrow: string;
    pendingTitle: string;
    pendingSummary: string;
    confidenceSuffix: string;
    scorePrefix: string;
    sourceRuleBased: string;
    sourceLlmAssisted: string;
    changeLater: string;
    changeEarlier: string;
    changeUnchanged: string;
  };
  cycleAnalog: {
    summaryCardLabel: string;
    pendingTitle: string;
    datesPending: string;
    datesWaiting: string;
    datesTemplate: string;
    agreementPending: string;
    agreementTemplate: string;
    eyebrow: string;
    agreementBadge: string;
    confidenceBadge: string;
    bestMatchPrefix: string;
    phaseWindowLabel: string;
    distanceLabel: string;
    coverageLabel: string;
    noMatches: string;
    phaseLadderLabel: string;
    distanceByCycleLabel: string;
    indicatorSupportLabel: string;
    timelineAria: string;
    distanceChartAria: string;
    phaseCapitulation: string;
    phaseReaccumulation: string;
    phaseEarlyBull: string;
    phaseBullExpansion: string;
    phaseLateBull: string;
    phaseOverheating: string;
    phaseDistribution: string;
    phaseUnwind: string;
  };
  constructive: {
    summaryCardLabel: string;
    summaryPending: string;
    summaryLabel: string;
    toneBroadlyConstructive: string;
    toneMixedButConstructive: string;
    toneSelectiveStrength: string;
    toneLimitedBreadth: string;
    summaryNoMetrics: string;
    summaryNoneBullish: string;
    summaryWithCounts: string;
    eyebrow: string;
    bullishBadge: string;
    neutralBadge: string;
    bearishBadge: string;
    leadingConstructiveReads: string;
    mainBearishPressure: string;
    noBullishSignals: string;
    panelBearishSuffix: string;
    neutralWatchlist: string;
    signalSupportByDataMode: string;
    sourceUpdated: string;
  };
  redditSentiment: {
    summaryCardLabel: string;
    summaryCardPending: string;
    summaryCardWaiting: string;
    summaryCardFallback: string;
    eyebrow: string;
    statsLabel: string;
    methodologyLabel: string;
    driversLabel: string;
    risksLabel: string;
    opportunitiesLabel: string;
    communitiesLabel: string;
    postsLabel: string;
    commentsLabel: string;
    sourceUpdated: string;
  };
  debug: {
    sectionTitle: string;
    sectionDescription: string;
    cacheHealthTitle: string;
    cacheUpdated: string;
    cacheUnavailable: string;
    refresh: string;
    refreshing: string;
    modeLabel: string;
    liveMetricsLabel: string;
    seededLabel: string;
    derivedLabel: string;
    modelLabel: string;
    liveLabel: string;
    schedulerLabel: string;
    nextRunLabel: string;
    noCacheSnapshot: string;
    noSourceTimestamp: string;
    refreshedDuringRequest: string;
    bootstrappedCache: string;
    servedFromGroupedCache: string;
    implementationNotes: string;
  };
  refresh: {
    complete: string;
    fallback: string;
    failed: string;
    cacheUnavailable: string;
    unableToLoad: string;
  };
  fallback: {
    warnings: string;
    scheduler: string;
  };
  status: {
    fresh: string;
    aging: string;
    stale: string;
    unknown: string;
    bullish: string;
    bearish: string;
    neutral: string;
    live: string;
    derived: string;
    model: string;
    seeded: string;
    approx: string;
    scraped: string;
  };
  preview: {
    eyebrow: string;
    title: string;
    body: string;
    bullishReadLabel: string;
    bearishReadLabel: string;
    learnMoreLabel: string;
    line: string;
    area: string;
    bar: string;
    histogram: string;
    stepLine: string;
    gauge: string;
    lineWithZones: string;
    barsPlusLine: string;
    realTime: string;
    daily: string;
    weekly: string;
  };
}

export const DASHBOARD_MESSAGES: DashboardMessages = {
  common: {
    show: getString(sections.common, "show"),
    hide: getString(sections.common, "hide"),
    close: getString(sections.common, "close"),
    loadingValue: getString(sections.common, "loading_value"),
    connectingValue: getString(sections.common, "connecting_value"),
    noTimestamp: getString(sections.common, "no_timestamp"),
    noLiveTimestamp: getString(sections.common, "no_live_timestamp"),
    justNow: getString(sections.common, "just_now"),
    inUnderAMinute: getString(sections.common, "in_under_a_minute"),
    unknown: getString(sections.common, "unknown"),
    notScheduled: getString(sections.common, "not_scheduled"),
    windowUnavailable: getString(sections.common, "window_unavailable"),
    notAvailable: getString(sections.common, "not_available"),
  },
  relativeTime: {
    minutesFuture: getString(sections["relative_time"], "minutes_future"),
    minutesPast: getString(sections["relative_time"], "minutes_past"),
    hoursFuture: getString(sections["relative_time"], "hours_future"),
    hoursPast: getString(sections["relative_time"], "hours_past"),
    daysFuture: getString(sections["relative_time"], "days_future"),
    daysPast: getString(sections["relative_time"], "days_past"),
  },
  app: {
    brand: getString(sections.app, "brand"),
    subtitle: getString(sections.app, "subtitle"),
    heroTitle: getString(sections.app, "hero_title"),
    heroBody: getString(sections.app, "hero_body"),
    logoAlt: getString(sections.app, "logo_alt"),
    btcPriceLabel: getString(sections.app, "btc_price_label"),
    coverageLabel: getString(sections.app, "coverage_label"),
    coingeckoAttributionPrefix: getString(sections.app, "coingecko_attribution_prefix"),
    coingeckoAttributionLinkLabel: getString(sections.app, "coingecko_attribution_link_label"),
    loadingLiveData: getString(sections.app, "loading_live_data"),
    activePanelLabel: getString(sections.app, "active_panel_label"),
    coverageSuffix: getString(sections.app, "coverage_suffix"),
    cardsSuffix: getString(sections.app, "cards_suffix"),
    coverageSummary: getString(sections.app, "coverage_summary"),
  },
  card: {
    updatedPrefix: getString(sections.card, "updated_prefix"),
    measuresLabel: getString(sections.card, "measures_label"),
    mattersLabel: getString(sections.card, "matters_label"),
  },
  learnPanel: {
    selectedMetricLabel: getString(sections.learn_panel, "selected_metric_label"),
    currentSnapshotLabel: getString(sections.learn_panel, "current_snapshot_label"),
    sourceLabel: getString(sections.learn_panel, "source_label"),
    bullishReadLabel: getString(sections.learn_panel, "bullish_read_label"),
    bearishReadLabel: getString(sections.learn_panel, "bearish_read_label"),
  },
  cycleEstimate: {
    eyebrow: getString(sections.cycle_estimate, "eyebrow"),
    pendingTitle: getString(sections.cycle_estimate, "pending_title"),
    pendingSummary: getString(sections.cycle_estimate, "pending_summary"),
    confidenceSuffix: getString(sections.cycle_estimate, "confidence_suffix"),
    scorePrefix: getString(sections.cycle_estimate, "score_prefix"),
    sourceRuleBased: getString(sections.cycle_estimate, "source_rule_based"),
    sourceLlmAssisted: getString(sections.cycle_estimate, "source_llm_assisted"),
    changeLater: getString(sections.cycle_estimate, "change_later"),
    changeEarlier: getString(sections.cycle_estimate, "change_earlier"),
    changeUnchanged: getString(sections.cycle_estimate, "change_unchanged"),
  },
  cycleAnalog: {
    summaryCardLabel: getString(sections.cycle_analog, "summary_card_label"),
    pendingTitle: getString(sections.cycle_analog, "pending_title"),
    datesPending: getString(sections.cycle_analog, "dates_pending"),
    datesWaiting: getString(sections.cycle_analog, "dates_waiting"),
    datesTemplate: getString(sections.cycle_analog, "dates_template"),
    agreementPending: getString(sections.cycle_analog, "agreement_pending"),
    agreementTemplate: getString(sections.cycle_analog, "agreement_template"),
    eyebrow: getString(sections.cycle_analog, "eyebrow"),
    agreementBadge: getString(sections.cycle_analog, "agreement_badge"),
    confidenceBadge: getString(sections.cycle_analog, "confidence_badge"),
    bestMatchPrefix: getString(sections.cycle_analog, "best_match_prefix"),
    phaseWindowLabel: getString(sections.cycle_analog, "phase_window_label"),
    distanceLabel: getString(sections.cycle_analog, "distance_label"),
    coverageLabel: getString(sections.cycle_analog, "coverage_label"),
    noMatches: getString(sections.cycle_analog, "no_matches"),
    phaseLadderLabel: getString(sections.cycle_analog, "phase_ladder_label"),
    distanceByCycleLabel: getString(sections.cycle_analog, "distance_by_cycle_label"),
    indicatorSupportLabel: getString(sections.cycle_analog, "indicator_support_label"),
    timelineAria: getString(sections.cycle_analog, "timeline_aria"),
    distanceChartAria: getString(sections.cycle_analog, "distance_chart_aria"),
    phaseCapitulation: getString(sections.cycle_analog, "phase_capitulation"),
    phaseReaccumulation: getString(sections.cycle_analog, "phase_reaccumulation"),
    phaseEarlyBull: getString(sections.cycle_analog, "phase_early_bull"),
    phaseBullExpansion: getString(sections.cycle_analog, "phase_bull_expansion"),
    phaseLateBull: getString(sections.cycle_analog, "phase_late_bull"),
    phaseOverheating: getString(sections.cycle_analog, "phase_overheating"),
    phaseDistribution: getString(sections.cycle_analog, "phase_distribution"),
    phaseUnwind: getString(sections.cycle_analog, "phase_unwind"),
  },
  constructive: {
    summaryCardLabel: getString(sections.constructive, "summary_card_label"),
    summaryPending: getString(sections.constructive, "summary_pending"),
    summaryLabel: getString(sections.constructive, "summary_label"),
    toneBroadlyConstructive: getString(sections.constructive, "tone_broadly_constructive"),
    toneMixedButConstructive: getString(sections.constructive, "tone_mixed_but_constructive"),
    toneSelectiveStrength: getString(sections.constructive, "tone_selective_strength"),
    toneLimitedBreadth: getString(sections.constructive, "tone_limited_breadth"),
    summaryNoMetrics: getString(sections.constructive, "summary_no_metrics"),
    summaryNoneBullish: getString(sections.constructive, "summary_none_bullish"),
    summaryWithCounts: getString(sections.constructive, "summary_with_counts"),
    eyebrow: getString(sections.constructive, "eyebrow"),
    bullishBadge: getString(sections.constructive, "bullish_badge"),
    neutralBadge: getString(sections.constructive, "neutral_badge"),
    bearishBadge: getString(sections.constructive, "bearish_badge"),
    leadingConstructiveReads: getString(sections.constructive, "leading_constructive_reads"),
    mainBearishPressure: getString(sections.constructive, "main_bearish_pressure"),
    noBullishSignals: getString(sections.constructive, "no_bullish_signals"),
    panelBearishSuffix: getString(sections.constructive, "panel_bearish_suffix"),
    neutralWatchlist: getString(sections.constructive, "neutral_watchlist"),
    signalSupportByDataMode: getString(sections.constructive, "signal_support_by_data_mode"),
    sourceUpdated: getString(sections.constructive, "source_updated"),
  },
  redditSentiment: {
    summaryCardLabel: getString(sections.reddit_sentiment, "summary_card_label"),
    summaryCardPending: getString(sections.reddit_sentiment, "summary_card_pending"),
    summaryCardWaiting: getString(sections.reddit_sentiment, "summary_card_waiting"),
    summaryCardFallback: getString(sections.reddit_sentiment, "summary_card_fallback"),
    eyebrow: getString(sections.reddit_sentiment, "eyebrow"),
    statsLabel: getString(sections.reddit_sentiment, "stats_label"),
    methodologyLabel: getString(sections.reddit_sentiment, "methodology_label"),
    driversLabel: getString(sections.reddit_sentiment, "drivers_label"),
    risksLabel: getString(sections.reddit_sentiment, "risks_label"),
    opportunitiesLabel: getString(sections.reddit_sentiment, "opportunities_label"),
    communitiesLabel: getString(sections.reddit_sentiment, "communities_label"),
    postsLabel: getString(sections.reddit_sentiment, "posts_label"),
    commentsLabel: getString(sections.reddit_sentiment, "comments_label"),
    sourceUpdated: getString(sections.reddit_sentiment, "source_updated"),
  },
  debug: {
    sectionTitle: getString(sections.debug, "section_title"),
    sectionDescription: getString(sections.debug, "section_description"),
    cacheHealthTitle: getString(sections.debug, "cache_health_title"),
    cacheUpdated: getString(sections.debug, "cache_updated"),
    cacheUnavailable: getString(sections.debug, "cache_unavailable"),
    refresh: getString(sections.debug, "refresh"),
    refreshing: getString(sections.debug, "refreshing"),
    modeLabel: getString(sections.debug, "mode_label"),
    liveMetricsLabel: getString(sections.debug, "live_metrics_label"),
    seededLabel: getString(sections.debug, "seeded_label"),
    derivedLabel: getString(sections.debug, "derived_label"),
    modelLabel: getString(sections.debug, "model_label"),
    liveLabel: getString(sections.debug, "live_label"),
    schedulerLabel: getString(sections.debug, "scheduler_label"),
    nextRunLabel: getString(sections.debug, "next_run_label"),
    noCacheSnapshot: getString(sections.debug, "no_cache_snapshot"),
    noSourceTimestamp: getString(sections.debug, "no_source_timestamp"),
    refreshedDuringRequest: getString(sections.debug, "refreshed_during_request"),
    bootstrappedCache: getString(sections.debug, "bootstrapped_cache"),
    servedFromGroupedCache: getString(sections.debug, "served_from_grouped_cache"),
    implementationNotes: getString(sections.debug, "implementation_notes"),
  },
  refresh: {
    complete: getString(sections.refresh, "complete"),
    fallback: getString(sections.refresh, "fallback"),
    failed: getString(sections.refresh, "failed"),
    cacheUnavailable: getString(sections.refresh, "cache_unavailable"),
    unableToLoad: getString(sections.refresh, "unable_to_load"),
  },
  fallback: {
    warnings: getString(sections.fallback, "warnings"),
    scheduler: getString(sections.fallback, "scheduler"),
  },
  status: {
    fresh: getString(sections.status, "fresh"),
    aging: getString(sections.status, "aging"),
    stale: getString(sections.status, "stale"),
    unknown: getString(sections.status, "unknown"),
    bullish: getString(sections.status, "bullish"),
    bearish: getString(sections.status, "bearish"),
    neutral: getString(sections.status, "neutral"),
    live: getString(sections.status, "live"),
    derived: getString(sections.status, "derived"),
    model: getString(sections.status, "model"),
    seeded: getString(sections.status, "seeded"),
    approx: getString(sections.status, "approx"),
    scraped: getString(sections.status, "scraped"),
  },
  preview: {
    eyebrow: getString(sections.preview, "eyebrow"),
    title: getString(sections.preview, "title"),
    body: getString(sections.preview, "body"),
    bullishReadLabel: getString(sections.preview, "bullish_read_label"),
    bearishReadLabel: getString(sections.preview, "bearish_read_label"),
    learnMoreLabel: getString(sections.preview, "learn_more_label"),
    line: getString(sections.preview, "line"),
    area: getString(sections.preview, "area"),
    bar: getString(sections.preview, "bar"),
    histogram: getString(sections.preview, "histogram"),
    stepLine: getString(sections.preview, "step_line"),
    gauge: getString(sections.preview, "gauge"),
    lineWithZones: getString(sections.preview, "line_with_zones"),
    barsPlusLine: getString(sections.preview, "bars_plus_line"),
    realTime: getString(sections.preview, "real_time"),
    daily: getString(sections.preview, "daily"),
    weekly: getString(sections.preview, "weekly"),
  },
};

export function fillMessage(template: string, variables: Record<string, string | number | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(variables[key] ?? ""));
}
