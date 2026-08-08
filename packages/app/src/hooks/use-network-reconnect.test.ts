/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/constants/platform", () => ({
  isNative: true,
  isWeb: false,
  getIsElectron: () => false,
}));

const notifyAllHostsNetworkChanged = vi.fn();
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    notifyAllHostsNetworkChanged,
  }),
}));

let netInfoListeners: Array<() => void> = [];
vi.mock("@react-native-community/netinfo", () => ({
  addEventListener: (listener: () => void) => {
    netInfoListeners.push(listener);
    return () => {
      netInfoListeners = netInfoListeners.filter((l) => l !== listener);
    };
  },
}));

import { renderHook } from "@testing-library/react";
import { useNetworkReconnect } from "@/hooks/use-network-reconnect";

describe("useNetworkReconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    netInfoListeners = [];
    notifyAllHostsNetworkChanged.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires exactly one notifyNetworkChanged per 500ms debounce window", () => {
    renderHook(() => useNetworkReconnect());

    for (let i = 0; i < 4; i++) {
      for (const listener of netInfoListeners) listener();
    }

    expect(notifyAllHostsNetworkChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(notifyAllHostsNetworkChanged).toHaveBeenCalledTimes(1);
  });

  it("collapses a sustained burst into bounded calls", () => {
    renderHook(() => useNetworkReconnect());

    for (let sec = 0; sec < 5; sec++) {
      for (const listener of netInfoListeners) listener();
      vi.advanceTimersByTime(200);
    }

    vi.advanceTimersByTime(500);

    expect(notifyAllHostsNetworkChanged.mock.calls.length).toBeLessThanOrEqual(5);
    expect(notifyAllHostsNetworkChanged.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("cleans up the debounce timer on unmount", () => {
    const { unmount } = renderHook(() => useNetworkReconnect());

    for (const listener of netInfoListeners) listener();
    unmount();

    vi.advanceTimersByTime(1000);
    expect(notifyAllHostsNetworkChanged).not.toHaveBeenCalled();
  });
});
