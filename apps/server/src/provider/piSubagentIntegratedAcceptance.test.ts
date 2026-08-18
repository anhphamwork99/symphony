/**
 * Ticket 24 / WP-A — Integrated remediation acceptance (T24-AC1..AC6).
 *
 * ONE hermetic file chains the full production path in sequenced `it()`
 * blocks against a single shared fixture state:
 *
 *   (1) three-history migration startup (fresh FILE / Symphony lineage /
 *       upstream-v0.7.2) → convergence → repository round-trip   [T24-AC1]
 *   (2) real pinned extension handshake matrix (compatible / stripped-
 *       capability partial / failing bridge / legacy no-bridge)    [T24-AC2]
 *   (3) managed spawn on the live chain: authority binding → atomic
 *       admission → child only after admission → replay idempotency →
 *       distinct concurrent identities → unauthorized denial        [T24-AC3]
 *   (4) injected recordAdmission failure → no child start → degraded
 *       health → repeated fail-closed → existing truth preserved →
 *       fresh-command recovery                                       [T24-AC4]
 *   (5) slow child bounded detach (budget + 500 ms envelope, standalone
 *       per-file method) → stable identity → parent_turn scope →
 *       real-chain DB reopen on the same file                        [T24-AC5]
 *   (6) real progress + heartbeat + durable lease; deterministic
 *       saturation flood with lifecycle reserve and exact dropped
 *       accounting; rate-capped tool.progress evidence; cleanup       [T24-AC6]
 *
 * SEQUENCING DEPENDENCY (deliberate): vitest executes `it()` blocks in
 * declaration order within a file. Later stages rely on state built by
 * earlier stages — the fresh-history FILE database created in stage (1) is
 * the live chain database for every later stage, and stage (5) reopens the
 * truth written by its own detach. Each stage boots its OWN adapter layer
 * over the SAME database file (exactly what a production restart does), so
 * the "live chain" is the durable file, not a single in-memory adapter.
 *
 * All helpers are LOCAL to this file (provenance, model server, agent dirs,
 * stripped-capability copy, authority fixture, observing repo layer) — no
 * imports from other *.test.ts files, which double-register their suites.
 *
 * Wall-clock note (Decision 0008): the stage-(5) `budget + 500 ms` detach
 * envelope is only valid in a standalone per-file invocation; this file is
 * registered in the `wallclock` vitest project and verified standalone.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NodeFileSystem } from "@effect/platform-node";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { DateTime, Effect, Layer, Option, Stream } from "effect";
import { afterAll, describe, expect, it } from "vitest";

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
import { runMigrations, migrationEntries } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import Migration0090 from "../persistence/Migrations/090_ProjectionThreadMessageTextSegments.ts";
import Migration0091 from "../persistence/Migrations/091_AutomationFailureTolerance.ts";
import Migration0092 from "../persistence/Migrations/092_BackfillAutomationRunThreadSource.ts";
import Migration0093 from "../persistence/Migrations/093_BackfillMaxIterationsDisabledReason.ts";
import Migration0094 from "../persistence/Migrations/094_ProjectionThreadsGoal.ts";
import Migration0095 from "../persistence/Migrations/095_ProjectionThreadsGoalTiming.ts";
import Migration0096 from "../persistence/Migrations/096_ProjectionThreadsGoalAchievements.ts";
import Migration0097 from "../persistence/Migrations/097_ProjectMcpActivation.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import {
  makePiSubagentExecutionRepository,
  PiSubagentExecutionRepositoryLive,
} from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Local provenance helpers (copied pattern; no cross-test imports) ─────────

interface LocalProvenanceManifest {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly hashes: Record<string, string>;
}

function loadLocalProvenanceManifest(): LocalProvenanceManifest {
  const manifestPath = join(__dirname, "./test-fixtures/piSubagentExtensionProvenance.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function computeLocalSha256(filePath: string): string {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function normalizeLocalGitUrl(url: string): string {
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

function resolveVersionedExtensionDir(): string {
  const repoDir = resolveAlfieRepoDir();
  const extDir = join(repoDir, "agent/extensions/pi-subagents");
  if (!existsSync(extDir) || !existsSync(join(extDir, "package.json"))) {
    throw new Error(`Provenance assertion failed: extension directory not found at '${extDir}'.`);
  }
  return extDir;
}

function verifyExtensionGitProvenance(): {
  isVerified: boolean;
  packageVersion: string;
} {
  const manifest = loadLocalProvenanceManifest();
  const dir = resolveAlfieRepoDir();
  const runGit = (args: string) =>
    execSync(args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const originUrl = runGit("git config --get remote.origin.url");
  if (normalizeLocalGitUrl(originUrl) !== normalizeLocalGitUrl(manifest.expectedRepositoryUrl)) {
    throw new Error("Provenance assertion failed: repository origin mismatch.");
  }
  const headCommit = runGit("git rev-parse HEAD");
  if (headCommit !== manifest.pinnedCommit) {
    throw new Error(
      `Provenance assertion failed: HEAD commit '${headCommit}' does not match pinned commit '${manifest.pinnedCommit}'.`,
    );
  }
  const gitStatus = runGit("git status --porcelain agent/extensions/pi-subagents")
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
    if (computeLocalSha256(join(dir, relPath)) !== expectedHash) {
      throw new Error(`Provenance assertion failed: SHA-256 mismatch for '${relPath}'.`);
    }
  }
  return { isVerified: true, packageVersion: pkg.version };
}

// ─── Deterministic loopback model fixture (local copy) ────────────────────────
//
// Only the model endpoint is a fixture (owner-approved seam): the adapter,
// extension bridge, AgentManager, runAgent, createAgentSession and the
// streaming client are all real. `requests` records every completion call so
// stage (4) can prove ZERO child requests were made for a rejected spawn.

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_FAST_MODEL_ID = "echo";
const DETERMINISTIC_SLOW_MODEL_ID = "echo-slow";
const DETERMINISTIC_SLOW_DELAY_MS = 4000;

function startDeterministicModelServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}> {
  const requests: string[] = [];
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
      requests.push(`${req.method} ${req.url} model=${requestedModel}`);
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
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

// ─── Agent-dir fixtures (local copies) ────────────────────────────────────────

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

function writeAgentDirWithModels(tempAgentDir: string, baseUrl: string): void {
  createRealExtensionDirectory(tempAgentDir);
  writeFileSync(
    join(tempAgentDir, "auth.json"),
    JSON.stringify({
      [DETERMINISTIC_MODEL_PROVIDER_ID]: { type: "api_key", key: "synara-local-test-key" },
    }),
  );
  writeFileSync(
    join(tempAgentDir, "models.json"),
    JSON.stringify({
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
    }),
  );
}

/**
 * Stripped-capability copy of the ACTUAL pinned extension: exactly the
 * `bounded-foreground-attachment` and `coalesced-progress` entries are
 * removed from the `PI_SUBAGENT_CAPABILITIES` literal in `src/index.ts`
 * (the current pinned literal includes coalesced-progress). Everything else
 * is byte-identical to the pinned tree, so the mixed-version (older
 * extension) handshake yields `capability_mismatch` and the Agent tool must
 * stay legacy/unwrapped.
 */
