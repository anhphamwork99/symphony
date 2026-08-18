import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect } from "vitest";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../Services/PiSubagentExecutionRepository.ts";
import { PiSubagentExecutionRepositoryLive } from "./PiSubagentExecutionRepository.ts";

const layer = it.layer(
  PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const baseAdmission = {
  executionId: "exec_test_001",
  attemptId: "att_001",
  generation: 1,
  commandId: "cmd_test_001",
  commandFingerprint: "fingerprint_scope_a",
  clientCommandId: "client_cmd_test_001",
  subject: "user_456",
  projectId: "proj_default",
  parentThreadId: "thread_main",
  parentTurnId: "turn_123",
  parentToolCallId: "call_abc",
  agentType: "researcher",
  prompt: "Investigate database performance",
  mode: "foreground" as const,
  cancellationScope: "parent_turn" as const,
  state: "accepted" as const,
  diagnosticCode: "pi_subagent_managed_enabled" as const,
  now: "2026-08-16T12:00:00.000Z",
};

layer("PiSubagentExecutionRepository (T20-AC1, T20-AC2, T20-AC3, T20-AC4, T20-AC8)", (it) => {
  it.effect("durably records accepted execution and journal event", () =>
    Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;

      const result = yield* repo.recordAdmission(baseAdmission);
      assert(result.kind === "admitted");
      assert.equal(result.execution.executionId, "exec_test_001");
      assert.equal(result.execution.attemptId, "att_001");
      assert.equal(result.execution.generation, 1);
      assert.equal(result.execution.observedState, "accepted");
      assert.equal(result.execution.desiredState, "running");

      // Verify retrieval by ID
      const fetched = yield* repo.getById("exec_test_001");
      assert.isTrue(Option.isSome(fetched));
      if (Option.isSome(fetched)) {
        assert.equal(fetched.value.commandId, "cmd_test_001");
        assert.equal(fetched.value.parentThreadId, "thread_main");
      }

      // Verify journal events
      const journalEvents = yield* repo.listJournalEvents("exec_test_001");
      assert.equal(journalEvents.length, 1);
      assert.equal(journalEvents[0]!.sequence, 1);
      assert.equal(journalEvents[0]!.state, "accepted");
      assert.equal(journalEvents[0]!.diagnosticCode, "pi_subagent_managed_enabled");
    }),
  );

  it.effect(
    "T20-AC3: replaying commandId within the same ownership scope returns already_applied and creates no duplicate",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;

        const replayResult = yield* repo.recordAdmission({
          ...baseAdmission,
          executionId: "exec_test_should_not_overwrite",
          attemptId: "att_002",
          now: "2026-08-16T12:05:00.000Z",
        });

        assert(replayResult.kind === "already_applied");
        assert.equal(replayResult.execution.executionId, "exec_test_001");
        assert.equal(replayResult.execution.attemptId, "att_001");

        // Confirm no second journal event was created for the existing execution
        const journalEvents = yield* repo.listJournalEvents("exec_test_001");
        assert.equal(journalEvents.length, 1);
      }),
  );

  it.effect(
    "T20-AC3: concurrent duplicate commands within the same scope create exactly 1 execution without SQL uniqueness error",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const concurrentCommandId = "cmd_concurrent_test_123";

        const attempts = Array.from({ length: 8 }, (_, i) => ({
          ...baseAdmission,
          executionId: `exec_concurrent_${i}`,
          attemptId: `att_concurrent_${i}`,
          commandId: concurrentCommandId,
          now: new Date(Date.now() + i * 100).toISOString(),
        }));

        const results = yield* Effect.all(
          attempts.map((cmd) => repo.recordAdmission(cmd)),
          { concurrency: "unbounded" },
        );

        // Exactly 1 was admitted, others returned already_applied
        const admitted = results.filter((r) => r.kind === "admitted");
        const alreadyApplied = results.filter((r) => r.kind === "already_applied");

        assert.equal(admitted.length, 1);
        assert.equal(alreadyApplied.length, 7);

        const winningExecutionId = admitted[0]!.execution.executionId;
        for (const res of results) {
          assert(res.kind === "admitted" || res.kind === "already_applied");
          assert.equal(res.execution.executionId, winningExecutionId);
        }

        const journal = yield* repo.listJournalEvents(winningExecutionId);
        assert.equal(journal.length, 1);
      }),
  );

  it.effect(
    "T20-AC4: lifecycle redelivery is idempotent and attempt 2 generation 2 restarts its own sequence at 1 (no collision, no stale regression)",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const execId = "exec_lifecycle_001";
        const att1 = "att_001";
        const att2 = "att_002";

        // 1. Admission (attempt 1)
        yield* repo.recordAdmission({
          ...baseAdmission,
          executionId: execId,
          attemptId: att1,
          commandId: "cmd_lifecycle_001",
          state: "accepted",
          now: "2026-08-16T12:00:00.000Z",
        });

        // 2. Lifecycle event: running
        const record1 = yield* repo.recordLifecycleEvent({
          eventId: "evt_running_1",
          executionId: execId,
          attemptId: att1,
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: "2026-08-16T12:00:01.000Z",
        });
        assert.equal(record1.kind, "recorded");
        assert.equal(record1.execution.observedState, "running");

        // 3. Redelivery of running event (idempotency)
        const replayEvent = yield* repo.recordLifecycleEvent({
          eventId: "evt_running_1",
          executionId: execId,
          attemptId: att1,
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: "2026-08-16T12:00:01.000Z",
        });
        assert.equal(replayEvent.kind, "already_applied");
        assert.equal(replayEvent.event.eventId, "evt_running_1");

        // 4. Attempt 1 failed
        yield* repo.recordLifecycleEvent({
          eventId: "evt_failed_1",
          executionId: execId,
          attemptId: att1,
          generation: 1,
          sequence: 3,
          state: "failed",
          occurredAt: "2026-08-16T12:00:02.000Z",
          diagnosticCode: "pi_subagent_admission_rejected",
          diagnosticMessage: "Attempt 1 failed",
        });

        // 5. Future attempt 2 on resume: generation 2, attempt att_002,
        //    sequence 1 — the audit repro: this must be RECORDED, not returned
        //    as attempt 1's sequence-1 already_applied.
        const resumeRecord = yield* repo.recordLifecycleEvent({
          eventId: "evt_running_2",
          executionId: execId,
          attemptId: att2,
          generation: 2,
          sequence: 1,
          state: "running",
          occurredAt: "2026-08-16T12:05:00.000Z",
        });
        assert.equal(resumeRecord.kind, "recorded");
        assert.equal(resumeRecord.execution.attemptId, att2);
        assert.equal(resumeRecord.execution.generation, 2);
        assert.equal(resumeRecord.execution.observedState, "running");

        // 6. Stale-event non-regression: a LATE attempt-1 event must be
        //    journaled as history but must NOT regress the current aggregate.
        const stale = yield* repo.recordLifecycleEvent({
          eventId: "evt_late_att1",
          executionId: execId,
          attemptId: att1,
          generation: 1,
          sequence: 99,
          state: "succeeded",
          occurredAt: "2026-08-16T12:06:00.000Z",
        });
        assert.equal(stale.kind, "recorded");
        assert.equal(stale.execution.attemptId, att2);
        assert.equal(stale.execution.generation, 2);
        assert.equal(stale.execution.observedState, "running");

        const journal = yield* repo.listJournalEvents(execId);
        assert.equal(journal.length, 5);
        // Deterministic journal ordering: generation first, then attempt-local
        // sequence (attempt 1 history, then attempt 2).
        assert.equal(journal[0]!.sequence, 1);
        assert.equal(journal[0]!.attemptId, att1);
        assert.equal(journal[0]!.state, "accepted");
        assert.equal(journal[1]!.sequence, 2);
        assert.equal(journal[1]!.state, "running");
        assert.equal(journal[2]!.sequence, 3);
        assert.equal(journal[2]!.state, "failed");
        assert.equal(journal[3]!.sequence, 99);
        assert.equal(journal[3]!.attemptId, att1);
        assert.equal(journal[3]!.state, "succeeded");
        assert.equal(journal[4]!.sequence, 1);
        assert.equal(journal[4]!.attemptId, att2);
        assert.equal(journal[4]!.generation, 2);
        assert.equal(journal[4]!.state, "running");
      }),
  );

  it.effect(
    "T20-AC2/AC5: same commandId under a different ownership scope fails closed mid-transaction with zero partial rows/events",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;

        // Scope A admits the command.
        const first = yield* repo.recordAdmission({
          ...baseAdmission,
          executionId: "exec_scope_a",
          attemptId: "att_scope_a",
          commandId: "cmd_cross_scope_1",
          commandFingerprint: "fingerprint_scope_a",
          now: "2026-08-16T12:00:00.000Z",
        });
        assert.equal(first.kind, "admitted");

        // Scope B replays the same commandId with a different fingerprint: the
        // journal write succeeds inside the transaction, then the executions
        // INSERT hits the released command_id UNIQUE constraint — the real
        // injected failure BETWEEN the two writes. The transaction must roll
        // back completely: no partial journal event, no duplicate row, and a
        // deterministic command_identity_mismatch (never the other execution's
        // identities).
        const second = yield* repo.recordAdmission({
          ...baseAdmission,
          executionId: "exec_scope_b",
          attemptId: "att_scope_b",
          commandId: "cmd_cross_scope_1",
          commandFingerprint: "fingerprint_scope_b",
          now: "2026-08-16T12:05:00.000Z",
        });
        assert(second.kind === "command_identity_mismatch");
        assert.equal(second.commandId, "cmd_cross_scope_1");

        // Zero partial rows/events: the journal still holds exactly the single
        // sequence-1 event from scope A and the executions table still holds
        // exactly one row.
        const journal = yield* repo.listJournalEvents("exec_scope_a");
        assert.equal(journal.length, 1);
        const scoped = yield* repo.getById("exec_scope_b");
        assert.isTrue(Option.isNone(scoped));
        const byCommand = yield* repo.getByCommandId("cmd_cross_scope_1");
        assert.isTrue(Option.isSome(byCommand));
        if (Option.isSome(byCommand)) {
          assert.equal(byCommand.value.executionId, "exec_scope_a");
        }
      }),
  );

  it.effect("records terminal rejected execution with stable diagnostic", () =>
    Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;

      const rejectAdmission = {
        ...baseAdmission,
        executionId: "exec_rejected_001",
        commandId: "cmd_rejected_001",
        state: "rejected" as const,
        diagnosticCode: "pi_subagent_admission_unauthorized" as const,
        rejectionReason: "Principal is not authorized to spawn subagents in project",
        now: "2026-08-16T12:10:00.000Z",
      };

      const result = yield* repo.recordAdmission(rejectAdmission);
      assert(result.kind === "admitted");
      assert.equal(result.execution.observedState, "rejected");
      assert.equal(result.execution.desiredState, "rejected");
      assert.equal(result.execution.diagnosticCode, "pi_subagent_admission_unauthorized");
      assert.equal(
        result.execution.rejectionReason,
        "Principal is not authorized to spawn subagents in project",
      );

      const journal = yield* repo.listJournalEvents("exec_rejected_001");
      assert.equal(journal.length, 1);
      assert.equal(journal[0]!.state, "rejected");
      assert.equal(journal[0]!.diagnosticCode, "pi_subagent_admission_unauthorized");
    }),
  );

  it.effect("lists executions by parent thread", () =>
    Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;

      const executions = yield* repo.listByThreadId("thread_main");
      assert.isAtLeast(executions.length, 2);
      assert.isTrue(executions.some((e) => e.executionId === "exec_test_001"));
    }),
  );
});

