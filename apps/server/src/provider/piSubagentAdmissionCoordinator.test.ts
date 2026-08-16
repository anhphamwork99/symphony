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
import { makePiSubagentControlHealth } from "./piSubagentControlHealth.ts";

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

describe("Pi subagent trusted authority verification (T20-AC5)", () => {
  it("rejects when trusted provider is not pi (T20-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          trustedProvider: "codex",
        },
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_provider_mismatch");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when subject authority credentials have expired (T20-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          mcpAuthority: {
            subject: "user_456",
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        },
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("Subject authority credentials have expired");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when extension command parentThreadId attempts to hijack a different thread (T20-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, parentThreadId: "thread_hijacked" as ThreadId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          trustedThreadId: "thread_main",
        },
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("Thread authorization mismatch");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when extension command projectId mismatches server-minted trusted project context (T20-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, projectId: "proj_attacker" as ProjectId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          trustedProjectId: "proj_default",
        },
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_project_mismatch");
      expect(result.rejectionReason).toContain("Project authorization mismatch");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when extension command parentTurnId mismatches server-minted trusted active turn context (T20-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, parentTurnId: "turn_forged" as TurnId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          trustedActiveTurnId: "turn_001",
        },
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_active_turn_required");
      expect(result.rejectionReason).toContain("Active turn mismatch");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("rejects when approval is required but not granted (T20-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          approvalRequired: true,
          approvalGranted: false,
        },
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("requires approval");
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

describe("Pi subagent admission fails closed (Ticket 03: T03-AC1, T03-AC2, T03-AC3, T03-AC4, T03-AC5, T03-AC6)", () => {
  it("T03-AC1, T03-AC2: failure to persist lifecycle fails closed with stable lifecycle persistence diagnostic and projects no accepted/running execution", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;

      // Injected store fault: repository that fails on recordAdmission
      const failingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: () =>
          Effect.fail({
            _tag: "PersistenceSqlError",
            cause: new Error("Simulated SQLite disk I/O error"),
            operation: "recordAdmission",
          } as any),
      };

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        now: "2026-08-16T12:00:00.000Z",
      });

      // T03-AC1: fails closed with stable diagnostic
      expect(result.status).toBe("rejected");
      expect(result.state).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(result.rejectionReason).toContain("Failed to persist execution lifecycle truth");

      // T03-AC2: No execution is projected as accepted or running in the store
      const stored = yield* liveRepo.getByCommandId("cmd_spawn_001");
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

  it("T03-AC3: managed control health becomes degraded upon persistence failure and subsequent admissions fail closed", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();

      const initialHealth = yield* controlHealth.getHealth();
      expect(initialHealth.status).toBe("available");

      // Store fault on first admission
      const failingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: () =>
          Effect.fail({
            _tag: "PersistenceSqlError",
            cause: new Error("Disk full"),
            operation: "recordAdmission",
          } as any),
      };

      const firstResult = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(firstResult.status).toBe("rejected");
      expect(firstResult.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // Verify control health is now degraded
      const degradedHealth = yield* controlHealth.getHealth();
      expect(degradedHealth.status).toBe("degraded");
      expect(degradedHealth.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // Subsequent admission fails closed immediately while health remains degraded
      const secondCommand: PiSubagentSpawnCommand = {
        ...validCommand,
        commandId: "cmd_spawn_002",
      };

      const secondResult = yield* admitSubagentSpawn({
        command: secondCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: liveRepo, // even with liveRepo, control health gate rejects
        controlHealth,
        now: "2026-08-16T12:01:00.000Z",
      });

      expect(secondResult.status).toBe("rejected");
      expect(secondResult.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(secondResult.rejectionReason).toContain("Failed to persist execution lifecycle truth");

      // No execution for command 2 in the database
      const stored = yield* liveRepo.getByCommandId("cmd_spawn_002");
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

  it("T03-AC4: existing execution records and terminal truth are not deleted, rewritten, or misreported by admission degradation", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();

      // 1. Durably record existing execution 1
      const initialResult = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: liveRepo,
        controlHealth,
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(initialResult.status).toBe("accepted");

      const existingRecord = yield* liveRepo.getById(initialResult.executionId);
      expect(Option.isSome(existingRecord)).toBe(true);

      // 2. Introduce store fault for a second execution
      const failingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: () =>
          Effect.fail({
            _tag: "PersistenceSqlError",
            cause: new Error("Store connection lost"),
            operation: "recordAdmission",
          } as any),
      };

      const failingCommand: PiSubagentSpawnCommand = {
        ...validCommand,
        commandId: "cmd_spawn_failing",
      };

      const failedResult = yield* admitSubagentSpawn({
        command: failingCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        now: "2026-08-16T12:02:00.000Z",
      });
      expect(failedResult.status).toBe("rejected");

      // 3. Verify existing execution 1 is intact and completely unaffected
      const afterRecord = yield* liveRepo.getById(initialResult.executionId);
      expect(Option.isSome(afterRecord)).toBe(true);
      if (Option.isSome(afterRecord)) {
        expect(afterRecord.value.executionId).toBe(initialResult.executionId);
        expect(afterRecord.value.observedState).toBe("accepted");
        expect(afterRecord.value.commandId).toBe("cmd_spawn_001");
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

  it("T03-AC5: once durable writes recover, health returns to available and a new command can be admitted without replaying rejected work", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();

      // Degrade health
      yield* controlHealth.markDegraded(
        "Temporary DB lock",
        "pi_subagent_lifecycle_persistence_failed",
      );

      // Admission during degradation fails closed
      const rejectedCommand: PiSubagentSpawnCommand = {
        ...validCommand,
        commandId: "cmd_during_outage",
      };
      const rejectedResult = yield* admitSubagentSpawn({
        command: rejectedCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: liveRepo,
        controlHealth,
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(rejectedResult.status).toBe("rejected");

      // Recover health
      yield* controlHealth.markAvailable();
      const currentHealth = yield* controlHealth.getHealth();
      expect(currentHealth.status).toBe("available");

      // Admit fresh command after recovery
      const freshCommand: PiSubagentSpawnCommand = {
        ...validCommand,
        commandId: "cmd_after_recovery",
      };
      const freshResult = yield* admitSubagentSpawn({
        command: freshCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: liveRepo,
        controlHealth,
        now: "2026-08-16T12:05:00.000Z",
      });
      expect(freshResult.status).toBe("accepted");
      expect(freshResult.executionId).toBeDefined();

      // Prior rejected command was not admitted / replayed
      const rejectedStored = yield* liveRepo.getByCommandId("cmd_during_outage");
      expect(Option.isNone(rejectedStored)).toBe(true);

      // Only the fresh command exists
      const all = yield* liveRepo.listByThreadId("thread_main");
      expect(all.length).toBe(1);
      expect(all[0]!.commandId).toBe("cmd_after_recovery");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        ),
      ),
    );
  });

  it("T03-AC6: legacy Pi behavior remains available according to negotiated capability policy and is never mislabeled managed", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth({
        status: "degraded",
        diagnosticCode: "pi_subagent_control_degraded",
      });

      // Legacy capability session
      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: unmanagedCapability,
        snapshotQuery,
        repository: liveRepo,
        controlHealth,
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
      expect(result.rejectionReason).toContain("Legacy session");

      // Nothing written to repository
      const stored = yield* liveRepo.getByCommandId("cmd_spawn_001");
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
});

