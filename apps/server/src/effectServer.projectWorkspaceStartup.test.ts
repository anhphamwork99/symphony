// FILE: effectServer.projectWorkspaceStartup.test.ts
// Purpose: Proves the production Project-workspace startup pass (WP3 wiring):
//          the exact coordinator call (empty legacy map), nonblocking
//          per-Project diagnostics, idempotent rerun, and the marker-last
//          publication the capability advertisement promises.
// Layer: Server startup wiring test (memory SQLite, migrations at boot).

import { ProjectId } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { ProjectWorkspaceStore } from "./projectWorkspace/Services/ProjectWorkspaceStore.ts";
import {
  makeProjectWorkspaceMigrationCoordinatorLayer,
  ProjectWorkspaceMigrationCoordinator,
} from "./projectWorkspace/projectWorkspaceMigrationCoordinator.ts";
import { runProjectWorkspaceMigrationOnStartup } from "./effectServer.ts";

const projectOne = ProjectId.makeUnsafe("startup-proj-one");
const projectTwo = ProjectId.makeUnsafe("startup-proj-two");
const projectFailing = ProjectId.makeUnsafe("startup-proj-failing");

const coordinatorLayer = makeProjectWorkspaceMigrationCoordinatorLayer({
  clock: { now: () => "2026-08-24T00:00:00.000Z" },
}).pipe(Layer.provideMerge(SqlitePersistenceMemory));

const layer = it.layer(coordinatorLayer);

const seedProject = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_projects (
        project_id, kind, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
      ) VALUES (
        ${projectId}, 'project', 'Project', '/tmp/p', '[]',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', null
      )
    `;
  });

layer("runProjectWorkspaceMigrationOnStartup", (it) => {
  it.effect("publishes every Project's marker before command-ready and reruns idempotently", () =>
    Effect.gen(function* () {
      yield* seedProject(projectOne);
      yield* seedProject(projectTwo);
      const coordinator = yield* ProjectWorkspaceMigrationCoordinator;

      // The production call: one pass, empty legacy-slice map (the server owns
      // no v1 workspace slices; those live in web/desktop storage).
      const first = yield* runProjectWorkspaceMigrationOnStartup({ coordinator });

      assert.deepStrictEqual([...first.published].sort(), [projectOne, projectTwo]);
      assert.deepStrictEqual(first.kept, []);
      assert.deepStrictEqual(first.failed, []);

      // Every marker is published: a client that observes the advertised
      // capability can only read fully published targets.
      const store = yield* ProjectWorkspaceStore;
      for (const projectId of [projectOne, projectTwo]) {
        const read = yield* store.readProjectWorkspace({ projectId });
        assert.strictEqual(read.kind, "published-current");
        if (read.kind !== "published-current") throw new Error("expected published-current");
        assert.strictEqual(read.slices.length, 5);
      }

      // Idempotent rerun: nothing republished, everything kept.
      const second = yield* runProjectWorkspaceMigrationOnStartup({ coordinator });
      assert.deepStrictEqual(second.published, []);
      assert.deepStrictEqual([...second.kept].sort(), [projectOne, projectTwo]);
      assert.deepStrictEqual(second.failed, []);
    }),
  );

  it.effect("collects a per-Project failure as a diagnostic without failing the startup pass", () =>
    Effect.gen(function* () {
      yield* seedProject(projectFailing);
      // A coordinator whose publication always fails for THIS project only.
      const failing: typeof ProjectWorkspaceMigrationCoordinator.Service = {
        migrateAllProjects: () =>
          Effect.succeed([
            {
              projectId: projectFailing,
              outcome: { kind: "failed", reason: "injected store failure" },
            },
          ]),
      };

      // The startup pass itself never fails — the server still goes
      // command-ready and the failure stays retryable with its reason.
      const outcome = yield* runProjectWorkspaceMigrationOnStartup({ coordinator: failing });
      assert.deepStrictEqual(outcome.published, []);
      assert.deepStrictEqual(outcome.kept, []);
      assert.deepStrictEqual(outcome.failed, [
        { projectId: projectFailing, reason: "injected store failure" },
      ]);
    }),
  );
});
