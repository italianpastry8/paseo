import { useEffect } from "react";
import { addEventListener as addNetInfoListener } from "@react-native-community/netinfo";
import { isNative } from "@/constants/platform";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

const NETWORK_CHANGE_DEBOUNCE_MS = 500;

/**
 * Native-only. Subscribes to OS network-change events (WiFi → cellular,
 * cellular → WiFi, connectivity regain) and notifies every active host
 * runtime client so they proactively rebuild their daemon connection
 * instead of waiting for the liveness heartbeat to discover the dead socket.
 *
 * Web and Electron skip this hook entirely — their network recovery is
 * adequately served by the existing liveness path.
 *
 * A single physical network switch fires a burst of 3-5 NetInfo events.
 * We debounce on a trailing edge so each switch collapses to one
 * notifyNetworkChanged() call per client.
 */
export function useNetworkReconnect(): void {
  useEffect(() => {
    if (!isNative) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = addNetInfoListener(() => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        getHostRuntimeStore().notifyAllHostsNetworkChanged();
      }, NETWORK_CHANGE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  }, []);
}
