import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { load as loadYaml } from "js-yaml";

/**
 * skill-scanner.ts — daemon port of the VS Code opencode-skill-manager scanner.
 *
 * Differences from the reference:
 * - frontmatter parsed with js-yaml instead of gray-matter (design D5)
 * - contentHash / addedAt / conflict tracking dropped: the host.skills protocol
 *   snapshot does not surface them
 */

export interface SkillRootSpec {
  id: string;
  skillsDir: string;
  disabledDir: string;
  scopes: string[];
}

export type SkillInstanceStatus = "active" | "archived";

export interface SkillInstanceInfo {
  rootId: string;
  /** Path found under the root (the symlink itself for symlink instances) — renames act on it. */
  dir: string;
  /** realpath result used to read SKILL.md; equals dir for real directories. */
  realPath: string;
  viaSymlink: boolean;
  status: SkillInstanceStatus;
}

export interface ScannedSkill {
  name: string;
  description: string;
  scopes: string[];
  enabled: boolean;
  instances: SkillInstanceInfo[];
}

export interface SkillScanWarning {
  dir: string;
  reason: string;
}

export interface SkillScanResult {
  skills: ScannedSkill[];
  warnings: SkillScanWarning[];
}

interface RawSkill {
  name: string;
  description: string;
  rootId: string;
  dir: string;
  realPath: string;
  viaSymlink: boolean;
  status: SkillInstanceStatus;
  /** Root ids through which this canonical dir is reachable (real dir or symlink). */
  scopeSources: Set<string>;
}

/** The six global skill roots shared with the VS Code extension. */
export function defaultSkillRoots(homeDir: string = homedir()): SkillRootSpec[] {
  return [
    {
      id: "home-agents",
      skillsDir: join(homeDir, ".agents", "skills"),
      disabledDir: join(homeDir, ".agents", "skills-disabled"),
      scopes: ["shared", "opencode", "claude"],
    },
    {
      id: "home-claude",
      skillsDir: join(homeDir, ".claude", "skills"),
      disabledDir: join(homeDir, ".claude", "skills-disabled"),
      scopes: ["claude", "opencode"],
    },
    {
      id: "home-opencode-config",
      skillsDir: join(homeDir, ".config", "opencode", "skills"),
      disabledDir: join(homeDir, ".config", "opencode", "skills-disabled"),
      scopes: ["opencode"],
    },
    {
      id: "home-opencode",
      skillsDir: join(homeDir, ".opencode", "skills"),
      disabledDir: join(homeDir, ".opencode", "skills-disabled"),
      scopes: ["opencode"],
    },
    {
      id: "home-codex",
      skillsDir: join(homeDir, ".codex", "skills"),
      disabledDir: join(homeDir, ".codex", "skills-disabled"),
      scopes: ["codex"],
    },
    {
      id: "home-gemini",
      skillsDir: join(homeDir, ".gemini", "skills"),
      disabledDir: join(homeDir, ".gemini", "skills-disabled"),
      scopes: ["gemini"],
    },
  ];
}

/** Scan all roots and merge same-name instances into logical skills (sorted by name). */
export async function scanSkills(roots: SkillRootSpec[]): Promise<SkillScanResult> {
  const warnings: SkillScanWarning[] = [];
  const rawSkills: RawSkill[] = [];
  await collectRealDirectoryInstances(roots, rawSkills, warnings);
  await collectSymlinkInstances(roots, rawSkills, warnings);
  return { skills: mergeRawSkillsByName(rawSkills, roots), warnings };
}

function findRawByRealPath(rawSkills: RawSkill[], path: string): RawSkill | undefined {
  for (const raw of rawSkills) {
    if (raw.realPath === path) {
      return raw;
    }
  }
  return undefined;
}

