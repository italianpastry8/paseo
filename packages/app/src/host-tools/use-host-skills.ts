/**
 * Host skills hook — owns the subscription to `host.skills.changed` plus
 * the toggle and group-edit mutations.
 *
 * The toggle mutation is per-skill: the caller passes a name and the desired
 * enable state. The hook tracks in-flight toggles by name so a single skill
 * shows a pending UI while the daemon is renaming directories, without
 * blocking other skills from being acted on in parallel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { HostSkill, HostSkillGroup, HostSkillsSnapshot, HostToolsActionResult } from "./types";
import { useHostToolsFeatures } from "./use-host-tools-features";

export interface HostSkillGroupUpdate {
  id: string;
  name: string;
  skills: string[];
}

export interface UseHostSkillsResult {
  snapshot: HostSkillsSnapshot | null;
  skills: HostSkill[];
  groups: HostSkillGroup[];
  ungroupedSkills: HostSkill[];
  groupedSkills: Map<string, HostSkill[]>;
  isLoading: boolean;
  error: string | null;
  toggle: (name: string, enable: boolean) => Promise<HostToolsActionResult | null>;
  pendingToggles: ReadonlySet<string>;
  updateGroups: (groups: HostSkillGroupUpdate[]) => Promise<HostToolsActionResult | null>;
  isUpdatingGroups: boolean;
  clientAvailable: boolean;
}

const UNGROUPED_BUCKET_ID = "__ungrouped__";

export function useHostSkills(serverId: string | null | undefined): UseHostSkillsResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const features = useHostToolsFeatures(normalizedServerId);
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const enabled = Boolean(normalizedServerId && client && isConnected && features.skills);

  const [snapshot, setSnapshot] = useState<HostSkillsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggles, setPendingToggles] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [isUpdatingGroups, setIsUpdatingGroups] = useState<boolean>(false);

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

    const applySnapshot = (next: HostSkillsSnapshot): void => {
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
      .hostSkillsList()
      .then(applySnapshot)
      .catch((err: unknown) => {
        applyError(err instanceof Error ? err.message : String(err));
      });

    void target.hostSkillsSubscribe(true).catch(() => undefined);
    const unsubscribe = target.onHostSkillsChanged(applySnapshot);

    return () => {
      cancelled = true;
      unsubscribe();
      void target.hostSkillsSubscribe(false).catch(() => undefined);
    };
  }, [client, enabled]);

  const skills = useMemo(() => snapshot?.skills ?? [], [snapshot]);
  const groups = useMemo(() => snapshot?.groups ?? [], [snapshot]);

  const { groupedSkills, ungroupedSkills } = useMemo(() => {
    const byGroup = new Map<string, HostSkill[]>();
    for (const group of groups) {
      byGroup.set(group.id, []);
    }
    const ungrouped: HostSkill[] = [];
    for (const skill of skills) {
      let placed = false;
      for (const group of groups) {
        if (group.skills.includes(skill.name)) {
          byGroup.get(group.id)?.push(skill);
          placed = true;
          break;
        }
      }
      if (!placed) {
        ungrouped.push(skill);
      }
    }
    return { groupedSkills: byGroup, ungroupedSkills: ungrouped };
  }, [groups, skills]);

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
        const result = await client.hostSkillsToggle({ name, enable });
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

  const updateGroups = useCallback(
    async (groupsToWrite: HostSkillGroupUpdate[]): Promise<HostToolsActionResult | null> => {
      if (!client || !enabled) return null;
      setIsUpdatingGroups(true);
      try {
        const result = await client.hostSkillsUpdateGroups({ groups: groupsToWrite });
        if (!result.ok && result.error) {
          setError(result.error.message);
        }
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setIsUpdatingGroups(false);
      }
    },
    [client, enabled],
  );

  return {
    snapshot,
    skills,
    groups,
    ungroupedSkills,
    groupedSkills,
    isLoading,
    error,
    toggle,
    pendingToggles,
    updateGroups,
    isUpdatingGroups,
    clientAvailable: Boolean(client),
  };
}

export const HOST_TOOLS_UNGROUPED_BUCKET_ID = UNGROUPED_BUCKET_ID;
