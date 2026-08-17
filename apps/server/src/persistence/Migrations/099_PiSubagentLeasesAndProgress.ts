/**
 * Adds heartbeat lease and progress snapshot columns to pi_subagent_executions.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const hasHeartbeat = yield* columnExists(sql, "pi_subagent_executions", "last_heartbeat_at");
  if (!hasHeartbeat) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN last_heartbeat_at TEXT
    `;
  }

  const hasLease = yield* columnExists(sql, "pi_subagent_executions", "lease_expires_at");
  if (!hasLease) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN lease_expires_at TEXT
    `;
  }

  const hasProgressJson = yield* columnExists(sql, "pi_subagent_executions", "last_progress_json");
  if (!hasProgressJson) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN last_progress_json TEXT
    `;
  }

  const hasProgressAt = yield* columnExists(sql, "pi_subagent_executions", "last_progress_at");
  if (!hasProgressAt) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN last_progress_at TEXT
    `;
  }

  const hasDroppedCount = yield* columnExists(
    sql,
    "pi_subagent_executions",
    "dropped_progress_count",
  );
  if (!hasDroppedCount) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN dropped_progress_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_executions_lease
    ON pi_subagent_executions (lease_expires_at)
  `;
});
