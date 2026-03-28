# Cycle Analog Header Spec

## Goal

Add a fourth square to the application header that helps answer:

- What part of the Bitcoin cycle does the current market most resemble?
- Which historical periods looked most similar to today across our strongest cycle indicators?

This card should complement the existing cycle estimate, not replace it.

## Product Framing

The current main header already presents a phase estimate such as `Early Recovery Under Disbelief`.
That estimate is produced by the rule-based cycle engine and summarizes today's indicator mix into a named phase.

The new square should add a different kind of signal:

- Existing estimate: rule-based interpretation of today's dashboard state
- New analog card: historical similarity match against prior cycle periods

This means the new square is not trying to say:

- "We know exactly where we are in the cycle"
- "We are exactly 62% through the cycle"

It is trying to say:

- "Today's indicator profile most resembles these historical moments"
- "Across the closest historical matches, this regime appears most often"

Recommended card label:

- `Cycle Analog`

Recommended v1 card content:

- Primary value: dominant analog regime, for example `Early Bull`
- Secondary line: closest historical analog dates, for example `Closest to Oct 2020, Jan 2024`
- Tertiary line: analog agreement, for example `72% of top matches in recovery-to-expansion`

## Why This Card Exists

The current cycle engine converts indicators into three internal dimensions:

- `heat`
- `damage`
- `distribution`

That is useful, but it does not directly compare the full current indicator fingerprint to prior cycle periods.

A historical analog card can improve interpretation in cases where two moments have similar "heat" but different character.
For example:

- A market can look constructive but still skeptical
- A market can also look constructive but increasingly distributed and late-cycle

Historical matching can help separate those conditions.

## Core Principle

Do not compare today only to "the previous cycle."

Compare today to a full library of historical dates across multiple Bitcoin cycles, then summarize the dominant analog regime from the nearest matches.

This avoids overfitting the read to one prior market environment.

## Methodology

### 1. Build a historical feature library

For every historical date with enough data coverage, create a feature vector from a selected set of cycle-relevant metrics.

Each historical row should include:

- `date`
- selected normalized metric values
- metric quality weights
- ex-post regime label
- optional reference context such as days since halving, days to prior ATH, days from cycle low

The analog engine should compare today's vector against this historical library.

### 2. Use a small, robust indicator set

V1 should use a limited set of strong cycle indicators with good historical depth and relatively better quality.

Recommended v1 candidates:

- `mvrv`
- `percent-supply-in-profit`
- `reserve-risk`
- `price-vs-realized-price`
- `asopr`
- `nupl`
- `liveliness`
- `dormancy`
- `lth-net-position-change`

Optional later additions:

- `mayer-multiple`
- `puell-multiple`
- `pi-cycle-top`
- `funding-rate`
- `hash-ribbon`

### 3. Down-weight noisy or proxy series

Not every dashboard metric should have equal influence.

Rules:

- `scraped` and direct series get full weight
- `approx` series get reduced weight
- metrics known to be conceptually proxied should be excluded from v1 if they can distort analog matching

This is especially important because the current dashboard still contains a meaningful number of `approx` metrics.

### 4. Normalize indicators across cycles

Raw values alone are not enough because Bitcoin's market structure changes over time.

V1 normalization should use one of these approaches:

- long-run percentile rank
- rolling z-score
- bounded normalization using historically meaningful ranges

Recommendation:

- Use percentile-style normalization where possible
- Keep all normalized features on a comparable `0..1` scale

This makes a 2020-like reading and a 2026 reading more comparable than raw levels would.

### 5. Compute similarity against all historical dates

For today's normalized feature vector:

1. Compare it to every eligible historical date
2. Compute a weighted distance score
3. Select the top nearest matches
4. Let those matches vote on the dominant regime

Suggested v1 distance function:

- weighted Euclidean distance
- or weighted Manhattan distance if we want a simpler interpretation

Suggested v1 weighting:

- stronger cycle indicators get more weight
- `approx` metrics get a lower multiplier
- highly correlated indicators should not all receive large independent weights

### 6. Convert nearest matches into a regime read

The output should not be one historical date only.

Instead:

- take the top `N` nearest matches
- group them by regime
- show the dominant regime and agreement percentage

Example:

- top 20 matches
- 14 of 20 are labeled `early-bull-expansion`
- displayed agreement = `70%`

This is more stable and more honest than over-emphasizing a single analog date.

## Regime Labeling

Historical dates need ex-post regime labels so the analog engine has something to vote on.

Recommended approach:

- Reuse the dashboard's existing cycle phase vocabulary where possible
- Map historical dates into the same phase set used by the current cycle estimator

