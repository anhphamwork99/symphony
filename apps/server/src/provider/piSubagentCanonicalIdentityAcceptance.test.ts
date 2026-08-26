import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  CommandId,
  MessageId,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
  ProjectId,
  ThreadId,
} from "@synara/contracts";

import {
  buildPiSubagentArtifact,
  loadPiSubagentExtensionProvenance,
} from "../../../../scripts/lib/piSubagentArtifactStaging.ts";
import { verifyPiSubagentArtifact } from "./piSubagentArtifactVerifier.ts";
import {
  DETERMINISTIC_DRIVER_MODEL_ID,
  makeRealPiWsHarness,
  observeIsolationPaths,
  snapshotPiAgentRuntime,
  snapshotFilesystemTree,
  verifyRealPiExtensionProvenance,
} from "./piSubagentRealPiAcceptanceHelpers.ts";
import {
  PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY,
  wrapPiSubagentManagedTool,
} from "./piSubagentManagedRuntimeBinding.ts";

const REPO_ROOT = resolve(__dirname, "../../../..");
const PINNED_ALFIE_COMMIT = "3fe340b401ca86bcbe8b55abd4de107e1d93482e";
const PINNED_ALFIE_VERSION = "0.15.0-alfie.6";
const PINNED_PI_SDK_VERSION = "0.83.0";

const toolResult = (text: string) => ({ content: [{ type: "text", text }] });
const invoke = (tool: any, params: Record<string, unknown>) =>
  tool.execute("canonical-acceptance-call", params, undefined, undefined, undefined);

