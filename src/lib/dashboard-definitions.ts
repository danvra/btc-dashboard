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
      what: "Compares BTC market cap with aggregate major stablecoin market cap.",
      why: "Helps frame whether stablecoin purchasing power is expanding or thinning relative to Bitcoin.",
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
      what: "Tracks a public sentiment composite from Alternative.me.",
      why: "Helps spot whether the broader market is fearful, neutral, or euphoric.",
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
      what: "A venue basket of BTC perpetual funding rates from public exchange APIs.",
      why: "Helps show whether perp positioning is paying up for longs or leaning defensive.",
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
      what: "Tracks BTC perpetual open interest from public venue APIs and local history.",
      why: "Helps show whether leveraged participation is expanding or cooling off.",
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
      what: "Uses Blockchain.com’s estimated transaction value in USD as a free activity proxy.",
      why: "Helps show whether economically meaningful settlement activity is firming or fading.",
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
      what: "Compares Bitcoin market value with realized value using Blockchain.com’s public chart.",
      why: "Helps place spot price in a broader valuation and cycle context.",
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
      what: "Compares current miner revenue with its 365-day moving average.",
      why: "Helps show whether miner profitability looks stressed, neutral, or overheated.",
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
      what: "Measures the gap between the 111DMA and the 2x 350DMA trigger line.",
      why: "Helps show how close price structure is to a classic late-cycle model trigger.",
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
      what: "Compares BTC spot price with its 200-day moving average.",
      why: "Helps show whether price is extended or compressed versus a longer trend baseline.",
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
      what: "Tracks the buffer between spot price and the 5x 2-year moving-average band.",
      why: "Helps frame how far current price sits from a historically hot long-cycle band.",
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
      what: "Compares spot price with a locally fitted long-term power-law trend line.",
      why: "Helps show whether price is trading below, near, or above its modeled long-run path.",
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
      what: "Uses circulating supply and annual issuance to estimate Bitcoin’s stock-to-flow ratio.",
      why: "Helps track a simple scarcity model using free supply history.",
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
      what: "Estimates active supply by dividing BTC transfer volume by circulating supply.",
      why: "Helps show whether a larger share of supply is participating in settlement activity.",
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
      what: "Tracks unique active Bitcoin addresses from Blockchain.com.",
      why: "Helps confirm whether network participation is broadening or fading.",
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
      what: "Tracks estimated total Bitcoin hash rate from Blockchain.com.",
      why: "Helps show network security and miner participation.",
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
      what: "Tracks current Bitcoin mining difficulty with next-adjustment context from mempool.space.",
      why: "Helps show how competitive mining conditions are and whether the next adjustment is easing or tightening.",
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
      what: "Compares the 30-day and 60-day hashrate averages.",
      why: "Helps show whether the mining network looks stressed or recovered.",
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
      what: "Tracks Blockchain.com’s Network Value to Transactions Signal chart.",
      why: "Helps compare valuation with underlying transaction activity.",
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
      what: "Tracks the broad U.S. dollar index from FRED.",
      why: "Helps frame macro liquidity pressure or relief for risk assets.",
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
      what: "Tracks the U.S. 10-year real yield from FRED.",
      why: "Helps show the real-rate backdrop facing long-duration and risk assets.",
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
      what: "Tracks total Federal Reserve assets from FRED.",
      why: "Helps contextualize broad liquidity expansion or contraction.",
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
      what: "Tracks overnight reverse repo usage from FRED.",
      why: "Helps monitor liquidity parked in the Fed’s overnight facility.",
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
