import { describe, expect, it } from "vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import {
  PI_SUBAGENT_CAPABILITIES,
  type ThreadId,
} from "@synara/contracts";

import { NodeFileSystem } from "@effect/platform-node";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../agentGateway/Services/McpSessionAuthority.ts";
import { makeMcpSessionAuthorityRegistry } from "../agentGateway/mcpSessionAuthority.ts";
import { makePiAdapterLive } from "./Layers/PiAdapter.ts";
import { PiAdapter } from "./Services/PiAdapter.ts";
import { PI_SUBAGENT_TEARDOWN_BAND } from "./piSubagentProcessTeardown.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";
import {
  makeCompatiblePiSubagentExtension,
  PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
} from "./piSubagentBridge.ts";

class TeardownClock {
  private nowMs = Date.parse("2026-08-20T12:00:00.000Z");
  private seq = 0;
  private readonly tasks = new Array<{
    id: number;
    at: number;
    callback: () => void;
    cancelled: boolean;
  }>();

  readonly now = (): number => this.nowMs;

  readonly schedule = (delayMs: number, callback: () => void): { readonly cancel: () => void } => {
    this.seq += 1;
    const task = {
      id: this.seq,
      at: this.nowMs + Math.max(0, delayMs),
      callback,
      cancelled: false,
    };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  };

  async advance(ms: number): Promise<void> {
    this.nowMs += ms;
    for (;;) {
      const due = this.tasks
        .filter((task) => !task.cancelled && task.at <= this.nowMs)
        .sort((left, right) => left.at - right.at || left.id - right.id);
      if (due.length === 0) break;
      for (const task of due) {
        task.cancelled = true;
        task.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
    }
  }
}

const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
};

const withTempHome = async <T>(tempDir: string, run: () => Promise<T>): Promise<T> => {
  const previousHome = process.env.HOME;
  process.env.HOME = tempDir;
  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
};

function makeSetup() {
  const tempDir = `/tmp/synara-pi-d0033-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const serverConfig: ServerConfigShape = {
    mode: "web",
    port: 3776,
    host: "127.0.0.1",
    cwd: tempDir,
    homeDir: tempDir,
    chatWorkspaceRoot: tempDir,
    studioWorkspaceRoot: tempDir,
    baseDir: tempDir,
    stateDir: tempDir,
    secretsDir: tempDir,
    dbPath: `${tempDir}/state.sqlite`,
    settingsPath: `${tempDir}/settings.json`,
    keybindingsConfigPath: `${tempDir}/keybindings.json`,
    worktreesDir: tempDir,
    attachmentsDir: tempDir,
    logsDir: tempDir,
    serverLogPath: `${tempDir}/server.log`,
    serverRuntimeStatePath: `${tempDir}/runtime.json`,
    providerLogsDir: tempDir,
    providerEventLogPath: `${tempDir}/provider.ndjson`,
    terminalLogsDir: tempDir,
    environmentIdPath: `${tempDir}/env-id`,
    staticDir: undefined,
    devUrl: undefined,
    publicUrl: undefined,
    allowInsecureRemote: false,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
  };

  const registry = makeMcpSessionAuthorityRegistry();
  const authorityService: McpSessionAuthorityShape = {
    ...registry,
    mintForLocalOwner: () => registry.mint({ subject: "local-owner:test", kind: "local-owner" }),
    mintForAuthenticated: (session) =>
      registry.mint({
        subject: session.subject,
        kind: "authenticated",
        authSessionId: session.sessionId,
        authExpiresAt:
          session.expiresAt === undefined || session.expiresAt === null
            ? null
            : DateTime.toEpochMillis(session.expiresAt),
      }),
    bindingFor: (authorityId, opts) => registry.bindingFor(authorityId, opts),
  };

  const mintAuthority = (threadId: string) => {
    const authorityRecord = registry.mint({
      subject: `user:${threadId}`,
      kind: "authenticated",
      authSessionId: `auth:${threadId}`,
      authExpiresAt: null,
    });
    return registry.bindingFor(authorityRecord.authorityId, {
      threadId,
      provider: "pi",
      projectId: "proj_default",
      lifecycleGeneration: null,
      credentialTtlMs: 60 * 60 * 1_000,
    })!;
  };

  return { tempDir, serverConfig, authorityService, mintAuthority };
}

const seedProjectAndThread = (threadId: string, tempDir: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO projection_projects (
        project_id, kind, title, workspace_root, default_model_selection_json,
        scripts_json, created_at, updated_at
      ) VALUES (
        'proj_default', 'project', 'Default', ${tempDir}, '{"provider":"pi","model":"pi"}',
        '[]', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT OR IGNORE INTO projection_threads (
        thread_id, project_id, title, model_selection_json,
        runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
      ) VALUES (
        ${threadId}, 'proj_default', 'Decision 0033 thread',
        '{"provider":"pi","model":"pi"}',
        'full-access', 'default', 'local',
        '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
      )
    `;
  });

