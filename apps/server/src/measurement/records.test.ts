// FILE: records.test.ts
// Purpose: WP2 focused tests for the record/report kernel (Decision 34 §1/§4).
// Covers per-turn delta computation, per-repetition records, paired deltas,
// spread/variance summaries, catalog identity/size, visible invalid runs,
// config equivalence checks, and the insufficient-evidence logic.
import { describe, expect, it } from "vitest";

import { computeTurnDelta, makeTurnMeasurement } from "./records.ts";
import {
  buildRunSetSummary,
  computePairedDeltas,
  componentSummary,
  evaluateEvidence,
  makeRecommendation,
  RunSetAnalysisError,
} from "./records.ts";
import type {
  CanonicalManifestSummary,
  ExposureEvidence,
  RawSessionStats,
  RepetitionRecord,
} from "./types.ts";

const raw = (overrides: Partial<RawSessionStats> = {}): RawSessionStats => ({
  input: 100,
  output: 30,
  cacheRead: 200,
  cacheWrite: 50,
  total: 380,
  ...overrides,
});

const manifest: CanonicalManifestSummary = {
  toolNames: ["bash", "read", "write"],
  toolCount: 3,
  canonicalBytes: 1234,
  hash: "abc123",
  hashAlgorithm: "sha256",
  method: "sort-by-name; compact JSON; UTF-8; sha256",
  localCaptureProduced: true,
  catalogComplete: true,
};

const exposure: ExposureEvidence = {
  mode: "standalone",
  projectSynaraMcpDesiredState: null,
  activationSucceeded: false,
  dormantObserved: true,
  lifecycleFailures: [],
};

const config = {
  model: "openai/gpt-5.6-sol",
  thinkingLevel: "medium",
  promptHash: "h",
  promptBytes: 10,
  workspaceCwd: "/tmp/ws",
  agentDir: "/tmp/agent",
  harnessVersion: "test",
};

describe("computeTurnDelta", () => {
  it("computes per-component deltas (after - before)", () => {
    const before: RawSessionStats = { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, total: 35 };
    const after: RawSessionStats = { input: 60, output: 20, cacheRead: 90, cacheWrite: 30, total: 200 };
    const delta = computeTurnDelta(before, after);
    expect(delta).toEqual({ input: 50, output: 15, cacheRead: 70, cacheWrite: 30, total: 165 });
  });

  it("reports the same per-turn delta twice when the same after record is used", () => {
    const before: RawSessionStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    const after: RawSessionStats = { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, total: 15 };
    const delta = computeTurnDelta(before, after);
    expect(delta.total).toBe(15);
  });
});

describe("makeTurnMeasurement", () => {
  it("records a valid reconciled turn", () => {
    const measurement = makeTurnMeasurement({
      turnIndex: 1,
      before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
      after: raw(),
      normalized: { usedTokens: 380, totalProcessedTokens: 380, inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 },
    });
    expect(measurement.invalid).toBe(false);
    expect(measurement.reconcileOk).toBe(true);
    expect(measurement.crossCheckOk).toBe(true);
    expect(measurement.delta).toEqual({ input: 100, output: 30, cacheRead: 200, cacheWrite: 50, total: 380 });
  });

  it("marks the turn invalid on reconciliation failure with explicit reasons", () => {
    const measurement = makeTurnMeasurement({
      turnIndex: 1,
      before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
      after: raw({ total: 999 }),
    });
    expect(measurement.invalid).toBe(true);
    expect(measurement.reconcileFailures.length).toBeGreaterThan(0);
    expect(measurement.invalidReason).toContain("reconciliation");
  });

  it("marks the turn invalid on a cross-check failure", () => {
    const measurement = makeTurnMeasurement({
      turnIndex: 1,
      before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
      after: raw(),
      normalized: { usedTokens: 380, inputTokens: 999, cachedInputTokens: 200, outputTokens: 30 },
    });
    expect(measurement.invalid).toBe(true);
    expect(measurement.crossCheckFailures.length).toBeGreaterThan(0);
  });

  it("keeps an explicit invalid reason when provided", () => {
    const measurement = makeTurnMeasurement({
      turnIndex: 2,
      before: raw(),
      after: raw({ input: 150, output: 40, cacheRead: 200, cacheWrite: 50, total: 440 }),
      normalized: {
        usedTokens: 440,
        totalProcessedTokens: 440,
        inputTokens: 150,
        cachedInputTokens: 200,
        outputTokens: 40,
      },
      invalidReason: "tool call observed",
    });
    expect(measurement.invalid).toBe(true);
    expect(measurement.invalidReason).toBe("tool call observed");
    expect(measurement.reconcileOk).toBe(true);
  });
});

