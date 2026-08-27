/** Ticket 03 / WP-03 — controlled-Alfie acceptance (Decision 0006). */
import { describe, expect, it } from "vitest";

import { CommandId, MessageId, ProjectId, ThreadId } from "@synara/contracts";

import {
  DETERMINISTIC_DRIVER_MODEL_ID,
  makeRealPiWsHarness,
  verifyRealPiExtensionProvenance,
} from "./piSubagentRealPiAcceptanceHelpers.ts";

const PINNED_COMMIT = "3fe340b401ca86bcbe8b55abd4de107e1d93482e";
const PINNED_VERSION = "0.15.0-alfie.6";

const waitFor = async <T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 90_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

function registeredTool(session: any, name: string): any {
  const extensions = session?.resourceLoader?.getExtensions?.()?.extensions;
  const extension = Array.isArray(extensions)
    ? extensions.find(
        (candidate: any) => candidate?.tools instanceof Map && candidate.tools.has(name),
      )
    : undefined;
  const entry = extension?.tools.get(name);
  const tool = entry?.definition ?? entry;
  if (!tool || typeof tool.execute !== "function") {
    throw new Error(`Pinned controlled Alfie did not register executable ${name}.`);
  }
  return tool;
}

const invoke = (tool: any, executionId: string, tag: string) =>
  Promise.resolve(
    tool.execute(
      `call_${tag}`,
      {
        execution_id: executionId,
        task: `Ticket 03 ${tag}`,
        context: "Use the exact current managed tuple only.",
        link_references: "Decision 0006",
        expected_outcome: "One bounded controlled-Alfie result.",
      },
      undefined,
      undefined,
      undefined,
    ),
  );

const assertNoAgentId = (value: unknown): void => {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoAgentId(entry);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    expect(key).not.toMatch(/agent[_-]?id/i);
    assertNoAgentId(entry);
  }
};

