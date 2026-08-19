import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer } from "effect";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";
import {
  startPiSubagentProcessTeardownSweep,
  sweepPiSubagentProcessTeardown,
} from "./piSubagentProcessTeardownSweep.ts";

/**
 * Ticket 16 — Owned process-tree teardown sweep driver (Testing Seam:
 * deterministic process-supervisor integration boundary with owned,
 * unrelated, surviving, graceful, and restart fixtures; approved
 * 2026-08-16).
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

const baseAdmission = {
  executionId: "exec_tds_1",
  attemptId: "att_tds_1",
  generation: 1,
  commandId: "cmd_tds_1",
  commandFingerprint: "fp_tds",
  clientCommandId: null,
  subject: "user_tds",
  projectId: "proj_default",
  parentThreadId: "thread_tds",
  parentTurnId: "turn_tds",
  parentToolCallId: null,
  agentType: "general-purpose",
  prompt: "teardown sweep seed",
  mode: "background" as const,
  cancellationScope: "parent_turn" as const,
  state: "accepted" as const,
  diagnosticCode: "pi_subagent_managed_enabled" as const,
};

describe("sweepPiSubagentProcessTeardown (Issue 16 driver)", () => {
  it.layer(repositoryLayer)(
    "resolves the owned supervisor per execution and reports safe outcome metadata",
    (it) => {
      it.effect("settles a proven owned teardown through the driver", () =>
        Effect.gen(function* () {
          const repository = yield* PiSubagentExecutionRepository;
          yield* repository.recordAdmission({
            ...baseAdmission,
            now: "2026-08-19T09:00:00.000Z",
          });
          yield* repository.recordLifecycleEvent({
            eventId: "evt_tds_cancelling",
            executionId: baseAdmission.executionId,
            attemptId: baseAdmission.attemptId,
            generation: 1,
            sequence: 2,
            state: "cancelling",
            occurredAt: "2026-08-19T11:58:00.000Z",
            diagnosticCode: "pi_subagent_cancel_escalated",
            diagnosticMessage: "fixture: cancelling before teardown",
          });
          yield* repository.recordWatchdogStageEvent({
            executionId: baseAdmission.executionId,
            attemptId: baseAdmission.attemptId,
            generation: 1,
            sequence: PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
            state: "cancelling",
            occurredAt: "2026-08-19T11:59:00.000Z",
            diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
            diagnosticMessage: "fixture teardown handoff",
            metadata: { phase: "watchdog_escalation", reason: "session_stop_timeout" },
          });

          const dispatched: string[] = [];
          const outcomes: Array<{
            executionId: string;
            outcomeKind: string;
            diagnosticCode: string;
          }> = [];
          const diagnostics: Array<{ diagnosticCode: string; parentThreadId: string }> = [];

          const result = yield* Effect.promise(() =>
            sweepPiSubagentProcessTeardown({
              repository,
              resolveOwnedTeardown: async (execution) => {
                dispatched.push(execution.parentThreadId);
                return { kind: "proven" as const };
              },
              now: () => NOW,
              onDiagnostic: (event) => {
                diagnostics.push({
                  diagnosticCode: event.diagnosticCode,
                  parentThreadId: event.parentThreadId,
                });
              },
              onOutcome: (outcome) => {
                outcomes.push({
                  executionId: outcome.executionId,
                  outcomeKind: outcome.outcomeKind,
                  diagnosticCode: outcome.diagnosticCode,
                });
              },
            }),
          );

          expect(result.processed).toBe(1);
          expect(dispatched).toEqual(["thread_tds"]);
          expect(outcomes).toEqual([
            {
              executionId: "exec_tds_1",
              outcomeKind: "settled_proven",
              // Truthful operator vocabulary: the outcome's diagnostic code
              // matches the outcome kind (never a hardcoded proven literal).
              diagnosticCode: "pi_subagent_teardown_proven",
            },
          ]);
          // The driver forwards the operator diagnostics with the safe
          // correlation identity (thread/execution), fixed vocabulary only.
          expect(
            diagnostics.some(
              (event) =>
                event.diagnosticCode === "pi_subagent_teardown_proven" &&
                event.parentThreadId === "thread_tds",
            ),
          ).toBe(true);

          const stored = yield* repository.getById("exec_tds_1");
          expect(stored).toBeDefined();
          if (stored && "_tag" in stored && stored._tag === "Some") {
            expect(stored.value.observedState).toBe("cancelled");
          }
        }),
      );
    },
  );

  it("the periodic timer stops cleanly and never throws into the loop", async () => {
    const passes: number[] = [];
    const timers: Array<{ readonly cancel: () => void }> = [];
    // A failing repository is swallowed by the sweep contract: the pass
    // retries on the next interval and never rejects into the timer loop.
    const repository = {
      listNonTerminalExecutions: () => Effect.fail(new Error("fixture unavailable")),
    } as never;
    const sweep = startPiSubagentProcessTeardownSweep({
      repository,
      resolveOwnedTeardown: () => Promise.resolve(undefined),
      now: () => NOW,
      intervalMs: 5,
      schedule: (delayMs, callback) => {
        const timer = setTimeout(
          () => {
            passes.push(delayMs);
            callback();
          },
          Math.max(0, delayMs),
        );
        const handle = { cancel: () => clearTimeout(timer) };
        timers.push(handle);
        return handle;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sweep.stop();
    for (const timer of timers) {
      timer.cancel();
    }
    expect(passes.length).toBeGreaterThanOrEqual(1);
  });
});
