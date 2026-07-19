/**
 * Compact horizontal progress bar used by the quota screen to render each
 * provider entry's remaining percentage. The bar takes a single value in
 * the 0..100 range and a variant. Color choices follow the existing app
 * theme tokens: `accent` for healthy remaining, `statusWarning` near the
 * low-water mark, `statusDanger` once the user is close to the limit.
 */
import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface ProgressBarProps {
  /** A value in [0, 100]. Negative values clamp to 0; >100 clamps to 100. */
  value: number;
  /** Optional accessible label; falls back to the numeric value. */
  accessibilityLabel?: string;
  testID?: string;
}

const PROGRESS_BAR_STYLES = StyleSheet.create((theme) => ({
  track: {
    width: "100%" as const,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  fill: {
    height: "100%" as const,
    borderRadius: theme.borderRadius.full,
  },
  fillHealthy: {
    backgroundColor: theme.colors.accent,
  },
  fillWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  fillDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
}));

function pickProgressVariant(value: number) {
  if (value <= 10) return "danger" as const;
  if (value <= 25) return "warning" as const;
  return "healthy" as const;
}

export function ProgressBar({ value, accessibilityLabel, testID }: ProgressBarProps) {
  const { clamped, variant } = useMemo(() => {
    const safeNumber = Number.isFinite(value) ? value : 0;
    return {
      clamped: Math.max(0, Math.min(100, safeNumber)),
      variant: pickProgressVariant(safeNumber),
    };
  }, [value]);

  const accessibilityValue = useMemo(
    () => ({ min: 0, max: 100, now: Math.round(clamped) }),
    [clamped],
  );

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? `${Math.round(clamped)}%`}
      accessibilityValue={accessibilityValue}
      testID={testID}
      style={PROGRESS_BAR_STYLES.track}
    >
      <FillTrack variant={variant} clamped={clamped} />
    </View>
  );
}

function FillTrack({
  variant,
  clamped,
}: {
  variant: ReturnType<typeof pickProgressVariant>;
  clamped: number;
}) {
  const fillStyle = useMemo(
    () => [
      PROGRESS_BAR_STYLES.fill,
      variant === "healthy" && PROGRESS_BAR_STYLES.fillHealthy,
      variant === "warning" && PROGRESS_BAR_STYLES.fillWarning,
      variant === "danger" && PROGRESS_BAR_STYLES.fillDanger,
      { width: `${clamped}%` as const },
    ],
    [variant, clamped],
  );
  return <View style={fillStyle} />;
}
