import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { HostQuotaService } from "./quota-service.js";

const EXPORT_FIXTURE = {
  version: 1,
  exportedAt: 1_700_000_000,
  providers: {
    "kimi-for-coding": {
      status: "ok",
      entries: [{ name: "5h", percentRemaining: 62 }],
    },
  },
};

describe("HostQuotaService", () => {
  let dir: string;
  let exportPath: string;
  let configPath: string;
  let cliPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-quota-"));
    exportPath = join(dir, "quota-export.json");
    configPath = join(dir, "quota-toast.json");
    cliPath = join(dir, "refresh-cli.js");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function createService(overrides?: Partial<ConstructorParameters<typeof HostQuotaService>[0]>) {
    return new HostQuotaService({
      exportPath,
      cliPath,
      configPath,
      logger: createTestLogger(),
      refreshCooldownMs: 0,
      ...overrides,
    });
  }

  it("returns normalized snapshot with enabledProviders from config", async () => {
    await writeFile(exportPath, JSON.stringify(EXPORT_FIXTURE));
    await writeFile(configPath, JSON.stringify({ enabledProviders: ["kimi-for-coding"] }));
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0].label).toBe("Kimi");
    expect(snapshot.enabledProviders).toEqual(["kimi-for-coding"]);
  });

  it("reports file_missing when export file is absent", async () => {
    const service = createService();
    const snapshot = await service.getSnapshot();
    expect(snapshot.error?.code).toBe("file_missing");
    expect(snapshot.providers).toEqual([]);
  });

  it("keeps last good snapshot and flags file_corrupt on parse error", async () => {
    await writeFile(exportPath, JSON.stringify(EXPORT_FIXTURE));
    const service = createService();
    const good = await service.getSnapshot();
    expect(good.providers).toHaveLength(1);

    await writeFile(exportPath, "{not json");
    const corrupted = await service.getSnapshot();
    expect(corrupted.error?.code).toBe("file_corrupt");
    expect(corrupted.providers).toHaveLength(1);
  });

  it("refresh reports cli_missing when CLI is absent", async () => {
    const service = createService();
    const result = await service.refresh();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("cli_missing");
  });

  it("refresh runs the CLI and publishes the new snapshot", async () => {
    await writeFile(exportPath, JSON.stringify(EXPORT_FIXTURE));
    await writeFile(
      cliPath,
      `require("fs").writeFileSync(${JSON.stringify(exportPath)}, JSON.stringify({version:1,exportedAt:1700000001,providers:{zai:{status:"ok",entries:[{name:"day",percentUsed:40}]}}}));\n`,
    );
    const service = createService();
    const snapshots: unknown[] = [];
    service.onSnapshotChanged((s) => snapshots.push(s));

    const result = await service.refresh();
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(snapshots).toHaveLength(1);
    const published = snapshots[0] as Awaited<ReturnType<typeof service.getSnapshot>>;
    expect(published.providers[0].id).toBe("zai");
    expect(published.providers[0].entries[0].percentRemaining).toBe(60);
  });

  it("refresh rejects re-entrant calls while running", async () => {
    await writeFile(
      cliPath,
      `setTimeout(() => { require("fs").writeFileSync(${JSON.stringify(exportPath)}, "{}"); }, 200);\n`,
    );
    const service = createService();
    const first = service.refresh();
    const second = await service.refresh();
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("in_progress");
    await first;
  });

  it("refresh enforces cooldown between runs", async () => {
    await writeFile(cliPath, "");
    const service = createService({ refreshCooldownMs: 60_000 });
    const first = await service.refresh();
    expect(first.ok).toBe(true);
    const second = await service.refresh();
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("cooldown");
  });

  it("refresh maps CLI exit 1 to partial_failure", async () => {
    await writeFile(cliPath, "process.exit(1);\n");
    const service = createService();
    const result = await service.refresh();
    expect(result.ok).toBe(true);
    expect(result.error?.code).toBe("partial_failure");
  });

  it("refresh surfaces CLI stderr excerpt on failure", async () => {
    await writeFile(cliPath, "console.error('boom happened'); process.exit(2);\n");
    const service = createService();
    const result = await service.refresh();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("cli_failed");
    expect(result.error?.message).toContain("boom happened");
  });

  it("isAvailable reflects the export directory presence", async () => {
    const service = createService();
    expect(service.isAvailable()).toBe(true);
    const missing = createService({
      exportPath: join(dir, "no-such-dir", "quota-export.json"),
    });
    expect(missing.isAvailable()).toBe(false);
  });

  it("watch publishes changes after start", async () => {
    await writeFile(exportPath, JSON.stringify(EXPORT_FIXTURE));
    const service = createService({ pollIntervalMs: 50 });
    const snapshots: unknown[] = [];
    service.onSnapshotChanged((s) => snapshots.push(s));
    service.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await writeFile(exportPath, JSON.stringify({ ...EXPORT_FIXTURE, exportedAt: 1_700_000_500 }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(snapshots.length).toBeGreaterThan(0);
    } finally {
      service.close();
    }
  });
});
