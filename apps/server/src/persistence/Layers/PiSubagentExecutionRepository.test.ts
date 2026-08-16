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

layer("PiSubagentExecutionRepository (T02-AC1, T02-AC3, T02-AC5)", (it) => {
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

  it.effect("replaying commandId returns already_applied and creates no duplicate", () =>
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
