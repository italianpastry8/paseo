/**
 * Host tools capability detection.
 *
 * The single detection point for `serverInfo.features.hostTools`. The daemon
 * negotiates which surfaces (quota, roles, skills) the host supports when the
 * client connects, and this hook exposes those booleans in a stable shape
 * that the rest of the host-tools UI can switch on without re-reading the
 * raw serverInfo object.
 *
 * `serverId` is accepted as nullable so consumers in conditional render
 * paths (e.g. before route params resolve) can pass `null` and get a fully
 * `false` capability bit set rather than throwing.
 */
import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import {
  HOST_TOOLS_DEFAULT_CAPABILITIES,
  resolveHostToolsCapabilities,
  type HostToolsCapabilities,
} from "./types";

export function useHostToolsFeatures(serverId: string | null | undefined): HostToolsCapabilities {
  const normalizedServerId = serverId?.trim() ?? "";
  const hostToolsField = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.serverInfo?.features?.hostTools ?? null,
  );

  return useMemo(
    () =>
      normalizedServerId
        ? resolveHostToolsCapabilities(hostToolsField)
        : HOST_TOOLS_DEFAULT_CAPABILITIES,
    [normalizedServerId, hostToolsField],
  );
}
