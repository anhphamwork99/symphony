// FILE: desktopProjectWorkspaceActivation.ts
// Purpose: The ONE Desktop activation boundary required by Decision 0004 —
//          every Project browser/annotation operation awaits
//          `ensureProjectWorkspaceActivated(projectId)` before any manager
//          method runs. Activation is lazy (first real ProjectId wins),
//          deduplicated per Project, isolated across Projects, and remembered
//          per manager lifetime so it is never reapplied over live mutations.
// Layer: Desktop main-process orchestration over the durable migration store
//        and DesktopBrowserManager.
// Depends on: desktopProjectWorkspaceMigration (durable publication),
//             browserManager (Desktop-owned slice application).
//
// Invariants (Decision 0004 "Binding decision" / "Publication and manager
// application" / "Failure behavior"):
// - Startup retry and lazy first-use share this one implementation.
// - A valid current publication for the exact Project always wins; without
//   one the honest production legacy input is EMPTY (no durable v1 Desktop
//   manager source exists), so canonical default slices are published.
// - The manager is driven from a freshly READ, freshly VALIDATED publication,
//   never from an in-memory migration result, and never from Thread state.
// - Stage/publication/read/validation/application failure leaves the Project
//   unactivated, blocks the requested operation, retains an actionable
//   per-Project diagnostic, and stays retryable on a later call.

import type { ProjectId } from "@synara/contracts";
import {
  ProjectWorkspaceSlice,
  PROJECT_WORKSPACE_SCHEMA_VERSION,
} from "@synara/contracts";
import {
  isProjectWorkspaceStagingComplete,
  PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS,
  projectWorkspacePublicationMarkerKey,
  projectWorkspaceStagingSliceKey,
} from "@synara/shared/projectWorkspaceMigration";
import { Schema } from "effect";

import type { DesktopBrowserManager } from "./browserManager";
import type { DesktopBrowserAutomationHost } from "./browserAutomation/desktopBrowserAutomationHost";
import {
  collectDesktopProjectWorkspaceProjectIds,
  DesktopProjectWorkspaceMigration,
  readDesktopProjectWorkspaceDocument,
  resolveDesktopProjectWorkspacePath,
  type DesktopProjectWorkspaceReadResult,
} from "./desktopProjectWorkspaceMigration";

/** Error surfaced to the caller when activation cannot complete. */
export class ProjectWorkspaceActivationError extends Error {
  constructor(
    readonly projectId: ProjectId,
    message: string,
  ) {
    super(`Project workspace activation failed for ${String(projectId)}: ${message}`);
    this.name = "ProjectWorkspaceActivationError";
  }
}

/** The Desktop-owned slices one activation may apply to the manager. */
export interface ProjectWorkspaceActivationInput {
  readonly projectId: ProjectId;
  readonly browser: {
    readonly open: boolean;
    readonly activeTabId: string | null;
    readonly tabs: ReadonlyArray<{ readonly id: string; readonly url: string; readonly title: string }>;
  };
  readonly annotations: ReadonlyArray<{
    readonly id: string;
    readonly tabId: string;
    readonly ordinal: number;
    readonly documentKey: string;
  }>;
}

export interface DesktopProjectWorkspaceActivationOptions {
  /** Test seam injected into every durable publication attempt. */
  readonly beforePublish?: (projectId: ProjectId) => void;
  /** Test seam observing each manager application. */
  readonly beforeApply?: (input: ProjectWorkspaceActivationInput) => void;
}

export interface DesktopProjectWorkspaceStartupActivationOutcome {
  /** One entry per document-known Project the startup pass attempted. */
  readonly results: ReadonlyArray<{
    readonly projectId: ProjectId;
    readonly status: "activated" | "failed";
    readonly diagnostic: string | null;
  }>;
  /** Diagnostic when the durable document itself could not be processed. */
  readonly diagnostic: string | null;
}

interface ActivationAttempt {
  readonly projectId: ProjectId;
}

function decodeSlice(raw: unknown): ProjectWorkspaceSlice | null {
  try {
    return Schema.decodeUnknownSync(ProjectWorkspaceSlice)(raw);
  } catch {
    return null;
  }
}

/**
 * Freshly validate one published read: current schema on every slice, the
 * exact Project on every slice, and the complete five-slice set with no
 * mixed, malformed, missing, or duplicated kinds. Returns the decoded slices
 * in canonical order, or a diagnostic explaining the first violation.
 */
