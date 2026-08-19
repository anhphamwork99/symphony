// FILE: 104_PiSubagentResumeDelegation.test.ts
// Purpose: Proves migration 104 preserves pre-104 execution rows, adds the
// complete nullable delegation/model replay fields, exposes legacy NULLs
// honestly through repository decoding, and is idempotent.
// Layer: SQLite migration test

import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makePiSubagentExecutionRepository } from "../Layers/PiSubagentExecutionRepository.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("migration 104 — PiSubagentResumeDelegation", (it) => {
  it.effect(
    "preserves a legacy execution with NULL replay fields and round-trips it through repository decoding",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const through103 = yield* runMigrations({ toMigrationInclusive: 103 });
        assert.isTrue(through103.some(([id]) => id === 103));

        yield* sql`
          INSERT INTO pi_subagent_executions (
            execution_id, attempt_id, generation, command_id,
            command_fingerprint, project_id, parent_thread_id,
            parent_turn_id, parent_tool_call_id, agent_type, prompt, mode,
            cancellation_scope, desired_state, observed_state,
            diagnostic_code, rejection_reason, first_attempt_id,
            first_attempt_generation, created_at, updated_at
          ) VALUES (
            'exec_legacy_resume_1', 'att_legacy_resume_1', 2,
            'cmd_legacy_resume_1', 'fp_legacy_resume_1', 'proj_default',
            'thread_main', NULL, 'call_legacy_resume_1', 'worker',
            'Legacy task', 'foreground', 'parent_turn', 'running', 'orphaned',
            'pi_subagent_owner_loss_orphaned', 'Legacy owner loss',
            'att_legacy_resume_1', 1, '2026-08-19T08:00:00.000Z',
            '2026-08-19T08:05:00.000Z'
          )
        `;

        const through104 = yield* runMigrations({ toMigrationInclusive: 104 });
        assert.isTrue(through104.some(([id]) => id === 104));

        const columns = yield* sql<{ readonly name: string }>`
          SELECT name
          FROM pragma_table_info('pi_subagent_executions')
          WHERE name IN (
            'delegation_context',
            'delegation_link_references',
            'delegation_expected_outcome',
            'resolved_model'
          )
          ORDER BY name
        `;
        assert.deepStrictEqual(
          columns.map((row) => row.name),
          [
            "delegation_context",
            "delegation_expected_outcome",
            "delegation_link_references",
            "resolved_model",
          ],
        );

        const repository = yield* makePiSubagentExecutionRepository;
        const decoded = yield* repository.getById("exec_legacy_resume_1");
        assert.isTrue(Option.isSome(decoded));
        const record = Option.getOrThrow(decoded);
        assert.isUndefined(record.delegationContext);
        assert.isUndefined(record.delegationLinkReferences);
        assert.isUndefined(record.delegationExpectedOutcome);
        assert.isUndefined(record.resolvedModel);
        assert.equal(record.prompt, "Legacy task");
        assert.equal(record.observedState, "orphaned");

        const secondPass = yield* runMigrations({
          toMigrationInclusive: 104,
        });
        assert.equal(secondPass.length, 0);
      }),
  );
});
