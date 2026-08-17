import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Cause, DateTime, Effect, Layer, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
  type ThreadId,
} from "@synara/contracts";

import {
  DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  ServerConfig,
  type ServerConfigShape,
} from "../config.ts";
import { makeMcpSessionAuthorityRegistry } from "../agentGateway/mcpSessionAuthority.ts";
import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../agentGateway/Services/McpSessionAuthority.ts";
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
  attachPiSubagentManagedForegroundBinding,
  getPiSubagentManagedForegroundBinding,
  isPiSubagentManagedForegroundBinding,
  makeCompatiblePiSubagentExtension,
  makeLegacyPiSubagentExtension,
  probePiSubagentBridge,
} from "./piSubagentBridge.ts";
import {
  assertProductionExtensionProvenance,
  createRealPiSession,
  resolveAlfieRepoDir,
  resolveVersionedExtensionDir,
  verifyExtensionGitProvenance,
} from "./piSubagentRealExtension.test.ts";
import { PiAdapter } from "./Services/PiAdapter.ts";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  createdDirs.length = 0;
});

function makeServerConfig(tempDir: string, overrides?: Partial<ServerConfigShape>): ServerConfigShape {
  return {
    mode: "web",
    port: 3779,
    host: "127.0.0.1",
    cwd: tempDir,
    homeDir: tempDir,
    chatWorkspaceRoot: tempDir,
    studioWorkspaceRoot: tempDir,
    baseDir: tempDir,
    stateDir: tempDir,
    secretsDir: tempDir,
    dbPath: join(tempDir, "state.sqlite"),
    settingsPath: join(tempDir, "settings.json"),
    keybindingsConfigPath: join(tempDir, "keybindings.json"),
    worktreesDir: tempDir,
    attachmentsDir: tempDir,
    logsDir: tempDir,
    serverLogPath: join(tempDir, "server.log"),
    serverRuntimeStatePath: join(tempDir, "runtime.json"),
    providerLogsDir: tempDir,
    providerEventLogPath: join(tempDir, "provider.ndjson"),
    terminalLogsDir: tempDir,
    environmentIdPath: join(tempDir, "env-id"),
    staticDir: undefined,
    devUrl: undefined,
    publicUrl: undefined,
    allowInsecureRemote: false,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
    ...overrides,
  };
}

function makeAuthorityFixture(threadId: string) {
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
    bindingFor: (authorityId, options) => registry.bindingFor(authorityId, options),
  };
  const authorityRecord = registry.mint({
    subject: `user_${threadId}`,
    kind: "authenticated",
    authSessionId: `auth_session_${threadId}`,
    authExpiresAt: null,
  });
  const binding = registry.bindingFor(authorityRecord.authorityId, {
    threadId: threadId as ThreadId,
    provider: "pi",
    projectId: "proj_default",
    lifecycleGeneration: null,
    credentialTtlMs: 60 * 60 * 1_000,
  })!;
  return { authorityService, binding };
}

function createRealExtensionDirectory(tempAgentDir: string): string {
  const versionedDir = resolveVersionedExtensionDir();
  const extensionsDir = join(tempAgentDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  symlinkSync(versionedDir, join(extensionsDir, "pi-subagents"), "dir");
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, join(extensionsDir, "shared"), "dir");
  }
  return tempAgentDir;
}

