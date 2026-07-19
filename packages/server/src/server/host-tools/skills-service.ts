import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type pino from "pino";
import type { HostSkillGroup, HostSkillsSnapshot, HostToolsError } from "../messages.js";
import { DebouncedFileWatch } from "./file-watch.js";
import { scanSkills, type ScannedSkill, type SkillRootSpec } from "./skill-scanner.js";

/**
 * skills-service.ts — daemon-side owner of the opencode skill manager state
 * shared with the VS Code opencode-skill-manager extension. Scans the six
 * global skill roots, merges the groups state file, watches everything for
 * external changes, and performs rename-based enable/disable.
 */

export interface HostSkillsServiceOptions {
  roots: SkillRootSpec[];
  statePath: string;
  logger: pino.Logger;
  debounceMs?: number;
  pollIntervalMs?: number;
}

export interface HostSkillsResult {
  ok: boolean;
  error?: HostToolsError;
}

export interface HostSkillGroupInput {
  id: string;
  name: string;
  skills: string[];
}

type SkillsSnapshotListener = (snapshot: HostSkillsSnapshot) => void;

const SCHEMA_VERSION = 1;
const UNGROUPED_ID = "__ungrouped__";
const UNGROUPED_NAME = "未分组";
const PRETTY_NAMES: Record<string, string> = {
  lark: "飞书全家桶",
  openspec: "OpenSpec 工作流",
};
const POLL_INTERVAL_DEFAULT_MS = 30_000;

interface SkillGroupDef {
  id: string;
  name: string;
  collapsed: boolean;
  members: string[];
  auto?: boolean;
  sortBy?: "name" | "date";
}

interface SkillManagerState {
  schemaVersion: number;
  groups: SkillGroupDef[];
  zhDict: Record<string, { zh: string }>;
  lastInstances: Record<string, string[]>;
}

interface LoadedState {
  state: SkillManagerState;
  error?: HostToolsError;
}

function defaultState(): SkillManagerState {
  return { schemaVersion: SCHEMA_VERSION, groups: [], zhDict: {}, lastInstances: {} };
}

export class HostSkillsService {
  private readonly roots: SkillRootSpec[];
  private readonly statePath: string;
  private readonly logger: pino.Logger;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;

  private lastPublishedJson: string | null = null;
  private readonly listeners = new Set<SkillsSnapshotListener>();
  private watchers: DebouncedFileWatch[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: HostSkillsServiceOptions) {
    this.roots = options.roots;
    this.statePath = options.statePath;
    this.logger = options.logger;
    this.debounceMs = options.debounceMs ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_DEFAULT_MS;
  }

  isAvailable(): boolean {
    return this.roots.some((r) => existsSync(r.skillsDir) || existsSync(r.disabledDir));
  }

  start(): void {
    if (this.watchers.length > 0) {
      return;
    }
    const watchedPaths: string[] = [this.statePath];
    for (const root of this.roots) {
      watchedPaths.push(root.skillsDir, root.disabledDir);
    }
    this.watchers = watchedPaths.map(
      (path) =>
        new DebouncedFileWatch({
          path,
          debounceMs: this.debounceMs,
          onChange: () => {
            void this.reloadAndPublish("watch");
          },
        }),
    );
    this.pollTimer = setInterval(() => {
      for (const watcher of this.watchers) {
        watcher.arm();
      }
      void this.reloadAndPublish("poll");
    }, this.pollIntervalMs);
    this.pollTimer.unref();
  }

  close(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.listeners.clear();
  }

