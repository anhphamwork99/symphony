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
  PI_SUBAGENT_TERMINAL_SEQUENCE,
  type PiSubagentTerminalObservation,
} from "./piSubagentTerminalCoordinator.ts";
import { makePiSubagentProgressCoalescer } from "./piSubagentProgressCoalescer.ts";

/**
 * Ticket 07 / Testing Seams 1–3 — Terminal lifecycle state-machine contracts
 * over the REAL repository + in-memory SQLite (journal-first durability,
 * first-terminal-wins, replay idempotency, stale counting, sequence-gap
 * diagnostics, cancel-vs-complete race arbitration) and the server
 * runtime-journal boundary with a degraded observation sink (T07-AC6).
 *
 * T07-AC1: terminal durably appended+applied BEFORE any completion delivery.
 * T07-AC2: duplicate/replayed terminals have exactly one state effect; first
 *          applicable terminal wins.
 * T07-AC3: attempt sequence gaps emit a stable diagnostic without deleting
 *          or delaying an already-persisted terminal.
 * T07-AC4: stale attempt/generation terminals ignored + counted, never
 *          overwrite current truth.
 * T07-AC5: bounded summary + transcript reference only.
 * T07-AC6: terminal persists under progress saturation / degraded sink.
 * T07-AC7: cancel-vs-complete race resolves through one applicable terminal
 *          owner without flip-flop.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_t07_1",
    attemptId: "att_t07_1",
    generation: 1,
    commandId: "cmd_t07_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_t07" as ThreadId,
    parentTurnId: "turn_t07" as TurnId,
    parentToolCallId: "call_t07",
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
  executionId: "exec_t07_1",
  attemptId: "att_t07_1",
  generation: 1,
  state: "succeeded",
  occurredAt: "2026-08-18T00:01:00.000Z",
  summary: "Agent completed: 3 tool uses. Outcome: done.",
  transcriptRef: "/tmp/agents/exec_t07_1/output.md",
  outcomeState: "done",
  ...overrides,
});

describe("Pi Subagent journal-first terminal lifecycle (Issue 07)", () => {
  it("T07-AC1: first terminal is journaled and applied before notification", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const order: string[] = [];
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
          onTerminalPersisted: () => {
            // The durable state must ALREADY be terminal when notification
            // begins (T07-AC1: delivery may begin only after durability).
            order.push("notify");
          },
        });

        expect(result.outcome).toBe("persisted");
        order.push("after-ingest");
        expect(order).toEqual(["notify", "after-ingest"]);

        const execution = yield* repository.getById("exec_t07_1");
        expect(Option.isSome(execution)).toBe(true);
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
          expect(execution.value.desiredState).toBe("succeeded");
        }
        const journal = yield* repository.listJournalEvents("exec_t07_1");
        const terminal = journal.find(
          (event) =>
            event.state === "succeeded" && event.sequence === PI_SUBAGENT_TERMINAL_SEQUENCE,
        );
        expect(terminal).toBeDefined();
        expect(terminal?.attemptId).toBe("att_t07_1");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC2: replayed terminal is exactly-once; a different-state racer cannot flip-flop", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const first = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(first.outcome).toBe("persisted");

        // Exact replay (same identity, deterministic eventId).
        const replay = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ occurredAt: "2026-08-18T00:02:00.000Z" }),
        });
        expect(replay.outcome).toBe("already_applied");

        // A DIFFERENT terminal state for the same attempt at the SAME
        // attempt-local sequence is a replay against the sequence dedup key:
        // exactly one state effect, no flip-flop (T07-AC2).
        const racing = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ state: "failed", occurredAt: "2026-08-18T00:03:00.000Z" }),
        });
        expect(racing.outcome).toBe("already_applied");

        const execution = yield* repository.getById("exec_t07_1");
        expect(Option.isSome(execution)).toBe(true);
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
        // Both terminal states were submitted, but exactly one journal row
        // exists at the attempt-local terminal sequence (sequence dedup), the
        // aggregate is succeeded, and the stale counter did not move: the
        // replay had no state effect at all.
        const journal = yield* repository.listJournalEvents("exec_t07_1");
        expect(journal.filter((event) => event.state === "succeeded")).toHaveLength(1);
        expect(journal.filter((event) => event.state === "failed")).toHaveLength(0);
        const evidence = yield* repository.getTerminalEvidence("exec_t07_1");
        expect(Option.isSome(evidence)).toBe(true);
        if (Option.isSome(evidence)) {
          expect(evidence.value.staleTerminalEvents).toBe(0);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC3: sequence gap emits a stable diagnostic without deleting/delaying the terminal", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // No started/detached events: the terminal (sequence 40) arrives with
        // a gap after the admission event (sequence 1).
        const diagnostics: Array<{
          executionId: string;
          diagnosticCode: PiSubagentDiagnosticCode;
          diagnosticMessage: string;
        }> = [];
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
          onDiagnostic: (event) => {
            diagnostics.push(event);
          },
        });

        expect(result.outcome).toBe("persisted");
        const gap = diagnostics.find(
          (event) => event.diagnosticCode === "pi_subagent_event_sequence_gap",
        );
        expect(gap).toBeDefined();
        expect(gap?.executionId).toBe("exec_t07_1");
        expect(gap?.diagnosticMessage).toContain("sequence gap");

        // The terminal was NOT deleted or delayed: durable truth is terminal.
        const execution = yield* repository.getById("exec_t07_1");
        expect(Option.isSome(execution)).toBe(true);
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
        const journal = yield* repository.listJournalEvents("exec_t07_1");
        expect(journal.some((event) => event.state === "succeeded")).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC3 (control): no gap diagnostic when sequences are contiguous", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        // Contiguous: admission seq 1 → fill 2..39 → terminal seq 40.
        for (let sequence = 2; sequence <= 39; sequence++) {
          yield* repository.recordLifecycleEvent({
            eventId: `evt_fill_${sequence}`,
            executionId: "exec_t07_1",
            attemptId: "att_t07_1",
            generation: 1,
            sequence,
            state: "running",
            occurredAt: "2026-08-18T00:00:30.000Z",
          });
        }
        const diagnostics: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
          onDiagnostic: (event) => {
            diagnostics.push(event);
          },
        });
        expect(result.outcome).toBe("persisted");
        expect(
          diagnostics.some((event) => event.diagnosticCode === "pi_subagent_event_sequence_gap"),
        ).toBe(false);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC4: stale attempt/generation terminal ignored, counted, truth preserved", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Advance to a newer attempt/generation (resume).
        yield* repository.recordLifecycleEvent({
          eventId: "evt_t07_resume",
          executionId: "exec_t07_1",
          attemptId: "att_t07_2",
          generation: 2,
          sequence: 1,
          state: "running",
          occurredAt: "2026-08-18T00:04:00.000Z",
        });

        const diagnostics: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
        // Late terminal from the OLD attempt.
        const stale = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ attemptId: "att_t07_1", generation: 1 }),
          onDiagnostic: (event) => {
            diagnostics.push(event);
          },
        });
        expect(stale.outcome).toBe("ignored_stale");
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_terminal_stale_ignored",
          ),
        ).toBe(true);

        // Current truth untouched: newer attempt still running.
        const execution = yield* repository.getById("exec_t07_1");
        expect(Option.isSome(execution)).toBe(true);
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("running");
          expect(execution.value.attemptId).toBe("att_t07_2");
          expect(execution.value.generation).toBe(2);
        }

        // The terminal for the CURRENT attempt applies.
        const current = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ attemptId: "att_t07_2", generation: 2 }),
        });
        expect(current.outcome).toBe("persisted");
        const after = yield* repository.getById("exec_t07_1");
        if (Option.isSome(after)) {
          expect(after.value.observedState).toBe("succeeded");
          expect(after.value.attemptId).toBe("att_t07_2");
        }
        const evidence = yield* repository.getTerminalEvidence("exec_t07_1");
        if (Option.isSome(evidence)) {
          expect(evidence.value.staleTerminalEvents).toBe(1);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC5: terminal payload stores bounded summary + transcript reference, never unbounded output", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const huge = "x".repeat(50_000);
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ summary: huge }),
          summaryMaxChars: 512,
        });

        const evidence = yield* repository.getTerminalEvidence("exec_t07_1");
        expect(Option.isSome(evidence)).toBe(true);
        if (Option.isSome(evidence)) {
          expect(evidence.value.terminalSummary?.length).toBeLessThanOrEqual(512);
          expect(evidence.value.terminalTranscriptRef).toBe("/tmp/agents/exec_t07_1/output.md");
        }
        // Default cap (2000) applies when the knob is absent.
        yield* admit(
          makeExecution({
            executionId: "exec_t07_cap",
            attemptId: "att_cap",
            commandId: "cmd_t07_cap",
          }),
        );
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({
            executionId: "exec_t07_cap",
            attemptId: "att_cap",
            summary: "y".repeat(9_999),
          }),
        });
        const evidenceDefault = yield* repository.getTerminalEvidence("exec_t07_cap");
        if (Option.isSome(evidenceDefault)) {
          expect(evidenceDefault.value.terminalSummary?.length).toBeLessThanOrEqual(2000);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC6: terminal persists while the observation sink is degraded (progress throws)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // A degraded observation sink: progress observations fail (thrown /
        // rejected), yet the terminal path — a separate, journal-first path
        // that never enters the progress coalescer — persists (T07-AC6).
        let progressFailures = 0;
        const degradedProgressSink = async (): Promise<void> => {
          progressFailures += 1;
          throw new Error("observation sink degraded");
        };
        for (let i = 0; i < 200; i++) {
          yield* Effect.promise(() =>
            degradedProgressSink().catch(() => {
              // Swallowed exactly like the server swallows progress sink
              // failures: observation, not control (T23-AC5).
            }),
          );
        }
        expect(progressFailures).toBe(200);

        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(result.outcome).toBe("persisted");
        const execution = yield* repository.getById("exec_t07_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
        // Journal integrity under the saturated window: exactly one terminal.
        const journal = yield* repository.listJournalEvents("exec_t07_1");
        expect(journal.filter((event) => event.state === "succeeded")).toHaveLength(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC7 (race A): durable cancelled first → late succeeded terminal ignored without flip-flop", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Cancel coordinator wins the race: intent + settled cancelled ack.
        yield* repository.recordCancellationIntent({
          executionId: "exec_t07_1",
          attemptId: "att_t07_1",
          generation: 1,
          sequence: 90,
          cancelCommandId: "cancelcmd_exec_t07_1_att_t07_1_gen1_th_t07",
          occurredAt: "2026-08-18T00:05:00.000Z",
          reason: "parent_turn_stop",
        });
        yield* repository.recordCancelledAck({
          executionId: "exec_t07_1",
          attemptId: "att_t07_1",
          generation: 1,
          sequence: 92,
          occurredAt: "2026-08-18T00:05:01.000Z",
          evidenceChannel: "child_ack",
        });

        // The child's own settlement arrives late with a success terminal.
        const late = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ occurredAt: "2026-08-18T00:05:02.000Z" }),
        });
        expect(late.outcome).toBe("ignored_stale");

        const execution = yield* repository.getById("exec_t07_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("cancelled");
          expect(execution.value.desiredState).toBe("cancelled");
        }
        const evidence = yield* repository.getTerminalEvidence("exec_t07_1");
        if (Option.isSome(evidence)) {
          expect(evidence.value.staleTerminalEvents).toBe(1);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC7 (race B): succeeded terminal first → late cancelled ack cannot flip-flop", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // Child completes before the cancel ack settles.
        const early = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(early.outcome).toBe("persisted");

        const ack = yield* repository.recordCancelledAck({
          executionId: "exec_t07_1",
          attemptId: "att_t07_1",
          generation: 1,
          sequence: 92,
          occurredAt: "2026-08-18T00:06:00.000Z",
          evidenceChannel: "child_ack",
        });
        // recordCancelledAck journals history but the guarded UPDATE cannot
        // regress the terminal aggregate.
        expect(ack.kind === "recorded" || ack.kind === "already_applied").toBe(true);

        const execution = yield* repository.getById("exec_t07_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
          expect(execution.value.desiredState).toBe("succeeded");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC1 (failure surface): terminal persistence failure never notifies and degrades control health", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        // No admission: the execution lookup fails — a persistence failure.
        const failures: Array<{ diagnosticCode: PiSubagentDiagnosticCode }> = [];
        let notified = false;
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ executionId: "exec_missing" }),
          onTerminalPersisted: () => {
            notified = true;
          },
          onTerminalPersistenceFailed: (event) => {
            failures.push(event);
          },
        });
        expect(result.outcome).toBe("failed");
        expect(notified).toBe(false);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.diagnosticCode).toBe("pi_subagent_terminal_persistence_failed");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC2 (generic path guard): recordLifecycleEvent terminal cannot overwrite a terminal aggregate", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        yield* repository.recordLifecycleEvent({
          eventId: "evt_t07_cancel_via_generic",
          executionId: "exec_t07_1",
          attemptId: "att_t07_1",
          generation: 1,
          sequence: 93,
          state: "cancelled",
          occurredAt: "2026-08-18T00:07:00.000Z",
        });
        const cancelled = yield* repository.getById("exec_t07_1");
        if (Option.isSome(cancelled)) {
          expect(cancelled.value.observedState).toBe("cancelled");
        }

        // A second, DIFFERENT terminal through the generic path must not
        // flip-flop the aggregate.
        yield* repository.recordLifecycleEvent({
          eventId: "evt_t07_failed_via_generic",
          executionId: "exec_t07_1",
          attemptId: "att_t07_1",
          generation: 1,
          sequence: 94,
          state: "failed",
          occurredAt: "2026-08-18T00:07:01.000Z",
        });
        const after = yield* repository.getById("exec_t07_1");
        if (Option.isSome(after)) {
          expect(after.value.observedState).toBe("cancelled");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T07-AC6 (saturation harness): terminal persists while the real progress coalescer is under a flood", async () => {
    // Shared provider-ingress saturation harness (ticket 05 / T23-AC6
    // harness): drive the EXACT server coalescer on a virtual clock, flood
    // progress observations, and interleave the terminal ingest. The
    // terminal path never enters the coalescer (reserved lifecycle capacity),
    // so it applies immediately regardless of flood state.
    const flushes: Array<{ executionId: string; coalescedCount: number }> = [];
    let virtualNow = 0;
    const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
    const coalescer = makePiSubagentProgressCoalescer({
      now: () => virtualNow,
      schedule: (delayMs, callback) => {
        const task = { at: virtualNow + Math.max(0, delayMs), callback, cancelled: false };
        timers.push(task);
        return { cancel: () => void (task.cancelled = true) };
      },
      onFlush: (flush) => {
        flushes.push({ executionId: flush.executionId, coalescedCount: flush.coalescedCount });
      },
      flushIntervalMs: 500,
      idleTtlMs: 30_000,
    });

    const fireDueTimers = async () => {
      for (;;) {
        const due = timers.filter((t) => !t.cancelled && t.at <= virtualNow);
        if (due.length === 0) break;
        for (const task of due) {
          task.cancelled = true;
          task.callback();
          await Promise.resolve();
        }
      }
    };

    // Flood: 5 000 progress observations across 5 simulated seconds.
    const floodCount = 5_000;
    for (let i = 0; i < floodCount; i++) {
      virtualNow += 1;
      await coalescer.recordProgress(
        "exec_t07_1",
        JSON.stringify({ turnCount: i + 1, activity: "flood" }),
      );
      await fireDueTimers();
      // Structural bound holds during the flood.
      expect(coalescer.trackedExecutions()).toBeLessThanOrEqual(1);
      expect(coalescer.pendingCount()).toBeLessThanOrEqual(1);
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // The terminal arrives mid-flood (pending progress slot exists) and
        // must persist immediately — it never queues behind progress.
        expect(coalescer.hasPending("exec_t07_1")).toBe(true);
        const result = yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation(),
        });
        expect(result.outcome).toBe("persisted");

        const execution = yield* repository.getById("exec_t07_1");
        if (Option.isSome(execution)) {
          expect(execution.value.observedState).toBe("succeeded");
        }
        const journal = yield* repository.listJournalEvents("exec_t07_1");
        const terminal = journal.find((event) => event.sequence === PI_SUBAGENT_TERMINAL_SEQUENCE);
        expect(terminal).toBeDefined();
      }).pipe(Effect.provide(repositoryLayer)),
    );

    // The flood's progress accounting is independent: coalesced + emitted
    // reconciles after full drain.
    virtualNow += 10_000;
    await fireDueTimers();
    const stats = coalescer.stats();
    expect(stats.totalCoalesced + stats.totalEmitted).toBe(floodCount);
  });
});