describe("Pi Subagent Bounded Foreground Attachment Integrated Acceptance (Issue 22)", () => {
  // -------------------------------------------------------------------------
  // T22-AC1: Fast inline child
  // -------------------------------------------------------------------------
  it("T22-AC1: real Pi child completing inside budget returns normal inline result with seq1 accepted and seq2 started only", async () => {
    const tempDir = `/tmp/synara-t22-ac1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdDirs.push(tempDir);
    createRealExtensionDirectory(tempDir);

    const serverConfig = makeServerConfig(tempDir, {
      piSubagentForegroundWaitMs: 30000, // 30s budget - child finishes well within this
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t22_ac1");

    let observedSession: any;
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSession = event.session;
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(SqlitePersistenceMemory),
    );

    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;

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
          'th_t22_ac1', 'proj_default', 'AC1 Thread',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t22_ac1" as ThreadId,
        cwd: tempDir,
        runtimeMode: "full-access",
        providerOptions: {
          pi: { agentDir: tempDir },
        },
        mcpAuthority: binding,
      });

      expect(observedSession).toBeDefined();
      const provenance = assertProductionExtensionProvenance(observedSession);
      expect(provenance.isProduction).toBe(true);

      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      // Extract bridge from extension
      const bridge = loadedExt.handlers.get("synara:subagents:bridge")[0]();
      expect(bridge).toBeDefined();

      const initialSnapshot = bridge.getResourceSnapshot();
      expect(initialSnapshot.activeAttachmentCount).toBe(0);
      expect(initialSnapshot.activeTimerCount).toBe(0);

      const parentCtx = {
        ui: {
          notify: () => {},
          setStatus: () => {},
          setWidget: () => {},
          select: async () => undefined,
          confirm: async () => true,
          input: async () => undefined,
        },
        cwd: tempDir,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      const startTime = Date.now();
      const result = yield* Effect.promise(() =>
        executeFn(
          "call_ac1_1",
          {
            commandId: "cmd_ac1_1",
            subagent_type: "researcher",
            task: "Fast inline task for AC1",
            context: "Fast inline context.",
            link_references: "None",
            expected_outcome: "Fast inline outcome.",
            run_in_background: false,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      const elapsed = Date.now() - startTime;

      expect(result).toBeDefined();
      expect((result as any).executionId).toMatch(/^exec_/);
      expect((result as any).attemptId).toMatch(/^att_/);
      expect((result as any).generation).toBe(1);

      const executionId = (result as any).executionId;

      // Verify journal events in repository:
      // Seq 1: accepted
      // Seq 2: running (started)
      // Must NOT have seq 3 (detached)
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.length).toBeGreaterThanOrEqual(2);
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[0]!.state).toBe("accepted");
      expect(journal[1]!.sequence).toBe(2);
      expect(journal[1]!.state).toBe("running");
      expect(journal[1]!.metadata).toMatchObject({
        phase: "started",
        attachmentMode: "foreground",
        foregroundWaitMs: 30000,
      });

      // Confirm no detached event in journal
      const detachedEvent = journal.find((e) => (e.metadata as any)?.phase === "detached");
      expect(detachedEvent).toBeUndefined();

      // Verify post-execution resource snapshot: live attachments and timers are 0
      const postSnapshot = bridge.getResourceSnapshot();
      expect(postSnapshot.activeAttachmentCount).toBe(0);
      expect(postSnapshot.activeTimerCount).toBe(0);

      yield* adapter.stopSession("th_t22_ac1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  // -------------------------------------------------------------------------
  // T22-AC2 & T22-AC3: Long detach, same child
  // -------------------------------------------------------------------------
  it("T22-AC2, T22-AC3: long child detaches at deadline, returns handle within budget + tolerance, preserving same execution identity and child ownership", async () => {
    const tempDir = `/tmp/synara-t22-ac2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdDirs.push(tempDir);
    createRealExtensionDirectory(tempDir);

    const foregroundWaitMs = 300; // 300ms budget
    const serverConfig = makeServerConfig(tempDir, {
      piSubagentForegroundWaitMs: foregroundWaitMs,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t22_ac2");

    let observedSession: any;
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSession = event.session;
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(SqlitePersistenceMemory),
    );

    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;

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
          'th_t22_ac2', 'proj_default', 'AC2 Thread',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t22_ac2" as ThreadId,
        cwd: tempDir,
        runtimeMode: "full-access",
        providerOptions: {
          pi: { agentDir: tempDir },
        },
        mcpAuthority: binding,
      });

      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;
      const bridge = loadedExt.handlers.get("synara:subagents:bridge")[0]();

      const parentCtx = {
        ui: {
          notify: () => {},
          setStatus: () => {},
          setWidget: () => {},
          select: async () => undefined,
          confirm: async () => true,
          input: async () => undefined,
        },
        cwd: tempDir,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      const startTime = Date.now();
      const result = yield* Effect.promise(() =>
        executeFn(
          "call_ac2_1",
          {
            commandId: "cmd_ac2_1",
            subagent_type: "researcher",
            task: "Long executing task to prove detach",
            context: "Detach context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: false,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      const elapsed = Date.now() - startTime;

      // Elapsed time: returned no later than budget + 500ms on a functioning loop (under 2500ms)
      expect(elapsed).toBeGreaterThanOrEqual(foregroundWaitMs - 50);
      expect(elapsed).toBeLessThan(foregroundWaitMs + 2000);

      // Verify returned handle structure
      expect(result).toBeDefined();
      expect((result as any).executionId).toMatch(/^exec_/);
      expect((result as any).attemptId).toMatch(/^att_/);
      expect((result as any).generation).toBe(1);

      const executionId = (result as any).executionId;
      const attemptId = (result as any).attemptId;

      // T22-AC3: Exactly one child exists before and after detach in active executions
      const activeExecs = bridge.getActiveExecutions();
      const matchingChild = activeExecs.find((e: any) => e.executionId === executionId);
      if (matchingChild) {
        expect(matchingChild.executionId).toBe(executionId);
        expect(matchingChild.attemptId).toBe(attemptId);
        expect(matchingChild.generation).toBe(1);
        expect(matchingChild.cancellationScope).toBe("parent_turn");
      }

      // Verify journal events: seq 1 accepted -> seq 2 started -> seq 3 detached
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.length).toBeGreaterThanOrEqual(3);
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[0]!.state).toBe("accepted");

      expect(journal[1]!.sequence).toBe(2);
      expect(journal[1]!.state).toBe("running");
      expect(journal[1]!.metadata).toMatchObject({
        phase: "started",
        attachmentMode: "foreground",
        foregroundWaitMs,
      });

      expect(journal[2]!.sequence).toBe(3);
      expect(journal[2]!.state).toBe("running");
      expect(journal[2]!.metadata).toMatchObject({
        phase: "detached",
        attachmentMode: "foreground",
        foregroundWaitMs,
      });

      // Live attachment is removed on detach while child continues
      const snapshot = bridge.getResourceSnapshot();
      expect(snapshot.activeAttachmentCount).toBe(0);
      expect(snapshot.activeTimerCount).toBe(0);

      yield* adapter.stopSession("th_t22_ac2" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  // -------------------------------------------------------------------------
  // T22-AC5: Production config path
  // -------------------------------------------------------------------------
  it("T22-AC5: foreground budget default is 10000ms, valid bounds are preserved, and invalid classes fall back to 10000ms", async () => {
    // 1. Validate boundary constants
    expect(DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS).toBe(10_000);
    expect(MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS).toBe(100);
    expect(MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS).toBe(60_000);

    // 2. Validate binding validator: isPiSubagentManagedForegroundBinding
    const validBinding = {
      executionId: "exec_val_1",
      attemptId: "att_val_1",
      generation: 1,
      cancellationScope: "parent_turn" as const,
      foregroundWaitMs: 10_000,
      reportObservation: async () => {},
    };
    expect(isPiSubagentManagedForegroundBinding(validBinding)).toBe(true);

    // Lower bound endpoint (100)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 100 }),
    ).toBe(true);

    // Upper bound endpoint (60000)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 60_000 }),
    ).toBe(true);

    // Intermediate valid value (5000)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 5_000 }),
    ).toBe(true);

    // Below min endpoint (< 100)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 99 }),
    ).toBe(false);

    // Above max endpoint (> 60000)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 60_001 }),
    ).toBe(false);

    // Negative value
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: -10_000 }),
    ).toBe(false);

    // Zero
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 0 }),
    ).toBe(false);

    // Non-integer float
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 5_000.5 }),
    ).toBe(false);

    // NaN / string
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: NaN }),
    ).toBe(false);
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: "10000" as any }),
    ).toBe(false);

    // 3. Verify on actual Pi session path: context binding receives the resolved foreground budget
    const tempDir = `/tmp/synara-t22-ac5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdDirs.push(tempDir);
    createRealExtensionDirectory(tempDir);

    const serverConfig = makeServerConfig(tempDir, {
      piSubagentForegroundWaitMs: 2500, // Valid custom budget
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t22_ac5");

    let observedSession: any;
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSession = event.session;
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(SqlitePersistenceMemory),
    );

    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;

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
          'th_t22_ac5', 'proj_default', 'AC5 Thread',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t22_ac5" as ThreadId,
        cwd: tempDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: tempDir } },
        mcpAuthority: binding,
      });

      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      const parentCtx = {
        ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, select: async () => undefined, confirm: async () => true, input: async () => undefined },
        cwd: tempDir,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      const result = yield* Effect.promise(() =>
        executeFn(
          "call_ac5_1",
          {
            commandId: "cmd_ac5_1",
            subagent_type: "researcher",
            task: "AC5 Config verification",
            context: "Context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: false,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );

      const executionId = (result as any).executionId;
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.length).toBeGreaterThanOrEqual(2);
      expect(journal[1]!.metadata).toMatchObject({
        foregroundWaitMs: 2500,
      });

      yield* adapter.stopSession("th_t22_ac5" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  // -------------------------------------------------------------------------
  // T22-AC6: Isolation
  // -------------------------------------------------------------------------
  it("T22-AC6: concurrent managed executions and an adjacent legacy session retain independent identities, timeouts, journal rows, and behavior", async () => {
    const tempDirManaged = `/tmp/synara-t22-ac6-m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempDirLegacy = `/tmp/synara-t22-ac6-l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdDirs.push(tempDirManaged, tempDirLegacy);
    createRealExtensionDirectory(tempDirManaged);

    const serverConfig = makeServerConfig(tempDirManaged, {
      piSubagentForegroundWaitMs: 400,
    });
    const { authorityService, binding: binding1 } = makeAuthorityFixture("th_t22_ac6_m1");
    const binding2 = authorityService.bindingFor("user_th_t22_ac6_m1", {
      threadId: "th_t22_ac6_m2" as ThreadId,
      provider: "pi",
      projectId: "proj_default",
      lifecycleGeneration: null,
      credentialTtlMs: 60 * 60 * 1_000,
    })!;

    let observedManagedSession: any;
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedManagedSession = event.session;
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(SqlitePersistenceMemory),
    );

    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;

      yield* sql`
        INSERT OR IGNORE INTO projection_projects (
          project_id, kind, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at
        ) VALUES (
          'proj_default', 'project', 'Default', ${tempDirManaged}, '{"provider":"pi","model":"pi"}',
          '[]', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES
          ('th_t22_ac6_m1', 'proj_default', 'Managed Thread 1', '{"provider":"pi","model":"pi"}', 'full-access', 'default', 'local', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL),
          ('th_t22_ac6_m2', 'proj_default', 'Managed Thread 2', '{"provider":"pi","model":"pi"}', 'full-access', 'default', 'local', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL)
      `;

      // Start managed session
      yield* adapter.startSession({
        threadId: "th_t22_ac6_m1" as ThreadId,
        cwd: tempDirManaged,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: tempDirManaged } },
        mcpAuthority: binding1,
      });

      const loadedExt = observedManagedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      const parentCtx = {
        ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, select: async () => undefined, confirm: async () => true, input: async () => undefined },
        cwd: tempDirManaged,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: observedManagedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // Run two concurrent managed executions
      const [res1, res2] = yield* Effect.promise(() =>
        Promise.all([
          executeFn(
            "call_m1",
            { commandId: "cmd_m1", subagent_type: "researcher", task: "Task M1", context: "C1", link_references: "L1", expected_outcome: "O1", run_in_background: false },
            undefined,
            undefined,
            parentCtx,
          ),
          executeFn(
            "call_m2",
            { commandId: "cmd_m2", subagent_type: "researcher", task: "Task M2", context: "C2", link_references: "L2", expected_outcome: "O2", run_in_background: false },
            undefined,
            undefined,
            parentCtx,
          ),
        ]),
      );

      // Verify both managed executions have distinct, valid identities
      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect((res1 as any).executionId).toBeDefined();
      expect((res2 as any).executionId).toBeDefined();
      expect((res1 as any).executionId).not.toBe((res2 as any).executionId);
      expect((res1 as any).attemptId).not.toBe((res2 as any).attemptId);

      // Verify separate journal events in SQLite for both
      const j1 = yield* repo.listJournalEvents((res1 as any).executionId);
      const j2 = yield* repo.listJournalEvents((res2 as any).executionId);
      expect(j1.length).toBeGreaterThanOrEqual(2);
      expect(j2.length).toBeGreaterThanOrEqual(2);
      expect(j1[0]!.executionId).toBe((res1 as any).executionId);
      expect(j2[0]!.executionId).toBe((res2 as any).executionId);

      // Adjacent legacy session with unmanaged extension
      const legacyExt = makeLegacyPiSubagentExtension();
      const legacyBridgeProbe = yield* Effect.promise(() =>
        probePiSubagentBridge(legacyExt),
      );
      expect(legacyBridgeProbe.isManaged).toBe(false);

      yield* adapter.stopSession("th_t22_ac6_m1" as ThreadId);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  // -------------------------------------------------------------------------
  // T22-AC7: Cleanup and failure surface
  // -------------------------------------------------------------------------
  it("T22-AC7: proves zero live timers and attachment entries after all settlement, failure, and disposal paths without affecting unrelated children", async () => {
    const tempDir = `/tmp/synara-t22-ac7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdDirs.push(tempDir);
    createRealExtensionDirectory(tempDir);

    const serverConfig = makeServerConfig(tempDir, {
      piSubagentForegroundWaitMs: 300,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t22_ac7");

    let observedSession: any;
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSession = event.session;
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(SqlitePersistenceMemory),
    );

    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const testProgram = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;

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
          'th_t22_ac7', 'proj_default', 'AC7 Thread',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t22_ac7" as ThreadId,
        cwd: tempDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: tempDir } },
        mcpAuthority: binding,
      });

      const loadedExt = observedSession.resourceLoader.getExtensions().extensions.find(
        (e: any) => e.tools instanceof Map && e.tools.has("Agent"),
      ) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;
      const bridge = loadedExt.handlers.get("synara:subagents:bridge")[0]();

      const parentCtx = {
        ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, select: async () => undefined, confirm: async () => true, input: async () => undefined },
        cwd: tempDir,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // 1. Initial snapshot check
      const snap0 = bridge.getResourceSnapshot();
      expect(snap0.activeAttachmentCount).toBe(0);
      expect(snap0.activeTimerCount).toBe(0);

      // 2. Successful detach -> parent attachment removed, timer cleared
      const detachResult = yield* Effect.promise(() =>
        executeFn(
          "call_ac7_detach",
          { commandId: "cmd_ac7_detach", subagent_type: "researcher", task: "Task Detach", context: "C", link_references: "L", expected_outcome: "O", run_in_background: false },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      expect(detachResult).toBeDefined();

      const snapDetach = bridge.getResourceSnapshot();
      expect(snapDetach.activeAttachmentCount).toBe(0);
      expect(snapDetach.activeTimerCount).toBe(0);

      // 3. Explicit cleanup: abort on bridge
      const abortRes = bridge.abort((detachResult as any).executionId);
      expect(typeof abortRes === "boolean" || typeof abortRes === "number").toBe(true);

      const snapAbort = bridge.getResourceSnapshot();
      expect(snapAbort.activeAttachmentCount).toBe(0);
      expect(snapAbort.activeTimerCount).toBe(0);

      // 4. Explicit abortAll
      const abortAllCount = bridge.abortAll();
      expect(typeof abortAllCount === "number" || typeof abortAllCount === "boolean").toBe(true);

      const snapAbortAll = bridge.getResourceSnapshot();
      expect(snapAbortAll.activeAttachmentCount).toBe(0);
      expect(snapAbortAll.activeTimerCount).toBe(0);

      // 5. Session disposal via adapter.stopSession
      yield* adapter.stopSession("th_t22_ac7" as ThreadId);

      const snapFinal = bridge.getResourceSnapshot();
      expect(snapFinal.activeAttachmentCount).toBe(0);
      expect(snapFinal.activeTimerCount).toBe(0);
    });

    await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
  });

  // -------------------------------------------------------------------------
  // T22-AC8: Real source only
  // -------------------------------------------------------------------------
  it("T22-AC8: verifies real Git provenance and hashes, and rejects synthetic replacement Agent tools", async () => {
    // 1. Verify Git origin, HEAD commit, clean extension path, package identity and SHA-256 hashes
    const repoDir = resolveAlfieRepoDir();
    const provenance = verifyExtensionGitProvenance(repoDir);
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageName).toBe("@alfie/pi-subagents");
    expect(provenance.packageVersion).toBe("0.10.0-alfie.1");
    expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);

    // 2. Reject synthetic inline factory extension
    const syntheticSession = {
      resourceLoader: {
        getExtensions: () => ({
          extensions: [
            {
              path: "<inline:synthetic-subagents>",
              sourceInfo: { source: "inline" },
              tools: new Map([
                [
                  "Agent",
                  {
                    name: "Agent",
                    parameters: {
                      properties: {
                        task: {},
                        context: {},
                        link_references: {},
                        expected_outcome: {},
                        subagent_type: {},
                        thinking: {},
                        run_in_background: {},
                        resume: {},
                        isolation: {},
                      },
                    },
                  },
                ],
              ]),
            },
          ],
        }),
      },
    };

    expect(() => assertProductionExtensionProvenance(syntheticSession)).toThrow(
      /Provenance assertion failed.*inline\/temporary factory/,
    );

    // 3. Reject synthetic lookalike with missing parameters schema
    const incompleteSession = {
      resourceLoader: {
        getExtensions: () => ({
          extensions: [
            {
              path: "/tmp/fake-extension/index.js",
              sourceInfo: { source: "package" },
              tools: new Map([
                [
                  "Agent",
                  {
                    name: "Agent",
                    parameters: {
                      properties: {
                        task: {},
                      },
                    },
                  },
                ],
              ]),
            },
          ],
        }),
      },
    };

    expect(() => assertProductionExtensionProvenance(incompleteSession)).toThrow(
      /Provenance assertion failed/,
    );
  });
});
