/**
 * `/h/[serverId]/host-tools` — entry route. Reads the negotiated
 * `features.hostTools` field on the host's `serverInfo` and redirects to
 * the first available tool screen. If no capability is advertised (or the
 * host is offline / has not finished the handshake), the route renders an
 * empty state rather than navigating to a section that would render an
 * error.
 */
import { useMemo } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HostToolsScreenContainer } from "@/host-tools/host-tools-screen-container";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  buildHostToolsQuotaRoute,
  buildHostToolsRolesRoute,
  buildHostToolsSkillsRoute,
  buildHostToolsMcpRoute,
} from "@/host-tools/routes";
import { useHostToolsFeatures } from "@/host-tools/use-host-tools-features";

export default function HostToolsIndexRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostToolsIndexContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostToolsIndexContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  const features = useHostToolsFeatures(serverId);
  const { t } = useTranslation();

  const fallback = useMemo(() => {
    if (features.quota) {
      return buildHostToolsQuotaRoute(serverId);
    }
    if (features.roles) {
      return buildHostToolsRolesRoute(serverId);
    }
    if (features.skills) {
      return buildHostToolsSkillsRoute(serverId);
    }
    if (features.mcp) {
      return buildHostToolsMcpRoute(serverId);
    }
    return null;
  }, [features.quota, features.roles, features.skills, features.mcp, serverId]);

  if (fallback) {
    return <Redirect href={fallback} />;
  }

  return (
    <HostToolsScreenContainer testID="host-tools-empty" scrollable={false}>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t("hostTools.empty.title")}</Text>
        <Text style={styles.emptyHint}>{t("hostTools.empty.hint")}</Text>
      </View>
    </HostToolsScreenContainer>
  );
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  emptyHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
