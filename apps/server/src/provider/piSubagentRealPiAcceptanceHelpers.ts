/**
 * Ticket 17 — Integrated real-Pi acceptance helpers (test-only harness).
 *
 * Everything in this module exists to support
 * `piSubagentRealPiAcceptance.test.ts`. It composes the PRODUCTION server
 * graph (`makeServerRuntimeServicesLayer` + the real durable provider
 * service + the REAL PiAdapter over the pinned Alfie pi-subagents
 * extension) behind a bounded loopback HTTP/WebSocket server exposing the
 * public `websocketRpcRouteLayer`, and drives it through a real WebSocket
 * RPC client.
 *
 * The ONLY substitutions inside the production graph are:
 *   - the deterministic loopback model endpoint (owner-approved fixture
 *     seam; identical role to the ticket-22/24 suites' echo server), and
 *   - the `ProviderAdapterRegistry` resolves ONLY "pi" to the real observed
 *     Pi adapter layer (same registry-substitution pattern as the approved
 *     `WsOrchestrationHarness`), so no unrelated provider binary is needed.
 *
 * Observation hooks (`onSubagentCapability`, `onSubagentAdmission`) are
 * production `makePiAdapterLive` composition options — they observe without
 * altering behavior, and they back the accepted direct live Agent-tool
 * fallback if deterministic model tool-calling cannot drive the public WS
 * turn path.
 */
import { execSync, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ORCHESTRATION_WS_METHODS,
  type ClientOrchestrationCommand,
  type DispatchResult,
  type OrchestrationReadModel,
  type PiSubagentResultReadResult,
  type ProviderListCommandsInput,
  type ProviderListCommandsResult,
  type ProviderListSkillsInput,
  type ProviderListSkillsResult,
  type OrchestrationReplayEventsInput,
  type OrchestrationReplayEventsResult,
  type OrchestrationThreadDetailSnapshot,
  type PiSubagentExecutionCard,
  type PiSubagentNegotiatedCapability,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
  type ServerSettingsView,
  ThreadId,
  WS_COMPATIBILITY_QUERY,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WS_NEGOTIATE_QUERY,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WS_SERVER_CAPABILITIES,
  WS_METHODS,
  WsBootstrapNegotiateResult,
  WsDeviceRpcGroup,
  WsFeatureRpcGroup,
} from "@synara/contracts";

import { Effect, Exit, Layer, ManagedRuntime, Option, Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { HttpRouter } from "effect/unstable/http";
import { Schema } from "effect";

import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../agentGateway/Services/McpSessionAuthority.ts";
import { AgentGatewayCredentialsWithSecretsLive } from "../agentGateway/Layers/AgentGatewayCredentials.ts";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import {
  ServerConfig,
  deriveServerPaths,
  preparePrivateServerPaths,
  resolveCanonicalWorkspaceRoots,
  type ServerConfigShape,
} from "../config.ts";
import { makeBoundedNodeHttpServer } from "../nodeHttpServer.ts";
import { OpenLive } from "../open.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationReactor } from "../orchestration/Services/OrchestrationReactor.ts";
import { recoverSynaraMcpPendingOperations } from "../orchestration/synaraMcpStartupRecovery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { setPiSubagentExecutionLifecycleListener } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { ProviderRuntimeEventRepositoryLive } from "../persistence/Layers/ProviderRuntimeEvents.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderUnsupportedError } from "../provider/Errors.ts";
import { ProviderDiscoveryServiceLive } from "../provider/Layers/ProviderDiscoveryService.ts";
import { ProviderSessionDirectoryLive } from "../provider/Layers/ProviderSessionDirectory.ts";
import { makePiAdapterLive } from "../provider/Layers/PiAdapter.ts";
import {
  PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT,
  SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV,
} from "../provider/piSubagentDesktopArtifactGate.ts";
import { piSubagentDesktopManagedExtensionDir } from "../provider/piSubagentManagedRuntimeBinding.ts";
import { makeDurableProviderServiceLive } from "../provider/Layers/ProviderService.ts";
import { PiAdapter } from "../provider/Services/PiAdapter.ts";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry.ts";
import { makePiSubagentExecutionCardBridge } from "../provider/piSubagentExecutionCardBridge.ts";
import { makePiSubagentParentEffectDispatcher } from "../provider/piSubagentParentEffectDispatcher.ts";
import {
  extractPiSubagentBridge,
  type PiSubagentActiveChild,
  type PiSubagentExtensionBridge,
} from "../provider/piSubagentBridge.ts";
import { recoverCompletionOutbox } from "../provider/piSubagentCompletionOutbox.ts";
import { runPiSubagentProcessTeardown } from "../provider/piSubagentProcessTeardown.ts";
import { reconcilePiSubagentExecutions } from "../provider/piSubagentRestartReconciliation.ts";
import { makeServerRuntimeServicesLayer } from "../serverLayers.ts";
import { ServerRuntimeStartup } from "../serverRuntimeStartup.ts";
import { ServerSettingsLive } from "../serverSettings.ts";
import { websocketRpcRouteLayer } from "../wsRpc.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";

type ModelTool = { name?: string; function?: { name?: string } };

const modelToolName = (tool: ModelTool): string | undefined => tool.name ?? tool.function?.name;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Provenance (local copy of the pinned-suite pattern; no test imports) ────

interface LocalProvenanceManifest {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly hashes: Record<string, string>;
}

function loadLocalProvenanceManifest(): LocalProvenanceManifest {
  const manifestPath = path.join(__dirname, "./test-fixtures/piSubagentExtensionProvenance.json");
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
      ? path.resolve(process.env.ALFIE_EXTENSION_DIR, "../../..")
      : undefined,
    path.resolve(process.cwd(), "../../../alfie"),
    path.resolve(process.cwd(), "../../alfie"),
    path.resolve(process.cwd(), "../alfie"),
    path.resolve(__dirname, "../../../../../../alfie"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (dir && existsSync(dir) && existsSync(path.join(dir, ".git"))) return path.resolve(dir);
  }
  throw new Error(
    "Provenance assertion failed: could not locate version-controlled alfie repository. Set ALFIE_REPO_DIR or ensure alfie exists alongside symphony.",
  );
}

function resolveVersionedExtensionDir(): string {
  const repoDir = resolveAlfieRepoDir();
  const extDir = path.join(repoDir, "agent/extensions/pi-subagents");
  if (!existsSync(extDir) || !existsSync(path.join(extDir, "package.json"))) {
    throw new Error(`Provenance assertion failed: extension directory not found at '${extDir}'.`);
  }
  return extDir;
}

export type UserPiHomeEntryType =
  | "absent"
  | "regular"
  | "directory"
  | "symlink"
  | "other";

export interface UserPiHomePathSnapshot {
  /** No file contents are retained in an isolation snapshot. */
  readonly exists: boolean;
  readonly type: UserPiHomeEntryType;
  readonly hash: string | null;
  readonly size: number | null;
}

export interface UserPiHomeResourceSnapshot extends UserPiHomePathSnapshot {
  /** Path relative to ~/.pi; never an absolute path or file content. */
  readonly path: string;
  /** Present only for symlinks. */
  readonly symlinkTarget: string | null;
}

export interface UserPiHomeModelsStoreSnapshot extends UserPiHomePathSnapshot {
  /** Diagnostic only; unlike the strict digest, cache mtime is allowed to move. */
  readonly mtimeMs: number | null;
}

export interface UserPiHomeSnapshot {
  /** Backward-compatible strict fingerprint of all non-cache, non-session paths. */
  readonly digest: string;
  readonly sensitive: Readonly<{
    readonly authJson: UserPiHomePathSnapshot;
    readonly modelsJson: UserPiHomePathSnapshot;
    readonly settingsJson: UserPiHomePathSnapshot;
  }>;
  /** Every entry below agent/extensions and agent/skills, including symlinks. */
  readonly resources: ReadonlyArray<UserPiHomeResourceSnapshot>;
  /** Exact agent/models-store.json observation; non-regular present values fail closed. */
  readonly modelsStore: UserPiHomeModelsStoreSnapshot;
}

export interface FilesystemTreeEntry {
  readonly path: string;
  readonly type: UserPiHomeEntryType;
  readonly symlinkTarget: string | null;
  readonly size: number | null;
  readonly hash: string | null;
}

export interface IsolationPathObservation {
  readonly path: string;
  /** Canonical existing path, or the canonical parent plus basename when absent. */
  readonly realpath: string;
  readonly exists: boolean;
  readonly type: UserPiHomeEntryType;
  readonly symlinkTarget: string | null;
}

export interface PiAgentRuntimeSnapshot {
  readonly authJson: UserPiHomePathSnapshot;
  readonly modelsJson: UserPiHomePathSnapshot;
  readonly settingsJson: UserPiHomePathSnapshot;
  readonly modelsStore: UserPiHomeModelsStoreSnapshot;
}

const USER_PI_SENSITIVE_FILES = {
  authJson: "agent/auth.json",
  modelsJson: "agent/models.json",
  settingsJson: "agent/settings.json",
} as const;
const USER_PI_MODELS_STORE = "agent/models-store.json";
const USER_PI_RESOURCE_ROOTS = ["agent/extensions", "agent/skills"] as const;

type UserPiEntry = {
  readonly type: UserPiHomeEntryType;
  readonly hash: string | null;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  readonly symlinkTarget: string | null;
};

function userPiRelative(piHome: string, fullPath: string): string {
  return path.relative(piHome, fullPath).split(path.sep).join("/");
}

function userPiEntryType(stat: ReturnType<typeof lstatSync>): UserPiHomeEntryType {
  if (stat.isFile()) return "regular";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  return "other";
}

