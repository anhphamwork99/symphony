import { DateTime, Effect, Fiber, Layer, Option, Stream } from "effect";
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
 * Ticket 03 / WP-02 lifecycle-containment wiring (Decision 0006) — the four
 * causal legs proving the volatile live-route boundary is composed into the
 * real production adapter (`makePiAdapterLive` + real repository layer):
 *
 * (1) seq2 gating: before the durable sequence-2 `started` row commits the
 *     route is captured-but-inactive (bounded unavailable, ZERO provider
 *     dispatch); after it commits the exact registration applies and the
 *     provider callback is entered exactly once.
 * (2) terminal ingress: the provider callback entered, the exact route is
 *     retired BEFORE the deferred `recordTerminalEvent` commit, then the
 *     terminal is durable and the provider count is unchanged.
 * (3) terminal persistence failure: the route stays retired, NO terminal
 *     notification/outbox entry is produced, and the bounded retry re-ingests
 *     the same terminal evidence while the route stays retired (no provider
 *     access on either ingest).
 * (4) stopSession: the exact session is cleared BEFORE the runtime disposal,
 *     so an in-flight provider response revalidates as stale-ignored and
 *     never triggers a second provider action.
 *
 * The compatible fixture extension registers Agent, steer_subagent and
 * get_subagent_result so the adapter's real wrapper pass (`wrapAgentTool` +
 * `wrapPiSubagentManagedTool`) runs against production routing, and the
 * fixture counts provider-side invocations through the ORIGINAL execute
 * captured underneath the wrapper.
 */

function makeTestSetup() {
  const tempDir = `/tmp/synara-pi-t03-wiring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
    subject: "user_test_t03_wiring",
    kind: "authenticated",
    authSessionId: "auth-session-t03-wiring",
    authExpiresAt: null,
  });

  const mcpAuthority = registry.bindingFor(authorityRecord.authorityId, {
    threadId: "th_t03_wiring_1",
    provider: "pi",
    projectId: "proj_default",
    lifecycleGeneration: null,
    credentialTtlMs: 60 * 60 * 1_000,
  })!;

  return { tempDir, serverConfig, authorityService, mcpAuthority };
}

const seedProjections = (threadId = "th_t03_wiring_1", tempDir = "/tmp") =>
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
        ${threadId}, 'proj_default', 'T03 wiring thread',
        '{"provider":"pi","model":"pi"}',
        'full-access', 'default', 'local',
        '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
      )
    `;
  });

/**
 * Repository wrap with injectable terminal/lifecycle persistence failures
 * and an optional hold that keeps the terminal journal write IN FLIGHT until
 * the test releases it (the leg-2 retire-order probe). The wrap only FAILS
 * `recordTerminalEvent` / seq2 `recordLifecycleEvent` when the hook is
 * armed; every other call passes to the real repository.
 */
