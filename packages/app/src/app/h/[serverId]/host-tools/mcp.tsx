/**
 * `/h/[serverId]/host-tools/mcp` — MCP server management route. Renders
 * the MCP screen when the host advertises
 * `features.hostTools.mcp`; otherwise the shared section route wrapper
 * shows an empty state. The header bar with the section title is always
 * visible so the user has a stable anchor.
 */
import { HostMcpScreen } from "@/host-tools/host-mcp-screen";
import { HostToolsHeader } from "@/host-tools/host-tools-header";
import { HostToolsScreenContainer } from "@/host-tools/host-tools-screen-container";
import { HostToolsSectionRoute } from "@/host-tools/host-tools-section-route";

export default function HostToolsMcpRoute() {
  return (
    <HostToolsSectionRoute capability="mcp">
      {({ serverId }) => (
        <>
          <HostToolsHeader serverId={serverId} section="mcp" />
          <HostToolsScreenContainer>
            <HostMcpScreen serverId={serverId} />
          </HostToolsScreenContainer>
        </>
      )}
    </HostToolsSectionRoute>
  );
}
