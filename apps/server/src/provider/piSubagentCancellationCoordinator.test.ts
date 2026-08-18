import type {
  PiSubagentCancelResult,
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
import {
  cancelParentTurnScope,
  cancelSinglePiSubagentExecution,
  type CancelParentTurnScopeInput,
} from "./piSubagentCancellationCoordinator.ts";
import type { PiSubagentActiveChild, PiSubagentExtensionBridge } from "./piSubagentBridge.ts";

/**
 * Ticket 06 / Testing Seam 1 — Cancel command and execution state-machine
 * contracts: desired/observed transitions, generation fencing, idempotency,
 * and evidence requirements (T06-AC1, T06-AC3, T06-AC4). Uses the REAL
 * repository over an in-memory SQLite database (the established
 * admission-coordinator test pattern) so journal-first durability, dedup,
 * and generation gating are exercised against production SQL.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_t06_1",
    attemptId: "att_t06_1",
    generation: 1,
    commandId: "cmd_t06_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_t06" as ThreadId,
    parentTurnId: "turn_t06" as TurnId,
    parentToolCallId: "call_t06",
    agentType: "general-purpose",
    prompt: "task",
    mode: "foreground",
    cancellationScope: "parent_turn" as PiSubagentCancellationScope,
    desiredState: "running" as PiSubagentLifecycleState,
    observedState: "running" as PiSubagentLifecycleState,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

const admit = (repository: PiSubagentExecutionRepositoryShape, record: PiSubagentExecutionRecord) =>
  repository.recordAdmission({
    executionId: record.executionId,
    attemptId: record.attemptId,
    generation: record.generation,
    commandId: record.commandId,
    commandFingerprint: `fp_${record.commandId}`,
    projectId: record.projectId,
    parentThreadId: record.parentThreadId,
    parentTurnId: record.parentTurnId,
    parentToolCallId: record.parentToolCallId,
    agentType: record.agentType,
    prompt: record.prompt,
    ...(record.mode !== undefined ? { mode: record.mode } : {}),
    ...(record.cancellationScope !== undefined
      ? { cancellationScope: record.cancellationScope }
      : {}),
    state: "accepted",
    diagnosticCode: "pi_subagent_managed_enabled",
    now: record.createdAt,
  });

function makeBridge(
  cancelImpl?: PiSubagentExtensionBridge["cancel"],
  activeExecutions?: ReadonlyArray<PiSubagentActiveChild>,
): PiSubagentExtensionBridge {
  return {
    handshake: async () => ({
      ok: true as const,
      protocolVersion: 1,
      extensionVersion: "0.14.0-alfie.1",
      capabilities: ["managed-spawn", "abort-propagation", "durable-cancellation"],
    }),
    ...(cancelImpl !== undefined ? { cancel: cancelImpl } : {}),
    abort: () => true,
    abortAll: () => 0,
    ...(activeExecutions !== undefined ? { getActiveExecutions: () => activeExecutions } : {}),
  };
}

describe("piSubagentCancellationCoordinator (Ticket 06 state machine)", () => {
  it("T06-AC1: records durable cancelling intent BEFORE dispatch and settles cancelled only from a same-identity ack", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        const order: string[] = [];
        const bridge = makeBridge(async (command) => {
          order.push("dispatch");
          return {
            status: "cancelled" as const,
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          };
        });

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 1,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        });

        // Journal-first: the cancelling intent row exists (sequence 90).
        const journal = yield* repository.listJournalEvents("exec_t06_1");
        const intent = journal.find((event) => event.state === "cancelling");
        expect(intent).toBeDefined();
        expect(intent!.attemptId).toBe("att_t06_1");
        expect(intent!.generation).toBe(1);
        expect(order).toEqual(["dispatch"]);

        expect(result.outcomes).toEqual([
          {
            kind: "cancelled_ack",
            executionId: "exec_t06_1",
            attemptId: "att_t06_1",
            generation: 1,
          },
        ]);
        const record = yield* repository.getById("exec_t06_1");
        expect(Option.isSome(record)).toBe(true);
        if (Option.isSome(record)) {
          expect(record.value.observedState).toBe("cancelled");
          expect(record.value.desiredState).toBe("cancelled");
        }
        const ackEvent = journal.find((event) => event.state === "cancelled");
        expect(ackEvent?.metadata).toMatchObject({ evidenceChannel: "child_ack" });
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC1: duplicate/replayed cancel command is idempotent — one intent row, one dispatch, no repeated abort", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        let dispatchCount = 0;
        const bridge = makeBridge(async () => {
          dispatchCount++;
          return {
            status: "cancelled" as const,
            executionId: "exec_t06_1",
            attemptId: "att_t06_1",
            generation: 1,
          };
        });
        const input: CancelParentTurnScopeInput = {
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 1,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        };

        yield* cancelParentTurnScope(input);
        const second = yield* cancelParentTurnScope(input);

        expect(dispatchCount).toBe(1);
        const journal = yield* repository.listJournalEvents("exec_t06_1");
        const intents = journal.filter((event) => event.state === "cancelling");
        expect(intents).toHaveLength(1);
        // The second Stop replays against a now-terminal execution: no
        // cancellable row exists, so no outcome is produced and nothing is
        // re-dispatched (idempotent by state).
        expect(second.outcomes).toEqual([]);
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.observedState).toBe("cancelled");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC2: targets every managed child declaring the parent-turn scope, both transport modes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_fg",
            attemptId: "att_fg",
            commandId: "cmd_fg",
            mode: "foreground",
          }),
        );
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_bg",
            attemptId: "att_bg",
            commandId: "cmd_bg",
            mode: "background",
          }),
        );
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_independent",
            attemptId: "att_ind",
            commandId: "cmd_ind",
            cancellationScope: "independent",
          }),
        );
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_other_thread",
            attemptId: "att_ot",
            commandId: "cmd_ot",
            parentThreadId: "th_other" as ThreadId,
          }),
        );
        const cancelled: string[] = [];
        const bridge = makeBridge(async (command) => {
          cancelled.push(command.executionId);
          return {
            status: "cancelled" as const,
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          };
        });

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 1,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        });

        expect(cancelled.toSorted()).toEqual(["exec_bg", "exec_fg"]);
        expect(result.outcomes).toHaveLength(2);
        expect(result.outcomes.every((outcome) => outcome.kind === "cancelled_ack")).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC3: stale late settlement cannot affect a newer attempt (journaled history only)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        // Current aggregate: attempt att_new / generation 3.
        yield* admit(repository, makeExecution({ attemptId: "att_new", generation: 3 }));
        // A late ack for the OLD attempt (att_t06_1 / gen 1) arrives through
        // the settlement path — history only, never the newer attempt.
        const settle = yield* repository.recordCancelledAck({
          executionId: "exec_t06_1",
          attemptId: "att_old",
          generation: 1,
          sequence: 92,
          occurredAt: "2026-08-18T00:02:00.000Z",
          evidenceChannel: "child_ack",
        });
        expect(settle.kind).toBe("recorded");
        const record = yield* repository.getById("exec_t06_1");
        expect(Option.isSome(record)).toBe(true);
        if (Option.isSome(record)) {
          expect(record.value.observedState).toBe("accepted");
          expect(record.value.attemptId).toBe("att_new");
          expect(record.value.desiredState).toBe("running");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC4/AC5: an ack carrying a different attempt/generation is not termination evidence — state stays cancelling", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        const bridge = makeBridge(async () => ({
          status: "cancelled" as const,
          executionId: "exec_t06_1",
          attemptId: "att_something_else",
          generation: 9,
        }));
        const escalations: string[] = [];
        const diagnostics: string[] = [];

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
          onEscalateProviderTurnInterrupt: (executionId) => escalations.push(executionId),
          onDiagnostic: (event) => diagnostics.push(event.diagnosticCode),
        });

        expect(result.outcomes[0]!.kind).toBe("still_cancelling");
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.observedState).toBe("accepted"); // never claimed cancelled
          expect(record.value.desiredState).toBe("cancelling");
        }
        expect(escalations).toEqual(["exec_t06_1"]);
        expect(diagnostics).toContain("pi_subagent_cancel_ack_timeout");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC4: owner-death evidence (dead owner + expired re-derived lease + not in listActive) settles cancelled without dispatch", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        // Stale heartbeat (60s old) with a 30s lease: re-derived expiry long past.
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_t06_1",
          occurredAt: "2026-08-18T00:00:00.000Z",
          leaseExpiresAt: "2026-08-18T00:00:30.000Z",
        });
        let dispatchCount = 0;
        const bridge = makeBridge(
          () =>
            new Promise<PiSubagentCancelResult>(() => {
              // Never resolves: drives the acknowledgement-timeout path.
              dispatchCount++;
            }),
        );

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => true,
          listActive: () => [], // no longer contains the execution
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          leaseDurationMs: 30000,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        });

        expect(dispatchCount).toBe(0);
        expect(result.outcomes).toEqual([
          {
            kind: "cancelled_owner_death",
            executionId: "exec_t06_1",
            attemptId: "att_t06_1",
            generation: 1,
          },
        ]);
        const journal = yield* repository.listJournalEvents("exec_t06_1");
        const ackEvent = journal.find((event) => event.state === "cancelled");
        expect(ackEvent?.metadata).toMatchObject({ evidenceChannel: "owner_death" });
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC4: owner dead but lease NOT expired keeps cancelling (no settlement without full proof)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        // Fresh heartbeat (10s old) with a 30s lease: not expired yet.
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_t06_1",
          occurredAt: "2026-08-18T00:00:50.000Z",
          leaseExpiresAt: "2026-08-18T00:01:20.000Z",
        });
        const diagnostics: string[] = [];

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge: undefined,
          isOwnerGenerationDead: () => true,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          leaseDurationMs: 30000,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
          onDiagnostic: (event) => diagnostics.push(event.diagnosticCode),
        });

        expect(result.outcomes[0]!.kind).toBe("still_cancelling");
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.observedState).not.toBe("cancelled");
          expect(record.value.desiredState).toBe("cancelling");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC6: dispatch failure preserves cancelling, stable diagnostic, bounded retry, escalation without success claim", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        let attempts = 0;
        const bridge = makeBridge(
          () =>
            new Promise<PiSubagentCancelResult>(() => {
              // Never resolves: drives the acknowledgement-timeout path.
              attempts++;
            }),
        );
        const escalations: string[] = [];
        const diagnostics: string[] = [];

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 2,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
          onEscalateProviderTurnInterrupt: (executionId) => escalations.push(executionId),
          onDiagnostic: (event) => diagnostics.push(event.diagnosticCode),
        });

        expect(attempts).toBe(3); // 1 + 2 retries
        expect(result.outcomes[0]).toMatchObject({
          kind: "still_cancelling",
          diagnosticCode: "pi_subagent_cancel_ack_timeout",
          dispatchAttempts: 3,
          escalated: true,
        });
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.desiredState).toBe("cancelling");
          expect(record.value.observedState).toBe("accepted");
        }
        expect(escalations).toEqual(["exec_t06_1"]);
        expect(diagnostics).toContain("pi_subagent_cancel_ack_timeout");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC6: absent bridge (mixed-version extension) is a stable dispatch failure, never a silent skip", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        const diagnostics: string[] = [];

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge: undefined,
          isOwnerGenerationDead: () => false,
          listActive: () => undefined,
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
          onDiagnostic: (event) => diagnostics.push(event.diagnosticCode),
        });

        expect(result.outcomes[0]).toMatchObject({
          kind: "still_cancelling",
          diagnosticCode: "pi_subagent_cancel_dispatch_failed",
        });
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.desiredState).toBe("cancelling");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC1: extension reporting already_terminal maps to the terminal outcome", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        const bridge = makeBridge(async (command) => ({
          status: "already_terminal" as const,
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        }));

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        });

        expect(result.outcomes[0]!.kind).toBe("already_terminal");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC3: extension reporting stale maps to the stale_generation outcome without settling", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        const bridge = makeBridge(
          async (command): Promise<PiSubagentCancelResult> => ({
            status: "stale" as const,
            executionId: command.executionId,
            attemptId: "att_current_live",
            generation: 7,
          }),
        );

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        });

        expect(result.outcomes[0]).toMatchObject({ kind: "stale_generation" });
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.observedState).toBe("accepted");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T06-AC4: owner dead and execution still in listActive is NOT owner-death proof (child may still be live)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_t06_1",
          occurredAt: "2026-08-18T00:00:00.000Z",
          leaseExpiresAt: "2026-08-18T00:00:30.000Z",
        });

        const result = yield* cancelParentTurnScope({
          threadId: "th_t06",
          repository,
          bridge: undefined,
          isOwnerGenerationDead: () => true,
          listActive: () => [
            {
              executionId: "exec_t06_1",
              attemptId: "att_t06_1",
              generation: 1,
              mode: "background",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 0,
          leaseDurationMs: 30000,
          now: () => Date.parse("2026-08-18T00:01:00.000Z"),
          sleep: () => Effect.void,
        });

        // Still-listed child: the coordinator falls through to the (absent)
        // dispatch path and stays cancelling — never cancelled_owner_death.
        expect(result.outcomes[0]!.kind).toBe("still_cancelling");
        const record = yield* repository.getById("exec_t06_1");
        if (Option.isSome(record)) {
          expect(record.value.observedState).not.toBe("cancelled");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});

describe("cancelSinglePiSubagentExecution (Ticket 11 card cancel)", () => {
  it("T11-AC6: cancels exactly the requested execution, leaves siblings untouched, and stays cancelling until ack", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_t11_a",
            attemptId: "att_t11_a",
            commandId: "cmd_t11_a",
          }),
        );
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_t11_b",
            attemptId: "att_t11_b",
            commandId: "cmd_t11_b",
          }),
        );
        const cancelledIds: string[] = [];
        let releaseAck: (() => void) | undefined;
        const ackGate = new Promise<PiSubagentCancelResult>((resolve) => {
          releaseAck = () =>
            resolve({
              status: "cancelled",
              executionId: "exec_t11_a",
              attemptId: "att_t11_a",
              generation: 1,
            });
        });
        const bridge = makeBridge((command) => {
          cancelledIds.push(command.executionId);
          // Never acknowledges within the bound → remains cancelling.
          void releaseAck;
          return ackGate;
        });

        const result = yield* cancelSinglePiSubagentExecution({
          threadId: "th_t06",
          executionId: "exec_t11_a",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 30,
          cancelRetryLimit: 0,
          now: () => Date.parse("2026-08-19T00:00:00.000Z"),
          sleep: () => Effect.void,
        });

        expect(result.outcome.kind).toBe("still_cancelling");
        // Only the requested execution was dispatched.
        expect(cancelledIds).toEqual(["exec_t11_a"]);
        // Durable intent is visible: desiredState cancelling, observed stays non-terminal.
        const target = yield* repository.getById("exec_t11_a");
        expect(Option.isSome(target)).toBe(true);
        if (Option.isSome(target)) {
          // Journal-first intent: desired flips to cancelling; observed stays
          // non-terminal until termination evidence (T06-AC1/T11-AC6).
          expect(target.value.desiredState).toBe("cancelling");
          expect(target.value.observedState).toBe("accepted");
        }
        // The sibling is untouched.
        const sibling = yield* repository.getById("exec_t11_b");
        expect(Option.isSome(sibling)).toBe(true);
        if (Option.isSome(sibling)) {
          expect(sibling.value.desiredState).toBe("running");
          expect(sibling.value.observedState).toBe("accepted");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T11-AC6: idempotent re-cancel replays already_applied intent and never re-dispatches; unknown execution reports not_found without state writes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(
          repository,
          makeExecution({
            executionId: "exec_t11_c",
            attemptId: "att_t11_c",
            commandId: "cmd_t11_c",
          }),
        );
        let dispatchCount = 0;
        const bridge = makeBridge(async (command) => {
          dispatchCount += 1;
          return {
            status: "cancelled" as const,
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          };
        });

        const first = yield* cancelSinglePiSubagentExecution({
          threadId: "th_t06",
          executionId: "exec_t11_c",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 1,
          now: () => Date.parse("2026-08-19T00:00:00.000Z"),
          sleep: () => Effect.void,
        });
        expect(first.outcome.kind).toBe("cancelled_ack");

        // Second cancel on the now-terminal execution: already_terminal, no dispatch.
        const second = yield* cancelSinglePiSubagentExecution({
          threadId: "th_t06",
          executionId: "exec_t11_c",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 1,
          now: () => Date.parse("2026-08-19T00:00:01.000Z"),
          sleep: () => Effect.void,
        });
        expect(second.outcome.kind).toBe("already_terminal");
        expect(dispatchCount).toBe(1);

        // Unknown execution: honest denial, no state writes.
        const unknown = yield* cancelSinglePiSubagentExecution({
          threadId: "th_t06",
          executionId: "exec_t11_missing",
          repository,
          bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => [],
          cancelAckTimeoutMs: 50,
          cancelRetryLimit: 1,
          now: () => Date.parse("2026-08-19T00:00:02.000Z"),
          sleep: () => Effect.void,
        });
        expect(unknown.outcome.kind).toBe("not_found");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
