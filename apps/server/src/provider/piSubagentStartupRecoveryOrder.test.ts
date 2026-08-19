import type {
  PiSubagentCancellationScope,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
} from "@synara/contracts";
import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { recoverCompletionOutbox } from "./piSubagentCompletionOutbox.ts";
import {
  PI_SUBAGENT_TEARDOWN_BAND,
  runPiSubagentProcessTeardown,
} from "./piSubagentProcessTeardown.ts";
import { reconcilePiSubagentExecutions } from "./piSubagentRestartReconciliation.ts";
import { ingestPiSubagentTerminal } from "./piSubagentTerminalCoordinator.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";

/**
 * Decision 0027 integrated startup-order regression.
 *
 * Production startup must run:
 *   outbox recovery → Ticket-16 no-owner discovery → Ticket-10 reconciliation.
 *
 * The ordering lets Ticket 16 journal honest band-78 uncertainty while the
 * band-74 generation is current, before Ticket 10 records the non-terminal
 * orphan fence. Decision 0028 approves this deterministic repository fixture
 * in place of a destructive real-Pi CI test.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const T0 = "2026-08-19T12:00:00.000Z";
const EPOCH_T0 = Date.parse(T0);

const makeExecution = (): PiSubagentExecutionRecord => ({
  executionId: "exec_startup_order_1",
  attemptId: "att_startup_order_1",
  generation: 1,
  commandId: "cmd_startup_order_1",
  projectId: "proj_default" as ProjectId,
  parentThreadId: "th_startup_order_1" as ThreadId,
  parentTurnId: "turn_startup_order_1" as TurnId,
  parentToolCallId: "call_startup_order_1",
  agentType: "general-purpose",
  prompt: "startup recovery ordering fixture",
  mode: "foreground",
  cancellationScope: "parent_turn" as PiSubagentCancellationScope,
  desiredState: "cancelling" as PiSubagentLifecycleState,
  observedState: "cancelling" as PiSubagentLifecycleState,
  createdAt: T0,
  updatedAt: T0,
});

const admit = (
  repository: PiSubagentExecutionRepositoryShape,
  execution: PiSubagentExecutionRecord,
) =>
  repository.recordAdmission({
    executionId: execution.executionId,
    attemptId: execution.attemptId,
    generation: execution.generation,
    commandId: execution.commandId,
    commandFingerprint: `fp_${execution.commandId}`,
    projectId: execution.projectId,
    parentThreadId: execution.parentThreadId,
    parentTurnId: execution.parentTurnId,
    parentToolCallId: execution.parentToolCallId,
    agentType: execution.agentType,
    prompt: execution.prompt,
    mode: execution.mode,
    cancellationScope: execution.cancellationScope,
    state: "accepted",
    diagnosticCode: "pi_subagent_managed_enabled",
    now: execution.createdAt,
  });

const driveToHandedOff = (
  repository: PiSubagentExecutionRepositoryShape,
  execution: PiSubagentExecutionRecord,
) =>
  Effect.gen(function* () {
    yield* repository.recordLifecycleEvent({
      eventId: `evt_cancelling_${execution.executionId}_${execution.attemptId}`,
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      sequence: 2,
      state: "cancelling",
      occurredAt: T0,
      diagnosticCode: "pi_subagent_cancel_escalated",
      diagnosticMessage: "fixture: cancelling before teardown handoff",
    });
    yield* repository.recordWatchdogStageEvent({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      sequence: PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      state: "cancelling",
      occurredAt: T0,
      diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
      diagnosticMessage: "fixture: watchdog handed ownership to Ticket 16",
      metadata: { phase: "watchdog_escalation", reason: "session_stop_timeout" },
    });
  });

describe("Pi subagent startup recovery order (Decision 0027)", () => {
  it("records no-owner teardown evidence before the Ticket-10 orphan fence", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToHandedOff(repository, execution);

        // Step 1 — Decision 0013 F3 remains first.
        const outbox = yield* recoverCompletionOutbox({
          repository,
          now: () => T0,
        });
        expect(outbox.recovered).toBe(0);
        expect(outbox.failures).toBe(0);

        // Step 2 — Ticket 16 runs while band 74 still matches generation 1.
        // `undefined` proves there is no live owned supervisor: no kill can
        // occur and only the honest owner_unproven outcome may be journaled.
        const dispatches: string[] = [];
        const teardown = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown({
            repository,
            dispatchOwnedTeardown: async (candidate) => {
              dispatches.push(candidate.executionId);
              return undefined;
            },
            now: () => EPOCH_T0,
          }),
        );
        expect(dispatches).toEqual([execution.executionId]);
        expect(teardown.outcomes).toHaveLength(1);
        expect(teardown.outcomes[0]!.outcome.kind).toBe("owner_unproven");

        const afterTeardownJournal = yield* repository.listJournalEvents(execution.executionId);
        expect(
          afterTeardownJournal.filter(
            (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
          ),
        ).toHaveLength(1);
        expect(
          afterTeardownJournal.filter(
            (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.request,
          ),
        ).toHaveLength(1);
        expect(
          afterTeardownJournal.filter(
            (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.ownerUnproven,
          ),
        ).toHaveLength(1);
        expect(
          afterTeardownJournal.some(
            (event) =>
              event.sequence === PI_SUBAGENT_TEARDOWN_BAND.proven ||
              event.sequence === PI_SUBAGENT_TEARDOWN_BAND.survivors,
          ),
        ).toBe(false);

        const afterTeardown = yield* repository.getById(execution.executionId);
        expect(Option.isSome(afterTeardown)).toBe(true);
        if (Option.isSome(afterTeardown)) {
          expect(afterTeardown.value.observedState).toBe("cancelling");
          expect(afterTeardown.value.generation).toBe(1);
        }

        // Step 3 — Ticket 10 follows and retains its accepted owner-loss
        // semantics: non-terminal orphaned, exactly one generation advance.
        const reconciliation = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => EPOCH_T0,
          summaryMaxChars: 2000,
        });
        expect(reconciliation.failures).toEqual([]);
        expect(reconciliation.outcomes).toHaveLength(1);
        expect(reconciliation.outcomes[0]!.kind).toBe("orphaned");
        if (reconciliation.outcomes[0]!.kind === "orphaned") {
          expect(reconciliation.outcomes[0]!.generation).toBe(2);
        }

        const settled = yield* repository.getById(execution.executionId);
        expect(Option.isSome(settled)).toBe(true);
        if (Option.isSome(settled)) {
          expect(settled.value.observedState).toBe("orphaned");
          expect(settled.value.generation).toBe(2);
          expect(settled.value.observedState).not.toBe("cancelled");
        }

        const settledJournal = yield* repository.listJournalEvents(execution.executionId);
        expect(
          settledJournal.some(
            (event) =>
              event.sequence === PI_SUBAGENT_TEARDOWN_BAND.proven ||
              (event.diagnosticCode ?? "") === "pi_subagent_teardown_proven" ||
              event.state === "cancelled",
          ),
        ).toBe(false);
        const rowCount = settledJournal.length;

        // A repeated startup pass cannot re-enter the fenced generation,
        // append teardown/orphan rows, or advance generation again.
        const replayOutbox = yield* recoverCompletionOutbox({
          repository,
          now: () => T0,
        });
        const replayTeardown = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown({
            repository,
            dispatchOwnedTeardown: async (candidate) => {
              dispatches.push(candidate.executionId);
              return undefined;
            },
            now: () => EPOCH_T0,
          }),
        );
        const replayReconciliation = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => EPOCH_T0,
          summaryMaxChars: 2000,
        });
        expect(replayOutbox.recovered).toBe(0);
        expect(replayTeardown.outcomes).toHaveLength(0);
        expect(dispatches).toEqual([execution.executionId]);
        expect(replayReconciliation.failures).toEqual([]);

        const afterReplay = yield* repository.getById(execution.executionId);
        expect(Option.isSome(afterReplay)).toBe(true);
        if (Option.isSome(afterReplay)) {
          expect(afterReplay.value.observedState).toBe("orphaned");
          expect(afterReplay.value.generation).toBe(2);
        }
        expect((yield* repository.listJournalEvents(execution.executionId)).length).toBe(rowCount);

        // A late terminal from fenced generation 1 is history-only and counted.
        const late = yield* ingestPiSubagentTerminal({
          repository,
          observation: {
            executionId: execution.executionId,
            attemptId: execution.attemptId,
            generation: 1,
            state: "succeeded",
            occurredAt: "2026-08-19T12:01:00.000Z",
            summary: "late success after restart owner loss",
          },
          summaryMaxChars: 2000,
        });
        expect(late.outcome).not.toBe("persisted");

        const afterLate = yield* repository.getById(execution.executionId);
        expect(Option.isSome(afterLate)).toBe(true);
        if (Option.isSome(afterLate)) {
          expect(afterLate.value.observedState).toBe("orphaned");
          expect(afterLate.value.generation).toBe(2);
        }
        const evidence = yield* repository.getTerminalEvidence(execution.executionId);
        expect(Option.isSome(evidence)).toBe(true);
        if (Option.isSome(evidence)) {
          expect(evidence.value.staleTerminalEvents).toBeGreaterThanOrEqual(1);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
