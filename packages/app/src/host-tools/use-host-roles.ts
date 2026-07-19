/**
 * Host roles hook — owns the subscription to `host.roles.changed` and the
 * model directory cache for the role-model switcher.
 *
 * The directory list comes from a one-shot `host.roles.list_models` call
 * (the daemon caches the result for an hour). The model picker uses the
 * returned list for fuzzy search; the `degraded` flag tells the UI to show
 * a "stale" badge so the user knows the list might be from a previous
 * successful refresh.
 */
import { useCallback, useEffect, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { HostRolesListModelsResult, HostRolesSnapshot, HostToolsActionResult } from "./types";
import { useHostToolsFeatures } from "./use-host-tools-features";

export interface SetHostRoleModelInput {
  role: string;
  model: string;
  variant?: string;
}

export interface UseHostRolesResult {
  snapshot: HostRolesSnapshot | null;
  isLoading: boolean;
  error: string | null;
  models: string[];
  modelsDegraded: boolean;
  modelsCachedAtMs: number | null;
  isLoadingModels: boolean;
  modelsError: string | null;
  loadModels: () => Promise<HostRolesListModelsResult | null>;
  setRoleModel: (input: SetHostRoleModelInput) => Promise<HostToolsActionResult | null>;
  isWriting: boolean;
  clientAvailable: boolean;
}

export function useHostRoles(serverId: string | null | undefined): UseHostRolesResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const features = useHostToolsFeatures(normalizedServerId);
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const enabled = Boolean(normalizedServerId && client && isConnected && features.roles);

  const [snapshot, setSnapshot] = useState<HostRolesSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsDegraded, setModelsDegraded] = useState<boolean>(false);
  const [modelsCachedAtMs, setModelsCachedAtMs] = useState<number | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isWriting, setIsWriting] = useState<boolean>(false);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setIsLoading(false);
      setError(null);
      setModels([]);
      setModelsDegraded(false);
      setModelsCachedAtMs(null);
      setIsLoadingModels(false);
      setModelsError(null);
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

    const applySnapshot = (next: HostRolesSnapshot): void => {
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
      .hostRolesGet()
      .then(applySnapshot)
      .catch((err: unknown) => {
        applyError(err instanceof Error ? err.message : String(err));
      });

    void target.hostRolesSubscribe(true).catch(() => undefined);
    const unsubscribe = target.onHostRolesChanged(applySnapshot);

    return () => {
      cancelled = true;
      unsubscribe();
      void target.hostRolesSubscribe(false).catch(() => undefined);
    };
  }, [client, enabled]);

  const loadModels = useCallback(async (): Promise<HostRolesListModelsResult | null> => {
    if (!client || !enabled) return null;
    setIsLoadingModels(true);
    setModelsError(null);
    try {
      const result = await client.hostRolesListModels();
      if (result.error) {
        setModelsError(result.error.message);
      } else {
        setModels(result.models);
        setModelsDegraded(result.degraded === true);
        setModelsCachedAtMs(result.cachedAtMs ?? null);
      }
      return result;
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setIsLoadingModels(false);
    }
  }, [client, enabled]);

  const setRoleModel = useCallback(
    async (input: SetHostRoleModelInput): Promise<HostToolsActionResult | null> => {
      if (!client || !enabled) return null;
      setIsWriting(true);
      try {
        const result = await client.hostRolesSetModel(input);
        if (!result.ok && result.error) {
          setError(result.error.message);
        }
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setIsWriting(false);
      }
    },
    [client, enabled],
  );

  return {
    snapshot,
    isLoading,
    error,
    models,
    modelsDegraded,
    modelsCachedAtMs,
    isLoadingModels,
    modelsError,
    loadModels,
    setRoleModel,
    isWriting,
    clientAvailable: Boolean(client),
  };
}
