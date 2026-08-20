// FILE: piSubagentExecutionCardReconnect.test.ts
// Ticket 17 — T17-AC2 (slice 1, web hydration seam): proves the PRODUCTION
// web store restores an execution card from a fresh reconnect thread-detail
// snapshot of the shape the integrated real-Pi acceptance harness observed
// through a genuinely new WebSocket client.
//
// Fixture provenance: the card payload below is the exact field-for-field
// shape captured from the Ticket-17 server harness run (2026-08-19) — a
// `getThreadDetailSnapshot` response for a thread whose foreground-managed
// subagent execution had just detached and was still `running`, observed by
// a NEW WS client after the first one closed. Cross-package imports of the
// server harness are not possible (apps/web does not depend on apps/server),
// so the payload is embedded here verbatim and re-validated against the
// `PiSubagentExecutionCard` CONTRACT schema before entering the store; the
// server-side half of the claim (a real server actually produced this shape
// over the public WS boundary) is proven by
// `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts` stage 2.
//
// The seams under test are the production web modules: snapshot
// normalization (`normalizeThreadFromReadModel`), full read-model sync
// (`syncServerReadModel`), the event reducer
// (`applyOrchestrationEvents`), and the thread selector
// (`getThreadFromState`) — the same path a browser tab takes after
// reconnecting.
import {
  OrchestrationThreadDetailSnapshot,
  PiSubagentExecutionCard,
  ThreadId,
  type OrchestrationEvent,
  type PiSubagentExecutionCard as PiSubagentExecutionCardType,
} from "@synara/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { applyOrchestrationEvents } from "./storeEventReducer";
import { makeDomainEvent, makeState, makeThread } from "./storeTestFixtures";
import { normalizeThreadFromReadModel } from "./storeNormalization";
import { getThreadFromState } from "./threadDerivation";
import { syncServerReadModel } from "./storeProjection";

const reconnectThreadId = ThreadId.makeUnsafe("t17-thread-2");

/**
 * Verbatim reconnect card observed by the fresh WS client in the Ticket-17
 * real-Pi harness (stage 2) while the detached child was still running.
 * `leaseExpiresAt` was still null at that instant (first heartbeat had not
 * landed yet) — the honest snapshot a reconnecting browser receives.
 */
const realReconnectRunningCard = {
  executionId: "exec_b9f0ba12-8fec-4080-9bd0-f25752a1b270",
  attemptId: "att_e324318e-8628-433a-94ab-33ad93d4b2c1",
  generation: 1,
  projectId: "t17-proj-1",
  parentThreadId: "t17-thread-2",
  parentTurnId: "65cde1b9-7c4f-4993-af9f-c2bb0c761792",
  parentToolCallId: "call_synara_local_agent",
  agentType: "researcher",
  mode: "foreground",
  cancellationScope: "parent_turn",
  desiredState: "running",
  observedState: "running",
  leaseExpiresAt: null,
  droppedProgressCount: 0,
  createdAt: "2026-08-19T18:10:55.078Z",
  updatedAt: "2026-08-19T18:10:55.391Z",
} satisfies Record<string, unknown>;

/** Contract validation gate: the fixture is schema-valid server output. */
function decodeReconnectCard(): PiSubagentExecutionCardType {
  const decoded = Schema.decodeUnknownOption(PiSubagentExecutionCard)(
    realReconnectRunningCard,
  );
  if (decoded._tag === "None") {
    throw new Error("Reconnect card fixture is not a valid PiSubagentExecutionCard.");
  }
  return decoded.value;
}

function makeReconnectThreadDetail(card: PiSubagentExecutionCardType) {
  const thread = {
    ...makeThread({ id: reconnectThreadId }),
    deletedAt: null,
    checkpoints: [],
    piSubagentExecutions: [card],
  } as unknown as Parameters<typeof normalizeThreadFromReadModel>[0];
  return thread;
}

function executionUpdatedEvent(
  card: PiSubagentExecutionCardType,
  sequence: number,
): Extract<OrchestrationEvent, { type: "thread.pi-subagent-execution-updated" }> {
  return makeDomainEvent(
    "thread.pi-subagent-execution-updated",
    {
      threadId: reconnectThreadId,
      executionId: card.executionId,
      journalSequence: 3,
      card,
    },
    { sequence },
  );
}

