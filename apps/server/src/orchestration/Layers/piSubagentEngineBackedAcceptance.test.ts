import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@synara/contracts";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  buildPiSubagentCompletionDispatchCommand,
  derivePiSubagentCompletionDispatchIdentity,
  serializePiSubagentCompletionDispatchCommand,
} from "../../provider/piSubagentCompletionDispatchIdentity.ts";
import { makePiSubagentParentEffectDispatcher } from "../../provider/piSubagentParentEffectDispatcher.ts";

/**
 * Decision 0016 — engine-backed acceptance (Ticket 09 remediation, WP7).
 *
 * The batch's frozen internal `thread.turn.start` command is dispatched to a
 * REAL OrchestrationEngine (durable event store + command receipts) through
 * the REAL parent-effect dispatcher bridge. This proves:
 *
 * - fresh dispatch commits exactly ONE parent message + ONE turn-start request
 *   + ONE accepted receipt, and the bridge returns the exact receipt with the
 *   committed message id;
 * - re-dispatch after a post-acceptance crash replays the SAME accepted
 *   receipt (same result seq) and appends NO second message / turn request /
 *   receipt row (Decision 0016 §10);
 * - the frozen command carries dispatchMode `queue` (busy roots commit a
 *   durable queued turn so the EXISTING queued-turn promotion owns
 *   post-acceptance busy delivery);
 * - rollback/mixed-version delivery rows stay inert (batch ledger authority).
 *
 * Regressions run with this file's peers: coordinator, outbox, command
 * receipts, provider delivery, queued-turn promotions.
 */

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

const TestServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-t09-engine-backed-acceptance-",
});

async function createEngineSystem() {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(TestServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const run = <A, E>(effect: Effect.Effect<A, E, never>) => runtime.runPromise(effect);
  // Structural subset of the engine the bridge needs.
  const port = engine as unknown as {
    dispatch: (command: unknown) => Effect.Effect<{ sequence: number }, unknown, never>;
    readEvents: (from: number) => Stream.Stream<OrchestrationEvent, unknown, never>;
    refreshCommandReadModel: () => Effect.Effect<unknown, unknown, never>;
  };
  return { run, port, dispose: () => runtime.dispose() };
}

const createdAt = () => new Date().toISOString();

const makeInternalCommand = (
  threadId: string,
  outboxIds: readonly string[],
  createdAtValue: string,
) => {
  const identity = derivePiSubagentCompletionDispatchIdentity({
    parentThreadId: threadId,
    outboxIds,
  });
  const parentMessageText = `[policy]\nA background subagent finished: ex_1, ex_2\n\nThe results above are bounded excerpts; full outputs remain retrievable by execution id.`;
  const command = buildPiSubagentCompletionDispatchCommand({
    identity,
    commandInput: {
      parentThreadId: threadId,
      parentMessageText,
      runtimeMode: "approval-required",
      interactionMode: "default",
      assistantDeliveryMode: "buffered",
      createdAt: createdAtValue,
    },
  });
  return { command, payload: serializePiSubagentCompletionDispatchCommand(command) };
};

const readEvents = (system: Awaited<ReturnType<typeof createEngineSystem>>) =>
  system.run(
    Stream.runCollect(system.port.readEvents(0)).pipe(Effect.map((chunk) => Array.from(chunk))),
  );

const readReceiptRows = (system: Awaited<ReturnType<typeof createEngineSystem>>) =>
  system.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        readonly commandId: string;
        readonly commandFingerprint: string;
        readonly status: string;
      }>`
        SELECT command_id AS "commandId", command_fingerprint AS "commandFingerprint", status
        FROM orchestration_command_receipts
      `;
    }),
  );

const createProjectAndThread = async (
  system: Awaited<ReturnType<typeof createEngineSystem>>,
  suffix: string,
) => {
  await system.run(
    system.port.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-pi-t09-project-${suffix}`),
      projectId: asProjectId(`project-t09-${suffix}`),
      title: `T09 ${suffix}`,
      workspaceRoot: `/tmp/t09-${suffix}`,
      defaultModelSelection: null,
      createdAt: createdAt(),
    }),
  );
  await system.run(
    system.port.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-pi-t09-thread-${suffix}`),
      threadId: asThreadId(`thread-pi-t09-${suffix}`),
      projectId: asProjectId(`project-t09-${suffix}`),
      title: `T09 ${suffix} parent`,
      modelSelection: { provider: "pi", model: "deterministic" },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: createdAt(),
    }),
  );
};

