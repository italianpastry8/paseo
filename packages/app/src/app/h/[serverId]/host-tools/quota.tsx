/**
 * `/h/[serverId]/host-tools/quota` — quota screen route. Renders the quota
 * screen when the host advertises `features.hostTools.quota`; otherwise the
 * shared section route wrapper shows an empty state. The header bar with
 * the section title is always visible so the user has a stable anchor even
 * when the screen body is empty.
 */
import { HostQuotaScreen } from "@/host-tools/host-quota-screen";
import { HostToolsHeader } from "@/host-tools/host-tools-header";
import { HostToolsScreenContainer } from "@/host-tools/host-tools-screen-container";
import { HostToolsSectionRoute } from "@/host-tools/host-tools-section-route";

export default function HostToolsQuotaRoute() {
  return (
    <HostToolsSectionRoute capability="quota">
      {({ serverId }) => (
        <>
          <HostToolsHeader serverId={serverId} section="quota" />
          <HostToolsScreenContainer>
            <HostQuotaScreen serverId={serverId} />
          </HostToolsScreenContainer>
        </>
      )}
    </HostToolsSectionRoute>
  );
}
