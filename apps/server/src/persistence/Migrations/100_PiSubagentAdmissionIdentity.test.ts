// FILE: 100_PiSubagentAdmissionIdentity.test.ts
// Purpose: Proves migration 100 preserves released 098/099 data, adds the
// durable first-attempt and command-ownership columns, and makes lifecycle
// journal uniqueness attempt/generation-local (attempt 2 may restart at
// sequence 1 without colliding with attempt 1) — with a second pass no-op.
// Layer: SQLite migration test

import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("migration 100 — PiSubagentAdmissionIdentity", (it) => {
  it.effect("preserves 098/099 data, backfills first attempt, and makes journal uniqueness attempt/generation-local", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // 1. Apply the released lineage through 099.
      const through99 = yield* runMigrations({ toMigrationInclusive: 99 });
      assert.isTrue(through99.some(([id]) => id === 99));

      // 2. Seed legacy 098/099-shaped rows (no Issue-20 columns yet).
      yield* sql`
        INSERT INTO pi_subagent_executions (
          execution_id, attempt_id, generation, command_id, project_id,
          parent_thread_id, parent_turn_id, parent_tool_call_id, agent_type,
          prompt, mode, cancellation_scope, desired_state, observed_state,
          diagnostic_code, rejection_reason, created_at, updated_at
        ) VALUES (
          'exec_legacy_1', 'att_legacy_1', 1, 'cmd_legacy_1', 'proj_default',
          'thread_main', 'turn_1', 'call_1', 'researcher', 'Legacy task',
          'foreground', 'parent_turn', 'running', 'succeeded',
          'pi_subagent_managed_enabled', NULL, '2026-08-16T10:00:00.000Z',
          '2026-08-16T11:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO pi_subagent_lifecycle_journal (
          event_id, execution_id, attempt_id, generation, sequence, state,
          occurred_at, diagnostic_code, diagnostic_message, metadata_json
        ) VALUES
          ('evt_legacy_1', 'exec_legacy_1', 'att_legacy_1', 1, 1, 'accepted',
           '2026-08-16T10:00:00.000Z', 'pi_subagent_managed_enabled', NULL, NULL),
          ('evt_legacy_2', 'exec_legacy_1', 'att_legacy_1', 1, 2, 'succeeded',
           '2026-08-16T11:00:00.000Z', NULL, NULL, NULL)
      `;

      // 3. Apply migration 100.
      const through100 = yield* runMigrations({ toMigrationInclusive: 100 });
      assert.isTrue(through100.some(([id]) => id === 100));

      // 4. Data preserved, new columns present, first attempt backfilled.
      const legacy = yield* sql<{
        readonly commandFingerprint: string;
        readonly firstAttemptId: string | null;
        readonly firstAttemptGeneration: number | null;
        readonly clientCommandId: string | null;
        readonly subject: string | null;
      }>`
        SELECT
          command_fingerprint AS "commandFingerprint",
          first_attempt_id AS "firstAttemptId",
          first_attempt_generation AS "firstAttemptGeneration",
          client_command_id AS "clientCommandId",
          subject
        FROM pi_subagent_executions
        WHERE execution_id = 'exec_legacy_1'
      `;
      assert.equal(legacy.length, 1);
      assert.equal(legacy[0]!.commandFingerprint, "");
      assert.equal(legacy[0]!.firstAttemptId, "att_legacy_1");
      assert.equal(legacy[0]!.firstAttemptGeneration, 1);
      assert.isNull(legacy[0]!.clientCommandId);
      assert.isNull(legacy[0]!.subject);

      const journal = yield* sql<{ readonly eventId: string; readonly sequence: number }>`
        SELECT event_id AS "eventId", sequence
        FROM pi_subagent_lifecycle_journal
        WHERE execution_id = 'exec_legacy_1'
        ORDER BY sequence ASC
      `;
      assert.equal(journal.length, 2);
      assert.equal(journal[0]!.eventId, "evt_legacy_1");
      assert.equal(journal[1]!.eventId, "evt_legacy_2");

      // 5. Attempt/generation-local uniqueness: attempt 2 generation 2 may
      //    restart its own sequence at 1 without colliding with attempt 1.
      yield* sql`
        INSERT INTO pi_subagent_lifecycle_journal (
          event_id, execution_id, attempt_id, generation, sequence, state,
          occurred_at, diagnostic_code, diagnostic_message, metadata_json
        ) VALUES (
          'evt_legacy_att2_seq1', 'exec_legacy_1', 'att_legacy_2', 2, 1, 'running',
          '2026-08-16T12:00:00.000Z', NULL, NULL, NULL
        )
      `;

      // 6. Second pass is a no-op (idempotent migration).
      const secondPass = yield* runMigrations({ toMigrationInclusive: 100 });
      assert.equal(secondPass.length, 0);
    }),
  );
});
