// FILE: synaraMcpJourneySmoke.test.ts
// Purpose: impl-12 AC2 composite journey smoke test at the public
// reducer/work-log seam. One concise journey spans enable pending/succeeded,
// authorized Synara MCP tool activity, disable while an MCP call is in
// flight, and a failed enable rollback terminal, then reconnect replay
// hydration and redelivery dedupe. It asserts only journey-level outcomes —
// durable activity ordering/visibility, live-vs-replay equivalence, one
// redelivery dedupe fact, and aggregate non-contamination of messages,
// pending interactions, and sidebar summaries — without duplicating the
// per-kind/per-tone/bounded-diagnostic matrices that live in
// storeEventReducer.test.ts and workLog.test.ts.

import {
  ApprovalRequestId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationPendingInteraction,
  type OrchestrationThreadActivity,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { applyOrchestrationEvents } from "./storeEventReducer";
import { syncServerReadModel } from "./storeProjection";
import {
  makeActivity,
  makeDomainEvent,
  makeReadModel,
  makeReadModelThread,
  makeState,
  makeSynaraMcpCommandActivity,
  makeThread,
  threadsOf,
} from "./storeTestFixtures";
import { deriveWorkLogEntries } from "./workLog";

function durableFacts(activity: OrchestrationThreadActivity) {
  return {
    id: activity.id,
    kind: activity.kind,
    turnId: activity.turnId,
    createdAt: activity.createdAt,
    payload: activity.payload,
  };
}

describe("Synara MCP composite journey smoke test", () => {
  const threadId = ThreadId.makeUnsafe("thread-1");
  const turnId = TurnId.makeUnsafe("turn-1");

  // The full impl-12 journey as one durable activity stream. Times increase
  // monotonically with the event sequence so live reduction (sequence order)
  // and replay hydration (createdAt order) derive the same work log.
  const journeyActivities: OrchestrationThreadActivity[] = [
    // Enable accepted at a safe turn boundary, then reconciled to terminal
    // succeeded: the project is enabled.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:00.000Z",
      requestId: "enable-journey-1",
      command: "enable",
      phase: "pending",
      status: "pending",
      requestedState: "enabled",
    }),
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:01.000Z",
      requestId: "enable-journey-1",
      command: "enable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "enabled",
      finalState: "enabled",
    }),
    // Authorized Synara MCP tool activity on turn-1: a create-thread call
    // starts and completes successfully.
    makeActivity({
      id: "journey-tool-create-started",
      createdAt: "2026-08-14T12:00:02.000Z",
      kind: "tool.started",
      summary: "Synara create thread",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        data: {
          toolCallId: "journey-create-thread",
          toolName: "mcp__synara__synara_create_thread",
        },
      },
    }),
    makeActivity({
      id: "journey-tool-create-completed",
      createdAt: "2026-08-14T12:00:03.000Z",
      kind: "tool.completed",
      summary: "Synara create thread",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        data: {
          toolCallId: "journey-create-thread",
          toolName: "mcp__synara__synara_create_thread",
        },
      },
    }),
    // A second MCP call starts, and /Disable Synara MCP is accepted while it
    // is in flight: the pending ack arrives before the call is cancelled.
    makeActivity({
      id: "journey-tool-list-started",
      createdAt: "2026-08-14T12:00:04.000Z",
      kind: "tool.started",
      summary: "Synara list threads",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        data: {
          toolCallId: "journey-list-threads",
          toolName: "mcp__synara__synara_list_threads",
        },
      },
    }),
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:05.000Z",
      requestId: "disable-journey-1",
      command: "disable",
      phase: "pending",
      status: "pending",
      requestedState: "disabled",
    }),
    // The in-flight call is cancelled (interrupted completion), then the
    // disable reconciles to a terminal succeeded ack.
    makeActivity({
      id: "journey-tool-list-completed",
      createdAt: "2026-08-14T12:00:06.000Z",
      kind: "tool.completed",
      summary: "Synara list threads",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        status: "interrupted",
        data: {
          toolCallId: "journey-list-threads",
          toolName: "mcp__synara__synara_list_threads",
        },
      },
    }),
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:07.000Z",
      requestId: "disable-journey-1",
      command: "disable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "disabled",
      finalState: "disabled",
    }),
    // A later enable attempt fails and rolls the project back to disabled:
    // pending ack, then the failed rollback terminal with bounded detail.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:08.000Z",
      requestId: "enable-journey-2",
      command: "enable",
      phase: "pending",
      status: "pending",
      requestedState: "enabled",
    }),
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:09.000Z",
      requestId: "enable-journey-2",
      command: "enable",
      phase: "terminal",
      status: "failed",
      requestedState: "enabled",
      finalState: "disabled",
      detail: "The Synara MCP command could not be completed.",
    }),
  ];

  const journeyEvents = journeyActivities.map((activity, index) =>
    makeDomainEvent("thread.activity-appended", { threadId, activity }, { sequence: index + 1 }),
  );

  // The user message and real pending approval that coexist with the journey:
  // Synara MCP acknowledgements must never contaminate either.
  const userMessage = {
    id: MessageId.makeUnsafe("user-enable-journey"),
    role: "user" as const,
    text: "Enable Synara MCP",
    turnId: null,
    createdAt: "2026-08-14T11:59:59.000Z",
    streaming: false,
    source: "native" as const,
  };
  const pendingInteraction: OrchestrationPendingInteraction = {
    interactionKind: "approval",
    requestId: ApprovalRequestId.makeUnsafe("req-approval-journey"),
    threadId,
    turnId,
    lifecycleGeneration: "generation-1",
    status: "pending",
    decision: null,
    responseCommandId: null,
    responseRequestedAt: null,
    createdAt: "2026-08-14T11:59:59.000Z",
    resolvedAt: null,
  };

  // Journey-level work-log facts: row identity in journey order plus the two
  // outcome signals the journey must surface (the cancelled call and the
  // failed-rollback terminal). Exact labels, per-kind tones, and bounded
  // diagnostics are covered by workLog.test.ts.
  function workLogFacts(activities: OrchestrationThreadActivity[]) {
    return deriveWorkLogEntries(activities, turnId, {
      visibleTurnIds: new Set([turnId]),
    }).map((entry) => ({
      id: entry.id,
      tone: entry.tone,
      toolStatus: entry.toolStatus,
    }));
  }

  it("keeps the enable/use/disable/rollback journey durable, replay-equivalent, deduped, and uncontaminated", () => {
    // --- Live reduction: every journey activity lands exactly once, in
    // journey order, and the work log preserves that journey order.
    const live = applyOrchestrationEvents(
      makeState(makeThread({ messages: [userMessage], pendingInteractions: [pendingInteraction] })),
      journeyEvents,
    );
    const liveActivities = threadsOf(live)[0]?.activities ?? [];
    expect(liveActivities.map((activity) => activity.id)).toEqual(
      journeyActivities.map((activity) => activity.id),
    );

    const liveWorkLog = workLogFacts(liveActivities);
    expect(liveWorkLog.map((entry) => entry.id)).toEqual([
      "enable-journey-1:pending",
      "enable-journey-1:terminal",
      "journey-tool-create-completed",
      "journey-tool-list-completed",
      "disable-journey-1:pending",
      "disable-journey-1:terminal",
      "enable-journey-2:pending",
      "enable-journey-2:terminal",
    ]);
    // The disable cancelled the in-flight call: the interrupted completion is
    // visible as a cancelled row, and the journey ends on the failed-rollback
    // terminal.
    expect(liveWorkLog.find((entry) => entry.id === "journey-tool-list-completed")).toMatchObject({
      tone: "tool",
      toolStatus: "cancelled",
    });
    expect(liveWorkLog[liveWorkLog.length - 1]).toMatchObject({
      id: "enable-journey-2:terminal",
      tone: "error",
    });

    // --- Reconnect replay: the server read-model snapshot carries the same
    // durable activities; live reduction and replay hydration converge.
    const replayed = syncServerReadModel(
      makeState(makeThread()),
      makeReadModel(makeReadModelThread({ activities: journeyActivities })),
    );
    expect(threadsOf(replayed)[0]?.activities.map(durableFacts)).toEqual(
      liveActivities.map(durableFacts),
    );
    expect(workLogFacts(threadsOf(replayed)[0]?.activities ?? [])).toEqual(liveWorkLog);

    // --- Redelivery dedupes: re-applying the same journaled events after
    // reconnect must not duplicate durable rows or change the work log.
    const afterRedelivery = applyOrchestrationEvents(live, journeyEvents);
    const redeliveredActivities = threadsOf(afterRedelivery)[0]?.activities ?? [];
    expect(redeliveredActivities.map(durableFacts)).toEqual(liveActivities.map(durableFacts));
    expect(new Set(redeliveredActivities.map((activity) => activity.id)).size).toBe(
      redeliveredActivities.length,
    );
    expect(workLogFacts(redeliveredActivities)).toEqual(liveWorkLog);

    // --- Aggregate non-contamination: acknowledgements are activities; they
    // never become messages, never touch the real pending approval, and never
    // alter sidebar summaries.
    expect(threadsOf(live)[0]?.messages).toEqual([userMessage]);
    expect(threadsOf(live)[0]?.pendingInteractions).toEqual([pendingInteraction]);
    const summaryState = syncServerReadModel(
      makeState(makeThread({ title: "MCP journey" })),
      makeReadModel(
        makeReadModelThread({
          title: "MCP journey",
          updatedAt: "2026-08-14T12:00:00.000Z",
        }),
      ),
    );
    const previousSummary = summaryState.sidebarThreadSummaryById["thread-1"];
    expect(previousSummary).toBeDefined();
    expect(
      applyOrchestrationEvents(summaryState, journeyEvents).sidebarThreadSummaryById["thread-1"],
    ).toEqual(previousSummary);
  });
});
