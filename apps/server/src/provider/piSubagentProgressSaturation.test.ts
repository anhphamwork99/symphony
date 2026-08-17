import { describe, expect, it } from "vitest";

import { makePiSubagentProgressCoalescer } from "./piSubagentProgressCoalescer.ts";

/**
 * Ticket 23 / T23-AC6 saturation evidence: a sustained deterministic progress
 * flood across multiple executions keeps server coalescer state structurally
 * bounded and completed executions release observation ownership.
 *
 * The harness drives the per-execution coalescer (the exact server-side
 * object PiAdapter instantiates per session, configured identically from the
 * resolved server config) on a manually-driven virtual clock, so the flood is
 * fully deterministic — no wall-clock sensitivity.
 *
 * Structural bounds proven:
 * - tracked executions never exceed the number of live executions (one Map
 *   entry each; no per-observation growth);
 * - at most one pending slot per execution regardless of flood size;
 * - emitted flushes are capped at rateHz × simulated duration + 1 per
 *   execution with exact dropped accounting;
 * - after an execution goes idle for max(leaseMs, 2 × heartbeatIntervalMs)
 *   with no progress, its entry is released entirely (timers + slot), so
 *   completed/detached executions release observation ownership;
 * - a 20 000-observation flood keeps the harness memory delta far below the
 *   64 MB bound (RSS measured around the flood; structural bounds above are
 *   the deterministic proof, the RSS check is a coarse secondary guard).
 */

interface ClockTask {
  readonly id: number;
  at: number;
  callback: () => void;
  cancelled: boolean;
}

class VirtualClock {
  private nowMs = 0;
  private seq = 0;
  private readonly tasks: ClockTask[] = [];

  readonly now = (): number => this.nowMs;

  readonly schedule = (delayMs: number, callback: () => void): { readonly cancel: () => void } => {
    this.seq += 1;
    const task: ClockTask = {
      id: this.seq,
      at: this.nowMs + Math.max(0, delayMs),
      callback,
      cancelled: false,
    };
    this.tasks.push(task);
    return { cancel: () => void (task.cancelled = true) };
  };

  pendingCount = (): number => this.tasks.filter((t) => !t.cancelled).length;

  async advance(ms: number): Promise<void> {
    this.nowMs += ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => !t.cancelled && t.at <= this.nowMs)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      if (due.length === 0) break;
      for (const task of due) {
        task.cancelled = true; // fire exactly once
        task.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
    }
  }
}

