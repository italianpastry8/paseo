import { spawn } from "node:child_process";
import { copyFileSync, existsSync, renameSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type pino from "pino";
import type { HostRolesSnapshot, HostToolsError } from "../messages.js";
import { DebouncedFileWatch } from "./file-watch.js";

export interface HostRolesServiceOptions {
  configPath: string;
  logger: pino.Logger;
  opencodeCommand?: string;
  modelsTimeoutMs?: number;
  modelsCacheTtlMs?: number;
  /**
   * Injectable seam for tests: runs the `opencode models` subprocess. The
   * default implementation spawns the process via node:child_process.
   */
  runModelsCommand?: ModelsCommandRunner;
}

export interface HostRolesListModelsResult {
  models: string[];
  cachedAtMs?: number;
  degraded?: boolean;
  error?: HostToolsError;
}

export interface HostRolesSetModelResult {
  ok: boolean;
  error?: HostToolsError;
}

export interface SetModelParams {
  role: string;
  model: string;
  variant?: string;
}

export interface ModelsCommandSuccess {
  ok: true;
  stdout: string;
}

export interface ModelsCommandFailure {
  ok: false;
  error: string;
  stderr?: string;
}

export type ModelsCommandRunner = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<ModelsCommandSuccess | ModelsCommandFailure>;

type RolesSnapshotListener = (snapshot: HostRolesSnapshot) => void;

interface RoleConfig {
  model?: string;
  variant?: string;
  [key: string]: unknown;
}

interface SlimConfigRoot {
  preset?: string;
  presets?: Record<string, Record<string, RoleConfig>>;
  $schema?: string;
  [key: string]: unknown;
}

const MODELS_TIMEOUT_DEFAULT_MS = 10_000;
const MODELS_CACHE_TTL_DEFAULT_MS = 60 * 60 * 1000;
const MODEL_ID_PATTERN = /^[^/]+\/.+/;

/**
 * Daemon-side owner of the oh-my-opencode-slim.json config file shared with
 * the VS Code omo-model-switcher extension. Reads the active preset's role
 * roster, watches the file for external writes, lists available models via
 * the `opencode models` subprocess, and writes back per-role model/variant
 * changes atomically.
 */
export class HostRolesService {
  private readonly configPath: string;
  private readonly logger: pino.Logger;
  private readonly opencodeCommand: string;
  private readonly modelsTimeoutMs: number;
  private readonly modelsCacheTtlMs: number;
  private readonly runModelsCommand: ModelsCommandRunner;

  private lastGood: HostRolesSnapshot | null = null;
  private lastPublishedJson: string | null = null;
  private readonly listeners = new Set<RolesSnapshotListener>();
  private watcher: DebouncedFileWatch | null = null;

  private modelsCache: string[] | null = null;
  private modelsCachedAtMs = 0;

  constructor(options: HostRolesServiceOptions) {
    this.configPath = options.configPath;
    this.logger = options.logger;
    this.opencodeCommand = options.opencodeCommand ?? "opencode";
    this.modelsTimeoutMs = options.modelsTimeoutMs ?? MODELS_TIMEOUT_DEFAULT_MS;
    this.modelsCacheTtlMs = options.modelsCacheTtlMs ?? MODELS_CACHE_TTL_DEFAULT_MS;
    this.runModelsCommand = options.runModelsCommand ?? defaultModelsRunner;
  }

  isAvailable(): boolean {
    return existsSync(dirname(this.configPath));
  }

  start(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = new DebouncedFileWatch({
      path: this.configPath,
      debounceMs: 100,
      onChange: () => {
        void this.reloadAndPublish("watch");
      },
    });
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
  }

  onSnapshotChanged(listener: RolesSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSnapshot(): Promise<HostRolesSnapshot> {
    const extracted = await this.readAndExtract();
    if (extracted.ok) {
      const snapshot: HostRolesSnapshot = {
        presetName: extracted.presetName,
        roles: extracted.roles,
      };
      this.lastGood = snapshot;
      return snapshot;
    }
    return this.snapshotForReadError(extracted.error);
  }

  async listModels(): Promise<HostRolesListModelsResult> {
    const now = Date.now();
    if (this.modelsCache && now - this.modelsCachedAtMs < this.modelsCacheTtlMs) {
      return {
        models: this.modelsCache,
        cachedAtMs: this.modelsCachedAtMs,
      };
    }
    const result = await this.runModelsCommand(this.opencodeCommand, ["models"], {
      timeout: this.modelsTimeoutMs,
    });
    if (result.ok) {
      const models = parseModelsOutput(result.stdout);
      this.modelsCache = models;
      this.modelsCachedAtMs = Date.now();
      return {
        models,
        cachedAtMs: this.modelsCachedAtMs,
      };
    }
    if (this.modelsCache) {
      return {
        models: this.modelsCache,
        cachedAtMs: this.modelsCachedAtMs,
        degraded: true,
      };
    }
    return {
      models: [],
      error: { code: "cli_failed", message: result.error },
    };
  }

  async setModel(params: SetModelParams): Promise<HostRolesSetModelResult> {
    const { role, model, variant } = params;
    if (!MODEL_ID_PATTERN.test(model)) {
      return {
        ok: false,
        error: { code: "invalid_model", message: `模型 ID 必须为 provider/model 格式:${model}` },
      };
    }
    const snapshot = await this.getSnapshot();
    if (snapshot.error) {
      return { ok: false, error: snapshot.error };
    }
    const found = snapshot.roles.find((r) => r.role === role);
    if (!found) {
      return {
        ok: false,
        error: { code: "role_not_found", message: `未找到角色:${role}` },
      };
    }
    try {
      await this.applyModelWrite(role, model, variant);
    } catch (error) {
      const toolsError = writeErrorToToolsError(error);
      return { ok: false, error: toolsError };
    }
    return { ok: true };
  }

  private async readAndExtract(): Promise<
    | { ok: true; presetName: string; roles: HostRolesSnapshot["roles"] }
    | { ok: false; error: HostToolsError }
  > {
    let text: string;
    try {
      text = await readFile(this.configPath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") {
        return { ok: false, error: { code: "file_missing", message: "配置文件不存在" } };
      }
      return {
        ok: false,
        error: {
          code: "read_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "file_corrupt",
          message: `JSON 解析失败:${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
    return extractRoster(parsed);
  }

  private snapshotForReadError(error: HostToolsError): HostRolesSnapshot {
    const base = this.lastGood ?? { roles: [] };
    return {
      ...base,
      error,
    };
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
      this.logger.warn({ err: error, reason }, "host roles reload failed");
    }
  }

  private async applyModelWrite(role: string, model: string, variant?: string): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.configPath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") {
        throw new WriteError("file_missing", "配置文件不存在");
      }
      throw new WriteError("read_failed", error instanceof Error ? error.message : String(error));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new WriteError(
        "file_corrupt",
        `JSON 解析失败:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new WriteError("file_corrupt", "配置顶层不是 JSON 对象");
    }
    const root = parsed as SlimConfigRoot;
    const preset = root.preset;
    const presets = root.presets;
    if (typeof preset !== "string" || typeof presets !== "object" || presets === null) {
      throw new WriteError("no_active_preset", "未找到激活的 preset");
    }
    const active = presets[preset];
    if (typeof active !== "object" || active === null) {
      throw new WriteError("no_active_preset", `未找到激活的 preset:${preset}`);
    }
    const roleCfg = active[role];
    if (typeof roleCfg !== "object" || roleCfg === null) {
      throw new WriteError("role_not_found", `未找到角色:${role}`);
    }
    roleCfg.model = model;
    if (variant !== undefined && Object.prototype.hasOwnProperty.call(roleCfg, "variant")) {
      roleCfg.variant = variant;
    }
    copyFileSync(this.configPath, `${this.configPath}.bak`);
    const trailing = text.endsWith("\n") ? "\n" : "";
    const content = JSON.stringify(parsed, null, 2) + trailing;
    await atomicWrite(this.configPath, content);
  }
}

export class WriteError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "WriteError";
  }
}

function writeErrorToToolsError(error: unknown): HostToolsError {
  if (error instanceof WriteError) {
    return { code: error.kind, message: error.message };
  }
  return {
    code: "write_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function extractRoster(
  parsed: unknown,
):
  | { ok: true; presetName: string; roles: HostRolesSnapshot["roles"] }
  | { ok: false; error: HostToolsError } {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: "file_corrupt", message: "配置顶层不是 JSON 对象" },
    };
  }
  const root = parsed as SlimConfigRoot;
  const preset = root.preset;
  if (typeof preset !== "string" || preset.length === 0) {
    return {
      ok: false,
      error: { code: "no_active_preset", message: "未找到激活的 preset" },
    };
  }
  const presets = root.presets;
  if (typeof presets !== "object" || presets === null || Array.isArray(presets)) {
    return {
      ok: false,
      error: { code: "no_active_preset", message: "未找到激活的 preset" },
    };
  }
  const active = presets[preset];
  if (typeof active !== "object" || active === null || Array.isArray(active)) {
    return {
      ok: false,
      error: { code: "no_active_preset", message: `未找到激活的 preset:${preset}` },
    };
  }
  const roles = Object.entries(active).map(([name, cfg]) => {
    const c: RoleConfig = typeof cfg === "object" && cfg !== null ? (cfg as RoleConfig) : {};
    const assignment: HostRolesSnapshot["roles"][number] = {
      role: name,
      hasVariantField: Object.prototype.hasOwnProperty.call(c, "variant"),
    };
    if (typeof c.model === "string") {
      assignment.model = c.model;
    }
    if (typeof c.variant === "string") {
      assignment.variant = c.variant;
    }
    return assignment;
  });
  return { ok: true, presetName: preset, roles };
}

export function parseModelsOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function atomicWrite(configPath: string, content: string): Promise<void> {
  const dir = dirname(configPath);
  const tmp = join(dir, `.${basename(configPath)}.tmp`);
  await writeFile(tmp, content, "utf-8");
  renameSync(tmp, configPath);
}

const defaultModelsRunner: ModelsCommandRunner = (command, args, options) => {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      timeout: options.timeout,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, error: error.message, stderr });
    });
    child.on("close", (exitCode, signal) => {
      if (signal) {
        resolve({ ok: false, error: `进程被 ${signal} 终止`, stderr });
        return;
      }
      if (exitCode === 0) {
        resolve({ ok: true, stdout });
        return;
      }
      const detail = stderr.trim().split("\n")[0] || `opencode models 退出码 ${exitCode}`;
      resolve({ ok: false, error: detail, stderr });
    });
  });
};
