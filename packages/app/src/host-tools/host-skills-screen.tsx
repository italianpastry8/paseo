/**
 * Skills screen (host-tools) — grouped skill list with enable/disable
 * switches, scope badges, description with `zhSummary` fallback, and
 * group CRUD. The ungrouped bucket is rendered last under a dedicated
 * "Other" label so users can move skills into a real group.
 *
 * The screen subscribes to `host.skills.changed` so the VSCode skill
 * manager's edits propagate here without a manual reload. A corrupt
 * `skill-manager.json` shows an error banner — the daemon never silently
 * overwrites a bad file, and the UI mirrors that contract.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ChevronRight, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/contexts/toast-context";
import type { HostSkill, HostSkillGroup } from "./types";
import {
  HOST_TOOLS_UNGROUPED_BUCKET_ID,
  useHostSkills,
  type HostSkillGroupUpdate,
} from "./use-host-skills";
import { useResolveHostToolsError } from "./format-helpers";
import { useHostSkillsExpandedGroupsStore } from "./host-skills-expanded-groups-store";
import type { Theme } from "@/styles/theme";

const ThemedPlus = withUnistyles(Plus);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedChevronRight = withUnistyles(ChevronRight);
const foregroundMutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface HostSkillsScreenProps {
  serverId: string;
}

export function HostSkillsScreen({ serverId }: HostSkillsScreenProps) {
  const { t } = useTranslation();
  const skills = useHostSkills(serverId);
  const toast = useToast();
  const [creatingGroup, setCreatingGroup] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const snapshotError = useResolveHostToolsError(
    skills.snapshot?.error?.code,
    skills.snapshot?.error?.message ?? null,
  );
  const fetchError = useResolveHostToolsError(null, skills.error);

  const handleToggle = useCallback(
    async (skill: HostSkill) => {
      const nextEnabled = !skill.enabled;
      const result = await skills.toggle(skill.name, nextEnabled);
      if (result === null) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error?.message ?? t("hostTools.skills.toggleFailed"));
      }
    },
    [skills, toast, t],
  );

  const handleCreateGroup = useCallback(async () => {
    const trimmed = newGroupName.trim();
    if (trimmed.length === 0) {
      return;
    }
    const newGroups: HostSkillGroupUpdate[] = [
      ...skills.groups.map((group) => ({
        id: group.id,
        name: group.name,
        skills: [...group.skills],
      })),
      { id: generateGroupId(trimmed), name: trimmed, skills: [] },
    ];
    const result = await skills.updateGroups(newGroups);
    if (result?.ok) {
      setNewGroupName("");
      setCreatingGroup(false);
      toast.show(t("hostTools.skills.groupCreated"));
    } else {
      toast.error(result?.error?.message ?? t("hostTools.skills.groupCreateFailed"));
    }
  }, [newGroupName, skills, toast, t]);

  const handleStartRename = useCallback((group: HostSkillGroup) => {
    setRenamingGroupId(group.id);
    setRenameValue(group.name);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingGroupId(null);
    setRenameValue("");
  }, []);

  const handleConfirmRename = useCallback(async () => {
    if (renamingGroupId === null) return;
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      handleCancelRename();
      return;
    }
    const newGroups: HostSkillGroupUpdate[] = skills.groups.map((group) =>
      group.id === renamingGroupId
        ? { id: group.id, name: trimmed, skills: [...group.skills] }
        : { id: group.id, name: group.name, skills: [...group.skills] },
    );
    const result = await skills.updateGroups(newGroups);
    if (result?.ok) {
      handleCancelRename();
      toast.show(t("hostTools.skills.groupRenamed"));
    } else {
      toast.error(result?.error?.message ?? t("hostTools.skills.groupRenameFailed"));
    }
  }, [handleCancelRename, renameValue, renamingGroupId, skills, toast, t]);

  const handleDeleteGroup = useCallback(
    async (group: HostSkillGroup) => {
      const newGroups: HostSkillGroupUpdate[] = skills.groups
        .filter((entry) => entry.id !== group.id)
        .map((entry) => ({ id: entry.id, name: entry.name, skills: [...entry.skills] }));
      const result = await skills.updateGroups(newGroups);
      if (result?.ok) {
        toast.show(t("hostTools.skills.groupDeleted"));
      } else {
        toast.error(result?.error?.message ?? t("hostTools.skills.groupDeleteFailed"));
      }
    },
    [skills, toast, t],
  );

  const handleMoveToGroup = useCallback(
    async (skillName: string, targetGroupId: string | null) => {
      const newGroups: HostSkillGroupUpdate[] = skills.groups.map((group) => ({
        id: group.id,
        name: group.name,
        skills: group.skills.filter((name) => name !== skillName),
      }));
      if (targetGroupId !== null) {
        const target = newGroups.find((group) => group.id === targetGroupId);
        if (target) {
          target.skills.push(skillName);
        }
      }
      const result = await skills.updateGroups(newGroups);
      if (result?.ok) {
        toast.show(
          targetGroupId === null
            ? t("hostTools.skills.skillUngrouped")
            : t("hostTools.skills.skillMoved"),
        );
      } else {
        toast.error(result?.error?.message ?? t("hostTools.skills.groupUpdateFailed"));
      }
    },
    [skills, toast, t],
  );

  const handleToggleCreatingGroup = useCallback(() => {
    setCreatingGroup((current) => !current);
  }, []);

  const handleCancelCreatingGroup = useCallback(() => {
    setCreatingGroup(false);
    setNewGroupName("");
  }, []);

  if (skills.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner color={styles.loadingSpinner.color} size="large" />
        <Text style={styles.loadingText}>{t("hostTools.skills.loading")}</Text>
      </View>
    );
  }

  const groups = skills.groups;
  const isUngroupedBucketNonEmpty = skills.ungroupedSkills.length > 0;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.intro}>
        <View style={styles.introText}>
          <Text style={styles.title}>{t("hostTools.skills.title")}</Text>
          <Text style={styles.subtitle}>
            {t("hostTools.skills.subtitle", { count: skills.skills.length })}
          </Text>
        </View>
        <CreateGroupButton isActive={creatingGroup} onPress={handleToggleCreatingGroup} />
      </View>

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

      {creatingGroup ? (
        <CreateGroupForm
          isUpdating={skills.isUpdatingGroups}
          name={newGroupName}
          onChangeName={setNewGroupName}
          onCancel={handleCancelCreatingGroup}
          onCreate={handleCreateGroup}
        />
      ) : null}

      {groups.length === 0 && !isUngroupedBucketNonEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("hostTools.skills.empty.title")}</Text>
          <Text style={styles.emptyHint}>{t("hostTools.skills.empty.hint")}</Text>
        </View>
      ) : null}

      {groups.map((group) => (
        <SkillGroupCard
          key={group.id}
          group={group}
          skills={skills.groupedSkills.get(group.id) ?? []}
          pendingToggles={skills.pendingToggles}
          availableGroups={groups}
          renaming={renamingGroupId === group.id}
          renameValue={renameValue}
          onChangeRenameValue={setRenameValue}
          onStartRename={handleStartRename}
          onCancelRename={handleCancelRename}
          onConfirmRename={handleConfirmRename}
          onDeleteGroup={handleDeleteGroup}
          onToggle={handleToggle}
          onMoveToGroup={handleMoveToGroup}
        />
      ))}

      {isUngroupedBucketNonEmpty ? (
        <UngroupedBucketCard
          ungroupedSkills={skills.ungroupedSkills}
          pendingToggles={skills.pendingToggles}
          availableGroups={groups}
          onToggle={handleToggle}
          onMoveToGroup={handleMoveToGroup}
        />
      ) : null}
    </ScrollView>
  );
}

interface CreateGroupButtonProps {
  isActive: boolean;
  onPress: () => void;
}

function CreateGroupButton({ isActive, onPress }: CreateGroupButtonProps) {
  const { t } = useTranslation();
  const pressStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.headerAction,
      pressed ? styles.headerActionPressed : null,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ expanded: isActive }), [isActive]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={t("hostTools.skills.createGroup")}
      onPress={onPress}
      style={pressStyle}
    >
      <ThemedPlus size={16} uniProps={foregroundMutedColor} />
      <Text style={styles.headerActionLabel}>{t("hostTools.skills.createGroup")}</Text>
    </Pressable>
  );
}

interface UngroupedBucketCardProps {
  ungroupedSkills: HostSkill[];
  pendingToggles: ReadonlySet<string>;
  availableGroups: HostSkillGroup[];
  onToggle: (skill: HostSkill) => void;
  onMoveToGroup: (skillName: string, targetGroupId: string | null) => void;
}

function UngroupedBucketCard({
  ungroupedSkills,
  pendingToggles,
  availableGroups,
  onToggle,
  onMoveToGroup,
}: UngroupedBucketCardProps) {
  const { t } = useTranslation();
  const ungroupedGroup = useMemo<HostSkillGroup>(
    () => ({
      id: HOST_TOOLS_UNGROUPED_BUCKET_ID,
      name: t("hostTools.skills.ungrouped"),
      skills: ungroupedSkills.map((skill) => skill.name),
    }),
    [t, ungroupedSkills],
  );
  return (
    <SkillGroupCard
      key={HOST_TOOLS_UNGROUPED_BUCKET_ID}
      group={ungroupedGroup}
      skills={ungroupedSkills}
      pendingToggles={pendingToggles}
      availableGroups={availableGroups}
      isUngroupedBucket
      onToggle={onToggle}
      onMoveToGroup={onMoveToGroup}
    />
  );
}

interface CreateGroupFormProps {
  isUpdating: boolean;
  name: string;
  onChangeName: (next: string) => void;
  onCancel: () => void;
  onCreate: () => Promise<void>;
}

function CreateGroupForm({
  isUpdating,
  name,
  onChangeName,
  onCancel,
  onCreate,
}: CreateGroupFormProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.inlineForm}>
      <Text style={styles.inlineFormLabel}>{t("hostTools.skills.newGroup")}</Text>
      <TextInput
        value={name}
        onChangeText={onChangeName}
        placeholder={t("hostTools.skills.newGroupPlaceholder")}
        placeholderTextColor={styles.inputPlaceholder.color}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        testID="host-skills-new-group"
      />
      <View style={styles.inlineFormActions}>
        <Button variant="outline" size="sm" onPress={onCancel} disabled={isUpdating}>
          {t("hostTools.common.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={onCreate}
          disabled={isUpdating || name.trim().length === 0}
          loading={isUpdating}
          testID="host-skills-create-group"
        >
          {t("hostTools.skills.createGroupAction")}
        </Button>
      </View>
    </View>
  );
}

interface SkillGroupCardProps {
  group: HostSkillGroup;
  skills: HostSkill[];
  pendingToggles: ReadonlySet<string>;
  availableGroups: HostSkillGroup[];
  /** When true, the card is read-only: no rename/delete, no group actions, no move-to-group. */
  isUngroupedBucket?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onChangeRenameValue?: (next: string) => void;
  onStartRename?: (group: HostSkillGroup) => void;
  onCancelRename?: () => void;
  onConfirmRename?: () => Promise<void>;
  onDeleteGroup?: (group: HostSkillGroup) => Promise<void>;
  onToggle: (skill: HostSkill) => void;
  onMoveToGroup: (skillName: string, targetGroupId: string | null) => void;
}

