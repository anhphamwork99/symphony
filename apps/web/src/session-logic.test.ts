import { ThreadId, TurnId, type OrchestrationThreadActivity } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  buildSourceProposedPlanReference,
  deriveActiveBackgroundTasksState,
  deriveActiveTaskListState,
  deriveActiveTurnBackgroundActivityState,
  deriveActiveWorkStartedAt,
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  hasLiveLatestTurn,
  hasLiveTurnTailWork,
  isLatestTurnSettled,
  PROVIDER_OPTIONS,
} from "./session-logic";
import { makeActivity } from "./storeTestFixtures";

describe("deriveActiveTaskListState", () => {
  it("returns the latest plan update for the active turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-old",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Initial plan",
          tasks: [{ task: "Inspect code", status: "pending" }],
        },
      }),
      makeActivity({
        id: "plan-latest",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Refined plan",
          tasks: [{ task: "Implement Codex user input", status: "inProgress" }],
        },
      }),
    ];

    expect(deriveActiveTaskListState(activities, TurnId.makeUnsafe("turn-1"))).toEqual({
      createdAt: "2026-02-23T00:00:02.000Z",
      turnId: "turn-1",
      explanation: "Refined plan",
      tasks: [{ task: "Implement Codex user input", status: "inProgress" }],
    });
  });

  it("falls back to the most recent plan from a previous turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-from-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          tasks: [{ task: "Write tests", status: "inProgress" }],
        },
      }),
    ];

    expect(deriveActiveTaskListState(activities, TurnId.makeUnsafe("turn-2"))).toEqual({
      createdAt: "2026-02-23T00:00:01.000Z",
      turnId: "turn-1",
      tasks: [{ task: "Write tests", status: "inProgress" }],
    });
  });

  it("does not revive a completed prior-turn plan on a new turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "completed-plan-from-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          tasks: [{ task: "Write tests", status: "completed" }],
        },
      }),
    ];

    expect(deriveActiveTaskListState(activities, TurnId.makeUnsafe("turn-2"))).toBeNull();
  });

  it("keeps an unfinished task list visible after its turn completes", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "unfinished-plan-from-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          tasks: [
            { task: "Inspect theme implementation", status: "pending" },
            { task: "Patch token plumbing", status: "pending" },
          ],
        },
      }),
      makeActivity({
        id: "turn-1-completed",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.completed",
        summary: "Turn completed",
        tone: "info",
        turnId: "turn-1",
        payload: {
          state: "completed",
        },
      }),
    ];

    expect(deriveActiveTaskListState(activities, TurnId.makeUnsafe("turn-2"))).toEqual({
      createdAt: "2026-02-23T00:00:01.000Z",
      turnId: "turn-1",
      tasks: [
        { task: "Inspect theme implementation", status: "pending" },
        { task: "Patch token plumbing", status: "pending" },
      ],
    });
  });

  it("uses sequence rather than a random activity id for same-millisecond snapshots", () => {
    const createdAt = "2026-02-23T00:00:01.000Z";
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "z-stale",
        sequence: 10,
        createdAt,
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: { tasks: [{ task: "Ship", status: "inProgress" }] },
      }),
      makeActivity({
        id: "a-final",
        sequence: 11,
        createdAt,
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: { tasks: [{ task: "Ship", status: "completed" }] },
      }),
    ];

    expect(deriveActiveTaskListState(activities, TurnId.makeUnsafe("turn-1"))?.tasks).toEqual([
      { task: "Ship", status: "completed" },
    ]);
  });

  it("treats an empty task update as an explicit clear", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-with-task",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          tasks: [{ task: "Patch UI", status: "inProgress" }],
        },
      }),
      makeActivity({
        id: "plan-cleared",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.tasks.updated",
        summary: "Tasks updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          tasks: [],
        },
      }),
    ];

    expect(deriveActiveTaskListState(activities, TurnId.makeUnsafe("turn-1"))).toBeNull();
  });
});

