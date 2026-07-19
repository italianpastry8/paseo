/**
 * Roles screen (host-tools) — list of roles with their current model,
 * a two-step picker (role → fuzzy search models) and an optional variant
 * step (low/medium/high) when the role's preset already has a `variant`
 * field. Writes go through `hostRolesSetModel`; on success the screen
 * shows a "新会话生效" hint.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ArrowLeft, Check, ChevronRight, Search, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/contexts/toast-context";
import type { HostRoleAssignment, HostRolesSnapshot, HostToolsError } from "./types";
import { useHostRoles } from "./use-host-roles";
import { useResolveHostToolsError } from "./format-helpers";
import type { Theme } from "@/styles/theme";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedCheck = withUnistyles(Check);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);

type PickerStep =
  | { kind: "list" }
  | { kind: "model"; role: HostRoleAssignment }
  | { kind: "variant"; role: HostRoleAssignment; model: string };

type Variant = "low" | "medium" | "high";

const VARIANT_VALUES: readonly Variant[] = ["low", "medium", "high"];

interface HostRolesScreenProps {
  serverId: string;
}

export function HostRolesScreen({ serverId }: HostRolesScreenProps) {
  const { t } = useTranslation();
  const roles = useHostRoles(serverId);
  const toast = useToast();
  const [step, setStep] = useState<PickerStep>({ kind: "list" });
  const [search, setSearch] = useState<string>("");
  const [selectedVariant, setSelectedVariant] = useState<Variant>("medium");
  const [writeError, setWriteError] = useState<HostToolsError | null>(null);
  const [writeSucceeded, setWriteSucceeded] = useState<{ role: string; model: string } | null>(
    null,
  );

  useEffect(() => {
    if (step.kind === "list") {
      setSearch("");
      setSelectedVariant("medium");
      setWriteError(null);
    }
  }, [step.kind]);

  const handleSelectRole = useCallback((role: HostRoleAssignment) => {
    setStep({ kind: "model", role });
  }, []);

  const performWrite = useCallback(
    async (input: { role: HostRoleAssignment; model: string; variant: Variant | undefined }) => {
      setWriteError(null);
      const variant = input.role.hasVariantField ? input.variant : undefined;
      const result = await roles.setRoleModel({
        role: input.role.role,
        model: input.model,
        ...(variant !== undefined ? { variant } : {}),
      });
      if (result === null) {
        return;
      }
      if (!result.ok) {
        if (result.error) {
          setWriteError(result.error);
        }
        toast.error(result.error?.message ?? t("hostTools.roles.writeFailed"));
        return;
      }
      toast.show(t("hostTools.roles.writeSuccess"));
      setWriteSucceeded({ role: input.role.role, model: input.model });
      setStep({ kind: "list" });
    },
    [roles, toast, t],
  );

  const handleSelectModel = useCallback(
    (model: string) => {
      if (step.kind !== "model") return;
      if (step.role.hasVariantField) {
        setStep({ kind: "variant", role: step.role, model });
      } else {
        void performWrite({ role: step.role, model, variant: undefined });
      }
    },
    [step, performWrite],
  );

  const handleConfirmVariant = useCallback(() => {
    if (step.kind !== "variant") return;
    void performWrite({ role: step.role, model: step.model, variant: selectedVariant });
  }, [step, selectedVariant, performWrite]);

  const handleCancelModelPicker = useCallback(() => {
    setStep({ kind: "list" });
  }, []);

  const handleCancelVariantPicker = useCallback(() => {
    setStep((current) =>
      current.kind === "variant" ? { kind: "model", role: current.role } : current,
    );
  }, []);

  const handleDismissWriteSucceeded = useCallback(() => {
    setWriteSucceeded(null);
  }, []);

  if (roles.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner color={styles.loadingSpinner.color} size="large" />
        <Text style={styles.loadingText}>{t("hostTools.roles.loading")}</Text>
      </View>
    );
  }

  if (step.kind === "model") {
    return (
      <ModelPickerStep
        role={step.role}
        roles={roles}
        search={search}
        onChangeSearch={setSearch}
        onCancel={handleCancelModelPicker}
        onSelectModel={handleSelectModel}
        writeError={writeError}
      />
    );
  }

  if (step.kind === "variant") {
    return (
      <VariantPickerStep
        role={step.role}
        model={step.model}
        selectedVariant={selectedVariant}
        onSelectVariant={setSelectedVariant}
        onCancel={handleCancelVariantPicker}
        onConfirm={handleConfirmVariant}
        isWriting={roles.isWriting}
        writeError={writeError}
      />
    );
  }

  return (
    <RoleListStep
      snapshot={roles.snapshot}
      error={roles.error}
      writeError={writeError}
      writeSucceeded={writeSucceeded}
      onSelectRole={handleSelectRole}
      onDismissWriteSucceeded={handleDismissWriteSucceeded}
    />
  );
}

interface RoleListStepProps {
  snapshot: HostRolesSnapshot | null;
  error: string | null;
  writeError: HostToolsError | null;
  writeSucceeded: { role: string; model: string } | null;
  onSelectRole: (role: HostRoleAssignment) => void;
  onDismissWriteSucceeded: () => void;
}

function RoleListStep({
  snapshot,
  error,
  writeError,
  writeSucceeded,
  onSelectRole,
  onDismissWriteSucceeded,
}: RoleListStepProps) {
  const { t } = useTranslation();
  const resolvedError = useResolveHostToolsError(snapshot?.error?.code, error);
  const resolvedWriteError = useResolveHostToolsError(writeError?.code, writeError?.message);
  const roles = snapshot?.roles ?? [];
  const presetName = snapshot?.presetName;

  const dismissLinkStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.linkButton,
      pressed ? styles.linkButtonPressed : null,
    ],
    [],
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.intro}>
        <Text style={styles.title}>{t("hostTools.roles.title")}</Text>
        {presetName ? (
          <Text style={styles.subtitle}>
            {t("hostTools.roles.presetName", { name: presetName })}
          </Text>
        ) : null}
      </View>

      {writeSucceeded ? (
        <Alert
          variant="success"
          title={t("hostTools.roles.successHint.title", {
            role: writeSucceeded.role,
            model: writeSucceeded.model,
          })}
          description={t("hostTools.roles.successHint.description")}
        />
      ) : null}

      {resolvedError ? (
        <Alert
          variant="error"
          title={resolvedError.title}
          description={resolvedError.description ?? undefined}
        />
      ) : null}

      {resolvedWriteError ? (
        <Alert
          variant="error"
          title={resolvedWriteError.title}
          description={resolvedWriteError.description ?? undefined}
        />
      ) : null}

      {roles.length === 0 && !resolvedError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("hostTools.roles.empty.title")}</Text>
          <Text style={styles.emptyHint}>{t("hostTools.roles.empty.hint")}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        {roles.map((role, index) => (
          <RoleRow key={role.role} role={role} isFirst={index === 0} onSelect={onSelectRole} />
        ))}
      </View>

      {writeSucceeded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("hostTools.roles.dismissSuccess")}
          onPress={onDismissWriteSucceeded}
          style={dismissLinkStyle}
        >
          <Text style={styles.linkLabel}>{t("hostTools.roles.dismissSuccess")}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

interface RoleRowProps {
  role: HostRoleAssignment;
  isFirst: boolean;
  onSelect: (role: HostRoleAssignment) => void;
}

function RoleRow({ role, isFirst, onSelect }: RoleRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onSelect(role);
  }, [onSelect, role]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      !isFirst ? styles.rowBorder : null,
      pressed ? styles.rowPressed : null,
    ],
    [isFirst],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("hostTools.roles.rowAccessibility", { role: role.role })}
      onPress={handlePress}
      style={rowStyle}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{role.role}</Text>
        <Text style={styles.rowSubtitle}>{role.model ?? t("hostTools.roles.noModel")}</Text>
        {role.variant ? (
          <Text style={styles.rowMeta}>
            {t("hostTools.roles.variant", { value: role.variant })}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowTrailing}>
        {role.hasVariantField ? <StatusBadge label={t("hostTools.roles.hasVariant")} /> : null}
        <ThemedChevronRight size={16} uniProps={foregroundMutedColor} />
      </View>
    </Pressable>
  );
}

const foregroundMutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ModelPickerStepProps {
  role: HostRoleAssignment;
  roles: ReturnType<typeof useHostRoles>;
  search: string;
  onChangeSearch: (next: string) => void;
  onCancel: () => void;
  onSelectModel: (model: string) => void;
  writeError: HostToolsError | null;
}

function ModelPickerStep({
  role,
  roles,
  search,
  onChangeSearch,
  onCancel,
  onSelectModel,
  writeError,
}: ModelPickerStepProps) {
  const { t } = useTranslation();
  const [loadAttempted, setLoadAttempted] = useState<boolean>(false);

  useEffect(() => {
    if (loadAttempted) {
      return;
    }
    if (roles.models.length === 0 && !roles.isLoadingModels && !roles.modelsError) {
      setLoadAttempted(true);
      void roles.loadModels();
    }
  }, [loadAttempted, roles]);

  const filtered = useMemo(() => {
    if (!search) {
      return roles.models;
    }
    const needle = search.toLowerCase();
    return roles.models.filter((model) => model.toLowerCase().includes(needle));
  }, [roles.models, search]);

  const resolvedWriteError = useResolveHostToolsError(writeError?.code, writeError?.message);

  return (
    <View style={styles.stepContainer}>
      <StepBackHeader
        title={role.role}
        subtitle={t("hostTools.roles.modelPicker.subtitle", { current: role.model ?? "—" })}
        onCancel={onCancel}
      />

      <View style={styles.searchBar}>
        <ThemedSearch size={16} uniProps={foregroundMutedColor} />
        <TextInput
          value={search}
          onChangeText={onChangeSearch}
          placeholder={t("hostTools.roles.modelPicker.searchPlaceholder")}
          placeholderTextColor={styles.searchPlaceholder.color}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          testID="host-roles-search"
        />
        <ClearSearchButton search={search} onChangeSearch={onChangeSearch} />
      </View>

      {roles.isLoadingModels ? (
        <View style={styles.modelsLoading}>
          <ActivityIndicator size="small" color={styles.loadingSpinner.color} />
          <Text style={styles.modelsLoadingLabel}>{t("hostTools.roles.modelPicker.loading")}</Text>
        </View>
      ) : null}

      {roles.modelsError ? (
        <Alert
          variant="error"
          title={t("hostTools.roles.modelPicker.errorTitle")}
          description={roles.modelsError}
        />
      ) : null}

      {resolvedWriteError ? (
        <Alert
          variant="error"
          title={resolvedWriteError.title}
          description={resolvedWriteError.description ?? undefined}
        />
      ) : null}

      {roles.modelsDegraded ? (
        <Alert
          variant="warning"
          title={t("hostTools.roles.modelPicker.degraded.title")}
          description={t("hostTools.roles.modelPicker.degraded.description")}
        />
      ) : null}

      <ScrollView
        style={styles.modelList}
        contentContainerStyle={styles.modelListContent}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 && !roles.isLoadingModels ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("hostTools.roles.modelPicker.noMatches")}</Text>
          </View>
        ) : null}
        {filtered.map((model) => (
          <ModelRow
            key={model}
            model={model}
            isCurrent={model === role.model}
            onSelect={onSelectModel}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface ClearSearchButtonProps {
  search: string;
  onChangeSearch: (next: string) => void;
}

function ClearSearchButton({ search, onChangeSearch }: ClearSearchButtonProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onChangeSearch("");
  }, [onChangeSearch]);
  if (!search) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("hostTools.common.clearSearch")}
      onPress={handlePress}
      style={styles.searchClear}
    >
      <ThemedX size={14} uniProps={foregroundMutedColor} />
    </Pressable>
  );
}

interface StepBackHeaderProps {
  title: string;
  subtitle: string;
  onCancel: () => void;
}

function StepBackHeader({ title, subtitle, onCancel }: StepBackHeaderProps) {
  const { t } = useTranslation();
  const backStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.backButton,
      pressed ? styles.backButtonPressed : null,
    ],
    [],
  );
  return (
    <View style={styles.stepHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("hostTools.common.back")}
        onPress={onCancel}
        style={backStyle}
      >
        <ThemedArrowLeft size={18} uniProps={foregroundColor} />
      </Pressable>
      <View style={styles.stepHeaderText}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

interface ModelRowProps {
  model: string;
  isCurrent: boolean;
  onSelect: (model: string) => void;
}

function ModelRow({ model, isCurrent, onSelect }: ModelRowProps) {
  const handlePress = useCallback(() => {
    onSelect(model);
  }, [onSelect, model]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.modelRow,
      pressed ? styles.modelRowPressed : null,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ selected: isCurrent }), [isCurrent]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={rowStyle}
    >
      <Text style={[styles.modelText, isCurrent ? styles.modelTextActive : null]}>{model}</Text>
      {isCurrent ? <ThemedCheck size={16} uniProps={foregroundColor} /> : null}
    </Pressable>
  );
}

const foregroundColor = (theme: Theme) => ({ color: theme.colors.foreground });

interface VariantPickerStepProps {
  role: HostRoleAssignment;
  model: string;
  selectedVariant: Variant;
  onSelectVariant: (variant: Variant) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isWriting: boolean;
  writeError: HostToolsError | null;
}

function VariantPickerStep({
  role,
  model,
  selectedVariant,
  onSelectVariant,
  onCancel,
  onConfirm,
  isWriting,
  writeError,
}: VariantPickerStepProps) {
  const { t } = useTranslation();
  const resolvedWriteError = useResolveHostToolsError(writeError?.code, writeError?.message);
  return (
    <View style={styles.stepContainer}>
      <StepBackHeader
        title={role.role}
        subtitle={t("hostTools.roles.variantPicker.subtitle", { model })}
        onCancel={onCancel}
      />

      {resolvedWriteError ? (
        <Alert
          variant="error"
          title={resolvedWriteError.title}
          description={resolvedWriteError.description ?? undefined}
        />
      ) : null}

      <View style={styles.variantGroup}>
        {VARIANT_VALUES.map((variant) => (
          <VariantRow
            key={variant}
            variant={variant}
            isActive={variant === selectedVariant}
            onSelect={onSelectVariant}
          />
        ))}
      </View>

      <View style={styles.variantActions}>
        <Button variant="outline" size="sm" onPress={onCancel} disabled={isWriting}>
          {t("hostTools.common.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={onConfirm}
          disabled={isWriting}
          loading={isWriting}
          testID="host-roles-confirm"
        >
          {t("hostTools.roles.variantPicker.confirm")}
        </Button>
      </View>
    </View>
  );
}

interface VariantRowProps {
  variant: Variant;
  isActive: boolean;
  onSelect: (variant: Variant) => void;
}

function VariantRow({ variant, isActive, onSelect }: VariantRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onSelect(variant);
  }, [onSelect, variant]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.variantRow,
      pressed ? styles.variantRowPressed : null,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      accessibilityLabel={t(`hostTools.roles.variants.${variant}`)}
      onPress={handlePress}
      style={rowStyle}
    >
      <View style={[styles.variantRadio, isActive ? styles.variantRadioActive : null]} />
      <Text style={styles.variantText}>{t(`hostTools.roles.variants.${variant}`)}</Text>
    </Pressable>
  );
}

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
  intro: {
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
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },
  rowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  linkButton: {
    alignSelf: "flex-start",
    padding: theme.spacing[2],
  },
  linkButtonPressed: {
    opacity: theme.opacity[50],
  },
  linkLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  stepContainer: {
    flex: 1,
    gap: theme.spacing[3],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingTop: theme.spacing[4],
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  backButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  backButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  stepHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  stepTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  stepSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  searchPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  searchClear: {
    padding: theme.spacing[1],
  },
  modelsLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  modelsLoadingLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  modelList: {
    flex: 1,
  },
  modelListContent: {
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  modelRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  modelText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  modelTextActive: {
    fontWeight: theme.fontWeight.medium,
  },
  variantGroup: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  variantRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  variantRadio: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  variantRadioActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  variantText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  variantActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