function SkillGroupCard({
  group,
  skills,
  pendingToggles,
  availableGroups,
  isUngroupedBucket = false,
  renaming = false,
  renameValue = "",
  onChangeRenameValue,
  onStartRename,
  onCancelRename,
  onConfirmRename,
  onDeleteGroup,
  onToggle,
  onMoveToGroup,
}: SkillGroupCardProps) {
  const { t } = useTranslation();
  const isExpanded = useHostSkillsExpandedGroupsStore((state) =>
    state.expandedGroupIds.has(group.id),
  );
  const toggleExpanded = useHostSkillsExpandedGroupsStore((state) => state.toggleGroupExpanded);
  const handleToggleExpanded = useCallback(() => {
    toggleExpanded(group.id);
  }, [group.id, toggleExpanded]);
  const headerToggleStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.groupHeaderToggle,
      pressed ? styles.groupHeaderTogglePressed : null,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);
  return (
    <View style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <Pressable
          style={headerToggleStyle}
          onPress={handleToggleExpanded}
          disabled={renaming}
          accessibilityRole="button"
          accessibilityLabel={t("hostTools.skills.toggleGroup", { name: group.name })}
          accessibilityState={accessibilityState}
          testID={`host-skills-group-toggle-${group.id}`}
        >
          <ThemedChevronRight
            size={14}
            uniProps={foregroundMutedColor}
            style={isExpanded ? styles.groupHeaderChevronExpanded : undefined}
          />
          <View style={styles.groupHeaderText}>
            {renaming && !isUngroupedBucket ? (
              <TextInput
                value={renameValue}
                onChangeText={onChangeRenameValue}
                placeholder={t("hostTools.skills.renamePlaceholder")}
                placeholderTextColor={styles.inputPlaceholder.color}
                style={styles.input}
                autoCorrect={false}
                autoCapitalize="none"
                testID="host-skills-rename-input"
              />
            ) : (
              <Text style={styles.groupTitle}>{group.name}</Text>
            )}
            <Text style={styles.groupSubtitle}>
              {skills.length === 0
                ? t("hostTools.skills.groupSubtitleEmpty")
                : t("hostTools.skills.groupSubtitle", {
                    enabled: skills.filter((s) => s.enabled).length,
                    total: skills.length,
                  })}
            </Text>
          </View>
        </Pressable>
        {!isUngroupedBucket ? (
          <GroupHeaderActions
            group={group}
            renaming={renaming}
            onStartRename={onStartRename ?? noopStartRename}
            onCancelRename={onCancelRename ?? noopCancelRename}
            onConfirmRename={onConfirmRename ?? noopConfirmRename}
            onDeleteGroup={onDeleteGroup ?? noopDeleteGroup}
          />
        ) : null}
      </View>

      {isExpanded && skills.length === 0 ? (
        <Text style={styles.groupEmpty}>{t("hostTools.skills.groupEmpty")}</Text>
      ) : null}

      {isExpanded
        ? skills.map((skill, index) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              isFirst={index === 0}
              isPending={pendingToggles.has(skill.name)}
              availableGroups={availableGroups}
              isInUngroupedBucket={isUngroupedBucket}
              currentGroupId={group.id}
              onToggle={onToggle}
              onMoveToGroup={onMoveToGroup}
            />
          ))
        : null}
    </View>
  );
}

