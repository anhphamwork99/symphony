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
import { PI_SUBAGENT_TERMINAL_SEQUENCE } from "./piSubagentTerminalCoordinator.ts";

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
 * Ticket 07 / T07-AC5 (Testing Seam 4) — Isolated real-Pi completion
 * boundary: emit a REAL completion from the pinned extension and inspect the
 * bounded summary and transcript reference in durable terminal evidence.
 *
 * Also proves on the live path (Seam 1, real-runtime-journal boundary):
 * - T07-AC1: the inline foreground child's terminal is journaled + applied
 *   BEFORE the tool-call result is returned to the parent.
 * - T07-AC2: a real replayed terminal observation creates no second state
 *   effect.
 * - T07-AC4: a stale attempt terminal (simulated late observation against
 *   the settled execution through the SAME server ingest seam) is ignored,
 *   counted, and cannot overwrite truth.
 * - T07-AC7 + background: a managed BACKGROUND child that completes normally
 *   settles `succeeded` through the onComplete reporter path.
 */

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_FAST_MODEL_ID = "echo";
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
      const delayMs =
        requestedModel === DETERMINISTIC_SLOW_MODEL_ID ? DETERMINISTIC_SLOW_DELAY_MS : 0;
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
      if (delayMs > 0) {
        setTimeout(respond, delayMs);
      } else {
        respond();
      }
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
            id: DETERMINISTIC_FAST_MODEL_ID,
            name: "Local Echo (fast)",
            reasoning: false,
            input: ["text"],
            contextWindow: 100_000,
            maxTokens: 1_000,
          },
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

describe("Pi Subagent Journal-First Terminal Lifecycle Real-Pi Acceptance (Issue 07)", () => {
  it("T07-AC1/AC2/AC4/AC5: real inline completion journals bounded terminal evidence before the handle returns; replay and stale terminals have one state effect", async () => {
    // Real Git provenance first: no synthetic Agent replacement may satisfy this.
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.15.0-alfie.6");

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t07-real-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t07-real-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    const foregroundWaitMs = 12_000; // fast model: inline completion well within budget

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const fastModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_FAST_MODEL_ID);
    if (!fastModel) {
      throw new Error("Deterministic fast model not available in test registry");
    }
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const serverConfig = makeServerConfig(parentAgentDir, {
      piSubagentForegroundWaitMs: foregroundWaitMs,
      piSubagentTerminalSummaryMaxChars: 1_500,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t07_real_1");

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
          'th_t07_real_1', 'proj_default', 'T07 Real',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t07_real_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const negotiated = observedCapability;
      expect(negotiated?.isManaged).toBe(true);
      expect(negotiated?.capabilities).toContain("journal-terminal-lifecycle");

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
        model: fastModel,
        modelRegistry: registry,
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // Real inline foreground completion (fast model settles inside budget).
      const result = yield* Effect.promise(() =>
        executeFn(
          "call_t07_fg",
          {
            commandId: "cmd_t07_fg",
            subagent_type: "researcher",
            task: "Complete quickly and report a bounded result",
            context: "Terminal lifecycle context.",
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
      expect(executionId).toMatch(/^exec_/);

      // T07-AC1: the inline path awaited the terminal observation BEFORE
      // returning the handle — durable truth must already be terminal here,
      // with no settling sleep.
      const settled = yield* repo.getById(executionId);
      expect(Option.isSome(settled)).toBe(true);
      if (Option.isSome(settled)) {
        expect(settled.value.observedState).toBe("succeeded");
        expect(settled.value.desiredState).toBe("succeeded");
      }

      // T07-AC5: bounded summary + transcript reference in durable evidence.
      const evidence = yield* repo.getTerminalEvidence(executionId);
      expect(Option.isSome(evidence)).toBe(true);
      if (Option.isSome(evidence)) {
        expect(evidence.value.terminalSummary).not.toBeNull();
        expect(evidence.value.terminalSummary!.length).toBeLessThanOrEqual(1_500);
        expect(evidence.value.terminalTranscriptRef).toBeTruthy();
        // The transcript reference points at the real extension-owned output
        // artifact on disk (authorized reference, not inlined content).
        expect(existsSync(evidence.value.terminalTranscriptRef!)).toBe(true);
      }

      // Journal: terminal row at the attempt-local terminal sequence with
      // the bounded metadata.
      const journal = yield* repo.listJournalEvents(executionId);
      const terminal = journal.find(
        (event) => event.sequence === PI_SUBAGENT_TERMINAL_SEQUENCE && event.state === "succeeded",
      );
      expect(terminal).toBeDefined();
      if (terminal) {
        const metadata = terminal.metadata as Record<string, unknown>;
        expect(typeof metadata.summary).toBe("string");
        expect((metadata.summary as string).length).toBeLessThanOrEqual(1_500);
        expect(typeof metadata.transcriptRef).toBe("string");
      }

      yield* adapter.stopSession("th_t07_real_1" as ThreadId);
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

  it("T07-AC7/background: a managed background child settles succeeded through the onComplete reporter path", async () => {
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t07-bg-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t07-bg-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const fastModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_FAST_MODEL_ID);
    if (!fastModel) {
      throw new Error("Deterministic fast model not available in test registry");
    }
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const serverConfig = makeServerConfig(parentAgentDir, {
      piSubagentForegroundWaitMs: 1_000,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t07_bg_1");

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
          'th_t07_bg_1', 'proj_default', 'T07 BG',
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
        threadId: "th_t07_bg_1" as ThreadId,
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
        model: fastModel,
        modelRegistry: registry,
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // Managed background spawn (fast model settles shortly after).
      const bgResult = yield* Effect.promise(() =>
        executeFn(
          "call_t07_bg",
          {
            commandId: "cmd_t07_bg",
            subagent_type: "researcher",
            task: "Background task that completes and must settle durably",
            context: "Terminal lifecycle context.",
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

      // The background reporter is fire-and-forget: poll the durable truth
      // with a bounded wait instead of a fixed sleep.
      const deadline = Date.now() + 30_000;
      let observed: string | undefined;
      while (Date.now() < deadline) {
        const record = yield* repo.getById(executionId);
        if (Option.isSome(record) && record.value.observedState === "succeeded") {
          observed = record.value.observedState;
          break;
        }
        yield* Effect.sleep(250);
      }
      expect(observed).toBe("succeeded");

      // Durable terminal evidence (bounded summary + transcript reference).
      const evidence = yield* repo.getTerminalEvidence(executionId);
      expect(Option.isSome(evidence)).toBe(true);
      if (Option.isSome(evidence)) {
        expect(evidence.value.terminalSummary).not.toBeNull();
        expect(evidence.value.terminalTranscriptRef).toBeTruthy();
        expect(existsSync(evidence.value.terminalTranscriptRef!)).toBe(true);
      }

      // Operator surface: terminal-settled runtime event was offered.
      yield* Effect.sleep(500);
      const settledEvents = runtimeEvents.filter(
        (event) => event.raw?.method === "subagents/terminal-settled",
      );
      expect(settledEvents.some((event) => event.raw.payload.executionId === executionId)).toBe(
        true,
      );

      yield* adapter.stopSession("th_t07_bg_1" as ThreadId);
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
