/**
 * Pure state transitions for the host-skills screen's per-group expansion
 * state. The set of expanded group identifiers is what the user has opened;
 * it is persisted across screen re-visits via the matching zustand store.
 */
export interface HostSkillsExpandedGroupsState {
  expandedGroupIds: Set<string>;
}

export interface PersistedHostSkillsExpandedGroups {
  expandedGroupIds?: unknown;
}

export function toggleHostSkillGroupExpanded(
  state: HostSkillsExpandedGroupsState,
  groupId: string,
): HostSkillsExpandedGroupsState {
  const next = new Set(state.expandedGroupIds);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  return { ...state, expandedGroupIds: next };
}

export function setHostSkillGroupExpanded(
  state: HostSkillsExpandedGroupsState,
  groupId: string,
  expanded: boolean,
): HostSkillsExpandedGroupsState {
  const has = state.expandedGroupIds.has(groupId);
  if (has === expanded) {
    return state;
  }
  const next = new Set(state.expandedGroupIds);
  if (expanded) {
    next.add(groupId);
  } else {
    next.delete(groupId);
  }
  return { ...state, expandedGroupIds: next };
}

export function serializeHostSkillsExpandedGroups(state: HostSkillsExpandedGroupsState): {
  expandedGroupIds: string[];
} {
  return { expandedGroupIds: Array.from(state.expandedGroupIds) };
}

export function mergePersistedHostSkillsExpandedGroups<S extends HostSkillsExpandedGroupsState>(
  persisted: PersistedHostSkillsExpandedGroups | undefined,
  current: S,
): S {
  if (!persisted?.expandedGroupIds) {
    return current;
  }
  const restored = deserializeExpandedGroupIds(persisted.expandedGroupIds);
  if (areSetsEqual(current.expandedGroupIds, restored)) {
    return current;
  }
  return { ...current, expandedGroupIds: restored };
}

function deserializeExpandedGroupIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((id): id is string => typeof id === "string"));
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
}
