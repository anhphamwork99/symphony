// FILE: piSubagentResumeCoordinator.test.ts
// Purpose: Ticket 14 Testing Seams —
//   Seam 1 (T14-AC1/AC2/AC4/AC5): server orchestration resume boundary with
//   authorization, quota, stale-event, and durable-restart fixtures — the REAL
//   repository + in-memory SQLite driven through the production resume
//   coordinator with the REAL shared admission gates.
//   Seam 2 (T14-AC2/AC3): execution/attempt state-machine contract — the
//   repository-level resume settlement (idempotent identity, generation fence,
//   non-orphaned denial, observation-column reset) plus the explicit-only
//   command-surface audit (no automatic resume trigger in reconciliation,
//   wall-time sweep, or startup recovery surfaces).
// Layer: Server provider coordinator tests (repository-real)
// Exports: none (vitest suite)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Layer, Option } from "effect";

import type {
  OrchestrationReadModel,
  PiSubagentExecutionRecord,
  ProjectId,
  ThreadId,
  TurnId,
} from "@synara/contracts";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  PiSubagentExecutionRepositoryLive,
  setPiSubagentExecutionLifecycleListener,
} from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import {
  makeMcpSessionAuthorityRegistry,
  type McpAuthorityBinding,
} from "../agentGateway/mcpSessionAuthority.ts";
import type {
  AdmissionSnapshotQuery,
  TrustedAdmissionContext,
} from "./piSubagentAdmissionCoordinator.ts";
import { reconcilePiSubagentExecutions } from "./piSubagentRestartReconciliation.ts";
import { sweepPiSubagentWallTimeExpiry } from "./piSubagentWallTimeSweep.ts";
import {
  PI_SUBAGENT_RESUME_SEQUENCE,
  resumePiSubagentExecution,
} from "./piSubagentResumeCoordinator.ts";
import {
  PI_SUBAGENT_WATCHDOG_BAND,
  PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC,
} from "./piSubagentWatchdogEscalation.ts";

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const BASE_TIME = "2026-08-19T09:00:00.000Z";
const BASE_TIME_2 = "2026-08-19T09:05:00.000Z";

afterEach(() => {
  setPiSubagentExecutionLifecycleListener(undefined);
});

const managedCapability = {
  status: "managed_enabled" as const,
  diagnosticCode: "pi_subagent_managed_enabled" as const,
  isManaged: true,
  protocolVersion: 1,
  capabilities: ["managed-spawn", "abort-propagation"],
  extensionVersion: "0.1.0",
};

const unmanagedCapability = {
  status: "bridge_absent" as const,
  diagnosticCode: "pi_subagent_bridge_absent" as const,
  isManaged: false,
  diagnosticMessage: "Legacy session",
};

function createSnapshotQuery(threads: OrchestrationReadModel["threads"]): AdmissionSnapshotQuery {
  return {
    getSnapshot: () =>
      Effect.succeed({
        threads,
        projects: [],
        spaces: [],
      } as unknown as OrchestrationReadModel),
  };
}

const liveThread = {
  id: "thread_main" as ThreadId,
  projectId: "proj_default" as ProjectId,
  archivedAt: null,
  runtimeMode: "full-access" as const,
  session: {
    status: "running" as const,
    activeTurnId: "turn_resume" as TurnId,
  },
  latestTurn: {
    id: "turn_resume" as TurnId,
    state: "running" as const,
  },
} as unknown as OrchestrationReadModel["threads"][number];

function makeAuthorityFixture() {
  const registry = makeMcpSessionAuthorityRegistry();
  const record = registry.mint({
    subject: "user_456",
    kind: "authenticated",
    authSessionId: "auth-session-1",
    authExpiresAt: null,
  });
  const binding = registry.bindingFor(record.authorityId, {
    threadId: "thread_main",
    provider: "pi",
    projectId: "proj_default",
    lifecycleGeneration: null,
    credentialTtlMs: 60 * 60 * 1_000,
  })!;
  return { registry, binding };
}

