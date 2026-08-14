// FILE: synaraMcpProjectReconciliation.test.ts
// Purpose: Verifies the project-wide Synara MCP fan-out reconciliation
// (impl-08, Decisions 16/17/18/19): one durable wait-set captured immutably
// at acceptance, per-member independent reconciliation through the public
// provider boundary, all-session success commits enabled, and any failure,
// timeout, or unsafe disappearance rolls the project back to disabled with
// sibling cleanup and exactly one terminal outcome. Uses a controllable clock
// (never a real 120-second wait) and fake provider seams at the external
// boundary.
// Layer: Orchestration command-boundary reconciliation tests
// Depends on: the planner public seams and the reconciliation module.

import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type IsoDateTime,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import {
  planSynaraMcpCommand,
  planSynaraMcpFailure,
  type SynaraMcpCommandPlan,
} from "./synaraMcpCommand.ts";
import {
  reconcileSynaraMcpProject,
  SYNARA_MCP_PROJECT_DISABLE_TIMEOUT_DETAIL,
  SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL,
  SYNARA_MCP_PROJECT_SESSION_DISAPPEARED_DETAIL,
  type SynaraMcpProjectReconciliationSeams,
} from "./synaraMcpProjectReconciliation.ts";

const now = "2026-08-12T12:00:00.000Z" as IsoDateTime;
const projectId = ProjectId.makeUnsafe("project-mcp-reconcile");
const issuingThreadId = ThreadId.makeUnsafe("thread-mcp-reconcile");
const secondThreadId = ThreadId.makeUnsafe("thread-mcp-reconcile-b");
const thirdThreadId = ThreadId.makeUnsafe("thread-mcp-reconcile-c");

