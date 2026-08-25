/**
 * Wall-clock-sensitive suite (Ticket 02 WP-C). Like the other real-Pi
 * detach-sensitive files, this runs only in the `wallclock` vitest project:
 * standalone per-file, one forked runner, with the desktop managed artifact
 * staged once and then exercised through the production WS/Pi adapter path.
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
  buildPiSubagentArtifact,
  loadPiSubagentExtensionProvenance,
} from "../../../../scripts/lib/piSubagentArtifactStaging.ts";
import { preparePiSubagentDevArtifact } from "../../../../scripts/lib/piSubagentDevArtifactCache.ts";
import { verifyPiSubagentArtifact } from "./piSubagentArtifactVerifier.ts";
import {
  DETERMINISTIC_SLOW_MODEL_ID,
  DETERMINISTIC_DRIVER_MODEL_ID,
  DETERMINISTIC_FAST_MODEL_ID,
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
const CANARY_MARKER = "wp-c-ticket-02-desktop-managed-canary";
const HOSTILE_SELECTED_MODEL_ID = "wp-c-hostile-unavailable-selected-model";
const HOSTILE_PROTOCOL_SECRET = "sk-hostile-99";
const HOSTILE_PROTOCOL_PATH = "/private/hostile";
const INNOCENT_STACK_LOCATION = "PiAdapter.ts:3596:99";
const createdRoots: string[] = [];

/**
 * Ticket 02 AC5 safe-diagnostics hardening: a bare `99` substring is NOT the
 * redaction contract — two-digit substrings collide with benign material
 * (e.g. an OS username embedded in a tmpdir path). The contract is that the
 * hostile negotiated protocol VERSION must not reach the operator surface in
 * any contextual form: prose ("protocol 99"), JSON field values, or
 * offered/supported version enumerations. These patterns pin that intent.
 * Stack locations and other harmless diagnostics can contain the same digits;
 * complete hostile secret and path values remain forbidden independently.
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

function assertInnocentStackNumberIsAllowed(): void {
  const diagnostic = `Error: bounded bootstrap failure\n    at ${INNOCENT_STACK_LOCATION}`;
  expect(diagnostic).toContain("99");
  expect(diagnostic).not.toContain(HOSTILE_PROTOCOL_SECRET);
  expect(diagnostic).not.toContain(HOSTILE_PROTOCOL_PATH);
  assertNoHostileProtocolVersion(diagnostic);
}

interface TreeSnapshot {
  readonly bytes: number;
  readonly digest: string;
}

interface StagedFixture {
  readonly rootDir: string;
  readonly sourceArtifactDir: string;
}

let stagedFixture: StagedFixture;
let userPiHomeDigestBefore = "";

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function requireAlfieRepoDir(): string {
  if (ALFIE_REPO_DIR.trim() === "") {
    throw new Error("ALFIE_REPO_DIR is required for this real desktop managed acceptance suite.");
  }
  const repoDir = resolve(ALFIE_REPO_DIR);
  if (!existsSync(repoDir) || !existsSync(join(repoDir, ".git"))) {
    throw new Error(`ALFIE_REPO_DIR does not point to a Git repository: '${repoDir}'.`);
  }
  return repoDir;
}

function snapshotTree(rootDir: string): TreeSnapshot {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for (const fullPath of readdirStable(rootDir)) {
    const content = readFileSync(fullPath);
    const relative = fullPath.slice(rootDir.length + 1);
    hash.update(relative);
    hash.update("\0");
    hash.update(content);
    bytes += content.byteLength;
  }
  return { bytes, digest: hash.digest("hex") };
}

function readdirStable(rootDir: string): string[] {
  const entries: string[] = [];
  const visit = (dir: string) => {
    const names = readdirSync(dir).toSorted();
    for (const name of names) {
      const fullPath = join(dir, name);
      const stat = lstatSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
      } else {
        entries.push(fullPath);
      }
    }
  };
  visit(rootDir);
  return entries;
}

function installUserGlobalCanary(userAgentDir: string): {
  readonly dir: string;
  readonly snapshot: TreeSnapshot;
} {
  const canaryDir = join(userAgentDir, "extensions", "pi-subagents");
  mkdirSync(join(canaryDir, "src"), { recursive: true });
  writeFileSync(
    join(canaryDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@alfie/pi-subagents",
        version: "0.10.0-canary",
        description: CANARY_MARKER,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(canaryDir, "src", "index.ts"),
    `throw new Error("${CANARY_MARKER}: user/global extension canary must never load");\n`,
    "utf8",
  );
  return { dir: canaryDir, snapshot: snapshotTree(canaryDir) };
}

function rewriteDecoyParentAgentDir(parentAgentDir: string): void {
  rmSync(join(parentAgentDir, "extensions"), { recursive: true, force: true });
  mkdirSync(join(parentAgentDir, "extensions", "pi-subagents", "src"), { recursive: true });
  writeFileSync(
    join(parentAgentDir, "extensions", "pi-subagents", "package.json"),
    `${JSON.stringify(
      {
        name: "@alfie/pi-subagents",
        version: "0.10.0-decoy",
        description: `${CANARY_MARKER}-decoy`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(parentAgentDir, "extensions", "pi-subagents", "src", "index.ts"),
    `throw new Error("${CANARY_MARKER}: decoy parent agent dir extension must never load");\n`,
    "utf8",
  );
  writeFileSync(
    join(parentAgentDir, "auth.json"),
    JSON.stringify({ decoy: { type: "api_key", key: "sk-decoy-parent-agent" } }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(parentAgentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          decoy: {
            name: "Decoy Only",
            baseUrl: "https://example.invalid/v1",
            api: "openai-completions",
            apiKey: "sk-decoy-parent-agent",
            authHeader: true,
            compat: { supportsDeveloperRole: false },
            models: [
              {
                id: "decoy-only-model",
                name: "Decoy Only",
                reasoning: false,
                input: ["text"],
                contextWindow: 1000,
                maxTokens: 100,
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
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
  if (!loaded?.path) {
    throw new Error(`No loaded Agent-bearing extension found for thread '${threadId}'.`);
  }
  return resolve(loaded.path);
}

function readPiLedgerCounts(dbPath: string): {
  readonly executions: number;
  readonly journal: number;
  readonly outbox: number;
  readonly batches: number;
} {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function createThreadHarnessState(
  harness: RealPiWsHarness,
  suffix: string,
  model: string,
): Promise<{ readonly projectId: ProjectId; readonly threadId: ThreadId }> {
  const projectId = ProjectId.makeUnsafe(`t02-wpc-project-${suffix}`);
  const threadId = ThreadId.makeUnsafe(`t02-wpc-thread-${suffix}`);
  const createdAt = new Date().toISOString();
  await harness.client.dispatchCommand({
    type: "project.create",
    commandId: CommandId.makeUnsafe(`cmd-t02-wpc-project-${suffix}`),
    projectId,
    title: `T02 WP-C Project ${suffix}`,
    workspaceRoot: harness.workspaceDir,
    createdAt,
  });
  await harness.client.dispatchCommand({
    type: "thread.create",
    commandId: CommandId.makeUnsafe(`cmd-t02-wpc-thread-${suffix}`),
    threadId,
    projectId,
    title: `T02 WP-C Thread ${suffix}`,
    modelSelection: { provider: "pi", model },
    interactionMode: "default",
    runtimeMode: "full-access",
    branch: null,
    worktreePath: harness.workspaceDir,
    createdAt,
  });
  return { projectId, threadId };
}

async function startTurn(
  harness: RealPiWsHarness,
  threadId: ThreadId,
  suffix: string,
  text: string,
  modelSelection?: { readonly provider: "pi"; readonly model: string },
): Promise<void> {
  await harness.client.dispatchCommand({
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(`cmd-t02-wpc-turn-${suffix}`),
    threadId,
    message: {
      messageId: MessageId.makeUnsafe(`msg-t02-wpc-turn-${suffix}`),
      role: "user",
      text,
      attachments: [],
    },
    ...(modelSelection === undefined ? {} : { modelSelection }),
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: new Date().toISOString(),
  });
}

/** Narrows a Schema.Json activity payload to an object carrying a string `detail`. */
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

