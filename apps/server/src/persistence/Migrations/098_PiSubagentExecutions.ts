import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pi_subagent_executions (
      execution_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      command_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      parent_thread_id TEXT NOT NULL,
      parent_turn_id TEXT,
      parent_tool_call_id TEXT,
      agent_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'foreground' CHECK (mode IN ('foreground', 'background')),
      cancellation_scope TEXT NOT NULL DEFAULT 'parent_turn' CHECK (cancellation_scope IN ('parent_turn', 'session', 'independent')),
      desired_state TEXT NOT NULL DEFAULT 'running',
      observed_state TEXT NOT NULL,
      diagnostic_code TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pi_subagent_lifecycle_journal (
      event_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      state TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      diagnostic_code TEXT,
      diagnostic_message TEXT,
      metadata_json TEXT,
      UNIQUE (execution_id, sequence),
      UNIQUE (execution_id, attempt_id, sequence)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_executions_thread
    ON pi_subagent_executions (parent_thread_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_journal_execution
    ON pi_subagent_lifecycle_journal (execution_id, sequence)
  `;
});
