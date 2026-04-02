function percentChange(latest, previous) {
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) {
    return 0;
  }

  const baseline = Math.abs(previous) > Number.EPSILON ? Math.abs(previous) : 1;
  return ((latest - previous) / baseline) * 100;
}

function bandStatus(value, bullishMax, neutralMax) {
  if (value <= bullishMax) {
    return "bullish";
  }

  if (value <= neutralMax) {
    return "neutral";
  }

  return "bearish";
}

function invertedBandStatus(value, bearishMax, neutralMax) {
  if (value <= bearishMax) {
    return "bearish";
  }

  if (value <= neutralMax) {
    return "neutral";
  }

  return "bullish";
}

export function evaluateMetricStatus(metricId, latest, previous = latest, context = {}) {
  if (!Number.isFinite(latest)) {
    return "neutral";
  }

  const changePct = percentChange(latest, previous);

  switch (metricId) {
    case "price-vs-realized-price":
      return latest >= 1.05 ? "bullish" : latest >= 0.95 ? "neutral" : "bearish";
    case "asopr":
      return latest > 1.01 ? "bullish" : latest >= 0.99 ? "neutral" : "bearish";
    case "exchange-netflow":
      return latest < -1_000 ? "bullish" : latest > 1_000 ? "bearish" : "neutral";
    case "exchange-balance":
      return changePct < -0.5 ? "bullish" : changePct > 0.5 ? "bearish" : "neutral";
    case "adjusted-transfer-volume":
    case "active-supply":
    case "active-addresses":
    case "hashrate":
    case "difficulty":
    case "fed-balance-sheet":
    case "spot-btc-etf-holdings":
      return changePct > 0.5 ? "bullish" : changePct < -0.5 ? "bearish" : "neutral";
    case "mvrv":
      return latest < 1.2 ? "bullish" : latest < 2.4 ? "neutral" : "bearish";
    case "percent-supply-in-profit":
      return latest < 55 ? "bullish" : latest < 85 ? "neutral" : "bearish";
    case "lth-supply":
    case "lth-net-position-change":
    case "stock-to-flow":
      return changePct > 0.5 || latest > 0 ? "bullish" : changePct < -0.5 || latest < 0 ? "bearish" : "neutral";
    case "sth-supply":
      return changePct > 2 ? "bearish" : changePct < -2 ? "bullish" : "neutral";
    case "reserve-risk":
      return bandStatus(latest, 0.003, 0.01);
    case "liveliness":
      return bandStatus(latest, 0.62, 0.68);
    case "puell-multiple":
      return latest < 0.75 ? "bullish" : latest < 2.5 ? "neutral" : "bearish";
    case "pi-cycle-top":
      return latest > 25 ? "bullish" : latest > 10 ? "neutral" : "bearish";
    case "mayer-multiple":
      return latest < 0.9 ? "bullish" : latest < 1.8 ? "neutral" : "bearish";
    case "2-year-ma-multiplier":
      return latest > 70 ? "bullish" : latest > 35 ? "neutral" : "bearish";
    case "nupl":
      return latest < 0.2 ? "bullish" : latest < 0.75 ? "neutral" : "bearish";
    case "lth-nupl":
      return latest < 0.2 ? "bullish" : latest < 0.6 ? "neutral" : "bearish";
    case "sth-nupl":
      return latest <= 0 ? "bullish" : latest <= 0.25 ? "neutral" : "bearish";
    case "rhodl-ratio":
      return latest > 2000 ? "bearish" : latest > 700 ? "neutral" : "bullish";
    case "fear-and-greed":
      return invertedBandStatus(latest, 25, 60);
    case "recent-reddit-sentiment":
      return invertedBandStatus(latest, 45, 65);
    case "hodl-waves":
      return latest > 55 ? "bullish" : latest > 45 ? "neutral" : "bearish";
    case "cdd":
    case "dormancy":
    case "dxy":
    case "10y-real-yield":
    case "on-rrp":
    case "power-law":
      return changePct < -0.5 ? "bullish" : changePct > 0.5 ? "bearish" : "neutral";
    case "hash-ribbon":
      return latest > 1.01 ? "bullish" : latest < 0.99 ? "bearish" : "neutral";
    case "ssr":
      return latest < 10 ? "bullish" : latest < 14 ? "neutral" : "bearish";
    case "fed-rate-expectations": {
      const currentMidpoint = Number(context.currentMidpoint ?? 0);
      if (Number.isFinite(currentMidpoint) && currentMidpoint > 0) {
        if (latest < currentMidpoint - 0.125) {
          return "bullish";
        }
        if (latest > currentMidpoint + 0.125) {
          return "bearish";
        }
        return "neutral";
      }
      return changePct < -0.5 ? "bullish" : changePct > 0.5 ? "bearish" : "neutral";
    }
    case "funding-rate":
      return latest < -0.01 ? "bullish" : latest > 0.01 ? "bearish" : "neutral";
    case "open-interest": {
      const fundingRate = Number(context.fundingRate ?? 0);
      if (changePct > 2.5 && fundingRate > 0.01) {
        return "bearish";
      }
      if (changePct >= -2 && changePct <= 2.5 && fundingRate <= 0.01) {
        return "bullish";
      }
      return "neutral";
    }
    case "nvt-signal":
      return latest < 90 ? "bullish" : latest < 150 ? "neutral" : "bearish";
    case "spot-btc-etf-flows":
      return latest > 0 ? "bullish" : latest < 0 ? "bearish" : "neutral";
    default:
      return changePct > 0.5 ? "bullish" : changePct < -0.5 ? "bearish" : "neutral";
  }
}
