import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type IsoDateTime,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import {
  isSynaraMcpTurnCommand,
  parseSynaraMcpCommand,
  planSynaraMcpCommand,
  planSynaraMcpCompletion,
  planSynaraMcpDispatch,
  planSynaraMcpFailure,
  sanitizeSynaraMcpDiagnostic,
  synaraMcpRequestId,
  synaraMcpWaitStatus,
} from "./synaraMcpCommand.ts";

const now = "2026-08-12T12:00:00.000Z" as IsoDateTime;
const projectId = ProjectId.makeUnsafe("project-mcp-command");
const threadId = ThreadId.makeUnsafe("thread-mcp-command");

function event(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly commandId?: string;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-mcp-command-${input.sequence}`),
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: now,
    commandId: input.commandId === undefined ? null : CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: input.type,
    payload: input.payload as never,
  } as OrchestrationEvent;
}

async function baseReadModel(options: { readonly active: boolean }): Promise<OrchestrationReadModel> {
  const created = await Effect.runPromise(
    projectEvent(
      createEmptyReadModel(now),
      event({
        sequence: 1,
        type: "project.created",
        aggregateKind: "project",
        aggregateId: projectId,
        commandId: "create-project",
        payload: {
          projectId,
          title: "MCP command",
          workspaceRoot: "/tmp/mcp-command",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  );
  const withThread = await Effect.runPromise(
    projectEvent(
      created,
      event({
        sequence: 2,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        commandId: "create-thread",
        payload: {
          threadId,
          projectId,
          title: "MCP command thread",
          modelSelection: { provider: "pi", model: "pi" },
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: "local",
          branch: null,
          worktreePath: null,
          workingDirectory: null,
          associatedWorktreePath: null,
          associatedWorktreeBranch: null,
          associatedWorktreeRef: null,
          createBranchFlowCompleted: false,
          isPinned: false,
          parentThreadId: null,
          creationSource: null,
          sourceThreadId: null,
          sourceTurnId: null,
          gatewayOperationId: null,
          gatewayOperationIndex: null,
          subagentAgentId: null,
          subagentNickname: null,
          subagentRole: null,
          forkSourceThreadId: null,
          sidechatSourceThreadId: null,
          lastKnownPr: null,
          handoff: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  );
  if (!options.active) return withThread;
  return Effect.runPromise(
    projectEvent(
      withThread,
      event({
        sequence: 3,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: threadId,
        commandId: "set-running",
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "pi",
            runtimeMode: "full-access",
            activeTurnId: "turn-mcp-command",
            lastError: null,
            updatedAt: now,
          },
        },
      }),
    ),
  );
}

function turnCommand(text: string) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.makeUnsafe(`turn-command-${text.slice(1, 7).toLowerCase()}`),
    threadId,
    message: {
      messageId: MessageId.makeUnsafe(`message-${text.slice(1, 7).toLowerCase()}`),
      role: "user" as const,
      text,
      attachments: [],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    createdAt: now,
  };
}

describe("Synara MCP command boundary and durable activity contract", () => {
  it("recognizes only the explicit commands and never plans a provider turn", async () => {
    expect(parseSynaraMcpCommand(" /Enable   Synara MCP ")).toBe("enable");
    expect(parseSynaraMcpCommand("/Disable Synara MCP")).toBe("disable");
    expect(parseSynaraMcpCommand("Enable Synara MCP")).toBeNull();

    const command = turnCommand("/Enable Synara MCP");
    expect(isSynaraMcpTurnCommand(command)).toBe(true);
    const plan = planSynaraMcpCommand({
      command,
      readModel: await baseReadModel({ active: false }),
      now: () => new Date(now),
    });

    expect(plan?.projectCommand?.type).toBe("project.mcp-activation.update");
    expect(plan?.terminalActivityCommand.type).toBe("thread.activity.append");
    expect(plan?.terminalActivityCommand.activity.turnId).toBeNull();
    expect(plan?.terminalActivityCommand.activity.kind).toBe("synara.mcp.command.succeeded");
    expect(plan?.terminalActivityCommand.activity.payload).toMatchObject({
      requestId: synaraMcpRequestId(command.commandId),
      command: "enable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "enabled",
      finalState: "enabled",
    });
  });

  it("emits pending only for an active wait and keeps phase identities deterministic", async () => {
    const command = turnCommand("/Enable Synara MCP");
    const plan = planSynaraMcpCommand({
      command,
      readModel: await baseReadModel({ active: true }),
      now: () => new Date(now),
    });
    expect(plan?.pending).toBe(true);
    expect(plan?.operation.waitSet).toHaveLength(1);
    expect(plan?.pendingActivityCommand.activity.id).toBe(
      `${plan?.requestId}:pending`,
    );
    expect(plan?.terminalActivityCommand.activity.id).toBe(
      `${plan?.requestId}:terminal`,
    );
    expect(plan?.pendingActivityCommand.commandId).not.toBe(plan?.terminalActivityCommand.commandId);

    const replay = planSynaraMcpCommand({
      command,
      readModel: await baseReadModel({ active: true }),
      now: () => new Date("2026-08-12T12:01:00.000Z"),
    });
    expect(replay?.requestId).toBe(plan?.requestId);
    expect(replay?.pendingActivityCommand.activity.id).toBe(plan?.pendingActivityCommand.activity.id);
    expect(replay?.terminalActivityCommand.activity.id).toBe(plan?.terminalActivityCommand.activity.id);
  });

  it("replays the journaled terminal activity without turning it into a message", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const initial = await baseReadModel({ active: false });
    const plan = planSynaraMcpCommand({ command, readModel: initial, now: () => new Date(now) });
    if (!plan || !plan.projectCommand) throw new Error("Expected an idle MCP command plan");

    const projectEventResult = await Effect.runPromise(
      decideOrchestrationCommand({ command: plan.projectCommand, readModel: initial }),
    );
    const activationEvent = Array.isArray(projectEventResult)
      ? projectEventResult[0]!
      : projectEventResult;
    const afterProject = await Effect.runPromise(
      projectEvent(initial, { ...activationEvent, sequence: 4 }),
    );
    const activityEventResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: plan.terminalActivityCommand,
        readModel: afterProject,
      }),
    );
    const activityEvent = Array.isArray(activityEventResult)
      ? activityEventResult[0]!
      : activityEventResult;
    const replayed = await Effect.runPromise(
      projectEvent(afterProject, { ...activityEvent, sequence: 5 }),
    );
    const thread = replayed.threads.find((candidate) => candidate.id === threadId)!;
    expect(thread.messages).toHaveLength(0);
    expect(thread.activities).toHaveLength(1);
    expect(thread.activities[0]).toMatchObject({
      id: `${plan.requestId}:terminal`,
      kind: "synara.mcp.command.succeeded",
      turnId: null,
      sequence: 5,
    });

    const replayedAgain = await Effect.runPromise(
      projectEvent(replayed, { ...activityEvent, sequence: 6 }),
    );
    expect(replayedAgain.threads.find((candidate) => candidate.id === threadId)?.activities).toHaveLength(1);
  });

  it("defers completion until the wait-set is idle and sanitizes bounded failure details", async () => {
    const command = turnCommand("/Enable Synara MCP");
    const active = await baseReadModel({ active: true });
    const plan = planSynaraMcpCommand({ command, readModel: active, now: () => new Date(now) });
    if (!plan) throw new Error("Expected MCP command plan");
    expect(synaraMcpWaitStatus(active, plan.operation)).toBe("waiting");

    const idle = {
      ...active,
      threads: active.threads.map((thread) => ({
        ...thread,
        session: thread.session
          ? { ...thread.session, status: "ready" as const, activeTurnId: null }
          : null,
        latestTurn: null,
      })),
    };
    expect(synaraMcpWaitStatus(idle, plan.operation)).toBe("ready");
    const completed = planSynaraMcpCompletion({
      plan,
      project: {
        ...idle.projects[0]!,
        synaraMcpActivationOperation: plan.operation,
      },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });
    expect(completed.projectCommand?.operation.aggregateStatus).toBe("succeeded");

    const failure = planSynaraMcpFailure({
      plan,
      project: {
        ...active.projects[0]!,
        synaraMcpActivationOperation: plan.operation,
      } as typeof active.projects[number],
      detail: `token=secret-value https://example.test/x /Users/private/file ${"x".repeat(2_000)}`,
      now: () => new Date(now),
    });
    expect(failure.projectCommand?.operation.aggregateStatus).toBe("failed");
    const activity = failure.activityCommand.activity;
    expect(activity.turnId).toBeNull();
    expect(activity.kind).toBe("synara.mcp.command.failed");
    expect(new TextEncoder().encode(String((activity.payload as { detail: string }).detail)).byteLength).toBeLessThanOrEqual(1_024);
    expect(String((activity.payload as { detail: string }).detail)).not.toContain("secret-value");
    expect(String((activity.payload as { detail: string }).detail)).not.toContain("/Users/private/file");
    expect(sanitizeSynaraMcpDiagnostic("\n")).toBe("The Synara MCP command could not be completed.");
  });

  it("keeps an exact Synara command owned by Synara when planning cannot produce a plan", async () => {
    const command = turnCommand("/Enable Synara MCP");
    const decision = planSynaraMcpDispatch({
      command,
      readModel: createEmptyReadModel(now),
      now: () => new Date(now),
    });
    if (decision.kind !== "unprocessable") {
      throw new Error("Expected an unprocessable MCP command decision");
    }
    // Regression (impl-05 AC1): the planning miss must never fall through to
    // the original turn command. The decision contains only a journaled
    // failure activity, never a thread.turn.start that could reach
    // Pi/model history.
    expect(decision).toEqual({
      kind: "unprocessable",
      activityCommand: expect.objectContaining({
        type: "thread.activity.append",
      }),
    });
    expect(decision.activityCommand.activity).toMatchObject({
      kind: "synara.mcp.command.failed",
      turnId: null,
      summary: "Synara MCP activation failed; the project remains disabled",
    });
    expect(decision.activityCommand.activity.payload).toMatchObject({
      requestId: synaraMcpRequestId(command.commandId),
      command: "enable",
      phase: "terminal",
      status: "failed",
      requestedState: "enabled",
      finalState: "disabled",
    });
    const detail = String(
      (decision.activityCommand.activity.payload as { detail: string }).detail,
    );
    expect(new TextEncoder().encode(detail).byteLength).toBeLessThanOrEqual(1_024);

    // Re-decision of the same command keeps deterministic receipt identity so
    // command-receipt deduplication and activity-id collapse stay idempotent.
    const replay = planSynaraMcpDispatch({
      command,
      readModel: createEmptyReadModel(now),
      now: () => new Date("2026-08-12T12:01:00.000Z"),
    });
    if (replay.kind !== "unprocessable") {
      throw new Error("Expected an unprocessable MCP command decision");
    }
    expect(replay.activityCommand.commandId).toBe(decision.activityCommand.commandId);
    expect(replay.activityCommand.activity.id).toBe(decision.activityCommand.activity.id);
  });

  it("journals a planning-miss failure through the decider as a durable activity with turnId null", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const withThread = await baseReadModel({ active: false });
    // The command thread exists but its project is gone: planning misses while
    // the journal can still append to the surviving thread.
    const orphanProjectReadModel = { ...withThread, projects: [] as never[] };
    const decision = planSynaraMcpDispatch({
      command,
      readModel: orphanProjectReadModel,
      now: () => new Date(now),
    });
    if (decision.kind !== "unprocessable") {
      throw new Error("Expected an unprocessable MCP command decision");
    }

    const eventResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: decision.activityCommand,
        readModel: orphanProjectReadModel,
      }),
    );
    const activityEvent = Array.isArray(eventResult) ? eventResult[0]! : eventResult;
    expect(activityEvent.type).toBe("thread.activity-appended");
    const projected = await Effect.runPromise(
      projectEvent(orphanProjectReadModel, { ...activityEvent, sequence: 2 }),
    );
    const thread = projected.threads.find((candidate) => candidate.id === threadId)!;
    expect(thread.messages).toHaveLength(0);
    expect(thread.activities).toHaveLength(1);
    expect(thread.activities[0]).toMatchObject({
      id: `${(decision.activityCommand.activity.payload as { requestId: string }).requestId}:terminal`,
      kind: "synara.mcp.command.failed",
      turnId: null,
      sequence: 2,
    });

    // Re-projecting the same event cannot duplicate the terminal activity.
    const replayed = await Effect.runPromise(
      projectEvent(projected, { ...activityEvent, sequence: 3 }),
    );
    const replayedThread = replayed.threads.find((candidate) => candidate.id === threadId)!;
    expect(replayedThread.messages).toHaveLength(0);
    expect(replayedThread.activities).toHaveLength(1);
  });
});