function makeTrustedContext(
  binding: McpAuthorityBinding | null,
  overrides: Partial<TrustedAdmissionContext> = {},
): TrustedAdmissionContext {
  return {
    trustedThreadId: "thread_main" as ThreadId,
    trustedProjectId: "proj_default" as ProjectId,
    trustedActiveTurnId: "turn_resume" as TurnId,
    trustedProvider: "pi",
    mcpAuthority: binding,
    ...overrides,
  };
}

/** Production-shaped orphaned fixture: admission (seq 1) + started (seq 2) +
 * restart reconciliation orphaning (band 50, fence gen+1). */
const admitThenOrphan = (executionId: string) =>
  Effect.gen(function* () {
    const repository = yield* PiSubagentExecutionRepository;
    yield* repository.recordAdmission({
      executionId,
      attemptId: `att_${executionId}_1`,
      generation: 1,
      commandId: `cmd_${executionId}`,
      commandFingerprint: `fp_${executionId}`,
      projectId: "proj_default" as ProjectId,
      parentThreadId: "thread_main" as ThreadId,
      parentTurnId: "turn_old" as TurnId,
      parentToolCallId: "call_old",
      agentType: "general-purpose",
      prompt: "task",
      mode: "foreground",
      cancellationScope: "parent_turn",
      state: "accepted",
      now: BASE_TIME,
    });
    yield* repository.recordLifecycleEvent({
      eventId: `evt_${executionId}_att1_seq2_started`,
      executionId,
      attemptId: `att_${executionId}_1`,
      generation: 1,
      sequence: 2,
      state: "running",
      occurredAt: BASE_TIME,
      metadataJson: JSON.stringify({ phase: "started" }),
    });
    const reconciliation = yield* reconcilePiSubagentExecutions({
      repository,
      mode: "restart",
      now: () => Date.parse(BASE_TIME_2),
    });
    const orphaned = reconciliation.outcomes.find(
      (outcome) => outcome.kind === "orphaned" && outcome.executionId === executionId,
    );
    expect(orphaned).toBeDefined();
  });

type ResumeRepository = Parameters<typeof resumePiSubagentExecution>[0]["repository"];

const makeResumeInput = (repository: ResumeRepository, overrides: Record<string, unknown> = {}) => {
  // ONE registry fixture: trustedContext and authorityRegistry must share the
  // same minted binding, or the subject-authority gate fails closed.
  const { registry, binding } = makeAuthorityFixture();
  return {
    executionId: "exec_resume_1",
    threadId: "thread_main",
    sessionCapability: managedCapability,
    snapshotQuery: createSnapshotQuery([liveThread]),
    trustedContext: makeTrustedContext(binding),
    authorityRegistry: registry,
    launchChildAttempt: async () => {},
    now: () => Date.parse(BASE_TIME_2),
    repository,
    ...overrides,
  };
};