function makeSeamedRepoLayer(hooks?: {
  readonly failTerminal?: () => boolean;
  readonly failSeq2Started?: () => boolean;
  readonly onRecordTerminal?: () => void;
  /** When set, the terminal write blocks on this gate before committing. */
  readonly holdTerminalGate?: () => Promise<void>;
}) {
  const terminalCalls: number[] = [];
  const CustomRepoLayer = Layer.effect(
    PiSubagentExecutionRepository,
    Effect.gen(function* () {
      const baseRepo = yield* makePiSubagentExecutionRepository;
      const wrapped: PiSubagentExecutionRepositoryShape = {
        ...baseRepo,
        recordTerminalEvent: (input) =>
          Effect.gen(function* () {
            terminalCalls.push(input.sequence);
            hooks?.onRecordTerminal?.();
            if (hooks?.failTerminal?.()) {
              return yield* Effect.fail({
                _tag: "PersistenceSqlError",
                message: "Injected terminal persistence failure",
              } as any);
            }
            if (hooks?.holdTerminalGate !== undefined) {
              yield* Effect.promise(hooks.holdTerminalGate);
            }
            return yield* baseRepo.recordTerminalEvent(input);
          }),
        recordLifecycleEvent: (input) => {
          if (hooks?.failSeq2Started?.() && input.sequence === 2) {
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
  return { CustomRepoLayer, terminalCalls };
}

/** Provider-side invocation counters for the managed steering tools. */
interface ManagedToolProbe {
  readonly steerProviderCalls: { count: number };
  readonly steerEntries: Array<{ readonly tuple: string }>;
  /** Optional gate for the leg-4 in-flight response experiment. */
  steerGate?: () => Promise<void>;
}

interface ManagedToolResult {
  readonly isError?: boolean;
  readonly diagnosticCode?: string;
  readonly content: ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
  }>;
}

/**
 * The compatible fixture: registers Agent, steer_subagent and
 * get_subagent_result on ONE extension, exposing the bridge handshake the
 * adapter negotiates plus the binding capture seam for the Agent tool.
 */
const makeWiringExtension = (probe: ManagedToolProbe) => {
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
  const factory = (pi: any) => {
    extension.factory(pi);
    if (!pi || typeof pi.registerTool !== "function") return;
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
        capturedBindingRef.current = getPiSubagentManagedForegroundBinding(ctx);
        return { content: [{ type: "text", text: "child started" }] };
      },
    });
    pi.registerTool({
      name: "steer_subagent",
      label: "Steer",
      description: "Managed steer",
      parameters: {} as any,
      execute: async (_id: string, params: any) => {
        probe.steerProviderCalls.count += 1;
        probe.steerEntries.push({
          tuple: `${String(params.execution_id ?? "?")}:${String(params.attempt_id ?? "?")}:${String(params.generation ?? "?")}`,
        });
        if (probe.steerGate !== undefined) {
          await probe.steerGate();
        }
        return { content: [{ type: "text", text: "steer applied" }] };
      },
    });
    pi.registerTool({
      name: "get_subagent_result",
      label: "Result",
      description: "Managed result",
      parameters: {} as any,
      execute: async () => {
        probe.steerProviderCalls.count += 1;
        return { content: [{ type: "text", text: "result snapshot" }] };
      },
    });
  };
  const capturedBindingRef: { current: PiSubagentManagedForegroundBinding | undefined } = {
    current: undefined,
  };
  return {
    extension: {
      name: "pi-subagents",
      factory,
      [Symbol.for("synara.pi.subagents.bridge")]: (extension as any)[
        Symbol.for("synara.pi.subagents.bridge")
      ],
    },
    capturedBindingRef,
  };
};

/** The WRAPPED (production-routed) managed tool entry in the loaded session. */
const loadedManagedTool = (observedSession: any, name: string): any => {
  const loadedExt = observedSession.resourceLoader
    .getExtensions()
    .extensions.find((e: any) => e.tools instanceof Map && e.tools.has(name)) as any;
  if (!loadedExt) return undefined;
  const entry = loadedExt.tools.get(name);
  return entry?.definition ?? entry;
};

const invokeSteer = (
  tool: any,
  executionId: string,
  binding: { attemptId: string; generation: number },
  tag: string,
): Promise<ManagedToolResult> =>
  Promise.resolve(
    tool.execute(
      `call_${tag}`,
      {
        execution_id: executionId,
        attempt_id: binding.attemptId,
        generation: binding.generation,
        task: `steer ${tag}`,
      },
      undefined,
      undefined,
      undefined,
    ),
  ) as Promise<ManagedToolResult>;

describe("Pi subagent lifecycle containment wiring (Ticket 03 / WP-02)", () => {
  it("leg 1: pre-seq2 steer is bounded unavailable with zero provider dispatch; post-seq2 the exact route applies with one provider call", async () => {
    let observedSession: any;

    const setup = makeTestSetup();
    const probe: ManagedToolProbe = { steerProviderCalls: { count: 0 }, steerEntries: [] };
    const { extension, capturedBindingRef } = makeWiringExtension(probe);
    let failSeq2Started = false;
    const { CustomRepoLayer } = makeSeamedRepoLayer({
      failSeq2Started: () => failSeq2Started,
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
      yield* seedProjections("th_t03_wiring_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      const runtimeEvents: any[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t03_wiring_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const steerTool = loadedManagedTool(observedSession, "steer_subagent");
      expect(steerTool).toBeDefined();
      expect((steerTool as any).__synaraCanonicalRoutingWrapped).toBe(true);
      const agentTool = loadedManagedTool(observedSession, "Agent");
      const agentExecute = agentTool.execute ?? agentTool.definition?.execute;

      // Admission captures the exact registration; the fixture never reports
      // `started`, so the durable seq2 row has NOT committed yet.
      const spawned = yield* Effect.promise(() =>
        agentExecute("call_t03_leg1", {
          commandId: "cmd_t03_leg1",
          subagent_type: "researcher",
          task: "Leg 1",
          prompt: "Leg 1",
        }),
      );
      const executionId = (spawned as any).executionId as string;
      expect(executionId).toMatch(/^exec_/);
      expect(capturedBindingRef.current).toBeDefined();
      const binding = capturedBindingRef.current!;
      expect(binding.executionId).toBe(executionId);

      // PRE-seq2: captured-but-inactive route → bounded unavailable, and the
      // provider callback was NEVER entered.
      const preSeq2 = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg1_pre"),
      );
      expect(probe.steerProviderCalls.count).toBe(0);
      expect(preSeq2.isError).toBe(true);
      expect(preSeq2.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
      expect(String(preSeq2.content[0].text)).toContain("pi_subagent_live_lifecycle_unavailable");

      // The durable seq2 `started` commit happens only through the
      // observation seam (reportObservation); before it, the journal holds
      // only the admission row (sequence 1).
      const journalPre = yield* repo.listJournalEvents(executionId);
      expect(journalPre.map((e) => e.sequence)).toEqual([1]);

      // POST-seq2: commit the durable started row, then the exact route
      // activates and the provider callback is entered exactly once.
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "started",
          occurredAt: "2026-08-27T00:00:00.000Z",
        }),
      );
      const journalPost = yield* repo.listJournalEvents(executionId);
      expect(journalPost.map((e) => e.sequence)).toEqual([1, 2]);

      const postSeq2 = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg1_post"),
      );
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(probe.steerEntries).toHaveLength(1);
      expect(probe.steerEntries[0]!.tuple).toBe(
        `${executionId}:${binding.attemptId}:${binding.generation}`,
      );
      // Applied control flows through the bounded success shape.
      expect(postSeq2.isError).toBeUndefined();
      expect(String(postSeq2.content[0].text)).toContain("Steer state: applied");

      // A distinct admission whose sequence-2 persistence fails never
      // activates its captured route. This proves the failure branch, not
      // only the successful ordering above.
      const failedSpawn = yield* Effect.promise(() =>
        agentExecute("call_t03_leg1_seq2_failure", {
          commandId: "cmd_t03_leg1_seq2_failure",
          subagent_type: "researcher",
          task: "Leg 1 sequence-2 failure",
          prompt: "Leg 1 sequence-2 failure",
        }),
      );
      const failedExecutionId = (failedSpawn as any).executionId as string;
      const failedBinding = capturedBindingRef.current!;
      failSeq2Started = true;
      const persistenceFailure = yield* Effect.promise(async () => {
        try {
          await failedBinding.reportObservation({
            kind: "started",
            occurredAt: "2026-08-27T00:01:00.000Z",
          });
          return undefined;
        } catch (error) {
          return error;
        }
      });
      failSeq2Started = false;
      expect(persistenceFailure).toMatchObject({
        diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
      });
      expect(
        (yield* repo.listJournalEvents(failedExecutionId)).map((event) => event.sequence),
      ).toEqual([1]);

      const afterFailedSeq2 = yield* Effect.promise(() =>
        invokeSteer(steerTool, failedExecutionId, failedBinding, "t03_leg1_failed_seq2"),
      );
      expect(afterFailedSeq2.isError).toBe(true);
      expect(afterFailedSeq2.diagnosticCode).toBe(
        "pi_subagent_live_lifecycle_unavailable",
      );
      expect(probe.steerProviderCalls.count).toBe(1);

      yield* adapter.stopSession("th_t03_wiring_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("leg 2: the terminal callback retires the exact route before the deferred recordTerminalEvent commit, leaving the terminal durable and the provider count unchanged", async () => {
    let observedSession: any;

    const setup = makeTestSetup();
    const probe: ManagedToolProbe = { steerProviderCalls: { count: 0 }, steerEntries: [] };
    const { extension, capturedBindingRef } = makeWiringExtension(probe);

    // Retire-order probe: hold the terminal journal write IN FLIGHT so the
    // exact moment between retirement and the deferred commit is observable
    // — a steer issued there must already be unavailable with zero dispatch.
    let releaseTerminalWrite: (() => void) | undefined;
    const terminalWriteGate = new Promise<void>((resolve) => {
      releaseTerminalWrite = resolve;
    });
    let terminalWriteHeld = false;
    const { CustomRepoLayer, terminalCalls } = makeSeamedRepoLayer({
      holdTerminalGate: () => {
        terminalWriteHeld = true;
        return terminalWriteGate;
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
      yield* seedProjections("th_t03_wiring_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      yield* adapter.startSession({
        threadId: "th_t03_wiring_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const steerTool = loadedManagedTool(observedSession, "steer_subagent");
      const agentTool = loadedManagedTool(observedSession, "Agent");
      const agentExecute = agentTool.execute ?? agentTool.definition?.execute;

      const spawned = yield* Effect.promise(() =>
        agentExecute("call_t03_leg2", {
          commandId: "cmd_t03_leg2",
          subagent_type: "researcher",
          task: "Leg 2",
          prompt: "Leg 2",
        }),
      );
      const executionId = (spawned as any).executionId as string;
      const binding = capturedBindingRef.current!;

      // Activate the route (durable seq2 commit) so the pre-retirement
      // boundary is observable: the callback is currently enterable.
      yield* Effect.promise(() =>
        binding.reportObservation({ kind: "started", occurredAt: "2026-08-27T01:00:00.000Z" }),
      );
      const preTerminal = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg2_pre"),
      );
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(preTerminal.isError).toBeUndefined();

      // Terminal ingress: retirement happens synchronously BEFORE the
      // deferred repository commit — the write is held open, so a steer
      // observed while it is in flight proves retirement preceded commit.
      const terminalIngest = binding.reportObservation({
        kind: "terminal",
        occurredAt: "2026-08-27T01:01:00.000Z",
        terminal: { state: "succeeded", summary: "Leg 2 done" },
      });
      yield* Effect.promise(async () => {
        // Wait until the terminal repository write is actually held.
        for (let i = 0; i < 500 && !terminalWriteHeld; i += 1) {
          await Promise.resolve();
        }
        return undefined;
      });
      expect(terminalWriteHeld).toBe(true);
      expect(terminalCalls).toEqual([40]);

      // The exact route is ALREADY retired while the terminal commit is
      // still in flight: bounded unavailable, zero provider dispatch.
      const duringCommit = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg2_during"),
      );
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(duringCommit.isError).toBe(true);
      expect(duringCommit.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");

      // Release the deferred commit and let the ingest settle.
      releaseTerminalWrite!();
      yield* Effect.promise(() => terminalIngest);

      // The terminal is durable and the route stays retired afterwards.
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.map((e) => e.sequence)).toEqual([1, 2, 40]);
      const recordOption = yield* repo.getById(executionId);
      expect(Option.isSome(recordOption)).toBe(true);
      if (Option.isSome(recordOption)) {
        expect(recordOption.value.observedState).toBe("succeeded");
      }
      const postTerminal = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg2_post"),
      );
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(postTerminal.isError).toBe(true);

      yield* adapter.stopSession("th_t03_wiring_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("leg 3: terminal persistence failure leaves the route retired with no terminal notification or outbox, and the bounded retry re-ingests without provider access", async () => {
    let observedSession: any;
    let failTerminal = false;

    const setup = makeTestSetup();
    const probe: ManagedToolProbe = { steerProviderCalls: { count: 0 }, steerEntries: [] };
    const { extension, capturedBindingRef } = makeWiringExtension(probe);
    const { CustomRepoLayer, terminalCalls } = makeSeamedRepoLayer({
      failTerminal: () => failTerminal,
    });
    const controlHealth = await Effect.runPromise(makePiSubagentControlHealth());

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
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
      yield* seedProjections("th_t03_wiring_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      const runtimeEvents: any[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t03_wiring_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const steerTool = loadedManagedTool(observedSession, "steer_subagent");
      const agentTool = loadedManagedTool(observedSession, "Agent");
      const agentExecute = agentTool.execute ?? agentTool.definition?.execute;

      const spawned = yield* Effect.promise(() =>
        agentExecute("call_t03_leg3", {
          commandId: "cmd_t03_leg3",
          subagent_type: "researcher",
          task: "Leg 3",
          prompt: "Leg 3",
        }),
      );
      const executionId = (spawned as any).executionId as string;
      const binding = capturedBindingRef.current!;
      yield* Effect.promise(() =>
        binding.reportObservation({ kind: "started", occurredAt: "2026-08-27T02:00:00.000Z" }),
      );
      yield* Effect.promise(() => invokeSteer(steerTool, executionId, binding, "t03_leg3_pre"));
      expect(probe.steerProviderCalls.count).toBe(1);

      // FAILING ingest: the route retires before the write, the write fails,
      // the producer is rejected, and NO terminal notification/outbox exists.
      failTerminal = true;
      yield* Effect.promise(() =>
        expect(
          binding.reportObservation({
            kind: "terminal",
            occurredAt: "2026-08-27T02:01:00.000Z",
            terminal: { state: "failed", summary: "Leg 3 transient failure" },
          }),
        ).rejects.toMatchObject({ diagnosticCode: "pi_subagent_terminal_persistence_failed" }),
      );
      yield* Effect.sleep(150);

      // Control health degraded: terminal truth is control truth.
      const health = yield* controlHealth.getHealth();
      expect(health.status).toBe("degraded");

      // No terminal runtime-event notification and no outbox entry: the
      // commit never happened, so delivery may not begin.
      expect(
        runtimeEvents.filter(
          (e) => e.raw?.method === "subagents/terminal-settled" || e.raw?.method === "subagents/completion-outbox-pending",
        ),
      ).toHaveLength(0);
      const outboxId = `outbox_${executionId}_${binding.attemptId}_gen${binding.generation}`;
      const outboxOption = yield* repo.getCompletionOutboxEntry(outboxId);
      expect(Option.isNone(outboxOption)).toBe(true);

      // The route stayed retired through the failure: a steer cannot reach
      // the provider even though the terminal never committed.
      const duringFailure = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg3_failed"),
      );
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(duringFailure.isError).toBe(true);
      expect(duringFailure.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");

      // BOUNDED RETRY: the producer re-ingests the SAME terminal evidence
      // through the same observation seam while the route stays retired.
      failTerminal = false;
      const retryCountBefore = terminalCalls.length;
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "terminal",
          occurredAt: "2026-08-27T02:02:00.000Z",
          terminal: { state: "failed", summary: "Leg 3 retry evidence" },
        }),
      );
      yield* Effect.sleep(150);
      expect(terminalCalls.length).toBe(retryCountBefore + 1);
      // No provider access on the retry path.
      expect(probe.steerProviderCalls.count).toBe(1);

      // The retry committed: terminal durable, outbox exists, journal exact.
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.map((e) => e.sequence)).toEqual([1, 2, 40]);
      const recordOption = yield* repo.getById(executionId);
      expect(Option.isSome(recordOption)).toBe(true);
      if (Option.isSome(recordOption)) {
        expect(recordOption.value.observedState).toBe("failed");
      }
      const outboxAfter = yield* repo.getCompletionOutboxEntry(outboxId);
      expect(Option.isSome(outboxAfter)).toBe(true);

      yield* adapter.stopSession("th_t03_wiring_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("leg 4: stopSession clears the exact session before disposal, so an in-flight provider response becomes stale and no second action runs", async () => {
    let observedSession: any;

    const setup = makeTestSetup();
    const probe: ManagedToolProbe = { steerProviderCalls: { count: 0 }, steerEntries: [] };
    const { extension, capturedBindingRef } = makeWiringExtension(probe);
    // The provider response is held in flight; it resolves only after the
    // stop cleared the session.
    let releaseInFlight: (() => void) | undefined;
    const inFlightGate = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    probe.steerGate = () => inFlightGate;

    const { CustomRepoLayer } = makeSeamedRepoLayer();

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [extension.factory],
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
      yield* seedProjections("th_t03_wiring_1", setup.tempDir);
      const adapter = yield* PiAdapter;

      yield* adapter.startSession({
        threadId: "th_t03_wiring_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: setup.tempDir } },
      } as any);

      const steerTool = loadedManagedTool(observedSession, "steer_subagent");
      const agentTool = loadedManagedTool(observedSession, "Agent");
      const agentExecute = agentTool.execute ?? agentTool.definition?.execute;

      const spawned = yield* Effect.promise(() =>
        agentExecute("call_t03_leg4", {
          commandId: "cmd_t03_leg4",
          subagent_type: "researcher",
          task: "Leg 4",
          prompt: "Leg 4",
        }),
      );
      const executionId = (spawned as any).executionId as string;
      const binding = capturedBindingRef.current!;
      yield* Effect.promise(() =>
        binding.reportObservation({ kind: "started", occurredAt: "2026-08-27T03:00:00.000Z" }),
      );

      // Issue the steer and let it RUN concurrently; the provider entered
      // and its response is held by the gate.
      const inFlightSteer = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg4_inflight"),
      ).pipe(Effect.forkChild);
      yield* Effect.promise(async () => {
        // Wait until the provider callback is actually entered (the wrapper
        // resolves the durable read first, so entry is asynchronous).
        for (let i = 0; i < 500 && probe.steerProviderCalls.count === 0; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return undefined;
      });
      expect(probe.steerProviderCalls.count).toBe(1);

      // stopSession clears the exact containment session BEFORE the runtime
      // disposal. Then release the in-flight provider response.
      const stopping = yield* adapter
        .stopSession("th_t03_wiring_1" as ThreadId)
        .pipe(Effect.forkChild);
      yield* Fiber.join(stopping);
      releaseInFlight!();

      // The late provider response revalidates as stale-ignored: bounded
      // failure surface, and the provider was entered exactly once — no
      // second action was triggered by the late response.
      const lateResult = yield* Fiber.join(inFlightSteer);
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(lateResult.isError).toBe(true);
      expect(lateResult.diagnosticCode).toBe("pi_subagent_live_lifecycle_stale_ignored");

      // A post-stop steer revalidates as unavailable (session cleared), also
      // with zero further provider dispatch.
      const postStop = yield* Effect.promise(() =>
        invokeSteer(steerTool, executionId, binding, "t03_leg4_post"),
      );
      expect(probe.steerProviderCalls.count).toBe(1);
      expect(postStop.isError).toBe(true);
      expect(postStop.diagnosticCode).toBe("pi_subagent_read_capability_unavailable");
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });
});
