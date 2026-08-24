// FILE: ProjectWorkspaceStore.test.ts
// Purpose: Proves the durable Project-owned workspace store: marker-gated
//          reads, all-five/marker-last transactionality, failure-before-marker
//          leaves nothing published, retry convergence, idempotency,
//          current-published precedence inputs, per-Project isolation, and
//          conversation/v1 retention (projection rows untouched).
// Layer: SQLite persistence test

import { ProjectId, ThreadId } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ProjectWorkspaceStagingInvalidError,
  ProjectWorkspaceStore,
} from "../Services/ProjectWorkspaceStore.ts";
import {
  makeProjectWorkspaceStoreLayer,
  ProjectWorkspaceStoreLive,
} from "./ProjectWorkspaceStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";

const layer = it.layer(ProjectWorkspaceStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const projectA = ProjectId.makeUnsafe("project-a");
const projectB = ProjectId.makeUnsafe("project-b");
const projectGate = ProjectId.makeUnsafe("project-gate");
const projectStage = ProjectId.makeUnsafe("project-stage");
const projectRetry = ProjectId.makeUnsafe("project-retry");
const projectMixed = ProjectId.makeUnsafe("project-mixed");
const projectTorn = ProjectId.makeUnsafe("project-torn");
const projectKeep = ProjectId.makeUnsafe("project-keep");
const projectMidTxn = ProjectId.makeUnsafe("project-mid-txn");
const projectCorrupt = ProjectId.makeUnsafe("project-corrupt");

const PUBLISHED_AT = "2026-08-24T00:00:00.000Z";

/** A complete, valid five-slice payload for one Project. */
function completeSlices(projectId: ProjectId, overrides: { readonly dockOpen?: boolean } = {}) {
  return [
    {
      slice: "right-dock" as const,
      projectId,
      open: overrides.dockOpen ?? true,
      preferredWidthPx: null,
      panes: [
        {
          id: "pane-a",
          kind: "browser" as const,
          threadId: null,
          diffTurnId: null,
          diffFilePath: null,
          filePath: null,
          pullRequestProjectId: null,
          pullRequestRepository: null,
          pullRequestNumber: null,
          pullRequestInitialTab: null,
          restorationDiagnostic: null,
        },
      ],
      activePaneId: "pane-a",
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
      activeTabId: "tab-1",
      tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
    },
    { slice: "browser-annotations" as const, projectId, markers: [] },
    { slice: "device" as const, projectId, attachedDeviceUdid: null, attachPhase: null },
  ];
}

const seedProjectAndThread = (projectId: ProjectId, threadId: string, updatedAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_projects (
        project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
      ) VALUES (
        ${projectId}, 'project', 'Project', '/tmp/project', '[]',
        ${updatedAt}, ${updatedAt}
      )
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, created_at, updated_at,
        runtime_mode, interaction_mode, env_mode
      ) VALUES (
        ${threadId}, ${projectId}, 'Thread', ${updatedAt}, ${updatedAt},
        'full-access', 'default', 'local'
      )
    `;
  });

layer("ProjectWorkspaceStore", (it) => {
  it.effect("reads nothing canonical before any publication marker exists", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      const result = yield* store.readProjectWorkspace({ projectId: projectGate });
      assert.deepStrictEqual(result, { kind: "unpublished", reason: "marker-absent" });
    }),
  );

  it.effect("stages all five slices and the marker last in one transaction", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* ProjectWorkspaceStore;

      yield* store.stageAndPublish({
        projectId: projectStage,
        slices: completeSlices(projectStage),
        publishedAt: PUBLISHED_AT,
        provenance: {
          sourceSchemaVersion: 1,
          sourceThreadId: ThreadId.makeUnsafe("thread-winner"),
        },
      });

      const markerRows = yield* sql<{
        readonly schemaVersion: number;
        readonly sourceThreadId: string | null;
      }>`
        SELECT schema_version AS "schemaVersion", source_thread_id AS "sourceThreadId"
        FROM project_workspace_publications
        WHERE project_id = ${projectStage}
      `;
      assert.deepStrictEqual(markerRows, [{ schemaVersion: 2, sourceThreadId: "thread-winner" }]);

      const kinds = yield* sql<{ readonly sliceKind: string }>`
        SELECT slice_kind AS "sliceKind"
        FROM project_workspace_slices
        WHERE project_id = ${projectStage}
        ORDER BY slice_kind ASC
      `;
      assert.deepStrictEqual(
        kinds.map((row) => row.sliceKind),
        ["browser", "browser-annotations", "device", "right-dock", "terminal-presentation"],
      );

      const read = yield* store.readProjectWorkspace({ projectId: projectStage });
      assert.strictEqual(read.kind, "published-current");
      if (read.kind !== "published-current") throw new Error("expected published-current");
      assert.strictEqual(read.slices.length, 5);
      assert.deepStrictEqual(read.marker.provenance, {
        sourceSchemaVersion: 1,
        sourceThreadId: "thread-winner",
      });
    }),
  );

  it.effect("publishing is idempotent: rerun converges to the same durable payload", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      const slices = completeSlices(projectRetry);

      yield* store.stageAndPublish({
        projectId: projectRetry,
        slices,
        publishedAt: PUBLISHED_AT,
        provenance: null,
      });
      yield* store.stageAndPublish({
        projectId: projectRetry,
        slices,
        publishedAt: "2026-08-24T00:00:05.000Z",
        provenance: null,
      });

      const sql = yield* SqlClient.SqlClient;
      const sliceRows = yield* sql<{ readonly sliceKind: string }>`
        SELECT slice_kind AS "sliceKind" FROM project_workspace_slices WHERE project_id = ${projectRetry}
      `;
      assert.strictEqual(sliceRows.length, 5);
      const markers = yield* sql<{ readonly publishedAt: string }>`
        SELECT published_at AS "publishedAt" FROM project_workspace_publications WHERE project_id = ${projectRetry}
      `;
      assert.strictEqual(markers.length, 1);
      const read = yield* store.readProjectWorkspace({ projectId: projectRetry });
      assert.strictEqual(read.kind, "published-current");
    }),
  );

  it.effect("isolates Projects: another Project's data never reads as canonical here", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      yield* store.stageAndPublish({
        projectId: projectB,
        slices: completeSlices(projectB),
        publishedAt: PUBLISHED_AT,
        provenance: null,
      });

      const readA = yield* store.readProjectWorkspace({ projectId: projectA });
      assert.deepStrictEqual(readA, { kind: "unpublished", reason: "marker-absent" });

      const readB = yield* store.readProjectWorkspace({ projectId: projectB });
      assert.strictEqual(readB.kind, "published-current");
      if (readB.kind !== "published-current") throw new Error("expected published-current");
      for (const slice of readB.slices) {
        assert.strictEqual(slice.projectId, projectB);
      }
    }),
  );

  it.effect("fails closed before writing when the payload is incomplete", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      const fourSlices = completeSlices(projectTorn)
        .slice(0, 4)
        .map((slice) => Object.assign({}, slice, { projectId: projectTorn }));
      const failure = yield* Effect.flip(
        store.stageAndPublish({
          projectId: projectTorn,
          slices: fourSlices,
          publishedAt: PUBLISHED_AT,
          provenance: null,
        }),
      );
      assert.isTrue(failure instanceof ProjectWorkspaceStagingInvalidError);

      const sql = yield* SqlClient.SqlClient;
      const sliceCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_slices WHERE project_id = ${projectTorn}
      `;
      assert.strictEqual(sliceCount[0]?.count, 0);
      const markerCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_publications WHERE project_id = ${projectTorn}
      `;
      assert.strictEqual(markerCount[0]?.count, 0);
    }),
  );

  it.effect("fails closed before writing when a slice belongs to another Project", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      const mixed = completeSlices(projectMixed).map((slice) =>
        slice.slice === "device" ? Object.assign({}, slice, { projectId: projectA }) : slice,
      );
      const failure = yield* Effect.flip(
        store.stageAndPublish({
          projectId: projectMixed,
          slices: mixed,
          publishedAt: PUBLISHED_AT,
          provenance: null,
        }),
      );
      assert.isTrue(failure instanceof ProjectWorkspaceStagingInvalidError);
    }),
  );

  it.effect("does not expose partial reads: staged rows without a marker stay unpublished", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Direct SQL simulates a torn boundary that committed slice rows but
      // never reached the marker insert (e.g. a hypothetical future writer).
      yield* sql`
        INSERT INTO project_workspace_slices (
          project_id, slice_kind, payload_json, schema_version, updated_at
        ) VALUES (
          ${projectTorn}, 'right-dock',
          ${JSON.stringify({
            slice: "right-dock",
            projectId: projectTorn,
            open: true,
            preferredWidthPx: null,
            panes: [],
            activePaneId: null,
          })},
          2, ${PUBLISHED_AT}
        )
      `;
      const store = yield* ProjectWorkspaceStore;
      const read = yield* store.readProjectWorkspace({ projectId: projectTorn });
      assert.deepStrictEqual(read, { kind: "unpublished", reason: "marker-absent" });
    }),
  );

  it.effect("keeps conversation projection rows byte-identical across publication", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedProjectAndThread(projectKeep, "thread-keep", "2026-08-01T00:00:00.000Z");

      const before = yield* sql`
        SELECT * FROM projection_threads WHERE thread_id = 'thread-keep'
      `;

      const store = yield* ProjectWorkspaceStore;
      yield* store.stageAndPublish({
        projectId: projectKeep,
        slices: completeSlices(projectKeep),
        publishedAt: PUBLISHED_AT,
        provenance: {
          sourceSchemaVersion: 1,
          sourceThreadId: ThreadId.makeUnsafe("thread-keep"),
        },
      });

      const after = yield* sql`
        SELECT * FROM projection_threads WHERE thread_id = 'thread-keep'
      `;
      assert.deepStrictEqual(after, before);
    }),
  );

  it.effect(
    "a mid-transaction failure after the slice upserts but before the marker rolls the whole transaction back",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // The store test hook is invoked INSIDE the transaction, after the
        // five slice upserts and before the marker insert. Making it fail
        // exactly once proves (Decision 0002 F.2/F.4) that neither the slices
        // nor the marker can commit from an aborted transaction, and that the
        // Project stays unpublished and retryable.
        let hookCalls = 0;
        const failOnceAfterSlices = makeProjectWorkspaceStoreLayer({
          afterSlicesBeforeMarker: () =>
            ++hookCalls === 1
              ? Effect.fail(
                  new ProjectWorkspaceStagingInvalidError({
                    projectId: projectMidTxn,
                    detail: "injected mid-transaction failure for the rollback proof",
                  }),
                )
              : Effect.void,
        }).pipe(Layer.provideMerge(SqlitePersistenceMemory));

        yield* Effect.gen(function* () {
          const store = yield* ProjectWorkspaceStore;
          const failure = yield* Effect.flip(
            store.stageAndPublish({
              projectId: projectMidTxn,
              slices: completeSlices(projectMidTxn),
              publishedAt: PUBLISHED_AT,
              provenance: null,
            }),
          );
          assert.isTrue(failure instanceof ProjectWorkspaceStagingInvalidError);

          // TRUE mid-transaction rollback: with the sqlite client, the slice
          // rows written earlier INSIDE this same transaction are gone.
          const sliceCount = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM project_workspace_slices WHERE project_id = ${projectMidTxn}
          `;
          assert.strictEqual(sliceCount[0]?.count, 0);
          const markerCount = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM project_workspace_publications WHERE project_id = ${projectMidTxn}
          `;
          assert.strictEqual(markerCount[0]?.count, 0);
        }).pipe(Effect.provide(failOnceAfterSlices), Effect.scoped);

        assert.strictEqual(hookCalls, 1);

        // Retry with the same deterministic target succeeds and converges.
        yield* Effect.gen(function* () {
          const store = yield* ProjectWorkspaceStore;
          yield* store.stageAndPublish({
            projectId: projectMidTxn,
            slices: completeSlices(projectMidTxn),
            publishedAt: "2026-08-24T00:00:05.000Z",
            provenance: null,
          });
          const read = yield* store.readProjectWorkspace({ projectId: projectMidTxn });
          assert.strictEqual(read.kind, "published-current");
        }).pipe(Effect.provide(failOnceAfterSlices), Effect.scoped);

        assert.strictEqual(hookCalls, 2);

        const finalSliceCount = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM project_workspace_slices WHERE project_id = ${projectMidTxn}
        `;
        assert.strictEqual(finalSliceCount[0]?.count, 5);
      }),
  );

  it.effect(
    "a valid marker with a corrupt slice payload reads as typed published-invalid, never canonical",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* ProjectWorkspaceStore;

        // Publish a complete, valid boundary first.
        yield* store.stageAndPublish({
          projectId: projectCorrupt,
          slices: completeSlices(projectCorrupt),
          publishedAt: PUBLISHED_AT,
          provenance: null,
        });

        // Simulate on-disk corruption of ONE slice row's JSON payload while
        // the marker stays valid: the read must return the typed
        // non-canonical `published-invalid` verdict, never partial data and
        // never `published-current`.
        yield* sql`
          UPDATE project_workspace_slices
          SET payload_json = 'not-json-at-all{'
          WHERE project_id = ${projectCorrupt} AND slice_kind = 'browser'
        `;

        const read = yield* store.readProjectWorkspace({ projectId: projectCorrupt });
        assert.strictEqual(read.kind, "published-invalid");
        if (read.kind !== "published-invalid") throw new Error("expected published-invalid");
        assert.include(read.detail, "not valid JSON");
        assert.include(read.detail, "browser");
      }),
  );
});

