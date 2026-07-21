import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

export function resolveHomePath(input: string): string {
  const expanded = expandHome(input);
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export interface HostToolsPaths {
  quotaExportPath: string;
  quotaCliPath: string;
  quotaConfigPath: string;
  omoConfigPath: string;
  skillManagerStatePath: string;
  opencodeCommand: string;
  opencodeConfigPath: string;
}

export function defaultHostToolsPaths(): HostToolsPaths {
  return {
    quotaExportPath: resolveHomePath("~/.cache/opencode/quota-export.json"),
    quotaCliPath: resolveHomePath(
      "~/.config/opencode/local-plugins/opencode-quota-ailink/dist/bin/opencode-quota.js",
    ),
    quotaConfigPath: resolveHomePath("~/.config/opencode/opencode-quota/quota-toast.json"),
    omoConfigPath: resolveHomePath("~/.config/opencode/oh-my-opencode-slim.json"),
    skillManagerStatePath: resolveHomePath("~/.agents/skill-manager.json"),
    opencodeCommand: "opencode",
    opencodeConfigPath: resolveHomePath("~/.config/opencode/opencode.jsonc"),
  };
}
