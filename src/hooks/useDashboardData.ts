import { startTransition, useEffect, useState } from "react";
import {
  buildFallbackSnapshot,
  fetchDashboardData,
  mergeCachePayload,
  type DashboardCachePayload,
  type DashboardDataSnapshot,
} from "../lib/dashboard-data";

export function useDashboardData() {
  const [snapshot, setSnapshot] = useState<DashboardDataSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function loadApiCache(timeoutMs = 12_000) {
    const payload = await fetchCachePayload("/api/dashboard-cache", timeoutMs);
    return mergeCachePayload(payload);
  }

  function shouldPromoteSnapshot(nextSnapshot: DashboardDataSnapshot, currentSnapshot: DashboardDataSnapshot | null) {
    const nextUpdatedAt = nextSnapshot.summary.lastUpdatedAt ?? 0;
    const currentUpdatedAt = currentSnapshot?.summary.lastUpdatedAt ?? 0;

    return nextUpdatedAt > currentUpdatedAt;
  }

  async function load(mode: "initial" | "refresh") {
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

          return;
        } catch {
          // Fall through to slower recovery paths when the static cache is unavailable.
        }
      }

      let nextSnapshot: DashboardDataSnapshot;

      try {
        nextSnapshot = await loadApiCache(mode === "refresh" ? 10_000 : 20_000);
      } catch {
        try {
          nextSnapshot = await loadStaticCache();
        } catch {
          nextSnapshot = await fetchDashboardData();
        }
      }

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setError(null);
      });
    } catch (loadError) {
      startTransition(() => {
        setSnapshot(buildFallbackSnapshot());
      });
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard data.");
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
    refresh: () => load("refresh"),
  };
}
