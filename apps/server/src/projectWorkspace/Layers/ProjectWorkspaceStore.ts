// FILE: Layers/ProjectWorkspaceStore.ts
// Purpose: SQLite implementation of the Project-owned Right-sidebar workspace
//          store over migration 105's `project_workspace_slices` and
//          `project_workspace_publications` tables.
// Layer: Server persistence layer.
// Depends on: Services/ProjectWorkspaceStore, persistence Errors, WP1 schemas,
//   shared policy staging-completeness gate.

import {
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  ProjectId,
  ProjectWorkspacePublicationMarker,
  ProjectWorkspaceSlice,
} from "@synara/contracts";
import {
  inspectProjectWorkspacePublishedTarget,
  isProjectWorkspaceStagingComplete,
} from "@synara/shared/projectWorkspaceMigration";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError, toPersistenceSqlOrDecodeError } from "../../persistence/Errors.ts";
import {
  ProjectWorkspaceStagingInvalidError,
  ProjectWorkspaceStore,
  type ProjectWorkspaceReadResult,
  type ProjectWorkspaceStoreError,
  type ProjectWorkspaceStoreShape,
} from "../Services/ProjectWorkspaceStore.ts";

interface SliceRow {
  readonly projectId: string;
  readonly sliceKind: string;
  readonly payloadJson: string;
  readonly schemaVersion: number;
  readonly updatedAt: string;
}

interface PublicationRow {
  readonly projectId: string;
  readonly schemaVersion: number;
  readonly publishedAt: string;
  readonly sourceSchemaVersion: number | null;
  readonly sourceThreadId: string | null;
}

const publicationRowToMarker = (row: PublicationRow): unknown => ({
  projectId: row.projectId,
  schemaVersion: row.schemaVersion,
  publishedAt: row.publishedAt,
  provenance:
    row.sourceSchemaVersion === null || row.sourceThreadId === null
      ? null
      : {
          sourceSchemaVersion: row.sourceSchemaVersion,
          sourceThreadId: row.sourceThreadId,
        },
});

const decodeOr = <S extends Schema.Top>(schema: S, input: unknown) => {
  try {
    return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
  } catch {
    return null;
  }
};

const unpublished = (
  reason:
    | "marker-absent"
    | "marker-invalid"
    | "marker-stale-version"
    | "marker-other-project"
    | "staging-incomplete"
    | "staging-mixed-project",
): ProjectWorkspaceReadResult => ({ kind: "unpublished", reason });

const publishedInvalid = (detail: string): ProjectWorkspaceReadResult => ({
  kind: "published-invalid",
  detail,
});

/**
 * Test seam between the five slice upserts and the marker insert — the
 * exact boundary whose transactionality Decision 0002 F.2/F.4 guards.
 * Undefined in production composition; a failing effect aborts the ONE
 * transaction so nothing partial can commit.
 */
export interface ProjectWorkspaceStoreTestHooks {
  readonly afterSlicesBeforeMarker?: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<void, ProjectWorkspaceStagingInvalidError>;
}

/**
 * Compose the store over SQLite. Production uses `ProjectWorkspaceStoreLive`
 * (no hooks); tests may compose `makeProjectWorkspaceStoreLayer(hooks)` to
 * fault-inject the pre-marker boundary inside the transaction.
 */
