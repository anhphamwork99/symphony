// FILE: dockTerminalScope.ts
// Purpose: Derive a stable, isolated LOCAL terminal correlation key for
//          right-dock terminals, keyed by the owning Project (Decision 0002).
// Layer: Terminal scope helpers
// Exports: dock terminal scope prefix + key factories shared by the dock pane,
//          the terminal store, and the orphan-state retention sweep.
//
// The dock terminal set stays an independent session set from the bottom drawer
// (the per-thread drawer terminal store/runtime), so the two never share xterm
// instances. The scope value is derived from the real `ProjectId` — every Main
// conversation in one Project resolves the SAME scope, so a same-Project
// conversation switch keeps the key, the store slice, and the xterm runtime
// alive (no reset, no restart).
//
// Decision 0003 remediation item 1: this key is a LOCAL correlation identifier
// of its own brand (`DockTerminalScopeId`) — never a `ThreadId`, never a
// pseudo-Thread, never sent to the server as an owner, and never cast into
// conversation lifecycle. Server-side terminal ownership travels on the real
// `ProjectId` via the `terminal.project.*` WS methods; a Project-owned dock
// terminal with no Project surface fails explicitly (remediation item 2), so
// no draft/host-thread fallback scope exists anymore.
import type { ProjectId } from "@synara/contracts";

declare const DockTerminalScopeBrand: unique symbol;

/**
 * LOCAL store/runtime correlation key for a Project-owned dock terminal
 * workspace. Distinct brand from `ThreadId` by construction: assigning one to
 * the other is a type error, so a Project-derived key can never masquerade as
 * a conversation identity (Decision 0002 prohibited shortcuts).
 */
export type DockTerminalScopeId = string & { readonly [DockTerminalScopeBrand]: true };

// Project-owned dock terminal scopes. One Project = one dock terminal workspace.
export const DOCK_TERMINAL_PROJECT_SCOPE_PREFIX = "dock-terminal-project:";

/** Build the local correlation key for one Project's dock terminal workspace. */
export function dockTerminalProjectScope(projectId: ProjectId): DockTerminalScopeId {
  return `${DOCK_TERMINAL_PROJECT_SCOPE_PREFIX}${projectId}` as DockTerminalScopeId;
}

/**
 * Resolve the dock terminal store/runtime scope for a dock host.
 *
 * Returns `null` when the owning Project is unresolved: the dock pane then
 * renders an explicit unavailable diagnostic instead of inventing a host
 * Thread or routing a Project-derived key into the Thread terminal API
 * (Decision 0003 remediation items 1–2).
 */
export function resolveDockTerminalScope(input: {
  readonly projectId: ProjectId | null;
}): DockTerminalScopeId | null {
  return input.projectId !== null ? dockTerminalProjectScope(input.projectId) : null;
}

/** True when a store key is a Project-owned dock terminal scope. */
export function isDockTerminalProjectScope(storeKey: string): boolean {
  return storeKey.startsWith(DOCK_TERMINAL_PROJECT_SCOPE_PREFIX);
}

/**
 * Compile-time guard: the dock scope brand and the conversation brand stay
 * disjoint. If either type ever widens into the other, this assignment stops
 * compiling (no synthetic alias can silently reappear).
 */
