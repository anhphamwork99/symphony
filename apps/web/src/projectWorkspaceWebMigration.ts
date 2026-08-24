// FILE: projectWorkspaceWebMigration.ts
// Purpose: Web localStorage boundary for the Project-owned Right-sidebar
//          workspace: stage every v2 slice under the WP2 deterministic keys,
//          publish the marker only after staging is durable, and never touch the
//          v1 Thread-keyed blobs (rollback source + Decision 0002 G retention).
// Layer: Web migration boundary (WP6)
// Depends on: WP2 shared pure policy (single collision policy), WP1 contracts.
//
// Boundary protocol (Decision 0002 F):
//  1. Build one stable snapshot of the Project's Threads and their raw legacy
//     v1 localStorage slices.
//  2. `planProjectWorkspaceMigration` (shared, pure) selects the one winner and
//     derives the complete deterministic target — every slice from that winner.
//  3. Stage every destination slice under
//     `synara:project-workspace:v2:stage:<projectId>:<kind>` (deterministic
//     upserts; rerunning from the same snapshot produces no duplicates).
//  4. ONLY after every staged write returned, write the publication marker
//     `synara:project-workspace:v2:published:<projectId>`.
//  5. Readers activate v2 only through `readPublishedProjectWorkspace`, which
//     re-verifies staging completeness against the marker — an incomplete stage
//     can never activate as canonical.
//
// Failure at any point before the marker leaves the target unpublished,
// observable, and retryable; v1 data is never modified or deleted.

import type { ProjectId, ThreadId } from "@synara/contracts";
import type { ProjectWorkspaceSlice } from "@synara/contracts";
import { Schema } from "effect";
import {
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  ProjectWorkspaceDockSlice,
  ProjectWorkspaceSlice as ProjectWorkspaceSliceUnion,
  ProjectWorkspaceTerminalPresentationSlice,
} from "@synara/contracts";
import {
  type LegacyProjectWorkspaceThreadInput,
  type ProjectWorkspaceMigrationPlan,
  inspectProjectWorkspacePublishedTarget,
  planProjectWorkspaceMigration,
  projectWorkspacePublicationMarkerKey,
  projectWorkspaceStagingSliceKey,
} from "@synara/shared/projectWorkspaceMigration";

/** localStorage-like boundary; injected so tests can observe writes. */
export interface ProjectWorkspaceWebStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

import { TERMINAL_STATE_LEGACY_STORAGE_KEY } from "./terminalStateStore";

/** v1 localStorage keys (read-only inputs; never written or removed). */
export const LEGACY_RIGHT_DOCK_STORAGE_KEY = "synara:right-dock-state:v1";
export const LEGACY_TERMINAL_STATE_STORAGE_KEY = TERMINAL_STATE_LEGACY_STORAGE_KEY;

/** Outcome of one migration attempt for one Project. */
export type ProjectWorkspaceWebMigrationOutcome =
  | { readonly outcome: "published"; readonly plan: "kept" | "migrated" | "empty-defaults" }
  | { readonly outcome: "unpublished"; readonly reason: string };

interface LegacySliceReaders {
  /**
   * Raw legacy right-dock slice for one Thread (the `dockStateByThreadId[tid]`
   * entry from `synara:right-dock-state:v1`), or null when absent.
   */
  readonly readRightDockSlice: (threadId: ThreadId) => unknown;
  /**
   * Raw legacy terminal presentation slice for one Thread (the
   * `terminalStateByThreadId[tid]` entry from `synara:terminal-state:v1`),
   * or null when absent.
   */
  readonly readTerminalSlice: (threadId: ThreadId) => unknown;
}