describe("Pi subagent explicit resume (Issue 14) — Seam 1: server resume boundary", () => {
  it("T14-AC1: resume keeps the executionId, mints ONE new attemptId, advances generation, and records the new generation BEFORE the child starts", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_1");

      const lifecycleNotifications: Array<{
        readonly executionId: string;
        readonly journalSequence: number;
      }> = [];
      setPiSubagentExecutionLifecycleListener((notification) => {
        lifecycleNotifications.push(notification);
      });
      let childStarted = false;
      let aggregateAtChildStart: PiSubagentExecutionRecord | null = null;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          launchChildAttempt: async (attempt: {
            readonly executionId: string;
            readonly attemptId: string;
            readonly generation: number;
          }) => {
            childStarted = true;
            const atStart = await Effect.runPromise(repository.getById(attempt.executionId));
            aggregateAtChildStart = Option.getOrThrow(atStart);
          },
        }),
      );

      expect(outcome.kind).toBe("resumed");
      if (outcome.kind === "resumed") {
        expect(outcome.executionId).toBe("exec_resume_1");
        expect(outcome.attemptId).toMatch(/^att_/);
        expect(outcome.attemptId).not.toBe("att_exec_resume_1_1");
        expect(outcome.generation).toBe(3); // 1 (spawn) + 1 (orphan fence) + 1 (resume)
      }
      // The durable aggregate was queued on the new attempt BEFORE the child.
      expect(childStarted).toBe(true);
      expect(aggregateAtChildStart).not.toBeNull();
      const resumedAttemptId =
        outcome.kind === "resumed" ? outcome.attemptId : aggregateAtChildStart!.attemptId;
      expect(aggregateAtChildStart!.attemptId).toBe(resumedAttemptId);
      expect(aggregateAtChildStart!.generation).toBe(3);
      expect(aggregateAtChildStart!.observedState).toBe("queued");
      expect(aggregateAtChildStart!.desiredState).toBe("running");

      // Exactly ONE resume journal event, disjoint band 80, under the NEW
      // attempt. Ticket 15 owns watchdog band 70–74.
      const journal = yield* repository.listJournalEvents("exec_resume_1");
      const resumeEvents = journal.filter(
        (event) => event.sequence === PI_SUBAGENT_RESUME_SEQUENCE,
      );
      expect(resumeEvents).toHaveLength(1);
      expect(resumeEvents[0]!.attemptId).toBe(resumedAttemptId);
      expect(resumeEvents[0]!.generation).toBe(3);
      expect(resumeEvents[0]!.state).toBe("queued");
      expect(
        lifecycleNotifications.filter(
          (notification) =>
            notification.executionId === "exec_resume_1" &&
            notification.journalSequence === PI_SUBAGENT_RESUME_SEQUENCE,
        ),
      ).toHaveLength(1);
      // Prior-attempt evidence is retained (admission seq 1, started seq 2,
      // orphan band 50 all remain).
      expect(journal.some((event) => event.sequence === 1)).toBe(true);
      expect(journal.some((event) => event.sequence === 2)).toBe(true);
      expect(journal.some((event) => event.sequence === 50)).toBe(true);

      // Regression for the PROJECT.md cross-ticket gate: watchdog stage 70
      // must remain persistable on the resumed attempt. A resume at 70 would
      // collide on UNIQUE(execution, attempt, generation, sequence).
      const watchdog = yield* repository.recordWatchdogStageEvent({
        executionId: "exec_resume_1",
        attemptId: resumedAttemptId,
        generation: 3,
        sequence: PI_SUBAGENT_WATCHDOG_BAND.escalationStarted,
        state: "queued",
        occurredAt: BASE_TIME_2,
        diagnosticCode: PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC,
        diagnosticMessage: "Watchdog can journal after explicit resume.",
        metadata: { trigger: "wall_time" },
      });
      expect(watchdog.kind).toBe("recorded");
      const journalWithWatchdog = yield* repository.listJournalEvents("exec_resume_1");
      expect(
        journalWithWatchdog.some(
          (event) =>
            event.attemptId === resumedAttemptId &&
            event.generation === 3 &&
            event.sequence === PI_SUBAGENT_WATCHDOG_BAND.escalationStarted,
        ),
      ).toBe(true);
      expect(PI_SUBAGENT_RESUME_SEQUENCE).toBe(80);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC1: replaying the same resume identity is idempotent — NO second attempt, NO second child", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_2");
      let launches = 0;
      const base = makeResumeInput(repository, {
        executionId: "exec_resume_2",
        launchChildAttempt: async () => {
          launches += 1;
        },
      });
      const first = yield* resumePiSubagentExecution(base);
      expect(first.kind).toBe("resumed");
      const second = yield* resumePiSubagentExecution(base);
      expect(second.kind).toBe("already_applied");
      expect(launches).toBe(1);
      if (first.kind === "resumed" && second.kind === "already_applied") {
        expect(second.attemptId).toBe(first.attemptId);
        expect(second.generation).toBe(first.generation);
      }
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC2: late events, terminals, cancels, and completions from the superseded attempt are ignored (generation fence) and counted", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_3");
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_3",
        }),
      );
      expect(outcome.kind).toBe("resumed");

      // Late RUNNING event from the OLD attempt/generation: journaled as
      // history only — the aggregate must stay on the new attempt.
      const late = yield* repository.recordLifecycleEvent({
        eventId: `evt_exec_resume_3_att1_gen1_late`,
        executionId: "exec_resume_3",
        attemptId: "att_exec_resume_3_1",
        generation: 1,
        sequence: 5,
        state: "running",
        occurredAt: "2026-08-19T09:06:00.000Z",
      });
      expect(late.execution.attemptId).not.toBe("att_exec_resume_3_1");
      expect(late.execution.observedState).not.toBe("running");

      // Late TERMINAL from the old attempt: ignored + counted (stale terminal).
      const staleTerminal = yield* repository.recordTerminalEvent({
        executionId: "exec_resume_3",
        attemptId: "att_exec_resume_3_1",
        generation: 1,
        sequence: 40,
        state: "succeeded",
        occurredAt: "2026-08-19T09:06:01.000Z",
        summary: "late terminal from superseded attempt",
      });
      expect(staleTerminal.kind === "ignored_stale").toBe(true);
      expect(staleTerminal.execution.observedState).toBe("queued");

      const evidence = yield* repository.getTerminalEvidence("exec_resume_3");
      expect(Option.isSome(evidence)).toBe(true);
      if (Option.isSome(evidence)) {
        expect(evidence.value.staleTerminalEvents).toBe(1);
      }

      // Late CANCEL intent from the old attempt: stale, never fences the new
      // attempt (the aggregate keeps the resumed identity).
      const staleCancel = yield* repository.recordCancellationIntent({
        executionId: "exec_resume_3",
        attemptId: "att_exec_resume_3_1",
        generation: 1,
        sequence: 90,
        cancelCommandId: "cancelcmd_exec_resume_3_att1_gen1",
        occurredAt: "2026-08-19T09:06:02.000Z",
        reason: "late",
      });
      expect(staleCancel.execution.attemptId).not.toBe("att_exec_resume_3_1");
      expect(staleCancel.execution.desiredState).toBe("running");

      // Late COMPLETION (outbox) from the old attempt can never deliver: the
      // generation fence supersedes it before any parent effect.
      const outboxId = `outbox_exec_resume_3_att1_gen1`;
      const outbox = yield* repository.recordCompletionOutboxEntry({
        executionId: "exec_resume_3",
        attemptId: "att_exec_resume_3_1",
        generation: 1,
        terminalEventId: `term_exec_resume_3_att1_gen1`,
        parentThreadId: "thread_main",
        terminalState: "succeeded",
        summary: "late completion",
        now: "2026-08-19T09:06:03.000Z",
      });
      expect(outbox.kind === "created" || outbox.kind === "already_applied").toBe(true);
      const delivery = yield* repository.markCompletionDelivered({
        outboxId,
        now: "2026-08-19T09:06:04.000Z",
      });
      // The resume fence supersedes the entry: no delivery transition.
      expect(delivery.kind === "transitioned").toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC4: resume re-runs the same admission gates — thread authorization denial creates NO child and NO attempt", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_4");
      const { binding } = makeAuthorityFixture();
      let launches = 0;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_4",
          trustedContext: makeTrustedContext(binding, {
            trustedThreadId: "thread_OTHER" as ThreadId,
          }),
          launchChildAttempt: async () => {
            launches += 1;
          },
        }),
      );
      expect(outcome.kind).toBe("gate_denied");
      if (outcome.kind === "gate_denied") {
        expect(outcome.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      }
      expect(launches).toBe(0);
      // No new attempt: the aggregate is still the orphaned attempt.
      const stored = yield* repository.getById("exec_resume_4");
      const record = Option.getOrThrow(stored);
      expect(record.attemptId).toBe("att_exec_resume_4_1");
      expect(record.observedState).toBe("orphaned");
      expect(record.generation).toBe(2);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC4: missing subject authority fails closed — no child, no attempt", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_5");
      let launches = 0;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_5",
          trustedContext: makeTrustedContext(null),
          launchChildAttempt: async () => {
            launches += 1;
          },
        }),
      );
      expect(outcome.kind).toBe("gate_denied");
      expect(launches).toBe(0);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC4: provider-session concurrency quota is enforced — a saturated budget denies resume with no child", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_6");
      // Occupy the provider-session budget with another admitted execution on
      // the same thread (orphaned does NOT count — use a running one).
      yield* repository.recordAdmission({
        executionId: "exec_quota_blocker",
        attemptId: "att_quota_blocker",
        generation: 1,
        commandId: "cmd_quota_blocker",
        commandFingerprint: "fp_quota_blocker",
        projectId: "proj_default" as ProjectId,
        parentThreadId: "thread_main" as ThreadId,
        parentTurnId: "turn_resume" as TurnId,
        parentToolCallId: "call_blocker",
        agentType: "general-purpose",
        prompt: "blocker",
        mode: "foreground",
        cancellationScope: "parent_turn",
        state: "accepted",
        now: BASE_TIME,
      });
      yield* repository.recordLifecycleEvent({
        eventId: "evt_quota_blocker_seq2",
        executionId: "exec_quota_blocker",
        attemptId: "att_quota_blocker",
        generation: 1,
        sequence: 2,
        state: "running",
        occurredAt: BASE_TIME,
      });

      let launches = 0;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_6",
          admissionPolicy: { providerConcurrency: 1 },
          launchChildAttempt: async () => {
            launches += 1;
          },
        }),
      );
      expect(outcome.kind).toBe("gate_denied");
      if (outcome.kind === "gate_denied") {
        expect(outcome.diagnosticCode).toBe("pi_subagent_admission_provider_concurrency_exhausted");
      }
      expect(launches).toBe(0);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC5: the resumed card shows the new attempt queued with prior-attempt evidence retained and updated diagnostics", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_7");
      yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_7",
        }),
      );
      const card = yield* repository.getExecutionCard("exec_resume_7");
      expect(Option.isSome(card)).toBe(true);
      if (Option.isSome(card)) {
        expect(card.value.executionId).toBe("exec_resume_7");
        expect(card.value.attemptId).toMatch(/^att_/);
        expect(card.value.attemptId).not.toBe("att_exec_resume_7_1");
        expect(card.value.generation).toBe(3);
        expect(["queued", "running"]).toContain(card.value.observedState);
        expect(card.value.desiredState).toBe("running");
        // Updated diagnostics: the resume diagnostic replaced owner-loss.
        expect(card.value.diagnosticCode).toBe("pi_subagent_resumed");
        // Prior-attempt evidence is retained in the journal.
        const journal = yield* repository.listJournalEvents("exec_resume_7");
        expect(journal.some((event) => event.state === "orphaned")).toBe(true);
        expect(journal.some((event) => event.sequence === 1)).toBe(true);
      }
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC6/AC3: unmanaged session denies resume — nothing resumes through a legacy bridge", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_8");
      let launches = 0;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_8",
          sessionCapability: unmanagedCapability,
          launchChildAttempt: async () => {
            launches += 1;
          },
        }),
      );
      expect(outcome.kind).toBe("unmanaged_session");
      expect(launches).toBe(0);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC4: a NON-orphaned execution refuses resume without mutation (invalid_state, no child)", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      // A plain RUNNING execution (no orphaning).
      yield* repository.recordAdmission({
        executionId: "exec_resume_9",
        attemptId: "att_exec_resume_9_1",
        generation: 1,
        commandId: "cmd_exec_resume_9",
        commandFingerprint: "fp_exec_resume_9",
        projectId: "proj_default" as ProjectId,
        parentThreadId: "thread_main" as ThreadId,
        parentTurnId: "turn_resume" as TurnId,
        parentToolCallId: "call_9",
        agentType: "general-purpose",
        prompt: "task",
        mode: "foreground",
        cancellationScope: "parent_turn",
        state: "accepted",
        now: BASE_TIME,
      });
      yield* repository.recordLifecycleEvent({
        eventId: "evt_exec_resume_9_seq2",
        executionId: "exec_resume_9",
        attemptId: "att_exec_resume_9_1",
        generation: 1,
        sequence: 2,
        state: "running",
        occurredAt: BASE_TIME,
      });

      let launches = 0;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_9",
          launchChildAttempt: async () => {
            launches += 1;
          },
        }),
      );
      expect(outcome.kind).toBe("invalid_state");
      expect(launches).toBe(0);
      const stored = yield* repository.getById("exec_resume_9");
      expect(Option.getOrThrow(stored).observedState).toBe("running");
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC4: an unknown execution denies resume (not_found, no child)", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      let launches = 0;
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_does_not_exist",
          launchChildAttempt: async () => {
            launches += 1;
          },
        }),
      );
      expect(outcome.kind).toBe("not_found");
      expect(launches).toBe(0);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC6: a child-start failure leaves the honest durable queued attempt and surfaces child_start_failed", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_resume_10");
      const outcome = yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_resume_10",
          launchChildAttempt: async () => {
            throw new Error("bridge launch failed");
          },
        }),
      );
      expect(outcome.kind).toBe("child_start_failed");
      if (outcome.kind === "child_start_failed") {
        expect(outcome.error).toContain("bridge launch failed");
        expect(outcome.attemptId).toMatch(/^att_/);
      }
      const stored = yield* repository.getById("exec_resume_10");
      const record = Option.getOrThrow(stored);
      expect(record.observedState).toBe("queued");
      expect(record.attemptId).toMatch(/^att_/);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});