describe("PiSubagentExecutionRepository disk reopen (T20-AC8)", () => {
  it("persists execution aggregate and ordered journal across database reopen", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const NodeServices = await import("@effect/platform-node/NodeServices");
    const { makeSqlitePersistenceLive } = await import("./Sqlite.ts");
    const { SqlClient } = await import("effect/unstable/sql/SqlClient");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "synara-pi-subagent-repo-"));
    const dbPath = path.join(tempDir, "state.sqlite");

    try {
      // Step 1: Open DB on disk, admit an execution, record journal events
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const admission = yield* repo.recordAdmission({
            ...baseAdmission,
            executionId: "exec_disk_001",
            commandId: "cmd_disk_001",
            state: "accepted",
            now: "2026-08-16T12:00:00.000Z",
          });
          expect(admission.kind).toBe("admitted");

          yield* repo.recordLifecycleEvent({
            eventId: "evt_disk_running",
            executionId: "exec_disk_001",
            attemptId: "att_001",
            generation: 1,
            sequence: 2,
            state: "running",
            occurredAt: "2026-08-16T12:00:05.000Z",
          });

          // The durable first-attempt identity is written at admission
          // (migration 100 columns) and survives reopen.
          const sql = yield* SqlClient;
          const rows = yield* sql<{ readonly firstAttemptId: string | null }>`
            SELECT first_attempt_id AS "firstAttemptId"
            FROM pi_subagent_executions
            WHERE execution_id = 'exec_disk_001'
          `;
          expect(rows[0]?.firstAttemptId).toBe("att_001");
        }).pipe(
          Effect.provide(
            PiSubagentExecutionRepositoryLive.pipe(
              Layer.provideMerge(
                makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
              ),
            ),
          ),
        ),
      );

      // Step 2: Reopen DB on disk with fresh connection / repository instance and verify
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;

          const fetched = yield* repo.getById("exec_disk_001");
          expect(Option.isSome(fetched)).toBe(true);
          if (Option.isSome(fetched)) {
            expect(fetched.value.executionId).toBe("exec_disk_001");
            expect(fetched.value.commandId).toBe("cmd_disk_001");
            expect(fetched.value.observedState).toBe("running");
          }

          const journal = yield* repo.listJournalEvents("exec_disk_001");
          expect(journal).toHaveLength(2);
          expect(journal[0]!.sequence).toBe(1);
          expect(journal[0]!.state).toBe("accepted");
          expect(journal[1]!.sequence).toBe(2);
          expect(journal[1]!.state).toBe("running");

          // First-attempt identity survives the reopen on disk.
          const sql = yield* SqlClient;
          const rows = yield* sql<{
            readonly firstAttemptId: string | null;
            readonly firstAttemptGeneration: number | null;
            readonly commandFingerprint: string;
            readonly subject: string | null;
          }>`
            SELECT
              first_attempt_id AS "firstAttemptId",
              first_attempt_generation AS "firstAttemptGeneration",
              command_fingerprint AS "commandFingerprint",
              subject
            FROM pi_subagent_executions
            WHERE execution_id = 'exec_disk_001'
          `;
          expect(rows[0]?.firstAttemptId).toBe("att_001");
          expect(rows[0]?.firstAttemptGeneration).toBe(1);
          expect(rows[0]?.commandFingerprint).toBe("fingerprint_scope_a");
          expect(rows[0]?.subject).toBe("user_456");
        }).pipe(
          Effect.provide(
            PiSubagentExecutionRepositoryLive.pipe(
              Layer.provideMerge(
                makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
              ),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("PiSubagentExecutionRepository observations (Issue 23 / T23-AC3/AC4/AC8)", () => {
  it.layer(PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
    "progress/heartbeat observations and reader",
    (it) => {
      const execId = "exec_t23_obs_001";

      it.effect(
        "recordProgressObservation updates latest snapshot and accumulates dropped counter",
        () =>
          Effect.gen(function* () {
            const repo = yield* PiSubagentExecutionRepository;
            const admission = yield* repo.recordAdmission({
              ...baseAdmission,
              executionId: execId,
              commandId: "cmd_t23_obs_001",
              now: "2026-08-18T00:00:00.000Z",
            });
            assert.equal(admission.kind, "admitted");

            yield* repo.recordProgressObservation({
              executionId: execId,
              progressJson: '{"turnCount":1}',
              occurredAt: "2026-08-18T00:00:01.000Z",
              droppedCountDelta: 0,
            });
            yield* repo.recordProgressObservation({
              executionId: execId,
              progressJson: '{"turnCount":5}',
              occurredAt: "2026-08-18T00:00:02.000Z",
              droppedCountDelta: 3,
            });
            yield* repo.recordProgressObservation({
              executionId: execId,
              progressJson: '{"turnCount":9}',
              occurredAt: "2026-08-18T00:00:03.000Z",
              droppedCountDelta: 7,
            });

            const observationOption = yield* repo.getObservation(execId);
            assert.isTrue(Option.isSome(observationOption));
            if (Option.isSome(observationOption)) {
              const obs = observationOption.value;
              // Latest snapshot wins (trailing edge).
              assert.equal(obs.lastProgressJson, '{"turnCount":9}');
              assert.equal(obs.lastProgressAt, "2026-08-18T00:00:03.000Z");
              assert.equal(obs.droppedProgressCount, 10);
              // Heartbeat columns untouched by progress.
              assert.equal(obs.lastHeartbeatAt, null);
              assert.equal(obs.leaseExpiresAt, null);
            }

            // Desired/observed states are untouched by progress observation.
            const recordOption = yield* repo.getById(execId);
            assert.isTrue(Option.isSome(recordOption));
            if (Option.isSome(recordOption)) {
              assert.equal(recordOption.value.desiredState, "running");
              assert.equal(recordOption.value.observedState, "accepted");
            }

            // No journal rows are created by progress observation.
            const journal = yield* repo.listJournalEvents(execId);
            assert.equal(journal.length, 1);
            assert.equal(journal[0]!.sequence, 1);
            assert.equal(journal[0]!.state, "accepted");
          }),
      );

      it.effect(
        "recordHeartbeatObservation refreshes lease columns without touching progress",
        () =>
          Effect.gen(function* () {
            const repo = yield* PiSubagentExecutionRepository;
            yield* repo.recordHeartbeatObservation({
              executionId: execId,
              occurredAt: "2026-08-18T00:00:10.000Z",
              leaseExpiresAt: "2026-08-18T00:00:40.000Z",
            });
            yield* repo.recordHeartbeatObservation({
              executionId: execId,
              occurredAt: "2026-08-18T00:00:20.000Z",
              leaseExpiresAt: "2026-08-18T00:00:50.000Z",
            });

            const observationOption = yield* repo.getObservation(execId);
            assert.isTrue(Option.isSome(observationOption));
            if (Option.isSome(observationOption)) {
              const obs = observationOption.value;
              assert.equal(obs.lastHeartbeatAt, "2026-08-18T00:00:20.000Z");
              assert.equal(obs.leaseExpiresAt, "2026-08-18T00:00:50.000Z");
              // Progress columns untouched by heartbeat (previous test's data).
              assert.equal(obs.lastProgressJson, '{"turnCount":9}');
              assert.equal(obs.droppedProgressCount, 10);
            }

            // Desired/observed states are untouched by heartbeat observation.
            const recordOption = yield* repo.getById(execId);
            assert.isTrue(Option.isSome(recordOption));
            if (Option.isSome(recordOption)) {
              assert.equal(recordOption.value.desiredState, "running");
              assert.equal(recordOption.value.observedState, "accepted");
            }

            // No journal rows are created by heartbeat observation.
            const journal = yield* repo.listJournalEvents(execId);
            assert.equal(journal.length, 1);
          }),
      );

      it.effect("missing execution produces a defined failure for both observation paths", () =>
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;

          const progressExit = yield* Effect.exit(
            repo.recordProgressObservation({
              executionId: "exec_missing_t23",
              progressJson: "{}",
              occurredAt: "2026-08-18T00:00:00.000Z",
              droppedCountDelta: 0,
            }),
          );
          assert.isTrue(Exit.isFailure(progressExit));

          const heartbeatExit = yield* Effect.exit(
            repo.recordHeartbeatObservation({
              executionId: "exec_missing_t23",
              occurredAt: "2026-08-18T00:00:00.000Z",
              leaseExpiresAt: "2026-08-18T00:00:30.000Z",
            }),
          );
          assert.isTrue(Exit.isFailure(heartbeatExit));

          // Reader returns None for a missing execution.
          const observationOption = yield* repo.getObservation("exec_missing_t23");
          assert.isTrue(Option.isNone(observationOption));
        }),
      );
    },
  );
});

describe("PiSubagentExecutionRepository observation reopen (Issue 23 / T23-AC8)", () => {
  it("file-backed reopen restores latest progress + lease observation without intermediate history", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "synara-t23-obs-reopen-"));
    const dbPath = path.join(tempDir, "state.sqlite");
    const execId = "exec_t23_reopen_001";

    const fileLayer = PiSubagentExecutionRepositoryLive.pipe(
      Layer.provideMerge(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    );

    try {
      // Phase 1: write admission, then multiple progress + heartbeat
      // observations (intermediate snapshots must NOT be preserved as rows).
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const admission = yield* repo.recordAdmission({
            ...baseAdmission,
            executionId: execId,
            commandId: "cmd_t23_reopen_001",
            now: "2026-08-18T00:00:00.000Z",
          });
          expect(admission.kind).toBe("admitted");

          yield* repo.recordProgressObservation({
            executionId: execId,
            progressJson: '{"turnCount":1,"activity":"planning"}',
            occurredAt: "2026-08-18T00:00:01.000Z",
            droppedCountDelta: 0,
          });
          yield* repo.recordProgressObservation({
            executionId: execId,
            progressJson: '{"turnCount":4,"activity":"researching"}',
            occurredAt: "2026-08-18T00:00:02.000Z",
            droppedCountDelta: 5,
          });
          yield* repo.recordProgressObservation({
            executionId: execId,
            progressJson: '{"turnCount":9,"activity":"writing"}',
            occurredAt: "2026-08-18T00:00:03.000Z",
            droppedCountDelta: 11,
          });
          yield* repo.recordHeartbeatObservation({
            executionId: execId,
            occurredAt: "2026-08-18T00:00:10.000Z",
            leaseExpiresAt: "2026-08-18T00:00:40.000Z",
          });
          yield* repo.recordHeartbeatObservation({
            executionId: execId,
            occurredAt: "2026-08-18T00:00:20.000Z",
            leaseExpiresAt: "2026-08-18T00:00:50.000Z",
          });
        }).pipe(Effect.provide(fileLayer)),
      );

      // Phase 2: reopen from disk with a fresh layer; only the LATEST
      // observation survives — no intermediate progress history exists.
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const sql = yield* SqlClient.SqlClient;

          const observationOption = yield* repo.getObservation(execId);
          expect(Option.isSome(observationOption)).toBe(true);
          if (Option.isSome(observationOption)) {
            const obs = observationOption.value;
            expect(obs.lastProgressJson).toBe('{"turnCount":9,"activity":"writing"}');
            expect(obs.lastProgressAt).toBe("2026-08-18T00:00:03.000Z");
            expect(obs.droppedProgressCount).toBe(16);
            expect(obs.lastHeartbeatAt).toBe("2026-08-18T00:00:20.000Z");
            expect(obs.leaseExpiresAt).toBe("2026-08-18T00:00:50.000Z");
          }

          // The aggregate states are unchanged from admission (accepted /
          // running-desired) — observation never mutated control truth.
          const recordOption = yield* repo.getById(execId);
          expect(Option.isSome(recordOption)).toBe(true);
          if (Option.isSome(recordOption)) {
            expect(recordOption.value.observedState).toBe("accepted");
            expect(recordOption.value.desiredState).toBe("running");
          }

          // No durable intermediate progress history: the journal holds only
          // the admission event.
          const journal = yield* repo.listJournalEvents(execId);
          expect(journal).toHaveLength(1);
          expect(journal[0]!.sequence).toBe(1);

          // Raw on-disk column verification (migration 099 surface).
          const rows = yield* sql<{
            readonly last_progress_json: string | null;
            readonly last_progress_at: string | null;
            readonly dropped_progress_count: number;
            readonly last_heartbeat_at: string | null;
            readonly lease_expires_at: string | null;
          }>`
            SELECT
              last_progress_json,
              last_progress_at,
              dropped_progress_count,
              last_heartbeat_at,
              lease_expires_at
            FROM pi_subagent_executions
            WHERE execution_id = ${execId}
          `;
          expect(rows).toHaveLength(1);
          expect(rows[0]!.last_progress_json).toBe('{"turnCount":9,"activity":"writing"}');
          expect(rows[0]!.dropped_progress_count).toBe(16);
          expect(rows[0]!.lease_expires_at).toBe("2026-08-18T00:00:50.000Z");
        }).pipe(Effect.provide(fileLayer)),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ticket 13: wall-time expiry trigger (T13-AC3)
