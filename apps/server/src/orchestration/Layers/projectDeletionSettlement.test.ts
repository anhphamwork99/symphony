// FILE: projectDeletionSettlement.test.ts
// Purpose: Proves WP4 Project-deletion sequencing (Decision 0002): terminal
//          settlement BEFORE the command commits, workspace deletion INSIDE
//          the same SQL transaction as `project.deleted`, typed rejection on
//          unproven settlement (no event, workspace retained), transaction
//          rollback restoring workspace + no event, idempotent retry, and
//          Thread delete/archive never settling Project terminals.
// Layer: Orchestration engine integration test (in-memory SQLite).

import {
  CommandId,
  ProjectId,
  ThreadId,
  type TerminalProjectSessionSnapshot,
} from "@synara/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ServerConfig } from "../../config.ts";
import { ProjectWorkspaceStore } from "../../projectWorkspace/Services/ProjectWorkspaceStore.ts";
import { ProjectWorkspaceStoreLive } from "../../projectWorkspace/Layers/ProjectWorkspaceStore.ts";
import {
  TerminalError,
  TerminalManager,
  type TerminalManagerShape,
  type TerminalProjectSettlementResult,
} from "../../terminal/Services/Manager.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fake terminal runtime: records which Project terminal sessions exist and
 * answers settlement with scripted outcomes. Thread-scoped methods fail loudly
 * if called — this suite never exercises them, and an accidental call would
 * itself be a sequencing bug.
 */
interface FakeTerminalState {
  readonly sessionsByProject: Map<string, TerminalProjectSessionSnapshot[]>;
  readonly settlementOutcomes: Map<string, TerminalProjectSettlementResult["outcome"][]>;
  readonly listCalls: string[];
  readonly settleCalls: string[];
  /** Fence state observed at each settleProjectTerminals call (WP4). Optional
   * so state literals can omit it; `createSystem` normalizes it in place. */
  fencesObservedAtSettle?: Array<string | null>;
  /** Fence state observed at each listProjectTerminals call (WP4). Optional so
   * state literals can omit it; `createSystem` normalizes it in place. */
  fencesObservedAtList?: Array<string | null>;
  /**
   * In-memory admission fence mirroring the runtime's fence semantics:
   * absent = unfenced, "deleting" = settlement in flight, "deleted" =
   * `project.deleted` committed (retained forever). Optional so state
   * literals can omit it; `createSystem` normalizes it in place.
   */
  fences?: Map<string, "deleting" | "deleted">;
}

const makeFakeTerminalManagerLayer = (state: FakeTerminalState) => {
  // Normalized in `createSystem`; snapshot once so all methods share one map
  // (and one pair of observation arrays), exactly like the fence map above.
  const fences = state.fences ?? new Map<string, "deleting" | "deleted">();
  state.fences = fences;
  const fencesObservedAtList = (state.fencesObservedAtList ??= []);
  const fencesObservedAtSettle = (state.fencesObservedAtSettle ??= []);
  return Layer.succeed(
    TerminalManager,
    {
      open: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      write: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      ackOutput: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      resize: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      clear: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      restart: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      close: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      closeSessionsOpenedAtOrBefore: () =>
        Effect.fail(new TerminalError({ message: "not used in this suite" })),
      openProject: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      writeProject: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      ackOutputProject: () =>
        Effect.fail(new TerminalError({ message: "not used in this suite" })),
      resizeProject: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      clearProject: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      restartProject: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      closeProject: () => Effect.fail(new TerminalError({ message: "not used in this suite" })),
      listProjectTerminals: ({ projectId }) =>
        Effect.sync(() => {
          state.listCalls.push(projectId);
          fencesObservedAtList.push(fences.get(projectId) ?? null);
          return state.sessionsByProject.get(projectId) ?? [];
        }),
      settleProjectTerminals: ({ projectId }) =>
        Effect.sync(() => {
          state.settleCalls.push(projectId);
          fencesObservedAtSettle.push(fences.get(projectId) ?? null);
          const sessions = state.sessionsByProject.get(projectId) ?? [];
          state.sessionsByProject.set(projectId, []);
          const outcomes =
            state.settlementOutcomes.get(projectId) ??
            sessions.map(() => "settled" as const);
          return sessions.map((session, index) => {
            const outcome = outcomes[index] ?? "settled";
            return {
              projectId,
              terminalId: session.terminalId,
              outcome,
              detail:
                outcome === "settled"
                  ? null
                  : outcome === "uncertain"
                    ? "stop signals were sent but no process exit was observed within the proof window"
                    : "injected settlement failure",
            } satisfies TerminalProjectSettlementResult;
          });
        }),
      beginProjectDeletionFence: ({ projectId }) =>
        Effect.sync(() => {
          if (!fences.has(projectId)) {
            fences.set(projectId, "deleting");
          }
        }),
      commitProjectDeletionFence: ({ projectId }) =>
        Effect.sync(() => {
          fences.set(projectId, "deleted");
        }),
      releaseProjectDeletionFence: ({ projectId }) =>
        Effect.sync(() => {
          if (fences.get(projectId) === "deleting") {
            fences.delete(projectId);
          }
        }),
      projectDeletionFenceState: ({ projectId }) =>
        Effect.sync(() => fences.get(projectId) ?? null),
      subscribe: () => Effect.sync(() => () => undefined),
      subscribeProject: () => Effect.sync(() => () => undefined),
      dispose: Effect.void,
    } satisfies TerminalManagerShape,
  );
};

const TestServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-project-deletion-settlement-test-",
});

async function createSystem(state: FakeTerminalState) {
  // Normalize the fence map in place so the fake layer and test assertions
  // always observe a single shared map even when the literal omitted it.
  state.fences ??= new Map();
  state.fencesObservedAtSettle ??= [];
  state.fencesObservedAtList ??= [];
  const layer = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(ProjectWorkspaceStoreLive),
      Layer.provide(makeFakeTerminalManagerLayer(state)),
      Layer.provide(SqlitePersistenceMemory),
    ),
    // Expose the SAME memoized SQLite persistence (engine + store + raw SQL
    // assertions share one in-memory database).
    ProjectWorkspaceStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ).pipe(
    Layer.provideMerge(TestServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const store = await runtime.runPromise(Effect.service(ProjectWorkspaceStore));
  /** Raw SQL against the same in-memory SQLite the engine commits to. */
  const sql = <A>(statement: Effect.Effect<A, unknown>) => runtime.runPromise(statement);
  return {
    engine,
    store,
    sql,
    // `run` executes inside the ManagedRuntime, so effects may require any
    // service it provides (e.g. `SqlClient.SqlClient` for journal assertions).
    run: runtime.runPromise.bind(runtime) as <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Promise<A>,
    dispose: () => runtime.dispose(),
  };
}

function snapshotFor(projectId: string, terminalId: string): TerminalProjectSessionSnapshot {
  return {
    projectId: ProjectId.makeUnsafe(projectId),
    terminalId,
    cwd: process.cwd(),
    status: "running",
    pid: 4242,
    history: "",
    exitCode: null,
    exitSignal: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Count committed `project.deleted` events directly in the journal. */
async function countProjectDeletedEvents(
  system: Awaited<ReturnType<typeof createSystem>>,
): Promise<number> {
  return system.run(
    Effect.gen(function* () {
      const client = yield* Effect.service(SqlClient.SqlClient);
      const rows = yield* client<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'project.deleted'
      `;
      return rows[0]?.count ?? 0;
    }),
  );
}

/** Seed one Project (no threads, so `project.delete` passes its invariants). */
async function createProject(system: Awaited<ReturnType<typeof createSystem>>, projectId: string) {
  await system.run(
    system.engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-create-${projectId}`),
      projectId: ProjectId.makeUnsafe(projectId),
      title: "Deletion settlement project",
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      createdAt: new Date().toISOString(),
    }),
  );
}

describe("project.delete terminal settlement sequencing", () => {
  it("settles Project terminals BEFORE committing and deletes the workspace in the same transaction", async () => {
    const state: FakeTerminalState = {
      sessionsByProject: new Map([["project-ok", [snapshotFor("project-ok", "default")]]]),
      settlementOutcomes: new Map(),
      listCalls: [],
      settleCalls: [],
    };
    const system = await createSystem(state);
    try {
      await createProject(system, "project-ok");
      // Publish a workspace for the Project so the delete has something to remove.
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("project-ok"),
          slices: completeSlicesFor(ProjectId.makeUnsafe("project-ok")),
          publishedAt: new Date().toISOString(),
          provenance: null,
        }),
      );

      const result = await system.run(
        system.engine.dispatch({
          type: "project.delete",
          commandId: CommandId.makeUnsafe("cmd-delete-ok"),
          projectId: ProjectId.makeUnsafe("project-ok"),
        }),
      );
      expect(result.sequence).toBeGreaterThan(0);

      // Settlement happened (list preflight + settle) before the commit.
      expect(state.listCalls).toContain("project-ok");
      expect(state.settleCalls).toEqual(["project-ok"]);

      // ADMISSION FENCE (WP4): the `deleting` fence was raised BEFORE the
      // settlement sequence ran (both preflight and settle observed it), the
      // successful commit promoted it to the retained `deleted` state, and
      // it is never released afterwards.
      expect(state.fencesObservedAtList).toEqual(["deleting"]);
      expect(state.fencesObservedAtSettle).toEqual(["deleting"]);
      expect(state.fences?.get("project-ok")).toBe("deleted");

      // The deletion committed AND the workspace state is gone.
      const read = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("project-ok") }),
      );
      expect(read).toMatchObject({ kind: "unpublished", reason: "marker-absent" });
      const deleted = await countProjectDeletedEvents(system);
      expect(deleted).toBe(1);
    } finally {
      await system.dispose();
    }
  });

  it("rejects with a typed error when settlement is unproven: no event, workspace retained", async () => {
    const state: FakeTerminalState = {
      sessionsByProject: new Map([
        ["project-uncertain", [snapshotFor("project-uncertain", "dev")]],
      ]),
      settlementOutcomes: new Map([["project-uncertain", ["uncertain"]]]),
      listCalls: [],
      settleCalls: [],
    };
    const system = await createSystem(state);
    try {
      await createProject(system, "project-uncertain");
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("project-uncertain"),
          slices: completeSlicesFor(ProjectId.makeUnsafe("project-uncertain")),
          publishedAt: new Date().toISOString(),
          provenance: null,
        }),
      );

      await expect(
        system.run(
          system.engine.dispatch({
            type: "project.delete",
            commandId: CommandId.makeUnsafe("cmd-delete-uncertain"),
            projectId: ProjectId.makeUnsafe("project-uncertain"),
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "OrchestrationCommandInvariantError",
        detail: expect.stringContaining("uncertain"),
      });

      // No project.deleted event was committed.
      const deleted = await countProjectDeletedEvents(system);
      expect(deleted).toBe(0);

      // ADMISSION FENCE (WP4): the `deleting` fence was up while the deletion
      // was deciding, and the typed unproven rejection RELEASED it — the
      // Project's terminals stay usable for the truthful retry.
      expect(state.fencesObservedAtList).toEqual(["deleting"]);
      expect(state.fencesObservedAtSettle).toEqual(["deleting"]);
      expect(state.fences?.get("project-uncertain")).toBeUndefined();
      // The workspace state is retained for the truthful retry.
      const read = await system.run(
        system.store.readProjectWorkspace({
          projectId: ProjectId.makeUnsafe("project-uncertain"),
        }),
      );
      expect(read.kind).toBe("published-current");
    } finally {
      await system.dispose();
    }
  });

  it("rejects when settlement itself fails (failed outcome)", async () => {
    const state: FakeTerminalState = {
      sessionsByProject: new Map([["project-failed", [snapshotFor("project-failed", "default")]]]),
      settlementOutcomes: new Map([["project-failed", ["failed"]]]),
      listCalls: [],
      settleCalls: [],
    };
    const system = await createSystem(state);
    try {
      await createProject(system, "project-failed");
      await expect(
        system.run(
          system.engine.dispatch({
            type: "project.delete",
            commandId: CommandId.makeUnsafe("cmd-delete-failed"),
            projectId: ProjectId.makeUnsafe("project-failed"),
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "OrchestrationCommandInvariantError",
        detail: expect.stringContaining("failed"),
      });
      const deleted = await countProjectDeletedEvents(system);
      expect(deleted).toBe(0);
    } finally {
      await system.dispose();
    }
  });

  it("rolls back BOTH the deletion event and the workspace delete when the transaction fails", async () => {
    const state: FakeTerminalState = {
      sessionsByProject: new Map(),
      settlementOutcomes: new Map(),
      listCalls: [],
      settleCalls: [],
    };
    const system = await createSystem(state);
    try {
      await createProject(system, "project-rollback");
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("project-rollback"),
          slices: completeSlicesFor(ProjectId.makeUnsafe("project-rollback")),
          publishedAt: new Date().toISOString(),
          provenance: null,
        }),
      );

      // Corrupt the receipt table so the transaction fails AFTER the event
      // append + workspace delete statements ran inside it. The table stays
      // readable so the PRE-transaction receipt lookup still succeeds; the
      // trigger fires exactly at the receipt INSERT inside the transaction,
      // where the rollback + fence release must be proven.
      await system.run(
        Effect.gen(function* () {
          const client = yield* Effect.service(SqlClient.SqlClient);
          yield* client`CREATE TRIGGER inject_receipt_failure
            BEFORE INSERT ON orchestration_command_receipts
            BEGIN
              SELECT RAISE(ABORT, 'injected transaction failure');
            END`;
        }),
      );

      await expect(
        system.run(
          system.engine.dispatch({
            type: "project.delete",
            commandId: CommandId.makeUnsafe("cmd-delete-rollback"),
            projectId: ProjectId.makeUnsafe("project-rollback"),
          }),
        ),
      ).rejects.toThrow();

      const deleted = await countProjectDeletedEvents(system);
      expect(deleted).toBe(0);

      // ADMISSION FENCE (WP4): the rollback released the `deleting` fence —
      // the transaction failed after the fence was raised (settlement ran
      // with it up), yet nothing committed, so terminals stay usable.
      expect(state.fencesObservedAtSettle).toEqual(["deleting"]);
      expect(state.fences?.get("project-rollback")).toBeUndefined();
      const read = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("project-rollback") }),
      );
      expect(read.kind).toBe("published-current");
    } finally {
      await system.dispose();
    }
  });

  it("retries idempotently: a second deletion after an unproven first attempt succeeds once proven", async () => {
    const state: FakeTerminalState = {
      sessionsByProject: new Map([["project-retry", [snapshotFor("project-retry", "default")]]]),
      settlementOutcomes: new Map([["project-retry", ["uncertain"]]]),
      listCalls: [],
      settleCalls: [],
    };
    const system = await createSystem(state);
    try {
      await createProject(system, "project-retry");
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("project-retry"),
          slices: completeSlicesFor(ProjectId.makeUnsafe("project-retry")),
          publishedAt: new Date().toISOString(),
          provenance: null,
        }),
      );

      await expect(
        system.run(
          system.engine.dispatch({
            type: "project.delete",
            commandId: CommandId.makeUnsafe("cmd-delete-retry-1"),
            projectId: ProjectId.makeUnsafe("project-retry"),
          }),
        ),
      ).rejects.toMatchObject({ _tag: "OrchestrationCommandInvariantError" });

      // The unproven terminal is later proven stopped; a NEW command id
      // (and fresh terminal state) settles and commits.
      state.sessionsByProject.set("project-retry", [snapshotFor("project-retry", "default")]);
      state.settlementOutcomes.set("project-retry", ["settled"]);
      await system.run(
        system.engine.dispatch({
          type: "project.delete",
          commandId: CommandId.makeUnsafe("cmd-delete-retry-2"),
          projectId: ProjectId.makeUnsafe("project-retry"),
        }),
      );

      const read = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("project-retry") }),
      );
      expect(read).toMatchObject({ kind: "unpublished", reason: "marker-absent" });
      const deleted = await countProjectDeletedEvents(system);
      expect(deleted).toBe(1);
    } finally {
      await system.dispose();
    }
  });

  it("thread delete/archive paths never settle Project-owned terminals", async () => {
    const state: FakeTerminalState = {
      sessionsByProject: new Map([["project-preserve", [snapshotFor("project-preserve", "t1")]]]),
      settlementOutcomes: new Map(),
      listCalls: [],
      settleCalls: [],
    };
    const system = await createSystem(state);
    try {
      await createProject(system, "project-preserve");
      // Archive and delete a thread of the Project (the reactor cleanup paths
      // call only the thread-scoped close operations in production).
      const threadId = ThreadId.makeUnsafe("thread-preserve");
      await system.run(
        system.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-create-thread-preserve"),
          threadId,
          projectId: ProjectId.makeUnsafe("project-preserve"),
          title: "Thread",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          interactionMode: "default",
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: new Date().toISOString(),
        }),
      );
      await system.run(
        system.engine.dispatch({
          type: "thread.archive",
          commandId: CommandId.makeUnsafe("cmd-archive-thread-preserve"),
          threadId,
        }),
      );
      await system.run(
        system.engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.makeUnsafe("cmd-delete-thread-preserve"),
          threadId,
        }),
      );

      // Project terminal state untouched: no settlement ever ran.
      expect(state.settleCalls).toEqual([]);
      expect(state.sessionsByProject.get("project-preserve")).toHaveLength(1);
    } finally {
      await system.dispose();
    }
  });
});

/** A complete valid five-slice payload (mirrors the WP3 store fixture). */
function completeSlicesFor(projectId: ProjectId) {
  return [
    {
      slice: "right-dock" as const,
      projectId,
      open: true,
      preferredWidthPx: null,
      panes: [],
      activePaneId: null,
    },
    {
      slice: "terminal-presentation" as const,
      projectId,
      presentationMode: "workspace" as const,
      workspaceTab: "terminal" as const,
      workspaceLayout: "both" as const,
      terminalHeightPx: 320,
      terminalIds: ["default"],
      activeTerminalId: "default",
      terminalLabelsById: { default: "Terminal 1" },
    },
    {
      slice: "browser" as const,
      projectId,
      open: true,
      activeTabId: null,
      tabs: [],
    },
    { slice: "browser-annotations" as const, projectId, markers: [] },
    { slice: "device" as const, projectId, attachedDeviceUdid: null, attachPhase: null },
  ];
}
