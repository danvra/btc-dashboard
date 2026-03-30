import { startTransition, useEffect, useState } from "react";
import {
  buildFallbackSnapshot,
  mergeCachePayload,
  type DashboardCachePayload,
  type DashboardDataSnapshot,
} from "../lib/dashboard-data";

type RefreshNotice = {
  completedAt: number;
  kind: "success" | "fallback" | "error";
  message: string;
};

const FRONTEND_REFRESH_MAX_AGE_MS = {
  fast: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  slow: 24 * 60 * 60 * 1000,
  synthetic: 24 * 60 * 60 * 1000,
} as const;

export function useDashboardData() {
  const [snapshot, setSnapshot] = useState<DashboardDataSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);

  async function fetchCachePayload(endpoint: string, timeoutMs?: number) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId =
      controller && timeoutMs
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
      const response = await fetch(endpoint, {
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw new Error(`Cache request failed: ${response.status} for ${endpoint}`);
      }

      return (await response.json()) as DashboardCachePayload;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async function loadStaticCache() {
    const payload = await fetchCachePayload(`/dashboard-cache.json?ts=${Date.now()}`);
    return mergeCachePayload(payload);
  }

  async function loadApiCache(timeoutMs = 12_000, options?: { force?: boolean }) {
    const refreshMode = options?.force ? "&refresh=force" : "";
    const payload = await fetchCachePayload(`/api/dashboard-cache?ts=${Date.now()}${refreshMode}`, timeoutMs);
    return mergeCachePayload(payload);
  }

  function shouldRequestApiRefresh(currentSnapshot: DashboardDataSnapshot) {
    const groups = currentSnapshot.meta?.groups;

    if (!groups) {
      return true;
    }

    const now = Date.now();

    return Object.entries(groups).some(([groupId, group]) => {
      if (!group?.generatedAt) {
        return true;
      }

      const maxAgeMs =
        FRONTEND_REFRESH_MAX_AGE_MS[groupId as keyof typeof FRONTEND_REFRESH_MAX_AGE_MS] ??
        FRONTEND_REFRESH_MAX_AGE_MS.daily;

      return now - group.generatedAt >= maxAgeMs;
    });
  }

  function shouldPromoteSnapshot(nextSnapshot: DashboardDataSnapshot, currentSnapshot: DashboardDataSnapshot | null) {
    const nextUpdatedAt = snapshotUpdatedAt(nextSnapshot);
    const currentUpdatedAt = snapshotUpdatedAt(currentSnapshot);

    return nextUpdatedAt > currentUpdatedAt;
  }

  function snapshotUpdatedAt(currentSnapshot: DashboardDataSnapshot | null) {
    return currentSnapshot?.meta?.generatedAt ?? currentSnapshot?.summary.lastUpdatedAt ?? 0;
  }

  async function load(mode: "initial" | "refresh") {
    const currentSnapshot = snapshot;

    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      if (mode === "initial") {
        try {
          const staticSnapshot = await loadStaticCache();

          startTransition(() => {
            setSnapshot(staticSnapshot);
            setError(null);
          });
          setIsLoading(false);

          if (shouldRequestApiRefresh(staticSnapshot)) {
            void (async () => {
              try {
                const apiSnapshot = await loadApiCache();

                if (shouldPromoteSnapshot(apiSnapshot, staticSnapshot)) {
                  startTransition(() => {
                    setSnapshot(apiSnapshot);
                  });
                }
              } catch {
                // Keep the fast static cache on screen if the API route is slow or unavailable.
              }
            })();
          }

          return;
        } catch {
          // Fall through to slower recovery paths when the static cache is unavailable.
        }
      }

      let nextSnapshot: DashboardDataSnapshot;
      let refreshSource: "api" | "static" = "api";

      try {
        nextSnapshot = await loadApiCache(mode === "refresh" ? 10_000 : 20_000, {
          force: mode === "refresh",
        });
      } catch {
        try {
          nextSnapshot = await loadStaticCache();
          refreshSource = "static";
        } catch {
          throw new Error("Dashboard cache is unavailable.");
        }
      }

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setError(null);
      });

      if (mode === "refresh") {
        const completedAt = Date.now();
        const message =
          refreshSource === "api"
            ? "Refresh complete."
            : "Live refresh unavailable. Showing cached data.";

        setRefreshNotice({
          completedAt,
          kind: refreshSource === "static" ? "fallback" : "success",
          message,
        });
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load dashboard data.";

      if (mode === "refresh" && currentSnapshot) {
        setError(null);
        setRefreshNotice({
          completedAt: Date.now(),
          kind: "fallback",
          message: "Live refresh unavailable. Keeping current cached data.",
        });
      } else {
        startTransition(() => {
          setSnapshot(buildFallbackSnapshot());
        });
        setError(message);

        if (mode === "refresh") {
          setRefreshNotice({
            completedAt: Date.now(),
            kind: "error",
            message: "Refresh failed.",
          });
        }
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void load("initial");
  }, []);

  return {
    snapshot,
    isLoading,
    isRefreshing,
    error,
    refreshNotice,
    refresh: () => load("refresh"),
  };
}
