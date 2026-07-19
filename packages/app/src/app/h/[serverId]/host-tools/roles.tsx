/**
 * `/h/[serverId]/host-tools/roles` — role/model switcher route. Renders
 * the roles screen when the host advertises
 * `features.hostTools.roles`; otherwise the shared section route wrapper
 * shows an empty state. The header bar with the section title is always
 * visible so the user has a stable anchor.
 */
import { HostRolesScreen } from "@/host-tools/host-roles-screen";
import { HostToolsHeader } from "@/host-tools/host-tools-header";
import { HostToolsScreenContainer } from "@/host-tools/host-tools-screen-container";
import { HostToolsSectionRoute } from "@/host-tools/host-tools-section-route";

export default function HostToolsRolesRoute() {
  return (
    <HostToolsSectionRoute capability="roles">
      {({ serverId }) => (
        <>
          <HostToolsHeader serverId={serverId} section="roles" />
          <HostToolsScreenContainer>
            <HostRolesScreen serverId={serverId} />
          </HostToolsScreenContainer>
        </>
      )}
    </HostToolsSectionRoute>
  );
}