const seedHandedOffExecution = (
  repository: PiSubagentExecutionRepositoryShape,
  input: {
    executionId: string;
    attemptId: string;
    generation: number;
    parentThreadId: string;
  },
) =>
  Effect.gen(function* () {
    yield* repository.recordAdmission({
      executionId: input.executionId,
      attemptId: input.attemptId,
      generation: input.generation,
      commandId: `cmd_${input.executionId}`,
      commandFingerprint: `fp_${input.executionId}`,
      projectId: "proj_default",
      parentThreadId: input.parentThreadId as ThreadId,
      parentTurnId: `turn_${input.executionId}`,
      parentToolCallId: null,
      agentType: "general-purpose",
      prompt: `seed ${input.executionId}`,
      mode: "background",
      cancellationScope: "parent_turn",
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
      now: "2026-08-20T09:00:00.000Z",
    });
    yield* repository.recordLifecycleEvent({
      eventId: `evt_cancelling_${input.executionId}`,
      executionId: input.executionId,
      attemptId: input.attemptId,
      generation: input.generation,
      sequence: 2,
      state: "cancelling",
      occurredAt: "2026-08-20T11:58:00.000Z",
      diagnosticCode: "pi_subagent_cancel_escalated",
      diagnosticMessage: "fixture: cancelling before teardown",
    });
    yield* repository.recordWatchdogStageEvent({
      executionId: input.executionId,
      attemptId: input.attemptId,
      generation: input.generation,
      sequence: PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      state: "cancelling",
      occurredAt: "2026-08-20T11:59:00.000Z",
      diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
      diagnosticMessage: "fixture teardown handoff",
      metadata: { phase: "watchdog_escalation", reason: "session_stop_timeout" },
    });
  });

const driveToHandedOff = (
  repository: PiSubagentExecutionRepositoryShape,
  executionId: string,
) =>
  Effect.gen(function* () {
    const stored = yield* repository.getById(executionId);
    expect(Option.isSome(stored)).toBe(true);
    if (Option.isNone(stored)) return;

    const journal = yield* repository.listJournalEvents(executionId);
    const nextSequence = Math.max(2, ...journal.map((event) => event.sequence + 1));
    yield* repository.recordLifecycleEvent({
      eventId: `evt_cancelling_${executionId}`,
      executionId,
      attemptId: stored.value.attemptId,
      generation: stored.value.generation,
      sequence: nextSequence,
      state: "cancelling",
      occurredAt: "2026-08-20T11:58:00.000Z",
      diagnosticCode: "pi_subagent_cancel_escalated",
      diagnosticMessage: "fixture: cancelling before teardown",
    });
    yield* repository.recordWatchdogStageEvent({
      executionId,
      attemptId: stored.value.attemptId,
      generation: stored.value.generation,
      sequence: PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      state: "cancelling",
      occurredAt: "2026-08-20T11:59:00.000Z",
      diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
      diagnosticMessage: "fixture teardown handoff",
      metadata: { phase: "watchdog_escalation", reason: "session_stop_timeout" },
    });
  });

function findAgentExecute(session: any): (toolCallId: string, params: Record<string, unknown>) => Promise<any> {
  const loadedExt = session.resourceLoader
    .getExtensions()
    .extensions.find((extension: any) => extension.tools instanceof Map && extension.tools.has("Agent"));
  const entry = loadedExt?.tools.get("Agent");
  const executeFn = entry?.execute ?? entry?.definition?.execute;
  if (typeof executeFn !== "function") {
    throw new Error("Managed Agent tool execute function was not found");
  }
  return executeFn;
}

