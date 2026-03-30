const PULLPUSH_API_BASE = "https://api.pullpush.io/reddit/search";
const REDDIT_SENTIMENT_WINDOW_HOURS = 48;
const REDDIT_POST_LIMIT = 16;
const REDDIT_COMMENT_LIMIT = 24;
const REDDIT_PROMPT_POST_LIMIT = 12;
const REDDIT_PROMPT_COMMENT_LIMIT = 16;
const BITCOIN_KEYWORDS = [
  /\bbitcoin\b/i,
  /\bbtc\b/i,
  /\bsats?\b/i,
  /\bspot etf\b/i,
  /\bhalving\b/i,
  /\bmicrostrategy\b/i,
  /\bmstr\b/i,
];

const SUBREDDIT_CONFIG = [
  { name: "Bitcoin", btcOnly: true },
  { name: "btc", btcOnly: true },
  { name: "BitcoinMarkets", btcOnly: true },
  { name: "CryptoCurrency", btcOnly: false },
  { name: "CryptoMarkets", btcOnly: false },
];

const POSITIVE_TERMS = [
  "bullish",
  "bull",
  "buy",
  "bought",
  "accumulate",
  "accumulation",
  "breakout",
  "strong",
  "higher",
  "uptrend",
  "support",
  "hodl",
  "inflow",
  "undervalued",
  "conviction",
];

const NEGATIVE_TERMS = [
  "bearish",
  "bear",
  "sell",
  "selling",
  "dump",
  "crash",
  "lower",
  "weak",
  "scam",
  "fraud",
  "hack",
  "pain",
  "liquidation",
  "panic",
  "overheated",
];

const MARKET_SIGNAL_KEYWORDS = [
  /\bprice\b/i,
  /\btarget\b/i,
  /\bbreakout\b/i,
  /\bcycle\b/i,
  /\bmacro\b/i,
  /\betf\b/i,
  /\binflow/i,
  /\boutflow/i,
  /\baccumulat/i,
  /\bbuy\b/i,
  /\bsell/i,
  /\bdip\b/i,
  /\brally\b/i,
  /\bresistance\b/i,
  /\bsupport\b/i,
  /\bhalving\b/i,
  /\bliquidation/i,
  /\bfunding\b/i,
  /\bopen interest\b/i,
];

