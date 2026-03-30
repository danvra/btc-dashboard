import { ensureDashboardCache } from "../lib/server/dashboard-cache-groups.mjs";
import { CACHE_GROUPS } from "../lib/server/dashboard-cache-shared.mjs";

function parseTtlHours(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24;
  }

  return Math.max(1, Math.round(parsed));
}

function isForceRefreshRequest(req) {
  if (req.query?.refresh === "force") {
    return true;
  }

  try {
    const url = new URL(req.url ?? "", "http://localhost");
    return url.searchParams.get("refresh") === "force";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ttlHours = parseTtlHours(process.env.DASHBOARD_CACHE_TTL_HOURS);
  const fallbackTtlSeconds = ttlHours * 60 * 60;
  const fastTtlSeconds = Math.max(60, Math.round(CACHE_GROUPS.fast.ttlMs / 1000));
  const ttlSeconds = Math.min(fallbackTtlSeconds, fastTtlSeconds);
  const staleWhileRevalidateSeconds = Math.max(60, Math.round(ttlSeconds / 2));
  const forceRefresh = isForceRefreshRequest(req);

  try {
    const result = await ensureDashboardCache(forceRefresh ? { force: true } : {});
    const payload = result.compositePayload;
    const cacheHeader = `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", cacheHeader);
    res.setHeader("CDN-Cache-Control", cacheHeader);
    res.setHeader("Vercel-CDN-Cache-Control", cacheHeader);
    res.setHeader("X-Dashboard-Cache-Ttl-Hours", String(ttlHours));
    res.setHeader("X-Dashboard-Fast-Ttl-Seconds", String(fastTtlSeconds));
    res.setHeader("X-Dashboard-Storage-Mode", result.storageMode);
    res.status(200).send(JSON.stringify(payload));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to build dashboard cache.",
    });
  }
}
