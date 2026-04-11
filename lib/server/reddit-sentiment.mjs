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

function heuristicStatus(score) {
  if (score >= 62) {
    return "bullish";
  }

  if (score <= 38) {
    return "bearish";
  }

  return "neutral";
}

function buildPromptPayload(corpus) {
  return {
    windowHours: REDDIT_SENTIMENT_WINDOW_HOURS,
    subredditCount: corpus.subreddits.length,
    subreddits: corpus.subreddits.map((subreddit) => `r/${subreddit}`),
    postCount: corpus.posts.length,
    commentCount: corpus.comments.length,
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

async function requestOpenAIRedditSentiment(corpus) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  const model = process.env.REDDIT_SENTIMENT_MODEL || process.env.CYCLE_ESTIMATE_MODEL || "gpt-4o-mini";
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 20_000) : null;
  let response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller?.signal,
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
              "You summarize Bitcoin-relevant Reddit sentiment using only the supplied posts and comments from the past 48 hours. Focus on Bitcoin market mood, retail positioning, and recurring discussion themes across the listed subreddits. Ignore one-off support questions unless they appear repeatedly across communities. Return valid JSON only that matches the schema.",
          },
          {
            role: "user",
            content: JSON.stringify(buildPromptPayload(corpus)),
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
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

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
  const selectedPosts = freshPosts
    .sort((left, right) => postWeight(right) - postWeight(left))
    .slice(0, REDDIT_PROMPT_POST_LIMIT);
  const selectedComments = freshComments
    .sort((left, right) => commentWeight(right) - commentWeight(left))
    .slice(0, REDDIT_PROMPT_COMMENT_LIMIT);

  if (selectedPosts.length === 0 && selectedComments.length === 0) {
    return {
      ok: false,
      reason: `No BTC-relevant Reddit posts or comments were available from the last ${REDDIT_SENTIMENT_WINDOW_HOURS} hours.`,
    };
  }

  const corpus = {
    posts: selectedPosts,
    comments: selectedComments,
    subreddits: Array.from(new Set(selectedPosts.concat(selectedComments).map((item) => item.subreddit))),
  };
  const newestSourceTimestampSeconds = Math.max(
    0,
    ...selectedPosts.map((post) => post.createdUtc),
    ...selectedComments.map((comment) => comment.createdUtc),
  );
  const sourceFreshnessHours =
    newestSourceTimestampSeconds > 0 ? Math.round((now / 1000 - newestSourceTimestampSeconds) / 3600) : null;

  try {
    const llmSummary = await requestOpenAIRedditSentiment(corpus);

    return {
      ok: true,
      score: Number(llmSummary.score),
      label: llmSummary.label,
      summary: llmSummary.summary,
      methodology: llmSummary.methodology,
      drivers: llmSummary.drivers,
      risks: llmSummary.risks,
      opportunities: llmSummary.opportunities,
      subreddits: corpus.subreddits.map((subreddit) => `r/${subreddit}`),
      asOf: now,
      sourceAsOf: newestSourceTimestampSeconds > 0 ? newestSourceTimestampSeconds * 1000 : now,
      source: "llm",
      model: llmSummary.model,
      postCount: selectedPosts.length,
      commentCount: selectedComments.length,
      freshestSourceAgeHours: sourceFreshnessHours,
      samplePosts: selectedPosts.slice(0, 4),
      sampleComments: selectedComments.slice(0, 3),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `OpenAI Reddit sentiment request failed: ${error.message}`
          : "OpenAI Reddit sentiment request failed.",
      sourceAsOf: newestSourceTimestampSeconds > 0 ? newestSourceTimestampSeconds * 1000 : now,
      postCount: selectedPosts.length,
      commentCount: selectedComments.length,
      freshestSourceAgeHours: sourceFreshnessHours,
    };
  }
}

export function redditSentimentStatus(score) {
  return heuristicStatus(score);
}