function createStrippedCapabilityExtensionCopy(targetDir: string): void {
  const versionedDir = resolveVersionedExtensionDir();
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(versionedDir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "test" ||
      entry === ".gitignore"
    ) {
      continue;
    }
    const from = join(versionedDir, entry);
    const to = join(targetDir, entry);
    if (lstatSync(from).isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to, "dir");
    } else if (lstatSync(from).isDirectory()) {
      cpSync(from, to, { recursive: true });
    } else {
      copyFileSync(from, to);
    }
  }
  symlinkSync(join(versionedDir, "node_modules"), join(targetDir, "node_modules"), "dir");

  const indexTsPath = join(targetDir, "src", "index.ts");
  const indexSource = readFileSync(indexTsPath, "utf8");
  const capabilityNeedle = `  const PI_SUBAGENT_CAPABILITIES = [
    "managed-spawn",
    "abort-propagation",
    "bounded-foreground-attachment",
    "coalesced-progress",
    "durable-cancellation",
    "journal-terminal-lifecycle",
  ] as const;`;
  const strippedReplacement = `  const PI_SUBAGENT_CAPABILITIES = [
    "managed-spawn",
    "abort-propagation",
  ] as const;`;
  if (!indexSource.includes(capabilityNeedle)) {
    throw new Error(
      "Stripped-capability fixture failed: could not find the exact PI_SUBAGENT_CAPABILITIES literal in the pinned extension source.",
    );
  }
  writeFileSync(indexTsPath, indexSource.replace(capabilityNeedle, strippedReplacement));
}

function createStrippedAgentDir(tempAgentDir: string, baseUrl: string): void {
  createStrippedCapabilityExtensionCopy(join(tempAgentDir, "extensions", "pi-subagents"));
  const versionedDir = resolveVersionedExtensionDir();
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, join(tempAgentDir, "extensions", "shared"), "dir");
  }
  const systemDir = join(versionedDir, "..", "..", "system");
  if (existsSync(systemDir)) {
    symlinkSync(systemDir, join(tempAgentDir, "system"), "dir");
  }
  writeFileSync(
    join(tempAgentDir, "auth.json"),
    JSON.stringify({
      [DETERMINISTIC_MODEL_PROVIDER_ID]: { type: "api_key", key: "synara-local-test-key" },
    }),
  );
  writeFileSync(
    join(tempAgentDir, "models.json"),
    JSON.stringify({
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
          ],
        },
      },
    }),
  );
}

// ─── Server config + authority fixture (local copies) ─────────────────────────

function makeServerConfig(
  tempDir: string,
  dbPath: string,
  overrides?: Partial<ServerConfigShape>,
): ServerConfigShape {
  return {
    mode: "web",
    port: 3790,
    host: "127.0.0.1",
    cwd: tempDir,
    homeDir: tempDir,
    chatWorkspaceRoot: tempDir,
    studioWorkspaceRoot: tempDir,
    baseDir: tempDir,
    stateDir: tempDir,
    secretsDir: tempDir,
    dbPath,
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

function makeAuthorityService() {
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
  const mintBinding = (subject: string, threadId: string) => {
    const record = registry.mint({
      subject,
      kind: "authenticated",
      authSessionId: `auth-session-${subject}`,
      authExpiresAt: null,
    });
    return {
      authorityId: record.authorityId,
      binding: registry.bindingFor(record.authorityId, {
        threadId: threadId as ThreadId,
        provider: "pi",
        projectId: "proj_default",
        lifecycleGeneration: null,
        credentialTtlMs: 60 * 60 * 1_000,
      })!,
    };
  };
  return { registry, authorityService, mintBinding };
}

const seedProjections = (threadIds: readonly string[], tempDir: string, dbWorkspaceRoot?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO projection_projects (
        project_id, kind, title, workspace_root, default_model_selection_json,
        scripts_json, created_at, updated_at
      ) VALUES (
        'proj_default', 'project', 'Default', ${dbWorkspaceRoot ?? tempDir}, '{"provider":"pi","model":"pi"}',
        '[]', '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'
      )
    `;
    for (const threadId of threadIds) {
      yield* sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          ${threadId}, 'proj_default', ${`Integrated ${threadId}`},
          '{"provider":"pi","model":"pi"}',
          'full-access', 'default', 'local',
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL
        )
      `;
    }
  });

const executeCtxFor = (session: any, cwd: string, model: any, registry: any) => ({
  ui: {
    notify: () => {},
    status: () => {},
    setStatus: () => {},
    setWidget: () => {},
    select: async () => undefined,
    confirm: async () => true,
    input: async () => undefined,
  },
  cwd,
  model,
  modelRegistry: registry,
  sessionManager: session.sessionManager,
  getSystemPrompt: () => "",
});

const agentExecuteFor = (session: any) => {
  const loadedExt = session.resourceLoader
    .getExtensions()
    .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
  expect(loadedExt).toBeDefined();
  const agentEntry = loadedExt.tools.get("Agent");
  return {
    execute: agentEntry.execute ?? agentEntry.definition?.execute,
    entry: agentEntry,
    bridge: loadedExt.handlers.get("synara:subagents:bridge")[0](),
  };
};

// ─── Shared fixture state (sequenced stages rely on this) ─────────────────────

interface IntegratedFixture {
  rootDir: string;
  dbPath: string;
  modelServer: Awaited<ReturnType<typeof startDeterministicModelServer>>;
  parentAgentDir: string;
  childAgentDir: string;
  strippedAgentDir: string;
  legacyAgentDir: string;
  /** Extension-free agent dir: only the flood companion factory's Agent tool. */
  floodAgentDir: string;
  /** Stage-(3) execution identity preserved for the stage-(4) truth check. */
  stage3ExecutionId?: string;
  stage3JournalLength?: number;
}

let fixture: IntegratedFixture | undefined;

const createdDirs: string[] = [];

