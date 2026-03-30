import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";
import { loadLocalEnv } from "./load-env.mjs";

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const publicDir = path.join(projectRoot, "public");
const publicGroupCacheDir = path.join(publicDir, "dashboard-cache-groups");
const publicCompositeFile = path.join(publicDir, "dashboard-cache.json");

const serverDataDir = path.join(projectRoot, ".dashboard-cache-data");
const fileGroupCacheDir = path.join(serverDataDir, "groups");
const fileHistoryDir = path.join(serverDataDir, "histories");
const fileSourceCacheDir = path.join(serverDataDir, "source-cache");
const fileCompositeFile = path.join(serverDataDir, "composite.json");
const fileWatermarksFile = path.join(serverDataDir, "watermarks.json");

const REDIS_COMPOSITE_KEY = "dashboard:composite";
const LEGACY_KV_URL_ENV = "KV_REST_API_URL";
const LEGACY_KV_TOKEN_ENV = "KV_REST_API_TOKEN";

let redisClient = null;

function normalizeRequestedStorageMode(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();

  if (normalized === "bootstrap") {
    return "bootstrap-readonly";
  }

  if (normalized === "redis" || normalized === "file" || normalized === "bootstrap-readonly") {
    return normalized;
  }

  return null;
}

function readRedisEnvConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env[LEGACY_KV_URL_ENV];
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env[LEGACY_KV_TOKEN_ENV];

  if (!url || !token) {
    return null;
  }

  return {
    url,
    token,
    usesLegacyAlias: !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

function isHostedRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function resolveStorageSelection() {
  const requestedMode = normalizeRequestedStorageMode(process.env.DASHBOARD_STORAGE_MODE);

  if (requestedMode) {
    if (requestedMode === "redis" && !readRedisEnvConfig()) {
      return {
        mode: "redis",
        writable: true,
        fallbackReason: "DASHBOARD_STORAGE_MODE=redis but Redis credentials are missing.",
        requestedMode,
      };
    }

    return {
      mode: requestedMode,
      writable: requestedMode !== "bootstrap-readonly",
      fallbackReason: requestedMode === "bootstrap-readonly" ? "Forced bootstrap mode." : null,
      requestedMode,
    };
  }

  if (readRedisEnvConfig()) {
    return {
      mode: "redis",
      writable: true,
      fallbackReason: null,
      requestedMode: null,
    };
  }

  if (!isHostedRuntime()) {
    return {
      mode: "file",
      writable: true,
      fallbackReason: null,
      requestedMode: null,
    };
  }

  return {
    mode: "bootstrap-readonly",
    writable: false,
    fallbackReason: "Hosted environment is missing Redis credentials; serving bundled bootstrap cache.",
    requestedMode: null,
  };
}

function createRedisClient() {
  const config = readRedisEnvConfig();

  if (!config) {
    throw new Error("Upstash Redis credentials are not configured.");
  }

  if (!redisClient) {
    redisClient = new Redis({
      url: config.url,
      token: config.token,
    });
  }

  return redisClient;
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function groupCacheFile(dir, groupId) {
  return path.join(dir, `${groupId}.json`);
}

function historyFile(metricId) {
  return path.join(fileHistoryDir, `${metricId}.json`);
}

function sourceCacheFile(cacheKey) {
  return path.join(fileSourceCacheDir, `${cacheKey}.json`);
}

function mergeHistoryPoint(points, point, maxPoints = 3650) {
  if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.value)) {
    return points ?? [];
  }

  const normalized = [...(points ?? [])];
  const existingIndex = normalized.findIndex((entry) => Number(entry?.timestamp) === Number(point.timestamp));

  if (existingIndex >= 0) {
    normalized[existingIndex] = point;
  } else {
    normalized.push(point);
  }

  normalized.sort((left, right) => left.timestamp - right.timestamp);
  return normalized.slice(-maxPoints);
}

function dedupeHistoryPoints(points, maxPoints = 3650) {
  return mergeHistoryPoint(
    (points ?? []).reduce((accumulator, point) => mergeHistoryPoint(accumulator, point, maxPoints), []),
    null,
    maxPoints,
  );
}

async function readAllLocalGroupSnapshots(groupIds, dir) {
  const snapshots = {};

  for (const groupId of groupIds) {
    const snapshot = await readJsonFile(groupCacheFile(dir, groupId));

    if (snapshot) {
      snapshots[groupId] = snapshot;
    }
  }

  return snapshots;
}

async function readLocalWatermarks() {
  return readJsonFile(fileWatermarksFile, {});
}

