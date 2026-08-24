// FILE: Services/ProjectWorkspaceStore.ts
// Purpose: Durable persistence for Project-owned Right-sidebar workspace
//          slices and their per-Project publication marker (WP3, Decision 0002).
// Layer: Server persistence service (schema-validated, typed errors).
// Depends on: WP1 contracts projectWorkspace schemas, persistence Errors.

import { ProjectId } from "@synara/contracts";
import type {
  ProjectWorkspaceMigrationProvenance,
  ProjectWorkspacePublicationMarker,
  ProjectWorkspaceSlice,
} from "@synara/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";
import { PROJECT_WORKSPACE_SCHEMA_VERSION } from "@synara/contracts";

import type { PersistenceDecodeError, PersistenceSqlError } from "../../persistence/Errors.ts";

/**
 * Why slices are written as raw JSON payloads: every v2 slice is validated
 * against its WP1 contract schema by THIS service before it is staged, and
 * re-validated on read, so the row carries schema-level integrity without the
 * migration needing to know each slice's field shape.
 */
export type ProjectWorkspaceStoreError = PersistenceSqlError | PersistenceDecodeError;

export class ProjectWorkspaceStagingInvalidError extends Schema.TaggedErrorClass<ProjectWorkspaceStagingInvalidError>()(
  "ProjectWorkspaceStagingInvalidError",
  {
    projectId: ProjectId,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot publish Project workspace ${this.projectId}: ${this.detail}`;
  }
}

/** Read result: canonical only when a current-version marker gates it. */
export type ProjectWorkspaceReadResult =
  | {
      readonly kind: "published-current";
      readonly slices: ReadonlyArray<ProjectWorkspaceSlice>;
      readonly marker: ProjectWorkspacePublicationMarker;
    }
  | {
      /** Marker absent, invalid, stale-version, or for another Project. */
      readonly kind: "unpublished";
      readonly reason:
        | "marker-absent"
        | "marker-invalid"
        | "marker-stale-version"
        | "marker-other-project"
        | "staging-incomplete"
        | "staging-mixed-project";
    }
  | {
      /**
       * A valid marker exists but a staged slice failed validation. The marker
       * said published; the persisted payload no longer satisfies the current
       * schema. Surfaced honestly instead of composing partial data.
       */
      readonly kind: "published-invalid";
      readonly detail: string;
    };

export interface ProjectWorkspaceStoreShape {
  /**
   * Marker-gated read for one Project. Returns nothing canonical unless a
   * valid current-version publication marker for EXACTLY this Project exists
   * and every staged slice decodes and belongs to this Project.
   */
  readonly readProjectWorkspace: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<ProjectWorkspaceReadResult, ProjectWorkspaceStoreError>;

  /**
   * The already-written destination payload for one Project (marker + staged
   * slice payloads as raw JSON), for shared-policy precedence inspection.
   */
  readonly readPublishedTarget: (input: { readonly projectId: ProjectId }) => Effect.Effect<
    {
      readonly publicationMarker: unknown;
      readonly stagedSlices: ReadonlyArray<unknown>;
    },
    ProjectWorkspaceStoreError
  >;

  /**
   * Transactionally stage every destination slice then insert the publication
   * marker LAST, in ONE SQLite transaction (Decision 0002 F.2/F.4). Either the
   * complete boundary payload plus its marker commits, or nothing does.
   *
   * Every slice is validated against its WP1 contract schema first; a payload
   * that is not exactly one complete current-version set for this Project
   * fails closed before any write.
   */
  readonly stageAndPublish: (input: {
    readonly projectId: ProjectId;
    readonly slices: ReadonlyArray<ProjectWorkspaceSlice>;
    readonly publishedAt: string;
    readonly provenance: ProjectWorkspaceMigrationProvenance | null;
  }) => Effect.Effect<void, ProjectWorkspaceStoreError | ProjectWorkspaceStagingInvalidError>;

  /**
   * Delete every persisted workspace slice AND the publication marker for one
   * Project (WP4 Project-deletion settlement). Idempotent: deleting an absent
   * Project workspace is a no-op success.
   *
   * Runs on the caller's current SQL transaction context WITHOUT opening its
   * own transaction: the orchestration engine calls this INSIDE the same
   * transaction that persists `project.deleted`, so the workspace delete and
   * the deletion event commit — or roll back — atomically.
   */
  readonly deleteProjectWorkspace: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<void, ProjectWorkspaceStoreError>;
}

export class ProjectWorkspaceStore extends ServiceMap.Service<
  ProjectWorkspaceStore,
  ProjectWorkspaceStoreShape
>()("synara/projectWorkspace/Services/ProjectWorkspaceStore/ProjectWorkspaceStore") {}

/** Slice kinds this store persists, in canonical stage order (WP2). */
export const PROJECT_WORKSPACE_STORE_SLICE_KINDS = [
  "right-dock",
  "terminal-presentation",
  "browser",
  "browser-annotations",
  "device",
] as const;

export const PROJECT_WORKSPACE_STORE_SCHEMA_VERSION = PROJECT_WORKSPACE_SCHEMA_VERSION;
