import { updateDashboardCache } from "../scripts/update-dashboard-cache.mjs";

function parseTtlHours(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24;
  }

  return Math.max(1, Math.round(parsed));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ttlHours = parseTtlHours(process.env.DASHBOARD_CACHE_TTL_HOURS);
  const ttlSeconds = ttlHours * 60 * 60;
  const staleWhileRevalidateSeconds = Math.max(300, Math.round(ttlSeconds / 4));

  try {
    const payload = await updateDashboardCache({ persist: false });
    const cacheHeader = `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", cacheHeader);
    res.setHeader("CDN-Cache-Control", cacheHeader);
    res.setHeader("Vercel-CDN-Cache-Control", cacheHeader);
    res.setHeader("X-Dashboard-Cache-Ttl-Hours", String(ttlHours));
    res.status(200).send(JSON.stringify(payload));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to build dashboard cache.",
    });
  }
}