function hashUserPiRegularFile(fullPath: string): string {
  try {
    return crypto.createHash("sha256").update(readFileSync(fullPath)).digest("hex");
  } catch (cause) {
    throw new Error(
      `Unable to fingerprint user Pi home entry '${fullPath}': ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

function observeUserPiEntry(fullPath: string, allowAbsent = true): UserPiEntry {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(fullPath);
  } catch (cause) {
    if (allowAbsent && (cause as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { type: "absent", hash: null, size: null, mtimeMs: null, symlinkTarget: null };
    }
    throw new Error(
      `Unable to inspect user Pi home entry '${fullPath}': ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  const type = userPiEntryType(stat);
  if (type === "regular") {
    return {
      type,
      hash: hashUserPiRegularFile(fullPath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      symlinkTarget: null,
    };
  }
  if (type === "symlink") {
    let symlinkTarget: string;
    try {
      symlinkTarget = fs.readlinkSync(fullPath);
    } catch (cause) {
      throw new Error(
        `Unable to read user Pi home symlink '${fullPath}': ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
    return {
      type,
      // Hashing the link target gives a stable, content-free witness for link
      // replacement while preserving the link's exact target separately.
      hash: crypto.createHash("sha256").update(symlinkTarget).digest("hex"),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      symlinkTarget,
    };
  }
  return {
    type,
    hash: null,
    size: type === "absent" ? null : stat.size,
    mtimeMs: type === "absent" ? null : stat.mtimeMs,
    symlinkTarget: null,
  };
}

/** Content-free, deterministic full-tree witness for controlled test roots. */
export function snapshotFilesystemTree(rootDir: string): ReadonlyArray<FilesystemTreeEntry> {
  const entries: FilesystemTreeEntry[] = [];
  const visit = (dir: string, relativeDir: string) => {
    for (const name of readdirSync(dir).toSorted()) {
      const fullPath = path.join(dir, name);
      const relativePath = relativeDir === "" ? name : `${relativeDir}/${name}`;
      const entry = observeUserPiEntry(fullPath, false);
      entries.push({
        path: relativePath,
        type: entry.type,
        symlinkTarget: entry.symlinkTarget,
        size: entry.size,
        hash: entry.hash,
      });
      if (entry.type === "directory") visit(fullPath, relativePath);
    }
  };
  const root = observeUserPiEntry(rootDir, false);
  if (root.type !== "directory") {
    throw new Error(`Isolation snapshot root '${rootDir}' is not a directory.`);
  }
  visit(rootDir, "");
  return entries;
}

/** lstat/realpath inventory used to prove that isolated resources do not alias. */
export function observeIsolationPaths(
  paths: Readonly<Record<string, string>>,
): Readonly<Record<string, IsolationPathObservation>> {
  return Object.fromEntries(
      Object.entries(paths).map(([name, fullPath]) => {
        const entry = observeUserPiEntry(fullPath);
        const canonicalPath =
          entry.type === "absent"
            ? path.join(fs.realpathSync(path.dirname(fullPath)), path.basename(fullPath))
            : fs.realpathSync(fullPath);
        return [
          name,
          {
            path: fullPath,
            realpath: canonicalPath,
            exists: entry.type !== "absent",
            type: entry.type,
            symlinkTarget: entry.symlinkTarget,
          },
      ];
    }),
  );
}

/** Separate bounded witness for the writable agent dir and volatile model cache. */
export function snapshotPiAgentRuntime(agentDir: string): PiAgentRuntimeSnapshot {
  const absent = (): UserPiHomePathSnapshot => ({
    exists: false,
    type: "absent",
    hash: null,
    size: null,
  });
  const observe = (name: string): UserPiEntry => observeUserPiEntry(path.join(agentDir, name));
  const auth = observe("auth.json");
  const models = observe("models.json");
  const settings = observe("settings.json");
  const modelsStore = observe("models-store.json");
  if (modelsStore.type !== "absent" && modelsStore.type !== "regular") {
    throw new Error(`Pi agent models-store.json must be absent or regular: '${agentDir}'.`);
  }
  return {
    authJson: auth.type === "absent" ? absent() : toUserPiPathSnapshot(auth),
    modelsJson: models.type === "absent" ? absent() : toUserPiPathSnapshot(models),
    settingsJson: settings.type === "absent" ? absent() : toUserPiPathSnapshot(settings),
    modelsStore: {
      ...(modelsStore.type === "absent" ? absent() : toUserPiPathSnapshot(modelsStore)),
      mtimeMs: modelsStore.mtimeMs,
    },
  };
}

function toUserPiPathSnapshot(entry: UserPiEntry): UserPiHomePathSnapshot {
  return {
    exists: entry.type !== "absent",
    type: entry.type,
    hash: entry.hash,
    size: entry.size,
  };
}

function snapshotUserPiResources(piHome: string): ReadonlyArray<UserPiHomeResourceSnapshot> {
  const resources: UserPiHomeResourceSnapshot[] = [];
  const visit = (fullDir: string) => {
    let names: string[];
    try {
      names = readdirSync(fullDir).toSorted();
    } catch (cause) {
      throw new Error(
        `Unable to enumerate user Pi resource directory '${fullDir}': ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
    for (const name of names) {
      const fullPath = path.join(fullDir, name);
      const entry = observeUserPiEntry(fullPath, false);
      const relativePath = userPiRelative(piHome, fullPath);
      resources.push({
        path: relativePath,
        ...toUserPiPathSnapshot(entry),
        symlinkTarget: entry.symlinkTarget,
      });
      if (entry.type === "directory") visit(fullPath);
    }
  };
  for (const resourceRoot of USER_PI_RESOURCE_ROOTS) {
    const fullRoot = path.join(piHome, resourceRoot);
    const rootEntry = observeUserPiEntry(fullRoot);
    if (rootEntry.type === "directory") visit(fullRoot);
    else if (rootEntry.type !== "absent") {
      throw new Error(`User Pi resource root '${resourceRoot}' is not a directory.`);
    }
  }
  return resources;
}

function snapshotUserPiHomeState(): UserPiHomeSnapshot {
  const piHome = path.join(os.homedir(), ".pi");
  const absentPath = (): UserPiHomePathSnapshot => ({
    exists: false,
    type: "absent",
    hash: null,
    size: null,
  });
  if (!existsSync(piHome)) {
    return {
      digest: "absent",
      sensitive: { authJson: absentPath(), modelsJson: absentPath(), settingsJson: absentPath() },
      resources: [],
      modelsStore: { ...absentPath(), mtimeMs: null },
    };
  }

  const strictHash = crypto.createHash("sha256");
  const walk = (dir: string) => {
    const relativeDir = userPiRelative(piHome, dir);
    if (relativeDir === "agent/sessions" || relativeDir.startsWith("agent/sessions/")) return;
    let names: string[];
    try {
      names = readdirSync(dir).toSorted();
    } catch (cause) {
      throw new Error(
        `Unable to enumerate user Pi home directory '${dir}': ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
    for (const name of names) {
      const fullPath = path.join(dir, name);
      const relativePath = userPiRelative(piHome, fullPath);
      if (relativePath === USER_PI_MODELS_STORE) continue;
      const entry = observeUserPiEntry(fullPath, false);
      strictHash.update(`${entry.type}:${relativePath}:${entry.size ?? "-"}:`);
      if (entry.symlinkTarget !== null) strictHash.update(`target:${entry.symlinkTarget}:`);
      if (entry.hash !== null) strictHash.update(`hash:${entry.hash}:`);
      if (entry.type === "directory") walk(fullPath);
    }
  };
  walk(piHome);

  const sensitive = Object.fromEntries(
    Object.entries(USER_PI_SENSITIVE_FILES).map(([name, relativePath]) => {
      const entry = observeUserPiEntry(path.join(piHome, relativePath));
      return [name, toUserPiPathSnapshot(entry)];
    }),
  ) as UserPiHomeSnapshot["sensitive"];
  const modelsStoreEntry = observeUserPiEntry(path.join(piHome, USER_PI_MODELS_STORE));
  if (modelsStoreEntry.type !== "absent" && modelsStoreEntry.type !== "regular") {
    throw new Error("User Pi models-store.json must be absent or a regular file.");
  }
  return {
    digest: strictHash.digest("hex"),
    sensitive,
    resources: snapshotUserPiResources(piHome),
    modelsStore: {
      ...toUserPiPathSnapshot(modelsStoreEntry),
      mtimeMs: modelsStoreEntry.mtimeMs,
    },
  };
}

export interface RealPiProvenanceResult {
  readonly isVerified: boolean;
  readonly packageVersion: string;
  readonly packageName: string;
  readonly pinnedCommit: string;
  /** Snapshot of the user's ~/.pi tree for before/after isolation proofs. */
  readonly snapshotUserPiHome: () => UserPiHomeSnapshot;
}

export function verifyRealPiExtensionProvenance(): RealPiProvenanceResult {
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
    readFileSync(path.join(dir, "agent/extensions/pi-subagents/package.json"), "utf8"),
  );
  if (pkg.name !== manifest.packageName || pkg.version !== manifest.packageVersion) {
    throw new Error(
      `Provenance assertion failed: package identity mismatch (${pkg.name}@${pkg.version}).`,
    );
  }
  for (const [relPath, expectedHash] of Object.entries(manifest.hashes)) {
    if (computeLocalSha256(path.join(dir, relPath)) !== expectedHash) {
      throw new Error(`Provenance assertion failed: SHA-256 mismatch for '${relPath}'.`);
    }
  }
  return {
    isVerified: true,
    packageVersion: pkg.version,
    packageName: pkg.name,
    pinnedCommit: headCommit,
    snapshotUserPiHome: snapshotUserPiHomeState,
  };
}

// ─── Deterministic loopback model endpoint (owner-approved fixture seam) ─────
//
// Only the model endpoint is a fixture. Models:
//   - "agent-driver": a session whose request carries the extension "Agent"
//     tool gets a scripted Agent tool call on every turn (the session
//     executes it and sends back the tool result); any session WITHOUT the
//     Agent tool (subagent children never inherit it) gets plain text.
//   - "agent-driver-background": identical parent-driver shape except it
//     delegates exactly once per user turn, requests background execution,
//     and never re-delegates on the same-turn tool result.
//   - "agent-driver-restart": delegates exactly once for one isolated restart
//     harness, then always returns text. This avoids treating Pi's
//     post-tool context representation as a fresh user turn.
//   - "echo-teardown-manual": operator-only child model that makes one real
//     call to Pi's registered custom bash tool with a configured command.
//   - "echo": immediate plain text ("ACK").
//   - "echo-slow": "echo" with a per-request delay (slow child legs).
export const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
export const DETERMINISTIC_FAST_MODEL_ID = "echo";
export const DETERMINISTIC_SLOW_MODEL_ID = "echo-slow";
export const DETERMINISTIC_DRIVER_MODEL_ID = "agent-driver";
export const DETERMINISTIC_BATCH_DRIVER_MODEL_ID = "agent-driver-background";
export const DETERMINISTIC_RESTART_DRIVER_MODEL_ID = "agent-driver-restart";
export const DETERMINISTIC_MANUAL_TEARDOWN_CHILD_MODEL = "echo-teardown-manual";
const DETERMINISTIC_SLOW_DELAY_MS = 4_000;

export interface LoopbackModelRequestLogEntry {
  readonly model: string;
  readonly hasAgentTool: boolean;
  readonly hasBashTool: boolean;
  readonly hasUserTurnAfterTool: boolean;
  readonly latestUserStartsWithDelegate: boolean;
  readonly delegated: boolean;
}

export interface LoopbackModelServer {
  readonly baseUrl: string;
  readonly requestCount: () => number;
  readonly requests: () => ReadonlyArray<LoopbackModelRequestLogEntry>;
  /** Number of deterministic slow-model responses held before their first byte. */
  readonly pendingSlowResponseCount: () => number;
  /** Releases every currently held deterministic slow-model response exactly once. */
  readonly releaseSlowResponses: () => void;
  readonly setManualTeardownCommand: (command: string) => void;
  readonly close: () => Promise<void>;
}

export function createDeterministicModelServer(
  options: {
    readonly slowDelayMs?: number;
    readonly holdSlowModelResponses?: boolean;
  } = {},
): Promise<LoopbackModelServer> {
  const log: LoopbackModelRequestLogEntry[] = [];
  const pendingSlowResponses = new Set<() => void>();
  let holdSlowResponses = options.holdSlowModelResponses === true;
  let delegatedToolCallCount = 0;
  let restartDriverDelegated = false;
  let manualBashDispatched = false;
  let manualTeardownCommand: string | undefined;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body: any = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      const requestedModel = typeof body?.model === "string" ? body.model : "";
      const tools: ReadonlyArray<ModelTool> = Array.isArray(body?.tools) ? body.tools : [];
      const hasAgentTool = tools.some((tool) => modelToolName(tool) === "Agent");
      const hasBashTool = tools.some((tool) => modelToolName(tool) === "bash");
      const messages: ReadonlyArray<{ role?: string; content?: unknown }> = Array.isArray(
        body?.messages,
      )
        ? body.messages
        : [];
      // Delegate exactly once per conversation: only the request that has
      // not yet seen a tool result (no role:"tool" message) issues the
      // Agent call; the follow-up turn (with the tool result) answers with
      // plain text so the parent turn completes instead of looping.
      const alreadyDelegated = messages.some((message) => message?.role === "tool");
      const lastUserIndex = (() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "user") return index;
        }
        return -1;
      })();
      const lastToolIndex = (() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "tool") return index;
        }
        return -1;
      })();
      const latestUserText = (() => {
        const message = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
        if (typeof message?.content === "string") return message.content;
        if (Array.isArray(message?.content)) {
          return message.content
            .map((entry) =>
              typeof entry === "object" &&
              entry !== null &&
              "text" in entry &&
              typeof (entry as { text?: unknown }).text === "string"
                ? (entry as { text: string }).text
                : "",
            )
            .join(" ");
        }
        return "";
      })();
      const shouldDelegateOncePerConversation =
        requestedModel === DETERMINISTIC_DRIVER_MODEL_ID && hasAgentTool && !alreadyDelegated;
      const hasUserTurnAfterTool = lastUserIndex > lastToolIndex;
      const latestUserStartsWithDelegate = latestUserText.startsWith("Delegate");
      const shouldDelegateOncePerUserTurn =
        requestedModel === DETERMINISTIC_BATCH_DRIVER_MODEL_ID &&
        hasAgentTool &&
        hasUserTurnAfterTool;
      const shouldDelegateOnceForRestart =
        requestedModel === DETERMINISTIC_RESTART_DRIVER_MODEL_ID &&
        hasAgentTool &&
        !restartDriverDelegated;
      const shouldRunManualBash =
        requestedModel === DETERMINISTIC_MANUAL_TEARDOWN_CHILD_MODEL &&
        hasBashTool &&
        !manualBashDispatched &&
        manualTeardownCommand !== undefined;
      const shouldDelegate =
        shouldDelegateOncePerConversation ||
        shouldDelegateOncePerUserTurn ||
        shouldDelegateOnceForRestart;
      if (shouldDelegateOnceForRestart) {
        restartDriverDelegated = true;
      }
      if (shouldRunManualBash) {
        manualBashDispatched = true;
      }
      log.push({
        model: requestedModel,
        hasAgentTool,
        hasBashTool,
        hasUserTurnAfterTool,
        latestUserStartsWithDelegate,
        delegated: shouldDelegate,
      });
      // Real-model latency for a delegating parent turn: the projection
      // must record the running turn (turn.started → session.set) before
      // the Agent tool call executes, exactly like a real slow model. A
      // zero-latency driver would race the projection pipeline.
      const driverDelayMs = 2_000;
      const slowChildDelayMs =
        options.slowDelayMs !== undefined && !hasAgentTool ? options.slowDelayMs : 0;
      const delayMs =
        requestedModel === DETERMINISTIC_SLOW_MODEL_ID
          ? (options.slowDelayMs ?? DETERMINISTIC_SLOW_DELAY_MS)
          : shouldDelegate
            ? driverDelayMs
            : slowChildDelayMs;

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
        if (shouldRunManualBash) {
          res.write(
            chunkEvent(
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_synara_manual_owned_bash",
                    type: "function",
                    function: {
                      name: "bash",
                      arguments: JSON.stringify({ command: manualTeardownCommand }),
                    },
                  },
                ],
              },
              null,
            ),
          );
          res.write(chunkEvent({}, "tool_calls"));
        } else if (shouldDelegate) {
          delegatedToolCallCount += 1;
          const toolArgs = JSON.stringify({
            task: "Run the integrated real-Pi acceptance delegation",
            context: "Deterministic loopback acceptance harness; the child must simply complete.",
            link_references: "None",
            expected_outcome: "A completed child run with a text result.",
            subagent_type: "researcher",
            ...(requestedModel === DETERMINISTIC_BATCH_DRIVER_MODEL_ID ||
            requestedModel === DETERMINISTIC_RESTART_DRIVER_MODEL_ID
              ? { run_in_background: true }
              : {}),
          });
          res.write(
            chunkEvent(
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call_synara_local_agent_${delegatedToolCallCount}`,
                    type: "function",
                    function: { name: "Agent", arguments: toolArgs },
                  },
                ],
              },
              null,
            ),
          );
          res.write(chunkEvent({}, "tool_calls"));
        } else {
          res.write(chunkEvent({ role: "assistant", content: "ACK" }, null));
          res.write(chunkEvent({}, "stop"));
        }
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
      if (holdSlowResponses && requestedModel === DETERMINISTIC_SLOW_MODEL_ID) {
        const release = () => {
          if (!pendingSlowResponses.delete(release)) return;
          respond();
        };
        pendingSlowResponses.add(release);
      } else if (delayMs > 0) {
        setTimeout(respond, delayMs);
      } else {
        respond();
      }
    });
  });
  return new Promise<LoopbackModelServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requestCount: () => log.length,
        requests: () => [...log],
        pendingSlowResponseCount: () => pendingSlowResponses.size,
        releaseSlowResponses: () => {
          holdSlowResponses = false;
          for (const release of [...pendingSlowResponses]) release();
        },
        setManualTeardownCommand: (command) => {
          manualTeardownCommand = command;
          manualBashDispatched = false;
        },
        close: () =>
          new Promise<void>((done) => {
            holdSlowResponses = false;
            for (const release of [...pendingSlowResponses]) release();
            server.close(() => done());
          }),
      });
    });
  });
}

