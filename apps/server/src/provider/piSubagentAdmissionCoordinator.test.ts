import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";

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
  makeMcpSessionAuthorityRegistry,
  type McpAuthorityBinding,
} from "../agentGateway/mcpSessionAuthority.ts";
import {
  admitSubagentSpawn,
  type AdmissionSnapshotQuery,
  type TrustedAdmissionContext,
} from "./piSubagentAdmissionCoordinator.ts";
import { makePiSubagentControlHealth } from "./piSubagentControlHealth.ts";

function createMockSnapshotQuery(
  threads: OrchestrationReadModel["threads"] = [],
): AdmissionSnapshotQuery {
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
  runtimeMode: "full-access" as const,
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

// ── Real Decision-21 authority registry (makeMcpSessionAuthorityRegistry) ──

function makeAuthorityFixture(
  overrides: {
    readonly subject?: string;
    readonly authExpiresAt?: number | null;
    readonly credentialTtlMs?: number;
    readonly projectId?: string | null;
  } = {},
) {
  const registry = makeMcpSessionAuthorityRegistry();
  const record = registry.mint({
    subject: overrides.subject ?? "user_456",
    kind: "authenticated",
    authSessionId: "auth-session-1",
    authExpiresAt: overrides.authExpiresAt ?? null,
  });
  const binding = registry.bindingFor(record.authorityId, {
    threadId: "thread_main",
    provider: "pi",
    projectId: overrides.projectId ?? "proj_default",
    lifecycleGeneration: null,
    credentialTtlMs: overrides.credentialTtlMs ?? 60 * 60 * 1_000,
  })!;
  return { registry, record, binding };
}

function makeTrustedContext(binding: McpAuthorityBinding | null): TrustedAdmissionContext {
  return {
    trustedThreadId: "thread_main" as ThreadId,
    trustedProjectId: "proj_default" as ProjectId,
    trustedActiveTurnId: "turn_001" as TurnId,
    trustedProvider: "pi",
    mcpAuthority: binding,
  };
}

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

describe("Pi subagent admission coordinator (T02-AC1, T02-AC3, T02-AC4, T02-AC5)", () => {
  it("admits authorized spawn in managed session and durably records accepted state (T02-AC1, T02-AC3)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("accepted");
      expect(result.executionId).toMatch(/^exec_/);
      expect(result.attemptId).toMatch(/^att_/);
      expect(result.generation).toBe(1);

      const stored = yield* repository.getById(result.executionId);
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("accepted");
        expect(stored.value.desiredState).toBe("running");
        expect(stored.value.commandId).toBe("cmd_spawn_001");
      }

      const journal = yield* repository.listJournalEvents(result.executionId);
      expect(journal).toHaveLength(1);
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[0]!.state).toBe("accepted");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects unmanaged session without creating execution (T02-AC6)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: unmanagedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
      const stored = yield* repository.getByCommandId("cmd_spawn_001");
      expect(Option.isNone(stored)).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects unauthorized caller when thread is not found (T02-AC4)", async () => {
    const snapshotQuery = createMockSnapshotQuery([]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("not found in server projection");

      // Rejected truth is durably recorded (sequence 1, rejected)
      const stored = yield* repository.getById(result.executionId);
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("rejected");
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when project does not match thread (T02-AC4)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, projectId: "proj_attacker" as ProjectId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_project_mismatch");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when thread has no matching active turn (T02-AC4)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, parentTurnId: "turn_stale" as TurnId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_active_turn_required");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("replaying command identity returns already-applied without creating duplicate execution (T02-AC5)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const first = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(first.status).toBe("accepted");

      const replay = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:05:00.000Z",
      });

      expect(replay.status).toBe("already_applied");
      expect(replay.executionId).toBe(first.executionId);
      expect(replay.attemptId).toBe(first.attemptId);

      const journal = yield* repository.listJournalEvents(first.executionId);
      expect(journal).toHaveLength(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});

