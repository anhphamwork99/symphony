// FILE: useActiveProjectRightDock.ts
// Purpose: Resolve the Project-owned right-dock state for the active route
//          thread: the dock follows the thread's durable projectId (draft
//          fallback included), never the thread itself (Decision 0002).
// Layer: Web workspace selector hook
// Depends on: rightDockStore, app store thread->project selector, draft store.

import type { ThreadId } from "@synara/contracts";
import { useMemo } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { resolveDockOwnerProjectId, selectRightDockState, useRightDockStore } from "../rightDockStore";
import { useStore } from "../store";
import { createThreadProjectIdSelector } from "../storeSelectors";

export function useActiveProjectRightDockState(activeThreadId: ThreadId | null) {
  const threadProjectId = useStore(
    useMemo(() => createThreadProjectIdSelector(activeThreadId), [activeThreadId]),
  );
  const draftProjectId = useComposerDraftStore((store) =>
    activeThreadId
      ? (store.draftThreadsByThreadId[activeThreadId]?.projectId ?? null)
      : null,
  );
  const ownerProjectId = resolveDockOwnerProjectId({ threadProjectId, draftProjectId });
  return {
    ownerProjectId,
    dockState: useRightDockStore(
      useMemo(() => selectRightDockState(ownerProjectId), [ownerProjectId]),
    ),
  };
}
