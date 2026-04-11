import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshAllGroups } from "../lib/server/dashboard-cache-groups.mjs";

const __filename = fileURLToPath(import.meta.url);

export async function updateDashboardCache(options = {}) {
  const result = await refreshAllGroups({
    refreshRedditSentiment: true,
    ...options,
    force: true,
  });

  return result.compositePayload;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  updateDashboardCache({ persist: true })
    .then((payload) => {
      console.log(
        `Updated dashboard cache with ${payload.summary.liveMetricCount} live metrics at ${new Date(
          payload.meta.generatedAt,
        ).toISOString()}`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