function projectCreatedEvent(sequence: number): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-reconcile-project-created`),
    aggregateKind: "project" as const,
    aggregateId: projectId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe("create-project"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created" as const,
    payload: {
      projectId,
      title: "Reconcile project",
      workspaceRoot: "/tmp/reconcile",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  } as unknown as OrchestrationEvent;
}

function threadCreatedEvent(sequence: number, thread: ThreadId, index: number): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-reconcile-thread-${index}`),
    aggregateKind: "thread" as const,
    aggregateId: thread,
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`create-thread-${index}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.created" as const,
    payload: {
      threadId: thread,
      projectId,
      title: `Reconcile thread ${index}`,
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
  } as unknown as OrchestrationEvent;
}

function sessionSetEvent(sequence: number, thread: ThreadId, index: number): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-reconcile-session-${index}`),
    aggregateKind: "thread" as const,
    aggregateId: thread,
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`set-session-${index}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.session-set" as const,
    payload: {
      threadId: thread,
      session: {
        threadId: thread,
        status: "ready",
        providerName: "pi",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
    },
  } as unknown as OrchestrationEvent;
}

async function multiSessionReadModel(): Promise<OrchestrationReadModel> {
  let readModel = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), projectCreatedEvent(1)),
  );
  for (const [index, thread] of [issuingThreadId, secondThreadId, thirdThreadId].entries()) {
    readModel = await Effect.runPromise(
      projectEvent(readModel, threadCreatedEvent(2 + index * 2, thread, index)),
    );
    readModel = await Effect.runPromise(
      projectEvent(readModel, sessionSetEvent(3 + index * 2, thread, index)),
    );
  }
  return readModel;
}

/** Synthetic projection: apply a project.mcp-activation.update to the model. */
function applyOperationUpdate(
  model: OrchestrationReadModel,
  command: Extract<OrchestrationCommand, { type: "project.mcp-activation.update" }>,
): OrchestrationReadModel {
  return {
    ...model,
    projects: model.projects.map((project) =>
      project.id === command.projectId
        ? {
            ...project,
            synaraMcpActivationVersion: command.operation.version,
            synaraMcpActivationOperation: command.operation,
            synaraMcpDesiredState: command.desiredState,
          }
        : project,
    ),
  };
}

export type SynaraMcpEnableResolution =
  | { readonly state: "active" }
  | { readonly state: "unavailable"; readonly detail?: string }
  | { readonly state: "timeout"; readonly detail: string };
export type SynaraMcpDisableResolution =
  | { readonly state: "dormant" }
  | { readonly state: "unavailable"; readonly detail?: string }
  | { readonly state: "timeout"; readonly detail: string };

interface ReconcileHarnessOptions {
  readonly plan: SynaraMcpCommandPlan;
  readonly readModel: OrchestrationReadModel;
  readonly enable?: (input: {
    readonly threadId: ThreadId;
    readonly expectedSessionGeneration: string;
    readonly remainingMs: number;
  }) => SynaraMcpEnableResolution;
  readonly disable?: (input: {
    readonly threadId: ThreadId;
    readonly remainingMs: number;
  }) => SynaraMcpDisableResolution;
}

interface ReconcileHarness {
  readonly model: () => OrchestrationReadModel;
  readonly dispatched: OrchestrationCommand[];
  readonly enableCalls: Array<{
    readonly threadId: ThreadId;
    readonly expectedSessionGeneration: string;
    readonly remainingMs: number;
  }>;
  readonly disableCalls: Array<{ readonly threadId: ThreadId; readonly remainingMs: number }>;
  readonly seams: SynaraMcpProjectReconciliationSeams;
  readonly advance: (to: Date) => void;
}

function makeHarness(options: ReconcileHarnessOptions): ReconcileHarness {
  let model = options.readModel;
  let clock = new Date(now);
  const dispatched: OrchestrationCommand[] = [];
  const enableCalls: ReconcileHarness["enableCalls"] = [];
  const disableCalls: ReconcileHarness["disableCalls"] = [];
  const seams: SynaraMcpProjectReconciliationSeams = {
    now: () => clock,
    getReadModel: async () => model,
    dispatch: async (command) => {
      dispatched.push(command);
      if (command.type === "project.mcp-activation.update") {
        model = applyOperationUpdate(model, command);
      }
    },
    enableMember: async (input) => {
      enableCalls.push(input);
      return options.enable?.(input) ?? { state: "active" };
    },
    disableMember: async (input) => {
      disableCalls.push(input);
      return options.disable?.(input) ?? { state: "dormant" };
    },
  };
  return {
    model: () => model,
    dispatched,
    enableCalls,
    disableCalls,
    seams,
    advance: (to) => {
      clock = to;
    },
  };
}

function turnCommand(text: string) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.makeUnsafe(`turn-reconcile-${text.slice(1, 7).toLowerCase()}`),
    threadId: issuingThreadId,
    message: {
      messageId: MessageId.makeUnsafe(`message-reconcile-${text.slice(1, 7).toLowerCase()}`),
      role: "user" as const,
      text,
      attachments: [],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    createdAt: now,
  };
}

interface PendingFixture {
  readonly plan: SynaraMcpCommandPlan;
  readonly readModel: OrchestrationReadModel;
}

/** Plan a Synara MCP command and journal its durable pending operation first. */
async function pendingFixture(text: string): Promise<PendingFixture> {
  const readModel = await multiSessionReadModel();
  const plan = planSynaraMcpCommand({
    command: turnCommand(text),
    readModel,
    now: () => new Date(now),
  });
  if (!plan || !plan.projectCommand) throw new Error("Expected a pending plan");
  const operationEvent = await Effect.runPromise(
    decideOrchestrationCommand({ command: plan.projectCommand, readModel }),
  );
  const afterOperation = await Effect.runPromise(
    projectEvent(readModel, {
      ...(Array.isArray(operationEvent) ? operationEvent[0]! : operationEvent),
      sequence: 9,
    }),
  );
  return { plan, readModel: afterOperation };
}

function terminalActivities(dispatched: OrchestrationCommand[]): OrchestrationCommand[] {
  return dispatched.filter(
    (command) =>
      command.type === "thread.activity.append" &&
      (command as { activity: { kind: string } }).activity.kind.startsWith("synara.mcp.command."),
  );
}

function operationCommands(dispatched: OrchestrationCommand[]) {
  return dispatched.filter((command) => command.type === "project.mcp-activation.update") as Array<
    Extract<OrchestrationCommand, { type: "project.mcp-activation.update" }>
  >;
}

describe("Synara MCP project reconciliation (impl-08 AC1/AC2)", () => {
  it("AC1: reconciles every captured member independently and commits enabled only after all sessions succeed", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const harness = makeHarness({ plan, readModel });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "succeeded" });
    // Every captured member was enabled through the provider boundary, in
    // deterministic wait-set order, with the captured generation token.
    expect(harness.enableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
      thirdThreadId,
    ]);
    for (const call of harness.enableCalls) {
      expect(call.expectedSessionGeneration).toBe(`orchestration:${call.threadId}:${now}`);
      expect(call.remainingMs).toBeGreaterThan(0);
      expect(call.remainingMs).toBeLessThanOrEqual(120_000);
    }
    // One member outcome command per member, then exactly one terminal.
    const operations = operationCommands(harness.dispatched);
    expect(operations).toHaveLength(3);
    expect(operations.map((command) => command.operation.aggregateStatus)).toEqual([
      "pending",
      "pending",
      "succeeded",
    ]);
    const terminal = terminalActivities(harness.dispatched);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      type: "thread.activity.append",
      activity: {
        kind: "synara.mcp.command.succeeded",
        turnId: null,
        payload: { status: "succeeded", finalState: "enabled" },
      },
    });
    const finalOperation = harness.model().projects[0]!.synaraMcpActivationOperation!;
    expect(finalOperation.aggregateStatus).toBe("succeeded");
    expect(finalOperation.desiredState).toBe("enabled");
    expect(finalOperation.outcomes.every((outcome) => outcome.status === "succeeded")).toBe(true);
    // No disable fan-out on the success path.
    expect(harness.disableCalls).toEqual([]);
  });

  it("AC2: a failed member causes durable failed-disabled rollback with sibling cleanup and exactly one failed terminal", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const harness = makeHarness({
      plan,
      readModel,
      enable: (input) =>
        input.threadId === secondThreadId
          ? { state: "unavailable", detail: "Synara MCP activation could not be proven." }
          : { state: "active" },
    });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "failed" });
    // The first member succeeded; the second failed; the third was never
    // enabled (rollback is global and immediate).
    expect(harness.enableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
    ]);
    // Journal-first: the failed-disabled operation lands before cleanup.
    const failureCommand = operationCommands(harness.dispatched).at(-1)!;
    expect(failureCommand.operation.aggregateStatus).toBe("failed");
    expect(failureCommand.operation.desiredState).toBe("disabled");
    expect(failureCommand.operation.outcomes.every((outcome) => outcome.status === "failed")).toBe(
      true,
    );
    expect(
      failureCommand.operation.outcomes.every(
        (outcome) => outcome.detail === "Synara MCP activation could not be proven.",
      ),
    ).toBe(true);
    // Rollback cleanup fans out to EVERY captured member, including the
    // successful sibling and the member that never started.
    expect(harness.disableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
      thirdThreadId,
    ]);
    // Exactly one terminal activity, journaled after the durable failure.
    const terminal = terminalActivities(harness.dispatched);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      activity: {
        kind: "synara.mcp.command.failed",
        turnId: null,
        payload: { status: "failed", finalState: "disabled" },
      },
    });
    const operationDispatchIndex = harness.dispatched.indexOf(failureCommand);
    const terminalDispatchIndex = harness.dispatched.indexOf(terminal[0]!);
    expect(operationDispatchIndex).toBeLessThan(terminalDispatchIndex);
    const finalOperation = harness.model().projects[0]!.synaraMcpActivationOperation!;
    expect(finalOperation.aggregateStatus).toBe("failed");
    expect(finalOperation.desiredState).toBe("disabled");
  });

  it("AC2: an unsafe member disappearance rolls back without enabling the vanished session", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const vanishedReadModel = {
      ...readModel,
      threads: readModel.threads.filter((thread) => thread.id !== secondThreadId),
    };
    const harness = makeHarness({
      plan,
      readModel: vanishedReadModel,
      enable: () => ({ state: "active" }),
    });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "failed" });
    // The vanished member was never enabled; the preceding member was.
    expect(harness.enableCalls.map((call) => call.threadId)).toEqual([issuingThreadId]);
    const failureCommand = operationCommands(harness.dispatched).at(-1)!;
    expect(failureCommand.operation.aggregateStatus).toBe("failed");
    expect(failureCommand.operation.outcomes.every((outcome) => outcome.status === "failed")).toBe(
      true,
    );
    expect(failureCommand.operation.outcomes[0]?.detail).toBe(
      SYNARA_MCP_PROJECT_SESSION_DISAPPEARED_DETAIL,
    );
    // Cleanup still targets every captured wait-set member.
    expect(harness.disableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
      thirdThreadId,
    ]);
    expect(terminalActivities(harness.dispatched)).toHaveLength(1);
  });

  it("AC2: a member timeout rolls back with the bounded deadline detail and cleans every member", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const harness = makeHarness({
      plan,
      readModel,
      enable: (input) =>
        input.threadId === secondThreadId
          ? { state: "timeout", detail: SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL }
          : { state: "active" },
    });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "failed" });
    const failureCommand = operationCommands(harness.dispatched).at(-1)!;
    expect(failureCommand.operation.aggregateStatus).toBe("failed");
    expect(failureCommand.operation.outcomes[0]?.detail).toBe(
      SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL,
    );
    expect(harness.disableCalls).toHaveLength(3);
    expect(terminalActivities(harness.dispatched)).toHaveLength(1);
    // Every provider call was bounded by the remaining deadline.
    for (const call of harness.enableCalls) {
      expect(call.remainingMs).toBeGreaterThanOrEqual(0);
    }
    for (const call of harness.disableCalls) {
      expect(call.remainingMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("AC2: an expired deadline refuses further member work and rolls back (fake clock, never a real 120s wait)", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const harness = makeHarness({ plan, readModel });
    // The fake clock jumps past the absolute deadline before any member work.
    harness.advance(new Date("2026-08-12T12:03:00.000Z"));

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "failed" });
    expect(harness.enableCalls).toEqual([]);
    const failureCommand = operationCommands(harness.dispatched).at(-1)!;
    expect(failureCommand.operation.aggregateStatus).toBe("failed");
    expect(failureCommand.operation.outcomes[0]?.detail).toBe(
      SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL,
    );
    expect(terminalActivities(harness.dispatched)).toHaveLength(1);
  });

  it("AC2: stale work stops when the operation is settled or superseded, journaling nothing", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const harness = makeHarness({
      plan,
      readModel,
      enable: () => {
        throw new Error("enable must not run for settled work");
      },
    });
    // The operation was already settled by another path (journal-first).
    const settled = planSynaraMcpFailure({
      plan,
      project: harness.model().projects[0]!,
      detail: "settled elsewhere",
      now: () => new Date("2026-08-12T12:00:01.000Z"),
    });
    if (!settled.projectCommand) throw new Error("Expected a failure command");
    await harness.seams.dispatch(settled.projectCommand);

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "none" });
    expect(harness.enableCalls).toEqual([]);
    expect(harness.disableCalls).toEqual([]);
    expect(terminalActivities(harness.dispatched)).toHaveLength(0);
  });

  it("AC2: replay of the reconciliation produces no duplicate side effects or terminal", async () => {
    const { plan, readModel } = await pendingFixture("/Enable Synara MCP");
    const harness = makeHarness({ plan, readModel });

    const first = await reconcileSynaraMcpProject({ plan, seams: harness.seams });
    expect(first).toEqual({ terminal: "succeeded" });
    const enableCallsAfterFirst = harness.enableCalls.length;
    const dispatchedAfterFirst = harness.dispatched.length;

    // A second run against the settled operation is a no-op.
    const second = await reconcileSynaraMcpProject({ plan, seams: harness.seams });
    expect(second).toEqual({ terminal: "none" });
    expect(harness.enableCalls).toHaveLength(enableCallsAfterFirst);
    expect(harness.disableCalls).toEqual([]);
    expect(harness.dispatched).toHaveLength(dispatchedAfterFirst);
  });

  it("AC2: multi-session disable fans out fail-closed and one unavailable member yields failed-disabled", async () => {
    const { plan, readModel } = await pendingFixture("/Disable Synara MCP");
    const harness = makeHarness({
      plan,
      readModel,
      disable: (input) =>
        input.threadId === secondThreadId
          ? { state: "unavailable", detail: "Synara MCP cleanup could not be proven." }
          : { state: "dormant" },
    });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "failed" });
    // The loop disabled the issuing session first, then the failing member;
    // the rollback fan-out then targets every captured member again
    // (idempotent at the provider) so cleanup is complete for all siblings.
    expect(harness.disableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
      issuingThreadId,
      secondThreadId,
      thirdThreadId,
    ]);
    const failureCommand = operationCommands(harness.dispatched).at(-1)!;
    expect(failureCommand.operation.aggregateStatus).toBe("failed");
    expect(failureCommand.operation.desiredState).toBe("disabled");
    expect(failureCommand.operation.outcomes.every((outcome) => outcome.status === "failed")).toBe(
      true,
    );
    const terminal = terminalActivities(harness.dispatched);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      activity: { kind: "synara.mcp.command.failed", payload: { finalState: "disabled" } },
    });
  });

  it("AC2: a disappeared disable member is dormant by construction and cleanup still targets every captured member", async () => {
    const { plan, readModel } = await pendingFixture("/Disable Synara MCP");
    const vanishedReadModel = {
      ...readModel,
      threads: readModel.threads.filter((thread) => thread.id !== thirdThreadId),
    };
    const harness = makeHarness({
      plan,
      readModel: vanishedReadModel,
      disable: (input) =>
        input.threadId === secondThreadId
          ? { state: "unavailable", detail: "cleanup unproven" }
          : { state: "dormant" },
    });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "failed" });
    // The vanished member was never disabled in the loop (dormant by
    // construction); the rollback fan-out still targets every captured member,
    // including the vanished one and the already-processed siblings.
    expect(harness.disableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
      issuingThreadId,
      secondThreadId,
      thirdThreadId,
    ]);
    expect(terminalActivities(harness.dispatched)).toHaveLength(1);
  });

  it("AC2: an all-dormant multi-session disable commits one succeeded terminal", async () => {
    const { plan, readModel } = await pendingFixture("/Disable Synara MCP");
    const harness = makeHarness({ plan, readModel });

    const result = await reconcileSynaraMcpProject({ plan, seams: harness.seams });

    expect(result).toEqual({ terminal: "succeeded" });
    expect(harness.disableCalls.map((call) => call.threadId)).toEqual([
      issuingThreadId,
      secondThreadId,
      thirdThreadId,
    ]);
    const finalOperation = harness.model().projects[0]!.synaraMcpActivationOperation!;
    expect(finalOperation.aggregateStatus).toBe("succeeded");
    expect(finalOperation.desiredState).toBe("disabled");
    const terminal = terminalActivities(harness.dispatched);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      activity: {
        kind: "synara.mcp.command.succeeded",
        payload: { status: "succeeded", finalState: "disabled" },
      },
    });
  });
});