function noopStartRename(_group: HostSkillGroup) {
  /* ungrouped bucket has no rename action */
}
function noopCancelRename() {
  /* ungrouped bucket has no rename action */
}
function noopConfirmRename() {
  return Promise.resolve();
}
function noopDeleteGroup(_group: HostSkillGroup) {
  return Promise.resolve();
}

interface GroupHeaderActionsProps {
  group: HostSkillGroup;
  renaming: boolean;
  onStartRename: (group: HostSkillGroup) => void;
  onCancelRename: () => void;
  onConfirmRename: () => Promise<void>;
  onDeleteGroup: (group: HostSkillGroup) => Promise<void>;
}

function GroupHeaderActions({
  group,
  renaming,
  onStartRename,
  onCancelRename,
  onConfirmRename,
  onDeleteGroup,
}: GroupHeaderActionsProps) {
  const { t } = useTranslation();
  if (renaming) {
    return (
      <View style={styles.groupActions}>
        <Button variant="ghost" size="sm" onPress={onCancelRename}>
          {t("hostTools.common.cancel")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onPress={onConfirmRename}
          testID="host-skills-rename-confirm"
        >
          {t("hostTools.skills.renameAction")}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.groupActions}>
      <RenameGroupButton group={group} onPress={onStartRename} />
      <DeleteGroupButton group={group} onPress={onDeleteGroup} />
    </View>
  );
}

interface RenameGroupButtonProps {
  group: HostSkillGroup;
  onPress: (group: HostSkillGroup) => void;
}

function RenameGroupButton({ group, onPress }: RenameGroupButtonProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onPress(group);
  }, [onPress, group]);
  const pressStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.groupIconButton,
      pressed ? styles.groupIconButtonPressed : null,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("hostTools.skills.renameGroup", { name: group.name })}
      onPress={handlePress}
      style={pressStyle}
    >
      <Text style={styles.groupIconButtonText}>{t("hostTools.skills.rename")}</Text>
    </Pressable>
  );
}

