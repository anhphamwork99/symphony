// FILE: desktopProjectWorkspaceMigration.ts
// Purpose: Project-scoped desktop publication boundary for the Right-sidebar workspace.
// Layer: Desktop main-process persistence
//
// The browser manager owns live native resources; this module owns only the
// durable desktop handoff. Legacy Thread records are read through the shared
// policy and are never changed. Every Project stages all slices, verifies the
// complete staged set, and writes its publication marker last.

import * as FS from "node:fs";
import * as Path from "node:path";

import type { ProjectId, ProjectWorkspaceSlice } from "@synara/contracts";
import {
  inspectProjectWorkspacePublishedTarget,
  isProjectWorkspaceStagingComplete,
  planProjectWorkspaceMigration,
  PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS,
  projectWorkspacePublicationMarkerKey,
  type ProjectWorkspaceMigrationProjectInput,
  type ProjectWorkspaceMigrationTarget,
} from "@synara/shared/projectWorkspaceMigration";
import { PROJECT_WORKSPACE_SCHEMA_VERSION } from "@synara/contracts";

export const DESKTOP_PROJECT_WORKSPACE_FILE_NAME = "synara-project-workspace-v2.json";
export const DESKTOP_PROJECT_WORKSPACE_FILE_VERSION = 2 as const;

export interface DesktopProjectWorkspaceDocument {
  readonly version: typeof DESKTOP_PROJECT_WORKSPACE_FILE_VERSION;
  readonly staged: Record<string, unknown>;
  readonly published: Record<string, unknown>;
  readonly diagnostics: Record<string, string>;
}

export type DesktopProjectWorkspaceMigrationResult =
  | {
      readonly status: "kept-published";
      readonly projectId: ProjectId;
    }
  | {
      readonly status: "published";
      readonly projectId: ProjectId;
      readonly target: ProjectWorkspaceMigrationTarget;
    }
  | {
      readonly status: "unpublished";
      readonly projectId: ProjectId;
      readonly diagnostic: string;
    };

export interface DesktopProjectWorkspaceMigrationOptions {
  readonly now?: () => string;
  /** Test seam for proving that a failure cannot publish a marker. */
  readonly beforeStage?: (projectId: ProjectId, key: string) => void;
  /** Test seam for proving marker-last ordering and retryability. */
  readonly beforePublish?: (projectId: ProjectId) => void;
}

export interface DesktopProjectWorkspaceReadResult {
  readonly projectId: ProjectId;
  readonly status: "published-current" | "unpublished";
  readonly slices: ReadonlyArray<ProjectWorkspaceSlice>;
  readonly diagnostic: string | null;
}

