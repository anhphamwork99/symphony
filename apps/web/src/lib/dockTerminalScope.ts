// FILE: dockTerminalScope.ts
// Purpose: Derive a stable, isolated terminal scope id for right-dock terminals,
//          keyed by the owning Project (Decision 0002).
// Layer: Terminal scope helpers
// Exports: dock terminal scope prefix + id factories shared by the dock pane and
//          the orphan-state retention sweep.
//
// The dock terminal set stays an independent session set from the bottom drawer
// (the per-thread drawer terminal store/runtime), so the two never share xterm
// instances. The scope value is derived from the real `ProjectId` — every Main
// conversation in one Project resolves the SAME scope, so a same-Project
// conversation switch keeps the key, the store slice, and the xterm runtime
// alive (no reset, no restart). It is never used as a `ProjectId` alias, never
// sent to the server as an owner, and never cast into conversation lifecycle:
// server-side terminal ownership travels on the real `ProjectId` via the
// `terminal.project.*` WS methods.
import type { ProjectId, ThreadId } from "@synara/contracts";

// Project-owned dock terminal scopes. One Project = one dock terminal workspace.
export const DOCK_TERMINAL_PROJECT_SCOPE_PREFIX = "dock-terminal-project:";

// Transitional host-thread fallback: a brand-new draft thread may render the
// dock before its Project is resolvable. The fallback keeps the pane usable
// without inventing a Project; the moment the Project resolves, the scope (and
// runtime) re-keys to it. It never becomes a Project owner.
export const DOCK_TERMINAL_DRAFT_SCOPE_PREFIX = "dock-terminal-draft:";

export function dockTerminalProjectScope(projectId: ProjectId): ThreadId {
  return `${DOCK_TERMINAL_PROJECT_SCOPE_PREFIX}${projectId}` as ThreadId;
}

export function dockTerminalDraftScope(hostThreadId: ThreadId): ThreadId {
  return `${DOCK_TERMINAL_DRAFT_SCOPE_PREFIX}${hostThreadId}` as ThreadId;
}

/** Resolve the dock terminal store/runtime scope for a dock host. */
export function resolveDockTerminalScope(input: {
  projectId: ProjectId | null;
  hostThreadId: ThreadId;
}): ThreadId {
  return input.projectId !== null
    ? dockTerminalProjectScope(input.projectId)
    : dockTerminalDraftScope(input.hostThreadId);
}

/** True when a store key is a Project-owned dock terminal scope. */
export function isDockTerminalProjectScope(storeKey: string): boolean {
  return storeKey.startsWith(DOCK_TERMINAL_PROJECT_SCOPE_PREFIX);
}