// ─── Agent-dir fixtures (local copies of the pinned-suite pattern) ───────────

function createRealExtensionDirectory(tempAgentDir: string): string {
  const versionedDir = resolveVersionedExtensionDir();
  const extensionsDir = path.join(tempAgentDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  const piSubagentsLink = path.join(extensionsDir, "pi-subagents");
  if (!existsSync(piSubagentsLink)) {
    symlinkSync(versionedDir, piSubagentsLink, "dir");
  }
  const sharedDir = path.join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    const sharedLink = path.join(extensionsDir, "shared");
    if (!existsSync(sharedLink)) {
      symlinkSync(sharedDir, sharedLink, "dir");
    }
  }
  return tempAgentDir;
}

function writeModelsAndAuth(tempAgentDir: string, baseUrl: string): void {
  writeFileSync(
    path.join(tempAgentDir, "auth.json"),
    JSON.stringify({
      [DETERMINISTIC_MODEL_PROVIDER_ID]: { type: "api_key", key: "synara-local-test-key" },
    }),
  );
  writeFileSync(
    path.join(tempAgentDir, "models.json"),
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
            {
              id: DETERMINISTIC_DRIVER_MODEL_ID,
              name: "Local Echo (agent driver)",
              reasoning: false,
              input: ["text"],
              contextWindow: 100_000,
              maxTokens: 1_000,
            },
            {
              id: DETERMINISTIC_BATCH_DRIVER_MODEL_ID,
              name: "Local Echo (background agent driver)",
              reasoning: false,
              input: ["text"],
              contextWindow: 100_000,
              maxTokens: 1_000,
            },
            {
              id: DETERMINISTIC_RESTART_DRIVER_MODEL_ID,
              name: "Local Echo (single restart agent driver)",
              reasoning: false,
              input: ["text"],
              contextWindow: 100_000,
              maxTokens: 1_000,
            },
            {
              id: DETERMINISTIC_MANUAL_TEARDOWN_CHILD_MODEL,
              name: "Local Echo (manual owned teardown child)",
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

export function writeAgentDirWithModels(tempAgentDir: string, baseUrl: string): void {
  mkdirSync(tempAgentDir, { recursive: true });
  createRealExtensionDirectory(tempAgentDir);
  writeModelsAndAuth(tempAgentDir, baseUrl);
}

/**
 * A copy of the pinned real extension with only required managed capabilities
 * removed. Its Agent tool remains real, but negotiation must retain legacy
 * semantics (`capability_mismatch`) and cannot create a managed execution.
 */
export function writeStrippedCapabilityAgentDir(tempAgentDir: string, baseUrl: string): void {
  const versionedDir = resolveVersionedExtensionDir();
  const targetExtensionDir = path.join(tempAgentDir, "extensions", "pi-subagents");
  mkdirSync(targetExtensionDir, { recursive: true });
  for (const entry of readdirSync(versionedDir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "test" ||
      entry === ".gitignore"
    ) {
      continue;
    }
    const from = path.join(versionedDir, entry);
    const to = path.join(targetExtensionDir, entry);
    if (lstatSync(from).isSymbolicLink()) {
      symlinkSync(fs.readlinkSync(from), to, "dir");
    } else if (lstatSync(from).isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }
  symlinkSync(
    path.join(versionedDir, "node_modules"),
    path.join(targetExtensionDir, "node_modules"),
    "dir",
  );

  const indexPath = path.join(targetExtensionDir, "src", "index.ts");
  const source = readFileSync(indexPath, "utf8");
  const capabilityLiteral = `  const PI_SUBAGENT_CAPABILITIES = [
    "managed-spawn",
    "abort-propagation",
    "bounded-foreground-attachment",
    "coalesced-progress",
    "durable-cancellation",
    "journal-terminal-lifecycle",
    "completion-delivery-ownership",
    // Decision 0033 point 3: the opaque, identity-fenced child-owner teardown
    // endpoint \`teardownOwnedProcesses\` is advertised and gated by this
    // capability. Additive: an old host simply never requires it.
    "child-bash-process-ownership",
    "execution-identity-routing-v1",
  ] as const;`;
  // This real-provider negative removes only canonical identity routing. All
  // other managed capabilities remain present so the failure is attributable
  // to the required Ticket 02 capability rather than an unrelated profile.
  const legacyReplacement = `  const PI_SUBAGENT_CAPABILITIES = [
    "managed-spawn",
    "abort-propagation",
    "bounded-foreground-attachment",
    "coalesced-progress",
    "durable-cancellation",
    "journal-terminal-lifecycle",
    "completion-delivery-ownership",
    // Decision 0033 point 3: the opaque, identity-fenced child-owner teardown
    // endpoint \`teardownOwnedProcesses\` is advertised and gated by this
    // capability. Additive: an old host simply never requires it.
    "child-bash-process-ownership",
  ] as const;`;
  if (!source.includes(capabilityLiteral)) {
    throw new Error(
      "Stripped-capability fixture failed: the pinned PI_SUBAGENT_CAPABILITIES literal changed.",
    );
  }
  writeFileSync(indexPath, source.replace(capabilityLiteral, legacyReplacement));

  const sharedDir = path.join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, path.join(tempAgentDir, "extensions", "shared"), "dir");
  }
  const systemDir = path.join(versionedDir, "..", "..", "system");
  if (existsSync(systemDir)) {
    symlinkSync(systemDir, path.join(tempAgentDir, "system"), "dir");
  }
  writeModelsAndAuth(tempAgentDir, baseUrl);
}

/** An extension-free agent directory used only to prove bridge-absent fallback. */
export function writeBridgeAbsentAgentDir(tempAgentDir: string, baseUrl: string): void {
  mkdirSync(tempAgentDir, { recursive: true });
  writeModelsAndAuth(tempAgentDir, baseUrl);
}

// ─── WebSocket RPC client (public boundary; mirrors the web transport) ───────

export interface RealPiWsClient {
  readonly dispatchCommand: (command: ClientOrchestrationCommand) => Promise<DispatchResult>;
  readonly getSnapshot: () => Promise<OrchestrationReadModel>;
  readonly getThreadDetailSnapshot: (
    threadId: string,
  ) => Promise<OrchestrationThreadDetailSnapshot | null>;
  /** Replays durable thread events through the public WebSocket boundary. */
  readonly replayEvents: (
    input: OrchestrationReplayEventsInput,
  ) => Promise<OrchestrationReplayEventsResult>;
  readonly readPiSubagentResult: (input: {
    readonly executionId: string;
  }) => Promise<PiSubagentResultReadResult>;
  readonly listCommands: (input: ProviderListCommandsInput) => Promise<ProviderListCommandsResult>;
  readonly listSkills: (input: ProviderListSkillsInput) => Promise<ProviderListSkillsResult>;
  readonly getServerSettings: () => Promise<ServerSettingsView>;
  readonly updateServerSettings: (patch: unknown) => Promise<ServerSettingsView>;
  readonly close: () => Promise<void>;
}

const HARNESS_CLIENT_BUILD = "synara-realpi-acceptance-harness/1";
const makeRpcClient = RpcClient.make(WsFeatureRpcGroup.merge(WsDeviceRpcGroup));

function negotiateUrl(port: number): string {
  const url = new URL(`http://127.0.0.1:${port}${WS_NEGOTIATE_HTTP_PATH}`);
  url.searchParams.set(WS_NEGOTIATE_QUERY.clientBuild, HARNESS_CLIENT_BUILD);
  url.searchParams.set(WS_NEGOTIATE_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  url.searchParams.set(WS_NEGOTIATE_QUERY.minRevision, String(WS_PROTOCOL_MIN_REVISION));
  url.searchParams.set(WS_NEGOTIATE_QUERY.maxRevision, String(WS_PROTOCOL_MAX_REVISION));
  for (const capability of WS_SERVER_CAPABILITIES) {
    url.searchParams.append(WS_NEGOTIATE_QUERY.requiredCapability, capability);
  }
  return url.toString();
}

async function negotiate(port: number): Promise<WsBootstrapNegotiateResult> {
  const response = await fetch(negotiateUrl(port), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Synara WS negotiation failed with HTTP ${response.status}: ${await response
        .text()
        .catch(() => "")}`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(WsBootstrapNegotiateResult)(body);
  if (decoded._tag === "None") {
    throw new Error("Synara WS negotiation returned an unreadable result.");
  }
  return decoded.value;
}

function featureSocketUrl(port: number, compatibility: WsBootstrapNegotiateResult): string {
  const url = new URL(`ws://127.0.0.1:${port}${WS_FEATURE_PATH}`);
  url.searchParams.set(WS_COMPATIBILITY_QUERY.clientBuild, HARNESS_CLIENT_BUILD);
  url.searchParams.set(WS_COMPATIBILITY_QUERY.protocolEpoch, String(compatibility.protocolEpoch));
  url.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolRevision,
    String(compatibility.negotiatedRevision),
  );
  url.searchParams.set(WS_COMPATIBILITY_QUERY.serverInstanceId, compatibility.serverInstanceId);
  return url.toString();
}

/** A genuinely new WS client: fresh negotiation, socket, and RPC runtime. */
export async function connectRealPiWsClient(port: number): Promise<RealPiWsClient> {
  const compatibility = await negotiate(port);
  const socketLayer = Socket.layerWebSocket(featureSocketUrl(port, compatibility)).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  const protocolLayer = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  );
  const runtime = ManagedRuntime.make(protocolLayer);
  const scope = runtime.runSync(Scope.make());
  const client = await runtime.runPromise(Scope.provide(scope)(makeRpcClient));
  const call = <A>(method: string, input: unknown): Promise<A> =>
    runtime.runPromise(
      (client as unknown as Record<string, (value: unknown) => Effect.Effect<A>>)[method]!(input),
    );
  return {
    dispatchCommand: (command) => call(ORCHESTRATION_WS_METHODS.dispatchCommand, command),
    getSnapshot: () => call(ORCHESTRATION_WS_METHODS.getSnapshot, {}),
    getThreadDetailSnapshot: (threadId) =>
      call(ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot, { threadId }),
    replayEvents: (input) => call(ORCHESTRATION_WS_METHODS.replayEvents, input),
    readPiSubagentResult: (input) => call(ORCHESTRATION_WS_METHODS.readPiSubagentResult, input),
    listCommands: (input) => call(WS_METHODS.providerListCommands, input),
    listSkills: (input) => call(WS_METHODS.providerListSkills, input),
    getServerSettings: () => call("server.getSettings", {}),
    updateServerSettings: (patch) => call("server.updateSettings", patch),
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    },
  };
}

// ─── The harness ─────────────────────────────────────────────────────────────

export class RealPiHarnessError extends Error {
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(`${message} (operation: ${operation})`);
    this.name = "RealPiHarnessError";
  }
}

