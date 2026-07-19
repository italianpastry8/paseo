/**
 * Quota screen (host-tools) — provider cards with progress bars, manual
 * refresh, 5-minute stale marker, and structured error display.
 *
 * The screen subscribes to `host.quota.changed` via `useHostQuota` so the
 * VSCode quota-panel's exports are picked up in real time without a manual
 * reload. The enabled-providers filter is applied here (the daemon may
 * include hidden providers even if the user's UI shouldn't show them), and
 * the 5-minute stale window matches the VSCode plugin's threshold.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  HOST_TOOLS_QUOTA_STALE_AFTER_MS,
  type HostQuotaProvider,
  type HostQuotaEntry,
} from "./types";
import { useHostQuota } from "./use-host-quota";
import {
  formatClockTime,
  formatPercentRemaining,
  formatRelativeTimestampMs,
  useResolveHostToolsError,
} from "./format-helpers";
import { ProgressBar } from "./progress-bar";
import type { Theme } from "@/styles/theme";

const ThemedRotateCw = withUnistyles(RotateCw);

interface HostQuotaScreenProps {
  serverId: string;
}

export function HostQuotaScreen({ serverId }: HostQuotaScreenProps) {
  const { t } = useTranslation();
  const quota = useHostQuota(serverId);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const nowMs = useMemo(() => Date.now() + refreshTick, [refreshTick]);

  const handleRefresh = useCallback(async () => {
    await quota.refresh();
    setRefreshTick((tick) => tick + 1);
  }, [quota]);

  const enabledProviderFilter = useMemo<Set<string> | null>(() => {
    const list = quota.snapshot?.enabledProviders;
    if (!list || list.length === 0) {
      return null;
    }
    return new Set(list);
  }, [quota.snapshot?.enabledProviders]);

  const visibleProviders = useMemo<HostQuotaProvider[]>(() => {
    const providers = quota.snapshot?.providers ?? [];
    if (!enabledProviderFilter) {
      return providers;
    }
    return providers.filter((provider) => enabledProviderFilter.has(provider.id));
  }, [quota.snapshot?.providers, enabledProviderFilter]);

  const snapshotError = useResolveHostToolsError(
    quota.snapshot?.error?.code,
    quota.snapshot?.error?.message ?? null,
  );
  const fetchError = useResolveHostToolsError(null, quota.error);

  const stale = useMemo(() => {
    const fetchedAt = quota.snapshot?.generatedAtMs;
    if (!fetchedAt) {
      return false;
    }
    return nowMs - fetchedAt > HOST_TOOLS_QUOTA_STALE_AFTER_MS;
  }, [nowMs, quota.snapshot?.generatedAtMs]);

  const fetchedLabel = useMemo(
    () =>
      formatRelativeTimestampMs(quota.snapshot?.generatedAtMs ?? null, nowMs, (key, options) =>
        t(key, options),
      ),
    [quota.snapshot?.generatedAtMs, nowMs, t],
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={quota.isRefreshing}
        onRefresh={handleRefresh}
        tintColor={styles.refreshTint.color}
      />
    ),
    [quota.isRefreshing, handleRefresh],
  );

  if (quota.isLoading) {
    return (
      <View style={styles.loadingContainer} testID="host-quota-loading">
        <LoadingSpinner color={styles.loadingSpinner.color} size="large" />
        <Text style={styles.loadingText}>{t("hostTools.quota.loading")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={refreshControl}
    >
      <HostQuotaToolbar
        fetchedLabel={fetchedLabel}
        isRefreshing={quota.isRefreshing}
        onRefresh={handleRefresh}
        stale={stale}
        snapshotError={snapshotError}
        fetchError={fetchError}
        versionMismatch={quota.snapshot?.versionMismatch === true}
      />

      {visibleProviders.length === 0 && !snapshotError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("hostTools.quota.empty.title")}</Text>
          <Text style={styles.emptyHint}>{t("hostTools.quota.empty.hint")}</Text>
        </View>
      ) : null}

      {visibleProviders.map((provider) => (
        <QuotaProviderCard key={provider.id} provider={provider} nowMs={nowMs} />
      ))}
    </ScrollView>
  );
}

interface HostQuotaToolbarProps {
  fetchedLabel: string;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  stale: boolean;
  snapshotError: { title: string; description: string | null } | null;
  fetchError: { title: string; description: string | null } | null;
  versionMismatch: boolean;
}

function HostQuotaToolbar({
  fetchedLabel,
  isRefreshing,
  onRefresh,
  stale,
  snapshotError,
  fetchError,
  versionMismatch,
}: HostQuotaToolbarProps) {
  const { t } = useTranslation();
  const refreshStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.refreshButton,
      pressed && !isRefreshing ? styles.refreshButtonPressed : null,
      isRefreshing ? styles.refreshButtonDisabled : null,
    ],
    [isRefreshing],
  );
  return (
    <>
      <View style={styles.intro}>
        <View style={styles.introText}>
          <Text style={styles.title}>{t("hostTools.quota.title")}</Text>
          <Text style={styles.subtitle}>
            {t("hostTools.quota.fetchedAt", { time: fetchedLabel })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("hostTools.quota.refresh")}
          onPress={onRefresh}
          disabled={isRefreshing}
          style={refreshStyle}
          testID="host-quota-refresh"
        >
          <RefreshIcon isRefreshing={isRefreshing} />
          <Text style={styles.refreshLabel}>
            {isRefreshing ? t("hostTools.quota.refreshing") : t("hostTools.quota.refresh")}
          </Text>
        </Pressable>
      </View>

      {stale ? (
        <Alert
          variant="warning"
          title={t("hostTools.quota.stale.title")}
          description={t("hostTools.quota.stale.description")}
        />
      ) : null}

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

      {versionMismatch ? (
        <Alert
          variant="warning"
          title={t("hostTools.quota.versionMismatch.title")}
          description={t("hostTools.quota.versionMismatch.description")}
        />
      ) : null}
    </>
  );
}

function RefreshIcon({ isRefreshing }: { isRefreshing: boolean }) {
  if (isRefreshing) {
    return <ActivityIndicator size="small" color={styles.refreshSpinner.color} />;
  }
  return <ThemedRotateCw size={16} uniProps={refreshIconColor} />;
}

interface QuotaProviderCardProps {
  provider: HostQuotaProvider;
  nowMs: number;
}

function QuotaProviderCard({ provider, nowMs }: QuotaProviderCardProps) {
  const { t } = useTranslation();
  const isProviderError = provider.status === "error";
  const fetchedAtLabel = useMemo(
    () =>
      formatRelativeTimestampMs(provider.fetchedAtMs ?? null, nowMs, (key, options) =>
        t(key, options),
      ),
    [provider.fetchedAtMs, nowMs, t],
  );

  return (
    <View style={styles.providerCard}>
      <View style={styles.providerHeader}>
        <View style={styles.providerHeaderText}>
          <Text style={styles.providerTitle}>{provider.label}</Text>
          <Text style={styles.providerSubtitle}>
            {t("hostTools.quota.fetchedAt", { time: fetchedAtLabel })}
          </Text>
        </View>
        {isProviderError ? (
          <StatusBadge label={t("hostTools.quota.providerError")} variant="error" />
        ) : null}
      </View>

      {isProviderError && provider.error ? (
        <Text style={styles.providerError}>{provider.error}</Text>
      ) : null}

      {provider.entries.length === 0 ? (
        <Text style={styles.providerSubtitle}>
          {t("hostTools.quota.noEntries", { provider: provider.label })}
        </Text>
      ) : null}

      {provider.entries.map((entry) => (
        <QuotaEntry key={entry.name} entry={entry} />
      ))}
    </View>
  );
}

function QuotaEntry({ entry }: { entry: HostQuotaEntry }) {
  const { t } = useTranslation();
  const isUnlimited = entry.unlimited === true;
  const value = typeof entry.percentRemaining === "number" ? entry.percentRemaining : null;
  const resetAt = formatClockTime(entry.resetAtMs);
  return (
    <View style={styles.entry}>
      <View style={styles.entryHeader}>
        <View style={styles.entryHeaderText}>
          <Text style={styles.entryName}>{entry.name}</Text>
          {entry.window ? <Text style={styles.entryWindow}>{entry.window}</Text> : null}
        </View>
        <Text style={styles.entryValue}>
          {isUnlimited
            ? t("hostTools.quota.unlimited")
            : formatPercentRemaining(value ?? undefined)}
        </Text>
      </View>
      {isUnlimited ? null : (
        <ProgressBar
          value={typeof value === "number" ? value : 0}
          accessibilityLabel={t("hostTools.quota.progressLabel", {
            name: entry.name,
            value: formatPercentRemaining(value ?? undefined),
          })}
        />
      )}
      <View style={styles.entryFooter}>
        <Text style={styles.entryValueText}>{entry.value ?? "—"}</Text>
        <Text style={styles.entryReset}>{t("hostTools.quota.resetsAt", { time: resetAt })}</Text>
      </View>
    </View>
  );
}

const refreshIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[3],
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  loadingSpinner: {
    color: theme.colors.foregroundMuted,
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  refreshTint: {
    color: theme.colors.foregroundMuted,
  },
  refreshSpinner: {
    color: theme.colors.foregroundMuted,
  },
  intro: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  introText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  refreshButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  refreshButtonDisabled: {
    opacity: theme.opacity[50],
  },
  refreshLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  empty: {
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
    alignItems: "center",
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
  providerCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  providerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  providerHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  providerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  providerSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  providerError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  entry: {
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  entryHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0],
  },
  entryName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  entryWindow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  entryValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  entryFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  entryValueText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  entryReset: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
