import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateDashboardCache } from "../../scripts/update-dashboard-cache.mjs";
import {
  CACHE_GROUP_ORDER,
  CACHE_GROUPS,
  buildCompositePayloadFromGroupSnapshots,
  buildGroupSnapshotsFromPayload,
} from "./dashboard-cache-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const publicDir = path.join(projectRoot, "public");
const cacheFile = path.join(publicDir, "dashboard-cache.json");
const groupCacheDir = path.join(publicDir, "dashboard-cache-groups");

function groupCacheFile(groupId) {
  return path.join(groupCacheDir, `${groupId}.json`);
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function readCompositeDashboardCache() {
  return readJsonFile(cacheFile);
}

export async function readGroupSnapshots() {
  const snapshots = {};

  for (const groupId of CACHE_GROUP_ORDER) {
    const snapshot = await readJsonFile(groupCacheFile(groupId));

    if (snapshot) {
      snapshots[groupId] = snapshot;
    }
  }

  return snapshots;
}

function bootstrapSnapshotsFromComposite(compositePayload, existingSnapshots = {}) {
  if (!compositePayload) {
    return { ...existingSnapshots };
  }

  const bootstrapped = buildGroupSnapshotsFromPayload(compositePayload, {
    generatedAt: compositePayload.meta?.generatedAt,
    refreshedGroupIds: [],
    refreshSource: "bootstrap",
  });
  const snapshots = { ...existingSnapshots };

  for (const groupId of CACHE_GROUP_ORDER) {
    if (!snapshots[groupId] && bootstrapped[groupId]) {
      snapshots[groupId] = bootstrapped[groupId];
    }
  }

  return snapshots;
}

function shouldRefreshSnapshot(snapshot, now) {
  if (!snapshot?.generatedAt) {
    return true;
  }

  const config = CACHE_GROUPS[snapshot.groupId];

  if (config.ttlMs <= 0) {
    return false;
  }

  const expiresAt = snapshot.expiresAt ?? snapshot.generatedAt + config.ttlMs;
  return now >= expiresAt;
}

function normalizedRefreshSet(groupIds) {
  const refreshIds = new Set(groupIds);

  if (groupIds.some((groupId) => groupId !== "synthetic")) {
    refreshIds.add("synthetic");
  }

  return Array.from(refreshIds);
}

async function writeGroupSnapshots(groupSnapshots) {
  await mkdir(groupCacheDir, { recursive: true });

  for (const groupId of CACHE_GROUP_ORDER) {
    const snapshot = groupSnapshots[groupId];

    if (!snapshot) {
      continue;
    }

    await writeFile(groupCacheFile(groupId), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
}

async function writeCompositeDashboardCache(compositePayload) {
  await mkdir(publicDir, { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(compositePayload, null, 2)}\n`, "utf8");
}

export async function refreshGroup(groupId, options = {}) {
  const persist = options.persist === true;
  const fullPayload = await updateDashboardCache({ persist });
  const groupSnapshots = buildGroupSnapshotsFromPayload(fullPayload, {
    generatedAt: fullPayload.meta?.generatedAt,
    refreshedGroupIds: normalizedRefreshSet([groupId]),
    refreshSource: "refreshed",
  });
  const compositePayload = buildCompositePayloadFromGroupSnapshots(groupSnapshots, fullPayload, {
    scheduler: "TTL-managed grouped cache with request-driven refresh",
  });

  if (persist) {
    await writeGroupSnapshots(groupSnapshots);
    await writeCompositeDashboardCache(compositePayload);
  }

  return {
    snapshot: groupSnapshots[groupId],
    compositePayload,
    groupSnapshots,
  };
}

export async function refreshAllGroups(options = {}) {
  const persist = options.persist === true;
  const fullPayload = await updateDashboardCache({ persist });
  const groupSnapshots = buildGroupSnapshotsFromPayload(fullPayload, {
    generatedAt: fullPayload.meta?.generatedAt,
    refreshedGroupIds: CACHE_GROUP_ORDER,
    refreshSource: "refreshed",
  });
  const compositePayload = buildCompositePayloadFromGroupSnapshots(groupSnapshots, fullPayload, {
    scheduler: "TTL-managed grouped cache with request-driven refresh",
  });

  if (persist) {
    await writeGroupSnapshots(groupSnapshots);
    await writeCompositeDashboardCache(compositePayload);
  }

  return {
    compositePayload,
    groupSnapshots,
  };
}

export async function ensureDashboardCache(options = {}) {
  const now = options.now ?? Date.now();
  const persist = options.persist === true;
  const compositePayload = await readCompositeDashboardCache();
  const cachedSnapshots = bootstrapSnapshotsFromComposite(compositePayload, await readGroupSnapshots());
  const refreshTargets = CACHE_GROUP_ORDER.filter((groupId) => shouldRefreshSnapshot(cachedSnapshots[groupId], now));

  if (refreshTargets.length === 0) {
    return buildCompositePayloadFromGroupSnapshots(cachedSnapshots, compositePayload, {
      now,
      scheduler: "TTL-managed grouped cache with request-driven refresh",
    });
  }

  try {
    const fullPayload = await updateDashboardCache({ persist: false });
    const freshSnapshots = buildGroupSnapshotsFromPayload(fullPayload, {
      generatedAt: fullPayload.meta?.generatedAt,
      refreshedGroupIds: normalizedRefreshSet(refreshTargets),
      refreshSource: "refreshed",
    });
    const mergedSnapshots = { ...cachedSnapshots };
    const baseComposite = compositePayload ?? {};

    for (const groupId of normalizedRefreshSet(refreshTargets)) {
      if (freshSnapshots[groupId]) {
        mergedSnapshots[groupId] = freshSnapshots[groupId];
      }
    }

    const nextComposite = buildCompositePayloadFromGroupSnapshots(mergedSnapshots, {
      ...baseComposite,
      summary: {
        ...(compositePayload?.summary ?? {}),
        btcPrice: fullPayload.summary?.btcPrice ?? compositePayload?.summary?.btcPrice,
        btcPriceChange: fullPayload.summary?.btcPriceChange ?? compositePayload?.summary?.btcPriceChange,
      },
    }, {
      now,
      scheduler: "TTL-managed grouped cache with request-driven refresh",
    });

    if (persist) {
      await writeGroupSnapshots(mergedSnapshots);
      await writeCompositeDashboardCache(nextComposite);
    }

    return nextComposite;
  } catch (error) {
    if (Object.keys(cachedSnapshots).length === 0) {
      throw error;
    }

    return buildCompositePayloadFromGroupSnapshots(cachedSnapshots, compositePayload, {
      now,
      scheduler: "TTL-managed grouped cache with request-driven refresh",
      extraWarnings: [
        error instanceof Error
          ? `Grouped refresh failed; serving cached groups instead: ${error.message}`
          : "Grouped refresh failed; serving cached groups instead.",
      ],
    });
  }
}
