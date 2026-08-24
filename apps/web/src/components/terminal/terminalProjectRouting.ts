// FILE: terminalProjectRouting.ts
// Purpose: Route terminal server calls to the owning surface: the Project-owned
//          `terminal.project.*` WS surface (Decision 0002) when the runtime entry
//          carries a ProjectId, otherwise the legacy Thread-keyed surface.
// Layer: Web terminal runtime helpers
// Depends on: projectWorkspaceApi (Project terminal API), nativeApi (legacy).
//
// Project terminal snapshots (`TerminalProjectSessionSnapshot`) map onto the
// thread snapshot shape the runtime replays from, and Project events are
// re-keyed onto the local runtime scope so `terminalRuntime.ts` keeps a single
// event-handling path. The ProjectId is the only owner ever sent to the server.

import type {
  ProjectId,
  TerminalEvent,
  TerminalProjectEvent,
  TerminalProjectSessionSnapshot,
  TerminalSessionSnapshot,
} from "@synara/contracts";

import { readProjectTerminalApi } from "~/projectWorkspaceApi";
import { readNativeApi } from "~/nativeApi";

/** Input shared by every routed call. */
export interface TerminalRouteInput {
  readonly projectId: ProjectId | null;
  readonly threadId: string;
  readonly terminalId: string;
}

function projectInput(entry: TerminalRouteInput) {
  return { projectId: entry.projectId as ProjectId, terminalId: entry.terminalId };
}

/** Open (or reconnect) the session, returning a replayable snapshot. */
export async function openTerminalSession(
  entry: TerminalRouteInput,
  input: {
    cwd: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
  },
): Promise<TerminalSessionSnapshot> {
  if (entry.projectId !== null) {
    const projectApi = readProjectTerminalApi();
    if (projectApi) {
      return projectTerminalSnapshotToThreadSnapshot(
        await projectApi.open({
          ...projectInput(entry),
          cwd: input.cwd,
          cols: input.cols,
          rows: input.rows,
          ...(input.env ? { env: input.env } : {}),
        }),
        entry.threadId,
      );
    }
  }
  const api = readNativeApi();
  if (!api) {
    throw new Error("Terminal transport is unavailable.");
  }
  return api.terminal.open({
    threadId: entry.threadId as TerminalSessionSnapshot["threadId"],
    terminalId: entry.terminalId,
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows,
    ...(input.env ? { env: input.env } : {}),
  });
}

/** Write raw input to the session PTY. */
export async function writeTerminalSession(entry: TerminalRouteInput, data: string): Promise<void> {
  if (entry.projectId !== null) {
    const projectApi = readProjectTerminalApi();
    if (projectApi) {
      return projectApi.write({ ...projectInput(entry), data });
    }
  }
  const api = readNativeApi();
  if (!api) return;
  return api.terminal.write({
    threadId: entry.threadId as TerminalSessionSnapshot["threadId"],
    terminalId: entry.terminalId,
    data,
  });
}

/** Flow-control ACK for streamed output bytes. */
export async function acknowledgeTerminalOutput(
  entry: TerminalRouteInput,
  bytes: number,
): Promise<void> {
  if (entry.projectId !== null) {
    const projectApi = readProjectTerminalApi();
    if (projectApi) {
      return projectApi.ackOutput({ ...projectInput(entry), bytes });
    }
  }
  const api = readNativeApi();
  if (!api) return;
  return api.terminal.ackOutput({
    threadId: entry.threadId as TerminalSessionSnapshot["threadId"],
    terminalId: entry.terminalId,
    bytes,
  });
}

/** Resize the session PTY grid. */
export async function resizeTerminalSession(
  entry: TerminalRouteInput,
  size: { cols: number; rows: number },
): Promise<void> {
  if (entry.projectId !== null) {
    const projectApi = readProjectTerminalApi();
    if (projectApi) {
      return projectApi.resize({ ...projectInput(entry), ...size });
    }
  }
  const api = readNativeApi();
  if (!api) return;
  return api.terminal.resize({
    threadId: entry.threadId as TerminalSessionSnapshot["threadId"],
    terminalId: entry.terminalId,
    cols: size.cols,
    rows: size.rows,
  });
}

