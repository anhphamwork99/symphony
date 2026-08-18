import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerDiagnosticsResult } from "@synara/contracts";

import { buildServerDiagnosticsResult } from "./serverDiagnostics.ts";

describe("serverGetDiagnostics result builder (Issue 13 / T13-AC4/T13-AC5)", () => {
  it("publishes the approved Pi metrics block without execution content", () => {
    const diagnostics = buildServerDiagnosticsResult({
      generatedAt: "2026-08-18T12:00:00.000Z",
      pid: 42,
      uptimeSeconds: 12,
      memory: {
        rss: 10,
        heapTotal: 8,
        heapUsed: 4,
        external: 1,
        arrayBuffers: 0,
      },
      childProcesses: [],
      projection: { projectCount: 1, threadCount: 2 },
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
      maxChildProcesses: 100,
    });

    expect(Schema.decodeSync(ServerDiagnosticsResult)(diagnostics)).toEqual(diagnostics);
    expect(diagnostics.piSubagents?.executionCounts.active).toBe(3);
    const serialized = JSON.stringify(diagnostics);
    for (const forbidden of ["prompt", "result", "transcript", "summary", "secret"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
