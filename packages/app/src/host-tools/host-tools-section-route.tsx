/**
 * Shared wrapper for the three host-tools section routes
 * (`/h/[serverId]/host-tools/{quota,roles,skills}`).
 *
 * - Enforces the host bootstrap boundary.
 * - Resolves the `serverId` route param.
 * - Renders the screen if the matching capability is on, otherwise shows
 *   a localized empty state. The empty state is what the spec calls
 *   "the screen with an empty/error state shell" — the host cannot serve
 *   the requested section, so the route renders something honest rather
 *   than throwing or silently succeeding.
 */
import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HostToolsScreenContainer } from "@/host-tools/host-tools-screen-container";
import { useHostToolsFeatures } from "@/host-tools/use-host-tools-features";
import type { HostToolsCapabilities } from "@/host-tools/types";

export interface HostToolsSectionRouteProps {
  /** Section key — the route file provides this. */
  capability: "quota" | "roles" | "skills";
  /** Render prop for the actual screen, called with the resolved serverId. */
  children: (input: { serverId: string }) => ReactNode;
}

export function HostToolsSectionRoute({ capability, children }: HostToolsSectionRouteProps) {
  return (
    <HostRouteBootstrapBoundary>
      <HostToolsSectionRouteContent capability={capability}>
        {children}
      </HostToolsSectionRouteContent>
    </HostRouteBootstrapBoundary>
  );
}

interface HostToolsSectionRouteContentProps {
  capability: "quota" | "roles" | "skills";
  children: (input: { serverId: string }) => ReactNode;
}

function HostToolsSectionRouteContent({ capability, children }: HostToolsSectionRouteContentProps) {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  const features = useHostToolsFeatures(serverId);
  const { t } = useTranslation();

  const supported = useMemo(() => isCapabilityOn(features, capability), [features, capability]);

  if (!serverId) {
    return (
      <HostToolsScreenContainer scrollable={false}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("hostTools.empty.title")}</Text>
          <Text style={styles.emptyHint}>{t("hostTools.empty.hint")}</Text>
        </View>
      </HostToolsScreenContainer>
    );
  }

  if (!supported) {
    return (
      <HostToolsScreenContainer scrollable={false} testID={`host-tools-${capability}-unsupported`}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t(`hostTools.unsupported.${capability}.title`)}</Text>
          <Text style={styles.emptyHint}>{t(`hostTools.unsupported.${capability}.hint`)}</Text>
        </View>
      </HostToolsScreenContainer>
    );
  }

  return <>{children({ serverId })}</>;
}

function isCapabilityOn(features: HostToolsCapabilities, capability: "quota" | "roles" | "skills") {
  return features[capability] === true;
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
