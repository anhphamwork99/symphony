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
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { runProviderSynaraMcpDisable } from "../wsRpc";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import {
  isSynaraMcpTurnCommand,
  parseSynaraMcpCommand,
  planSynaraMcpCommand,
  planSynaraMcpCompletion,
  planSynaraMcpDisableResolution,
  planSynaraMcpDisableTerminal,
  planSynaraMcpDispatch,
  planSynaraMcpFailure,
  sanitizeSynaraMcpDiagnostic,
  synaraMcpRequestId,
  synaraMcpWaitStatus,
  type SynaraMcpCommandPayload,
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

/** A live but idle session: no in-flight turn, so its safe boundary is immediate. */
async function idleSessionReadModel(): Promise<OrchestrationReadModel> {
  const active = await baseReadModel({ active: true });
  return {
    ...active,
    threads: active.threads.map((thread) => ({
      ...thread,
      session: thread.session
        ? { ...thread.session, status: "ready" as const, activeTurnId: null }
        : null,
      latestTurn: null,
    })),
  };
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

  it("plans exactly one succeeded terminal with finalState disabled for a proven disable", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const active = await baseReadModel({ active: true });
    const plan = planSynaraMcpCommand({ command, readModel: active, now: () => new Date(now) });
    if (!plan) throw new Error("Expected MCP command plan");

    const terminal = planSynaraMcpDisableTerminal({
      plan,
      project: { ...active.projects[0]!, synaraMcpActivationOperation: plan.operation },
      outcome: { state: "dormant" },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });

    expect(terminal.projectCommand?.operation.aggregateStatus).toBe("succeeded");
    expect(terminal.projectCommand?.operation.desiredState).toBe("disabled");
    const activity = terminal.activityCommand.activity;
    expect(activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activity.kind).toBe("synara.mcp.command.succeeded");
    expect(activity.turnId).toBeNull();
    expect(activity.payload).toMatchObject({
      requestId: plan.requestId,
      command: "disable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "disabled",
      finalState: "disabled",
    });
  });

  it("plans exactly one failed terminal with finalState disabled when the disable is unavailable", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const active = await baseReadModel({ active: true });
    const plan = planSynaraMcpCommand({ command, readModel: active, now: () => new Date(now) });
    if (!plan) throw new Error("Expected MCP command plan");

    const terminal = planSynaraMcpDisableTerminal({
      plan,
      project: { ...active.projects[0]!, synaraMcpActivationOperation: plan.operation },
      outcome: {
        state: "unavailable",
        detail: `token=secret-value https://example.test/x /Users/private/file ${
"x".repeat(2_000)}`,
      },
      now: () => new Date(now),
    });

    expect(terminal.projectCommand?.operation.aggregateStatus).toBe("failed");
    expect(terminal.projectCommand?.operation.desiredState).toBe("disabled");
    const activity = terminal.activityCommand.activity;
    expect(activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activity.kind).toBe("synara.mcp.command.failed");
    expect(activity.turnId).toBeNull();
    expect(activity.payload).toMatchObject({
      requestId: plan.requestId,
      command: "disable",
      phase: "terminal",
      status: "failed",
      requestedState: "disabled",
      finalState: "disabled",
    });
    const detail = String((activity.payload as { detail: string }).detail);
    expect(new TextEncoder().encode(detail).byteLength).toBeLessThanOrEqual(1_024);
    expect(detail).not.toContain("secret-value");
    expect(detail).not.toContain("/Users/private/file");
  });

  it("keeps a no-wait disable pending until the provider outcome while an idle enable still settles immediately (Decision 14)", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const plan = planSynaraMcpCommand({
      command,
      readModel: await idleSessionReadModel(),
      now: () => new Date(now),
    });
    if (!plan) throw new Error("Expected MCP command plan");
    // The idle issuing session joins the wait-set so the contracts schema can
    // represent the durable pending operation that the provider outcome
    // transitions: a timeout/uncertain disable must never look like clean
    // success before the provider result is known.
    expect(plan.pending).toBe(true);
    expect(plan.operation.aggregateStatus).toBe("pending");
    expect(plan.operation.waitSet).toEqual([
      { sessionId: threadId, sessionGeneration: `orchestration:${threadId}:${now}` },
    ]);
    expect(plan.operation.outcomes).toEqual([
      {
        sessionId: threadId,
        sessionGeneration: `orchestration:${threadId}:${now}`,
        status: "pending",
        detail: null,
        updatedAt: now,
      },
    ]);
    expect(plan.pendingActivityCommand.activity.id).toBe(`${plan.requestId}:pending`);

    // impl-05 contract unchanged: an idle enable has no provider outcome to
    // wait for and still settles immediately.
    const enable = planSynaraMcpCommand({
      command: turnCommand("/Enable Synara MCP"),
      readModel: await idleSessionReadModel(),
      now: () => new Date(now),
    });
    expect(enable?.pending).toBe(false);
    expect(enable?.operation.aggregateStatus).toBe("succeeded");
    expect(enable?.operation.waitSet).toHaveLength(0);
  });

  it("resolves a no-wait disable to a succeeded operation and activity when the provider outcome is dormant", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan) throw new Error("Expected MCP command plan");

    const terminal = planSynaraMcpDisableResolution({
      plan,
      project: { ...readModel.projects[0]!, synaraMcpActivationOperation: plan.operation },
      outcome: { state: "dormant" },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });

    expect(terminal.projectCommand?.operation.aggregateStatus).toBe("succeeded");
    expect(terminal.projectCommand?.operation.desiredState).toBe("disabled");
    expect(terminal.projectCommand?.operation.outcomes).toHaveLength(1);
    expect(terminal.projectCommand?.operation.outcomes[0]?.status).toBe("succeeded");
    const activity = terminal.activityCommand.activity;
    expect(activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activity.kind).toBe("synara.mcp.command.succeeded");
    expect(activity.turnId).toBeNull();
    expect(activity.payload).toMatchObject({
      requestId: plan.requestId,
      command: "disable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "disabled",
      finalState: "disabled",
    });
  });

  it("resolves a no-wait disable to a failed disabled operation and activity when the provider outcome is unavailable", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan) throw new Error("Expected MCP command plan");

    const terminal = planSynaraMcpDisableResolution({
      plan,
      project: { ...readModel.projects[0]!, synaraMcpActivationOperation: plan.operation },
      outcome: {
        state: "unavailable",
        detail: `token=secret-value https://example.test/x /Users/private/file ${
"x".repeat(2_000)}`,
      },
      now: () => new Date(now),
    });

    expect(terminal.projectCommand?.operation.aggregateStatus).toBe("failed");
    expect(terminal.projectCommand?.operation.desiredState).toBe("disabled");
    expect(terminal.projectCommand?.operation.outcomes).toHaveLength(1);
    expect(terminal.projectCommand?.operation.outcomes[0]?.status).toBe("failed");
    const activity = terminal.activityCommand.activity;
    expect(activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activity.kind).toBe("synara.mcp.command.failed");
    expect(activity.turnId).toBeNull();
    expect(activity.payload).toMatchObject({
      requestId: plan.requestId,
      command: "disable",
      phase: "terminal",
      status: "failed",
      requestedState: "disabled",
      finalState: "disabled",
    });
    const detail = String((activity.payload as { detail: string }).detail);
    expect(new TextEncoder().encode(detail).byteLength).toBeLessThanOrEqual(1_024);
    expect(detail).not.toContain("secret-value");
    expect(detail).not.toContain("/Users/private/file");
  });

  it("resolves a no-wait disable timeout to the same failed disabled terminal", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan) throw new Error("Expected MCP command plan");

    const timeoutDetail = "The Synara MCP disable did not complete before its deadline.";
    const terminal = planSynaraMcpDisableResolution({
      plan,
      project: { ...readModel.projects[0]!, synaraMcpActivationOperation: plan.operation },
      outcome: { state: "timeout", detail: timeoutDetail },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });

    expect(terminal.projectCommand?.operation.aggregateStatus).toBe("failed");
    expect(terminal.projectCommand?.operation.desiredState).toBe("disabled");
    expect(terminal.projectCommand?.operation.outcomes[0]?.status).toBe("failed");
    const activity = terminal.activityCommand.activity;
    expect(activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activity.kind).toBe("synara.mcp.command.failed");
    expect(activity.payload).toMatchObject({
      status: "failed",
      finalState: "disabled",
      detail: timeoutDetail,
    });
  });

  it("journals a no-wait disable success exactly once through the decider", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan || !plan.projectCommand) throw new Error("Expected an idle disable plan");

    // Journal-first: the durable operation lands pending before any provider
    // outcome is known.
    const operationEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: plan.projectCommand, readModel }),
    );
    const afterOperation = await Effect.runPromise(
      projectEvent(readModel, {
        ...(Array.isArray(operationEvent) ? operationEvent[0]! : operationEvent),
        sequence: 4,
      }),
    );
    expect(afterOperation.projects[0]!.synaraMcpActivationOperation?.aggregateStatus).toBe("pending");

    const terminal = planSynaraMcpDisableResolution({
      plan,
      project: afterOperation.projects[0]!,
      outcome: { state: "dormant" },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });
    expect(terminal.projectCommand).not.toBeNull();
    const terminalOperationEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: terminal.projectCommand!, readModel: afterOperation }),
    );
    const afterTerminalOperation = await Effect.runPromise(
      projectEvent(afterOperation, {
        ...(Array.isArray(terminalOperationEvent) ? terminalOperationEvent[0]! : terminalOperationEvent),
        sequence: 5,
      }),
    );
    expect(afterTerminalOperation.projects[0]!.synaraMcpActivationOperation?.aggregateStatus).toBe(
      "succeeded",
    );

    const terminalActivityEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: terminal.activityCommand, readModel: afterTerminalOperation }),
    );
    const afterTerminalActivity = await Effect.runPromise(
      projectEvent(afterTerminalOperation, {
        ...(Array.isArray(terminalActivityEvent) ? terminalActivityEvent[0]! : terminalActivityEvent),
        sequence: 6,
      }),
    );
    const thread = afterTerminalActivity.threads.find((candidate) => candidate.id === threadId)!;
    expect(thread.messages).toHaveLength(0);
    const terminalActivity = thread.activities.find(
      (entry) => entry.id === `${plan.requestId}:terminal`,
    )!;
    expect(terminalActivity).toMatchObject({
      kind: "synara.mcp.command.succeeded",
      turnId: null,
    });
    expect(terminalActivity.payload as unknown as SynaraMcpCommandPayload).toMatchObject({
      requestId: plan.requestId,
      status: "succeeded",
      finalState: "disabled",
    });

    // A duplicate resolution against the settled operation never re-transitions.
    const duplicate = planSynaraMcpDisableResolution({
      plan,
      project: afterTerminalActivity.projects[0]!,
      outcome: { state: "unavailable", detail: "late unavailable" },
      now: () => new Date("2026-08-12T12:00:02.000Z"),
    });
    expect(duplicate.projectCommand).toBeNull();
  });

  it("never re-transitions a settled disable and replays the canonical terminal for a retried command", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan || !plan.projectCommand) throw new Error("Expected an idle disable plan");

    // Journal the pending operation, then its failed terminal.
    const operationEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: plan.projectCommand, readModel }),
    );
    const afterOperation = await Effect.runPromise(
      projectEvent(readModel, {
        ...(Array.isArray(operationEvent) ? operationEvent[0]! : operationEvent),
        sequence: 4,
      }),
    );
    const failure = planSynaraMcpDisableResolution({
      plan,
      project: afterOperation.projects[0]!,
      outcome: { state: "unavailable", detail: "The disable could not prove its cleanup." },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });
    expect(failure.projectCommand).not.toBeNull();
    const failureEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: failure.projectCommand!, readModel: afterOperation }),
    );
    const afterFailure = await Effect.runPromise(
      projectEvent(afterOperation, {
        ...(Array.isArray(failureEvent) ? failureEvent[0]! : failureEvent),
        sequence: 5,
      }),
    );
    expect(afterFailure.projects[0]!.synaraMcpActivationOperation?.aggregateStatus).toBe("failed");

    // Re-planning the same command (a retry) sees the settled operation: the
    // resolution can only replay the deterministic terminal, never
    // re-transition the durable operation.
    const retry = planSynaraMcpCommand({
      command,
      readModel: afterFailure,
      now: () => new Date("2026-08-12T12:02:00.000Z"),
    });
    if (!retry) throw new Error("Expected retry plan");
    expect(retry.pending).toBe(false);
    const replay = planSynaraMcpDisableResolution({
      plan: retry,
      project: afterFailure.projects[0]!,
      outcome: { state: "timeout", detail: "The Synara MCP disable did not complete before its deadline." },
      now: () => new Date("2026-08-12T12:02:01.000Z"),
    });
    expect(replay.projectCommand).toBeNull();
    expect(replay.activityCommand.activity.id).toBe(`${retry.requestId}:terminal`);
    expect(replay.activityCommand.activity).toMatchObject({
      kind: "synara.mcp.command.failed",
      turnId: null,
    });
    expect(
      replay.activityCommand.activity.payload as unknown as SynaraMcpCommandPayload,
    ).toMatchObject({
      status: "failed",
      finalState: "disabled",
      detail: "The disable could not prove its cleanup.",
    });
  });

  it("catches a thrown provider disable failure and journals exactly one failed-disabled terminal (wsRpc pending shape)", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan || !plan.projectCommand) throw new Error("Expected an idle disable plan");

    // Journal-first: the durable pending operation lands before the provider
    // outcome is known.
    const operationEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: plan.projectCommand, readModel }),
    );
    const afterOperation = await Effect.runPromise(
      projectEvent(readModel, {
        ...(Array.isArray(operationEvent) ? operationEvent[0]! : operationEvent),
        sequence: 4,
      }),
    );
    expect(afterOperation.projects[0]!.synaraMcpActivationOperation?.aggregateStatus).toBe(
      "pending",
    );

    // The provider disable throws: the command boundary catches it locally
    // and normalizes it to a sanitized unavailable outcome instead of letting
    // the failure escape to the RPC error path and leave the pending
    // operation without a terminal.
    const outcome = await Effect.runPromise(
      runProviderSynaraMcpDisable({
        disable: Effect.fail(
          new Error(
            "provider disable exploded: bearer=super-secret https://evil.test/x /Users/private/f",
          ),
        ),
        remainingMs: 60_000,
      }),
    );
    expect(Option.isSome(outcome)).toBe(true);
    if (!Option.isSome(outcome)) throw new Error("Expected a normalized disable outcome");
    expect(outcome.value).toMatchObject({ state: "unavailable" });
    const detail = outcome.value.state === "unavailable" ? outcome.value.detail ?? "" : "";
    expect(new TextEncoder().encode(detail).byteLength).toBeLessThanOrEqual(1_024);
    expect(detail).not.toContain("super-secret");
    expect(detail).not.toContain("https://");
    expect(detail).not.toContain("/Users/private");

    // The shared terminal planner drives exactly one failed operation and
    // one failed activity with finalState disabled.
    const terminal = planSynaraMcpDisableResolution({
      plan,
      project: afterOperation.projects[0]!,
      outcome: outcome.value,
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });
    expect(terminal.projectCommand).not.toBeNull();
    expect(terminal.projectCommand?.operation.aggregateStatus).toBe("failed");
    expect(terminal.projectCommand?.operation.desiredState).toBe("disabled");
    expect(terminal.projectCommand?.operation.outcomes).toHaveLength(1);
    expect(terminal.projectCommand?.operation.outcomes[0]?.status).toBe("failed");

    const terminalOperationEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: terminal.projectCommand!, readModel: afterOperation }),
    );
    const afterTerminalOperation = await Effect.runPromise(
      projectEvent(afterOperation, {
        ...(Array.isArray(terminalOperationEvent)
          ? terminalOperationEvent[0]!
          : terminalOperationEvent),
        sequence: 5,
      }),
    );
    expect(afterTerminalOperation.projects[0]!.synaraMcpActivationOperation?.aggregateStatus).toBe(
      "failed",
    );

    const terminalActivityEvent = await Effect.runPromise(
      decideOrchestrationCommand({
        command: terminal.activityCommand,
        readModel: afterTerminalOperation,
      }),
    );
    const afterTerminalActivity = await Effect.runPromise(
      projectEvent(afterTerminalOperation, {
        ...(Array.isArray(terminalActivityEvent)
          ? terminalActivityEvent[0]!
          : terminalActivityEvent),
        sequence: 6,
      }),
    );
    const thread = afterTerminalActivity.threads.find((candidate) => candidate.id === threadId)!;
    expect(thread.messages).toHaveLength(0);
    const terminalActivities = thread.activities.filter(
      (entry) => entry.id === `${plan.requestId}:terminal`,
    );
    expect(terminalActivities).toHaveLength(1);
    expect(terminalActivities[0]).toMatchObject({
      kind: "synara.mcp.command.failed",
      turnId: null,
    });
    expect(terminalActivities[0]?.payload as unknown as SynaraMcpCommandPayload).toMatchObject({
      requestId: plan.requestId,
      command: "disable",
      phase: "terminal",
      status: "failed",
      requestedState: "disabled",
      finalState: "disabled",
    });

    // A duplicate resolution against the settled operation never
    // re-transitions the durable operation and produces no second terminal.
    const duplicate = planSynaraMcpDisableResolution({
      plan,
      project: afterTerminalActivity.projects[0]!,
      outcome: { state: "unavailable", detail: "late unavailable" },
      now: () => new Date("2026-08-12T12:00:02.000Z"),
    });
    expect(duplicate.projectCommand).toBeNull();
  });

  it("catches a thrown provider disable failure and replays exactly one deterministic failed terminal for a settled disable (wsRpc non-pending shape)", async () => {
    const command = turnCommand("/Disable Synara MCP");
    const readModel = await idleSessionReadModel();
    const plan = planSynaraMcpCommand({ command, readModel, now: () => new Date(now) });
    if (!plan || !plan.projectCommand) throw new Error("Expected an idle disable plan");

    // Settle the durable operation as failed first, as the pending shape
    // would have.
    const operationEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: plan.projectCommand, readModel }),
    );
    const afterOperation = await Effect.runPromise(
      projectEvent(readModel, {
        ...(Array.isArray(operationEvent) ? operationEvent[0]! : operationEvent),
        sequence: 4,
      }),
    );
    const failure = planSynaraMcpDisableResolution({
      plan,
      project: afterOperation.projects[0]!,
      outcome: { state: "unavailable", detail: "The disable could not prove its cleanup." },
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });
    const failureEvent = await Effect.runPromise(
      decideOrchestrationCommand({ command: failure.projectCommand!, readModel: afterOperation }),
    );
    const afterFailure = await Effect.runPromise(
      projectEvent(afterOperation, {
        ...(Array.isArray(failureEvent) ? failureEvent[0]! : failureEvent),
        sequence: 5,
      }),
    );
    expect(afterFailure.projects[0]!.synaraMcpActivationOperation?.aggregateStatus).toBe("failed");

    // A retried command replans the settled operation: the non-pending
    // command-boundary shape (deterministic terminal replay only).
    const retry = planSynaraMcpCommand({
      command,
      readModel: afterFailure,
      now: () => new Date("2026-08-12T12:02:00.000Z"),
    });
    if (!retry) throw new Error("Expected retry plan");
    expect(retry.pending).toBe(false);

    // The provider throws again; the command boundary catches it locally, but
    // the settled operation is never re-transitioned: exactly one
    // deterministic terminal replay with finalState disabled.
    const outcome = await Effect.runPromise(
      runProviderSynaraMcpDisable({
        disable: Effect.fail(new Error("provider disable exploded again")),
        remainingMs: 60_000,
      }),
    );
    expect(Option.isSome(outcome)).toBe(true);
    if (!Option.isSome(outcome)) throw new Error("Expected a normalized disable outcome");
    expect(outcome.value).toMatchObject({ state: "unavailable" });

    const replay = planSynaraMcpDisableResolution({
      plan: retry,
      project: afterFailure.projects[0]!,
      outcome: outcome.value,
      now: () => new Date("2026-08-12T12:02:01.000Z"),
    });
    expect(replay.projectCommand).toBeNull();
    expect(replay.activityCommand.activity.id).toBe(`${retry.requestId}:terminal`);
    expect(replay.activityCommand.activity).toMatchObject({
      kind: "synara.mcp.command.failed",
      turnId: null,
    });
    expect(replay.activityCommand.activity.payload as unknown as SynaraMcpCommandPayload).toMatchObject({
      status: "failed",
      finalState: "disabled",
      detail: "The disable could not prove its cleanup.",
    });
  });
});
