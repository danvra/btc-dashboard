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
}

export interface DashboardPanel {
  id: DashboardPanelId;
  title: string;
  description: string;
}

export const DASHBOARD_PANELS: DashboardPanel[] = [
  {
    id: "price-action",
    title: "Price / Positioning",
    description: "Spot pricing, liquidity context, derivatives positioning, and sentiment.",
  },
  {
    id: "cycle-regime",
    title: "Cycle / Regime",
    description: "Free-source valuation, miner stress, and locally derived cycle model overlays.",
  },
  {
    id: "context-confirmation",
    title: "Context / Confirmation",
    description: "Network activity, mining health, and valuation confirmation from public on-chain data.",
  },
  {
    id: "macro-market-structure",
    title: "Macro / Market Structure",
    description: "Dollar liquidity, rates, and the broader macro backdrop from FRED.",
  },
];

export const DASHBOARD_METRICS: DashboardMetric[] = [
  {
    id: "ssr",
    name: "Stablecoin Supply Ratio",
    shortName: "SSR",
    panelId: "price-action",
    tooltip: {
      what: "Compares Bitcoin's size to stablecoin liquidity.",
      why: "Helps gauge how much dollar-like buying power exists relative to BTC.",
    },
    chartType: "line",
    updateFrequency: "real-time",
    bullishInterpretation: "Lower SSR can suggest more stablecoin buying power relative to BTC market cap.",
    bearishInterpretation: "Higher SSR can suggest thinner stablecoin dry powder relative to BTC market cap.",
    learnMore:
      "SSR is a liquidity-style ratio built from public market caps. It is a useful context metric, but it is still a simplified proxy for available crypto-native buying power.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "ratio",
  },
  {
    id: "fear-and-greed",
    name: "Fear & Greed",
    panelId: "price-action",
    tooltip: {
      what: "Tracks broad crypto market sentiment on a 0 to 100 scale.",
      why: "Helps show whether the market mood is fearful, balanced, or overheated.",
    },
    chartType: "gauge",
    updateFrequency: "daily",
    bullishInterpretation: "Fearful or washed-out sentiment can improve asymmetry when other signals are stable.",
    bearishInterpretation: "Extreme greed can signal a hotter and more crowded tape.",
    learnMore:
      "This is an external sentiment index rather than a direct on-chain metric. It works best as context alongside positioning and valuation signals.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "number",
  },
  {
    id: "funding-rate",
    name: "Funding Rate Basket",
    shortName: "Funding",
    panelId: "price-action",
    tooltip: {
      what: "Tracks the periodic cost of holding perpetual futures positions.",
      why: "Helps show when leverage is leaning too aggressively long or short.",
    },
    chartType: "line",
    updateFrequency: "real-time",
    bullishInterpretation: "Moderate or reset funding can support a healthier trend backdrop.",
    bearishInterpretation: "Persistently elevated funding can signal crowded long positioning.",
    learnMore:
      "The dashboard averages public funding history from multiple venues into one compact read. It is meant to show regime and crowding, not exact venue-specific execution conditions.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "percent",
  },
  {
    id: "open-interest",
    name: "Open Interest",
    shortName: "OI",
    panelId: "price-action",
    tooltip: {
      what: "Measures the total size of open BTC futures positions across venues.",
      why: "Helps show how much leverage is building or clearing from the market.",
    },
    chartType: "area",
    updateFrequency: "real-time",
    bullishInterpretation: "Rising open interest with contained funding can support trend participation.",
    bearishInterpretation: "Rapid open-interest expansion alongside hot funding can raise liquidation risk.",
    learnMore:
      "The current v1 implementation favors efficient public OI snapshots plus local history, so the emphasis is on regime shifts rather than exact venue-weighted notional precision.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "btc",
  },
  {
    id: "adjusted-transfer-volume",
    name: "Adjusted Transfer Volume",
    panelId: "price-action",
    tooltip: {
      what: "Estimates real BTC value transferred on-chain after removing noise.",
      why: "Helps show whether meaningful network activity is strengthening or fading.",
    },
    chartType: "area",
    updateFrequency: "daily",
    bullishInterpretation: "Rising on-chain settlement activity can confirm healthier demand and throughput.",
    bearishInterpretation: "Fading settlement activity can point to softer participation.",
    learnMore:
      "This v1 card intentionally uses a documented free chart endpoint instead of a scraped or paid adjusted-volume metric. It is a practical public proxy, not a perfect replacement for premium on-chain vendors.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "usd",
  },
  {
    id: "mvrv",
    name: "MVRV",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares Bitcoin's market value to average on-chain cost basis.",
      why: "Helps show whether the market looks overheated, neutral, or depressed.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Neutral or recovering MVRV can support a healthier cycle backdrop.",
    bearishInterpretation: "Historically hot MVRV readings can signal a more stretched market.",
    learnMore:
      "MVRV is one of the strongest free cycle inputs still available in the refactored dashboard, so it carries more weight in the synthetic cycle outputs.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "ratio",
  },
  {
    id: "puell-multiple",
    name: "Puell Multiple",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares miner revenue with its longer-term average.",
      why: "Helps show whether miner profitability and selling pressure are unusually low or high.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Low or resetting Puell readings can align with healthier longer-term opportunity.",
    bearishInterpretation: "High miner profitability can coincide with hotter cycle conditions.",
    learnMore:
      "This card is locally derived from Blockchain.com miner revenue history. It stays fully API-first while preserving a classic cycle signal.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "ratio",
  },
  {
    id: "pi-cycle-top",
    name: "Pi Cycle Buffer",
    shortName: "Pi Cycle",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares the 111-day average with twice the 350-day average.",
      why: "Helps flag when price momentum starts looking historically overheated.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "A wide positive buffer suggests the model is not near a classic trigger condition.",
    bearishInterpretation: "A shrinking or negative buffer suggests hotter late-cycle conditions.",
    learnMore:
      "This is a local model overlay derived from public BTC history. It is useful context, but it should not be treated as a timing oracle.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "percent",
  },
  {
    id: "mayer-multiple",
    name: "Mayer Multiple",
    panelId: "cycle-regime",
    tooltip: {
      what: "Measures price relative to the 200-day moving average.",
      why: "Helps show whether BTC looks extended, neutral, or compressed versus long-term trend.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Lower or recovering Mayer readings can suggest better long-term asymmetry.",
    bearishInterpretation: "Very high Mayer readings can point to trend extension and hotter conditions.",
    learnMore:
      "The Mayer Multiple is a public-price-derived trend and valuation model, which makes it a strong fit for the free-source connector refactor.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "ratio",
  },
  {
    id: "2-year-ma-multiplier",
    name: "2-Year MA Multiplier",
    shortName: "2Y MA",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares BTC with the 2-year moving average and its 5x upper band.",
      why: "Helps show whether price is closer to washed-out levels or overheated cycle territory.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "A large buffer below the top band suggests price is not yet in the hottest historical zone.",
    bearishInterpretation: "A thin buffer or breakout through the band suggests a hotter cycle regime.",
    learnMore:
      "This card is computed from public price history and is intentionally labeled as a derived cycle model rather than a directly sourced market feed.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "percent",
  },
  {
    id: "power-law",
    name: "Power Law Ratio",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares BTC price with a long-term power-law trend model.",
      why: "Helps frame whether price looks stretched, neutral, or compressed versus that model.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "A lower price-to-model ratio can suggest less extended long-term positioning.",
    bearishInterpretation: "A higher price-to-model ratio can suggest a richer long-term valuation.",
    learnMore:
      "This is explicitly a local model overlay. In v1 it is kept because it is cheap to compute from free BTC history, not because it is a canonical market truth.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "ratio",
  },
  {
    id: "stock-to-flow",
    name: "Stock-to-Flow",
    shortName: "S2F",
    panelId: "cycle-regime",
    tooltip: {
      what: "Measures BTC scarcity as circulating supply divided by annual new issuance.",
      why: "Helps place Bitcoin within a long-term scarcity model tied to halvings and supply expansion.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising stock-to-flow reflects slower supply growth relative to existing stock.",
    bearishInterpretation: "A weaker or broken scarcity read reduces confidence in the model backdrop.",
    learnMore:
      "Like Power Law, this card is a local model-derived overlay. It stays in v1 because it is inexpensive to maintain and clearly labeled as such.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "ratio",
  },
  {
    id: "active-supply",
    name: "Active Supply Proxy",
    shortName: "Active Supply",
    panelId: "context-confirmation",
    tooltip: {
      what: "Shows how much BTC supply has moved recently.",
      why: "Helps reveal whether dormant coins are re-entering circulation or staying inactive.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising active-supply participation can support a healthier activity backdrop.",
    bearishInterpretation: "Fading participation can suggest softer network engagement.",
    learnMore:
      "This is a free public proxy built from Blockchain.com transfer volume and supply data. It is not a cohort metric, but it gives the dashboard a clean API-first activity read.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "percent",
  },
  {
    id: "active-addresses",
    name: "Active Addresses",
    panelId: "context-confirmation",
    tooltip: {
      what: "Counts addresses sending or receiving BTC.",
      why: "Helps give a rough read on current network participation and market engagement.",
    },
    chartType: "area",
    updateFrequency: "daily",
    bullishInterpretation: "Rising address activity can confirm healthier participation.",
    bearishInterpretation: "Weak address activity can reinforce a softer activity regime.",
    learnMore:
      "This is a straightforward public network participation signal and remains one of the cleaner confirmation metrics in the free-source connector layer.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "number",
  },
  {
    id: "hashrate",
    name: "Hashrate",
    panelId: "context-confirmation",
    tooltip: {
      what: "Estimates the total computing power securing Bitcoin.",
      why: "Helps track network health, miner confidence, and the strength of the mining base.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising hashrate points to a stronger and more committed mining network.",
    bearishInterpretation: "Sharp hashrate weakness can reflect miner stress or reduced participation.",
    learnMore:
      "Hashrate is a foundational public mining-health input and also feeds the locally derived Hash Ribbon card.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "number",
  },
  {
    id: "difficulty",
    name: "Difficulty",
    panelId: "context-confirmation",
    tooltip: {
      what: "Shows how hard it is to mine a new block.",
      why: "Helps reflect mining competition and the resilience of the network over time.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Stable or rising difficulty generally supports a stronger mining backdrop.",
    bearishInterpretation: "A weakening difficulty trend can align with miner stress.",
    learnMore:
      "The main series comes from Blockchain.com while the subtitle adds upcoming adjustment context from mempool.space.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "number",
  },
  {
    id: "hash-ribbon",
    name: "Hash Ribbon",
    panelId: "context-confirmation",
    tooltip: {
      what: "Compares shorter and longer hashrate averages.",
      why: "Helps spot miner stress, compression, and recovery phases.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "A recovered ribbon can suggest miner stress is easing.",
    bearishInterpretation: "A compressed ribbon can point to weaker miner conditions.",
    learnMore:
      "This is a local derivative of public hashrate history and is retained because it offers strong signal value for very little connector cost.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "ratio",
  },
  {
    id: "nvt-signal",
    name: "NVT Signal",
    shortName: "NVTS",
    panelId: "context-confirmation",
    tooltip: {
      what: "Compares Bitcoin's market value with on-chain transaction value.",
      why: "Helps judge whether price is running ahead of or in line with network activity.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Lower or resetting NVT Signal can align with healthier valuation support.",
    bearishInterpretation: "High NVT Signal can indicate valuation running ahead of activity.",
    learnMore:
      "NVT Signal is one of the highest-signal free valuation proxies still available after removing cohort and exchange-reserve metrics from v1.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "ratio",
  },
  {
    id: "dxy",
    name: "US Dollar Index",
    shortName: "DXY",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Tracks the strength of the U.S. dollar against major currencies.",
      why: "Helps frame whether the macro backdrop is supportive or restrictive for risk assets.",
    },
    chartType: "line",
    updateFrequency: "weekly",
    bullishInterpretation: "A softer dollar backdrop can support broader risk appetite.",
    bearishInterpretation: "A strengthening dollar can pressure liquidity-sensitive assets.",
    learnMore:
      "The macro cohort deliberately updates more slowly to stay efficient on free infrastructure and because these series do not need intraday refreshes for this dashboard.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "number",
  },
  {
    id: "10y-real-yield",
    name: "10Y Real Yield",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Shows the inflation-adjusted yield on 10-year U.S. bonds.",
      why: "Helps gauge how attractive yield-bearing assets look versus Bitcoin.",
    },
    chartType: "line",
    updateFrequency: "weekly",
    bullishInterpretation: "Lower real yields can support a friendlier liquidity backdrop for BTC.",
    bearishInterpretation: "Higher real yields can tighten financial conditions and pressure risk assets.",
    learnMore:
      "This remains a slow-moving macro confirmation card, intentionally grouped into the 48-hour slow cohort.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "percent",
  },
  {
    id: "fed-balance-sheet",
    name: "Fed Balance Sheet",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Tracks the size of the Fed's assets.",
      why: "Helps give a rough read on whether financial conditions are loosening or tightening.",
    },
    chartType: "area",
    updateFrequency: "weekly",
    bullishInterpretation: "A stabilizing or expanding balance sheet can support a looser liquidity backdrop.",
    bearishInterpretation: "A shrinking balance sheet can reinforce tighter liquidity conditions.",
    learnMore:
      "This is a macro backdrop card rather than a market-timing indicator, so it is intentionally refreshed less often than the price and on-chain cohorts.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "usd",
  },
  {
    id: "on-rrp",
    name: "ON RRP",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Shows cash parked in the Fed's overnight reverse repo facility.",
      why: "Helps add context around short-term system liquidity and collateral conditions.",
    },
    chartType: "area",
    updateFrequency: "weekly",
    bullishInterpretation: "Lower ON RRP usage can suggest cash is being redeployed elsewhere in the system.",
    bearishInterpretation: "Persistently elevated ON RRP can point to sticky liquidity parking.",
    learnMore:
      "ON RRP is a slow-moving liquidity-context metric and works best as a companion to DXY, real yields, and the Fed balance sheet.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "usd",
  },
];

export const DASHBOARD_METRICS_BY_PANEL = DASHBOARD_PANELS.map((panel) => ({
  ...panel,
  metrics: DASHBOARD_METRICS.filter((metric) => metric.panelId === panel.id),
}));

export function getMetricById(metricId: string) {
  return DASHBOARD_METRICS.find((metric) => metric.id === metricId);
}