// ── WP4: transactional-context Project workspace deletion ───────────

layer("ProjectWorkspaceStore.deleteProjectWorkspace", (it) => {
  const projectDeleteSettled = ProjectId.makeUnsafe("project-delete-settled");
  const projectDeleteAbsent = ProjectId.makeUnsafe("project-delete-absent");
  const projectDeleteNeighbor = ProjectId.makeUnsafe("project-delete-neighbor");

  it.effect("deletes every slice and the publication marker for one Project", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* ProjectWorkspaceStore;

      yield* store.stageAndPublish({
        projectId: projectDeleteSettled,
        slices: completeSlices(projectDeleteSettled),
        publishedAt: PUBLISHED_AT,
        provenance: null,
      });
      yield* store.stageAndPublish({
        projectId: projectDeleteNeighbor,
        slices: completeSlices(projectDeleteNeighbor),
        publishedAt: PUBLISHED_AT,
        provenance: null,
      });

      yield* store.deleteProjectWorkspace({ projectId: projectDeleteSettled });

      const sliceCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_slices WHERE project_id = ${projectDeleteSettled}
      `;
      assert.strictEqual(sliceCount[0]?.count, 0);
      const markerCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_publications WHERE project_id = ${projectDeleteSettled}
      `;
      assert.strictEqual(markerCount[0]?.count, 0);
      const read = yield* store.readProjectWorkspace({ projectId: projectDeleteSettled });
      assert.deepStrictEqual(read, { kind: "unpublished", reason: "marker-absent" });
    }),
  );

  it.effect("is idempotent: deleting an absent Project workspace succeeds as a no-op", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      yield* store.deleteProjectWorkspace({ projectId: projectDeleteAbsent });
      yield* store.deleteProjectWorkspace({ projectId: projectDeleteAbsent });
      const read = yield* store.readProjectWorkspace({ projectId: projectDeleteAbsent });
      assert.deepStrictEqual(read, { kind: "unpublished", reason: "marker-absent" });
    }),
  );

  it.effect("never deletes another Project's workspace state", () =>
    Effect.gen(function* () {
      const store = yield* ProjectWorkspaceStore;
      yield* store.stageAndPublish({
        projectId: projectDeleteNeighbor,
        slices: completeSlices(projectDeleteNeighbor),
        publishedAt: PUBLISHED_AT,
        provenance: null,
      });

      yield* store.deleteProjectWorkspace({ projectId: projectDeleteSettled });

      const neighborRead = yield* store.readProjectWorkspace({
        projectId: projectDeleteNeighbor,
      });
      assert.strictEqual(neighborRead.kind, "published-current");
    }),
  );

  it.effect("joins the caller's transaction: a rollback restores the workspace atomically", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* ProjectWorkspaceStore;

      yield* store.stageAndPublish({
        projectId: projectDeleteSettled,
        slices: completeSlices(projectDeleteSettled),
        publishedAt: PUBLISHED_AT,
        provenance: null,
      });

      // Simulate the engine's deletion transaction failing AFTER the workspace
      // delete: the deletes must roll back with the aborted transaction, so the
      // deleted Project's workspace is never orphaned half-deleted.
      const rolledBack = yield* Effect.flip(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* store.deleteProjectWorkspace({ projectId: projectDeleteSettled });
            yield* new ProjectWorkspaceStagingInvalidError({
              projectId: projectDeleteSettled,
              detail: "injected post-delete transaction failure",
            });
          }),
        ),
      );
      assert.isTrue(rolledBack instanceof ProjectWorkspaceStagingInvalidError);

      const read = yield* store.readProjectWorkspace({ projectId: projectDeleteSettled });
      assert.strictEqual(read.kind, "published-current");
    }),
  );
});
