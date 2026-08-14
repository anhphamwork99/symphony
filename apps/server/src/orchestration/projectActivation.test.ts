import {
  CommandId,
  EventId,
  IsoDateTime,
  makeProjectMcpActivationRecoveryIdentity,
  OrchestrationEvent,
  ProjectId,
  ProjectMcpActivationOperation,
  ProjectMcpActivationUpdateCommand,
  ThreadId,
} from "@synara/contracts";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-08-12T12:00:00.000Z" as IsoDateTime;
const projectId = ProjectId.makeUnsafe("project-activation");
const sessionId = ThreadId.makeUnsafe("session-activation");

const operation = (overrides: Partial<ProjectMcpActivationOperation> = {}) =>
  ({
    projectId,
    requestId: "request-activation",
    operationGeneration: 1,
    recoveryIdentity: makeProjectMcpActivationRecoveryIdentity({
      projectId,
      requestId: "request-activation",
      operationGeneration: 1,
    }),
    issuingThreadId: sessionId,
    absoluteDeadline: "2026-08-12T12:02:00.000Z",
    desiredState: "enabled",
    waitSet: [{ sessionId, sessionGeneration: "runtime-1" }],
    outcomes: [
      {
        sessionId,
        sessionGeneration: "runtime-1",
        status: "pending",
        detail: null,
        updatedAt: now,
      },
    ],
    aggregateStatus: "pending",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }) satisfies ProjectMcpActivationOperation;

const command = (overrides: Partial<ProjectMcpActivationUpdateCommand> = {}) =>
  ({
    type: "project.mcp-activation.update",
    commandId: CommandId.makeUnsafe("command-activation"),
    projectId,
    desiredState: "enabled",
    expectedVersion: 0,
    operation: operation(),
    ...overrides,
  }) satisfies ProjectMcpActivationUpdateCommand;