function emptyDocument(diagnostic?: string): DesktopProjectWorkspaceDocument {
  return {
    version: DESKTOP_PROJECT_WORKSPACE_FILE_VERSION,
    staged: {},
    published: {},
    diagnostics: diagnostic ? { store: diagnostic } : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDocument(value: unknown): DesktopProjectWorkspaceDocument {
  if (!isRecord(value) || value.version !== DESKTOP_PROJECT_WORKSPACE_FILE_VERSION) {
    return emptyDocument("Desktop Project workspace data is malformed or unavailable.");
  }
  if (!isRecord(value.staged) || !isRecord(value.published) || !isRecord(value.diagnostics)) {
    return emptyDocument("Desktop Project workspace data is malformed or unavailable.");
  }
  const diagnostics: Record<string, string> = {};
  for (const [key, diagnostic] of Object.entries(value.diagnostics)) {
    if (typeof diagnostic === "string" && diagnostic.length > 0) diagnostics[key] = diagnostic;
  }
  return {
    version: DESKTOP_PROJECT_WORKSPACE_FILE_VERSION,
    staged: { ...value.staged },
    published: { ...value.published },
    diagnostics,
  };
}

export function resolveDesktopProjectWorkspacePath(userDataPath: string): string {
  return Path.join(userDataPath, DESKTOP_PROJECT_WORKSPACE_FILE_NAME);
}

export function readDesktopProjectWorkspaceDocument(
  filePath: string,
): DesktopProjectWorkspaceDocument {
  try {
    return parseDocument(JSON.parse(FS.readFileSync(filePath, "utf8")));
  } catch {
    return emptyDocument();
  }
}

function writeDocument(filePath: string, document: DesktopProjectWorkspaceDocument): void {
  const parentPath = Path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(parentPath, { recursive: true, mode: 0o700 });
  const descriptor = JSON.stringify(document);
  const handle = FS.openSync(temporaryPath, "wx", 0o600);
  try {
    FS.writeFileSync(handle, `${descriptor}\n`, "utf8");
    FS.fsyncSync(handle);
    FS.closeSync(handle);
    FS.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      FS.closeSync(handle);
    } catch {
      // The handle may already be closed before rename failed.
    }
    try {
      FS.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

function projectTargetFromDocument(
  document: DesktopProjectWorkspaceDocument,
  projectId: ProjectId,
): { readonly marker: unknown; readonly stagedSlices: ReadonlyArray<unknown> } {
  return {
    marker: document.published[projectWorkspacePublicationMarkerKey(projectId)],
    stagedSlices: PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS.map(
      (kind) => document.staged[`synara:project-workspace:v2:stage:${projectId}:${kind}`],
    ),
  };
}

function markerForTarget(
  target: ProjectWorkspaceMigrationTarget,
  publishedAt: string,
): Record<string, unknown> {
  return {
    projectId: target.projectId,
    schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    publishedAt,
    provenance: target.provenance,
  };
}

export class DesktopProjectWorkspaceMigration {
  private document: DesktopProjectWorkspaceDocument;

  constructor(
    private readonly filePath: string,
    private readonly options: DesktopProjectWorkspaceMigrationOptions = {},
  ) {
    this.document = readDesktopProjectWorkspaceDocument(filePath);
  }

  /** The durable document backing this migration instance. */
  getDocument(): Readonly<DesktopProjectWorkspaceDocument> {
    return this.document;
  }

  /** Read only published Project data; staged data is never mixed into a read. */
  read(projectId: ProjectId): DesktopProjectWorkspaceReadResult {
    const target = projectTargetFromDocument(this.document, projectId);
    const status = inspectProjectWorkspacePublishedTarget(
      { publicationMarker: target.marker, stagedSlices: target.stagedSlices },
      projectId,
    );
    if (status.status !== "published-current") {
      return {
        projectId,
        status: "unpublished",
        slices: [],
        diagnostic:
          this.document.diagnostics[projectId] ??
          this.document.diagnostics.store ??
          "Project workspace publication is unavailable; retained staged data is retryable.",
      };
    }
    return {
      projectId,
      status: status.status,
      slices: target.stagedSlices as ReadonlyArray<ProjectWorkspaceSlice>,
      diagnostic: this.document.diagnostics[projectId] ?? null,
    };
  }

  /**
   * Migrate one Project independently. The caller supplies one stable v1
   * snapshot; this boundary never mutates that snapshot or any Thread record.
   */
  migrate(input: ProjectWorkspaceMigrationProjectInput): DesktopProjectWorkspaceMigrationResult {
    const existing = projectTargetFromDocument(this.document, input.projectId);
    const plan = planProjectWorkspaceMigration({
      ...input,
      publishedTarget: {
        publicationMarker: existing.marker,
        stagedSlices: existing.stagedSlices,
      },
    });
    if (plan.outcome === "keep-published") {
      return { status: "kept-published", projectId: input.projectId };
    }

    try {
      // Stage every deterministic key before the verification gate. A failure
      // leaves any already-written stage records but cannot leave a marker.
      for (const entry of plan.target.stagedEntries) {
        this.options.beforeStage?.(input.projectId, entry.key);
        this.document.staged[entry.key] = entry.slice;
        delete this.document.published[plan.target.publicationMarkerKey];
        this.persist();
      }

      const stagedSlices = PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS.map(
        (kind) =>
          this.document.staged[`synara:project-workspace:v2:stage:${input.projectId}:${kind}`],
      );
      if (!isProjectWorkspaceStagingComplete(stagedSlices, input.projectId)) {
        throw new Error("Desktop Project workspace staging verification failed.");
      }

      this.options.beforePublish?.(input.projectId);
      // Marker-last: only this write makes the complete Project workspace
      // visible to readers. The marker is per Project, so another Project's
      // successful migration is unaffected by this one failing.
      this.document.published[plan.target.publicationMarkerKey] = markerForTarget(
        plan.target,
        (this.options.now ?? (() => new Date().toISOString()))(),
      );
      delete this.document.diagnostics[input.projectId];
      this.persist();
      return { status: "published", projectId: input.projectId, target: plan.target };
    } catch (error) {
      const diagnostic =
        error instanceof Error
          ? error.message
          : "Desktop Project workspace migration failed before publication.";
      delete this.document.published[plan.target.publicationMarkerKey];
      this.document.diagnostics[input.projectId] = diagnostic;
      this.persist();
      return { status: "unpublished", projectId: input.projectId, diagnostic };
    }
  }

  private persist(): void {
    writeDocument(this.filePath, this.document);
  }
}

// ── Production startup helper (WP7) ──────────────────────────────────

/** The deterministic key prefix every per-Project record carries. */
const PROJECT_WORKSPACE_RECORD_KEY_PREFIX = "synara:project-workspace:v2:";

/**
 * Derive the retryable Project IDs honestly from the migration document's own
 * durable keys (staged slices, published markers, per-Project diagnostics).
 *
 * The desktop main process has no durable Thread/Project projection of its
 * own — Projects and Threads are server-owned — so it NEVER invents a Project
 * list. The only Projects the desktop boundary may re-run are the ones its
 * own userData document already references: an incomplete stage left by a
 * previous run converges here (Decision 0002 F.7 retry), and a published
 * marker simply reports `kept-published` (idempotent, no rewrite).
 */
export function collectDesktopProjectWorkspaceProjectIds(
  document: Readonly<DesktopProjectWorkspaceDocument>,
): ReadonlyArray<ProjectId> {
  const projectIds = new Set<string>();
  for (const key of Object.keys(document.diagnostics)) {
    // Diagnostic keys are the raw ProjectId (set/cleared per Project).
    if (key.startsWith(PROJECT_WORKSPACE_RECORD_KEY_PREFIX)) continue;
    if (key.length > 0) {
      projectIds.add(key);
    }
  }
  for (const key of [...Object.keys(document.staged), ...Object.keys(document.published)]) {
    if (!key.startsWith(PROJECT_WORKSPACE_RECORD_KEY_PREFIX)) continue;
    const segments = key.slice(PROJECT_WORKSPACE_RECORD_KEY_PREFIX.length).split(":");
    // stage:<projectId>:<kind> | published:<projectId>
    const id = segments[0] === "stage" || segments[0] === "published" ? segments[1] : undefined;
    if (id !== undefined && id.length > 0) {
      projectIds.add(id);
    }
  }
  return [...projectIds].toSorted().map((id) => id as ProjectId);
}

export interface DesktopProjectWorkspaceStartupOutcome {
  /** One entry per retryable Project the startup pass processed. */
  readonly results: ReadonlyArray<DesktopProjectWorkspaceMigrationResult>;
  /** Diagnostic when the userData document itself could not be processed. */
  readonly diagnostic: string | null;
}

/**
 * The production startup pass: open the real userData store, converge every
 * Project the boundary already knows about, and surface diagnostics.
 *
 * Called from the desktop main bootstrap BEFORE the Project browser surface is
 * exposed over IPC, so no renderer can observe the Project workspace through a
 * half-staged boundary. Never throws: a store-level failure returns a
 * diagnostic (logged by the caller) and leaves the previous document intact;
 * per-Project failures are reported per Project and stay retryable on the next
 * start. v1 records are never read here at all — the desktop boundary owns no
 * v1 slices — and nothing is cleaned up.
 */
export function runDesktopProjectWorkspaceStartupMigration(input: {
  readonly userDataPath: string;
  readonly now?: () => string;
}): DesktopProjectWorkspaceStartupOutcome {
  const filePath = resolveDesktopProjectWorkspacePath(input.userDataPath);
  try {
    const migration = new DesktopProjectWorkspaceMigration(
      filePath,
      input.now === undefined ? {} : { now: input.now },
    );
    const projectIds = collectDesktopProjectWorkspaceProjectIds(migration.getDocument());
    const results: DesktopProjectWorkspaceMigrationResult[] = [];
    for (const projectId of projectIds) {
      try {
        results.push(migration.migrate({ projectId, threads: [] }));
      } catch (error) {
        // `migrate` is expected to catch internally; guard the boundary so one
        // Project's defect can never abort the remaining convergence passes.
        results.push({
          status: "unpublished",
          projectId,
          diagnostic:
            error instanceof Error
              ? error.message
              : "Desktop Project workspace migration failed before publication.",
        });
      }
    }
    return { results, diagnostic: null };
  } catch (error) {
    return {
      results: [],
      diagnostic:
        error instanceof Error ? error.message : "Desktop Project workspace store is unavailable.",
    };
  }
}
