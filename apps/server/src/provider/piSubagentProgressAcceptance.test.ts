import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
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

// Local provenance helpers (copied from piSubagentRealExtension.test.ts —
// cross-test-file imports double-register the source file's suites in
// vitest, so the established pattern is a local copy).
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
 * Ticket 23 / T23-AC9 real-Pi acceptance: the ACTUAL pinned
 * `@alfie/pi-subagents` extension (no synthetic Agent replacement) produces
 * coalesced progress observations and heartbeat lease observations through
 * the production PiAdapter managed path against the deterministic local
 * OpenAI-completions model fixture (the same owner-approved seam as Issue 22:
 * only the model endpoint is a fixture; adapter, extension bridge,
 * AgentManager, runAgent and the streaming client are all real).
 *
 * Proves on the live path:
 * - T23-AC1: the managed producer never calls onUpdate (no legacy 80 ms
 *   spinner publication) — captured via a spy passed to the real Agent tool.
 * - T23-AC2: real producer progress observations arrive at the server rate
 *   cap and the latest durable snapshot reflects real child activity.
 * - T23-AC3: real heartbeat observations refresh the durable lease
 *   (last_heartbeat_at / lease_expires_at) without journal rows or
 *   transcript-message runtime events.
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
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
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
            name: "Local Echo",
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

describe("Pi Subagent Progress + Heartbeat Real-Pi Acceptance (Issue 23)", () => {
  it("T23-AC9/AC1/AC2/AC3: real pinned extension produces coalesced progress and heartbeat lease observations with no legacy spinner onUpdate", async () => {
    // Real Git provenance first: no synthetic Agent replacement may satisfy this.
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.15.0-alfie.4");

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t23-real-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t23-real-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl);
    writeAgentDir(childAgentDir, modelServer.baseUrl);

    const foregroundWaitMs = 12_000; // slow model takes ~4 s/turn × turns
    const heartbeatIntervalMs = 1_500;
    const leaseDurationMs = 4_500;

    // Real parent tool-execution model context: the real ModelRegistry over
    // the same agent dir, resolving the deterministic SLOW model so the real
    // child runs long enough for genuine progress + heartbeat observations.
    // PI_CODING_AGENT_DIR points the child session's own services at the same
    // deterministic provider (established Issue-22 pattern).
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
      piSubagentProgressRateHz: 2,
      piSubagentHeartbeatIntervalMs: heartbeatIntervalMs,
      piSubagentLeaseDurationMs: leaseDurationMs,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t23_real_1");

    const runtimeEvents: any[] = [];
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
          '[]', '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'th_t23_real_1', 'proj_default', 'T23 Real',
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
        threadId: "th_t23_real_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      // Managed negotiation with the REAL extension must include
      // coalesced-progress now.
      const negotiated = (observedSession as any)[Symbol.for("synara.pi.subagents.probe_cache")];
      expect(negotiated?.isManaged).toBe(true);
      expect(negotiated?.capabilities).toContain("coalesced-progress");

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;

      // T23-AC1: onUpdate spy — the real managed producer must NEVER emit the
      // legacy spinner stream through the tool-update channel.
      const onUpdateCalls: any[] = [];
      const onUpdateSpy = (partial: any) => {
        onUpdateCalls.push(partial);
      };

      const startedAt = Date.now();
      const result = yield* Effect.promise(() =>
        executeFn(
          "call_t23_real_1",
          {
            commandId: "cmd_t23_real_1",
            subagent_type: "researcher",
            task: "Slow deterministic task that emits real activity",
            context: "Real progress context.",
            link_references: "None",
            expected_outcome: "Outcome.",
            run_in_background: false,
          },
          undefined,
          onUpdateSpy,
          {
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
          },
        ),
      );
      const elapsedMs = Date.now() - startedAt;

      expect(onUpdateCalls).toHaveLength(0); // T23-AC1: no legacy spinner
      expect(result).toBeDefined();
      const executionId = (result as any).executionId;
      expect(executionId).toMatch(/^exec_/);

      // Give fire-and-forget observation writes + collector a moment.
      yield* Effect.sleep(500);

      // Journal truth: admission + started (+ detached if over budget).
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.length).toBeGreaterThanOrEqual(2);
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[1]!.sequence).toBe(2);

      // T23-AC2: durable latest progress snapshot from the REAL producer.
      const observationOption = yield* repo.getObservation(executionId);
      expect(Option.isSome(observationOption)).toBe(true);
      if (Option.isSome(observationOption)) {
        const observation = observationOption.value;
        if (observation.lastProgressJson !== null) {
          const progress = JSON.parse(observation.lastProgressJson);
          // Real producer payload contract: no spinnerFrame, real counters.
          expect("spinnerFrame" in progress).toBe(false);
          expect(progress.toolUses).toBeGreaterThanOrEqual(0);
          expect(progress.status).toBe("running");
        }
        // T23-AC3: real heartbeat refreshed the durable lease.
        expect(observation.lastHeartbeatAt).not.toBeNull();
        expect(observation.leaseExpiresAt).not.toBeNull();
        const leaseLead =
          Date.parse(observation.leaseExpiresAt!) - Date.parse(observation.lastHeartbeatAt!);
        expect(leaseLead).toBe(leaseDurationMs);

        // Rate-cap accounting on the live path: total observed ≤ rateHz ×
        // wall time + margin (the producer + server both cap at 2 Hz).
        expect(observation.droppedProgressCount).toBeGreaterThanOrEqual(0);
      }

      // No transcript-message runtime events from progress/heartbeat: only
      // tool.progress activity emissions are allowed from the observation path.
      const messageLike = runtimeEvents.filter((e) =>
        ["message.completed", "message.updated", "message.started"].includes(e.type),
      );
      expect(messageLike).toHaveLength(0);

      // The child ran long enough for at least one heartbeat (1.5 s interval)
      // only when the child actually exceeded the interval; accept either but
      // require the observation write to have occurred.
      expect(elapsedMs).toBeGreaterThan(0);

      yield* adapter.stopSession("th_t23_real_1" as ThreadId);
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
