import type { OrchestrationEvent, PiSubagentExecutionCard } from "@synara/contracts";
import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { applyOrchestrationEvents } from "./storeEventReducer";
import { makeDomainEvent, makeState, makeThread } from "./storeTestFixtures";
import { normalizeThreadFromReadModel } from "./storeNormalization";
import { getThreadFromState } from "./threadDerivation";
import { syncServerReadModel } from "./storeProjection";

/**
 * Ticket 11 — web store reducer + snapshot hydration contracts (T11-AC2,
 * T11-AC4, T11-AC5): execution-card upsert idempotency (duplicate event
 * identities have ONE projection effect), full lifecycle state coverage,
 * cancel-request intent neutrality (no projection without server truth), and
 * snapshot hydration restoring cards without any parent tool row.
 */

const threadId = ThreadId.makeUnsafe("thread-pi-1");

function makeCard(overrides: Partial<PiSubagentExecutionCard> = {}): PiSubagentExecutionCard {
  return {
    executionId: "exec-1",
    attemptId: "exec-1_att1",
    generation: 1,
    projectId: "project-1",
    parentThreadId: "thread-pi-1",
    parentTurnId: null,
    parentToolCallId: null,
    agentType: "worker",
    mode: "foreground",
    cancellationScope: "parent_turn",
    desiredState: "running",
    observedState: "running",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:01.000Z",
    ...overrides,
  } as PiSubagentExecutionCard;
}

function executionUpdatedEvent(
  card: PiSubagentExecutionCard,
  overrides: Partial<
    Extract<OrchestrationEvent, { type: "thread.pi-subagent-execution-updated" }>
  > = {},
): Extract<OrchestrationEvent, { type: "thread.pi-subagent-execution-updated" }> {
  return makeDomainEvent(
    "thread.pi-subagent-execution-updated",
    {
      threadId,
      executionId: card.executionId,
      journalSequence: 2,
      card,
    },
    overrides,
  );
}

