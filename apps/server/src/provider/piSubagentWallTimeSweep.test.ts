import { describe, expect, it } from "vitest";
import { Effect, Layer, Option } from "effect";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import {
  sweepPiSubagentWallTimeExpiry,
  startPiSubagentWallTimeSweep,
} from "./piSubagentWallTimeSweep.ts";

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const baseAdmission = {
  attemptId: "att_sweep_001",
  generation: 1,
  commandFingerprint: "fp_sweep",
  clientCommandId: null,
  subject: "user_sweep",
  projectId: "proj_default",
  parentThreadId: "thread_main",
  parentTurnId: "turn_sweep",
  parentToolCallId: null,
  agentType: "researcher",
  prompt: "sweep seed",
  mode: "foreground" as const,
  cancellationScope: "parent_turn" as const,
  state: "accepted" as const,
  diagnosticCode: "pi_subagent_managed_enabled" as const,
};

describe("sweepPiSubagentWallTimeExpiry (Issue 13 / T13-AC3)", () => {
  it("journals band-60 triggers for expired executions, reports safe metadata, and stays idempotent", async () => {
    const triggers: Array<Record<string, unknown>> = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;

        yield* repository.recordAdmission({
          ...baseAdmission,
          executionId: "exec_sweep_expired",
          attemptId: "att_sweep_expired",
          commandId: "cmd_sweep_expired",
          now: "2026-08-18T10:00:00.000Z",
        });
        yield* repository.recordAdmission({
          ...baseAdmission,
          executionId: "exec_sweep_fresh",
          attemptId: "att_sweep_fresh",
          commandId: "cmd_sweep_fresh",
          now: "2026-08-18T11:59:00.000Z",
        });

        const first = yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => Date.parse("2026-08-18T12:00:00.000Z"),
            onExpiryRecorded: (trigger) => {
              triggers.push({ ...trigger });
            },
          }),
        );
        expect(first).toEqual({ recorded: 1, skipped: 0 });

        const journal = yield* repository.listJournalEvents("exec_sweep_expired");
        expect(journal).toHaveLength(2);
        expect(journal[1]!.sequence).toBe(60);
        expect(journal[1]!.diagnosticCode).toBe("pi_subagent_walltime_expired");

        // Aggregate never settles (T13-AC3).
        const stored = yield* repository.getById("exec_sweep_expired");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("accepted");
        }

        // Second sweep: idempotent — trigger already journaled.
        const second = yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => Date.parse("2026-08-18T12:00:30.000Z"),
            onExpiryRecorded: (trigger) => {
              triggers.push({ ...trigger });
            },
          }),
        );
        expect(second).toEqual({ recorded: 0, skipped: 1 });
        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toEqual({
          executionId: "exec_sweep_expired",
          attemptId: "att_sweep_expired",
          generation: 1,
          parentThreadId: "thread_main",
          diagnosticCode: "pi_subagent_walltime_expired",
          wallTimeMs: 7200000,
        });
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("timer sweep drives periodic evaluation through the injected scheduler", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* repository.recordAdmission({
          ...baseAdmission,
          executionId: "exec_sweep_timer",
          attemptId: "att_sweep_timer",
          commandId: "cmd_sweep_timer",
          now: "2026-08-18T09:00:00.000Z",
        });

        const fired: number[] = [];
        const timers: Array<() => void> = [];
        const timer = startPiSubagentWallTimeSweep({
          repository,
          wallTimeMs: 7200000,
          intervalMs: 100,
          nowMs: () => Date.parse("2026-08-18T12:00:00.000Z"),
          schedule: (_delayMs, callback) => {
            const id = fired.length;
            fired.push(id);
            timers.push(callback);
            return { cancel: () => undefined };
          },
        });

        try {
          expect(fired).toHaveLength(1);
          // Drive the scheduled tick manually.
          timers[0]!();
          yield* Effect.sleep("10 millis");
          const journal = yield* repository.listJournalEvents("exec_sweep_timer");
          expect(journal.some((event) => event.sequence === 60)).toBe(true);
          // Rescheduled after the sweep completed.
          expect(fired.length).toBeGreaterThanOrEqual(2);
        } finally {
          timer.stop();
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
