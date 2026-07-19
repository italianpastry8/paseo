/**
 * Host quota hook — owns the live subscription to `host.quota.changed` and
 * exposes the latest snapshot plus a manual refresh action.
 *
 * The hook is single-purpose:
 *   - subscribes when the host is connected and the quota capability is on;
 *   - reads the initial snapshot via `host.quota.get`;
 *   - keeps the subscription alive for the lifetime of the consuming screen;
 *   - exposes a `refresh()` action that calls `host.quota.refresh` and
 *     reuses the daemon's own dedup (a second concurrent refresh returns the
 *     `in_progress` error from the server rather than spawning a new process).
 *
 * The `generatedAtMs` field on the snapshot is the source of truth for
 * staleness; the 5-minute threshold lives next to the rest of the host-tools
 * constants in `./types`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { HostQuotaSnapshot, HostToolsActionResult } from "./types";
import { useHostToolsFeatures } from "./use-host-tools-features";

export interface UseHostQuotaResult {
  snapshot: HostQuotaSnapshot | null;
  isLoading: boolean;
  error: string | null;
  isRefreshing: boolean;
  refresh: () => Promise<HostToolsActionResult | null>;
  clientAvailable: boolean;
}

const EMPTY_RESULT = null;

export function useHostQuota(serverId: string | null | undefined): UseHostQuotaResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const features = useHostToolsFeatures(normalizedServerId);
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const enabled = Boolean(normalizedServerId && client && isConnected && features.quota);

  const [snapshot, setSnapshot] = useState<HostQuotaSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const inFlightRefresh = useRef<boolean>(false);

  // Reset state when the host changes or the feature flag flips off so that
  // a different server doesn't show the previous server's quota.
  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setIsLoading(false);
      setError(null);
      setIsRefreshing(false);
      return;
    }
    setIsLoading(true);
    setError(null);
  }, [enabled, normalizedServerId]);

  useEffect(() => {
    if (!enabled || !client) {
      return;
    }
    const target: DaemonClient = client;

    let cancelled = false;
    const applySnapshot = (next: HostQuotaSnapshot): void => {
      if (cancelled) return;
      setSnapshot(next);
      setIsLoading(false);
    };
    const applyError = (message: string): void => {
      if (cancelled) return;
      setError(message);
      setIsLoading(false);
    };

    void target
      .hostQuotaGet()
      .then(applySnapshot)
      .catch((err: unknown) => {
        applyError(err instanceof Error ? err.message : String(err));
      });

    void target.hostQuotaSubscribe(true).catch(() => undefined);
    const unsubscribe = target.onHostQuotaChanged(applySnapshot);

    return () => {
      cancelled = true;
      unsubscribe();
      void target.hostQuotaSubscribe(false).catch(() => undefined);
    };
  }, [client, enabled]);

  const refresh = useCallback(async (): Promise<HostToolsActionResult | null> => {
    if (!client || !enabled) return EMPTY_RESULT;
    if (inFlightRefresh.current) {
      return EMPTY_RESULT;
    }
    inFlightRefresh.current = true;
    setIsRefreshing(true);
    try {
      const result = await client.hostQuotaRefresh();
      if (!result.ok && result.error) {
        setError(result.error.message);
      }
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      inFlightRefresh.current = false;
      setIsRefreshing(false);
    }
  }, [client, enabled]);

  return {
    snapshot,
    isLoading,
    error,
    isRefreshing,
    refresh,
    clientAvailable: Boolean(client),
  };
}