/** Read the raw persisted v1 record entries behind the two web v1 keys. */
export function createLegacyLocalStorageSliceReaders(
  storage: ProjectWorkspaceWebStorage,
): LegacySliceReaders {
  const readRecord = (key: string, innerField: string): Record<string, unknown> => {
    const raw = storage.getItem(key);
    if (raw === null) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      // The zustand-persist envelope keeps the state under `state`; accept a
      // bare record too so hand-written fixtures stay simple.
      const state = (parsed as { state?: unknown }).state;
      const source =
        state !== undefined && typeof state === "object" && state !== null
          ? (state as Record<string, unknown>)
          : (parsed as Record<string, unknown>);
      const inner = source[innerField];
      if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
        return {};
      }
      return inner as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const rightDock = readRecord(LEGACY_RIGHT_DOCK_STORAGE_KEY, "dockStateByThreadId");
  const terminal = readRecord(LEGACY_TERMINAL_STATE_STORAGE_KEY, "terminalStateByThreadId");
  return {
    readRightDockSlice: (threadId) => rightDock[threadId] ?? null,
    readTerminalSlice: (threadId) => terminal[threadId] ?? null,
  };
}

/** Convert a web ThreadTerminalState into the v1 legacy schema shape. */
export function toLegacyTerminalPresentationSlice(state: {
  presentationMode: "drawer" | "workspace";
  workspaceActiveTab: "terminal" | "chat";
  workspaceLayout: "both" | "terminal-only";
  terminalHeight: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalLabelsById: Record<string, string>;
}): { threadId: ThreadId } | null {
  if (!state.terminalIds.includes(state.activeTerminalId)) {
    return null;
  }
  const labelsNameKnownTerminals = Object.keys(state.terminalLabelsById).every((key) =>
    state.terminalIds.includes(key),
  );
  if (!labelsNameKnownTerminals) {
    return null;
  }
  return {
    threadId: "" as ThreadId,
    presentationMode: state.presentationMode,
    workspaceTab: state.workspaceActiveTab,
    workspaceLayout: state.workspaceLayout,
    terminalHeightPx: state.terminalHeight,
    terminalIds: [...state.terminalIds],
    activeTerminalId: state.activeTerminalId,
    terminalLabelsById: { ...state.terminalLabelsById },
  };
}

/**
 * Run (or verify) the migration for one Project against the injected storage.
 *
 * Pure with respect to inputs: same snapshot + same storage state ⇒ same
 * outcome. `nowIso` stamps the marker's `publishedAt` (the boundary's own
 * clock; the policy deliberately never synthesizes one).
 */
export function migrateProjectWorkspaceOnWeb(input: {
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<LegacyProjectWorkspaceThreadInput>;
  readonly storage: ProjectWorkspaceWebStorage;
  readonly nowIso: string;
}): ProjectWorkspaceWebMigrationOutcome {
  const { projectId, storage } = input;
  const readers = createLegacyLocalStorageSliceReaders(storage);
  const threads = input.threads.map((thread) => ({
    ...thread,
    slices: {
      rightDock: readers.readRightDockSlice(thread.threadId),
      terminalPresentation: readers.readTerminalSlice(thread.threadId),
      // The web boundary never persisted browser workspace state (only the
      // browser history cache, which is not the workspace) and never persisted
      // device state; both stay absent so the policy publishes the canonical
      // default for them instead of borrowing from any Thread.
      browser: undefined,
      device: undefined,
    },
  }));

  const markerKey = projectWorkspacePublicationMarkerKey(projectId);
  const stagedSlices = readStagedSlices(projectId, storage);
  const plan: ProjectWorkspaceMigrationPlan = planProjectWorkspaceMigration({
    projectId,
    threads,
    publishedTarget: {
      publicationMarker: parseJson(storage.getItem(markerKey)),
      stagedSlices,
    },
  });

  if (plan.outcome === "keep-published") {
    return { outcome: "published", plan: "kept" };
  }

  // Stage every slice first. Any throw (quota, disabled storage) aborts before
  // the marker exists, so nothing partial can ever activate.
  try {
    for (const entry of plan.target.stagedEntries) {
      storage.setItem(entry.key, JSON.stringify(entry.slice));
    }
    // Re-read the staged payload and verify completeness BEFORE publishing: a
    // short write or an evicted entry must not publish.
    const written = readStagedSlices(projectId, storage);
    const verified = inspectProjectWorkspacePublishedTarget(
      {
        publicationMarker: parseJson(storage.getItem(markerKey)),
        stagedSlices: written,
      },
      projectId,
    );
    if (verified.status !== "unpublished" || verified.reason !== "marker-absent") {
      // Something else published or a marker exists while staging was being
      // rewritten; keep-published precedence means we never overwrite it.
      return verified.status === "published-current"
        ? { outcome: "published", plan: "kept" }
        : { outcome: "unpublished", reason: `staging-verification-${verified.reason}` };
    }
    const marker = {
      projectId,
      schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
      publishedAt: input.nowIso,
      provenance: plan.target.provenance,
    };
    storage.setItem(markerKey, JSON.stringify(marker));
  } catch (error) {
    return {
      outcome: "unpublished",
      reason: error instanceof Error ? error.message : "storage-write-failed",
    };
  }

  return {
    outcome: "published",
    plan: plan.outcome === "migrate-legacy-winner" ? "migrated" : "empty-defaults",
  };
}

