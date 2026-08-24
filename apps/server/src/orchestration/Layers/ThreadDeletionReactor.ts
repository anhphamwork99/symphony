import { ProjectId, ThreadId, type OrchestrationEvent } from "@synara/contracts";
import { makeDrainableWorker, startDrainableWorkerProducers } from "@synara/shared/DrainableWorker";
import { Cause, Effect, Layer, Option, Stream } from "effect";

import { DeviceService } from "../../device/Services/DeviceService";
import { ProfileStatsArchive } from "../../profileStatsArchive";
import { ProviderService } from "../../provider/Services/ProviderService";
import { TerminalManager } from "../../terminal/Services/Manager";
import { ProjectWorkspaceStore } from "../../projectWorkspace/Services/ProjectWorkspaceStore";
import { THREAD_RETENTION_COMMAND_ID_PREFIX } from "../../threadRetention";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import {
  ThreadDeletionReactor,
  type ThreadDeletionReactorShape,
} from "../Services/ThreadDeletionReactor";

type ThreadDeletedEvent = Extract<OrchestrationEvent, { type: "thread.deleted" }>;
type ThreadArchivedEvent = Extract<OrchestrationEvent, { type: "thread.archived" }>;
type ProjectDeletedEvent = Extract<OrchestrationEvent, { type: "project.deleted" }>;
type ThreadLifecycleCleanupEvent = ThreadDeletedEvent | ThreadArchivedEvent;

// Crash recovery / backfill: threads soft-deleted before the purge could run
// (or before purge existed) are archived and purged shortly after startup.
const PURGE_STARTUP_SWEEP_DELAY_MS = 60 * 1000;
const THREAD_LIFECYCLE_REACTOR_CAPACITY = 64;
const PURGE_FENCE_RETRY_ATTEMPTS = 20;
const PURGE_FENCE_RETRY_DELAY_MS = 100;
const ARCHIVE_CLEANUP_RETRY_ATTEMPTS = 5;
const ARCHIVE_CLEANUP_RETRY_DELAY_MS = 100;

const MISSING_PROVIDER_BINDING_DETAIL = "no persisted provider binding exists";

export function isThreadLifecycleCleanupEvent(
  event: OrchestrationEvent,
): event is ThreadLifecycleCleanupEvent {
  return event.type === "thread.deleted" || event.type === "thread.archived";
}

export function isProjectDeletedEvent(event: OrchestrationEvent): event is ProjectDeletedEvent {
  return event.type === "project.deleted";
}

export function isThreadCurrentlyArchived(
  thread: { readonly archivedAt?: string | null | undefined } | undefined,
): boolean {
  return thread?.archivedAt !== null && thread?.archivedAt !== undefined;
}

export const logCleanupCauseUnlessInterrupted = <R, E>({
  effect,
  message,
  threadId,
}: {
  readonly effect: Effect.Effect<void, E, R>;
  readonly message: string;
  readonly threadId: ThreadDeletedEvent["payload"]["threadId"];
}): Effect.Effect<void, E, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logDebug(message, {
        threadId,
        cause: Cause.pretty(cause),
      });
    }),
  );

export const cleanupSucceededUnlessInterrupted = <R, E>({
  effect,
  message,
  threadId,
}: {
  readonly effect: Effect.Effect<void, E, R>;
  readonly message: string;
  readonly threadId: ThreadDeletedEvent["payload"]["threadId"];
}): Effect.Effect<boolean, E, R> =>
  effect.pipe(
    Effect.as(true),
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logDebug(message, {
        threadId,
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(false));
    }),
  );

