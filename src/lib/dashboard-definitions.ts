import indicatorsRaw from "../config/config-indicators.conf?raw";
import { parseConf, type ConfScalar } from "./conf-parser";

export type DashboardPanelId =
  | "price-action"
  | "cycle-regime"
  | "context-confirmation"
  | "macro-market-structure";

export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "histogram"
  | "step-line"
  | "gauge"
  | "line-with-zones"
  | "bars-plus-line";

export type UpdateFrequency = "real-time" | "daily" | "weekly";

export type Sentiment = "bullish" | "bearish" | "neutral";

export interface MetricTooltip {
  what: string;
  why: string;
}

export interface DashboardMetric {
  id: string;
  name: string;
  shortName?: string;
  panelId: DashboardPanelId;
  tooltip: MetricTooltip;
  chartType: ChartType;
  updateFrequency: UpdateFrequency;
  bullishInterpretation: string;
  bearishInterpretation: string;
  learnMore: string;
  defaultVisible?: boolean;
  mobilePriority?: 1 | 2 | 3;
  valueFormat?: "price" | "number" | "percent" | "ratio" | "btc" | "usd";
  sentimentMode?: Sentiment;
  enabled: boolean;
}

export interface DashboardPanel {
  id: DashboardPanelId;
  title: string;
  description: string;
}

const EXPECTED_PANEL_IDS: DashboardPanelId[] = [
  "price-action",
  "cycle-regime",
  "context-confirmation",
  "macro-market-structure",
];

const EXPECTED_METRIC_IDS = [
  "price-vs-realized-price",
  "asopr",
  "exchange-netflow",
  "exchange-balance",
  "adjusted-transfer-volume",
  "mvrv",
  "percent-supply-in-profit",
  "lth-supply",
  "sth-supply",
  "lth-net-position-change",
  "reserve-risk",
  "liveliness",
  "puell-multiple",
  "pi-cycle-top",
  "mayer-multiple",
  "2-year-ma-multiplier",
  "nupl",
  "lth-nupl",
  "sth-nupl",
  "rhodl-ratio",
  "fear-and-greed",
  "recent-reddit-sentiment",
  "hodl-waves",
  "active-supply",
  "active-addresses",
  "cdd",
  "dormancy",
  "hashrate",
  "difficulty",
  "hash-ribbon",
  "ssr",
  "dxy",
  "10y-real-yield",
  "fed-rate-expectations",
  "fed-balance-sheet",
  "on-rrp",
  "funding-rate",
  "open-interest",
  "nvt-signal",
  "power-law",
  "stock-to-flow",
  "spot-btc-etf-flows",
  "spot-btc-etf-holdings",
] as const;

function getString(values: Record<string, ConfScalar>, key: string) {
  const value = values[key];

  if (typeof value !== "string") {
    throw new Error(`Missing indicator config string: ${key}`);
  }

  return value;
}

function getBoolean(values: Record<string, ConfScalar>, key: string) {
  const value = values[key];

  if (typeof value !== "boolean") {
    throw new Error(`Missing indicator config boolean: ${key}`);
  }

  return value;
}

function getNumber(values: Record<string, ConfScalar>, key: string) {
  const value = values[key];

  if (typeof value !== "number") {
    throw new Error(`Missing indicator config number: ${key}`);
  }

  return value;
}

function indexSections() {
  return Object.fromEntries(parseConf(indicatorsRaw).map((section) => [section.name, section.values]));
}

function parsePanelOrder(rawValue: string): DashboardPanelId[] {
  return rawValue.split(",").map((value) => value.trim()) as DashboardPanelId[];
}

function loadDashboardConfig() {
  const sections = indexSections();
  const panelsSection = sections.panels;

  if (!panelsSection) {
    throw new Error("Indicator config is missing the [panels] section.");
  }

  const panelOrder = parsePanelOrder(getString(panelsSection, "order"));

  for (const expectedPanelId of EXPECTED_PANEL_IDS) {
    if (!panelOrder.includes(expectedPanelId)) {
      throw new Error(`Indicator config is missing panel ${expectedPanelId}.`);
    }
  }

  const panels: DashboardPanel[] = panelOrder.map((panelId) => ({
    id: panelId,
    title: getString(panelsSection, `${panelId}.title`),
    description: getString(panelsSection, `${panelId}.description`),
  }));

  const allMetrics: DashboardMetric[] = parseConf(indicatorsRaw)
    .filter((section) => section.name.startsWith("metric."))
    .map((section) => {
      const values = section.values;

      return {
        id: getString(values, "id"),
        name: getString(values, "name"),
        shortName: getString(values, "short_name") || undefined,
        panelId: getString(values, "panel_id") as DashboardPanelId,
        enabled: getBoolean(values, "enabled"),
        chartType: getString(values, "chart_type") as ChartType,
        updateFrequency: getString(values, "update_frequency") as UpdateFrequency,
        valueFormat: getString(values, "value_format") as DashboardMetric["valueFormat"],
        defaultVisible: getBoolean(values, "default_visible"),
        mobilePriority: getNumber(values, "mobile_priority") as DashboardMetric["mobilePriority"],
        tooltip: {
          what: getString(values, "tooltip_what"),
          why: getString(values, "tooltip_why"),
        },
        bullishInterpretation: getString(values, "bullish_interpretation"),
        bearishInterpretation: getString(values, "bearish_interpretation"),
        learnMore: getString(values, "learn_more"),
      };
    });

  const metricIds = allMetrics.map((metric) => metric.id);

  if (metricIds.length !== EXPECTED_METRIC_IDS.length) {
    throw new Error(`Expected ${EXPECTED_METRIC_IDS.length} metrics in indicator config, found ${metricIds.length}.`);
  }

  for (const expectedMetricId of EXPECTED_METRIC_IDS) {
    if (!metricIds.includes(expectedMetricId)) {
      throw new Error(`Indicator config is missing metric ${expectedMetricId}.`);
    }
  }

  for (const metric of allMetrics) {
    if (!EXPECTED_PANEL_IDS.includes(metric.panelId)) {
      throw new Error(`Metric ${metric.id} references unknown panel ${metric.panelId}.`);
    }
  }

  const enabledMetrics = allMetrics.filter((metric) => metric.enabled);

  if (enabledMetrics.length !== 22) {
    throw new Error(`Expected 22 enabled metrics, found ${enabledMetrics.length}.`);
  }

  const metricsByPanel = panels.map((panel) => ({
    ...panel,
    metrics: enabledMetrics.filter((metric) => metric.panelId === panel.id),
  }));

  return {
    panels,
    allMetrics,
    enabledMetrics,
    metricsByPanel,
  };
}

const dashboardConfig = loadDashboardConfig();

export const DASHBOARD_PANELS = dashboardConfig.panels;
export const DASHBOARD_ALL_METRICS = dashboardConfig.allMetrics;
export const DASHBOARD_METRICS = dashboardConfig.enabledMetrics;
export const DASHBOARD_METRICS_BY_PANEL = dashboardConfig.metricsByPanel;

export function getMetricById(metricId: string, options: { includeDisabled?: boolean } = {}) {
  const source = options.includeDisabled ? DASHBOARD_ALL_METRICS : DASHBOARD_METRICS;
  return source.find((metric) => metric.id === metricId);
}
