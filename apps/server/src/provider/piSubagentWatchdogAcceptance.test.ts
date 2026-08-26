import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, Option, Stream } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { DateTime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { type ThreadId } from "@synara/contracts";

import { makeMcpSessionAuthorityRegistry } from "../agentGateway/mcpSessionAuthority.ts";
import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../agentGateway/Services/McpSessionAuthority.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { makePiAdapterLive } from "./Layers/PiAdapter.ts";
import { PiAdapter } from "./Services/PiAdapter.ts";
import { runPiSubagentWatchdogEscalation } from "./piSubagentWatchdogEscalation.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";

/**
 * Ticket 15 — Watchdog escalation real-Pi acceptance (approved Testing
 * Seams: isolated real-Pi boundary for child abort and provider-turn
 * interrupt, including acknowledgement timing).
 *
 * Proven against the REAL Alfie pi-subagents extension (pinned git
 * provenance, no synthetic Agent replacement):
 * - T15-AC1/AC4: a wall-time-expired background child receives the
 *   watchdog's stage-1 child abort through the real bridge and settles to
 *   `cancelled` ONLY through the child acknowledgement (termination
 *   evidence), exactly once.
 * - T15-AC2/AC5: a stage-1 acknowledgement timeout (bound shorter than the
 *   real child's settlement latency) advances to the provider-turn
 *   interrupt WITHOUT ever claiming stopped/cancelled — the projection
 *   keeps honest `cancelling` until evidence exists; timer expiry alone is
 *   never termination proof.
 */

// Local provenance helpers (established pattern: cross-test-file imports
// double-register the source file's suites in vitest).
const __dirname = dirname(fileURLToPath(import.meta.url));

interface ProvenanceManifest {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly hashes: Record<string, string>;
}

function loadProvenanceManifest(): ProvenanceManifest {
  const manifestPath = resolve(__dirname, "./test-fixtures/piSubagentExtensionProvenance.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function normalizeGitUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (normalized.endsWith(".git")) normalized = normalized.slice(0, -4);
  if (normalized.startsWith("git@github.com:")) {
    normalized = "https://github.com/" + normalized.slice("git@github.com:".length);
  }
  return normalized;
}

function resolveAlfieRepoDir(): string {
  const candidates = [
    process.env.ALFIE_REPO_DIR,
    process.env.ALFIE_EXTENSION_DIR
      ? resolve(process.env.ALFIE_EXTENSION_DIR, "../../..")
      : undefined,
    resolve(process.cwd(), "../../../alfie"),
    resolve(process.cwd(), "../../alfie"),
    resolve(process.cwd(), "../alfie"),
    resolve(__dirname, "../../../../../../alfie"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (dir && existsSync(dir) && existsSync(join(dir, ".git"))) return resolve(dir);
  }
  throw new Error(
    "Provenance assertion failed: could not locate version-controlled alfie repository. Set ALFIE_REPO_DIR or ensure alfie exists alongside symphony.",
  );
}

function verifyExtensionGitProvenance(): { isVerified: boolean; packageVersion: string } {
  const manifest = loadProvenanceManifest();
  const dir = resolveAlfieRepoDir();
  const originUrl = execSync("git config --get remote.origin.url", {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (normalizeGitUrl(originUrl) !== normalizeGitUrl(manifest.expectedRepositoryUrl)) {
    throw new Error("Provenance assertion failed: repository origin mismatch.");
  }
  const headCommit = execSync("git rev-parse HEAD", {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (headCommit !== manifest.pinnedCommit) {
    throw new Error(
      `Provenance assertion failed: HEAD commit '${headCommit}' does not match pinned commit '${manifest.pinnedCommit}'.`,
    );
  }
  const gitStatus = execSync("git status --porcelain agent/extensions/pi-subagents", {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes("node_modules"))
    .join("\n");
  if (gitStatus.length > 0) {
    throw new Error(
      `Provenance assertion failed: extension path has uncommitted changes:\n${gitStatus}`,
    );
  }
  const pkg = JSON.parse(
    readFileSync(join(dir, "agent/extensions/pi-subagents/package.json"), "utf8"),
  );
  return { isVerified: true, packageVersion: pkg.version };
}

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_SLOW_MODEL_ID = "echo-slow";
const DETERMINISTIC_SLOW_DELAY_MS = 4000;

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function startDeterministicModelServer(): Promise<{
  readonly close: () => Promise<void>;
  readonly baseUrl: string;
}> {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    let body = "";
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { messages?: Array<{ role: string }> };
      const userText =
        parsed.messages?.findLast((message) => message.role === "user")?.role === "user"
          ? "watchdog acceptance task"
          : "watchdog acceptance task";
      const respond = () => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunkEvent = (delta: Record<string, unknown>, finishReason: string | null) =>
          `data: ${JSON.stringify({
            id: `chatcmpl-${requestCount}`,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta,
                finish_reason: finishReason,
              },
            ],
          })}\n\n`;
        res.write(chunkEvent({ role: "assistant" }, null));
        res.write(chunkEvent({ content: userText }, null));
        res.write(chunkEvent({}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
      };
      setTimeout(respond, DETERMINISTIC_SLOW_DELAY_MS);
    });
  });

  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Could not bind deterministic model server");
      }
      resolvePromise({
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          ),
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
    });
  });
}

function writeAgentDir(tempAgentDir: string, baseUrl: string): void {
  const repoDir = resolveAlfieRepoDir();
  const versionedDir = join(repoDir, "agent", "extensions", "pi-subagents");
  const extensionsDir = join(tempAgentDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  symlinkSync(versionedDir, join(extensionsDir, "pi-subagents"), "dir");
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, join(extensionsDir, "shared"), "dir");
  }
  const systemDir = join(repoDir, "agent", "system");
  if (existsSync(systemDir)) {
    symlinkSync(systemDir, join(tempAgentDir, "system"), "dir");
  }
  const models = {
    providers: {
      [DETERMINISTIC_MODEL_PROVIDER_ID]: {
        name: "Synara Local Echo (deterministic test fixture provider)",
        baseUrl,
        api: "openai-completions",
        apiKey: "synara-local-test-key",
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [
          {
            id: DETERMINISTIC_SLOW_MODEL_ID,
            name: "Local Echo (slow)",
            reasoning: false,
            input: ["text"],
            contextWindow: 100_000,
            maxTokens: 1_000,
          },
        ],
      },
    },
  };
  writeFileSync(
    join(tempAgentDir, "auth.json"),
    JSON.stringify({
      [DETERMINISTIC_MODEL_PROVIDER_ID]: { type: "api_key", key: "synara-local-test-key" },
    }),
  );
  writeFileSync(join(tempAgentDir, "models.json"), JSON.stringify(models));
}