async function writeLocalWatermarks(value) {
  await writeJsonFile(fileWatermarksFile, value);
}

const fileProvider = {
  mode: "file",
  writable: true,
  async getComposite() {
    return (await readJsonFile(fileCompositeFile)) ?? readJsonFile(publicCompositeFile);
  },
  async setComposite(snapshot) {
    await writeJsonFile(fileCompositeFile, snapshot);
    await writeJsonFile(publicCompositeFile, snapshot);
  },
  async getGroup(groupId) {
    return (await readJsonFile(groupCacheFile(fileGroupCacheDir, groupId))) ?? readJsonFile(groupCacheFile(publicGroupCacheDir, groupId));
  },
  async setGroup(groupId, snapshot) {
    await writeJsonFile(groupCacheFile(fileGroupCacheDir, groupId), snapshot);
    await writeJsonFile(groupCacheFile(publicGroupCacheDir, groupId), snapshot);
  },
  async getAllGroups(groupIds) {
    const serverSnapshots = await readAllLocalGroupSnapshots(groupIds, fileGroupCacheDir);

    if (Object.keys(serverSnapshots).length > 0) {
      return serverSnapshots;
    }

    return readAllLocalGroupSnapshots(groupIds, publicGroupCacheDir);
  },
  async getHistory(metricId) {
    const payload = await readJsonFile(historyFile(metricId), { points: [] });
    return Array.isArray(payload?.points) ? payload.points : [];
  },
  async setHistory(metricId, points) {
    await writeJsonFile(historyFile(metricId), { points: dedupeHistoryPoints(points) });
  },
  async getSourceCache(cacheKey) {
    const payload = await readJsonFile(sourceCacheFile(cacheKey));

    if (!payload || Number(payload.expiresAt ?? 0) <= Date.now()) {
      return null;
    }

    return payload.value ?? null;
  },
  async setSourceCache(cacheKey, value, ttlMs) {
    await writeJsonFile(sourceCacheFile(cacheKey), {
      value,
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    });
  },
  async getWatermark(key) {
    const watermarks = await readLocalWatermarks();
    return watermarks[key] ?? null;
  },
  async setWatermark(key, value) {
    const watermarks = await readLocalWatermarks();
    watermarks[key] = value;
    await writeLocalWatermarks(watermarks);
  },
  async acquireLock() {
    return randomUUID();
  },
  async releaseLock() {
    return true;
  },
};