describe("deriveActiveBackgroundTasksState", () => {
  it("counts only still-active non-plan background tasks for the current turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-task-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "Plan task started",
        tone: "info",
        turnId: "turn-1",
        payload: {
          taskId: "turn-1",
          taskType: "plan",
        },
      }),
      makeActivity({
        id: "background-task-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.started",
        summary: "Subagent task started",
        tone: "info",
        turnId: "turn-1",
        payload: {
          taskId: "task-subagent-1",
          taskType: "subagent",
        },
      }),
      makeActivity({
        id: "background-task-progress",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.progress",
        summary: "Subagent task update",
        tone: "info",
        turnId: "turn-1",
        payload: {
          taskId: "task-subagent-1",
        },
      }),
      makeActivity({
        id: "completed-other-turn",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "task.completed",
        summary: "Task completed",
        tone: "info",
        turnId: "turn-2",
        payload: {
          taskId: "task-other-turn",
        },
      }),
    ];

    expect(deriveActiveBackgroundTasksState(activities, TurnId.makeUnsafe("turn-1"))).toEqual({
      activeCount: 1,
      taskIds: ["task-subagent-1"],
    });
  });

  it("retires paused tasks from active background work", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "background-task-start-paused",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "Task started",
        tone: "info",
        turnId: "turn-1",
        payload: { taskId: "task-paused", taskType: "subagent" },
      }),
      makeActivity({
        id: "background-task-paused",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.updated",
        summary: "Task paused",
        tone: "info",
        turnId: "turn-1",
        payload: { taskId: "task-paused", status: "paused" },
      }),
    ];

    expect(deriveActiveBackgroundTasksState(activities, TurnId.makeUnsafe("turn-1"))).toBeNull();
  });
});