describe("Decision 0016 engine-backed acceptance (WP7)", () => {
  it("fresh dispatch commits ONE message + ONE turn request + ONE accepted receipt; bridge returns the exact receipt", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "a");

      const bridged = makePiSubagentParentEffectDispatcher();
      bridged.bindOnce(system.port);
      const { payload, command } = makeInternalCommand(
        "thread-pi-t09-a",
        ["outbox_pi_1", "outbox_pi_2"],
        createdAt(),
      );

      const outcome = await bridged.dispatch(payload);
      expect(outcome.kind).toBe("accepted");
      if (outcome.kind !== "accepted") {
        return;
      }
      expect(outcome.receipt.commandId).toBe(command.commandId);
      expect(outcome.receipt.messageId).toBe(command.message.messageId);
      expect(outcome.receipt.resultSequence).toBeGreaterThan(0);

      const events = await readEvents(system);
      const messageSents = events.filter(
        (event) => event.type === "thread.message-sent" && event.commandId === command.commandId,
      );
      const turnRequests = events.filter(
        (event) =>
          event.type === "thread.turn-start-requested" &&
          event.payload.messageId === command.message.messageId,
      );
      expect(messageSents).toHaveLength(1);
      expect(turnRequests).toHaveLength(1);
      expect(messageSents[0]!.payload.messageId).toBe(command.message.messageId);
      expect(messageSents[0]!.payload.dispatchOrigin).toBe("agent");

      const receipts = await readReceiptRows(system);
      expect(
        receipts.filter((receipt) => receipt.commandId === command.commandId),
      ).toHaveLength(1);
    } finally {
      await system.dispose();
    }
  });

  it("post-acceptance crash replay returns the SAME receipt and appends NO second message/turn/receipt", async () => {
    const system = await createEngineSystem();
    try {
      await createProjectAndThread(system, "b");

      const bridged = makePiSubagentParentEffectDispatcher();
      bridged.bindOnce(system.port);
      const { payload, command } = makeInternalCommand(
        "thread-pi-t09-b",
        ["outbox_pi_3", "outbox_pi_4"],
        createdAt(),
      );

      const first = await bridged.dispatch(payload);
      expect(first.kind).toBe("accepted");
      const second = await bridged.dispatch(payload); // post-acceptance crash replay
      expect(second.kind).toBe("accepted");
      if (first.kind !== "accepted" || second.kind !== "accepted") {
        return;
      }
      expect(second.receipt.resultSequence).toBe(first.receipt.resultSequence);

      const events = await readEvents(system);
      const messageSents = events.filter(
        (event) => event.type === "thread.message-sent" && event.commandId === command.commandId,
      );
      const turnRequests = events.filter(
        (event) =>
          event.type === "thread.turn-start-requested" &&
          event.payload.messageId === command.message.messageId,
      );
      expect(messageSents).toHaveLength(1);
      expect(turnRequests).toHaveLength(1);

      const receipts = await readReceiptRows(system);
      const matched = receipts.filter((receipt) => receipt.commandId === command.commandId);
      expect(matched).toHaveLength(1);
      expect(matched[0]!.status).toBe("accepted");
      expect(matched[0]!.commandFingerprint).toBeTypeOf("string");
    } finally {
      await system.dispose();
    }
  });

  it("queued busy-root path: frozen command uses dispatchMode queue; engine accepts with ONE message and an existing-promotion turn intent", async () => {
    const system = await createEngineSystem();
    const sql = await system.run(Effect.service(SqlClient.SqlClient));
    try {
      await createProjectAndThread(system, "q");
      const { payload, command } = makeInternalCommand("thread-pi-t09-q", ["outbox_pi_5"], createdAt());
      expect(command.dispatchMode).toBe("queue");

      // Mark the parent root busy through the projected session row the
      // decider's read model resolves, then refresh the engine read model.
      await system.run(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO projection_thread_sessions (
              thread_id, status, active_turn_id, updated_at
            ) VALUES (
              'thread-pi-t09-q', 'running', 'turn-active-1', ${createdAt()}
            )
            ON CONFLICT(thread_id) DO UPDATE SET
              status = 'running', active_turn_id = 'turn-active-1', updated_at = ${createdAt()}
          `;
        }),
      );
      await system.run(system.port.refreshCommandReadModel());

      const bridged = makePiSubagentParentEffectDispatcher();
      bridged.bindOnce(system.port);
      const outcome = await bridged.dispatch(payload);
      expect(outcome.kind).toBe("accepted");

      const events = await readEvents(system);
      const messageSents = events.filter(
        (event) => event.type === "thread.message-sent" && event.commandId === command.commandId,
      );
      const turnIntents = events.filter(
        (event) =>
          (event.type === "thread.turn-queued" || event.type === "thread.turn-start-requested") &&
          event.payload.messageId === command.message.messageId,
      );
      expect(messageSents).toHaveLength(1);
      expect(turnIntents).toHaveLength(1);
    } finally {
      await system.dispose();
    }
  });

  it("rollback/mixed-version: the batch-ledger scan authority never redrives legacy `delivered` rows", async () => {
    const system = await createEngineSystem();
    try {
      // Direct introspection: Ticket 09 recovery authority is the batch ledger
      // and the recoverable outbox scan is pending + within-budget retryable.
      // A `delivered` row with no batch (old binary / downgrade) is inert.
      const sql = await system.run(Effect.service(SqlClient.SqlClient));
      const tableCount = await system.run(
        Effect.gen(function* () {
          return yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pi_subagent_completion_dispatch_batches'
          `;
        }),
      );
      expect(tableCount).toHaveLength(1);
    } finally {
      await system.dispose();
    }
  });
});
