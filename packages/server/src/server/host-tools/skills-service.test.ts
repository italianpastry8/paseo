import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { defaultSkillRoots, scanSkills, type SkillRootSpec } from "./skill-scanner.js";
import { HostSkillsService } from "./skills-service.js";

function skillMd(name: string, description?: string): string {
  const desc = description ? `\ndescription: ${description}` : "";
  return `---\nname: ${name}${desc}\n---\n\n# ${name}\n`;
}

describe("skill-scanner", () => {
  let dir: string;
  let root: SkillRootSpec;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-skills-scan-"));
    root = {
      id: "home-agents",
      skillsDir: join(dir, ".agents", "skills"),
      disabledDir: join(dir, ".agents", "skills-disabled"),
      scopes: ["shared", "opencode"],
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("defaultSkillRoots returns the six global roots", () => {
    const roots = defaultSkillRoots("/home/test");
    expect(roots).toHaveLength(6);
    expect(roots.map((r) => r.id)).toEqual([
      "home-agents",
      "home-claude",
      "home-opencode-config",
      "home-opencode",
      "home-codex",
      "home-gemini",
    ]);
    expect(roots[0].skillsDir).toBe(join("/home/test", ".agents", "skills"));
    expect(roots[0].disabledDir).toBe(join("/home/test", ".agents", "skills-disabled"));
  });

  it("scans active and archived instances and merges by name", async () => {
    await mkdir(join(root.skillsDir, "alpha"), { recursive: true });
    await writeFile(join(root.skillsDir, "alpha", "SKILL.md"), skillMd("alpha", "Alpha skill"));
    await mkdir(join(root.disabledDir, "beta"), { recursive: true });
    await writeFile(join(root.disabledDir, "beta", "SKILL.md"), skillMd("beta"));

    const { skills } = await scanSkills([root]);
    expect(skills).toHaveLength(2);
    const alpha = skills.find((s) => s.name === "alpha");
    const beta = skills.find((s) => s.name === "beta");
    expect(alpha?.enabled).toBe(true);
    expect(alpha?.description).toBe("Alpha skill");
    expect(alpha?.scopes).toEqual(["opencode", "shared"]);
    expect(beta?.enabled).toBe(false);
    expect(beta?.instances[0].status).toBe("archived");
  });

  it("merges same-name instances across roots and unions scopes", async () => {
    const rootB: SkillRootSpec = {
      id: "home-codex",
      skillsDir: join(dir, ".codex", "skills"),
      disabledDir: join(dir, ".codex", "skills-disabled"),
      scopes: ["codex"],
    };
    await mkdir(join(root.skillsDir, "shared-skill"), { recursive: true });
    await writeFile(join(root.skillsDir, "shared-skill", "SKILL.md"), skillMd("shared-skill"));
    await mkdir(join(rootB.skillsDir, "shared-skill"), { recursive: true });
    await writeFile(join(rootB.skillsDir, "shared-skill", "SKILL.md"), skillMd("shared-skill"));

    const { skills } = await scanSkills([root, rootB]);
    expect(skills).toHaveLength(1);
    expect(skills[0].instances).toHaveLength(2);
    expect(skills[0].scopes).toEqual(["codex", "opencode", "shared"]);
  });

  it("symlink to an already-scanned real dir contributes scopes, not an instance", async () => {
    const rootB: SkillRootSpec = {
      id: "home-codex",
      skillsDir: join(dir, ".codex", "skills"),
      disabledDir: join(dir, ".codex", "skills-disabled"),
      scopes: ["codex"],
    };
    await mkdir(join(root.skillsDir, "linked"), { recursive: true });
    await writeFile(join(root.skillsDir, "linked", "SKILL.md"), skillMd("linked"));
    await mkdir(rootB.skillsDir, { recursive: true });
    await symlink(join(root.skillsDir, "linked"), join(rootB.skillsDir, "linked"));

    const { skills } = await scanSkills([root, rootB]);
    expect(skills).toHaveLength(1);
    expect(skills[0].instances).toHaveLength(1);
    expect(skills[0].instances[0].viaSymlink).toBe(false);
    expect(skills[0].scopes).toEqual(["codex", "opencode", "shared"]);
  });

  it("symlink to a dir outside all roots becomes a movable instance", async () => {
    const outside = join(dir, "outside", "ext-skill");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "SKILL.md"), skillMd("ext-skill", "External"));
    await mkdir(root.skillsDir, { recursive: true });
    await symlink(outside, join(root.skillsDir, "ext-skill"));

    const { skills } = await scanSkills([root]);
    expect(skills).toHaveLength(1);
    expect(skills[0].instances).toHaveLength(1);
    expect(skills[0].instances[0].viaSymlink).toBe(true);
    expect(skills[0].instances[0].dir).toBe(join(root.skillsDir, "ext-skill"));
    expect(skills[0].description).toBe("External");
  });

  it("falls back to the directory name when frontmatter is broken", async () => {
    await mkdir(join(root.skillsDir, "broken-yaml"), { recursive: true });
    await writeFile(join(root.skillsDir, "broken-yaml", "SKILL.md"), "---\nname: [unclosed\n---\n");

    const { skills, warnings } = await scanSkills([root]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("broken-yaml");
    expect(warnings.some((w) => w.reason.includes("frontmatter 解析失败"))).toBe(true);
  });

  it("skips dirs without SKILL.md with a warning", async () => {
    await mkdir(join(root.skillsDir, "no-md"), { recursive: true });
    const { skills, warnings } = await scanSkills([root]);
    expect(skills).toHaveLength(0);
    expect(warnings.some((w) => w.reason.includes("SKILL.md"))).toBe(true);
  });
});

