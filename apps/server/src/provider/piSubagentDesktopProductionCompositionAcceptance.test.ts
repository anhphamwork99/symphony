/**
 * Ticket 04 WP2 — packaged desktop production-composition acceptance.
 *
 * This wall-clock suite carries one complete environment object across the
 * production release boundary:
 *
 * release resources -> buildBackendChildSpawnEnv -> desktop artifact gate
 * -> real Pi runtime/handshake -> public WS + durable execution-card truth.
 *
 * The deterministic loopback model is the only fixture inside the runtime
 * composition. The artifact, verifier, Pi adapter, Agent tool, lifecycle,
 * persistence, WebSocket route, and execution-card projection are real.
 */
import crypto from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Json, JsonObject } from "effect/Schema";

import { CommandId, MessageId, ProjectId, ThreadId } from "@synara/contracts";

import {
  BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV,
  BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE,
  BACKEND_CHILD_SERVER_ENTRY_ENV,
  buildBackendChildSpawnEnv,
  SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV,
} from "@synara/shared/piSubagentDesktopArtifactEnvironment";
import { stagePiSubagentArtifactIntoDesktopResources } from "../../../../scripts/lib/piSubagentArtifactStaging.ts";
import { verifyPiSubagentArtifact } from "./piSubagentArtifactVerifier.ts";
import {
  DETERMINISTIC_DRIVER_MODEL_ID,
  DETERMINISTIC_SLOW_MODEL_ID,
  makeRealPiWsHarness,
  verifyRealPiExtensionProvenance,
  type RealPiWsHarness,
} from "./piSubagentRealPiAcceptanceHelpers.ts";
import {
  PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES,
  PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
} from "./piSubagentManagedRuntimeBinding.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const ALFIE_REPO_DIR = process.env.ALFIE_REPO_DIR ?? "";
const FOREGROUND_BUDGET_MS = 300;
const CANARY_MARKER = "t04-wp2-isolated-old-global-extension";
const POISONED_ARTIFACT_VALUE = "/poison/inherited/pi-subagent-artifact";
const HOSTILE_MODEL_ID = "t04-wp2-hostile-unavailable-model";
const LEGIT_AUTH_SENTINEL = "t04-wp2-auth-preserved";
const LEGIT_MODELS_SENTINEL = "t04-wp2-models-preserved";
const TURN_PROMPT = "Delegate this packaged desktop acceptance task to one researcher subagent.";
const createdRoots: string[] = [];

interface TreeSnapshot {
  readonly bytes: number;
  readonly digest: string;
}

interface ReleaseLayout {
  readonly rootDir: string;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly desktopResourcesDir: string;
  readonly artifactDir: string;
}

interface LedgerCounts {
  readonly executions: number;
  readonly journal: number;
  readonly outbox: number;
  readonly batches: number;
}

interface FailureExpectation {
  readonly label: string;
  readonly category: string;
  readonly mutate?: (artifactDir: string) => void;
  readonly model?: string;
  readonly exactRuntimeDetail?: boolean;
  readonly forbidden?: ReadonlyArray<string>;
}

let officialRelease: ReleaseLayout | undefined;
let officialArtifactSnapshot: TreeSnapshot | undefined;
let realUserPiHomeDigestBefore = "";

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

function requireAlfieRepoDir(): string {
  if (ALFIE_REPO_DIR.trim() === "") {
    throw new Error("ALFIE_REPO_DIR is required for Ticket 04 WP2 acceptance.");
  }
  const repoDir = resolve(ALFIE_REPO_DIR);
  if (!existsSync(repoDir) || !existsSync(join(repoDir, ".git"))) {
    throw new Error(`ALFIE_REPO_DIR is not a Git repository: '${repoDir}'.`);
  }
  return repoDir;
}

function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readdirStable(rootDir: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).toSorted()) {
      const fullPath = join(dir, name);
      const stat = lstatSync(fullPath);
      if (stat.isDirectory()) visit(fullPath);
      else files.push(fullPath);
    }
  };
  visit(rootDir);
  return files;
}

function snapshotTree(rootDir: string): TreeSnapshot {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for (const fullPath of readdirStable(rootDir)) {
    const content = readFileSync(fullPath);
    hash.update(fullPath.slice(rootDir.length + 1));
    hash.update("\0");
    hash.update(content);
    bytes += content.byteLength;
  }
  return { bytes, digest: hash.digest("hex") };
}