/**
 * Ticket 02 — desktop managed harness configuration (WP-A).
 *
 * When present, the harness composes the PRODUCTION desktop managed Pi
 * bootstrap: ServerConfig switches to `mode: "desktop"`, `makePiAdapterLive`
 * receives the release-derived artifact locator env (`SYNARA_PI_SUBAGENT_ARTIFACT_DIR`)
 * plus the explicit user agent dir, and the deterministic loopback
 * auth/models are written INTO that isolated user dir. The `providers.pi.agentDir`
 * setting still routes at the (web-shaped) parent dir — a decoy the desktop
 * managed path must ignore for extension discovery (extensions load only
 * from `<verified artifact>/agent`). Absent, every web-mode behavior is
 * preserved exactly.
 *
 * Local web/dev locator leg: `mode: "web"` composes the SAME production
 * managed binding (gate locator env + explicit user agent dir + controlled
 * `<artifact>/agent` extension discovery) while the ServerConfig stays in
 * web mode — the exact production composition a dev-runner-launched web
 * server with a prepared verified cache locator runs. The shared gate
 * verifies any non-blank locator identically for both modes
 * (`piSubagentDesktopArtifactGate.ts` decision order), so the only
 * difference from the default leg is the ServerConfig `mode` value.
 */
export interface RealPiWsHarnessDesktopManagedConfig {
  /** Verified-release artifact root (the gate locator value). */
  readonly artifactDir: string;
  /** Isolated user Pi agent dir supplying auth.json/models.json. */
  readonly userAgentDir: string;
  /**
   * Server runtime mode this harness leg reports. Defaults to `"desktop"`
   * (the Ticket-02 desktop leg, unchanged). `"web"` keeps the local
   * web/dev composition: the managed binding is still composed and the
   * locator is still verified, exactly like a `dev`/`dev:server` launch
   * with a prepared managed artifact locator.
   */
  readonly mode?: "desktop" | "web";
  /**
   * Ticket 04 WP1 / Decision 0016: a COMPLETE desktop-derived backend
   * environment (the exact object the production resolver
   * `applyPiSubagentArtifactBackendEnv` returns for a packaged launch).
   * When present it is passed VERBATIM to the production
   * `piSubagentDesktopArtifactGateEnv` seam — never reconstructed,
   * filtered, or re-derived — so removal of inherited `PI_CODING_AGENT_DIR`,
   * replacement of a poisoned inherited locator, and preservation of
   * legitimate user runtime configuration are all exercised together by
   * the composition consuming it. Its locator must match `artifactDir`
   * (the harness fails setup otherwise, since two disagreeing sources would
   * silently reintroduce the one-key reconstruction this seam removes).
   *
   * When absent, the Ticket-02 legacy form is preserved exactly: the gate
   * env is reconstructed from `artifactDir` alone.
   */
  readonly backendEnv?: NodeJS.ProcessEnv;
}

