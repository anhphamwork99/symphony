// FILE: 105_ProjectWorkspaceStagedPublication.test.ts
// Purpose: Proves migration 105 creates exactly the Project-owned workspace
//          destination tables, is idempotent/replay-safe, preserves the full
//          migration lineage including itself, and never touches v1 or
//          conversation tables.
// Layer: SQLite migration test

import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const trackerRows = (sql: SqlClient.SqlClient) =>
  sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id ASC
  `;

layer("migration 105 — ProjectWorkspaceStagedPublication", (it) => {
  it.effect("creates the slice and publication tables with their constraints", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const sliceColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('project_workspace_slices') ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        sliceColumns.map((row) => row.name),
        ["payload_json", "project_id", "schema_version", "slice_kind", "updated_at"],
      );

      const pkColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('project_workspace_slices') WHERE pk > 0 ORDER BY pk ASC
      `;
      assert.deepStrictEqual(pkColumns.map((row) => row.name), ["project_id", "slice_kind"]);

      const publicationColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('project_workspace_publications') ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        publicationColumns.map((row) => row.name),
        ["project_id", "published_at", "schema_version", "source_schema_version", "source_thread_id"],
      );
      const publicationPk = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('project_workspace_publications') WHERE pk > 0
      `;
      assert.deepStrictEqual(publicationPk.map((row) => row.name), ["project_id"]);

      // The slice-kind CHECK admits exactly the five WP1 kinds.
      for (const kind of [
        "right-dock",
        "terminal-presentation",
        "browser",
        "browser-annotations",
        "device",
      ]) {
        const inserted = yield* sql`
          INSERT INTO project_workspace_slices (
            project_id, slice_kind, payload_json, schema_version, updated_at
          ) VALUES ('proj-check', ${kind}, '{}', 2, '2026-08-24T00:00:00.000Z')
        `;
        assert.isDefined(inserted);
      }
      const rejected = yield* Effect.flip(sql`
        INSERT INTO project_workspace_slices (
          project_id, slice_kind, payload_json, schema_version, updated_at
        ) VALUES ('proj-check', 'not-a-slice', '{}', 2, '2026-08-24T00:00:00.000Z')
      `);
      assert.isDefined(rejected);
      yield* sql`DELETE FROM project_workspace_slices WHERE project_id = 'proj-check'`;
    }),
  );

  it.effect("is idempotent and preserves the declared lineage including itself", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const secondPass = yield* runMigrations();
      assert.lengthOf(secondPass, 0);

      const tracker = yield* trackerRows(sql);
      assert.deepStrictEqual(
        tracker.map((row) => [row.migration_id, row.name]),
        migrationEntries.map(([id, name]) => [id, name]),
      );
      assert.deepStrictEqual(tracker[tracker.length - 1], {
        migration_id: 105,
        name: "ProjectWorkspaceStagedPublication",
      });
    }),
  );

  it.effect("keeps conversation rows untouched across the migration range", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 104 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'proj-migration', 'project', 'P', '/tmp/p', '[]',
          '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, created_at, updated_at,
          runtime_mode, interaction_mode, env_mode
        ) VALUES (
          'thread-migration', 'proj-migration', 'T',
          '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
          'full-access', 'default', 'local'
        )
      `;
      const before = yield* sql`SELECT * FROM projection_threads WHERE thread_id = 'thread-migration'`;

      yield* runMigrations();

      const after = yield* sql`SELECT * FROM projection_threads WHERE thread_id = 'thread-migration'`;
      assert.deepStrictEqual(after, before);

      const workspaceRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_slices
      `;
      assert.strictEqual(workspaceRows[0]?.count, 0);
      const publicationRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM project_workspace_publications
      `;
      assert.strictEqual(publicationRows[0]?.count, 0);
    }),
  );
});
