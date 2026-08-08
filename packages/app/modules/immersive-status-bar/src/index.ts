import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * Native side is a local Expo module (`modules/immersive-status-bar`) that is
 * only linked on Android. On web/iOS the native module is absent, so the
 * require below would throw — guard it and fall back to a no-op.
 */
let nativeModule: {
  setEnabled(enabled: boolean): void;
  getDisplayCutoutInsets(): number[];
} | null = null;

try {
  nativeModule = requireNativeModule("ImmersiveStatusBar");
} catch {
  nativeModule = null;
}

/**
 * Toggle Android immersive sticky status bar mode (transient bars shown by
 * swipe, auto-hiding after a timeout). No-op on non-Android platforms or when
 * the native module failed to load.
 */
export function setImmersiveStatusBar(enabled: boolean): void {
  if (Platform.OS === "android" && nativeModule) {
    nativeModule.setEnabled(enabled);
  }
}

/**
 * Read the current Android display-cutout insets in dp as [top, left, bottom, right].
 * Used by the immersive safe-area override to subtract the cutout strip that
 * SHORT_EDGES still reports even when the status bar is hidden. Returns zeros
 * off-Android or when the native module / insets are unavailable.
 */
export function getDisplayCutoutInsets(): number[] {
  if (Platform.OS !== "android" || !nativeModule) {
    return [0, 0, 0, 0];
  }
  try {
    return nativeModule.getDisplayCutoutInsets();
  } catch {
    return [0, 0, 0, 0];
  }
}
