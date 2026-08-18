/**
 * 103_PiSubagentCompletionDispatchBatches — Decision 0016 crash-safe
 * parent-effect dispatch ledger (Ticket 09 remediation).
 *
 * Decision 0015 F1 blocks Ticket 09 acceptance: the coordinator persisted
 * outbox rows `delivered` BEFORE the parent effect, so process death between
 * those steps could leave a delivered/unacknowledged row outside every
 * recovery scan and permanently lose the parent effect. Decision 0016 adopts
 * a bounded immutable completion-dispatch batch ledger: the batch becomes the
 * durable recovery authority, the deterministic internal `thread.turn.start`
 * command is frozen at batch creation, and a fingerprint-matched accepted
 * orchestration command receipt is the sole parent-effect acceptance /
 * acknowledgement proof.
 *
 * This migration is strictly additive and idempotent (replay-safe):
 *
 * - `pi_subagent_completion_dispatch_batches` — one immutable batch per
 *   dispatch. It persists the deterministic parent command/message identity,
 *   protocol/fingerprint version, canonical command fingerprint, canonical
 *   bounded ordered outbox-ID membership JSON, frozen bounded parent message
 *   text, and the frozen canonical `thread.turn.start` command payload (for
 *   byte-identical redrive), plus batch state, attempt count, accepted
 *   receipt sequence, bounded last-error/diagnostic evidence, and the full
 *   created/updated/accepted/acknowledged/superseded/exhausted timestamp set.
 * - nullable `dispatch_batch_id` on `pi_subagent_completion_outbox` — the
 *   guarded "member of an active batch" association. Members of an active
 *   batch transition to the existing `delivered` delivery state as batch
 *   membership evidence; `delivered` is NOT parent-effect acceptance.
 * - a partial unique index on `parent_thread_id` over all nonterminal batch
 *   states (`awaiting_acceptance`, `retryable`, `accepted`) — the durable
 *   one-outstanding-authority per parent thread. At most one active batch can
 *   exist for a thread across process restarts; in-memory maps in the
 *   coordinator are only optimizations over it.
 *
 * Batch states distinguish awaiting acceptance, retryable boundary failure,
 * accepted (fingerprint-matched receipt observed), acknowledged/finalized,
 * superseded (stale before submission), and exhausted/permanent failure
 * (transient retry ceiling, immutable rejection, or identity collision).
 *
 * Old binaries replaying over this schema pause liveness for associated
 * `delivered` rows (their recoverable scan selects `pending` plus
 * within-budget `failed_retryable` only) and never reinterpret or redeliver
 * them (Decision 0016 §8). Evidence deletion / schema rollback is
 * unauthorized.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── outbox: guarded nullable batch association ──────────────────────────
  // Additive one-time column (SQLite cannot add columns via IF NOT EXISTS).
  if (!(yield* columnExists(sql, "pi_subagent_completion_outbox", "dispatch_batch_id"))) {
    yield* sql`
      ALTER TABLE pi_subagent_completion_outbox
      ADD COLUMN dispatch_batch_id TEXT
    `;
  }
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_completion_outbox_batch
    ON pi_subagent_completion_outbox (dispatch_batch_id)
  `;

  // ── batch ledger ────────────────────────────────────────────────────────
  yield* sql`
    CREATE TABLE IF NOT EXISTS pi_subagent_completion_dispatch_batches (
      batch_id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      parent_command_id TEXT NOT NULL UNIQUE,
      parent_message_id TEXT NOT NULL,
      fingerprint_version INTEGER NOT NULL CHECK (fingerprint_version >= 1),
      command_fingerprint TEXT NOT NULL,
      membership_json TEXT NOT NULL,
      parent_message_text TEXT NOT NULL,
      command_payload_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (
        state IN (
          'awaiting_acceptance',
          'retryable',
          'accepted',
          'acknowledged',
          'superseded',
          'exhausted'
        )
      ),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      accepted_receipt_sequence INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT,
      acknowledged_at TEXT,
      superseded_at TEXT,
      exhausted_at TEXT,
      UNIQUE (parent_thread_id, parent_message_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pi_subagent_completion_dispatch_batches_thread
    ON pi_subagent_completion_dispatch_batches (parent_thread_id, state, updated_at)
  `;

  // Durable one-outstanding-per-parent-thread authority (Decision 0016 §2).
  // Only nonterminal states occupy the active slot; terminal batches
  // (acknowledged/superseded/exhausted) release it automatically.
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pi_subagent_completion_dispatch_batches_active
    ON pi_subagent_completion_dispatch_batches (parent_thread_id)
    WHERE state IN ('awaiting_acceptance', 'retryable', 'accepted')
  `;
});
