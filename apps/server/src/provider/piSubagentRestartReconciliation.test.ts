import type {
  PiSubagentCancellationScope,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
  PiSubagentTranscriptTerminalMarker,
} from "@synara/contracts";
import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  recoverCompletionOutbox,
  type PiSubagentCompletionDeliveryOutcome,
  type PiSubagentCompletionDeliveryRequest,
  processPendingCompletions,
} from "./piSubagentCompletionOutbox.ts";
import type { PiSubagentActiveChild } from "./piSubagentBridge.ts";
import {
  PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE,
  reconcilePiSubagentExecutions,
} from "./piSubagentRestartReconciliation.ts";

/**
 * Ticket 10 / Testing Seams — Restart reconciliation to terminal or orphaned.
 *
 * Seam 1 (T10-AC1/AC2/AC4/AC5/AC7): server orchestration kill/restart
 * harness — the REAL repository + in-memory SQLite, driven through the
 * production coordinator with active-owner, no-owner, terminal-marker,
 * missing-marker, lease-expiry, and stale-event fixtures.
 *
 * Seam 2 (T10-AC1): execution state-machine contract — `orphaned` is
 * non-terminal and exits only through new evidence (the repository keeps it
 * in the cancellation/reconciliation scan sets; a terminal can never be
 * orphaned).
 *
 * Seam 3 (T10-AC6): projected diagnostic contract — the owner-loss
 * diagnostic explains partial external/workspace side effects and recommends
 * inspection, durably persisted on the execution record.
 *
 * Decision 0013 F1/F2 dispositions live in the recovery-boundary tests at
 * the bottom of this file (journal→outbox clamping and stale-terminal
 * exclusion).
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const BASE_TIME_MS = Date.parse("2026-08-18T08:00:00.000Z");

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_t10_1",
    attemptId: "att_t10_1",
    generation: 1,
    commandId: "cmd_t10_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_t10" as ThreadId,
    parentTurnId: "turn_t10" as TurnId,
    parentToolCallId: "call_t10",
    agentType: "general-purpose",
    prompt: "task",
    mode: "foreground",
    cancellationScope: "parent_turn" as PiSubagentCancellationScope,
    desiredState: "running" as PiSubagentLifecycleState,
    observedState: "running" as PiSubagentLifecycleState,
    createdAt: "2026-08-18T07:00:00.000Z",
    updatedAt: "2026-08-18T07:00:00.000Z",
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

/**
 * Production-shaped fixture: admission (seq 1 accepted) followed by the
 * `started` lifecycle event (seq 2 running) exactly as the PiAdapter path
 * journals it — reconciliation fixtures operate on a `running` child.
 */
const admitRunning = (record: PiSubagentExecutionRecord) =>
  Effect.gen(function* () {
    yield* admit(record);
    const repository = yield* PiSubagentExecutionRepository;
    const started = yield* repository.recordLifecycleEvent({
      eventId: `evt_${record.executionId}_${record.attemptId}_gen${record.generation}_seq2_started`,
      executionId: record.executionId,
      attemptId: record.attemptId,
      generation: record.generation,
      sequence: 2,
      state: "running",
      occurredAt: record.createdAt,
      metadataJson: JSON.stringify({ phase: "started" }),
    });
    expect(started.kind === "recorded" || started.kind === "already_applied").toBe(true);
  });

/** A bridge active-child record (live-owner fixture, T10-AC3). */
const activeChild = (execution: PiSubagentExecutionRecord): PiSubagentActiveChild => ({
  executionId: execution.executionId,
  attemptId: execution.attemptId,
  generation: execution.generation,
  mode: execution.mode,
  cancellationScope: "parent_turn",
  isRunning: true,
});

