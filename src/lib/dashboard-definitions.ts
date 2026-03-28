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

export interface MetricInterpretation {
  bullish: string;
  bearish: string;
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
    title: "Daily / Price Action",
    description: "Short-term market behavior, exchange activity, and transaction flow.",
  },
  {
    id: "cycle-regime",
    title: "Cycle / Regime",
    description: "Market cycle positioning, holder behavior, and conviction signals.",
  },
  {
    id: "context-confirmation",
    title: "Context / Confirmation",
    description: "Network participation and supporting confirmation indicators.",
  },
  {
    id: "macro-market-structure",
    title: "Macro / Market Structure",
    description: "Liquidity, rates, macro backdrop, and institutional demand.",
  },
];

export const DASHBOARD_METRICS: DashboardMetric[] = [
  {
    id: "price-vs-realized-price",
    name: "Price vs Realized Price",
    panelId: "price-action",
    tooltip: {
      what: "Compares BTC price with the average on-chain cost basis.",
      why: "Helps show whether the market trades above or below the average holder's price.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Price holds above realized price, showing stronger market positioning.",
    bearishInterpretation: "Price falls below realized price, showing weaker market positioning.",
    learnMore:
      "This metric compares spot price with the average price at which coins last moved on-chain. Holding above it often signals stronger conditions, while trading below it can suggest broader holder stress.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "price",
  },
  {
    id: "asopr",
    name: "aSOPR",
    panelId: "price-action",
    tooltip: {
      what: "Shows whether coins moved today were sold at a profit or a loss.",
      why: "Helps reveal whether the market is taking profits or realizing pain.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "aSOPR stays above 1 with brief resets that quickly recover.",
    bearishInterpretation: "aSOPR stays below 1, showing losses are being realized.",
    learnMore:
      "Adjusted SOPR looks at whether coins spent on-chain are locking in gains or losses. It can help show whether the market is accepting higher prices or struggling to hold them.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "ratio",
  },
  {
    id: "exchange-netflow",
    name: "Exchange Netflow",
    panelId: "price-action",
    tooltip: {
      what: "Measures net BTC moving into or out of exchanges.",
      why: "Helps gauge whether coins are positioning for sale or moving off-platform to hold.",
    },
    chartType: "histogram",
    updateFrequency: "daily",
    bullishInterpretation: "Net outflows suggest coins are leaving exchanges to be held.",
    bearishInterpretation: "Net inflows suggest more supply may be available to sell.",
    learnMore:
      "Exchange netflow tracks the balance of incoming and outgoing BTC across trading venues. It is often used as a simple read on near-term sell pressure versus self-custody or accumulation behavior.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "btc",
  },
  {
    id: "exchange-balance",
    name: "Exchange Balance / Exchange Reserve",
    shortName: "Exchange Reserve",
    panelId: "price-action",
    tooltip: {
      what: "Tracks how much BTC is sitting on exchanges.",
      why: "Helps show how much liquid supply is readily available to be sold.",
    },
    chartType: "area",
    updateFrequency: "daily",
    bullishInterpretation: "Falling exchange balances suggest tighter liquid supply.",
    bearishInterpretation: "Rising exchange balances suggest more BTC is available to sell.",
    learnMore:
      "Exchange reserve follows the amount of Bitcoin held on major exchanges. Lower balances can support a tighter supply backdrop, while rising balances can increase available sell-side liquidity.",
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
    bullishInterpretation: "Rising meaningful transfer activity supports stronger network usage.",
    bearishInterpretation: "Weak or fading transfer activity can signal softer participation.",
    learnMore:
      "Adjusted transfer volume aims to isolate economically meaningful on-chain transfers by filtering out some internal churn and noise. It helps show whether real settlement activity is growing or slowing.",
    defaultVisible: true,
    mobilePriority: 3,
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
    bullishInterpretation: "Recovering from low or neutral levels can support a healthier uptrend.",
    bearishInterpretation: "Extreme readings can signal overheating or a higher-risk market.",
    learnMore:
      "MVRV compares the current market value of Bitcoin with its realized value, which represents aggregate on-chain cost basis. It is widely used to place price in a broader cycle context.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "ratio",
  },
  {
    id: "percent-supply-in-profit",
    name: "Percent Supply in Profit",
    panelId: "cycle-regime",
    tooltip: {
      what: "Shows how much BTC supply is sitting in unrealized profit.",
      why: "Helps reveal whether most holders are comfortable or under pressure.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising readings show more holders are back in profit.",
    bearishInterpretation: "Low readings show more holders are underwater and under stress.",
    learnMore:
      "This metric estimates the share of circulating supply whose last on-chain move occurred below the current price. It helps frame whether the market is broadly profitable or under pressure.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "percent",
  },
  {
    id: "lth-supply",
    name: "LTH Supply",
    panelId: "cycle-regime",
    tooltip: {
      what: "Measures how much BTC is held by long-term holders.",
      why: "Helps show whether strong hands are accumulating and keeping supply off the market.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising long-term holder supply points to accumulation and conviction.",
    bearishInterpretation: "Falling long-term holder supply can indicate distribution into strength.",
    learnMore:
      "Long-term holder supply estimates the amount of BTC held by entities or coins that have stayed dormant long enough to be considered conviction-driven rather than short-term traders.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "btc",
  },
  {
    id: "sth-supply",
    name: "STH Supply",
    panelId: "cycle-regime",
    tooltip: {
      what: "Measures how much BTC is held by short-term holders.",
      why: "Helps show whether more supply sits with reactive market participants.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Moderate rebuilding can support trend continuation after resets.",
    bearishInterpretation: "Rapid growth in short-term supply can signal froth or weaker hands.",
    learnMore:
      "Short-term holder supply tracks the portion of BTC held by newer market participants. It often expands during bullish phases and can rise sharply when speculation becomes crowded.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "btc",
  },
  {
    id: "lth-net-position-change",
    name: "LTH Net Position Change",
    panelId: "cycle-regime",
    tooltip: {
      what: "Shows whether long-term holders are adding to or reducing holdings.",
      why: "Helps confirm accumulation or distribution by conviction-driven investors.",
    },
    chartType: "histogram",
    updateFrequency: "daily",
    bullishInterpretation: "Positive readings suggest long-term holders are accumulating.",
    bearishInterpretation: "Negative readings suggest long-term holders are distributing.",
    learnMore:
      "This metric focuses on change over time in long-term holder balances. It is useful for confirming whether experienced holders are absorbing supply or reducing exposure.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "btc",
  },
  {
    id: "reserve-risk",
    name: "Reserve Risk",
    panelId: "cycle-regime",
    tooltip: {
      what: "Measures price relative to long-term holder conviction.",
      why: "Helps judge whether BTC looks relatively attractive or expensive in cycle terms.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Low readings suggest price remains attractive relative to conviction.",
    bearishInterpretation: "High readings suggest a more expensive long-term setup.",
    learnMore:
      "Reserve Risk blends price with the opportunity cost carried by long-term holders who continue not to sell. It is often used as a high-level cycle valuation framework rather than a timing tool.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "number",
  },
  {
    id: "liveliness",
    name: "Liveliness",
    panelId: "cycle-regime",
    tooltip: {
      what: "Shows whether older coins are mostly being held or spent.",
      why: "Helps confirm whether long-term conviction is strengthening or weakening.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Flat or falling liveliness suggests stronger long-term holding behavior.",
    bearishInterpretation: "Rising liveliness suggests more older coins are being spent.",
    learnMore:
      "Liveliness reflects the balance between coin accumulation and spending over time. Rising values can indicate old supply reactivation, while falling values suggest continued holding.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "number",
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
    bullishInterpretation: "Lower or recovering readings can suggest reduced miner-side excess.",
    bearishInterpretation: "Extreme highs can signal elevated miner profitability and sell pressure.",
    learnMore:
      "Puell Multiple compares current miner revenue with a long-term average to help frame whether miners are under pressure or unusually profitable, both of which can affect market structure.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "ratio",
  },
  {
    id: "pi-cycle-top",
    name: "Pi Cycle Top",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares the 111-day average with twice the 350-day average.",
      why: "Helps flag when price momentum starts looking historically overheated.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "A wide buffer between the two lines suggests less immediate top-risk.",
    bearishInterpretation: "A tight or crossed setup can signal a hotter late-cycle market.",
    learnMore:
      "The Pi Cycle Top indicator is a price-only cycle model built from two moving averages. It is popular in BTC communities because past major tops tended to arrive when the faster average met the slower multiplied average.",
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
    bullishInterpretation: "Lower readings can suggest BTC is closer to long-term support than euphoria.",
    bearishInterpretation: "Very high readings can signal that BTC is stretched above trend.",
    learnMore:
      "Mayer Multiple divides spot price by the 200-day moving average. It is a simple long-cycle trend gauge that many BTC users watch for signs of overextension or reset.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "ratio",
  },
  {
    id: "nupl",
    name: "NUPL",
    panelId: "cycle-regime",
    tooltip: {
      what: "Measures net unrealized profit or loss across the Bitcoin market.",
      why: "Helps show whether the cycle looks fearful, healthy, or euphoric.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Low or recovering NUPL can suggest a healthier early-cycle backdrop.",
    bearishInterpretation: "Very high NUPL can signal euphoric conditions and higher cycle risk.",
    learnMore:
      "NUPL compares unrealized gains and losses across the market relative to market value. It is a classic cycle indicator for spotting capitulation, recovery, and euphoric phases.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "ratio",
  },
  {
    id: "lth-nupl",
    name: "LTH-NUPL",
    panelId: "cycle-regime",
    tooltip: {
      what: "Estimates unrealized profit or loss for long-term holders.",
      why: "Helps show whether conviction holders are sitting on modest gains or major cycle profits.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Lower or rebuilding readings can suggest long-term holders still have room before euphoria.",
    bearishInterpretation: "Very high readings can show long-term holders are deep in profit and closer to distribution risk.",
    learnMore:
      "This metric focuses on unrealized profit or loss for long-term holders. It can help separate broad market strength from the profit position of Bitcoin's most conviction-driven cohort.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "ratio",
  },
  {
    id: "sth-nupl",
    name: "STH-NUPL",
    panelId: "cycle-regime",
    tooltip: {
      what: "Estimates unrealized profit or loss for short-term holders.",
      why: "Helps show whether newer market participants are stressed or becoming overheated.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Negative or reset readings can reflect washed-out short-term positioning.",
    bearishInterpretation: "High positive readings can show newer holders are crowded into profit and more fragile.",
    learnMore:
      "Short-term holder NUPL tracks unrealized profit and loss for newer market participants. It is useful for spotting stress, local resets, and froth among reactive holders.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "ratio",
  },
  {
    id: "rhodl-ratio",
    name: "RHODL Ratio",
    panelId: "cycle-regime",
    tooltip: {
      what: "Compares wealth held in young coins versus older held coins.",
      why: "Helps judge whether the market looks early-cycle, balanced, or overheated.",
    },
    chartType: "line-with-zones",
    updateFrequency: "daily",
    bullishInterpretation: "Lower readings usually point to earlier-cycle or less overheated conditions.",
    bearishInterpretation: "High readings can suggest wealth is concentrated in newer coins and cycle risk is rising.",
    learnMore:
      "RHODL compares the realized value of younger coins to older coins and adjusts for market age. It is widely used to judge whether cycle wealth is concentrated in fresh speculation or long-held conviction.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "number",
  },
  {
    id: "active-supply",
    name: "Active Supply",
    panelId: "context-confirmation",
    tooltip: {
      what: "Shows how much BTC supply has moved recently.",
      why: "Helps reveal whether dormant coins are re-entering circulation or staying inactive.",
    },
    chartType: "area",
    updateFrequency: "daily",
    bullishInterpretation: "A measured rise can confirm healthier market participation.",
    bearishInterpretation: "A sharp reactivation of dormant supply can add distribution risk.",
    learnMore:
      "Active supply estimates the amount of BTC that has moved within selected recent time windows. It helps show whether more of the network's supply is becoming engaged again.",
    defaultVisible: true,
    mobilePriority: 3,
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
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising address activity can confirm broader participation.",
    bearishInterpretation: "Flat or falling activity can weaken confidence in the move.",
    learnMore:
      "Active addresses are a simple participation measure that tracks how many on-chain addresses are transacting. It is best treated as directional context rather than a strict user count.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "number",
  },
  {
    id: "cdd",
    name: "CDD (Coin Days Destroyed)",
    shortName: "CDD",
    panelId: "context-confirmation",
    tooltip: {
      what: "Gives more weight to older coins when they move.",
      why: "Helps spot moments when long-held BTC suddenly becomes active.",
    },
    chartType: "histogram",
    updateFrequency: "daily",
    bullishInterpretation: "Contained readings suggest older supply is still sitting tight.",
    bearishInterpretation: "Large spikes can signal long-held coins are waking up and moving.",
    learnMore:
      "Coin Days Destroyed increases the impact of movements from older coins. It is useful for spotting when dormant supply starts to re-enter the market or shift ownership.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "number",
  },
  {
    id: "dormancy",
    name: "Dormancy",
    panelId: "context-confirmation",
    tooltip: {
      what: "Shows the average age of coins moved on-chain.",
      why: "Helps reveal whether mainly newer coins or older held coins are being spent.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Lower dormancy suggests mostly newer coins are moving.",
    bearishInterpretation: "Higher dormancy suggests older coins are becoming more active.",
    learnMore:
      "Dormancy measures the average age of spent coins and helps distinguish between routine activity from newer supply and larger shifts involving older holdings.",
    defaultVisible: true,
    mobilePriority: 3,
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
    bullishInterpretation: "Rising or stable hashrate suggests strong network security and miner confidence.",
    bearishInterpretation: "Persistent declines can signal miner stress or weaker network conditions.",
    learnMore:
      "Hashrate is a broad network health measure that estimates the computing power dedicated to mining Bitcoin. It usually trends over longer periods rather than acting as a fast market signal.",
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
    chartType: "step-line",
    updateFrequency: "daily",
    bullishInterpretation: "Rising or steady difficulty points to competitive, resilient mining conditions.",
    bearishInterpretation: "Falling difficulty can signal miner stress or reduced participation.",
    learnMore:
      "Bitcoin adjusts mining difficulty to keep block production relatively stable. It is a slower-moving structural indicator that often complements hashrate.",
    defaultVisible: true,
    mobilePriority: 3,
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
    bearishInterpretation: "A compressed ribbon can suggest miners are still under pressure.",
    learnMore:
      "Hash Ribbon is a miner-cycle model built from short and long moving averages of hashrate. It is often used to identify periods of miner capitulation and later recovery.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "number",
  },
  {
    id: "ssr",
    name: "SSR (Stablecoin Supply Ratio)",
    shortName: "SSR",
    panelId: "context-confirmation",
    tooltip: {
      what: "Compares Bitcoin's size to stablecoin liquidity.",
      why: "Helps gauge how much dollar-like buying power exists relative to BTC.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Lower SSR suggests stronger relative stablecoin liquidity.",
    bearishInterpretation: "Higher SSR suggests thinner relative stablecoin liquidity.",
    learnMore:
      "The Stablecoin Supply Ratio compares Bitcoin's market size with the size of major stablecoin supply. It can offer a rough liquidity context for crypto-native buying power.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "ratio",
  },
  {
    id: "dxy",
    name: "U.S. Dollar Index",
    shortName: "DXY",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Tracks the strength of the U.S. dollar against major currencies.",
      why: "Helps frame whether the macro backdrop is supportive or restrictive for risk assets.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "A softer dollar can create a friendlier backdrop for BTC.",
    bearishInterpretation: "A stronger dollar can tighten conditions for risk assets.",
    learnMore:
      "The U.S. Dollar Index is a broad macro context signal. Bitcoin often performs better when dollar strength eases, though the relationship is not always immediate.",
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
    updateFrequency: "daily",
    bullishInterpretation: "Falling real yields can support non-yielding assets like BTC.",
    bearishInterpretation: "Rising real yields can pressure demand for non-yielding assets.",
    learnMore:
      "Real yields help frame the opportunity cost of holding assets like Bitcoin that do not produce income. They are a useful macro lens, especially during policy-driven market shifts.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "percent",
  },
  {
    id: "fed-rate-expectations",
    name: "Fed Rate Expectations / FedWatch",
    shortName: "FedWatch",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Shows what markets expect the Fed to do with rates.",
      why: "Helps frame liquidity expectations and risk appetite.",
    },
    chartType: "step-line",
    updateFrequency: "daily",
    bullishInterpretation: "More easing or less tightening expected can support risk appetite.",
    bearishInterpretation: "More tightening or delayed easing can pressure liquidity-sensitive assets.",
    learnMore:
      "Rate expectations summarize how markets think the Federal Reserve may change policy. These expectations often matter as much as actual decisions for short-term market reactions.",
    defaultVisible: true,
    mobilePriority: 2,
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
    bullishInterpretation: "Expansion or stabilization can support a looser liquidity backdrop.",
    bearishInterpretation: "Persistent shrinkage can reflect tighter financial conditions.",
    learnMore:
      "The Federal Reserve balance sheet is a slower-moving macro liquidity reference. It is not a trading signal on its own, but it can help frame the broader policy environment.",
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
    updateFrequency: "daily",
    bullishInterpretation: "Falling ON RRP can imply liquidity is being released elsewhere.",
    bearishInterpretation: "High or rising ON RRP can reflect stickier liquidity conditions.",
    learnMore:
      "ON RRP is a plumbing-style macro metric that helps explain where short-term cash is being parked in the financial system. It is best used as supporting context rather than a headline signal.",
    defaultVisible: true,
    mobilePriority: 3,
    valueFormat: "usd",
  },
  {
    id: "funding-rate",
    name: "Funding Rate",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Tracks the periodic cost of holding perpetual futures positions.",
      why: "Helps show when leverage is leaning too aggressively long or short.",
    },
    chartType: "line",
    updateFrequency: "daily",
    bullishInterpretation: "Flat or slightly negative funding can suggest leverage is less crowded.",
    bearishInterpretation: "Persistently high positive funding can signal crowded longs and froth.",
    learnMore:
      "Funding Rate reflects whether perpetual futures traders are paying to stay long or short. BTC communities watch it closely because sustained positive funding often appears when leverage gets crowded.",
    defaultVisible: true,
    mobilePriority: 2,
    valueFormat: "percent",
  },
  {
    id: "spot-btc-etf-flows",
    name: "Spot BTC ETF Flows",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Measures net money moving into or out of spot Bitcoin ETFs.",
      why: "Helps show whether institutional demand is strengthening or fading.",
    },
    chartType: "bars-plus-line",
    updateFrequency: "daily",
    bullishInterpretation: "Consistent positive inflows suggest strengthening institutional demand.",
    bearishInterpretation: "Sustained outflows suggest weakening demand or profit-taking.",
    learnMore:
      "ETF flows track daily net creations and redemptions across spot Bitcoin funds. They are one of the clearest public signals of traditional market demand entering or leaving the BTC ecosystem.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "usd",
  },
  {
    id: "spot-btc-etf-holdings",
    name: "Spot BTC ETF Holdings",
    panelId: "macro-market-structure",
    tooltip: {
      what: "Tracks total BTC held by spot Bitcoin ETFs.",
      why: "Helps show how much supply these products are absorbing over time.",
    },
    chartType: "area",
    updateFrequency: "daily",
    bullishInterpretation: "Rising holdings show ETFs are steadily absorbing supply.",
    bearishInterpretation: "Flat or falling holdings show demand is slowing or reversing.",
    learnMore:
      "ETF holdings show the cumulative amount of Bitcoin held inside spot ETF vehicles. This can help you track whether these products are steadily pulling supply out of the available market float.",
    defaultVisible: true,
    mobilePriority: 1,
    valueFormat: "btc",
  },
];

export const DASHBOARD_METRICS_BY_PANEL = DASHBOARD_PANELS.map((panel) => ({
  ...panel,
  metrics: DASHBOARD_METRICS.filter((metric) => metric.panelId === panel.id),
}));

export function getMetricById(metricId: string) {
  return DASHBOARD_METRICS.find((metric) => metric.id === metricId);
}
