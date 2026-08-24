// FILE: rightDockStore.ts
// Purpose: Persist the tabbed right-dock state (open panes + active tab + preferred
//          width) keyed by the owning Project (Decision 0002). Every Main
//          conversation in one Project reads and writes the same slice directly;
//          switching conversations never changes the key, copies state, or resets
//          the workspace. Side-chat panes keep their real nested ThreadId.
// Layer: UI state store
// Exports: dock store hook, per-project selector, and stable default snapshot.

import type { ProjectId } from "@synara/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { randomUUID } from "./lib/utils";
import {
  type OpenPaneInput,
  type RightDockPane,
  type RightDockProjectState,
  closePaneInState,
  createDefaultRightDockState,
  openPaneInState,
  sanitizePreferredDockWidthPx,
  sanitizeRightDockStateByProjectId,
  setActivePaneInState,
  setDockOpenInState,
  toggleSingletonPaneInState,
  updatePaneInState,
} from "./rightDockStore.logic";

// v2 is the Project-keyed shape (WP1 ProjectWorkspaceDockSlice semantics). The
// v1 Thread-keyed blob stays on disk untouched: it is the rollback source and
// the migration input (Decision 0002 G); this store never reads, writes, or
// deletes it.
const RIGHT_DOCK_STORAGE_KEY = "synara:right-dock-state:v2";

interface RightDockStore {
  dockStateByProjectId: Record<string, RightDockProjectState | undefined>;
  openPane: (
    projectId: ProjectId | null,
    input: Omit<OpenPaneInput, "paneId"> & { paneId?: string },
  ) => void;
  toggleSingletonPane: (
    projectId: ProjectId | null,
    input: Omit<OpenPaneInput, "paneId"> & { paneId?: string },
  ) => void;
  closePane: (projectId: ProjectId | null, paneId: string) => void;
  setActivePane: (projectId: ProjectId | null, paneId: string) => void;
  setDockOpen: (projectId: ProjectId | null, open: boolean) => void;
  updatePane: (
    projectId: ProjectId | null,
    paneId: string,
    patch: Partial<
      Pick<
        RightDockPane,
        | "diffTurnId"
        | "diffFilePath"
        | "filePath"
        | "threadId"
        | "pullRequestProjectId"
        | "pullRequestRepository"
        | "pullRequestNumber"
        | "pullRequestInitialTab"
        | "restorationDiagnostic"
      >
    >,
  ) => void;
  /**
   * Remember the user's preferred dock width. Only user-intended widths (open,
   * drag) reach this action; the render-only viewport clamp never does, so a
   * narrow window can never overwrite the remembered preference (scenario 8).
   */
  setPreferredWidth: (projectId: ProjectId | null, widthPx: number) => void;
  /**
   * Apply a published v2 migration slice for one Project (idempotent; only the
   * migration activator calls this after the publication marker is durable).
   */
  applyPublishedDockSlice: (projectId: ProjectId | null, slice: RightDockProjectState) => void;
}

// Frozen shared snapshot: it is handed back from `selectRightDockState` for any
// project without persisted dock state, so it must stay a stable, immutable
// reference (transitions always build new objects rather than mutating it).
const DEFAULT_RIGHT_DOCK_STATE = createDefaultRightDockState();
Object.freeze(DEFAULT_RIGHT_DOCK_STATE);
Object.freeze(DEFAULT_RIGHT_DOCK_STATE.panes);

function commit(
  set: (fn: (store: RightDockStore) => Partial<RightDockStore>) => void,
  projectId: ProjectId | null,
  transform: (state: RightDockProjectState) => RightDockProjectState,
): void {
  if (projectId === null) {
    return;
  }
  set((store) => {
    const previous = store.dockStateByProjectId[projectId] ?? DEFAULT_RIGHT_DOCK_STATE;
    const next = transform(previous);
    if (next === previous) {
      return {};
    }
    return {
      dockStateByProjectId: {
        ...store.dockStateByProjectId,
        [projectId]: next,
      },
    };
  });
}

export const useRightDockStore = create<RightDockStore>()(
  persist(
    (set) => ({
      dockStateByProjectId: {},
      openPane: (projectId, input) =>
        commit(set, projectId, (state) =>
          openPaneInState(state, { ...input, paneId: input.paneId ?? randomUUID() }),
        ),
      toggleSingletonPane: (projectId, input) =>
        commit(set, projectId, (state) =>
          toggleSingletonPaneInState(state, { ...input, paneId: input.paneId ?? randomUUID() }),
        ),
      closePane: (projectId, paneId) =>
        commit(set, projectId, (state) => closePaneInState(state, paneId)),
      setActivePane: (projectId, paneId) =>
        commit(set, projectId, (state) => setActivePaneInState(state, paneId)),
      setDockOpen: (projectId, open) =>
        commit(set, projectId, (state) => setDockOpenInState(state, open)),
      updatePane: (projectId, paneId, patch) =>
        commit(set, projectId, (state) => updatePaneInState(state, paneId, patch)),
      setPreferredWidth: (projectId, widthPx) =>
        commit(set, projectId, (state) => {
          const preferredWidthPx = sanitizePreferredDockWidthPx(widthPx);
          if (preferredWidthPx === null || state.preferredWidthPx === preferredWidthPx) {
            return state;
          }
          return { ...state, preferredWidthPx };
        }),
      applyPublishedDockSlice: (projectId, slice) => {
        if (projectId === null) {
          return;
        }
        set((store) => ({
          dockStateByProjectId: {
            ...store.dockStateByProjectId,
            [projectId]: slice,
          },
        }));
      },
    }),
    {
      name: RIGHT_DOCK_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Validate persisted panes on rehydrate so a stale/unknown pane kind from
      // an older app version can never crash the dock during render.
      merge: (persisted, current) => ({
        ...current,
        dockStateByProjectId: sanitizeRightDockStateByProjectId(
          (persisted as { dockStateByProjectId?: unknown } | undefined)?.dockStateByProjectId,
        ),
      }),
    },
  ),
);

export function selectRightDockState(projectId: ProjectId | null) {
  // Keep the fallback snapshot stable so React does not observe phantom store
  // changes while mounting a project that has no persisted dock state yet.
  return (store: RightDockStore) =>
    (projectId ? store.dockStateByProjectId[projectId] : undefined) ?? DEFAULT_RIGHT_DOCK_STATE;
}

/**
 * Resolve the Project owning the right-dock workspace for a conversation.
 *
 * The active Main conversation selects its own workspace only through its
 * durable `projectId` — never by being treated as the workspace host. A draft
 * thread resolves through its draft project; `null` means the Project is not
 * (yet) knowable, and the dock renders the default snapshot.
 */
export function resolveDockOwnerProjectId(input: {
  threadProjectId: ProjectId | null | undefined;
  draftProjectId?: ProjectId | null | undefined;
}): ProjectId | null {
  if (input.threadProjectId) {
    return input.threadProjectId;
  }
  return input.draftProjectId ?? null;
}