function parseJson(raw: string | null): unknown {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function readStagedSlices(
  projectId: ProjectId,
  storage: ProjectWorkspaceWebStorage,
): unknown[] {
  const slices: unknown[] = [];
  for (const key of stagedSliceKeys(projectId)) {
    const raw = storage.getItem(key);
    if (raw === null) {
      continue;
    }
    slices.push(parseJson(raw));
  }
  return slices;
}

function stagedSliceKeys(projectId: ProjectId): string[] {
  return [
    projectWorkspaceStagingSliceKey(projectId, "right-dock"),
    projectWorkspaceStagingSliceKey(projectId, "terminal-presentation"),
    projectWorkspaceStagingSliceKey(projectId, "browser"),
    projectWorkspaceStagingSliceKey(projectId, "browser-annotations"),
    projectWorkspaceStagingSliceKey(projectId, "device"),
  ];
}

/** Decoded published v2 slices for one Project, or null when not activatable. */
export interface PublishedProjectWorkspace {
  readonly dock: typeof ProjectWorkspaceDockSlice.Type;
  readonly terminalPresentation: typeof ProjectWorkspaceTerminalPresentationSlice.Type;
  readonly slices: ReadonlyArray<ProjectWorkspaceSlice>;
}

/**
 * Activation gate for readers: returns the published v2 workspace for the
 * Project only when a valid current-version marker exists AND the staged
 * payload is complete for exactly this Project. Anything else — absent marker,
 * stale marker, incomplete stage, mixed-Project slices — returns null and the
 * reader stays on its prior compatible path. Never composes published and
 * legacy slices (Decision 0002 F.5).
 */
export function readPublishedProjectWorkspace(
  projectId: ProjectId,
  storage: ProjectWorkspaceWebStorage,
): PublishedProjectWorkspace | null {
  const markerRaw = parseJson(
    storage.getItem(projectWorkspacePublicationMarkerKey(projectId)),
  );
  const stagedSlices = readStagedSlices(projectId, storage);
  const status = inspectProjectWorkspacePublishedTarget(
    { publicationMarker: markerRaw, stagedSlices },
    projectId,
  );
  if (status.status !== "published-current") {
    return null;
  }
  const dock = Schema.decodeUnknownSync(ProjectWorkspaceDockSlice)(
    stagedSlices.find((raw): raw is Record<string, unknown> =>
      isSliceKind(raw, "right-dock"),
    ) as unknown,
  );
  const terminalPresentation = Schema.decodeUnknownSync(
    ProjectWorkspaceTerminalPresentationSlice,
  )(
    stagedSlices.find((raw): raw is Record<string, unknown> =>
      isSliceKind(raw, "terminal-presentation"),
    ) as unknown,
  );
  const slices = stagedSlices.map((raw) =>
    Schema.decodeUnknownSync(ProjectWorkspaceSliceUnion)(raw),
  );
  return { dock, terminalPresentation, slices };
}

function isSliceKind(raw: unknown, kind: string): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { slice?: unknown }).slice === kind
  );
}