// ─────────────────────────────────────────────────────────────────────

describe("PiSubagentExecutionRepository wall-time expiry trigger (Issue 13 / T13-AC3)", () => {
  it.layer(PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
    "records journal-only band-60 expiry without settling the aggregate",
    (it) => {
      it.effect("records expiry trigger leaving observed state untouched", () =>
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;

          const admission = yield* repo.recordAdmission({
            ...baseAdmission,
            executionId: "exec_walltime_001",
            attemptId: "att_walltime_001",
            commandId: "cmd_walltime_001",
            now: "2026-08-18T10:00:00.000Z",
          });
          expect(admission.kind).toBe("admitted");

          const result = yield* repo.recordWallTimeExpiryEvent({
            executionId: "exec_walltime_001",
            attemptId: "att_walltime_001",
            generation: 1,
            occurredAt: "2026-08-18T12:00:00.000Z",
            wallTimeMs: 7200000,
          });
          expect(result.kind).toBe("recorded");
          expect(result.execution.observedState).toBe("accepted");
          expect(result.execution.generation).toBe(1);

          // Aggregate untouched: no projection settlement (T13-AC3).
          const fetched = yield* repo.getById("exec_walltime_001");
          expect(Option.isSome(fetched)).toBe(true);
          if (Option.isSome(fetched)) {
            expect(fetched.value.observedState).toBe("accepted");
            expect(fetched.value.desiredState).toBe("running");
            expect(fetched.value.generation).toBe(1);
          }

          const journal = yield* repo.listJournalEvents("exec_walltime_001");
          expect(journal).toHaveLength(2);
          expect(journal[1]!.sequence).toBe(60);
          expect(journal[1]!.diagnosticCode).toBe("pi_subagent_walltime_expired");
          expect(journal[1]!.state).toBe("accepted");

          // Idempotent replay: already_applied, no second journal row.
          const replay = yield* repo.recordWallTimeExpiryEvent({
            executionId: "exec_walltime_001",
            attemptId: "att_walltime_001",
            generation: 1,
            occurredAt: "2026-08-18T12:00:01.000Z",
            wallTimeMs: 7200000,
          });
          expect(replay.kind).toBe("already_applied");
          const journalAfterReplay = yield* repo.listJournalEvents("exec_walltime_001");
          expect(journalAfterReplay).toHaveLength(2);
        }),
      );

      it.effect(
        "never fires a stale expiry for a superseded generation and never for terminals",
        () =>
          Effect.gen(function* () {
            const repo = yield* PiSubagentExecutionRepository;

            const admission = yield* repo.recordAdmission({
              ...baseAdmission,
              executionId: "exec_walltime_002",
              attemptId: "att_walltime_002",
              commandId: "cmd_walltime_002",
              now: "2026-08-18T10:00:00.000Z",
            });
            expect(admission.kind).toBe("admitted");

            // Generation advanced by reconciliation (orphan fence +1).
            const orphaned = yield* repo.recordOrphanedEvent({
              executionId: "exec_walltime_002",
              attemptId: "att_walltime_002",
              generation: 1,
              occurredAt: "2026-08-18T10:30:00.000Z",
              diagnosticCode: "pi_subagent_owner_loss_orphaned",
              diagnosticMessage: "owner lost",
            });
            expect(orphaned.kind).toBe("recorded");

            const stale = yield* repo.recordWallTimeExpiryEvent({
              executionId: "exec_walltime_002",
              attemptId: "att_walltime_002",
              generation: 1,
              occurredAt: "2026-08-18T12:00:00.000Z",
              wallTimeMs: 7200000,
            });
            expect(stale.kind).toBe("stale_generation");
            const journal = yield* repo.listJournalEvents("exec_walltime_002");
            expect(journal.every((event) => event.sequence !== 60)).toBe(true);

            // Terminal aggregates never receive an expiry trigger.
            yield* repo.recordAdmission({
              ...baseAdmission,
              executionId: "exec_walltime_003",
              attemptId: "att_walltime_003",
              commandId: "cmd_walltime_003",
              now: "2026-08-18T10:00:00.000Z",
            });
            yield* repo.recordTerminalEvent({
              executionId: "exec_walltime_003",
              attemptId: "att_walltime_003",
              generation: 1,
              sequence: 40,
              state: "succeeded",
              occurredAt: "2026-08-18T10:05:00.000Z",
              summary: "done",
            });
            const terminalGuard = yield* repo.recordWallTimeExpiryEvent({
              executionId: "exec_walltime_003",
              attemptId: "att_walltime_003",
              generation: 1,
              occurredAt: "2026-08-18T12:00:00.000Z",
              wallTimeMs: 7200000,
            });
            expect(terminalGuard.kind).toBe("already_applied");
          }),
      );
    },
  );
});