const runManagedSpawn = async (session: any, input: {
  commandId: string;
  prompt: string;
}): Promise<{ executionId: string; attemptId: string; generation: number }> => {
  const execute = findAgentExecute(session);
  const result = await execute(`call_${input.commandId}`, {
    commandId: input.commandId,
    subagent_type: "researcher",
    task: input.prompt,
    prompt: input.prompt,
    run_in_background: true,
    mode: "background",
  });
  return {
    executionId: String(result.executionId),
    attemptId: String(result.attemptId),
    generation: Number(result.generation),
  };
};

const expectProven = (repository: PiSubagentExecutionRepositoryShape, executionId: string) =>
  Effect.gen(function* () {
    const journal = yield* repository.listJournalEvents(executionId);
    expect(
      journal.some(
        (event) =>
          event.sequence === PI_SUBAGENT_TEARDOWN_BAND.proven &&
          event.diagnosticCode === "pi_subagent_teardown_proven",
      ),
    ).toBe(true);
    const stored = yield* repository.getById(executionId);
    expect(Option.isSome(stored)).toBe(true);
    if (Option.isSome(stored)) {
      expect(stored.value.observedState).toBe("cancelled");
      expect(stored.value.generation).toBe(2);
    }
  });

const expectSurvivors = (
  repository: PiSubagentExecutionRepositoryShape,
  executionId: string,
  survivorPids: number[],
) =>
  Effect.gen(function* () {
    const journal = yield* repository.listJournalEvents(executionId);
    const outcomeRow = journal.find(
      (event) =>
        event.sequence === PI_SUBAGENT_TEARDOWN_BAND.survivors &&
        event.diagnosticCode === "pi_subagent_teardown_survivors",
    );
    expect(outcomeRow).toBeDefined();
    // Review F2: the bounded survivor PID evidence the identity-matched owner
    // reported is DURABLY STORED on the band-77 row — not merely implied by
    // the outcome kind.
    const metadata = (outcomeRow!.metadata ?? {}) as Record<string, unknown>;
    expect(metadata.survivorPids).toEqual(survivorPids);
    expect(outcomeRow!.diagnosticMessage).toContain(`(${survivorPids.join(", ")})`);
    const stored = yield* repository.getById(executionId);
    expect(Option.isSome(stored)).toBe(true);
    if (Option.isSome(stored)) {
      expect(stored.value.observedState).toBe("cancelling");
      expect(stored.value.generation).toBe(1);
    }
  });

