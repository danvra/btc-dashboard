import {
  CACHE_GROUP_ORDER,
  CACHE_GROUPS,
  DASHBOARD_CACHE_SCHEDULER,
  buildCompositePayloadFromGroupSnapshots,
  buildGroupSnapshotsFromPayload,
} from "./dashboard-cache-shared.mjs";
import {
  refreshDailyGroup,
  refreshFastGroup,
  refreshSlowGroup,
  refreshSyntheticGroup,
  snapshotForResponse,
} from "./dashboard-group-refreshers.mjs";
import {
  acquireRefreshLock,
  getStorageCapabilities,
  getStorageMode,
  readAllGroupSnapshots,
  readBundledCompositeSnapshot,
  readCompositeSnapshot,
  releaseRefreshLock,
  writeCompositeSnapshot,
  writeGroupSnapshot,
} from "./dashboard-storage.mjs";

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
      snapshots[groupId] = {
        ...bootstrapped[groupId],
        refreshedDuringRequest: false,
        refreshSource: "cache",
      };
    }
  }

  return snapshots;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    refreshedDuringRequest: false,
    refreshSource: "cache",
  };
}

function shouldRefreshSnapshot(snapshot, now, force = false) {
  if (force) {
    return true;
  }

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

function snapshotCount(groupSnapshots) {
  return Object.values(groupSnapshots ?? {}).filter(Boolean).length;
}

function warningMessage(groupId, error) {
  const label = CACHE_GROUPS[groupId]?.label ?? groupId;
  const message = error instanceof Error ? error.message : "Unknown refresh failure.";
  return `${label} group refresh failed; serving cached group instead: ${message}`;
}

async function loadCachedState(persist) {
  const storage = getStorageCapabilities();
  const storedComposite = await readCompositeSnapshot();
  const bundledComposite = await readBundledCompositeSnapshot();
  const baseComposite = storedComposite ?? bundledComposite ?? { meta: {}, summary: {}, metrics: {} };
  const rawSnapshots = await readAllGroupSnapshots(CACHE_GROUP_ORDER);
  const storedSnapshots = bootstrapSnapshotsFromComposite(baseComposite, rawSnapshots);
  const bootstrapUsed = !storedComposite && Boolean(bundledComposite);

  if (persist && storage.writable) {
    const writes = [];

    if (!storedComposite && bundledComposite) {
      writes.push(writeCompositeSnapshot(baseComposite));
    }

    for (const groupId of CACHE_GROUP_ORDER) {
      if (!storedSnapshots[groupId] || rawSnapshots[groupId]) {
        continue;
      }

      writes.push(writeGroupSnapshot(groupId, normalizeSnapshot(storedSnapshots[groupId])));
    }

    if (writes.length > 0) {
      await Promise.all(writes);
    }
  }

  return {
    baseComposite,
    bootstrapUsed,
    storage,
    groupSnapshots: Object.fromEntries(
      Object.entries(storedSnapshots).map(([groupId, snapshot]) => [groupId, normalizeSnapshot(snapshot)]),
    ),
  };
}

async function refreshUpstreamGroup(groupId, options = {}) {
  const refreshOptions = {
    ...options,
    previousSnapshot: options.groupSnapshots?.[groupId] ?? null,
  };

  switch (groupId) {
    case "fast":
      return refreshFastGroup(refreshOptions);
    case "daily":
      return refreshDailyGroup(refreshOptions);
    case "slow":
      return refreshSlowGroup(refreshOptions);
    default:
      throw new Error(`Unsupported upstream group: ${groupId}`);
  }
}

function cloneGroupSnapshots(groupSnapshots) {
  return Object.fromEntries(
    Object.entries(groupSnapshots ?? {})
      .filter(([, snapshot]) => Boolean(snapshot))
      .map(([groupId, snapshot]) => [groupId, normalizeSnapshot(snapshot)]),
  );
}

async function rebuildComposite(groupSnapshots, baseComposite, options = {}) {
  const persistedComposite = buildCompositePayloadFromGroupSnapshots(groupSnapshots, baseComposite, {
    now: options.now,
    scheduler: DASHBOARD_CACHE_SCHEDULER,
  });

  const diagnostics = {
    storageMode: options.storage?.mode ?? getStorageMode(),
    storageWritable: Boolean(options.storage?.writable),
    bootstrapUsed: Boolean(options.bootstrapUsed),
    fallbackReason: options.storage?.fallbackReason ?? null,
  };

  persistedComposite.meta = {
    ...(persistedComposite.meta ?? {}),
    ...diagnostics,
  };

  if (options.persist !== false && options.storage?.writable !== false) {
    await writeCompositeSnapshot(persistedComposite);
  }

  const responseSnapshots = Object.fromEntries(
    Object.entries(groupSnapshots).map(([groupId, snapshot]) => [
      groupId,
      snapshotForResponse(snapshot, options.refreshedGroupIds?.has(groupId)),
    ]),
  );

  const responseComposite = buildCompositePayloadFromGroupSnapshots(responseSnapshots, persistedComposite, {
      now: options.now,
      scheduler: DASHBOARD_CACHE_SCHEDULER,
      extraWarnings: options.extraWarnings,
    });
  responseComposite.meta = {
    ...(responseComposite.meta ?? {}),
    ...diagnostics,
  };

  return {
    persistedComposite,
    responseComposite,
    responseSnapshots,
  };
}

async function refreshSelectedGroups(targetGroupIds, options = {}) {
  const now = options.now ?? Date.now();
  const requestedPersist = options.persist !== false;
  const { baseComposite, bootstrapUsed, storage, groupSnapshots: initialSnapshots } = await loadCachedState(requestedPersist);
  const persist = requestedPersist && storage.writable;
  const groupSnapshots = cloneGroupSnapshots(initialSnapshots);
  const refreshedGroupIds = new Set();
  const extraWarnings = [];
  const upstreamTargets = targetGroupIds.filter((groupId) => groupId !== "synthetic");

  if (storage.fallbackReason) {
    extraWarnings.push(storage.fallbackReason);
  }

  if (!storage.writable && storage.mode === "bootstrap-readonly") {
    const rebuilt = await rebuildComposite(groupSnapshots, baseComposite, {
      now,
      persist: false,
      refreshedGroupIds,
      extraWarnings,
      storage,
      bootstrapUsed: true,
    });

    return {
      compositePayload: rebuilt.responseComposite,
      groupSnapshots: rebuilt.responseSnapshots,
      refreshedGroupIds: [],
      storageMode: storage.mode,
      storageWritable: false,
      bootstrapUsed: true,
      fallbackReason: storage.fallbackReason,
    };
  }

  for (const groupId of upstreamTargets) {
    const force = options.force === true || options.forceGroupIds?.includes(groupId);

    if (!shouldRefreshSnapshot(groupSnapshots[groupId], now, force)) {
      continue;
    }

    try {
      const lockToken = await acquireRefreshLock(`group:${groupId}`, 90_000);

      if (!lockToken) {
        extraWarnings.push(`${CACHE_GROUPS[groupId]?.label ?? groupId} refresh is already in progress; serving cached data.`);
        continue;
      }

      try {
        const nextSnapshot = await refreshUpstreamGroup(groupId, {
          now,
          persist,
          groupSnapshots,
          baseComposite,
        });

        groupSnapshots[groupId] = normalizeSnapshot(nextSnapshot);
        refreshedGroupIds.add(groupId);

        if (persist) {
          await writeGroupSnapshot(groupId, groupSnapshots[groupId]);
        }
      } finally {
        await releaseRefreshLock(`group:${groupId}`, lockToken);
      }
    } catch (error) {
      extraWarnings.push(warningMessage(groupId, error));
    }
  }

  const syntheticRequested = targetGroupIds.includes("synthetic");
  const syntheticForce = options.force === true || options.forceGroupIds?.includes("synthetic");
  const syntheticMissing = !groupSnapshots.synthetic;
  const shouldRefreshSynthetic =
    refreshedGroupIds.size > 0 ||
    (syntheticRequested && shouldRefreshSnapshot(groupSnapshots.synthetic, now, syntheticForce)) ||
    syntheticMissing;

  if (shouldRefreshSynthetic && snapshotCount(groupSnapshots) > 0) {
    try {
      const syntheticSnapshot = await refreshSyntheticGroup({
        now,
        persist,
        previousSnapshot: groupSnapshots.synthetic ?? null,
        groupSnapshots,
        baseComposite,
      });

      groupSnapshots.synthetic = normalizeSnapshot(syntheticSnapshot);
      refreshedGroupIds.add("synthetic");

      if (persist) {
        await writeGroupSnapshot("synthetic", groupSnapshots.synthetic);
      }
    } catch (error) {
      extraWarnings.push(warningMessage("synthetic", error));
    }
  }

  if (snapshotCount(groupSnapshots) === 0) {
    throw new Error("No dashboard group snapshots are available.");
  }

  const rebuilt = await rebuildComposite(groupSnapshots, baseComposite, {
    now,
    persist,
    refreshedGroupIds,
    extraWarnings,
    storage,
    bootstrapUsed,
  });

  return {
    compositePayload: rebuilt.responseComposite,
    groupSnapshots: rebuilt.responseSnapshots,
    refreshedGroupIds: Array.from(refreshedGroupIds),
    storageMode: storage.mode,
    storageWritable: storage.writable,
    bootstrapUsed,
    fallbackReason: storage.fallbackReason,
  };
}

export async function readCompositeDashboardCache() {
  const compositePayload = await readCompositeSnapshot();

  if (compositePayload) {
    return compositePayload;
  }

  return readBundledCompositeSnapshot();
}

export async function readGroupSnapshots() {
  const { groupSnapshots } = await loadCachedState(false);
  return groupSnapshots;
}

export async function refreshGroup(groupId, options = {}) {
  const targetGroupIds = groupId === "synthetic" ? ["synthetic"] : [groupId, "synthetic"];
  return refreshSelectedGroups(targetGroupIds, {
    ...options,
    force: true,
  });
}

export async function refreshAllGroups(options = {}) {
  return refreshSelectedGroups(["fast", "daily", "slow", "synthetic"], {
    refreshRedditSentiment: options.refreshRedditSentiment ?? false,
    ...options,
    force: true,
  });
}

export async function ensureDashboardCache(options = {}) {
  return refreshSelectedGroups(["fast", "daily", "slow", "synthetic"], {
    refreshRedditSentiment: false,
    ...options,
  });
}

export async function warmDashboardCache(options = {}) {
  return refreshSelectedGroups(["fast", "daily", "slow", "synthetic"], {
    refreshRedditSentiment: true,
    ...options,
  });
}