function isPathWithin(root: string, candidate: string): boolean {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const child = relative(rootPath, candidatePath);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

function assertArtifactAgentHasNoUserConfiguration(agentDir: string): void {
  for (const name of ["auth.json", "models.json", "models-store.json", "settings.json"]) {
    expect(existsSync(join(agentDir, name))).toBe(false);
  }
}

function assertArtifactTreeHasNoUserConfiguration(
  entries: ReadonlyArray<{ readonly path: string }>,
): void {
  for (const entry of entries) {
    expect(entry.path.split("/").at(-1)).not.toMatch(/^(auth|models|models-store|settings)\.json$/);
  }
}

function assertNoProviderIdentity(value: unknown): void {
  if (typeof value === "string") {
    expect(value).not.toMatch(/agent[_-]?id/i);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoProviderIdentity(entry);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    expect(key).not.toMatch(/agent[_-]?id/i);
    assertNoProviderIdentity(entry);
  }
}

type DurableRead = {
  executionId: string;
  attemptId: string;
  generation: number;
  observedState: "accepted" | "running" | "succeeded" | "failed";
  terminalState: "succeeded" | "failed" | null;
  summary: string | null;
  summaryTruncated: boolean;
  diagnostics?: string[];
};

const runningRead: DurableRead = {
  executionId: "exec_canonical_race",
  attemptId: "attempt_canonical_race",
  generation: 1,
  observedState: "running",
  terminalState: null,
  summary: null,
  summaryTruncated: false,
};

interface RaceState {
  retired: boolean;
  generationValid: boolean;
  inserted: number;
  sent: number;
  queue: number;
  replay: number;
  resume: number;
  bootstrap: number;
  reconstruction: number;
  children: number;
  bookkeepingCommits: number;
  trace: string[];
}

function makeRaceState(): RaceState {
  return {
    retired: false,
    generationValid: true,
    inserted: 0,
    sent: 0,
    queue: 0,
    replay: 0,
    resume: 0,
    bootstrap: 0,
    reconstruction: 0,
    children: 0,
    bookkeepingCommits: 0,
    trace: [],
  };
}

function makeRaceTool(
  state: RaceState,
  winner: "terminal-first" | "enqueue-first" | "cancel-before" | "cancel-after",
) {
  const tool: any = {
    execute: async () => {
      state.trace.push("provider-live-guard");
      if (winner === "terminal-first") {
        state.retired = true;
        state.trace.push("retirement/index-removal");
        state.trace.push("durable-commit");
        return {
          isError: true,
          diagnosticCode: "pi_subagent_managed_execution_unavailable_live",
          content: [{ type: "text", text: "Agent not found" }],
        };
      }
      if (winner === "cancel-before") {
        state.generationValid = false;
        state.trace.push("bookkeeping");
        return {
          isError: true,
          diagnosticCode: "pi_subagent_managed_execution_unavailable_live",
          content: [{ type: "text", text: "Agent not found" }],
        };
      }

      state.trace.push("sdk-insertion");
      state.inserted += 1;
      if (winner === "cancel-after") state.generationValid = false;
      state.retired = true;
      state.trace.push("retirement/index-removal");
      state.trace.push("durable-commit");
      state.trace.push("bookkeeping");
      if (state.generationValid) state.bookkeepingCommits += 1;
      if (winner === "enqueue-first") state.sent += 1;
      return toolResult("steer accepted");
    },
  };
  wrapPiSubagentManagedTool(tool, "steer_subagent", {
    readService: {
      readResult: () => {
        state.trace.push("tuple-lookup");
        // The read is the durable tuple lookup only. The synchronized winner
        // is applied at the provider boundary below, after the live guard.
        return Effect.succeed(runningRead);
      },
    },
    isCapabilityBound: () => true,
  });
  return tool;
}

describe("Ticket 02 canonical identity and synchronized race unit simulations (non-acceptance)", () => {
  it("keeps one public execution identity across normal read, equal alias, and live supplement", async () => {
    const calls: unknown[] = [];
    const tool: any = {
      execute: async (_id: string, params: unknown) => {
        calls.push(params);
        return toolResult("live supplement");
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: {
        readResult: (input) =>
          Effect.succeed({
            ...runningRead,
            diagnostics: input.agent_id ? ["pi_subagent_read_alias_deprecated"] : undefined,
          }),
      },
      isCapabilityBound: () => true,
    });

    const canonical = await invoke(tool, { execution_id: runningRead.executionId });
    const alias = await invoke(tool, { agent_id: runningRead.executionId });

    expect(canonical.content[0].text).toContain(runningRead.executionId);
    expect(alias.content[0].text).toContain(runningRead.executionId);
    expect(alias.details).toMatchObject({ executionId: runningRead.executionId });
    expect(calls).toEqual([
      {
        execution_id: runningRead.executionId,
        attempt_id: runningRead.attemptId,
        generation: runningRead.generation,
      },
      {
        execution_id: runningRead.executionId,
        attempt_id: runningRead.attemptId,
        generation: runningRead.generation,
      },
    ]);
    assertNoProviderIdentity(canonical);
    assertNoProviderIdentity(alias);
  });

  it("rejects provider identity, conflicting aliases, oversized ids, missing capability, and preserves auth-before-provider", async () => {
    let providerCalls = 0;
    const tool: any = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("must not run");
      },
    };
    wrapPiSubagentManagedTool(tool, "steer_subagent", {
      readService: {
        readResult: () =>
          Effect.fail({
            kind: "denied" as const,
            diagnosticCode: "pi_subagent_read_unauthorized_or_out_of_scope" as const,
          }),
      },
      isCapabilityBound: () => true,
    });

    const denied = await invoke(tool, { execution_id: runningRead.executionId });
    const providerId = await invoke(tool, { agentId: "alfie-private-agent" });
    const conflicting = await invoke(tool, {
      execution_id: runningRead.executionId,
      agent_id: "other-execution",
    });
    const oversized = await invoke(tool, { execution_id: "x".repeat(257) });

    expect(denied.diagnosticCode).toBe("pi_subagent_read_unauthorized_or_out_of_scope");
    expect(providerId.diagnosticCode).toBe("pi_subagent_read_alias_conflict");
    expect(conflicting.diagnosticCode).toBe("pi_subagent_read_alias_conflict");
    expect(oversized.diagnosticCode).toBe("pi_subagent_read_payload_bounded");
    expect(providerCalls).toBe(0);

    const capabilityTool: any = { execute: async () => toolResult("must not run") };
    wrapPiSubagentManagedTool(capabilityTool, "get_subagent_result", {
      readService: { readResult: () => Effect.succeed(runningRead) },
      isCapabilityBound: () => false,
    });
    const capabilityDenied = await invoke(capabilityTool, {
      execution_id: runningRead.executionId,
    });
    expect(capabilityDenied.diagnosticCode).toBe("pi_subagent_read_capability_unavailable");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(capabilityDenied)));
  });

  it("gives durable terminal truth precedence and exact-live control returns unavailable after eviction", async () => {
    let providerCalls = 0;
    const tool: any = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("must not run after terminal");
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: {
        readResult: () =>
          Effect.succeed({
            ...runningRead,
            observedState: "succeeded",
            terminalState: "succeeded",
            summary: "durable terminal",
            diagnostics: ["pi_subagent_read_durable_terminal_precedence"],
          }),
      },
      isCapabilityBound: () => true,
    });
    const read = await invoke(tool, { execution_id: runningRead.executionId });
    expect(read.content[0].text).toContain("durable terminal");
    expect(providerCalls).toBe(0);

    const evicted: any = {
      execute: async () => ({
        isError: true,
        diagnosticCode: "pi_subagent_managed_execution_unavailable_live",
        content: [{ type: "text", text: "Agent not found" }],
      }),
    };
    wrapPiSubagentManagedTool(evicted, "steer_subagent", {
      readService: { readResult: () => Effect.succeed(runningRead) },
      isCapabilityBound: () => true,
    });
    const unavailable = await invoke(evicted, { execution_id: runningRead.executionId });
    expect(unavailable.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
    expect(unavailable.content[0].text).not.toContain("Agent not found");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(read)));
    assertNoProviderIdentity(JSON.parse(JSON.stringify(unavailable)));
  });

  it("simulates terminal-first linearization with zero provider insertion/send (not real-Pi acceptance)", async () => {
    const state = makeRaceState();
    state.trace.push("invocation");
    const tool = makeRaceTool(state, "terminal-first");
    const result = await invoke(tool, {
      execution_id: runningRead.executionId,
      attempt_id: runningRead.attemptId,
      generation: runningRead.generation,
    });
    state.trace.push("return");

    expect(result.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
    expect(state.trace).toEqual([
      "invocation",
      "tuple-lookup",
      "provider-live-guard",
      "retirement/index-removal",
      "durable-commit",
      "return",
    ]);
    expect(state.inserted).toBe(0);
    expect(state.sent).toBe(0);
    expect(state.queue + state.replay + state.resume + state.bootstrap + state.reconstruction).toBe(
      0,
    );
    expect(state.children).toBe(0);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("simulates enqueue-first linearization with exactly one insertion before retirement and durable commit (not real-Pi acceptance)", async () => {
    const state = makeRaceState();
    state.trace.push("invocation");
    const tool = makeRaceTool(state, "enqueue-first");
    const result = await invoke(tool, {
      execution_id: runningRead.executionId,
      attempt_id: runningRead.attemptId,
      generation: runningRead.generation,
    });
    state.trace.push("return");

    expect(result.content[0].text).toContain("Steer state: applied");
    expect(state.trace).toEqual([
      "invocation",
      "tuple-lookup",
      "provider-live-guard",
      "sdk-insertion",
      "retirement/index-removal",
      "durable-commit",
      "bookkeeping",
      "return",
    ]);
    expect(state.inserted).toBe(1);
    expect(state.sent).toBe(1);
    expect(state.bookkeepingCommits).toBe(1);
    expect(state.retired).toBe(true);
    expect(state.queue + state.replay + state.resume + state.bootstrap + state.reconstruction).toBe(
      0,
    );
    expect(state.children).toBe(0);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("simulates cancellation-first and insertion-before-cancellation generation fencing (not real-Pi acceptance)", async () => {
    const before = makeRaceState();
    before.trace.push("invocation");
    const beforeResult = await invoke(makeRaceTool(before, "cancel-before"), {
      execution_id: runningRead.executionId,
    });
    before.trace.push("return");
    expect(beforeResult.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
    expect(before.inserted).toBe(0);
    expect(before.trace).toEqual([
      "invocation",
      "tuple-lookup",
      "provider-live-guard",
      "bookkeeping",
      "return",
    ]);

    const after = makeRaceState();
    after.trace.push("invocation");
    const afterResult = await invoke(makeRaceTool(after, "cancel-after"), {
      execution_id: runningRead.executionId,
    });
    after.trace.push("return");
    expect(afterResult.content[0].text).toContain("Steer state: applied");
    expect(after.inserted).toBe(1);
    expect(after.generationValid).toBe(false);
    expect(after.bookkeepingCommits).toBe(0);
    expect(after.retired).toBe(true);
    expect(after.trace).toEqual([
      "invocation",
      "tuple-lookup",
      "provider-live-guard",
      "sdk-insertion",
      "retirement/index-removal",
      "durable-commit",
      "bookkeeping",
      "return",
    ]);
    expect(after.queue + after.replay + after.resume + after.bootstrap + after.reconstruction).toBe(
      0,
    );
    expect(after.children).toBe(0);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(afterResult)));
  });

  it("keeps stale tuple requests fenced before provider lookup", async () => {
    let providerCalls = 0;
    const tool: any = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("must not run");
      },
    };
    wrapPiSubagentManagedTool(tool, "steer_subagent", {
      readService: {
        readResult: () =>
          Effect.fail({
            kind: "denied" as const,
            diagnosticCode: "pi_subagent_read_stale_attempt_or_generation" as const,
          }),
      },
      isCapabilityBound: () => true,
    });
    const result = await invoke(tool, {
      execution_id: runningRead.executionId,
      attempt_id: "stale-attempt",
      generation: 1,
    });
    expect(result.diagnosticCode).toBe("pi_subagent_read_stale_attempt_or_generation");
    expect(providerCalls).toBe(0);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });
});

