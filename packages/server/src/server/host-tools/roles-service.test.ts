import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { HostRolesService, parseModelsOutput, type ModelsCommandRunner } from "./roles-service.js";

const SLIM_FIXTURE = {
  $schema: "https://example.com/slim.schema.json",
  preset: "default",
  presets: {
    default: {
      oracle: { model: "openai/gpt-4o" },
      fixer: { model: "anthropic/claude-3.5-sonnet", variant: "high" },
      planner: { model: "google/gemini-2.5-pro" },
    },
    other: {
      oracle: { model: "openai/o1" },
    },
  },
  mcps: [{ name: "filesystem" }],
  skills: ["git", "bash"],
};

describe("HostRolesService", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-roles-"));
    configPath = join(dir, "oh-my-opencode-slim.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function createService(overrides?: Partial<ConstructorParameters<typeof HostRolesService>[0]>) {
    return new HostRolesService({
      configPath,
      logger: createTestLogger(),
      ...overrides,
    });
  }

  it("returns the active preset roster with model/variant/hasVariantField", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.presetName).toBe("default");
    const fixer = snapshot.roles.find((r) => r.role === "fixer");
    expect(fixer?.model).toBe("anthropic/claude-3.5-sonnet");
    expect(fixer?.variant).toBe("high");
    expect(fixer?.hasVariantField).toBe(true);
    const oracle = snapshot.roles.find((r) => r.role === "oracle");
    expect(oracle?.model).toBe("openai/gpt-4o");
    expect(oracle?.variant).toBeUndefined();
    expect(oracle?.hasVariantField).toBe(false);
  });

  it("reports file_missing when config is absent", async () => {
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error?.code).toBe("file_missing");
    expect(snapshot.roles).toEqual([]);
  });

  it("reports file_corrupt on invalid JSON", async () => {
    await writeFile(configPath, "{not json");
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error?.code).toBe("file_corrupt");
    expect(snapshot.roles).toEqual([]);
  });

  it("reports no_active_preset when preset field is missing", async () => {
    await writeFile(configPath, JSON.stringify({ presets: { default: {} } }));
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error?.code).toBe("no_active_preset");
  });

  it("reports no_active_preset when active preset is absent from presets", async () => {
    await writeFile(configPath, JSON.stringify({ preset: "ghost", presets: { default: {} } }));
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error?.code).toBe("no_active_preset");
  });

  it("keeps last good roles and flags error on subsequent corrupt read", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();
    const good = await service.getSnapshot();
    expect(good.roles).toHaveLength(3);

    await writeFile(configPath, "{broken");
    const corrupted = await service.getSnapshot();
    expect(corrupted.error?.code).toBe("file_corrupt");
    expect(corrupted.roles).toHaveLength(3);
    expect(corrupted.presetName).toBe("default");
  });

  it("isAvailable reflects the config directory presence", () => {
    const service = createService();
    expect(service.isAvailable()).toBe(true);
    const missing = createService({
      configPath: join(dir, "no-such-dir", "slim.json"),
    });
    expect(missing.isAvailable()).toBe(false);
  });

  it("setModel writes back the model atomically with .bak and preserves other fields", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2) + "\n");
    const service = createService();
    const result = await service.setModel({ role: "oracle", model: "openai/gpt-4o-mini" });
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    const written = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(written) as typeof SLIM_FIXTURE;
    expect(parsed.presets.default.oracle.model).toBe("openai/gpt-4o-mini");
    // Untouched role preserved.
    expect(parsed.presets.default.fixer.model).toBe("anthropic/claude-3.5-sonnet");
    expect(parsed.presets.default.fixer.variant).toBe("high");
    // $schema and unknown top-level fields preserved.
    expect(parsed.$schema).toBe(SLIM_FIXTURE.$schema);
    expect(parsed.mcps).toEqual(SLIM_FIXTURE.mcps);
    expect(parsed.skills).toEqual(SLIM_FIXTURE.skills);
    // Non-active preset untouched.
    expect(parsed.presets.other.oracle.model).toBe("openai/o1");
    // Formatting: 2-space indent + trailing newline.
    expect(written).toMatch(/\n$/);
    expect(written).toContain('  "preset"');
    // .bak backup created.
    expect(existsSync(`${configPath}.bak`)).toBe(true);
  });

  it("setModel writes variant only when the role already has a variant field", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();

    // fixer has variant → variant is written.
    const fixerResult = await service.setModel({
      role: "fixer",
      model: "anthropic/claude-3.7-sonnet",
      variant: "low",
    });
    expect(fixerResult.ok).toBe(true);
    const afterFixer = JSON.parse(readFileSync(configPath, "utf-8")) as typeof SLIM_FIXTURE;
    expect(afterFixer.presets.default.fixer.variant).toBe("low");

    // oracle has no variant → variant is NOT added even when requested.
    const oracleResult = await service.setModel({
      role: "oracle",
      model: "openai/gpt-4o-mini",
      variant: "medium",
    });
    expect(oracleResult.ok).toBe(true);
    const afterOracle = JSON.parse(readFileSync(configPath, "utf-8")) as typeof SLIM_FIXTURE;
    expect(afterOracle.presets.default.oracle.model).toBe("openai/gpt-4o-mini");
    expect("variant" in afterOracle.presets.default.oracle).toBe(false);
  });

  it("setModel rejects invalid model id without writing", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();
    const result = await service.setModel({ role: "oracle", model: "gpt-4o" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_model");
    // File untouched.
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as typeof SLIM_FIXTURE;
    expect(parsed.presets.default.oracle.model).toBe("openai/gpt-4o");
  });

  it("setModel rejects unknown role without writing", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();
    const result = await service.setModel({ role: "ghost", model: "openai/gpt-4o" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("role_not_found");
  });

  it("setModel reports file_missing when config absent", async () => {
    const service = createService();
    const result = await service.setModel({ role: "oracle", model: "openai/gpt-4o" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("file_missing");
  });

  it("listModels returns cached list within TTL without invoking the runner", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    let calls = 0;
    const runner: ModelsCommandRunner = async () => {
      calls++;
      return { ok: true, stdout: "openai/gpt-4o\nanthropic/claude-3.5-sonnet\n" };
    };
    const service = createService({
      runModelsCommand: runner,
      modelsCacheTtlMs: 60_000,
    });
    const first = await service.listModels();
    expect(first.error).toBeUndefined();
    expect(first.models).toEqual(["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]);
    expect(first.cachedAtMs).toBeTypeOf("number");
    expect(calls).toBe(1);
    const second = await service.listModels();
    expect(second.models).toEqual(first.models);
    expect(second.cachedAtMs).toBe(first.cachedAtMs);
    expect(calls).toBe(1);
  });

  it("listModels returns degraded cache on runner failure", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    let call = 0;
    const runner: ModelsCommandRunner = async () => {
      call++;
      if (call === 1) {
        return { ok: true, stdout: "openai/gpt-4o\n" };
      }
      return { ok: false, error: "boom", stderr: "boom" };
    };
    const service = createService({
      runModelsCommand: runner,
      modelsCacheTtlMs: 0,
    });
    const first = await service.listModels();
    expect(first.models).toEqual(["openai/gpt-4o"]);
    const second = await service.listModels();
    expect(second.degraded).toBe(true);
    expect(second.models).toEqual(["openai/gpt-4o"]);
    expect(second.cachedAtMs).toBe(first.cachedAtMs);
    expect(second.error).toBeUndefined();
  });

  it("listModels returns structured error when runner fails and no cache exists", async () => {
    const runner: ModelsCommandRunner = async () => {
      return { ok: false, error: "opencode not installed", stderr: "not found" };
    };
    const service = createService({ runModelsCommand: runner });
    const result = await service.listModels();
    expect(result.models).toEqual([]);
    expect(result.error?.code).toBe("cli_failed");
    expect(result.error?.message).toContain("opencode not installed");
  });

  it("parseModelsOutput trims and drops empty lines", () => {
    expect(parseModelsOutput("  a/b\n\nc/d  \n")).toEqual(["a/b", "c/d"]);
  });

  it("watch publishes changed roster after start", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();
    const snapshots: unknown[] = [];
    service.onSnapshotChanged((s) => snapshots.push(s));
    service.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const updated = {
        ...SLIM_FIXTURE,
        presets: {
          ...SLIM_FIXTURE.presets,
          default: {
            ...SLIM_FIXTURE.presets.default,
            oracle: { model: "openai/gpt-4o-mini" },
          },
        },
      };
      await writeFile(configPath, JSON.stringify(updated, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(snapshots.length).toBeGreaterThan(0);
      const last = snapshots[snapshots.length - 1] as Awaited<
        ReturnType<typeof service.getSnapshot>
      >;
      const oracle = last.roles.find((r) => r.role === "oracle");
      expect(oracle?.model).toBe("openai/gpt-4o-mini");
    } finally {
      service.close();
    }
  });

  it("watch dedupes identical JSON after initial publish", async () => {
    await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
    const service = createService();
    const snapshots: unknown[] = [];
    service.onSnapshotChanged((s) => snapshots.push(s));
    service.start();
    try {
      // First change publishes (lastPublishedJson was null).
      await new Promise((resolve) => setTimeout(resolve, 150));
      await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const initialCount = snapshots.length;
      expect(initialCount).toBeGreaterThanOrEqual(1);
      // Second identical write must be deduped.
      await writeFile(configPath, JSON.stringify(SLIM_FIXTURE, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(snapshots.length).toBe(initialCount);
    } finally {
      service.close();
    }
  });
});