const THEME_DEFINITIONS = [
  {
    label: "buy-the-dip and accumulation",
    patterns: [/\bdca\b/i, /buy the dip/i, /\blump sum\b/i, /\baccumulat/i, /\bstack/i],
    tone: "constructive",
  },
  {
    label: "price targets and upside debate",
    patterns: [/\bath\b/i, /price discovery/i, /\bbreakout\b/i, /\btarget\b/i, /\b110k\b/i, /\b120k\b/i],
    tone: "constructive",
  },
  {
    label: "macro and dollar backdrop",
    patterns: [/\bmacro\b/i, /\bdollar\b/i, /\byield/i, /\bfed\b/i, /\bliquidity\b/i],
    tone: "mixed",
  },
  {
    label: "exchange, wallet, and scam risk",
    patterns: [/\bexchange\b/i, /\bwallet\b/i, /\bscam\b/i, /\bhack\b/i, /\bkraken\b/i, /\bmexc\b/i, /\bchangelly\b/i],
    tone: "risk",
  },
  {
    label: "cycle and bull-bear positioning",
    patterns: [/\bcycle\b/i, /\bbullish\b/i, /\bbearish\b/i, /\boverheated\b/i, /\bhalving\b/i],
    tone: "mixed",
  },
];

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "almost",
  "also",
  "around",
  "because",
  "been",
  "being",
  "bitcoin",
  "btc",
  "comment",
  "could",
  "crypto",
  "discussion",
  "from",
  "have",
  "just",
  "market",
  "more",
  "post",
  "price",
  "really",
  "reddit",
  "still",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "thread",
  "some",
  "your",
  "money",
  "funds",
  "wallet",
  "friend",
  "month",
  "question",
  "very",
  "what",
  "when",
  "with",
  "would",
]);

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function truncate(value, maxLength = 180) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function stripNoise(value) {
  if (!value) {
    return "";
  }

  const normalized = value
    .replace(/\[removed\]|\[deleted\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function looksBitcoinRelevant(text) {
  return BITCOIN_KEYWORDS.some((pattern) => pattern.test(text));
}

function createExcerpt(...parts) {
  return truncate(
    parts
      .map((part) => stripNoise(part))
      .filter(Boolean)
      .join(" "),
    220,
  );
}

function postWeight(post) {
  const marketSignalBoost = MARKET_SIGNAL_KEYWORDS.some((pattern) => pattern.test(post.excerpt)) ? 18 : 0;
  return (
    Number(post.score ?? 0) +
    Number(post.numComments ?? 0) * 0.45 +
    Math.min(Number(post.upvoteRatio ?? 0) * 12, 12) +
    marketSignalBoost
  );
}

function commentWeight(comment) {
  const marketSignalBoost = MARKET_SIGNAL_KEYWORDS.some((pattern) => pattern.test(comment.excerpt)) ? 10 : 0;
  return Number(comment.score ?? 0) + Math.min((comment.body?.length ?? 0) / 120, 4) + marketSignalBoost;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "btc-dashboard-prototype/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.json();
}

async function fetchPullPush(kind, params) {
  const searchParams = new URLSearchParams(params);
  const payload = await fetchJson(`${PULLPUSH_API_BASE}/${kind}/?${searchParams.toString()}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function normalizePost(post, subredditConfig) {
  const createdUtc = Number(post.created_utc ?? post.created ?? 0);

  if (!Number.isFinite(createdUtc)) {
    return null;
  }

  const title = stripNoise(post.title);
  const body = stripNoise(post.selftext);
  const text = `${title} ${body}`.trim();

  if (!text) {
    return null;
  }

  if (!subredditConfig.btcOnly && !looksBitcoinRelevant(text)) {
    return null;
  }

  return {
    id: String(post.id ?? ""),
    subreddit: post.subreddit ?? subredditConfig.name,
    title: truncate(title, 120),
    body: truncate(body, 220),
    excerpt: createExcerpt(title, body),
    createdUtc,
    score: Number(post.score ?? post.ups ?? 0),
    numComments: Number(post.num_comments ?? 0),
    upvoteRatio: Number(post.upvote_ratio ?? 0),
    url: post.url ?? `https://www.reddit.com${post.permalink ?? ""}`,
    permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : post.url,
  };
}

function normalizeComment(comment, subredditConfig) {
  const createdUtc = Number(comment.created_utc ?? comment.created ?? 0);

  if (!Number.isFinite(createdUtc)) {
    return null;
  }

  const body = stripNoise(comment.body);

  if (!body) {
    return null;
  }

  if (!subredditConfig.btcOnly && !looksBitcoinRelevant(body)) {
    return null;
  }

  return {
    id: String(comment.id ?? ""),
    subreddit: comment.subreddit ?? subredditConfig.name,
    body: truncate(body, 240),
    excerpt: truncate(body, 180),
    createdUtc,
    score: Number(comment.score ?? comment.ups ?? 0),
    url: comment.permalink ? `https://www.reddit.com${comment.permalink}` : undefined,
    permalink: comment.permalink ? `https://www.reddit.com${comment.permalink}` : undefined,
  };
}

function countTerms(text, terms) {
  const haystack = ` ${text.toLowerCase()} `;
  return terms.reduce((total, term) => {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const matches = haystack.match(pattern);
    return total + (matches?.length ?? 0);
  }, 0);
}

function topTermsFromCorpus(texts, limit = 4) {
  const counts = new Map();

  for (const text of texts) {
    const tokens = stripNoise(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function themeHits(texts) {
  return THEME_DEFINITIONS.map((theme) => ({
    ...theme,
    hits: texts.reduce(
      (total, text) => total + theme.patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0),
      0,
    ),
  }))
    .filter((theme) => theme.hits > 0)
    .sort((left, right) => right.hits - left.hits);
}

function heuristicLabel(score) {
  if (score >= 70) {
    return "Bullish";
  }

  if (score >= 58) {
    return "Constructive";
  }

  if (score >= 43) {
    return "Neutral";
  }

  if (score >= 30) {
    return "Cautious";
  }

  return "Bearish";
}

function heuristicStatus(score) {
  if (score >= 62) {
    return "bullish";
  }

  if (score <= 38) {
    return "bearish";
  }

  return "neutral";
}

function heuristicSummary(corpus) {
  const texts = [
    ...corpus.posts.map((post) => `${post.title} ${post.body}`),
    ...corpus.comments.map((comment) => comment.body),
  ];
  const joined = texts.join(" ");
  const positiveCount = countTerms(joined, POSITIVE_TERMS);
  const negativeCount = countTerms(joined, NEGATIVE_TERMS);
  const balance = positiveCount - negativeCount;
  const score = clamp(Math.round(50 + (balance / Math.max(positiveCount + negativeCount, 8)) * 28));
  const label = heuristicLabel(score);
  const terms = topTermsFromCorpus(texts, 5);
  const themes = themeHits(texts);
  const topThemes = themes.slice(0, 3).map((theme) => theme.label);
  const dominantSubs = Array.from(
    new Set(corpus.posts.concat(corpus.comments).map((item) => `r/${item.subreddit}`)),
  ).slice(0, 5);
  const riskTheme = themes.find((theme) => theme.tone === "risk")?.label;
  const constructiveTheme = themes.find((theme) => theme.tone === "constructive")?.label;

  return {
    score,
    label,
    summary:
      balance >= 5
        ? `Bitcoin-relevant Reddit chatter leans constructive, led by ${topThemes.join(", ")}.`
        : balance <= -5
          ? `Bitcoin-relevant Reddit chatter leans cautious, with discussion anchored by ${topThemes.join(", ")}.`
          : `Bitcoin-relevant Reddit chatter looks mixed, with the loudest themes around ${topThemes.join(", ")}.`,
    methodology:
      "Heuristic fallback based on recent Reddit post and comment language because a live LLM summary was unavailable.",
    drivers:
      topThemes.length > 0
        ? topThemes.map((theme) => `Recent threads are clustering around ${theme}.`)
        : terms.slice(0, 3).map((term) => `Discussion volume is clustering around ${term}.`),
    risks: [
      riskTheme
        ? `Risk-heavy threads are still surfacing around ${riskTheme}.`
        : "Broad crypto threads can swing faster than Bitcoin-native communities.",
      "Support and scam posts can temporarily skew mood lower without reflecting market positioning.",
    ],
    opportunities: [
      constructiveTheme
        ? `Constructive engagement is strongest around ${constructiveTheme}.`
        : "A steady rise in constructive Reddit language can confirm improving retail engagement.",
    ],
    subreddits: dominantSubs,
  };
}

function buildPromptPayload(corpus, heuristic) {
  return {
    windowHours: REDDIT_SENTIMENT_WINDOW_HOURS,
    subredditCount: corpus.subreddits.length,
    subreddits: corpus.subreddits.map((subreddit) => `r/${subreddit}`),
    postCount: corpus.posts.length,
    commentCount: corpus.comments.length,
    heuristicBaseline: heuristic,
    posts: corpus.posts.slice(0, REDDIT_PROMPT_POST_LIMIT).map((post) => ({
      subreddit: post.subreddit,
      score: post.score,
      numComments: post.numComments,
      title: post.title,
      body: post.body,
      createdUtc: post.createdUtc,
    })),
    comments: corpus.comments.slice(0, REDDIT_PROMPT_COMMENT_LIMIT).map((comment) => ({
      subreddit: comment.subreddit,
      score: comment.score,
      body: comment.body,
      createdUtc: comment.createdUtc,
    })),
  };
}

async function requestOpenAIRedditSentiment(corpus, heuristic) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const model = process.env.REDDIT_SENTIMENT_MODEL || process.env.CYCLE_ESTIMATE_MODEL || "gpt-4o-mini";
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
            "You summarize Bitcoin-relevant Reddit sentiment across recent subreddit posts and comments. Focus on Bitcoin market mood, retail positioning, and recurring discussion themes. Ignore one-off support questions unless they are common. Return valid JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify(buildPromptPayload(corpus, heuristic)),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "reddit_sentiment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: {
                type: "integer",
                minimum: 0,
                maximum: 100,
              },
              label: {
                type: "string",
                enum: ["Bearish", "Cautious", "Neutral", "Constructive", "Bullish"],
              },
              summary: {
                type: "string",
              },
              methodology: {
                type: "string",
              },
              drivers: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 4,
              },
              risks: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 3,
              },
              opportunities: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 3,
              },
            },
            required: ["score", "label", "summary", "methodology", "drivers", "risks", "opportunities"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Reddit sentiment request failed with ${response.status}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text;

  if (typeof outputText !== "string" || outputText.length === 0) {
    throw new Error("OpenAI Reddit sentiment response did not include output_text");
  }

  return {
    ...JSON.parse(outputText),
    model,
  };
}

export async function fetchRecentRedditSentiment(options = {}) {
  const now = options.now ?? Date.now();
  const cutoffSeconds = Math.floor(now / 1000) - REDDIT_SENTIMENT_WINDOW_HOURS * 60 * 60;
  const subredditPayloads = await Promise.all(
    SUBREDDIT_CONFIG.map(async (config) => {
      const [rawPosts, rawComments] = await Promise.all([
        fetchPullPush("submission", {
          subreddit: config.name,
          sort: "desc",
          sort_type: "created_utc",
          size: String(REDDIT_POST_LIMIT),
        }),
        fetchPullPush("comment", {
          subreddit: config.name,
          sort: "desc",
          sort_type: "created_utc",
          size: String(REDDIT_COMMENT_LIMIT),
        }),
      ]);

      return {
        posts: rawPosts.map((post) => normalizePost(post, config)).filter(Boolean),
        comments: rawComments.map((comment) => normalizeComment(comment, config)).filter(Boolean),
      };
    }),
  );

  const allPosts = subredditPayloads.flatMap((payload) => payload.posts);
  const allComments = subredditPayloads.flatMap((payload) => payload.comments);
  const freshPosts = allPosts.filter((post) => post.createdUtc >= cutoffSeconds);
  const freshComments = allComments.filter((comment) => comment.createdUtc >= cutoffSeconds);
  const usingArchiveFallback = freshPosts.length === 0 && freshComments.length === 0;
  const selectedPosts = (usingArchiveFallback ? allPosts : freshPosts)
    .sort((left, right) => postWeight(right) - postWeight(left))
    .slice(0, REDDIT_PROMPT_POST_LIMIT);
  const selectedComments = (usingArchiveFallback ? allComments : freshComments)
    .sort((left, right) => commentWeight(right) - commentWeight(left))
    .slice(0, REDDIT_PROMPT_COMMENT_LIMIT);

  if (selectedPosts.length === 0 && selectedComments.length === 0) {
    throw new Error("No Reddit posts or comments were available for the recent BTC sentiment window.");
  }

  const corpus = {
    posts: selectedPosts,
    comments: selectedComments,
    subreddits: Array.from(new Set(selectedPosts.concat(selectedComments).map((item) => item.subreddit))),
  };
  const heuristic = heuristicSummary(corpus);
  const newestArchiveTimestampSeconds = Math.max(
    0,
    ...selectedPosts.map((post) => post.createdUtc),
    ...selectedComments.map((comment) => comment.createdUtc),
  );
  const sourceFreshnessHours =
    newestArchiveTimestampSeconds > 0 ? Math.round((now / 1000 - newestArchiveTimestampSeconds) / 3600) : null;
  const archiveFallbackReason = usingArchiveFallback
    ? `Reddit sentiment used the newest available public archive items because the mirror did not expose BTC-relevant posts or comments from the last ${REDDIT_SENTIMENT_WINDOW_HOURS} hours.`
    : null;

  try {
    const llmSummary = await requestOpenAIRedditSentiment(corpus, heuristic);

    if (!llmSummary) {
      return {
        ...heuristic,
        asOf: now,
        sourceAsOf: newestArchiveTimestampSeconds > 0 ? newestArchiveTimestampSeconds * 1000 : now,
        source: "heuristic",
        fallbackReason: [archiveFallbackReason, "OpenAI API key missing; using heuristic Reddit sentiment fallback."]
          .filter(Boolean)
          .join(" "),
        postCount: selectedPosts.length,
        commentCount: selectedComments.length,
        freshestSourceAgeHours: sourceFreshnessHours,
        samplePosts: selectedPosts.slice(0, 4),
        sampleComments: selectedComments.slice(0, 3),
      };
    }

    return {
      score: clamp(Number(llmSummary.score)),
      label: llmSummary.label,
      summary: llmSummary.summary,
      methodology: llmSummary.methodology,
      drivers: llmSummary.drivers,
      risks: llmSummary.risks,
      opportunities: llmSummary.opportunities,
      subreddits: corpus.subreddits.map((subreddit) => `r/${subreddit}`),
      asOf: now,
      sourceAsOf: newestArchiveTimestampSeconds > 0 ? newestArchiveTimestampSeconds * 1000 : now,
      source: "llm",
      model: llmSummary.model,
      fallbackReason: archiveFallbackReason,
      postCount: selectedPosts.length,
      commentCount: selectedComments.length,
      freshestSourceAgeHours: sourceFreshnessHours,
      samplePosts: selectedPosts.slice(0, 4),
      sampleComments: selectedComments.slice(0, 3),
    };
  } catch (error) {
    return {
      ...heuristic,
      asOf: now,
      sourceAsOf: newestArchiveTimestampSeconds > 0 ? newestArchiveTimestampSeconds * 1000 : now,
      source: "heuristic",
      fallbackReason: [
        archiveFallbackReason,
        error instanceof Error
          ? `Reddit sentiment fell back to the heuristic summarizer because the LLM request failed: ${error.message}`
          : "Reddit sentiment fell back to the heuristic summarizer because the LLM request failed.",
      ]
        .filter(Boolean)
        .join(" "),
      postCount: selectedPosts.length,
      commentCount: selectedComments.length,
      freshestSourceAgeHours: sourceFreshnessHours,
      samplePosts: selectedPosts.slice(0, 4),
      sampleComments: selectedComments.slice(0, 3),
    };
  }
}

export function redditSentimentStatus(score) {
  return heuristicStatus(score);
}
