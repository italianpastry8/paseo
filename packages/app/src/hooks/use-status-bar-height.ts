import { Platform } from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Live Android status bar occlusion height, or 0 elsewhere.
 *
 * StatusBar.currentHeight keeps reporting the physical bar height even when the
 * bar is hidden (immersive mode), which offsets anchored overlays by ~24-64px.
 * The safe-area top inset equals the bar height when shown and drops to 0 when
 * the bar hides, so it tracks the actual occlusion. Non-Android platforms never
 * contributed a value (0), so they keep returning 0.
 */
export function useStatusBarHeight(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android" ? insets.top : 0;
}

/**
 * Non-hook variant for reads that happen outside a React component body.
 *
 * Same platform semantics as useStatusBarHeight, but a static snapshot:
 * initialWindowMetrics captures the insets when the safe-area provider
 * initializes and does not re-read when the bar toggles.
 */
export function getStatusBarHeight(): number {
  if (Platform.OS !== "android") return 0;
  return initialWindowMetrics?.insets.top ?? 0;
}