interface DeleteGroupButtonProps {
  group: HostSkillGroup;
  onPress: (group: HostSkillGroup) => Promise<void>;
}

function DeleteGroupButton({ group, onPress }: DeleteGroupButtonProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    void onPress(group);
  }, [onPress, group]);
  const pressStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.groupIconButton,
      pressed ? styles.groupIconButtonPressed : null,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("hostTools.skills.deleteGroup", { name: group.name })}
      onPress={handlePress}
      style={pressStyle}
    >
      <ThemedTrash2 size={14} uniProps={foregroundMutedColor} />
    </Pressable>
  );
}

interface SkillRowProps {
  skill: HostSkill;
  isFirst: boolean;
  isPending: boolean;
  availableGroups: HostSkillGroup[];
  isInUngroupedBucket: boolean;
  currentGroupId: string;
  onToggle: (skill: HostSkill) => void;
  onMoveToGroup: (skillName: string, targetGroupId: string | null) => void;
}

function SkillRow({
  skill,
  isFirst,
  isPending,
  availableGroups,
  isInUngroupedBucket,
  currentGroupId,
  onToggle,
  onMoveToGroup,
}: SkillRowProps) {
  const { t } = useTranslation();
  const description = skill.zhSummary ?? skill.description;
  const moveTargets = useMemo(
    () =>
      availableGroups.filter(
        (group) => group.id !== currentGroupId && group.id !== HOST_TOOLS_UNGROUPED_BUCKET_ID,
      ),
    [availableGroups, currentGroupId],
  );

  const handleToggleValue = useCallback(() => {
    onToggle(skill);
  }, [onToggle, skill]);

  const showMoveActions = !isInUngroupedBucket && moveTargets.length > 0;
  const canShowMoveToUngrouped = !isInUngroupedBucket;

  return (
    <View style={[styles.skillRow, !isFirst ? styles.skillRowBorder : null]}>
      <View style={styles.skillRowText}>
        <View style={styles.skillRowTitleRow}>
          <Text style={styles.skillName}>{skill.name}</Text>
          {isPending ? (
            <ActivityIndicator
              size="small"
              color={styles.loadingSpinner.color}
              style={styles.skillRowSpinner}
            />
          ) : null}
        </View>
        {description ? <Text style={styles.skillDescription}>{description}</Text> : null}
        {skill.scopes.length > 0 ? (
          <View style={styles.skillScopes}>
            {skill.scopes.map((scope) => (
              <StatusBadge key={scope} label={scope} />
            ))}
          </View>
        ) : null}
        {showMoveActions ? (
          <View style={styles.skillRowActions}>
            {canShowMoveToUngrouped ? (
              <MoveSkillAction
                skillName={skill.name}
                targetGroupId={null}
                onMoveToGroup={onMoveToGroup}
                translationKey="hostTools.skills.moveToUngrouped"
                label={t("hostTools.skills.moveToUngrouped")}
              />
            ) : null}
            {moveTargets.map((group) => (
              <MoveSkillAction
                key={group.id}
                skillName={skill.name}
                targetGroupId={group.id}
                onMoveToGroup={onMoveToGroup}
                translationKey="hostTools.skills.moveTo"
                label={t("hostTools.skills.moveTo", { name: group.name })}
              />
            ))}
          </View>
        ) : null}
      </View>
      <Switch
        value={skill.enabled}
        onValueChange={handleToggleValue}
        disabled={isPending}
        accessibilityLabel={t("hostTools.skills.toggleSkill", { name: skill.name })}
        testID={`host-skills-switch-${skill.name}`}
      />
    </View>
  );
}