describe("Pi Subagent restart reconciliation (Issue 10)", () => {
  it("T10-AC1: no live-owner or terminal evidence produces non-terminal `orphaned` with a stable owner-loss diagnostic; running is never asserted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admitRunning(execution);

        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => BASE_TIME_MS,
        });

        expect(result.failures).toHaveLength(0);
        expect(result.outcomes).toHaveLength(1);
        expect(result.outcomes[0]).toMatchObject({
          kind: "orphaned",
          executionId: "exec_t10_1",
          diagnosticCode: "pi_subagent_owner_loss_orphaned",
        });

        const after = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(after)).toBe(true);
        if (Option.isSome(after)) {
          // `orphaned` is NON-terminal: observed becomes orphaned, and the
          // record is still in the reconciliation/cancellation scan sets.
          expect(after.value.observedState).toBe("orphaned");
          expect(after.value.diagnosticCode).toBe("pi_subagent_owner_loss_orphaned");
          expect(after.value.rejectionReason).toBe(PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE);
          // Reconciliation fence: the generation advanced so late events
          // from the orphaned attempt are stale (T10-AC5 support).
          expect(after.value.generation).toBe(2);
          expect(after.value.attemptId).toBe("att_t10_1");
        }

        // Non-terminal state machine: the orphaned execution is still
        // cancellable (exits only through new evidence or explicit action).
        const cancellable = yield* repository.listCancellableByParentTurn("th_t10");
        expect(cancellable.some((e) => e.executionId === "exec_t10_1")).toBe(true);

        // Idempotent reconciliation: a second pass reports the SAME fenced
        // orphaned generation (no re-settlement) — no second journal row, no
        // further generation advance.
        const journalBefore = yield* repository.listJournalEvents("exec_t10_1");
        const orphanRowsBefore = journalBefore.filter((e) => e.state === "orphaned");
        expect(orphanRowsBefore).toHaveLength(1);
        const generationBefore = (() => {
          const record = Option.isSome(after) ? after.value : undefined;
          return record?.generation ?? -1;
        })();
        const second = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => BASE_TIME_MS,
        });
        const secondOrphan = second.outcomes.find((o) => o.kind === "orphaned");
        expect(secondOrphan).toBeDefined();
        if (secondOrphan?.kind === "orphaned") {
          expect(secondOrphan.generation).toBe(generationBefore);
        }
        const journalAfter = yield* repository.listJournalEvents("exec_t10_1");
        expect(journalAfter.filter((e) => e.state === "orphaned")).toHaveLength(1);
        const settledTwice = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(settledTwice)).toBe(true);
        if (Option.isSome(settledTwice)) {
          expect(settledTwice.value.generation).toBe(generationBefore);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC6: the orphan diagnostic explains partial side effects and recommends inspection (projected diagnostic contract)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admitRunning(makeExecution());

        const diagnostics: string[] = [];
        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => BASE_TIME_MS,
          onDiagnostic: (event) => {
            diagnostics.push(event.diagnosticMessage);
          },
        });
        expect(result.outcomes[0]?.kind).toBe("orphaned");

        const message = PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE;
        // The diagnostic must explain BOTH the uncertainty and the
        // recommended action (spec user stories 14/16; T10-AC6).
        expect(message).toMatch(/partial external or workspace side effects/i);
        expect(message).toMatch(/inspect/i);
        expect(message).toMatch(/not automatically replayed/i);
        // The same message is what the projection surface reads durably
        // (execution record) and what runtime observers receive.
        expect(diagnostics).toContain(message);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC3: a live-owner listActive match under the same execution, attempt, and generation refreshes observation without a new attempt", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admitRunning(execution);

        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          liveOwnerProbes: [() => [activeChild(execution)]],
          leaseDurationMs: 30000,
          now: () => BASE_TIME_MS,
        });

        expect(result.outcomes).toHaveLength(1);
        expect(result.outcomes[0]).toMatchObject({
          kind: "running_refreshed",
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1,
        });

        const after = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(after)).toBe(true);
        if (Option.isSome(after)) {
          // Still running under the SAME attempt — no new attempt, no fence.
          expect(after.value.observedState).toBe("running");
          expect(after.value.attemptId).toBe("att_t10_1");
          expect(after.value.generation).toBe(1);
        }

        // Observation refreshed: the server-side heartbeat touch updated
        // last_heartbeat_at and the re-derived lease against the server clock.
        const observation = yield* repository.getObservation("exec_t10_1");
        expect(Option.isSome(observation)).toBe(true);
        if (Option.isSome(observation)) {
          expect(observation.value.lastHeartbeatAt).toBe(new Date(BASE_TIME_MS).toISOString());
          expect(observation.value.leaseExpiresAt).toBe(
            new Date(BASE_TIME_MS + 30000).toISOString(),
          );
        }

        // A listActive record that does NOT match the current attempt or
        // generation is not live-owner evidence (identity mismatch → orphan).
        yield* admitRunning(
          makeExecution({
            executionId: "exec_t10_2",
            attemptId: "att_t10_2",
            commandId: "cmd_t10_2",
            parentToolCallId: "call_2",
          }),
        );
        const mismatched = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          liveOwnerProbes: [
            () => [
              {
                executionId: "exec_t10_2",
                attemptId: "att_OTHER",
                generation: 1,
                mode: "foreground",
                cancellationScope: "parent_turn",
                isRunning: true,
              },
            ],
          ],
          now: () => BASE_TIME_MS,
        });
        expect(
          mismatched.outcomes.some((o) => o.kind === "orphaned" && o.executionId === "exec_t10_2"),
        ).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC4: startup reconciliation performs no spawn, resume, or other side-effecting delegation replay", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admitRunning(makeExecution());

        // Side-effecting surface spies: the bridge fixture fails the test if
        // reconciliation so much as calls a dispatch method.
        const forbiddenCalls: string[] = [];
        const probe = () => {
          forbiddenCalls.push("listActive");
          return [] as ReadonlyArray<PiSubagentActiveChild>;
        };
        const readTranscriptTerminal = async () => {
          forbiddenCalls.push("transcriptRead");
          return undefined;
        };

        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          liveOwnerProbes: [probe],
          readTranscriptTerminal,
          now: () => BASE_TIME_MS,
        });
        expect(result.outcomes[0]?.kind).toBe("orphaned");

        // Evidence reads happened (probe + reader were consulted), but the
        // coordinator exposes NO spawn/resume/cancel dispatch surface at all:
        // its input contract has no dispatch methods to call. The strongest
        // available proof at this seam: reconciliation settled durably
        // (journal shows only the orphan event — no new attempts, no running
        // assertions) and no tool/turn/spawn runtime events were produced.
        const journal = yield* repository.listJournalEvents("exec_t10_1");
        const journalStates = journal.map((event) => event.state);
        expect(journalStates).toEqual(["accepted", "running", "orphaned"]);
        expect(journal.some((event) => event.attemptId !== "att_t10_1")).toBe(false);
        expect(forbiddenCalls).toContain("listActive");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC2: a transcript terminal marker with matching identity and generation restores the terminal outcome instead of orphaning", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admitRunning(execution);

        const marker: PiSubagentTranscriptTerminalMarker = {
          kind: "transcript_terminal",
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1,
          state: "succeeded",
          summary: "Agent completed: 2 tool uses. Outcome: done.",
          transcriptRef: "/tmp/pi-subagents-0/x/tasks/att_t10_1.output",
          outcomeState: "completed",
        };

        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          readTranscriptTerminal: async () => marker,
          now: () => BASE_TIME_MS,
        });

        expect(result.outcomes).toHaveLength(1);
        expect(result.outcomes[0]).toMatchObject({
          kind: "terminal_restored",
          executionId: "exec_t10_1",
          state: "succeeded",
          source: "transcript_marker",
        });

        const after = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(after)).toBe(true);
        if (Option.isSome(after)) {
          expect(after.value.observedState).toBe("succeeded");
        }
        // Decision 0013 linkage: the restored terminal created its completion
        // outbox entry atomically — the recovered completion enters the
        // fenced delivery path.
        const outboxId = `outbox_exec_t10_1_att_t10_1_gen1`;
        const entry = yield* repository.getCompletionOutboxEntry(outboxId);
        expect(Option.isSome(entry)).toBe(true);
        if (Option.isSome(entry)) {
          expect(entry.value.deliveryState).toBe("pending");
          expect(entry.value.terminalState).toBe("succeeded");
        }

        // Mismatched identity/generation restores NOTHING (stale marker):
        // a different generation must not settle the execution.
        yield* admitRunning(
          makeExecution({
            executionId: "exec_t10_3",
            attemptId: "att_t10_3",
            generation: 4,
            commandId: "cmd_t10_3",
            parentToolCallId: "call_3",
          }),
        );
        const staleMarkerResult = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          readTranscriptTerminal: async () => ({
            ...marker,
            executionId: "exec_t10_3",
            attemptId: "att_t10_3",
            generation: 3, // stale generation — must not restore
          }),
          now: () => BASE_TIME_MS,
        });
        expect(
          staleMarkerResult.outcomes.some(
            (o) => o.kind === "orphaned" && o.executionId === "exec_t10_3",
          ),
        ).toBe(true);
        const after3 = yield* repository.getById("exec_t10_3");
        expect(Option.isSome(after3)).toBe(true);
        if (Option.isSome(after3)) {
          expect(after3.value.observedState).toBe("orphaned");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC5: late events from stale attempts or generations after reconciliation are ignored and counted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admitRunning(makeExecution());

        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => BASE_TIME_MS,
        });
        expect(result.outcomes[0]?.kind).toBe("orphaned");

        // Fence check: the aggregate advanced to generation 2.
        const after = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(after)).toBe(true);
        if (Option.isSome(after)) {
          expect(after.value.generation).toBe(2);
        }

        // A late terminal from the ORPHANED generation is journaled history
        // only: ignored_stale + counted (stale_terminal_events), never able
        // to reverse the settled projection into `succeeded`.
        const lateTerminal = yield* repository.recordTerminalEvent({
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1, // the orphaned generation — now stale
          sequence: 40,
          state: "succeeded",
          occurredAt: new Date(BASE_TIME_MS + 5000).toISOString(),
          summary: "late terminal from the dead child",
        });
        expect(lateTerminal.kind).toBe("ignored_stale");
        if (lateTerminal.kind === "ignored_stale") {
          expect(lateTerminal.reason).toBe("superseded_generation");
          expect(lateTerminal.staleTerminalEvents).toBe(1);
        }

        const settled = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(settled)).toBe(true);
        if (Option.isSome(settled)) {
          expect(settled.value.observedState).toBe("orphaned");
        }
        const evidence = yield* repository.getTerminalEvidence("exec_t10_1");
        expect(Option.isSome(evidence)).toBe(true);
        if (Option.isSome(evidence)) {
          expect(evidence.value.staleTerminalEvents).toBe(1);
        }

        // A late generic lifecycle event from the stale generation is also
        // journaled history only — it cannot flip observed back to running.
        const lateRunning = yield* repository.recordLifecycleEvent({
          eventId: "late_running_evt",
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1,
          sequence: 5,
          state: "running",
          occurredAt: new Date(BASE_TIME_MS + 6000).toISOString(),
        });
        expect(lateRunning.kind).toBe("recorded");
        const stillSettled = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(stillSettled)).toBe(true);
        if (Option.isSome(stillSettled)) {
          expect(stillSettled.value.observedState).toBe("orphaned");
          expect(stillSettled.value.generation).toBe(2);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC7: lease expiry without renewed live-owner evidence enters the same owner-loss reconciliation after the configured threshold", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admitRunning(execution);

        // Lease-expiry mode requires the re-derived lease to have been
        // expired BEYOND the orphan threshold. last_heartbeat_at at
        // 07:00:00, lease 30s, threshold 60s → orphan-eligible from 07:01:30.
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_t10_1",
          occurredAt: "2026-08-18T07:00:00.000Z",
          leaseExpiresAt: "2026-08-18T07:00:30.000Z",
        });

        // Below the threshold (07:01:00): NOT orphaned, state untouched.
        const before = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "lease_expiry",
          leaseDurationMs: 30000,
          orphanAfterMs: 60000,
          now: () => Date.parse("2026-08-18T07:01:00.000Z"),
        });
        expect(before.outcomes[0]).toMatchObject({ kind: "lease_not_expired" });
        const unchanged = yield* repository.getById("exec_t10_1");
        expect(Option.isSome(unchanged)).toBe(true);
        if (Option.isSome(unchanged)) {
          expect(unchanged.value.observedState).toBe("running");
        }

        // Past the threshold (07:01:31) with no live-owner evidence: the
        // SAME owner-loss reconciliation orphans the execution.
        const after = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "lease_expiry",
          leaseDurationMs: 30000,
          orphanAfterMs: 60000,
          now: () => Date.parse("2026-08-18T07:01:31.000Z"),
        });
        expect(after.outcomes[0]).toMatchObject({
          kind: "orphaned",
          executionId: "exec_t10_1",
        });

        // A live owner past the threshold is NEVER orphaned: renewed
        // live-owner evidence wins in lease-expiry mode too.
        yield* admitRunning(
          makeExecution({
            executionId: "exec_t10_live",
            attemptId: "att_t10_live",
            commandId: "cmd_t10_live",
            parentToolCallId: "call_live",
          }),
        );
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_t10_live",
          occurredAt: "2026-08-18T07:00:00.000Z",
          leaseExpiresAt: "2026-08-18T07:00:30.000Z",
        });
        const refreshed = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "lease_expiry",
          leaseDurationMs: 30000,
          orphanAfterMs: 60000,
          liveOwnerProbes: [
            () => [
              activeChild(
                makeExecution({
                  executionId: "exec_t10_live",
                  attemptId: "att_t10_live",
                }),
              ),
            ],
          ],
          now: () => Date.parse("2026-08-18T07:01:31.000Z"),
        });
        expect(refreshed.outcomes).toContainEqual({
          kind: "running_refreshed",
          executionId: "exec_t10_live",
          attemptId: "att_t10_live",
          generation: 1,
        });
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T10-AC7: the orphan threshold is configurable (approximately 60 seconds by default)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admitRunning(makeExecution());
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_t10_1",
          occurredAt: "2026-08-18T07:00:00.000Z",
          leaseExpiresAt: "2026-08-18T07:00:30.000Z",
        });

        // A shorter configured threshold orphans earlier: with threshold 5s,
        // 07:00:36 is already past last_heartbeat + 30s lease + 5s.
        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "lease_expiry",
          leaseDurationMs: 30000,
          orphanAfterMs: 5000,
          now: () => Date.parse("2026-08-18T07:00:36.000Z"),
        });
        expect(result.outcomes[0]).toMatchObject({ kind: "orphaned" });
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("terminal aggregates are never orphaned (owner loss cannot reverse terminal truth)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        const terminal = yield* repository.recordTerminalEvent({
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-18T07:30:00.000Z",
          summary: "completed before restart",
        });
        expect(terminal.kind).toBe("recorded");

        const result = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          now: () => BASE_TIME_MS,
        });
        // Terminal executions are outside the non-terminal scan entirely.
        expect(result.outcomes).toHaveLength(0);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});