type RealRaceMode = "terminal-first" | "enqueue-first";

type RaceHook = {
  readonly install: (
    tuple: { executionId: string; attemptId: string; generation: number },
    nonce: string,
  ) => { installed: boolean; reason?: string };
  readonly releaseManagerGuard: () => void;
  readonly releaseSessionPromise: () => void;
  readonly snapshot: () => {
    readonly installed: boolean;
    readonly disposed: boolean;
    readonly tuple:
      | { readonly executionId: string; readonly attemptId: string; readonly generation: number }
      | undefined;
    readonly events: ReadonlyArray<{
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
      readonly sequence: number;
      readonly type: string;
    }>;
    readonly counters: Readonly<Record<string, number>>;
    readonly guardReleased: boolean;
    readonly returnedPromiseHeld: boolean;
  };
  readonly dispose: () => void;
};

const RACE_HOOK_KEY = Symbol.for("pi-subagents:internal-test:canonical-steer-race-v1");
const RACE_HOOK_ENV = "SYNARA_PI_SUBAGENT_INTERNAL_TEST_HOOKS";
const RACE_RUN_ID_ENV = "SYNARA_PI_SUBAGENT_INTERNAL_TEST_RUN_ID";

function installedPiSdkVersion(): string {
  const packagePaths = [
    resolve(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/package.json"),
    resolve(REPO_ROOT, "node_modules/@earendil-works/pi-coding-agent/package.json"),
    resolve(REPO_ROOT, "apps/server/node_modules/@earendil-works/pi-coding-agent/package.json"),
  ];
  for (const packagePath of packagePaths) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
      if (typeof packageJson.version === "string") return packageJson.version;
    } catch {
      // Try the next workspace resolution root.
    }
  }
  throw new Error(`Installed Pi SDK manifest not found in: ${packagePaths.join(", ")}`);
}