function validatePublishedSlices(
  read: DesktopProjectWorkspaceReadResult,
): { readonly slices: ReadonlyArray<ProjectWorkspaceSlice> } | { readonly diagnostic: string } {
  if (read.status !== "published-current") {
    return {
      diagnostic:
        read.diagnostic ??
        "Project workspace publication is unavailable; activation is retryable.",
    };
  }
  const byKind = new Map<string, ProjectWorkspaceSlice>();
  for (const raw of read.slices) {
    const slice = decodeSlice(raw);
    if (slice === null) {
      return {
        diagnostic: `Project workspace publication has a malformed or stale slice; expected schema version ${PROJECT_WORKSPACE_SCHEMA_VERSION}.`,
      };
    }
    if (String(slice.projectId) !== String(read.projectId)) {
      return {
        diagnostic: "Project workspace publication contains another Project's slice.",
      };
    }
    if (byKind.has(slice.slice)) {
      return {
        diagnostic: "Project workspace publication contains a duplicated slice kind.",
      };
    }
    byKind.set(slice.slice, slice);
  }
  if (
    !isProjectWorkspaceStagingComplete(
      PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS.map((kind) => byKind.get(kind)),
      read.projectId,
    )
  ) {
    return {
      diagnostic: "Project workspace publication is incomplete; activation is retryable.",
    };
  }
  return {
    slices: PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS.map(
      (kind) => byKind.get(kind) as ProjectWorkspaceSlice,
    ),
  };
}

/** Map validated published slices onto the manager application input. */
function activationInputFromSlices(
  projectId: ProjectId,
  slices: ReadonlyArray<ProjectWorkspaceSlice>,
): ProjectWorkspaceActivationInput {
  const browser = slices.find(
    (slice): slice is Extract<ProjectWorkspaceSlice, { slice: "browser" }> =>
      slice.slice === "browser",
  );
  const annotations = slices.find(
    (slice): slice is Extract<ProjectWorkspaceSlice, { slice: "browser-annotations" }> =>
      slice.slice === "browser-annotations",
  );
  // Both kinds are structurally required by validatePublishedSlices; the
  // non-null assertions are that completeness guarantee, not an assumption.
  const browserSlice = browser as Extract<ProjectWorkspaceSlice, { slice: "browser" }>;
  const annotationSlice = annotations as Extract<
    ProjectWorkspaceSlice,
    { slice: "browser-annotations" }
  >;
  return {
    projectId,
    browser: {
      open: browserSlice.open,
      activeTabId: browserSlice.activeTabId,
      tabs: browserSlice.tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title })),
    },
    // Durable markers are a projection stub (id/tabId/ordinal/documentKey).
    // Restoring them fabricates no live marker, session, or runtime.
    annotations: annotationSlice.markers.map((marker) => ({
      id: marker.id,
      tabId: marker.tabId,
      ordinal: marker.ordinal,
      documentKey: marker.documentKey,
    })),
  };
}

export class DesktopProjectWorkspaceActivation {
  /** Projects whose activation succeeded in this manager lifetime. */
  private readonly activatedProjects = new Set<string>();
  /** Projects with an activation attempt in flight; concurrent first calls share it. */
  private readonly inFlightByProject = new Map<string, Promise<void>>();
  /** Projects whose committed deletion is terminal for this activation lifetime. */
  private readonly deletedProjectIds = new Set<string>();
  /** Project deletion work is serialized independently per Project. */
  private readonly removalInFlightByProject = new Map<string, Promise<void>>();
  /** Last retained diagnostic per Project (cleared on success). */
  private readonly diagnosticsByProject = new Map<string, string>();

  constructor(
    private readonly filePath: string,
    private readonly browserManager: DesktopBrowserManager,
    private readonly options: DesktopProjectWorkspaceActivationOptions = {},
  ) {
    for (const projectId of Object.keys(readDesktopProjectWorkspaceDocument(filePath).tombstones)) {
      this.deletedProjectIds.add(projectId);
    }
  }

  static forUserDataPath(
    userDataPath: string,
    browserManager: DesktopBrowserManager,
    options?: DesktopProjectWorkspaceActivationOptions,
  ): DesktopProjectWorkspaceActivation {
    return new DesktopProjectWorkspaceActivation(
      resolveDesktopProjectWorkspacePath(userDataPath),
      browserManager,
      options,
    );
  }

  /** The durable document path backing this activation boundary. */
  get storePath(): string {
    return this.filePath;
  }

  /** Last retained diagnostic for one Project, or null after success. */
  diagnosticFor(projectId: ProjectId): string | null {
    return this.diagnosticsByProject.get(String(projectId)) ?? null;
  }

