import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const publicDir = path.join(projectRoot, "public");
const groupCacheDir = path.join(publicDir, "dashboard-cache-groups");
const cacheFile = path.join(publicDir, "dashboard-cache.json");
const historyFile = path.join(publicDir, "dashboard-history.json");

const REDIS_COMPOSITE_KEY = "dashboard:composite";
const REDIS_HISTORY_KEY = "dashboard:history";
const LEGACY_KV_URL_ENV = "KV_REST_API_URL";
const LEGACY_KV_TOKEN_ENV = "KV_REST_API_TOKEN";

let redisClient = null;

function parseJsonOrNull(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function groupCacheFile(groupId) {
  return path.join(groupCacheDir, `${groupId}.json`);
}

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

async function readAllLocalGroupSnapshots(groupIds) {
  const snapshots = {};

  for (const groupId of groupIds) {
    const snapshot = await readJsonFile(groupCacheFile(groupId));

    if (snapshot) {
      snapshots[groupId] = snapshot;
    }
  }

  return snapshots;
}

async function readLocalHistoryMap() {
  const history = await readJsonFile(historyFile, { metrics: {} });
  return history?.metrics ?? {};
}

async function writeLocalHistoryMap(historyMap) {
  await writeJsonFile(historyFile, {
    metrics: historyMap,
  });
}

async function readRedisJson(key) {
  return (await createRedisClient().get(key)) ?? null;
}

async function writeRedisJson(key, value) {
  await createRedisClient().set(key, value);
}

async function readRedisHistoryMap() {
  return (await readRedisJson(REDIS_HISTORY_KEY)) ?? {};
}

async function writeRedisHistoryMap(historyMap) {
  await writeRedisJson(REDIS_HISTORY_KEY, historyMap);
}

function mergeHistoryPoint(points, point, maxPoints = 180) {
  if (!Number.isFinite(point?.timestamp) || !Number.isFinite(point?.value)) {
    return points ?? [];
  }

  const nextPoints = [...(points ?? [])];
  const last = nextPoints.at(-1);

  if (last && Math.abs(last.timestamp - point.timestamp) < 30 * 60 * 1000) {
    nextPoints[nextPoints.length - 1] = point;
  } else {
    nextPoints.push(point);
  }

  return nextPoints.slice(-maxPoints);
}

const storageProviders = {
  redis: {
    mode: "redis",
    writable: true,
    async getComposite() {
      return readRedisJson(REDIS_COMPOSITE_KEY);
    },
    async setComposite(snapshot) {
      await writeRedisJson(REDIS_COMPOSITE_KEY, snapshot);
    },
    async getGroup(groupId) {
      return readRedisJson(`dashboard:group:${groupId}`);
    },
    async setGroup(groupId, snapshot) {
      await writeRedisJson(`dashboard:group:${groupId}`, snapshot);
    },
    async getAllGroups(groupIds) {
      const entries = await Promise.all(
        groupIds.map(async (groupId) => [groupId, await readRedisJson(`dashboard:group:${groupId}`)]),
      );

      return Object.fromEntries(entries.filter(([, value]) => Boolean(value)));
    },
    async getHistory() {
      return readRedisHistoryMap();
    },
    async setHistory(historyMap) {
      await writeRedisHistoryMap(historyMap);
    },
  },
  file: {
    mode: "file",
    writable: true,
    async getComposite() {
      return readJsonFile(cacheFile);
    },
    async setComposite(snapshot) {
      await writeJsonFile(cacheFile, snapshot);
    },
    async getGroup(groupId) {
      return readJsonFile(groupCacheFile(groupId));
    },
    async setGroup(groupId, snapshot) {
      await writeJsonFile(groupCacheFile(groupId), snapshot);
    },
    async getAllGroups(groupIds) {
      return readAllLocalGroupSnapshots(groupIds);
    },
    async getHistory() {
      return readLocalHistoryMap();
    },
    async setHistory(historyMap) {
      await writeLocalHistoryMap(historyMap);
    },
  },
  "bootstrap-readonly": {
    mode: "bootstrap-readonly",
    writable: false,
    async getComposite() {
      return readJsonFile(cacheFile);
    },
    async setComposite() {
      throw new Error("Bootstrap storage is read-only.");
    },
    async getGroup(groupId) {
      return readJsonFile(groupCacheFile(groupId));
    },
    async setGroup() {
      throw new Error("Bootstrap storage is read-only.");
    },
    async getAllGroups(groupIds) {
      return readAllLocalGroupSnapshots(groupIds);
    },
    async getHistory() {
      return readLocalHistoryMap();
    },
    async setHistory() {
      throw new Error("Bootstrap storage is read-only.");
    },
  },
};

function getStorageProvider() {
  const selection = resolveStorageSelection();
  return storageProviders[selection.mode];
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
  const historyMap = await getStorageProvider().getHistory();
  return historyMap[metricId] ?? [];
}

export async function appendHistory(metricId, point, maxPoints = 180) {
  const provider = getStorageProvider();
  const historyMap = await provider.getHistory();
  const next = mergeHistoryPoint(historyMap[metricId] ?? [], point, maxPoints);
  historyMap[metricId] = next;
  await provider.setHistory(historyMap);
  return next;
}

export async function readBundledCompositeSnapshot() {
  return readJsonFile(cacheFile);
}

export async function readBundledHistory() {
  return readLocalHistoryMap();
}

export function parseStoredJson(value) {
  return parseJsonOrNull(value);
}
