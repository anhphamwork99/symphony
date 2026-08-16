import { describe, expect, it } from "vitest";
import { Effect } from "effect";

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