const expectOwnerUnproven = (repository: PiSubagentExecutionRepositoryShape, executionId: string) =>
  Effect.gen(function* () {
    const journal = yield* repository.listJournalEvents(executionId);
    expect(
      journal.some(
        (event) =>
          event.sequence === PI_SUBAGENT_TEARDOWN_BAND.ownerUnproven &&
          event.diagnosticCode === "pi_subagent_teardown_owner_unproven",
      ),
    ).toBe(true);
    expect(
      journal.some((event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.proven),
    ).toBe(false);
    expect(
      journal.some((event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.survivors),
    ).toBe(false);
    const stored = yield* repository.getById(executionId);
    expect(Option.isSome(stored)).toBe(true);
    if (Option.isSome(stored)) {
      expect(stored.value.observedState).toBe("cancelling");
      expect(stored.value.generation).toBe(1);
    }
  });

describe("PiAdapter Decision 0033 managed-child teardown wiring", () => {
  it("routes exact execution identity through the retained owner endpoint and settles proven", async () => {
    const setup = makeSetup();
    const clock = new TeardownClock();
    const teardownCalls: Array<{
      executionId: string;
      attemptId: string;
      generation: number;
    }> = [];
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      onSpawn: () => ({
        status: "accepted",
        executionId: "exec_d33_proven",
        attemptId: "att_d33_proven",
        generation: 1,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
      }),
      onTeardownOwnedProcesses: async (command) => {
        teardownCalls.push({
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        });
        return {
          status: "proven",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        };
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentTeardownClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProjectAndThread("th_d33_proven", setup.tempDir);
      const adapter = yield* PiAdapter;
      const repository = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_d33_proven" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mintAuthority("th_d33_proven"),
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const spawned = yield* Effect.promise(() =>
        runManagedSpawn(observedSession, {
          commandId: "cmd_d33_proven",
          prompt: "prove teardown",
        }),
      );
      yield* driveToHandedOff(repository, spawned.executionId);

      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      expect(teardownCalls).toEqual([
        {
          executionId: spawned.executionId,
          attemptId: spawned.attemptId,
          generation: 1,
        },
      ]);
      yield* expectProven(repository, spawned.executionId);
    });

    await withTempHome(setup.tempDir, () =>
      Effect.runPromise(program.pipe(Effect.provide(testLayer))),
    );
  });

  it("maps validated survivors replies onto the existing band-77 coordinator path", async () => {
    const setup = makeSetup();
    const clock = new TeardownClock();
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      onSpawn: () => ({
        status: "accepted",
        executionId: "exec_d33_survivors",
        attemptId: "att_d33_survivors",
        generation: 1,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
      }),
      onTeardownOwnedProcesses: async (command) => ({
        status: "survivors",
        executionId: command.executionId,
        attemptId: command.expectedAttemptId,
        generation: command.expectedGeneration,
        survivorPids: [4242, 4243],
      }),
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentTeardownClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProjectAndThread("th_d33_survivors", setup.tempDir);
      const adapter = yield* PiAdapter;
      const repository = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_d33_survivors" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mintAuthority("th_d33_survivors"),
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const spawned = yield* Effect.promise(() =>
        runManagedSpawn(observedSession, {
          commandId: "cmd_d33_survivors",
          prompt: "survivors teardown",
        }),
      );
      yield* driveToHandedOff(repository, spawned.executionId);

      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      yield* expectSurvivors(repository, spawned.executionId, [4242, 4243]);
    });

    await withTempHome(setup.tempDir, () =>
      Effect.runPromise(program.pipe(Effect.provide(testLayer))),
    );
  });

  it("maps invalid owner replies to band 78 without parent supervisor fallback", async () => {
    const invalidCases = [
      {
        label: "capability_absent",
        capabilities: PI_SUBAGENT_CAPABILITIES.filter(
          (capability) => capability !== PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
        ),
        teardown: undefined,
      },
      { label: "malformed", teardown: async () => ({ nope: true }) },
      {
        label: "mismatched",
        teardown: async () => ({
          status: "proven",
          executionId: "wrong_exec",
          attemptId: "wrong_att",
          generation: 7,
        }),
      },
      {
        label: "throw",
        teardown: async () => {
          throw new Error("owner endpoint exploded");
        },
      },
      {
        label: "stale",
        teardown: async (command: any) => ({
          status: "stale",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        }),
      },
      {
        label: "missing",
        teardown: async (command: any) => ({
          status: "missing",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        }),
      },
      {
        label: "owner_unavailable",
        teardown: async (command: any) => ({
          status: "owner_unavailable",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        }),
      },
        {
          label: "dispatch_failed",
          teardown: async (command: any) => ({
            status: "dispatch_failed",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          }),
        },
        // Decision 0033 survivor evidence is contract-canonical. A malformed
        // owner report must fail closed to band 78, never create band 77.
        {
          label: "survivors_empty",
          teardown: async (command: any) => ({
            status: "survivors",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
            survivorPids: [],
          }),
        },
        {
          label: "survivors_unsorted",
          teardown: async (command: any) => ({
            status: "survivors",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
            survivorPids: [2, 1],
          }),
        },
        {
          label: "survivors_duplicated",
          teardown: async (command: any) => ({
            status: "survivors",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
            survivorPids: [1, 1],
          }),
        },
        {
          label: "survivors_over_cap",
          teardown: async (command: any) => ({
            status: "survivors",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
            survivorPids: Array.from({ length: 17 }, (_, index) => index + 1),
          }),
        },
      ] as const;

    for (const invalidCase of invalidCases) {
      const setup = makeSetup();
      const clock = new TeardownClock();
      let observedSession: any;
      let processSupervisorCalls = 0;

      const { extension } = makeCompatiblePiSubagentExtension({
        ...(invalidCase.capabilities === undefined
          ? {}
          : { capabilities: [...invalidCase.capabilities] }),
        onSpawn: () => ({
          status: "accepted",
          executionId: `exec_${invalidCase.label}`,
          attemptId: `att_${invalidCase.label}`,
          generation: 1,
          state: "accepted",
          diagnosticCode: "pi_subagent_managed_enabled",
        }),
        ...(invalidCase.teardown === undefined
          ? {}
          : { onTeardownOwnedProcesses: invalidCase.teardown }),
      });

      const testLayer = Layer.mergeAll(
        makePiAdapterLive({
          extensionFactories: [extension.factory],
          piSubagentTeardownClock: clock,
          onSubagentCapability: (event) => {
            observedSession = event.session;
            (event.context.processSupervisor as any).teardownAll = async () => {
              processSupervisorCalls += 1;
            };
          },
        }).pipe(
          Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
          Layer.provide(NodeFileSystem.layer),
          Layer.provide(PiSubagentExecutionRepositoryLive),
          Layer.provide(OrchestrationProjectionSnapshotQueryLive),
          Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
          Layer.provide(SqlitePersistenceMemory),
        ),
        PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        SqlitePersistenceMemory,
      );

      const program = Effect.gen(function* () {
        const threadId = `th_${invalidCase.label}`;
        yield* seedProjectAndThread(threadId, setup.tempDir);
        const adapter = yield* PiAdapter;
        const repository = yield* PiSubagentExecutionRepository;

        yield* adapter.startSession({
          threadId: threadId as ThreadId,
          cwd: setup.tempDir,
          mcpAuthority: setup.mintAuthority(threadId),
          runtimeMode: "full-access",
          providerOptions: { pi: { agentDir: setup.tempDir } },
        } as any);

        const spawned = yield* Effect.promise(() =>
          runManagedSpawn(observedSession, {
            commandId: `cmd_${invalidCase.label}`,
            prompt: invalidCase.label,
          }),
        );
        yield* driveToHandedOff(repository, spawned.executionId);

        yield* Effect.promise(() => clock.advance(30_100));
        yield* Effect.promise(() => settle());

        expect(processSupervisorCalls).toBe(0);
        yield* expectOwnerUnproven(repository, spawned.executionId);
      });

      await withTempHome(setup.tempDir, () =>
        Effect.runPromise(program.pipe(Effect.provide(testLayer))),
      );
    }
  });

    it("times out a never-settling owner endpoint into durable band 78 and keeps scheduling subsequent sweep passes", async () => {
    const setup = makeSetup();
    const clock = new TeardownClock();
    const teardownCalls: string[] = [];
    let observedSession: any;
    let processSupervisorCalls = 0;

    const { extension } = makeCompatiblePiSubagentExtension({
      onSpawn: () => ({
        status: "accepted",
        executionId: "exec_d33_timeout",
        attemptId: "att_d33_timeout",
        generation: 1,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
      }),
      // The admitted endpoint never settles: only the host-side bound (the
      // existing Pi watchdog stage timeout injected through the server
      // config — no new knob) can end the dispatch.
      onTeardownOwnedProcesses: (command) => {
        teardownCalls.push(command.executionId);
        return new Promise(() => {});
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentTeardownClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
          (event.context.processSupervisor as any).teardownAll = async () => {
            processSupervisorCalls += 1;
          };
        },
      }).pipe(
        Layer.provide(
          Layer.succeed(ServerConfig, {
            ...setup.serverConfig,
            piSubagentWatchdogStageTimeoutMs: 100,
          }),
        ),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    // One sweep pass: fire the virtual sweep timer, then let the real
    // 100ms host-side dispatch bound elapse before flushing microtasks.
    const runOneSweepPass = async () => {
      await clock.advance(30_100);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await settle();
      await settle();
    };

    const program = Effect.gen(function* () {
      yield* seedProjectAndThread("th_d33_timeout", setup.tempDir);
      const adapter = yield* PiAdapter;
      const repository = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_d33_timeout" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mintAuthority("th_d33_timeout"),
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const spawned = yield* Effect.promise(() =>
        runManagedSpawn(observedSession, {
          commandId: "cmd_d33_timeout",
          prompt: "never-settling owner endpoint",
        }),
      );
      yield* driveToHandedOff(repository, spawned.executionId);

      // First pass: the bounded dispatch elapses, the coordinator journals
      // the honest non-terminal outcome, and the pass completes.
      yield* Effect.promise(() => runOneSweepPass());

      expect(teardownCalls).toEqual([spawned.executionId]);
      const journal = yield* repository.listJournalEvents(spawned.executionId);
      // Band 75 request FIRST, then the band 78 owner_unproven outcome —
      // never band 76 (proven) or band 77 (survivors).
      const sequences = journal.map((event) => event.sequence);
      expect(sequences.indexOf(PI_SUBAGENT_TEARDOWN_BAND.request)).toBeGreaterThanOrEqual(0);
      expect(
        sequences.indexOf(PI_SUBAGENT_TEARDOWN_BAND.request),
      ).toBeLessThan(sequences.indexOf(PI_SUBAGENT_TEARDOWN_BAND.ownerUnproven));
      expect(
        journal.some(
          (event) =>
            event.sequence === PI_SUBAGENT_TEARDOWN_BAND.ownerUnproven &&
            event.diagnosticCode === "pi_subagent_teardown_owner_unproven",
        ),
      ).toBe(true);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.proven),
      ).toBe(false);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.survivors),
      ).toBe(false);

      // Non-terminal and unfenced: cancelling, generation unchanged, so a
      // later validated owner can still prove teardown.
      const stored = yield* repository.getById(spawned.executionId);
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("cancelling");
        expect(stored.value.desiredState).toBe("cancelling");
        expect(stored.value.generation).toBe(1);
      }
      // No parent supervisor fallback was ever consulted.
      expect(processSupervisorCalls).toBe(0);

      // The sweep scheduled a subsequent pass and re-dispatched to the
      // same retained owner endpoint.
      yield* Effect.promise(() => runOneSweepPass());
      expect(teardownCalls).toEqual([spawned.executionId, spawned.executionId]);
      const stillStored = yield* repository.getById(spawned.executionId);
      expect(Option.isSome(stillStored)).toBe(true);
      if (Option.isSome(stillStored)) {
        expect(stillStored.value.observedState).toBe("cancelling");
        expect(stillStored.value.generation).toBe(1);
      }
      expect(processSupervisorCalls).toBe(0);
    });

    await withTempHome(setup.tempDir, () =>
      Effect.runPromise(program.pipe(Effect.provide(testLayer))),
      );
    });

    it("retains the exact owner after a durable proven-outcome write fails so the next sweep can retry proof", async () => {
      const setup = makeSetup();
      const clock = new TeardownClock();
      const teardownCalls: string[] = [];
      let observedSession: any;
      let remainingOutcomeWriteFailures = 1;
      const repositoryRef: { current: PiSubagentExecutionRepositoryShape | undefined } = {
        current: undefined,
      };
      const injectedRepository = new Proxy({} as PiSubagentExecutionRepositoryShape, {
        get(_target, property) {
          const repository = repositoryRef.current;
          if (repository === undefined) {
            throw new Error("test repository was not bound before use");
          }
          if (property === "recordTeardownOutcome") {
            return (
              input: Parameters<PiSubagentExecutionRepositoryShape["recordTeardownOutcome"]>[0],
            ) => {
              if (remainingOutcomeWriteFailures > 0) {
                remainingOutcomeWriteFailures -= 1;
                return Effect.fail(new Error("forced proven-outcome persistence failure") as never);
              }
              return repository.recordTeardownOutcome(input);
            };
          }
          const value = (repository as any)[property];
          return typeof value === "function" ? value.bind(repository) : value;
        },
      });
      const { extension } = makeCompatiblePiSubagentExtension({
        onSpawn: () => ({
          status: "accepted",
          executionId: "exec_d33_proven_retry",
          attemptId: "att_d33_proven_retry",
          generation: 1,
          state: "accepted",
          diagnosticCode: "pi_subagent_managed_enabled",
        }),
        onTeardownOwnedProcesses: async (command) => {
          teardownCalls.push(command.executionId);
          return {
            status: "proven",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          };
        },
      });
      const testLayer = Layer.mergeAll(
        makePiAdapterLive({
          extensionFactories: [extension.factory],
          piSubagentRepository: injectedRepository,
          piSubagentTeardownClock: clock,
          onSubagentCapability: (event) => {
            observedSession = event.session;
          },
        }).pipe(
          Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
          Layer.provide(NodeFileSystem.layer),
          Layer.provide(PiSubagentExecutionRepositoryLive),
          Layer.provide(OrchestrationProjectionSnapshotQueryLive),
          Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
          Layer.provide(SqlitePersistenceMemory),
        ),
        PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        SqlitePersistenceMemory,
      );

      const program = Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        repositoryRef.current = repository;
        const adapter = yield* PiAdapter;
        yield* seedProjectAndThread("th_d33_proven_retry", setup.tempDir);
        yield* adapter.startSession({
          threadId: "th_d33_proven_retry" as ThreadId,
          cwd: setup.tempDir,
          mcpAuthority: setup.mintAuthority("th_d33_proven_retry"),
          runtimeMode: "full-access",
          providerOptions: { pi: { agentDir: setup.tempDir } },
        } as any);
        const spawned = yield* Effect.promise(() =>
          runManagedSpawn(observedSession, {
            commandId: "cmd_d33_proven_retry",
            prompt: "retry proven owner after persistence failure",
          }),
        );
        yield* driveToHandedOff(repository, spawned.executionId);

        // Valid owner proof arrives, but the durable band-76/fence write fails.
        // The mapping must remain: this is cancelling generation 1 with no
        // terminal teardown claim, not a reason to fall back to band 78.
        yield* Effect.promise(() => clock.advance(30_100));
        yield* Effect.promise(() => settle());
        expect(teardownCalls).toEqual([spawned.executionId]);
        const afterFailure = yield* repository.getById(spawned.executionId);
        expect(Option.isSome(afterFailure)).toBe(true);
        if (Option.isSome(afterFailure)) {
          expect(afterFailure.value.observedState).toBe("cancelling");
          expect(afterFailure.value.generation).toBe(1);
        }
        const journalAfterFailure = yield* repository.listJournalEvents(spawned.executionId);
        expect(
          journalAfterFailure.some((event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.proven),
        ).toBe(false);
        expect(
          journalAfterFailure.some(
            (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.ownerUnproven,
          ),
        ).toBe(false);

        // The retained exact endpoint receives the same execution identity on
        // the next pass; only this successful durable write may release it.
        yield* Effect.promise(() => clock.advance(30_100));
        yield* Effect.promise(() => settle());
        expect(teardownCalls).toEqual([spawned.executionId, spawned.executionId]);
        yield* expectProven(repository, spawned.executionId);
      });

      await withTempHome(setup.tempDir, () =>
        Effect.runPromise(program.pipe(Effect.provide(testLayer))),
      );
    });

    it("retains a capability-bearing owner endpoint across same-process parent session stop", async () => {
    const setup = makeSetup();
    const clock = new TeardownClock();
    const teardownCalls: string[] = [];
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      onSpawn: () => ({
        status: "accepted",
        executionId: "exec_d33_stopped",
        attemptId: "att_d33_stopped",
        generation: 1,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
      }),
      onTeardownOwnedProcesses: async (command) => {
        teardownCalls.push(command.executionId);
        return {
          status: "proven",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        };
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentTeardownClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProjectAndThread("th_d33_stopped", setup.tempDir);
      const adapter = yield* PiAdapter;
      const repository = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_d33_stopped" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mintAuthority("th_d33_stopped"),
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const spawned = yield* Effect.promise(() =>
        runManagedSpawn(observedSession, {
          commandId: "cmd_d33_stopped",
          prompt: "retain owner across stop",
        }),
      );
      yield* adapter.stopSession("th_d33_stopped" as ThreadId);
      yield* driveToHandedOff(repository, spawned.executionId);

      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      expect(teardownCalls).toEqual([spawned.executionId]);
      yield* expectProven(repository, spawned.executionId);
    });

    await withTempHome(setup.tempDir, () =>
      Effect.runPromise(program.pipe(Effect.provide(testLayer))),
    );
  });

  it("starts with an empty registry after adapter process restart and maps missing/disposed owners to undefined", async () => {
    const setup = makeSetup();
    const clock = new TeardownClock();

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        piSubagentTeardownClock: clock,
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProjectAndThread("th_d33_restart", setup.tempDir);
      const repository = yield* PiSubagentExecutionRepository;
      yield* seedHandedOffExecution(repository, {
        executionId: "exec_d33_restart",
        attemptId: "att_d33_restart",
        generation: 1,
        parentThreadId: "th_d33_restart",
      });

      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      yield* expectOwnerUnproven(repository, "exec_d33_restart");
    });

    await withTempHome(setup.tempDir, () =>
      Effect.runPromise(program.pipe(Effect.provide(testLayer))),
      );
    });

    it("isolates sibling and historical same-thread owner endpoints by exact execution identity", async () => {
    const setup = makeSetup();
    const clock = new TeardownClock();
    let observedSession: any;
    const oldAcceptedCalls: string[] = [];
    const newAcceptedCalls: string[] = [];
    const oldRejectedCalls: string[] = [];
    const newRejectedCalls: string[] = [];
    let oldExpectedExecutionId: string | undefined;
    let newExpectedExecutionId: string | undefined;

    const oldFixture = makeCompatiblePiSubagentExtension({
      onSpawn: () => ({
        status: "accepted",
        executionId: "exec_d33_old",
        attemptId: "att_d33_old",
        generation: 1,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
      }),
      onTeardownOwnedProcesses: async (command) => {
        if (command.executionId !== oldExpectedExecutionId) {
          oldRejectedCalls.push(command.executionId);
          return {
            status: "stale",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          };
        }
        oldAcceptedCalls.push(command.executionId);
        return {
          status: "proven",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        };
      },
    });
    const newFixture = makeCompatiblePiSubagentExtension({
      onSpawn: () => ({
        status: "accepted",
        executionId: "exec_d33_new",
        attemptId: "att_d33_new",
        generation: 1,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
      }),
      onTeardownOwnedProcesses: async (command) => {
        if (command.executionId !== newExpectedExecutionId) {
          newRejectedCalls.push(command.executionId);
          return {
            status: "stale",
            executionId: command.executionId,
            attemptId: command.expectedAttemptId,
            generation: command.expectedGeneration,
          };
        }
        newAcceptedCalls.push(command.executionId);
        return {
          status: "proven",
          executionId: command.executionId,
          attemptId: command.expectedAttemptId,
          generation: command.expectedGeneration,
        };
      },
    });
    expect(oldFixture.bridge).not.toBe(newFixture.bridge);

    let sessionFactoryCallCount = 0;
    const extensionFactory = (pi: any) => {
      sessionFactoryCallCount += 1;
      if (sessionFactoryCallCount === 1) {
        return oldFixture.extension.factory(pi);
      }
      if (sessionFactoryCallCount === 2) {
        return newFixture.extension.factory(pi);
      }
      throw new Error(`Unexpected extension factory invocation #${String(sessionFactoryCallCount)}`);
    };

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extensionFactory],
        piSubagentTeardownClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProjectAndThread("th_d33_isolated", setup.tempDir);
      const adapter = yield* PiAdapter;
      const repository = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_d33_isolated" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mintAuthority("th_d33_isolated"),
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);
      const oldSpawned = yield* Effect.promise(() =>
        runManagedSpawn(observedSession, {
          commandId: "cmd_d33_old",
          prompt: "old owner",
        }),
      );
      oldExpectedExecutionId = oldSpawned.executionId;
      yield* adapter.stopSession("th_d33_isolated" as ThreadId);

      yield* adapter.startSession({
        threadId: "th_d33_isolated" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mintAuthority("th_d33_isolated"),
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);
      const newSpawned = yield* Effect.promise(() =>
        runManagedSpawn(observedSession, {
          commandId: "cmd_d33_new",
          prompt: "new owner",
        }),
      );
      newExpectedExecutionId = newSpawned.executionId;

      yield* driveToHandedOff(repository, oldSpawned.executionId);
      yield* driveToHandedOff(repository, newSpawned.executionId);
      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      expect(sessionFactoryCallCount).toBe(2);
      expect(oldAcceptedCalls).toEqual([oldSpawned.executionId]);
      expect(newAcceptedCalls).toEqual([newSpawned.executionId]);
      expect(oldRejectedCalls).toEqual([]);
      expect(newRejectedCalls).toEqual([]);
      yield* expectProven(repository, oldSpawned.executionId);
      yield* expectProven(repository, newSpawned.executionId);
    });

    await withTempHome(setup.tempDir, () =>
      Effect.runPromise(program.pipe(Effect.provide(testLayer))),
    );
  });
});