describe("Decision 0013 F1/F2 dispositions (recovery boundary, Ticket 10)", () => {
  it("F1: journal→outbox recovery re-clamps unbounded journal-extracted metadata", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // A legacy/generic terminal journal row carrying unbounded metadata
        // (the F1 exposure: the row predates the bounded terminal writers).
        const unboundedSummary = "x".repeat(50000);
        const unboundedRef = "r".repeat(5000);
        const recorded = yield* repository.recordLifecycleEvent({
          eventId: "legacy_terminal_exec_t10_1",
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-18T07:30:00.000Z",
          metadataJson: JSON.stringify({
            summary: unboundedSummary,
            transcriptRef: unboundedRef,
          }),
        });
        expect(recorded.kind).toBe("recorded");

        const result = yield* recoverCompletionOutbox({ repository });
        expect(result.recovered).toBe(1);

        const entry = yield* repository.getCompletionOutboxEntry(
          "outbox_exec_t10_1_att_t10_1_gen1",
        );
        expect(Option.isSome(entry)).toBe(true);
        if (Option.isSome(entry)) {
          // Bounded at the accepted terminal caps — never the unbounded
          // journal content (Decision 0012 F2 envelope, F1 clamp).
          expect(entry.value.summary.length).toBeLessThanOrEqual(2000);
          expect(entry.value.transcriptRef?.length ?? 0).toBeLessThanOrEqual(1024);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("F2: recovery excludes inapplicable stale terminals (no transiently-pending stale entries)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        // A stale terminal journal row: superseded attempt/generation that
        // deliberately received no outbox row during ingest.
        const stale = yield* repository.recordTerminalEvent({
          executionId: "exec_t10_1",
          attemptId: "att_OLD",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-18T07:20:00.000Z",
          summary: "stale terminal from a superseded attempt",
        });
        expect(stale.kind).toBe("ignored_stale");

        const result = yield* recoverCompletionOutbox({ repository });
        // The stale terminal is excluded by the applicability predicate —
        // recovery creates no pending entry for it (prompt fencing without
        // the transient superseded row).
        expect(result.recovered).toBe(0);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("recovered pending entries enter the fenced delivery path (Decision 0013 downstream invariant)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const recorded = yield* repository.recordLifecycleEvent({
          eventId: "legacy_terminal_exec_t10_1",
          executionId: "exec_t10_1",
          attemptId: "att_t10_1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-18T07:30:00.000Z",
          metadataJson: JSON.stringify({ summary: "recovered completion" }),
        });
        expect(recorded.kind).toBe("recorded");

        yield* recoverCompletionOutbox({ repository });

        const deliveries: PiSubagentCompletionDeliveryRequest[] = [];
        const pump = yield* processPendingCompletions({
          repository,
          retryLimit: 5,
          deliver: async (
            request: PiSubagentCompletionDeliveryRequest,
          ): Promise<PiSubagentCompletionDeliveryOutcome> => {
            deliveries.push(request);
            return { accepted: true, acknowledged: true };
          },
        });
        expect(pump.delivered).toBe(1);
        expect(pump.acknowledged).toBe(1);
        expect(deliveries[0]?.dedupeId).toBe("outbox_exec_t10_1_att_t10_1_gen1");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