function createReleaseLayout(label: string): ReleaseLayout {
  const rootDir = makeTempRoot(`t04-wp2-${label}-`);
  const appPath = join(rootDir, "app.asar");
  const resourcesPath = join(rootDir, "resources");
  const desktopResourcesDir = join(appPath, "apps", "desktop", "resources");
  const artifactDir = join(desktopResourcesDir, "pi-subagents-artifact");
  mkdirSync(desktopResourcesDir, { recursive: true });
  mkdirSync(resourcesPath, { recursive: true });
  return { rootDir, appPath, resourcesPath, desktopResourcesDir, artifactDir };
}

function copyOfficialRelease(label: string): ReleaseLayout {
  if (officialRelease === undefined) {
    throw new Error("The official packaged artifact was not staged successfully.");
  }
  const layout = createReleaseLayout(label);
  cpSync(officialRelease.artifactDir, layout.artifactDir, { recursive: true });
  return layout;
}

function installOldGlobalCanary(userAgentDir: string): {
  readonly dir: string;
  readonly snapshot: TreeSnapshot;
} {
  const canaryDir = join(userAgentDir, "extensions", "pi-subagents");
  mkdirSync(join(canaryDir, "src"), { recursive: true });
  writeFileSync(
    join(canaryDir, "package.json"),
    `${JSON.stringify(
      { name: "@alfie/pi-subagents", version: "0.10.0-canary", description: CANARY_MARKER },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(canaryDir, "src", "index.ts"),
    `throw new Error("${CANARY_MARKER}: must never load");\n`,
    "utf8",
  );
  return { dir: canaryDir, snapshot: snapshotTree(canaryDir) };
}

function rewriteParentDecoy(parentAgentDir: string): string {
  const decoyDir = join(parentAgentDir, "extensions", "pi-subagents");
  rmSync(join(parentAgentDir, "extensions"), { recursive: true, force: true });
  mkdirSync(join(decoyDir, "src"), { recursive: true });
  writeFileSync(
    join(decoyDir, "package.json"),
    `${JSON.stringify(
      { name: "@alfie/pi-subagents", version: "0.10.0-decoy", description: CANARY_MARKER },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(decoyDir, "src", "index.ts"),
    `throw new Error("${CANARY_MARKER}: parent decoy must never load");\n`,
    "utf8",
  );
  return decoyDir;
}

function deriveBackendEnv(layout: ReleaseLayout, poisonedAgentDir: string): {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly backendEnv: NodeJS.ProcessEnv;
} {
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: POISONED_ARTIFACT_VALUE,
    PI_CODING_AGENT_DIR: poisonedAgentDir,
    T04_WP2_AUTH_SENTINEL: LEGIT_AUTH_SENTINEL,
    T04_WP2_MODELS_SENTINEL: LEGIT_MODELS_SENTINEL,
  };
  const before = { ...baseEnv };
  const backendEnv = buildBackendChildSpawnEnv({
    baseEnv,
    isPackaged: true,
    appPath: layout.appPath,
    resourcesPath: layout.resourcesPath,
    exists: existsSync,
    shellPathHydrated: true,
    serverEntry: join(layout.rootDir, "apps", "server", "dist", "main.js"),
  });
  expect(baseEnv).toEqual(before);
  return { baseEnv, backendEnv };
}

function assertCompleteDerivedEnv(
  layout: ReleaseLayout,
  baseEnv: NodeJS.ProcessEnv,
  backendEnv: NodeJS.ProcessEnv,
): void {
  expect(backendEnv).not.toBe(baseEnv);
  expect(backendEnv[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(layout.artifactDir);
  expect(backendEnv[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).not.toBe(POISONED_ARTIFACT_VALUE);
  expect(backendEnv.PI_CODING_AGENT_DIR).toBeUndefined();
  expect(backendEnv.T04_WP2_AUTH_SENTINEL).toBe(LEGIT_AUTH_SENTINEL);
  expect(backendEnv.T04_WP2_MODELS_SENTINEL).toBe(LEGIT_MODELS_SENTINEL);
  expect(backendEnv[BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV]).toBe(
    BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE,
  );
  expect(backendEnv[BACKEND_CHILD_SERVER_ENTRY_ENV]).toBe(
    join(layout.rootDir, "apps", "server", "dist", "main.js"),
  );
}

function loadedAgentExtensionPath(harness: RealPiWsHarness, threadId: ThreadId): string {
  const session = harness.observedSessions().get(String(threadId)) as
    | {
        resourceLoader?: {
          getExtensions?: () => {
            readonly extensions?: ReadonlyArray<{
              readonly path?: string;
              readonly tools?: Map<string, unknown>;
            }>;
          };
        };
      }
    | undefined;
  const extensions = session?.resourceLoader?.getExtensions?.().extensions ?? [];
  const loaded = extensions.find(
    (candidate) =>
      typeof candidate.path === "string" &&
      candidate.tools instanceof Map &&
      candidate.tools.has("Agent"),
  );
  if (!loaded?.path) throw new Error(`No Agent-bearing extension loaded for '${threadId}'.`);
  return resolve(loaded.path);
}

function writeResearcherSlowPreference(piHomeDir: string): void {
  writeFileSync(
    join(piHomeDir, "PREFERENCES.md"),
    "---\nmodels:\n  subagent: synara-local-echo/echo-slow\n" +
      "  subagent/researcher: synara-local-echo/echo-slow\n---\n",
    "utf8",
  );
}

function readPiLedgerCounts(dbPath: string): LedgerCounts {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { readonly count: number })
        .count;
    return {
      executions: count("pi_subagent_executions"),
      journal: count("pi_subagent_lifecycle_journal"),
      outbox: count("pi_subagent_completion_outbox"),
      batches: count("pi_subagent_completion_dispatch_batches"),
    };
  } finally {
    db.close();
  }
}

async function waitFor<Defined>(
  read: () => Awaited<Defined> | undefined | Promise<Awaited<Defined> | undefined>,
  predicate: (value: Exclude<Defined, undefined>) => boolean,
  timeoutMs: number,
  description: string,
): Promise<Exclude<Defined, undefined>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await Promise.resolve(read()).catch(() => undefined);
    if (value !== undefined && predicate(value as Exclude<Defined, undefined>)) {
      return value as Exclude<Defined, undefined>;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

async function createThread(
  harness: RealPiWsHarness,
  suffix: string,
  model: string,
): Promise<ThreadId> {
  const projectId = ProjectId.makeUnsafe(`t04-wp2-project-${suffix}`);
  const threadId = ThreadId.makeUnsafe(`t04-wp2-thread-${suffix}`);
  const createdAt = new Date().toISOString();
  await harness.client.dispatchCommand({
    type: "project.create",
    commandId: CommandId.makeUnsafe(`cmd-t04-wp2-project-${suffix}`),
    projectId,
    title: `T04 WP2 Project ${suffix}`,
    workspaceRoot: harness.workspaceDir,
    createdAt,
  });
  await harness.client.dispatchCommand({
    type: "thread.create",
    commandId: CommandId.makeUnsafe(`cmd-t04-wp2-thread-${suffix}`),
    threadId,
    projectId,
    title: `T04 WP2 Thread ${suffix}`,
    modelSelection: { provider: "pi", model },
    interactionMode: "default",
    runtimeMode: "full-access",
    branch: null,
    worktreePath: harness.workspaceDir,
    createdAt,
  });
  return threadId;
}

async function startTurn(harness: RealPiWsHarness, threadId: ThreadId, suffix: string): Promise<void> {
  await harness.client.dispatchCommand({
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(`cmd-t04-wp2-turn-${suffix}`),
    threadId,
    message: {
      messageId: MessageId.makeUnsafe(`msg-t04-wp2-turn-${suffix}`),
      role: "user",
      text: TURN_PROMPT,
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: new Date().toISOString(),
  });
}

function isJsonObjectWithDetail(
  payload: Json | undefined,
): payload is JsonObject & { readonly detail: string } {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as JsonObject).detail === "string"
  );
}

async function waitForFailureDetail(harness: RealPiWsHarness, threadId: ThreadId): Promise<string> {
  return waitFor(
    async () => {
      const thread = (await harness.client.getThreadDetailSnapshot(String(threadId)))?.thread;
      const activity = thread?.activities.find(
        (candidate) => candidate.kind === "provider.turn.start.failed",
      );
      return isJsonObjectWithDetail(activity?.payload) ? activity.payload.detail : undefined;
    },
    (detail) => detail.length > 0,
    45_000,
    "bounded provider.turn.start.failed detail",
  );
}

function patchHandshakeArtifact(artifactDir: string, replacement: string): void {
  const relativeEntry = "agent/extensions/pi-subagents/src/index.ts";
  const entryPath = join(artifactDir, relativeEntry);
  const anchor = `      return {
        ok: true,
        protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
        extensionVersion: EXTENSION_VERSION,
        capabilities: availableCapabilities,
      };`;
  const source = readFileSync(entryPath, "utf8");
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one handshake anchor, found ${occurrences}.`);
  }
  writeFileSync(entryPath, source.replace(anchor, replacement), "utf8");

  const manifestPath = join(artifactDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    }>;
  };
  const bytes = readFileSync(entryPath);
  let updates = 0;
  const files = manifest.files.map((record) => {
    if (record.path !== relativeEntry) return record;
    updates += 1;
    return { ...record, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  if (updates !== 1) throw new Error(`Expected one manifest record, found ${updates}.`);
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, files }, null, 2)}\n`, "utf8");
}

function makeFailureRelease(expectation: FailureExpectation): ReleaseLayout {
  const layout = copyOfficialRelease(expectation.label);
  expectation.mutate?.(layout.artifactDir);
  return layout;
}

function assertRedactedDetail(
  detail: string,
  layout: ReleaseLayout,
  userAgentDir: string,
  extraForbidden: ReadonlyArray<string> = [],
): void {
  expect(detail.length).toBeLessThanOrEqual(1_024);
  assertNoSensitiveTokens(detail, layout, userAgentDir, extraForbidden);
}

function assertNoSensitiveTokens(
  detail: string,
  layout: ReleaseLayout,
  userAgentDir: string,
  extraForbidden: ReadonlyArray<string> = [],
): void {
  for (const forbidden of [
    layout.rootDir,
    layout.artifactDir,
    officialRelease?.artifactDir ?? "",
    userAgentDir,
    POISONED_ARTIFACT_VALUE,
    CANARY_MARKER,
    LEGIT_AUTH_SENTINEL,
    LEGIT_MODELS_SENTINEL,
    "auth.json",
    "models.json",
    "apiKey",
    "baseUrl",
    "synara-local-echo",
    "synara-local-test-key",
    TURN_PROMPT,
    "prompt",
    "cause",
    "sk-hostile",
    "/private/hostile",
    ...extraForbidden,
  ]) {
    if (forbidden.length > 0) expect(detail).not.toContain(forbidden);
  }
}

/**
 * Ticket 04 AC3 safe-diagnostics hardening: a bare `99` substring is NOT the
 * redaction contract — two-digit substrings collide with benign material
 * (e.g. an OS username embedded in a tmpdir path). The contract is that the
 * hostile negotiated protocol VERSION must not reach the operator surface in
 * any contextual form: prose ("protocol 99"), JSON field values, or
 * offered/supported version enumerations. These patterns pin that intent.
 */
const HOSTILE_PROTOCOL_VERSION_PATTERNS: readonly RegExp[] = [
  /protocol\s*version\s*[:=#]?\s*99\b/i,
  /protocolVersion["'\s:=]+99\b/i,
  /supportedProtocolVersions[^0-9]{0,64}\b99\b/i,
  /\bversion["'\s:=]+99\b/i,
  /\boffered\b[^0-9]{0,64}\b99\b/i,
  /\bsupported\b[^0-9]{0,64}\b99\b/i,
  /\b99\s*\/\s*[0-9]+\b/,
  /\b[0-9]+\s*\/\s*99\b/,
];

function assertNoHostileProtocolVersion(detail: string): void {
  for (const pattern of HOSTILE_PROTOCOL_VERSION_PATTERNS) {
    expect(
      detail,
      `detail must not match hostile protocol-version pattern ${String(pattern)}`,
    ).not.toMatch(pattern);
  }
}

async function runFailureLeg(expectation: FailureExpectation): Promise<void> {
  const layout = makeFailureRelease(expectation);
  const userAgentDir = join(layout.rootDir, "isolated-user-agent");
  const canary = installOldGlobalCanary(userAgentDir);
  const { baseEnv, backendEnv } = deriveBackendEnv(layout, userAgentDir);
  assertCompleteDerivedEnv(layout, baseEnv, backendEnv);

  const harness = await makeRealPiWsHarness({
    foregroundWaitMs: FOREGROUND_BUDGET_MS,
    progressRateHz: 10,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    completionBatchWindowMs: 5_000,
    desktopManaged: { artifactDir: layout.artifactDir, userAgentDir, backendEnv },
  });
  try {
    const decoyDir = rewriteParentDecoy(harness.parentAgentDir);
    const authBefore = readFileSync(join(userAgentDir, "auth.json"));
    const modelsBefore = readFileSync(join(userAgentDir, "models.json"));
    const fixtureBaseUrl = (
      JSON.parse(modelsBefore.toString("utf8")) as {
        readonly providers?: Readonly<Record<string, { readonly baseUrl?: string }>>;
      }
    ).providers?.["synara-local-echo"]?.baseUrl;
    const threadId = await createThread(
      harness,
      expectation.label,
      expectation.model ?? DETERMINISTIC_DRIVER_MODEL_ID,
    );
    await startTurn(harness, threadId, expectation.label);
    const detail = await waitForFailureDetail(harness, threadId);

    if (expectation.exactRuntimeDetail) {
      const prefix = "Error: Provider adapter request failed (pi) for session/start: ";
      const firstLine = detail.split("\n", 1)[0] ?? "";
      expect(firstLine.startsWith(prefix)).toBe(true);
      expect(firstLine.slice(prefix.length)).toBe(
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
      );
    } else {
      expect(detail).toContain(expectation.category);
    }
    const extraForbidden = [
      ...(expectation.forbidden ?? []),
      ...(fixtureBaseUrl === undefined ? [] : [fixtureBaseUrl]),
    ];
    assertRedactedDetail(detail, layout, userAgentDir, extraForbidden);
    assertNoHostileProtocolVersion(detail);

    const threadDetail = await harness.waitForThreadDetail(String(threadId));
    expect(threadDetail.thread.session).toMatchObject({
      providerName: "pi",
      status: "error",
      activeTurnId: null,
    });
    const sessionLastError = threadDetail.thread.session?.lastError ?? "";
    expect(sessionLastError.length).toBeGreaterThan(0);
    if (expectation.exactRuntimeDetail) {
      const prefix = "Error: Provider adapter request failed (pi) for session/start: ";
      const firstLine = sessionLastError.split("\n", 1)[0] ?? "";
      expect(firstLine.startsWith(prefix)).toBe(true);
      expect(firstLine.slice(prefix.length)).toBe(
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
      );
    } else {
      expect(sessionLastError).toContain(expectation.category);
    }
    assertNoSensitiveTokens(sessionLastError, layout, userAgentDir, extraForbidden);
    assertNoHostileProtocolVersion(sessionLastError);
    expect(threadDetail.thread.piSubagentExecutions).toHaveLength(0);
    expect(harness.observedSessions().size).toBe(0);
    expect(harness.observedCapabilities().size).toBe(0);
    expect(harness.observedAdmissions()).toHaveLength(0);
    expect(harness.observedSupervisorSpawnPids()).toHaveLength(0);
    expect(harness.modelServer.requestCount()).toBe(0);
    expect(snapshotTree(canary.dir)).toEqual(canary.snapshot);
    expect(resolve(decoyDir)).not.toBe(resolve(harness.desktop?.managedExtensionDir ?? ""));
    expect(readFileSync(join(userAgentDir, "auth.json"))).toEqual(authBefore);
    expect(readFileSync(join(userAgentDir, "models.json"))).toEqual(modelsBefore);
  } finally {
    const dbPath = harness.dbPath;
    await harness.dispose({ preserveRootDir: true });
    expect(harness.envWasRestored()).toBe(true);
    const ledger = readPiLedgerCounts(dbPath);
    rmSync(harness.rootDir, { recursive: true, force: true });
    expect(ledger).toEqual({
      executions: 0,
      journal: 0,
      outbox: 0,
      batches: 0,
    });
  }
}

beforeAll(async () => {
  const alfieRepoDir = requireAlfieRepoDir();
  const provenance = verifyRealPiExtensionProvenance();
  expect(provenance.isVerified).toBe(true);
  realUserPiHomeDigestBefore = provenance.snapshotUserPiHome().digest;

  const release = createReleaseLayout("official-release");
  const staged = stagePiSubagentArtifactIntoDesktopResources({
    repoRoot: REPO_ROOT,
    desktopResourcesDir: release.desktopResourcesDir,
    alfieRepoDir,
  });
  expect(resolve(staged.artifactDir)).toBe(resolve(release.artifactDir));
  const verified = await verifyPiSubagentArtifact(staged.artifactDir);
  expect(verified.valid).toBe(true);
  officialRelease = release;
  officialArtifactSnapshot = snapshotTree(staged.artifactDir);
}, 180_000);

afterAll(async () => {
  try {
    if (officialRelease !== undefined && officialArtifactSnapshot !== undefined) {
      const verified = await verifyPiSubagentArtifact(officialRelease.artifactDir);
      expect(verified.valid).toBe(true);
      expect(snapshotTree(officialRelease.artifactDir)).toEqual(officialArtifactSnapshot);
    }
    if (realUserPiHomeDigestBefore !== "") {
      expect(verifyRealPiExtensionProvenance().snapshotUserPiHome().digest).toBe(
        realUserPiHomeDigestBefore,
      );
    }
  } finally {
    for (const root of createdRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("Ticket 04 WP2 packaged desktop production composition", () => {
  it("AC1 + AC2: selects the official artifact through the complete resolver env, handshakes before exactly one admission, detaches within budget, stays live, then hydrates one fenced terminal card", async () => {
    if (officialRelease === undefined) throw new Error("Official release fixture is unavailable.");
    const layout = officialRelease;
    const userAgentDir = join(layout.rootDir, "isolated-user-agent-success");
    const canary = installOldGlobalCanary(userAgentDir);
    const { baseEnv, backendEnv } = deriveBackendEnv(layout, userAgentDir);
    assertCompleteDerivedEnv(layout, baseEnv, backendEnv);

    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: FOREGROUND_BUDGET_MS,
      progressRateHz: 10,
      heartbeatIntervalMs: 1_000,
      leaseDurationMs: 3_000,
      completionBatchWindowMs: 5_000,
      desktopManaged: { artifactDir: layout.artifactDir, userAgentDir, backendEnv },
    });
    try {
      const decoyDir = rewriteParentDecoy(harness.parentAgentDir);
      const authBefore = readFileSync(join(userAgentDir, "auth.json"));
      const modelsBefore = readFileSync(join(userAgentDir, "models.json"));
      const artifactBefore = snapshotTree(layout.artifactDir);
      harness.writeSubagentModelPreference("synara-local-echo/echo-slow");
      writeResearcherSlowPreference(harness.piHomeDir);
      const threadId = await createThread(harness, "success", DETERMINISTIC_DRIVER_MODEL_ID);
      await startTurn(harness, threadId, "success");

      const capability = await waitFor(
        () => {
          const observed = harness.observedCapabilities().get(String(threadId));
          const admissions = harness
            .observedAdmissions()
            .filter((event) => String(event.threadId) === String(threadId));
          return observed !== undefined && admissions.length === 0 ? observed : undefined;
        },
        (observed) => observed.status === "managed_enabled",
        45_000,
        "seven-capability handshake before first admission",
      );
      expect(PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES).toHaveLength(7);
      expect(capability.isManaged).toBe(true);
      for (const required of PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES) {
        expect(capability.capabilities).toContain(required);
      }

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find(
            (event) => String(event.threadId) === String(threadId),
          ),
        (event) => event.result.status !== "rejected",
        90_000,
        "one real managed Agent admission",
      );
      expect(
        harness.observedAdmissions().filter((event) => String(event.threadId) === String(threadId)),
      ).toHaveLength(1);
      const executionId = admission.result.executionId;
      const durable = await waitFor(
        () => harness.durable.getById(executionId),
        (row) => row !== undefined,
        30_000,
        "durable execution identity",
      );
      await waitFor(
        () => harness.modelServer.requests(),
        (requests) =>
          requests.some(
            (request) =>
              request.model === DETERMINISTIC_SLOW_MODEL_ID && request.hasAgentTool === false,
          ),
        45_000,
        "real slow child model request without the parent Agent tool",
      );

      const journal = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) => events.some((event) => event.sequence === 3),
        30_000,
        "accepted, started, detached journal",
      );
      expect(journal.slice(0, 3).map((event) => event.sequence)).toEqual([1, 2, 3]);
      const accepted = journal[0]!;
      const started = journal[1]!;
      const detached = journal[2]!;
      expect(accepted).toMatchObject({
        state: "accepted",
        attemptId: durable.attemptId,
        generation: durable.generation,
      });
      expect(started).toMatchObject({
        state: "running",
        attemptId: durable.attemptId,
        generation: durable.generation,
      });
      expect(detached).toMatchObject({
        state: "running",
        attemptId: durable.attemptId,
        generation: durable.generation,
        metadata: {
          phase: "detached",
          attachmentMode: "foreground",
          foregroundWaitMs: FOREGROUND_BUDGET_MS,
        },
      });
      const attachmentMs = Date.parse(detached.occurredAt) - Date.parse(started.occurredAt);
      process.stdout.write(
        `T04-WP2 detach envelope: attachment=${attachmentMs}ms budget=${FOREGROUND_BUDGET_MS}ms\n`,
      );
      expect(attachmentMs).toBeGreaterThanOrEqual(FOREGROUND_BUDGET_MS - 50);
      expect(attachmentMs).toBeLessThan(FOREGROUND_BUDGET_MS + 500);

      const loadedPath = loadedAgentExtensionPath(harness, threadId);
      expect(loadedPath.startsWith(resolve(harness.desktop!.managedExtensionDir))).toBe(true);
      expect(loadedPath.startsWith(resolve(canary.dir))).toBe(false);
      expect(loadedPath.startsWith(resolve(decoyDir))).toBe(false);

      const backgroundCard = await harness.waitForExecutionCard(
        String(threadId),
        (card) =>
          card.executionId === executionId &&
          card.observedState === "running" &&
          card.currentAttachment === "detached",
        30_000,
      );
      expect(backgroundCard).toMatchObject({
        executionId,
        attemptId: durable.attemptId,
        generation: durable.generation,
        desiredState: "running",
        observedState: "running",
        currentAttachment: "detached",
        currentTeardownEvidence: "none",
      });

      const freshClient = await harness.connectNewClient();
      try {
        const hydratedBackgroundCard = await waitFor(
          async () => {
            const detail = await freshClient.getThreadDetailSnapshot(String(threadId));
            return (detail?.thread.piSubagentExecutions ?? []).find(
              (card) => card.executionId === executionId,
            );
          },
          (card) => card.observedState === "running" && card.currentAttachment === "detached",
          15_000,
          "durable detached card on a fresh public WebSocket",
        );
        expect(hydratedBackgroundCard.attemptId).toBe(durable.attemptId);
        expect(hydratedBackgroundCard.generation).toBe(durable.generation);

        const activeBeforeTerminal = harness.bridgeActiveExecutions(String(threadId));
        expect(
          activeBeforeTerminal.some(
            (candidate) => candidate.executionId === executionId && candidate.isRunning,
          ),
        ).toBe(true);

        const detachedAt = Date.parse(detached.occurredAt);
        const observation = await waitFor(
          () => harness.durable.getObservation(executionId),
          (value) =>
            value !== undefined &&
            value.lastProgressAt !== null &&
            value.lastHeartbeatAt !== null &&
            Date.parse(value.lastProgressAt) > detachedAt &&
            Date.parse(value.lastHeartbeatAt) > detachedAt,
          60_000,
          "progress and heartbeat strictly after detach",
        );
        expect(Date.parse(observation.lastProgressAt!)).toBeGreaterThan(detachedAt);
        expect(Date.parse(observation.lastHeartbeatAt!)).toBeGreaterThan(detachedAt);
        expect(Date.parse(observation.leaseExpiresAt!)).toBeGreaterThan(
          Date.parse(observation.lastHeartbeatAt!),
        );

        const terminalCard = await waitFor(
          async () => {
            const detail = await freshClient.getThreadDetailSnapshot(String(threadId));
            return (detail?.thread.piSubagentExecutions ?? []).find(
              (card) => card.executionId === executionId,
            );
          },
          (card) => card.observedState === "succeeded",
          60_000,
          "terminal card with the same identity on fresh public WebSocket",
        );
        expect(terminalCard).toMatchObject({
          executionId,
          attemptId: durable.attemptId,
          generation: durable.generation,
          observedState: "succeeded",
          currentAttachment: null,
          currentTeardownEvidence: null,
        });
        expect(terminalCard.terminalSummary).toContain("ACK");

        const terminalJournal = await waitFor(
          () => harness.durable.listJournalEvents(executionId),
          (events) => events.some((event) => event.sequence === 40),
          30_000,
          "one fenced terminal commit",
        );
        const terminals = terminalJournal.filter((event) => event.sequence === 40);
        expect(terminals).toHaveLength(1);
        expect(terminals[0]).toMatchObject({
          state: "succeeded",
          attemptId: durable.attemptId,
          generation: durable.generation,
        });
      } finally {
        await freshClient.close();
      }

      await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) => active.every((candidate) => candidate.executionId !== executionId),
        30_000,
        "owner registry cleanup after terminal handoff",
      );
      expect(
        harness.observedAdmissions().filter((event) => String(event.threadId) === String(threadId)),
      ).toHaveLength(1);
      expect(snapshotTree(canary.dir)).toEqual(canary.snapshot);
      expect(snapshotTree(layout.artifactDir)).toEqual(artifactBefore);
      expect(readFileSync(join(userAgentDir, "auth.json"))).toEqual(authBefore);
      expect(readFileSync(join(userAgentDir, "models.json"))).toEqual(modelsBefore);
      expect(await verifyPiSubagentArtifact(layout.artifactDir)).toMatchObject({ valid: true });
    } finally {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
    }
  }, 180_000);

  it("AC3 locator-less guard: packaged resolution cannot be replaced by a reconstructed one-key env", async () => {
    const layout = createReleaseLayout("locator-missing-guard");
    const poisonDir = join(layout.rootDir, "poison-agent");
    const { backendEnv } = deriveBackendEnv(layout, poisonDir);
    expect(backendEnv[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBeUndefined();
    expect(backendEnv.PI_CODING_AGENT_DIR).toBeUndefined();
    await expect(
      makeRealPiWsHarness({
        desktopManaged: {
          artifactDir: join(layout.rootDir, "must-not-be-reconstructed"),
          userAgentDir: join(layout.rootDir, "user-agent"),
          backendEnv,
        },
      }),
    ).rejects.toMatchObject({ operation: "desktopManagedBackendEnvLocatorMismatch" });
  });

  it("AC3: all packaged artifact, capability/protocol, bridge, and runtime failures are bounded, redacted, side-effect free, and never fall back globally", async () => {
    const failures: ReadonlyArray<FailureExpectation> = [
      {
        label: "manifest-missing",
        category: "manifest_missing",
        mutate: (artifactDir) => {
          rmSync(artifactDir, { recursive: true, force: true });
          mkdirSync(artifactDir, { recursive: true });
        },
      },
      {
        label: "manifest-malformed",
        category: "manifest_malformed",
        mutate: (artifactDir) => writeFileSync(join(artifactDir, "manifest.json"), "{", "utf8"),
      },
      {
        label: "digest-mismatch",
        category: "digest_mismatch",
        mutate: (artifactDir) => {
          const entry = join(
            artifactDir,
            "agent",
            "extensions",
            "pi-subagents",
            "src",
            "index.ts",
          );
          writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// corrupt byte\n`, "utf8");
        },
      },
      {
        label: "capability-mismatch",
        category: "capability_mismatch:pi_subagent_capability_mismatch",
        mutate: (artifactDir) =>
          patchHandshakeArtifact(
            artifactDir,
            `      return {
        ok: true,
        protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
        extensionVersion: EXTENSION_VERSION,
        capabilities: availableCapabilities.filter(
          (capability) => capability !== "durable-cancellation",
        ),
      };`,
          ),
      },
      {
        label: "unsupported-protocol",
        category: "unsupported_version:pi_subagent_unsupported_version",
        forbidden: ["Hostile extension demands", "sk-hostile"],
        mutate: (artifactDir) =>
          patchHandshakeArtifact(
            artifactDir,
            `      return {
        ok: false,
        error: "unsupported_version",
        protocolVersion: 99,
        supportedProtocolVersions: [99],
        extensionVersion: EXTENSION_VERSION,
        detail: "Hostile extension demands 99 sk-hostile /private/hostile",
      };`,
          ),
      },
      {
        label: "malformed-handshake",
        category: "bridge_malformed_response:pi_subagent_bridge_malformed_response",
        forbidden: ["totally", "hostile handshake payload"],
        mutate: (artifactDir) =>
          patchHandshakeArtifact(
            artifactDir,
            `      return { totally: "hostile handshake payload" };`,
          ),
      },
      {
        label: "runtime-model-invalid",
        category: "runtime_config_invalid",
        model: HOSTILE_MODEL_ID,
        exactRuntimeDetail: true,
        forbidden: [HOSTILE_MODEL_ID],
      },
    ];

    for (const failure of failures) {
      await runFailureLeg(failure);
    }
  }, 600_000);
});
