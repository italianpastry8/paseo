import { copyFileSync, existsSync, renameSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type pino from "pino";
import type { HostMcpServer, HostMcpSnapshot, HostToolsError } from "../messages.js";
import { DebouncedFileWatch } from "./file-watch.js";
import { stripJsoncComments } from "./strip-jsonc.js";

export interface HostMcpServiceOptions {
  configPath: string;
  logger: pino.Logger;
  debounceMs?: number;
}

export interface HostMcpToggleResult {
  ok: boolean;
  error?: HostToolsError;
}

type McpSnapshotListener = (snapshot: HostMcpSnapshot) => void;

export class HostMcpService {
  private readonly configPath: string;
  private readonly logger: pino.Logger;
  private readonly debounceMs: number;
  private readonly listeners = new Set<McpSnapshotListener>();
  private watcher: DebouncedFileWatch | null = null;
  private lastPublishedJson: string | null = null;

  constructor(options: HostMcpServiceOptions) {
    this.configPath = options.configPath;
    this.logger = options.logger;
    this.debounceMs = options.debounceMs ?? 100;
  }

  isAvailable(): boolean {
    return existsSync(this.configPath);
  }

  start(): void {
    if (this.watcher) return;
    this.watcher = new DebouncedFileWatch({
      path: this.configPath,
      debounceMs: this.debounceMs,
      onChange: () => {
        void this.reloadAndPublish("watch");
      },
      onError: (err) => {
        this.logger.warn({ err }, "mcp watcher error");
      },
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  subscribe(listener: McpSnapshotListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  async getSnapshot(): Promise<HostMcpSnapshot> {
    return this.loadSnapshot();
  }

  async toggle(name: string, enable: boolean): Promise<HostMcpToggleResult> {
    try {
      const raw = await readFile(this.configPath, "utf-8");
      const cleaned = stripJsoncComments(raw);
      const parsed = JSON.parse(cleaned);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          ok: false,
          error: { code: "file_corrupt", message: "opencode.jsonc 顶层不是 JSON 对象" },
        };
      }
      const mcp = (parsed as Record<string, unknown>).mcp;
      if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp)) {
        return {
          ok: false,
          error: { code: "file_corrupt", message: "opencode.jsonc 无 mcp 对象" },
        };
      }
      const server = (mcp as Record<string, unknown>)[name];
      if (server === undefined || typeof server !== "object" || server === null) {
        return { ok: false, error: { code: "not_found", message: `未找到 MCP server:${name}` } };
      }
      (server as Record<string, unknown>).enabled = enable;
      copyFileSync(this.configPath, `${this.configPath}.bak`);
      const trailing = raw.endsWith("\n") ? "\n" : "";
      const content = JSON.stringify(parsed, null, 2) + trailing;
      await atomicWrite(this.configPath, content);
      void this.reloadAndPublish("toggle");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: writeErrorToToolsError(err) };
    }
  }

  private async reloadAndPublish(_reason: string): Promise<void> {
    const snapshot = await this.loadSnapshot();
    const json = JSON.stringify(snapshot);
    if (this.lastPublishedJson === json) return;
    this.lastPublishedJson = json;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        this.logger.warn({ err }, "mcp listener threw");
      }
    }
  }

  private async loadSnapshot(): Promise<HostMcpSnapshot> {
    try {
      if (!existsSync(this.configPath)) {
        return { servers: [], error: { code: "file_missing", message: "opencode.jsonc 不存在" } };
      }
      const raw = await readFile(this.configPath, "utf-8");
      const cleaned = stripJsoncComments(raw);
      const parsed = JSON.parse(cleaned);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          servers: [],
          error: { code: "file_corrupt", message: "opencode.jsonc 顶层不是 JSON 对象" },
        };
      }
      const mcp = (parsed as Record<string, unknown>).mcp;
      if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp)) {
        return { servers: [] }; // no mcp field = empty list, not an error
      }
      const servers: HostMcpServer[] = Object.entries(mcp).map(([name, cfg]) => {
        const s = (typeof cfg === "object" && cfg !== null ? cfg : {}) as Record<string, unknown>;
        const server: HostMcpServer = {
          name,
          enabled: typeof s.enabled === "boolean" ? s.enabled : true, // default true per opencode semantics
        };
        if (typeof s.type === "string") server.type = s.type;
        if (Array.isArray(s.command)) {
          server.command = s.command.filter((c): c is string => typeof c === "string");
        }
        if (typeof s.env === "object" && s.env !== null && !Array.isArray(s.env)) {
          const env: Record<string, string> = {};
          for (const [k, v] of Object.entries(s.env as Record<string, unknown>)) {
            if (typeof v === "string") env[k] = v;
          }
          server.env = env;
        }
        return server;
      });
      return { servers };
    } catch (err) {
      return { servers: [], error: writeErrorToToolsError(err) };
    }
  }
}

function writeErrorToToolsError(error: unknown): HostToolsError {
  return {
    code: "file_corrupt",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function atomicWrite(configPath: string, content: string): Promise<void> {
  const dir = dirname(configPath);
  const tmp = join(dir, `.${basename(configPath)}.tmp`);
  await writeFile(tmp, content, "utf-8");
  renameSync(tmp, configPath);
}