const settleBounded = async (
  operation: Promise<unknown> | undefined,
  label: string,
  timeoutMs = 2_000,
): Promise<void> => {
  if (operation === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out settling ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

describe("Ticket 03 controlled-Alfie live lifecycle containment acceptance", () => {
  it("keeps exact live control session-scoped, fails closed after retirement, exposes no agentId in managed public results, and preserves the pin", async () => {
    const provenance = verifyRealPiExtensionProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageName).toBe("@alfie/pi-subagents");
    expect(provenance.packageVersion).toBe(PINNED_VERSION);
    expect(provenance.pinnedCommit).toBe(PINNED_COMMIT);
    const userPiBefore = provenance.snapshotUserPiHome();

    let releaseTerminal!: () => void;
    let markTerminalEntered!: () => void;
    const terminalRelease = new Promise<void>((resolveRelease) => {
      releaseTerminal = resolveRelease;
    });
    const terminalEntered = new Promise<void>((resolveEntered) => {
      markTerminalEntered = resolveEntered;
    });
    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
      holdDeterministicSlowResponses: true,
      beforeTerminalCommit: async () => {
        markTerminalEntered();
        await terminalRelease;
      },
    });
    harness.writeSubagentModelPreference("synara-local-echo/echo-slow");
    let turnStart: Promise<unknown> | undefined;
    let ownerThreadId: ThreadId | undefined;
    let siblingThreadId: ThreadId | undefined;
    try {
      const projectId = ProjectId.makeUnsafe("t03-controlled-project");
      ownerThreadId = ThreadId.makeUnsafe("t03-controlled-owner");
      siblingThreadId = ThreadId.makeUnsafe("t03-controlled-sibling");
      const createdAt = new Date().toISOString();
      await harness.client.dispatchCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-t03-controlled-project"),
        projectId,
        title: "Ticket 03 controlled Alfie",
        workspaceRoot: harness.workspaceDir,
        createdAt,
      });
      for (const [threadId, suffix, model] of [
        [ownerThreadId, "owner", DETERMINISTIC_DRIVER_MODEL_ID],
        [siblingThreadId, "sibling", "echo"],
      ] as const) {
        await harness.client.dispatchCommand({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(`cmd-t03-controlled-${suffix}-thread`),
          threadId,
          projectId,
          title: `Controlled ${suffix}`,
          modelSelection: { provider: "pi", model },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: harness.workspaceDir,
          createdAt,
        });
      }
      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t03-controlled-sibling-turn"),
        threadId: siblingThreadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t03-controlled-sibling-turn"),
          role: "user",
          text: "Start only the controlled sibling Pi session.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      turnStart = harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t03-controlled-owner-turn"),
        threadId: ownerThreadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t03-controlled-owner-turn"),
          role: "user",
          text: "Delegate exactly one controlled Alfie child.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      void turnStart.catch(() => undefined);

      const admission = await waitFor(
        () =>
          harness
            .observedAdmissions()
            .find((event) => String(event.threadId) === String(ownerThreadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        "one controlled Alfie admission",
      );
      if (!admission) throw new Error("Controlled Alfie admission was not observed.");
      const identity = admission.result;
      await waitFor(
        () => harness.durable.listJournalEvents(identity.executionId),
        (events) => events.some((event) => event.sequence === 2),
        "sequence-2 activation",
      );
      await waitFor(
        () => harness.modelServer.pendingSlowResponseCount(),
        (count) => count === 1,
        "held controlled child",
      );

      const ownerTool = registeredTool(
        harness.observedSessions().get(String(ownerThreadId)),
        "steer_subagent",
      );
      const siblingTool = registeredTool(
        harness.observedSessions().get(String(siblingThreadId)),
        "steer_subagent",
      );
      const applied = await invoke(ownerTool, identity.executionId, "controlled_exact");
      expect(applied.isError).toBeUndefined();
      expect(String(applied.content?.[0]?.text)).toContain("Steer state: applied");
      assertNoAgentId(JSON.parse(JSON.stringify(applied)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      expect(harness.observedExtensionSteerEmissions()[0]).toMatchObject({
        threadId: ownerThreadId,
        payload: {
          id: identity.executionId,
          executionId: identity.executionId,
          attemptId: identity.attemptId,
          generation: identity.generation,
        },
      });

      const sibling = await invoke(siblingTool, identity.executionId, "controlled_sibling");
      expect(sibling.isError).toBe(true);
      expect(sibling.diagnosticCode).toBe("pi_subagent_read_unauthorized_or_out_of_scope");
      assertNoAgentId(JSON.parse(JSON.stringify(sibling)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);

      harness.modelServer.releaseSlowResponses();
      await terminalEntered;
      const retired = await invoke(ownerTool, identity.executionId, "controlled_retired");
      expect(retired.isError).toBe(true);
      expect(retired.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
      assertNoAgentId(JSON.parse(JSON.stringify(retired)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      releaseTerminal();
      await waitFor(
        () => harness.durable.listJournalEvents(identity.executionId),
        (events) => events.some((event) => event.sequence === 40 && event.state === "succeeded"),
        "controlled terminal band-40",
      );
      expect(harness.observedAdmissions()).toHaveLength(1);
      expect(harness.modelServer.requests().filter((request) => request.delegated)).toHaveLength(1);
      expect(harness.observedSupervisorSpawnPids()).toHaveLength(0);
      await settleBounded(turnStart, "controlled owner turn", 10_000);
    } finally {
      releaseTerminal();
      harness.modelServer.releaseSlowResponses();
      try {
        await Promise.allSettled([
          settleBounded(turnStart?.catch(() => undefined), "controlled owner turn"),
          ownerThreadId === undefined
            ? Promise.resolve()
            : settleBounded(
                harness.abortPiTurn(String(ownerThreadId)).catch(() => undefined),
                "controlled owner abort",
              ),
          ownerThreadId === undefined
            ? Promise.resolve()
            : settleBounded(
                harness.stopPiSession(String(ownerThreadId)).catch(() => undefined),
                "controlled owner session stop",
              ),
          siblingThreadId === undefined
            ? Promise.resolve()
            : settleBounded(
                harness.stopPiSession(String(siblingThreadId)).catch(() => undefined),
                "controlled sibling session stop",
              ),
        ]);
      } finally {
        await harness.dispose();
      }
    }

    const after = verifyRealPiExtensionProvenance();
    expect(after.packageVersion).toBe(PINNED_VERSION);
    expect(after.pinnedCommit).toBe(PINNED_COMMIT);
    expect(after.isVerified).toBe(true);
    expect(after.snapshotUserPiHome().digest).toBe(userPiBefore.digest);
    expect(harness.envWasRestored()).toBe(true);
    expect((await harness.rootExists())()).toBe(false);
  }, 180_000);
});
