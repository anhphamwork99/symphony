// FILE: projectWorkspaceActivation.ts
// Purpose: Activate the Project-owned Right-sidebar workspace in the web app:
//          run the v1→v2 localStorage migration per Project (marker-gated), then
//          apply the published slices into the live stores exactly once per
//          Project per session. Published Project data wins; an unpublished or
//          incomplete stage never activates.
// Layer: Web workspace activation (WP6)
// Depends on: projectWorkspaceWebMigration, rightDockStore, terminalStateStore.

import { type ProjectId, type ThreadId } from "@synara/contracts";
import type { LegacyProjectWorkspaceThreadInput } from "@synara/shared/projectWorkspaceMigration";

import { useRightDockStore } from "./rightDockStore";
import { useTerminalStateStore } from "./terminalStateStore";
import { dockTerminalProjectScope } from "./lib/dockTerminalScope";
import {
  migrateProjectWorkspaceOnWeb,
  readPublishedProjectWorkspace,
  type ProjectWorkspaceWebStorage,
} from "./projectWorkspaceWebMigration";

/** Thread metadata the migration policy needs, projected from the app store. */
export interface ProjectWorkspaceThreadSnapshot {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly updatedAt: string | null;
  readonly deletedAt: string | null;
  readonly archivedAt: string | null;
}

function toPolicyThread(thread: ProjectWorkspaceThreadSnapshot): LegacyProjectWorkspaceThreadInput | null {
  // A Thread whose durable `updatedAt` is missing cannot be durably ordered;
  // the policy fails closed for it, so skip it rather than fabricating a stamp.
  if (thread.updatedAt === null) {
    return null;
  }
  return {
    threadId: thread.threadId,
    projectId: thread.projectId,
    updatedAt: thread.updatedAt,
    deletedAt: thread.deletedAt,
    archivedAt: thread.archivedAt,
    slices: {},
  };
}

/** Applied-once bookkeeping so repeated activations stay idempotent. */
const appliedProjects = new Set<ProjectId>();

export interface ProjectWorkspaceActivationResult {
  readonly projectId: ProjectId;
  readonly outcome: "published" | "unpublished" | "already-applied";
  readonly reason?: string;
}

/**
 * Migrate + activate one Project's workspace against the injected storage.
 *
 * Idempotent: a second call for the same Project in the same session is a
 * no-op (`already-applied`), and the boundary itself is marker-gated — a valid
 * published target is never rederived or overwritten.
 */
export function activateProjectWorkspace(input: {
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<ProjectWorkspaceThreadSnapshot>;
  readonly storage: ProjectWorkspaceWebStorage;
  readonly nowIso: string;
}): ProjectWorkspaceActivationResult {
  const { projectId } = input;
  if (appliedProjects.has(projectId)) {
    return { projectId, outcome: "already-applied" };
  }

  const migration = migrateProjectWorkspaceOnWeb({
    projectId,
    threads: input.threads
      .map(toPolicyThread)
      .filter((thread): thread is LegacyProjectWorkspaceThreadInput => thread !== null),
    storage: input.storage,
    nowIso: input.nowIso,
  });
  if (migration.outcome === "unpublished") {
    // Nothing partial activates; the v1 data and the stores stay untouched and
    // the next activation attempt retries from the same snapshot.
    return { projectId, outcome: "unpublished", reason: migration.reason };
  }

  const published = readPublishedProjectWorkspace(projectId, input.storage);
  if (published === null) {
    return { projectId, outcome: "unpublished", reason: "activation-gate-rejected" };
  }

  applyPublishedWorkspace(projectId, published);
  appliedProjects.add(projectId);
  return { projectId, outcome: "published" };
}

/** Map a published v2 workspace into the live stores (Project data wins). */
export function applyPublishedWorkspace(
  projectId: ProjectId,
  published: NonNullable<ReturnType<typeof readPublishedProjectWorkspace>>,
): void {
  useRightDockStore.getState().applyPublishedDockSlice(projectId, {
    open: published.dock.open,
    preferredWidthPx: published.dock.preferredWidthPx,
    panes: published.dock.panes.map((pane) => ({
      id: pane.id,
      kind: pane.kind,
      threadId: pane.threadId,
      diffTurnId: pane.diffTurnId,
      diffFilePath: pane.diffFilePath,
      filePath: pane.filePath,
      pullRequestProjectId: pane.pullRequestProjectId,
      pullRequestRepository: pane.pullRequestRepository,
      pullRequestNumber: pane.pullRequestNumber,
      pullRequestInitialTab: pane.pullRequestInitialTab,
      restorationDiagnostic: pane.restorationDiagnostic ?? null,
    })),
    activePaneId: published.dock.activePaneId,
  });

  const terminalScope = dockTerminalProjectScope(projectId);
  useTerminalStateStore
    .getState()
    .applyPublishedTerminalPresentation(terminalScope, published.terminalPresentation);
}

/** Test hook: forget applied Projects so activation can be re-run in isolation. */
export function resetProjectWorkspaceActivationForTests(): void {
  appliedProjects.clear();
}