describe("deriveActiveTurnBackgroundActivityState", () => {
  const runningTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "running" as const,
    startedAt: "2026-02-23T00:00:01.000Z",
    completedAt: null,
  };
  const runningSession = { orchestrationStatus: "running" as const };

  const backgroundActivity = (overrides: {
    id: string;
    createdAt: string;
    turnId?: string;
    state?: OrchestrationThreadActivity["payload"];
    payload?: OrchestrationThreadActivity["payload"];
  }) =>
    makeActivity({
      id: overrides.id,
      createdAt: overrides.createdAt,
      kind: "turn.background-activity.changed",
      summary: "Background activity changed",
      tone: "info",
      turnId: overrides.turnId ?? "turn-1",
      payload:
        overrides.payload ??
        (typeof overrides.state === "string"
          ? { state: overrides.state }
          : (overrides.state ?? {})),
    });

  it("derives each aggregate state for the current turn by ordered sequence (last change wins)", () => {
    for (const state of ["active", "idle", "finalizing"] as const) {
      const activities = [
        backgroundActivity({
          id: "bg-earlier",
          createdAt: "2026-02-23T00:00:02.000Z",
          state: "idle",
        }),
        backgroundActivity({
          id: "bg-latest",
          createdAt: "2026-02-23T00:00:03.000Z",
          state,
        }),
      ];
      expect(
        deriveActiveTurnBackgroundActivityState({
          activities,
          latestTurn: runningTurn,
          session: runningSession,
        }),
      ).toEqual({ state });
    }
  });

  it("ignores stale changes recorded on a prior turn", () => {
    const activities = [
      backgroundActivity({
        id: "bg-prior-turn",
        createdAt: "2026-02-23T00:00:01.500Z",
        turnId: "turn-0",
        state: "active",
      }),
    ];
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: runningTurn,
        session: runningSession,
      }),
    ).toBeNull();
  });

  it("clears once the latest turn is settled (completed and session no longer running)", () => {
    const activities = [
      backgroundActivity({ id: "bg-1", createdAt: "2026-02-23T00:00:02.000Z", state: "active" }),
    ];
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: {
          ...runningTurn,
          state: "completed" as const,
          completedAt: "2026-02-23T00:00:09.000Z",
        },
        session: { orchestrationStatus: "ready" as const },
      }),
    ).toBeNull();
  });

  it("keeps the status through the finalizing window: completed turn while the session is still running", () => {
    // The provider-stop window: the latest turn already carries a completion
    // timestamp but the provider session is still running down background
    // work. That is exactly when the aggregate status line must stay visible.
    const activities = [
      backgroundActivity({ id: "bg-1", createdAt: "2026-02-23T00:00:02.000Z", state: "active" }),
    ];
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: {
          ...runningTurn,
          state: "completed" as const,
          completedAt: "2026-02-23T00:00:09.000Z",
        },
        session: runningSession,
      }),
    ).toEqual({ state: "active" });
  });

  it("clears on an aborted (interrupted) latest turn even while the session is still running", () => {
    const activities = [
      backgroundActivity({ id: "bg-1", createdAt: "2026-02-23T00:00:02.000Z", state: "active" }),
    ];
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: {
          ...runningTurn,
          state: "interrupted" as const,
          completedAt: "2026-02-23T00:00:08.000Z",
        },
        session: runningSession,
      }),
    ).toBeNull();
  });

  it("clears when the session is no longer running", () => {
    for (const orchestrationStatus of [
      "idle",
      "ready",
      "interrupted",
      "stopped",
      "error",
    ] as const) {
      const activities = [
        backgroundActivity({
          id: "bg-1",
          createdAt: "2026-02-23T00:00:02.000Z",
          state: "active",
        }),
      ];
      expect(
        deriveActiveTurnBackgroundActivityState({
          activities,
          latestTurn: runningTurn,
          session: { orchestrationStatus },
        }),
      ).toBeNull();
    }
  });

  it("clears without a session or without a started latest turn", () => {
    const activities = [
      backgroundActivity({ id: "bg-1", createdAt: "2026-02-23T00:00:02.000Z", state: "active" }),
    ];
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: runningTurn,
        session: null,
      }),
    ).toBeNull();
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: { ...runningTurn, startedAt: null },
        session: runningSession,
      }),
    ).toBeNull();
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: null,
        session: runningSession,
      }),
    ).toBeNull();
  });

  it("derives the same status from a reconnect snapshot replay of the same journal", () => {
    const activities = [
      backgroundActivity({ id: "bg-1", createdAt: "2026-02-23T00:00:02.000Z", state: "active" }),
      backgroundActivity({
        id: "bg-2",
        createdAt: "2026-02-23T00:00:03.000Z",
        state: "finalizing",
      }),
    ];
    // A reconnect snapshot replays the same ordered journal; the derivation is
    // a pure function of that journal, so the replayed derivation must match.
    const first = deriveActiveTurnBackgroundActivityState({
      activities,
      latestTurn: runningTurn,
      session: runningSession,
    });
    const replayed = deriveActiveTurnBackgroundActivityState({
      activities: [...activities],
      latestTurn: { ...runningTurn },
      session: { ...runningSession },
    });
    expect(first).toEqual({ state: "finalizing" });
    expect(replayed).toEqual(first);
  });

  it("is stable when the latest change was appended twice (duplicate delivery)", () => {
    const base = backgroundActivity({
      id: "bg-1",
      createdAt: "2026-02-23T00:00:02.000Z",
      state: "active",
    });
    const latest = backgroundActivity({
      id: "bg-2",
      createdAt: "2026-02-23T00:00:03.000Z",
      state: "finalizing",
    });
    const duplicated = [base, latest, { ...latest }];

    const derived = deriveActiveTurnBackgroundActivityState({
      activities: duplicated,
      latestTurn: runningTurn,
      session: runningSession,
    });
    expect(derived).toEqual({ state: "finalizing" });
    // Idempotent across re-derivations of the same duplicated journal.
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities: [...duplicated],
        latestTurn: { ...runningTurn },
        session: { ...runningSession },
      }),
    ).toEqual(derived);
  });

  it("falls back to the most recent decodable change when the latest payload is malformed", () => {
    for (const malformed of [
      {},
      { state: 42 },
      { state: "running-background-work" },
      { state: null },
      "not-an-object",
      null,
    ] as const) {
      const activities = [
        backgroundActivity({
          id: "bg-decodable",
          createdAt: "2026-02-23T00:00:02.000Z",
          state: "active",
        }),
        backgroundActivity({
          id: "bg-malformed",
          createdAt: "2026-02-23T00:00:03.000Z",
          payload: malformed as OrchestrationThreadActivity["payload"],
        }),
      ];
      expect(
        deriveActiveTurnBackgroundActivityState({
          activities,
          latestTurn: runningTurn,
          session: runningSession,
        }),
      ).toEqual({ state: "active" });
    }
  });

  it("returns null when no change for the current turn is decodable", () => {
    const activities = [
      backgroundActivity({
        id: "bg-malformed",
        createdAt: "2026-02-23T00:00:02.000Z",
        payload: { state: "unknown-state" },
      }),
    ];
    expect(
      deriveActiveTurnBackgroundActivityState({
        activities,
        latestTurn: runningTurn,
        session: runningSession,
      }),
    ).toBeNull();
  });
});

