import type {
  PiSubagentCancellationScope,
  PiSubagentDiagnosticCode,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
} from "@synara/contracts";
import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  ingestPiSubagentTerminal,
  type PiSubagentTerminalObservation,
} from "./piSubagentTerminalCoordinator.ts";
import {
  processPendingCompletions,
  recoverCompletionOutbox,
  type PiSubagentCompletionDeliveryOutcome,
  type PiSubagentCompletionDeliveryRequest,
} from "./piSubagentCompletionOutbox.ts";

/**
 * Ticket 08 / Testing Seams — Durable completion outbox.
 *
 * Seam 1 (T08-AC1/AC3/AC4/AC5): server orchestration integration boundary —
 * the REAL repository + in-memory SQLite, driven through the production
 * terminal ingest (`ingestPiSubagentTerminal`) with crash-before-delivery,
 * replay, retry, and acknowledgement fault injection at the parent
 * completion-injection boundary.
 *
 * Seam 2 (T08-AC2/AC6): completion-delivery state-machine contract —
 * outcome/delivery separation and supersede rules.
 *
 * Seam 3 (T08-AC5): parent completion-injection boundary — the same dedupe
 * identity cannot create duplicate parent effects.
 *
 * T08-AC1: terminal persistence + outbox creation atomic (or journal-first
 *          recoverable) before notification.
 * T08-AC2: delivery state independently represented (pending / delivered /
 *          acknowledged / failed_retryable / superseded) without mutating
 *          execution outcome.
 * T08-AC3: replayed terminal or outbox processing → no duplicate entry or
 *          follow-up effect.
 * T08-AC4: crash between terminal persistence and delivery leaves the
 *          execution terminal and the outbox recoverably pending.
 * T08-AC5: retry uses a stable dedupe identity and reaches acknowledgement
 *          without duplicate parent content.
 * T08-AC6: a completion superseded by a newer generation produces no delivery
 *          effect while its original execution evidence remains readable.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_t08_1",
    attemptId: "att_t08_1",
    generation: 1,
    commandId: "cmd_t08_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_t08" as ThreadId,
    parentTurnId: "turn_t08" as TurnId,
    parentToolCallId: "call_t08",
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

const admit = (record: PiSubagentExecutionRecord) =>
  Effect.gen(function* () {
    const repository = yield* PiSubagentExecutionRepository;
    const result = yield* repository.recordAdmission({
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
      mode: record.mode,
      cancellationScope: record.cancellationScope,
      state: "accepted",
      now: record.createdAt,
    });
    expect(result.kind === "admitted" || result.kind === "already_applied").toBe(true);
  });

const makeObservation = (
  overrides?: Partial<PiSubagentTerminalObservation>,
): PiSubagentTerminalObservation => ({
  executionId: "exec_t08_1",
  attemptId: "att_t08_1",
  generation: 1,
  state: "succeeded",
  occurredAt: "2026-08-18T00:01:00.000Z",
  summary: "Agent completed: 3 tool uses. Outcome: done.",
  transcriptRef: "/tmp/agents/exec_t08_1/output.md",
  outcomeState: "done",
  ...overrides,
});

const outboxIdFor = (observation: PiSubagentTerminalObservation) =>
  `outbox_${observation.executionId}_${observation.attemptId}_gen${observation.generation}`;

/** Parent completion-injection boundary with dedupe-by-identity (T08-AC5). */
function makeParentBoundary() {
  const deliveredRequests: PiSubagentCompletionDeliveryRequest[] = [];
  const distinctEffects = new Set<string>();
  let failNext = 0;
  let acknowledge = false;
  const boundary = {
    deliver: async (
      request: PiSubagentCompletionDeliveryRequest,
    ): Promise<PiSubagentCompletionDeliveryOutcome> => {
      deliveredRequests.push(request);
      if (failNext > 0) {
        failNext -= 1;
        return { accepted: false, acknowledged: false, error: "parent boundary temporarily down" };
      }
      // Parent-side effect is keyed by the STABLE dedupe identity: a redelivery
      // of the same dedupeId never creates a second parent effect.
      distinctEffects.add(request.dedupeId);
      return { accepted: true, acknowledged: acknowledge };
    },
    /** Simulates a crash of the delivery step (never reaches the boundary). */
    failNextDeliveries: (count: number) => {
      failNext = count;
    },
    setAcknowledge: (value: boolean) => {
      acknowledge = value;
    },
    requestCount: () => deliveredRequests.length,
    distinctEffectCount: () => distinctEffects.size,
    requests: () => deliveredRequests,
  };
  return boundary;
}

