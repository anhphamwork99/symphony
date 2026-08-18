// FILE: 103_PiSubagentCompletionDispatchBatches.test.ts
// Purpose: Proves migration 103 is additive and idempotent: adds the guarded
// nullable `dispatch_batch_id` to the completion outbox, creates the
// `pi_subagent_completion_dispatch_batches` ledger with the one-outstanding
// partial unique parent-thread index, and survives a full replay (a second
// pass is a no-op). Layer: SQLite migration test.

import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("migration 103 — PiSubagentCompletionDispatchBatches", (it) => {
  it.effect(
    "adds the guarded outbox column and the immutable batch ledger (second pass no-op)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // 1. Released lineage through 102.
        const through102 = yield* runMigrations({ toMigrationInclusive: 102 });
        assert.isTrue(through102.some(([id]) => id === 102));

        // 2. Seed a released-shape outbox row (no dispatch_batch_id yet).
        yield* sql`
        INSERT INTO pi_subagent_executions (
          execution_id, attempt_id, generation, command_id, project_id,
          parent_thread_id, parent_turn_id, parent_tool_call_id, agent_type,
          prompt, mode, cancellation_scope, desired_state, observed_state,
          diagnostic_code, rejection_reason, command_fingerprint,
          created_at, updated_at
        ) VALUES (
          'exec_103_1', 'att_103_1', 1, 'cmd_103_1', 'proj_default',
          'thread_103', 'turn_1', 'call_1', 'researcher', 'task',
          'background', 'parent_turn', 'running', 'succeeded',
          'pi_subagent_managed_enabled', NULL, 'fp_103_1',
          '2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z'
        )
      `;
        yield* sql`
        INSERT INTO pi_subagent_completion_outbox (
          outbox_id, execution_id, attempt_id, generation, terminal_event_id,
          parent_thread_id, delivery_state, terminal_state, summary,
          transcript_ref, attempt_count, last_error, superseded_by_generation,
          delivered_at, acknowledged_at, created_at, updated_at
        ) VALUES (
          'outbox_103_1', 'exec_103_1', 'att_103_1', 1, 'evt_103_1',
          'thread_103', 'pending', 'succeeded', 'done',
          NULL, 0, NULL, NULL, NULL, NULL,
          '2026-08-18T11:00:00.000Z', '2026-08-18T11:00:00.000Z'
        )
      `;

        // 3. Apply migration 103.
        const through103 = yield* runMigrations({ toMigrationInclusive: 103 });
        assert.isTrue(through103.some(([id]) => id === 103));

        // 4. Outbox row preserved; nullable guarded batch column added (NULL).
        const outbox = yield* sql<{
          readonly outboxId: string;
          readonly deliveryState: string;
          readonly dispatchBatchId: string | null;
        }>`
        SELECT
          outbox_id AS "outboxId",
          delivery_state AS "deliveryState",
          dispatch_batch_id AS "dispatchBatchId"
        FROM pi_subagent_completion_outbox
        WHERE outbox_id = 'outbox_103_1'
      `;
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0]!.deliveryState, "pending");
        assert.isNull(outbox[0]!.dispatchBatchId);

        // 5. Batch ledger exists with the full frozen-content + state column
        //    surface and the CHECK that guards batch states.
        const batchTables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'pi_subagent_completion_dispatch_batches'
      `;
        assert.equal(batchTables.length, 1);
        const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('pi_subagent_completion_dispatch_batches')
      `;
        const columnNames = columns.map((c) => c.name);
        for (const required of [
          "batch_id",
          "parent_thread_id",
          "parent_command_id",
          "parent_message_id",
          "fingerprint_version",
          "command_fingerprint",
          "membership_json",
          "parent_message_text",
          "command_payload_json",
          "state",
          "attempt_count",
          "accepted_receipt_sequence",
          "last_error",
          "created_at",
          "updated_at",
          "accepted_at",
          "acknowledged_at",
          "superseded_at",
          "exhausted_at",
        ]) {
          assert.include(columnNames, required);
        }

        // 6. Partial unique index: at most one nonterminal batch per thread.
        const activeIndexes = yield* sql<{ readonly name: string; readonly sql: string }>`
        SELECT name, sql FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_pi_subagent_completion_dispatch_batches_active'
      `;
        assert.equal(activeIndexes.length, 1);
        assert.match(activeIndexes[0]!.sql ?? "", /WHERE state IN/u);

        yield* sql`
        INSERT INTO pi_subagent_completion_dispatch_batches (
          batch_id, parent_thread_id, parent_command_id, parent_message_id,
          fingerprint_version, command_fingerprint, membership_json,
          parent_message_text, command_payload_json, state, attempt_count,
          created_at, updated_at
        ) VALUES (
          'batch_103_a', 'thread_103', 'cmd_103_a', 'msg_103_a', 1, 'fp_a',
          '["outbox_103_1"]', 'follow up', '{"type":"thread.turn.start"}',
          'awaiting_acceptance', 0,
          '2026-08-18T11:05:00.000Z', '2026-08-18T11:05:00.000Z'
        )
      `;

        // A second NONTERMINAL batch for the same thread must fail (the
        // durable one-outstanding authority).
        const insertSecondNonterminal = sql`
          INSERT INTO pi_subagent_completion_dispatch_batches (
            batch_id, parent_thread_id, parent_command_id, parent_message_id,
            fingerprint_version, command_fingerprint, membership_json,
            parent_message_text, command_payload_json, state, attempt_count,
            created_at, updated_at
          ) VALUES (
            'batch_103_b', 'thread_103', 'cmd_103_b', 'msg_103_b', 1, 'fp_b',
            '["outbox_103_2"]', 'follow up b', '{"type":"thread.turn.start"}',
            'awaiting_acceptance', 0,
            '2026-08-18T11:06:00.000Z', '2026-08-18T11:06:00.000Z'
          )
        `;
        const secondInsertExit = yield* Effect.exit(insertSecondNonterminal);
        assert.isTrue(Exit.isFailure(secondInsertExit));

        // A TERMINAL batch for the same thread is allowed (slot released).
        yield* sql`
        INSERT INTO pi_subagent_completion_dispatch_batches (
          batch_id, parent_thread_id, parent_command_id, parent_message_id,
          fingerprint_version, command_fingerprint, membership_json,
          parent_message_text, command_payload_json, state, attempt_count,
          created_at, updated_at
        ) VALUES (
          'batch_103_c', 'thread_103', 'cmd_103_c', 'msg_103_c', 1, 'fp_c',
          '["outbox_103_3"]', 'follow up c', '{"type":"thread.turn.start"}',
          'acknowledged', 0,
          '2026-08-18T11:07:00.000Z', '2026-08-18T11:07:00.000Z'
        )
      `;

        // 7. Full replay (MigrationReplay already covers id -> latest): a
        //    second pass over this post-state is a no-op.
        const secondPass = yield* runMigrations({ toMigrationInclusive: 103 });
        assert.equal(secondPass.length, 0);
        const stillThere = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM pi_subagent_completion_dispatch_batches
      `;
        assert.equal(stillThere[0]!.count, 2);
      }),
  );
});
