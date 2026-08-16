import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { describe, expect } from "vitest";

import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
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
      assert.equal(result.kind, "admitted");
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

  it.effect("T20-AC3: replaying commandId within the same ownership scope returns already_applied and creates no duplicate", () =>
    Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;

      const replayResult = yield* repo.recordAdmission({
        ...baseAdmission,
        executionId: "exec_test_should_not_overwrite",
        attemptId: "att_002",
        now: "2026-08-16T12:05:00.000Z",
      });

      assert.equal(replayResult.kind, "already_applied");
      assert.equal(replayResult.execution.executionId, "exec_test_001");
      assert.equal(replayResult.execution.attemptId, "att_001");

      // Confirm no second journal event was created for the existing execution
      const journalEvents = yield* repo.listJournalEvents("exec_test_001");
      assert.equal(journalEvents.length, 1);
    }),
  );

  it.effect("T20-AC3: concurrent duplicate commands within the same scope create exactly 1 execution without SQL uniqueness error", () =>
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
        assert.equal(res.execution.executionId, winningExecutionId);
      }

      const journal = yield* repo.listJournalEvents(winningExecutionId);
      assert.equal(journal.length, 1);
    }),
  );

  it.effect("T20-AC4: lifecycle redelivery is idempotent and attempt 2 generation 2 restarts its own sequence at 1 (no collision, no stale regression)", () =>
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

  it.effect("T20-AC2/AC5: same commandId under a different ownership scope fails closed mid-transaction with zero partial rows/events", () =>
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
      assert.equal(second.kind, "command_identity_mismatch");
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
      assert.equal(result.kind, "admitted");
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
