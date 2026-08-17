import { Cause, DateTime, Effect, Layer, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
  type ThreadId,
} from "@synara/contracts";

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
  makeLegacyPiSubagentExtension,
  type PiSubagentManagedForegroundBinding,
} from "./piSubagentBridge.ts";
import { makePiSubagentControlHealth, type PiSubagentControlHealthShape } from "./piSubagentControlHealth.ts";
import { PiAdapter } from "./Services/PiAdapter.ts";

describe("Pi subagent foreground lifecycle reporter and managed binding (Issue 22 / WP-03)", () => {
  function makeTestSetup(options?: {
    readonly foregroundWaitMs?: number;
  }) {
    const tempDir = `/tmp/synara-pi-fg-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      piSubagentForegroundWaitMs: options?.foregroundWaitMs,
    };

    const registry = makeMcpSessionAuthorityRegistry();
    const authorityService: McpSessionAuthorityShape = {
      ...registry,
      mintForLocalOwner: () =>
        registry.mint({ subject: "local-owner:test", kind: "local-owner" }),
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
      subject: "user_test_fg",
      kind: "authenticated",
      authSessionId: "auth-session-fg",
      authExpiresAt: null,
    });

    const mcpAuthority = registry.bindingFor(authorityRecord.authorityId, {
      threadId: "th_fg_test_1",
      provider: "pi",
      projectId: "proj_default",
      lifecycleGeneration: null,
      credentialTtlMs: 60 * 60 * 1_000,
    })!;

    const warnings: any[] = [];
    const admittedEvents: Array<{
      readonly threadId: ThreadId;
      readonly command: PiSubagentSpawnCommand;
      readonly result: PiSubagentSpawnResult;
    }> = [];

    return {
      tempDir,
      serverConfig,
      authorityService,
      mcpAuthority,
      warnings,
      admittedEvents,
    };
  }

  const seedProjections = (threadId = "th_fg_test_1", tempDir = "/tmp") =>
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
          ${threadId}, 'proj_default', 'Admission thread',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
        )
      `;
    });

  it("T22-WP03-1: passes immutable binding with server correlation and foregroundWaitMs to executed tool context", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let capturedCtxIsFrozen = false;
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation", "bounded-foreground-attachment"],
      extensionVersion: "0.10.0-alfie.1",
    });

    const customExtension = {
      name: "pi-subagents",
      factory: (pi: any) => {
        extension.factory(pi);
        if (pi && typeof pi.registerTool === "function") {
          pi.registerTool({
            name: "Agent",
            label: "Managed Agent",
            description: "Managed Pi subagent tool",
            parameters: {} as any,
            execute: async (_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) => {
              capturedBinding = getPiSubagentManagedForegroundBinding(ctx);
              capturedCtxIsFrozen = Object.isFrozen(ctx);
              return { content: [{ type: "text", text: "captured binding" }] };
            },
          });
        }
      },
      [Symbol.for("synara.pi.subagents.bridge")]: (extension as any)[Symbol.for("synara.pi.subagents.bridge")],
    };

    const setup = makeTestSetup({
      foregroundWaitMs: 8000,
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [customExtension.factory],
        onSubagentCapability: (event) => {
          observedSession = event.session;
        },
        onSubagentAdmission: (event) => {
          setup.admittedEvents.push(event);
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
      yield* seedProjections("th_fg_test_1", setup.tempDir);

      const adapter = yield* PiAdapter;
      yield* adapter.startSession({
        threadId: "th_fg_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: {
          pi: {
            agentDir: setup.tempDir,
          },
        },
      });

      expect(observedSession).toBeDefined();
      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      expect(loadedExt).toBeDefined();
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;
      expect(executeFn).toBeDefined();

      const result = yield* Effect.promise(() =>
        executeFn("call_fg_1", {
          commandId: "cmd_fg_1",
          subagent_type: "researcher",
          task: "Verify binding injection",
          prompt: "Verify binding injection",
        }),
      );

      expect(capturedBinding).toBeDefined();
      expect(capturedBinding!.executionId).toMatch(/^exec_/);
      expect(capturedBinding!.attemptId).toMatch(/^att_/);
      expect(capturedBinding!.generation).toBe(1);
      expect(capturedBinding!.cancellationScope).toBe("parent_turn");
      expect(capturedBinding!.foregroundWaitMs).toBe(8000);
      expect(typeof capturedBinding!.reportObservation).toBe("function");
      expect(capturedCtxIsFrozen).toBe(true);

      expect((result as any).executionId).toBe(capturedBinding!.executionId);
      expect((result as any).attemptId).toBe(capturedBinding!.attemptId);
      expect((result as any).generation).toBe(1);

      yield* adapter.stopSession("th_fg_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("T22-WP03-2: reporter writes exact sequence 2 (started) and sequence 3 (detached) with bounded metadata", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation", "bounded-foreground-attachment"],
      extensionVersion: "0.10.0-alfie.1",
    });

    const customExtension = {
      name: "pi-subagents",
      factory: (pi: any) => {
        extension.factory(pi);
        if (pi && typeof pi.registerTool === "function") {
          pi.registerTool({
            name: "Agent",
            label: "Managed Agent",
            description: "Managed Pi subagent tool",
            parameters: {} as any,
            execute: async (_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) => {
              capturedBinding = getPiSubagentManagedForegroundBinding(ctx);
              if (capturedBinding) {
                // Alfie calls started first
                await capturedBinding.reportObservation({
                  kind: "started",
                  occurredAt: "2026-08-17T10:00:01.000Z",
                });
                // Alfie calls detached next
                await capturedBinding.reportObservation({
                  kind: "detached",
                  occurredAt: "2026-08-17T10:00:06.000Z",
                });
              }
              return { content: [{ type: "text", text: "reported observations" }] };
            },
          });
        }
      },
      [Symbol.for("synara.pi.subagents.bridge")]: (extension as any)[Symbol.for("synara.pi.subagents.bridge")],
    };

    const setup = makeTestSetup({
      foregroundWaitMs: 5000,
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [customExtension.factory],
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

    const testProgram = Effect.gen(function* () {
      yield* seedProjections("th_fg_test_1", setup.tempDir);

      const adapter = yield* PiAdapter;
      const repo = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_fg_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: {
          pi: {
            agentDir: setup.tempDir,
          },
        },
      });

      expect(observedSession).toBeDefined();
      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      yield* Effect.promise(() =>
        executeFn("call_fg_2", {
          commandId: "cmd_fg_2",
          subagent_type: "researcher",
          task: "Report seq2 and seq3",
          prompt: "Report seq2 and seq3",
        }),
      );

      expect(capturedBinding).toBeDefined();
      const executionId = capturedBinding!.executionId;

      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal).toHaveLength(3);

      // Sequence 1: accepted
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[0]!.state).toBe("accepted");

      // Sequence 2: running (started)
      expect(journal[1]!.sequence).toBe(2);
      expect(journal[1]!.state).toBe("running");
      expect(journal[1]!.occurredAt).toBe("2026-08-17T10:00:01.000Z");
      expect(journal[1]!.metadata).toEqual({
        phase: "started",
        occurredAt: "2026-08-17T10:00:01.000Z",
        attachmentMode: "foreground",
        foregroundWaitMs: 5000,
      });

      // Sequence 3: running (detached)
      expect(journal[2]!.sequence).toBe(3);
      expect(journal[2]!.state).toBe("running");
      expect(journal[2]!.occurredAt).toBe("2026-08-17T10:00:06.000Z");
      expect(journal[2]!.metadata).toEqual({
        phase: "detached",
        occurredAt: "2026-08-17T10:00:06.000Z",
        attachmentMode: "foreground",
        foregroundWaitMs: 5000,
      });

      // Execution aggregate has observedState running
      const execOpt = yield* repo.getById(executionId);
      expect(Option.isSome(execOpt)).toBe(true);
      const execRecord = Option.getOrThrow(execOpt);
      expect(execRecord.observedState).toBe("running");

      yield* adapter.stopSession("th_fg_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("T22-WP03-3: duplicate observations converge idempotently and detached before started is rejected", async () => {
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation", "bounded-foreground-attachment"],
      extensionVersion: "0.10.0-alfie.1",
    });

    const customExtension = {
      name: "pi-subagents",
      factory: (pi: any) => {
        extension.factory(pi);
        if (pi && typeof pi.registerTool === "function") {
          pi.registerTool({
            name: "Agent",
            label: "Managed Agent",
            description: "Managed Pi subagent tool",
            parameters: {} as any,
            execute: async (_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) => {
              capturedBinding = getPiSubagentManagedForegroundBinding(ctx);
              return { content: [{ type: "text", text: "captured" }] };
            },
          });
        }
      },
      [Symbol.for("synara.pi.subagents.bridge")]: (extension as any)[Symbol.for("synara.pi.subagents.bridge")],
    };

    const setup = makeTestSetup({
      foregroundWaitMs: 10000,
    });

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [customExtension.factory],
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

    const testProgram = Effect.gen(function* () {
      yield* seedProjections("th_fg_test_1", setup.tempDir);

      const adapter = yield* PiAdapter;
      const repo = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_fg_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: {
          pi: {
            agentDir: setup.tempDir,
          },
        },
      });

      expect(observedSession).toBeDefined();
      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      yield* Effect.promise(() =>
        executeFn("call_fg_3", {
          commandId: "cmd_fg_3",
          subagent_type: "researcher",
          task: "Idempotent observations",
          prompt: "Idempotent observations",
        }),
      );

      expect(capturedBinding).toBeDefined();
      const binding = capturedBinding!;

      // 1. Started observation
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "started",
          occurredAt: "2026-08-17T11:00:00.000Z",
        }),
      );

      // Duplicate started observation converges cleanly
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "started",
          occurredAt: "2026-08-17T11:00:00.000Z",
        }),
      );

      // 2. Detached observation
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "detached",
          occurredAt: "2026-08-17T11:00:10.000Z",
        }),
      );

      // Duplicate detached observation converges cleanly
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "detached",
          occurredAt: "2026-08-17T11:00:10.000Z",
        }),
      );

      const journal = yield* repo.listJournalEvents(binding.executionId);
      // Journal must contain exactly 3 events (1 accepted, 1 started, 1 detached)
      expect(journal).toHaveLength(3);
      expect(journal.map((e) => e.sequence)).toEqual([1, 2, 3]);

      yield* adapter.stopSession("th_fg_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("T22-WP03-4: sequence 2 and sequence 3 persistence failures degrade control health, emit safe warning, and preserve earlier truth", async () => {
    let failSeq2 = false;
    let failSeq3 = false;
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    let observedSession: any;

    const { extension } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation", "bounded-foreground-attachment"],
      extensionVersion: "0.10.0-alfie.1",
    });

    const customExtension = {
      name: "pi-subagents",
      factory: (pi: any) => {
        extension.factory(pi);
        if (pi && typeof pi.registerTool === "function") {
          pi.registerTool({
            name: "Agent",
            label: "Managed Agent",
            description: "Managed Pi subagent tool",
            parameters: {} as any,
            execute: async (_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) => {
              capturedBinding = getPiSubagentManagedForegroundBinding(ctx);
              return { content: [{ type: "text", text: "captured" }] };
            },
          });
        }
      },
      [Symbol.for("synara.pi.subagents.bridge")]: (extension as any)[Symbol.for("synara.pi.subagents.bridge")],
    };

    const setup = makeTestSetup({
      foregroundWaitMs: 10000,
    });

    const controlHealth = await Effect.runPromise(makePiSubagentControlHealth());

    // Wrap repository to inject persistence failures on seq2 or seq3
    const CustomRepoLayer = Layer.effect(
      PiSubagentExecutionRepository,
      Effect.gen(function* () {
        const baseRepo = yield* makePiSubagentExecutionRepository;
        return {
          ...baseRepo,
          recordLifecycleEvent: (input) => {
            if (failSeq2 && input.sequence === 2) {
              return Effect.fail({
                _tag: "PersistenceSqlError",
                message: "Injected SQL failure on sequence 2 write",
              } as any);
            }
            if (failSeq3 && input.sequence === 3) {
              return Effect.fail({
                _tag: "PersistenceSqlError",
                message: "Injected SQL failure on sequence 3 write",
              } as any);
            }
            return baseRepo.recordLifecycleEvent(input);
          },
        };
      }),
    ).pipe(Layer.provide(SqlitePersistenceMemory));

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [customExtension.factory],
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
      yield* seedProjections("th_fg_test_1", setup.tempDir);

      const adapter = yield* PiAdapter;
      const repo = yield* PiSubagentExecutionRepository;

      yield* adapter.startSession({
        threadId: "th_fg_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: {
          pi: {
            agentDir: setup.tempDir,
          },
        },
      });

      expect(observedSession).toBeDefined();
      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      // ── Test Failure on Sequence 2 (Started) ──
      failSeq2 = true;
      yield* Effect.promise(() =>
        executeFn("call_fail_seq2", {
          commandId: "cmd_fail_seq2",
          subagent_type: "researcher",
          task: "Failure on seq2",
          prompt: "Failure on seq2",
        }),
      );

      expect(capturedBinding).toBeDefined();
      const binding1 = capturedBinding!;

      // reportObservation started should reject with pi_subagent_lifecycle_persistence_failed
      let seq2Error: any;
      yield* Effect.promise(async () => {
        try {
          await binding1.reportObservation({
            kind: "started",
            occurredAt: "2026-08-17T12:00:00.000Z",
          });
        } catch (err) {
          seq2Error = err;
        }
      });
      expect(seq2Error).toBeDefined();
      expect(String(seq2Error?.message ?? seq2Error)).toContain("pi_subagent_lifecycle_persistence_failed");

      // Control health is degraded
      const healthAfterSeq2 = yield* controlHealth.getHealth();
      expect(healthAfterSeq2.status).toBe("degraded");
      expect(healthAfterSeq2.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // Sequence 1 admission truth is preserved
      const journal1 = yield* repo.listJournalEvents(binding1.executionId);
      expect(journal1).toHaveLength(1);
      expect(journal1[0]!.sequence).toBe(1);
      expect(journal1[0]!.state).toBe("accepted");

      // Recover health for next test
      yield* controlHealth.markAvailable();
      failSeq2 = false;

      // ── Test Failure on Sequence 3 (Detached) ──
      failSeq3 = true;
      yield* Effect.promise(() =>
        executeFn("call_fail_seq3", {
          commandId: "cmd_fail_seq3",
          subagent_type: "researcher",
          task: "Failure on seq3",
          prompt: "Failure on seq3",
        }),
      );

      const binding2 = capturedBinding!;
      expect(binding2.executionId).not.toBe(binding1.executionId);

      // Started succeeds
      yield* Effect.promise(() =>
        binding2.reportObservation({
          kind: "started",
          occurredAt: "2026-08-17T12:05:00.000Z",
        }),
      );

      // Detached fails
      let seq3Error: any;
      yield* Effect.promise(async () => {
        try {
          await binding2.reportObservation({
            kind: "detached",
            occurredAt: "2026-08-17T12:05:10.000Z",
          });
        } catch (err) {
          seq3Error = err;
        }
      });
      expect(seq3Error).toBeDefined();
      expect(String(seq3Error?.message ?? seq3Error)).toContain("pi_subagent_lifecycle_persistence_failed");

      // Control health is degraded
      const healthAfterSeq3 = yield* controlHealth.getHealth();
      expect(healthAfterSeq3.status).toBe("degraded");
      expect(healthAfterSeq3.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // Sequence 1 and Sequence 2 remain committed and preserved
      const journal2 = yield* repo.listJournalEvents(binding2.executionId);
      expect(journal2).toHaveLength(2);
      expect(journal2[0]!.sequence).toBe(1);
      expect(journal2[1]!.sequence).toBe(2);
      expect(journal2[1]!.state).toBe("running");

      yield* adapter.stopSession("th_fg_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  it("T22-WP03-5: unmanaged / legacy session does not receive managed binding and executes legacy behavior", async () => {
    let receivedBinding: any = "unset";
    let observedSession: any;

    const { extension } = makeLegacyPiSubagentExtension();

    const customExtension = {
      name: "pi-legacy-subagents",
      factory: (pi: any) => {
        if (pi && typeof pi.registerTool === "function") {
          pi.registerTool({
            name: "Agent",
            label: "Legacy Agent",
            description: "Legacy unmanaged subagent tool",
            parameters: {} as any,
            execute: async (_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) => {
              receivedBinding = getPiSubagentManagedForegroundBinding(ctx);
              return { content: [{ type: "text", text: "legacy response" }] };
            },
          });
        }
      },
    };

    const setup = makeTestSetup();

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        extensionFactories: [customExtension.factory],
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
      yield* seedProjections("th_legacy_test_1", setup.tempDir);

      const adapter = yield* PiAdapter;
      yield* adapter.startSession({
        threadId: "th_legacy_test_1" as ThreadId,
        cwd: setup.tempDir,
        mcpAuthority: setup.mcpAuthority,
        runtimeMode: "full-access",
        providerOptions: {
          pi: {
            agentDir: setup.tempDir,
          },
        },
      });

      expect(observedSession).toBeDefined();
      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      const result = yield* Effect.promise(() =>
        executeFn("call_legacy_1", {
          prompt: "Legacy call without admission",
        }),
      );

      expect(receivedBinding).toBeUndefined();
      expect((result as any).content[0].text).toBe("legacy response");
      expect((result as any).executionId).toBeUndefined();

      yield* adapter.stopSession("th_legacy_test_1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });
});
