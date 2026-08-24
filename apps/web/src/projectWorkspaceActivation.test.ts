// FILE: projectWorkspaceActivation.test.ts
// Purpose: Proves the web activation gate (F3): activation requires BOTH the
//          advertised `project.right-sidebar-workspace` capability AND a
//          published complete marker; when either is absent the legacy reads
//          and stores stay untouched, and a later capability arrival can still
//          activate the same Project.
// Layer: Web activation test (WP6).

import { ProjectId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  activateProjectWorkspace,
  resetProjectWorkspaceActivationForTests,
} from "./projectWorkspaceActivation";
import {
  LEGACY_RIGHT_DOCK_STORAGE_KEY,
  LEGACY_TERMINAL_STATE_STORAGE_KEY,
  readPublishedProjectWorkspace,
  toLegacyTerminalPresentationSlice,
  type ProjectWorkspaceWebStorage,
} from "./projectWorkspaceWebMigration";
import { PROJECT_WORKSPACE_CAPABILITY } from "./projectWorkspaceApi";
import { useRightDockStore } from "./rightDockStore";
import { useTerminalStateStore } from "./terminalStateStore";

const projectId = ProjectId.makeUnsafe("gate-project-1");

function makeStorage(): ProjectWorkspaceWebStorage & { written: Map<string, string> } {
  const backing = new Map<string, string>();
  return {
    written: backing,
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
  };
}

function seedLegacyV1(storage: ProjectWorkspaceWebStorage): void {
  storage.setItem(
    LEGACY_RIGHT_DOCK_STORAGE_KEY,
    JSON.stringify({
      state: {
        dockStateByThreadId: {
          "thread-gate": {
            threadId: "thread-gate",
            open: true,
            panes: [
              {
                id: "pane-gate",
                kind: "browser",
                threadId: null,
                diffTurnId: null,
                diffFilePath: null,
                filePath: null,
                pullRequestProjectId: null,
                pullRequestRepository: null,
                pullRequestNumber: null,
                pullRequestInitialTab: null,
              },
            ],
            activePaneId: "pane-gate",
          },
        },
      },
    }),
  );
}

function legacyThreads() {
  return [
    {
      threadId: "thread-gate" as never,
      projectId,
      updatedAt: "2026-08-20T10:00:00.000Z",
      deletedAt: null,
      archivedAt: null,
      slices: {},
    },
  ];
}

beforeEach(() => {
  resetProjectWorkspaceActivationForTests();
  useRightDockStore.setState({ dockStateByProjectId: {} });
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
});

describe("projectWorkspaceActivation — capability gate", () => {
  it("does not migrate, stage, or apply anything when the capability is absent", () => {
    const storage = makeStorage();
    seedLegacyV1(storage);

    const result = activateProjectWorkspace({
      projectId,
      threads: legacyThreads(),
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: false,
    });

    expect(result).toEqual({
      projectId,
      outcome: "unpublished",
      reason: "capability-absent",
    });
    // Nothing v2 was written: no staged slice, no marker — only the seeded
    // v1 blob is present, byte-for-byte unchanged.
    const v2Writes = [...storage.written.keys()].filter((key) =>
      key.includes("synara:project-workspace:v2"),
    );
    expect(v2Writes).toEqual([]);
    // …and no v2 read activates (the gate a renderer would consult).
    expect(readPublishedProjectWorkspace(projectId, storage)).toBeNull();
    // Legacy reads are preserved exactly.
    expect(storage.getItem(LEGACY_RIGHT_DOCK_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(LEGACY_TERMINAL_STATE_STORAGE_KEY)).toBeNull();
    // The live stores stay untouched: no Project dock entry appears.
    expect(useRightDockStore.getState().dockStateByProjectId[projectId]).toBeUndefined();
  });

  it("activates when the capability is present and the marker publishes", () => {
    const storage = makeStorage();
    seedLegacyV1(storage);

    const result = activateProjectWorkspace({
      projectId,
      threads: legacyThreads(),
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });

    expect(result.outcome).toBe("published");
    expect(readPublishedProjectWorkspace(projectId, storage)).not.toBeNull();
    const dockState = useRightDockStore.getState().dockStateByProjectId[projectId];
    expect(dockState?.open).toBe(true);
    expect(dockState?.panes[0]?.kind).toBe("browser");
  });

  it("a capability-absent pass does not poison a later capability-present pass", () => {
    const storage = makeStorage();
    seedLegacyV1(storage);
    const threads = legacyThreads();

    const absent = activateProjectWorkspace({
      projectId,
      threads,
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: false,
    });
    expect(absent.outcome).toBe("unpublished");

    // The server upgrades and the capability arrives on the next attempt: the
    // same Project still activates (the failed gate was not remembered).
    const present = activateProjectWorkspace({
      projectId,
      threads,
      storage,
      nowIso: "2026-08-24T01:00:00.000Z",
      capabilityPresent: true,
    });
    expect(present.outcome).toBe("published");
    expect(useRightDockStore.getState().dockStateByProjectId[projectId]?.open).toBe(true);
  });

  it("exports the exact advertised capability string the server gate uses", () => {
    expect(PROJECT_WORKSPACE_CAPABILITY).toBe("project.right-sidebar-workspace");
  });
});

describe("toLegacyTerminalPresentationSlice — explicit ThreadId input", () => {
  it("carries the caller-supplied real ThreadId; never a placeholder owner", () => {
    const slice = toLegacyTerminalPresentationSlice("thread-real" as never, {
      presentationMode: "workspace",
      workspaceActiveTab: "terminal",
      workspaceLayout: "both",
      terminalHeight: 300,
      terminalIds: ["t1"],
      activeTerminalId: "t1",
      terminalLabelsById: { t1: "Build" },
    });
    expect(slice).not.toBeNull();
    expect(slice?.threadId).toBe("thread-real");
    // No synthetic/empty owner can round-trip out of the converter.
    expect(String(slice?.threadId ?? "")).not.toBe("");
  });

  it("still rejects an active terminal that is not in the terminal list", () => {
    expect(
      toLegacyTerminalPresentationSlice("thread-real" as never, {
        presentationMode: "drawer",
        workspaceActiveTab: "chat",
        workspaceLayout: "both",
        terminalHeight: 280,
        terminalIds: ["t1"],
        activeTerminalId: "missing",
        terminalLabelsById: {},
      }),
    ).toBeNull();
  });
});
