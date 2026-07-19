/**
 * Shared formatting and error helpers for the host-tools screens.
 *
 * The screens all need the same few small pieces:
 *   - a structured error renderer that matches the daemon's error codes to
 *     a friendly message and a hint;
 *   - a timestamp formatter that gives the user a "3 minutes ago" feel
 *     without an external date library;
 *   - a percentage formatter that handles the daemon's "percentRemaining"
 *     numbers safely.
 */
import { useTranslation } from "react-i18next";
import { classifyHostToolsError, type HostToolsErrorCode } from "./types";

export interface ResolvedHostToolsError {
  code: HostToolsErrorCode;
  title: string;
  description: string | null;
}

export function useResolveHostToolsError(
  code: string | null | undefined,
  fallbackMessage?: string | null,
): ResolvedHostToolsError | null {
  const { t } = useTranslation();
  if (!code && !fallbackMessage) {
    return null;
  }
  const resolved = classifyHostToolsError(code);
  const title = t(`hostTools.errors.${resolved}.title`);
  const description =
    fallbackMessage && fallbackMessage.length > 0
      ? fallbackMessage
      : t(`hostTools.errors.${resolved}.description`);
  return {
    code: resolved,
    title,
    description: description === "" ? null : description,
  };
}

export function formatRelativeTimestampMs(
  timestampMs: number | null | undefined,
  nowMs: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!timestampMs) {
    return t("hostTools.common.unknownTime");
  }
  const deltaMs = nowMs - timestampMs;
  if (deltaMs < 0) {
    return t("hostTools.common.justNow");
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 30) {
    return t("hostTools.common.justNow");
  }
  if (seconds < 60) {
    return t("hostTools.common.secondsAgo", { count: seconds });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("hostTools.common.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("hostTools.common.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return t("hostTools.common.daysAgo", { count: days });
}

export function formatClockTime(timestampMs: number | null | undefined): string {
  if (!timestampMs) {
    return "—";
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const paddedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${paddedMinutes}`;
}

export function formatPercentRemaining(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value);
  return `${rounded}%`;
}

export function useNowMs(refreshTick: number): number {
  // `refreshTick` is included to force the consumer to recompute when the
  // host pushes a fresh snapshot; the value itself is unused. The hook
  // signature keeps the call-site declarative.
  void refreshTick;
  return Date.now();
}