function makeServerConfig(
  tempDir: string,
  overrides?: Partial<ServerConfigShape>,
): ServerConfigShape {
  return {
    mode: "web",
    port: 3781,
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

describe("Pi Subagent Watchdog Escalation Real-Pi Acceptance (Issue 15)", () => {
  it("T15-AC1/AC4: wall-time expiry escalates a real background child through stage-1 abort and settles exactly once on child acknowledgement", async () => {
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.15.0-alfie.6");

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t15-real-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t15-real-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const slowModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_SLOW_MODEL_ID);
    if (!slowModel) {
      throw new Error("Deterministic slow model not available in test registry");
    }
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const serverConfig = makeServerConfig(parentAgentDir);
    const { authorityService, binding } = makeAuthorityFixture("th_t15_real_1");

    let observedSession: any;
    let observedCapability: any;

    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSession = event.session;
        observedCapability = event.capability;
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
          'proj_default', 'project', 'Default', ${parentAgentDir}, '{"provider":"pi","model":"pi"}',
          '[]', '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'th_t15_real_1', 'proj_default', 'T15 Real',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t15_real_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const negotiated = observedCapability;
      expect(negotiated?.isManaged).toBe(true);
      expect(negotiated?.capabilities).toContain("durable-cancellation");

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
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
        cwd: parentAgentDir,
        model: slowModel,
        modelRegistry: registry,
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // One background managed child in the parent-turn scope.
      const bgResult = yield* Effect.promise(() =>
        executeFn(
          "call_t15_bg",
          {
            commandId: "cmd_t15_bg",
            subagent_type: "researcher",
            task: "Background child that the watchdog must durably cancel",
            context: "Watchdog context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: true,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      const executionId = (bgResult as any).executionId;
      expect(executionId).toMatch(/^exec_/);

      // The child is live in the bridge active set before escalation.
      const activeBefore = bridge.getActiveExecutions();
      expect(activeBefore.some((e: any) => e.executionId === executionId)).toBe(true);

      // Journal the durable band-60 wall-time trigger directly (the ticket 13
      // sweep's committed effect) so the watchdog pass consumes it.
      const stored = yield* repo.getById(executionId);
      expect(Option.isSome(stored)).toBe(true);
      const { attemptId, generation } = Option.getOrThrow(stored);
      yield* repo.recordWallTimeExpiryEvent({
        executionId,
        attemptId,
        generation,
        occurredAt: new Date().toISOString(),
        wallTimeMs: 60_000,
      });

      // Stage-1 bound must exceed the real settlement latency of the slow
      // model (~4s) so the child acknowledgement IS the evidence.
      const diagnostics: Array<{ executionId: string; diagnosticCode: string }> = [];
      const result = yield* Effect.promise(() =>
        runPiSubagentWatchdogEscalation({
          repository: repo,
          resolveBridge: () => bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => bridge.getActiveExecutions(),
          interruptProviderTurn: async () => {
            throw new Error("stage-2 interrupt must not run when stage 1 settles on evidence");
          },
          stopProviderSession: async () => {
            throw new Error("stage-3 session stop must not run when stage 1 settles on evidence");
          },
          stageTimeoutMs: 12_000,
          cancelRetryLimit: 1,
          leaseDurationMs: 30000,
          idleAfterMs: 60000,
          onDiagnostic: (event) => {
            diagnostics.push({
              executionId: event.executionId,
              diagnosticCode: event.diagnosticCode,
            });
          },
        }),
      );

      expect(result.escalations).toHaveLength(1);
      expect(result.escalations[0]!.outcome).toMatchObject({
        kind: "settled_by_evidence",
        evidence: "cancelled_ack",
      });
      expect(
        diagnostics.some(
          (event) => event.diagnosticCode === "pi_subagent_watchdog_walltime_escalation",
        ),
      ).toBe(true);

      // Settled exactly once through the normal lifecycle: cancelled with
      // child_ack evidence, and the watchdog stage records stop at band 70.
      const recordOption = yield* repo.getById(executionId);
      expect(Option.isSome(recordOption)).toBe(true);
      if (Option.isSome(recordOption)) {
        expect(recordOption.value.observedState).toBe("cancelled");
        expect(recordOption.value.desiredState).toBe("cancelled");
      }
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.filter((event) => event.sequence === 92)).toHaveLength(1);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.escalationStarted),
      ).toBe(true);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff),
      ).toBe(false);
      expect(journal.some((event) => event.sequence === 90)).toBe(true);

      // The child is gone from the live active set.
      const activeAfter = bridge.getActiveExecutions();
      expect(activeAfter.some((e: any) => e.executionId === executionId)).toBe(false);

      yield* adapter.stopSession("th_t15_real_1" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      await modelServer.close();
    }
  }, 120_000);

  it("T15-AC2/AC5: a stage-1 acknowledgement timeout advances to the provider-turn interrupt without ever claiming stopped or cancelled", async () => {
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t15-real-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t15-real-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const slowModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_SLOW_MODEL_ID);
    if (!slowModel) {
      throw new Error("Deterministic slow model not available in test registry");
    }
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const serverConfig = makeServerConfig(parentAgentDir);
    const { authorityService, binding } = makeAuthorityFixture("th_t15_real_2");

    let observedSession: any;
    let observedCapability: any;
    let interruptDispatched = 0;
    let sessionStopDispatched = 0;

    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSession = event.session;
        observedCapability = event.capability;
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
          'proj_default', 'project', 'Default', ${parentAgentDir}, '{"provider":"pi","model":"pi"}',
          '[]', '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'th_t15_real_2', 'proj_default', 'T15 Real Timeout',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
        )
      `;

      yield* Stream.runForEach(adapter.streamEvents, () => Effect.void).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t15_real_2" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const negotiated = observedCapability;
      expect(negotiated?.isManaged).toBe(true);

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
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
        cwd: parentAgentDir,
        model: slowModel,
        modelRegistry: registry,
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      const bgResult = yield* Effect.promise(() =>
        executeFn(
          "call_t15_to",
          {
            commandId: "cmd_t15_to",
            subagent_type: "researcher",
            task: "Background child whose acknowledgement will time out",
            context: "Watchdog context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: true,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      const executionId = (bgResult as any).executionId;

      const stored = yield* repo.getById(executionId);
      const { attemptId, generation } = Option.getOrThrow(stored);
      yield* repo.recordWallTimeExpiryEvent({
        executionId,
        attemptId,
        generation,
        occurredAt: new Date().toISOString(),
        wallTimeMs: 60_000,
      });

      // Stage-1 bound is FAR below the real settlement latency (~4s): the
      // acknowledgement cannot arrive in time, so the watchdog must advance
      // to the provider-turn interrupt (stage 2) without claiming anything.
      const result = yield* Effect.promise(() =>
        runPiSubagentWatchdogEscalation({
          repository: repo,
          resolveBridge: () => bridge,
          isOwnerGenerationDead: () => false,
          listActive: () => bridge.getActiveExecutions(),
          interruptProviderTurn: async () => {
            interruptDispatched += 1;
            // The real provider-turn interrupt control: abort the live
            // session's active turn (stage 2 evidence pathway).
            await (observedSession as any).abort();
          },
          stopProviderSession: async () => {
            sessionStopDispatched += 1;
            return "uncertain" as const;
          },
          stageTimeoutMs: 300,
          cancelRetryLimit: 0,
          leaseDurationMs: 30000,
          idleAfterMs: 60000,
        }),
      );

      expect(result.escalations).toHaveLength(1);
      const outcome = result.escalations[0]!.outcome;
      // The chain progressed through interrupt and session stop; the honest
      // outcome is cleanup_uncertain (Ticket 16 owns teardown next).
      expect(outcome).toMatchObject({ kind: "cleanup_uncertain" });
      expect(interruptDispatched).toBe(1);
      expect(sessionStopDispatched).toBe(1);

      // Timer expiry alone is NEVER termination proof (T15-AC5): the
      // projection keeps honest cancelling — no stopped/cancelled claim
      // anywhere in the journal band or aggregate.
      const recordOption = yield* repo.getById(executionId);
      expect(Option.isSome(recordOption)).toBe(true);
      if (Option.isSome(recordOption)) {
        expect(recordOption.value.desiredState).toBe("cancelling");
        expect(["cancelled", "succeeded", "failed", "rejected"]).not.toContain(
          recordOption.value.observedState,
        );
      }
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.some((event) => event.sequence === 92)).toBe(false);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.childAbortTimeout),
      ).toBe(true);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt),
      ).toBe(true);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop),
      ).toBe(true);
      expect(
        journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff),
      ).toBe(true);

      // Late events cannot claim success: a late terminal from the orphaned
      // attempt after the teardown handoff is counted as stale (Ticket 16's
      // fencing guards; here we prove the watchdog itself claimed nothing).
      yield* adapter.stopSession("th_t15_real_2" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      await modelServer.close();
    }
  }, 120_000);
});
