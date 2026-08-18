/**
 * 102_PiSubagentCompletionOutbox — Issue 08 durable completion outbox.
 *
 * Creates the durable completion-delivery state machine storage, separate
 * from the execution aggregate (T08-AC2: delivery state never rewrites the
 * execution outcome):
 *
 * - `pi_subagent_completion_outbox` — one row per APPLICABLE terminal
 *   (succeeded|failed journal event for an attempt/generation). The dedupe
 *   identity is deterministic (`outbox_<executionId>_<attemptId>_gen<generation>`)
 *   with `UNIQUE (execution_id, attempt_id, generation)` so replayed terminals
 *   and replayed outbox processing can never create a duplicate entry
 *   (T08-AC3) and retries can never create duplicate parent content
 *   (T08-AC5).
 * - Delivery states: pending → delivered → acknowledged, with
 *   failed_retryable (bounded idempotent retry) and superseded (a newer
 *   attempt/generation owns the execution; no delivery effect, T08-AC6).
 *
 * Entries are created atomically inside the terminal-persist transaction
 * (`recordTerminalEvent`) for new terminals, and journal-first recoverably by
 * the recovery scan for terminal journal rows without an outbox row (T08-AC1/
 * AC4 — e.g. databases written before this migration).
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pi_subagent_completion_outbox (
      outbox_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      terminal_event_id TEXT NOT NULL,
      parent_thread_id TEXT NOT NULL,
      delivery_state TEXT NOT NULL CHECK (
        delivery_state IN ('pending', 'delivered', 'acknowledged', 'failed_retryable', 'superseded')
      ),
      terminal_state TEXT NOT NULL CHECK (terminal_state IN ('succeeded', 'failed')),
      summary TEXT NOT NULL,
      transcript_ref TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      superseded_by_generation INTEGER,
      delivered_at TEXT,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (execution_id, attempt_id, generation)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_completion_outbox_state
    ON pi_subagent_completion_outbox (delivery_state, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_completion_outbox_thread
    ON pi_subagent_completion_outbox (parent_thread_id, delivery_state)
  `;
});
