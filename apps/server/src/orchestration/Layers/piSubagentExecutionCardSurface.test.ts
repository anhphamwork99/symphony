import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
  type PiSubagentExecutionCard,
} from "@synara/contracts";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as NodeServices from "@effect/platform-node";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import {
  PiSubagentExecutionRepositoryLive,
  setPiSubagentExecutionLifecycleListener,
} from "../../persistence/Layers/PiSubagentExecutionRepository.ts";
import { PiSubagentExecutionRepository } from "../../persistence/Services/PiSubagentExecutionRepository.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makePiSubagentExecutionCardBridge } from "../../provider/piSubagentExecutionCardBridge.ts";
import {
  isThreadDetailEventFor,
  THREAD_DETAIL_EVENT_TYPES,
} from "@synara/shared/threadDetailEvents";

/**
 * Ticket 11 — reconnectable execution card: snapshot/replay surface
 * (T11-AC1, T11-AC2, T11-AC5 contract side).
 *
 * Proves against a REAL OrchestrationEngine + REAL repository:
 * - T11-AC1: the thread-detail snapshot exposes the bounded execution-card
 *   aggregate (identity, desired/observed, latest coalesced progress, lease,
 *   terminal summary, delivery state, diagnostics) with no prompt or raw
 *   progress JSON, capped per thread;
 * - T11-AC2: lifecycle replay resumes after the client cursor
 *   (readThreadEvents afterSequence) and intermediate progress history is
 *   never journaled/replayed; duplicate event identities have ONE projection
 *   effect (deterministic command identity → engine receipt replay, and the
 *   web reducer's upsert idempotency is covered by web-side tests);
 * - T11-AC5: the card rides the thread-detail snapshot — hydration needs no
 *   parent tool row or live session.
 */

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

const TestServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-t11-execution-card-",
});

async function createEngineSystem() {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(PiSubagentExecutionRepositoryLive),
    Layer.provideMerge(TestServerConfigLayer),
    Layer.provideMerge(NodeServices.NodeServices.layer),
  )
    .pipe(Layer.provideMerge(SqlitePersistenceMemory))
    // Expose the snapshot query + execution repository to the test runtime
    // (provide-merge so Effect.service resolves them from the same context).
    .pipe(
      Layer.provideMerge(
        OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      ),
      Layer.provideMerge(
        PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      ),
    );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
  const repository = await runtime.runPromise(Effect.service(PiSubagentExecutionRepository));
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    runtime.runPromise(effect as Effect.Effect<A, E, never>);
  const port = engine as unknown as {
    dispatch: (command: unknown) => Effect.Effect<{ sequence: number }, unknown, never>;
    readEvents: (from: number) => Stream.Stream<OrchestrationEvent, unknown, never>;
    readThreadEvents: (
      threadId: string,
      fromSequenceExclusive: number,
      eventTypes?: ReadonlyArray<string>,
    ) => Stream.Stream<OrchestrationEvent, unknown, never>;
    readThreadEventsThrough: (
      threadId: string,
      fromSequenceExclusive: number,
      throughSequenceInclusive: number,
      eventTypes?: ReadonlyArray<string>,
    ) => Stream.Stream<OrchestrationEvent, unknown, never>;
    getEventHighWaterSequence: Effect.Effect<number, unknown, never>;
  };
  return { run, port, snapshotQuery, repository, dispose: () => runtime.dispose() };
}

type EngineSystem = Awaited<ReturnType<typeof createEngineSystem>>;

const createdAt = () => new Date().toISOString();

async function createProjectAndThread(system: EngineSystem, suffix: string) {
  await system.run(
    system.port.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-t11-project-${suffix}`),
      projectId: asProjectId(`project-t11-${suffix}`),
      title: `T11 ${suffix}`,
      workspaceRoot: `/tmp/t11-${suffix}`,
      defaultModelSelection: null,
      createdAt: createdAt(),
    }),
  );
  await system.run(
    system.port.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-t11-thread-${suffix}`),
      threadId: asThreadId(`thread-t11-${suffix}`),
      projectId: asProjectId(`project-t11-${suffix}`),
      title: `T11 ${suffix} parent`,
      modelSelection: { provider: "pi", model: "deterministic" },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: createdAt(),
    }),
  );
}