describe("findLatestProposedPlan", () => {
  it("prefers the latest proposed plan for the active turn", () => {
    expect(
      findLatestProposedPlan(
        [
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "# Older",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:01.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "# Latest",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:02.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-2",
            turnId: TurnId.makeUnsafe("turn-2"),
            planMarkdown: "# Different turn",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:03.000Z",
            updatedAt: "2026-02-23T00:00:03.000Z",
          },
        ],
        TurnId.makeUnsafe("turn-1"),
      ),
    ).toEqual({
      id: "plan:thread-1:turn:turn-1",
      turnId: "turn-1",
      planMarkdown: "# Latest",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the most recently updated proposed plan", () => {
    const latestPlan = findLatestProposedPlan(
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.makeUnsafe("turn-1"),
          planMarkdown: "# First",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:01.000Z",
          updatedAt: "2026-02-23T00:00:01.000Z",
        },
        {
          id: "plan:thread-1:turn:turn-2",
          turnId: TurnId.makeUnsafe("turn-2"),
          planMarkdown: "# Latest",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:03.000Z",
        },
      ],
      null,
    );

    expect(latestPlan?.planMarkdown).toBe("# Latest");
  });
});

describe("hasActionableProposedPlan", () => {
  it("returns true for an unimplemented proposed plan", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.makeUnsafe("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:01.000Z",
      }),
    ).toBe(true);
  });

  it("returns false for a proposed plan already implemented elsewhere", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.makeUnsafe("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: "2026-02-23T00:00:02.000Z",
        implementationThreadId: ThreadId.makeUnsafe("thread-implement"),
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:02.000Z",
      }),
    ).toBe(false);
  });
});

describe("buildSourceProposedPlanReference", () => {
  it("returns source plan metadata for implementation turns", () => {
    expect(
      buildSourceProposedPlanReference({
        threadId: ThreadId.makeUnsafe("thread-source"),
        proposedPlan: { id: "plan-source" },
      }),
    ).toEqual({
      threadId: ThreadId.makeUnsafe("thread-source"),
      planId: "plan-source",
    });
  });

  it("omits source plan metadata when no plan is active", () => {
    expect(
      buildSourceProposedPlanReference({
        threadId: ThreadId.makeUnsafe("thread-source"),
        proposedPlan: null,
      }),
    ).toBeUndefined();
  });
});