const event = (overrides: Partial<Extract<OrchestrationEvent, { type: "project.created" }>> = {}) =>
  ({
    sequence: 1,
    eventId: EventId.makeUnsafe("event-project-activation"),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe("command-project-created"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId,
      title: "Activation",
      workspaceRoot: "/tmp/activation",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  }) as Extract<OrchestrationEvent, { type: "project.created" }>;

// Array.isArray does not narrow readonly arrays out of a union (the decider
// returns `event | readonly event[]`), so the assertions below use this guard
// to reach a precise element type in both branches.
const isEventArray = (value: unknown): value is readonly Omit<OrchestrationEvent, "sequence">[] =>
  Array.isArray(value);

describe("project MCP activation persistence contract", () => {
  it("decides, validates, projects, and replays the complete operation identity", async () => {
    const initial = await Effect.runPromise(projectEvent(createEmptyReadModel(now), event()));
    const decided = await Effect.runPromise(
      decideOrchestrationCommand({ command: command(), readModel: initial }),
    );
    const activationEvent = Array.isArray(decided) ? decided[0]! : decided;

    expect(activationEvent.type).toBe("project.mcp-activation-updated");
    const projected = await Effect.runPromise(
      projectEvent(initial, {
        ...activationEvent,
        sequence: 2,
      }),
    );
    const hydrated = projected.projects[0]!;
    expect(hydrated.synaraMcpDesiredState).toBe("enabled");
    expect(hydrated.synaraMcpActivationOperation).toEqual(operation());
    expect(hydrated.synaraMcpActivationVersion).toBe(1);

    const replayed = await Effect.runPromise(projectEvent(createEmptyReadModel(now), event()));
    const replayedWithActivation = await Effect.runPromise(
      projectEvent(replayed, {
        ...activationEvent,
        sequence: 2,
      }),
    );
    expect(replayedWithActivation.projects[0]?.synaraMcpActivationOperation).toEqual(
      hydrated.synaraMcpActivationOperation,
    );
  });

  it("survives journal append and replay with the same operation identity", async () => {
    const program = Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const initial = yield* projectEvent(createEmptyReadModel(now), event());
      const decided = yield* decideOrchestrationCommand({ command: command(), readModel: initial });
      const activationEvent = Array.isArray(decided) ? decided[0]! : decided;
      const saved = yield* store.append(activationEvent);
      const replayed = yield* Stream.runCollect(store.readFromSequence(saved.sequence - 1, 10));
      return Array.from(replayed);
    }).pipe(
      Effect.provide(OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory))),
    );

    const replayed = await Effect.runPromise(program);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.type).toBe("project.mcp-activation-updated");
    expect(
      (replayed[0] as Extract<OrchestrationEvent, { type: "project.mcp-activation-updated" }>)
        .payload.operation,
    ).toEqual(operation());
  });

  it("rejects stale CAS and concurrent activation requests through the decider boundary", async () => {
    const initial = await Effect.runPromise(projectEvent(createEmptyReadModel(now), event()));

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({ expectedVersion: 1 }),
          readModel: initial,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "Project MCP activation version is stale: expected 0, received 1.",
    });

    const firstActivation = await Effect.runPromise(
      decideOrchestrationCommand({ command: command(), readModel: initial }),
    );
    const firstActivationEvent = Array.isArray(firstActivation)
      ? firstActivation[0]!
      : firstActivation;
    const afterFirstActivation = await Effect.runPromise(
      projectEvent(initial, { ...firstActivationEvent, sequence: 2 }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({
            expectedVersion: 1,
            operation: operation({
              requestId: "request-activation-2",
              version: 2,
            }),
          }),
          readModel: afterFirstActivation,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "A project activation operation is already pending for another request.",
    });

    const rollback = operation({
      desiredState: "disabled",
      aggregateStatus: "failed",
      version: 2,
      outcomes: [
        {
          sessionId,
          sessionGeneration: "runtime-1",
          status: "failed",
          detail: "safe-boundary failure",
          updatedAt: now,
        },
      ],
    });
    const rollbackEvent = await Effect.runPromise(
      decideOrchestrationCommand({
        command: command({
          expectedVersion: 1,
          desiredState: "disabled",
          operation: rollback,
          commandId: CommandId.makeUnsafe("command-activation-terminal-operation"),
        }),
        readModel: afterFirstActivation,
      }),
    );
    expect((isEventArray(rollbackEvent) ? rollbackEvent[0] : rollbackEvent)?.type).toBe(
      "project.mcp-activation-updated",
    );
  });

  it("rejects a new activation operation without the recovery record", async () => {
    const initial = await Effect.runPromise(projectEvent(createEmptyReadModel(now), event()));

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({
            operation: operation({ recoveryIdentity: undefined }),
          }),
          readModel: initial,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "A new activation operation must carry a recovery identity and issuing thread.",
    });

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({
            operation: operation({ issuingThreadId: undefined }),
          }),
          readModel: initial,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "A new activation operation must carry a recovery identity and issuing thread.",
    });
  });

  it("keeps the recovery record immutable across same-request updates", async () => {
    const initial = await Effect.runPromise(projectEvent(createEmptyReadModel(now), event()));
    const firstActivation = await Effect.runPromise(
      decideOrchestrationCommand({ command: command(), readModel: initial }),
    );
    const firstActivationEvent = Array.isArray(firstActivation)
      ? firstActivation[0]!
      : firstActivation;
    const afterFirstActivation = await Effect.runPromise(
      projectEvent(initial, { ...firstActivationEvent, sequence: 2 }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({
            expectedVersion: 1,
            operation: operation({
              version: 2,
              recoveryIdentity: "synara-mcp-recovery:01234567",
            }),
          }),
          readModel: afterFirstActivation,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "An activation operation recovery identity is immutable.",
    });

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({
            expectedVersion: 1,
            operation: operation({
              version: 2,
              issuingThreadId: ThreadId.makeUnsafe("other-issuing-thread"),
            }),
          }),
          readModel: afterFirstActivation,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "An activation operation issuing thread is immutable.",
    });
  });

  it("requires the recovery record on a new request after a terminal operation", async () => {
    const initial = await Effect.runPromise(projectEvent(createEmptyReadModel(now), event()));
    const accepted = await Effect.runPromise(
      decideOrchestrationCommand({ command: command(), readModel: initial }),
    );
    const acceptedEvent = Array.isArray(accepted) ? accepted[0]! : accepted;
    const afterFirst = await Effect.runPromise(
      projectEvent(initial, { ...acceptedEvent, sequence: 2 }),
    );
    const terminal = operation({
      aggregateStatus: "succeeded",
      version: 2,
      outcomes: [
        {
          sessionId,
          sessionGeneration: "runtime-1",
          status: "succeeded" as const,
          detail: null,
          updatedAt: now,
        },
      ],
    });
    const terminalEvent = await Effect.runPromise(
      decideOrchestrationCommand({
        command: command({
          expectedVersion: 1,
          operation: terminal,
          commandId: CommandId.makeUnsafe("command-activation-terminal"),
        }),
        readModel: afterFirst,
      }),
    );
    const afterTerminal = await Effect.runPromise(
      projectEvent(afterFirst, {
        ...(Array.isArray(terminalEvent) ? terminalEvent[0]! : terminalEvent),
        sequence: 3,
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: command({
            expectedVersion: 2,
            operation: operation({
              requestId: "request-activation-2",
              operationGeneration: 2,
              recoveryIdentity: undefined,
              version: 3,
            }),
            commandId: CommandId.makeUnsafe("command-activation-2"),
          }),
          readModel: afterTerminal,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandInvariantError",
      detail: "A new activation operation must carry a recovery identity and issuing thread.",
    });
  });
});