async function waitForTurnStartFailureDetail(
  harness: RealPiWsHarness,
  threadId: ThreadId,
): Promise<string> {
  const detail = await waitFor(
    async () => {
      const thread = (await harness.client.getThreadDetailSnapshot(String(threadId)))?.thread;
      const failed = thread?.activities.find(
        (activity) => activity.kind === "provider.turn.start.failed",
      );
      const payload = failed?.payload;
      return isJsonObjectWithDetail(payload) ? payload.detail : undefined;
    },
    (value) => value.length > 0,
    45_000,
    "provider.turn.start.failed detail",
  );
  return detail;
}

async function makeDesktopHarness(artifactDir: string): Promise<RealPiWsHarness> {
  const rootDir = makeTempRoot("t02-wpc-desktop-");
  const userAgentDir = join(rootDir, "desktop-user-agent");
  return makeRealPiWsHarness({
    foregroundWaitMs: 300,
    progressRateHz: 10,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    completionBatchWindowMs: 5_000,
    desktopManaged: {
      artifactDir,
      userAgentDir,
    },
  });
}

/**
 * Local web/dev locator leg (dev-runner prepared cache composition): the
 * SAME managed binding inputs as `makeDesktopHarness`, but the live
 * ServerConfig stays in WEB mode — exactly what a `dev`/`dev:server`
 * launch with a prepared verified cache locator runs. The shared gate
 * verifies any non-blank locator identically for both modes, so the whole
 * production managed path (gate locator env + explicit user agent dir +
 * controlled `<artifact>/agent` extension discovery) engages unchanged
 * while the server reports web mode.
 */
async function makeWebManagedHarness(artifactDir: string): Promise<RealPiWsHarness> {
  const rootDir = makeTempRoot("t02-wpc-web-managed-");
  const userAgentDir = join(rootDir, "web-managed-user-agent");
  return makeRealPiWsHarness({
    foregroundWaitMs: 300,
    progressRateHz: 10,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    completionBatchWindowMs: 5_000,
    desktopManaged: {
      artifactDir,
      userAgentDir,
      mode: "web",
    },
  });
}

function copyArtifactForRun(label: string): string {
  const rootDir = makeTempRoot(`t02-wpc-artifact-copy-${label}-`);
  const artifactDir = join(rootDir, "artifact");
  cpSync(stagedFixture.sourceArtifactDir, artifactDir, { recursive: true });
  return artifactDir;
}

/**
 * Local manifest-file record shape for the hostile-fixture patch below. The
 * WP1a contract (`PiSubagentArtifactFileRecord`) is the authority; this test
 * only needs the three fields it rewrites, so it handles the shape locally
 * instead of changing any production or contract file.
 */
interface LocalManifestFileRecord {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/**
 * AC5 hostile bridge legs: the exact success-return block at the end of the
 * pinned extension's `handshake` implementation. The patch below must find
 * this anchor EXACTLY once — never a fuzzy match — or the fixture fails
 * closed instead of patching the wrong site.
 */
const HOSTILE_HANDSHAKE_ANCHOR = `      return {
        ok: true,
        protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
        extensionVersion: EXTENSION_VERSION,
        capabilities: availableCapabilities,
      };`;

/**
 * Builds a SELF-CONSISTENT hostile bridge artifact (AC5 malformed/
 * unsupported legs) from a fresh copy of the already staged verified
 * artifact:
 *
 * - patches ONLY the copied `agent/extensions/pi-subagents/src/index.ts`
 *   handshake success-return with a hostile response of the requested
 *   family, guarded against a missing/ambiguous anchor;
 * - recomputes that one file's manifest record (size + SHA-256) so the PURE
 *   verifier accepts the fixture as self-consistent.
 *
 * This is a test fixture only: it drives the real Pi SDK loader, the real
 * extension bridge, the production PiAdapter bootstrap, and the public WS
 * boundary through an artifact that verifies — exactly the divergence a
 * hostile verified-looking artifact represents. It is not an attack on
 * production release provenance, and no user/global fallback is created.
 */
function patchHostileHandshakeArtifact(label: string, hostileReturn: string): string {
  const artifactDir = copyArtifactForRun(label);
  const extensionEntryRelative = "agent/extensions/pi-subagents/src/index.ts";
  const entryPath = join(artifactDir, extensionEntryRelative);
  const original = readFileSync(entryPath, "utf8");
  const occurrences = original.split(HOSTILE_HANDSHAKE_ANCHOR).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Hostile fixture anchor guard failed for '${label}': expected exactly 1 handshake success-return anchor, found ${occurrences}.`,
    );
  }
  writeFileSync(entryPath, original.replace(HOSTILE_HANDSHAKE_ANCHOR, hostileReturn), "utf8");

  const manifestPath = join(artifactDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly files: ReadonlyArray<LocalManifestFileRecord>;
  };
  const patched = readFileSync(entryPath);
  let updated = 0;
  const files = manifest.files.map((record) => {
    if (record.path !== extensionEntryRelative) return record;
    updated += 1;
    return { ...record, sizeBytes: patched.byteLength, sha256: sha256(patched) };
  });
  if (updated !== 1) {
    throw new Error(
      `Hostile fixture manifest guard failed for '${label}': expected exactly 1 manifest record for '${extensionEntryRelative}', found ${updated}.`,
    );
  }
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, files }, null, 2)}\n`, "utf8");
  return artifactDir;
}

