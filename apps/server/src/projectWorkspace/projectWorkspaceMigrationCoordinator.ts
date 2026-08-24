// FILE: projectWorkspaceMigrationCoordinator.ts
// Purpose: Coordinate the per-Project staged publication of Project-owned
//          Right-sidebar workspace state: snapshot → shared pure policy →
//          transactional staging → marker-last publication (WP3, Decision 0002).
// Layer: Server coordinator (no runtime terminal/browser/device ownership).
// Depends on: @synara/shared/projectWorkspaceMigration (the single pure
//   policy), the ProjectWorkspaceStore persistence service, and a durable
//   Thread/Project metadata snapshot seam.
//
// The v1 legacy slices live in web/desktop localStorage, NOT the server
// database; they reach this coordinator through the explicit
// `legacySlicesByThreadId` input. The durable snapshot seam supplies Thread
// metadata (projectId, updatedAt, deletedAt, archivedAt) from
// `projection_threads`, and Projects from `projection_projects`.
//
// Process Projects INDEPENDENTLY: one Project's failure never publishes or
// blocks another Project's target (Decision 0002 F.8). A failure before the
// marker leaves the target unpublished and retryable; retry re-derives the
// same deterministic target and converges.

import type { ProjectId, ThreadId } from "@synara/contracts";
import { Effect, Layer, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../persistence/Errors.ts";
import {
  planProjectWorkspaceMigration,
  type LegacyProjectWorkspaceThreadSlicesInput,
  type ProjectWorkspaceMigrationPlan,
} from "@synara/shared/projectWorkspaceMigration";
import { ProjectWorkspaceStore } from "./Services/ProjectWorkspaceStore.ts";
import { ProjectWorkspaceStoreLive } from "./Layers/ProjectWorkspaceStore.ts";

// ── Snapshot types ───────────────────────────────────────────────────

/** Durable orchestration metadata for one Thread, read before selection. */
export interface ProjectWorkspaceThreadSnapshot {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly archivedAt: string | null;
}

/** One Project's complete migration input: threads plus their v1 slices. */
export interface ProjectWorkspaceProjectSnapshot {
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<{
    readonly metadata: ProjectWorkspaceThreadSnapshot;
    readonly slices: LegacyProjectWorkspaceThreadSlicesInput;
  }>;
}

/** Deterministic publication clock supplied by the coordinator boundary. */
export interface ProjectWorkspaceClock {
  readonly now: () => string;
}

/** A test seam injected between staging and the marker insert. */
export interface ProjectWorkspacePublicationHooks {
  /**
   * Runs after the shared policy has derived the target but before the
   * transaction that stages slices and inserts the marker. A failing effect
   * aborts publication for THIS Project only, leaving nothing durable.
   */
  readonly beforePublication?: (
    input: ProjectWorkspaceProjectSnapshot,
    plan: ProjectWorkspaceMigrationPlan,
  ) => Effect.Effect<void, unknown>;
}

export type ProjectWorkspaceMigrationProjectOutcome =
  | { readonly kind: "kept-published" }
  | { readonly kind: "published"; readonly winnerThreadId: ThreadId | null }
  | { readonly kind: "failed"; readonly reason: string };

// ── Coordinator service ──────────────────────────────────────────────

export interface ProjectWorkspaceMigrationCoordinatorShape {
  /**
   * Snapshot every Project's Threads from durable projection state, pair them
   * with the caller-supplied legacy v1 slices, and run the staged publication
   * independently per Project. Never throws for one Project's failure: that
   * Project reports `failed` and every other Project still publishes.
   */
  readonly migrateAllProjects: (input: {
    readonly legacySlicesByThreadId: ReadonlyMap<ThreadId, LegacyProjectWorkspaceThreadSlicesInput>;
    readonly projectIds?: ReadonlyArray<ProjectId>;
  }) => Effect.Effect<
    ReadonlyArray<{
      readonly projectId: ProjectId;
      readonly outcome: ProjectWorkspaceMigrationProjectOutcome;
    }>
  >;
}

/** Coordinator service tag; composed per server (options via the Live layer factory). */
export class ProjectWorkspaceMigrationCoordinator extends ServiceMap.Service<
  ProjectWorkspaceMigrationCoordinator,
  ProjectWorkspaceMigrationCoordinatorShape
>()("synara/projectWorkspace/ProjectWorkspaceMigrationCoordinator") {}

/** A stable diagnostic string for any per-Project failure cause. */
const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
};

