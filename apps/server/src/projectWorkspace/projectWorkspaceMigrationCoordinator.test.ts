// FILE: projectWorkspaceMigrationCoordinator.test.ts
// Purpose: Proves the per-Project staged-publication coordinator: durable
//          snapshot + shared-policy consumption (eligibility, newest
//          updatedAt, ThreadId tie-break), current-published precedence,
//          injected failure before publication leaves nothing published and
//          retry converges, per-Project independence, and conversation
//          retention.
// Layer: Server coordinator test (memory SQLite, migrations at boot).

import type { LegacyProjectWorkspaceThreadSlicesInput } from "@synara/shared/projectWorkspaceMigration";
import { ProjectId, ThreadId } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectWorkspaceStoreLive } from "./Layers/ProjectWorkspaceStore.ts";
import { ProjectWorkspaceStore } from "./Services/ProjectWorkspaceStore.ts";
import {
  makeProjectWorkspaceMigrationCoordinatorLayer,
  ProjectWorkspaceMigrationCoordinator,
  type ProjectWorkspacePublicationHooks,
} from "./projectWorkspaceMigrationCoordinator.ts";

// Every test seeds rows into one shared memory database, so each test uses
// its own Project ids to stay independent (same convention as the store test).
const projectA = ProjectId.makeUnsafe("proj-a");
const projectB = ProjectId.makeUnsafe("proj-b");
const projectEligible = ProjectId.makeUnsafe("proj-eligible");
const projectDefaults = ProjectId.makeUnsafe("proj-defaults");
const projectRetry = ProjectId.makeUnsafe("proj-retry");
const projectKeep = ProjectId.makeUnsafe("proj-keep");
const projectPrecedence = ProjectId.makeUnsafe("proj-precedence");
const projectIndependentA = ProjectId.makeUnsafe("proj-indep-a");
const projectIndependentB = ProjectId.makeUnsafe("proj-indep-b");
const projectDeleted = ProjectId.makeUnsafe("proj-deleted");
const projectAfterDeleted = ProjectId.makeUnsafe("proj-after-deleted");
const projectIsoSnapshotA = ProjectId.makeUnsafe("proj-iso-snap-a");
const projectIsoSnapshotB = ProjectId.makeUnsafe("proj-iso-snap-b");

const clock = { now: () => "2026-08-24T00:00:00.000Z" };

const coordinatorLayer = (hooks?: ProjectWorkspacePublicationHooks) =>
  makeProjectWorkspaceMigrationCoordinatorLayer({ clock, hooks }).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  );

const layer = it.layer(coordinatorLayer());

const seedProject = (projectId: ProjectId, extra: { readonly deletedAt?: string | null } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_projects (
        project_id, kind, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
      ) VALUES (
        ${projectId}, 'project', 'Project', '/tmp/p', '[]',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z',
        ${extra.deletedAt ?? null}
      )
    `;
  });

const seedThread = (
  projectId: ProjectId,
  threadId: string,
  updatedAt: string,
  extra: { readonly deletedAt?: string | null; readonly archivedAt?: string | null } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, created_at, updated_at,
        runtime_mode, interaction_mode, env_mode, archived_at, deleted_at
      ) VALUES (
        ${threadId}, ${projectId}, 'Thread', ${updatedAt}, ${updatedAt},
        'full-access', 'default', 'local',
        ${extra.archivedAt ?? null}, ${extra.deletedAt ?? null}
      )
    `;
  });

function legacyDock(threadId: string, open: boolean): LegacyProjectWorkspaceThreadSlicesInput {
  return {
    rightDock: {
      threadId,
      open,
      panes: [
        {
          id: "pane-1",
          kind: "terminal",
          threadId: null,
          diffTurnId: null,
          diffFilePath: null,
          filePath: null,
          pullRequestProjectId: null,
          pullRequestRepository: null,
          pullRequestNumber: null,
          pullRequestInitialTab: null,
        },
      ],
      activePaneId: "pane-1",
    },
  };
}

const slicesFor = (threadIds: ReadonlyArray<string>) =>
  new Map<ThreadId, LegacyProjectWorkspaceThreadSlicesInput>(
    threadIds.map((id) => [ThreadId.makeUnsafe(id), legacyDock(id, true)] as const),
  );