Current phase vocabulary:

- `deep-capitulation`
- `bottoming-and-reaccumulation`
- `early-recovery-under-disbelief`
- `healthy-bull-expansion`
- `late-cycle-acceleration`
- `euphoric-overheating`
- `distribution-and-top-formation`
- `post-top-unwind`

Recommended simplification for the header card:

- Collapse those into shorter user-facing display labels

Suggested display mapping:

- `deep-capitulation` -> `Capitulation`
- `bottoming-and-reaccumulation` -> `Reaccumulation`
- `early-recovery-under-disbelief` -> `Early Bull`
- `healthy-bull-expansion` -> `Bull Expansion`
- `late-cycle-acceleration` -> `Late Bull`
- `euphoric-overheating` -> `Overheating`
- `distribution-and-top-formation` -> `Distribution`
- `post-top-unwind` -> `Unwind`

## Data Contract

Recommended addition to the dashboard summary payload:

```ts
interface DashboardCycleAnalog {
  asOfDate: string;
  label: string;
  phaseId: string;
  agreement: number;
  confidence: number;
  closestDates: string[];
  closestPhaseIds: string[];
  summary: string;
  methodology: "historical-nearest-neighbor";
  matchCount: number;
  indicatorIds: string[];
}
```

Recommended placement:

- `summary.cycleAnalog`

Example payload:

```json
{
  "cycleAnalog": {
    "asOfDate": "2026-03-28",
    "label": "Early Bull",
    "phaseId": "early-recovery-under-disbelief",
    "agreement": 72,
    "confidence": 78,
    "closestDates": ["2020-10-21", "2024-01-12", "2019-04-08"],
    "closestPhaseIds": [
      "early-recovery-under-disbelief",
      "healthy-bull-expansion",
      "early-recovery-under-disbelief"
    ],
    "summary": "Current cycle conditions most closely resemble prior recovery periods before broad euphoric excess.",
    "methodology": "historical-nearest-neighbor",
    "matchCount": 20,
    "indicatorIds": [
      "mvrv",
      "percent-supply-in-profit",
      "reserve-risk",
      "price-vs-realized-price",
      "nupl",
      "liveliness"
    ]
  }
}
```

## Header UX Spec

### Card title

- `Cycle Analog`

### Primary value

- short regime label such as `Early Bull`

### Secondary text

- `Closest to Oct 2020, Jan 2024`

### Supporting text

- `72% of top matches in recovery-to-expansion`

### Fallback states

If analog data is missing:

- title remains `Cycle Analog`
- value becomes `Pending`
- supporting line becomes `Historical comparison appears once enough indicator history is available`

If confidence is weak:

- still show the dominant regime
- soften the supporting copy, for example `Mixed historical analogs`

## Confidence Model

Confidence should not be based only on similarity.

Recommended inputs:

- analog agreement across top matches
- coverage of required indicators
- average quality weight of participating indicators
- dispersion between the best match and the rest

This prevents the UI from showing high confidence when the matches are based on thin or noisy data.

## Guardrails

The card must avoid false precision.

Do not:

- show a percentage-complete cycle meter
- claim exact timing to top or bottom
- compare against only one prior cycle
- let raw price dominate the analog
- let multiple highly correlated price-derived metrics overwhelm the read

Do:

- present this as a probabilistic analog
- use multiple historical matches
- lower the influence of proxy or approximate data
- favor stability over day-to-day flapping

## Implementation Plan

### V1

Goal:

- deliver a stable, understandable header card

Scope:

- use 6 to 9 quality indicators
- normalize all features to a common scale
- compute weighted nearest historical matches
- output dominant regime, top analog dates, agreement, and confidence

### V2

Enhancements:

- richer analog clustering by halving era and macro backdrop
- better de-correlation of overlapping price-derived features
- tooltip or expanded view with the top matching dates and indicator contributions
- optional "why this analog" explanation

## Recommended Build Order

1. Define the exact v1 indicator set and weights
2. Build historical feature rows for each eligible date
3. Add ex-post regime labels for the historical library
4. Compute similarity and match voting
5. Add `summary.cycleAnalog` to the cache payload
6. Render the fourth header square
7. Tune for stability so the label does not flap too easily

## Recommendation

The best v1 implementation is:

- a `Cycle Analog` card
- based on a small set of robust cycle indicators
- using weighted historical nearest-neighbor matching
- showing a dominant regime plus top analog dates
- framed as a probabilistic analog, not a precise cycle clock

This gives the header a new dimension of meaning without duplicating the current cycle estimate or overstating certainty.