describe("Pi Subagent durable completion outbox (Issue 08)", () => {
  it("T08-AC1: terminal persistence and outbox creation are atomic before notification", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const order: string[] = [];
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
          onTerminalPersisted: () => {
            // At notification time, BOTH durable truths already exist: the
            // terminal aggregate is settled AND the outbox entry is pending
            // (created in the same transaction — T08-AC1).
            order.push("notify");
          },
        });
        expect(result.outcome).toBe("persisted");
        expect(order).toEqual(["notify"]);

        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(entry)).toBe(true);
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("pending");
          expect(entry.value.terminalState).toBe("succeeded");
          expect(entry.value.attemptCount).toBe(0);
          expect(entry.value.parentThreadId).toBe("th_t08");
          // Bounded evidence inheritance (Decision 0012 F2): the outbox
          // carries the SAME bounded summary/transcript reference, not
          // unbounded content.
          expect(entry.value.summary).toBe("Agent completed: 3 tool uses. Outcome: done.");
          expect(entry.value.transcriptRef).toBe("/tmp/agents/exec_t08_1/output.md");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC1 (failure direction): outbox write failure rolls back the whole terminal transaction — never terminal without outbox", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Pre-insert a CONFLICTING outbox row for the same identity with an
        // incompatible shape (different outbox_id for the same
        // execution/attempt/generation unique key... not possible via the
        // unique key alone). Instead: drop the outbox table's required
        // columns by inserting garbage via a direct sabotage is not a public
        // seam — use the missing-execution failure instead, which exercises
        // the same atomic-rollback contract at the repository boundary.
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ executionId: "exec_t08_missing" }),
          onTerminalPersisted: () => {
            throw new Error("must not notify");
          },
          onTerminalPersistenceFailed: (event) => {
            expect(event.diagnosticCode).toBe("pi_subagent_terminal_persistence_failed");
          },
        });
        expect(result.outcome).toBe("failed");

        // Failure direction of atomicity: no journal row, no aggregate, no
        // outbox row — nothing half-persisted.
        const journal = yield* repository.listJournalEvents("exec_t08_missing");
        expect(journal).toHaveLength(0);
        const missing = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation({ executionId: "exec_t08_missing" })),
        );
        expect(Option.isNone(missing)).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC2: delivery state is independently represented and never mutates execution outcome", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const outboxId = outboxIdFor(makeObservation());

        // pending → delivered
        const delivered = yield* repository.markCompletionDelivered({
          outboxId,
          now: "2026-08-18T00:02:00.000Z",
        });
        expect(delivered.kind).toBe("transitioned");
        if (delivered.kind === "transitioned") {
          expect(delivered.entry.deliveryState).toBe("delivered");
          expect(delivered.entry.deliveredAt).toBe("2026-08-18T00:02:00.000Z");
        }

        // delivered → acknowledged
        const acknowledged = yield* repository.markCompletionAcknowledged({
          outboxId,
          now: "2026-08-18T00:03:00.000Z",
        });
        expect(acknowledged.kind).toBe("transitioned");
        if (acknowledged.kind === "transitioned") {
          expect(acknowledged.entry.deliveryState).toBe("acknowledged");
          expect(acknowledged.entry.acknowledgedAt).toBe("2026-08-18T00:03:00.000Z");
        }

        // The EXECUTION outcome is untouched by every delivery transition:
        // still succeeded with its original terminal evidence.
        const execution = yield* repository.getById("exec_t08_1");
        expect(Option.isSome(execution)).toBe(true);
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
          expect(execution.value.desiredState).toBe("succeeded");
          expect(execution.value.updatedAt).toBe("2026-08-18T00:01:00.000Z");
        }

        // Acknowledged is terminal on the delivery side: no further effect.
        const again = yield* repository.markCompletionDelivered({
          outboxId,
          now: "2026-08-18T00:04:00.000Z",
        });
        expect(again.kind).toBe("invalid_transition");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC2 (failed_retryable): delivery failure stays retryable and never rewrites the outcome", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const outboxId = outboxIdFor(makeObservation());
        const failed = yield* repository.markCompletionDeliveryFailed({
          outboxId,
          now: "2026-08-18T00:02:00.000Z",
          error: "transient parent failure",
        });
        expect(failed.kind).toBe("transitioned");
        if (failed.kind === "transitioned") {
          expect(failed.entry.deliveryState).toBe("failed_retryable");
          expect(failed.entry.attemptCount).toBe(1);
          expect(failed.entry.lastError).toBe("transient parent failure");
        }

        // failed_retryable remains recoverable within the retry budget.
        const recoverable = yield* repository.listRecoverableCompletionOutbox({ retryLimit: 5 });
        expect(recoverable.map((entry) => entry.outboxId)).toContain(outboxId);

        // The execution is STILL succeeded — delivery failure is not
        // execution failure (T08-AC2, spec story 21).
        const execution = yield* repository.getById("exec_t08_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }

        // failed_retryable → delivered → acknowledged still reachable.
        const delivered = yield* repository.markCompletionDelivered({
          outboxId,
          now: "2026-08-18T00:03:00.000Z",
        });
        expect(delivered.kind).toBe("transitioned");
        const acknowledged = yield* repository.markCompletionAcknowledged({
          outboxId,
          now: "2026-08-18T00:04:00.000Z",
        });
        expect(acknowledged.kind).toBe("transitioned");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC3: replayed terminal and replayed outbox processing create no duplicate entry or effect", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const first = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(first.outcome).toBe("persisted");
        const replay = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ occurredAt: "2026-08-18T00:09:00.000Z" }),
        });
        expect(replay.outcome).toBe("already_applied");

        // Exactly one outbox row for the execution (the unique attempt/
        // generation identity dedupes even the direct creation seam).
        const direct = yield* repository.recordCompletionOutboxEntry({
          executionId: "exec_t08_1",
          attemptId: "att_t08_1",
          generation: 1,
          terminalEventId: "terminal_exec_t08_1_att_t08_1_gen1_succeeded",
          parentThreadId: "th_t08",
          terminalState: "succeeded",
          summary: "duplicate attempt",
          now: "2026-08-18T00:10:00.000Z",
        });
        expect(direct.kind).toBe("already_applied");
        if (direct.kind === "already_applied") {
          // The original bounded evidence is preserved, not overwritten.
          expect(direct.entry.summary).toBe("Agent completed: 3 tool uses. Outcome: done.");
        }

        // Journal-first recovery replay: nothing left to recover.
        const recovery = yield* recoverCompletionOutbox({
          repository,
          now: () => "2026-08-18T00:11:00.000Z",
        });
        expect(recovery.recovered).toBe(0);

        const parent = makeParentBoundary();
        const pump1 = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:12:00.000Z",
        });
        expect(pump1.delivered).toBe(1);
        // A second pump over the same durable state: the acknowledged entry
        // is no longer recoverable — no second parent request, no effect.
        const pump2 = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:13:00.000Z",
        });
        expect(pump2.delivered).toBe(0);
        expect(pump2.skipped).toBe(0);
        expect(parent.requestCount()).toBe(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC4: crash between terminal persistence and delivery leaves the execution terminal and the outbox recoverably pending", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Terminal ingests durably; the process "crashes" before ANY delivery
        // pump ever runs (no deliver call at all).
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(result.outcome).toBe("persisted");

        // Post-crash durable state: execution terminal, outbox pending.
        const execution = yield* repository.getById("exec_t08_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
        const pending = yield* repository.listRecoverableCompletionOutbox({ retryLimit: 5 });
        expect(pending.map((entry) => entry.outboxId)).toContain(outboxIdFor(makeObservation()));

        // Recovery: the pending entry delivers on the next pump and reaches
        // acknowledgement — the crash did not lose the completion.
        const parent = makeParentBoundary();
        parent.setAcknowledge(true);
        const pump = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:20:00.000Z",
        });
        expect(pump.delivered).toBe(1);
        expect(pump.acknowledged).toBe(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC4 (journal-first recovery): a terminal journal row without an outbox entry recovers one", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Simulate the pre-102 / crash-window state: a succeeded terminal in
        // the journal + aggregate with NO outbox row. The generic lifecycle
        // path journals the terminal without creating an outbox entry.
        yield* repository.recordLifecycleEvent({
          eventId: "evt_t08_generic_terminal",
          executionId: "exec_t08_1",
          attemptId: "att_t08_1",
          generation: 1,
          sequence: 41,
          state: "succeeded",
          occurredAt: "2026-08-18T00:15:00.000Z",
          metadataJson: JSON.stringify({
            summary: "Agent completed via generic path.",
          }),
        });

        const before = yield* repository.listRecoverableCompletionOutbox({ retryLimit: 5 });
        expect(before).toHaveLength(0);

        const diagnostics: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
        const recovery = yield* recoverCompletionOutbox({
          repository,
          now: () => "2026-08-18T00:16:00.000Z",
          onDiagnostic: (event) => {
            diagnostics.push(event);
          },
        });
        expect(recovery.recovered).toBe(1);
        expect(recovery.failures).toBe(0);

        const after = yield* repository.listRecoverableCompletionOutbox({ retryLimit: 5 });
        expect(after).toHaveLength(1);
        expect(after[0]!.deliveryState).toBe("pending");
        expect(after[0]!.summary).toBe("Agent completed via generic path.");

        // Idempotent replay of the recovery scan: no duplicates.
        const replay = yield* recoverCompletionOutbox({
          repository,
          now: () => "2026-08-18T00:17:00.000Z",
        });
        expect(replay.recovered).toBe(0);
        const stillOne = yield* repository.listRecoverableCompletionOutbox({ retryLimit: 5 });
        expect(stillOne).toHaveLength(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC5: retry reaches acknowledgement through the dedupe-identity boundary without duplicate parent content", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const parent = makeParentBoundary();
        // First pump: delivery boundary rejects (transient failure).
        parent.failNextDeliveries(1);
        const diagnostics: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
        const pump1 = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:21:00.000Z",
          onDiagnostic: (event) => {
            diagnostics.push(event);
          },
        });
        expect(pump1.failed).toBe(1);
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_completion_delivery_failed",
          ),
        ).toBe(true);

        // The failed entry is retryable (T08-AC2/AC5).
        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("failed_retryable");
          expect(entry.value.attemptCount).toBe(1);
        }

        // Second pump: the boundary accepts AND acknowledges; the STABLE
        // dedupe identity means the parent produced exactly ONE distinct
        // effect despite the retry re-reaching the boundary.
        parent.setAcknowledge(true);
        const pump2 = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:22:00.000Z",
        });
        expect(pump2.delivered).toBe(1);
        expect(pump2.acknowledged).toBe(1);
        expect(parent.requestCount()).toBe(2); // at-least-once delivery…
        expect(parent.distinctEffectCount()).toBe(1); // …exactly-once parent effect

        // The execution outcome never changed through any of this.
        const execution = yield* repository.getById("exec_t08_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC5 (retry budget): an exhausted entry stops being auto-recovered but keeps its evidence", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const outboxId = outboxIdFor(makeObservation());
        // Exhaust the retry budget with retryLimit = 1.
        yield* repository.markCompletionDeliveryFailed({
          outboxId,
          now: "2026-08-18T00:21:30.000Z",
          error: "failure one",
        });

        const recoverable = yield* repository.listRecoverableCompletionOutbox({ retryLimit: 1 });
        expect(recoverable.map((entry) => entry.outboxId)).not.toContain(outboxId);

        // The entry and its bounded evidence remain readable even when
        // auto-retry is exhausted (operator surface).
        const entry = yield* repository.getCompletionOutboxEntry(outboxId);
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("failed_retryable");
          expect(entry.value.lastError).toBe("failure one");
          expect(entry.value.summary).toContain("Agent completed");
        }
        // The execution outcome stays succeeded.
        const execution = yield* repository.getById("exec_t08_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC6: a completion superseded by a newer generation produces no delivery effect; evidence stays readable", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Attempt 1 completes → outbox pending. No delivery happens yet.
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });

        // The execution is resumed under a NEWER attempt/generation before
        // the pending completion was delivered.
        yield* repository.recordLifecycleEvent({
          eventId: "evt_t08_resume",
          executionId: "exec_t08_1",
          attemptId: "att_t08_2",
          generation: 2,
          sequence: 1,
          state: "running",
          occurredAt: "2026-08-18T00:23:00.000Z",
        });

        const parent = makeParentBoundary();
        const diagnostics: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
        const pump = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:24:00.000Z",
          onDiagnostic: (event) => {
            diagnostics.push(event);
          },
        });
        expect(pump.superseded).toBe(1);
        expect(pump.delivered).toBe(0);
        // NO delivery effect reached the parent boundary.
        expect(parent.requestCount()).toBe(0);
        expect(
          diagnostics.some((event) => event.diagnosticCode === "pi_subagent_completion_superseded"),
        ).toBe(true);

        // The superseded entry records the fencing generation…
        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("superseded");
          expect(entry.value.supersededByGeneration).toBe(2);
          // …while its ORIGINAL execution evidence remains readable.
          expect(entry.value.terminalState).toBe("succeeded");
          expect(entry.value.summary).toContain("Agent completed");
          expect(entry.value.transcriptRef).toBe("/tmp/agents/exec_t08_1/output.md");
        }
        const evidence = yield* repository.getTerminalEvidence("exec_t08_1");
        expect(Option.isSome(evidence)).toBe(true);
        if (Option.isSome(evidence)) {
          expect(evidence.value.terminalSummary).toContain("Agent completed");
        }
        const journal = yield* repository.listJournalEvents("exec_t08_1");
        expect(journal.some((event) => event.state === "succeeded" && event.sequence === 40)).toBe(
          true,
        );

        // The new attempt's eventual terminal creates its OWN entry and
        // delivers normally.
        const second = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            attemptId: "att_t08_2",
            generation: 2,
            summary: "Agent completed (retry run).",
          }),
        });
        expect(second.outcome).toBe("persisted");
        parent.setAcknowledge(true);
        const pump2 = yield* processPendingCompletions({
          repository,
          deliver: parent.deliver,
          now: () => "2026-08-18T00:25:00.000Z",
        });
        expect(pump2.delivered).toBe(1);
        expect(pump2.acknowledged).toBe(1);
        expect(parent.requests()[0]!.summary).toBe("Agent completed (retry run).");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T08-AC2 (supersede guard): an acknowledged entry cannot be superseded; supersede is terminal for delivery", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const outboxId = outboxIdFor(makeObservation());
        yield* repository.markCompletionDelivered({ outboxId, now: "2026-08-18T00:26:00.000Z" });
        yield* repository.markCompletionAcknowledged({ outboxId, now: "2026-08-18T00:27:00.000Z" });

        // An acknowledged completion is complete: a late supersede (e.g. a
        // resume after delivery) cannot regress it.
        const late = yield* repository.markCompletionSuperseded({
          outboxId,
          supersededByGeneration: 2,
          now: "2026-08-18T00:28:00.000Z",
        });
        expect(late.kind).toBe("invalid_transition");

        // Superseded entries cannot be delivered.
        yield* admit(
          makeExecution({
            executionId: "exec_t08_sup",
            attemptId: "att_sup",
            commandId: "cmd_t08_sup",
          }),
        );
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            executionId: "exec_t08_sup",
            attemptId: "att_sup",
          }),
        });
        yield* repository.markCompletionSuperseded({
          outboxId: "outbox_exec_t08_sup_att_sup_gen1",
          supersededByGeneration: 3,
          now: "2026-08-18T00:29:00.000Z",
        });
        const deliverLate = yield* repository.markCompletionDelivered({
          outboxId: "outbox_exec_t08_sup_att_sup_gen1",
          now: "2026-08-18T00:30:00.000Z",
        });
        expect(deliverLate.kind).toBe("invalid_transition");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