export const makeProjectWorkspaceMigrationCoordinator = (options?: {
  readonly clock?: ProjectWorkspaceClock;
  readonly hooks?: ProjectWorkspacePublicationHooks;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* ProjectWorkspaceStore;
    const clock = options?.clock ?? { now: () => new Date().toISOString() };
    const hooks = options?.hooks ?? {};

    const snapshotProjectIds = (filter?: ReadonlyArray<ProjectId>) =>
      sql<{ readonly projectId: ProjectId }>`
        SELECT project_id AS "projectId"
        FROM projection_projects
        WHERE deleted_at IS NULL
        ${filter === undefined ? sql`` : sql`AND project_id IN ${sql.in([...filter])}`}
        ORDER BY project_id ASC
      `;

    const snapshotThreads = (projectId: ProjectId) =>
      sql<{
        readonly threadId: ThreadId;
        readonly projectId: ProjectId;
        readonly updatedAt: string;
        readonly deletedAt: string | null;
        readonly archivedAt: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          archived_at AS "archivedAt"
        FROM projection_threads
        WHERE project_id = ${projectId}
        ORDER BY thread_id ASC
      `;

    const migrateProject = (
      snapshot: ProjectWorkspaceProjectSnapshot,
    ): Effect.Effect<ProjectWorkspaceMigrationProjectOutcome, never> =>
      Effect.gen(function* () {
        const publishedTarget = yield* store.readPublishedTarget({
          projectId: snapshot.projectId,
        });

        const plan = planProjectWorkspaceMigration({
          projectId: snapshot.projectId,
          threads: snapshot.threads.map((thread) => ({
            threadId: thread.metadata.threadId,
            projectId: thread.metadata.projectId,
            updatedAt: thread.metadata.updatedAt,
            deletedAt: thread.metadata.deletedAt,
            archivedAt: thread.metadata.archivedAt,
            slices: thread.slices,
          })),
          publishedTarget,
        });

        if (plan.outcome === "keep-published") {
          return { kind: "kept-published" } as const;
        }

        const beforePublication = hooks.beforePublication?.(snapshot, plan) ?? Effect.void;
        yield* beforePublication;

        yield* store.stageAndPublish({
          projectId: snapshot.projectId,
          slices: plan.target.stagedEntries.map((entry) => entry.slice),
          publishedAt: clock.now(),
          provenance: plan.target.provenance,
        });

        return {
          kind: "published",
          winnerThreadId: plan.outcome === "migrate-legacy-winner" ? plan.winnerThreadId : null,
        } as const;
      }).pipe(
        Effect.catch((cause) =>
          Effect.succeed({
            kind: "failed" as const,
            reason: describeFailure(cause),
          }),
        ),
      );

    const migrateAllProjects: ProjectWorkspaceMigrationCoordinatorShape["migrateAllProjects"] = (
      input,
    ) =>
      Effect.gen(function* () {
        const projectRows = yield* snapshotProjectIds(
          input.projectIds === undefined || input.projectIds.length === 0
            ? undefined
            : [...input.projectIds],
        ).pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "ProjectWorkspaceMigrationCoordinator.migrateAllProjects:snapshotProjects",
            ),
          ),
          Effect.orDie,
        );

        const results: Array<{
          readonly projectId: ProjectId;
          readonly outcome: ProjectWorkspaceMigrationProjectOutcome;
        }> = [];

        for (const { projectId } of projectRows) {
          // A per-Project Thread-snapshot failure is isolated to THIS Project
          // (Decision 0002 F.8): it reports `failed` and every later Project
          // still processes, instead of orDie-ing the whole migration run.
          const threadRowsResult = yield* Effect.result(
            snapshotThreads(projectId).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "ProjectWorkspaceMigrationCoordinator.migrateAllProjects:snapshotThreads",
                ),
              ),
            ),
          );

          if (threadRowsResult._tag === "Failure") {
            results.push({
              projectId,
              outcome: {
                kind: "failed",
                reason: describeFailure(threadRowsResult.failure),
              },
            });
            continue;
          }
          const threadRows = threadRowsResult.success;

          const snapshot: ProjectWorkspaceProjectSnapshot = {
            projectId,
            threads: threadRows.map((row) => ({
              metadata: row,
              slices:
                input.legacySlicesByThreadId.get(row.threadId) ??
                ({} satisfies LegacyProjectWorkspaceThreadSlicesInput),
            })),
          };

          results.push({
            projectId,
            outcome: yield* migrateProject(snapshot),
          });
        }

        return results;
      });

    return { migrateAllProjects } satisfies ProjectWorkspaceMigrationCoordinatorShape;
  });

/** Compose the coordinator service over its store + SQLite dependencies. */
export const ProjectWorkspaceMigrationCoordinatorLive = Layer.effect(
  ProjectWorkspaceMigrationCoordinator,
  makeProjectWorkspaceMigrationCoordinator(),
).pipe(Layer.provideMerge(ProjectWorkspaceStoreLive));

/** Test/composition variant carrying explicit clock/hooks options. */
export const makeProjectWorkspaceMigrationCoordinatorLayer = (options?: {
  readonly clock?: ProjectWorkspaceClock;
  readonly hooks?: ProjectWorkspacePublicationHooks;
}) =>
  Layer.effect(
    ProjectWorkspaceMigrationCoordinator,
    makeProjectWorkspaceMigrationCoordinator(options),
  ).pipe(Layer.provideMerge(ProjectWorkspaceStoreLive));
