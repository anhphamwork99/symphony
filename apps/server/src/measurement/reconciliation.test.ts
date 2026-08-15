// FILE: reconciliation.test.ts
// Purpose: WP1 focused tests for the accounting reconciliation kernel
// (Decision 34 §"Reconciliation and acceptance implications", AC2). Tests
// the documented Pi SessionStats reconciliation equation, missing/inconsistent
// component failures, raw turn.completed payload extraction, and the
// raw-vs-normalized cross-check against Synara's projected snapshots.
import { describe, expect, it } from "vitest";

import {
  PI_RECONCILIATION_RULE,
  reconcileSessionStats,
  reconcileRawVsNormalized,
  extractTurnCompletedUsage,
  isFiniteNonNegative,
} from "./reconciliation.ts";
import type { NormalizedTokenSnapshot, RawSessionStats } from "./types.ts";

describe("reconcileSessionStats", () => {
  it("documents the Pi reconciliation equation", () => {
    expect(PI_RECONCILIATION_RULE.equation).toBe("total == input + cacheRead + cacheWrite + output");
    expect(PI_RECONCILIATION_RULE.description.length).toBeGreaterThan(20);
  });

  it("accepts a consistent full session stats record", () => {
    const stats: RawSessionStats = {
      input: 100,
      cacheRead: 200,
      cacheWrite: 50,
      output: 30,
      total: 380,
    };
    const result = reconcileSessionStats(stats);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.equation).toBe(PI_RECONCILIATION_RULE.equation);
  });

  it("accepts a zero-cost fresh session (all zeros)", () => {
    const stats: RawSessionStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    expect(reconcileSessionStats(stats).ok).toBe(true);
  });

  it("fails on a missing component", () => {
    const stats = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } as RawSessionStats;
    const result = reconcileSessionStats(stats);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("total"))).toBe(true);
  });

  it("fails on a negative component", () => {
    const stats: RawSessionStats = {
      input: -1,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    };
    const result = reconcileSessionStats(stats);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("negative"))).toBe(true);
  });

  it("fails on an unexplained inconsistent total", () => {
    const stats: RawSessionStats = {
      input: 100,
      cacheRead: 100,
      cacheWrite: 50,
      output: 30,
      total: 999,
    };
    const result = reconcileSessionStats(stats);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("total"))).toBe(true);
    expect(result.failures.some((failure) => failure.includes("expected 280"))).toBe(true);
  });
});

describe("reconcileRawVsNormalized", () => {
  it("accepts a matching normalized snapshot", () => {
    const raw: RawSessionStats = {
      input: 100,
      cacheRead: 200,
      cacheWrite: 50,
      output: 30,
      total: 380,
    };
    const normalized: NormalizedTokenSnapshot = {
      usedTokens: 380,
      totalProcessedTokens: 380,
      inputTokens: 100,
      cachedInputTokens: 200,
      outputTokens: 30,
    };
    const result = reconcileRawVsNormalized(raw, normalized);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("accepts an absent normalized snapshot when no usage activity was projected", () => {
    const raw: RawSessionStats = {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      total: 0,
    };
    expect(reconcileRawVsNormalized(raw, undefined).ok).toBe(true);
  });

  it("fails when the normalized input tokens disagree with the raw input", () => {
    const raw: RawSessionStats = {
      input: 100,
      cacheRead: 200,
      cacheWrite: 50,
      output: 30,
      total: 380,
    };
    const normalized: NormalizedTokenSnapshot = {
      usedTokens: 380,
      inputTokens: 150,
      cachedInputTokens: 200,
      outputTokens: 30,
    };
    const result = reconcileRawVsNormalized(raw, normalized);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("input"))).toBe(true);
  });

  it("fails when the normalized cached input disagrees with the raw cacheRead", () => {
    const raw: RawSessionStats = {
      input: 100,
      cacheRead: 200,
      cacheWrite: 50,
      output: 30,
      total: 380,
    };
    const normalized: NormalizedTokenSnapshot = {
      usedTokens: 380,
      inputTokens: 100,
      cachedInputTokens: 999,
      outputTokens: 30,
    };
    const result = reconcileRawVsNormalized(raw, normalized);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("cacheRead"))).toBe(true);
  });

  it("fails when the normalized totalProcessedTokens disagrees with the raw total", () => {
    const raw: RawSessionStats = {
      input: 100,
      cacheRead: 200,
      cacheWrite: 50,
      output: 30,
      total: 380,
    };
    const normalized: NormalizedTokenSnapshot = {
      usedTokens: 380,
      totalProcessedTokens: 999,
      inputTokens: 100,
      cachedInputTokens: 200,
      outputTokens: 30,
    };
    const result = reconcileRawVsNormalized(raw, normalized);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("totalProcessedTokens"))).toBe(true);
  });
});

describe("extractTurnCompletedUsage", () => {
  it("extracts a raw usage payload from a turn.completed event payload", () => {
    const payload = {
      state: "completed",
      stopReason: null,
      usage: {
        sessionFile: undefined,
        sessionId: "s1",
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, total: 35 },
        cost: 0.001,
      },
    };
    const result = extractTurnCompletedUsage(payload);
    if (!result.ok) {
      throw new Error(result.failures.join("; "));
    }
    expect(result.value).toEqual({
      state: "completed",
      stopReason: null,
      usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, total: 35, cost: 0.001 },
    });
  });

  it("fails explicitly when the usage payload is missing", () => {
    const result = extractTurnCompletedUsage({ state: "completed", stopReason: null });
    if (result.ok) {
      throw new Error("expected extraction to fail");
    }
    expect(result.failures.some((failure) => failure.includes("usage"))).toBe(true);
  });

  it("fails explicitly on malformed token fields", () => {
    const result = extractTurnCompletedUsage({
      state: "completed",
      stopReason: null,
      usage: { tokens: { input: "nope" } },
    });
    if (result.ok) {
      throw new Error("expected extraction to fail");
    }
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

describe("isFiniteNonNegative", () => {
  it("accepts finite non-negative numbers", () => {
    expect(isFiniteNonNegative(0)).toBe(true);
    expect(isFiniteNonNegative(42)).toBe(true);
  });
  it("rejects negative, NaN, Infinity and non-numbers", () => {
    expect(isFiniteNonNegative(-1)).toBe(false);
    expect(isFiniteNonNegative(Number.NaN)).toBe(false);
    expect(isFiniteNonNegative(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNonNegative("1" as unknown as number)).toBe(false);
    expect(isFiniteNonNegative(undefined as unknown as number)).toBe(false);
  });
});
