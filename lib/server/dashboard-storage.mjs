import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const publicDir = path.join(projectRoot, "public");
const groupCacheDir = path.join(publicDir, "dashboard-cache-groups");
const cacheFile = path.join(publicDir, "dashboard-cache.json");
const historyFile = path.join(publicDir, "dashboard-history.json");

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

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

async function redisCommand(args) {
  const config = redisConfig();

  if (!config) {
    throw new Error("Upstash Redis is not configured.");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    throw new Error(`Upstash request failed: ${response.status}`);
  }

  const payload = await response.json();

  if (payload?.error) {
    throw new Error(payload.error);
  }

  return payload?.result ?? null;
}

async function readRedisJson(key) {
  const result = await redisCommand(["GET", key]);
  return typeof result === "string" ? parseJsonOrNull(result) : result;
}

async function writeRedisJson(key, value) {
  await redisCommand(["SET", key, JSON.stringify(value)]);
}

async function readAllLocalGroupSnapshots(groupIds) {
  const snapshots = {};

  for (const groupId of groupIds) {
    const snapshot = await readJsonFile(path.join(groupCacheDir, `${groupId}.json`));

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

export function getStorageMode() {
  return redisConfig() ? "redis" : "file";
}

export async function readGroupSnapshot(groupId) {
  if (getStorageMode() === "redis") {
    return readRedisJson(`dashboard:group:${groupId}`);
  }

  return readJsonFile(path.join(groupCacheDir, `${groupId}.json`));
}

export async function writeGroupSnapshot(groupId, snapshot) {
  if (getStorageMode() === "redis") {
    await writeRedisJson(`dashboard:group:${groupId}`, snapshot);
    return;
  }

  await writeJsonFile(path.join(groupCacheDir, `${groupId}.json`), snapshot);
}

export async function readAllGroupSnapshots(groupIds) {
  if (getStorageMode() === "redis") {
    const entries = await Promise.all(
      groupIds.map(async (groupId) => [groupId, await readRedisJson(`dashboard:group:${groupId}`)]),
    );

    return Object.fromEntries(entries.filter(([, value]) => Boolean(value)));
  }

  return readAllLocalGroupSnapshots(groupIds);
}

export async function readCompositeSnapshot() {
  if (getStorageMode() === "redis") {
    return readRedisJson("dashboard:composite");
  }

  return readJsonFile(cacheFile);
}

export async function writeCompositeSnapshot(snapshot) {
  if (getStorageMode() === "redis") {
    await writeRedisJson("dashboard:composite", snapshot);
    return;
  }

  await writeJsonFile(cacheFile, snapshot);
}

export async function readHistory(metricId) {
  if (getStorageMode() === "redis") {
    return (await readRedisJson(`dashboard:history:${metricId}`)) ?? [];
  }

  const historyMap = await readLocalHistoryMap();
  return historyMap[metricId] ?? [];
}

export async function appendHistory(metricId, point, maxPoints = 180) {
  if (getStorageMode() === "redis") {
    const current = (await readRedisJson(`dashboard:history:${metricId}`)) ?? [];
    const next = mergeHistoryPoint(current, point, maxPoints);
    await writeRedisJson(`dashboard:history:${metricId}`, next);
    return next;
  }

  const historyMap = await readLocalHistoryMap();
  const next = mergeHistoryPoint(historyMap[metricId] ?? [], point, maxPoints);
  historyMap[metricId] = next;
  await writeLocalHistoryMap(historyMap);
  return next;
}

export async function readBundledCompositeSnapshot() {
  return readJsonFile(cacheFile);
}
