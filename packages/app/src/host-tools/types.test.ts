/**
 * Unit tests for the host-tools capability resolver. The hook itself is
 * a thin wrapper around `useSessionStore`; testing the resolver covers the
 * "single detection point" contract — the rest of the host-tools UI
 * imports `useHostToolsFeatures` rather than reading `serverInfo` itself,
 * so the resolver is the only place that needs to know about the wire
 * field shape.
 */
import { describe, expect, it } from "vitest";
import {
  classifyHostToolsError,
  HOST_TOOLS_DEFAULT_CAPABILITIES,
  resolveHostToolsCapabilities,
} from "./types";

describe("resolveHostToolsCapabilities", () => {
  it("returns all false for a missing field (older daemon)", () => {
    expect(resolveHostToolsCapabilities(null)).toEqual(HOST_TOOLS_DEFAULT_CAPABILITIES);
    expect(resolveHostToolsCapabilities(undefined)).toEqual(HOST_TOOLS_DEFAULT_CAPABILITIES);
  });

  it("returns all false for an empty field object", () => {
    expect(resolveHostToolsCapabilities({})).toEqual(HOST_TOOLS_DEFAULT_CAPABILITIES);
  });

  it("passes each capability through independently", () => {
    expect(resolveHostToolsCapabilities({ quota: true, roles: true, skills: true })).toEqual({
      quota: true,
      roles: true,
      skills: true,
      hasAny: true,
    });

    expect(resolveHostToolsCapabilities({ quota: true, roles: false, skills: true })).toEqual({
      quota: true,
      roles: false,
      skills: true,
      hasAny: true,
    });

    expect(resolveHostToolsCapabilities({ quota: true })).toEqual({
      quota: true,
      roles: false,
      skills: false,
      hasAny: true,
    });

    expect(resolveHostToolsCapabilities({ skills: true })).toEqual({
      quota: false,
      roles: false,
      skills: true,
      hasAny: true,
    });
  });

  it("treats truthy non-boolean values as off", () => {
    // The protocol only ever emits boolean values, but the resolver is
    // strict-equal to `true` so accidental truthy values (e.g. "true",
    // 1) are treated as off — this matches the rest of the app's
    // capability gating.
    expect(resolveHostToolsCapabilities({ quota: "true" as unknown as true })).toEqual(
      HOST_TOOLS_DEFAULT_CAPABILITIES,
    );
  });
});

describe("classifyHostToolsError", () => {
  it("maps known error codes to the typed union", () => {
    expect(classifyHostToolsError("file_missing")).toBe("file_missing");
    expect(classifyHostToolsError("file_corrupt")).toBe("file_corrupt");
    expect(classifyHostToolsError("version_mismatch")).toBe("version_mismatch");
    expect(classifyHostToolsError("cli_missing")).toBe("cli_missing");
    expect(classifyHostToolsError("cooldown")).toBe("cooldown");
    expect(classifyHostToolsError("in_progress")).toBe("in_progress");
    expect(classifyHostToolsError("config_missing")).toBe("config_missing");
    expect(classifyHostToolsError("config_corrupt")).toBe("config_corrupt");
    expect(classifyHostToolsError("no_active_preset")).toBe("no_active_preset");
    expect(classifyHostToolsError("invalid_model")).toBe("invalid_model");
    expect(classifyHostToolsError("move_conflict")).toBe("move_conflict");
    expect(classifyHostToolsError("permission_denied")).toBe("permission_denied");
  });

  it("falls back to 'unknown' for unrecognized codes", () => {
    expect(classifyHostToolsError("totally_unrelated")).toBe("unknown");
    expect(classifyHostToolsError("")).toBe("unknown");
    expect(classifyHostToolsError(null)).toBe("unknown");
    expect(classifyHostToolsError(undefined)).toBe("unknown");
  });
});
