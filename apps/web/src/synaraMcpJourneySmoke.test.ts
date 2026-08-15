// FILE: synaraMcpJourneySmoke.test.ts
// Purpose: impl-12 AC2 composite journey smoke test at the public
// reducer/work-log seam. One journey spans dormant startup, enable
// pending/succeeded, authorized Synara MCP tool activity, disable pending
// while an MCP call is in flight, the Pi turn continuing after the cancelled
// call, a failed enable rollback terminal, reconnect replay hydration, and
// redelivery dedupe. It asserts live reduction and replay hydration converge,
// derived work-log entries keep stable journey order/labels/tones, messages,
// pending interactions, and sidebar summaries stay untouched, and redelivery
// dedupes. Deliberately composite: the focused matrices live in
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

describe("Synara MCP composite journey smoke test", () => {
  const threadId = ThreadId.makeUnsafe("thread-1");
  const turnId = TurnId.makeUnsafe("turn-1");

  // The full impl-12 journey as one durable activity stream. Times increase
  // monotonically with the event sequence so live reduction (sequence order)
  // and replay hydration (createdAt order) derive the same work log.
  const journeyActivities: OrchestrationThreadActivity[] = [
    // 1. Enable command accepted at a safe turn boundary: pending ack first.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:00.000Z",
      requestId: "enable-journey-1",
      command: "enable",
      phase: "pending",
      status: "pending",
      requestedState: "enabled",
    }),
    // 2. Enable reconciled: terminal succeeded ack, project enabled.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:01.000Z",
      requestId: "enable-journey-1",
      command: "enable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "enabled",
      finalState: "enabled",
    }),
    // 3-4. Authorized Synara MCP tool activity on turn-1: a create-thread call
    // starts and completes successfully.
    makeActivity({
      id: "journey-tool-create-started",
      createdAt: "2026-08-14T12:00:02.000Z",
      kind: "tool.started",
      summary: "Synara create thread",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        title: "Synara create thread",
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
        status: "completed",
        title: "Synara create thread",
        data: {
          toolCallId: "journey-create-thread",
          toolName: "mcp__synara__synara_create_thread",
        },
      },
    }),
    // 5. A second MCP call starts...
    makeActivity({
      id: "journey-tool-list-started",
      createdAt: "2026-08-14T12:00:04.000Z",
      kind: "tool.started",
      summary: "Synara list threads",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        title: "Synara list threads",
        data: {
          toolCallId: "journey-list-threads",
          toolName: "mcp__synara__synara_list_threads",
        },
      },
    }),
    // 6. ...and /Disable Synara MCP is accepted while that call is in flight:
    // pending ack arrives before the call is cancelled.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:05.000Z",
      requestId: "disable-journey-1",
      command: "disable",
      phase: "pending",
      status: "pending",
      requestedState: "disabled",
    }),
    // 7. The in-flight call is cancelled (interrupted completion)...
    makeActivity({
      id: "journey-tool-list-completed",
      createdAt: "2026-08-14T12:00:06.000Z",
      kind: "tool.completed",
      summary: "Synara list threads",
      turnId,
      payload: {
        itemType: "mcp_tool_call",
        status: "interrupted",
        title: "Synara list threads",
        data: {
          toolCallId: "journey-list-threads",
          toolName: "mcp__synara__synara_list_threads",
        },
      },
    }),
    // 8. ...and the disable reconciles to a terminal succeeded ack.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:07.000Z",
      requestId: "disable-journey-1",
      command: "disable",
      phase: "terminal",
      status: "succeeded",
      requestedState: "disabled",
      finalState: "disabled",
    }),
    // 9-10. The Pi turn continues after the cancelled MCP call: ordinary
    // non-MCP work (a file change) completes on the same turn.
    makeActivity({
      id: "journey-turn-continues-started",
      createdAt: "2026-08-14T12:00:08.000Z",
      kind: "tool.started",
      summary: "Apply patch",
      turnId,
      payload: {
        itemType: "file_change",
        title: "Apply patch",
        data: {
          toolCallId: "journey-apply-patch",
          item: { changes: [{ path: "README.md" }] },
        },
      },
    }),
    makeActivity({
      id: "journey-turn-continues-completed",
      createdAt: "2026-08-14T12:00:09.000Z",
      kind: "tool.completed",
      summary: "Apply patch",
      turnId,
      payload: {
        itemType: "file_change",
        status: "completed",
        title: "Apply patch",
        data: {
          toolCallId: "journey-apply-patch",
          item: { changes: [{ path: "README.md" }] },
        },
      },
    }),
    // 11-12. A later enable attempt fails and rolls the project back to
    // disabled: pending ack, then the failed rollback terminal with bounded
    // sanitized detail.
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:10.000Z",
      requestId: "enable-journey-2",
      command: "enable",
      phase: "pending",
      status: "pending",
      requestedState: "enabled",
    }),
    makeSynaraMcpCommandActivity({
      createdAt: "2026-08-14T12:00:11.000Z",
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
    makeDomainEvent(
      "thread.activity-appended",
      { threadId, activity },
      { sequence: index + 1 },
    ),
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

  function durableFacts(activity: OrchestrationThreadActivity) {
    return {
      id: activity.id,
      kind: activity.kind,
      turnId: activity.turnId,
      createdAt: activity.createdAt,
      payload: activity.payload,
    };
  }

  function entryFacts(state: ReturnType<typeof makeState>) {
    return deriveWorkLogEntries(
      threadsOf(state)[0]?.activities ?? [],
      turnId,
      { visibleTurnIds: new Set([turnId]) },
    ).map((entry) => ({
      id: entry.id,
      label: entry.label,
      tone: entry.tone,
      turnId: entry.turnId,
      toolTitle: entry.toolTitle,
      toolStatus: entry.toolStatus,
      detail: entry.detail,
    }));
  }

  it("reduces the enable/use/disable/rollback journey live and replays it identically", () => {
    // --- Dormant start: no Synara MCP catalog, connection, or activity rows.
    const dormant = makeState(makeThread());
    expect(threadsOf(dormant)[0]?.activities).toEqual([]);
    expect(deriveWorkLogEntries(threadsOf(dormant)[0]?.activities ?? [], undefined)).toEqual([]);

    // --- Live reduction of the whole journey.
    const initialState = makeState(
      makeThread({ messages: [userMessage], pendingInteractions: [pendingInteraction] }),
    );
    const live = applyOrchestrationEvents(initialState, journeyEvents);

    // Exactly-once durable rows on the live path: every journey activity keeps
    // its deterministic id; none is duplicated or dropped.
    const liveActivities = threadsOf(live)[0]?.activities ?? [];
    expect(liveActivities.map((activity) => activity.id)).toEqual(
      journeyActivities.map((activity) => activity.id),
    );

    // --- Derived work log: stable journey order, labels, and tones.
    // MCP acknowledgement rows stay null-turn and never collapse; the two tool
    // calls collapse into one row each at their start position, so the disable
    // pending row sits after the cancelled in-flight call it ordered.
    expect(entryFacts(live)).toEqual([
      {
        id: "enable-journey-1:pending",
        label: "Synara MCP will be enabled after the current turn completes",
        tone: "info",
        turnId: null,
        toolTitle: "Synara MCP will be enabled after the current turn completes",
        toolStatus: undefined,
        detail: undefined,
      },
      {
        id: "enable-journey-1:terminal",
        label: "Synara MCP is enabled for this project",
        tone: "info",
        turnId: null,
        toolTitle: "Synara MCP is enabled for this project",
        toolStatus: undefined,
        detail: undefined,
      },
      {
        id: "journey-tool-create-completed",
        label: "Synara create thread",
        tone: "tool",
        turnId,
        toolTitle: "Synara created a thread",
        toolStatus: "completed",
        detail: undefined,
      },
      {
        id: "journey-tool-list-completed",
        label: "Synara list threads",
        tone: "tool",
        turnId,
        toolTitle: "Synara stopped listing threads",
        toolStatus: "cancelled",
        detail: undefined,
      },
      {
        id: "disable-journey-1:pending",
        label: "Synara MCP will be disabled after the current turn completes",
        tone: "info",
        turnId: null,
        toolTitle: "Synara MCP will be disabled after the current turn completes",
        toolStatus: undefined,
        detail: undefined,
      },
      {
        id: "disable-journey-1:terminal",
        label: "Synara MCP is disabled",
        tone: "info",
        turnId: null,
        toolTitle: "Synara MCP is disabled",
        toolStatus: undefined,
        detail: undefined,
      },
      {
        id: "journey-turn-continues-completed",
        label: "Apply patch",
        tone: "tool",
        turnId,
        toolTitle: "Apply patch",
        toolStatus: "completed",
        detail: undefined,
      },
      {
        id: "enable-journey-2:pending",
        label: "Synara MCP will be enabled after the current turn completes",
        tone: "info",
        turnId: null,
        toolTitle: "Synara MCP will be enabled after the current turn completes",
        toolStatus: undefined,
        detail: undefined,
      },
      {
        id: "enable-journey-2:terminal",
        label: "Synara MCP activation failed; the project remains disabled",
        tone: "error",
        turnId: null,
        toolTitle: "Synara MCP activation failed; the project remains disabled",
        toolStatus: undefined,
        detail: "The Synara MCP command could not be completed.",
      },
    ]);

    // --- No assistant/sidebar/pending-interaction contamination.
    // Acknowledgements are activities: they never become messages, never touch
    // the real pending approval, and never alter its pending state.
    expect(threadsOf(live)[0]?.messages).toEqual([userMessage]);
    expect(threadsOf(live)[0]?.pendingInteractions).toEqual([pendingInteraction]);

    // Sidebar summaries stay untouched: MCP acknowledgements and tool rows are
    // not summary-signal activities.
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
    const summaryAfter = applyOrchestrationEvents(summaryState, journeyEvents);
    expect(previousSummary).toBeDefined();
    expect(summaryAfter.sidebarThreadSummaryById["thread-1"]).toEqual(previousSummary);

    // --- Reconnect replay: the server read-model snapshot carries the same
    // durable activities; live reduction and replay hydration converge.
    const replayed = syncServerReadModel(
      makeState(makeThread()),
      makeReadModel(makeReadModelThread({ activities: journeyActivities })),
    );
    expect(threadsOf(replayed)[0]?.activities.map(durableFacts)).toEqual(
      liveActivities.map(durableFacts),
    );
    // Work log derived from the replayed state matches the live-derived one.
    expect(entryFacts(replayed)).toEqual(entryFacts(live));

    // --- Redelivery dedupes: re-applying the same journaled events after
    // reconnect must not duplicate durable rows or change the work log.
    const afterRedelivery = applyOrchestrationEvents(live, journeyEvents);
    const redeliveredActivities = threadsOf(afterRedelivery)[0]?.activities ?? [];
    expect(redeliveredActivities.map(durableFacts)).toEqual(liveActivities.map(durableFacts));
    expect(redeliveredActivities.map((activity) => activity.id)).toEqual(
      liveActivities.map((activity) => activity.id),
    );
    const redeliveredIds = redeliveredActivities.map((activity) => activity.id);
    expect(new Set(redeliveredIds).size).toBe(redeliveredIds.length);
    expect(entryFacts(afterRedelivery)).toEqual(entryFacts(live));
  });
});