export interface MakeRealPiWsHarnessOptions {
  readonly foregroundWaitMs?: number;
  readonly progressRateHz?: number;
  readonly heartbeatIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly completionBatchWindowMs?: number;
  /** Reuse an existing durable root for restart acceptance flows. */
  readonly rootDir?: string;
  /** Reuse an explicit SQLite file under the durable root. */
  readonly dbPath?: string;
  /** Reuse an existing loopback model server across a server restart. */
  readonly modelServer?: LoopbackModelServer;
  /** Optional slow-model delay used to hold a real child live for race setup. */
  readonly deterministicSlowDelayMs?: number;
  /** Hold deterministic slow-model responses until the caller explicitly releases them. */
  readonly holdDeterministicSlowResponses?: boolean;
  /** Ticket 02: compose the desktop managed bootstrap (web mode when absent). */
  readonly desktopManaged?: RealPiWsHarnessDesktopManagedConfig;
}

export interface ObservedSubagentAdmission {
  readonly threadId: ThreadId;
  readonly command: PiSubagentSpawnCommand;
  readonly result: PiSubagentSpawnResult;
}

export interface RealPiWsHarness {
  readonly port: number;
  readonly origin: string;
  readonly rootDir: string;
  readonly homeDir: string;
  readonly workspaceDir: string;
  readonly dbPath: string;
  readonly parentAgentDir: string;
  readonly childAgentDir: string;
  /** Isolated PI_HOME (the extension's PREFERENCES.md root). */
  readonly piHomeDir: string;
  /**
   * Runtime mode of the LIVE composed ServerConfig (read back from the
   * harness ManagedRuntime, not from the options).
   */
  readonly serverMode: "web" | "desktop";
  /**
   * Ticket 02: controlled desktop managed locations, present ONLY when the
   * harness was composed with `desktopManaged` (undefined in plain web
   * mode). `mode` reports the ServerConfig runtime mode this leg composed
   * (`"desktop"` by default; `"web"` for the local web/dev locator leg).
   */
  readonly desktop?: {
    readonly artifactDir: string;
    readonly userAgentDir: string;
    /** Controlled agent dir the gate derives from the artifact (`<root>/agent`). */
    readonly managedAgentDir: string;
    /** Release-controlled extension dir (the only extension source). */
    readonly managedExtensionDir: string;
    /** Server runtime mode this leg reported (default "desktop"). */
    readonly mode: "desktop" | "web";
  };
  /** Writes an isolated subagent model preference (invalidates the loader's mtime cache). */
  readonly writeSubagentModelPreference: (selector: string) => void;
  readonly foregroundWaitMs: number;
  readonly modelServer: LoopbackModelServer;
  readonly client: RealPiWsClient;
  readonly engine: OrchestrationEngineShape;
  /** Reattaches this live harness's owned execution-card lifecycle listener. */
  readonly restoreCardLifecycleListener: () => void;
  /** Live production repository instance for coordinator-driven acceptance legs. */
  readonly repository: PiSubagentExecutionRepositoryShape;
  /** Connects a genuinely NEW WebSocket RPC client to the same server. */
  readonly connectNewClient: () => Promise<RealPiWsClient>;
  /** Negotiated subagent capability events observed by the real adapter. */
  readonly observedCapabilities: () => ReadonlyMap<string, PiSubagentNegotiatedCapability>;
  /** Live parent session objects captured by the adapter capability hook. */
  readonly observedSessions: () => ReadonlyMap<string, unknown>;
  /** Managed admission events observed by the real adapter. */
  readonly observedAdmissions: () => ReadonlyArray<ObservedSubagentAdmission>;
  /** PIDs spawned by the actual Pi supervisor-backed custom bash operations. */
  readonly observedSupervisorSpawnPids: () => ReadonlyArray<number>;
  /** Stable operation diagnostics recorded by harness setup/dispose. */
  readonly lastOperationDiagnostics: () => ReadonlyArray<string>;
  /** True when the harness restored every process-env variable it set. */
  readonly envWasRestored: () => boolean;
  readonly userHome: () => Promise<string>;
  readonly rootExists: () => () => boolean;
  /** Polls thread detail until it resolves and returns it (public RPC). */
  readonly waitForThreadDetail: (
    threadId: string,
    timeoutMs?: number,
  ) => Promise<OrchestrationThreadDetailSnapshot>;
  /** Polls thread detail until a card matching the predicate exists. */
  readonly waitForExecutionCard: (
    threadId: string,
    predicate: (card: PiSubagentExecutionCard) => boolean,
    timeoutMs?: number,
  ) => Promise<PiSubagentExecutionCard>;
  /** Live bridge active-child snapshot for the observed session of one thread. */
  readonly bridgeActiveExecutions: (threadId: string) => ReadonlyArray<PiSubagentActiveChild>;
  /** Live managed bridge for an owned parent session, if still available. */
  readonly bridgeForThread: (threadId: string) => PiSubagentExtensionBridge | undefined;
  /** Actual provider-turn abort for the owned Pi session's live runtime. */
  readonly abortPiTurn: (threadId: string) => Promise<void>;
  /** Actual provider-session stop for the owned Pi session. */
  readonly stopPiSession: (threadId: string) => Promise<"stopped">;
  /** Durable-truth reads through the LIVE repository the server writes. */
  readonly durable: {
    readonly getById: (executionId: string) => Promise<
      | {
          readonly executionId: string;
          readonly attemptId: string;
          readonly generation: number;
          readonly observedState: string;
          readonly desiredState: string;
          readonly cancellationScope: string;
          readonly diagnosticCode: string | null;
        }
      | undefined
    >;
    readonly listJournalEvents: (executionId: string) => Promise<
      ReadonlyArray<{
        readonly sequence: number;
        readonly state: string;
        readonly attemptId: string | undefined;
        readonly generation: number;
        readonly occurredAt: string;
        readonly diagnosticCode: string | null;
        readonly metadata: Record<string, unknown> | null;
      }>
    >;
    readonly getObservation: (executionId: string) => Promise<
      | {
          readonly lastProgressJson: string | null;
          readonly lastProgressAt: string | null;
          readonly lastHeartbeatAt: string | null;
          readonly leaseExpiresAt: string | null;
          readonly droppedProgressCount: number;
        }
      | undefined
    >;
    /** Records the durable band-60 wall-time trigger for the current identity. */
    readonly recordWallTimeExpiry: (executionId: string, wallTimeMs: number) => Promise<void>;
    /**
     * Manual-only lower seam: records the current identity's Ticket-15
     * handoff so the production Ticket-16 coordinator can be exercised
     * against an actual owned bash process. It is not watchdog evidence.
     */
    readonly recordManualTeardownHandoff: (executionId: string) => Promise<void>;
    readonly getCompletionOutboxEntry: (executionId: string) => Promise<
      | {
          readonly outboxId: string;
          readonly executionId: string;
          readonly deliveryState: string;
          readonly dispatchBatchId: string | null;
        }
      | undefined
    >;
    readonly getCompletionDispatchBatch: (batchId: string) => Promise<
      | {
          readonly batchId: string;
          readonly parentCommandId: string;
          readonly parentMessageId: string;
          readonly membership: readonly string[];
          readonly state: string;
          readonly acceptedReceiptSequence: number | null;
        }
      | undefined
    >;
  };
  /** Idempotent, retry-safe teardown of every owned resource. */
  readonly dispose: (options?: {
    readonly preserveRootDir?: boolean;
    readonly preserveModelServer?: boolean;
  }) => Promise<void>;
}

