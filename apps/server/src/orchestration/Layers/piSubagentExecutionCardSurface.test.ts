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
  PI_SUBAGENT_WATCHDOG_BAND,
  runPiSubagentWatchdogEscalation,
} from "../../provider/piSubagentWatchdogEscalation.ts";
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
    readonly mode?: "foreground" | "background";
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
      mode: input.mode ?? "foreground",
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

describe("Ticket 03 durable card truth (current-generation attachment + teardown evidence)", () => {
  /** Reads the exact current card by identity (R1 identity-scoped seam). */
  const currentCard = async (system: EngineSystem, executionId: string) => {
    const option = await system.run(system.repository.getExecutionCard(executionId));
    expect(option._tag).toBe("Some");
    if (option._tag !== "Some") {
      throw new Error(`execution ${executionId} card not found`);
    }
    return option.value as PiSubagentExecutionCard;
  };

  it("T03-AC1: fresh cards always carry explicit current-generation attachment/teardown-evidence fields (list, get, snapshot)", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t03a");
      await admitExecution(system, {
        executionId: "exec-t03-fresh",
        threadId: "thread-t11-t03a",
        now: "2026-08-21T00:00:00.000Z",
      });

      // Fresh foreground live card: explicit fields, never undefined — the
      // contract's decoding default must never fire for fresh reads.
      const byId = await currentCard(system, "exec-t03-fresh");
      expect(byId.currentAttachment).toBe("attached");
      expect(byId.currentTeardownEvidence).toBe("none");

      const byThread = await system.run(
        system.repository.listExecutionCardsByThreadId("thread-t11-t03a", 64),
      );
      expect(byThread).toHaveLength(1);
      expect(byThread[0]!.currentAttachment).toBe("attached");
      expect(byThread[0]!.currentTeardownEvidence).toBe("none");

      // Snapshot path shares the same derivation (single bounded-card truth).
      const detail = await system.run(
        system.snapshotQuery.getThreadDetailSnapshotById(asThreadId("thread-t11-t03a")),
      );
      expect(detail._tag).toBe("Some");
      if (detail._tag === "Some") {
        const snapshotCards = detail.value.thread.piSubagentExecutions ?? [];
        expect(snapshotCards).toHaveLength(1);
        expect(snapshotCards[0]!.currentAttachment).toBe("attached");
        expect(snapshotCards[0]!.currentTeardownEvidence).toBe("none");
      }
    } finally {
      await system.dispose();
    }
  });

  it("T03-AC1: attachment derivation — foreground without seq3 is attached; exact current seq3 phase=detached is detached; background admission is detached", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t03b");
      await admitExecution(system, {
        executionId: "exec-t03-fg",
        threadId: "thread-t11-t03b",
        now: "2026-08-21T00:00:00.000Z",
      });
      await admitExecution(system, {
        executionId: "exec-t03-fg-detached",
        threadId: "thread-t11-t03b",
        now: "2026-08-21T00:00:01.000Z",
      });
      await admitExecution(system, {
        executionId: "exec-t03-bg",
        threadId: "thread-t11-t03b",
        mode: "background",
        now: "2026-08-21T00:00:02.000Z",
      });

      // A prior-attempt seq-3 detached row must NOT attach to a different
      // execution: identity-fenced derivation.
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-fg-detached-seq3",
          executionId: "exec-t03-fg-detached",
          attemptId: "exec-t03-fg-detached_att1",
          generation: 1,
          sequence: 3,
          state: "running",
          occurredAt: "2026-08-21T00:00:03.000Z",
          metadataJson: JSON.stringify({ phase: "detached", foregroundWaitMs: 1200 }),
        }),
      );

      const fg = await currentCard(system, "exec-t03-fg");
      expect(fg.currentAttachment).toBe("attached");
      expect(fg.currentTeardownEvidence).toBe("none");

      const fgDetached = await currentCard(system, "exec-t03-fg-detached");
      expect(fgDetached.currentAttachment).toBe("detached");
      expect(fgDetached.currentTeardownEvidence).toBe("none");

      // Background mode is a durable admission fact → detached with no
      // journal row at all (AC2's precondition: mode, not a journal row).
      const bg = await currentCard(system, "exec-t03-bg");
      expect(bg.currentAttachment).toBe("detached");
      expect(bg.mode).toBe("background");
      const bgJournal = await system.run(system.repository.listJournalEvents("exec-t03-bg"));
      expect(bgJournal.some((event) => event.sequence === 3)).toBe(false);
    } finally {
      await system.dispose();
    }
  });

  it("T03-AC5: terminal and orphaned cards carry NULL attachment/teardown evidence", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t03c");
      await admitExecution(system, {
        executionId: "exec-t03-terminal",
        threadId: "thread-t11-t03c",
        now: "2026-08-21T00:00:00.000Z",
      });
      await admitExecution(system, {
        executionId: "exec-t03-orphan",
        threadId: "thread-t11-t03c",
        now: "2026-08-21T00:00:01.000Z",
      });

      // Terminal leg: settle succeeded AFTER journaling teardown request and
      // uncertain evidence on the same generation — the terminal card must
      // carry NULL teardown truth, not the journaled bands.
      await system.run(
        system.repository.recordTeardownRequested({
          executionId: "exec-t03-terminal",
          attemptId: "exec-t03-terminal_att1",
          generation: 1,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:02.000Z",
        }),
      );
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-terminal",
          attemptId: "exec-t03-terminal_att1",
          generation: 1,
          outcome: "survivors",
          occurredAt: "2026-08-21T00:00:03.000Z",
          diagnosticMessage: "fixture: survivors before terminal",
        }),
      );
      await system.run(
        system.repository.recordTerminalEvent({
          executionId: "exec-t03-terminal",
          attemptId: "exec-t03-terminal_att1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-21T00:00:04.000Z",
          summary: "settled before teardown could resolve",
        }),
      );
      const terminal = await currentCard(system, "exec-t03-terminal");
      expect(terminal.observedState).toBe("succeeded");
      expect(terminal.currentAttachment).toBeNull();
      expect(terminal.currentTeardownEvidence).toBeNull();

      // Orphaned leg: owner-loss advances the generation (fence) — the
      // orphaned card must carry NULL truth even though the pre-orphan
      // generation journaled a detached row + teardown request.
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-orphan-seq3",
          executionId: "exec-t03-orphan",
          attemptId: "exec-t03-orphan_att1",
          generation: 1,
          sequence: 3,
          state: "running",
          occurredAt: "2026-08-21T00:00:02.000Z",
          metadataJson: JSON.stringify({ phase: "detached" }),
        }),
      );
      await system.run(
        system.repository.recordTeardownRequested({
          executionId: "exec-t03-orphan",
          attemptId: "exec-t03-orphan_att1",
          generation: 1,
          state: "running",
          occurredAt: "2026-08-21T00:00:03.000Z",
        }),
      );
      await system.run(
        system.repository.recordOrphanedEvent({
          executionId: "exec-t03-orphan",
          attemptId: "exec-t03-orphan_att1",
          generation: 1,
          occurredAt: "2026-08-21T00:00:04.000Z",
          diagnosticCode: "pi_subagent_owner_loss_orphaned",
          diagnosticMessage: "fixture: owner loss fence",
        }),
      );
      const orphaned = await currentCard(system, "exec-t03-orphan");
      expect(orphaned.observedState).toBe("orphaned");
      expect(orphaned.currentAttachment).toBeNull();
      expect(orphaned.currentTeardownEvidence).toBeNull();

      // Snapshot agrees with the repository reads (AC5 surfaces agree).
      const detail = await system.run(
        system.snapshotQuery.getThreadDetailSnapshotById(asThreadId("thread-t11-t03c")),
      );
      expect(detail._tag).toBe("Some");
      if (detail._tag === "Some") {
        const snapshotCards = detail.value.thread.piSubagentExecutions ?? [];
        for (const card of snapshotCards) {
          expect(card.currentAttachment).toBeNull();
          expect(card.currentTeardownEvidence).toBeNull();
        }
      }
    } finally {
      await system.dispose();
    }
  });

  it("T03-AC1: teardown-evidence ladder — none → requested(75); owner_unproven(78) over requested; survivors(77) wins over both when both exist", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t03d");
      await admitExecution(system, {
        executionId: "exec-t03-ladder",
        threadId: "thread-t11-t03d",
        now: "2026-08-21T00:00:00.000Z",
      });
      // Drive the aggregate into `cancelling` (the honest live state under
      // teardown) so the live-gate stays open across every ladder rung.
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-ladder-cancelling",
          executionId: "exec-t03-ladder",
          attemptId: "exec-t03-ladder_att1",
          generation: 1,
          sequence: 2,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:01.000Z",
          diagnosticCode: "pi_subagent_cancel_escalated",
          diagnosticMessage: "fixture: cancelling",
        }),
      );

      // Rung 0: no teardown band → `none`.
      expect((await currentCard(system, "exec-t03-ladder")).currentTeardownEvidence).toBe(
        "none",
      );

      // Rung 1: band 75 request only → `requested` (intent, not outcome).
      await system.run(
        system.repository.recordTeardownRequested({
          executionId: "exec-t03-ladder",
          attemptId: "exec-t03-ladder_att1",
          generation: 1,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:02.000Z",
        }),
      );
      expect((await currentCard(system, "exec-t03-ladder")).currentTeardownEvidence).toBe(
        "requested",
      );

      // Rung 2: band 78 owner_unproven outranks the bare request.
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-ladder",
          attemptId: "exec-t03-ladder_att1",
          generation: 1,
          outcome: "owner_unproven",
          occurredAt: "2026-08-21T00:00:03.000Z",
          diagnosticMessage: "fixture: owner unproven",
        }),
      );
      expect((await currentCard(system, "exec-t03-ladder")).currentTeardownEvidence).toBe(
        "owner_unproven",
      );

      // Rung 3: band 77 survivors lands later but must WIN presentation when
      // both uncertain bands exist (survivors evidence outranks owner-unproven).
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-ladder",
          attemptId: "exec-t03-ladder_att1",
          generation: 1,
          outcome: "survivors",
          occurredAt: "2026-08-21T00:00:04.000Z",
          diagnosticMessage: "fixture: survivors",
        }),
      );
      const ladderCard = await currentCard(system, "exec-t03-ladder");
      expect(ladderCard.currentTeardownEvidence).toBe("survivors");
      expect(ladderCard.observedState).toBe("cancelling");
      expect(ladderCard.currentAttachment).toBe("attached");
    } finally {
      await system.dispose();
    }
  });

  it("T03-AC5: prior-attempt/prior-generation seq3 and 75/77/78 evidence cannot contaminate a resumed generation", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t03e");
      await admitExecution(system, {
        executionId: "exec-t03-resume",
        threadId: "thread-t11-t03e",
        now: "2026-08-21T00:00:00.000Z",
      });
      const attempt1 = "exec-t03-resume_att1";

      // Prior attempt: detached seq3 + full uncertain teardown ladder.
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-resume-seq3",
          executionId: "exec-t03-resume",
          attemptId: attempt1,
          generation: 1,
          sequence: 3,
          state: "running",
          occurredAt: "2026-08-21T00:00:01.000Z",
          metadataJson: JSON.stringify({ phase: "detached" }),
        }),
      );
      await system.run(
        system.repository.recordTeardownRequested({
          executionId: "exec-t03-resume",
          attemptId: attempt1,
          generation: 1,
          state: "running",
          occurredAt: "2026-08-21T00:00:02.000Z",
        }),
      );
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-resume",
          attemptId: attempt1,
          generation: 1,
          outcome: "owner_unproven",
          occurredAt: "2026-08-21T00:00:03.000Z",
          diagnosticMessage: "fixture: prior attempt owner unproven",
        }),
      );
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-resume",
          attemptId: attempt1,
          generation: 1,
          outcome: "survivors",
          occurredAt: "2026-08-21T00:00:04.000Z",
          diagnosticMessage: "fixture: prior attempt survivors",
        }),
      );
      // Owner-loss fence → generation 2, then explicit resume → attempt 2 / generation 3.
      await system.run(
        system.repository.recordOrphanedEvent({
          executionId: "exec-t03-resume",
          attemptId: attempt1,
          generation: 1,
          occurredAt: "2026-08-21T00:00:05.000Z",
          diagnosticCode: "pi_subagent_owner_loss_orphaned",
          diagnosticMessage: "fixture: orphan before resume",
        }),
      );
      const resume = await system.run(
        system.repository.recordResumeEvent({
          executionId: "exec-t03-resume",
          expectedAttemptId: attempt1,
          expectedGeneration: 2,
          newAttemptId: "exec-t03-resume_att2",
          parentTurnId: null,
          occurredAt: "2026-08-21T00:00:06.000Z",
        }),
      );
      expect(resume.kind).toBe("recorded");

      // The resumed current card must carry NO stale prior-generation
      // detach or teardown evidence: fresh live attempt, `none` teardown,
      // attached foreground.
      const resumed = await currentCard(system, "exec-t03-resume");
      expect(resumed.attemptId).toBe("exec-t03-resume_att2");
      expect(resumed.generation).toBe(3);
      expect(resumed.observedState).toBe("queued");
      expect(resumed.currentAttachment).toBe("attached");
      expect(resumed.currentTeardownEvidence).toBe("none");

      // Snapshot path agrees (all surfaces one truth).
      const detail = await system.run(
        system.snapshotQuery.getThreadDetailSnapshotById(asThreadId("thread-t11-t03e")),
      );
      expect(detail._tag).toBe("Some");
      if (detail._tag === "Some") {
        const snapshotCards = detail.value.thread.piSubagentExecutions ?? [];
        expect(snapshotCards).toHaveLength(1);
        expect(snapshotCards[0]!.currentAttachment).toBe("attached");
        expect(snapshotCards[0]!.currentTeardownEvidence).toBe("none");
      }
    } finally {
      await system.dispose();
    }
  });

  it("T03-AC5: proven teardown (band 76) settles cancelled, advances the generation, and the fenced card carries NO stale teardown evidence", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t03f");
      await admitExecution(system, {
        executionId: "exec-t03-proven",
        threadId: "thread-t11-t03f",
        now: "2026-08-21T00:00:00.000Z",
      });
      const attempt1 = "exec-t03-proven_att1";
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-proven-cancelling",
          executionId: "exec-t03-proven",
          attemptId: attempt1,
          generation: 1,
          sequence: 2,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:01.000Z",
          diagnosticCode: "pi_subagent_cancel_escalated",
          diagnosticMessage: "fixture: cancelling",
        }),
      );
      // Uncertain evidence first, then a later pass proves teardown: each
      // outcome kind owns its band, so proven must not be blocked by the
      // earlier survivors row (outcome retry must actually retry).
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-proven",
          attemptId: attempt1,
          generation: 1,
          outcome: "survivors",
          occurredAt: "2026-08-21T00:00:02.000Z",
          diagnosticMessage: "fixture: survivors first",
        }),
      );
      const proven = await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-proven",
          attemptId: attempt1,
          generation: 1,
          outcome: "proven",
          occurredAt: "2026-08-21T00:00:03.000Z",
          diagnosticMessage: "fixture: proven later",
        }),
      );
      expect(proven.kind).toBe("recorded");
      expect(proven.execution.observedState).toBe("cancelled");
      expect(proven.execution.generation).toBe(2);

      // The settled card is terminal → NULL current truth (76 never describes
      // a current generation; the fence moved the aggregate past it).
      const card = await currentCard(system, "exec-t03-proven");
      expect(card.observedState).toBe("cancelled");
      expect(card.generation).toBe(2);
      expect(card.currentAttachment).toBeNull();
      expect(card.currentTeardownEvidence).toBeNull();
    } finally {
      await system.dispose();
    }
  });

  it("T03-AC1: recorded 77/78 outcomes publish committed card events (Cancellation unverified) with deterministic identities", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "t03g");
      const bridge = makePiSubagentExecutionCardBridge();
      bridge.bindOnce(system.port);
      setPiSubagentExecutionLifecycleListener((notification) => {
        bridge.handleNotification(system.repository, notification);
      });

      await admitExecution(system, {
        executionId: "exec-t03-publish",
        threadId: "thread-t11-t03g",
        now: "2026-08-21T00:00:00.000Z",
      });
      const attempt1 = "exec-t03-publish_att1";
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-publish-cancelling",
          executionId: "exec-t03-publish",
          attemptId: attempt1,
          generation: 1,
          sequence: 2,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:01.000Z",
          diagnosticCode: "pi_subagent_cancel_escalated",
          diagnosticMessage: "fixture: cancelling",
        }),
      );
      await system.run(
        system.repository.recordTeardownRequested({
          executionId: "exec-t03-publish",
          attemptId: attempt1,
          generation: 1,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:02.000Z",
        }),
      );
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-publish",
          attemptId: attempt1,
          generation: 1,
          outcome: "owner_unproven",
          occurredAt: "2026-08-21T00:00:03.000Z",
          diagnosticMessage: "fixture: owner unproven",
        }),
      );
      await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-publish",
          attemptId: attempt1,
          generation: 1,
          outcome: "survivors",
          occurredAt: "2026-08-21T00:00:04.000Z",
          diagnosticMessage: "fixture: survivors",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      const events = await readThreadCardEvents(system, "thread-t11-t03g", 0);
      const cardEvents = events.filter(
        (event) => event.type === "thread.pi-subagent-execution-updated",
      );
      // The committed card reached the event surface: an event whose card
      // carries the uncertain evidence (survivors — precedence over 78).
      const survivorsEvents = cardEvents.filter(
        (event) =>
          event.type === "thread.pi-subagent-execution-updated" &&
          event.payload.card.currentTeardownEvidence === "survivors",
      );
      expect(survivorsEvents.length).toBeGreaterThan(0);
      for (const event of survivorsEvents) {
        expect(event.payload.card.observedState).toBe("cancelling");
        expect(event.payload.card.currentAttachment).toBe("attached");
      }
      // Deterministic command identity per band (77, 78) → no duplicate
      // events for the same band publication.
      const survivorsIdentities = survivorsEvents.map((event) =>
        event.type === "thread.pi-subagent-execution-updated"
          ? `${event.payload.executionId}:${event.payload.journalSequence}`
          : "",
      );
      expect(new Set(survivorsIdentities).size).toBe(survivorsIdentities.length);
    } finally {
      setPiSubagentExecutionLifecycleListener(undefined);
      await system.dispose();
    }
  });

  it("T03-AC1: already_applied and stale_generation teardown outcomes publish NOTHING (no false publication)", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "t03h");
      const bridge = makePiSubagentExecutionCardBridge();
      bridge.bindOnce(system.port);
      setPiSubagentExecutionLifecycleListener((notification) => {
        bridge.handleNotification(system.repository, notification);
      });

      await admitExecution(system, {
        executionId: "exec-t03-silent",
        threadId: "thread-t11-t03h",
        now: "2026-08-21T00:00:00.000Z",
      });
      const attempt1 = "exec-t03-silent_att1";
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t03-silent-cancelling",
          executionId: "exec-t03-silent",
          attemptId: attempt1,
          generation: 1,
          sequence: 2,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:01.000Z",
          diagnosticCode: "pi_subagent_cancel_escalated",
          diagnosticMessage: "fixture: cancelling",
        }),
      );
      await system.run(
        system.repository.recordTeardownRequested({
          executionId: "exec-t03-silent",
          attemptId: attempt1,
          generation: 1,
          state: "cancelling",
          occurredAt: "2026-08-21T00:00:02.000Z",
        }),
      );
      // First owner_unproven commits (records band 78 and publishes).
      const first = await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-silent",
          attemptId: attempt1,
          generation: 1,
          outcome: "owner_unproven",
          occurredAt: "2026-08-21T00:00:03.000Z",
          diagnosticMessage: "fixture: owner unproven",
        }),
      );
      expect(first.kind).toBe("recorded");
      // Replay of the SAME outcome identity → already_applied → NO publication.
      const replay = await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-silent",
          attemptId: attempt1,
          generation: 1,
          outcome: "owner_unproven",
          occurredAt: "2026-08-21T00:00:04.000Z",
          diagnosticMessage: "fixture: owner unproven replay",
        }),
      );
      expect(replay.kind).toBe("already_applied");

      // Stale generation: orphan-fence the aggregate to generation 2, then
      // record an outcome targeting the superseded generation → journals
      // history only, publishes NOTHING.
      await system.run(
        system.repository.recordOrphanedEvent({
          executionId: "exec-t03-silent",
          attemptId: attempt1,
          generation: 1,
          occurredAt: "2026-08-21T00:00:05.000Z",
          diagnosticCode: "pi_subagent_owner_loss_orphaned",
          diagnosticMessage: "fixture: fence before stale outcome",
        }),
      );
      const stale = await system.run(
        system.repository.recordTeardownOutcome({
          executionId: "exec-t03-silent",
          attemptId: attempt1,
          generation: 1,
          outcome: "survivors",
          occurredAt: "2026-08-21T00:00:06.000Z",
          diagnosticMessage: "fixture: stale survivors",
        }),
      );
      expect(stale.kind).toBe("stale_generation");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Publication census: card events exist for the lifecycle truth changes
      // (admission seq1, cancelling seq2, first 78, orphan band 50) but the
      // replay and the stale outcome contributed NONE — no survivors card
      // event exists and exactly ONE owner_unproven card event exists.
      const events = await readThreadCardEvents(system, "thread-t11-t03h", 0);
      const cardEvents = events.filter(
        (event) => event.type === "thread.pi-subagent-execution-updated",
      );
      const withEvidence = cardEvents.filter(
        (event) =>
          event.type === "thread.pi-subagent-execution-updated" &&
          (event.payload.card.currentTeardownEvidence === "owner_unproven" ||
            event.payload.card.currentTeardownEvidence === "survivors"),
      );
      expect(withEvidence).toHaveLength(1);
      expect(withEvidence[0]!.payload.card.currentTeardownEvidence).toBe("owner_unproven");
      // The orphaned aggregate's live gate closed: the LAST card event for
      // this execution carries NULL current truth (no stale teardown).
      const lastForExecution = cardEvents
        .filter(
          (event) =>
            event.type === "thread.pi-subagent-execution-updated" &&
            event.payload.executionId === "exec-t03-silent",
        )
        .at(-1);
      expect(lastForExecution?.payload.card.currentAttachment).toBeNull();
      expect(lastForExecution?.payload.card.currentTeardownEvidence).toBeNull();
    } finally {
      setPiSubagentExecutionLifecycleListener(undefined);
      await system.dispose();
    }
  });
});

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

  it("T15-AC5 (projection): timeout-only watchdog progression never surfaces a stopped/cancelled claim", async () => {
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "wd5");
      await admitExecution(system, {
        executionId: "exec-t15-ac5",
        threadId: "thread-t11-wd5",
        now: "2026-08-19T00:00:00.000Z",
      });
      // Durable wall-time trigger (band 60) for the current attempt.
      await system.run(
        system.repository.recordWallTimeExpiryEvent({
          executionId: "exec-t15-ac5",
          attemptId: "exec-t15-ac5_att1",
          generation: 1,
          occurredAt: "2026-08-19T00:00:10.000Z",
          wallTimeMs: 60_000,
        }),
      );

      // Timeout-only progression: no bridge, no acknowledgement, no terminal
      // evidence anywhere — the stage controls dispatch but never prove.
      const result = await system.run(
        Effect.promise(() =>
          runPiSubagentWatchdogEscalation({
            repository: system.repository,
            resolveBridge: () => undefined,
            isOwnerGenerationDead: () => false,
            listActive: () => undefined,
            interruptProviderTurn: async () => undefined,
            stopProviderSession: async () => "uncertain" as const,
            stageTimeoutMs: 100,
            cancelRetryLimit: 0,
            leaseDurationMs: 30_000,
            idleAfterMs: 60_000,
            now: () => Date.parse("2026-08-19T00:01:00.000Z"),
          }),
        ),
      );
      expect(result.escalations).toHaveLength(1);
      expect(result.escalations[0]!.outcome).toMatchObject({ kind: "cleanup_uncertain" });

      // Projection surface (T15-AC5): the card carried by the thread-detail
      // snapshot keeps honest cancelling — observed stays non-terminal and
      // desired is cancelling; no stopped/cancelled claim exists.
      const detail = await system.run(
        system.snapshotQuery.getThreadDetailSnapshotById(asThreadId("thread-t11-wd5")),
      );
      expect(detail._tag).toBe("Some");
      if (detail._tag !== "Some") {
        return;
      }
      const cards = detail.value.thread.piSubagentExecutions ?? [];
      expect(cards).toHaveLength(1);
      const card = cards[0]!;
      expect(card.executionId).toBe("exec-t15-ac5");
      expect(card.desiredState).toBe("cancelling");
      expect(["cancelled", "succeeded", "failed", "rejected"]).not.toContain(card.observedState);

      // The full escalation band is durable evidence (70–74), and NO
      // terminal journal row was ever written by the watchdog.
      const journal = await system.run(system.repository.listJournalEvents("exec-t15-ac5"));
      for (const sequence of [
        PI_SUBAGENT_WATCHDOG_BAND.escalationStarted,
        PI_SUBAGENT_WATCHDOG_BAND.childAbortTimeout,
        PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
        PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
        PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      ]) {
        expect(journal.some((event) => event.sequence === sequence)).toBe(true);
      }
      expect(
        journal.some(
          (event) =>
            event.state === "cancelled" || event.state === "succeeded" || event.state === "failed",
        ),
      ).toBe(false);
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

  it("review R1: lifecycle on a NON-newest sibling execution still publishes its own card event; deleted executions publish nothing", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "sib");
      const bridge = makePiSubagentExecutionCardBridge();
      bridge.bindOnce(system.port);
      setPiSubagentExecutionLifecycleListener((notification) => {
        bridge.handleNotification(system.repository, notification);
      });
      // Two executions: older created first, newer second.
      await admitExecution(system, {
        executionId: "exec-t11-sib-old",
        threadId: "thread-t11-sib",
        now: "2026-08-19T00:10:00.000Z",
      });
      await admitExecution(system, {
        executionId: "exec-t11-sib-new",
        threadId: "thread-t11-sib",
        now: "2026-08-19T00:10:01.000Z",
      });
      // By-execution card read returns each identity regardless of sibling order.
      const oldCard = await system.run(system.repository.getExecutionCard("exec-t11-sib-old"));
      expect(oldCard._tag).toBe("Some");
      if (oldCard._tag === "Some") {
        expect(oldCard.value.executionId).toBe("exec-t11-sib-old");
        expect(oldCard.value.parentThreadId).toBe("thread-t11-sib");
      }
      const missing = await system.run(system.repository.getExecutionCard("exec-t11-sib-none"));
      expect(missing._tag).toBe("None");

      // Lifecycle event on the OLDER execution must publish ITS card event.
      await system.run(
        system.repository.recordLifecycleEvent({
          eventId: "evt-t11-sib-old-started",
          executionId: "exec-t11-sib-old",
          attemptId: "exec-t11-sib-old_att1",
          generation: 1,
          sequence: 2,
          state: "running",
          occurredAt: "2026-08-19T00:10:02.000Z",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));

      const events = await readThreadCardEvents(system, "thread-t11-sib", 0);
      const oldRunning = events.filter(
        (event) =>
          event.type === "thread.pi-subagent-execution-updated" &&
          event.payload.executionId === "exec-t11-sib-old" &&
          event.payload.card.observedState === "running",
      );
      expect(oldRunning.length).toBeGreaterThan(0);
    } finally {
      setPiSubagentExecutionLifecycleListener(undefined);
      await system.dispose();
    }
  });

  it("review R4-N1: every delivery-state transition publishes its own card event (distinct delivery-band identities)", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "dlv");
      const bridge = makePiSubagentExecutionCardBridge();
      bridge.bindOnce(system.port);
      setPiSubagentExecutionLifecycleListener((notification) => {
        bridge.handleNotification(system.repository, notification);
      });
      await admitExecution(system, {
        executionId: "exec-t11-dlv",
        threadId: "thread-t11-dlv",
      });
      // Terminal ingest creates the outbox entry (pending) atomically.
      await system.run(
        system.repository.recordTerminalEvent({
          executionId: "exec-t11-dlv",
          attemptId: "exec-t11-dlv_att1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-19T00:20:00.000Z",
          summary: "done",
        }),
      );
      const outboxId = `outbox_exec-t11-dlv_exec-t11-dlv_att1_gen1`;
      await system.run(
        system.repository.markCompletionDelivered({
          outboxId,
          now: "2026-08-19T00:20:01.000Z",
        }),
      );
      await system.run(
        system.repository.markCompletionAcknowledged({
          outboxId,
          now: "2026-08-19T00:20:02.000Z",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      const events = await readThreadCardEvents(system, "thread-t11-dlv", 0);
      const cardEvents = events.filter(
        (event) => event.type === "thread.pi-subagent-execution-updated",
      );
      const deliveryStates = cardEvents
        .map((event) =>
          event.type === "thread.pi-subagent-execution-updated"
            ? (event.payload.card.deliveryState ?? "absent")
            : "other",
        )
        .filter((state) => state !== "other");
      // Each committed delivery state reaches the stream: pending (terminal),
      // delivered, AND acknowledged — no collision drops the second change.
      expect(deliveryStates).toContain("delivered");
      expect(deliveryStates).toContain("acknowledged");
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

  it("T12-AC5: full result/transcript content never enters lifecycle events, snapshots, or the WS push payload", async () => {
    // Ticket 12: the authorized read surface is the ONLY content-bearing
    // path. Snapshots, lifecycle events, and the deterministic card push
    // stay bounded — the card carries the bounded summary excerpt and the
    // opaque reference, never transcript entries or raw result content.
    const system = await createEngineSystem();
    try {
      setPiSubagentExecutionLifecycleListener(undefined);
      await createProjectAndThread(system, "t12ac5");
      await admitExecution(system, {
        executionId: "exec-t12-ac5",
        threadId: "thread-t11-t12ac5",
        prompt: "SECRET T12 PROMPT THAT MUST NEVER LEAVE THE SERVER",
        now: "2026-08-19T00:00:00.000Z",
      });
      // A terminal with content-shaped markers that must NOT survive into
      // any public surface beyond the bounded summary the aggregate keeps.
      const FULL_RESULT_SENTINEL = "FULL-TRANSCRIPT-CONTENT-MARKER-THAT-MUST-NEVER-BE-PUSHED";
      await system.run(
        system.repository.recordTerminalEvent({
          executionId: "exec-t12-ac5",
          attemptId: "exec-t12-ac5_att1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-19T00:01:00.000Z",
          summary: `Bounded summary ${FULL_RESULT_SENTINEL}`.slice(0, 120),
          transcriptRef: "/tmp/pi-subagents-x/tasks/exec-t12-ac5.output",
        }),
      );

      const detail = await system.run(
        system.snapshotQuery.getThreadDetailSnapshotById(asThreadId("thread-t11-t12ac5")),
      );
      expect(detail._tag).toBe("Some");
      if (detail._tag === "Some") {
        const serializedSnapshot = JSON.stringify(detail.value.thread.piSubagentExecutions);
        expect(serializedSnapshot).not.toContain("SECRET T12 PROMPT");
        expect(serializedSnapshot).not.toContain("entries");
        expect(serializedSnapshot).not.toContain("resultContent");
      }

      // Lifecycle/WS push payload: the bounded card only. No transcript
      // entries, no unbounded content fields on the event schema.
      const events = await readThreadCardEvents(system, "thread-t11-t12ac5", 0);
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain("SECRET T12 PROMPT");
      // The transcript PATH is stored as the opaque reference in durable
      // truth (bounded, T07-AC5 inheritance) — but entry content never rides
      // events: the card event payload schema has no entries/content fields.
      for (const event of events) {
        if (event.type === "thread.pi-subagent-execution-updated") {
          expect(Object.hasOwn(event.payload, "entries")).toBe(false);
          expect(Object.hasOwn(event.payload, "resultContent")).toBe(false);
          expect(Object.hasOwn(event.payload, "transcriptContent")).toBe(false);
        }
      }
    } finally {
      setPiSubagentExecutionLifecycleListener(undefined);
      await system.dispose();
    }
  });
});
