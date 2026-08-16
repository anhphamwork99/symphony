import { describe, expect, it } from "vitest";
import { Effect, Layer, Option } from "effect";

import type {
  OrchestrationReadModel,
  PiSubagentNegotiatedCapability,
  PiSubagentSpawnCommand,
  ProjectId,
  ThreadId,
  TurnId,
} from "@synara/contracts";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import {
  admitSubagentSpawn,
  type AdmissionSnapshotQuery,
} from "./piSubagentAdmissionCoordinator.ts";

function createMockSnapshotQuery(threads: OrchestrationReadModel["threads"] = []): AdmissionSnapshotQuery {
  return {
    getSnapshot: () =>
      Effect.succeed({
        threads,
        projects: [],
        spaces: [],
      } as unknown as OrchestrationReadModel),
  };
}

const managedCapability: PiSubagentNegotiatedCapability = {
  status: "managed_enabled",
  diagnosticCode: "pi_subagent_managed_enabled",
  isManaged: true,
  protocolVersion: 1,
  capabilities: ["managed-spawn", "abort-propagation"],
  extensionVersion: "0.1.0",
};

const unmanagedCapability: PiSubagentNegotiatedCapability = {
  status: "bridge_absent",
  diagnosticCode: "pi_subagent_bridge_absent",
  isManaged: false,
  diagnosticMessage: "Legacy session",
};

const validThread = {
  id: "thread_main" as ThreadId,
  projectId: "proj_default" as ProjectId,
  archivedAt: null,
  session: {
    status: "running" as const,
    activeTurnId: "turn_001" as TurnId,
  },
  latestTurn: {
    id: "turn_001" as TurnId,
    state: "running" as const,
  },
} as unknown as OrchestrationReadModel["threads"][number];

const validCommand: PiSubagentSpawnCommand = {
  commandId: "cmd_spawn_001",
  projectId: "proj_default" as ProjectId,
  parentThreadId: "thread_main" as ThreadId,
  parentTurnId: "turn_001" as TurnId,
  parentToolCallId: "call_tool_1",
  agentType: "researcher",
  prompt: "Investigate performance bottleneck",
  mode: "foreground",
  cancellationScope: "parent_turn",
};

describe("Pi subagent admission coordinator (T02-AC1, T02-AC3, T02-AC4, T02-AC5)", () => {
  it("admits authorized spawn in managed session and durably records accepted state (T02-AC1, T02-AC3)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("accepted");
      expect(result.executionId).toBeDefined();
      expect(result.attemptId).toBeDefined();
      expect(result.generation).toBe(1);
      expect(result.state).toBe("accepted");
      expect(result.diagnosticCode).toBe("pi_subagent_managed_enabled");

      // Verify it is durable in repository before any child can start
      const stored = yield* repository.getById(result.executionId);
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("accepted");
        expect(stored.value.commandId).toBe("cmd_spawn_001");
      }
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects unmanaged session without creating execution (T02-AC6)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: unmanagedCapability,
        snapshotQuery,
        repository,
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");

      // No execution in repository
      const stored = yield* repository.getByCommandId("cmd_spawn_001");
      expect(Option.isNone(stored)).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects unauthorized caller when thread is not found (T02-AC4)", async () => {
    const snapshotQuery = createMockSnapshotQuery([]); // no threads

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("not found");

      // Rejected execution is durably recorded with terminal state
      const stored = yield* repository.getByCommandId("cmd_spawn_001");
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("rejected");
        expect(stored.value.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      }
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when project does not match thread (T02-AC4)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, projectId: "proj_other" as ProjectId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_project_mismatch");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when thread has no matching active turn (T02-AC4)", async () => {
    const threadWithoutTurn = {
      ...validThread,
      session: { status: "idle" as const, activeTurnId: null },
      latestTurn: null,
    } as unknown as OrchestrationReadModel["threads"][number];
    const snapshotQuery = createMockSnapshotQuery([threadWithoutTurn]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_active_turn_required");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("replaying command identity returns already-applied without creating duplicate execution (T02-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const firstResult = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(firstResult.status).toBe("accepted");

      const secondResult = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        now: "2026-08-16T12:01:00.000Z",
      });

      expect(secondResult.status).toBe("already_applied");
      expect(secondResult.executionId).toBe(firstResult.executionId);
      expect(secondResult.attemptId).toBe(firstResult.attemptId);
      expect(secondResult.diagnosticCode).toBe("pi_subagent_already_applied");

      // Verify only 1 execution exists in repository
      const allExecutions = yield* repository.listByThreadId("thread_main");
      expect(allExecutions.length).toBe(1);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });
});