function writeResearcherSlowPreference(piHomeDir: string): void {
  writeFileSync(
    join(piHomeDir, "PREFERENCES.md"),
    `---\nmodels:\n  subagent: synara-local-echo/echo-slow\n  subagent/researcher: synara-local-echo/echo-slow\n---\n`,
    "utf8",
  );
}

async function expectManagedArtifactUnchanged(artifactDir: string, managedAgentDir: string) {
  const verified = await verifyPiSubagentArtifact(artifactDir);
  expect(verified.valid).toBe(true);
  for (const relativePath of [
    "auth.json",
    "models.json",
    "models-store.json",
    "settings.json",
  ]) {
    expect(existsSync(join(managedAgentDir, relativePath))).toBe(false);
  }
}

beforeAll(async () => {
  const repoDir = requireAlfieRepoDir();
  const provenance = verifyRealPiExtensionProvenance();
  expect(provenance.isVerified).toBe(true);
  expect(resolve(repoDir)).toBe(resolve(requireAlfieRepoDir()));
  userPiHomeDigestBefore = provenance.snapshotUserPiHome().digest;

  const rootDir = makeTempRoot("t02-wpc-artifact-");
  const artifactDir = join(rootDir, "staged-artifact");
  const staged = buildPiSubagentArtifact({
    repoDir,
    artifactDir,
    provenance: loadPiSubagentExtensionProvenance(
      join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
    ),
  });
  expect(resolve(staged.artifactDir)).toBe(resolve(artifactDir));
  const verified = await verifyPiSubagentArtifact(artifactDir);
  expect(verified.valid).toBe(true);

  stagedFixture = { rootDir, sourceArtifactDir: artifactDir };
}, 180_000);

