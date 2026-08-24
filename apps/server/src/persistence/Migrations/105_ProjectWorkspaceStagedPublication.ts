/**
 * 105_ProjectWorkspaceStagedPublication — Project-owned Right-sidebar
 * workspace destination persistence (WP3, Decision 0002).
 *
 * Creates the DURABLE DESTINATION only:
 * - `project_workspace_slices` — one row per (Project, slice kind) holding the
 *   validated Project-owned v2 slice payload (all five kinds from WP1:
 *   right-dock, terminal-presentation, browser, browser-annotations, device).
 * - `project_workspace_publications` — the per-Project publication marker with
 *   its schema version, publication instant, and legacy migration provenance.
 *
 * It deliberately writes NO data: legacy v1 Right-sidebar slices live in
 * web/desktop localStorage, not the server database, so migration selection
 * and staging are coordinated per Project at runtime by the
 * `projectWorkspace` staged-publication coordinator (snapshot → shared pure
 * policy → one transaction that upserts all five slices then inserts the
 * marker LAST). Until a marker row exists for a Project, readers must not
 * treat that Project's slice rows as canonical (marker-gated reads).
 *
 * Additive and replay-safe: `CREATE TABLE IF NOT EXISTS` guards everything, so
 * a lineage-reconciled replay over its own post-state is a no-op. It never
 * touches v1 Thread-owned records or any conversation table.
 */
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_workspace_slices (
      project_id TEXT NOT NULL,
      slice_kind TEXT NOT NULL
        CHECK (slice_kind IN (
          'right-dock',
          'terminal-presentation',
          'browser',
          'browser-annotations',
          'device'
        )),
      payload_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL
        CHECK (schema_version > 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, slice_kind)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_workspace_publications (
      project_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL
        CHECK (schema_version > 0),
      published_at TEXT NOT NULL,
      source_schema_version INTEGER,
      source_thread_id TEXT
    )
  `;
});