describe("Pi subagent explicit resume (Issue 14) — Seam 2: state-machine + explicit-only audit", () => {
  it("T14-AC3: reconciliation NEVER resumes — restart reconciliation orphans without creating a new attempt, and resume is the only exit", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* repository.recordAdmission({
        executionId: "exec_audit_1",
        attemptId: "att_audit_1",
        generation: 1,
        commandId: "cmd_audit_1",
        commandFingerprint: "fp_audit_1",
        projectId: "proj_default" as ProjectId,
        parentThreadId: "thread_main" as ThreadId,
        parentTurnId: "turn_old" as TurnId,
        parentToolCallId: "call_audit_1",
        agentType: "general-purpose",
        prompt: "task",
        mode: "foreground",
        cancellationScope: "parent_turn",
        state: "accepted",
        now: BASE_TIME,
      });
      yield* repository.recordLifecycleEvent({
        eventId: "evt_audit_1_seq2",
        executionId: "exec_audit_1",
        attemptId: "att_audit_1",
        generation: 1,
        sequence: 2,
        state: "running",
        occurredAt: BASE_TIME,
      });

      // Restart reconciliation: orphan only — attempt/generation untouched by
      // any spawn/resume (only the fence advances generation).
      const result = yield* reconcilePiSubagentExecutions({
        repository,
        mode: "restart",
        now: () => Date.parse(BASE_TIME_2),
      });
      expect(result.failures).toHaveLength(0);
      const stored = yield* repository.getById("exec_audit_1");
      const record = Option.getOrThrow(stored);
      expect(record.observedState).toBe("orphaned");
      expect(record.attemptId).toBe("att_audit_1"); // NO new attempt
      const journal = yield* repository.listJournalEvents("exec_audit_1");
      expect(
        journal.filter((event) => event.sequence === PI_SUBAGENT_RESUME_SEQUENCE),
      ).toHaveLength(0); // NO resume event

      // Wall-time sweep on the orphaned execution: journal-only, no resume.
      yield* Effect.promise(() =>
        sweepPiSubagentWallTimeExpiry({
          repository,
          nowMs: () => Date.parse(BASE_TIME_2) + 3 * 60 * 60 * 1_000,
          wallTimeMs: 60 * 60 * 1_000,
        }),
      );
      const afterSweep = yield* repository.getById("exec_audit_1");
      expect(Option.getOrThrow(afterSweep).observedState).toBe("orphaned");
      const journalAfterSweep = yield* repository.listJournalEvents("exec_audit_1");
      expect(
        journalAfterSweep.filter((event) => event.sequence === PI_SUBAGENT_RESUME_SEQUENCE),
      ).toHaveLength(0);
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });

  it("T14-AC3: public command-surface audit — startup/reconciliation/sweep surfaces contain no resume dispatch (explicit-only)", async () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const audit = (relativePath: string) => readFileSync(`${here}${relativePath}`, "utf8");
    const reconciliation = audit("piSubagentRestartReconciliation.ts");
    const sweep = audit("piSubagentWallTimeSweep.ts");
    const outbox = audit("piSubagentCompletionOutbox.ts");
    const resumeCoordinator = audit("piSubagentResumeCoordinator.ts");

    for (const [name, source] of [
      ["restart reconciliation", reconciliation],
      ["wall-time sweep", sweep],
      ["completion outbox recovery", outbox],
    ] as const) {
      expect(
        source.includes("resumePiSubagentExecution"),
        `${name} must not import or invoke the resume coordinator`,
      ).toBe(false);
      expect(
        source.includes("recordResumeEvent"),
        `${name} must not invoke the resume settlement`,
      ).toBe(false);
    }
    // The resume coordinator is exported for exactly one production consumer:
    // the PiAdapter explicit command path.
    expect(resumeCoordinator.includes("export const resumePiSubagentExecution")).toBe(true);

    const adapter = audit("Layers/PiAdapter.ts");
    const coordinatorImports = adapter.match(/resumePiSubagentExecutionCoordinator/g) ?? [];
    expect(coordinatorImports.length).toBeGreaterThan(0);
    // The ONLY production dispatch site is the explicit resumePiSubagentExecution
    // adapter method; no startup/recovery path may call it.
    const resumeMethodDefIndex = adapter.indexOf("const resumePiSubagentExecution: PiAdapterShape");
    expect(resumeMethodDefIndex).toBeGreaterThan(-1);
  });

  it("T14-AC1 state machine: the resume settlement resets lease/progress observations and re-binds the parent turn", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* PiSubagentExecutionRepository;
      yield* admitThenOrphan("exec_state_1");
      // Stale observations from the superseded attempt.
      yield* repository.recordHeartbeatObservation({
        executionId: "exec_state_1",
        occurredAt: BASE_TIME,
        leaseExpiresAt: BASE_TIME,
      });
      yield* repository.recordProgressObservation({
        executionId: "exec_state_1",
        progressJson: '{"p":"old attempt progress"}',
        occurredAt: BASE_TIME,
        droppedCountDelta: 3,
      });

      yield* resumePiSubagentExecution(
        makeResumeInput(repository, {
          executionId: "exec_state_1",
        }),
      );
      const observation = yield* repository.getObservation("exec_state_1");
      expect(Option.isSome(observation)).toBe(true);
      if (Option.isSome(observation)) {
        expect(observation.value.leaseExpiresAt).toBeNull();
        expect(observation.value.lastProgressAt).toBeNull();
      }
      const stored = yield* repository.getById("exec_state_1");
      const record = Option.getOrThrow(stored);
      expect(record.parentTurnId).toBe("turn_resume"); // re-bound to the authorizing turn
    });
    await Effect.runPromise(program.pipe(Effect.provide(repositoryLayer)));
  });
});
