import { DateTime, Effect, Layer, Option, Stream } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { PI_SUBAGENTS_PROTOCOL_VERSION, type ThreadId } from "@synara/contracts";

import { makeMcpSessionAuthorityRegistry } from "../agentGateway/mcpSessionAuthority.ts";
import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../agentGateway/Services/McpSessionAuthority.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import {
  makePiSubagentExecutionRepository,
  PiSubagentExecutionRepositoryLive,
} from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { makePiAdapterLive } from "./Layers/PiAdapter.ts";
import {
  getPiSubagentManagedForegroundBinding,
  makeCompatiblePiSubagentExtension,
  type PiSubagentManagedForegroundBinding,
} from "./piSubagentBridge.ts";
import { makePiSubagentControlHealth } from "./piSubagentControlHealth.ts";
import { PiAdapter } from "./Services/PiAdapter.ts";

/**
 * Ticket 23 / WP-B server-side dispatch evidence (T23-AC2/AC3/AC4/AC5):
 * a captured managed binding is flooded with progress/heartbeat observations
 * while the server-side coalescer runs on a manually-driven virtual clock
 * (injected via the PiAdapterLiveOptions.piSubagentProgressClock test seam),
 * proving:
 * - tool.progress emission is capped at rateHz with trailing-edge latest
 *   snapshot semantics and exact dropped-count accounting;
 * - heartbeat refreshes the durable lease with NO emission and NO journal;
 * - lifecycle started/detached journal writes are never discarded by the
 *   flood (they never enter the coalescer);
 * - observation persistence failure is swallowed while lifecycle persistence
 *   failure still degrades control health.
 *
 * Determinism note: vitest fake timers cannot be used here because this
 * Effect version's scheduler never resolves under them (Effect.sleep waits
 * on real-time microtask chains the fakes do not drive), and the adapter
 * layer graph relies on Effect timers for its runtime-event queue. The
 * virtual clock drives ONLY the coalescer's timers, keeping the flood
 * evidence wall-clock independent.
 */
class VirtualClock {
  private nowMs: number = 0;
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
    return {
      cancel: () => {
        task.cancelled = true;
      },
    };
  };

  pendingCount = (): number => this.tasks.filter((t) => !t.cancelled).length;

  /** Fires every scheduled callback due at now+ms, in due order. */
  async advance(ms: number): Promise<void> {
    this.nowMs += ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => !t.cancelled && t.at <= this.nowMs)
        .toSorted((a, b) => a.at - b.at || a.id - b.id);
      if (due.length === 0) break;
      for (const task of due) {
        task.cancelled = true; // fire exactly once
        task.callback();
        // Let flushed persistence promises settle between callbacks.
        await Promise.resolve();
        await Promise.resolve();
      }
    }
  }
}

function makeTestSetup(options?: {
  readonly foregroundWaitMs?: number;
  readonly progressRateHz?: number;
  readonly heartbeatIntervalMs?: number;
  readonly leaseDurationMs?: number;
}) {
  const tempDir = `/tmp/synara-pi-t23-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const serverConfig: ServerConfigShape = {
    mode: "web",
    port: 3775,
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
    ...(options?.foregroundWaitMs !== undefined
      ? { piSubagentForegroundWaitMs: options.foregroundWaitMs }
      : {}),
    ...(options?.progressRateHz !== undefined
      ? { piSubagentProgressRateHz: options.progressRateHz }
      : {}),
    ...(options?.heartbeatIntervalMs !== undefined
      ? { piSubagentHeartbeatIntervalMs: options.heartbeatIntervalMs }
      : {}),
    ...(options?.leaseDurationMs !== undefined
      ? { piSubagentLeaseDurationMs: options.leaseDurationMs }
      : {}),
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

  const authorityRecord = registry.mint({
    subject: "user_test_t23",
    kind: "authenticated",
    authSessionId: "auth-session-t23",
    authExpiresAt: null,
  });

  const mcpAuthority = registry.bindingFor(authorityRecord.authorityId, {
    threadId: "th_t23_test_1",
    provider: "pi",
    projectId: "proj_default",
    lifecycleGeneration: null,
    credentialTtlMs: 60 * 60 * 1_000,
  })!;

  return { tempDir, serverConfig, authorityService, mcpAuthority };
}

const seedProjections = (threadId = "th_t23_test_1", tempDir = "/tmp") =>
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
        ${threadId}, 'proj_default', 'T23 progress thread',
        '{"provider":"pi","model":"pi"}',
        'full-access', 'default', 'local',
        '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
      )
    `;
  });

