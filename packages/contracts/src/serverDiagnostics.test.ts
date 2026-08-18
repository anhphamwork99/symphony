import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerDiagnosticsResult } from "./server";

const baseDiagnostics = {
  generatedAt: "2026-08-18T12:00:00.000Z",
  process: {
    pid: 42,
    uptimeSeconds: 10,
    memory: {
      rssBytes: 1,
      heapTotalBytes: 1,
      heapUsedBytes: 1,
      externalBytes: 0,
      arrayBuffersBytes: 0,
    },
  },
  childProcesses: [],
  childProcessTotalCount: 0,
  childProcessTotalRssBytes: 0,
  projection: {
    projectCount: 1,
    threadCount: 2,
  },
};

describe("ServerDiagnosticsResult Pi subagent telemetry (Issue 13 / T13-AC4)", () => {
  it("decodes the approved optional serverGetDiagnostics metrics block", () => {
    const decoded = Schema.decodeSync(ServerDiagnosticsResult)({
      ...baseDiagnostics,
      piSubagents: {
        executionCounts: {
          active: 3,
          queued: 2,
          cancelling: 1,
          orphaned: 4,
          terminal: 5,
        },
        leaseExpiryCount: 6,
        detachLatencyMs: { p50: 50, p95: 95, max: 100 },
        cancelLatencyMs: { p50: 150, p95: 195, max: 200 },
        progress: { coalesced: 500, dropped: 500 },
        completionRetries: 7,
      },
    });

    expect(decoded.piSubagents?.executionCounts.orphaned).toBe(4);
    expect(decoded.piSubagents?.detachLatencyMs.p95).toBe(95);
    expect(decoded.piSubagents?.completionRetries).toBe(7);
  });

  it("keeps the block additive and rejects negative metric values", () => {
    expect(Schema.decodeSync(ServerDiagnosticsResult)(baseDiagnostics).piSubagents).toBeUndefined();
    expect(() =>
      Schema.decodeSync(ServerDiagnosticsResult)({
        ...baseDiagnostics,
        piSubagents: {
          executionCounts: {
            active: -1,
            queued: 0,
            cancelling: 0,
            orphaned: 0,
            terminal: 0,
          },
          leaseExpiryCount: 0,
          detachLatencyMs: { p50: 0, p95: 0, max: 0 },
          cancelLatencyMs: { p50: 0, p95: 0, max: 0 },
          progress: { coalesced: 0, dropped: 0 },
          completionRetries: 0,
        },
      }),
    ).toThrow();
  });
});
