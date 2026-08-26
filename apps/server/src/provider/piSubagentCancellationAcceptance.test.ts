import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
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

function computeSha256(filePath: string): string {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
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
  if (pkg.name !== manifest.packageName || pkg.version !== manifest.packageVersion) {
    throw new Error(
      `Provenance assertion failed: package identity mismatch (${pkg.name}@${pkg.version}).`,
    );
  }
  for (const [relPath, expectedHash] of Object.entries(manifest.hashes)) {
    const computed = computeSha256(join(dir, relPath));
    if (computed !== expectedHash) {
      throw new Error(`Provenance assertion failed: SHA-256 mismatch for '${relPath}'.`);
    }
  }
  return { isVerified: true, packageVersion: pkg.version };
}

/**
 * Ticket 06 / T06-AC2, T06-AC4, T06-AC5, T06-AC7 real-Pi acceptance: Stop on
 * a parent turn runs the durable cancellation coordinator against the ACTUAL
 * pinned extension (no synthetic Agent replacement) with the deterministic
 * loopback model fixture. Proves on the live path:
 *
 * - T06-AC2: adapter.interruptTurn targets every managed child declaring the
 *   parent-turn scope — a foreground-DETACHED child and a BACKGROUND child
 *   in the same thread are both cancelled.
 * - T06-AC4: the durable aggregate reaches `cancelled` only through a child
 *   terminal acknowledgement carrying the same attempt/generation (journal
 *   rows cancelling → cancelled with evidenceChannel child_ack).
 * - T06-AC5: `session.abort()` resolution alone is insufficient — the test
 *   drives interruptTurn (which itself awaits session.abort()) and asserts
 *   the durable state was already settled by evidence, not by the abort
 *   promise.
 * - T06-AC7: the background managed spawn receives and honors parent abort
 *   propagation (the real bridge.cancel aborts the background record and the
 *   ack resolves after its settlement).
 */

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_SLOW_MODEL_ID = "echo-slow";
const DETERMINISTIC_SLOW_DELAY_MS = 4000;

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

function startDeterministicModelServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let requestedModel = "";
      try {
        requestedModel = JSON.parse(raw)?.model ?? "";
      } catch {
        requestedModel = "";
      }
      // Slow model never finishes a turn quickly enough to self-settle: the
      // child stays genuinely live until the durable cancel aborts it.
      const respond = () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunkEvent = (delta: Record<string, unknown>, finishReason: string | null) =>
          `data: ${JSON.stringify({
            id: "chatcmpl-synara-local-echo",
            object: "chat.completion.chunk",
            created: 0,
            model: requestedModel,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`;
        res.write(chunkEvent({ role: "assistant", content: "ACK" }, null));
        res.write(chunkEvent({}, "stop"));
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-synara-local-echo",
            object: "chat.completion.chunk",
            created: 0,
            model: requestedModel,
            choices: [],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      };
      setTimeout(respond, DETERMINISTIC_SLOW_DELAY_MS);
    });
  });
  return new Promise((resolve_) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve_({
        server,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
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

describe("Pi Subagent Durable Parent-Turn Cancellation Real-Pi Acceptance (Issue 06)", () => {
  it("T06-AC2/AC4/AC5/AC7: Stop cancels foreground-detached and background children with termination evidence", async () => {
    // Real Git provenance first: no synthetic Agent replacement may satisfy this.
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.15.0-alfie.6");

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t06-real-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t06-real-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    const foregroundWaitMs = 1_500; // detach well before the slow model settles
    // The acknowledgement bound must cover the real settlement latency of the
    // deterministic slow model (the abort signal does not cancel an
    // in-flight SSE request that has not yet received headers; the child's
    // promise settles when the stream closes at ~4s). 8s keeps the bound
    // well below the wallclock testTimeout while proving bounded waits.
    const ackTimeoutMs = 8_000;

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

    const serverConfig = makeServerConfig(parentAgentDir, {
      piSubagentForegroundWaitMs: foregroundWaitMs,
      piSubagentCancelAckTimeoutMs: ackTimeoutMs,
      piSubagentCancelRetryLimit: 1,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t06_real_1");

    const runtimeEvents: any[] = [];
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
          'th_t06_real_1', 'proj_default', 'T06 Real',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
        )
      `;

      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: "th_t06_real_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      // Managed negotiation with the REAL extension must include
      // durable-cancellation now.
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

      // 1. Foreground child that detaches within the budget and keeps running.
      const fgResult = yield* Effect.promise(() =>
        executeFn(
          "call_t06_fg",
          {
            commandId: "cmd_t06_fg",
            subagent_type: "researcher",
            task: "Detached foreground child that must be durably cancelled",
            context: "Cancellation context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: false,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      const fgExecutionId = (fgResult as any).executionId;
      expect(fgExecutionId).toMatch(/^exec_/);
      expect((fgResult as any).details?.disposition ?? "detached").toBeTruthy();

      // 2. Background managed child in the same parent-turn scope (T06-AC2/AC7).
      const bgResult = yield* Effect.promise(() =>
        executeFn(
          "call_t06_bg",
          {
            commandId: "cmd_t06_bg",
            subagent_type: "researcher",
            task: "Background child that must receive the durable cancel",
            context: "Cancellation context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: true,
          },
          undefined,
          undefined,
          parentCtx,
        ),
      );
      const bgExecutionId = (bgResult as any).executionId;
      expect(bgExecutionId).toMatch(/^exec_/);

      // Both children are live in the bridge active set before Stop.
      const activeBefore = bridge.getActiveExecutions();
      expect(activeBefore.some((e: any) => e.executionId === fgExecutionId)).toBe(true);
      expect(activeBefore.some((e: any) => e.executionId === bgExecutionId)).toBe(true);

      // 3. Stop on the parent turn: interruptTurn runs the durable
      // coordinator BEFORE session.abort (T06-AC5: the abort promise itself
      // is never the termination proof).
      yield* adapter.interruptTurn("th_t06_real_1" as ThreadId);

      // 4. Termination evidence settled durably: both executions reached
      // cancelled through child acknowledgements carrying the same
      // attempt/generation (T06-AC4).
      for (const executionId of [fgExecutionId, bgExecutionId]) {
        const recordOption = yield* repo.getById(executionId);
        expect(Option.isSome(recordOption)).toBe(true);
        if (Option.isSome(recordOption)) {
          expect(recordOption.value.observedState).toBe("cancelled");
          expect(recordOption.value.desiredState).toBe("cancelled");
        }
        const journal = yield* repo.listJournalEvents(executionId);
        const cancelling = journal.find((event) => event.state === "cancelling");
        expect(cancelling).toBeDefined();
        const cancelledEvent = journal.find((event) => event.state === "cancelled");
        expect(cancelledEvent).toBeDefined();
        expect(cancelledEvent!.attemptId).toBe(cancelling!.attemptId);
        expect(cancelledEvent!.generation).toBe(cancelling!.generation);
        expect(cancelledEvent!.metadata).toMatchObject({ evidenceChannel: "child_ack" });
      }

      // 5. The children are gone from the live active set (T06-AC7: the
      // background child received and honored the abort).
      const activeAfter = bridge.getActiveExecutions();
      expect(activeAfter.some((e: any) => e.executionId === fgExecutionId)).toBe(false);
      expect(activeAfter.some((e: any) => e.executionId === bgExecutionId)).toBe(false);

      // 6. A cancellation-settled runtime event was offered for each child.
      // Give the forked streamEvents consumer a moment to drain the offered
      // runtime events before filtering (the durable truth above is the
      // primary evidence; this is the operator-visibility surface).
      yield* Effect.sleep(250);
      const settledEvents = runtimeEvents.filter(
        (event) => event.raw?.method === "subagents/cancel-settled",
      );
      const settledIds = settledEvents.map((e) => e.raw.payload.executionId);
      expect(settledIds).toEqual(expect.arrayContaining([fgExecutionId, bgExecutionId]));

      yield* adapter.stopSession("th_t06_real_1" as ThreadId);
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

  it("T06-AC6/T06-AC1: replayed Stop against settled executions re-dispatches nothing and keeps durable truth", async () => {
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t06-replay-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t06-replay-${Date.now()}-child`;
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

    const serverConfig = makeServerConfig(parentAgentDir, {
      piSubagentForegroundWaitMs: 1_000,
      piSubagentCancelAckTimeoutMs: 8_000,
      piSubagentCancelRetryLimit: 1,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t06_replay_1");

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
          'th_t06_replay_1', 'proj_default', 'T06 Replay',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t06_replay_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

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
          "call_t06_replay",
          {
            commandId: "cmd_t06_replay",
            subagent_type: "researcher",
            task: "Background child for the replay test",
            context: "Cancellation context.",
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

      // First Stop settles the child.
      yield* adapter.interruptTurn("th_t06_replay_1" as ThreadId);
      const afterFirst = yield* repo.getById(executionId);
      expect(Option.isSome(afterFirst)).toBe(true);
      if (Option.isSome(afterFirst)) {
        expect(afterFirst.value.observedState).toBe("cancelled");
      }
      const journalAfterFirst = yield* repo.listJournalEvents(executionId);
      const cancellingCount = journalAfterFirst.filter(
        (event) => event.state === "cancelling",
      ).length;
      const cancelledCount = journalAfterFirst.filter(
        (event) => event.state === "cancelled",
      ).length;

      // Replayed Stop: nothing left in the parent-turn scope — no new intent
      // rows, no new ack rows, no new dispatch (T06-AC1 idempotency).
      yield* adapter.interruptTurn("th_t06_replay_1" as ThreadId);
      const journalAfterReplay = yield* repo.listJournalEvents(executionId);
      expect(journalAfterReplay.filter((event) => event.state === "cancelling").length).toBe(
        cancellingCount,
      );
      expect(journalAfterReplay.filter((event) => event.state === "cancelled").length).toBe(
        cancelledCount,
      );
      const afterReplay = yield* repo.getById(executionId);
      if (Option.isSome(afterReplay)) {
        expect(afterReplay.value.observedState).toBe("cancelled");
      }

      yield* adapter.stopSession("th_t06_replay_1" as ThreadId);
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
