import type { HostQuotaEntry, HostQuotaProvider, HostQuotaSnapshot } from "../messages.js";

export interface RawQuotaEntry {
  name: string;
  window?: string;
  percentRemaining?: number;
  percentUsed?: number;
  value?: string;
  resetAt?: number | string;
  unlimited?: boolean;
  [key: string]: unknown;
}

export interface RawQuotaProvider {
  status: "ok" | "error" | "unavailable" | string;
  fetchedAt?: number | string;
  error?: string;
  entries?: RawQuotaEntry[];
  [key: string]: unknown;
}

export interface RawQuotaExport {
  version: number;
  exportedAt?: number | string;
  fromCache?: boolean;
  cacheAgeSeconds?: number;
  providers?: Record<string, RawQuotaProvider>;
  [key: string]: unknown;
}

const PROVIDER_LABELS: Record<string, string> = {
  "kimi-for-coding": "Kimi",
  "opencode-go": "Go",
  ailink: "AILink",
  "google-antigravity": "Google",
  "google-gemini-cli": "Gemini",
  anthropic: "Claude",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  zhipu: "Zhipu",
  zai: "Z.ai",
  "minimax-coding-plan": "MiniMax",
};

export function quotaProviderLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeEntry(raw: RawQuotaEntry): HostQuotaEntry {
  let percentRemaining: number | undefined;
  if (typeof raw.percentRemaining === "number") {
    percentRemaining = raw.percentRemaining;
  } else if (typeof raw.percentUsed === "number") {
    percentRemaining = Math.max(0, 100 - raw.percentUsed);
  }
  return {
    name: String(raw.name ?? ""),
    window: raw.window ? String(raw.window) : undefined,
    percentRemaining,
    value: raw.value ? String(raw.value) : undefined,
    resetAtMs: normalizeTimestampMs(raw.resetAt),
    unlimited: raw.unlimited === true,
  };
}

function normalizeProvider(id: string, raw: RawQuotaProvider): HostQuotaProvider {
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map((entry) => normalizeEntry(entry))
    : [];
  return {
    id,
    label: quotaProviderLabel(id),
    status: raw.status === "ok" ? "ok" : "error",
    error: typeof raw.error === "string" ? raw.error : undefined,
    fetchedAtMs: normalizeTimestampMs(raw.fetchedAt),
    entries,
  };
}

/**
 * Ported from the VS Code quota-panel extension's exportTypes.ts: the two
 * sides must agree on normalization so both UIs render identical numbers.
 */
export function normalizeQuotaExport(raw: RawQuotaExport): HostQuotaSnapshot {
  if (raw.version !== 1) {
    return { providers: [], versionMismatch: true };
  }
  const providers: HostQuotaProvider[] = [];
  for (const [id, provider] of Object.entries(raw.providers ?? {})) {
    if (!provider || typeof provider !== "object") {
      continue;
    }
    providers.push(normalizeProvider(id, provider));
  }
  return {
    generatedAtMs: normalizeTimestampMs(raw.exportedAt),
    providers,
  };
}
