import { type ReactNode, useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useAppSettings } from "@/hooks/use-settings";
import { getDisplayCutoutInsets } from "../../modules/immersive-status-bar/src";

/**
 * Correct the safe-area insets handed to the app while Android immersive mode is
 * active. With `layoutInDisplayCutoutMode` SHORT_EDGES the display-cutout insets are
 * always dispatched — even when the status bar is hidden — so
 * react-native-safe-area-context reports a phantom cutout strip and the app pads it
 * with an app-colored band (observed at ~42dp on foldables in landscape). This
 * subtracts the cutout contribution per edge from the merged insets so the app stops
 * padding that band.
 *
 * Inactive (non-Android, setting off, or settings still loading) renders children
 * unchanged — `useAppSettings` normalizes the setting to `false` until load, so this
 * engages only after the persisted value is available.
 */
export function ImmersiveInsetsOverride({ children }: { children: ReactNode }) {
  const { settings } = useAppSettings();
  const realInsets = useSafeAreaInsets();
  // Re-read the cutout on rotation / fold, which changes window dimensions.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const active = Platform.OS === "android" && settings.immersiveStatusBar;

  const insets = useMemo<EdgeInsets>(() => {
    if (!active) {
      return realInsets;
    }
    // [top, left, bottom, right] in dp — same unit as useSafeAreaInsets() (the
    // library converts px -> dp via PixelUtil.toDIPFromPixel before emitting events).
    const cutout = getDisplayCutoutInsets();
    return {
      top: Math.max(0, realInsets.top - cutout[0]),
      left: Math.max(0, realInsets.left - cutout[1]),
      bottom: Math.max(0, realInsets.bottom - cutout[2]),
      right: Math.max(0, realInsets.right - cutout[3]),
    };
    // windowWidth/windowHeight are the re-query trigger for rotation/fold, not
    // inputs to the subtraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, realInsets, windowWidth, windowHeight]);

  if (!active) {
    return children;
  }
  return <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>;
}
