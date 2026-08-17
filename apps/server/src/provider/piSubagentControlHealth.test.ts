import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { ThreadId } from "@synara/contracts";

import { makePiSubagentControlHealth } from "./piSubagentControlHealth.ts";

describe("PiSubagentControlHealth (T03-AC3, T03-AC5)", () => {
  it("initializes as available by default", async () => {
    const program = Effect.gen(function* () {
      const health = yield* makePiSubagentControlHealth();
      const state = yield* health.getHealth();
      expect(state.status).toBe("available");
      expect(state.diagnosticCode).toBeUndefined();
      expect(state.reason).toBeUndefined();
    });

    await Effect.runPromise(program);
  });

  it("transitions to degraded with diagnostic code and reason", async () => {
    const program = Effect.gen(function* () {
      const health = yield* makePiSubagentControlHealth();

      yield* health.markDegraded(
        "Persistence failure in sqlite database",
        "pi_subagent_lifecycle_persistence_failed",
      );

      const state = yield* health.getHealth();
      expect(state.status).toBe("degraded");
      expect(state.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(state.reason).toBe("Persistence failure in sqlite database");
      expect(state.degradedAt).toBeDefined();
    });

    await Effect.runPromise(program);
  });

  it("transitions from degraded back to available upon recovery", async () => {
    const program = Effect.gen(function* () {
      const health = yield* makePiSubagentControlHealth({
        status: "degraded",
        diagnosticCode: "pi_subagent_control_degraded",
        reason: "Outage",
      });

      const degradedState = yield* health.getHealth();
      expect(degradedState.status).toBe("degraded");

      yield* health.markAvailable();

      const recoveredState = yield* health.getHealth();
      expect(recoveredState.status).toBe("available");
      expect(recoveredState.diagnosticCode).toBeUndefined();
      expect(recoveredState.reason).toBeUndefined();
    });

    await Effect.runPromise(program);
  });
});

describe("PiSubagentControlHealth transitions (Ticket 21: T21-AC3, T21-AC5, T21-AC6)", () => {
  it("T21-AC3/T21-AC6: degrading reports exactly one transition and repeated degradation is a no-op that keeps the first diagnostic", async () => {
    const program = Effect.gen(function* () {
      const health = yield* makePiSubagentControlHealth();

      const first = yield* health.markDegraded(
        "Failed to persist execution lifecycle truth: disk I/O",
        "pi_subagent_lifecycle_persistence_failed",
        { threadId: "thread_main" as ThreadId },
      );
      expect(first?.from).toBe("available");
      expect(first?.to).toBe("degraded");
      expect(first?.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(first?.threadId).toBe("thread_main");
      expect(first?.occurredAt).toBeDefined();

      const stateAfterFirst = yield* health.getHealth();
      expect(stateAfterFirst.status).toBe("degraded");
      const firstDegradedAt = stateAfterFirst.degradedAt;
      expect(firstDegradedAt).toBeDefined();

      // A second persistence failure while already degraded is NOT a new
      // transition: the first diagnostic and timestamp stay stable.
      const second = yield* health.markDegraded(
        "Failed to persist execution lifecycle truth: second failure",
        "pi_subagent_lifecycle_persistence_failed",
        { threadId: "thread_other" as ThreadId },
      );
      expect(second).toBeNull();

      const stateAfterSecond = yield* health.getHealth();
      expect(stateAfterSecond.degradedAt).toBe(firstDegradedAt);
      expect(stateAfterSecond.reason).toBe(
        "Failed to persist execution lifecycle truth: disk I/O",
      );
    });

    await Effect.runPromise(program);
  });

  it("T21-AC5/T21-AC6: recovery reports exactly one transition and marking available while available is a no-op", async () => {
    const program = Effect.gen(function* () {
      const health = yield* makePiSubagentControlHealth();

      const noop = yield* health.markAvailable({ threadId: "thread_main" as ThreadId });
      expect(noop).toBeNull();

      yield* health.markDegraded("Persistence outage", "pi_subagent_control_degraded");

      const recovery = yield* health.markAvailable({
        threadId: "thread_recovery" as ThreadId,
      });
      expect(recovery?.from).toBe("degraded");
      expect(recovery?.to).toBe("available");
      expect(recovery?.threadId).toBe("thread_recovery");
      expect(recovery?.occurredAt).toBeDefined();

      const second = yield* health.markAvailable();
      expect(second).toBeNull();

      const state = yield* health.getHealth();
      expect(state.status).toBe("available");
      expect(state.diagnosticCode).toBeUndefined();
      expect(state.degradedAt).toBeUndefined();
    });

    await Effect.runPromise(program);
  });

  it("T21-AC5: recovery probes are single-flight — concurrent probes serialize and later probes re-read recovered health themselves", async () => {
    const program = Effect.gen(function* () {
      const health = yield* makePiSubagentControlHealth();
      const order: string[] = [];

      const probeA = health.withRecoveryProbe(
        Effect.gen(function* () {
          order.push("A:start");
          const before = yield* health.getHealth();
          order.push(`A:sees-${before.status}`);
          yield* Effect.sleep(60);
          yield* health.markDegraded("probe A failure", "pi_subagent_control_degraded");
          order.push("A:end");
        }),
      );
      const probeB = health.withRecoveryProbe(
        Effect.gen(function* () {
          order.push("B:start");
          const before = yield* health.getHealth();
          order.push(`B:sees-${before.status}`);
          order.push("B:end");
        }),
      );

      yield* Effect.all([probeA, probeB], { concurrency: "unbounded" });

      // B could not enter while A held the single-flight gate, so B starts
      // only after A finished and re-reads health itself.
      expect(order).toEqual([
        "A:start",
        "A:sees-available",
        "A:end",
        "B:start",
        "B:sees-degraded",
        "B:end",
      ]);
    });

    await Effect.runPromise(program);
  });
});
