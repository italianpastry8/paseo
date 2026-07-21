/**
 * Route builders for the host-tools screens. Centralized so callers in the
 * workspace header and the host-tools screens themselves stay in sync.
 */
import type { Href } from "expo-router";
import { buildHostRootRoute } from "@/utils/host-routes";

export type HostToolsSection = "quota" | "roles" | "skills" | "mcp";

const HOST_TOOLS_SECTIONS: readonly HostToolsSection[] = ["quota", "roles", "skills", "mcp"];

export function isHostToolsSection(value: string): value is HostToolsSection {
  return (HOST_TOOLS_SECTIONS as readonly string[]).includes(value);
}

export function buildHostToolsRoute(serverId: string, section: HostToolsSection): Href {
  const base = buildHostRootRoute(serverId);
  return `${base}/host-tools/${section}` as Href;
}

export function buildHostToolsQuotaRoute(serverId: string): Href {
  return buildHostToolsRoute(serverId, "quota");
}

export function buildHostToolsRolesRoute(serverId: string): Href {
  return buildHostToolsRoute(serverId, "roles");
}

export function buildHostToolsSkillsRoute(serverId: string): Href {
  return buildHostToolsRoute(serverId, "skills");
}

export function buildHostToolsMcpRoute(serverId: string): Href {
  return buildHostToolsRoute(serverId, "mcp");
}

export function buildHostToolsIndexRoute(serverId: string): Href {
  const base = buildHostRootRoute(serverId);
  return `${base}/host-tools` as Href;
}
