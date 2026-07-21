/**
 * Host tools — re-exports the wire types the UI consumes from the protocol
 * package and a single `HostToolsCapabilities` view of the
 * `serverInfo.features.hostTools` capability bit. The capability gate is the
 * single detection point; the rest of the host-tools UI imports `useHostToolsFeatures`
 * rather than reading `serverInfo` itself.
 */
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import type {
  HostRolesListModelsResult,
  HostToolsActionResult,
} from "@getpaseo/client/internal/daemon-client";

export type {
  HostQuotaSnapshot,
  HostQuotaProvider,
  HostQuotaEntry,
  HostRolesSnapshot,
  HostRoleAssignment,
  HostSkill,
  HostSkillGroup,
  HostSkillInstance,
  HostSkillsSnapshot,
  HostToolsError,
  HostMcpServer,
  HostMcpSnapshot,
} from "@getpaseo/protocol/messages";

export type { HostToolsActionResult, HostRolesListModelsResult };

type ServerInfoFeatures = NonNullable<ServerInfoStatusPayload["features"]>;
export type HostToolsFeaturesField = NonNullable<ServerInfoFeatures["hostTools"]>;

/**
 * Each capability the daemon may advertise. The keys match the field names on
 * `serverInfo.features.hostTools` so the detection site can do a single
 * truthy check per capability.
 */
export type HostToolsCapability = "quota" | "roles" | "skills" | "mcp";

export interface HostToolsCapabilities {
  quota: boolean;
  roles: boolean;
  skills: boolean;
  mcp: boolean;
  hasAny: boolean;
}

export const HOST_TOOLS_DEFAULT_CAPABILITIES: HostToolsCapabilities = {
  quota: false,
  roles: false,
  skills: false,
  mcp: false,
  hasAny: false,
};

export function resolveHostToolsCapabilities(
  field: HostToolsFeaturesField | null | undefined,
): HostToolsCapabilities {
  const quota = field?.quota === true;
  const roles = field?.roles === true;
  const skills = field?.skills === true;
  const mcp = field?.mcp === true;
  return {
    quota,
    roles,
    skills,
    mcp,
    hasAny: quota || roles || skills || mcp,
  };
}

/**
 * A small unified shape for the surfaces that show "this host doesn't have
 * quota/roles/skills" rather than rendering an empty state. The structured
 * error codes come from the daemon and are matched 1:1 in the UI.
 */
export type HostToolsErrorCode =
  | "file_missing"
  | "file_corrupt"
  | "version_mismatch"
  | "cli_missing"
  | "cooldown"
  | "in_progress"
  | "config_missing"
  | "config_corrupt"
  | "no_active_preset"
  | "invalid_model"
  | "move_conflict"
  | "permission_denied"
  | "unknown";

export function classifyHostToolsError(code: string | null | undefined): HostToolsErrorCode {
  if (code === "file_missing") return "file_missing";
  if (code === "file_corrupt") return "file_corrupt";
  if (code === "version_mismatch") return "version_mismatch";
  if (code === "cli_missing") return "cli_missing";
  if (code === "cooldown") return "cooldown";
  if (code === "in_progress") return "in_progress";
  if (code === "config_missing") return "config_missing";
  if (code === "config_corrupt") return "config_corrupt";
  if (code === "no_active_preset") return "no_active_preset";
  if (code === "invalid_model") return "invalid_model";
  if (code === "move_conflict") return "move_conflict";
  if (code === "permission_denied") return "permission_denied";
  return "unknown";
}

/**
 * The well-known 5-minute freshness window VSCode quota-panel uses. The
 * UI uses this to mark a snapshot as stale when the daemon hasn't pushed
 * a new one within the threshold.
 */
export const HOST_TOOLS_QUOTA_STALE_AFTER_MS = 5 * 60 * 1000;