/**
 * Wraps the live repository with observation-capturing proxies and optional
 * injected failures, mirroring the lifecycle-test repository wrap pattern.
 */
function makeObservingRepoLayer(hooks?: {
  readonly onProgress?: (call: { progressJson: string; coalescedCount: number }) => void;
  readonly onHeartbeat?: (call: { occurredAt: string; leaseExpiresAt: string }) => void;
  readonly failObservation?: () => boolean;
  readonly failLifecycle?: () => boolean;
}) {
  const progressCalls: Array<{ progressJson: string; coalescedCount: number }> = [];
  const heartbeatCalls: Array<{ occurredAt: string; leaseExpiresAt: string }> = [];
  const CustomRepoLayer = Layer.effect(
    PiSubagentExecutionRepository,
    Effect.gen(function* () {
      const baseRepo = yield* makePiSubagentExecutionRepository;
      const wrapped: PiSubagentExecutionRepositoryShape = {
        ...baseRepo,
        recordProgressObservation: (input) => {
          const call = {
            progressJson: input.progressJson,
            coalescedCount: input.droppedCountDelta,
          };
          progressCalls.push(call);
          hooks?.onProgress?.(call);
          if (hooks?.failObservation?.()) {
            return Effect.fail({
              _tag: "PersistenceSqlError",
              message: "Injected progress observation failure",
            } as any);
          }
          return baseRepo.recordProgressObservation(input);
        },
        recordHeartbeatObservation: (input) => {
          const call = { occurredAt: input.occurredAt, leaseExpiresAt: input.leaseExpiresAt };
          heartbeatCalls.push(call);
          hooks?.onHeartbeat?.(call);
          if (hooks?.failObservation?.()) {
            return Effect.fail({
              _tag: "PersistenceSqlError",
              message: "Injected heartbeat observation failure",
            } as any);
          }
          return baseRepo.recordHeartbeatObservation(input);
        },
        recordLifecycleEvent: (input) => {
          if (hooks?.failLifecycle?.()) {
            return Effect.fail({
              _tag: "PersistenceSqlError",
              message: "Injected lifecycle persistence failure",
            } as any);
          }
          return baseRepo.recordLifecycleEvent(input);
        },
      };
      return wrapped;
    }),
  ).pipe(Layer.provide(SqlitePersistenceMemory));
  return { CustomRepoLayer, progressCalls, heartbeatCalls };
}

const makeCapturingExtension = (hooks: {
  readonly onBinding?: (binding: PiSubagentManagedForegroundBinding) => void;
}) => {
  const { extension } = makeCompatiblePiSubagentExtension({
    protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
    capabilities: [
      "managed-spawn",
      "abort-propagation",
      "bounded-foreground-attachment",
      "coalesced-progress",
      "execution-identity-routing-v1",
    ],
    extensionVersion: "0.15.0-alfie.6",
  });
  return {
    name: "pi-subagents",
    factory: (pi: any) => {
      extension.factory(pi);
      if (pi && typeof pi.registerTool === "function") {
        pi.registerTool({
          name: "Agent",
          label: "Managed Agent",
          description: "Managed Pi subagent tool",
          parameters: {} as any,
          execute: async (
            _toolCallId: string,
            _params: any,
            _signal: any,
            _onUpdate: any,
            ctx: any,
          ) => {
            const binding = getPiSubagentManagedForegroundBinding(ctx);
            if (binding) {
              hooks.onBinding?.(binding);
            }
            return { content: [{ type: "text", text: "ok" }] };
          },
        });
      }
    },
    [Symbol.for("synara.pi.subagents.bridge")]: (extension as any)[
      Symbol.for("synara.pi.subagents.bridge")
    ],
  };
};

