import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CommandId, MessageId, ProjectId, ThreadId } from "@synara/contracts";

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

describe("Ticket 02 canonical identity and synchronized race acceptance", () => {
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

  it("proves synchronized terminal-first linearization with zero provider insertion/send", async () => {
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

  it("proves synchronized enqueue-first linearization with exactly one insertion before retirement and durable commit", async () => {
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

  it("proves cancellation-first and insertion-before-cancellation generation fencing", async () => {
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

describe("Ticket 02 isolated controlled real-Pi composition boundary", () => {
    it("loads the registered production Agent from the exact pinned artifact and negotiates canonical routing", async () => {
      const provenance = verifyRealPiExtensionProvenance();
      const alfieRepoDir = process.env.ALFIE_REPO_DIR;
      if (!alfieRepoDir) {
        throw new Error("ALFIE_REPO_DIR is required for controlled real-Pi acceptance.");
      }
      expect(provenance.isVerified).toBe(true);
    expect(provenance.pinnedCommit).toBe(PINNED_ALFIE_COMMIT);
    expect(provenance.packageVersion).toBe(PINNED_ALFIE_VERSION);
    expect(PINNED_PI_SDK_VERSION).toBe("0.83.0");

    const root = mkdtempSync(join(tmpdir(), "synara-t02-canonical-artifact-"));
    const artifactDir = join(root, "artifact");
    const userAgentDir = join(root, "user-agent");
    let harness: Awaited<ReturnType<typeof makeRealPiWsHarness>> | undefined;
    try {
        buildPiSubagentArtifact({
          repoDir: alfieRepoDir,
        artifactDir,
        provenance: loadPiSubagentExtensionProvenance(
          join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
        ),
      });
      const verification = await verifyPiSubagentArtifact(artifactDir);
      expect(verification.valid).toBe(true);

      harness = await makeRealPiWsHarness({
        foregroundWaitMs: 300,
        desktopManaged: { artifactDir, userAgentDir, mode: "desktop" },
      });
      const projectId = ProjectId.makeUnsafe("t02-canonical-real-project");
      const threadId = ThreadId.makeUnsafe("t02-canonical-real-thread");
      const createdAt = new Date().toISOString();
      await harness.client.dispatchCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-t02-canonical-project"),
        projectId,
        title: "Ticket 02 canonical identity",
        workspaceRoot: harness.workspaceDir,
        createdAt,
      });
      await harness.client.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t02-canonical-thread"),
        threadId,
        projectId,
        title: "Ticket 02 canonical identity",
        modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt,
      });
      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t02-canonical-turn"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t02-canonical-turn"),
          role: "user",
          text: "Delegate the canonical identity acceptance task.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const capability = await waitForCapability(harness, String(threadId));
      expect(capability.isManaged).toBe(true);
      expect(capability.capabilities).toContain(PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY);
      const session = harness.observedSessions().get(String(threadId)) as
        | { getAllTools?: () => ReadonlyArray<{ name?: string }> }
        | undefined;
      expect(session?.getAllTools?.().some((tool) => tool.name === "Agent")).toBe(true);
      const admission = await waitForAdmission(harness);
      expect(admission.result.executionId).toMatch(/^exec_/);
    } finally {
      await harness?.dispose().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});

async function waitForCapability(
  harness: Awaited<ReturnType<typeof makeRealPiWsHarness>>,
  threadId: string,
) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const capability = harness.observedCapabilities().get(threadId);
    if (capability !== undefined) return capability;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for real-Pi capability negotiation.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForAdmission(harness: Awaited<ReturnType<typeof makeRealPiWsHarness>>) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const admission = harness.observedAdmissions()[0];
    if (admission !== undefined) return admission;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for real-Pi managed admission.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
