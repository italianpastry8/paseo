/**
 * Shared screen header for the three host-tools section screens. The
 * header sits above the screen content; the screen content lives in the
 * `<HostToolsScreenContainer>` so the layout always renders the title
 * + back button even when the screen body is empty.
 *
 * Renders inside the same `BackHeader` primitive the settings screen uses
 * so the navigation pattern matches the rest of the app.
 */
import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { BackHeader } from "@/components/headers/back-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { useHostToolsFeatures } from "./use-host-tools-features";

interface HostToolsHeaderProps {
  serverId: string;
  section: "quota" | "roles" | "skills";
  trailing?: ReactNode;
}

export function HostToolsHeader({ serverId, section, trailing }: HostToolsHeaderProps) {
  const { t } = useTranslation();
  // Features are read so the header re-renders if the capability flips off
  // after the screen has been mounted (e.g. daemon reconnect with a
  // different serverInfo). The hook returns a stable shape so this just
  // subscribes the header to serverInfo changes — it does not gate render.
  useHostToolsFeatures(serverId);
  const sectionLabel = t(`hostTools.sections.${section}.title`);
  const sectionHint = t(`hostTools.sections.${section}.subtitle`);
  const sectionBadge = t(`hostTools.sections.${section}.badge`);
  const titleAccessory = useMemo(
    () => (
      <View style={styles.headerAccessory}>
        <StatusBadge label={sectionBadge} />
        {sectionHint ? <Text style={styles.subtitle}>{sectionHint}</Text> : null}
      </View>
    ),
    [sectionBadge, sectionHint],
  );
  return (
    <BackHeader title={sectionLabel} titleAccessory={titleAccessory} rightContent={trailing} />
  );
}

const styles = StyleSheet.create((theme) => ({
  headerAccessory: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