  onSnapshotChanged(listener: SkillsSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSnapshot(): Promise<HostSkillsSnapshot> {
    const { state, error } = await this.loadState();
    const { skills, warnings } = await scanSkills(this.roots);
    if (warnings.length > 0) {
      this.logger.debug({ warnings }, "host skills scan warnings");
    }
    return {
      skills: skills.map((skill) => this.toProtocolSkill(skill, state)),
      groups: resolveGroups(skills, state.groups),
      ...(error ? { error } : {}),
    };
  }

  async toggle(input: { name: string; enable: boolean }): Promise<HostSkillsResult> {
    const { skills } = await scanSkills(this.roots);
    const skill = skills.find((s) => s.name === input.name);
    if (!skill) {
      return {
        ok: false,
        error: { code: "skill_not_found", message: `未找到 skill:${input.name}` },
      };
    }

    const rootById = new Map<string, SkillRootSpec>();
    for (const root of this.roots) {
      rootById.set(root.id, root);
    }

    const instancesToMove = skill.instances.filter((instance) =>
      input.enable ? instance.status === "archived" : instance.status === "active",
    );
    if (instancesToMove.length === 0) {
      return { ok: true };
    }

    const moved: Array<{ from: string; to: string }> = [];
    try {
      for (const instance of instancesToMove) {
        const root = rootById.get(instance.rootId);
        if (!root) {
          throw new Error(`找不到实例所属根:${instance.rootId}`);
        }
        const targetDir = input.enable ? root.skillsDir : root.disabledDir;
        const from = instance.dir;
        const to = join(targetDir, from.split("/").pop() ?? from);
        // mkdir -p in both directions: the reference only does it on disable, but the
        // skills dir may legitimately not exist yet when re-enabling an archived-only root.
        await mkdir(targetDir, { recursive: true });
        await rename(from, to);
        moved.push({ from, to });
      }
    } catch (error) {
      // Rollback in reverse order, best-effort.
      for (let i = moved.length - 1; i >= 0; i--) {
        const { from, to } = moved[i];
        try {
          await rename(to, from);
        } catch {
          // Continue rolling back the rest.
        }
      }
      return {
        ok: false,
        error: {
          code: "toggle_failed",
          message: `移动 skill "${input.name}" ${input.enable ? "启用" : "禁用"}失败:${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      };
    }

    // Update lastInstances (restore reference only); never overwrite a corrupt state file.
    const { state, error } = await this.loadState();
    if (!error) {
      state.lastInstances[skill.name] = instancesToMove.map((instance) => instance.rootId);
      await this.saveState(state);
    }

    await this.reloadAndPublish("toggle");
    return { ok: true };
  }

  async updateGroups(input: { groups: HostSkillGroupInput[] }): Promise<HostSkillsResult> {
    const { state, error } = await this.loadState();
    if (error) {
      return { ok: false, error };
    }
    state.groups = input.groups.map((group) => {
      const existing = state.groups.find((g) => g.id === group.id);
      return {
        id: group.id,
        name: group.name,
        collapsed: existing?.collapsed ?? true,
        members: [...group.skills].sort(),
        ...(existing?.auto ? { auto: true } : {}),
        ...(existing?.sortBy ? { sortBy: existing.sortBy } : {}),
      };
    });
    try {
      await this.saveState(state);
    } catch (saveError) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: `分组写入失败:${saveError instanceof Error ? saveError.message : String(saveError)}`,
        },
      };
    }
    await this.reloadAndPublish("groups.update");
    return { ok: true };
  }

  private toProtocolSkill(
    skill: ScannedSkill,
    state: SkillManagerState,
  ): HostSkillsSnapshot["skills"][number] {
    const zhSummary = state.zhDict[skill.name]?.zh;
    return {
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      ...(zhSummary ? { zhSummary } : {}),
      scopes: skill.scopes,
      enabled: skill.enabled,
      instances: skill.instances.map((instance) => ({
        rootId: instance.rootId,
        path: instance.dir,
        enabled: instance.status === "active",
        ...(instance.viaSymlink ? { isSymlink: true } : {}),
      })),
    };
  }

  private async loadState(): Promise<LoadedState> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return { state: defaultState() };
      }
      return {
        state: defaultState(),
        error: {
          code: "read_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { state: defaultState(), error: corruptStateError() };
    }
    if (!isValidManagerState(parsed)) {
      return { state: defaultState(), error: corruptStateError() };
    }
    return { state: parsed };
  }

  private async saveState(state: SkillManagerState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await rename(tmp, this.statePath);
  }

  private async reloadAndPublish(reason: string): Promise<void> {
    try {
      const snapshot = await this.getSnapshot();
      const json = JSON.stringify(snapshot);
      if (json === this.lastPublishedJson) {
        return;
      }
      this.lastPublishedJson = json;
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    } catch (error) {
      this.logger.warn({ err: error, reason }, "host skills reload failed");
    }
  }
}

function corruptStateError(): HostToolsError {
  return { code: "file_corrupt", message: "分组文件已损坏,未覆盖" };
}

function isValidManagerState(value: unknown): value is SkillManagerState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(v.groups) &&
    !!v.zhDict &&
    typeof v.zhDict === "object" &&
    !!v.lastInstances &&
    typeof v.lastInstances === "object"
  );
}

/** Merge user groups + auto groups + ungrouped bucket (user first, ungrouped last). */
export function resolveGroups(
  skills: ScannedSkill[],
  userGroups: SkillGroupDef[],
): HostSkillGroup[] {
  const allSkillNames = new Set(skills.map((s) => s.name));
  const assigned = new Set<string>();
  const result: HostSkillGroup[] = [];

  for (const group of userGroups) {
    const members = group.members.filter((m) => allSkillNames.has(m)).sort();
    result.push({ id: group.id, name: group.name, skills: members });
    for (const member of members) {
      assigned.add(member);
    }
  }

  const remaining = skills.filter((s) => !assigned.has(s.name));
  for (const group of autoGroup(remaining)) {
    result.push({ id: group.id, name: group.name, skills: group.members });
    for (const member of group.members) {
      assigned.add(member);
    }
  }

  const ungrouped = skills
    .filter((s) => !assigned.has(s.name))
    .map((s) => s.name)
    .sort();
  result.push({ id: UNGROUPED_ID, name: UNGROUPED_NAME, skills: ungrouped });

  return result;
}

/** Prefix heuristic: prefix before the first "-", ≥3 members, pretty names mapped. */
export function autoGroup(skills: ScannedSkill[]): SkillGroupDef[] {
  const prefixMap = new Map<string, ScannedSkill[]>();
  for (const skill of skills) {
    const prefix = extractPrefix(skill.name);
    if (!prefix) {
      continue;
    }
    const list = prefixMap.get(prefix) ?? [];
    list.push(skill);
    prefixMap.set(prefix, list);
  }

  const groups: SkillGroupDef[] = [];
  for (const [prefix, members] of prefixMap.entries()) {
    if (members.length < 3) {
      continue;
    }
    const pretty = PRETTY_NAMES[prefix] ?? capitalizeFirst(prefix);
    groups.push({
      id: `auto-${prefix}`,
      name: `${pretty} (${members.length})`,
      collapsed: true,
      members: members.map((m) => m.name).sort(),
      auto: true,
    });
  }

  return groups.sort((a, b) => b.members.length - a.members.length);
}

function extractPrefix(name: string): string | undefined {
  const idx = name.indexOf("-");
  if (idx <= 0) {
    return undefined;
  }
  return name.slice(0, idx).toLowerCase();
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