interface MoveSkillActionProps {
  skillName: string;
  targetGroupId: string | null;
  onMoveToGroup: (skillName: string, targetGroupId: string | null) => void;
  translationKey: string;
  label: string;
}

function MoveSkillAction({ skillName, targetGroupId, onMoveToGroup, label }: MoveSkillActionProps) {
  const handlePress = useCallback(() => {
    onMoveToGroup(skillName, targetGroupId);
  }, [onMoveToGroup, skillName, targetGroupId]);
  const pressStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.skillRowAction,
      pressed ? styles.skillRowActionPressed : null,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      style={pressStyle}
    >
      <Text style={styles.skillRowActionLabel}>{label}</Text>
    </Pressable>
  );
}

function generateGroupId(seed: string): string {
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = slug.length > 0 ? slug : "group";
  const stamp = Math.random().toString(36).slice(2, 8);
  return `${base}-${stamp}`;
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
  headerAction: {
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
  headerActionPressed: {
    backgroundColor: theme.colors.surface2,
  },
  headerActionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  inlineForm: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  inlineFormLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  inputPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  inlineFormActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
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
  groupCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  groupHeaderToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    marginHorizontal: -theme.spacing[1],
    marginVertical: -theme.spacing[1],
  },
  groupHeaderTogglePressed: {
    backgroundColor: theme.colors.surface2,
  },
  groupHeaderChevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  groupHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  groupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  groupSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  groupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  groupIconButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  groupIconButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  groupIconButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  groupEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  skillRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[3],
  },
  skillRowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  skillRowText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  skillRowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  skillRowSpinner: {
    marginLeft: theme.spacing[1],
  },
  skillName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  skillDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  skillScopes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  skillRowActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  skillRowAction: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  skillRowActionPressed: {
    backgroundColor: theme.colors.surface3,
  },
  skillRowActionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