export const detachThreadDevice = (threadId: ThreadId) =>
  Effect.service(DeviceService).pipe(
    Effect.flatMap((service) =>
      Effect.promise(() => service.manager.handleThreadRemoved(threadId)).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logDebug("thread lifecycle cleanup skipped device detach", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
    ),
  );

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const profileStatsArchive = yield* ProfileStatsArchive;
  const providerService = yield* ProviderService;
  const terminalManager = yield* TerminalManager;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  // Optional: the Project workspace store participates only in the
  // idempotent postcondition cleanup below; engine-transactional deletion is
  // the primary path and does not depend on this reactor.
  const projectWorkspaceStore = Option.getOrUndefined(
    yield* Effect.serviceOption(ProjectWorkspaceStore),
  );

  const refreshCommandReadModelAfterPurge = (threadId: string) =>
    orchestrationEngine.refreshCommandReadModel().pipe(
      Effect.asVoid,
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("thread deletion cleanup could not refresh command read model", {
          threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const stopProviderSessionWithoutBinding = (
    threadId: ThreadDeletedEvent["payload"]["threadId"],
    cause: Cause.Cause<unknown>,
  ) =>
    Effect.logDebug("thread deletion cleanup found no provider session to stop", {
      threadId,
      cause: Cause.pretty(cause),
    }).pipe(Effect.as(true));

  const stopProviderSession = Effect.fn(function* (
    threadId: ThreadDeletedEvent["payload"]["threadId"],
  ) {
    return yield* providerService.stopSession({ threadId }).pipe(
      Effect.as(true),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        if (Cause.pretty(cause).includes(MISSING_PROVIDER_BINDING_DETAIL)) {
          return stopProviderSessionWithoutBinding(threadId, cause);
        }
        return Effect.logDebug("thread deletion cleanup skipped provider session stop", {
          threadId,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(false));
      }),
    );
  });

  const closeThreadTerminals = (
    threadId: ThreadDeletedEvent["payload"]["threadId"],
    deleteHistory: boolean,
    openedAtOrBefore?: string,
  ) =>
    cleanupSucceededUnlessInterrupted({
      effect:
        openedAtOrBefore === undefined
          ? terminalManager.close({ threadId, deleteHistory })
          : terminalManager.closeSessionsOpenedAtOrBefore({
              threadId,
              openedAtOrBefore,
            }),
      message: "thread lifecycle cleanup skipped terminal close",
      threadId,
    });

  const waitForThreadPurgeFence = Effect.fn(function* (
    threadId: ThreadDeletedEvent["payload"]["threadId"],
  ) {
    for (let attempt = 0; attempt < PURGE_FENCE_RETRY_ATTEMPTS; attempt += 1) {
      const fenced = yield* profileStatsArchive.hasThreadPurgeFence({ threadId });
      if (!fenced) return true;
      yield* Effect.sleep(PURGE_FENCE_RETRY_DELAY_MS);
    }
    yield* Effect.logWarning("thread deletion retained unresolved provider delivery evidence", {
      threadId,
    });
    return false;
  });

  // Legacy retention deletes only hid the thread (their rows kept feeding
  // profile stats directly). Explicit deletes snapshot the stat aggregates and
  // then hard-delete the thread's rows so disk space is actually reclaimed.
  const purgeThreadData = (event: ThreadDeletedEvent) => {
    if (event.commandId?.startsWith(THREAD_RETENTION_COMMAND_ID_PREFIX)) {
      return Effect.void;
    }
    return waitForThreadPurgeFence(event.payload.threadId).pipe(
      Effect.flatMap((canPurge) =>
        canPurge
          ? profileStatsArchive.purgeThreadWithStatsSnapshot({
              threadId: event.payload.threadId,
            })
          : Effect.succeed(false),
      ),
      Effect.flatMap((purged) =>
        purged ? refreshCommandReadModelAfterPurge(event.payload.threadId) : Effect.void,
      ),
      Effect.catch((error) =>
        // A failed purge leaves the thread soft-deleted; the startup sweep
        // retries it on the next boot.
        Effect.logWarning("thread deletion cleanup skipped stats archive purge", {
          threadId: event.payload.threadId,
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
  };

  const cleanupThreadBeforePurge = Effect.fn(function* (
    threadId: ThreadDeletedEvent["payload"]["threadId"],
  ) {
    const providerCleanupSucceeded = yield* stopProviderSession(threadId);
    const terminalCleanupSucceeded = yield* closeThreadTerminals(threadId, true);
    return providerCleanupSucceeded && terminalCleanupSucceeded;
  });

  const cleanupArchivedThread = Effect.fn(function* (event: ThreadArchivedEvent) {
    const threadId = event.payload.threadId;
    for (let attempt = 1; attempt <= ARCHIVE_CLEANUP_RETRY_ATTEMPTS; attempt += 1) {
      // The archive cleanup worker is asynchronous. An undo may already have
      // projected thread.unarchived and opened a replacement terminal while
      // this older event was waiting in the queue. Re-read authoritative state
      // before every close attempt so stale archive work cannot kill it.
      const currentThread = Option.getOrUndefined(
        yield* projectionSnapshotQuery.getThreadShellById(threadId),
      );
      if (!isThreadCurrentlyArchived(currentThread)) {
        yield* Effect.logDebug("thread archive cleanup ignored stale archive event", {
          threadId,
          archivedAt: event.payload.archivedAt,
        });
        return;
      }
      yield* detachThreadDevice(threadId);
      const terminalCleanupSucceeded = yield* closeThreadTerminals(
        threadId,
        false,
        event.payload.archivedAt,
      );
      if (terminalCleanupSucceeded) return;
      if (attempt < ARCHIVE_CLEANUP_RETRY_ATTEMPTS) {
        yield* Effect.sleep(ARCHIVE_CLEANUP_RETRY_DELAY_MS);
      }
    }
    yield* Effect.logWarning("thread archive cleanup exhausted retries", {
      threadId,
      attempts: ARCHIVE_CLEANUP_RETRY_ATTEMPTS,
    });
  });

  const processThreadDeleted = Effect.fn(function* (event: ThreadDeletedEvent) {
    const { threadId } = event.payload;
    yield* detachThreadDevice(threadId);
    const cleanupSucceeded = yield* cleanupThreadBeforePurge(threadId);
    if (!cleanupSucceeded) {
      yield* Effect.logWarning("thread deletion cleanup deferred stats archive purge", {
        threadId,
      });
      return;
    }
    yield* purgeThreadData(event);
  });

  /**
   * WP4 (Decision 0002): `project.deleted` post-event handling. The PRIMARY
   * settlement already happened pre-commit inside the engine (settle before
   * the command commits; workspace rows deleted in the same transaction as
   * the event). This worker only enforces the postcondition idempotently:
   * any Project terminal session that somehow outlived the commit is settled
   * again (a truthful no-op when none remain) and any residual workspace rows
   * are deleted. It never runs BEFORE deletion and never deletes state for a
   * Project that was not already deleted.
   */
  const processProjectDeleted = Effect.fn(function* (event: ProjectDeletedEvent) {
    const projectId = ProjectId.makeUnsafe(event.payload.projectId);
    // WP5 (Decision 0002): settle the deleted Project's device attachment
    // AFTER the committed deletion (the same postcondition position as the
    // terminal settlement above). Idempotent and scoped to this one Project:
    // detaching clears the attachment truthfully and every OTHER Project's
    // attachment is untouched. A device Synara booted that no other workspace
    // still watches falls back to the normal idle ladder inside the manager.
    yield* Effect.service(DeviceService).pipe(
      Effect.flatMap((service) =>
        Effect.promise(() => service.manager.handleProjectRemoved(projectId)),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("project deletion device attachment cleanup skipped", {
          projectId,
          cause: Cause.pretty(cause),
        });
      }),
    );
    const residuals = yield* Effect.result(terminalManager.settleProjectTerminals({ projectId }));
    if (residuals._tag === "Failure") {
      yield* Effect.logWarning("project deletion postcondition terminal settlement failed", {
        projectId,
        failure:
          residuals.failure instanceof Error
            ? residuals.failure.message
            : String(residuals.failure),
      });
      return;
    }
    for (const result of residuals.success) {
      if (result.outcome !== "settled") {
        yield* Effect.logWarning(
          "project deletion postcondition settlement reported an unproven residual terminal",
          {
            projectId,
            terminalId: result.terminalId,
            outcome: result.outcome,
            detail: result.detail,
          },
        );
      }
    }
    if (projectWorkspaceStore === undefined) {
      return;
    }
    yield* projectWorkspaceStore.deleteProjectWorkspace({ projectId }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("project deletion postcondition workspace cleanup skipped", {
          projectId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  });

  const processThreadLifecycleEvent = (event: ThreadLifecycleCleanupEvent) =>
    event.type === "thread.deleted" ? processThreadDeleted(event) : cleanupArchivedThread(event);

  type LifecycleCleanupEvent = ThreadLifecycleCleanupEvent | ProjectDeletedEvent;

  const processLifecycleEventSafely = (event: LifecycleCleanupEvent) =>
    (isProjectDeletedEvent(event)
      ? processProjectDeleted(event)
      : processThreadLifecycleEvent(event)
    ).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("thread lifecycle cleanup reactor failed to process event", {
          eventType: event.type,
          projectId: isProjectDeletedEvent(event) ? event.payload.projectId : undefined,
          threadId: !isProjectDeletedEvent(event) ? event.payload.threadId : undefined,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processLifecycleEventSafely, {
    capacity: THREAD_LIFECYCLE_REACTOR_CAPACITY,
  });

  const start: ThreadDeletionReactorShape["start"] = Effect.fn(() =>
    startDrainableWorkerProducers(
      worker,
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
            if (!isThreadLifecycleCleanupEvent(event) && !isProjectDeletedEvent(event)) {
              return Effect.void;
            }
            return worker.enqueue(event);
          }),
        );
        yield* Effect.forkScoped(
          Effect.sleep(PURGE_STARTUP_SWEEP_DELAY_MS).pipe(
            Effect.flatMap(() =>
              profileStatsArchive.purgeSoftDeletedManualThreads({
                beforePurge: (threadId) =>
                  cleanupThreadBeforePurge(ThreadId.makeUnsafe(threadId)).pipe(
                    Effect.flatMap((cleaned) =>
                      cleaned
                        ? waitForThreadPurgeFence(ThreadId.makeUnsafe(threadId))
                        : Effect.succeed(false),
                    ),
                  ),
              }),
            ),
            Effect.tap((purgedCount) =>
              purgedCount > 0 ? refreshCommandReadModelAfterPurge("startup-sweep") : Effect.void,
            ),
            Effect.flatMap((purgedCount) =>
              purgedCount > 0
                ? Effect.logInfo("purged soft-deleted threads after stats archive snapshot", {
                    purgedCount,
                  })
                : Effect.void,
            ),
            Effect.catch((error) =>
              Effect.logWarning("startup purge sweep for deleted threads failed", {
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
          ),
        );
      }),
    ),
  );

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadDeletionReactorShape;
});

export const ThreadDeletionReactorLive = Layer.effect(ThreadDeletionReactor, make);