// NOTE: the shared fixture directory (database file + agent dirs) is created
// in stage (1) and consumed by every later sequenced `it()`, so cleanup MUST
// happen in afterAll — an afterEach removal would delete the live chain
// database between stages. Per-stage throwaway dirs would use createdDirs.
afterAll(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

// ─── The integrated chain ─────────────────────────────────────────────────────

describe("Pi Subagent Integrated Remediation Acceptance (Ticket 24)", () => {
  // -------------------------------------------------------------------------
  // STAGE 1 — T24-AC1: three-history startup convergence + repository readiness
  // -------------------------------------------------------------------------
  it("T24-AC1: fresh, Symphony-lineage, and upstream-v0.7.2 histories converge and the repository round-trips on each; the fresh FILE history becomes the live chain database", async () => {
    // Real Git provenance first: no synthetic Agent replacement may satisfy
    // any leg of this file.
    const provenance = verifyExtensionGitProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageVersion).toBe("0.13.0-alfie.1");

    const rootDir = mkdtempSync(join(tmpdir(), "synara-t24-integrated-"));
    createdDirs.push(rootDir);
    const dbPath = join(rootDir, "state.sqlite");

    const modelServer = await startDeterministicModelServer();
    const parentAgentDir = join(rootDir, "parent-agent");
    const childAgentDir = join(rootDir, "child-agent");
    const strippedAgentDir = join(rootDir, "stripped-agent");
    const legacyAgentDir = join(rootDir, "legacy-agent");
    const floodAgentDir = join(rootDir, "flood-agent");
    writeAgentDirWithModels(parentAgentDir, modelServer.baseUrl);
    writeAgentDirWithModels(childAgentDir, modelServer.baseUrl);
    createStrippedAgentDir(strippedAgentDir, modelServer.baseUrl);
    mkdirSync(legacyAgentDir, { recursive: true }); // no extension at all
    mkdirSync(floodAgentDir, { recursive: true }); // no on-disk extension

    fixture = {
      rootDir,
      dbPath,
      modelServer,
      parentAgentDir,
      childAgentDir,
      strippedAgentDir,
      legacyAgentDir,
      floodAgentDir,
    };

    const trackerRows = (sql: SqlClient.SqlClient) =>
      sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id ASC
      `;

    const schemaHas = (sql: SqlClient.SqlClient) =>
      Effect.gen(function* () {
        const tables = (yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table'
        `).map((r) => r.name);
        expect(tables).toContain("message_text_segments");
        expect(tables).toContain("pi_subagent_executions");
        expect(tables).toContain("pi_subagent_lifecycle_journal");
        const piCols = (yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('pi_subagent_executions')
        `).map((r) => r.name);
        for (const col of [
          "last_heartbeat_at",
          "lease_expires_at",
          "last_progress_json",
          "last_progress_at",
          "dropped_progress_count",
          "command_fingerprint",
        ]) {
          expect(piCols).toContain(col);
        }
      });

    // Repository round-trip proof shared by all three histories: admission →
    // lifecycle seq2 → progress → heartbeat → observation read-back with
    // exact lease math. Uses history-local execution ids (prefixed) so the
    // live-chain truth of later stages is never polluted.
    const repositoryRoundTrip = (prefix: string, leaseDurationMs: number) =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const sql = yield* SqlClient.SqlClient;
        yield* seedProjections([`${prefix}_thread`], `/tmp/${prefix}`);
        const executionId = `${prefix}_exec_1`;
        const admission = yield* repo.recordAdmission({
          executionId,
          attemptId: `${prefix}_att_1`,
          generation: 1,
          commandId: `${prefix}_cmd_1`,
          commandFingerprint: `${prefix}_fingerprint`,
          clientCommandId: `${prefix}_client_cmd`,
          subject: `user_${prefix}`,
          projectId: "proj_default",
          parentThreadId: `${prefix}_thread` as ThreadId,
          parentTurnId: `${prefix}_turn`,
          parentToolCallId: `${prefix}_call`,
          agentType: "researcher",
          prompt: "startup round-trip",
          mode: "foreground",
          cancellationScope: "parent_turn",
          state: "accepted",
          diagnosticCode: "pi_subagent_managed_enabled",
          now: "2026-08-18T00:00:00.000Z",
        });
        expect(admission.kind).toBe("admitted");
        yield* repo.recordLifecycleEvent({
          eventId: `${prefix}_evt_2`,
          executionId,
          attemptId: `${prefix}_att_1`,
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: "2026-08-18T00:00:00.100Z",
          metadataJson: JSON.stringify({
            phase: "started",
            occurredAt: "2026-08-18T00:00:00.100Z",
            attachmentMode: "foreground",
            foregroundWaitMs: 300,
          }),
        });
        yield* repo.recordProgressObservation({
          executionId,
          progressJson: JSON.stringify({ toolUses: 1, status: "running" }),
          occurredAt: "2026-08-18T00:00:01.000Z",
          droppedCountDelta: 2,
        });
        yield* repo.recordHeartbeatObservation({
          executionId,
          occurredAt: "2026-08-18T00:00:02.000Z",
          leaseExpiresAt: new Date(
            Date.parse("2026-08-18T00:00:02.000Z") + leaseDurationMs,
          ).toISOString(),
        });
        const observationOption = yield* repo.getObservation(executionId);
        expect(Option.isSome(observationOption)).toBe(true);
        if (Option.isSome(observationOption)) {
          const observation = observationOption.value;
          expect(JSON.parse(observation.lastProgressJson!)).toMatchObject({
            toolUses: 1,
            status: "running",
          });
          expect(observation.droppedProgressCount).toBe(2);
          expect(observation.lastHeartbeatAt).toBe("2026-08-18T00:00:02.000Z");
        }
        const journal = yield* repo.listJournalEvents(executionId);
        expect(journal.map((e) => e.sequence)).toEqual([1, 2]);
        yield* sql`DELETE FROM pi_subagent_lifecycle_journal WHERE execution_id = ${executionId}`;
        yield* sql`DELETE FROM pi_subagent_executions WHERE execution_id = ${executionId}`;
      });

    // --- FRESH history (file-backed — becomes the live chain database) ---
    // The persistence layer's own setup runs the migration chain at boot (the
    // production startup path); convergence is asserted from the tracker +
    // schema + repository round-trip rather than from the executed list.
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* schemaHas(sql);
        const tracker = yield* trackerRows(sql);
        expect(tracker.map((r) => [r.migration_id, r.name])).toEqual(
          migrationEntries.map(([id, name]) => [id, name]),
        );
        // effect_sql_migrations rows complete through 101, and a second
        // explicit run is a no-op (idempotent convergence).
        expect(tracker[tracker.length - 1]!.migration_id).toBe(101);
        const secondPass = yield* runMigrations();
        expect(secondPass.length).toBe(0);
        yield* repositoryRoundTrip("fresh", 30_000);
      }).pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(
            Layer.provideMerge(
              makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
            ),
          ),
        ),
      ),
    );

    // --- Symphony lineage (memory): migrations 1-89 + 97 recorded as 90 ---
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 89 });
        yield* Migration0097;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (90, 'ProjectMcpActivation')
        `;
        const executed = yield* runMigrations();
        expect(executed.map(([id]) => id)).toEqual([
          90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
        ]);
        yield* schemaHas(sql);
        const tracker = yield* trackerRows(sql);
        expect(tracker.map((r) => [r.migration_id, r.name])).toEqual(
          migrationEntries.map(([id, name]) => [id, name]),
        );
        const secondPass = yield* runMigrations();
        expect(secondPass.length).toBe(0);
        yield* repositoryRoundTrip("symphony", 30_000);
      }).pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(
            Layer.provideMerge(NodeSqliteClient.layerMemory()),
          ),
        ),
      ),
    );

    // --- Upstream v0.7.2 lineage (memory): 1-89 + 90-96 recorded ---
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 89 });
        yield* Migration0090;
        yield* Migration0091;
        yield* Migration0092;
        yield* Migration0093;
        yield* Migration0094;
        yield* Migration0095;
        yield* Migration0096;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES
            (90, 'ProjectionThreadMessageTextSegments'),
            (91, 'AutomationFailureTolerance'),
            (92, 'BackfillAutomationRunThreadSource'),
            (93, 'BackfillMaxIterationsDisabledReason'),
            (94, 'ProjectionThreadsGoal'),
            (95, 'ProjectionThreadsGoalTiming'),
            (96, 'ProjectionThreadsGoalAchievements')
        `;
        const executed = yield* runMigrations();
        expect(executed.map(([id]) => id)).toEqual([97, 98, 99, 100, 101]);
        yield* schemaHas(sql);
        const tracker = yield* trackerRows(sql);
        expect(tracker.map((r) => [r.migration_id, r.name])).toEqual(
          migrationEntries.map(([id, name]) => [id, name]),
        );
        const secondPass = yield* runMigrations();
        expect(secondPass.length).toBe(0);
        yield* repositoryRoundTrip("upstream", 30_000);
      }).pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(
            Layer.provideMerge(NodeSqliteClient.layerMemory()),
          ),
        ),
      ),
    );

    expect(existsSync(dbPath)).toBe(true);
  }, 90_000);

  // -------------------------------------------------------------------------
  // STAGE 2 — T24-AC2: handshake matrix against the real pinned extension
  // -------------------------------------------------------------------------
  it("T24-AC2: compatible negotiation is managed with coalesced-progress; stripped-capability copy yields capability_mismatch with a legacy Agent tool; failing bridge and legacy no-bridge paths are distinct", async () => {
    if (!fixture) throw new Error("stage 1 must run first");
    const { dbPath, parentAgentDir, strippedAgentDir, legacyAgentDir } = fixture;

    const serverConfig = makeServerConfig(parentAgentDir, dbPath);
    const { authorityService, mintBinding } = makeAuthorityService();
    const bindingCompatible = mintBinding("user_t24_hs_ok", "th_t24_hs_ok");
    const bindingStripped = mintBinding("user_t24_hs_stripped", "th_t24_hs_stripped");
    const bindingFailing = mintBinding("user_t24_hs_failing", "th_t24_hs_failing");
    const bindingLegacy = mintBinding("user_t24_hs_legacy", "th_t24_hs_legacy");

    const observedSessions = new Map<string, any>();
    const observedCapabilities = new Map<string, any>();
    const admittedEvents: Array<{
      threadId: ThreadId;
      command: PiSubagentSpawnCommand;
      result: PiSubagentSpawnResult;
    }> = [];

    // Failing-bridge leg: a locally-defined extension factory whose bridge
    // handshake throws (the distinct `bridge_error` diagnostic). Registered
    // through the production `extensionFactories` seam on the same adapter;
    // mirrors the production failing-bridge fixture's discovery surface
    // (bridge key on `pi`, on the factory, and the bridge event).
    const failingBridge = {
      handshake: async () => {
        throw new Error("T24 handshake explosion");
      },
    };
    const failingBridgeExtension = {
      name: "pi-subagents-failing",
      factory: (pi: any) => {
        if (pi) {
          pi[Symbol.for("synara.pi.subagents.bridge")] = failingBridge;
          if (typeof pi.on === "function") {
            pi.on("synara:subagents:bridge", () => failingBridge);
          }
        }
      },
    };
    (failingBridgeExtension.factory as any)[Symbol.for("synara.pi.subagents.bridge")] =
      failingBridge;

    // Main adapter: NO extra factories — the compatible / stripped / legacy
    // legs observe exactly what the on-disk agent dirs provide. (A factory
    // would apply to every session of the adapter, which is why the
    // failing-bridge leg runs on its own adapter below.)
    const sqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSessions.set(String(event.threadId), event.session);
        observedCapabilities.set(String(event.threadId), event.capability);
      },
      onSubagentAdmission: (event) => {
        admittedEvents.push(event);
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(sqliteLayer),
    );

    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      sqliteLayer,
    );

    // Separate adapter for the failing-bridge leg only (its factory must not
    // contaminate the legacy no-bridge leg).
    const failingSqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(
      Layer.provide(NodeServices.layer),
    );
    const failingAdapterLayer = makePiAdapterLive({
      extensionFactories: [failingBridgeExtension.factory],
      onSubagentCapability: (event) => {
        observedSessions.set(String(event.threadId), event.session);
        observedCapabilities.set(String(event.threadId), event.capability);
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(failingSqliteLayer),
    );
    const failingTestLayer = Layer.mergeAll(
      failingAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(failingSqliteLayer)),
      failingSqliteLayer,
    );

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* seedProjections(
        ["th_t24_hs_ok", "th_t24_hs_stripped", "th_t24_hs_failing", "th_t24_hs_legacy"],
        parentAgentDir,
      );

      // ── Compatible: the actual pinned extension, full capabilities ──
      yield* adapter.startSession({
        threadId: "th_t24_hs_ok" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: bindingCompatible.binding,
      });
      const compatible = observedCapabilities.get("th_t24_hs_ok");
      expect(compatible?.isManaged).toBe(true);
      expect(compatible?.status).toBe("managed_enabled");
      expect(compatible?.capabilities).toContain("managed-spawn");
      expect(compatible?.capabilities).toContain("abort-propagation");
      expect(compatible?.capabilities).toContain("bounded-foreground-attachment");
      expect(compatible?.capabilities).toContain("coalesced-progress");
      const compatibleSession = observedSessions.get("th_t24_hs_ok");
      const negotiated = (compatibleSession as any)[Symbol.for("synara.pi.subagents.probe_cache")];
      expect(negotiated?.isManaged).toBe(true);
      expect(negotiated?.capabilities).toContain("coalesced-progress");

      // ── Partial/unsupported: stripped-capability copy of the REAL tree ──
      yield* adapter.startSession({
        threadId: "th_t24_hs_stripped" as ThreadId,
        cwd: strippedAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: strippedAgentDir } },
        mcpAuthority: bindingStripped.binding,
      });
      const stripped = observedCapabilities.get("th_t24_hs_stripped");
      expect(stripped?.isManaged).toBe(false);
      expect(stripped?.status).toBe("capability_mismatch");
      // The required-capability gap is reported by the extension: the
      // stripped literal removed BOTH bounded-foreground-attachment and
      // coalesced-progress; only bounded-foreground-attachment is REQUIRED
      // by the server handshake (coalesced-progress is optional), so the
      // extension's missing list names the required one. The absence of the
      // optional capability is proven below by the negotiated-capability
      // gap (the copy cannot negotiate managed at all).
      expect(stripped?.missingCapabilities).toContain("bounded-foreground-attachment");
      const strippedSession = observedSessions.get("th_t24_hs_stripped");
      const strippedAgent = agentExecuteFor(strippedSession);
      expect(typeof strippedAgent.execute).toBe("function");
      // The Agent tool stays legacy/unwrapped: no admission wrapper, no
      // executionId stamping capability.
      expect(strippedAgent.entry.__synaraAdmissionWrapped).toBeUndefined();
      expect(strippedAgent.entry.definition?.__synaraAdmissionWrapped).toBeUndefined();

      // An Agent call on the stripped session never reaches Synara admission.
      const strippedBefore = admittedEvents.length;
      const strippedResult: any = yield* Effect.promise(() =>
        strippedAgent.execute(
          "call_t24_hs_stripped",
          {
            commandId: "cmd_t24_hs_stripped",
            subagent_type: "researcher",
            task: "Legacy path task",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: true,
          },
          undefined,
          undefined,
          executeCtxFor(strippedSession, strippedAgentDir, undefined, {
            find: () => undefined,
            getAll: () => [],
            getAvailable: () => [],
          }),
        ),
      );
      expect(strippedResult.executionId).toBeUndefined();
      expect(admittedEvents.length).toBe(strippedBefore);
      const strippedThreadRows = yield* repo.listByThreadId("th_t24_hs_stripped");
      expect(strippedThreadRows).toHaveLength(0);

      // ── Legacy (no bridge at all): unaffected path ──
      yield* adapter.startSession({
        threadId: "th_t24_hs_legacy" as ThreadId,
        cwd: legacyAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: legacyAgentDir } },
        mcpAuthority: bindingLegacy.binding,
      });
      const legacy = observedCapabilities.get("th_t24_hs_legacy");
      expect(legacy?.isManaged).toBe(false);
      expect(legacy?.status).toBe("bridge_absent");
      expect(legacy?.diagnosticCode).toBe("pi_subagent_bridge_absent");

      for (const threadId of ["th_t24_hs_ok", "th_t24_hs_stripped", "th_t24_hs_legacy"]) {
        yield* adapter.stopSession(threadId as ThreadId);
      }
    });

    // ── Failing bridge: the distinct bridge_error diagnostic (own adapter,
    // so its factory cannot contaminate the legacy no-bridge leg) ──
    const failingProgram = Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      yield* seedProjections(["th_t24_hs_failing"], legacyAgentDir);
      yield* adapter.startSession({
        threadId: "th_t24_hs_failing" as ThreadId,
        cwd: legacyAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: legacyAgentDir } },
        mcpAuthority: bindingFailing.binding,
      });
      const failing = observedCapabilities.get("th_t24_hs_failing");
      expect(failing?.isManaged).toBe(false);
      expect(failing?.status).toBe("bridge_error");
      expect(failing?.diagnosticCode).toBe("pi_subagent_bridge_error");
      expect(failing?.diagnosticMessage).toContain("T24 handshake explosion");
      yield* adapter.stopSession("th_t24_hs_failing" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
      await Effect.runPromise(failingProgram.pipe(Effect.provide(failingTestLayer)));
    } finally {
      // Layer scopes end with their programs; sessions were stopped explicitly.
    }
  }, 90_000);

  // -------------------------------------------------------------------------
  // STAGE 3 — T24-AC3: atomic admission, replay idempotency, distinct
  // concurrent identities, unauthorized denial — on the live chain DB.
  // -------------------------------------------------------------------------
  it("T24-AC3: managed Agent spawn admits atomically (seq1 accepted → seq2 started), replays the same commandId idempotently, mints distinct identities for a second spawn, and refuses an unauthorized spawn before any child starts", async () => {
    if (!fixture) throw new Error("stage 1 must run first");
    const { dbPath, parentAgentDir, childAgentDir, modelServer } = fixture;

    // Real parent tool-execution model context (fast model) + child agent dir.
    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const fastModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_FAST_MODEL_ID);
    if (!fastModel) {
      throw new Error("fast deterministic model missing from test registry");
    }
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const serverConfig = makeServerConfig(parentAgentDir, dbPath, {
      piSubagentForegroundWaitMs: 30_000,
    });
    const { authorityService, mintBinding, registry: authorityRegistry } = makeAuthorityService();
    const bound = mintBinding("user_t24_ac3", "th_t24_ac3");

    const observedSessions = new Map<string, any>();
    const admittedEvents: Array<{
      threadId: ThreadId;
      command: PiSubagentSpawnCommand;
      result: PiSubagentSpawnResult;
    }> = [];

    const sqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSessions.set(String(event.threadId), event.session);
      },
      onSubagentAdmission: (event) => {
        admittedEvents.push(event);
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(sqliteLayer),
    );
    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      sqliteLayer,
    );

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* seedProjections(["th_t24_ac3"], parentAgentDir);

      yield* adapter.startSession({
        threadId: "th_t24_ac3" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: bound.binding,
      });
      const session = observedSessions.get("th_t24_ac3");
      expect(session).toBeDefined();
      const { execute: executeFn } = agentExecuteFor(session);
      const ctx = executeCtxFor(session, parentAgentDir, fastModel, registry);

      // ── Authorized fast managed spawn: child completes inline ──
      const requestsBefore = modelServer.requests.length;
      const result: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac3_1",
          {
            commandId: "cmd_t24_ac3_1",
            subagent_type: "researcher",
            task: "Integrated fast task",
            context: "C",
            link_references: "L",
            expected_outcome: "ACK",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      expect(result.isError).toBeUndefined();
      expect(result.executionId).toMatch(/^exec_/);
      expect(result.attemptId).toMatch(/^att_/);
      expect(result.generation).toBe(1);
      expect(result.content?.[0]?.text).toContain("ACK");
      // A real child consumed the deterministic FAST model.
      expect(modelServer.requests.length).toBeGreaterThan(requestsBefore);

      const executionId = result.executionId as string;
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[0]!.state).toBe("accepted");
      expect(journal[1]!.sequence).toBe(2);
      expect(journal[1]!.state).toBe("running");
      expect(journal[1]!.metadata).toMatchObject({
        phase: "started",
        attachmentMode: "foreground",
        foregroundWaitMs: 30_000,
      });
      const journalLengthAfterFirst = journal.length;
      fixture!.stage3ExecutionId = executionId;
      fixture!.stage3JournalLength = journalLengthAfterFirst;

      // ── Replay: the SAME params.commandId on the same session ──
      const replayResult: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac3_1",
          {
            commandId: "cmd_t24_ac3_1",
            subagent_type: "researcher",
            task: "Integrated fast task",
            context: "C",
            link_references: "L",
            expected_outcome: "ACK",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      expect(replayResult.executionId).toBe(executionId);
      expect(replayResult.attemptId).toBe(result.attemptId);
      expect(replayResult.generation).toBe(1);
      expect(String(replayResult.content?.[0]?.text ?? "")).toContain("already applied");
      // No new journal rows beyond the first run's truth.
      const journalAfterReplay = yield* repo.listJournalEvents(executionId);
      expect(journalAfterReplay.length).toBe(journalLengthAfterFirst);
      const rowsForThread = yield* repo.listByThreadId("th_t24_ac3");
      expect(rowsForThread.filter((r) => r.executionId === executionId)).toHaveLength(1);

      // ── Second concurrent managed spawn: distinct identities ──
      const secondResult: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac3_2",
          {
            commandId: "cmd_t24_ac3_2",
            subagent_type: "researcher",
            task: "Integrated second task",
            context: "C",
            link_references: "L",
            expected_outcome: "ACK",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      expect(secondResult.executionId).toMatch(/^exec_/);
      expect(secondResult.executionId).not.toBe(executionId);
      expect(secondResult.attemptId).not.toBe(result.attemptId);
      const secondJournal = yield* repo.listJournalEvents(secondResult.executionId);
      expect(secondJournal[0]!.sequence).toBe(1);
      expect(secondJournal[0]!.state).toBe("accepted");

      // ── Unauthorized: revoke the authority, then spawn ──
      authorityRegistry.revoke(bound.authorityId, "t24 integrated revocation");
      const requestsBeforeDenied = modelServer.requests.length;
      const deniedResult: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac3_denied",
          {
            commandId: "cmd_t24_ac3_denied",
            subagent_type: "researcher",
            task: "Unauthorized task",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      expect(deniedResult.isError).toBe(true);
      expect(deniedResult.content?.[0]?.text).toContain("pi_subagent_admission_unauthorized");
      // No child started for the denied spawn: zero model requests.
      expect(modelServer.requests.length).toBe(requestsBeforeDenied);
      // Rejected truth is durable (sequence 1, rejected) under the same thread.
      const threadRowsAfterDenial = yield* repo.listByThreadId("th_t24_ac3");
      const rejectedRow = threadRowsAfterDenial.find((r) => r.observedState === "rejected");
      expect(rejectedRow).toBeDefined();
      expect(rejectedRow!.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
      const rejectedJournal = yield* repo.listJournalEvents(rejectedRow!.executionId);
      expect(rejectedJournal.map((e) => [e.sequence, e.state])).toEqual([[1, "rejected"]]);

      // Stage-(3) fast-child inline completion evidence for T24-AC5 lives
      // here (child completed inline well inside the 30 s budget); stage (5)
      // references this and adds the bounded-detach leg.
      yield* adapter.stopSession("th_t24_ac3" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  }, 90_000);

  // -------------------------------------------------------------------------
  // STAGE 4 — T24-AC4: fail-closed degradation and admission-driven recovery
  // -------------------------------------------------------------------------
  it("T24-AC4: injected recordAdmission failure starts no child, degrades control health, keeps failing closed while degraded, preserves stage-3 truth, and recovers via a fresh authorized command", async () => {
    if (!fixture) throw new Error("stage 1 must run first");
    const { dbPath, parentAgentDir, childAgentDir, modelServer } = fixture;
    const stage3ExecutionId = fixture.stage3ExecutionId;
    if (!stage3ExecutionId) throw new Error("stage 3 must run first");

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const fastModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_FAST_MODEL_ID);
    if (!fastModel) throw new Error("fast deterministic model missing from test registry");
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const serverConfig = makeServerConfig(parentAgentDir, dbPath, {
      piSubagentForegroundWaitMs: 30_000,
    });
    const { authorityService, mintBinding } = makeAuthorityService();
    const bound = mintBinding("user_t24_ac4", "th_t24_ac4");

    // Injectable persistence failure at the production admission boundary
    // (approved seam — same pattern as the ticket-21 real-extension suite).
    let failAdmissionWrites = true;
    const controlHealth = await Effect.runPromise(makePiSubagentControlHealth());

    const sqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const flakyRepoLayer = Layer.effect(
      PiSubagentExecutionRepository,
      Effect.gen(function* () {
        const baseRepo = yield* makePiSubagentExecutionRepository;
        const wrapped: PiSubagentExecutionRepositoryShape = {
          ...baseRepo,
          recordAdmission: (input) => {
            if (failAdmissionWrites) {
              return Effect.fail({
                _tag: "PersistenceSqlError",
                cause: new Error("T24-INJECTED-ADMISSION-OUTAGE"),
                operation: "recordAdmission",
              } as any);
            }
            return baseRepo.recordAdmission(input);
          },
        };
        return wrapped;
      }),
    ).pipe(Layer.provide(sqliteLayer));

    const observedSessions = new Map<string, any>();
    const piAdapterLayer = makePiAdapterLive({
      controlHealth,
      onSubagentCapability: (event) => {
        observedSessions.set(String(event.threadId), event.session);
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(flakyRepoLayer),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(sqliteLayer),
    );
    const testLayer = Layer.mergeAll(piAdapterLayer, flakyRepoLayer, sqliteLayer);

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* seedProjections(["th_t24_ac4"], parentAgentDir);

      yield* adapter.startSession({
        threadId: "th_t24_ac4" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: bound.binding,
      });
      const session = observedSessions.get("th_t24_ac4");
      expect(session).toBeDefined();
      const { execute: executeFn } = agentExecuteFor(session);
      const ctx = executeCtxFor(session, parentAgentDir, fastModel, registry);

      // ── First attempt with failing persistence: NO child starts ──
      const requestsBefore = modelServer.requests.length;
      const degraded: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac4_1",
          {
            commandId: "cmd_t24_ac4_1",
            subagent_type: "researcher",
            task: "Outage task",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      expect(degraded.isError).toBe(true);
      expect(degraded.content?.[0]?.text).toContain("pi_subagent_lifecycle_persistence_failed");
      // Zero child requests for the rejected execution.
      expect(modelServer.requests.length).toBe(requestsBefore);
      // No durable truth was projected for the failed command.
      const threadRows = yield* repo.listByThreadId("th_t24_ac4");
      expect(threadRows).toHaveLength(0);
      // Control health degraded.
      const healthDegraded = yield* controlHealth.getHealth();
      expect(healthDegraded.status).toBe("degraded");
      expect(healthDegraded.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

      // ── Second attempt WHILE DEGRADED: also fails closed ──
      const degradedAgain: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac4_2",
          {
            commandId: "cmd_t24_ac4_2",
            subagent_type: "researcher",
            task: "Still degraded task",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      expect(degradedAgain.isError).toBe(true);
      expect(degradedAgain.content?.[0]?.text).toContain(
        "pi_subagent_lifecycle_persistence_failed",
      );
      expect(modelServer.requests.length).toBe(requestsBefore);
      expect(yield* repo.listByThreadId("th_t24_ac4")).toHaveLength(0);

      // ── Existing stage-(3) truth unchanged ──
      const stage3Journal = yield* repo.listJournalEvents(stage3ExecutionId);
      expect(stage3Journal.length).toBe(fixture!.stage3JournalLength);
      expect(stage3Journal[0]!.sequence).toBe(1);
      expect(stage3Journal[0]!.state).toBe("accepted");
      expect(stage3Journal[1]!.sequence).toBe(2);
      const stage3Aggregate = yield* repo.getById(stage3ExecutionId);
      expect(Option.isSome(stage3Aggregate)).toBe(true);

      // ── Recovery: clear the fail flag, issue a FRESH commandId ──
      failAdmissionWrites = false;
      const recovered: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac4_recovery",
          {
            commandId: "cmd_t24_ac4_recovery",
            subagent_type: "researcher",
            task: "Recovery task",
            context: "C",
            link_references: "L",
            expected_outcome: "ACK",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      // Single-flight recovery: the normal recordAdmission of this fresh
      // command marks health available and admits it (ticket-21 semantics).
      expect(recovered.isError).toBeUndefined();
      expect(recovered.executionId).toMatch(/^exec_/);
      expect(modelServer.requests.length).toBeGreaterThan(requestsBefore);
      const healthRecovered = yield* controlHealth.getHealth();
      expect(healthRecovered.status).toBe("available");
      const recoveredJournal = yield* repo.listJournalEvents(recovered.executionId);
      expect(recoveredJournal[0]!.sequence).toBe(1);
      expect(recoveredJournal[0]!.state).toBe("accepted");
      expect(recoveredJournal[1]!.sequence).toBe(2);

      yield* adapter.stopSession("th_t24_ac4" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  }, 90_000);

  // -------------------------------------------------------------------------
  // STAGE 5 — T24-AC5: bounded detach (budget + 500 ms) + real-chain reopen
  // -------------------------------------------------------------------------
  it("T24-AC5: slow child detaches within budget + 500 ms with stable identity and parent_turn scope, and the same database file reopens with identical aggregate, ordered journal, and observation", async () => {
    if (!fixture) throw new Error("stage 1 must run first");
    const { dbPath, parentAgentDir, childAgentDir } = fixture;

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const slowModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_SLOW_MODEL_ID);
    if (!slowModel) throw new Error("slow deterministic model missing from test registry");
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const foregroundWaitMs = 300;
    const serverConfig = makeServerConfig(parentAgentDir, dbPath, {
      piSubagentForegroundWaitMs: foregroundWaitMs,
      piSubagentProgressRateHz: 2,
      piSubagentHeartbeatIntervalMs: 1_000,
      piSubagentLeaseDurationMs: 3_000,
    });
    const { authorityService, mintBinding } = makeAuthorityService();
    const bound = mintBinding("user_t24_ac5", "th_t24_ac5");

    const observedSessions = new Map<string, any>();
    const sqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedSessions.set(String(event.threadId), event.session);
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(sqliteLayer),
    );
    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      sqliteLayer,
    );

    let detachHandle: any;
    let detachElapsedMs = 0;

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* seedProjections(["th_t24_ac5"], parentAgentDir);

      yield* adapter.startSession({
        threadId: "th_t24_ac5" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: bound.binding,
      });
      const session = observedSessions.get("th_t24_ac5");
      expect(session).toBeDefined();
      const { execute: executeFn } = agentExecuteFor(session);
      const ctx = executeCtxFor(session, parentAgentDir, slowModel, registry);

      // Warm-up (unmeasured): first managed foreground call in the process
      // performs the real extension's lazy module compilation. The measured
      // call below runs on the warmed loop (Decision 0006 §5 method).
      yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac5_warmup",
          {
            commandId: "cmd_t24_ac5_warmup",
            subagent_type: "researcher",
            task: "Warm-up",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      // Let the warm-up's detached child settle far away from the measurement.
      yield* Effect.sleep(1_500);

      const startTime = Date.now();
      const result: any = yield* Effect.promise(() =>
        executeFn(
          "call_t24_ac5_detach",
          {
            commandId: "cmd_t24_ac5_detach",
            subagent_type: "researcher",
            task: "Slow bounded detach task",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
          undefined,
          undefined,
          ctx,
        ),
      );
      detachElapsedMs = Date.now() - startTime;
      detachHandle = result;
      // Decision 0006 §5 envelope measurement (visible in run output for the
      // acceptance report; the assertion below is the binding check).
      process.stdout.write(
        `T24-AC5 detach envelope: elapsed=${detachElapsedMs}ms budget=${foregroundWaitMs}ms envelope=${foregroundWaitMs + 500}ms\n`,
      );

      // Decision 0006 §5 envelope (standalone per-file method): the handle
      // returns no later than budget + 500 ms.
      expect(detachElapsedMs).toBeGreaterThanOrEqual(foregroundWaitMs - 50);
      expect(detachElapsedMs).toBeLessThan(foregroundWaitMs + 500);

      expect(result.executionId).toMatch(/^exec_/);
      expect(result.attemptId).toMatch(/^att_/);
      expect(result.generation).toBe(1);

      const executionId = result.executionId as string;
      const attemptId = result.attemptId as string;

      // Stable identity across the handle + journal, parent_turn scope via
      // journal metadata (command truth is server-minted).
      const journal = yield* repo.listJournalEvents(executionId);
      expect(journal.length).toBeGreaterThanOrEqual(3);
      expect(journal[0]!.sequence).toBe(1);
      expect(journal[0]!.state).toBe("accepted");
      expect(journal[1]!.sequence).toBe(2);
      expect(journal[1]!.state).toBe("running");
      expect(journal[1]!.attemptId).toBe(attemptId);
      expect(journal[2]!.sequence).toBe(3);
      expect(journal[2]!.state).toBe("running");
      expect(journal[2]!.metadata).toMatchObject({
        phase: "detached",
        attachmentMode: "foreground",
        foregroundWaitMs,
      });
      const aggregate = yield* repo.getById(executionId);
      expect(Option.isSome(aggregate)).toBe(true);
      if (Option.isSome(aggregate)) {
        expect(aggregate.value.cancellationScope).toBe("parent_turn");
        expect(aggregate.value.observedState).toBe("running");
      }

      // The detached child keeps running; stop the session (production
      // teardown aborts the runtime and its children) before reopen.
      yield* adapter.stopSession("th_t24_ac5" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }

    // ── REAL-CHAIN REOPEN: a fresh persistence layer over the SAME file ──
    // (the adapter layer scope above ended with its program, so the original
    // runtime is disposed — exactly the reopen pattern of the ticket-22
    // suite, now exercised on the integrated chain database).
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const executionId = detachHandle.executionId as string;

        const reopened = yield* repo.getById(executionId);
        expect(Option.isSome(reopened)).toBe(true);
        if (Option.isSome(reopened)) {
          expect(reopened.value.executionId).toBe(executionId);
          expect(reopened.value.attemptId).toBe(detachHandle.attemptId);
          expect(reopened.value.generation).toBe(1);
          expect(reopened.value.observedState).toBe("running");
          expect(reopened.value.cancellationScope).toBe("parent_turn");
        }

        const journal = yield* repo.listJournalEvents(executionId);
        expect(journal.map((e) => e.sequence)).toEqual([1, 2, 3]);
        expect(journal[1]!.metadata).toMatchObject({ phase: "started", foregroundWaitMs });
        expect(journal[2]!.metadata).toMatchObject({ phase: "detached", foregroundWaitMs });

        // Whatever progress/heartbeat the real child recorded before the
        // session stopped is restored from the same file without any
        // intermediate history (latest snapshot only).
        const observationOption = yield* repo.getObservation(executionId);
        expect(Option.isSome(observationOption)).toBe(true);
      }).pipe(
        Effect.provide(
          PiSubagentExecutionRepositoryLive.pipe(
            Layer.provideMerge(
              makeSqlitePersistenceLive(fixture.dbPath).pipe(Layer.provide(NodeServices.layer)),
            ),
          ),
        ),
      ),
    );

    // Inline-completion leg of T24-AC5 is proven by stage (3) above (fast
    // child completing inline inside the budget with [accepted, running]
    // journal and no detached event); not duplicated here.
  }, 90_000);

  // -------------------------------------------------------------------------
  // STAGE 6 — T24-AC6: real progress/heartbeat/lease; saturation flood with
  // lifecycle reserve; rate-capped tool.progress; cleanup.
  // -------------------------------------------------------------------------
  it("T24-AC6: real slow child produces durable progress and heartbeat lease observations; a 2000-observation flood is rate-capped with exact dropped accounting and idempotent lifecycle journal; cleanup releases attachments and timers", async () => {
    if (!fixture) throw new Error("stage 1 must run first");
    const { dbPath, parentAgentDir, childAgentDir, modelServer } = fixture;

    const modelRuntime = await ModelRuntime.create({
      authPath: join(parentAgentDir, "auth.json"),
      modelsPath: join(parentAgentDir, "models.json"),
    });
    const registry = new ModelRegistry(modelRuntime);
    const slowModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_SLOW_MODEL_ID);
    if (!slowModel) throw new Error("slow deterministic model missing from test registry");
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;

    const heartbeatIntervalMs = 1_000;
    const leaseDurationMs = 3_000;
    const progressRateHz = 10; // 100 ms flush interval (REAL schedule)
    const serverConfig = makeServerConfig(parentAgentDir, dbPath, {
      piSubagentForegroundWaitMs: 300,
      piSubagentProgressRateHz: progressRateHz,
      piSubagentHeartbeatIntervalMs: heartbeatIntervalMs,
      piSubagentLeaseDurationMs: leaseDurationMs,
    });
    const { authorityService, mintBinding } = makeAuthorityService();
    const boundReal = mintBinding("user_t24_ac6_real", "th_t24_ac6_real");
    const boundFlood = mintBinding("user_t24_ac6_flood", "th_t24_ac6_flood");

    // Saturation leg: a locally-defined compatible companion extension
    // (production fixture module `piSubagentBridge.ts`, not another test
    // file) registered through the production `extensionFactories` seam on
    // the SAME adapter over the SAME live-chain database. It captures the
    // production binding the adapter attaches so the flood can drive the
    // REAL server coalescer at its REAL schedule (setTimeout). The ticket-23
    // virtual-clock seam stays unused here: this file is wallclock/real-time
    // by design.
    let capturedBinding: PiSubagentManagedForegroundBinding | undefined;
    const { extension: floodExtension } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: [
        "managed-spawn",
        "abort-propagation",
        "bounded-foreground-attachment",
        "coalesced-progress",
      ],
      extensionVersion: "0.13.0-alfie.1",
    });
    const capturingFloodExtension = {
      name: "pi-subagents-t24-flood",
      factory: (pi: any) => {
        floodExtension.factory(pi);
        if (pi && typeof pi.registerTool === "function") {
          pi.registerTool({
            name: "Agent",
            label: "Managed Agent",
            description: "Flood capturing Agent tool",
            parameters: {} as any,
            execute: async (
              _toolCallId: string,
              _params: any,
              _signal: any,
              _onUpdate: any,
              ctx: any,
            ) => {
              capturedBinding = getPiSubagentManagedForegroundBinding(ctx);
              return { content: [{ type: "text", text: "captured" }] };
            },
          });
        }
      },
    };

    const observedSessions = new Map<string, any>();
    const runtimeEvents: any[] = [];
    const sqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
    const piAdapterLayer = makePiAdapterLive({
      extensionFactories: [capturingFloodExtension.factory],
      onSubagentCapability: (event) => {
        observedSessions.set(String(event.threadId), event.session);
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
      Layer.provide(sqliteLayer),
    );
    const testLayer = Layer.mergeAll(
      piAdapterLayer,
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      sqliteLayer,
    );

    const testProgram = Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const adapter = yield* PiAdapter;
      yield* seedProjections(["th_t24_ac6_real", "th_t24_ac6_flood"], parentAgentDir);

      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      // ── Real slow child: durable progress + heartbeat lease ──
      yield* adapter.startSession({
        threadId: "th_t24_ac6_real" as ThreadId,
        cwd: parentAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: parentAgentDir } },
        mcpAuthority: boundReal.binding,
      });
      const realSession = observedSessions.get("th_t24_ac6_real");
      expect(realSession).toBeDefined();
      const { execute: realExecute, bridge: realBridge } = agentExecuteFor(realSession);
      const realCtx = executeCtxFor(realSession, parentAgentDir, slowModel, registry);

      const realResult: any = yield* Effect.promise(() =>
        realExecute(
          "call_t24_ac6_real",
          {
            commandId: "cmd_t24_ac6_real",
            subagent_type: "researcher",
            task: "Slow real progress task",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
          undefined,
          undefined,
          realCtx,
        ),
      );
      // Bounded detach for the slow real child (300 ms budget) returned the
      // handle while the child continues in the background.
      expect(realResult.executionId).toMatch(/^exec_/);
      const realExecutionId = realResult.executionId as string;

      // Let the detached child stream across the slow model's first turn
      // (4 s/turn delay before the response chunks arrive) plus 2-3
      // heartbeat intervals (1 s), so the real producer emits genuine
      // progress + heartbeat observations (there IS text-delta activity
      // each turn: the echo fixture streams ACK deltas).
      yield* Effect.sleep(6_500);

      const observationOption = yield* repo.getObservation(realExecutionId);
      expect(Option.isSome(observationOption)).toBe(true);
      if (Option.isSome(observationOption)) {
        const observation = observationOption.value;
        expect(observation.lastProgressJson).not.toBeNull();
        const progress = JSON.parse(observation.lastProgressJson!);
        // Real producer payload contract: real counters, no spinner frame.
        expect("spinnerFrame" in progress).toBe(false);
        expect(progress.status).toBe("running");
        expect(typeof progress.toolUses).toBe("number");
        expect(typeof progress.turnCount).toBe("number");
        expect(observation.lastHeartbeatAt).not.toBeNull();
        expect(observation.leaseExpiresAt).not.toBeNull();
        const leaseLead =
          Date.parse(observation.leaseExpiresAt!) - Date.parse(observation.lastHeartbeatAt!);
        expect(leaseLead).toBe(leaseDurationMs);
      }
      // Journal truth for the real child: lifecycle + the journal-first
      // terminal (Issue 07: the slow child is aborted by session teardown
      // after the assertions, so no terminal row lands HERE — but the
      // foreground-detached child reports its terminal asynchronously; the
      // sequence set therefore ends with the terminal band when it lands
      // before the journal read).
      const realJournal = yield* repo.listJournalEvents(realExecutionId);
      expect(realJournal[0]!.state).toBe("accepted");
      const realSequences = realJournal.map((e) => e.sequence);
      expect(realSequences.slice(0, 3)).toEqual([1, 2, 3]);
      for (const sequence of realSequences.slice(3)) {
        // Anything after the lifecycle band is terminal evidence only.
        expect(sequence).toBe(40);
      }
      yield* adapter.stopSession("th_t24_ac6_real" as ThreadId);

      // ── Deterministic saturation flood on the REAL schedule ──
      // The flood session's agent dir has NO on-disk extension, so the ONLY
      // Agent tool is the companion factory's capturing one (same shape the
      // ticket-23 dispatch suite uses) — the production adapter still wraps
      // it with the full managed admission + binding path over the SAME
      // live-chain database.
      const floodAgentDir = fixture!.floodAgentDir;
      yield* adapter.startSession({
        threadId: "th_t24_ac6_flood" as ThreadId,
        cwd: floodAgentDir,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: floodAgentDir } },
        mcpAuthority: boundFlood.binding,
      });
      const floodSession = observedSessions.get("th_t24_ac6_flood");
      expect(floodSession).toBeDefined();
      const { execute: floodExecute } = agentExecuteFor(floodSession);
      const floodCtx = executeCtxFor(floodSession, floodAgentDir, undefined, {
        find: () => undefined,
        getAll: () => [],
        getAvailable: () => [],
      });
      yield* Effect.promise(() =>
        floodExecute(
          "call_t24_ac6_flood",
          {
            commandId: "cmd_t24_ac6_flood",
            subagent_type: "researcher",
            task: "Flood",
            prompt: "Flood",
          },
          undefined,
          undefined,
          floodCtx,
        ),
      );
      expect(capturedBinding).toBeDefined();
      const binding = capturedBinding!;
      const floodExecutionId = binding.executionId;
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "started",
          occurredAt: new Date().toISOString(),
        }),
      );

      const floodCount = 2_000;
      const floodStart = Date.now();
      for (let i = 0; i < floodCount; i += 1) {
        yield* Effect.promise(() =>
          binding.reportObservation({
            kind: "progress",
            occurredAt: new Date(floodStart + i).toISOString(),
            progressJson: JSON.stringify({ turnCount: i + 1, status: "running" }),
          }),
        );
      }
      const floodElapsedMs = Date.now() - floodStart;
      // Let the final trailing-edge flush (100 ms) fire and settle.
      yield* Effect.sleep(400);

      const floodToolProgress = runtimeEvents.filter(
        (e) => e.type === "tool.progress" && e.raw?.payload?.executionId === floodExecutionId,
      );
      // Rate cap on the REAL schedule: ≤ ceil(elapsed × rateHz) + 1 events.
      const cap = Math.ceil((floodElapsedMs / 1000) * progressRateHz) + 1;
      expect(floodToolProgress.length).toBeLessThanOrEqual(cap);
      expect(floodToolProgress.length).toBeGreaterThanOrEqual(1);

      // Exact accounting: emitted + dropped == flood count.
      const floodObservationOption = yield* repo.getObservation(floodExecutionId);
      expect(Option.isSome(floodObservationOption)).toBe(true);
      if (Option.isSome(floodObservationOption)) {
        const emitted = floodToolProgress.length;
        expect(floodObservationOption.value.droppedProgressCount + emitted).toBe(floodCount);
      }

      // Lifecycle reserve: a duplicate detached observation amid/after the
      // flood keeps the journal idempotent — no new rows, still [1, 2, 3].
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "detached",
          occurredAt: new Date().toISOString(),
        }),
      );
      yield* Effect.promise(() =>
        binding.reportObservation({
          kind: "detached",
          occurredAt: new Date().toISOString(),
        }),
      );
      yield* Effect.sleep(200);
      const floodJournal = yield* repo.listJournalEvents(floodExecutionId);
      expect(floodJournal.map((e) => e.sequence)).toEqual([1, 2, 3]);

      // ── Cleanup ──
      yield* adapter.stopSession("th_t24_ac6_flood" as ThreadId);
      // Bridge-level resources released (the flood session used the real
      // extension's bridge through the companion factory).
      const realSnapshotAfter = realBridge.getResourceSnapshot();
      expect(realSnapshotAfter.activeAttachmentCount).toBe(0);
      expect(realSnapshotAfter.activeTimerCount).toBe(0);

      // Coalescer release (indirect proof — the session-scoped coalescer is
      // internal and not exposed): after stopSession (disposeAll cancels
      // every per-execution slot and timer) and one full flush interval past
      // the idle TTL, no further tool.progress events for the flood
      // execution appear on the runtime-event stream.
      const eventsAtIdleCheck = runtimeEvents.filter(
        (e) => e.type === "tool.progress" && e.raw?.payload?.executionId === floodExecutionId,
      ).length;
      yield* Effect.sleep(Math.max(leaseDurationMs, 2 * heartbeatIntervalMs) + 500);
      const eventsAfterIdle = runtimeEvents.filter(
        (e) => e.type === "tool.progress" && e.raw?.payload?.executionId === floodExecutionId,
      ).length;
      expect(eventsAfterIdle).toBe(eventsAtIdleCheck);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  }, 90_000);

  // Shared model server teardown after the last stage.
  it("teardown: closes the shared deterministic model server", async () => {
    if (fixture) {
      await fixture.modelServer.close();
    }
  });
});
