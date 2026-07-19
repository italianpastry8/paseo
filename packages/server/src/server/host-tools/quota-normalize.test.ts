import { describe, expect, it } from "vitest";
import { normalizeQuotaExport, quotaProviderLabel } from "./quota-normalize.js";

describe("normalizeQuotaExport", () => {
  it("normalizes providers, entries, and timestamps", () => {
    const snapshot = normalizeQuotaExport({
      version: 1,
      exportedAt: 1_700_000_000,
      providers: {
        "kimi-for-coding": {
          status: "ok",
          fetchedAt: "2026-07-19T08:00:00.000Z",
          entries: [
            { name: "5h", percentRemaining: 62, resetAt: 1_700_000_600 },
            { name: "weekly", percentUsed: 25, value: "75/100" },
          ],
        },
        ailink: {
          status: "error",
          error: "boom",
          entries: [],
        },
      },
    });

    expect(snapshot.versionMismatch).toBeUndefined();
    expect(snapshot.generatedAtMs).toBe(1_700_000_000_000);
    expect(snapshot.providers).toHaveLength(2);

    const kimi = snapshot.providers[0];
    expect(kimi.label).toBe("Kimi");
    expect(kimi.status).toBe("ok");
    expect(kimi.fetchedAtMs).toBe(Date.parse("2026-07-19T08:00:00.000Z"));
    expect(kimi.entries[0]).toEqual({
      name: "5h",
      window: undefined,
      percentRemaining: 62,
      value: undefined,
      resetAtMs: 1_700_000_600_000,
      unlimited: false,
    });
    expect(kimi.entries[1].percentRemaining).toBe(75);

    const ailink = snapshot.providers[1];
    expect(ailink.status).toBe("error");
    expect(ailink.error).toBe("boom");
  });

  it("flags version mismatch instead of parsing", () => {
    const snapshot = normalizeQuotaExport({ version: 2, providers: { a: { status: "ok" } } });
    expect(snapshot.versionMismatch).toBe(true);
    expect(snapshot.providers).toEqual([]);
  });

  it("maps non-ok statuses to error and skips malformed providers", () => {
    const snapshot = normalizeQuotaExport({
      version: 1,
      providers: {
        x: { status: "unavailable", entries: [] },
        // @ts-expect-error intentionally malformed
        broken: null,
      },
    });
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0].status).toBe("error");
  });

  it("keeps millisecond timestamps as-is and converts seconds", () => {
    const snapshot = normalizeQuotaExport({
      version: 1,
      exportedAt: "1700000000000",
      providers: {
        x: {
          status: "ok",
          entries: [{ name: "a", resetAt: 1_700_000_000_000 }],
        },
      },
    });
    expect(snapshot.generatedAtMs).toBe(1_700_000_000_000);
    expect(snapshot.providers[0].entries[0].resetAtMs).toBe(1_700_000_000_000);
  });
});

describe("quotaProviderLabel", () => {
  it("falls back to the id for unknown providers", () => {
    expect(quotaProviderLabel("kimi-for-coding")).toBe("Kimi");
    expect(quotaProviderLabel("something-new")).toBe("something-new");
  });
});