describe("Ticket 11 execution-card store reducer", () => {
  it("T11-AC2: upserts a card by executionId and duplicate events have ONE projection effect", () => {
    const card = makeCard();
    const event = executionUpdatedEvent(card, { sequence: 5 });

    let state = applyOrchestrationEvents(makeState(makeThread({ id: threadId })), [event]);
    let after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    expect(after.piSubagentExecutions).toHaveLength(1);
    expect(after.piSubagentExecutions![0]!.executionId).toBe("exec-1");

    const firstProjection = state.piSubagentExecutionsByThreadId?.[threadId];

    // Replayed duplicate (same identity, same content): one projection
    // effect — the state slice keeps the SAME array reference (no churn).
    state = applyOrchestrationEvents(state, [event]);
    expect(state.piSubagentExecutionsByThreadId?.[threadId]).toBe(firstProjection);

    // A NEW event identity with the same execution: replace, not append.
    state = applyOrchestrationEvents(state, [
      executionUpdatedEvent(makeCard({ observedState: "cancelling", desiredState: "cancelling" }), {
        sequence: 6,
      }),
    ]);
    after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    expect(after.piSubagentExecutions).toHaveLength(1);
    expect(after.piSubagentExecutions![0]!.observedState).toBe("cancelling");
  });

  it("Ticket 03: new whole-card fields project through the upsert idempotently (T03-AC5)", () => {
    const freshCard = makeCard({
      observedState: "running",
      desiredState: "running",
      currentAttachment: "detached",
      currentTeardownEvidence: "none",
    });
    let state = applyOrchestrationEvents(makeState(makeThread({ id: threadId })), [
      executionUpdatedEvent(freshCard, { sequence: 5 }),
    ]);
    let after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    expect(after.piSubagentExecutions![0]!.currentAttachment).toBe("detached");
    expect(after.piSubagentExecutions![0]!.currentTeardownEvidence).toBe("none");

    // Duplicate identity, identical content: one projection effect — the
    // slice keeps the same reference while carrying the new fields.
    const firstProjection = state.piSubagentExecutionsByThreadId?.[threadId];
    state = applyOrchestrationEvents(state, [executionUpdatedEvent(freshCard, { sequence: 5 })]);
    expect(state.piSubagentExecutionsByThreadId?.[threadId]).toBe(firstProjection);

    // A new identity advancing the whole-card truth replaces, not appends.
    state = applyOrchestrationEvents(state, [
      executionUpdatedEvent(
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "owner_unproven",
        }),
        { sequence: 6 },
      ),
    ]);
    after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    expect(after.piSubagentExecutions).toHaveLength(1);
    expect(after.piSubagentExecutions![0]!.currentTeardownEvidence).toBe("owner_unproven");
  });

  it("Ticket 03: an old-shape card (absent fields) projects conservative null truth without churn", () => {
    const oldShape = makeCard() as unknown as Record<string, unknown>;
    delete oldShape.currentAttachment;
    delete oldShape.currentTeardownEvidence;
    const card = oldShape as unknown as PiSubagentExecutionCard;
    const event = executionUpdatedEvent(card, { sequence: 5 });

    const state = applyOrchestrationEvents(makeState(makeThread({ id: threadId })), [event]);
    const after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    expect(after.piSubagentExecutions).toHaveLength(1);
    // Conservative hydration: the web treats absent truth as null (ordinary
    // observed-state presentation) and never fabricates attachment or
    // teardown evidence.
    expect(after.piSubagentExecutions![0]!.currentAttachment ?? null).toBeNull();
    expect(after.piSubagentExecutions![0]!.currentTeardownEvidence ?? null).toBeNull();
  });

  it("T11-AC4: every managed lifecycle state projects onto the card slice", () => {
    const states = [
      "requested",
      "accepted",
      "queued",
      "running",
      "cancelling",
      "cancelled",
      "succeeded",
      "failed",
      "orphaned",
    ] as const;
    let state = makeState(makeThread({ id: threadId }));
    let sequence = 1;
    for (const observedState of states) {
      sequence += 1;
      state = applyOrchestrationEvents(state, [
        executionUpdatedEvent(makeCard({ observedState, desiredState: observedState }), {
          sequence,
        }),
      ]);
      const after = getThreadFromState(state, threadId) as {
        piSubagentExecutions?: PiSubagentExecutionCard[];
      };
      expect(after.piSubagentExecutions![0]!.observedState).toBe(observedState);
    }
    expect(getThreadFromState(state, threadId)!.piSubagentExecutions).toHaveLength(1);
  });

  it("T14-AC6: resume-request events project NOTHING — durable truth arrives only through card updates", () => {
    const state = applyOrchestrationEvents(
      applyOrchestrationEvents(makeState(makeThread({ id: threadId })), [
        executionUpdatedEvent(makeCard({ observedState: "orphaned", desiredState: "running" }), {
          sequence: 5,
        }),
      ]),
      [
        makeDomainEvent(
          "thread.pi-subagent-execution-resume-requested",
          {
            threadId,
            executionId: "exec-1",
            createdAt: "2026-08-19T00:00:02.000Z",
          },
          { sequence: 7 },
        ),
      ],
    );
    const after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    // The orphaned card keeps rendering durable truth: the new attempt lands
    // only via the server's journal-first execution-updated event.
    expect(after.piSubagentExecutions).toHaveLength(1);
    expect(after.piSubagentExecutions![0]!.observedState).toBe("orphaned");
  });

  it("T11-AC6: cancel-request events project NOTHING — durable truth arrives only through card updates", () => {
    const state = applyOrchestrationEvents(makeState(makeThread({ id: threadId })), [
      makeDomainEvent(
        "thread.pi-subagent-execution-cancel-requested",
        {
          threadId,
          executionId: "exec-1",
          createdAt: "2026-08-19T00:00:02.000Z",
        },
        { sequence: 7 },
      ),
    ]);
    const after = getThreadFromState(state, threadId) as {
      piSubagentExecutions?: PiSubagentExecutionCard[];
    };
    expect(after.piSubagentExecutions ?? []).toHaveLength(0);
  });

  it("T11-AC5: snapshot hydration restores cards without a parent tool row", () => {
    const card = makeCard({ observedState: "orphaned", desiredState: "orphaned" });
    const readModelThread = {
      ...makeThread({ id: threadId }),
      checkpoints: [],
      piSubagentExecutions: [card],
    } as unknown as Parameters<typeof normalizeThreadFromReadModel>[0];
    const normalized = normalizeThreadFromReadModel(readModelThread, undefined);
    expect(normalized.piSubagentExecutions).toHaveLength(1);
    expect(normalized.piSubagentExecutions![0]!.observedState).toBe("orphaned");

    // Snapshot replacement is wholesale: a snapshot without the execution
    // drops it (eviction/reset honesty), and a second equal snapshot keeps
    // the previous reference (no churn).
    const again = normalizeThreadFromReadModel(readModelThread as never, normalized);
    expect(again).toBe(normalized);
  });

  it("T11-AC5: full read-model sync writes the card slice and reconstructs it through the thread selector", () => {
    const card = makeCard({ observedState: "succeeded", desiredState: "succeeded" });
    const readModel = {
      snapshotSequence: 2,
      spaces: [],
      projects: [],
      updatedAt: "2026-08-19T00:00:00.000Z",
      threads: [
        {
          ...makeThread({ id: threadId }),
          deletedAt: null,
          checkpoints: [],
          piSubagentExecutions: [card],
        } as never,
      ],
    } as never;
    let state = makeState(makeThread({ id: threadId }));
    state = syncServerReadModel(state, readModel);
    expect(state.piSubagentExecutionsByThreadId?.[threadId]).toHaveLength(1);
    const thread = getThreadFromState(state, threadId);
    expect(thread?.piSubagentExecutions).toHaveLength(1);
    expect(thread?.piSubagentExecutions![0]!.executionId).toBe("exec-1");
  });
});
