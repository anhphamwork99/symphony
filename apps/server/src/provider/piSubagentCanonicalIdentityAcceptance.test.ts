import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  verifyRealPiExtensionProvenance,
} from "./piSubagentRealPiAcceptanceHelpers.ts";
import {
  PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY,
  wrapPiSubagentManagedTool,
} from "./piSubagentManagedRuntimeBinding.ts";

const REPO_ROOT = resolve(__dirname, "../../../..");
const PINNED_ALFIE_COMMIT = "73bc7744f8fbbd12206302de2df8230b29a49178";
const PINNED_ALFIE_VERSION = "0.15.0-alfie.5";
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
    const capabilityDenied = await invoke(capabilityTool, { execution_id: runningRead.executionId });
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
    expect(state.queue + state.replay + state.resume + state.bootstrap + state.reconstruction).toBe(0);
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
    expect(state.queue + state.replay + state.resume + state.bootstrap + state.reconstruction).toBe(0);
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
    expect(after.queue + after.replay + after.resume + after.bootstrap + after.reconstruction).toBe(0);
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

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function makeDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

type ProductionManagerFacade = {
  readonly resolveManagedExecution: (
    executionId: string,
    attemptId: string,
    generation: number,
  ) => any;
  readonly getRecord: (...args: any[]) => any;
  readonly getManagedExecutionIndexSize: () => number;
};

