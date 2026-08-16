import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(NodeSqliteClient.layerMemory())("097_ProjectMcpActivation", (it) => {
  it.effect("hydrates legacy project rows as disabled and adds durable operation columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 96 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'legacy-project', 'project', 'Legacy', '/tmp/legacy', '[]',
          '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 97 });
      const rows = yield* sql<{
        readonly desiredState: string;
        readonly activationVersion: number;
        readonly operation: string | null;
      }>`SELECT synara_mcp_desired_state AS "desiredState",
                synara_mcp_activation_version AS "activationVersion",
                synara_mcp_activation_operation_json AS "operation"
           FROM projection_projects
          WHERE project_id = 'legacy-project'`;

      assert.deepStrictEqual(rows[0], {
        desiredState: "disabled",
        activationVersion: 0,
        operation: null,
      });
    }),
  );

  it.effect("does not allow invalid desired state through the migration schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 97 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'constraint-project', 'project', 'Constraint', '/tmp/constraint', '[]',
          '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', NULL
        )
      `;
      const result = yield* Effect.exit(
        sql`UPDATE projection_projects SET synara_mcp_desired_state = 'invalid' WHERE project_id = 'constraint-project'`,
      );
      assert.isTrue(result._tag === "Failure");
    }),
  );
});
