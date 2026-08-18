/**
 * Wall-clock-sensitive suite (Ticket 22, Decision 0006 §5 `budget + 500 ms`
 * envelope). This file runs in the `wallclock` vitest project defined in
 * `apps/server/vitest.config.ts` (WP-08): one forked runner process per file,
 * executed before the `unit` project. WP-08 also proved the envelope tail in
 * multi-file invocations comes from vitest main-process transform work for
 * pending heavy files, not from adjacent teardown (owner adjudication
 * 2026-08-17, option A): envelope acceptance is verified per-file standalone.
 * Do not move this file out of that project without re-adjudicating the
 * envelope.
 */
import { execSync } from "node:child_process";
import nodeCrypto from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as http from "node:http";
import {
  type AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRegistry,
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
import { PiAdapter } from "./Services/PiAdapter.ts";

// ─── Provenance helpers (local copies) ─────────────────────────────────────────
//
// These mirror the exported provenance helpers of
// `piSubagentRealExtension.test.ts` byte-for-byte in behavior. They are
// duplicated here — rather than imported — because importing another test
// module registers that module's suites inside this file, making every
// real-extension test execute twice per vitest invocation. That duplicated
// execution piles scheduling load onto the exact wall-clock-sensitive detach
// assertions tightened for Decision 0006 §5 (budget + 500 ms), and adds no
// evidence: the real-extension suites already run as their own file in the
// verification commands.

interface LocalProvenanceManifest {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly extensionEntryRelativePath: string;
  readonly packageManifestRelativePath: string;
  readonly hashes: Record<string, string>;
}

function loadLocalProvenanceManifest(): LocalProvenanceManifest {
  const manifestPath = join(__dirname, "./test-fixtures/piSubagentExtensionProvenance.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Provenance assertion failed: provenance manifest not found at ${manifestPath}`,
    );
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function computeLocalSha256(filePath: string): string {
  const content = readFileSync(filePath);
  return nodeCrypto.createHash("sha256").update(content).digest("hex");
}

function normalizeLocalGitUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -4);
  }
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
    if (dir && existsSync(dir) && existsSync(join(dir, ".git"))) {
      return resolve(dir);
    }
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