describe("findSidebarProposedPlan", () => {
  it("prefers the running turn source proposed plan when available on the same thread", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.makeUnsafe("thread-1"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: TurnId.makeUnsafe("turn-plan"),
                planMarkdown: "# Source plan",
                implementedAt: "2026-02-23T00:00:03.000Z",
                implementationThreadId: ThreadId.makeUnsafe("thread-2"),
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:02.000Z",
              },
            ],
          },
          {
            id: ThreadId.makeUnsafe("thread-2"),
            proposedPlans: [
              {
                id: "plan-2",
                turnId: TurnId.makeUnsafe("turn-other"),
                planMarkdown: "# Latest elsewhere",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:04.000Z",
                updatedAt: "2026-02-23T00:00:05.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            planId: "plan-1",
          },
        },
        latestTurnSettled: false,
        threadId: ThreadId.makeUnsafe("thread-1"),
      }),
    ).toEqual({
      id: "plan-1",
      turnId: "turn-plan",
      planMarkdown: "# Source plan",
      implementedAt: "2026-02-23T00:00:03.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the latest proposed plan once the turn is settled", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.makeUnsafe("thread-1"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: TurnId.makeUnsafe("turn-plan"),
                planMarkdown: "# Older",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:02.000Z",
              },
              {
                id: "plan-2",
                turnId: TurnId.makeUnsafe("turn-latest"),
                planMarkdown: "# Latest",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:03.000Z",
                updatedAt: "2026-02-23T00:00:04.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            planId: "plan-1",
          },
        },
        latestTurnSettled: true,
        threadId: ThreadId.makeUnsafe("thread-1"),
      })?.planMarkdown,
    ).toBe("# Latest");
  });

  it("hides implemented proposed plans once the implementation turn is settled", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.makeUnsafe("thread-1"),
            proposedPlans: [
              {
                id: "plan-implemented",
                turnId: TurnId.makeUnsafe("turn-plan"),
                planMarkdown: "# Implemented",
                implementedAt: "2026-02-23T00:00:05.000Z",
                implementationThreadId: ThreadId.makeUnsafe("thread-1"),
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:05.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            planId: "plan-implemented",
          },
        },
        latestTurnSettled: true,
        threadId: ThreadId.makeUnsafe("thread-1"),
      }),
    ).toBeNull();
  });
});

describe("isLatestTurnSettled", () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed",
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("returns false while the session still reports the latest turn as running", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.makeUnsafe("turn-1"),
      }),
    ).toBe(false);
  });

  it("returns false while the session still reports another running turn", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.makeUnsafe("turn-2"),
      }),
    ).toBe(false);
  });

  it("returns true once the session is no longer running that turn", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "ready",
        activeTurnId: undefined,
      }),
    ).toBe(true);
  });

  it("returns false when turn timestamps are incomplete", () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          startedAt: null,
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
      ),
    ).toBe(false);
  });

  it("returns true for interrupted turns even while the session is still running", () => {
    expect(
      isLatestTurnSettled(
        {
          ...latestTurn,
          state: "interrupted",
        },
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        },
      ),
    ).toBe(true);
  });

  it("returns true for error turns even while the session is still running", () => {
    expect(
      isLatestTurnSettled(
        {
          ...latestTurn,
          state: "error",
        },
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        },
      ),
    ).toBe(true);
  });
});

describe("deriveActiveWorkStartedAt", () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed",
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("prefers the latest-turn start while the running session still points at it", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:10:00.000Z");
  });

  it("falls back to sendStartedAt when a different turn is currently running", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-2"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("uses sendStartedAt once the prior turn is settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });
});

describe("hasLiveLatestTurn", () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed",
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("returns true while the session still reports the latest turn as running", () => {
    expect(
      hasLiveLatestTurn(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.makeUnsafe("turn-1"),
      }),
    ).toBe(true);
  });

  it("returns false for interrupted turns because they are terminal locally", () => {
    expect(
      hasLiveLatestTurn(
        {
          ...latestTurn,
          state: "interrupted",
        },
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        },
      ),
    ).toBe(false);
  });

  it("returns false for error turns because they are terminal locally", () => {
    expect(
      hasLiveLatestTurn(
        {
          ...latestTurn,
          state: "error",
        },
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
        },
      ),
    ).toBe(false);
  });
});

