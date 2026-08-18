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
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  ingestPiSubagentTerminal,
  type PiSubagentTerminalObservation,
} from "./piSubagentTerminalCoordinator.ts";
import {
  makePiSubagentCompletionCoordinator,
  type PiSubagentCompletionCoordinatorFollowUpEntry,
} from "./piSubagentCompletionCoordinator.ts";

/**
 * Ticket 09 / Testing Seams — Per-thread completion coordinator.
 *
 * Seam 1 (T09-AC1/AC2/AC3/AC4/AC6): server orchestration integration
 * boundary — the REAL repository + in-memory SQLite + the production
 * coordinator, driven through the production terminal ingest
 * (`ingestPiSubagentTerminal`), the post-commit completion-pending trigger,
 * and the parent follow-up boundary with simultaneous-completion,
 * active-parent, idle-parent, busy-then-idle, failure, retry, and supersede
 * fixtures. The parent boundary is a fake whose ONLY inputs are the
 * follow-up payload and the busy flag — user-read state is structurally not
 * a delivery gate (T09-AC3).
 *
 * Seam 2 (T09-AC2/AC4): completion-delivery state-machine contract — the
 * coordinator's one-outstanding-follow-up invariant, retry accounting, and
 * no-duplicate-follow-up-content rules over the durable outbox states.
 *
 * T09-AC1: completions for one parent thread inside the configured batching
 *          window produce ONE follow-up containing bounded summaries and
 *          execution identities.
 * T09-AC2: a thread has at most one pending or unacknowledged managed
 *          follow-up; later bursts wait or join a later batch.
 * T09-AC3: delivery occurs only when the parent has no active turn (busy
 *          defers until the parent turn settles); user-read state is not a
 *          delivery gate.
 * T09-AC4: delivery failure remains retryable and cannot duplicate follow-up
 *          content or change execution outcomes.
 * T09-AC6: superseded delivery entries create no follow-up effect, and their
 *          execution results remain retrievable by identity.
 *
 * Seam 3 (T09-AC5) — isolated real-Pi mixed managed/legacy boundary — lives
 * in the wallclock suite (piSubagentCompletionOwnershipAcceptance.test.ts).
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_t09_1",
    attemptId: "att_t09_1",
    generation: 1,
    commandId: "cmd_t09_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_t09" as ThreadId,
    parentTurnId: "turn_t09" as TurnId,
    parentToolCallId: "call_t09",
    agentType: "general-purpose",
    prompt: "task",
    mode: "background",
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
  executionId: "exec_t09_1",
  attemptId: "att_t09_1",
  generation: 1,
  state: "succeeded",
  occurredAt: "2026-08-18T00:01:00.000Z",
  summary: "Agent completed: 3 tool uses. Outcome: done.",
  transcriptRef: "/tmp/agents/exec_t09_1/output.md",
  outcomeState: "done",
  ...overrides,
});

const outboxIdFor = (observation: PiSubagentTerminalObservation) =>
  `outbox_${observation.executionId}_${observation.attemptId}_gen${observation.generation}`;

/** Manually-driven virtual clock — timing evidence never touches wall time. */
const makeVirtualClock = () => {
  let current = 0;
  const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  return {
    now: () => current,
    schedule: (delayMs: number, callback: () => void) => {
      const timer = { at: current + Math.max(0, delayMs), callback, cancelled: false };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
    advance: (ms: number) => {
      current += ms;
      for (const timer of [...timers]) {
        if (!timer.cancelled && timer.at <= current) {
          timer.cancelled = true;
          timer.callback();
        }
      }
    },
  };
};

type VirtualClock = ReturnType<typeof makeVirtualClock>;

/**
 * Parent follow-up boundary fake (T09 seam 1). The boundary's ONLY inputs
 * are the follow-up payload and the busy flag — there is deliberately no
 * user-read-state input anywhere on this seam (T09-AC3).
 */
const makeParentBoundary = () => {
  const dispatches: Array<{
    parentThreadId: string;
    entries: readonly PiSubagentCompletionCoordinatorFollowUpEntry[];
  }> = [];
  const busyThreads = new Set<string>();
  let failNext = 0;
  return {
    isParentBusy: (parentThreadId: string) => busyThreads.has(parentThreadId),
    setBusy: (parentThreadId: string, busy: boolean) => {
      if (busy) {
        busyThreads.add(parentThreadId);
      } else {
        busyThreads.delete(parentThreadId);
      }
    },
    sendFollowUp: async (
      parentThreadId: string,
      entries: readonly PiSubagentCompletionCoordinatorFollowUpEntry[],
    ): Promise<{ accepted: boolean; error?: string }> => {
      if (failNext > 0) {
        failNext -= 1;
        return { accepted: false, error: "parent follow-up boundary down" };
      }
      dispatches.push({ parentThreadId, entries });
      return { accepted: true };
    },
    failNextDispatches: (count: number) => {
      failNext = count;
    },
    dispatchCount: () => dispatches.length,
    dispatches: () => dispatches,
    dispatchedEntryIds: () =>
      dispatches.flatMap((dispatch) => dispatch.entries.map((entry) => entry.executionId)),
  };
};

type ParentBoundary = ReturnType<typeof makeParentBoundary>;

const BATCH_WINDOW_MS = 1_000;

const setupCoordinator = (options?: {
  readonly boundary?: ParentBoundary;
  readonly clock?: VirtualClock;
  readonly batchWindowMs?: number;
  readonly retryLimit?: number;
  readonly maxBatchEntries?: number;
  readonly onDiagnostic?: (event: {
    readonly parentThreadId: string;
    readonly executionId?: string | undefined;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}) => {
  const boundary = options?.boundary ?? makeParentBoundary();
  const clock = options?.clock ?? makeVirtualClock();
  const diagnostics: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
  // Repository ref: bound to the live repository inside each Effect scope
  // (the repository service is only available there).
  let repositoryRef: PiSubagentExecutionRepositoryShape | undefined;
  const coordinator = makePiSubagentCompletionCoordinator({
    get repository() {
      if (repositoryRef === undefined) {
        throw new Error("coordinator repository not bound to the Effect scope yet");
      }
      return repositoryRef;
    },
    batchWindowMs: options?.batchWindowMs ?? BATCH_WINDOW_MS,
    retryLimit: options?.retryLimit,
    maxBatchEntries: options?.maxBatchEntries,
    now: clock.now,
    schedule: clock.schedule,
    isParentBusy: boundary.isParentBusy,
    sendFollowUp: boundary.sendFollowUp,
    onDiagnostic: (event) => {
      diagnostics.push(event);
      options?.onDiagnostic?.(event);
    },
  });
  const bindRepository = (repository: PiSubagentExecutionRepositoryShape) => {
    repositoryRef = repository;
  };
  return { boundary, clock, coordinator, diagnostics, bindRepository };
};

describe("Pi Subagent per-thread completion coordinator (Issue 09)", () => {
  it("T09-AC1: completions inside the batching window produce ONE follow-up with bounded summaries and identities", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator();
        bindRepository(repository);

        // Two near-simultaneous managed child terminals on ONE thread.
        yield* admit(makeExecution());
        yield* admit(
          makeExecution({
            executionId: "exec_t09_2",
            attemptId: "att_t09_2",
            commandId: "cmd_t09_2",
          }),
        );
        const first = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(first.outcome).toBe("persisted");
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        const second = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            executionId: "exec_t09_2",
            attemptId: "att_t09_2",
            summary: "Agent completed: wrote report. Outcome: done.",
          }),
        });
        expect(second.outcome).toBe("persisted");
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        // Before the window closes: NO follow-up yet (batching).
        expect(boundary.dispatchCount()).toBe(0);

        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());

        // ONE follow-up for the whole burst, carrying BOTH bounded summaries
        // and BOTH execution identities (T09-AC1).
        expect(boundary.dispatchCount()).toBe(1);
        const dispatch = boundary.dispatches()[0]!;
        expect(dispatch.parentThreadId).toBe("th_t09");
        expect(dispatch.entries).toHaveLength(2);
        expect(dispatch.entries.map((entry) => entry.executionId)).toEqual([
          "exec_t09_1",
          "exec_t09_2",
        ]);
        expect(dispatch.entries[0]!.summary).toBe("Agent completed: 3 tool uses. Outcome: done.");
        expect(dispatch.entries[1]!.summary).toBe(
          "Agent completed: wrote report. Outcome: done.",
        );
        // The stable dedupe identity travels with every entry (Decision
        // 0013 F4: parent-effect key).
        expect(dispatch.entries[0]!.dedupeId).toBe(outboxIdFor(makeObservation()));
        expect(dispatch.entries[0]!.terminalState).toBe("succeeded");

        // Entries are durably `delivered` once dispatched.
        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(entry)).toBe(true);
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("delivered");
        }

        // The follow-up turn settles → acknowledged (one bounded follow-up,
        // fully accounted).
        coordinator.notifyFollowUpSettled({ parentThreadId: "th_t09", outcome: "completed" });
        yield* Effect.promise(() => coordinator.waitForIdle());
        const acknowledged = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation()),
        );
        if (Option.isSome(acknowledged)) {
          expect(acknowledged.value.deliveryState).toBe("acknowledged");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC1 (window 0): a zero-length batching window flushes immediately", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator({ batchWindowMs: 0 });
        bindRepository(repository);

        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        clock.advance(0);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC2: at most one outstanding follow-up per thread — later bursts wait, then join a later batch", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator();
        bindRepository(repository);

        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);

        // The follow-up turn is still running (not settled): a later burst
        // on the SAME thread must NOT dispatch a second follow-up while the
        // first is unacknowledged (T09-AC2).
        yield* admit(
          makeExecution({
            executionId: "exec_t09_late",
            attemptId: "att_t09_late",
            commandId: "cmd_t09_late",
          }),
        );
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            executionId: "exec_t09_late",
            attemptId: "att_t09_late",
          }),
        });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });
        clock.advance(BATCH_WINDOW_MS * 10);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);

        // The waiting burst is delivered in a LATER batch once the
        // outstanding follow-up settles (T09-AC2 "join a later batch").
        coordinator.notifyFollowUpSettled({ parentThreadId: "th_t09", outcome: "completed" });
        yield* Effect.promise(() => coordinator.waitForIdle());
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(2);
        expect(boundary.dispatches()[1]!.entries.map((entry) => entry.executionId)).toEqual([
          "exec_t09_late",
        ]);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC3 (active parent): delivery defers while the parent turn is active and never interrupts", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator();
        bindRepository(repository);

        boundary.setBusy("th_t09", true);
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        // Window elapses while the parent is busy: NO follow-up — the
        // coordinator must not interrupt the active parent turn (T09-AC3).
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(0);

        // Still busy much later: still deferred (no delivery gate besides
        // the parent-turn boundary — user-read state is not consulted).
        clock.advance(BATCH_WINDOW_MS * 60);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(0);

        // The entry remains pending (recoverable) while deferred.
        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("pending");
        }

        // Busy-then-idle: the parent turn settles → the deferred batch
        // delivers at the safe boundary (T09-AC3).
        boundary.setBusy("th_t09", false);
        coordinator.onParentTurnSettled("th_t09");
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC4 (dispatch failure): delivery stays retryable without duplicate parent content or outcome change", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator({ retryLimit: 3 });
        bindRepository(repository);

        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        // First dispatch attempt fails at the parent boundary.
        boundary.failNextDispatches(1);
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(0);

        // The entry is retryable and the execution outcome is UNCHANGED.
        const failed = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(failed)) {
          expect(failed.value.deliveryState).toBe("failed_retryable");
          expect(failed.value.attemptCount).toBe(1);
        }
        const execution = yield* repository.getById("exec_t09_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }

        // Retry within budget: exactly ONE accepted follow-up — the failed
        // attempt produced no parent content, so no duplicate exists.
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);
        expect(boundary.dispatches()[0]!.entries).toHaveLength(1);

        coordinator.notifyFollowUpSettled({ parentThreadId: "th_t09", outcome: "completed" });
        yield* Effect.promise(() => coordinator.waitForIdle());
        const acknowledged = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation()),
        );
        if (Option.isSome(acknowledged)) {
          expect(acknowledged.value.deliveryState).toBe("acknowledged");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC4 (retry budget): an exhausted entry stops dispatching but keeps its evidence readable", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator({ retryLimit: 1 });
        bindRepository(repository);

        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        boundary.failNextDispatches(99);
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        // Budget 1 exhausted: no further dispatch attempts.
        expect(boundary.dispatchCount()).toBe(0);

        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("failed_retryable");
          expect(entry.value.attemptCount).toBe(1);
          // Evidence stays readable (operator surface).
          expect(entry.value.summary).toContain("Agent completed");
        }
        const evidence = yield* repository.getTerminalEvidence("exec_t09_1");
        expect(Option.isSome(evidence)).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC4 (follow-up turn failed before running): the batch re-enters retryable delivery without duplicate content", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator();
        bindRepository(repository);

        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);

        // The follow-up turn was rejected before it ran (prompt rejection):
        // the entries return to retryable delivery — the failed turn showed
        // no content, so the retry cannot duplicate follow-up content.
        coordinator.notifyFollowUpSettled({ parentThreadId: "th_t09", outcome: "failed" });
        yield* Effect.promise(() => coordinator.waitForIdle());

        const entry = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("failed_retryable");
        }

        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(2);
        coordinator.notifyFollowUpSettled({ parentThreadId: "th_t09", outcome: "completed" });
        yield* Effect.promise(() => coordinator.waitForIdle());
        const acknowledged = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation()),
        );
        if (Option.isSome(acknowledged)) {
          expect(acknowledged.value.deliveryState).toBe("acknowledged");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC6: a superseded entry creates no follow-up effect and its result stays retrievable by identity", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator();
        bindRepository(repository);

        // Attempt 1 completes; before delivery, the execution resumes under
        // a newer attempt/generation (the pending entry becomes stale).
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });

        yield* repository.recordLifecycleEvent({
          eventId: "evt_t09_resume",
          executionId: "exec_t09_1",
          attemptId: "att_t09_2",
          generation: 2,
          sequence: 1,
          state: "running",
          occurredAt: "2026-08-18T00:05:00.000Z",
        });

        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());

        // The stale entry produced NO follow-up effect.
        expect(boundary.dispatchCount()).toBe(0);
        const stale = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        if (Option.isSome(stale)) {
          expect(stale.value.deliveryState).toBe("superseded");
        }
        // Its execution result remains retrievable by identity (T09-AC6).
        const evidence = yield* repository.getTerminalEvidence("exec_t09_1");
        expect(Option.isSome(evidence)).toBe(true);
        if (Option.isSome(evidence)) {
          expect(evidence.value.terminalSummary).toContain("Agent completed");
        }

        // The newer attempt's terminal delivers normally in its own batch.
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            attemptId: "att_t09_2",
            generation: 2,
            summary: "Agent completed (retry run).",
          }),
        });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);
        expect(boundary.dispatches()[0]!.entries.map((entry) => entry.executionId)).toEqual([
          "exec_t09_1",
        ]);
        expect(boundary.dispatches()[0]!.entries[0]!.dedupeId).toBe(
          "outbox_exec_t09_1_att_t09_2_gen2",
        );
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC2 (thread isolation): per-thread scans never co-batch across parent threads", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator();
        bindRepository(repository);

        yield* admit(makeExecution());
        yield* admit(
          makeExecution({
            executionId: "exec_t09_other",
            attemptId: "att_t09_other",
            commandId: "cmd_t09_other",
            parentThreadId: "th_other" as ThreadId,
            parentTurnId: "turn_other" as TurnId,
          }),
        );
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: "th_t09" });
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            executionId: "exec_t09_other",
            attemptId: "att_t09_other",
          }),
        });
        coordinator.onCompletionPending({ parentThreadId: "th_other" });

        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());

        expect(boundary.dispatchCount()).toBe(2);
        const byThread = new Map(boundary.dispatches().map((d) => [d.parentThreadId, d]));
        expect(byThread.get("th_t09")!.entries.map((e) => e.executionId)).toEqual(["exec_t09_1"]);
        expect(byThread.get("th_other")!.entries.map((e) => e.executionId)).toEqual([
          "exec_t09_other",
        ]);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T09-AC2 (batch cap): bursts beyond the per-follow-up entry cap join the NEXT batch", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { boundary, clock, coordinator, bindRepository } = setupCoordinator({ maxBatchEntries: 2 });
        bindRepository(repository);

        for (let index = 1; index <= 3; index += 1) {
          yield* admit(
            makeExecution({
              executionId: `exec_t09_cap${index}`,
              attemptId: `att_t09_cap${index}`,
              commandId: `cmd_t09_cap${index}`,
            }),
          );
          yield* ingestPiSubagentTerminal({
            repository,
            observation: makeObservation({
              executionId: `exec_t09_cap${index}`,
              attemptId: `att_t09_cap${index}`,
            }),
          });
          coordinator.onCompletionPending({ parentThreadId: "th_t09" });
        }

        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(1);
        expect(boundary.dispatches()[0]!.entries).toHaveLength(2);

        // The overflow entry waits for the next batch after settle.
        coordinator.notifyFollowUpSettled({ parentThreadId: "th_t09", outcome: "completed" });
        yield* Effect.promise(() => coordinator.waitForIdle());
        clock.advance(BATCH_WINDOW_MS);
        yield* Effect.promise(() => coordinator.waitForIdle());
        expect(boundary.dispatchCount()).toBe(2);
        expect(boundary.dispatches()[1]!.entries.map((e) => e.executionId)).toEqual([
          "exec_t09_cap3",
        ]);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
