/**
 * Host tools menu — the icon-only button + the dropdown anchored to it.
 *
 * Visibility is gated entirely on the result of `useHostToolsFeatures`. When
 * every capability is off (or `serverInfo.features.hostTools` is missing on
 * an older daemon) the entire component renders nothing. When at least one
 * capability is on, the Puzzle button appears in the workspace header and
 * each menu item is rendered conditionally on its own capability.
 *
 * Visual treatment mirrors the existing header action buttons (the
 * `WorkspaceActions` kebab and the file-explorer toggle): icon-only on both
 * compact and desktop, with the same padding/radius the parent uses for
 * `headerActionButton` / `compactHeaderActionButton`.
 */
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Puzzle } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildHostToolsQuotaRoute,
  buildHostToolsRolesRoute,
  buildHostToolsSkillsRoute,
} from "./routes";
import { useHostToolsFeatures } from "./use-host-tools-features";
import type { Theme } from "@/styles/theme";

interface HostToolsMenuProps {
  serverId: string;
  isCompact: boolean;
}

const ThemedPuzzle = withUnistyles(Puzzle);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function HostToolsTooltipLabel({ label }: { label: string }): ReactElement {
  return (
    <View style={tooltipStyles.row}>
      <Text style={tooltipStyles.text}>{label}</Text>
    </View>
  );
}

const tooltipStyles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));

const triggerStyles = StyleSheet.create((theme) => ({
  regular: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  compact: {
    width: theme.spacing[8],
    height: theme.spacing[8],
    padding: 0,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
}));

export function HostToolsMenu({ serverId, isCompact }: HostToolsMenuProps): ReactElement | null {
  const { t } = useTranslation();
  const router = useRouter();
  const features = useHostToolsFeatures(serverId);

  const handleSelect = useCallback(
    (href: Href) => () => {
      router.push(href);
    },
    [router],
  );

  const triggerStyle = isCompact ? triggerStyles.compact : triggerStyles.regular;
  const triggerLabel = t("hostTools.menu.trigger");

  const renderIcon = useCallback(
    (state: { hovered: boolean; pressed: boolean; open: boolean }) => {
      const colorMapping =
        state.hovered || state.pressed || state.open ? foregroundColorMapping : mutedColorMapping;
      return <ThemedPuzzle size={isCompact ? 20 : 16} uniProps={colorMapping} />;
    },
    [isCompact],
  );

  const items = useMemo(() => {
    if (!features.hasAny) {
      return null;
    }
    const out: ReactElement[] = [];
    if (features.quota) {
      out.push(
        <DropdownMenuItem
          key="quota"
          testID="host-tools-menu-quota"
          onSelect={handleSelect(buildHostToolsQuotaRoute(serverId))}
        >
          {t("hostTools.menu.items.quota")}
        </DropdownMenuItem>,
      );
    }
    if (features.roles) {
      out.push(
        <DropdownMenuItem
          key="roles"
          testID="host-tools-menu-roles"
          onSelect={handleSelect(buildHostToolsRolesRoute(serverId))}
        >
          {t("hostTools.menu.items.roles")}
        </DropdownMenuItem>,
      );
    }
    if (features.skills) {
      out.push(
        <DropdownMenuItem
          key="skills"
          testID="host-tools-menu-skills"
          onSelect={handleSelect(buildHostToolsSkillsRoute(serverId))}
        >
          {t("hostTools.menu.items.skills")}
        </DropdownMenuItem>,
      );
    }
    return out;
  }, [features.hasAny, features.quota, features.roles, features.skills, handleSelect, serverId, t]);

  if (!features.hasAny) {
    return null;
  }

  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            testID="host-tools-menu-trigger"
            style={triggerStyle}
            accessibilityRole="button"
            accessibilityLabel={triggerLabel}
          >
            {renderIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={6}>
          <HostToolsTooltipLabel label={triggerLabel} />
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" width={220} testID="host-tools-menu" side="bottom">
        <DropdownMenuLabel>{t("hostTools.menu.title")}</DropdownMenuLabel>
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
