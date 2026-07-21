import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { HostMcpService } from "./mcp-service.js";

describe("HostMcpService", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "paseo-mcp-"));
    configPath = join(dir, "opencode.jsonc");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function createService(overrides?: { configPath?: string; logger?: pino.Logger }) {
    return new HostMcpService({
      configPath,
      logger: createTestLogger(),
      ...overrides,
    });
  }

  async function writeConfig(content: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, content, "utf-8");
  }

  const fixtureWithComments = `{
  // MCP server configuration
  "mcp": {
    "filesystem": {
      "type": "filesystem",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
      "enabled": true,
      "env": {
        "HOME": "/tmp"
      }
    },
    /* archived server */
    "brave-search": {
      "type": "brave-search",
      "command": ["npx", "-y", "@anthropic/mcp-server-brave-search"],
      "enabled": false
    }
  }
}`;

  it("isAvailable returns false when config file is missing", () => {
    expect(createService().isAvailable()).toBe(false);
  });

  it("isAvailable returns true when config file exists", async () => {
    await writeConfig(fixtureWithComments);
    expect(createService().isAvailable()).toBe(true);
  });

  it("lists servers from a fixture with comments", async () => {
    await writeConfig(fixtureWithComments);
    const snapshot = await createService().getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.servers).toHaveLength(2);
    const fs = snapshot.servers.find((s) => s.name === "filesystem");
    expect(fs?.enabled).toBe(true);
    expect(fs?.type).toBe("filesystem");
    expect(fs?.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-filesystem"]);
    expect(fs?.env).toEqual({ HOME: "/tmp" });
    const bs = snapshot.servers.find((s) => s.name === "brave-search");
    expect(bs?.enabled).toBe(false);
    expect(bs?.type).toBe("brave-search");
  });

  it("no mcp field returns empty list (not error)", async () => {
    await writeConfig('{ "other": true }');
    const snapshot = await createService().getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.servers).toEqual([]);
  });

  it("enabled field missing defaults to true", async () => {
    await writeConfig('{ "mcp": { "my-server": { "type": "custom" } } }');
    const snapshot = await createService().getSnapshot();
    expect(snapshot.servers).toHaveLength(1);
    expect(snapshot.servers[0].enabled).toBe(true);
  });

  it("file missing returns file_missing error", async () => {
    const snapshot = await createService().getSnapshot();
    expect(snapshot.error?.code).toBe("file_missing");
    expect(snapshot.servers).toEqual([]);
  });

  it("file corrupt (invalid JSON) returns file_corrupt error", async () => {
    await writeConfig("{ not valid json");
    const snapshot = await createService().getSnapshot();
    expect(snapshot.error?.code).toBe("file_corrupt");
    expect(snapshot.servers).toEqual([]);
  });

  it("top-level non-object returns file_corrupt error", async () => {
    await writeConfig('"just a string"');
    const snapshot = await createService().getSnapshot();
    expect(snapshot.error?.code).toBe("file_corrupt");
  });

  it("toggle flips enabled and writes atomically with .bak", async () => {
    await writeConfig(fixtureWithComments);
    const service = createService();

    const result = await service.toggle("filesystem", false);
    expect(result.ok).toBe(true);

    // .bak should exist
    expect(existsSync(`${configPath}.bak`)).toBe(true);

    // Read back: filesystem should now be disabled
    const snapshot = await service.getSnapshot();
    expect(snapshot.servers.find((s) => s.name === "filesystem")?.enabled).toBe(false);

    // brave-search should remain unchanged
    expect(snapshot.servers.find((s) => s.name === "brave-search")?.enabled).toBe(false);
  });

  it("toggle enables a disabled server", async () => {
    await writeConfig(fixtureWithComments);
    const service = createService();

    const result = await service.toggle("brave-search", true);
    expect(result.ok).toBe(true);

    const snapshot = await service.getSnapshot();
    expect(snapshot.servers.find((s) => s.name === "brave-search")?.enabled).toBe(true);
  });

  it("toggle non-existent server returns not_found", async () => {
    await writeConfig(fixtureWithComments);
    const result = await createService().toggle("ghost", false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_found");
  });

  it("toggle on file with no mcp field returns file_corrupt", async () => {
    await writeConfig('{ "other": true }');
    const result = await createService().toggle("anything", false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("file_corrupt");
  });

  it("toggle on missing file returns file_corrupt (from readFile error)", async () => {
    const result = await createService().toggle("anything", false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("file_corrupt");
  });

  it("subscribe + external file change fires listener with new snapshot", async () => {
    await writeConfig(fixtureWithComments);
    const service = createService();
    const snapshots: unknown[] = [];

    const unsub = service.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    try {
      // Start with a known snapshot
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate external change by writing a new config
      await writeFile(
        configPath,
        JSON.stringify({
          mcp: {
            "new-server": { type: "custom", enabled: true },
          },
        }),
        "utf-8",
      );

      // Wait for watcher to fire
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(snapshots.length).toBeGreaterThan(0);
      const last = snapshots[snapshots.length - 1] as { servers: Array<{ name: string }> };
      expect(last.servers.some((s) => s.name === "new-server")).toBe(true);
    } finally {
      unsub();
    }
  });

  it("subscribe returns unsubscribe function that stops watcher", async () => {
    await writeConfig(fixtureWithComments);
    const service = createService();
    const snapshots: unknown[] = [];

    const unsub = service.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    // Give watcher time to arm
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsub();

    // Write a change after unsubscribe
    await writeFile(configPath, JSON.stringify({ mcp: { x: { type: "y" } } }), "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should not have fired after unsubscribe
    expect(snapshots.length).toBe(0);
  });
});
