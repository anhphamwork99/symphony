// FILE: MigrationLineageReconciliation.test.ts
// Purpose: Proves that Fresh, Symphony-lineage, and Upstream-v0.7.2 database fixtures
//          converge on the exact same schema, preserve pre-existing data, and are idempotent.
// AC: T18-AC3, T18-AC5, T18-AC7

import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vitest";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

import Migration0090 from "./090_ProjectionThreadMessageTextSegments.ts";
import Migration0091 from "./091_AutomationFailureTolerance.ts";
import Migration0092 from "./092_BackfillAutomationRunThreadSource.ts";
import Migration0093 from "./093_BackfillMaxIterationsDisabledReason.ts";
import Migration0094 from "./094_ProjectionThreadsGoal.ts";
import Migration0095 from "./095_ProjectionThreadsGoalTiming.ts";
import Migration0096 from "./096_ProjectionThreadsGoalAchievements.ts";
import Migration0097 from "./097_ProjectMcpActivation.ts";

const schemaObjects = (sql: SqlClient.SqlClient) =>
  sql<{
    readonly type: string;
    readonly name: string;
    readonly sql: string | null;
  }>`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
      AND name != 'effect_sql_migrations'
    ORDER BY type, name
  `;

const trackerRows = (sql: SqlClient.SqlClient) =>
  sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id ASC
  `;

describe("Migration Lineage Reconciliation (T18-AC3, T18-AC5, T18-AC7)", () => {
  it.effect(
    "converges fresh, Symphony, and upstream-v0.7.2 fixtures to identical schema with data preserved",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // --- 1. FRESH FIXTURE ---
        const freshExecuted = yield* runMigrations();
        assert.strictEqual(freshExecuted.length, migrationEntries.length);

        // Verify fresh schema contains all required upstream, Symphony, and Pi tables/columns
        const freshTables = (yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table'
        `).map((r) => r.name);

        assert.include(freshTables, "message_text_segments");
        assert.include(freshTables, "pi_subagent_executions");
        assert.include(freshTables, "pi_subagent_lifecycle_journal");

        const freshThreadCols = (yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('projection_threads')
        `).map((r) => r.name);
        assert.include(freshThreadCols, "goal");
        assert.include(freshThreadCols, "goal_started_at");
        assert.include(freshThreadCols, "goal_paused_at");
        assert.include(freshThreadCols, "goal_achievements_json");

        const freshProjectCols = (yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('projection_projects')
        `).map((r) => r.name);
        assert.include(freshProjectCols, "synara_mcp_desired_state");
        assert.include(freshProjectCols, "synara_mcp_activation_version");
        assert.include(freshProjectCols, "synara_mcp_activation_operation_json");

        const freshAutoCols = (yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('automation_definitions')
        `).map((r) => r.name);
        assert.include(freshAutoCols, "stop_after_consecutive_failures");
        assert.include(freshAutoCols, "consecutive_failure_count");
        assert.include(freshAutoCols, "disabled_reason");
        assert.include(freshAutoCols, "disabled_at");

        const freshPiCols = (yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('pi_subagent_executions')
        `).map((r) => r.name);
        assert.include(freshPiCols, "last_heartbeat_at");
        assert.include(freshPiCols, "lease_expires_at");
        assert.include(freshPiCols, "last_progress_json");
        assert.include(freshPiCols, "last_progress_at");
        assert.include(freshPiCols, "dropped_progress_count");
      }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("Symphony-lineage fixture migrates to equivalent schema and preserves data", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // 1. Build a Symphony fixture up to migration 90 (as shipped in v0.7.2-symphony.1/2)
      yield* runMigrations({ toMigrationInclusive: 89 });
      yield* Migration0097; // Run ProjectMcpActivation
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (90, 'ProjectMcpActivation')
      `;

      // Seed representative pre-existing Symphony data
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json,
          synara_mcp_desired_state, synara_mcp_activation_version, synara_mcp_activation_operation_json,
          created_at, updated_at
        ) VALUES (
          'proj-symphony-1', 'project', 'Symphony App', '/workspace/symphony', '[]',
          'enabled', 3, '{"recoveryIdentity":{"attemptId":"att-1"}}',
          '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, created_at, updated_at,
          runtime_mode, interaction_mode, env_mode
        ) VALUES (
          'thread-symphony-1', 'proj-symphony-1', 'Symphony Thread',
          '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z',
          'full-access', 'default', 'local'
        )
      `;
      yield* sql`
        INSERT INTO automation_definitions (
          automation_id, project_id, name, prompt, schedule_json, enabled,
          model_selection_json, runtime_mode, interaction_mode, worktree_mode, mode,
          stop_on_error, completion_policy_json, completion_policy_version,
          minimum_interval_seconds, retry_policy_json, misfire_policy,
          acknowledged_risks_json, iteration_count, created_at, updated_at
        ) VALUES (
          'auto-symphony-1', 'proj-symphony-1', 'Auto Symphony', 'Do work', '{"type":"manual"}', 1,
          '{"provider":"codex","model":"gpt-5-codex"}', 'approval-required',
          'default', 'auto', 'standalone', 1, '{"type":"none"}', 0,
          60, '{"type":"none"}', 'coalesce', '[]', 0,
          '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z'
        )
      `;

      // 2. Migrate to latest
      const executed = yield* runMigrations();
      assert.deepStrictEqual(
        executed.map(([id]) => id),
        [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104],
      );

      // Verify tracker
      const tracker = yield* trackerRows(sql);
      assert.deepStrictEqual(
        tracker.map((r) => [r.migration_id, r.name]),
        migrationEntries.map(([id, name]) => [id, name]),
      );

      // Verify representative data survived untouched
      const project = yield* sql<{
        readonly projectId: string;
        readonly desiredState: string;
        readonly activationVersion: number;
        readonly operationJson: string;
      }>`
        SELECT
          project_id AS "projectId",
          synara_mcp_desired_state AS "desiredState",
          synara_mcp_activation_version AS "activationVersion",
          synara_mcp_activation_operation_json AS "operationJson"
        FROM projection_projects
        WHERE project_id = 'proj-symphony-1'
      `;
      assert.deepStrictEqual(project, [
        {
          projectId: "proj-symphony-1",
          desiredState: "enabled",
          activationVersion: 3,
          operationJson: '{"recoveryIdentity":{"attemptId":"att-1"}}',
        },
      ]);

      const thread = yield* sql<{ readonly threadId: string; readonly title: string }>`
        SELECT thread_id AS "threadId", title
        FROM projection_threads
        WHERE thread_id = 'thread-symphony-1'
      `;
      assert.deepStrictEqual(thread, [{ threadId: "thread-symphony-1", title: "Symphony Thread" }]);

      // Verify upstream 091 backfill applied to the pre-existing automation definition
      const auto = yield* sql<{
        readonly autoId: string;
        readonly stopAfterConsecutiveFailures: number | null;
      }>`
        SELECT
          automation_id AS "autoId",
          stop_after_consecutive_failures AS "stopAfterConsecutiveFailures"
        FROM automation_definitions
        WHERE automation_id = 'auto-symphony-1'
      `;
      assert.deepStrictEqual(auto, [
        { autoId: "auto-symphony-1", stopAfterConsecutiveFailures: 3 },
      ]);

      // 3. Second pass is a no-op (T18-AC7)
      const secondPass = yield* runMigrations();
      assert.strictEqual(secondPass.length, 0);

      const schemaAfterSecondPass = yield* schemaObjects(sql);
      const thirdPass = yield* runMigrations();
      assert.strictEqual(thirdPass.length, 0);
      assert.deepStrictEqual(yield* schemaObjects(sql), schemaAfterSecondPass);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("Upstream-v0.7.2 fixture migrates to equivalent schema and preserves data", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // 1. Build an Upstream-v0.7.2 fixture (migrations 1-89 + 90-96)
      yield* runMigrations({ toMigrationInclusive: 89 });
      yield* Migration0090;
      yield* Migration0091;
      yield* Migration0092;
      yield* Migration0093;
      yield* Migration0094;
      yield* Migration0095;
      yield* Migration0096;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (90, 'ProjectionThreadMessageTextSegments'),
          (91, 'AutomationFailureTolerance'),
          (92, 'BackfillAutomationRunThreadSource'),
          (93, 'BackfillMaxIterationsDisabledReason'),
          (94, 'ProjectionThreadsGoal'),
          (95, 'ProjectionThreadsGoalTiming'),
          (96, 'ProjectionThreadsGoalAchievements')
      `;

      // Seed representative pre-existing upstream-v0.7.2 data
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'proj-upstream-1', 'project', 'Upstream App', '/workspace/upstream', '[]',
          '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, goal, goal_started_at, goal_paused_at,
          goal_achievements_json, created_at, updated_at,
          runtime_mode, interaction_mode, env_mode
        ) VALUES (
          'thread-upstream-1', 'proj-upstream-1', 'Upstream Thread', 'Refactor auth',
          '2026-08-11T10:00:00.000Z', NULL, '["step1"]',
          '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z',
          'full-access', 'default', 'local'
        )
      `;
      yield* sql`
        INSERT INTO message_text_segments (
          thread_id, message_id, sequence, started_at, ended_at, text
        ) VALUES (
          'thread-upstream-1', 'msg-1', 1,
          '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:01.000Z', 'segment text'
        )
      `;
      yield* sql`
        INSERT INTO automation_definitions (
          automation_id, project_id, name, prompt, schedule_json, enabled,
          model_selection_json, runtime_mode, interaction_mode, worktree_mode, mode,
          stop_after_consecutive_failures, consecutive_failure_count, disabled_reason, disabled_at,
          stop_on_error, completion_policy_json, completion_policy_version,
          minimum_interval_seconds, retry_policy_json, misfire_policy,
          acknowledged_risks_json, iteration_count, created_at, updated_at
        ) VALUES (
          'auto-upstream-1', 'proj-upstream-1', 'Upstream Auto', 'Prompt', '{"type":"manual"}', 0,
          '{"provider":"codex","model":"gpt-5-codex"}', 'approval-required',
          'default', 'auto', 'standalone', 5, 2, 'failures', '2026-08-11T11:00:00.000Z',
          1, '{"type":"none"}', 0, 60, '{"type":"none"}', 'coalesce', '[]', 2,
          '2026-08-11T10:00:00.000Z', '2026-08-11T11:00:00.000Z'
        )
      `;

      // 2. Migrate to latest
      const executed = yield* runMigrations();
      assert.deepStrictEqual(
        executed.map(([id]) => id),
        [97, 98, 99, 100, 101, 102, 103, 104],
      );

      // Verify tracker
      const tracker = yield* trackerRows(sql);
      assert.deepStrictEqual(
        tracker.map((r) => [r.migration_id, r.name]),
        migrationEntries.map(([id, name]) => [id, name]),
      );

      // Verify representative data survived untouched
      const thread = yield* sql<{
        readonly threadId: string;
        readonly goal: string;
        readonly achievementsJson: string;
      }>`
        SELECT
          thread_id AS "threadId",
          goal,
          goal_achievements_json AS "achievementsJson"
        FROM projection_threads
        WHERE thread_id = 'thread-upstream-1'
      `;
      assert.deepStrictEqual(thread, [
        {
          threadId: "thread-upstream-1",
          goal: "Refactor auth",
          achievementsJson: '["step1"]',
        },
      ]);

      const segments = yield* sql<{
        readonly messageId: string;
        readonly text: string;
      }>`
        SELECT message_id AS "messageId", text
        FROM message_text_segments
        WHERE thread_id = 'thread-upstream-1'
      `;
      assert.deepStrictEqual(segments, [{ messageId: "msg-1", text: "segment text" }]);

      const auto = yield* sql<{
        readonly autoId: string;
        readonly disabledReason: string | null;
        readonly consecutiveFailureCount: number;
      }>`
        SELECT
          automation_id AS "autoId",
          disabled_reason AS "disabledReason",
          consecutive_failure_count AS "consecutiveFailureCount"
        FROM automation_definitions
        WHERE automation_id = 'auto-upstream-1'
      `;
      assert.deepStrictEqual(auto, [
        { autoId: "auto-upstream-1", disabledReason: "failures", consecutiveFailureCount: 2 },
      ]);

      // Verify Symphony 097 added default MCP activation columns to pre-existing projects
      const project = yield* sql<{
        readonly projectId: string;
        readonly desiredState: string;
        readonly activationVersion: number;
      }>`
        SELECT
          project_id AS "projectId",
          synara_mcp_desired_state AS "desiredState",
          synara_mcp_activation_version AS "activationVersion"
        FROM projection_projects
        WHERE project_id = 'proj-upstream-1'
      `;
      assert.deepStrictEqual(project, [
        { projectId: "proj-upstream-1", desiredState: "disabled", activationVersion: 0 },
      ]);

      // 3. Second pass is a no-op (T18-AC7)
      const secondPass = yield* runMigrations();
      assert.strictEqual(secondPass.length, 0);

      const schemaAfterSecondPass = yield* schemaObjects(sql);
      const thirdPass = yield* runMigrations();
      assert.strictEqual(thirdPass.length, 0);
      assert.deepStrictEqual(yield* schemaObjects(sql), schemaAfterSecondPass);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect(
    "Schema across fresh, Symphony-lineage, and upstream-v0.7.2 is byte-for-byte equivalent",
    () =>
      Effect.gen(function* () {
        const getFreshSchema = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations();
          return yield* schemaObjects(sql);
        }).pipe(Effect.provide(NodeSqliteClient.layerMemory()));

        const getSymphonySchema = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations({ toMigrationInclusive: 89 });
          yield* Migration0097;
          yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (90, 'ProjectMcpActivation')
        `;
          yield* runMigrations();
          return yield* schemaObjects(sql);
        }).pipe(Effect.provide(NodeSqliteClient.layerMemory()));

        const getUpstreamSchema = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations({ toMigrationInclusive: 89 });
          yield* Migration0090;
          yield* Migration0091;
          yield* Migration0092;
          yield* Migration0093;
          yield* Migration0094;
          yield* Migration0095;
          yield* Migration0096;
          yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES
            (90, 'ProjectionThreadMessageTextSegments'),
            (91, 'AutomationFailureTolerance'),
            (92, 'BackfillAutomationRunThreadSource'),
            (93, 'BackfillMaxIterationsDisabledReason'),
            (94, 'ProjectionThreadsGoal'),
            (95, 'ProjectionThreadsGoalTiming'),
            (96, 'ProjectionThreadsGoalAchievements')
        `;
          yield* runMigrations();
          return yield* schemaObjects(sql);
        }).pipe(Effect.provide(NodeSqliteClient.layerMemory()));

        const freshSchema = yield* getFreshSchema;
        const symphonySchema = yield* getSymphonySchema;
        const upstreamSchema = yield* getUpstreamSchema;

        // Schema objects should match identically
        assert.deepStrictEqual(symphonySchema, freshSchema);
        assert.deepStrictEqual(upstreamSchema, freshSchema);
      }),
  );
});
