import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_projects", "synara_mcp_desired_state"))) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN synara_mcp_desired_state TEXT NOT NULL DEFAULT 'disabled'
      CHECK (synara_mcp_desired_state IN ('disabled', 'enabled'))
    `;
  }

  if (!(yield* columnExists(sql, "projection_projects", "synara_mcp_activation_version"))) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN synara_mcp_activation_version INTEGER NOT NULL DEFAULT 0
      CHECK (synara_mcp_activation_version >= 0)
    `;
  }

  if (!(yield* columnExists(sql, "projection_projects", "synara_mcp_activation_operation_json"))) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN synara_mcp_activation_operation_json TEXT
    `;
  }
});
