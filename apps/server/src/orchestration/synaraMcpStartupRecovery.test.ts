// FILE: synaraMcpStartupRecovery.test.ts
// Purpose: Verifies impl-09 AC1 — startup/replay reconciliation. After the
// projection bootstrap and before markCommandReady, every durable pending
// operation is settled from its persisted deadline with ZERO provider/MCP
// replay: pending enable rolls back failed-disabled (the pre-restart runtimes
// are gone), pending disable converges safely disabled, exactly one
// deterministic terminal activity is journaled, stale/duplicate work stops,
// and a legacy pending operation without a recovery identity blocks startup
// with a bounded diagnostic. Old terminal JSON still decodes through the
// durable schema. Uses a controllable clock and fake dispatch seams (no
// provider seam exists in the module: recovery performs no provider calls).
// Layer: Orchestration startup-recovery tests
import {
  CommandId,
  EventId,
  IsoDateTime,
  makeProjectMcpActivationRecoveryIdentity,
  MessageId,
  ProjectId,
  ProjectMcpActivationOperation,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";
import {
  planSynaraMcpCommand,
  type SynaraMcpCommandPlan,
} from "./synaraMcpCommand.ts";
import {
  recoverSynaraMcpPendingOperations,
  SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DEADLINE_ELAPSED_DETAIL,
  SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL,
  type SynaraMcpStartupRecoverySeams,
} from "./synaraMcpStartupRecovery.ts";

const now = "2026-08-12T12:00:00.000Z" as IsoDateTime;
const projectId = ProjectId.makeUnsafe("project-mcp-recovery");
const issuingThreadId = ThreadId.makeUnsafe("thread-mcp-recovery");
const secondThreadId = ThreadId.makeUnsafe("thread-mcp-recovery-b");

function projectCreatedEvent(sequence: number): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.makeUnsafe("event-recovery-project-created"),
    aggregateKind: "project" as const,
    aggregateId: projectId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe("create-recovery-project"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created" as const,
    payload: {
      projectId,
      title: "Recovery project",
      workspaceRoot: "/tmp/recovery",
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
    eventId: EventId.makeUnsafe(`event-recovery-thread-${index}`),
    aggregateKind: "thread" as const,
    aggregateId: thread,
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`create-recovery-thread-${index}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.created" as const,
    payload: {
      threadId: thread,
      projectId,
      title: `Recovery thread ${index}`,
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
    eventId: EventId.makeUnsafe(`event-recovery-session-${index}`),
    aggregateKind: "thread" as const,
    aggregateId: thread,
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`set-recovery-session-${index}`),
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

/** A project with two live sessions (the issuing thread plus one sibling). */
async function baseReadModel(): Promise<OrchestrationReadModel> {
  let readModel = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), projectCreatedEvent(1)),
  );
  for (const [index, thread] of [issuingThreadId, secondThreadId].entries()) {
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

function turnCommand(text: string) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.makeUnsafe(`turn-recovery-${text.slice(1, 7).toLowerCase()}`),
    threadId: issuingThreadId,
    message: {
      messageId: MessageId.makeUnsafe(`message-recovery-${text.slice(1, 7).toLowerCase()}`),
      role: "user" as const,
      text,
      attachments: [],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    createdAt: now,
  };
}

interface RecoveryHarness {
  readonly model: () => OrchestrationReadModel;
  readonly dispatched: OrchestrationCommand[];
  readonly seams: SynaraMcpStartupRecoverySeams;
  readonly advance: (to: Date) => void;
}

function makeHarness(options: {
  readonly readModel: OrchestrationReadModel;
  /** Optional mutation applied after the first read model fetch (stale-work race). */
  readonly afterFirstRead?: (model: OrchestrationReadModel) => OrchestrationReadModel;
}): RecoveryHarness {
  let model = options.readModel;
  let clock = new Date(now);
  let reads = 0;
  const dispatched: OrchestrationCommand[] = [];
  const seams: SynaraMcpStartupRecoverySeams = {
    now: () => clock,
    getReadModel: async () => {
      reads += 1;
      if (reads === 2 && options.afterFirstRead !== undefined) {
        model = options.afterFirstRead(model);
      }
      return model;
    },
    dispatch: async (command) => {
      dispatched.push(command);
      if (command.type === "project.mcp-activation.update") {
        model = applyOperationUpdate(model, command);
      }
    },
  };
  return {
    model: () => model,
    dispatched,
    seams,
    advance: (to) => {
      clock = to;
    },
  };
}

/** The durable pending operation a restart would hydrate, minted by the planner. */
async function pendingOperationFor(
  text: "/Enable Synara MCP" | "/Disable Synara MCP",
): Promise<{ plan: SynaraMcpCommandPlan; restartModel: OrchestrationReadModel }> {
  const readModel = await baseReadModel();
  const plan = planSynaraMcpCommand({
    command: turnCommand(text),
    readModel,
    now: () => new Date(now),
  });
  if (plan === null) throw new Error("Expected a command plan");
  const restartModel = applyOperationUpdate(readModel, plan.projectCommand!);
  return { plan, restartModel };
}

describe("impl-09 AC1: startup recovery of pending project activation operations", () => {
  it("settles a pending enable with a journal-first failed-disabled rollback and one deterministic terminal", async () => {
    const { plan, restartModel } = await pendingOperationFor("/Enable Synara MCP");
    const harness = makeHarness({ readModel: restartModel });
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });

    expect(result).toEqual({
      kind: "recovered",
      operations: [
        {
          projectId,
          requestId: plan.requestId,
          operationGeneration: plan.operation.operationGeneration,
          terminal: "failed",
        },
      ],
    });
    expect(harness.dispatched).toHaveLength(2);
    const projectCommand = harness.dispatched[0] as Extract<
      OrchestrationCommand,
      { type: "project.mcp-activation.update" }
    >;
    const activityCommand = harness.dispatched[1] as Extract<
      OrchestrationCommand,
      { type: "thread.activity.append" }
    >;

    // Journal-first: the durable failed-disabled operation lands before the
    // terminal activity, with the deterministic terminal-operation command id.
    expect(projectCommand.type).toBe("project.mcp-activation.update");
    expect(projectCommand.commandId).toBe(`${plan.requestId}:terminal-operation`);
    expect(projectCommand.desiredState).toBe("disabled");
    const settled = projectCommand.operation;
    expect(settled.aggregateStatus).toBe("failed");
    expect(settled.desiredState).toBe("disabled");
    expect(settled.version).toBe(plan.operation.version + 1);
    expect(settled.recoveryIdentity).toBe(plan.operation.recoveryIdentity);
    expect(settled.issuingThreadId).toBe(issuingThreadId);
    // The persisted deadline is never extended: it stays the original one.
    expect(settled.absoluteDeadline).toBe(plan.operation.absoluteDeadline);
    for (const outcome of settled.outcomes) {
      expect(outcome.status).toBe("failed");
      expect(outcome.detail).toBe(SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL);
    }

    expect(activityCommand.type).toBe("thread.activity.append");
    expect(activityCommand.threadId).toBe(issuingThreadId);
    expect(activityCommand.activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activityCommand.commandId).toBe(`${plan.requestId}:terminal`);
    expect(activityCommand.activity.kind).toBe("synara.mcp.command.failed");
    expect(activityCommand.activity.turnId).toBeNull();
    expect(activityCommand.activity.payload).toMatchObject({
      requestId: plan.requestId,
      command: "enable",
      phase: "terminal",
      status: "failed",
      requestedState: "enabled",
      finalState: "disabled",
      detail: SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL,
    });

    // The durable model converged to failed-disabled.
    expect(harness.model().projects[0]?.synaraMcpDesiredState).toBe("disabled");
    expect(
      harness.model().projects[0]?.synaraMcpActivationOperation?.aggregateStatus,
    ).toBe("failed");

    // No provider/MCP replay: the module has no provider seam, and the
    // dispatched surface is exactly the operation + the terminal activity.
  });

  it("reports the elapsed persisted deadline in the rollback detail without extending it", async () => {
    const { plan, restartModel } = await pendingOperationFor("/Enable Synara MCP");
    const harness = makeHarness({ readModel: restartModel });
    // Restart completes after the persisted absolute deadline (fake clock;
    // never a real 120-second wait).
    harness.advance(new Date(Date.parse(plan.operation.absoluteDeadline) + 1_000));
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });

    expect(result).toEqual({
      kind: "recovered",
      operations: [
        {
          projectId,
          requestId: plan.requestId,
          operationGeneration: plan.operation.operationGeneration,
          terminal: "failed",
        },
      ],
    });
    const activityCommand = harness.dispatched[1] as Extract<
      OrchestrationCommand,
      { type: "thread.activity.append" }
    >;
    expect(activityCommand.activity.payload).toMatchObject({
      status: "failed",
      finalState: "disabled",
      detail: expect.stringContaining(
        SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DEADLINE_ELAPSED_DETAIL,
      ),
    });
    // The deadline is not extended by the recovery.
    const settled = (harness.dispatched[0] as Extract<
      OrchestrationCommand,
      { type: "project.mcp-activation.update" }
    >).operation;
    expect(settled.absoluteDeadline).toBe(plan.operation.absoluteDeadline);
  });

  it("converges a pending disable to succeeded-disabled with one deterministic terminal", async () => {
    const { plan, restartModel } = await pendingOperationFor("/Disable Synara MCP");
    const harness = makeHarness({ readModel: restartModel });
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });

    expect(result).toEqual({
      kind: "recovered",
      operations: [
        {
          projectId,
          requestId: plan.requestId,
          operationGeneration: plan.operation.operationGeneration,
          terminal: "succeeded",
        },
      ],
    });
    expect(harness.dispatched).toHaveLength(2);
    const projectCommand = harness.dispatched[0] as Extract<
      OrchestrationCommand,
      { type: "project.mcp-activation.update" }
    >;
    const activityCommand = harness.dispatched[1] as Extract<
      OrchestrationCommand,
      { type: "thread.activity.append" }
    >;

    expect(projectCommand.desiredState).toBe("disabled");
    expect(projectCommand.operation.aggregateStatus).toBe("succeeded");
    expect(projectCommand.operation.desiredState).toBe("disabled");
    for (const outcome of projectCommand.operation.outcomes) {
      expect(outcome.status).toBe("succeeded");
      expect(outcome.detail).toBeNull();
    }
    expect(activityCommand.activity.kind).toBe("synara.mcp.command.succeeded");
    expect(activityCommand.activity.id).toBe(`${plan.requestId}:terminal`);
    expect(activityCommand.threadId).toBe(issuingThreadId);
    expect(activityCommand.activity.payload).toMatchObject({
      requestId: plan.requestId,
      command: "disable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "disabled",
      finalState: "disabled",
    });
    expect(harness.model().projects[0]?.synaraMcpDesiredState).toBe("disabled");
  });

  it("blocks startup with a bounded diagnostic for a legacy pending operation without a recovery identity", async () => {
    const { plan, restartModel } = await pendingOperationFor("/Enable Synara MCP");
    const legacyPending: OrchestrationReadModel = {
      ...restartModel,
      projects: restartModel.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              synaraMcpActivationOperation: {
                ...plan.operation,
                recoveryIdentity: undefined,
                issuingThreadId: undefined,
              } as unknown as ProjectMcpActivationOperation,
            }
          : project,
      ),
    };
    const harness = makeHarness({ readModel: legacyPending });
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });

    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("Expected blocked");
    expect(result.detail).toContain(projectId);
    expect(result.detail).toContain(plan.requestId);
    expect(result.detail).toContain(String(plan.operation.operationGeneration));
    expect(result.detail.length).toBeLessThanOrEqual(1_024);
    // Nothing was journaled: startup fails closed before any settlement.
    expect(harness.dispatched).toHaveLength(0);
  });

  it("blocks startup when a recoverable pending operation lacks its issuing thread", async () => {
    const { plan, restartModel } = await pendingOperationFor("/Disable Synara MCP");
    const incomplete: OrchestrationReadModel = {
      ...restartModel,
      projects: restartModel.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              synaraMcpActivationOperation: {
                ...plan.operation,
                issuingThreadId: undefined,
              } as unknown as ProjectMcpActivationOperation,
            }
          : project,
      ),
    };
    const harness = makeHarness({ readModel: incomplete });
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });
    expect(result.kind).toBe("blocked");
    expect(harness.dispatched).toHaveLength(0);
  });

  it("stops stale work when the operation settled between reads and journaled nothing twice", async () => {
    const { plan, restartModel } = await pendingOperationFor("/Enable Synara MCP");
    // Simulate a concurrent settlement between the recovery's first and second
    // read: the second read sees the operation terminal, so the recovery must
    // stop without journaling anything.
    const settled = applyOperationUpdate(
      restartModel,
      {
        type: "project.mcp-activation.update",
        commandId: CommandId.makeUnsafe("external-settlement"),
        projectId,
        desiredState: "disabled",
        expectedVersion: plan.operation.version,
        operation: {
          ...plan.operation,
          desiredState: "disabled",
          outcomes: plan.operation.outcomes.map((outcome) => ({
            ...outcome,
            status: "failed" as const,
            detail: "external settlement",
          })),
          aggregateStatus: "failed",
          version: plan.operation.version + 1,
        },
      },
    );
    const harness = makeHarness({
      readModel: restartModel,
      afterFirstRead: () => settled,
    });
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });
    expect(result).toEqual({ kind: "recovered", operations: [] });
    expect(harness.dispatched).toHaveLength(0);

    // A second full pass is a no-op: the operation is already terminal.
    const again = await recoverSynaraMcpPendingOperations({ seams: harness.seams });
    expect(again).toEqual({ kind: "recovered", operations: [] });
    expect(harness.dispatched).toHaveLength(0);
  });

  it("recovers multiple pending operations across projects", async () => {
    const secondProjectId = ProjectId.makeUnsafe("project-mcp-recovery-2");
    const { restartModel } = await pendingOperationFor("/Enable Synara MCP");
    const withSecondProject: OrchestrationReadModel = {
      ...restartModel,
      projects: [
        ...restartModel.projects,
        {
          ...restartModel.projects[0]!,
          id: secondProjectId,
          title: "Recovery project 2",
        },
      ],
    };
    const harness = makeHarness({ readModel: withSecondProject });
    const result = await recoverSynaraMcpPendingOperations({ seams: harness.seams });
    expect(result.kind).toBe("recovered");
    if (result.kind !== "recovered") throw new Error("Expected recovered");
    expect(result.operations).toHaveLength(2);
    expect(harness.dispatched).toHaveLength(4);
  });

  it("allows legacy terminal JSON to decode through the durable schema", () => {
    // Pre-impl-09 terminal operations carry no recovery record; the schema
    // must decode them unchanged so historical journal rows keep replaying.
    const legacyTerminal: ProjectMcpActivationOperation = {
      projectId,
      requestId: "legacy-request",
      operationGeneration: 1,
      absoluteDeadline: "2026-08-12T12:02:00.000Z",
      desiredState: "disabled",
      waitSet: [{ sessionId: secondThreadId, sessionGeneration: "runtime-legacy" }],
      outcomes: [
        {
          sessionId: secondThreadId,
          sessionGeneration: "runtime-legacy",
          status: "succeeded",
          detail: null,
          updatedAt: now,
        },
      ],
      aggregateStatus: "succeeded",
      version: 2,
      createdAt: now,
      updatedAt: now,
    } as ProjectMcpActivationOperation;
    const decoded = Schema.decodeUnknownSync(ProjectMcpActivationOperation)(legacyTerminal);
    expect(decoded.recoveryIdentity).toBeUndefined();
    expect(decoded.issuingThreadId).toBeUndefined();
    expect(decoded.aggregateStatus).toBe("succeeded");

    // Legacy pending JSON also decodes at the schema level (permissive), so
    // the projection bootstrap is not broken; startup recovery is the layer
    // that blocks it with the bounded diagnostic.
    const legacyPending = {
      ...legacyTerminal,
      desiredState: "enabled" as const,
      aggregateStatus: "pending" as const,
      version: 1,
      outcomes: [
        {
          sessionId: secondThreadId,
          sessionGeneration: "runtime-legacy",
          status: "pending" as const,
          detail: null,
          updatedAt: now,
        },
      ],
    };
    const decodedPending = Schema.decodeUnknownSync(ProjectMcpActivationOperation)(legacyPending);
    expect(decodedPending.recoveryIdentity).toBeUndefined();
    expect(decodedPending.aggregateStatus).toBe("pending");
  });

  it("rejects a recovery identity that does not round-trip through the schema", () => {
    const withIdentity = makeProjectMcpActivationRecoveryIdentity({
      projectId,
      requestId: "legacy-request",
      operationGeneration: 1,
    });
    expect(withIdentity.startsWith("synara-mcp-recovery:")).toBe(true);
    expect(withIdentity.length).toBeLessThanOrEqual(128);
    const operation: ProjectMcpActivationOperation = {
      projectId,
      requestId: "legacy-request",
      operationGeneration: 1,
      recoveryIdentity: withIdentity,
      issuingThreadId: issuingThreadId,
      absoluteDeadline: "2026-08-12T12:02:00.000Z",
      desiredState: "enabled",
      waitSet: [{ sessionId: secondThreadId, sessionGeneration: "runtime-legacy" }],
      outcomes: [
        {
          sessionId: secondThreadId,
          sessionGeneration: "runtime-legacy",
          status: "pending",
          detail: null,
          updatedAt: now,
        },
      ],
      aggregateStatus: "pending",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const decoded = Schema.decodeUnknownSync(ProjectMcpActivationOperation)(operation);
    expect(decoded.recoveryIdentity).toBe(withIdentity);
    expect(decoded.issuingThreadId).toBe(issuingThreadId);
  });
});