describe("computePairedDeltas", () => {
  it("computes paired deltas between turn 2 and turn 1 of each repetition", () => {
    const repetitions: readonly RepetitionRecord[] = [
      {
        mode: "standalone",
        repetitionIndex: 0,
        manifest,
        startup: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
        turns: [
          makeTurnMeasurement({
            turnIndex: 1,
            before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
            after: raw(),
          }),
          makeTurnMeasurement({
            turnIndex: 2,
            before: raw(),
            after: raw({ input: 140, output: 40, cacheRead: 200, cacheWrite: 50, total: 430 }),
          }),
        ],
        invalid: false,
        exposureEvidence: exposure,
        config,
      },
    ];
    const deltas = computePairedDeltas(repetitions);
    expect(deltas).toHaveLength(1);
    // Paired delta = turn-2 incremental cost minus turn-1 incremental cost.
    // Turn 1 cost {100,30,200,50,380}; turn 2 cost {40,10,0,0,50}.
    const delta = deltas[0]!;
    expect(delta.input).toBe(-60);
    expect(delta.output).toBe(-20);
    expect(delta.cacheRead).toBe(-200);
    expect(delta.cacheWrite).toBe(-50);
    expect(delta.total).toBe(-330);
    expect(delta.consistentDirection).toBe(true);
  });

  it("reports inconsistent direction when components move opposite ways", () => {
    const repetitions: readonly RepetitionRecord[] = [
      {
        mode: "standalone",
        repetitionIndex: 0,
        manifest,
        startup: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
        turns: [
          makeTurnMeasurement({
            turnIndex: 1,
            before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
            after: raw(),
          }),
          makeTurnMeasurement({
            turnIndex: 2,
            before: raw(),
            after: raw({ input: 140, output: 30, cacheRead: 300, cacheWrite: 50, total: 520 }),
          }),
        ],
        invalid: false,
        exposureEvidence: exposure,
        config,
      },
    ];
    const [delta] = computePairedDeltas(repetitions);
    // input +40 (positive), cacheRead +100 (positive), output 0, total +140: all
    // non-zero components agree in direction; cacheWrite 0 is neutral.
    expect(delta!.consistentDirection).toBe(true);
  });

  it("throws when a repetition does not have exactly two valid turns", () => {
    const repetitions: readonly RepetitionRecord[] = [
      {
        mode: "standalone",
        repetitionIndex: 0,
        manifest,
        startup: raw(),
        turns: [
          makeTurnMeasurement({
            turnIndex: 1,
            before: raw(),
            after: raw(),
          }),
        ],
        invalid: false,
        exposureEvidence: exposure,
        config,
      },
    ];
    expect(() => computePairedDeltas(repetitions)).toThrow(RunSetAnalysisError);
  });
});

describe("componentSummary", () => {
  it("computes mean, min, max, range and sample variance", () => {
    const summary = componentSummary([10, 20, 30]);
    expect(summary.mean).toBe(20);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(30);
    expect(summary.range).toBe(20);
    // sample variance of [10,20,30] = ((100+0+100)/2) = 100
    expect(summary.sampleVariance).toBe(100);
    expect(summary.sampleStdDev).toBe(10);
    expect(summary.values).toEqual([10, 20, 30]);
  });

  it("handles a single value with zero variance", () => {
    const summary = componentSummary([42]);
    expect(summary.mean).toBe(42);
    expect(summary.sampleVariance).toBe(0);
    expect(summary.sampleStdDev).toBe(0);
  });

  it("handles an empty list with NaN-free zeros", () => {
    const summary = componentSummary([]);
    expect(summary.mean).toBe(0);
    expect(summary.range).toBe(0);
    expect(Number.isNaN(summary.sampleVariance)).toBe(false);
  });
});

describe("buildRunSetSummary", () => {
  it("separates valid and invalid repetitions and builds per-component summaries", () => {
    const valid: RepetitionRecord = {
      mode: "standalone",
      repetitionIndex: 0,
      manifest,
      startup: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
      turns: [
        makeTurnMeasurement({
          turnIndex: 1,
          before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
          after: raw(),
          normalized: {
            usedTokens: 380,
            totalProcessedTokens: 380,
            inputTokens: 100,
            cachedInputTokens: 200,
            outputTokens: 30,
          },
        }),
        makeTurnMeasurement({
          turnIndex: 2,
          before: raw(),
          after: raw({ input: 140, output: 40, cacheRead: 200, cacheWrite: 50, total: 430 }),
          normalized: {
            usedTokens: 430,
            totalProcessedTokens: 430,
            inputTokens: 140,
            cachedInputTokens: 200,
            outputTokens: 40,
          },
        }),
      ],
      invalid: false,
      exposureEvidence: exposure,
      config,
    };
    const invalidRecord: RepetitionRecord = {
      ...valid,
      repetitionIndex: 1,
      turns: [
        makeTurnMeasurement({
          turnIndex: 1,
          before: raw(),
          after: raw(),
          invalidReason: "tool call observed",
        }),
        makeTurnMeasurement({
          turnIndex: 2,
          before: raw(),
          after: raw({ input: 140, output: 40, cacheRead: 200, cacheWrite: 50, total: 430 }),
        }),
      ],
      invalid: true,
      invalidReason: "turn 1 invalid: tool call observed",
    };
    const summary = buildRunSetSummary({
      mode: "standalone",
      repetitions: [valid, invalidRecord],
    });
    expect(summary.validRepetitions).toHaveLength(1);
    expect(summary.invalidRepetitions).toHaveLength(1);
    expect(summary.pairedDeltas).toHaveLength(1);
    expect(summary.components.total.values).toEqual([-330]);
  });

  it("keeps invalid repetitions visible instead of dropping them", () => {
    const invalidRecord: RepetitionRecord = {
      mode: "standalone",
      repetitionIndex: 0,
      manifest,
      startup: raw(),
      turns: [],
      invalid: true,
      invalidReason: "lifecycle failure",
      exposureEvidence: { ...exposure, lifecycleFailures: ["server died"] },
      config,
    };
    const summary = buildRunSetSummary({
      mode: "standalone",
      repetitions: [invalidRecord],
    });
    expect(summary.validRepetitions).toHaveLength(0);
    expect(summary.invalidRepetitions).toHaveLength(1);
    expect(summary.invalidRepetitions[0]!.invalidReason).toBe("lifecycle failure");
  });
});

