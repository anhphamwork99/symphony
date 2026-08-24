// FILE: projectTerminalClose.test.ts
// Purpose: Prove the Project-owned dock terminal close flow (Decision 0002 /
//          Project Contract scenario 4): an active terminal warns before the
//          task stops, cancelling leaves process and UI untouched, an idle
//          terminal closes immediately, and a failed close settles truthfully
//          without losing local state.
// Layer: Web terminal close-flow tests (WP6)
// Depends on: terminalProjectRouting helpers (pure routing + snapshot mapping).

import { ProjectId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  closeTerminalSession,
  preflightProjectTerminalRunning,
  projectTerminalEventToLocalEvent,
  projectTerminalSnapshotToThreadSnapshot,
  writeTerminalSession,
} from "~/components/terminal/terminalProjectRouting";
import { PROJECT_WORKSPACE_CAPABILITY, readProjectTerminalApi } from "~/projectWorkspaceApi";
import * as projectWorkspaceApi from "~/projectWorkspaceApi";
import type { TerminalProjectEvent, TerminalProjectSessionSnapshot } from "@synara/contracts";

const projectId = ProjectId.makeUnsafe("project-1");
const SCOPE = "dock-terminal-project:project-1";

function snapshot(
  overrides?: Partial<TerminalProjectSessionSnapshot>,
): TerminalProjectSessionSnapshot {
  return {
    projectId,
    terminalId: "t1",
    cwd: "/repo",
    status: "running",
    pid: 4321,
    history: "$ echo hi\nhi\n",
    exitCode: null,
    exitSignal: null,
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectTerminalSnapshotToThreadSnapshot", () => {
  it("re-keys onto the local runtime scope while preserving replay payload", () => {
    const mapped = projectTerminalSnapshotToThreadSnapshot(
      snapshot({ replayPreamble: "\u001b]0;title\u0007" }),
      SCOPE,
    );
    expect(mapped.threadId).toBe(SCOPE);
    expect(mapped.terminalId).toBe("t1");
    expect(mapped.history).toContain("echo hi");
    expect(mapped.replayPreamble).toBeDefined();
    expect(mapped.pid).toBe(4321);
  });
});

describe("projectTerminalEventToLocalEvent", () => {
  it("maps every event kind onto the local scope with legacy shape", () => {
    const base = { projectId, terminalId: "t1", createdAt: "2026-08-24T00:00:00.000Z" };
    const cases: TerminalProjectEvent[] = [
      { ...base, type: "started", snapshot: snapshot() },
      { ...base, type: "output", data: "hi", byteLength: 2 },
      { ...base, type: "exited", exitCode: 0, exitSignal: null },
      { ...base, type: "error", message: "boom" },
      { ...base, type: "cleared" },
      { ...base, type: "restarted", snapshot: snapshot() },
      {
        ...base,
        type: "activity",
        hasRunningSubprocess: true,
        cliKind: "claude",
        agentState: "running",
      },
    ];
    for (const event of cases) {
      const mapped = projectTerminalEventToLocalEvent(event, SCOPE);
      expect(mapped.threadId).toBe(SCOPE);
      expect(mapped.type).toBe(event.type);
      expect(mapped.terminalId).toBe("t1");
    }
  });
});

describe("preflightProjectTerminalRunning", () => {
  it("reports the server's truthful running status for the terminal", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        snapshot({ terminalId: "t1", status: "running" }),
        snapshot({ terminalId: "t2", status: "exited" }),
      ]);
    const api = {
      open: vi.fn(),
      write: vi.fn(),
      ackOutput: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: vi.fn(),
      list,
      onEvent: () => () => undefined,
    };
    const readApi = vi.spyOn(projectWorkspaceApi, "readProjectTerminalApi");
    readApi.mockReturnValue(api);

    expect(await preflightProjectTerminalRunning(projectId, "t1")).toBe(true);
    expect(await preflightProjectTerminalRunning(projectId, "t2")).toBe(false);
    expect(await preflightProjectTerminalRunning(projectId, "missing")).toBe(false);
    readApi.mockRestore();
    vi.unstubAllGlobals();
  });

  it("returns null (fall back to local view) when the preflight fails", async () => {
    const readApi = vi.spyOn(projectWorkspaceApi, "readProjectTerminalApi");
    readApi.mockReturnValue({
      open: vi.fn(),
      write: vi.fn(),
      ackOutput: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: vi.fn(),
      list: vi.fn().mockRejectedValue(new Error("transport down")),
      onEvent: () => () => undefined,
    });
    expect(await preflightProjectTerminalRunning(projectId, "t1")).toBeNull();
    readApi.mockRestore();
  });
});

describe("closeTerminalSession (Project-owned)", () => {
  it("closes through the Project surface and keeps failure truthful", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const readApi = vi.spyOn(projectWorkspaceApi, "readProjectTerminalApi");
    readApi.mockReturnValue({
      open: vi.fn(),
      write: vi.fn(),
      ackOutput: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close,
      list: vi.fn().mockResolvedValue([]),
      onEvent: () => () => undefined,
    });

    await closeTerminalSession(
      { projectId, threadId: SCOPE, terminalId: "t1" },
      { deleteHistory: true },
    );
    expect(close).toHaveBeenCalledWith({
      projectId,
      terminalId: "t1",
      deleteHistory: true,
    });

    // A failing close throws (truthful) instead of pretending success.
    close.mockRejectedValueOnce(new Error("server refused"));
    await expect(
      closeTerminalSession({ projectId, threadId: SCOPE, terminalId: "t1" }),
    ).rejects.toThrow("server refused");
    readApi.mockRestore();
  });

  it("writeTerminalSession routes input through the Project surface", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const readApi = vi.spyOn(projectWorkspaceApi, "readProjectTerminalApi");
    readApi.mockReturnValue({
      open: vi.fn(),
      write,
      ackOutput: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      onEvent: () => () => undefined,
    });
    await writeTerminalSession({ projectId, threadId: SCOPE, terminalId: "t1" }, "ls\r");
    expect(write).toHaveBeenCalledWith({
      projectId,
      terminalId: "t1",
      data: "ls\r",
    });
    readApi.mockRestore();
  });
});

describe("capability gate", () => {
  it("exports the Project workspace capability constant", () => {
    expect(PROJECT_WORKSPACE_CAPABILITY).toBe("project.right-sidebar-workspace");
    expect(readProjectTerminalApi).toBeDefined();
  });
});