/** Runs `body` against a fresh coordinator built with the given hooks. */
const withCoordinator = <A>(
  hooks: ProjectWorkspacePublicationHooks | undefined,
  body: (coordinator: typeof ProjectWorkspaceMigrationCoordinator.Service) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
    return yield* body(coordinator);
  }).pipe(Effect.provide(coordinatorLayer(hooks)), Effect.scoped);

layer("projectWorkspaceMigrationCoordinator", (it) => {
  it.effect(
    "consumes the shared policy: newest updatedAt wins; ties break by ascending ThreadId",
    () =>
      Effect.gen(function* () {
        yield* seedProject(projectEligible);
        yield* seedThread(projectEligible, "t-old", "2026-01-01T00:00:00.000Z");
        yield* seedThread(projectEligible, "t-b", "2026-02-01T00:00:00.000Z");
        yield* seedThread(projectEligible, "t-a", "2026-02-01T00:00:00.000Z"); // tie with t-b

        const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
        const results = yield* coordinator.migrateAllProjects({
          legacySlicesByThreadId: slicesFor(["t-old", "t-b", "t-a"]),
        });

        assert.strictEqual(results.length, 1);
        assert.deepStrictEqual(results[0]!.outcome, {
          kind: "published",
          winnerThreadId: "t-a",
        });

        const store = yield* ProjectWorkspaceStore;
        const read = yield* store.readProjectWorkspace({ projectId: projectEligible });
        assert.strictEqual(read.kind, "published-current");
        if (read.kind !== "published-current") throw new Error("expected published-current");
        assert.strictEqual(read.slices.length, 5);
        assert.strictEqual(read.marker.provenance?.sourceThreadId, "t-a");
      }),
  );

  it.effect("skips deleted Threads; archived Threads remain eligible", () =>
    Effect.gen(function* () {
      yield* seedProject(projectA);
      yield* seedThread(projectA, "t-del-a", "2026-03-01T00:00:00.000Z", {
        deletedAt: "2026-03-02T00:00:00.000Z",
      });
      yield* seedThread(projectA, "t-arc-a", "2026-02-01T00:00:00.000Z", {
        archivedAt: "2026-02-02T00:00:00.000Z",
      });

      const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
      const results = yield* coordinator.migrateAllProjects({
        legacySlicesByThreadId: slicesFor(["t-del-a", "t-arc-a"]),
        projectIds: [projectA],
      });

      assert.deepStrictEqual(results[0]!.outcome, {
        kind: "published",
        winnerThreadId: "t-arc-a",
      });
    }),
  );

  it.effect("skips deleted Projects entirely: no outcome row, nothing published", () =>
    Effect.gen(function* () {
      // Decision 0002 B.1: candidates are evaluated per NON-DELETED Project.
      // A soft-deleted Project must never even enter the migration loop.
      yield* seedProject(projectDeleted, { deletedAt: "2026-08-01T00:00:00.000Z" });
      yield* seedThread(projectDeleted, "t-deleted-project", "2026-02-01T00:00:00.000Z");

      const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
      const results = yield* coordinator.migrateAllProjects({
        legacySlicesByThreadId: slicesFor(["t-deleted-project"]),
        projectIds: [projectDeleted],
      });

      // The deleted Project is filtered out of the snapshot itself.
      assert.deepStrictEqual(results, []);

      const store = yield* ProjectWorkspaceStore;
      const read = yield* store.readProjectWorkspace({ projectId: projectDeleted });
      assert.deepStrictEqual(read, { kind: "unpublished", reason: "marker-absent" });

      const sql = yield* SqlClient.SqlClient;
      const sliceCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_slices WHERE project_id = ${projectDeleted}
      `;
      assert.strictEqual(sliceCount[0]?.count, 0);
    }),
  );

  it.effect(
    "isolates a per-Project Thread-snapshot failure: the run survives and every Project reports failed",
    () =>
      Effect.gen(function* () {
        // Force EVERY per-Project Thread-snapshot read to fail and prove the
        // isolation contract: no orDie defect kills the run; each Project
        // gets a `failed` row with a diagnostic reason, and nothing durable
        // is written. The table is renamed for the duration of this test and
        // restored on exit so the shared memory database stays usable for
        // later tests in this file.
        const sql = yield* SqlClient.SqlClient;
        yield* seedProject(projectIsoSnapshotA);
        yield* seedProject(projectIsoSnapshotB);
        yield* seedThread(projectIsoSnapshotA, "t-iso-a", "2026-02-01T00:00:00.000Z");
        yield* seedThread(projectIsoSnapshotB, "t-iso-b", "2026-02-01T00:00:00.000Z");
        yield* sql`ALTER TABLE projection_threads RENAME TO projection_threads_iso_fault`;

        const results = yield* Effect.gen(function* () {
          const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
          return yield* coordinator.migrateAllProjects({
            legacySlicesByThreadId: slicesFor(["t-iso-a", "t-iso-b"]),
            projectIds: [projectIsoSnapshotA, projectIsoSnapshotB],
          });
        }).pipe(
          Effect.onExit(() =>
            sql`ALTER TABLE projection_threads_iso_fault RENAME TO projection_threads`,
          ),
        );

        assert.strictEqual(results.length, 2);
        for (const row of results) {
          assert.strictEqual(row.outcome.kind, "failed");
          if (row.outcome.kind !== "failed") throw new Error("expected failed");
          assert.include(row.outcome.reason, "snapshotThreads");
        }
      }).pipe(Effect.provide(coordinatorLayer()), Effect.scoped),
  );

  it.effect("publishes empty defaults with null provenance when no Thread is eligible", () =>
    Effect.gen(function* () {
      yield* seedProject(projectDefaults);
      yield* seedThread(projectDefaults, "t-clean", "2026-02-01T00:00:00.000Z");

      const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
      const results = yield* coordinator.migrateAllProjects({
        legacySlicesByThreadId: new Map(),
        projectIds: [projectDefaults],
      });

      assert.deepStrictEqual(results[0]!.outcome, { kind: "published", winnerThreadId: null });

      const store = yield* ProjectWorkspaceStore;
      const read = yield* store.readProjectWorkspace({ projectId: projectDefaults });
      assert.strictEqual(read.kind, "published-current");
      if (read.kind !== "published-current") throw new Error("expected published-current");
      assert.strictEqual(read.marker.provenance, null);
    }),
  );

  it.effect("keeps a valid current publication instead of overwriting it", () =>
    Effect.gen(function* () {
      yield* seedProject(projectPrecedence);
      yield* seedThread(projectPrecedence, "t-first", "2026-02-01T00:00:00.000Z");

      const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
      yield* coordinator.migrateAllProjects({
        legacySlicesByThreadId: slicesFor(["t-first"]),
        projectIds: [projectPrecedence],
      });

      const store = yield* ProjectWorkspaceStore;
      const first = yield* store.readProjectWorkspace({ projectId: projectPrecedence });
      assert.strictEqual(first.kind, "published-current");

      const results = yield* coordinator.migrateAllProjects({
        legacySlicesByThreadId: slicesFor(["t-first"]),
        projectIds: [projectPrecedence],
      });
      assert.deepStrictEqual(results[0]!.outcome, { kind: "kept-published" });

      const second = yield* store.readProjectWorkspace({ projectId: projectPrecedence });
      assert.deepStrictEqual(second, first);
    }),
  );

  it.effect(
    "injected failure before publication leaves nothing published; retry converges",
    () =>
      withCoordinator(
        {
          beforePublication: (() => {
            let attempts = 0;
            return () =>
              Effect.suspend(() => {
                attempts += 1;
                return attempts === 1
                  ? Effect.fail(new Error("injected mid-write failure"))
                  : Effect.void;
              });
          })(),
        },
        (coordinator) =>
          Effect.gen(function* () {
            yield* seedProject(projectRetry);
            yield* seedThread(projectRetry, "t-retry", "2026-02-01T00:00:00.000Z");

            const first = yield* coordinator.migrateAllProjects({
              legacySlicesByThreadId: slicesFor(["t-retry"]),
              projectIds: [projectRetry],
            });
            assert.strictEqual(first.length, 1);
            assert.deepStrictEqual(first[0]!.outcome, {
              kind: "failed",
              reason: "injected mid-write failure",
            });

            // Failure before the marker leaves NOTHING durable: no slices,
            // no marker, and the read stays non-canonical.
            const sql = yield* SqlClient.SqlClient;
            const sliceCount = yield* sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count FROM project_workspace_slices WHERE project_id = ${projectRetry}
            `;
            assert.strictEqual(sliceCount[0]?.count, 0);
            const markerCount = yield* sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count
              FROM project_workspace_publications WHERE project_id = ${projectRetry}
            `;
            assert.strictEqual(markerCount[0]?.count, 0);

            const store = yield* ProjectWorkspaceStore;
            const unpublished = yield* store.readProjectWorkspace({ projectId: projectRetry });
            assert.deepStrictEqual(unpublished, { kind: "unpublished", reason: "marker-absent" });

            // Retry converges to the same deterministic target.
            const second = yield* coordinator.migrateAllProjects({
              legacySlicesByThreadId: slicesFor(["t-retry"]),
              projectIds: [projectRetry],
            });
            assert.strictEqual(second[0]!.outcome.kind, "published");

            const read = yield* store.readProjectWorkspace({ projectId: projectRetry });
            assert.strictEqual(read.kind, "published-current");
            if (read.kind !== "published-current") throw new Error("expected published-current");
            assert.strictEqual(read.marker.provenance?.sourceThreadId, "t-retry");
          }),
      ),
  );

  it.effect(
    "processes Projects independently: one Project's failure never blocks another",
    () =>
      withCoordinator(
        {
          // Fail only for the second Project; the first must still publish.
          beforePublication: (snapshot) =>
            snapshot.projectId === projectIndependentB
              ? Effect.fail(new Error("project-b failure"))
              : Effect.void,
        },
        (coordinator) =>
          Effect.gen(function* () {
            yield* seedProject(projectIndependentA);
            yield* seedProject(projectIndependentB);
            yield* seedThread(projectIndependentA, "t-indep-a", "2026-02-01T00:00:00.000Z");
            yield* seedThread(projectIndependentB, "t-indep-b", "2026-02-01T00:00:00.000Z");

            const results = yield* coordinator.migrateAllProjects({
              legacySlicesByThreadId: new Map([
                ...slicesFor(["t-indep-a"]),
                ...slicesFor(["t-indep-b"]),
              ]),
              projectIds: [projectIndependentA, projectIndependentB],
            });

            const byProject = new Map(results.map((row) => [row.projectId, row.outcome]));
            assert.strictEqual(byProject.get(projectIndependentA)?.kind, "published");
            assert.deepStrictEqual(byProject.get(projectIndependentB), {
              kind: "failed",
              reason: "project-b failure",
            });

            const store = yield* ProjectWorkspaceStore;
            const readA = yield* store.readProjectWorkspace({ projectId: projectIndependentA });
            assert.strictEqual(readA.kind, "published-current");
            const readB = yield* store.readProjectWorkspace({ projectId: projectIndependentB });
            assert.strictEqual(readB.kind, "unpublished");
          }),
      ),
  );

  it.effect("keeps every conversation row unchanged through migration", () =>
    Effect.gen(function* () {
      yield* seedProject(projectKeep);
      yield* seedThread(projectKeep, "t-keep", "2026-02-01T00:00:00.000Z");
      const sql = yield* SqlClient.SqlClient;
      const beforeThreads = yield* sql`
        SELECT * FROM projection_threads WHERE thread_id = 't-keep'
      `;
      const beforeProjects = yield* sql`
        SELECT * FROM projection_projects WHERE project_id = ${projectKeep}
      `;

      const coordinator = yield* ProjectWorkspaceMigrationCoordinator;
      yield* coordinator.migrateAllProjects({
        legacySlicesByThreadId: slicesFor(["t-keep"]),
        projectIds: [projectKeep],
      });

      const afterThreads = yield* sql`
        SELECT * FROM projection_threads WHERE thread_id = 't-keep'
      `;
      const afterProjects = yield* sql`
        SELECT * FROM projection_projects WHERE project_id = ${projectKeep}
      `;
      assert.deepStrictEqual(afterThreads, beforeThreads);
      assert.deepStrictEqual(afterProjects, beforeProjects);
    }),
  );
});
