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

  it.effect("T20-AC3: replaying commandId returns already_applied and creates no duplicate", () =>
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

  it.effect("T20-AC3: concurrent duplicate commands create exactly 1 execution without SQL uniqueness error", () =>
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

  it.effect("T20-AC4: lifecycle redelivery is idempotent and future attempt advances state cleanly", () =>
    Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const execId = "exec_lifecycle_001";
      const att1 = "att_001";
      const att2 = "att_002";

      // 1. Admission
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

      // 5. Future attempt 2 on resume: generation 2, attempt att_002, sequence 4
      const resumeRecord = yield* repo.recordLifecycleEvent({
        eventId: "evt_running_2",
        executionId: execId,
        attemptId: att2,
        generation: 2,
        sequence: 4,
        state: "running",
        occurredAt: "2026-08-16T12:05:00.000Z",
      });
      assert.equal(resumeRecord.kind, "recorded");
      assert.equal(resumeRecord.execution.attemptId, att2);
      assert.equal(resumeRecord.execution.generation, 2);
      assert.equal(resumeRecord.execution.observedState, "running");

      const journal = yield* repo.listJournalEvents(execId);
      assert.equal(journal.length, 4);
      assert.equal(journal[0]!.sequence, 1);
      assert.equal(journal[0]!.state, "accepted");
      assert.equal(journal[1]!.sequence, 2);
      assert.equal(journal[1]!.state, "running");
      assert.equal(journal[2]!.sequence, 3);
      assert.equal(journal[2]!.state, "failed");
      assert.equal(journal[3]!.sequence, 4);
      assert.equal(journal[3]!.state, "running");
      assert.equal(journal[3]!.attemptId, att2);
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
