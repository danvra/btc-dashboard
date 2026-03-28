import { warmDashboardCache } from "../lib/server/dashboard-cache-groups.mjs";

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await warmDashboardCache();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      ok: true,
      storageMode: result.storageMode,
      refreshedGroupIds: result.refreshedGroupIds,
      generatedAt: result.compositePayload.meta?.generatedAt ?? null,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to warm dashboard cache.",
    });
  }
}