function verifyExtensionGitProvenance(repoDir?: string): {
  isVerified: boolean;
  repoDir: string;
  commit: string;
  packageName: string;
  packageVersion: string;
} {
  const manifest = loadLocalProvenanceManifest();
  const dir = repoDir ? resolve(repoDir) : resolveAlfieRepoDir();

  const runGit = (args: string) =>
    execSync(args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

  if (runGit("git rev-parse --is-inside-work-tree") !== "true") {
    throw new Error(`Provenance assertion failed: '${dir}' is not a valid Git repository.`);
  }

  const originUrl = runGit("git config --get remote.origin.url");
  if (normalizeLocalGitUrl(originUrl) !== normalizeLocalGitUrl(manifest.expectedRepositoryUrl)) {
    throw new Error(
      `Provenance assertion failed: repository origin '${originUrl}' does not match expected '${manifest.expectedRepositoryUrl}'.`,
    );
  }

  const headCommit = runGit("git rev-parse HEAD");
  if (headCommit !== manifest.pinnedCommit) {
    throw new Error(
      `Provenance assertion failed: HEAD commit '${headCommit}' does not match pinned commit '${manifest.pinnedCommit}'.`,
    );
  }

  const gitStatus = runGit("git status --porcelain agent/extensions/pi-subagents")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("node_modules"))
    .join("\n");
  if (gitStatus.length > 0) {
    throw new Error(
      `Provenance assertion failed: extension path 'agent/extensions/pi-subagents' has uncommitted changes:\n${gitStatus}`,
    );
  }

  const pkgPath = join(dir, manifest.packageManifestRelativePath);
  if (!existsSync(pkgPath)) {
    throw new Error(`Provenance assertion failed: package manifest missing at '${pkgPath}'.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== manifest.packageName) {
    throw new Error(
      `Provenance assertion failed: package name '${pkg.name}' does not match expected '${manifest.packageName}'.`,
    );
  }
  if (pkg.version !== manifest.packageVersion) {
    throw new Error(
      `Provenance assertion failed: package version '${pkg.version}' does not match expected '${manifest.packageVersion}'.`,
    );
  }

  for (const [relPath, expectedHash] of Object.entries(manifest.hashes)) {
    const fullPath = join(dir, relPath);
    if (!existsSync(fullPath)) {
      throw new Error(
        `Provenance assertion failed: file '${relPath}' missing from extension tree.`,
      );
    }
    const computed = computeLocalSha256(fullPath);
    if (computed !== expectedHash) {
      throw new Error(
        `Provenance assertion failed: SHA-256 mismatch for '${relPath}': expected '${expectedHash}', got '${computed}'.`,
      );
    }
  }

  return {
    isVerified: true,
    repoDir: dir,
    commit: headCommit,
    packageName: pkg.name,
    packageVersion: pkg.version,
  };
}

/**
 * Asserts the session loaded the actual production `@alfie/pi-subagents`
 * extension through real package discovery (same checks as the canonical
 * helper in `piSubagentRealExtension.test.ts`).
 */
function assertProductionExtensionProvenance(session: AgentSession | any): {
  isProduction: boolean;
  packageName: string;
  extensionVersion: string;
  extensionPath: string;
  toolNames: string[];
} {
  const resourceLoader = session.resourceLoader;
  if (!resourceLoader || typeof resourceLoader.getExtensions !== "function") {
    throw new Error(
      "Provenance assertion failed: session does not expose resourceLoader with getExtensions().",
    );
  }

  const loadedExtensions = resourceLoader.getExtensions()?.extensions;
  if (!Array.isArray(loadedExtensions) || loadedExtensions.length === 0) {
    throw new Error("Provenance assertion failed: no extensions loaded in session.");
  }

  const ext = loadedExtensions.find((e: any) => {
    if (!e || typeof e !== "object") return false;
    if (e.tools instanceof Map && e.tools.has("Agent")) return true;
    if (e.handlers instanceof Map && e.handlers.has("synara:subagents:bridge")) return true;
    return false;
  });

  if (!ext) {
    throw new Error(
      "Provenance assertion failed: subagents extension not found among loaded extensions.",
    );
  }

  if (!ext.path || ext.path.startsWith("<inline:") || ext.path.startsWith("<temporary")) {
    throw new Error(
      "Provenance assertion failed: extension was injected via inline/temporary factory, not real package discovery.",
    );
  }

  if (
    ext.sourceInfo?.source !== "auto" &&
    ext.sourceInfo?.source !== "local" &&
    ext.sourceInfo?.source !== "package"
  ) {
    throw new Error(
      `Provenance assertion failed: extension source '${ext.sourceInfo?.source}' is not a production discovery source.`,
    );
  }

  if (!existsSync(ext.path)) {
    throw new Error(
      `Provenance assertion failed: extension entry path '${ext.path}' does not exist on disk.`,
    );
  }

  let currentDir = dirname(ext.path);
  let packageJsonPath: string | undefined;
  for (let i = 0; i < 4; i++) {
    const candidate = join(currentDir, "package.json");
    if (existsSync(candidate)) {
      packageJsonPath = candidate;
      break;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  if (!packageJsonPath) {
    throw new Error(
      `Provenance assertion failed: could not locate package.json for extension at '${ext.path}'.`,
    );
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const manifest = loadLocalProvenanceManifest();
  if (pkg.name !== manifest.packageName) {
    throw new Error(
      `Provenance assertion failed: package name is '${pkg.name}', expected '${manifest.packageName}'.`,
    );
  }
  if (pkg.version !== manifest.packageVersion) {
    throw new Error(
      `Provenance assertion failed: package version is '${pkg.version}', expected '${manifest.packageVersion}'.`,
    );
  }

  const tools = session.getAllTools();
  const agentTool = tools.find((t: any) => t.name === "Agent");
  if (!agentTool) {
    throw new Error("Provenance assertion failed: 'Agent' tool is not registered on session.");
  }

  const props = (agentTool.parameters as any)?.properties;
  const isCompleteSchema =
    props &&
    typeof props === "object" &&
    "task" in props &&
    "context" in props &&
    "link_references" in props &&
    "expected_outcome" in props &&
    "subagent_type" in props &&
    "thinking" in props &&
    "run_in_background" in props &&
    "resume" in props &&
    "isolation" in props;

  if (!isCompleteSchema) {
    throw new Error(
      "Provenance assertion failed: Agent tool is missing required fields from the complete 9-field delegation schema.",
    );
  }

  verifyExtensionGitProvenance(resolveAlfieRepoDir());

  return {
    isProduction: true,
    packageName: pkg.name,
    extensionVersion: pkg.version,
    extensionPath: ext.path,
    toolNames: tools.map((t: any) => t.name),
  };
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  createdDirs.length = 0;
});

function makeServerConfig(
  tempDir: string,
  overrides?: Partial<ServerConfigShape>,
): ServerConfigShape {
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

/**
 * Deterministic completion-model support for the owner-approved actual-Pi
 * boundary (Issue 22 remediation, Decision 0001 evidence standards).
 *
 * The acceptance environment has no working model credential, so a real
 * child cannot complete successfully against a hosted provider. These
 * helpers stand up a REAL local OpenAI-completions provider instead: a loopback
 * HTTP server speaking the streaming chat-completions wire format, registered
 * as an ordinary custom provider via the agent dir's `models.json`/`auth.json`
 * (the standard pi configuration surface — no production seam is mocked).
 *
 * The child still runs the complete real boundary: PiAdapter session,
 * extension admission, AgentManager, `runAgent`, `createAgentSession`, the
 * real `openai-completions` streaming client, and settlement. Only the model
 * endpoint is a deterministic local fixture, which makes "child completes
 * successfully inside the budget" (T22-AC1) and "legacy session waits
 * unbounded for its child" (T22-AC6) deterministic.
 */
const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_FAST_MODEL_ID = "echo";
const DETERMINISTIC_SLOW_MODEL_ID = "echo-slow";
const DETERMINISTIC_SLOW_DELAY_MS = 1500;

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

/**
 * Writes a real agent-dir configuration (extensions symlinks + auth.json +
 * models.json) whose registry contains the deterministic local provider.
 */
function writeDeterministicModelAgentDir(tempAgentDir: string, baseUrl: string): void {
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
 * Creates a real mixed-version extension directory for T22-AC6: a full copy
 * of the actual pinned `@alfie/pi-subagents` extension tree with EXACTLY ONE
 * change — the `bounded-foreground-attachment` entry is removed from the
 * `PI_SUBAGENT_CAPABILITIES` array in `src/index.ts`. That removal is the
 * mixed-version (older-extension) condition under test: Symphony must
 * negotiate `capability_mismatch` and keep the actual Agent tool on legacy
 * unmanaged semantics instead of partially applying managed semantics
 * (Decision 0006 §3).
 *
 * Everything else is byte-identical to the pinned extension: `src/`,
 * `package.json`, `extension-manifest.json`, top-level helper scripts, and a
 * symlinked `node_modules` + sibling `shared` (same on-disk layout the real
 * sessions discover).
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

/**
 * Builds a real adjacent-legacy agent dir for T22-AC6: extensions/pi-subagents
 * is the stripped-capability copy of the actual extension, plus the standard
 * sibling `shared` symlink and deterministic-model configuration so the real
 * legacy Agent call can execute an actual child to completion.
 */
function createLegacyAgentDir(tempAgentDir: string, baseUrl: string): void {
  createStrippedCapabilityExtensionCopy(join(tempAgentDir, "extensions", "pi-subagents"));
  const versionedDir = resolveVersionedExtensionDir();
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, join(tempAgentDir, "extensions", "shared"), "dir");
  }
  // The copied extension tree resolves its system-prompt templates relative
  // to `<agentDir>/system` (the copy is a real directory, not a symlink), so
  // link the real repo's `agent/system` alongside it exactly like the real
  // agent dir layout.
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
 * Builds the runtime tool-execution context model/registry pair the way the
 * production runtime supplies it: a real `ModelRegistry` over a
 * `ModelRuntime` created from the same agent dir, resolving the deterministic
 * local model. `PI_CODING_AGENT_DIR` is pointed at `childAgentDir` so the
 * child session's own services (extension loader, settings, model runtime)
 * resolve the same deterministic provider.
 */
async function resolveDeterministicModelContext(
  agentDir: string,
  childAgentDir: string,
  slow: boolean,
) {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
  const registry = new ModelRegistry(modelRuntime);
  const modelId = slow ? DETERMINISTIC_SLOW_MODEL_ID : DETERMINISTIC_FAST_MODEL_ID;
  const model = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, modelId);
  if (!model) {
    throw new Error(
      `Deterministic local model ${DETERMINISTIC_MODEL_PROVIDER_ID}/${modelId} not available in test registry`,
    );
  }
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = childAgentDir;
  return {
    model,
    registry,
    restoreEnv: () => {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    },
  };
}

describe("Pi Subagent Bounded Foreground Attachment Integrated Acceptance (Issue 22)", () => {
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
        cwd: tempDir,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: observedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // Warm-up (unmeasured): the first managed foreground call in a process
      // also performs the real extension's lazy module compilation
      // (agent-runner chain, prompts, widget). Decision 0006 §5 measures the
      // production call chain on a functioning loop, so the AC measured call
      // runs once on the warmed loop — identical to every subsequent managed
      // call in a real server process.
      yield* Effect.promise(() =>
        executeFn(
          "call_ac2_warmup",
          {
            commandId: "cmd_ac2_warmup",
            subagent_type: "researcher",
            task: "Warm-up execution",
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

      // Decision 0006 §5 acceptance envelope: the handle must return no later
      // than budget + 500 ms on a functioning loop (measured locally on this
      // boundary: single-shot detach lands ~305-580 ms for a 300 ms budget).
      expect(elapsed).toBeGreaterThanOrEqual(foregroundWaitMs - 50);
      expect(elapsed).toBeLessThan(foregroundWaitMs + 500);

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
    expect(isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 100 })).toBe(
      true,
    );

    // Upper bound endpoint (60000)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 60_000 }),
    ).toBe(true);

    // Intermediate valid value (5000)
    expect(isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 5_000 })).toBe(
      true,
    );

    // Below min endpoint (< 100)
    expect(isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 99 })).toBe(
      false,
    );

    // Above max endpoint (> 60000)
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 60_001 }),
    ).toBe(false);

    // Negative value
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: -10_000 }),
    ).toBe(false);

    // Zero
    expect(isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 0 })).toBe(
      false,
    );

    // Non-integer float
    expect(
      isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: 5_000.5 }),
    ).toBe(false);

    // NaN / string
    expect(isPiSubagentManagedForegroundBinding({ ...validBinding, foregroundWaitMs: NaN })).toBe(
      false,
    );
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
          {
            commandId: "cmd_ac7_detach",
            subagent_type: "researcher",
            task: "Task Detach",
            context: "C",
            link_references: "L",
            expected_outcome: "O",
            run_in_background: false,
          },
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
    expect(provenance.packageVersion).toBe("0.13.0-alfie.1");
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

  // -------------------------------------------------------------------------
  // T22-AC6: Isolation across concurrent managed executions AND a real
  // adjacent legacy session (stripped-capability mixed-version extension).
  // -------------------------------------------------------------------------
  it("T22-AC6: concurrent managed executions and a real adjacent legacy session retain independent identities, timeouts, journal rows, and behavior", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempDirManaged = `/tmp/synara-t22-ac6-m-${stamp}`;
    const tempDirLegacy = `/tmp/synara-t22-ac6-l-${stamp}`;
    const tempDirLegacyChild = `/tmp/synara-t22-ac6-lc-${stamp}`;
    createdDirs.push(tempDirManaged, tempDirLegacy, tempDirLegacyChild);

    // Deterministic model server: the legacy leg executes an actual Agent call
    // whose real child consumes the SLOW deterministic model (1500 ms), so the
    // legacy session demonstrably waits for its child far beyond the managed
    // budget (unbounded legacy foreground) while the managed executions detach
    // at their own deadline.
    const modelServer = await startDeterministicModelServer();
    createRealExtensionDirectory(tempDirManaged);
    createLegacyAgentDir(tempDirLegacy, modelServer.baseUrl);
    writeDeterministicModelAgentDir(tempDirLegacyChild, modelServer.baseUrl);
    const legacyModelContext = await resolveDeterministicModelContext(
      tempDirLegacy,
      tempDirLegacyChild,
      true,
    );

    const managedForegroundWaitMs = 400;
    const serverConfig = makeServerConfig(tempDirManaged, {
      piSubagentForegroundWaitMs: managedForegroundWaitMs,
    });
    const { authorityService, binding: binding1 } = makeAuthorityFixture("th_t22_ac6_m1");
    const binding2 = authorityService.bindingFor("user_th_t22_ac6_m1", {
      threadId: "th_t22_ac6_m2" as ThreadId,
      provider: "pi",
      projectId: "proj_default",
      lifecycleGeneration: null,
      credentialTtlMs: 60 * 60 * 1_000,
    })!;
    const legacyBinding = authorityService.bindingFor("user_th_t22_ac6_m1", {
      threadId: "th_t22_ac6_legacy" as ThreadId,
      provider: "pi",
      projectId: "proj_default",
      lifecycleGeneration: null,
      credentialTtlMs: 60 * 60 * 1_000,
    })!;

    const observedSessions = new Map<string, any>();
    const observedCapabilities = new Map<string, any>();
    const admittedEvents: Array<{
      threadId: ThreadId;
      command: PiSubagentSpawnCommand;
      result: PiSubagentSpawnResult;
    }> = [];
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
          ('th_t22_ac6_m2', 'proj_default', 'Managed Thread 2', '{"provider":"pi","model":"pi"}', 'full-access', 'default', 'local', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL),
          ('th_t22_ac6_legacy', 'proj_default', 'Legacy Thread', '{"provider":"pi","model":"pi"}', 'full-access', 'default', 'local', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z', NULL)
      `;

      // Managed session (current extension).
      yield* adapter.startSession({
        threadId: "th_t22_ac6_m1" as ThreadId,
        cwd: tempDirManaged,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: tempDirManaged } },
        mcpAuthority: binding1,
      });
      const managedSession = observedSessions.get("th_t22_ac6_m1");
      expect(managedSession).toBeDefined();

      const loadedExt = managedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      const agentEntry = loadedExt.tools.get("Agent");
      const executeFn = agentEntry.execute ?? agentEntry.definition?.execute;
      const managedBridge = loadedExt.handlers.get("synara:subagents:bridge")[0]();

      const parentCtx = {
        ui: {
          notify: () => {},
          setStatus: () => {},
          setWidget: () => {},
          select: async () => undefined,
          confirm: async () => true,
          input: async () => undefined,
        },
        cwd: tempDirManaged,
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
        sessionManager: managedSession.sessionManager,
        getSystemPrompt: () => "",
      };

      // Real adjacent legacy session through the SAME production adapter: its
      // agent dir resolves the stripped-capability copy of the actual
      // extension (only "bounded-foreground-attachment" removed), so the
      // handshake must yield capability_mismatch and the actual Agent tool
      // must stay on legacy unmanaged semantics.
      yield* adapter.startSession({
        threadId: "th_t22_ac6_legacy" as ThreadId,
        cwd: tempDirLegacy,
        runtimeMode: "full-access",
        providerOptions: { pi: { agentDir: tempDirLegacy } },
        mcpAuthority: legacyBinding,
      });
      const legacySession = observedSessions.get("th_t22_ac6_legacy");
      expect(legacySession).toBeDefined();

      const legacyCapability = observedCapabilities.get("th_t22_ac6_legacy");
      expect(legacyCapability?.isManaged).toBe(false);
      expect(legacyCapability?.status).toBe("capability_mismatch");
      expect(legacyCapability?.missingCapabilities).toContain("bounded-foreground-attachment");

      const legacyLoadedExt = legacySession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
      expect(legacyLoadedExt).toBeDefined();
      const legacyAgentEntry = legacyLoadedExt.tools.get("Agent");
      const legacyExecuteFn = legacyAgentEntry.execute ?? legacyAgentEntry.definition?.execute;
      expect(typeof legacyExecuteFn).toBe("function");
      // No Synara admission wrapper is installed for the mixed-version
      // session: no managed binding can be attached to its Agent calls.
      expect(legacyAgentEntry.__synaraAdmissionWrapped).toBeUndefined();
      expect(legacyAgentEntry.definition?.__synaraAdmissionWrapped).toBeUndefined();

      const legacyParentCtx = {
        ui: {
          notify: () => {},
          setStatus: () => {},
          setWidget: () => {},
          select: async () => undefined,
          confirm: async () => true,
          input: async () => undefined,
        },
        cwd: tempDirLegacy,
        model: legacyModelContext.model,
        modelRegistry: legacyModelContext.registry,
        sessionManager: legacySession.sessionManager,
        getSystemPrompt: () => "",
      };

      const admittedBefore = admittedEvents.length;

      // CONCURRENT execution: two managed bounded-foreground Agent calls and
      // one real legacy (unbounded) Agent call racing in the same event loop.
      // The legacy call is started first (unawaited) so all three children are
      // genuinely in flight together; the managed pair is timed on its own so
      // the measurement covers exactly the managed bounded-detach return,
      // while the legacy call keeps waiting for its actual slow child well
      // past the managed budget.
      const legacyStartedAt = Date.now();
      const legacyPromise = Promise.resolve(
        legacyExecuteFn(
          "call_legacy",
          {
            commandId: "cmd_legacy",
            subagent_type: "researcher",
            task: "Legacy unbounded foreground task",
            context: "Legacy context.",
            link_references: "None",
            expected_outcome: "ACK from the real legacy child.",
            run_in_background: false,
          },
          undefined,
          undefined,
          legacyParentCtx,
        ),
      );

      const managedStart = Date.now();
      const [res1, res2] = yield* Effect.promise(() =>
        Promise.all([
          executeFn(
            "call_m1",
            {
              commandId: "cmd_m1",
              subagent_type: "researcher",
              task: "Task M1",
              context: "C1",
              link_references: "L1",
              expected_outcome: "O1",
              run_in_background: false,
            },
            undefined,
            undefined,
            parentCtx,
          ),
          executeFn(
            "call_m2",
            {
              commandId: "cmd_m2",
              subagent_type: "researcher",
              task: "Task M2",
              context: "C2",
              link_references: "L2",
              expected_outcome: "O2",
              run_in_background: false,
            },
            undefined,
            undefined,
            parentCtx,
          ),
        ]),
      );
      const managedElapsed = Date.now() - managedStart;

      const legacyResult = yield* Effect.promise(() => legacyPromise);
      const legacyElapsed = Date.now() - legacyStartedAt;

      // ── Managed pair: distinct identities, bounded detach, journals ──
      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect((res1 as any).executionId).toBeDefined();
      expect((res2 as any).executionId).toBeDefined();
      expect((res1 as any).executionId).not.toBe((res2 as any).executionId);
      expect((res1 as any).attemptId).not.toBe((res2 as any).attemptId);

      // Decision 0006 §5 envelope for the managed budget (400 ms + 500 ms).
      expect(managedElapsed).toBeLessThan(managedForegroundWaitMs + 500);

      const j1 = yield* repo.listJournalEvents((res1 as any).executionId);
      const j2 = yield* repo.listJournalEvents((res2 as any).executionId);
      expect(j1.length).toBeGreaterThanOrEqual(3);
      expect(j2.length).toBeGreaterThanOrEqual(3);
      expect(j1[0]!.executionId).toBe((res1 as any).executionId);
      expect(j2[0]!.executionId).toBe((res2 as any).executionId);
      expect(j1[2]!.metadata).toMatchObject({
        phase: "detached",
        foregroundWaitMs: managedForegroundWaitMs,
      });
      expect(j2[2]!.metadata).toMatchObject({
        phase: "detached",
        foregroundWaitMs: managedForegroundWaitMs,
      });

      // Managed bridge resources are clean after both detaches.
      const managedSnapshot = managedBridge.getResourceSnapshot();
      expect(managedSnapshot.activeAttachmentCount).toBe(0);
      expect(managedSnapshot.activeTimerCount).toBe(0);

      // ── Legacy leg: normal inline completion, unbounded wait, no managed truth ──
      expect(legacyResult).toBeDefined();
      const legacyText = (legacyResult as any).content?.[0]?.text ?? "";
      // The real legacy child COMPLETED (actual child output text + the
      // extension's own completion framing) — this is a settlement, not a
      // bounded detach.
      expect((legacyResult as any).isError).toBeUndefined();
      expect(legacyText).toContain("Agent completed in");
      expect(legacyText).toContain("ACK");
      expect(legacyText).not.toContain("detached after foreground timeout");
      // Unbounded wait: the legacy call waited for its actual slow child
      // (deterministic 1500 ms model delay) and completed inline, exceeding
      // the managed 400 ms budget — no bounded cut happened for the legacy
      // session, and the managed pair returned before the legacy child did.
      expect(legacyElapsed).toBeGreaterThanOrEqual(1500);
      expect(managedElapsed).toBeGreaterThanOrEqual(managedForegroundWaitMs);
      expect(managedElapsed).toBeLessThan(1500);
      // No managed identities were attached to the legacy result.
      expect((legacyResult as any).executionId).toBeUndefined();
      expect((legacyResult as any).attemptId).toBeUndefined();
      expect((legacyResult as any).generation).toBeUndefined();

      // No journal rows exist for the legacy execution: admission never ran
      // for the capability-mismatched session — every admission in this test
      // belongs to the managed thread, and the legacy thread has zero
      // durable rows.
      expect(admittedEvents.length).toBe(admittedBefore + 2);
      for (const admitted of admittedEvents.slice(admittedBefore)) {
        expect(admitted.command.parentThreadId).not.toBe("th_t22_ac6_legacy");
      }
      const legacyThreadRows = yield* repo.listByThreadId("th_t22_ac6_legacy");
      expect(legacyThreadRows).toHaveLength(0);

      // The legacy child consumed the deterministic SLOW model through the
      // real pipeline (proves an actual Agent execution, not a fixture probe).
      expect(
        modelServer.requests.some((r) => r.includes(`model=${DETERMINISTIC_SLOW_MODEL_ID}`)),
      ).toBe(true);

      // Managed truth is unaffected by the legacy execution: the two managed
      // journals still end at their detached sequences and no third managed
      // execution was minted.
      const managedThreadRows = yield* repo.listByThreadId("th_t22_ac6_m1");
      expect(managedThreadRows).toHaveLength(2);

      yield* adapter.stopSession("th_t22_ac6_m1" as ThreadId);
      yield* adapter.stopSession("th_t22_ac6_legacy" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      legacyModelContext.restoreEnv();
      await modelServer.close();
    }
  });

  // -------------------------------------------------------------------------
  // T22-AC1: Fast inline child
  // -------------------------------------------------------------------------
  it("T22-AC1: real Pi child completing inside budget returns normal inline result with seq1 accepted and seq2 started only", async () => {
    const tempDir = `/tmp/synara-t22-ac1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const childAgentDir = `${tempDir}-child`;
    createdDirs.push(tempDir, childAgentDir);
    // Deterministic successful completion: the real child runs the complete
    // actual-Pi boundary against a local deterministic model endpoint, so the
    // inline result provably represents a successful completion (child output
    // text + completed status) inside the 30 s budget — not merely a returned
    // identity object.
    const modelServer = await startDeterministicModelServer();
    writeDeterministicModelAgentDir(tempDir, modelServer.baseUrl);
    writeDeterministicModelAgentDir(childAgentDir, modelServer.baseUrl);
    const modelContext = await resolveDeterministicModelContext(tempDir, childAgentDir, false);

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

      const loadedExt = observedSession.resourceLoader
        .getExtensions()
        .extensions.find((e: any) => e.tools instanceof Map && e.tools.has("Agent")) as any;
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
        model: modelContext.model,
        modelRegistry: modelContext.registry,
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
      expect((result as any).isError).toBeUndefined();
      expect((result as any).executionId).toMatch(/^exec_/);
      expect((result as any).attemptId).toMatch(/^att_/);
      expect((result as any).generation).toBe(1);

      // T22-AC1 remediation: the inline result must provably be a SUCCESSFUL
      // completion of the real child — the child's actual output text ("ACK",
      // streamed by the deterministic local model the real child consumed) and
      // the extension's own completion framing, not merely identities.
      const resultText = (result as any).content?.[0]?.text ?? "";
      expect(resultText).toContain("Agent completed in");
      expect(resultText).toContain("ACK");
      expect(resultText).not.toContain("Agent failed:");
      expect(resultText).not.toContain("detached after foreground timeout");
      expect((result as any).details?.status).toBe("completed");
      expect((result as any).details?.disposition).not.toBe("detached");
      // Completed inside the budget (deterministic child settles in well under
      // a second; the budget is 30 s).
      expect(elapsed).toBeLessThan(30000);

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

      // The deterministic local model endpoint really served the real child's
      // completion request (proves the child executed the full real pipeline,
      // and no fallback/default hosted model was used).
      expect(modelServer.requests.length).toBeGreaterThanOrEqual(1);
      expect(
        modelServer.requests.some((r) => r.includes(`model=${DETERMINISTIC_FAST_MODEL_ID}`)),
      ).toBe(true);

      yield* adapter.stopSession("th_t22_ac1" as ThreadId);
    });

    try {
      await Effect.runPromise(testProgram.pipe(Effect.provide(testLayer)));
    } finally {
      modelContext.restoreEnv();
      await modelServer.close();
    }
  });
});