describe("evaluateEvidence", () => {
  it("declares insufficient evidence when required repetitions are missing", () => {
    const verdict = evaluateEvidence({
      mode: "standalone",
      repetitions: 3,
      turnsPerRepetition: 2,
      model: "m",
      thinkingLevel: "medium",
      promptHash: "h",
      promptBytes: 10,
      harnessVersion: "test",
    }, []);
    expect(verdict.insufficientEvidence).toBe(true);
    expect(verdict.reasons).toContain("incomplete-repetitions");
  });

  it("declares sufficient evidence for a full valid matrix", () => {
    const valid = (index: number): RepetitionRecord => ({
      mode: "standalone",
      repetitionIndex: index,
      manifest,
      startup: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
      turns: [
        makeTurnMeasurement({
          turnIndex: 1,
          before: raw({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }),
          after: raw({ input: 100 + index, output: 30, cacheRead: 200, cacheWrite: 50, total: 380 + index }),
          normalized: {
            usedTokens: 380 + index,
            totalProcessedTokens: 380 + index,
            inputTokens: 100 + index,
            cachedInputTokens: 200,
            outputTokens: 30,
          },
        }),
        makeTurnMeasurement({
          turnIndex: 2,
          before: raw({ input: 100 + index, output: 30, cacheRead: 200, cacheWrite: 50, total: 380 + index }),
          after: raw({ input: 140 + index, output: 40, cacheRead: 200, cacheWrite: 50, total: 430 + index }),
          normalized: {
            usedTokens: 430 + index,
            totalProcessedTokens: 430 + index,
            inputTokens: 140 + index,
            cachedInputTokens: 200,
            outputTokens: 40,
          },
        }),
      ],
      invalid: false,
      exposureEvidence: exposure,
      config,
    });
    const verdict = evaluateEvidence({
      mode: "standalone",
      repetitions: 3,
      turnsPerRepetition: 2,
      model: "m",
      thinkingLevel: "medium",
      promptHash: "h",
      promptBytes: 10,
      harnessVersion: "test",
    }, [valid(0), valid(1), valid(2)]);
    expect(verdict.insufficientEvidence).toBe(false);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.validPairCount).toBe(3);
  });

  it("declares insufficient evidence on an incomplete catalog", () => {
    const record: RepetitionRecord = {
      mode: "synara-activated",
      repetitionIndex: 0,
      manifest: { ...manifest, catalogComplete: false, catalogIncompleteReason: "unreachable" },
      startup: raw(),
      turns: [
        makeTurnMeasurement({
          turnIndex: 1,
          before: raw(),
          after: raw(),
        }),
        makeTurnMeasurement({
          turnIndex: 2,
          before: raw(),
          after: raw({ input: 140, output: 40, cacheRead: 200, cacheWrite: 50, total: 430 }),
        }),
      ],
      invalid: false,
      exposureEvidence: { ...exposure, mode: "synara-activated" },
      config,
    };
    const verdict = evaluateEvidence({
      mode: "synara-activated",
      repetitions: 1,
      turnsPerRepetition: 2,
      model: "m",
      thinkingLevel: "medium",
      promptHash: "h",
      promptBytes: 10,
      harnessVersion: "test",
    }, [record]);
    expect(verdict.insufficientEvidence).toBe(true);
    expect(verdict.reasons).toContain("incomplete-catalog");
  });
});

describe("makeRecommendation", () => {
  it("supports investigation when every valid paired delta agrees on direction", () => {
    const recommendation = makeRecommendation({
      consistentDirection: true,
      component: "total",
      pairedCount: 3,
      direction: "positive",
    });
    expect(recommendation.kind).toBe("supports-investigation");
  });

  it("is inconclusive when direction is not consistent across valid pairs", () => {
    const recommendation = makeRecommendation({
      consistentDirection: false,
      component: "total",
      pairedCount: 3,
      direction: "mixed",
    });
    expect(recommendation.kind).toBe("inconclusive");
  });

  it("never recommends against when there are no valid pairs", () => {
    const recommendation = makeRecommendation({
      consistentDirection: false,
      component: "total",
      pairedCount: 0,
      direction: "none",
    });
    expect(recommendation.kind).toBe("inconclusive");
  });
});