describe("hasLiveTurnTailWork", () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    completedAt: null,
  } as const;

  it("keeps the turn live while assistant text is still streaming", () => {
    expect(
      hasLiveTurnTailWork({
        latestTurn,
        messages: [
          {
            role: "assistant",
            streaming: true,
            turnId: TurnId.makeUnsafe("turn-1"),
          },
        ],
        activities: [],
        session: { orchestrationStatus: "ready" },
      }),
    ).toBe(true);
  });

  it("ignores stale assistant streaming flags once the turn is completed", () => {
    expect(
      hasLiveTurnTailWork({
        latestTurn: {
          ...latestTurn,
          completedAt: "2026-04-13T00:00:05.000Z",
        },
        messages: [
          {
            role: "assistant",
            streaming: true,
            turnId: TurnId.makeUnsafe("turn-1"),
          },
        ],
        activities: [],
        session: { orchestrationStatus: "ready" },
      }),
    ).toBe(false);
  });

  it("keeps the turn live while a background task is still open", () => {
    expect(
      hasLiveTurnTailWork({
        latestTurn,
        messages: [],
        activities: [
          makeActivity({
            id: "task-started-1",
            kind: "task.started",
            summary: "Repo scan started",
            turnId: "turn-1",
            payload: {
              taskId: "task-1",
              taskType: "index",
              title: "Repo scan",
            },
          }),
        ],
        session: { orchestrationStatus: "running" },
      }),
    ).toBe(true);
  });

  it("ignores tool lifecycle bookkeeping once the visible answer is done", () => {
    expect(
      hasLiveTurnTailWork({
        latestTurn,
        messages: [],
        activities: [
          makeActivity({
            id: "tool-started-1",
            kind: "tool.started",
            summary: "Run shell command started",
            turnId: "turn-1",
            payload: {
              itemType: "command_execution",
              data: {
                item: {
                  id: "tool-1",
                },
              },
            },
          }),
          makeActivity({
            id: "tool-completed-1",
            kind: "tool.completed",
            summary: "Run shell command",
            turnId: "turn-1",
            payload: {
              itemType: "command_execution",
              data: {
                item: {
                  id: "tool-1",
                },
              },
            },
          }),
        ],
        session: { orchestrationStatus: "running" },
      }),
    ).toBe(false);
  });

  it("ignores stale background tasks once the provider session is idle", () => {
    expect(
      hasLiveTurnTailWork({
        latestTurn,
        messages: [],
        activities: [
          makeActivity({
            id: "task-started-1",
            kind: "task.started",
            summary: "Repo scan started",
            turnId: "turn-1",
            payload: {
              taskId: "task-1",
              taskType: "index",
              title: "Repo scan",
            },
          }),
          makeActivity({
            id: "task-progress-1",
            kind: "task.progress",
            summary: "Repo scan in progress",
            turnId: "turn-1",
            payload: {
              taskId: "task-1",
              taskType: "index",
              summary: "Scanning files",
            },
          }),
        ],
        session: { orchestrationStatus: "ready" },
      }),
    ).toBe(false);
  });
});

describe("PROVIDER_OPTIONS", () => {
  it("lists available providers", () => {
    const claude = PROVIDER_OPTIONS.find((option) => option.value === "claudeAgent");
    const cursor = PROVIDER_OPTIONS.find((option) => option.value === "cursor");
    const grok = PROVIDER_OPTIONS.find((option) => option.value === "grok");
    const droid = PROVIDER_OPTIONS.find((option) => option.value === "droid");
    const kilo = PROVIDER_OPTIONS.find((option) => option.value === "kilo");
    const opencode = PROVIDER_OPTIONS.find((option) => option.value === "opencode");
    const pi = PROVIDER_OPTIONS.find((option) => option.value === "pi");
    expect(PROVIDER_OPTIONS).toEqual([
      { value: "codex", label: "Codex", available: true },
      { value: "claudeAgent", label: "Claude", available: true },
      { value: "cursor", label: "Cursor", available: true },
      { value: "antigravity", label: "Antigravity", available: true },
      { value: "grok", label: "Grok", available: true },
      { value: "droid", label: "Droid", available: true },
      { value: "kilo", label: "Kilo", available: true },
      { value: "opencode", label: "OpenCode", available: true },
      { value: "pi", label: "Pi", available: true },
    ]);
    expect(claude).toEqual({
      value: "claudeAgent",
      label: "Claude",
      available: true,
    });
    expect(cursor).toEqual({
      value: "cursor",
      label: "Cursor",
      available: true,
    });
    expect(grok).toEqual({
      value: "grok",
      label: "Grok",
      available: true,
    });
    expect(droid).toEqual({
      value: "droid",
      label: "Droid",
      available: true,
    });
    expect(kilo).toEqual({
      value: "kilo",
      label: "Kilo",
      available: true,
    });
    expect(opencode).toEqual({
      value: "opencode",
      label: "OpenCode",
      available: true,
    });
    expect(pi).toEqual({
      value: "pi",
      label: "Pi",
      available: true,
    });
  });
});