function runGit(cwd: string, args: ReadonlyArray<string>): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function initializeGitWorkspace(cwd: string): void {
  const isRepository = (() => {
    try {
      return (
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        }).trim() === "true"
      );
    } catch {
      return false;
    }
  })();
  if (isRepository) return;
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "v1\n");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DEFAULT_WAIT_TIMEOUT_MS = 45_000;
const WAIT_POLL_MS = 20;

export async function makeRealPiWsHarness(
  options: MakeRealPiWsHarnessOptions = {},
): Promise<RealPiWsHarness> {
  const diagnostics: string[] = [];
  const foregroundWaitMs = options.foregroundWaitMs ?? 10_000;
  const progressRateHz = options.progressRateHz ?? 5;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
  const leaseDurationMs = options.leaseDurationMs ?? 15_000;
  const completionBatchWindowMs = options.completionBatchWindowMs;
  const ownsRootDir = true;
  const ownsModelServer = options.modelServer === undefined;

  // Ticket 04 WP1 / Decision 0016: when the caller supplies a COMPLETE
  // desktop-derived backend env, the production gate must consume that exact
  // object — the seam exists precisely so acceptance can carry the resolver's
  // whole derived environment (scrubbed `PI_CODING_AGENT_DIR`, release-derived
  // locator, preserved user runtime configuration) instead of a reconstructed
  // one-key env. Validate only that the two sources agree on the locator; a
  // mismatch means the caller derived its env from a different artifact than
  // the one it asked the harness to expose, which must fail closed at setup.
  const desktopManagedBackendEnvLocator =
    options.desktopManaged?.backendEnv?.[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
  if (
    options.desktopManaged?.backendEnv !== undefined &&
    desktopManagedBackendEnvLocator !== options.desktopManaged.artifactDir
  ) {
    throw new RealPiHarnessError(
      `desktopManaged.backendEnv locator '${
        desktopManagedBackendEnvLocator ?? "<absent>"
      }' does not match artifactDir '${options.desktopManaged.artifactDir}'.`,
      "desktopManagedBackendEnvLocatorMismatch",
    );
  }

  // ── Owned temp root: state, home, workspace, agent dirs, model endpoint ──
  const rootDir = options.rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "synara-realpi-t17-"));
  const homeDir = path.join(rootDir, "home");
  const workspaceDir = path.join(rootDir, "workspace");
  const parentAgentDir = path.join(rootDir, "parent-agent");
  const childAgentDir = path.join(rootDir, "child-agent");
  const piHomeDir = path.join(rootDir, "pi-home");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(piHomeDir, { recursive: true });
  initializeGitWorkspace(workspaceDir);

  const modelServer =
    options.modelServer ??
    (await createDeterministicModelServer({
      slowDelayMs: options.deterministicSlowDelayMs,
      holdSlowModelResponses: options.holdDeterministicSlowResponses,
    }));
  writeAgentDirWithModels(parentAgentDir, modelServer.baseUrl);
  writeAgentDirWithModels(childAgentDir, modelServer.baseUrl);

  // Ticket 02 desktop managed harness leg (WP-A): the explicit user agent
  // dir receives the SAME deterministic loopback auth/models the web-mode
  // dirs get — schema-valid isolated user runtime configuration. The caller
  // may supply a not-yet-existing directory (the harness owns creating the
  // isolated tree). The artifact itself is NEVER staged here (the caller
  // supplies a verified release artifact root; staging is a separate
  // verified pipeline).
  if (options.desktopManaged !== undefined) {
    mkdirSync(options.desktopManaged.userAgentDir, { recursive: true });
    writeModelsAndAuth(options.desktopManaged.userAgentDir, modelServer.baseUrl);
  }

  // Isolated child-agent resolution: the extension spawns children against
  // the SDK default agent dir, so point PI_CODING_AGENT_DIR at the owned
  // child dir for the harness lifetime (restored on dispose). PI_HOME is
  // isolated the same way so the extension's PREFERENCES.md reads never
  // touch the user's real ~/.pi.
  const previousEnv = {
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PI_HOME: process.env.PI_HOME,
  };
  let envRestored = false;
  process.env.PI_CODING_AGENT_DIR = childAgentDir;
  process.env.PI_HOME = piHomeDir;
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    envRestored = true;
  };

  const failSetup = async (cause: unknown, operation: string): Promise<never> => {
    diagnostics.push(operation);
    restoreEnv();
    if (ownsModelServer) {
      await modelServer.close().catch(() => undefined);
    }
    if (ownsRootDir) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
    throw cause instanceof RealPiHarnessError
      ? cause
      : new RealPiHarnessError(cause instanceof Error ? cause.message : String(cause), operation);
  };

  let derivedDbPath: string;
  try {
    const derivedPaths = await Effect.runPromise(
      deriveServerPaths(rootDir, undefined).pipe(Effect.provide(NodeServices.layer)),
    );
    derivedDbPath = options.dbPath ?? derivedPaths.dbPath;
  } catch (cause) {
    return await failSetup(cause, "deriveServerPaths");
  }

  const configLayer = Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const defaultPaths = yield* deriveServerPaths(rootDir, undefined);
      const paths = {
        ...defaultPaths,
        dbPath: options.dbPath ?? defaultPaths.dbPath,
      };
      yield* Effect.sync(() => preparePrivateServerPaths(paths));
      const { chatWorkspaceRoot, studioWorkspaceRoot } = yield* resolveCanonicalWorkspaceRoots({
        homeDir,
      });
      return {
        // Ticket 02: ONLY the mode field changes on the desktop leg — the
        // desktop managed Pi bootstrap keys off `mode === "desktop"`; every
        // other production path (paths, roots, flags, subagent timers) is
        // identical between the two harness legs. The local web/dev locator
        // leg (desktopManaged.mode === "web") keeps web mode: the shared gate
        // verifies the non-blank locator identically for both modes, so the
        // same managed binding is composed on a web-mode server.
        mode:
          options.desktopManaged === undefined || options.desktopManaged.mode === "web"
            ? ("web" as const)
            : ("desktop" as const),
        port: 0,
        host: "127.0.0.1",
        cwd: workspaceDir,
        homeDir,
        chatWorkspaceRoot,
        studioWorkspaceRoot,
        baseDir: rootDir,
        ...paths,
        staticDir: undefined,
        devUrl: undefined,
        publicUrl: undefined,
        allowInsecureRemote: false,
        noBrowser: true,
        authToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logProviderEvents: false,
        logWebSocketEvents: false,
        piSubagentForegroundWaitMs: foregroundWaitMs,
        piSubagentProgressRateHz: progressRateHz,
        piSubagentHeartbeatIntervalMs: heartbeatIntervalMs,
        piSubagentLeaseDurationMs: leaseDurationMs,
        ...(completionBatchWindowMs !== undefined
          ? { piSubagentCompletionBatchWindowMs: completionBatchWindowMs }
          : {}),
      } satisfies ServerConfigShape;
    }),
  );

  // ── Production graph with the REAL observed Pi adapter ────────────────────
  // Mirrors `makeServerProviderLayer` (runtimeLayer.ts) with the differences
  // the approved seams allow: `makePiAdapterLive` gets the observation
  // options (behavior-neutral), and the registry resolves only "pi" (the
  // approved WsOrchestrationHarness substitution pattern — no other provider
  // binary is required or exercised).
  const observedCapabilityEvents = new Map<string, PiSubagentNegotiatedCapability>();
  const observedSessionObjects = new Map<string, unknown>();
  const admissionEvents: ObservedSubagentAdmission[] = [];
  const supervisorSpawnPids: number[] = [];

  const completionDispatchBridge = makePiSubagentParentEffectDispatcher();
  const executionCardBridge = makePiSubagentExecutionCardBridge();

  const sqliteLayer = makeSqlitePersistenceLive(derivedDbPath).pipe(
    Layer.provide(NodeServices.layer),
  );
  const piSubagentRepositoryLayer = PiSubagentExecutionRepositoryLive;

  // Late-bound MCP session authority for the PiAdapter's Decision-21
  // admission re-validation. The adapter layer is composed independently of
  // the runtime-services graph (exactly like `makeServerProviderLayer`), so
  // its optional service lookups need explicit wiring (same reason the
  // ticket-24 integrated suite provides `Layer.succeed(McpSessionAuthority,
  // …)`). This forwarder delegates every call to the LIVE production
  // registry instance the WS boundary binds commands into (captured after
  // the runtime builds below), so validation semantics are unchanged — no
  // second registry, no bypassed revocation/expiry checks.
  let liveAuthority: McpSessionAuthorityShape | undefined;
  const authorityForwarder: McpSessionAuthorityShape = new Proxy({} as McpSessionAuthorityShape, {
    get(_target, property) {
      if (liveAuthority === undefined) {
        throw new Error(
          "RealPiWsHarness MCP session authority forwarder used before the runtime bound the live registry.",
        );
      }
      const value = (liveAuthority as unknown as Record<string | symbol, unknown>)[property];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(liveAuthority)
        : value;
    },
  });

  const piAdapterLayer = makePiAdapterLive({
    completionDispatchBridge,
    // Ticket 02 desktop managed harness leg (WP-A) / Ticket 04 WP1 seam:
    // production desktop gate env plus the explicit user agent dir. When the
    // caller supplied a COMPLETE desktop-derived backend env (Decision 0016),
    // that exact object is passed VERBATIM — never reconstructed or filtered;
    // the gate reads the release-derived locator out of it like production
    // reads it out of the spawned backend's `process.env`. Without it, the
    // Ticket-02 legacy one-key form is preserved. Both are undefined in web
    // mode — `makePiAdapterLive` then observes the real process env and the
    // SDK's own agent-dir resolution, exactly like the web-mode composition
    // always did.
    ...(options.desktopManaged === undefined
      ? {}
      : {
          piSubagentDesktopArtifactGateEnv: options.desktopManaged.backendEnv ?? {
            SYNARA_PI_SUBAGENT_ARTIFACT_DIR: options.desktopManaged.artifactDir,
          },
          piSubagentDesktopUserAgentDir: options.desktopManaged.userAgentDir,
        }),
    spawnProcess: (command, args, options) => {
      const child = spawn(command, [...args], options);
      if (child.pid !== undefined) {
        supervisorSpawnPids.push(child.pid);
      }
      return child;
    },
    onSubagentCapability: (event) => {
      observedCapabilityEvents.set(String(event.threadId), event.capability);
      observedSessionObjects.set(String(event.threadId), event.session);
    },
    onSubagentAdmission: (event) => {
      admissionEvents.push(event);
    },
  }).pipe(
    Layer.provide(AgentGatewayCredentialsWithSecretsLive),
    Layer.provide(piSubagentRepositoryLayer),
    // Production snapshot query for managed admission (the same layer
    // reference `OrchestrationLayerLive` merges, so one build memoizes it to
    // the same instance the reactor uses — same wiring the ticket-24
    // integrated suite applies to the adapter).
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(Layer.succeed(McpSessionAuthority, authorityForwarder)),
  );
  const adapterRegistryLayer = Layer.effect(
    ProviderAdapterRegistry,
    Effect.gen(function* () {
      const piAdapter = yield* PiAdapter;
      return {
        getByProvider: (provider: string) =>
          provider === "pi"
            ? Effect.succeed(piAdapter)
            : Effect.fail(new ProviderUnsupportedError({ provider: provider as never })),
        listProviders: () => Effect.succeed(["pi" as const]),
      } as typeof ProviderAdapterRegistry.Service;
    }),
  ).pipe(Layer.provide(piAdapterLayer));
  const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntimeRepositoryLive),
  );
  const providerLayer = Layer.mergeAll(
    makeDurableProviderServiceLive().pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provide(providerSessionDirectoryLayer),
      Layer.provide(ProviderRuntimeEventRepositoryLive),
    ),
    ProviderDiscoveryServiceLive.pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provideMerge(ServerSettingsLive),
      Layer.provideMerge(ServerSecretStoreLive),
    ),
    adapterRegistryLayer,
    providerSessionDirectoryLayer,
  );

  const runtimeLayer = Layer.mergeAll(
    makeServerRuntimeServicesLayer().pipe(Layer.provideMerge(providerLayer)),
    OpenLive,
  ).pipe(
    Layer.provideMerge(configLayer),
    Layer.provideMerge(sqliteLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(runtimeLayer);

  let engine: OrchestrationEngineShape;
  let reactor: OrchestrationReactor["Service"];
  let runtimeStartup: ServerRuntimeStartup["Service"];
  let authority: McpSessionAuthorityShape;
  try {
    engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    reactor = await runtime.runPromise(Effect.service(OrchestrationReactor));
    runtimeStartup = await runtime.runPromise(Effect.service(ServerRuntimeStartup));
    authority = await runtime.runPromise(Effect.service(McpSessionAuthority));
    liveAuthority = authority;
  } catch (cause) {
    return await failSetup(cause, "loadRuntimeServices");
  }

  // Decision 0016 / Ticket 11 production wiring: bind the late-bound
  // dispatchers to the live engine and attach the repository lifecycle
  // listener exactly like `main.ts` startup.
  completionDispatchBridge.bindOnce(engine);
  executionCardBridge.bindOnce(engine);
  const repository = await runtime.runPromise(Effect.service(PiSubagentExecutionRepository));
  setPiSubagentExecutionLifecycleListener((notification) => {
    executionCardBridge.handleNotification(repository, notification);
  });

  // The LIVE composed ServerConfig's runtime mode (resolved from the same
  // ManagedRuntime every production service above consumed — not a mirror
  // of the harness options). Acceptance legs assert the mode the real
  // composition actually ran under (e.g. web-mode locator legs prove the
  // managed binding engaged while ServerConfig stayed in web mode).
  const serverMode = (
    await runtime.runPromise(Effect.service(ServerConfig))
  ).mode;

  // Start the real orchestration reactor and mark command-ready, mirroring
  // the WsOrchestrationHarness startup sequence.
  const reactorScope = await runtime.runPromise(Scope.make("sequential"));
  try {
    await runtime.runPromise(reactor.start.pipe(Scope.provide(reactorScope)));
    await runtime.runPromise(Effect.sleep(10));
    await runtime.runPromise(
      Effect.tryPromise(() =>
        recoverSynaraMcpPendingOperations({
          seams: {
            now: () => new Date(),
            getReadModel: () => Effect.runPromise(engine.getReadModel()),
            dispatch: (command) => Effect.runPromise(engine.dispatch(command)),
          },
        }).then((result) => {
          if (result.kind === "blocked") {
            throw new Error(result.detail);
          }
          return result.operations;
        }),
      ),
    );
    await runtime.runPromise(runtimeStartup.markCommandReady);
  } catch (cause) {
    return await failSetup(cause, "startOrchestrationReactor");
  }

  // Mount the production WS route layer over a bounded loopback HTTP server.
  const serverScope = await runtime.runPromise(Scope.make("sequential"));
  const boundAddress: { current: { _tag: string; port: number } | null } = { current: null };
  try {
    await runtime.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const httpServer = yield* makeBoundedNodeHttpServer(() => http.createServer(), {
            port: 0,
            host: "127.0.0.1",
          });
          const address = httpServer.address;
          boundAddress.current =
            address && address._tag === "TcpAddress"
              ? { _tag: address._tag, port: address.port }
              : null;
          const httpApp = yield* HttpRouter.toHttpEffect(websocketRpcRouteLayer);
          yield* httpServer.serve(httpApp);
        }),
        serverScope,
      ),
    );
  } catch (cause) {
    return await failSetup(cause, "httpServerMount");
  }
  const address = boundAddress.current;
  if (address === null || !Number.isInteger(address.port)) {
    return await failSetup("Server did not bind a TCP port.", "httpServerListen");
  }
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;

  // Wire the parent agent dir through the PUBLIC settings seam so the
  // production `ensureSessionForThreadCore` provider-options resolution
  // (`providerStartOptionsFromServerSettings`) picks it up for every Pi
  // session start — no server internals, no env mutation. On the desktop
  // managed leg this same setting is intentionally a DECOY: the desktop
  // bootstrap ignores `agentDir` for extension discovery (extensions load
  // only from the verified artifact's controlled `agent` subtree), so a
  // desktop harness can prove the decoy never reaches the loader.
  let client: RealPiWsClient;
  try {
    client = await connectRealPiWsClient(port);
    await client.updateServerSettings({ providers: { pi: { agentDir: parentAgentDir } } });
    const settings = await client.getServerSettings();
    if (settings.providers.pi?.agentDir !== parentAgentDir) {
      throw new Error(
        `server.updateSettings did not persist the isolated Pi agent dir (got '${settings.providers.pi?.agentDir}').`,
      );
    }
  } catch (cause) {
    return await failSetup(cause, "connectWsClient");
  }

  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* recoverCompletionOutbox({ repository });
        yield* Effect.tryPromise(() =>
          runPiSubagentProcessTeardown({
            repository,
            dispatchOwnedTeardown: () => Promise.resolve(undefined),
          }),
        );
        yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          liveOwnerProbes: [],
        });
      }),
    );
  } catch (cause) {
    return await failSetup(cause, "startupPiRecovery");
  }

  const waitForThreadDetail: RealPiWsHarness["waitForThreadDetail"] = async (
    threadId,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const detail = await client.getThreadDetailSnapshot(threadId);
      if (detail !== null) return detail;
      if (Date.now() >= deadline) {
        throw new RealPiHarnessError(`thread detail '${threadId}'`, "waitForThreadDetail");
      }
      await sleep(WAIT_POLL_MS);
    }
  };

  const waitForExecutionCard: RealPiWsHarness["waitForExecutionCard"] = async (
    threadId,
    predicate,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const detail = await client.getThreadDetailSnapshot(threadId);
      const cards = detail?.thread.piSubagentExecutions ?? [];
      const match = cards.find(predicate);
      if (match) return match;
      if (Date.now() >= deadline) {
        throw new RealPiHarnessError(
          `execution card for thread '${threadId}'`,
          "waitForExecutionCard",
        );
      }
      await sleep(WAIT_POLL_MS);
    }
  };

  // Durable truth through the live repository instance (same connection the
  // server writes; no second sqlite open against the lifecycle-locked file).
  const durable: RealPiWsHarness["durable"] = {
    getById: (executionId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const aggregate = yield* repo.getById(executionId);
          if (Option.isNone(aggregate)) return undefined;
          const value = aggregate.value as any;
          return {
            executionId: value.executionId as string,
            attemptId: value.attemptId as string,
            generation: value.generation as number,
            observedState: value.observedState as string,
            desiredState: value.desiredState as string,
            cancellationScope: value.cancellationScope as string,
            diagnosticCode: (value.diagnosticCode ?? null) as string | null,
          };
        }),
      ),
    listJournalEvents: (executionId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const events = yield* repo.listJournalEvents(executionId);
          return (events as any[]).map((event) => ({
            sequence: event.sequence as number,
            state: event.state as string,
            attemptId: event.attemptId as string | undefined,
            generation: event.generation as number,
            occurredAt: event.occurredAt as string,
            diagnosticCode: (event.diagnosticCode ?? null) as string | null,
            metadata: (event.metadata ?? null) as Record<string, unknown> | null,
          }));
        }),
      ),
    getObservation: (executionId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const observation = yield* repo.getObservation(executionId);
          if (Option.isNone(observation)) return undefined;
          const value = observation.value as any;
          return {
            lastProgressJson: (value.lastProgressJson ?? null) as string | null,
            lastProgressAt: (value.lastProgressAt ?? null) as string | null,
            lastHeartbeatAt: (value.lastHeartbeatAt ?? null) as string | null,
            leaseExpiresAt: (value.leaseExpiresAt ?? null) as string | null,
            droppedProgressCount: value.droppedProgressCount as number,
          };
        }),
      ),
    recordWallTimeExpiry: (executionId, wallTimeMs) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const aggregate = yield* repo.getById(executionId);
          if (Option.isNone(aggregate)) {
            throw new Error(`Execution '${executionId}' is unavailable for wall-time expiry.`);
          }
          yield* repo.recordWallTimeExpiryEvent({
            executionId,
            attemptId: aggregate.value.attemptId,
            generation: aggregate.value.generation,
            occurredAt: new Date().toISOString(),
            wallTimeMs,
          });
        }),
      ),
    recordManualTeardownHandoff: (executionId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const aggregate = yield* repo.getById(executionId);
          if (Option.isNone(aggregate)) {
            throw new Error(
              `Execution '${executionId}' is unavailable for manual teardown handoff.`,
            );
          }
          const value = aggregate.value;
          yield* repo.recordWatchdogStageEvent({
            executionId,
            attemptId: value.attemptId,
            generation: value.generation,
            sequence: 74,
            state: value.observedState,
            occurredAt: new Date().toISOString(),
            diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
            diagnosticMessage:
              "Manual owned-teardown setup after separately proven watchdog handoff.",
            metadata: { phase: "manual_owned_teardown_setup" },
          });
        }),
      ),
    getCompletionOutboxEntry: (executionId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const aggregate = yield* repo.getById(executionId);
          if (Option.isNone(aggregate)) return undefined;
          const row = aggregate.value as any;
          const outboxId = `outbox_${row.executionId}_${row.attemptId}_gen${row.generation}`;
          const outbox = yield* repo.getCompletionOutboxEntry(outboxId);
          if (Option.isNone(outbox)) return undefined;
          const value = outbox.value as any;
          return {
            outboxId: value.outboxId as string,
            executionId: value.executionId as string,
            deliveryState: value.deliveryState as string,
            dispatchBatchId: (value.dispatchBatchId ?? null) as string | null,
          };
        }),
      ),
    getCompletionDispatchBatch: (batchId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;
          const batch = yield* repo.getCompletionDispatchBatch(batchId);
          if (Option.isNone(batch)) return undefined;
          const value = batch.value as any;
          return {
            batchId: value.batchId as string,
            parentCommandId: value.parentCommandId as string,
            parentMessageId: value.parentMessageId as string,
            membership: value.membership as readonly string[],
            state: value.state as string,
            acceptedReceiptSequence: (value.acceptedReceiptSequence ?? null) as number | null,
          };
        }),
      ),
  };

  let disposed = false;
  const dispose: RealPiWsHarness["dispose"] = async (disposeOptions) => {
    if (disposed) return;
    const failures: unknown[] = [];
    // Release the module-scope lifecycle listener this harness installed.
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
    } catch (cause) {
      failures.push(cause);
    }
    await client.close().catch((cause) => failures.push(cause));
    await runtime
      .runPromise(Scope.close(serverScope, Exit.void))
      .catch((cause) => failures.push(cause));
    await runtime
      .runPromise(Scope.close(reactorScope, Exit.void))
      .catch((cause) => failures.push(cause));
    await runtime.dispose().catch((cause) => failures.push(cause));
    if (!(disposeOptions?.preserveModelServer ?? false) && ownsModelServer) {
      await modelServer.close().catch((cause) => failures.push(cause));
    }
    restoreEnv();
    try {
      if (!(disposeOptions?.preserveRootDir ?? false) && ownsRootDir) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    } catch (cause) {
      failures.push(cause);
    }
    if (failures.length > 0) {
      diagnostics.push("dispose");
      throw new RealPiHarnessError(
        failures
          .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
          .join("; "),
        "dispose",
      );
    }
    disposed = true;
  };

  return {
    port,
    origin,
    rootDir,
    homeDir,
    workspaceDir,
    dbPath: derivedDbPath,
    parentAgentDir,
    childAgentDir,
    piHomeDir,
    serverMode,
    ...(options.desktopManaged === undefined
      ? {}
      : {
          desktop: {
            artifactDir: options.desktopManaged.artifactDir,
            userAgentDir: options.desktopManaged.userAgentDir,
            managedAgentDir: path.join(
              options.desktopManaged.artifactDir,
              PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT,
            ),
            managedExtensionDir: piSubagentDesktopManagedExtensionDir(
              path.join(
                options.desktopManaged.artifactDir,
                PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT,
              ),
            ),
            mode: options.desktopManaged.mode ?? "desktop",
          },
        }),
    writeSubagentModelPreference: (selector) => {
      writeFileSync(
        path.join(piHomeDir, "PREFERENCES.md"),
        `---\nmodels:\n  subagent: ${selector}\n---\n`,
      );
    },
    foregroundWaitMs,
    modelServer,
    client,
    engine,
    restoreCardLifecycleListener: () => {
      setPiSubagentExecutionLifecycleListener((notification) => {
        executionCardBridge.handleNotification(repository, notification);
      });
    },
    repository,
    connectNewClient: () => connectRealPiWsClient(port),
    observedCapabilities: () => new Map(observedCapabilityEvents),
    observedSessions: () => new Map(observedSessionObjects),
    observedAdmissions: () => [...admissionEvents],
    observedSupervisorSpawnPids: () => [...supervisorSpawnPids],
    lastOperationDiagnostics: () => [...diagnostics],
    envWasRestored: () => envRestored,
    userHome: async () => os.homedir(),
    rootExists: () => () => fs.existsSync(rootDir),
    waitForThreadDetail,
    waitForExecutionCard,
    bridgeActiveExecutions: (threadId) => {
      const session = observedSessionObjects.get(threadId);
      const bridge = extractPiSubagentBridge(session);
      return typeof bridge?.getActiveExecutions === "function" ? bridge.getActiveExecutions() : [];
    },
    bridgeForThread: (threadId) => extractPiSubagentBridge(observedSessionObjects.get(threadId)),
    abortPiTurn: async (threadId) => {
      const session = observedSessionObjects.get(threadId) as
        | { abort?: () => Promise<void> }
        | undefined;
      if (typeof session?.abort !== "function") {
        throw new RealPiHarnessError(
          `No live Pi session with abort() is bound to thread '${threadId}'.`,
          "abortPiTurn",
        );
      }
      await session.abort();
    },
    stopPiSession: async (threadId) => {
      // Resolve the adapter through the runtime's OWN ProviderAdapterRegistry
      // — the same registry the production WS graph serves provider traffic
      // through. `PiAdapter` itself is intentionally consumed by the registry
      // layer (not part of the runtime context), and capturing the adapter in
      // that layer's effect can observe an instance the composition evaluated
      // separately from the one holding the live session.
      const adapter = await runtime
        .runPromise(
          Effect.flatMap(Effect.service(ProviderAdapterRegistry), (registry) =>
            registry.getByProvider("pi"),
          ),
        )
        .catch((cause) => {
          throw new RealPiHarnessError(
            `No 'pi' adapter could be resolved from the harness runtime's ProviderAdapterRegistry (${
              cause instanceof Error ? cause.message : String(cause)
            }).`,
            "stopPiSession",
          );
        });
      // `PiAdapterShape.stopSession` returns an Effect (Layers/PiAdapter.ts);
      // awaiting the value alone would never execute it. Drive it through
      // the harness's own `ManagedRuntime` so the real adapter stop path
      // (session disposal + runtime events) actually runs.
      await runtime.runPromise(adapter.stopSession(ThreadId.makeUnsafe(threadId)));
      return "stopped" as const;
    },
    durable,
    dispose,
  } satisfies RealPiWsHarness;
}
