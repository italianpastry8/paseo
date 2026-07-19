/**
 * `/h/[serverId]/host-tools/skills` — skill management route. Renders
 * the skills screen when the host advertises
 * `features.hostTools.skills`; otherwise the shared section route wrapper
 * shows an empty state. The header bar with the section title is always
 * visible so the user has a stable anchor.
 */
import { HostSkillsScreen } from "@/host-tools/host-skills-screen";
import { HostToolsHeader } from "@/host-tools/host-tools-header";
import { HostToolsScreenContainer } from "@/host-tools/host-tools-screen-container";
import { HostToolsSectionRoute } from "@/host-tools/host-tools-section-route";

export default function HostToolsSkillsRoute() {
  return (
    <HostToolsSectionRoute capability="skills">
      {({ serverId }) => (
        <>
          <HostToolsHeader serverId={serverId} section="skills" />
          <HostToolsScreenContainer>
            <HostSkillsScreen serverId={serverId} />
          </HostToolsScreenContainer>
        </>
      )}
    </HostToolsSectionRoute>
  );
}