export const makeProjectWorkspaceStoreLayer = (hooks?: ProjectWorkspaceStoreTestHooks) =>
  Layer.effect(
    ProjectWorkspaceStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const readSliceRows = (projectId: ProjectId) =>
        sql<SliceRow>`
        SELECT
          project_id AS "projectId",
          slice_kind AS "sliceKind",
          payload_json AS "payloadJson",
          schema_version AS "schemaVersion",
          updated_at AS "updatedAt"
        FROM project_workspace_slices
        WHERE project_id = ${projectId}
        ORDER BY slice_kind ASC
      `;

      const readPublicationRow = (projectId: ProjectId) =>
        sql<PublicationRow>`
        SELECT
          project_id AS "projectId",
          schema_version AS "schemaVersion",
          published_at AS "publishedAt",
          source_schema_version AS "sourceSchemaVersion",
          source_thread_id AS "sourceThreadId"
        FROM project_workspace_publications
        WHERE project_id = ${projectId}
        LIMIT 1
      `;

      const readPublishedTarget: ProjectWorkspaceStoreShape["readPublishedTarget"] = ({
        projectId,
      }) =>
        Effect.gen(function* () {
          const publicationRows = yield* readPublicationRow(projectId).pipe(
            Effect.mapError(
              toPersistenceSqlError("ProjectWorkspaceStore.readPublishedTarget:query"),
            ),
          );
          const sliceRows = yield* readSliceRows(projectId).pipe(
            Effect.mapError(
              toPersistenceSqlError("ProjectWorkspaceStore.readPublishedTarget:query"),
            ),
          );
          return {
            publicationMarker:
              publicationRows.length === 0 ? null : publicationRowToMarker(publicationRows[0]!),
            stagedSlices: sliceRows.map((row) => {
              try {
                return JSON.parse(row.payloadJson) as unknown;
              } catch {
                return null;
              }
            }),
          };
        });

      const readProjectWorkspace: ProjectWorkspaceStoreShape["readProjectWorkspace"] = ({
        projectId,
      }) =>
        Effect.gen(function* () {
          const publicationRows = yield* readPublicationRow(projectId);
          const sliceRows = yield* readSliceRows(projectId);

          // Publication-inspection semantics live in ONE place: the shared pure
          // policy. The store supplies only the raw persisted rows; the typed
          // `unpublished` verdict (marker-absent/invalid/stale-version/
          // other-project/staging-incomplete/staging-mixed-project) comes from
          // the same function the migration planner itself consumes.
          const rawStagedSlices: Array<unknown> = [];
          for (const row of sliceRows) {
            let payload: unknown;
            try {
              payload = JSON.parse(row.payloadJson) as unknown;
            } catch {
              return publishedInvalid(
                `staged slice ${row.sliceKind} for project ${row.projectId} is not valid JSON`,
              );
            }
            rawStagedSlices.push(payload);
          }

          const rawMarker =
            publicationRows.length === 0 ? null : publicationRowToMarker(publicationRows[0]!);
          const status = inspectProjectWorkspacePublishedTarget(
            { publicationMarker: rawMarker, stagedSlices: rawStagedSlices },
            projectId,
          );
          if (status.status !== "published-current") {
            return unpublished(status.reason);
          }

          const stagedSlices: Array<ProjectWorkspaceSlice> = [];
          for (const raw of rawStagedSlices) {
            const slice = decodeOr(ProjectWorkspaceSlice, raw);
            if (slice === null) {
              // inspectProjectWorkspacePublishedTarget guarantees the set is
              // complete and decodable here; this branch only guards a contract
              // drift between the two decode sites.
              return publishedInvalid(
                `staged slice for project ${projectId} failed schema validation`,
              );
            }
            stagedSlices.push(slice);
          }

          const marker = decodeOr(ProjectWorkspacePublicationMarker, rawMarker)!;

          return {
            kind: "published-current",
            slices: stagedSlices,
            marker,
          } satisfies ProjectWorkspaceReadResult;
        }).pipe(
          Effect.mapError(
            toPersistenceSqlError("ProjectWorkspaceStore.readProjectWorkspace:query"),
          ),
        );

      const stageAndPublish: ProjectWorkspaceStoreShape["stageAndPublish"] = (input) =>
        Effect.gen(function* () {
          // Validate the complete boundary payload BEFORE any write: exactly one
          // current-version slice of every kind, all owned by this Project.
          if (!isProjectWorkspaceStagingComplete(input.slices, input.projectId)) {
            return yield* new ProjectWorkspaceStagingInvalidError({
              projectId: input.projectId,
              detail:
                "the staged payload is not exactly one complete current-version slice set owned by this Project",
            });
          }

          const sourceSchemaVersion =
            input.provenance === null ? null : input.provenance.sourceSchemaVersion;
          const sourceThreadId = input.provenance === null ? null : input.provenance.sourceThreadId;

          // ONE transaction: all five slice upserts, then the marker LAST
          // (Decision 0002 F.2/F.4). A failure between them rolls the whole
          // transaction back — the target stays unpublished and retryable.
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const now = input.publishedAt;
              for (const slice of input.slices) {
                yield* sql`
                INSERT INTO project_workspace_slices (
                  project_id,
                  slice_kind,
                  payload_json,
                  schema_version,
                  updated_at
                )
                VALUES (
                  ${input.projectId},
                  ${slice.slice},
                  ${JSON.stringify(slice)},
                  ${PROJECT_WORKSPACE_SCHEMA_VERSION},
                  ${now}
                )
                ON CONFLICT (project_id, slice_kind) DO UPDATE SET
                  payload_json = excluded.payload_json,
                  schema_version = excluded.schema_version,
                  updated_at = excluded.updated_at
              `;
              }

              const midTransaction =
                hooks?.afterSlicesBeforeMarker?.({ projectId: input.projectId }) ?? Effect.void;
              yield* midTransaction;

              yield* sql`
              INSERT INTO project_workspace_publications (
                project_id,
                schema_version,
                published_at,
                source_schema_version,
                source_thread_id
              )
              VALUES (
                ${input.projectId},
                ${PROJECT_WORKSPACE_SCHEMA_VERSION},
                ${input.publishedAt},
                ${sourceSchemaVersion},
                ${sourceThreadId}
              )
              ON CONFLICT (project_id) DO UPDATE SET
                schema_version = excluded.schema_version,
                published_at = excluded.published_at,
                source_schema_version = excluded.source_schema_version,
                source_thread_id = excluded.source_thread_id
            `;
            }),
          );
        }).pipe(
          Effect.mapError(
            (cause): ProjectWorkspaceStoreError | ProjectWorkspaceStagingInvalidError =>
              cause instanceof ProjectWorkspaceStagingInvalidError
                ? cause
                : toPersistenceSqlOrDecodeError(
                    "ProjectWorkspaceStore.stageAndPublish:query",
                    "ProjectWorkspaceStore.stageAndPublish:decode",
                  )(cause),
          ),
        );

      const deleteProjectWorkspace: ProjectWorkspaceStoreShape["deleteProjectWorkspace"] = ({
        projectId,
      }) =>
        Effect.gen(function* () {
          // Deliberately NO withTransaction here: the orchestration engine invokes
          // this inside the SAME transaction that appends `project.deleted` and
          // projects it, so these deletes join that transaction and roll back with
          // it if the commit fails. Standalone callers get per-statement atomicity,
          // which is acceptable for an idempotent postcondition cleanup.
          yield* sql`DELETE FROM project_workspace_slices WHERE project_id = ${projectId}`;
          yield* sql`DELETE FROM project_workspace_publications WHERE project_id = ${projectId}`;
        }).pipe(
          Effect.mapError(
            toPersistenceSqlError("ProjectWorkspaceStore.deleteProjectWorkspace:query"),
          ),
        );

      return {
        readProjectWorkspace: (input) =>
          readProjectWorkspace(input).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectWorkspaceStore.readProjectWorkspace:query",
                "ProjectWorkspaceStore.readProjectWorkspace:decode",
              ),
            ),
          ),
        readPublishedTarget,
        stageAndPublish,
        deleteProjectWorkspace,
      } satisfies ProjectWorkspaceStoreShape;
    }),
  );

/** Production composition: no test hooks. */
export const ProjectWorkspaceStoreLive = makeProjectWorkspaceStoreLayer();