const redisProvider = {
  mode: "redis",
  writable: true,
  async getComposite() {
    return (await createRedisClient().get(REDIS_COMPOSITE_KEY)) ?? null;
  },
  async setComposite(snapshot) {
    await createRedisClient().set(REDIS_COMPOSITE_KEY, snapshot);
  },
  async getGroup(groupId) {
    return (await createRedisClient().get(`dashboard:group:${groupId}`)) ?? null;
  },
  async setGroup(groupId, snapshot) {
    await createRedisClient().set(`dashboard:group:${groupId}`, snapshot);
  },
  async getAllGroups(groupIds) {
    const entries = await Promise.all(
      groupIds.map(async (groupId) => [groupId, await createRedisClient().get(`dashboard:group:${groupId}`)]),
    );

    return Object.fromEntries(entries.filter(([, value]) => Boolean(value)));
  },
  async getHistory(metricId) {
    return (await createRedisClient().get(`dashboard:history:${metricId}`)) ?? [];
  },
  async setHistory(metricId, points) {
    await createRedisClient().set(`dashboard:history:${metricId}`, dedupeHistoryPoints(points));
  },
  async getSourceCache(cacheKey) {
    const payload = await createRedisClient().get(`dashboard:source-cache:${cacheKey}`);

    if (!payload || Number(payload.expiresAt ?? 0) <= Date.now()) {
      return null;
    }

    return payload.value ?? null;
  },
  async setSourceCache(cacheKey, value, ttlMs) {
    const payload = {
      value,
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    await createRedisClient().set(`dashboard:source-cache:${cacheKey}`, payload, {
      px: ttlMs,
    });
  },
  async getWatermark(key) {
    return (await createRedisClient().get(`dashboard:watermark:${key}`)) ?? null;
  },
  async setWatermark(key, value) {
    await createRedisClient().set(`dashboard:watermark:${key}`, value);
  },
  async acquireLock(key, ttlMs) {
    const token = randomUUID();
    const result = await createRedisClient().set(`dashboard:lock:${key}`, token, {
      nx: true,
      px: ttlMs,
    });

    return result === "OK" ? token : null;
  },
  async releaseLock(key, token) {
    const redis = createRedisClient();
    const currentToken = await redis.get(`dashboard:lock:${key}`);

    if (currentToken !== token) {
      return false;
    }

    await redis.del(`dashboard:lock:${key}`);
    return true;
  },
};

const bootstrapProvider = {
  mode: "bootstrap-readonly",
  writable: false,
  async getComposite() {
    return readJsonFile(publicCompositeFile);
  },
  async setComposite() {
    throw new Error("Bootstrap storage is read-only.");
  },
  async getGroup(groupId) {
    return readJsonFile(groupCacheFile(publicGroupCacheDir, groupId));
  },
  async setGroup() {
    throw new Error("Bootstrap storage is read-only.");
  },
  async getAllGroups(groupIds) {
    return readAllLocalGroupSnapshots(groupIds, publicGroupCacheDir);
  },
  async getHistory() {
    return [];
  },
  async setHistory() {
    throw new Error("Bootstrap storage is read-only.");
  },
  async getSourceCache() {
    return null;
  },
  async setSourceCache() {
    throw new Error("Bootstrap storage is read-only.");
  },
  async getWatermark() {
    return null;
  },
  async setWatermark() {
    throw new Error("Bootstrap storage is read-only.");
  },
  async acquireLock() {
    return null;
  },
  async releaseLock() {
    return false;
  },
};

function getStorageProvider() {
  const selection = resolveStorageSelection();

  if (selection.mode === "redis") {
    return redisProvider;
  }

  if (selection.mode === "file") {
    return fileProvider;
  }

  return bootstrapProvider;
}

export function getStorageMode() {
  return resolveStorageSelection().mode;
}

export function getStorageCapabilities() {
  const selection = resolveStorageSelection();
  const redisConfig = readRedisEnvConfig();

  return {
    mode: selection.mode,
    writable: selection.writable,
    fallbackReason: selection.fallbackReason,
    requestedMode: selection.requestedMode,
    isHosted: isHostedRuntime(),
    bootstrapAvailable: true,
    redisConfigured: Boolean(redisConfig),
    usesLegacyRedisAlias: Boolean(redisConfig?.usesLegacyAlias),
    serverDataDir,
  };
}

export async function readGroupSnapshot(groupId) {
  return getStorageProvider().getGroup(groupId);
}

export async function writeGroupSnapshot(groupId, snapshot) {
  await getStorageProvider().setGroup(groupId, snapshot);
}

export async function readAllGroupSnapshots(groupIds) {
  return getStorageProvider().getAllGroups(groupIds);
}

export async function readCompositeSnapshot() {
  return getStorageProvider().getComposite();
}

export async function writeCompositeSnapshot(snapshot) {
  await getStorageProvider().setComposite(snapshot);
}

export async function readHistory(metricId) {
  return getStorageProvider().getHistory(metricId);
}

export async function readHistories(metricIds) {
  const entries = await Promise.all(metricIds.map(async (metricId) => [metricId, await readHistory(metricId)]));
  return Object.fromEntries(entries);
}

export async function writeHistory(metricId, points) {
  await getStorageProvider().setHistory(metricId, points);
}

export async function appendHistory(metricId, point, maxPoints = 3650) {
  const current = await readHistory(metricId);
  const next = mergeHistoryPoint(current, point, maxPoints);
  await writeHistory(metricId, next);
  return next;
}

export async function readSourceCache(cacheKey) {
  return getStorageProvider().getSourceCache(cacheKey);
}

export async function writeSourceCache(cacheKey, value, ttlMs) {
  await getStorageProvider().setSourceCache(cacheKey, value, ttlMs);
}

export async function readWatermark(key) {
  return getStorageProvider().getWatermark(key);
}

export async function writeWatermark(key, value) {
  await getStorageProvider().setWatermark(key, value);
}

export async function acquireRefreshLock(lockKey, ttlMs = 90_000) {
  return getStorageProvider().acquireLock(lockKey, ttlMs);
}

export async function releaseRefreshLock(lockKey, token) {
  if (!token) {
    return false;
  }

  return getStorageProvider().releaseLock(lockKey, token);
}

export async function readBundledCompositeSnapshot() {
  return readJsonFile(publicCompositeFile);
}

export async function writeBundledCompositeSnapshot(snapshot) {
  await writeJsonFile(publicCompositeFile, snapshot);
}

export async function writeBundledGroupSnapshot(groupId, snapshot) {
  await writeJsonFile(groupCacheFile(publicGroupCacheDir, groupId), snapshot);
}

export async function clearLocalServerData() {
  await rm(serverDataDir, { recursive: true, force: true });
}