function productionManagerFacade(): ProductionManagerFacade {
  const facade = (globalThis as any)[Symbol.for("pi-subagents:manager")];
  if (
    !facade ||
    typeof facade.resolveManagedExecution !== "function" ||
    typeof facade.getRecord !== "function" ||
    typeof facade.getManagedExecutionIndexSize !== "function"
  ) {
    throw new Error(
      "The registered production Alfie manager facade is unavailable or incomplete.",
    );
  }
  return facade as ProductionManagerFacade;
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

  const root = mkdtempSync(join(tmpdir(), `synara-t02-steer-${mode}-`));
  const artifactDir = join(root, "artifact");
  const userAgentDir = join(root, "user-agent");
  const userPiBefore = provenance.snapshotUserPiHome();
  let harness: Awaited<ReturnType<typeof makeRealPiWsHarness>> | undefined;
  let restoreExactSessionSteer: (() => void) | undefined;
  let sessionSteerCalls = 0;
  let sdkInsertions = 0;
  let insertion: Deferred | undefined;
  let release: Deferred | undefined;
  const trace: string[] = [];

  try {
    buildPiSubagentArtifact({
      repoDir: alfieRepoDir,
      artifactDir,
      provenance: loadPiSubagentExtensionProvenance(
        join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
      ),
    });
    expect((await verifyPiSubagentArtifact(artifactDir)).valid).toBe(true);

    harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
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
    expect(resolve(userAgentDir)).not.toBe(realPiHome);
    expect(resolve(harness.piHomeDir)).not.toBe(realPiHome);
    assertArtifactAgentHasNoUserConfiguration(desktop.managedAgentDir);

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

    // Keep the real parent turn in flight while observing its session. Awaiting
    // the public dispatch first can allow a slow child to retire before the
    // production facade is sampled; the acceptance must patch the exact live
    // child record before that happens.
    const admissionsForThread = () =>
      harness!.observedAdmissions().filter((event) => String(event.threadId) === thread);
    insertion = makeDeferred();
    release = makeDeferred();
    await harness.client.dispatchCommand({
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

    const capability = await waitFor(
      () => harness.observedCapabilities().get(thread),
      (value) => value !== undefined,
      "production managed capability negotiation",
    );
    if (!capability) throw new Error("Production managed capability negotiation returned no result.");
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
    const facade = productionManagerFacade();
    expect(resolve(loaded.extension.path).startsWith(resolve(harness.desktop!.managedExtensionDir))).toBe(
      true,
    );
    expect(resolve(loaded.extension.path)).not.toContain(resolve(userAgentDir));
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

    const exactRecord = await waitFor(
      () => facade.resolveManagedExecution(identity.executionId, identity.attemptId, identity.generation),
      (value) => value?.session !== undefined,
      "exact live managed record from production facade",
      90_000,
    );
    if (!exactRecord?.session) throw new Error("The exact live managed record was not captured.");
    expect(exactRecord.managedExecution).toMatchObject({
      executionId: identity.executionId,
      attemptId: identity.attemptId,
      generation: identity.generation,
    });

    const originalSessionSteer = exactRecord.session.steer;
    if (typeof originalSessionSteer !== "function") {
      throw new Error("The exact live managed record has no session.steer function.");
    }
    exactRecord.session.steer = function (...args: any[]) {
      const result = originalSessionSteer.apply(this, args);
      // Pi SDK 0.83 inserts synchronously before returning this promise.
      // Count immediately, then hold only the returned promise.
      sessionSteerCalls += 1;
      sdkInsertions += 1;
      trace.push("sdk-insertion");
      insertion!.resolve();
      return (async () => {
        await release!.promise;
        return await result;
      })();
    };
    restoreExactSessionSteer = () => {
      exactRecord.session.steer = originalSessionSteer;
    };
    await waitFor(
      () => harness.bridgeActiveExecutions(thread),
      (active) => active.some((candidate) => candidate.executionId === identity.executionId && candidate.isRunning),
      "exact live bridge execution",
      90_000,
    );

    // The trace is an acceptance trace of the real production boundary. These
    // labels correspond to the registered tool's authorization/live path;
    // sdk-insertion is recorded only by the exact child session method above.
    trace.push("invocation", "tuple-lookup", "live-guard");

    let steerCall: Promise<any>;
    if (mode === "terminal-first") {
      // Patch while live, then let the real child retire and commit seq 40
      // before the registered production tool is invoked.
      await waitFor(
        () => harness!.bridgeActiveExecutions(thread),
        (active) => active.every((candidate) => candidate.executionId !== identity.executionId),
        "terminal-first live retirement and bridge removal",
        90_000,
      );
      expect(facade.resolveManagedExecution(identity.executionId, identity.attemptId, identity.generation)).toBe(
        undefined,
      );
      expect(facade.getManagedExecutionIndexSize()).toBe(0);
      const terminal = await waitFor(
        () => harness!.durable.listJournalEvents(identity.executionId),
        (events) => events.some((event) => event.sequence === 40 && event.state === "succeeded"),
        "terminal-first durable seq-40 commit",
        90_000,
      );
      trace.push("retirement/index-removal", "durable-commit");
      expect(terminal.filter((event) => event.sequence === 40)).toHaveLength(1);
      expect(sessionSteerCalls).toBe(0);
      steerCall = invoke(loaded.target, {
        execution_id: identity.executionId,
        attempt_id: identity.attemptId,
        generation: identity.generation,
        task: "Continue the synchronized terminal-first race task.",
        context: "Use only the exact current execution tuple.",
        link_references: "Decision 0003",
        expected_outcome: "Durable terminal truth remains authoritative.",
      });
    } else {
      steerCall = invoke(loaded.target, {
        execution_id: identity.executionId,
        attempt_id: identity.attemptId,
        generation: identity.generation,
        task: "Continue the synchronized enqueue-first race task.",
        context: "Use only the exact current execution tuple.",
        link_references: "Decision 0003",
        expected_outcome: "The one inserted steer is applied; no second send occurs.",
      });
      await insertion.promise;
      expect(sessionSteerCalls).toBe(1);
      expect(sdkInsertions).toBe(1);
      expect(facade.getManagedExecutionIndexSize()).toBeGreaterThanOrEqual(1);
      await waitFor(
        () => harness!.bridgeActiveExecutions(thread),
        (active) => active.every((candidate) => candidate.executionId !== identity.executionId),
        "enqueue-first natural live retirement and bridge removal",
        90_000,
      );
      expect(facade.getManagedExecutionIndexSize()).toBe(0);
      const terminal = await waitFor(
        () => harness!.durable.listJournalEvents(identity.executionId),
        (events) => events.some((event) => event.sequence === 40 && event.state === "succeeded"),
        "enqueue-first durable seq-40 commit",
        90_000,
      );
      trace.push("retirement/index-removal", "durable-commit");
      expect(terminal.filter((event) => event.sequence === 40)).toHaveLength(1);
      release.resolve();
    }

    const result = await steerCall;
    trace.push("bookkeeping", "return");
    if (mode === "terminal-first") {
      expect(result.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
      expect(result.content?.[0]?.text).not.toContain("Agent not found");
      expect(sessionSteerCalls).toBe(0);
      expect(sdkInsertions).toBe(0);
    } else {
      expect(result.content?.[0]?.text).toContain("Steer state: applied");
      expect(sessionSteerCalls).toBe(1);
      expect(sdkInsertions).toBe(1);
    }
    expect(facade.getManagedExecutionIndexSize()).toBe(0);
    expect(
      harness.bridgeActiveExecutions(thread).some((candidate) => candidate.executionId === identity.executionId),
    ).toBe(false);
    expect(admissionsForThread()).toHaveLength(1);
    expect(harness.modelServer.requests().filter((request) => request.delegated)).toHaveLength(1);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
    assertNoProviderIdentity(trace);
    assertArtifactAgentHasNoUserConfiguration(desktop.managedAgentDir);
    expect((await verifyPiSubagentArtifact(artifactDir)).valid).toBe(true);
  } finally {
    restoreExactSessionSteer?.();
    if (harness) {
      await harness.dispose();
      expect(harness.envWasRestored()).toBe(true);
      expect((await harness.rootExists())()).toBe(false);
    }
    const userPiAfter = verifyRealPiExtensionProvenance().snapshotUserPiHome();
    expect(userPiAfter.digest).toBe(userPiBefore.digest);
    expect(userPiAfter.sensitive).toEqual(userPiBefore.sensitive);
    expect(userPiAfter.resources).toEqual(userPiBefore.resources);
    expect(["absent", "regular"]).toContain(userPiBefore.modelsStore.type);
    expect(["absent", "regular"]).toContain(userPiAfter.modelsStore.type);
    expect((await verifyPiSubagentArtifact(artifactDir)).valid).toBe(true);
    rmSync(root, { recursive: true, force: true });
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
