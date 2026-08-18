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
 * Ticket 09 / Testing Seam 3 (T09-AC5) — Isolated real-Pi mixed
 * managed/legacy boundary: ownership acknowledgement suppresses only the
 * managed nudge.
 *
 * - Managed boundary (pinned 0.14.0 extension advertising
 *   completion-delivery-ownership): a real background completion's terminal
 *   observation resolves (durable terminal+outbox commit = ownership ack) →
 *   the extension nudge stays suppressed → the Synara per-thread coordinator
 *   delivers exactly ONE follow-up turn on the parent session at the safe
 *   boundary → the entry settles acknowledged after the follow-up turn.
 * - Legacy boundary (the same extension family at the pre-09 pinned commit
 *   608c1c57d / 0.13.0-alfie.1, loaded from a detached git worktree): the
 *   legacy nudge remains the delivery mechanism — Synara dispositions the
 *   entry as legacy-owned (delivered+acknowledged at terminal-persist) and
 *   injects NO follow-up of its own (no double notification).
 */

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_FAST_MODEL_ID = "echo";

const createdDirs: string[] = [];
const createdWorktrees: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  for (const worktree of createdWorktrees.splice(0)) {
    try {
      execSync(`git worktree remove --force ${worktree}`, {
        cwd: resolveAlfieRepoDir(),
        stdio: ["ignore", "ignore", "ignore"],
      });
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

function writeAgentDir(tempAgentDir: string, baseUrl: string, extensionRepoDir: string): void {
  const versionedDir = join(extensionRepoDir, "agent", "extensions", "pi-subagents");
  const extensionsDir = join(tempAgentDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  symlinkSync(versionedDir, join(extensionsDir, "pi-subagents"), "dir");
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, join(extensionsDir, "shared"), "dir");
  }
  const systemDir = join(extensionRepoDir, "agent", "system");
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

/**
 * Detached git worktree of the alfie repo at the PRE-09 pinned commit — the
 * real legacy extension family (0.13.0-alfie.1) with
 * journal-terminal-lifecycle but WITHOUT completion-delivery-ownership.
 */
function materializeLegacyExtensionWorktree(): string {
  const repoDir = resolveAlfieRepoDir();
  const worktreeDir = `/tmp/synara-t09-legacy-worktree-${Date.now()}`;
  execSync(`git worktree add --detach ${worktreeDir} 608c1c57d`, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  createdWorktrees.push(worktreeDir);
  createdDirs.push(worktreeDir);
  // The extension resolves its dependencies from the workspace-level
  // node_modules (agent/extensions/node_modules), which a fresh worktree
  // lacks — link the live one so the legacy extension loads for real.
  symlinkSync(
    join(repoDir, "agent", "extensions", "node_modules"),
    join(worktreeDir, "agent", "extensions", "node_modules"),
    "dir",
  );
  const rootModules = join(repoDir, "node_modules");
  if (existsSync(rootModules)) {
    symlinkSync(rootModules, join(worktreeDir, "node_modules"), "dir");
  }
  // The runtime loads the BUILT entry (index.js → dist/), which is
  // gitignored — compile the legacy checkout in the worktree. The legacy
  // source type-checks against ITS pinned peers; the linked workspace
  // node_modules is newer and reports peer-type drift — tsc still EMITS the
  // JavaScript (no noEmitOnError), which is what the runtime loads. Verify
  // the emitted entry exists and is the LEGACY build (advertises
  // journal-terminal-lifecycle, does NOT advertise
  // completion-delivery-ownership).
  try {
    execSync("bun x tsc", {
      cwd: join(worktreeDir, "agent", "extensions", "pi-subagents"),
      encoding: "utf8",
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // The legacy source type-checks against ITS pinned peers; the linked
    // workspace node_modules is newer and reports peer-type drift. tsc
    // still EMITS the JavaScript (what the runtime loads); the artifact
    // checks below are the load-bearing verification.
  }
  const legacyEntry = readFileSync(
    join(worktreeDir, "agent", "extensions", "pi-subagents", "dist", "index.js"),
    "utf8",
  );
  if (
    !legacyEntry.includes("journal-terminal-lifecycle") ||
    legacyEntry.includes("completion-delivery-ownership")
  ) {
    throw new Error("Legacy worktree build failed: emitted extension is not the pre-09 family.");
  }
  return worktreeDir;
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

const insertProjectionFixtures = (parentAgentDir: string, threadId: string, title: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
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
        ${threadId}, 'proj_default', ${title},
        '{"provider":"pi","model":"pi"}',
        'full-access', 'default', 'local',
        '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
      )
    `;
  });

const readParentTranscriptTexts = async (session: any): Promise<string[]> => {
  const texts: string[] = [];
  try {
    const entries: any[] = (await session.sessionManager.getEntries?.()) ?? [];
    for (const entry of entries) {
      if (entry?.type === "message" && entry.message) {
        const content = entry.message.content;
        if (typeof content === "string") {
          texts.push(content);
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (typeof part?.text === "string") {
              texts.push(part.text);
            }
          }
        }
      } else if (entry?.type === "custom_message") {
        if (typeof entry.content === "string") {
          texts.push(entry.content);
        } else if (Array.isArray(entry.content)) {
          for (const part of entry.content) {
            if (typeof part?.text === "string") {
              texts.push(part.text);
            }
          }
        }
      }
    }
  } catch {
    // Transcript shape varies; absence is asserted by callers.
  }
  return texts;
};

describe("Pi Subagent Completion-Delivery Ownership Real-Pi Acceptance (Issue 09)", () => {
  it("T09-AC5 (managed): ownership ack suppresses the extension nudge; the Synara coordinator delivers exactly one follow-up and settles acknowledged", async () => {
    // Real Git provenance first: no synthetic Agent replacement may satisfy this.
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.14.0-alfie.1");

    const modelServer = await startDeterministicModelServer();

    const parentAgentDir = `/tmp/synara-t09-managed-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t09-managed-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl, resolveAlfieRepoDir());
    writeAgentDir(childAgentDir, modelServer.baseUrl, resolveAlfieRepoDir());

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
      piSubagentCompletionBatchWindowMs: 200,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t09_managed_1");

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
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* insertProjectionFixtures(parentAgentDir, "th_t09_managed_1", "T09 Managed");

      yield* adapter.startSession({
        threadId: "th_t09_managed_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const negotiated = (observedSession as any)[Symbol.for("synara.pi.subagents.probe_cache")];
      expect(negotiated?.isManaged).toBe(true);
      // The ownership capability must be negotiated on this boundary.
      expect(negotiated?.capabilities).toContain("completion-delivery-ownership");

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
          "call_t09_managed",
          {
            commandId: "cmd_t09_managed",
            subagent_type: "researcher",
            task: "Background task completing under Synara-owned delivery",
            context: "Completion ownership context.",
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
      // The durable record carries the minted attempt/generation identities
      // the outbox entry is deterministically keyed by.
      const admissionRecord = yield* repo.getById(executionId);
      expect(Option.isSome(admissionRecord)).toBe(true);
      const outboxId = Option.isSome(admissionRecord)
        ? `outbox_${executionId}_${admissionRecord.value.attemptId}_gen${admissionRecord.value.generation}`
        : "";

      // Bounded wait for the full ownership-delivery-acknowledgement chain:
      // terminal persists (ownership ack resolves → nudge suppressed) →
      // coordinator batches (200ms window) → safe boundary → ONE follow-up
      // turn runs on the parent (echo model) → parent turn settles → the
      // entry acknowledges.
      const deadline = Date.now() + 45_000;
      let finalState: string | undefined;
      while (Date.now() < deadline) {
        const entry = yield* repo.getCompletionOutboxEntry(outboxId);
        if (Option.isSome(entry)) {
          finalState = entry.value.deliveryState;
          if (entry.value.deliveryState === "acknowledged") {
            break;
          }
        }
        yield* Effect.sleep(250);
      }
      expect(finalState).toBe("acknowledged");

      // The parent transcript carries the Synara follow-up signature — and
      // NOT the legacy extension nudge signature (suppressed after the
      // ownership acknowledgement). Exactly one completion follow-up.
      const entries = yield* Effect.promise(() => readParentTranscriptTexts(observedSession));
      const synaraFollowUps = entries.filter((text) =>
        text.includes("A background subagent finished:"),
      );
      const legacyNudges = entries.filter(
        (text) =>
          text.includes("<task-notification>") ||
          text.includes("Background agent group completed:"),
      );
      expect(synaraFollowUps.length).toBe(1);
      expect(legacyNudges.length).toBe(0);
      expect(synaraFollowUps[0]).toContain(executionId);

      yield* adapter.stopSession("th_t09_managed_1" as ThreadId);
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

  it("T09-AC5 (legacy): a pre-09 extension keeps the legacy nudge active; Synara dispositions legacy-owned and injects NO follow-up of its own", async () => {
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);

    const modelServer = await startDeterministicModelServer();

    // The REAL pre-09 extension family at the legacy pinned commit, loaded
    // from a detached git worktree (the live repo is at the new pin).
    const legacyWorktreeDir = materializeLegacyExtensionWorktree();

    const parentAgentDir = `/tmp/synara-t09-legacy-${Date.now()}-parent`;
    const childAgentDir = `/tmp/synara-t09-legacy-${Date.now()}-child`;
    createdDirs.push(parentAgentDir, childAgentDir);
    writeAgentDir(parentAgentDir, modelServer.baseUrl, legacyWorktreeDir);
    writeAgentDir(childAgentDir, modelServer.baseUrl, legacyWorktreeDir);

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
      piSubagentCompletionBatchWindowMs: 200,
    });
    const { authorityService, binding } = makeAuthorityFixture("th_t09_legacy_1");

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
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* insertProjectionFixtures(parentAgentDir, "th_t09_legacy_1", "T09 Legacy");

      yield* adapter.startSession({
        threadId: "th_t09_legacy_1" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: binding,
      });

      const negotiated = (observedSession as any)[Symbol.for("synara.pi.subagents.probe_cache")];
      expect(negotiated?.isManaged).toBe(true);
      // Mixed-version boundary: the legacy extension negotiates managed
      // execution and terminal reporting but NOT completion-delivery-ownership.
      expect(negotiated?.capabilities).toContain("journal-terminal-lifecycle");
      expect(negotiated?.capabilities).not.toContain("completion-delivery-ownership");

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

      const bgResult = yield* Effect.promise(() =>
        executeFn(
          "call_t09_legacy",
          {
            commandId: "cmd_t09_legacy",
            subagent_type: "researcher",
            task: "Background task completing through the legacy nudge",
            context: "Legacy ownership context.",
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
      const admissionRecord = yield* repo.getById(executionId);
      expect(Option.isSome(admissionRecord)).toBe(true);
      const outboxId = Option.isSome(admissionRecord)
        ? `outbox_${executionId}_${admissionRecord.value.attemptId}_gen${admissionRecord.value.generation}`
        : "";

      // Bounded wait: the legacy disposition settles the entry directly
      // (delivered+acknowledged at terminal-persist; no Synara follow-up).
      const deadline = Date.now() + 45_000;
      let finalState: string | undefined;
      let sawLegacyNotification = false;
      while (Date.now() < deadline) {
        const entry = yield* repo.getCompletionOutboxEntry(outboxId);
        if (Option.isSome(entry)) {
          finalState = entry.value.deliveryState;
          if (entry.value.deliveryState === "acknowledged") {
            break;
          }
        }
        // The legacy extension's own nudge is the delivery mechanism: it
        // arrives as a followUp turn on the parent transcript.
        const texts = yield* Effect.promise(() => readParentTranscriptTexts(observedSession));
        if (
          texts.some(
            (text) =>
              text.includes("<task-notification>") ||
              text.includes("Background agent group completed:"),
          )
        ) {
          sawLegacyNotification = true;
        }
        yield* Effect.sleep(250);
      }
      expect(finalState).toBe("acknowledged");

      // The legacy nudge fires after the 200ms hold and runs a followUp turn
      // on the parent — it can land AFTER the entry's legacy disposition
      // settled. Bounded wait for the legacy notification to appear.
      const nudgeDeadline = Date.now() + 20_000;
      while (Date.now() < nudgeDeadline && !sawLegacyNotification) {
        const texts = yield* Effect.promise(() => readParentTranscriptTexts(observedSession));
        if (
          texts.some(
            (text) =>
              text.includes("<task-notification>") ||
              text.includes("Background agent group completed:"),
          )
        ) {
          sawLegacyNotification = true;
        }
        yield* Effect.sleep(250);
      }
      expect(sawLegacyNotification).toBe(true);

      // Synara injected NO follow-up of its own (no double notification).
      const entries = yield* Effect.promise(() => readParentTranscriptTexts(observedSession));
      const synaraFollowUps = entries.filter((text) =>
        text.includes("A background subagent finished:"),
      );
      expect(synaraFollowUps.length).toBe(0);

      yield* adapter.stopSession("th_t09_legacy_1" as ThreadId);
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
