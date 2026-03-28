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

  async function loadFromCache() {
    const response = await fetch(`/dashboard-cache.json?ts=${Date.now()}`);

    if (!response.ok) {
      throw new Error(`Cache request failed: ${response.status}`);
    }

    const payload = (await response.json()) as DashboardCachePayload;
    return mergeCachePayload(payload);
  }

  async function load(mode: "initial" | "refresh") {
    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      let nextSnapshot: DashboardDataSnapshot;

      try {
        nextSnapshot = await loadFromCache();
      } catch {
        nextSnapshot = await fetchDashboardData();
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