describe("Pi subagent progress saturation bounds (Issue 23 / T23-AC6)", () => {
  it("a sustained 20k-observation flood across 8 executions stays structurally bounded with exact counters", async () => {
    const clock = new VirtualClock();
    const flushes: Array<{ executionId: string; coalescedCount: number }> = [];

    const flushIntervalMs = 500; // rateHz 2
    const idleTtlMs = Math.max(30_000, 2 * 10_000); // max(lease, 2×heartbeat)

    const coalescer = makePiSubagentProgressCoalescer({
      now: clock.now,
      schedule: clock.schedule,
      onFlush: (flush) => {
        flushes.push({ executionId: flush.executionId, coalescedCount: flush.coalescedCount });
      },
      flushIntervalMs,
      idleTtlMs,
    });

    const executionIds = Array.from({ length: 8 }, (_, i) => `exec_sat_${i + 1}`);
    const perExecution = 2_500;
    const totalObservations = executionIds.length * perExecution; // 20 000

    const rssBefore = process.memoryUsage.rss();

    // Sustained flood: 10 simulated seconds per execution, interleaved so all
    // 8 executions are tracked simultaneously (worst-case structural state).
    for (let i = 0; i < perExecution; i += 1) {
      await clock.advance(4); // 2500 × 4 ms = 10 s simulated
      for (const executionId of executionIds) {
        await coalescer.recordProgress(
          executionId,
          JSON.stringify({ turnCount: i + 1, activity: `sat ${executionId} step ${i + 1}` }),
        );
      }
      // Structural bound: never more tracked executions than live executions,
      // never more than one pending slot per execution — at ANY flood point.
      expect(coalescer.trackedExecutions()).toBeLessThanOrEqual(executionIds.length);
      expect(coalescer.pendingCount()).toBeLessThanOrEqual(executionIds.length);
    }
    // Flush all trailing slots.
    await clock.advance(flushIntervalMs + 100);

    const rssAfter = process.memoryUsage.rss();
    // Coarse secondary guard: a 20k flood must not approach linear retention
    // (each observation payload is ~60 bytes; 20k × 60 B ≈ 1.2 MB — the bound
    // allows allocator noise but fails on linear-in-observations retention
    // which would be tens of MB and growing).
    expect(rssAfter - rssBefore).toBeLessThan(64 * 1024 * 1024);

    // Emission cap per execution: rateHz × duration + 1 (trailing edge).
    for (const executionId of executionIds) {
      const emitted = flushes.filter((f) => f.executionId === executionId).length;
      expect(emitted).toBeLessThanOrEqual(2 * (10_000 / 1000) + 1);
      expect(emitted).toBeGreaterThanOrEqual(19);
    }

    // Exact accounting: emitted + coalesced == observations per execution.
    const stats = coalescer.stats();
    expect(stats.totalEmitted).toBe(flushes.length);
    expect(stats.totalCoalesced + stats.totalEmitted).toBe(totalObservations);

    // All 8 executions tracked while active…
    expect(coalescer.trackedExecutions()).toBe(executionIds.length);
    expect(clock.pendingCount()).toBe(executionIds.length); // idle timers armed

    // …and every one releases observation ownership after the idle TTL.
    await clock.advance(idleTtlMs + 100);
    expect(coalescer.trackedExecutions()).toBe(0);
    expect(coalescer.pendingCount()).toBe(0);
    expect(clock.pendingCount()).toBe(0); // no leaked timers
    const idleFlushCount = flushes.length;
    expect(idleFlushCount).toBe(stats.totalEmitted); // idle cleanup emitted nothing new
  });

  it("dispose() flushes the pending trailing snapshot exactly once and removes the entry", async () => {
    const clock = new VirtualClock();
    const flushes: Array<{ executionId: string; progressJson: string; coalescedCount: number }> =
      [];

    const coalescer = makePiSubagentProgressCoalescer({
      now: clock.now,
      schedule: clock.schedule,
      onFlush: (flush) => {
        flushes.push({
          executionId: flush.executionId,
          progressJson: flush.progressJson,
          coalescedCount: flush.coalescedCount,
        });
      },
      flushIntervalMs: 500,
      idleTtlMs: 30_000,
    });

    // Three rapid observations; only the latest snapshot may survive.
    await coalescer.recordProgress("exec_disp_1", '{"turnCount":1}');
    await coalescer.recordProgress("exec_disp_1", '{"turnCount":2}');
    await coalescer.recordProgress("exec_disp_1", '{"turnCount":3}');

    expect(coalescer.hasPending("exec_disp_1")).toBe(true);

    // Inline completion: dispose BEFORE the flush timer fires.
    await coalescer.dispose("exec_disp_1");

    expect(coalescer.trackedExecutions()).toBe(0);
    expect(flushes).toHaveLength(1);
    expect(JSON.parse(flushes[0]!.progressJson).turnCount).toBe(3); // trailing edge
    expect(flushes[0]!.coalescedCount).toBe(2); // exactly the two replaced snapshots

    // The cancelled flush timer must never fire later.
    await clock.advance(5_000);
    expect(flushes).toHaveLength(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("idle release then late progress re-tracks the execution with fresh state", async () => {
    const clock = new VirtualClock();
    const flushes: string[] = [];

    const coalescer = makePiSubagentProgressCoalescer({
      now: clock.now,
      schedule: clock.schedule,
      onFlush: (flush) => {
        flushes.push(flush.progressJson);
      },
      flushIntervalMs: 500,
      idleTtlMs: 30_000,
    });

    await coalescer.recordProgress("exec_late_1", '{"turnCount":1}');
    await clock.advance(600); // flush
    await clock.advance(30_500); // idle TTL fires → entry released
    expect(coalescer.trackedExecutions()).toBe(0);

    // A detached producer that reports progress again re-enters cleanly.
    await coalescer.recordProgress("exec_late_1", '{"turnCount":2}');
    expect(coalescer.trackedExecutions()).toBe(1);
    await clock.advance(600);
    expect(flushes).toEqual(['{"turnCount":1}', '{"turnCount":2}']);
  });
});
