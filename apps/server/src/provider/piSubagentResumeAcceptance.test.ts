// FILE: piSubagentResumeAcceptance.test.ts
// Purpose: Ticket 14 / Testing Seams —
//   Seam 3 (T14-AC1/AC4/AC6): isolated real-Pi resume boundary. A REAL
//   managed child (pinned extension, deterministic slow model) spawns through
//   the production adapter path, is orphaned the honest way (the no-owner
//   restart-reconciliation view — exactly what a restarted server process
//   sees), and then ONE explicit resume through the production adapter resume
//   command creates the new child attempt under the SAME executionId while
//   NO implicit path (reconciliation replay) ever does.
// Layer: Server provider wallclock acceptance (real Pi runtime)
// Exports: none (vitest suite)

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, Option } from "effect";
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
import { extractPiSubagentBridge } from "./piSubagentBridge.ts";
import { reconcilePiSubagentExecutions } from "./piSubagentRestartReconciliation.ts";

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
  const candidates = [process.env.ALFIE_REPO_DIR, "/Users/anhpham99/alfie", "../alfie"].filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "agent/extensions/pi-subagents/package.json"))) {
      return resolve(candidate);
    }
  }
  throw new Error(
    "Alfie repo directory not found (expected agent/extensions/pi-subagents). Set ALFIE_REPO_DIR.",
  );
}

function verifyExtensionGitProvenance() {
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

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_FAST_MODEL_ID = "echo";
const DETERMINISTIC_SLOW_MODEL_ID = "echo-slow";
const DETERMINISTIC_SLOW_DELAY_MS = 8000;

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

describe("Pi Subagent Explicit Resume Real-Pi Acceptance (Issue 14)", () => {
  it("T14-AC1/AC4/AC6: one explicit resume creates the new child attempt under the same execution; no implicit path resumes", async () => {
    // Real Git provenance first: no synthetic bridge may satisfy this.
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.14.0-alfie.1");

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t14-real-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t14-real-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    // Foreground budget (1s) < slow-model delay (8s): the child detaches and
    // keeps running — a REAL live child to orphan and resume.
    const foregroundWaitMs = 1_000;

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
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t14_real_1");

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
          'proj_default', 'project', 'Default', ${parentAgentDir}, '{"provider":"pi","model":"pi"}',
          '[]', '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'th_t14_real_1', 'proj_default', 'T14 Real',
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL
        )
      `;

      yield* adapter.startSession({
        threadId: "th_t14_real_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const negotiated = (observedSession as any)[Symbol.for("synara.pi.subagents.probe_cache")];
      expect(negotiated?.isManaged).toBe(true);

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

      // Real detached foreground child (slow model): the tool call returns
      // the handle after the 1s budget while the SAME child keeps running.
      const result = yield* Effect.promise(() =>
        executeFn(
          "call_t14_fg",
          {
            commandId: "cmd_t14_fg",
            subagent_type: "researcher",
            task: "Long-running task for explicit resume",
            context: "Explicit resume context.",
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
      const firstAttemptId = (result as any).attemptId;
      expect(executionId).toMatch(/^exec_/);

      // Wait for the durable started lifecycle (running truth).
      const startedDeadline = Date.now() + 15_000;
      let started = false;
      while (Date.now() < startedDeadline) {
        const record = yield* repo.getById(executionId);
        if (Option.isSome(record) && record.value.observedState === "running") {
          started = true;
          break;
        }
        yield* Effect.sleep(250);
      }
      expect(started).toBe(true);

      // The restart view (no live-owner probe — exactly what a restarted
      // server process sees) orphans the execution honestly.
      const orphaned = yield* reconcilePiSubagentExecutions({
        repository: repo,
        mode: "restart",
        now: () => Date.now(),
      });
      expect(orphaned.outcomes.some((o) => o.kind === "orphaned")).toBe(true);
      const afterOrphan = yield* repo.getById(executionId);
      expect(Option.isSome(afterOrphan)).toBe(true);
      if (Option.isSome(afterOrphan)) {
        expect(afterOrphan.value.observedState).toBe("orphaned");
      }

      // T14-AC3/AC6 (implicit-path half): a SECOND no-owner reconciliation
      // replay must remain idempotent — no new attempt, no resume, no child.
      const replay = yield* reconcilePiSubagentExecutions({
        repository: repo,
        mode: "restart",
        now: () => Date.now(),
      });
      const afterReplay = yield* repo.getById(executionId);
      expect(Option.isSome(afterReplay)).toBe(true);
      const orphanAttemptId = Option.getOrThrow(afterOrphan).attemptId;
      const orphanGeneration = Option.getOrThrow(afterOrphan).generation;
      if (Option.isSome(afterReplay)) {
        expect(afterReplay.value.observedState).toBe("orphaned");
        expect(afterReplay.value.attemptId).toBe(orphanAttemptId);
      }
      // Idempotent replay outcome: already-fenced orphaned evidence with the
      // SAME generation — never a second fence, never a new attempt.
      const replayOutcome = replay.outcomes.find((o) => o.kind === "orphaned");
      expect(replayOutcome).toBeDefined();
      if (replayOutcome && replayOutcome.kind === "orphaned") {
        expect(replayOutcome.generation).toBe(orphanGeneration);
      }

      // T14-AC1/AC6 (explicit half): ONE explicit resume through the
      // production adapter command creates the new attempt and starts the
      // REAL child under the same executionId.
      yield* adapter.resumePiSubagentExecution!("th_t14_real_1" as ThreadId, executionId);

      const resumed = yield* repo.getById(executionId);
      expect(Option.isSome(resumed)).toBe(true);
      let newAttemptId = "";
      let newGeneration = -1;
      if (Option.isSome(resumed)) {
        expect(resumed.value.observedState).toMatch(/^(queued|running)$/);
        expect(resumed.value.attemptId).not.toBe(firstAttemptId);
        expect(resumed.value.attemptId).not.toBe(orphanAttemptId);
        expect(resumed.value.generation).toBe(orphanGeneration + 1);
        newAttemptId = resumed.value.attemptId;
        newGeneration = resumed.value.generation;
      }

      // The REAL bridge registers the resumed child under the new attempt.
      const bridge = extractPiSubagentBridge(observedSession);
      expect(bridge).toBeDefined();
      const resumedChildDeadline = Date.now() + 15_000;
      let resumedChildLive = false;
      while (Date.now() < resumedChildDeadline) {
        const active = bridge!.getActiveExecutions?.() ?? [];
        const live = active.find(
          (child: any) => child.executionId === executionId && child.attemptId === newAttemptId,
        );
        if (live !== undefined && live.isRunning === true) {
          resumedChildLive = true;
          break;
        }
        yield* Effect.sleep(250);
      }
      expect(resumedChildLive).toBe(true);
      expect(newGeneration).toBeGreaterThan(1);

      // Replay of the same explicit resume is idempotent: the outcome surfaces
      // already-applied semantics through the adapter boundary (no error
      // corruption, no second child) — a second call resolves successfully
      // while the bridge still shows exactly ONE resumed child attempt.
      yield* adapter.resumePiSubagentExecution!("th_t14_real_1" as ThreadId, executionId);
      const activeAfterReplay = bridge!.getActiveExecutions?.() ?? [];
      const resumedLiveCount = activeAfterReplay.filter(
        (child: any) => child.attemptId === newAttemptId,
      ).length;
      expect(resumedLiveCount).toBe(1);

      yield* adapter.stopSession("th_t14_real_1" as ThreadId);
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