afterAll(async () => {
  const verified = await verifyPiSubagentArtifact(stagedFixture.sourceArtifactDir);
  expect(verified.valid).toBe(true);
  const provenance = verifyRealPiExtensionProvenance();
  expect(provenance.snapshotUserPiHome().digest).toBe(userPiHomeDigestBefore);
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Ticket 02 WP-C real controlled desktop artifact acceptance", () => {
  it("discovery keeps the verified artifact immutable before any active session", async () => {
    const runArtifactDir = copyArtifactForRun("discovery-immutability");
    const harness = await makeDesktopHarness(runArtifactDir);
    try {
      if (harness.desktop === undefined) {
        throw new Error("Desktop harness did not expose controlled desktop paths.");
      }
      expect(harness.observedSessions()).toHaveLength(0);

      await harness.client.listSkills({ provider: "pi", cwd: harness.workspaceDir });
      expect(harness.observedSessions()).toHaveLength(0);
      await expectManagedArtifactUnchanged(
        harness.desktop.artifactDir,
        harness.desktop.managedAgentDir,
      );

      await harness.client.listCommands({ provider: "pi", cwd: harness.workspaceDir });
      expect(harness.observedSessions()).toHaveLength(0);
      await expectManagedArtifactUnchanged(
        harness.desktop.artifactDir,
        harness.desktop.managedAgentDir,
      );

      const { threadId } = await createThreadHarnessState(
        harness,
        "discovery-immutability",
        DETERMINISTIC_FAST_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "discovery-immutability",
        "Reply with a short acknowledgment only. Do not delegate.",
      );
      await waitFor(
        async () =>
          (await harness.client.getThreadDetailSnapshot(String(threadId))) ?? undefined,
        (value) => value.thread.latestTurn?.state === "completed",
        90_000,
        "managed session terminal success",
      );
      await expectManagedArtifactUnchanged(
        harness.desktop.artifactDir,
        harness.desktop.managedAgentDir,
      );
    } finally {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
    }
  }, 180_000);

  it("AC1 + AC3: desktop managed loads only the staged artifact extension, ignores user/global and settings decoys, uses the real Agent tool, and commits exactly one durable admission", async () => {
    const harness = await makeDesktopHarness(copyArtifactForRun("ac1-ac3"));
    try {
      if (harness.desktop === undefined) {
        throw new Error("Desktop harness did not expose controlled desktop paths.");
      }
      rewriteDecoyParentAgentDir(harness.parentAgentDir);
      const userCanary = installUserGlobalCanary(harness.desktop.userAgentDir);

      const settings = await harness.client.getServerSettings();
      expect(settings.providers.pi?.agentDir).toBe(harness.parentAgentDir);

      const { threadId } = await createThreadHarnessState(
        harness,
        "ac1-ac3",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "ac1-ac3",
        "Delegate this desktop managed acceptance task to a researcher subagent.",
      );

      const capabilityBeforeAdmission = await waitFor(
        () => {
          const capability = harness.observedCapabilities().get(String(threadId));
          const admissions = harness
            .observedAdmissions()
            .filter((event) => String(event.threadId) === String(threadId));
          return capability !== undefined && admissions.length === 0 ? capability : undefined;
        },
        (capability) => capability.status === "managed_enabled",
        45_000,
        "managed capability before Agent admission",
      );
      expect(capabilityBeforeAdmission.isManaged).toBe(true);
      for (const required of PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES) {
        expect(capabilityBeforeAdmission.capabilities).toContain(required);
      }

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        90_000,
        "single managed admission",
      );
      expect(
        harness.observedAdmissions().filter((event) => String(event.threadId) === String(threadId)),
      ).toHaveLength(1);

      const executionId = admission.result.executionId;
      const durable = await waitFor(
        () => harness.durable.getById(executionId),
        (value) => value !== undefined,
        30_000,
        "durable admitted row",
      );
      const journal = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) => events.some((event) => event.sequence === 2),
        30_000,
        "accepted and started journal",
      );
      expect(journal[0]?.sequence).toBe(1);
      expect(journal[0]?.state).toBe("accepted");
      expect(journal[0]?.attemptId).toBe(durable.attemptId);
      expect(journal[0]?.generation).toBe(durable.generation);
      expect(journal[1]?.sequence).toBe(2);
      expect(journal[1]?.state).toBe("running");
      expect(journal[1]?.attemptId).toBe(durable.attemptId);
      expect(journal[1]?.generation).toBe(durable.generation);

      const loadedPath = loadedAgentExtensionPath(harness, threadId);
      expect(loadedPath.startsWith(resolve(harness.desktop.managedExtensionDir))).toBe(true);
      expect(loadedPath.startsWith(resolve(userCanary.dir))).toBe(false);
      expect(loadedPath.startsWith(resolve(harness.parentAgentDir))).toBe(false);

      const card = await harness.waitForExecutionCard(
        String(threadId),
        (candidate) => candidate.executionId === executionId,
        45_000,
      );
      expect(card.attemptId).toBe(durable.attemptId);
      expect(card.generation).toBe(durable.generation);

      const modelRequests = await waitFor(
        () => harness.modelServer.requests(),
        (requests) =>
          requests.some(
            (request) => request.model === DETERMINISTIC_DRIVER_MODEL_ID && request.hasAgentTool,
          ),
        45_000,
        "real Agent parent model traffic",
      );
      expect(
        modelRequests.some(
          (request) => request.model === DETERMINISTIC_DRIVER_MODEL_ID && request.hasAgentTool,
        ),
      ).toBe(true);

      const userCanaryAfter = snapshotTree(userCanary.dir);
      expect(userCanaryAfter).toEqual(userCanary.snapshot);

      const artifactStillValid = await verifyPiSubagentArtifact(stagedFixture.sourceArtifactDir);
      expect(artifactStillValid.valid).toBe(true);
    } finally {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
    }
  }, 180_000);

  // Local web/dev locator leg (dev-runner prepared cache): the shared gate
  // verifies any NON-BLANK locator identically for both modes, so a web-mode
  // server started with a prepared verified cache locator composes the SAME
  // managed binding as the desktop leg. This is the exact production
  // composition a `dev`/`dev:server` launch with a pin-keyed verified cache
  // entry runs: ServerConfig stays in WEB mode, the gate consumes the
  // launcher-derived locator, and the desktop managed bootstrap keys off the
  // gate's trusted controlled-runtime binding — never off the ServerConfig
  // mode value itself. Adapts the AC1+AC3 desktop managed case (decoy
  // parent/user-global canaries, capability-before-admission, artifact-only
  // extension path) and extends it to a full terminal + public result read.
  it("local web/dev locator: a web-mode server with a prepared verified cache locator engages the same managed binding end to end — live web ServerConfig, seven capabilities before admission, artifact-only extension, real managed spawn to terminal succeeded with a retrievable result, and an unchanged verified artifact", async () => {
    const synaraHomeRoot = makeTempRoot("t02-wpc-web-cache-home-");
    const synaraHome = join(synaraHomeRoot, ".synara");
    mkdirSync(synaraHome, { recursive: true });
    const prepared = await preparePiSubagentDevArtifact({
      repoRoot: REPO_ROOT,
      synaraHome,
      env: { ALFIE_REPO_DIR },
    });
    const harness = await makeWebManagedHarness(prepared.artifactDir);
    try {
      if (harness.desktop === undefined) {
        throw new Error("Web managed harness did not expose controlled managed paths.");
      }
      // The LIVE composed ServerConfig ran in web mode (read back from the
      // harness ManagedRuntime, not from the options) and the managed leg
      // reports web mode.
      expect(harness.serverMode).toBe("web");
      expect(harness.desktop.mode).toBe("web");

      rewriteDecoyParentAgentDir(harness.parentAgentDir);
      const userCanary = installUserGlobalCanary(harness.desktop.userAgentDir);

      const { threadId } = await createThreadHarnessState(
        harness,
        "web-locator",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "web-locator",
        "Delegate this web managed acceptance task to a researcher subagent.",
      );

      // Managed capability (all seven required capabilities) negotiated
      // BEFORE any Agent admission — same ordering contract as the desktop
      // leg, now proven on a web-mode server.
      const capabilityBeforeAdmission = await waitFor(
        () => {
          const capability = harness.observedCapabilities().get(String(threadId));
          const admissions = harness
            .observedAdmissions()
            .filter((event) => String(event.threadId) === String(threadId));
          return capability !== undefined && admissions.length === 0 ? capability : undefined;
        },
        (capability) => capability.status === "managed_enabled",
        45_000,
        "web-mode managed capability before Agent admission",
      );
      expect(capabilityBeforeAdmission.isManaged).toBe(true);
      for (const required of PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES) {
        expect(capabilityBeforeAdmission.capabilities).toContain(required);
      }

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        90_000,
        "web-mode managed admission",
      );
      expect(
        harness.observedAdmissions().filter((event) => String(event.threadId) === String(threadId)),
      ).toHaveLength(1);

      const executionId = admission.result.executionId;
      const durable = await waitFor(
        () => harness.durable.getById(executionId),
        (value) => value !== undefined,
        30_000,
        "web-mode durable admitted row",
      );

      // Extension loading stays isolated to the verified artifact's
      // controlled extension dir — the user/global canary and the decoy
      // parent agent dir never load in web mode either.
      const loadedPath = loadedAgentExtensionPath(harness, threadId);
      expect(loadedPath.startsWith(resolve(harness.desktop.managedExtensionDir))).toBe(true);
      expect(loadedPath.startsWith(resolve(userCanary.dir))).toBe(false);
      expect(loadedPath.startsWith(resolve(harness.parentAgentDir))).toBe(false);

      // The real parent model traffic carries the real Agent tool — the
      // managed spawn happened on a genuinely live web-mode session.
      await waitFor(
        () => harness.modelServer.requests(),
        (requests) =>
          requests.some(
            (request) => request.model === DETERMINISTIC_DRIVER_MODEL_ID && request.hasAgentTool,
          ),
        45_000,
        "web-mode real Agent parent model traffic",
      );

      // The managed child runs to terminal succeeded with a retrievable
      // bounded summary through the public result read RPC (same public
      // contract as the Ticket 17/T17-AC4 read leg).
      const terminalCard = await harness.waitForExecutionCard(
        String(threadId),
        (candidate) =>
          candidate.executionId === executionId && candidate.observedState === "succeeded",
        90_000,
      );
      expect(terminalCard.attemptId).toBe(durable.attemptId);
      expect(terminalCard.generation).toBe(durable.generation);

      const result = await harness.client.readPiSubagentResult({ executionId });
      expect(result.observedState).toBe("succeeded");
      expect(result.terminalState).toBe("succeeded");
      expect(result.summary).toContain("ACK");
      expect(result.transcriptRef).toBeTruthy();

      const userCanaryAfter = snapshotTree(userCanary.dir);
      expect(userCanaryAfter).toEqual(userCanary.snapshot);

      expect(harness.desktop.artifactDir).toBe(prepared.artifactDir);
      const artifactStillValid = await verifyPiSubagentArtifact(prepared.artifactDir);
      expect(artifactStillValid.valid).toBe(true);
    } finally {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
    }
  }, 180_000);

  // Runtime-repro regression (2026-08-23): Pi SDK 0.83's session.setModel
  // persists defaultProvider/defaultModel through the session services'
  // SettingsManager to `<agentDir>/settings.json`. On the desktop managed
  // path that agentDir is the VERIFIED artifact's controlled `agent` subtree,
  // so switching models in an existing chat wrote an unlisted file and the
  // next artifact gate failed closed with `unlisted_entry`, quarantining
  // the thread. Production now passes one session-scoped
  // `SettingsManager.inMemory()` per createSdkRuntime invocation for
  // desktop-managed sessions only. This leg proves the fix against the REAL
  // SDK + REAL verified artifact: a mid-chat model switch actually reaches
  // the real AgentSession.setModel (observed as model traffic on the new
  // model id), and the artifact tree remains byte-identical and
  // re-verifiable afterwards.
  it("settings isolation: a mid-chat model switch through the real SDK setModel writes no artifact settings.json and leaves the verified artifact re-verifiable", async () => {
    const runArtifactDir = copyArtifactForRun("settings-isolation");
    const harness = await makeDesktopHarness(runArtifactDir);
    try {
      if (harness.desktop === undefined) {
        throw new Error("Desktop harness did not expose controlled desktop paths.");
      }
      const managedAgentDir = harness.desktop.managedAgentDir;

      const { threadId } = await createThreadHarnessState(
        harness,
        "settings-isolation",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "settings-isolation-1",
        "Reply with a short acknowledgment only. Do not delegate.",
      );

      // The session is live and the initial model selection is in effect.
      await waitFor(
        () => harness.modelServer.requests(),
        (requests) => requests.some((request) => request.model === DETERMINISTIC_DRIVER_MODEL_ID),
        45_000,
        "initial driver model traffic",
      );
      await waitFor(
        () => harness.observedSessions().get(String(threadId)),
        (value) => value !== undefined,
        45_000,
        "live desktop session",
      );

      const artifactBefore = snapshotTree(runArtifactDir);
      expect(existsSync(join(managedAgentDir, "settings.json"))).toBe(false);

      // The runtime-repro vector: switch models in the EXISTING chat. The
      // production sendTurn path resolves the model from the session's
      // registry and calls the real AgentSession.setModel BEFORE the prompt.
      await startTurn(
        harness,
        threadId,
        "settings-isolation-2",
        "Reply with a short acknowledgment only. Do not delegate.",
        { provider: "pi", model: DETERMINISTIC_FAST_MODEL_ID },
      );

      // setModel genuinely ran: the turn's model traffic is on the NEW id
      // (a model request that could only follow a successful setModel +
      // prompt on the switched session).
      await waitFor(
        () => harness.modelServer.requests(),
        (requests) => requests.some((request) => request.model === DETERMINISTIC_FAST_MODEL_ID),
        45_000,
        "switched model traffic",
      );

      // No settings.json materialized anywhere in the verified artifact —
      // the `unlisted_entry` repro file — and the whole tree is
      // byte-identical to before the switch.
      expect(existsSync(join(managedAgentDir, "settings.json"))).toBe(false);
      expect(existsSync(join(runArtifactDir, "settings.json"))).toBe(false);
      expect(snapshotTree(runArtifactDir)).toEqual(artifactBefore);

      // The verifier itself still accepts the artifact: genuine fail-closed
      // verification is untouched (no whitelist, no relaxed policy).
      const stillVerified = await verifyPiSubagentArtifact(runArtifactDir);
      expect(stillVerified.valid).toBe(true);
    } finally {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
    }
  }, 180_000);

  it("AC2: a good desktop session negotiates managed capability before admission, while a separately corrupted artifact fails early with bounded digest diagnostics and zero public side effects", async () => {
    const goodHarness = await makeDesktopHarness(copyArtifactForRun("ac2-good"));
    try {
      const { threadId } = await createThreadHarnessState(
        goodHarness,
        "ac2-good",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(goodHarness, threadId, "ac2-good", "Capability probe ordering check.");

      const capability = await waitFor(
        () => {
          const value = goodHarness.observedCapabilities().get(String(threadId));
          const admissions = goodHarness
            .observedAdmissions()
            .filter((event) => String(event.threadId) === String(threadId));
          return value !== undefined && admissions.length === 0 ? value : undefined;
        },
        (value) => value.status === "managed_enabled",
        45_000,
        "managed capability before any Agent admission",
      );
      expect(capability.isManaged).toBe(true);
      for (const required of PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES) {
        expect(capability.capabilities).toContain(required);
      }
    } finally {
      await goodHarness.dispose();
      expect(goodHarness.envWasRestored()).toBe(true);
    }

    const corruptArtifactDir = copyArtifactForRun("ac2-bad");
    writeFileSync(
      join(corruptArtifactDir, "agent", "extensions", "pi-subagents", "src", "index.ts"),
      `${readFileSync(
        join(corruptArtifactDir, "agent", "extensions", "pi-subagents", "src", "index.ts"),
        "utf8",
      )}\n// ${CANARY_MARKER}: corrupt copy only\n`,
      "utf8",
    );
    const corruptVerified = await verifyPiSubagentArtifact(corruptArtifactDir);
    expect(corruptVerified.valid).toBe(false);
    if (corruptVerified.valid) {
      throw new Error(
        "Expected the corrupted artifact copy to verify as invalid before harness bootstrap.",
      );
    }
    expect(corruptVerified.category).toBe("digest_mismatch");

    const badHarness = await makeDesktopHarness(corruptArtifactDir);
    try {
      const { threadId } = await createThreadHarnessState(
        badHarness,
        "ac2-bad",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(
        badHarness,
        threadId,
        "ac2-bad",
        "This must fail at desktop artifact bootstrap before any Pi Agent work.",
      );

      const detail = await waitForTurnStartFailureDetail(badHarness, threadId);
      expect(detail).toContain("Managed Pi subagents are unavailable (digest_mismatch):");
      expect(detail).toContain("managed pi artifact verification failed: digest_mismatch");
      expect(detail.length).toBeLessThanOrEqual(1_024);
      expect(detail).not.toContain(corruptArtifactDir);
      expect(detail).not.toContain(stagedFixture.sourceArtifactDir);

      const threadDetail = await badHarness.waitForThreadDetail(String(threadId));
      expect(threadDetail.thread.session).toMatchObject({
        providerName: "pi",
        status: "error",
        activeTurnId: null,
      });
      expect(threadDetail.thread.session?.lastError).toContain("digest_mismatch");
      expect(threadDetail.thread.piSubagentExecutions).toHaveLength(0);
      expect(badHarness.observedSessions().size).toBe(0);
      expect(badHarness.observedCapabilities().size).toBe(0);
      expect(badHarness.observedAdmissions()).toHaveLength(0);
      expect(badHarness.modelServer.requestCount()).toBe(0);
    } finally {
      // WAL repair (Ticket 02 draft defect): the live repo holds exclusive
      // WAL access, so readPiLedgerCounts must run only AFTER dispose
      // releases it (same pattern as piSubagentRealPiAcceptance.test.ts's
      // post-shutdown closedDatabase read). preserveRootDir keeps the
      // SQLite file readable until the count check below; every public
      // WS/no-effects assertion above already ran while the harness was
      // live.
      const badDbPath = badHarness.dbPath;
      await badHarness.dispose({ preserveRootDir: true });
      expect(badHarness.envWasRestored()).toBe(true);

      const ledger = readPiLedgerCounts(badDbPath);
      expect(ledger.executions).toBe(0);
      expect(ledger.journal).toBe(0);
      expect(ledger.outbox).toBe(0);
      expect(ledger.batches).toBe(0);
    }
  }, 180_000);

  it("AC4: a slow real child detaches within the bounded foreground window, emits strictly-new progress/heartbeat liveness after the detach journal event, commits exactly one terminal seq-40, and clears the active registry only after handoff", async () => {
    const harness = await makeDesktopHarness(copyArtifactForRun("ac4"));
    try {
      harness.writeSubagentModelPreference("synara-local-echo/echo-slow");
      writeResearcherSlowPreference(harness.piHomeDir);
      const { threadId } = await createThreadHarnessState(
        harness,
        "ac4",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(harness, threadId, "ac4", "Delegate the slow desktop child task.");

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        90_000,
        "slow managed desktop admission",
      );
      const executionId = admission.result.executionId;
      const durable = await waitFor(
        () => harness.durable.getById(executionId),
        (value) => value !== undefined,
        30_000,
        "durable execution row",
      );
      await waitFor(
        () => harness.modelServer.requests(),
        (requests) =>
          requests.some(
            (request) =>
              request.model === DETERMINISTIC_SLOW_MODEL_ID && request.hasAgentTool === false,
          ),
        45_000,
        "slow child model request",
      );

      // Finding B (independent review), part 1 — pre-detach liveness
      // baseline: capture the observation state as of the started (seq-2)
      // journal event, before the detach event can be observed. With this
      // harness's deterministic loopback the slow child model answers
      // only after DETERMINISTIC_SLOW_DELAY_MS = 4_000 ms, while the
      // foreground budget is 300 ms — so the producer's progress funnel
      // (`onStreamUpdate`) cannot have fired yet and NO progress
      // observation may predate detach. (The heartbeat interval is 1_000
      // ms and starts only after the seq-2 commit, so a pre-detach tick is
      // equally impossible; it is recorded, not asserted, to avoid a
      // poll-latency race with the 300 ms window.)
      await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) => events.some((event) => event.sequence === 2),
        30_000,
        "started journal event",
      );
      const preDetachObservation = await harness.durable.getObservation(executionId);
      process.stdout.write(
        `T02-AC4 pre-detach baseline: progress=${preDetachObservation?.lastProgressAt ?? null} heartbeat=${preDetachObservation?.lastHeartbeatAt ?? null}\n`,
      );
      expect(preDetachObservation?.lastProgressAt ?? null).toBeNull();

      const journal = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) => events.some((event) => event.sequence === 3),
        30_000,
        "detach journal",
      );
      const accepted = journal.find((event) => event.sequence === 1);
      const started = journal.find((event) => event.sequence === 2);
      const detached = journal.find((event) => event.sequence === 3);
      expect(accepted?.state).toBe("accepted");
      expect(started?.state).toBe("running");
      expect(detached?.state).toBe("running");
      expect(detached?.attemptId).toBe(durable.attemptId);
      expect(detached?.generation).toBe(durable.generation);
      expect(detached?.metadata).toMatchObject({
        phase: "detached",
        attachmentMode: "foreground",
        foregroundWaitMs: harness.foregroundWaitMs,
      });
      const attachmentMs = Date.parse(detached!.occurredAt) - Date.parse(started!.occurredAt);
      process.stdout.write(
        `T02-AC4 detach envelope: attachment=${attachmentMs}ms budget=${harness.foregroundWaitMs}ms\n`,
      );
      expect(attachmentMs).toBeGreaterThanOrEqual(harness.foregroundWaitMs - 50);
      expect(attachmentMs).toBeLessThan(harness.foregroundWaitMs + 500);

      const activeBeforeTerminal = await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) =>
          active.some((candidate) => candidate.executionId === executionId && candidate.isRunning),
        30_000,
        "active registry before terminal handoff",
      );
      expect(activeBeforeTerminal.some((candidate) => candidate.executionId === executionId)).toBe(
        true,
      );

      // Finding B, part 2 — post-detach liveness proof. Deterministic
      // loopback chronology pins the ordering: the slow child's first
      // response chunk lands ~3.7 s AFTER the 300 ms detach, and the
      // heartbeat interval (1_000 ms) first ticks ~0.7 s after detach, so
      // both required observations can only be produced by a reporter
      // still alive after the detach journal commit. Every timestamp
      // compared is producer-minted `new Date().toISOString()` from the
      // SAME extension process clock — the journal `occurredAt` is the
      // producer-supplied string of the detached observation — so strict
      // `>` is well defined, and same-ms collisions are excluded by the
      // deterministic separations above, not by luck. (Waiting for a
      // NEWER-than-baseline pair would be wrong here: observations stop
      // exactly-once when the detached child settles, so the first
      // post-detach pair is frequently also the final one.)
      const detachedOccurredAtMs = Date.parse(detached!.occurredAt);
      const observation = await waitFor(
        () => harness.durable.getObservation(executionId),
        (value) =>
          value !== undefined &&
          value.lastProgressAt !== null &&
          value.lastHeartbeatAt !== null &&
          Date.parse(value.lastProgressAt) > detachedOccurredAtMs &&
          Date.parse(value.lastHeartbeatAt) > detachedOccurredAtMs,
        60_000,
        "progress and heartbeat observation strictly after the detach journal event",
      );
      process.stdout.write(
        `T02-AC4 post-detach observation: detached=${detached!.occurredAt} progress=${observation.lastProgressAt} heartbeat=${observation.lastHeartbeatAt}\n`,
      );
      expect(Date.parse(observation.lastProgressAt!)).toBeGreaterThan(detachedOccurredAtMs);
      expect(Date.parse(observation.lastHeartbeatAt!)).toBeGreaterThan(detachedOccurredAtMs);
      expect(observation.lastProgressJson).not.toBeNull();
      expect(Date.parse(observation.leaseExpiresAt!)).toBeGreaterThan(
        Date.parse(observation.lastHeartbeatAt!),
      );

      const terminalCard = await harness.waitForExecutionCard(
        String(threadId),
        (candidate) =>
          candidate.executionId === executionId && candidate.observedState === "succeeded",
        60_000,
      );
      expect(terminalCard.attemptId).toBe(durable.attemptId);
      expect(terminalCard.generation).toBe(durable.generation);

      const terminalJournal = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) => events.some((event) => event.sequence === 40),
        60_000,
        "terminal seq-40 commit",
      );
      const sequence40 = terminalJournal.filter((event) => event.sequence === 40);
      expect(sequence40).toHaveLength(1);
      expect(sequence40[0]).toMatchObject({
        state: "succeeded",
        attemptId: durable.attemptId,
        generation: durable.generation,
      });

      const activeAfterTerminal = await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) => active.every((candidate) => candidate.executionId !== executionId),
        30_000,
        "active registry cleanup after terminal handoff",
      );
      expect(activeAfterTerminal.some((candidate) => candidate.executionId === executionId)).toBe(
        false,
      );
    } finally {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
    }
  }, 180_000);

  it("AC5 (selected model): an unavailable hostile selected model surfaces exactly the fixed desktop runtime-config failure detail and produces no session, publication, admission, execution, card, child, or outbox effect", async () => {
    const harness = await makeDesktopHarness(copyArtifactForRun("ac5"));
    try {
      const { threadId } = await createThreadHarnessState(
        harness,
        "ac5",
        HOSTILE_SELECTED_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "ac5",
        "Attempt to start with a hostile unavailable selected model id.",
      );

      // Finding A (independent review): AC5 selected invalid runtime
      // config must surface EXACTLY the exported runtime-config failure
      // constant — the closed-vocabulary contract — not a superset detail
      // that merely contains it. The public activity detail is the reactor's
      // `Cause.pretty` envelope around the ProviderAdapterRequestError:
      // line 1 is the error message `Error: Provider adapter request
      // failed (pi) for session/start: <detail>` followed by its stack, so
      // the closed-vocabulary rule is asserted on the exact extracted
      // `<detail>` segment. Only the malformed/unsupported bridge legs keep
      // their own distinct exact bounded bootstrap details.
      const detail = await waitForTurnStartFailureDetail(harness, threadId);
      const RUNTIME_CONFIG_ENVELOPE_PREFIX =
        "Error: Provider adapter request failed (pi) for session/start: ";
      const detailFirstLine = detail.split("\n", 1)[0]!;
      expect(detailFirstLine.startsWith(RUNTIME_CONFIG_ENVELOPE_PREFIX)).toBe(true);
      expect(detailFirstLine.slice(RUNTIME_CONFIG_ENVELOPE_PREFIX.length)).toBe(
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
      );
      for (const forbidden of [
        HOSTILE_SELECTED_MODEL_ID,
        stagedFixture.sourceArtifactDir,
        harness.desktop?.userAgentDir ?? "",
        "auth.json",
        "models.json",
        "synara-local-echo",
        "apiKey",
        "baseUrl",
        "prompt",
        "cause",
      ]) {
        if (forbidden.length > 0) {
          expect(detail).not.toContain(forbidden);
        }
      }

      const threadDetail = await harness.waitForThreadDetail(String(threadId));
      expect(threadDetail.thread.session).toMatchObject({
        providerName: "pi",
        status: "error",
        activeTurnId: null,
      });
      const sessionErrorFirstLine = (threadDetail.thread.session?.lastError ?? "").split(
        "\n",
        1,
      )[0]!;
      expect(sessionErrorFirstLine.startsWith(RUNTIME_CONFIG_ENVELOPE_PREFIX)).toBe(true);
      expect(sessionErrorFirstLine.slice(RUNTIME_CONFIG_ENVELOPE_PREFIX.length)).toBe(
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
      );
      expect(threadDetail.thread.piSubagentExecutions).toHaveLength(0);
      expect(harness.observedSessions().size).toBe(0);
      expect(harness.observedCapabilities().size).toBe(0);
      expect(harness.observedAdmissions()).toHaveLength(0);
      expect(harness.modelServer.requestCount()).toBe(0);
    } finally {
      // WAL repair (Ticket 02 draft defect): same post-dispose read as AC2 —
      // the public WS/no-effects assertions above all ran while live.
      const ac5DbPath = harness.dbPath;
      await harness.dispose({ preserveRootDir: true });
      expect(harness.envWasRestored()).toBe(true);

      const ledger = readPiLedgerCounts(ac5DbPath);
      expect(ledger.executions).toBe(0);
      expect(ledger.journal).toBe(0);
      expect(ledger.outbox).toBe(0);
      expect(ledger.batches).toBe(0);
    }
  }, 180_000);

  // AC5 production mapping note: the selected-model leg above proves the
  // fixed RUNTIME-CONFIG failure detail (`createSdkRuntime` failure). The two
  // legs below prove the DISTINCT bounded closed-vocabulary BOOTSTRAP failure
  // detail produced when a verified-looking artifact's real bridge diverges
  // at handshake: `piSubagentDesktopManagedBootstrapFailureDetail` maps the
  // negotiated capability's status + diagnosticCode ONLY — never the hostile
  // detail/extensionVersion/version numbers the artifact supplied.
  it("AC5 (malformed bridge): a self-consistent verified artifact whose real bridge returns a malformed handshake response fails the public turn start with the bounded closed-vocabulary bootstrap detail and zero effects", async () => {
    const malformedArtifactDir = patchHostileHandshakeArtifact(
      "ac5-malformed",
      // The patched return replaces the guarded anchor exactly; the block
      // stays syntactically valid and the extension still registers its
      // real bridge — only the handshake response is hostile.
      `      // ${CANARY_MARKER}: hostile malformed handshake fixture (test-only copy)
      return { totally: "not a handshake response" };`,
    );
    const hostileVerified = await verifyPiSubagentArtifact(malformedArtifactDir);
    expect(hostileVerified.valid).toBe(true);

    const harness = await makeDesktopHarness(malformedArtifactDir);
    try {
      const { threadId } = await createThreadHarnessState(
        harness,
        "ac5-malformed",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "ac5-malformed",
        "Attempt to start against a hostile malformed bridge handshake.",
      );

      const detail = await waitForTurnStartFailureDetail(harness, threadId);
      expect(detail).toContain(
        "Managed Pi subagent harness bootstrap failed (bridge_malformed_response:pi_subagent_bridge_malformed_response)",
      );
      expect(detail.length).toBeLessThanOrEqual(512);
      for (const forbidden of [
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
        "totally",
        "not a handshake response",
        malformedArtifactDir,
        stagedFixture.sourceArtifactDir,
        harness.desktop?.userAgentDir ?? "",
        "auth.json",
        "models.json",
        "synara-local-echo",
        "apiKey",
        "baseUrl",
        "prompt",
        "cause",
      ]) {
        if (forbidden.length > 0) {
          expect(detail).not.toContain(forbidden);
        }
      }

      const threadDetail = await harness.waitForThreadDetail(String(threadId));
      expect(threadDetail.thread.session).toMatchObject({
        providerName: "pi",
        status: "error",
        activeTurnId: null,
      });
      expect(threadDetail.thread.session?.lastError).toContain(
        "(bridge_malformed_response:pi_subagent_bridge_malformed_response)",
      );
      expect(threadDetail.thread.piSubagentExecutions).toHaveLength(0);
      expect(harness.observedSessions().size).toBe(0);
      expect(harness.observedCapabilities().size).toBe(0);
      expect(harness.observedAdmissions()).toHaveLength(0);
      expect(harness.modelServer.requestCount()).toBe(0);
    } finally {
      const malformedDbPath = harness.dbPath;
      await harness.dispose({ preserveRootDir: true });
      expect(harness.envWasRestored()).toBe(true);

      const ledger = readPiLedgerCounts(malformedDbPath);
      expect(ledger.executions).toBe(0);
      expect(ledger.journal).toBe(0);
      expect(ledger.outbox).toBe(0);
      expect(ledger.batches).toBe(0);
    }
  }, 180_000);

  it("AC5 (unsupported bridge): a self-consistent verified artifact whose real bridge rejects the protocol version fails the public turn start with the bounded closed-vocabulary bootstrap detail and zero effects", async () => {
    const unsupportedArtifactDir = patchHostileHandshakeArtifact(
      "ac5-unsupported",
      // Schema-valid failure response with a hostile version demand; the
      // production mapping must surface ONLY the closed status/code pair —
      // never the hostile detail, versions, or extension identity.
      `      // ${CANARY_MARKER}: hostile unsupported-version handshake fixture (test-only copy)
      return {
        ok: false,
        error: "unsupported_version",
        protocolVersion: 99,
        supportedProtocolVersions: [99],
        extensionVersion: EXTENSION_VERSION,
        detail: "Hostile extension demands protocol version 99 with secret/path material sk-hostile-99 /private/hostile",
      };`,
    );
    const hostileVerified = await verifyPiSubagentArtifact(unsupportedArtifactDir);
    expect(hostileVerified.valid).toBe(true);
    assertInnocentStackNumberIsAllowed();

    const harness = await makeDesktopHarness(unsupportedArtifactDir);
    try {
      const { threadId } = await createThreadHarnessState(
        harness,
        "ac5-unsupported",
        DETERMINISTIC_DRIVER_MODEL_ID,
      );
      await startTurn(
        harness,
        threadId,
        "ac5-unsupported",
        "Attempt to start against a hostile unsupported-protocol bridge handshake.",
      );

      const detail = await waitForTurnStartFailureDetail(harness, threadId);
      expect(detail).toContain(
        "Managed Pi subagent harness bootstrap failed (unsupported_version:pi_subagent_unsupported_version)",
      );
      expect(detail.length).toBeLessThanOrEqual(512);
      assertNoHostileProtocolVersion(detail);
      for (const forbidden of [
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
        "Hostile extension demands",
        HOSTILE_PROTOCOL_SECRET,
        HOSTILE_PROTOCOL_PATH,
        unsupportedArtifactDir,
        stagedFixture.sourceArtifactDir,
        harness.desktop?.userAgentDir ?? "",
        "auth.json",
        "models.json",
        "synara-local-echo",
        "apiKey",
        "baseUrl",
        "prompt",
        "cause",
      ]) {
        if (forbidden.length > 0) {
          expect(detail).not.toContain(forbidden);
        }
      }

      const threadDetail = await harness.waitForThreadDetail(String(threadId));
      expect(threadDetail.thread.session).toMatchObject({
        providerName: "pi",
        status: "error",
        activeTurnId: null,
      });
      expect(threadDetail.thread.session?.lastError).toContain(
        "(unsupported_version:pi_subagent_unsupported_version)",
      );
      assertNoHostileProtocolVersion(threadDetail.thread.session?.lastError ?? "");
      expect(threadDetail.thread.piSubagentExecutions).toHaveLength(0);
      expect(harness.observedSessions().size).toBe(0);
      expect(harness.observedCapabilities().size).toBe(0);
      expect(harness.observedAdmissions()).toHaveLength(0);
      expect(harness.modelServer.requestCount()).toBe(0);
    } finally {
      const unsupportedDbPath = harness.dbPath;
      await harness.dispose({ preserveRootDir: true });
      expect(harness.envWasRestored()).toBe(true);

      const ledger = readPiLedgerCounts(unsupportedDbPath);
      expect(ledger.executions).toBe(0);
      expect(ledger.journal).toBe(0);
      expect(ledger.outbox).toBe(0);
      expect(ledger.batches).toBe(0);
    }
  }, 180_000);
});
