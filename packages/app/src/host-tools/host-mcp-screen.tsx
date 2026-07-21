/**
 * MCP screen (host-tools) — flat list of MCP servers with enable/disable
 * switches. Simpler than the skills screen (no groups, no CRUD).
 *
 * The screen subscribes to `host.mcp.changed` so edits from the host
 * propagate here without a manual reload.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/contexts/toast-context";
import type { HostMcpServer } from "./types";
import { useHostMcp } from "./use-host-mcp";
import { useResolveHostToolsError } from "./format-helpers";

interface HostMcpScreenProps {
  serverId: string;
}

export function HostMcpScreen({ serverId }: HostMcpScreenProps) {
  const { t } = useTranslation();
  const mcp = useHostMcp(serverId);
  const toast = useToast();

  const snapshotError = useResolveHostToolsError(
    mcp.snapshot?.error?.code,
    mcp.snapshot?.error?.message ?? null,
  );
  const fetchError = useResolveHostToolsError(null, mcp.error);

  const handleToggle = useCallback(
    async (server: HostMcpServer) => {
      const nextEnabled = !server.enabled;
      const result = await mcp.toggle(server.name, nextEnabled);
      if (result === null) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error?.message ?? t("hostTools.mcp.toggleFailed"));
      }
    },
    [mcp, toast, t],
  );

  if (mcp.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner color={styles.loadingSpinner.color} size="large" />
        <Text style={styles.loadingText}>{t("hostTools.mcp.loading")}</Text>
      </View>
    );
  }

  const servers = mcp.servers;
  const isEmpty = servers.length === 0 && !snapshotError && !fetchError;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.intro}>
        <View style={styles.introText}>
          <Text style={styles.title}>{t("hostTools.mcp.title")}</Text>
          <Text style={styles.subtitle}>
            {t("hostTools.mcp.subtitle", { count: servers.length })}
          </Text>
        </View>
      </View>

      <Text style={styles.hint}>{t("hostTools.mcp.newSessionHint")}</Text>

      {snapshotError ? (
        <Alert
          variant="error"
          title={snapshotError.title}
          description={snapshotError.description ?? undefined}
        />
      ) : null}

      {fetchError ? (
        <Alert
          variant="error"
          title={fetchError.title}
          description={fetchError.description ?? undefined}
        />
      ) : null}

      {isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("hostTools.mcp.empty.title")}</Text>
          <Text style={styles.emptyHint}>{t("hostTools.mcp.empty.hint")}</Text>
        </View>
      ) : null}

      {servers.map((server) => (
        <McpServerRow
          key={server.name}
          server={server}
          isPending={mcp.pendingToggles.has(server.name)}
          onToggle={handleToggle}
        />
      ))}
    </ScrollView>
  );
}

interface McpServerRowProps {
  server: HostMcpServer;
  isPending: boolean;
  onToggle: (server: HostMcpServer) => void;
}

function McpServerRow({ server, isPending, onToggle }: McpServerRowProps) {
  const { t } = useTranslation();

  const handleToggleValue = useCallback(() => {
    onToggle(server);
  }, [onToggle, server]);

  return (
    <View style={styles.serverRow}>
      <View style={styles.serverInfo}>
        <Text style={styles.serverName}>{server.name}</Text>
        <Text style={styles.serverMeta}>
          {t("hostTools.mcp.serverMeta", {
            type: server.type ?? "local",
            command: server.command?.[0] ?? "",
          })}
        </Text>
      </View>
      <Switch
        value={server.enabled}
        onValueChange={handleToggleValue}
        disabled={isPending}
        accessibilityLabel={t("hostTools.mcp.toggleServer", { name: server.name })}
        testID={`host-mcp-switch-${server.name}`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[3],
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  loadingSpinner: {
    color: theme.colors.foregroundMuted,
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  intro: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  introText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    gap: theme.spacing[2],
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
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  serverInfo: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  serverName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  serverMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