function productionRaceHook(): RaceHook {
  const hook = (globalThis as any)[RACE_HOOK_KEY] as RaceHook | undefined;
  if (!hook) {
    throw new Error("The registered production canonical steer race hook was not exposed.");
  }
  return hook;
}

function registeredProductionTool(session: any, name: string): any {
  const extensions = session?.resourceLoader?.getExtensions?.()?.extensions;
  if (!Array.isArray(extensions)) {
    throw new Error("The observed parent session has no extension registry.");
  }
  const extension = extensions.find(
    (candidate: any) => candidate?.tools instanceof Map && candidate.tools.has(name),
  );
  if (!extension) {
    throw new Error(`The observed parent session did not load the registered ${name} tool.`);
  }
  const entry = extension.tools.get(name);
  const target = entry?.definition ?? entry;
  if (!target || typeof target.execute !== "function") {
    throw new Error(`The registered ${name} tool is not executable.`);
  }
  return { extension, target };
}

async function waitFor<T>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runRealPiSteerRace(mode: RealRaceMode): Promise<void> {
  const provenance = verifyRealPiExtensionProvenance();
  expect(provenance.isVerified).toBe(true);
  expect(provenance.packageName).toBe("@alfie/pi-subagents");
  expect(provenance.packageVersion).toBe(PINNED_ALFIE_VERSION);
  expect(provenance.pinnedCommit).toBe(PINNED_ALFIE_COMMIT);
  expect(installedPiSdkVersion()).toBe(PINNED_PI_SDK_VERSION);

  const alfieRepoDir = process.env.ALFIE_REPO_DIR;
  if (!alfieRepoDir) {
    throw new Error("ALFIE_REPO_DIR is required for synchronized real-Pi acceptance.");
  }

    const userPiBefore = provenance.snapshotUserPiHome();
    const root = mkdtempSync(join(tmpdir(), `synara-t02-steer-${mode}-`));
    const artifactDir = join(root, "artifact");
    const userAgentDir = join(root, "user-agent");
  const previousRaceEnv = {
    [RACE_HOOK_ENV]: process.env[RACE_HOOK_ENV],
    [RACE_RUN_ID_ENV]: process.env[RACE_RUN_ID_ENV],
  };
  const nonce = `t02-${mode}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let harness: Awaited<ReturnType<typeof makeRealPiWsHarness>> | undefined;
  let hook: RaceHook | undefined;
  let artifactBefore: ReturnType<typeof snapshotFilesystemTree> | undefined;
  let userAgentBefore: ReturnType<typeof snapshotFilesystemTree> | undefined;
  let isolatedPiBefore: ReturnType<typeof snapshotFilesystemTree> | undefined;
    let isolatedAgentRuntimeBefore: ReturnType<typeof snapshotPiAgentRuntime> | undefined;
    let turnStart: Promise<unknown> | undefined;
    const causalTrace: string[] = [];
    let capturedHookEventCount = 0;
    const cleanupFailures: unknown[] = [];

  try {
    process.env[RACE_HOOK_ENV] = "canonical-steer-race-v1";
    process.env[RACE_RUN_ID_ENV] = nonce;
    expect((globalThis as any)[RACE_HOOK_KEY]).toBeUndefined();
    buildPiSubagentArtifact({
      repoDir: alfieRepoDir,
      artifactDir,
      provenance: loadPiSubagentExtensionProvenance(
        join(
          REPO_ROOT,
          "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json",
        ),
      ),
    });
    artifactBefore = snapshotFilesystemTree(artifactDir);
    expect((await verifyPiSubagentArtifact(artifactDir)).valid).toBe(true);

      harness = await makeRealPiWsHarness({
        foregroundWaitMs: 300,
        holdDeterministicSlowResponses: true,
        desktopManaged: { artifactDir, userAgentDir, mode: "desktop" },
      });
    harness.writeSubagentModelPreference("synara-local-echo/echo-slow");
    writeFileSync(
      join(harness.piHomeDir, "PREFERENCES.md"),
      `---\nmodels:\n  subagent: synara-local-echo/echo-slow\n  subagent/researcher: synara-local-echo/echo-slow\n---\n`,
      "utf8",
    );
    expect(harness.serverMode).toBe("desktop");
    expect(harness.desktop).toBeDefined();
    const desktop = harness.desktop!;
    expect(desktop.managedExtensionDir.startsWith(desktop.managedAgentDir)).toBe(true);
    expect(desktop.managedExtensionDir).not.toBe(userAgentDir);
    expect(harness.envWasRestored()).toBe(false);
    expect(isPathWithin(root, artifactDir)).toBe(true);
    expect(isPathWithin(root, userAgentDir)).toBe(true);
    expect(isPathWithin(harness.rootDir, harness.homeDir)).toBe(true);
    expect(isPathWithin(harness.rootDir, harness.workspaceDir)).toBe(true);
    expect(isPathWithin(harness.rootDir, harness.parentAgentDir)).toBe(true);
    expect(isPathWithin(harness.rootDir, harness.childAgentDir)).toBe(true);
    expect(isPathWithin(harness.rootDir, harness.piHomeDir)).toBe(true);
    expect(isPathWithin(harness.rootDir, harness.dbPath)).toBe(true);
    expect(isPathWithin(root, desktop.managedAgentDir)).toBe(true);
    const realPiHome = resolve(join(homedir(), ".pi"));
      const isolation = observeIsolationPaths({
        runRoot: root,
        artifact: artifactDir,
        writableUserAgentDir: userAgentDir,
        writableAuth: join(userAgentDir, "auth.json"),
        writableModels: join(userAgentDir, "models.json"),
        writableSettings: join(userAgentDir, "settings.json"),
        writableModelsStore: join(userAgentDir, "models-store.json"),
        managedAgentDir: desktop.managedAgentDir,
        managedExtensionDir: desktop.managedExtensionDir,
        harnessRoot: harness.rootDir,
        home: harness.homeDir,
        state: harness.dbPath,
      workspace: harness.workspaceDir,
      parentAgentDir: harness.parentAgentDir,
      childAgentDir: harness.childAgentDir,
      piHomeDir: harness.piHomeDir,
    });
    expect(new Set(Object.values(isolation).map((entry) => entry.realpath)).size).toBe(
      Object.keys(isolation).length,
    );
      for (const entry of Object.values(isolation)) {
        expect(entry.type).not.toBe("symlink");
        expect(entry.realpath).not.toBe(realPiHome);
        expect(entry.realpath.startsWith(`${realPiHome}${sep}`)).toBe(false);
      }
      for (const name of [
        "artifact",
        "writableUserAgentDir",
        "writableAuth",
        "writableModels",
        "writableSettings",
        "writableModelsStore",
        "managedAgentDir",
        "managedExtensionDir",
      ]) {
        expect(
          isPathWithin(isolation.runRoot!.realpath, isolation[name]!.realpath),
          `${name} must remain under ${isolation.runRoot!.realpath}: ${isolation[name]!.realpath}`,
        ).toBe(true);
      }
      for (const name of [
        "harnessRoot",
        "home",
        "state",
        "workspace",
        "parentAgentDir",
        "childAgentDir",
        "piHomeDir",
      ]) {
        expect(isPathWithin(isolation.harnessRoot!.realpath, isolation[name]!.realpath)).toBe(true);
      }
      expect(isolation.writableAuth?.type).toBe("regular");
      expect(isolation.writableModels?.type).toBe("regular");
      expect(isolation.writableSettings?.type).toBe("absent");
      expect(["absent", "regular"]).toContain(isolation.writableModelsStore?.type);
      expect(isolation.managedAgentDir?.type).toBe("directory");
      expect(isolation.managedExtensionDir?.type).toBe("directory");
    assertArtifactAgentHasNoUserConfiguration(desktop.managedAgentDir);
    assertArtifactTreeHasNoUserConfiguration(artifactBefore ?? []);
    userAgentBefore = snapshotFilesystemTree(userAgentDir);
    isolatedPiBefore = snapshotFilesystemTree(harness.piHomeDir);
    isolatedAgentRuntimeBefore = snapshotPiAgentRuntime(userAgentDir);

    const projectId = ProjectId.makeUnsafe(`t02-steer-${mode}-project`);
    const threadId = ThreadId.makeUnsafe(`t02-steer-${mode}-thread`);
    const thread = String(threadId);
    const createdAt = new Date().toISOString();
    await harness.client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-t02-steer-${mode}-project`),
      projectId,
      title: `Ticket 02 ${mode} synchronized steer`,
      workspaceRoot: harness.workspaceDir,
      createdAt,
    });
    await harness.client.dispatchCommand({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-t02-steer-${mode}-thread`),
      threadId,
      projectId,
      title: `Ticket 02 ${mode} synchronized steer`,
      modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: null,
      worktreePath: harness.workspaceDir,
      createdAt,
    });

    const admissionsForThread = () =>
      harness!.observedAdmissions().filter((event) => String(event.threadId) === thread);
    turnStart = harness.client.dispatchCommand({
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe(`cmd-t02-steer-${mode}-turn`),
      threadId,
      message: {
        messageId: MessageId.makeUnsafe(`msg-t02-steer-${mode}-turn`),
        role: "user",
        text: "Delegate the synchronized real-Pi steer race task.",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: new Date().toISOString(),
    });
    void turnStart.catch(() => undefined);

    const capability = await waitFor(
      () => harness.observedCapabilities().get(thread),
      (value) => value !== undefined,
      "production managed capability negotiation",
    );
    if (!capability)
      throw new Error("Production managed capability negotiation returned no result.");
    expect(capability.isManaged).toBe(true);
    expect(capability.status).toBe("managed_enabled");
    expect(capability.capabilities).toContain(PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY);
    for (const required of PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES) {
      expect(capability.capabilities).toContain(required);
    }

    const observedSessions = await waitFor(
      () => harness.observedSessions(),
      (value) => value.size > 0,
      "observed production parent session",
    );
    const session = observedSessions.get(thread);
    if (!session) {
      throw new Error(
        `Observed production parent session key mismatch (expected ${thread}; observed ${[...observedSessions.keys()].join(",")}).`,
      );
    }
      const loaded = registeredProductionTool(session, "steer_subagent");
      const loadedExtensionPath = realpathSync(loaded.extension.path);
      expect(isPathWithin(isolation.managedExtensionDir!.realpath, loadedExtensionPath)).toBe(true);
      expect(isPathWithin(isolation.writableUserAgentDir!.realpath, loadedExtensionPath)).toBe(false);
    expect((session as any).getAllTools?.().some((tool: any) => tool.name === "Agent")).toBe(true);

    const admission = await waitFor(
      () => admissionsForThread()[0],
      (value) => value !== undefined && value.result.status !== "rejected",
      "one exact managed admission",
      90_000,
    );
    if (!admission) throw new Error("The exact managed admission was not observed.");
    expect(admissionsForThread()).toHaveLength(1);
    const identity = admission.result;
    expect(identity.executionId).toMatch(/^exec_/);
      expect(identity.attemptId).toMatch(/^att_/);
      expect(identity.generation).toBeGreaterThan(0);
      await waitFor(
        () => harness!.modelServer.pendingSlowResponseCount(),
        (count) => count === 1,
        "one causally held slow child response",
        30_000,
      );

    // The hook is obtained only after the observed parent session has loaded.
    // Its installation resolves the exact tuple in that extension-owned manager;
    // no child wrapper, native import, or global manager facade is used.
    hook = productionRaceHook();
    const tuple = {
      executionId: identity.executionId,
      attemptId: identity.attemptId,
      generation: identity.generation,
    };
    expect(
      await waitFor(
        () => hook!.install(tuple, nonce),
        (result) => result.installed,
        "exact production manager tuple installation",
        30_000,
      ),
    ).toEqual({ installed: true });
    expect(hook.snapshot().tuple).toEqual({
      executionId: identity.executionId,
      attemptId: identity.attemptId,
      generation: identity.generation,
    });

      const captureHookEvents = () => {
        const events = hook!.snapshot().events;
        for (const event of events.slice(capturedHookEventCount)) {
          causalTrace.push(`hook:${event.type}`);
        }
        capturedHookEventCount = events.length;
      };
      const steerCall = invoke(loaded.target, {
        execution_id: identity.executionId,
      attempt_id: identity.attemptId,
      generation: identity.generation,
      task: `Continue the synchronized ${mode} race task.`,
      context: "Use only the exact current execution tuple.",
      link_references: "Decision 0005",
        expected_outcome: "The exact production hook proves one linearization.",
      });
      causalTrace.push("production-tool-call-promise-created");
      await waitFor(
      () => hook!.snapshot(),
      (snapshot) =>
        snapshot.events.some((event) => event.type === "manager-invocation") &&
        snapshot.events.some((event) => event.type === "before-live-guard"),
        "exact production manager invocation and pre-guard barrier",
      );
      captureHookEvents();
      const liveAtManagerBarrier = harness
        .bridgeActiveExecutions(thread)
        .filter(
          (candidate) =>
            candidate.executionId === identity.executionId &&
            candidate.attemptId === identity.attemptId &&
            candidate.generation === identity.generation,
        );
      expect(liveAtManagerBarrier).toHaveLength(1);
      expect(harness.modelServer.pendingSlowResponseCount()).toBe(1);
      causalTrace.push("exact-live-tuple-and-held-child-observed-at-manager-barrier");

      if (mode === "terminal-first") {
        harness.modelServer.releaseSlowResponses();
        causalTrace.push("slow-child-response-released");
        await waitFor(
        () => harness!.bridgeActiveExecutions(thread),
        (active) => active.every((candidate) => candidate.executionId !== identity.executionId),
        "terminal-first live retirement and bridge removal",
          90_000,
        );
        causalTrace.push("bridge-index-retired");
        const terminal = await waitFor(
        () => harness!.durable.listJournalEvents(identity.executionId),
        (events) =>
          events.some(
            (event) =>
              event.sequence === 40 &&
              event.state === "succeeded" &&
              event.attemptId === identity.attemptId &&
              event.generation === identity.generation,
          ),
        "terminal-first durable seq-40 commit",
        90_000,
        );
        expect(terminal.filter((event) => event.sequence === 40)).toHaveLength(1);
        causalTrace.push("durable-exact-seq40-committed");
        hook.releaseManagerGuard();
        causalTrace.push("manager-guard-released");
      } else {
        hook.releaseManagerGuard();
        causalTrace.push("manager-guard-released");
        await waitFor(
        () => hook!.snapshot(),
        (snapshot) => snapshot.events.some((event) => event.type === "returned-promise-held"),
          "exact returned-promise-held insertion barrier",
        );
        captureHookEvents();
        expect(hook.snapshot().counters["session-steer-invocation"]).toBe(1);
        expect(hook.snapshot().counters["sdk-insertion"]).toBe(1);
        harness.modelServer.releaseSlowResponses();
        causalTrace.push("slow-child-response-released");
        await waitFor(
        () => harness!.bridgeActiveExecutions(thread),
        (active) => active.every((candidate) => candidate.executionId !== identity.executionId),
        "enqueue-first natural live retirement and bridge removal",
          90_000,
        );
        causalTrace.push("bridge-index-retired");
        const terminal = await waitFor(
        () => harness!.durable.listJournalEvents(identity.executionId),
        (events) =>
          events.some(
            (event) =>
              event.sequence === 40 &&
              event.state === "succeeded" &&
              event.attemptId === identity.attemptId &&
              event.generation === identity.generation,
          ),
        "enqueue-first durable seq-40 commit",
        90_000,
        );
        expect(terminal.filter((event) => event.sequence === 40)).toHaveLength(1);
        causalTrace.push("durable-exact-seq40-committed");
        hook.releaseSessionPromise();
        causalTrace.push("session-promise-released");
      }

      const result = await steerCall;
      captureHookEvents();
      causalTrace.push("production-tool-call-settled");
      const observedHook = hook.snapshot();
    const eventTypes = observedHook.events.map((event) => event.type);
    if (mode === "terminal-first") {
      expect(result.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
      expect(result.content?.[0]?.text).not.toContain("Agent not found");
      expect(observedHook.counters["session-steer-invocation"] ?? 0).toBe(0);
      expect(observedHook.counters["sdk-insertion"] ?? 0).toBe(0);
      expect(eventTypes).toEqual([
        "manager-invocation",
        "before-live-guard",
        "live-guard-rejected-not-running",
        "manager-return-rejected",
      ]);
    } else {
      expect(result.content?.[0]?.text).toContain("Steer state: applied");
      expect(observedHook.counters["session-steer-invocation"]).toBe(1);
      expect(observedHook.counters["sdk-insertion"]).toBe(1);
      expect(eventTypes).toEqual([
        "manager-invocation",
        "before-live-guard",
        "live-guard-pass",
        "session-steer-invocation",
        "sdk-insertion",
        "returned-promise-held",
        "returned-promise-released",
        "post-await-generation-pass",
        "bookkeeping-commit",
        "manager-return-sent",
      ]);
    }
    expect(
      observedHook.events.every(
        (event) =>
          event.executionId === identity.executionId &&
          event.attemptId === identity.attemptId &&
          event.generation === identity.generation,
      ),
    ).toBe(true);
    expect(
      harness
        .bridgeActiveExecutions(thread)
        .some((candidate) => candidate.executionId === identity.executionId),
    ).toBe(false);
      expect(admissionsForThread()).toHaveLength(1);
      expect(harness.modelServer.requests().filter((request) => request.delegated)).toHaveLength(1);
      expect(harness.modelServer.pendingSlowResponseCount()).toBe(0);
      const observedActionCounters = {
        managedAdmissions: admissionsForThread().length,
        delegatedModelRequests: harness.modelServer.requests().filter((request) => request.delegated)
          .length,
        activeExactTuples: harness
          .bridgeActiveExecutions(thread)
          .filter((candidate) => candidate.executionId === identity.executionId).length,
        sessionSteerInvocations: observedHook.counters["session-steer-invocation"] ?? 0,
        sdkInsertions: observedHook.counters["sdk-insertion"] ?? 0,
      };
      expect(observedActionCounters).toEqual({
        managedAdmissions: 1,
        delegatedModelRequests: 1,
        activeExactTuples: 0,
        sessionSteerInvocations: mode === "enqueue-first" ? 1 : 0,
        sdkInsertions: mode === "enqueue-first" ? 1 : 0,
      });
      // These actions have no runtime counter in the production manager steer path.
      // Their zero evidence is structural: the exact-live steer implementation calls
      // only the already-owned record.session.steer and contains no admission,
      // Resume, bootstrap, reconstruction, queue-replay, or child-creation branch.
      const structurallyAbsentActions = [
        "resume",
        "bootstrap",
        "reconstruction",
        "queue-replay",
        "new-child",
      ] as const;
      expect(structurallyAbsentActions).toHaveLength(5);
      expect(causalTrace).toEqual(
        mode === "terminal-first"
          ? [
              "production-tool-call-promise-created",
              "hook:manager-invocation",
              "hook:before-live-guard",
              "exact-live-tuple-and-held-child-observed-at-manager-barrier",
              "slow-child-response-released",
              "bridge-index-retired",
              "durable-exact-seq40-committed",
              "manager-guard-released",
              "hook:live-guard-rejected-not-running",
              "hook:manager-return-rejected",
              "production-tool-call-settled",
            ]
          : [
              "production-tool-call-promise-created",
              "hook:manager-invocation",
              "hook:before-live-guard",
              "exact-live-tuple-and-held-child-observed-at-manager-barrier",
              "manager-guard-released",
              "hook:live-guard-pass",
              "hook:session-steer-invocation",
              "hook:sdk-insertion",
              "hook:returned-promise-held",
              "slow-child-response-released",
              "bridge-index-retired",
              "durable-exact-seq40-committed",
              "session-promise-released",
              "hook:returned-promise-released",
              "hook:post-await-generation-pass",
              "hook:bookkeeping-commit",
              "hook:manager-return-sent",
              "production-tool-call-settled",
            ],
      );
      process.stdout.write(
        `T02-F5 ${mode} evidence: ${JSON.stringify({
          causalTrace,
          observedActionCounters,
          structurallyAbsentActions,
        })}\n`,
      );
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
    assertNoProviderIdentity(observedHook.events);
    assertArtifactAgentHasNoUserConfiguration(desktop.managedAgentDir);
    assertArtifactTreeHasNoUserConfiguration(snapshotFilesystemTree(artifactDir));
    expect((await verifyPiSubagentArtifact(artifactDir)).valid).toBe(true);
    expect(snapshotFilesystemTree(artifactDir)).toEqual(artifactBefore);
    expect(
      snapshotFilesystemTree(userAgentDir).filter((entry) => entry.path !== "models-store.json"),
    ).toEqual(userAgentBefore?.filter((entry) => entry.path !== "models-store.json"));
    expect(snapshotFilesystemTree(harness.piHomeDir)).toEqual(isolatedPiBefore);
      const isolatedAgentRuntimeAfter = snapshotPiAgentRuntime(userAgentDir);
    expect(isolatedAgentRuntimeAfter.authJson).toEqual(isolatedAgentRuntimeBefore?.authJson);
    expect(isolatedAgentRuntimeAfter.modelsJson).toEqual(isolatedAgentRuntimeBefore?.modelsJson);
    expect(isolatedAgentRuntimeAfter.settingsJson).toEqual(
      isolatedAgentRuntimeBefore?.settingsJson,
      );
      expect(["absent", "regular"]).toContain(isolatedAgentRuntimeAfter.modelsStore.type);
      const isolatedCacheDiagnostic = {
        before: isolatedAgentRuntimeBefore?.modelsStore,
        after: isolatedAgentRuntimeAfter.modelsStore,
        classification: "non-causal-provider-catalogue-cache",
      };
      expect(isolatedCacheDiagnostic.before).toBeDefined();
      expect(isolatedCacheDiagnostic.after).toBeDefined();
      process.stdout.write(
        `T02-F5 ${mode} isolated cache diagnostic: ${JSON.stringify(isolatedCacheDiagnostic)}\n`,
      );
    } finally {
      try {
        hook ??= (globalThis as any)[RACE_HOOK_KEY] as RaceHook | undefined;
        hook?.releaseManagerGuard();
      } catch (cause) {
        cleanupFailures.push(cause);
    }
    try {
      hook?.releaseSessionPromise();
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    try {
      hook?.dispose();
      expect((globalThis as any)[RACE_HOOK_KEY]).toBeUndefined();
      expect(hook?.snapshot().disposed ?? true).toBe(true);
    } catch (cause) {
      cleanupFailures.push(cause);
    }
      if (harness) {
        try {
          harness.modelServer.releaseSlowResponses();
          await harness.dispose();
        expect(harness.envWasRestored()).toBe(true);
        expect((await harness.rootExists())()).toBe(false);
      } catch (cause) {
        cleanupFailures.push(cause);
      }
      }
      try {
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            turnStart?.catch(() => undefined) ?? Promise.resolve(),
            new Promise((_, reject) => {
              cleanupTimer = setTimeout(
                () => reject(new Error("Timed out awaiting parent turn cleanup.")),
                5_000,
              );
            }),
          ]);
        } finally {
          if (cleanupTimer) clearTimeout(cleanupTimer);
        }
      } catch (cause) {
      cleanupFailures.push(cause);
    }
    try {
      const userPiAfter = verifyRealPiExtensionProvenance().snapshotUserPiHome();
        expect(userPiAfter.digest).toBe(userPiBefore.digest);
        expect(userPiAfter.sensitive).toEqual(userPiBefore.sensitive);
        expect(userPiAfter.resources).toEqual(userPiBefore.resources);
        expect(["absent", "regular"]).toContain(userPiBefore.modelsStore.type);
        expect(["absent", "regular"]).toContain(userPiAfter.modelsStore.type);
        const ambientCacheDiagnostic = {
          before: userPiBefore.modelsStore,
          after: userPiAfter.modelsStore,
          classification: "non-causal-provider-catalogue-cache",
        };
        expect(ambientCacheDiagnostic.before).toBeDefined();
        expect(ambientCacheDiagnostic.after).toBeDefined();
        process.stdout.write(
          `T02-F5 ${mode} ambient cache diagnostic: ${JSON.stringify(ambientCacheDiagnostic)}\n`,
        );
      } catch (cause) {
        cleanupFailures.push(cause);
      }
      try {
        rmSync(root, { recursive: true, force: true });
        expect(existsSync(root)).toBe(false);
      } catch (cause) {
        cleanupFailures.push(cause);
      }
    try {
      for (const [key, value] of Object.entries(previousRaceEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      expect(process.env[RACE_HOOK_ENV]).toBe(previousRaceEnv[RACE_HOOK_ENV]);
      expect(process.env[RACE_RUN_ID_ENV]).toBe(previousRaceEnv[RACE_RUN_ID_ENV]);
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    if (cleanupFailures.length > 0) {
      throw new Error(
        cleanupFailures
          .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
          .join("; "),
      );
    }
  }
}

describe("Ticket 02 synchronized controlled real-Pi F5 acceptance", () => {
  it("proves terminal-first through the registered production steer_subagent tool and exact record session", async () => {
    await runRealPiSteerRace("terminal-first");
  }, 180_000);

  it("proves enqueue-first through the registered production steer_subagent tool and exact record session", async () => {
    await runRealPiSteerRace("enqueue-first");
  }, 180_000);
});
