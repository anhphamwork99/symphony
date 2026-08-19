/**
 * 104_PiSubagentResumeDelegation — Ticket 14 durable delegation replay.
 *
 * An explicit resume must start the SAME delegation the original admission
 * accepted: the Alfie pi-subagents Agent tool validates the complete
 * four-string delegation request (`task`, `context`, `link_references`,
 * `expected_outcome`) and rejects a spawn without it. Until now Synara only
 * persisted `agent_type` + `prompt`, so an explicit resume could not rebuild
 * a valid delegation and the resumed child would be rejected
 * (`DELEGATION_INVALID`) before ever starting.
 *
 * This migration is strictly additive and idempotent (replay-safe): three
 * nullable columns on `pi_subagent_executions` persist the admission-time
 * delegation triplet and the resolved `provider/modelId` selection the
 * child ran under. Rows admitted before this migration (legacy) keep NULL;
 * the resume launcher replays the stored triplet (gap-naming placeholders
 * for legacy rows) and resolves the stored model through the session's
 * model registry so the resumed attempt runs on the SAME provider.
 */
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const existingColumns = yield* sql<{ name: string }>`
    SELECT name FROM pragma_table_info('pi_subagent_executions')
  `;
  const columnNames = new Set(existingColumns.map((row) => row.name));

  if (!columnNames.has("delegation_context")) {
    yield* sql`
      ALTER TABLE pi_subagent_executions ADD COLUMN delegation_context TEXT
    `;
  }
  if (!columnNames.has("delegation_link_references")) {
    yield* sql`
      ALTER TABLE pi_subagent_executions ADD COLUMN delegation_link_references TEXT
    `;
  }
  if (!columnNames.has("delegation_expected_outcome")) {
    yield* sql`
      ALTER TABLE pi_subagent_executions ADD COLUMN delegation_expected_outcome TEXT
    `;
  }
  if (!columnNames.has("resolved_model")) {
    yield* sql`
      ALTER TABLE pi_subagent_executions ADD COLUMN resolved_model TEXT
    `;
  }
});