describe("HostSkillsService", () => {
  let dir: string;
  let root: SkillRootSpec;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-skills-svc-"));
    root = {
      id: "home-agents",
      skillsDir: join(dir, ".agents", "skills"),
      disabledDir: join(dir, ".agents", "skills-disabled"),
      scopes: ["shared"],
    };
    statePath = join(dir, ".agents", "skill-manager.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function createService(overrides?: Partial<ConstructorParameters<typeof HostSkillsService>[0]>) {
    return new HostSkillsService({
      roots: [root],
      statePath,
      logger: createTestLogger(),
      ...overrides,
    });
  }

  async function addSkill(name: string, options?: { archived?: boolean; description?: string }) {
    const base = options?.archived ? root.disabledDir : root.skillsDir;
    await mkdir(join(base, name), { recursive: true });
    await writeFile(join(base, name, "SKILL.md"), skillMd(name, options?.description));
  }

  it("isAvailable reflects root directory presence", async () => {
    expect(createService().isAvailable()).toBe(false);
    await mkdir(root.skillsDir, { recursive: true });
    expect(createService().isAvailable()).toBe(true);
  });

  it("auto-groups by prefix when the state file is missing", async () => {
    for (const name of ["lark-doc", "lark-sheet", "lark-drive", "solo"]) {
      await addSkill(name);
    }
    const snapshot = await createService().getSnapshot();
    expect(snapshot.error).toBeUndefined();
    const auto = snapshot.groups.find((g) => g.id === "auto-lark");
    expect(auto?.name).toBe("飞书全家桶 (3)");
    expect(auto?.skills).toEqual(["lark-doc", "lark-drive", "lark-sheet"]);
    const ungrouped = snapshot.groups.find((g) => g.id === "__ungrouped__");
    expect(ungrouped?.skills).toEqual(["solo"]);
  });

  it("reports file_corrupt on broken state and never overwrites it", async () => {
    await addSkill("alpha");
    await mkdir(join(dir, ".agents"), { recursive: true });
    await writeFile(statePath, "{not json");
    const before = await readFile(statePath, "utf-8");

    const snapshot = await createService().getSnapshot();
    expect(snapshot.error?.code).toBe("file_corrupt");
    expect(snapshot.skills).toHaveLength(1);
    expect(await readFile(statePath, "utf-8")).toBe(before);
  });

  it("merges user groups from the state file and surfaces zhSummary", async () => {
    await addSkill("alpha");
    await addSkill("beta");
    await mkdir(join(dir, ".agents"), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        groups: [{ id: "group-fav", name: "常用", collapsed: false, members: ["beta", "alpha"] }],
        zhDict: { alpha: { zh: "阿尔法", source: "user", updatedAt: "2026-01-01" } },
        lastInstances: {},
      }),
    );

    const snapshot = await createService().getSnapshot();
    const fav = snapshot.groups.find((g) => g.id === "group-fav");
    expect(fav?.skills).toEqual(["alpha", "beta"]);
    expect(snapshot.skills.find((s) => s.name === "alpha")?.zhSummary).toBe("阿尔法");
  });

  it("toggle disables a skill via rename and creates skills-disabled", async () => {
    await addSkill("alpha");
    const service = createService();
    const result = await service.toggle({ name: "alpha", enable: false });
    expect(result.ok).toBe(true);

    const { skills } = await scanSkills([root]);
    expect(skills.find((s) => s.name === "alpha")?.enabled).toBe(false);

    const state = JSON.parse(await readFile(statePath, "utf-8"));
    expect(state.lastInstances.alpha).toEqual(["home-agents"]);
  });

  it("toggle enables an archived skill via rename", async () => {
    await addSkill("beta", { archived: true });
    const service = createService();
    const result = await service.toggle({ name: "beta", enable: true });
    expect(result.ok).toBe(true);
    const { skills } = await scanSkills([root]);
    expect(skills.find((s) => s.name === "beta")?.enabled).toBe(true);
  });

  it("toggle reports skill_not_found for unknown skills", async () => {
    const result = await createService().toggle({ name: "ghost", enable: false });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("skill_not_found");
  });

  it("toggle does not overwrite a corrupt state file but still moves dirs", async () => {
    await addSkill("alpha");
    await mkdir(join(dir, ".agents"), { recursive: true });
    await writeFile(statePath, "{broken");
    const before = await readFile(statePath, "utf-8");

    const result = await createService().toggle({ name: "alpha", enable: false });
    expect(result.ok).toBe(true);
    expect(await readFile(statePath, "utf-8")).toBe(before);
    const { skills } = await scanSkills([root]);
    expect(skills.find((s) => s.name === "alpha")?.enabled).toBe(false);
  });

  it("updateGroups replaces groups atomically and preserves other state fields", async () => {
    await addSkill("alpha");
    await addSkill("beta");
    await mkdir(join(dir, ".agents"), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        groups: [],
        zhDict: { alpha: { zh: "阿尔法", source: "user", updatedAt: "x" } },
        lastInstances: { alpha: ["home-agents"] },
      }),
    );

    const service = createService();
    const result = await service.updateGroups({
      groups: [{ id: "group-new", name: "新建", skills: ["beta", "alpha"] }],
    });
    expect(result.ok).toBe(true);

    const state = JSON.parse(await readFile(statePath, "utf-8"));
    expect(state.zhDict.alpha.zh).toBe("阿尔法");
    expect(state.lastInstances.alpha).toEqual(["home-agents"]);
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].members).toEqual(["alpha", "beta"]);

    const snapshot = await service.getSnapshot();
    expect(snapshot.groups.find((g) => g.id === "group-new")?.skills).toEqual(["alpha", "beta"]);
  });

  it("updateGroups refuses to overwrite a corrupt state file", async () => {
    await mkdir(join(dir, ".agents"), { recursive: true });
    await writeFile(statePath, "{broken");
    const before = await readFile(statePath, "utf-8");

    const result = await createService().updateGroups({ groups: [] });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("file_corrupt");
    expect(await readFile(statePath, "utf-8")).toBe(before);
  });

  it("watch publishes changes after start", async () => {
    await addSkill("alpha");
    const service = createService({ pollIntervalMs: 50 });
    const snapshots: unknown[] = [];
    service.onSnapshotChanged((s) => snapshots.push(s));
    service.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await addSkill("gamma");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(snapshots.length).toBeGreaterThan(0);
    } finally {
      service.close();
    }
  });
});
