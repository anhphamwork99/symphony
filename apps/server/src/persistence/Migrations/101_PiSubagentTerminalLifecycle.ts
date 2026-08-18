/**
 * 101_PiSubagentTerminalLifecycle — Issue 07 journal-first terminal
 * lifecycle.
 *
 * Adds the durable stale-terminal accounting column and the bounded terminal
 * evidence columns to `pi_subagent_executions`:
 *
 * - `stale_terminal_events INTEGER NOT NULL DEFAULT 0` — the durable counter
 *   for terminal evidence from a superseded attempt/generation, or a terminal
 *   that lost the applicable-terminal race: journaled as history, counted,
 *   never able to overwrite current execution truth (T07-AC4/T07-AC7).
 * - `terminal_summary TEXT` — bounded result summary from the applicable
 *   terminal (T07-AC5).
 * - `terminal_transcript_ref TEXT` — reference to the extension-owned
 *   transcript artifact for authorized later retrieval (T07-AC5).
 *
 * No journal table change is required: terminal journal rows reuse the
 * attempt/generation-local sequence uniqueness established in migration 100.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const hasStaleCount = yield* columnExists(sql, "pi_subagent_executions", "stale_terminal_events");
  if (!hasStaleCount) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN stale_terminal_events INTEGER NOT NULL DEFAULT 0
    `;
  }

  const hasTerminalSummary = yield* columnExists(sql, "pi_subagent_executions", "terminal_summary");
  if (!hasTerminalSummary) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN terminal_summary TEXT
    `;
  }

  const hasTerminalTranscriptRef = yield* columnExists(
    sql,
    "pi_subagent_executions",
    "terminal_transcript_ref",
  );
  if (!hasTerminalTranscriptRef) {
    yield* sql`
      ALTER TABLE pi_subagent_executions
      ADD COLUMN terminal_transcript_ref TEXT
    `;
  }
});