describe("Pi subagent progress observation dispatch (Issue 23 / WP-B)", () => {
  it("T23-AC2: flood of 5000 progress observations is capped at rateHz with trailing-edge latest snapshot and exact dropped counters", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;

    const setup = makeTestSetup({
      progressRateHz: 2, // 500 ms flush interval
      heartbeatIntervalMs: 10000,
      leaseDurationMs: 30000,
    });

    const runtimeEvents: any[] = [];
    const { CustomRepoLayer, progressCalls } = makeObservingRepoLayer();
    const clock = new VirtualClock();

    const extension = makeCapturingExtension({
      onBinding: (binding) => {
        capturedBinding = binding;
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentProgressClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(CustomRepoLayer),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      CustomRepoLayer,
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      yield* seedProjections("th_t23_test_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t23_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      yield* Effect.promise(() =>
        executeFn("call_t23_flood", {
          commandId: "cmd_t23_flood",
          subagent_type: "researcher",
          task: "Flood",
          prompt: "Flood",
        }),
      );
      expect(capturedBinding).toBeDefined();
      yield* Effect.promise(() =>
        capturedBinding!.reportObservation({
          kind: "started",
          occurredAt: "2026-08-18T00:00:00.000Z",
        }),
      );

      // Flood N = 5000 progress observations over 10 simulated seconds.
      // The flood advances virtual time 2 ms per observation (10 s total),
      // so the coalescer's 500 ms trailing edge fires exactly 20 times.
      const N = 5000;
      for (let i = 0; i < N; i += 1) {
        yield* Effect.promise(() => clock.advance(2));
        yield* Effect.promise(() =>
          capturedBinding!.reportObservation({
            kind: "progress",
            occurredAt: new Date(i * 2).toISOString(),
            progressJson: JSON.stringify({ turnCount: i + 1, activity: `step ${i + 1}` }),
          }),
        );
      }
      // Flush the trailing slot: one full flush interval more.
      yield* Effect.promise(() => clock.advance(600));
      // Macrotask turns so the forked collector fiber drains the queue.
      yield* Effect.sleep(150);

      const toolProgressEvents = runtimeEvents.filter((e) => e.type === "tool.progress");
      // Cap: rateHz × duration + 1 (the +1 covers the initial trailing edge).
      expect(toolProgressEvents.length).toBeLessThanOrEqual(2 * (10_000 / 1000) + 1);
      expect(toolProgressEvents.length).toBeGreaterThanOrEqual(19);

      // Trailing edge: the LAST payload wins on the final flush.
      expect(progressCalls.length).toBeGreaterThan(0);
      const lastPersisted = JSON.parse(progressCalls[progressCalls.length - 1]!.progressJson);
      expect(lastPersisted.turnCount).toBeGreaterThanOrEqual(N - 2);

      // Counters are exact: emitted + coalesced == N.
      const coalescedSum = progressCalls.reduce((acc, c) => acc + c.coalescedCount, 0);
      expect(coalescedSum + progressCalls.length).toBe(N);

      // No message-like runtime events emitted by progress observation.
      const messageLike = runtimeEvents.filter((e) =>
        ["message.completed", "message.updated", "tool.started", "tool.completed"].includes(e.type),
      );
      expect(messageLike).toHaveLength(0);

      yield* adapter.stopSession("th_t23_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("T23-AC3: heartbeat observations refresh the durable lease with no emissions and no journal writes", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;

    const setup = makeTestSetup({
      progressRateHz: 2,
      heartbeatIntervalMs: 10000,
      leaseDurationMs: 30000,
    });

    const runtimeEvents: any[] = [];
    const { CustomRepoLayer, heartbeatCalls } = makeObservingRepoLayer();
    const clock = new VirtualClock();

    const extension = makeCapturingExtension({
      onBinding: (binding) => {
        capturedBinding = binding;
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentProgressClock: clock,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(CustomRepoLayer),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      CustomRepoLayer,
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      yield* seedProjections("th_t23_test_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t23_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      yield* Effect.promise(() =>
        executeFn("call_t23_hb", {
          commandId: "cmd_t23_hb",
          subagent_type: "researcher",
          task: "Heartbeat",
          prompt: "Heartbeat",
        }),
      );
      expect(capturedBinding).toBeDefined();
      const executionId = capturedBinding!.executionId;
      yield* Effect.promise(() =>
        capturedBinding!.reportObservation({
          kind: "started",
          occurredAt: "2026-08-18T01:00:00.000Z",
        }),
      );

      // Three heartbeats ~10 s apart.
      const heartbeatTimes = [
        "2026-08-18T01:00:00.000Z",
        "2026-08-18T01:00:10.000Z",
        "2026-08-18T01:00:20.000Z",
      ];
      for (const occurredAt of heartbeatTimes) {
        yield* Effect.promise(() =>
          capturedBinding!.reportObservation({ kind: "heartbeat", occurredAt }),
        );
      }
      // Fire-and-forget writes settle (macrotask turns for the Effect
      // runPromise dispatches and the collector fiber).
      yield* Effect.sleep(200);

      // Lease math: occurredAt + 30000 ms exactly.
      expect(heartbeatCalls).toHaveLength(3);
      expect(heartbeatCalls[0]!.leaseExpiresAt).toBe("2026-08-18T01:00:30.000Z");
      expect(heartbeatCalls[2]!.leaseExpiresAt).toBe("2026-08-18T01:00:50.000Z");

      // Durable lease observation is readable.
      const observationOption = yield* repo.getObservation(executionId);
      expect(Option.isSome(observationOption)).toBe(true);
      if (Option.isSome(observationOption)) {
        expect(observationOption.value.lastHeartbeatAt).toBe("2026-08-18T01:00:20.000Z");
        expect(observationOption.value.leaseExpiresAt).toBe("2026-08-18T01:00:50.000Z");
      }

      // NO tool.progress, NO message-like runtime events.
      expect(runtimeEvents.filter((e) => e.type === "tool.progress")).toHaveLength(0);
      expect(runtimeEvents.filter((e) => e.type.startsWith("message."))).toHaveLength(0);

      // NO journal rows beyond admission+started.
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.map((e) => e.sequence)).toEqual([1, 2]);

      yield* adapter.stopSession("th_t23_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("T23-AC5: lifecycle journal writes are never discarded amid a progress flood; observation persistence failure is swallowed while lifecycle failure degrades", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;
    let failObservation = false;
    let failLifecycle = false;

    const setup = makeTestSetup({
      progressRateHz: 2,
      heartbeatIntervalMs: 10000,
      leaseDurationMs: 30000,
    });

    const runtimeEvents: any[] = [];
    const controlHealth = await Effect.runPromise(makePiSubagentControlHealth());

    const { CustomRepoLayer } = makeObservingRepoLayer({
      failObservation: () => failObservation,
      failLifecycle: () => failLifecycle,
    });
    const clock = new VirtualClock();

    const extension = makeCapturingExtension({
      onBinding: (binding) => {
        capturedBinding = binding;
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
        piSubagentProgressClock: clock,
        controlHealth,
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, setup.serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(CustomRepoLayer),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, setup.authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      CustomRepoLayer,
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      yield* seedProjections("th_t23_test_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t23_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      // Execution 1: observation persistence fails — must be swallowed.
      yield* Effect.promise(() =>
        executeFn("call_t23_fail_progress", {
          commandId: "cmd_t23_fail_progress",
          subagent_type: "researcher",
          task: "Failing progress",
          prompt: "Failing progress",
        }),
      );
      expect(capturedBinding).toBeDefined();
      const binding1 = capturedBinding!;
      yield* Effect.promise(() =>
        binding1.reportObservation({
          kind: "started",
          occurredAt: "2026-08-18T02:00:00.000Z",
        }),
      );
      failObservation = true;
      yield* Effect.promise(() =>
        expect(
          binding1.reportObservation({
            kind: "progress",
            occurredAt: "2026-08-18T02:00:01.000Z",
            progressJson: '{"turnCount":1}',
          }),
        ).resolves.toBeUndefined(),
      );
      yield* Effect.promise(() => clock.advance(600));
      yield* Effect.promise(() =>
        expect(
          binding1.reportObservation({
            kind: "heartbeat",
            occurredAt: "2026-08-18T02:00:02.000Z",
          }),
        ).resolves.toBeUndefined(),
      );
      yield* Effect.sleep(200);

      // No throw to the extension AND no control-health degrade: progress is
      // observation, not control.
      const healthAfterObservationFailure = yield* controlHealth.getHealth();
      expect(healthAfterObservationFailure.status).toBe("available");
      failObservation = false;

      // Execution 2: lifecycle persistence failure still degrades.
      yield* Effect.promise(() =>
        executeFn("call_t23_fail_lifecycle", {
          commandId: "cmd_t23_fail_lifecycle",
          subagent_type: "researcher",
          task: "Failing lifecycle",
          prompt: "Failing lifecycle",
        }),
      );
      const binding2 = capturedBinding!;
      expect(binding2.executionId).not.toBe(binding1.executionId);
      failLifecycle = true;
      yield* Effect.promise(() =>
        expect(
          binding2.reportObservation({
            kind: "started",
            occurredAt: "2026-08-18T02:10:00.000Z",
          }),
        ).rejects.toMatchObject({ diagnosticCode: "pi_subagent_lifecycle_persistence_failed" }),
      );
      const healthAfterLifecycleFailure = yield* controlHealth.getHealth();
      expect(healthAfterLifecycleFailure.status).toBe("degraded");
      failLifecycle = false;
      yield* controlHealth.markAvailable();

      // Execution 3: flood + lifecycle interleaved — journal remains exact.
      yield* Effect.promise(() =>
        executeFn("call_t23_interleave", {
          commandId: "cmd_t23_interleave",
          subagent_type: "researcher",
          task: "Interleave",
          prompt: "Interleave",
        }),
      );
      const binding3 = capturedBinding!;
      yield* Effect.promise(() =>
        binding3.reportObservation({
          kind: "started",
          occurredAt: "2026-08-18T03:00:00.000Z",
        }),
      );
      for (let i = 0; i < 500; i += 1) {
        yield* Effect.promise(() => clock.advance(5));
        yield* Effect.promise(() =>
          binding3.reportObservation({
            kind: "progress",
            occurredAt: new Date(3_000_000 + i * 5).toISOString(),
            progressJson: JSON.stringify({ turnCount: i + 1 }),
          }),
        );
        if (i === 250) {
          yield* Effect.promise(() =>
            binding3.reportObservation({
              kind: "detached",
              occurredAt: "2026-08-18T03:00:02.000Z",
            }),
          );
        }
      }
      yield* Effect.promise(() => clock.advance(600));
      yield* Effect.promise(() =>
        binding3.reportObservation({
          kind: "detached",
          occurredAt: "2026-08-18T03:00:02.000Z",
        }),
      );

      const journal = yield* repo.listJournalEvents(binding3.executionId);
      expect(journal.map((e) => e.sequence)).toEqual([1, 2, 3]);
      expect(journal[2]!.state).toBe("running");

      // Desired/observed states were never touched by the flood (T23-AC4).
      const recordOption = yield* repo.getById(binding3.executionId);
      expect(Option.isSome(recordOption)).toBe(true);
      if (Option.isSome(recordOption)) {
        expect(recordOption.value.desiredState).toBe("running");
        expect(recordOption.value.observedState).toBe("running");
      }

      yield* adapter.stopSession("th_t23_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("rejects invalid observation kinds", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;

    const setup = makeTestSetup();
    const extension = makeCapturingExtension({
      onBinding: (binding) => {
        capturedBinding = binding;
      },
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
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
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      yield* seedProjections("th_t23_test_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      yield* adapter.startSession({
        threadId: "th_t23_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      yield* Effect.promise(() =>
        executeFn("call_t23_invalid", {
          commandId: "cmd_t23_invalid",
          subagent_type: "researcher",
          task: "Invalid kind",
          prompt: "Invalid kind",
        }),
      );
      expect(capturedBinding).toBeDefined();

      yield* Effect.promise(() =>
        expect(
          (capturedBinding as any)!.reportObservation({
            kind: "spinner",
            occurredAt: "2026-08-18T04:00:00.000Z",
          }),
        ).rejects.toThrow("Invalid observation kind"),
      );
      yield* Effect.promise(() =>
        expect(capturedBinding!.reportObservation(null as any)).rejects.toThrow(
          "Invalid observation kind",
        ),
      );

      yield* adapter.stopSession("th_t23_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });
});