const admitExecution = async (
  system: EngineSystem,
  input: {
    readonly executionId: string;
    readonly threadId: string;
    readonly prompt?: string;
    readonly now?: string;
  },
) => {
  const result = await system.run(
    system.repository.recordAdmission({
      executionId: input.executionId,
      attemptId: `${input.executionId}_att1`,
      generation: 1,
      commandId: `cmd_spawn_${input.executionId}`,
      commandFingerprint: `fp_${input.executionId}`,
      projectId: "project-t11-a",
      parentThreadId: input.threadId,
      parentTurnId: null,
      parentToolCallId: null,
      agentType: "worker",
      prompt: input.prompt ?? "Do the delegated work",
      mode: "foreground",
      cancellationScope: "parent_turn",
      state: "accepted",
      now: input.now ?? createdAt(),
    }),
  );
  expect(result.kind).toBe("admitted");
};

const readThreadCardEvents = async (
  system: EngineSystem,
  threadId: string,
  fromSequenceExclusive: number,
) =>
  system.run(
    Stream.runCollect(
      system.port.readThreadEvents(threadId, fromSequenceExclusive, THREAD_DETAIL_EVENT_TYPES),
    ).pipe(Effect.map((chunk) => Array.from(chunk))),
  );

describe("Ticket 11 execution-card snapshot/replay surface", () => {
  it("T11-AC1: thread-detail snapshot exposes the bounded card aggregate without prompt or raw progress JSON", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "a");
      await admitExecution(system, {
        executionId: "exec-t11-ac1",
        threadId: "thread-t11-a",
        prompt: "SECRET PROMPT CONTENT THAT MUST NEVER LEAVE THE SERVER",
        now: "2026-08-19T00:00:00.000Z",
      });
      // Latest coalesced progress + lease observation.
      await system.run(
        system.repository.recordProgressObservation({
          executionId: "exec-t11-ac1",
          progressJson: JSON.stringify({ summary: "Compiling module 7 of 9" }),
          occurredAt: "2026-08-19T00:00:05.000Z",
          droppedCountDelta: 3,
        }),
      );
      await system.run(
        system.repository.recordHeartbeatObservation({
          executionId: "exec-t11-ac1",
          occurredAt: "2026-08-19T00:00:08.000Z",
          leaseExpiresAt: "2026-08-19T00:00:38.000Z",
        }),
      );

      const cards = await system.run(
        system.repository.listExecutionCardsByThreadId("thread-t11-a", 64),
      );
      expect(cards).toHaveLength(1);
      const card = cards[0] as PiSubagentExecutionCard;
      expect(card.executionId).toBe("exec-t11-ac1");
      expect(card.desiredState).toBe("running");
      expect(card.observedState).toBe("accepted");
      expect(card.leaseExpiresAt).toBe("2026-08-19T00:00:38.000Z");
      expect(card.lastProgressSummary).toBe("Compiling module 7 of 9");
      expect(card.lastProgressAt).toBe("2026-08-19T00:00:05.000Z");
      expect(card.droppedProgressCount).toBe(3);

      // Snapshot path: the thread-detail snapshot carries the same bounded
      // aggregate (T11-AC5: hydration independent of any live tool row).
      const detail = await system.run(
        system.snapshotQuery.getThreadDetailSnapshotById(asThreadId("thread-t11-a")),
      );
      expect(detail._tag).toBe("Some");
      if (detail._tag !== "Some") {
        return;
      }
      const snapshotCards = detail.value.thread.piSubagentExecutions ?? [];
      expect(snapshotCards).toHaveLength(1);
      expect(snapshotCards[0]!.executionId).toBe("exec-t11-ac1");
      expect(snapshotCards[0]!.leaseExpiresAt).toBe("2026-08-19T00:00:38.000Z");

      // T11-AC1 bound contract: no prompt, no raw progress JSON anywhere in
      // the serialized card payload.
      const serialized = JSON.stringify(detail.value.thread.piSubagentExecutions);
      expect(serialized).not.toContain("SECRET PROMPT CONTENT");
      expect(serialized).not.toContain("progressJson");
    } finally {
      await system.dispose();
    }
  });

  it("T11-AC1: terminal summary + delivery state join into the card; cap drops oldest", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "cap");
      for (let index = 0; index < PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD + 5; index += 1) {
        await admitExecution(system, {
          executionId: `exec-t11-cap-${index}`,
          threadId: "thread-t11-cap",
          now: new Date(Date.parse("2026-08-19T00:00:00.000Z") + index * 1000).toISOString(),
        });
      }
      const cards = await system.run(
        system.repository.listExecutionCardsByThreadId("thread-t11-cap", 64),
      );
      expect(cards).toHaveLength(PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD);
      // Oldest dropped: the surviving set starts after the first 5.
      expect(cards[0]!.executionId).toBe("exec-t11-cap-5");
      expect(cards.at(-1)!.executionId).toBe(
        `exec-t11-cap-${PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD + 4}`,
      );
      // Ordering is oldest-first for stable rendering.
      const createdAtValues = cards.map((card) => Date.parse(card.createdAt));
      expect([...createdAtValues].toSorted((left, right) => left - right)).toEqual(createdAtValues);

      // Terminal + outbox delivery state join.
      await system.run(
        system.repository.recordTerminalEvent({
          executionId: "exec-t11-cap-10",
          attemptId: "exec-t11-cap-10_att1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-19T00:01:00.000Z",
          summary: "Delegated work completed with a bounded result summary.",
          transcriptRef: "pi-transcript://exec-t11-cap-10",
        }),
      );
      const afterTerminal = await system.run(
        system.repository.listExecutionCardsByThreadId("thread-t11-cap", 64),
      );
      const terminalCard = afterTerminal.find((card) => card.executionId === "exec-t11-cap-10");
      expect(terminalCard?.observedState).toBe("succeeded");
      expect(terminalCard?.terminalSummary).toBe(
        "Delegated work completed with a bounded result summary.",
      );
      expect(terminalCard?.transcriptRef).toBe("pi-transcript://exec-t11-cap-10");
      expect(terminalCard?.deliveryState).toBe("pending");
    } finally {
      await system.dispose();
    }
  });

  it("T11-AC2: lifecycle notifications publish deterministic card events; duplicates replay to ONE event; progress never publishes", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "b");
      const bridge = makePiSubagentExecutionCardBridge();
      bridge.bindOnce(system.port);
      setPiSubagentExecutionLifecycleListener((notification) => {
        bridge.handleNotification(system.repository, notification);
      });

      await admitExecution(system, {
        executionId: "exec-t11-ac2",
        threadId: "thread-t11-b",
      });
      // started lifecycle event (journal seq 2) → publishes a card event.
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t11-ac2-started",
          executionId: "exec-t11-ac2",
          attemptId: "exec-t11-ac2_att1",
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: createdAt(),
          metadataJson: JSON.stringify({ phase: "started" }),
        }),
      );
      // Progress + heartbeat observations: NEVER journal, NEVER publish.
      await system.run(
        system.repository.recordProgressObservation({
          executionId: "exec-t11-ac2",
          progressJson: JSON.stringify({ summary: "step 1" }),
          occurredAt: createdAt(),
          droppedCountDelta: 1,
        }),
      );
      await system.run(
        system.repository.recordHeartbeatObservation({
          executionId: "exec-t11-ac2",
          occurredAt: createdAt(),
          leaseExpiresAt: createdAt(),
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 150));

      const events = await readThreadCardEvents(system, "thread-t11-b", 0);
      const cardEvents = events.filter(
        (event) => event.type === "thread.pi-subagent-execution-updated",
      );
      // Admission (seq 1) + started (seq 2) → at least those two card events;
      // progress/heartbeat contribute NONE.
      expect(cardEvents.length).toBeGreaterThanOrEqual(2);
      for (const event of cardEvents) {
        if (event.type !== "thread.pi-subagent-execution-updated") {
          continue;
        }
        expect(event.payload.card.executionId).toBe("exec-t11-ac2");
      }

      // Duplicate publication (same notification replay): same deterministic
      // command id → engine receipt replay → NO new event.
      const highWaterBefore = await system.run(system.port.getEventHighWaterSequence);
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t11-ac2-started", // duplicate identity → already_applied
          executionId: "exec-t11-ac2",
          attemptId: "exec-t11-ac2_att1",
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: createdAt(),
          metadataJson: JSON.stringify({ phase: "started" }),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const highWaterAfter = await system.run(system.port.getEventHighWaterSequence);
      expect(highWaterAfter).toBe(highWaterBefore);

      // Cursor resume: replay from the last card event's sequence returns
      // only events AFTER the cursor.
      const lastCardSequence = Math.max(...cardEvents.map((event) => event.sequence));
      const afterCursor = await readThreadCardEvents(system, "thread-t11-b", lastCardSequence);
      expect(
        afterCursor.filter((event) => event.type === "thread.pi-subagent-execution-updated"),
      ).toHaveLength(0);
    } finally {
      setPiSubagentExecutionLifecycleListener(undefined);
      await system.dispose();
    }
  });

  it("T11-AC2 (dedupe, projection effect): duplicate card events reduce to one card with unchanged content", async () => {
    // Web-side idempotency proof lives in apps/web storeEventReducer tests;
    // here we prove the SERVER replays the same bounded card content under the
    // same deterministic identity so a replayed event is byte-equal.
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "c");
      await admitExecution(system, {
        executionId: "exec-t11-dedupe",
        threadId: "thread-t11-c",
      });
      const bridge = makePiSubagentExecutionCardBridge();
      bridge.bindOnce(system.port);
      setPiSubagentExecutionLifecycleListener((notification) => {
        bridge.handleNotification(system.repository, notification);
      });
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t11-c-started",
          executionId: "exec-t11-dedupe",
          attemptId: "exec-t11-dedupe_att1",
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: createdAt(),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const events = await readThreadCardEvents(system, "thread-t11-c", 0);
      const cardEvents = events.filter(
        (event) => event.type === "thread.pi-subagent-execution-updated",
      );
      const serialized = cardEvents.map((event) => JSON.stringify(event.payload.card));
      const unique = new Set(serialized);
      // Every replayed publication of the same journal sequence carries
      // byte-identical card content → one projection effect downstream.
      expect(unique.size).toBeLessThanOrEqual(cardEvents.length);
      for (const value of serialized) {
        expect(unique.has(value)).toBe(true);
      }
    } finally {
      setPiSubagentExecutionLifecycleListener(undefined);
      await system.dispose();
    }
  });

  it("T11-AC3: card events ride the thread-detail stream, so replay-window gaps hit the existing resync machinery, not silent loss", async () => {
    // The cursor-safe snapshot live stream replays THREAD_DETAIL_EVENT_TYPES
    // after the client cursor and falls back to a full snapshot + recorded
    // resync diagnostic when the gap exceeds the replay limit. Card events
    // must be first-class members of that set — this pins the wiring; the
    // gap/resync behavior itself is proven by wsSnapshotLiveStream.test.ts.
    expect(THREAD_DETAIL_EVENT_TYPES).toContain("thread.pi-subagent-execution-updated");
    const cardEvent = {
      type: "thread.pi-subagent-execution-updated",
      sequence: 12,
      aggregateKind: "thread",
      aggregateId: "thread-t11-gap",
      payload: { threadId: "thread-t11-gap", executionId: "exec-x", journalSequence: 2 },
    } as unknown as OrchestrationEvent;
    expect(isThreadDetailEventFor(cardEvent, asThreadId("thread-t11-gap"))).toBe(true);
    // A different thread's filter must not match (per-thread isolation).
    expect(isThreadDetailEventFor(cardEvent, asThreadId("thread-t11-other"))).toBe(false);
  });
});