describe("Pi subagent trusted authority verification (T20-AC5)", () => {
  it("rejects when trusted provider is not pi (T20-AC5 provider)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: { ...makeTrustedContext(binding), trustedProvider: "codex" },
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_provider_mismatch");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when no server-minted subject authority binding exists (T20-AC5 missing-binding)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(null),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("missing-binding");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when the authority registry is unavailable (T20-AC5 fail-closed)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("registry is unavailable");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects an unknown-authority binding (minted by a different registry) (T20-AC5 unknown-authority)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { binding } = makeAuthorityFixture();
    const otherRegistry = makeMcpSessionAuthorityRegistry();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: otherRegistry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("unknown-authority");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects a revoked authority (T20-AC5 revoked)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, record, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      registry.revoke(record.authorityId, "user signed out");

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("revoked");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects an expired authentication (T20-AC5 expired-auth)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    // Auth expires in the past → bindingFor refuses to mint (null), so build
    // the binding snapshot directly to prove admission rejects expired-auth.
    const registry = makeMcpSessionAuthorityRegistry();
    const record = registry.mint({
      subject: "user_456",
      kind: "authenticated",
      authSessionId: "auth-session-1",
      authExpiresAt: Date.now() - 60_000,
    });
    const binding: McpAuthorityBinding = {
      authorityId: record.authorityId,
      subject: record.subject,
      kind: record.kind,
      authSessionId: record.authSessionId,
      authExpiresAt: record.authExpiresAt,
      issuedAt: record.issuedAt,
      credentialExpiresAt: Date.now() + 60_000,
      sessionGeneration: record.sessionGeneration,
      lifecycleGeneration: null,
      projectId: "proj_default",
    };

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("expired-auth");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects an expired credential (T20-AC5 expired-credential)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const registry = makeMcpSessionAuthorityRegistry();
    const record = registry.mint({
      subject: "user_456",
      kind: "authenticated",
      authSessionId: "auth-session-1",
      authExpiresAt: null,
    });
    const binding: McpAuthorityBinding = {
      authorityId: record.authorityId,
      subject: record.subject,
      kind: record.kind,
      authSessionId: record.authSessionId,
      authExpiresAt: null,
      issuedAt: record.issuedAt,
      credentialExpiresAt: Date.now() - 1_000,
      sessionGeneration: record.sessionGeneration,
      lifecycleGeneration: null,
      projectId: "proj_default",
    };

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("expired-credential");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects a stale session-generation binding (T20-AC5 stale-session-generation)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const registry = makeMcpSessionAuthorityRegistry();
    const record = registry.mint({
      subject: "user_456",
      kind: "authenticated",
      authSessionId: "auth-session-1",
      authExpiresAt: null,
    });
    const binding: McpAuthorityBinding = {
      authorityId: record.authorityId,
      subject: record.subject,
      kind: record.kind,
      authSessionId: record.authSessionId,
      authExpiresAt: null,
      issuedAt: record.issuedAt,
      credentialExpiresAt: Date.now() + 60_000,
      sessionGeneration: "stale-gen-other",
      lifecycleGeneration: null,
      projectId: "proj_default",
    };

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("stale-session-generation");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects a subject-mismatched binding (T20-AC5 subject-mismatch)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { binding } = makeAuthorityFixture();

    const registry = makeMcpSessionAuthorityRegistry();
    const other = registry.mint({
      subject: "user_other",
      kind: "authenticated",
      authSessionId: "auth-session-1",
      authExpiresAt: null,
    });
    const mismatchedBinding: McpAuthorityBinding = {
      ...binding,
      authorityId: other.authorityId,
      subject: "attacker-subject",
      sessionGeneration: other.sessionGeneration,
      authSessionId: other.authSessionId,
    };

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(mismatchedBinding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("subject-mismatch");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects a project-mismatched binding (T20-AC5 project-mismatch)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture({
      projectId: "proj_other_bound",
    });

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("project-mismatch");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when extension command parentThreadId attempts to hijack a different thread (T20-AC5 thread)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, parentThreadId: "thread_hijacked" as ThreadId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("Thread authorization mismatch");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when extension command parentTurnId mismatches the trusted active turn (T20-AC5 turn)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, parentTurnId: "turn_other" as TurnId },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_active_turn_required");
      expect(result.rejectionReason).toContain("Active turn mismatch");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("rejects when the thread is approval-required and the Pi provider has no approval gate (T20-AC5 approval)", async () => {
    const approvalRequiredThread = {
      ...validThread,
      runtimeMode: "approval-required" as const,
    } as unknown as OrchestrationReadModel["threads"][number];
    const snapshotQuery = createMockSnapshotQuery([approvalRequiredThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      expect(result.rejectionReason).toContain("no approval gate");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("cross-authority collision: same commandId under a different subject scope is refused, never returns the other execution's identities", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const { registry: registryA, binding: bindingA } = makeAuthorityFixture({
        subject: "user_a",
      });
      const { registry: registryB, binding: bindingB } = makeAuthorityFixture({
        subject: "user_b",
      });

      const first = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registryA,
        trustedContext: makeTrustedContext(bindingA),
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(first.status).toBe("accepted");

      const second = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        authorityRegistry: registryB,
        trustedContext: makeTrustedContext(bindingB),
        now: "2026-08-16T12:05:00.000Z",
      });

      // Fail closed: the second caller must NOT receive the first execution's
      // identities and no duplicate row exists.
      expect(second.status).toBe("rejected");
      expect(second.diagnosticCode).toBe("pi_subagent_command_identity_mismatch");
      expect(second.executionId).not.toBe(first.executionId);
      expect(second.attemptId).not.toBe(first.attemptId);

      const journal = yield* repository.listJournalEvents(first.executionId);
      expect(journal).toHaveLength(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("concurrent same-authority replays converge on one execution with identical identities (T20-AC3)", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();
    const concurrentCommand: PiSubagentSpawnCommand = {
      ...validCommand,
      commandId: "cmd_concurrent_scope_1",
      clientCommandId: "client_cmd_concurrent_1",
    };

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const attempts = Array.from({ length: 8 }, (_, i) =>
        admitSubagentSpawn({
          command: concurrentCommand,
          sessionCapability: managedCapability,
          snapshotQuery,
          repository,
          authorityRegistry: registry,
          trustedContext: makeTrustedContext(binding),
          now: new Date(Date.now() + i * 100).toISOString(),
        }),
      );

      const results = yield* Effect.all(attempts, { concurrency: "unbounded" });

      const accepted = results.filter((r) => r.status === "accepted");
      const alreadyApplied = results.filter((r) => r.status === "already_applied");
      expect(accepted).toHaveLength(1);
      expect(alreadyApplied).toHaveLength(7);

      const winningExecutionId = accepted[0]!.executionId;
      for (const res of results) {
        expect(res.executionId).toBe(winningExecutionId);
        expect(res.attemptId).toBe(accepted[0]!.attemptId);
      }

      const journal = yield* repository.listJournalEvents(winningExecutionId);
      expect(journal).toHaveLength(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});

describe("Pi subagent admission fails closed (Ticket 03: T03-AC1, T03-AC2, T03-AC3, T03-AC4, T03-AC5, T03-AC6)", () => {
  it("T03-AC1, T03-AC2: failure to persist lifecycle fails closed with stable lifecycle persistence diagnostic and projects no accepted/running execution", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

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
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
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

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T03-AC3: managed control health becomes degraded upon persistence failure and subsequent admissions fail closed", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

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
            cause: new Error("Simulated SQLite disk I/O error"),
            operation: "recordAdmission",
          } as any),
      };

      const first = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_fault_1" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(first.status).toBe("rejected");
      expect(first.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      const healthAfter = yield* controlHealth.getHealth();
      expect(healthAfter.status).toBe("degraded");
      expect(healthAfter.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // Subsequent admission fails closed via control health (no store call)
      const second = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_fault_2" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:01:00.000Z",
      });
      expect(second.status).toBe("rejected");
      expect(second.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(second.rejectionReason).toContain("Failed to persist execution lifecycle truth");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T03-AC4: existing execution records and terminal truth are not deleted, rewritten, or misreported by admission degradation", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;

      // Existing terminal truth: a succeeded execution with journal history
      const existing = yield* liveRepo.recordAdmission({
        executionId: "exec_existing_1",
        attemptId: "att_existing_1",
        generation: 1,
        commandId: "cmd_existing_1",
        commandFingerprint: "fingerprint_existing_1",
        projectId: "proj_default",
        parentThreadId: "thread_main",
        parentTurnId: "turn_001",
        parentToolCallId: "call_existing_1",
        agentType: "researcher",
        prompt: "Existing terminal work",
        mode: "foreground",
        cancellationScope: "parent_turn",
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
        now: "2026-08-16T10:00:00.000Z",
      });
      expect(existing.kind).toBe("admitted");
      yield* liveRepo.recordLifecycleEvent({
        eventId: "evt_existing_terminal",
        executionId: "exec_existing_1",
        attemptId: "att_existing_1",
        generation: 1,
        sequence: 2,
        state: "succeeded",
        occurredAt: "2026-08-16T11:00:00.000Z",
      });

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
        command: { ...validCommand, commandId: "cmd_after_existing" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // Terminal truth untouched
      const fetched = yield* liveRepo.getById("exec_existing_1");
      expect(Option.isSome(fetched)).toBe(true);
      if (Option.isSome(fetched)) {
        expect(fetched.value.observedState).toBe("succeeded");
      }
      const journal = yield* liveRepo.listJournalEvents("exec_existing_1");
      expect(journal).toHaveLength(2);
      expect(journal[1]!.state).toBe("succeeded");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T03-AC5: once durable writes recover, health returns to available and a new command can be admitted without replaying rejected work", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();

      let storeFailing = true;
      const flakyRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: (input) =>
          storeFailing
            ? Effect.fail({
                _tag: "PersistenceSqlError",
                cause: new Error("Simulated SQLite disk I/O error"),
                operation: "recordAdmission",
              } as any)
            : liveRepo.recordAdmission(input),
      };

      const rejected = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_recover_1" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: flakyRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:00:00.000Z",
      });
      expect(rejected.status).toBe("rejected");
      const healthAfter = yield* controlHealth.getHealth();
      expect(healthAfter.status).toBe("degraded");

      // Writes recover
      storeFailing = false;
      yield* controlHealth.markAvailable();

      const admitted = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_recover_2" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: flakyRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-16T12:10:00.000Z",
      });
      expect(admitted.status).toBe("accepted");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T03-AC6: legacy Pi behavior remains available according to negotiated capability policy and is never mislabeled managed", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;

      const result = yield* admitSubagentSpawn({
        command: validCommand,
        sessionCapability: unmanagedCapability,
        snapshotQuery,
        repository,
        trustedContext: {
          trustedThreadId: "thread_main" as ThreadId,
          trustedProjectId: "proj_default" as ProjectId,
          trustedActiveTurnId: "turn_001" as TurnId,
          trustedProvider: "pi",
          mcpAuthority: null,
        },
        now: "2026-08-16T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
      const stored = yield* repository.getByCommandId("cmd_spawn_001");
      expect(Option.isNone(stored)).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});

describe("Pi subagent production fail-closed control health (Ticket 21: T21-AC1, T21-AC2, T21-AC3, T21-AC4)", () => {
  it("T21-AC1/T21-AC3: degraded admissions keep probing the durable store fail-closed with the stable persistence diagnostic and exactly one degraded transition", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();
      const transitions: Array<Record<string, unknown>> = [];
      let storeFailing = true;
      let recordAdmissionCalls = 0;

      const failingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: (input) => {
          recordAdmissionCalls += 1;
          return storeFailing
            ? Effect.fail({
                _tag: "PersistenceSqlError",
                cause: new Error("Simulated SQLite disk I/O error"),
                operation: "recordAdmission",
              } as any)
            : liveRepo.recordAdmission(input);
        },
      };

      const admit = (commandId: string, now: string) =>
        admitSubagentSpawn({
          command: { ...validCommand, commandId },
          sessionCapability: managedCapability,
          snapshotQuery,
          repository: failingRepo,
          controlHealth,
          authorityRegistry: registry,
          trustedContext: makeTrustedContext(binding),
          onHealthTransition: (transition) => {
            transitions.push(transition as unknown as Record<string, unknown>);
          },
          now,
        });

      const first = yield* admit("cmd_t21_probe_1", "2026-08-17T12:00:00.000Z");
      expect(first.status).toBe("rejected");
      expect(first.state).toBe("rejected");
      expect(first.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(recordAdmissionCalls).toBe(1);

      const healthAfterFirst = yield* controlHealth.getHealth();
      expect(healthAfterFirst.status).toBe("degraded");
      expect(healthAfterFirst.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // While persistence remains unavailable every fresh managed admission
      // is still refused with the SAME stable persistence diagnostic. The
      // admission-driven recovery probe actually attempts the durable store
      // (T21-AC5 precondition), so the failure is re-proven, not assumed.
      const second = yield* admit("cmd_t21_probe_2", "2026-08-17T12:01:00.000Z");
      expect(second.status).toBe("rejected");
      expect(second.state).toBe("rejected");
      expect(second.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(second.rejectionReason).toContain("Failed to persist execution lifecycle truth");
      expect(recordAdmissionCalls).toBe(2);

      // Exactly one degraded transition across repeated failures (T21-AC3).
      expect(transitions).toHaveLength(1);
      expect(transitions[0]!.from).toBe("available");
      expect(transitions[0]!.to).toBe("degraded");
      expect(transitions[0]!.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(transitions[0]!.threadId).toBe("thread_main");

      const healthAfterSecond = yield* controlHealth.getHealth();
      expect(healthAfterSecond.status).toBe("degraded");

      // T21-AC2: neither failed admission projected accepted/running state.
      const stored1 = yield* liveRepo.getByCommandId("cmd_t21_probe_1");
      const stored2 = yield* liveRepo.getByCommandId("cmd_t21_probe_2");
      expect(Option.isNone(stored1)).toBe(true);
      expect(Option.isNone(stored2)).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T21-AC3: degraded control health never masks authorization diagnostics — provider mismatch still fails closed with its own stable code", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();

      yield* controlHealth.markDegraded(
        "Failed to persist execution lifecycle truth: disk I/O",
        "pi_subagent_lifecycle_persistence_failed",
      );

      const result = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_t21_degraded_provider" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: {
          ...makeTrustedContext(binding),
          trustedProvider: "codex",
        },
        now: "2026-08-17T12:00:00.000Z",
      });

      expect(result.status).toBe("rejected");
      expect(result.diagnosticCode).toBe("pi_subagent_admission_provider_mismatch");
      expect(result.rejectionReason).toContain("Provider mismatch");

      const health = yield* controlHealth.getHealth();
      expect(health.status).toBe("degraded");
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T21-AC2/T21-AC4: a degraded admission's failed probe preserves existing running, orphaned, and terminal truth field-for-field and leaves no partial rows", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();

      // Existing truth in every aggregate family: running, orphaned, terminal.
      const seed = (
        executionId: string,
        commandId: string,
        observedState: "running" | "orphaned" | "succeeded",
      ) =>
        Effect.gen(function* () {
          yield* liveRepo.recordAdmission({
            executionId,
            attemptId: `att_${executionId}`,
            generation: 1,
            commandId,
            commandFingerprint: `fp_${commandId}`,
            clientCommandId: null,
            subject: "user_456",
            projectId: "proj_default",
            parentThreadId: "thread_main",
            parentTurnId: "turn_001",
            parentToolCallId: `call_${commandId}`,
            agentType: "researcher",
            prompt: `Existing ${observedState} work`,
            mode: "foreground",
            cancellationScope: "parent_turn",
            state: "accepted",
            diagnosticCode: "pi_subagent_managed_enabled",
            now: "2026-08-17T10:00:00.000Z",
          });
          yield* liveRepo.recordLifecycleEvent({
            eventId: `evt_${executionId}`,
            executionId,
            attemptId: `att_${executionId}`,
            generation: 1,
            sequence: 2,
            state: observedState,
            occurredAt: "2026-08-17T11:00:00.000Z",
          });
        });

      yield* seed("exec_t21_running", "cmd_t21_running", "running");
      yield* seed("exec_t21_orphaned", "cmd_t21_orphaned", "orphaned");
      yield* seed("exec_t21_terminal", "cmd_t21_terminal", "succeeded");

      const snapshotBefore = yield* Effect.all(
        ["exec_t21_running", "exec_t21_orphaned", "exec_t21_terminal"].map((id) =>
          Effect.gen(function* () {
            const record = yield* liveRepo.getById(id);
            const journal = yield* liveRepo.listJournalEvents(id);
            return {
              record: Option.getOrThrow(record),
              journal,
            };
          }),
        ),
        { concurrency: "unbounded" },
      );

      let recordAdmissionCalls = 0;
      const failingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: (input) => {
          recordAdmissionCalls += 1;
          return Effect.fail({
            _tag: "PersistenceSqlError",
            cause: new Error("Simulated SQLite disk I/O error"),
            operation: "recordAdmission",
          } as any);
        },
      };

      const degraded = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_t21_truth_probe" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-17T12:00:00.000Z",
      });
      expect(degraded.status).toBe("rejected");
      expect(degraded.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect((yield* controlHealth.getHealth()).status).toBe("degraded");

      // A second fresh command while degraded re-proves the outage through
      // the admission-driven recovery probe (the durable store is actually
      // attempted again while degraded).
      const degradedAgain = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_t21_truth_probe_2" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-17T12:01:00.000Z",
      });
      expect(degradedAgain.status).toBe("rejected");
      expect(degradedAgain.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      expect(recordAdmissionCalls).toBe(2);

      // Field-equivalent preservation before/during/after the degraded
      // admission (the durable snapshot seam reads through the repository).
      const snapshotAfter = yield* Effect.all(
        ["exec_t21_running", "exec_t21_orphaned", "exec_t21_terminal"].map((id) =>
          Effect.gen(function* () {
            const record = yield* liveRepo.getById(id);
            const journal = yield* liveRepo.listJournalEvents(id);
            return {
              record: Option.getOrThrow(record),
              journal,
            };
          }),
        ),
        { concurrency: "unbounded" },
      );
      expect(snapshotAfter).toEqual(snapshotBefore);
      expect(snapshotAfter[0]!.record.observedState).toBe("running");
      expect(snapshotAfter[1]!.record.observedState).toBe("orphaned");
      expect(snapshotAfter[2]!.record.observedState).toBe("succeeded");

      // No partial truth for the degraded command itself.
      const partial = yield* liveRepo.getByCommandId("cmd_t21_truth_probe");
      expect(Option.isNone(partial)).toBe(true);
      const threadRows = yield* liveRepo.listByThreadId("thread_main");
      expect(threadRows.filter((row) => row.commandId === "cmd_t21_truth_probe")).toHaveLength(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});

describe("Pi subagent admission-driven recovery (Ticket 21: T21-AC5, T21-AC7)", () => {
  it("T21-AC5: a fresh command's durable recovery probe marks health available, admits that same command, and never replays rejected work", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();
      const transitions: Array<{
        from: string;
        to: string;
        diagnosticCode?: string;
        threadId?: string;
      }> = [];
      let storeFailing = true;

      const flakyRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: (input) =>
          storeFailing
            ? Effect.fail({
                _tag: "PersistenceSqlError",
                cause: new Error("Simulated SQLite disk I/O error"),
                operation: "recordAdmission",
              } as any)
            : liveRepo.recordAdmission(input),
      };

      const admit = (commandId: string, now: string) =>
        admitSubagentSpawn({
          command: { ...validCommand, commandId },
          sessionCapability: managedCapability,
          snapshotQuery,
          repository: flakyRepo,
          controlHealth,
          authorityRegistry: registry,
          trustedContext: makeTrustedContext(binding),
          onHealthTransition: (transition) => {
            transitions.push({
              from: transition.from,
              to: transition.to,
              ...(transition.diagnosticCode !== undefined
                ? { diagnosticCode: transition.diagnosticCode }
                : {}),
              ...(transition.threadId !== undefined ? { threadId: transition.threadId } : {}),
            });
          },
          now,
        });

      // Outage: the first command is rejected and health degrades.
      const rejected = yield* admit("cmd_t21_rejected_during_outage", "2026-08-17T12:00:00.000Z");
      expect(rejected.status).toBe("rejected");
      expect((yield* controlHealth.getHealth()).status).toBe("degraded");

      // Durable writes recover. The next FRESH command drives the recovery
      // probe: its own atomic recordAdmission succeeds, control health
      // returns to available, and that same command is admitted.
      storeFailing = false;
      const recovering = yield* admit("cmd_t21_recovery_probe", "2026-08-17T12:10:00.000Z");
      expect(recovering.status).toBe("accepted");
      expect(recovering.executionId).toMatch(/^exec_/);
      expect((yield* controlHealth.getHealth()).status).toBe("available");

      // Exactly one degraded and one recovery transition, scoped to the
      // admission threads that drove them.
      expect(transitions).toEqual([
        {
          from: "available",
          to: "degraded",
          diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
          threadId: "thread_main",
        },
        {
          from: "degraded",
          to: "available",
          diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
          threadId: "thread_main",
        },
      ]);

      // No replay: the rejected command never gained an execution and the
      // recovered admission is the only new durable truth.
      const rejectedRow = yield* liveRepo.getByCommandId("cmd_t21_rejected_during_outage");
      expect(Option.isNone(rejectedRow)).toBe(true);
      const recoveredRow = yield* liveRepo.getByCommandId("cmd_t21_recovery_probe");
      expect(Option.isSome(recoveredRow)).toBe(true);
      if (Option.isSome(recoveredRow)) {
        expect(recoveredRow.value.observedState).toBe("accepted");
        expect(recoveredRow.value.executionId).toBe(recovering.executionId);
      }

      // Post-recovery admissions are normal admissions (no probe marking).
      const normal = yield* admit("cmd_t21_after_recovery", "2026-08-17T12:11:00.000Z");
      expect(normal.status).toBe("accepted");
      expect(transitions).toHaveLength(2);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T21-AC5: a concurrent waiter re-reads recovered health and performs its own normal admission without a second recovery transition", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();
      const transitions: Array<{ from: string; to: string }> = [];

      // Degrade first (store fails once while healthy).
      let storeFailing = true;
      const flakyRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: (input) =>
          storeFailing
            ? Effect.fail({
                _tag: "PersistenceSqlError",
                cause: new Error("Simulated SQLite disk I/O error"),
                operation: "recordAdmission",
              } as any)
            : liveRepo.recordAdmission(input),
      };
      const admit = (commandId: string, now: string) =>
        admitSubagentSpawn({
          command: { ...validCommand, commandId },
          sessionCapability: managedCapability,
          snapshotQuery,
          repository: flakyRepo,
          controlHealth,
          authorityRegistry: registry,
          trustedContext: makeTrustedContext(binding),
          onHealthTransition: (transition) => {
            transitions.push({ from: transition.from, to: transition.to });
          },
          now,
        });

      yield* admit("cmd_t21_waiter_outage", "2026-08-17T12:00:00.000Z");
      expect((yield* controlHealth.getHealth()).status).toBe("degraded");

      // Recovery: the store is healthy again, but the probe leader's durable
      // write is held until the waiter has parked on the single-flight gate.
      storeFailing = false;
      const leaderHeld = yield* Deferred.make<void>();
      const leaderRelease = yield* Deferred.make<void>();
      const gatedRepo: typeof liveRepo = {
        ...flakyRepo,
        recordAdmission: (input) =>
          input.commandId === "cmd_t21_probe_leader"
            ? Deferred.succeed(leaderHeld, undefined).pipe(
                Effect.andThen(Deferred.await(leaderRelease)),
                Effect.andThen(liveRepo.recordAdmission(input)),
              )
            : flakyRepo.recordAdmission(input),
      };

      const leaderFiber = yield* Effect.forkChild(
        admitSubagentSpawn({
          command: { ...validCommand, commandId: "cmd_t21_probe_leader" },
          sessionCapability: managedCapability,
          snapshotQuery,
          repository: gatedRepo,
          controlHealth,
          authorityRegistry: registry,
          trustedContext: makeTrustedContext(binding),
          onHealthTransition: (transition) => {
            transitions.push({ from: transition.from, to: transition.to });
          },
          now: "2026-08-17T12:10:00.000Z",
        }),
      );
      const waiterFiber = yield* Effect.forkChild(
        admitSubagentSpawn({
          command: { ...validCommand, commandId: "cmd_t21_waiter" },
          sessionCapability: managedCapability,
          snapshotQuery,
          repository: gatedRepo,
          controlHealth,
          authorityRegistry: registry,
          trustedContext: makeTrustedContext(binding),
          onHealthTransition: (transition) => {
            transitions.push({ from: transition.from, to: transition.to });
          },
          now: "2026-08-17T12:10:01.000Z",
        }),
      );

      // The leader parks inside its durable write while degraded; the waiter
      // parks on the single-flight recovery gate.
      yield* Deferred.await(leaderHeld);
      yield* Effect.sleep(50);
      yield* Deferred.succeed(leaderRelease, undefined);
      const leaderResult = yield* Fiber.join(leaderFiber);
      const waiterResult = yield* Fiber.join(waiterFiber);

      // The probe leader recovered health and was admitted; the waiter
      // re-read available health and performed its own normal admission.
      expect(leaderResult.status).toBe("accepted");
      expect(waiterResult.status).toBe("accepted");
      expect(waiterResult.executionId).not.toBe(leaderResult.executionId);
      expect((yield* controlHealth.getHealth()).status).toBe("available");

      // Exactly one degraded → available transition: the waiter's success
      // marked nothing because it was a normal admission.
      expect(transitions).toEqual([
        { from: "available", to: "degraded" },
        { from: "degraded", to: "available" },
      ]);

      const leaderRow = yield* liveRepo.getByCommandId("cmd_t21_probe_leader");
      const waiterRow = yield* liveRepo.getByCommandId("cmd_t21_waiter");
      expect(Option.isSome(leaderRow)).toBe(true);
      expect(Option.isSome(waiterRow)).toBe(true);
      expect(
        Option.isSome(waiterRow) && Option.isSome(leaderRow)
          ? waiterRow.value.executionId !== leaderRow.value.executionId
          : false,
      ).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T21-AC7: legacy and unhandshaked sessions are never gated by degraded control health and never create managed truth", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();
      let recordAdmissionCalls = 0;
      const countingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: (input) => {
          recordAdmissionCalls += 1;
          return liveRepo.recordAdmission(input);
        },
      };

      yield* controlHealth.markDegraded(
        "Failed to persist execution lifecycle truth: disk I/O",
        "pi_subagent_lifecycle_persistence_failed",
      );

      const legacy = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_t21_legacy_during_outage" },
        sessionCapability: unmanagedCapability,
        snapshotQuery,
        repository: countingRepo,
        controlHealth,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-17T12:00:00.000Z",
      });
      expect(legacy.status).toBe("rejected");
      expect(legacy.diagnosticCode).toBe("pi_subagent_bridge_absent");

      const unsupported = yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_t21_unsupported_during_outage" },
        sessionCapability: {
          ...managedCapability,
          status: "capability_mismatch",
          isManaged: false,
          diagnosticCode: "pi_subagent_capability_mismatch",
          diagnosticMessage: "Extension lacks required capabilities",
        },
        snapshotQuery,
        repository: countingRepo,
        controlHealth,
        trustedContext: makeTrustedContext(binding),
        now: "2026-08-17T12:00:01.000Z",
      });
      expect(unsupported.status).toBe("rejected");
      expect(unsupported.diagnosticCode).toBe("pi_subagent_capability_mismatch");

      // No durable write was attempted for legacy paths and degraded control
      // health is untouched by them.
      expect(recordAdmissionCalls).toBe(0);
      const health = yield* controlHealth.getHealth();
      expect(health.status).toBe("degraded");
      const rows = yield* liveRepo.listByThreadId("thread_main");
      expect(rows).toHaveLength(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});