  /** Has this Project completed activation in this manager lifetime? */
  isActivated(projectId: ProjectId): boolean {
    return this.activatedProjects.has(String(projectId));
  }

  /**
   * The activation boundary itself. Resolves only when the Project's
   * published workspace has been freshly read, validated, and completely
   * applied to the manager; rejects with a Project-scoped diagnostic
   * otherwise. Concurrent callers for one Project share one attempt;
   * Projects activate independently.
   */
  async ensureProjectWorkspaceActivated(projectId: ProjectId): Promise<void> {
    const key = String(projectId);
    this.assertProjectNotDeleted(projectId);
    if (this.activatedProjects.has(key)) {
      return;
    }
    const inFlight = this.inFlightByProject.get(key);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const attempt: Promise<void> = Promise.resolve()
      .then(() => this.runActivation({ projectId }))
      .finally(() => {
        this.inFlightByProject.delete(key);
      });
    this.inFlightByProject.set(key, attempt);
    return attempt;
  }

  /**
   * Startup pass (Decision 0004 item 1): retry only the Project IDs the
   * durable document already names — staged keys, publication markers, or
   * per-Project diagnostics — using the SAME activation implementation and
   * invariants as lazy first use. Never throws; one Project's failure never
   * blocks another, and no Project ID is ever invented.
   */
  async activateKnownProjects(): Promise<DesktopProjectWorkspaceStartupActivationOutcome> {
    let projectIds: ReadonlyArray<ProjectId>;
    try {
      projectIds = collectDesktopProjectWorkspaceProjectIds(
        readDesktopProjectWorkspaceDocument(this.filePath),
      );
    } catch (error) {
      return {
        results: [],
        diagnostic:
          error instanceof Error
            ? error.message
            : "Desktop Project workspace store is unavailable.",
      };
    }
    const results: Array<DesktopProjectWorkspaceStartupActivationOutcome["results"][number]> = [];
    for (const projectId of projectIds) {
      try {
        await this.ensureProjectWorkspaceActivated(projectId);
        results.push({ projectId, status: "activated", diagnostic: null });
      } catch (error) {
        results.push({
          projectId,
          status: "failed",
          diagnostic: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { results, diagnostic: null };
  }

  /**
   * Project deletion invalidation (Decision 0004 item 8): clears only this
   * Project's activation bookkeeping so a recreated Project re-activates from
   * its (new) publication. Manager state clearing is owned by
   * DesktopBrowserManager.handleProjectRemoved.
   */
  forgetProject(projectId: ProjectId): void {
    const key = String(projectId);
    this.activatedProjects.delete(key);
    if (!this.deletedProjectIds.has(key)) {
      this.diagnosticsByProject.delete(key);
    }
    // Deliberately leaves any in-flight attempt alone: it observes the same
    // attempt the caller that started it observes (failure behavior).
  }

  /**
   * Terminal deletion boundary. The in-memory fence is set synchronously so a
   * concurrent or subsequent activation cannot pass its next gate. Durable
   * cleanup waits for the Project's current activation, then persists the
   * tombstone before clearing manager state.
   */
  async handleProjectRemoved(
    projectId: ProjectId,
    deletedAt = new Date().toISOString(),
  ): Promise<void> {
    const key = String(projectId);
    this.deletedProjectIds.add(key);
    const existingRemoval = this.removalInFlightByProject.get(key);
    if (existingRemoval !== undefined) {
      return existingRemoval;
    }
    const currentActivation = this.inFlightByProject.get(key);
    const removal = (currentActivation?.catch(() => undefined) ?? Promise.resolve())
      .then(() => {
        const migration = new DesktopProjectWorkspaceMigration(this.filePath);
        migration.deleteProject(projectId, deletedAt);
        this.activatedProjects.delete(key);
        this.diagnosticsByProject.delete(key);
        this.browserManager.handleProjectRemoved(projectId);
      })
      .finally(() => {
        this.removalInFlightByProject.delete(key);
      });
    this.removalInFlightByProject.set(key, removal);
    return removal;
  }

  private assertProjectNotDeleted(projectId: ProjectId): void {
    const key = String(projectId);
    if (!this.deletedProjectIds.has(key)) {
      const durableTombstone = readDesktopProjectWorkspaceDocument(this.filePath).tombstones[key];
      if (durableTombstone !== undefined) {
        this.deletedProjectIds.add(key);
      }
    }
    if (this.deletedProjectIds.has(key)) {
      throw new ProjectWorkspaceActivationError(
        projectId,
        "Project workspace has been permanently deleted.",
      );
    }
  }

  private async runActivation(attempt: ActivationAttempt): Promise<void> {
    const { projectId } = attempt;
    const key = String(projectId);
    try {
      this.assertProjectNotDeleted(projectId);
      // 1. Fresh read of the durable publication. A valid current publication
      //    for this exact Project wins and is never republished over.
      let read = this.readPublication(projectId);
      if (read.status !== "published-current") {
        // A malformed store, stale/mixed publication, or externally torn
        // staged set is not an invitation to replace data with defaults. It
        // must remain blocked and diagnosable. A staged set accompanied by a
        // Project diagnostic is the one retryable exception: it is the
        // durable footprint of a previous migration attempt that failed
        // before marker publication.
        const document = readDesktopProjectWorkspaceDocument(this.filePath);
        const markerKey = projectWorkspacePublicationMarkerKey(projectId);
        const hasPublishedRecord = Object.prototype.hasOwnProperty.call(document.published, markerKey);
        const hasStagedRecord = PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS.some((kind) =>
          Object.prototype.hasOwnProperty.call(document.staged, projectWorkspaceStagingSliceKey(projectId, kind)),
        );
        if (document.diagnostics.store !== undefined) {
          throw new Error(document.diagnostics.store);
        }
        if (hasPublishedRecord) {
          throw new Error(
            read.diagnostic ??
              "Project workspace publication is stale or mixed; activation is retryable.",
          );
        }
        if (hasStagedRecord && document.diagnostics[String(projectId)] === undefined) {
          throw new Error(
            read.diagnostic ??
              "Project workspace staging is incomplete or malformed; activation is retryable.",
          );
        }

        // 2. No current publication: publish honestly. Production legacy
        //    input is EMPTY — the desktop owns no durable v1 manager source —
        //    so canonical defaults are staged and the marker is written last.
        //    `migrate` itself keeps any valid current publication intact.
        const migration = new DesktopProjectWorkspaceMigration(this.filePath, {
          beforeStage: (candidate) => this.assertProjectNotDeleted(candidate),
          beforePublish: (candidate) => {
            this.assertProjectNotDeleted(candidate);
            this.options.beforePublish?.(candidate);
          },
        });
        const result = migration.migrate({ projectId, threads: [] });
        if (result.status === "unpublished") {
          throw new Error(result.diagnostic);
        }
        if (result.status === "deleted") {
          this.assertProjectNotDeleted(projectId);
        }
        this.assertProjectNotDeleted(projectId);
        // 3. Drive the manager from a FRESHLY READ publication, never from
        //    the in-memory migration result (read-before-apply).
        read = this.readPublication(projectId);
      }

      this.assertProjectNotDeleted(projectId);
      const validated = validatePublishedSlices(read);
      if ("diagnostic" in validated) {
        throw new Error(validated.diagnostic);
      }

      const input = activationInputFromSlices(projectId, validated.slices);
      this.options.beforeApply?.(input);
      this.assertProjectNotDeleted(projectId);
      // 4. Atomically apply the Desktop-owned slices BEFORE the requested
      //    operation. Device/dock/terminal slices were validated above but
      //    have no Desktop manager ownership and are never invented here.
      this.browserManager.applyProjectWorkspaceActivation(input);

      this.diagnosticsByProject.delete(key);
      // 5. Mark activated only after complete application succeeded.
      this.activatedProjects.add(key);
    } catch (error) {
      const diagnostic =
        error instanceof Error
          ? error.message
          : "Project workspace activation failed before manager application.";
      this.diagnosticsByProject.set(key, diagnostic);
      throw new ProjectWorkspaceActivationError(projectId, diagnostic);
    }
  }

  private readPublication(projectId: ProjectId): DesktopProjectWorkspaceReadResult {
    return new DesktopProjectWorkspaceMigration(this.filePath).read(projectId);
  }
}

// ── Non-IPC Project entry points (Decision 0004 item 7) ─────────────

/**
 * The automation host is a non-IPC entry point that can drive Project browser
 * state before any renderer IPC call arrives: every tool request carrying a
 * real ProjectId awaits the same activation boundary first. Thread-keyed
 * requests pass through unchanged (no Thread fallback exists for Projects).
 */
export function createActivationGatedAutomationHost(
  host: Pick<DesktopBrowserAutomationHost, "executeTool">,
  activation: DesktopProjectWorkspaceActivation,
): Pick<DesktopBrowserAutomationHost, "executeTool"> {
  return {
    executeTool: async (request) => {
      if (request.projectId !== undefined) {
        await activation.ensureProjectWorkspaceActivated(request.projectId);
 }
      return host.executeTool(request);
    },
  };
}
