import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshAllGroups } from "../lib/server/dashboard-cache-groups.mjs";
import { writeBundledCompositeSnapshot, writeBundledGroupSnapshot } from "../lib/server/dashboard-storage.mjs";

const __filename = fileURLToPath(import.meta.url);

function normalizeBootstrapGroupSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    refreshedDuringRequest: false,
    refreshSource: "bootstrap",
  };
}

function normalizeBootstrapPayload(payload) {
  return {
    ...payload,
    meta: {
      ...(payload.meta ?? {}),
      groups: Object.fromEntries(
        Object.entries(payload.meta?.groups ?? {}).map(([groupId, groupMeta]) => [
          groupId,
          {
            ...groupMeta,
            refreshedDuringRequest: false,
            refreshSource: "bootstrap",
          },
        ]),
      ),
    },
  };
}

export async function updateDashboardCache(options = {}) {
  const result = await refreshAllGroups({
    ...options,
    force: true,
  });
  const bootstrapPayload = normalizeBootstrapPayload(result.compositePayload);

  if (options.persist !== false) {
    await Promise.all([
      writeBundledCompositeSnapshot(bootstrapPayload),
      ...Object.entries(result.groupSnapshots ?? {}).map(([groupId, snapshot]) =>
        writeBundledGroupSnapshot(groupId, normalizeBootstrapGroupSnapshot(snapshot)),
      ),
    ]);
  }

  return bootstrapPayload;
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
