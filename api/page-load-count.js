import { getStorageMode, recordPageLoad } from "../lib/server/dashboard-storage.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const pageLoadCount = await recordPageLoad();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("X-Dashboard-Storage-Mode", getStorageMode());
    res.status(200).send(JSON.stringify({ pageLoadCount }));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to record page load.",
    });
  }
}