describe("Ticket 17 execution-card reconnect hydration (web store seam)", () => {
  it("restores the running card from a fresh reconnect thread-detail snapshot without any parent tool row", () => {
    const card = decodeReconnectCard();
    expect(card.observedState).toBe("running");

    // Snapshot normalization path (the reconnecting tab's thread-detail
    // hydration): the card survives with identity and durable state intact.
    const normalized = normalizeThreadFromReadModel(
      makeReconnectThreadDetail(card),
      undefined,
    );
    expect(normalized.piSubagentExecutions).toHaveLength(1);
    const restored = normalized.piSubagentExecutions![0]!;
    expect(restored.executionId).toBe(card.executionId);
    expect(restored.attemptId).toBe(card.attemptId);
    expect(restored.observedState).toBe("running");
    expect(restored.desiredState).toBe("running");
    expect(restored.leaseExpiresAt ?? null).toBeNull();
    expect(restored.droppedProgressCount).toBe(0);

    // Idempotent hydration: an identical second snapshot keeps the same
    // reference (no churn on reconnect storms).
    const again = normalizeThreadFromReadModel(
      makeReconnectThreadDetail(card) as never,
      normalized,
    );
    expect(again).toBe(normalized);
  });

  it("full read-model sync writes the card slice and the thread selector reconstructs it", () => {
    const card = decodeReconnectCard();
    const readModel = {
      snapshotSequence: 7,
      spaces: [],
      projects: [],
      updatedAt: "2026-08-19T18:10:56.000Z",
      threads: [
        {
          ...makeThread({ id: reconnectThreadId }),
          deletedAt: null,
          checkpoints: [],
          piSubagentExecutions: [card],
        } as never,
      ],
    } as never;
    let state = makeState(makeThread({ id: reconnectThreadId }));
    state = syncServerReadModel(state, readModel);
    expect(state.piSubagentExecutionsByThreadId?.[reconnectThreadId]).toHaveLength(1);
    const thread = getThreadFromState(state, reconnectThreadId);
    expect(thread?.piSubagentExecutions).toHaveLength(1);
    expect(thread?.piSubagentExecutions![0]!.executionId).toBe(card.executionId);
    expect(thread?.piSubagentExecutions![0]!.observedState).toBe("running");
  });

  it("a live terminal card update replaces the restored card by identity (no duplicate)", () => {
    const card = decodeReconnectCard();
    const base = makeState(makeThread({ id: reconnectThreadId }));
    // Reconnect hydration first…
    let state = syncServerReadModel(
      base,
      {
        snapshotSequence: 7,
        spaces: [],
        projects: [],
        updatedAt: "2026-08-19T18:10:56.000Z",
        threads: [
          {
            ...makeThread({ id: reconnectThreadId }),
            deletedAt: null,
            checkpoints: [],
            piSubagentExecutions: [card],
          } as never,
        ],
      } as never,
    );
    // …then the durable terminal truth arrives through the event stream.
    const terminalCard: PiSubagentExecutionCardType = {
      ...card,
      desiredState: "succeeded",
      observedState: "succeeded",
      leaseExpiresAt: "2026-08-19T18:10:59.000Z",
      lastProgressSummary: "running",
      lastProgressAt: "2026-08-19T18:10:58.000Z",
      terminalSummary: "ACK",
    };
    state = applyOrchestrationEvents(state, [executionUpdatedEvent(terminalCard, 12)]);
    const after = getThreadFromState(state, reconnectThreadId);
    expect(after?.piSubagentExecutions).toHaveLength(1);
    expect(after?.piSubagentExecutions![0]!.observedState).toBe("succeeded");
    expect(after?.piSubagentExecutions![0]!.terminalSummary).toContain("ACK");
    // Snapshot replacement stays wholesale-honest: a later snapshot that
    // explicitly carries NO executions for the thread drops the card (server
    // truth wins over stale local state; an absent field would instead
    // preserve it — that distinction is itself production semantics).
    state = syncServerReadModel(
      state,
      {
        snapshotSequence: 20,
        spaces: [],
        projects: [],
        updatedAt: "2026-08-19T18:11:10.000Z",
        threads: [
          {
            ...makeThread({ id: reconnectThreadId }),
            deletedAt: null,
            checkpoints: [],
            piSubagentExecutions: [],
          } as never,
        ],
      } as never,
    );
    const evicted = getThreadFromState(state, reconnectThreadId);
    expect(evicted?.piSubagentExecutions ?? []).toHaveLength(0);
  });
});