describe("PiSubagentExecutionRepository operator telemetry (Issue 13 / T13-AC4)", () => {
  it.layer(PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
    "derives bounded counts, timing summaries, progress, lease, and retry metrics",
    (it) => {
      it.effect("returns the approved serverGetDiagnostics metrics mapping", () =>
        Effect.gen(function* () {
          const repository = yield* PiSubagentExecutionRepository;
          const sql = yield* SqlClient.SqlClient;
          const executions = [
            ["exec_metrics_active_1", "accepted", 12, "2026-08-18T11:00:00.000Z"],
            ["exec_metrics_active_2", "running", 0, "2026-08-18T13:00:00.000Z"],
            ["exec_metrics_active_3", "requested", 0, null],
            ["exec_metrics_queued", "queued", 0, null],
            ["exec_metrics_cancelling", "cancelling", 0, null],
            ["exec_metrics_orphaned", "orphaned", 0, null],
            ["exec_metrics_cancelled", "cancelled", 0, null],
            ["exec_metrics_succeeded", "succeeded", 0, null],
            ["exec_metrics_failed", "failed", 0, null],
            ["exec_metrics_rejected", "rejected", 0, null],
          ] as const;

          for (const [executionId, state, droppedProgressCount, leaseExpiresAt] of executions) {
            yield* sql`
              INSERT INTO pi_subagent_executions (
                execution_id, attempt_id, generation, command_id, project_id,
                parent_thread_id, parent_turn_id, parent_tool_call_id, agent_type,
                prompt, mode, cancellation_scope, desired_state, observed_state,
                created_at, updated_at, dropped_progress_count, lease_expires_at
              ) VALUES (
                ${executionId}, ${`att_${executionId}`}, 1, ${`cmd_${executionId}`},
                'proj_metrics', 'thread_metrics', 'turn_metrics', 'call_metrics',
                'researcher', 'never emitted by telemetry', 'foreground',
                'parent_turn', ${state}, ${state},
                '2026-08-18T10:00:00.000Z', '2026-08-18T10:00:00.000Z',
                ${droppedProgressCount}, ${leaseExpiresAt}
              )
            `;
          }

          const journalEvents = [
            [
              "evt_detach_1_admit",
              "exec_metrics_active_1",
              1,
              "accepted",
              "2026-08-18T10:00:00.000Z",
              null,
            ],
            [
              "evt_detach_1",
              "exec_metrics_active_1",
              3,
              "running",
              "2026-08-18T10:00:00.250Z",
              '{"phase":"detached"}',
            ],
            [
              "evt_detach_2_admit",
              "exec_metrics_active_2",
              1,
              "accepted",
              "2026-08-18T10:00:01.000Z",
              null,
            ],
            [
              "evt_detach_2",
              "exec_metrics_active_2",
              3,
              "running",
              "2026-08-18T10:00:02.000Z",
              '{"phase":"detached"}',
            ],
            [
              "evt_cancel_1_intent",
              "exec_metrics_cancelled",
              10,
              "cancelling",
              "2026-08-18T10:00:03.000Z",
              '{"phase":"cancelling"}',
            ],
            [
              "evt_cancel_1_done",
              "exec_metrics_cancelled",
              20,
              "cancelled",
              "2026-08-18T10:00:03.400Z",
              '{"phase":"cancelled"}',
            ],
            [
              "evt_cancel_2_intent",
              "exec_metrics_succeeded",
              10,
              "cancelling",
              "2026-08-18T10:00:04.000Z",
              '{"phase":"cancelling"}',
            ],
            [
              "evt_cancel_2_done",
              "exec_metrics_succeeded",
              40,
              "succeeded",
              "2026-08-18T10:00:05.200Z",
              null,
            ],
          ] as const;
          for (const [
            eventId,
            executionId,
            sequence,
            state,
            occurredAt,
            metadataJson,
          ] of journalEvents) {
            yield* sql`
              INSERT INTO pi_subagent_lifecycle_journal (
                event_id, execution_id, attempt_id, generation, sequence, state,
                occurred_at, metadata_json
              ) VALUES (
                ${eventId}, ${executionId}, ${`att_${executionId}`}, 1, ${sequence},
                ${state}, ${occurredAt}, ${metadataJson}
              )
            `;
          }

          for (const [outboxId, executionId, attemptCount] of [
            ["outbox_metrics_1", "exec_metrics_succeeded", 2],
            ["outbox_metrics_2", "exec_metrics_failed", 3],
          ] as const) {
            yield* sql`
              INSERT INTO pi_subagent_completion_outbox (
                outbox_id, execution_id, attempt_id, generation, terminal_event_id,
                parent_thread_id, delivery_state, terminal_state, summary,
                attempt_count, created_at, updated_at
              ) VALUES (
                ${outboxId}, ${executionId}, ${`att_${executionId}`}, 1,
                ${`terminal_${executionId}`}, 'thread_metrics', 'failed_retryable',
                'failed', 'bounded summary', ${attemptCount},
                '2026-08-18T10:00:00.000Z', '2026-08-18T10:00:00.000Z'
              )
            `;
          }

          const snapshot = yield* repository.getTelemetrySnapshot("2026-08-18T12:00:00.000Z");
          expect(snapshot).toEqual({
            executionCounts: {
              active: 3,
              queued: 1,
              cancelling: 1,
              orphaned: 1,
              terminal: 4,
            },
            leaseExpiryCount: 1,
            detachLatencyMs: { p50: 250, p95: 1_000, max: 1_000 },
            cancelLatencyMs: { p50: 400, p95: 1_200, max: 1_200 },
            progress: { coalesced: 12, dropped: 12 },
            completionRetries: 5,
          });
        }),
      );
    },
  );
});
