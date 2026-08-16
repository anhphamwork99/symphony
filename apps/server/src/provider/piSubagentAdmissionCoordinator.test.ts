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

function makeAuthorityFixture(overrides: {
  readonly subject?: string;
  readonly authExpiresAt?: number | null;
  readonly credentialTtlMs?: number;
  readonly projectId?: string | null;
} = {}) {
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
