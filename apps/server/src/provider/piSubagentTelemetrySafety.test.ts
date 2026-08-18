import { describe, expect, it } from "vitest";

import { makePiSubagentSafeCorrelation } from "./piSubagentTelemetrySafety.ts";

describe("Pi subagent safe telemetry dimensions (Issue 13 / T13-AC5)", () => {
  it("emits the complete stable correlation set and no content-bearing fields", () => {
    const safe = makePiSubagentSafeCorrelation({
      executionId: "exec_safe_001",
      attemptId: "att_safe_001",
      threadId: "  thread_safe_001  ",
      generation: 3,
      diagnosticCode: "pi_subagent_walltime_expired",
    });

    expect(safe).toEqual({
      executionId: "exec_safe_001",
      attemptId: "att_safe_001",
      threadId: "thread_safe_001",
      generation: 3,
      diagnosticCode: "pi_subagent_walltime_expired",
    });
    expect(Object.keys(safe).toSorted()).toEqual([
      "attemptId",
      "diagnosticCode",
      "executionId",
      "generation",
      "threadId",
    ]);

    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "prompt",
      "result",
      "transcript",
      "rejectionReason",
      "secret",
      "apiKey",
      "bearerToken",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