describe("Pi subagent degraded admission concurrency (Ticket 21: T21-AC3, T21-AC5)", () => {
  it("T21-AC3: concurrent fresh commands while degraded serialize their recovery probes, all fail closed, and report one degraded transition", async () => {
    const snapshotQuery = createMockSnapshotQuery([validThread]);
    const { registry, binding } = makeAuthorityFixture();

    const program = Effect.gen(function* () {
      const liveRepo = yield* PiSubagentExecutionRepository;
      const controlHealth = yield* makePiSubagentControlHealth();
      const transitions: Array<{ from: string; to: string }> = [];
      let recordAdmissionAttempts = 0;
      let inFlight = 0;
      let maxInFlight = 0;

      const failingRepo: typeof liveRepo = {
        ...liveRepo,
        recordAdmission: () =>
          Effect.gen(function* () {
            recordAdmissionAttempts += 1;
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            yield* Effect.sleep(20);
            inFlight -= 1;
            return yield* Effect.fail({
              _tag: "PersistenceSqlError",
              cause: new Error("Simulated SQLite disk I/O error"),
              operation: "recordAdmission",
            } as any);
          }),
      };

      // Degrade first.
      yield* admitSubagentSpawn({
        command: { ...validCommand, commandId: "cmd_t21_concurrent_outage" },
        sessionCapability: managedCapability,
        snapshotQuery,
        repository: failingRepo,
        controlHealth,
        authorityRegistry: registry,
        trustedContext: makeTrustedContext(binding),
        onHealthTransition: (transition) => {
          transitions.push({ from: transition.from, to: transition.to });
        },
        now: "2026-08-17T12:00:00.000Z",
      });
      expect((yield* controlHealth.getHealth()).status).toBe("degraded");

      // Four concurrent fresh commands while the store is unavailable.
      const results = yield* Effect.all(
        [1, 2, 3, 4].map((n) =>
          admitSubagentSpawn({
            command: { ...validCommand, commandId: `cmd_t21_concurrent_${n}` },
            sessionCapability: managedCapability,
            snapshotQuery,
            repository: failingRepo,
            controlHealth,
            authorityRegistry: registry,
            trustedContext: makeTrustedContext(binding),
            onHealthTransition: (transition) => {
              transitions.push({ from: transition.from, to: transition.to });
            },
            now: `2026-08-17T12:0${n}:00.000Z`,
          }),
        ),
        { concurrency: "unbounded" },
      );

      for (const result of results) {
        expect(result.status).toBe("rejected");
        expect(result.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");
      }
      // Every degraded admission re-proved the outage through its own probe.
      expect(recordAdmissionAttempts).toBe(5);
      // Single-flight: probes never overlapped.
      expect(maxInFlight).toBe(1);
      // Exactly one degraded transition for the entire outage.
      expect(transitions).toEqual([{ from: "available", to: "degraded" }]);
      expect((yield* controlHealth.getHealth()).status).toBe("degraded");

      // No durable truth was projected for any degraded command.
      for (const n of [1, 2, 3, 4]) {
        const row = yield* liveRepo.getByCommandId(`cmd_t21_concurrent_${n}`);
        expect(Option.isNone(row)).toBe(true);
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});
