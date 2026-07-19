/**
 * Persisted zustand store for which host-skill groups the user has expanded.
 * The set of expanded group identifiers is what the user has opened; it is
 * persisted across screen re-visits so the groups they had opened remain
 * open when they return. All groups are collapsed by default on first
 * visit because the persisted set starts empty.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type HostSkillsExpandedGroupsState,
  mergePersistedHostSkillsExpandedGroups,
  serializeHostSkillsExpandedGroups,
  setHostSkillGroupExpanded,
  toggleHostSkillGroupExpanded,
} from "./state";

interface HostSkillsExpandedGroupsActions {
  toggleGroupExpanded: (groupId: string) => void;
  setGroupExpanded: (groupId: string, expanded: boolean) => void;
}

type HostSkillsExpandedGroupsStoreState = HostSkillsExpandedGroupsState &
  HostSkillsExpandedGroupsActions;

export const useHostSkillsExpandedGroupsStore = create<HostSkillsExpandedGroupsStoreState>()(
  persist(
    (set) => ({
      expandedGroupIds: new Set<string>(),
      toggleGroupExpanded: (groupId) =>
        set((state) => toggleHostSkillGroupExpanded(state, groupId)),
      setGroupExpanded: (groupId, expanded) =>
        set((state) => setHostSkillGroupExpanded(state, groupId, expanded)),
    }),
    {
      name: "host-skills-expanded-groups",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => serializeHostSkillsExpandedGroups(state),
      merge: (persistedState, currentState) =>
        mergePersistedHostSkillsExpandedGroups(
          persistedState as { expandedGroupIds?: unknown } | undefined,
          currentState,
        ),
    },
  ),
);
