import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type pino from "pino";
import type { HostQuotaSnapshot, HostToolsError } from "../messages.js";
import { DebouncedFileWatch } from "./file-watch.js";
import { normalizeQuotaExport, type RawQuotaExport } from "./quota-normalize.js";

export interface HostQuotaServiceOptions {
  exportPath: string;
  cliPath: string;
  configPath: string;
  logger: pino.Logger;
  nodeCommand?: string;
  refreshTimeoutMs?: number;
  refreshCooldownMs?: number;
  pollIntervalMs?: number;
}

export interface QuotaRefreshResult {
  ok: boolean;
  error?: HostToolsError;
}

type QuotaSnapshotListener = (snapshot: HostQuotaSnapshot) => void;

interface QuotaConfigFile {
  enabledProviders?: string[];
}

const REFRESH_TIMEOUT_DEFAULT_MS = 60_000;
const REFRESH_COOLDOWN_DEFAULT_MS = 30_000;
const POLL_INTERVAL_DEFAULT_MS = 30_000;

/**
 * Daemon-side owner of the opencode quota export file shared with the VS Code
 * quota-panel extension. Reads and normalizes the export JSON, merges the
 * enabledProviders config, watches the file for external refreshes, and runs
 * the refresh CLI on demand.
 */
export class HostQuotaService {
  private readonly exportPath: string;
  private readonly cliPath: string;
  private readonly configPath: string;
  private readonly logger: pino.Logger;
  private readonly nodeCommand: string;
  private readonly refreshTimeoutMs: number;
  private readonly refreshCooldownMs: number;
  private readonly pollIntervalMs: number;

  private lastGood: HostQuotaSnapshot | null = null;
  private lastPublishedJson: string | null = null;
  private lastMtimeMs = 0;
  private refreshing = false;
  private lastRefreshStartedAt = 0;
  private readonly listeners = new Set<QuotaSnapshotListener>();
  private watcher: DebouncedFileWatch | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(options: HostQuotaServiceOptions) {
    this.exportPath = options.exportPath;
    this.cliPath = options.cliPath;
    this.configPath = options.configPath;
    this.logger = options.logger;
    this.nodeCommand = options.nodeCommand ?? "node";
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? REFRESH_TIMEOUT_DEFAULT_MS;
    this.refreshCooldownMs = options.refreshCooldownMs ?? REFRESH_COOLDOWN_DEFAULT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_DEFAULT_MS;
  }

  isAvailable(): boolean {
    return existsSync(dirname(this.exportPath)) || existsSync(this.exportPath);
  }

  start(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = new DebouncedFileWatch({
      path: this.exportPath,
      debounceMs: 100,
      onChange: () => {
        void this.reloadAndPublish("watch");
      },
    });
    this.pollTimer = setInterval(() => {
      void this.pollMtime();
    }, this.pollIntervalMs);
    this.pollTimer.unref();
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.listeners.clear();
  }

  onSnapshotChanged(listener: QuotaSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSnapshot(): Promise<HostQuotaSnapshot> {
    const enabledProviders = await this.readEnabledProviders();
    try {
      const text = await readFile(this.exportPath, "utf-8");
      const mtime = (await stat(this.exportPath)).mtimeMs;
      this.lastMtimeMs = mtime;
      const parsed = JSON.parse(text) as RawQuotaExport;
      const snapshot: HostQuotaSnapshot = {
        ...normalizeQuotaExport(parsed),
        ...(enabledProviders ? { enabledProviders } : {}),
      };
      this.lastGood = snapshot;
      return snapshot;
    } catch (error) {
      return this.snapshotForReadError(error, enabledProviders);
    }
  }

  async refresh(): Promise<QuotaRefreshResult> {
    if (this.refreshing) {
      return { ok: false, error: { code: "in_progress", message: "刷新已在进行中" } };
    }
    const now = Date.now();
    if (now - this.lastRefreshStartedAt < this.refreshCooldownMs) {
      const remainSec = Math.ceil(
        (this.refreshCooldownMs - (now - this.lastRefreshStartedAt)) / 1000,
      );
      return {
        ok: false,
        error: { code: "cooldown", message: `刷新冷却中,请 ${remainSec} 秒后再试` },
      };
    }
    if (!existsSync(this.cliPath)) {
      return {
        ok: false,
        error: { code: "cli_missing", message: `未找到额度刷新 CLI:${this.cliPath}` },
      };
    }

    this.refreshing = true;
    this.lastRefreshStartedAt = now;
    try {
      const result = await this.runRefreshCli();
      if (!result.ok) {
        return result;
      }
      await this.reloadAndPublish("refresh");
      return result;
    } finally {
      this.refreshing = false;
    }
  }

  private async readEnabledProviders(): Promise<string[] | undefined> {
    try {
      const text = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(text) as QuotaConfigFile;
      if (Array.isArray(parsed.enabledProviders)) {
        return parsed.enabledProviders.filter((p): p is string => typeof p === "string");
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private snapshotForReadError(error: unknown, enabledProviders?: string[]): HostQuotaSnapshot {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    let toolsError: HostToolsError;
    if (code === "ENOENT") {
      toolsError = { code: "file_missing", message: "额度数据文件不存在" };
    } else if (error instanceof SyntaxError) {
      toolsError = { code: "file_corrupt", message: `JSON 解析失败:${error.message}` };
    } else {
      toolsError = {
        code: "read_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const base = this.lastGood ?? { providers: [] };
    return {
      ...base,
      ...(enabledProviders ? { enabledProviders } : {}),
      error: toolsError,
    };
  }

  private async pollMtime(): Promise<void> {
    this.watcher?.arm();
    try {
      const stats = await stat(this.exportPath);
      if (stats.mtimeMs !== this.lastMtimeMs) {
        await this.reloadAndPublish("poll");
      }
    } catch {
      // Export file missing; nothing to publish.
    }
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
      this.logger.warn({ err: error, reason }, "host quota reload failed");
    }
  }

  private runRefreshCli(): Promise<QuotaRefreshResult> {
    return new Promise((resolve) => {
      const child = spawn(this.nodeCommand, [this.cliPath, "fetch", "--json"], {
        shell: false,
        windowsHide: true,
        timeout: this.refreshTimeoutMs,
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      child.on("error", (error) => {
        resolve({
          ok: false,
          error: { code: "cli_failed", message: error.message },
        });
      });
      child.on("close", (exitCode, signal) => {
        if (signal) {
          resolve({
            ok: false,
            error: { code: "cli_failed", message: `进程被 ${signal} 终止` },
          });
          return;
        }
        if (exitCode === 0) {
          resolve({ ok: true });
          return;
        }
        if (exitCode === 1) {
          resolve({
            ok: true,
            error: { code: "partial_failure", message: "部分平台刷新失败" },
          });
          return;
        }
        const excerpt = stderr.trim().split("\n").slice(0, 3).join("; ") || "未知错误";
        resolve({
          ok: false,
          error: { code: "cli_failed", message: `CLI 错误:${excerpt}` },
        });
      });
    });
  }
}