/**
 * Close the session server-side. For Project-owned terminals this deletes the
 * Project terminal's history; for legacy Thread terminals it keeps the
 * existing `deleteHistory` semantics of the caller.
 */
export async function closeTerminalSession(
  entry: TerminalRouteInput,
  options?: { readonly deleteHistory?: boolean },
): Promise<void> {
  if (entry.projectId !== null) {
    const projectApi = readProjectTerminalApi();
    if (projectApi) {
      await projectApi.close({
        projectId: entry.projectId,
        terminalId: entry.terminalId,
        deleteHistory: options?.deleteHistory ?? true,
      });
      return;
    }
  }
  const api = readNativeApi();
  if (!api || !("close" in api.terminal) || typeof api.terminal.close !== "function") {
    throw new Error("Terminal close is unavailable.");
  }
  await api.terminal.close({
    threadId: entry.threadId as TerminalSessionSnapshot["threadId"],
    terminalId: entry.terminalId,
    deleteHistory: options?.deleteHistory ?? true,
  });
}

/**
 * Truthful running-state preflight for the close confirmation: the server's
 * live status for the Project's terminals. Returns null when the preflight is
 * unavailable (legacy surface), and the caller falls back to its local view.
 */
export async function preflightProjectTerminalRunning(
  projectId: ProjectId,
  terminalId: string,
): Promise<boolean | null> {
  const projectApi = readProjectTerminalApi();
  if (!projectApi) {
    return null;
  }
  const snapshots = await projectApi.list({ projectId }).catch(() => null);
  if (snapshots === null) {
    return null;
  }
  const snapshot = snapshots.find((candidate) => candidate.terminalId === terminalId);
  return snapshot ? snapshot.status === "running" : false;
}

/** Re-key a Project terminal snapshot onto the local runtime scope for replay. */
export function projectTerminalSnapshotToThreadSnapshot(
  snapshot: TerminalProjectSessionSnapshot,
  localScopeId: string,
): TerminalSessionSnapshot {
  return {
    threadId: localScopeId,
    terminalId: snapshot.terminalId,
    cwd: snapshot.cwd,
    status: snapshot.status,
    pid: snapshot.pid,
    history: snapshot.history,
    ...(snapshot.replayPreamble !== undefined ? { replayPreamble: snapshot.replayPreamble } : {}),
    exitCode: snapshot.exitCode,
    exitSignal: snapshot.exitSignal,
    updatedAt: snapshot.updatedAt,
  };
}

/**
 * Re-key a Project terminal event onto the local runtime scope as a legacy
 * `TerminalEvent`, so `terminalRuntime.ts` handles one event shape. Carries
 * the local scope (never the ProjectId) as the correlation key the runtime
 * already subscribes by.
 */
export function projectTerminalEventToLocalEvent(
  event: TerminalProjectEvent,
  localScopeId: string,
): TerminalEvent {
  const base = {
    threadId: localScopeId as TerminalEvent extends { threadId: infer T } ? T : string,
    terminalId: event.terminalId,
    createdAt: event.createdAt,
  };
  switch (event.type) {
    case "started":
      return {
        ...base,
        type: "started",
        snapshot: projectTerminalSnapshotToThreadSnapshot(event.snapshot, localScopeId),
      };
    case "restarted":
      return {
        ...base,
        type: "restarted",
        snapshot: projectTerminalSnapshotToThreadSnapshot(event.snapshot, localScopeId),
      };
    case "output":
      return {
        ...base,
        type: "output",
        data: event.data,
        ...(event.byteLength !== undefined ? { byteLength: event.byteLength } : {}),
      };
    case "exited":
      return { ...base, type: "exited", exitCode: event.exitCode, exitSignal: event.exitSignal };
    case "error":
      return { ...base, type: "error", message: event.message };
    case "cleared":
      return { ...base, type: "cleared" };
    case "activity":
      return {
        ...base,
        type: "activity",
        hasRunningSubprocess: event.hasRunningSubprocess,
        cliKind: event.cliKind,
        agentState: event.agentState,
      };
  }
}
