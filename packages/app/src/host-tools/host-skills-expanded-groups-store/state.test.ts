import { describe, expect, it } from "vitest";
import {
  type HostSkillsExpandedGroupsState,
  mergePersistedHostSkillsExpandedGroups,
  serializeHostSkillsExpandedGroups,
  setHostSkillGroupExpanded,
  toggleHostSkillGroupExpanded,
} from "@/host-tools/host-skills-expanded-groups-store/state";

function emptyState(): HostSkillsExpandedGroupsState {
  return { expandedGroupIds: new Set() };
}

describe("host skills expanded groups transitions", () => {
  it("toggles a group open and closed", () => {
    let state = emptyState();

    state = toggleHostSkillGroupExpanded(state, "group-a");
    expect(Array.from(state.expandedGroupIds)).toEqual(["group-a"]);

    state = toggleHostSkillGroupExpanded(state, "group-b");
    expect(Array.from(state.expandedGroupIds).sort()).toEqual(["group-a", "group-b"]);

    state = toggleHostSkillGroupExpanded(state, "group-a");
    expect(Array.from(state.expandedGroupIds)).toEqual(["group-b"]);
  });

  it("setGroupExpanded adds a previously closed group", () => {
    const state = setHostSkillGroupExpanded(emptyState(), "group-a", true);
    expect(state.expandedGroupIds.has("group-a")).toBe(true);
  });

  it("setGroupExpanded removes a previously open group", () => {
    const opened = setHostSkillGroupExpanded(emptyState(), "group-a", true);
    const closed = setHostSkillGroupExpanded(opened, "group-a", false);
    expect(closed.expandedGroupIds.has("group-a")).toBe(false);
  });

  it("setGroupExpanded returns the same state when the value is unchanged", () => {
    const opened = setHostSkillGroupExpanded(emptyState(), "group-a", true);
    expect(setHostSkillGroupExpanded(opened, "group-a", true)).toBe(opened);
  });

  it("serializes the expanded set as an array of group ids", () => {
    const state: HostSkillsExpandedGroupsState = {
      expandedGroupIds: new Set(["group-a", "group-b"]),
    };
    expect(serializeHostSkillsExpandedGroups(state)).toEqual({
      expandedGroupIds: ["group-a", "group-b"],
    });
  });

  it("restores expanded group ids from persisted preferences", () => {
    const restored = mergePersistedHostSkillsExpandedGroups(
      { expandedGroupIds: ["group-a", "group-b", 42] },
      emptyState(),
    );
    expect(Array.from(restored.expandedGroupIds).sort()).toEqual(["group-a", "group-b"]);
  });

  it("keeps the existing state when persisted preferences are absent or empty", () => {
    const current = emptyState();
    expect(mergePersistedHostSkillsExpandedGroups(undefined, current)).toBe(current);
    expect(mergePersistedHostSkillsExpandedGroups({}, current)).toBe(current);
    expect(mergePersistedHostSkillsExpandedGroups({ expandedGroupIds: [] }, current)).toBe(current);
    expect(
      mergePersistedHostSkillsExpandedGroups({ expandedGroupIds: "not-an-array" }, current),
    ).toBe(current);
  });

  it("keeps the existing state when persisted preferences match the current set", () => {
    const current: HostSkillsExpandedGroupsState = {
      expandedGroupIds: new Set(["group-a"]),
    };
    expect(mergePersistedHostSkillsExpandedGroups({ expandedGroupIds: ["group-a"] }, current)).toBe(
      current,
    );
  });
});
