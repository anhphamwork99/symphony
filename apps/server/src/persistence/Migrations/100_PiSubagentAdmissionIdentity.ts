/**
 * 100_PiSubagentAdmissionIdentity — Issue 20 atomic authorized production
 * admission schema.
 *
 * Adds the durable command-ownership scope (fingerprint + client correlation
 * id + trusted subject) and the durable FIRST-ATTEMPT identity to
 * `pi_subagent_executions`, and makes lifecycle journal uniqueness
 * attempt/generation-local so a future resume attempt may begin its own
 * sequence (sequence 1) without colliding with a prior attempt.
 *
 * The journal table is rebuilt because SQLite cannot drop a column
 * constraint in place: the released 098 schema carries
 * `UNIQUE (execution_id, sequence)` in addition to
 * `UNIQUE (execution_id, attempt_id, sequence)`, and that first constraint
 * makes attempt 2 sequence 1 collide with attempt 1 sequence 1. The rebuild
 * preserves every row and column, swaps the unique constraint for
 * `UNIQUE (execution_id, attempt_id, generation, sequence)`, and recreates
 * the released journal index. The rebuild is guarded on the released
 * pre-state (the old unique constraint present in the table SQL), so a
 * second pass is a no-op and the released 098/099 lineage is untouched.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

const JOURNAL_TABLE = "pi_subagent_lifecycle_journal";

/** True when the released 098 journal shape (UNIQUE (execution_id, sequence)) is still present. */
const journalNeedsRebuild = (sql: SqlClient.SqlClient) =>
  sql<{ readonly hasLegacyUnique: number }>`
    SELECT EXISTS(
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ${JOURNAL_TABLE}
        AND sql LIKE '%UNIQUE (execution_id, sequence)%'
    ) AS "hasLegacyUnique"
  `.pipe(Effect.map(([row]) => row?.hasLegacyUnique === 1));

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── pi_subagent_executions: durable command-ownership scope ─────────────
  if (!(yield* columnExists(sql, "pi_subagent_executions", "command_fingerprint"))) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN command_fingerprint TEXT NOT NULL DEFAULT ''
    `;
  }
  if (!(yield* columnExists(sql, "pi_subagent_executions", "client_command_id"))) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN client_command_id TEXT
    `;
  }
  if (!(yield* columnExists(sql, "pi_subagent_executions", "subject"))) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN subject TEXT
    `;
  }

  // ── pi_subagent_executions: durable first-attempt identity ──────────────
  // The aggregate's live attempt_id/generation advance on resume; the first
  // attempt (the admission-time attempt) is preserved durably here so the
  // record never loses the admission truth.
  if (!(yield* columnExists(sql, "pi_subagent_executions", "first_attempt_id"))) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN first_attempt_id TEXT
    `;
    yield* sql`
      UPDATE pi_subagent_executions
      SET first_attempt_id = attempt_id
      WHERE first_attempt_id IS NULL
    `;
  }
  if (!(yield* columnExists(sql, "pi_subagent_executions", "first_attempt_generation"))) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN first_attempt_generation INTEGER
    `;
    yield* sql`
      UPDATE pi_subagent_executions
      SET first_attempt_generation = generation
      WHERE first_attempt_generation IS NULL
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_executions_command_scope
    ON pi_subagent_executions (command_id, command_fingerprint)
  `;

  // ── pi_subagent_lifecycle_journal: attempt/generation-local uniqueness ──
  if (yield* journalNeedsRebuild(sql)) {
    yield* sql`DROP TABLE IF EXISTS pi_subagent_lifecycle_journal_100`;
    yield* sql`
      CREATE TABLE pi_subagent_lifecycle_journal_100 (
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
        UNIQUE (execution_id, attempt_id, generation, sequence)
      )
    `;
    yield* sql`
      INSERT INTO pi_subagent_lifecycle_journal_100 (
        event_id,
        execution_id,
        attempt_id,
        generation,
        sequence,
        state,
        occurred_at,
        diagnostic_code,
        diagnostic_message,
        metadata_json
      )
      SELECT
        event_id,
        execution_id,
        attempt_id,
        generation,
        sequence,
        state,
        occurred_at,
        diagnostic_code,
        diagnostic_message,
        metadata_json
      FROM pi_subagent_lifecycle_journal
    `;
    yield* sql`DROP TABLE pi_subagent_lifecycle_journal`;
    yield* sql`
      ALTER TABLE pi_subagent_lifecycle_journal_100
      RENAME TO pi_subagent_lifecycle_journal
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_pi_subagent_journal_execution
      ON pi_subagent_lifecycle_journal (execution_id, sequence)
    `;
  }
});