/** First pass: collect real directories as instances. */
async function collectRealDirectoryInstances(
  roots: SkillRootSpec[],
  rawSkills: RawSkill[],
  warnings: SkillScanWarning[],
): Promise<void> {
  for (const root of roots) {
    for (const [dir, status] of [
      [root.skillsDir, "active"],
      [root.disabledDir, "archived"],
    ] as const) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
          continue;
        }
        warnings.push({
          dir,
          reason: `无法读取目录: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      for (const name of names) {
        if (name.startsWith(".")) {
          continue;
        }
        const skillDir = join(dir, name);
        let stats;
        try {
          stats = await lstat(skillDir);
        } catch {
          continue;
        }
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          continue;
        }

        const parsed = await parseSkillDir(skillDir, skillDir, warnings);
        if (!parsed) {
          continue;
        }
        const realPath = await safeRealpath(skillDir);
        const existing = findRawByRealPath(rawSkills, realPath);
        if (existing) {
          existing.scopeSources.add(root.id);
          continue;
        }
        rawSkills.push({
          ...parsed,
          rootId: root.id,
          dir: skillDir,
          realPath,
          viaSymlink: false,
          status,
          scopeSources: new Set([root.id]),
        });
      }
    }
  }
}

/** Second pass: handle symlinks. */
async function collectSymlinkInstances(
  roots: SkillRootSpec[],
  rawSkills: RawSkill[],
  warnings: SkillScanWarning[],
): Promise<void> {
  for (const root of roots) {
    for (const [dir, status] of [
      [root.skillsDir, "active"],
      [root.disabledDir, "archived"],
    ] as const) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }

      for (const name of names) {
        const symlinkDir = join(dir, name);
        let stats;
        try {
          stats = await lstat(symlinkDir);
        } catch {
          continue;
        }
        if (!stats.isSymbolicLink()) {
          continue;
        }

        let realPath: string;
        try {
          realPath = await realpath(symlinkDir);
        } catch {
          // Broken symlink: contributes nothing.
          continue;
        }

        const existing = findRawByRealPath(rawSkills, realPath);
        if (existing) {
          existing.scopeSources.add(root.id);
          continue;
        }

        // Symlink target lives outside all registered roots: treat the symlink itself
        // as a movable instance within this root. SKILL.md is read from the target.
        const parsed = await parseSkillDir(symlinkDir, realPath, warnings);
        if (!parsed) {
          continue;
        }
        rawSkills.push({
          ...parsed,
          rootId: root.id,
          dir: symlinkDir,
          realPath,
          viaSymlink: true,
          status,
          scopeSources: new Set([root.id]),
        });
      }
    }
  }
}

function mergeRawSkillsByName(rawSkills: RawSkill[], roots: SkillRootSpec[]): ScannedSkill[] {
  const byName = new Map<string, RawSkill[]>();
  for (const raw of rawSkills) {
    const list = byName.get(raw.name) ?? [];
    list.push(raw);
    byName.set(raw.name, list);
  }

  const skills: ScannedSkill[] = [];
  for (const name of Array.from(byName.keys()).sort()) {
    const list = byName.get(name);
    if (!list || list.length === 0) {
      continue;
    }

    const instances: SkillInstanceInfo[] = list
      .map((s) => ({
        rootId: s.rootId,
        dir: s.dir,
        realPath: s.realPath,
        viaSymlink: s.viaSymlink,
        status: s.status,
      }))
      .sort((a, b) => a.dir.localeCompare(b.dir));

    const primary = list.find((s) => s.status === "active") ?? list[0];
    const enabled = list.some((s) => s.status === "active");

    skills.push({
      name,
      description: primary.description,
      scopes: collectScopes(list, roots),
      enabled,
      instances,
    });
  }
  return skills;
}

function collectScopes(list: RawSkill[], roots: SkillRootSpec[]): string[] {
  const scopeSet = new Set<string>();
  for (const s of list) {
    for (const rootId of s.scopeSources) {
      const root = roots.find((r) => r.id === rootId);
      if (!root) {
        continue;
      }
      for (const scope of root.scopes) {
        scopeSet.add(scope);
      }
    }
  }
  return Array.from(scopeSet).sort();
}

interface ParsedSkill {
  name: string;
  description: string;
}

async function parseSkillDir(
  warningDir: string,
  readDir: string,
  warnings: SkillScanWarning[],
): Promise<ParsedSkill | undefined> {
  const skillMdPath = join(readDir, "SKILL.md");
  let raw: string;
  try {
    raw = await readFile(skillMdPath, "utf-8");
  } catch {
    warnings.push({ dir: warningDir, reason: "缺少或无法读取 SKILL.md" });
    return undefined;
  }

  let name: string | undefined;
  let description = "";
  let parseError: string | undefined;

  try {
    const data = parseFrontmatter(raw);
    if (data && typeof data === "object") {
      const dataName = (data as Record<string, unknown>).name;
      if (typeof dataName === "string" && dataName.trim().length > 0) {
        name = dataName.trim();
      }
      const dataDesc = (data as Record<string, unknown>).description;
      if (typeof dataDesc === "string") {
        description = dataDesc.trim();
      }
    }
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  if (parseError) {
    name = basename(warningDir);
    warnings.push({ dir: warningDir, reason: `SKILL.md frontmatter 解析失败: ${parseError}` });
  } else if (!name) {
    name = basename(warningDir);
    warnings.push({ dir: warningDir, reason: "SKILL.md 缺少 name 字段,已使用目录名兜底" });
  }

  return { name, description };
}

/** Extract the YAML frontmatter block (--- delimited) and parse it with js-yaml. */
export function parseFrontmatter(raw: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) {
    return undefined;
  }
  return loadYaml(match[1]);
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}
