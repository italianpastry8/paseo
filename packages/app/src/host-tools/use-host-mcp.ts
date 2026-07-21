/**
 * Host MCP hook — owns the subscription to `host.mcp.changed` plus
 * the toggle mutation.
 *
 * The toggle mutation is per-server: the caller passes a name and the desired
 * enable state. The hook tracks in-flight toggles by name so a single server
 * shows a pending UI while the daemon is renaming directories, without
 * blocking other servers from being acted on in parallel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { HostMcpServer, HostMcpSnapshot, HostToolsActionResult } from "./types";
import { useHostToolsFeatures } from "./use-host-tools-features";

export interface UseHostMcpResult {
  snapshot: HostMcpSnapshot | null;
  servers: HostMcpServer[];
  isLoading: boolean;
  error: string | null;
  toggle: (name: string, enable: boolean) => Promise<HostToolsActionResult | null>;
  pendingToggles: ReadonlySet<string>;
  clientAvailable: boolean;
}

export function useHostMcp(serverId: string | null | undefined): UseHostMcpResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const features = useHostToolsFeatures(normalizedServerId);
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const enabled = Boolean(normalizedServerId && client && isConnected && features.mcp);

  const [snapshot, setSnapshot] = useState<HostMcpSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggles, setPendingToggles] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setIsLoading(false);
      setError(null);
      setPendingToggles(new Set());
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

    const applySnapshot = (next: HostMcpSnapshot): void => {
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
      .hostMcpList()
      .then(applySnapshot)
      .catch((err: unknown) => {
        applyError(err instanceof Error ? err.message : String(err));
      });

    void target.hostMcpSubscribe(true).catch(() => undefined);
    const unsubscribe = target.onHostMcpChanged(applySnapshot);

    return () => {
      cancelled = true;
      unsubscribe();
      void target.hostMcpSubscribe(false).catch(() => undefined);
    };
  }, [client, enabled]);

  const servers = useMemo(() => snapshot?.servers ?? [], [snapshot]);

  const toggle = useCallback(
    async (name: string, enable: boolean): Promise<HostToolsActionResult | null> => {
      if (!client || !enabled) return null;
      setPendingToggles((current) => {
        if (current.has(name)) {
          return current;
        }
        const next = new Set(current);
        next.add(name);
        return next;
      });
      try {
        const result = await client.hostMcpToggle({ name, enable });
        if (!result.ok && result.error) {
          setError(result.error.message);
        }
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setPendingToggles((current) => {
          if (!current.has(name)) {
            return current;
          }
          const next = new Set(current);
          next.delete(name);
          return next;
        });
      }
    },
    [client, enabled],
  );

  return {
    snapshot,
    servers,
    isLoading,
    error,
    toggle,
    pendingToggles,
    clientAvailable: Boolean(client),
  };
}
