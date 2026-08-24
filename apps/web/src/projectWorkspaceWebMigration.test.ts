import { ProjectId, ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveDockTerminalScope } from "./lib/dockTerminalScope";
import {
  activateProjectWorkspace,
  resetProjectWorkspaceActivationForTests,
} from "./projectWorkspaceActivation";
import {
  LEGACY_RIGHT_DOCK_STORAGE_KEY,
  LEGACY_TERMINAL_STATE_STORAGE_KEY,
  migrateProjectWorkspaceOnWeb,
  readPublishedProjectWorkspace,
  type ProjectWorkspaceWebStorage,
} from "./projectWorkspaceWebMigration";
import { useRightDockStore } from "./rightDockStore";
import { useTerminalStateStore } from "./terminalStateStore";

const projectId = ProjectId.makeUnsafe("project-1");
const otherProjectId = ProjectId.makeUnsafe("project-2");

function makeStorage(): ProjectWorkspaceWebStorage & {
  written: Map<string, string>;
  removed: string[];
} {
  const backing = new Map<string, string>();
  const removed: string[] = [];
  return {
    written: backing,
    removed,
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
      removed.push(key);
    },
  };
}

function seedLegacyV1(
  storage: ProjectWorkspaceWebStorage,
  payload: {
    rightDockByThread?: Record<string, unknown>;
    terminalByThread?: Record<string, unknown>;
  },
): void {
  if (payload.rightDockByThread) {
    storage.setItem(
      LEGACY_RIGHT_DOCK_STORAGE_KEY,
      JSON.stringify({ state: { dockStateByThreadId: payload.rightDockByThread } }),
    );
  }
  if (payload.terminalByThread) {
    storage.setItem(
      LEGACY_TERMINAL_STATE_STORAGE_KEY,
      JSON.stringify({ state: { terminalStateByThreadId: payload.terminalByThread } }),
    );
  }
}

function threadInput(input: {
  threadId: string;
  projectId: string;
  updatedAt?: string;
  deletedAt?: string | null;
  archivedAt?: string | null;
}) {
  return {
    threadId: ThreadId.makeUnsafe(input.threadId),
    projectId: input.projectId as ProjectId,
    updatedAt: input.updatedAt ?? "2026-08-20T10:00:00.000Z",
    deletedAt: input.deletedAt ?? null,
    archivedAt: input.archivedAt ?? null,
    slices: {},
  };
}

function nonDefaultRightDock(openPaneId = "browser-1", threadId = "thread-winner") {
  return {
    threadId,
    open: true,
    panes: [
      {
        id: openPaneId,
        kind: "browser",
        threadId: null,
        diffTurnId: null,
        diffFilePath: null,
        filePath: null,
        pullRequestProjectId: null,
        pullRequestRepository: null,
        pullRequestNumber: null,
        pullRequestInitialTab: null,
        restorationDiagnostic: null,
      },
    ],
    activePaneId: openPaneId,
  };
}

function nonDefaultTerminal(threadId = "thread-winner") {
  return {
    threadId,
    presentationMode: "workspace",
    workspaceTab: "terminal",
    workspaceLayout: "terminal-only",
    terminalHeightPx: 400,
    terminalIds: ["t1"],
    activeTerminalId: "t1",
    terminalLabelsById: { t1: "Build" },
  };
}

beforeEach(() => {
  resetProjectWorkspaceActivationForTests();
  useRightDockStore.setState({ dockStateByProjectId: {} });
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
});

describe("projectWorkspaceWebMigration — staging and publication", () => {
  it("migrates the winning Thread's slices under Project keys and publishes the marker", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-winner": nonDefaultRightDock() },
      terminalByThread: { "thread-winner": nonDefaultTerminal() },
    });

    const result = migrateProjectWorkspaceOnWeb({
      projectId,
      threads: [threadInput({ threadId: "thread-winner", projectId })],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
    });

    expect(result).toEqual({ outcome: "published", plan: "migrated" });
    const published = readPublishedProjectWorkspace(projectId, storage);
    expect(published).not.toBeNull();
    expect(published?.dock.open).toBe(true);
    expect(published?.dock.panes[0]?.kind).toBe("browser");
    expect(published?.terminalPresentation.terminalHeightPx).toBe(400);
    // v1 blobs are never written or removed (Decision 0002 G retention).
    expect(storage.getItem(LEGACY_RIGHT_DOCK_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(LEGACY_TERMINAL_STATE_STORAGE_KEY)).not.toBeNull();
    expect(storage.removed).toEqual([]);
  });

  it("is idempotent: a rerun keeps the published target and rewrites nothing", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-winner": nonDefaultRightDock() },
    });
    const threads = [threadInput({ threadId: "thread-winner", projectId })];

    const first = migrateProjectWorkspaceOnWeb({
      projectId,
      threads,
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
    });
    const firstPublished = readPublishedProjectWorkspace(projectId, storage);
    const second = migrateProjectWorkspaceOnWeb({
      projectId,
      threads,
      storage,
      nowIso: "2026-08-24T01:00:00.000Z",
    });

    expect(first.outcome).toBe("published");
    expect(second).toEqual({ outcome: "published", plan: "kept" });
    // Marker timestamp is NOT advanced by a rerun over the same snapshot.
    const secondPublished = readPublishedProjectWorkspace(projectId, storage);
    expect(secondPublished?.dock).toEqual(firstPublished?.dock);
  });

  it("publishes nothing when a staged write fails midway", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-winner": nonDefaultRightDock() },
    });
    const failing = {
      ...storage,
      setItem: (key: string, value: string) => {
        if (key.includes(":stage:") && key.endsWith(":device")) {
          throw new Error("QuotaExceededError");
        }
        storage.setItem(key, value);
      },
    } satisfies ProjectWorkspaceWebStorage;

    const result = migrateProjectWorkspaceOnWeb({
      projectId,
      threads: [threadInput({ threadId: "thread-winner", projectId })],
      storage: failing,
      nowIso: "2026-08-24T00:00:00.000Z",
    });

    expect(result.outcome).toBe("unpublished");
    expect(readPublishedProjectWorkspace(projectId, failing)).toBeNull();
    // v1 remains untouched.
    expect(storage.getItem(LEGACY_RIGHT_DOCK_STORAGE_KEY)).not.toBeNull();
    expect(storage.removed).toEqual([]);
  });

  it("an incomplete stage (marker without every slice) never activates", () => {
    const storage = makeStorage();
    migrateProjectWorkspaceOnWeb({
      projectId,
      threads: [threadInput({ threadId: "thread-winner", projectId })],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
    });
    // Simulate eviction of one staged slice while the marker survives.
    const allKeys = [...storage.written.keys()];
    const evicted = allKeys.find((key) => key.endsWith(":stage:project-1:browser"));
    expect(evicted).toBeDefined();
    storage.written.delete(evicted as string);

    expect(readPublishedProjectWorkspace(projectId, storage)).toBeNull();
  });

  it("picks the newest-updated winner and takes every slice from that one Thread only", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: {
        "thread-richer-dock": {
          ...nonDefaultRightDock("rich-dock", "thread-richer-dock"),
          open: false,
        },
        "thread-newer": nonDefaultRightDock("newer-dock", "thread-newer"),
      },
      terminalByThread: { "thread-richer-dock": nonDefaultTerminal("thread-richer-dock") },
    });

    const result = migrateProjectWorkspaceOnWeb({
      projectId,
      threads: [
        threadInput({
          threadId: "thread-richer-dock",
          projectId,
          updatedAt: "2026-08-18T10:00:00.000Z",
        }),
        threadInput({
          threadId: "thread-newer",
          projectId,
          updatedAt: "2026-08-19T10:00:00.000Z",
        }),
      ],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
    });

    expect(result).toEqual({ outcome: "published", plan: "migrated" });
    const published = readPublishedProjectWorkspace(projectId, storage);
    // The dock comes from the winner... and the terminal slice does NOT borrow
    // from the richer loser (all-slices rule, Decision 0002 D).
    expect(published?.dock.panes[0]?.id).toBe("newer-dock");
    expect(published?.terminalPresentation.terminalIds).toEqual(["default"]);
    expect(published?.terminalPresentation.terminalLabelsById).toEqual({});
  });

  it("archived Threads remain eligible; deleted Threads are ineligible", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: {
        "thread-deleted": {
          ...nonDefaultRightDock("deleted-dock", "thread-deleted"),
          open: true,
        },
        "thread-archived": {
          ...nonDefaultRightDock("archived-dock", "thread-archived"),
          open: true,
        },
      },
    });

    const result = migrateProjectWorkspaceOnWeb({
      projectId,
      threads: [
        threadInput({
          threadId: "thread-deleted",
          projectId,
          deletedAt: "2026-08-21T00:00:00.000Z",
        }),
        threadInput({
          threadId: "thread-archived",
          projectId,
          updatedAt: "2026-08-18T10:00:00.000Z",
          archivedAt: "2026-08-19T00:00:00.000Z",
        }),
      ],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
    });

    expect(result.outcome).toBe("published");
    const published = readPublishedProjectWorkspace(projectId, storage);
    expect(published?.dock.panes[0]?.id).toBe("archived-dock");
  });

  it("keeps Projects independent: publishing one never touches another", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-a": nonDefaultRightDock("dock-a") },
    });

    const a = migrateProjectWorkspaceOnWeb({
      projectId,
      threads: [threadInput({ threadId: "thread-a", projectId })],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
    });
    const b = readPublishedProjectWorkspace(otherProjectId, storage);

    expect(a.outcome).toBe("published");
    expect(b).toBeNull();
  });
});

describe("activateProjectWorkspace — store application", () => {
  it("applies the published dock and terminal slices into the live stores once", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-winner": nonDefaultRightDock() },
      terminalByThread: { "thread-winner": nonDefaultTerminal() },
    });

    const first = activateProjectWorkspace({
      projectId,
      threads: [threadInput({ threadId: "thread-winner", projectId })],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });
    const second = activateProjectWorkspace({
      projectId,
      threads: [threadInput({ threadId: "thread-winner", projectId })],
      storage,
      nowIso: "2026-08-25T00:00:00.000Z",
      capabilityPresent: true,
    });

    expect(first.outcome).toBe("published");
    expect(second.outcome).toBe("already-applied");

    const dockState = useRightDockStore.getState().dockStateByProjectId[projectId];
    expect(dockState?.open).toBe(true);
    expect(dockState?.panes[0]?.kind).toBe("browser");

    const scope = resolveDockTerminalScope({ projectId })!;
    const terminalState = useTerminalStateStore.getState().terminalStateByThreadId[scope];
    expect(terminalState?.terminalHeight).toBe(400);
    expect(terminalState?.terminalLabelsById.t1).toBe("Build");
  });

  it("keeps Projects isolated in the live stores", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-a": nonDefaultRightDock("dock-a") },
    });
    activateProjectWorkspace({
      projectId,
      threads: [threadInput({ threadId: "thread-a", projectId })],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });

    expect(useRightDockStore.getState().dockStateByProjectId[otherProjectId]).toBeUndefined();
  });

  it("fails closed for a Thread without durable updatedAt: it never wins and never crashes", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: {
        // The richer slice belongs to the Thread with NO durable updatedAt.
        "thread-stale": nonDefaultRightDock("stale-pane"),
        "thread-winner": nonDefaultRightDock("winner-pane"),
      },
    });

    const result = activateProjectWorkspace({
      projectId,
      threads: [
        { ...threadInput({ threadId: "thread-stale", projectId }), updatedAt: null },
        threadInput({ threadId: "thread-winner", projectId }),
      ],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });

    expect(result.outcome).toBe("published");
    const dockState = useRightDockStore.getState().dockStateByProjectId[projectId];
    // The durably-orderable Thread wins; the updatedAt-less Thread's richer
    // slice is never borrowed (Decision 0002 C.1 + D.4).
    expect(dockState?.panes[0]?.id).toBe("winner-pane");
  });

  it("publishes empty defaults when every Thread lacks durable updatedAt", () => {
    const storage = makeStorage();
    seedLegacyV1(storage, {
      rightDockByThread: { "thread-stale": nonDefaultRightDock("stale-pane") },
    });

    const result = activateProjectWorkspace({
      projectId,
      threads: [{ ...threadInput({ threadId: "thread-stale", projectId }), updatedAt: null }],
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });

    // Fail closed: no candidate is durably orderable, so the canonical empty
    // workspace publishes — the stale slice never activates by accident.
    expect(result.outcome).toBe("published");
    const dockState = useRightDockStore.getState().dockStateByProjectId[projectId];
    expect(dockState?.panes).toHaveLength(0);
    expect(dockState?.open).toBe(false);
  });
});

describe("resolveDockTerminalScope — same-Project continuity", () => {
  it("resolves one stable scope per Project across different conversations", () => {
    expect(resolveDockTerminalScope({ projectId })).toBe(resolveDockTerminalScope({ projectId }));
    expect(resolveDockTerminalScope({ projectId })).not.toBe(
      resolveDockTerminalScope({ projectId: otherProjectId }),
    );
  });

  it("never leaks the scope value as a ProjectId-shaped owner", () => {
    const scope = resolveDockTerminalScope({ projectId })!;
    expect(scope.startsWith("dock-terminal-project:")).toBe(true);
    expect(scope.endsWith(projectId)).toBe(true);
  });
});

describe("rightDockStore — Project ownership invariants", () => {
  it("keeps the workspace across a same-Project conversation switch (no reset, no copy)", () => {
    const openPane = useRightDockStore.getState().openPane;
    openPane(projectId, { kind: "browser" });
    const before = useRightDockStore.getState().dockStateByProjectId[projectId] ?? null;

    // Switching conversations in the same Project writes nothing under any key.
    const storeBefore = useRightDockStore.getState().dockStateByProjectId;
    useRightDockStore.setState({ dockStateByProjectId: { ...storeBefore } });
    const after = useRightDockStore.getState().dockStateByProjectId[projectId] ?? null;

    expect(after).toBe(before);
    expect(Object.keys(useRightDockStore.getState().dockStateByProjectId)).toEqual([projectId]);
  });

  it("isolates Projects: writing one never touches another", () => {
    const openPane = useRightDockStore.getState().openPane;
    openPane(projectId, { kind: "browser" });
    expect(useRightDockStore.getState().dockStateByProjectId[otherProjectId]).toBeUndefined();
  });

  it("retains the sidechat's real nested ThreadId as pane content", () => {
    const sidechatThreadId = ThreadId.makeUnsafe("sidechat-thread");
    const openPane = useRightDockStore.getState().openPane;
    openPane(projectId, { kind: "sidechat", threadId: sidechatThreadId });
    const dockState = useRightDockStore.getState().dockStateByProjectId[projectId];
    expect(dockState?.panes[0]?.kind).toBe("sidechat");
    expect(dockState?.panes[0]?.threadId).toBe(sidechatThreadId);
  });

  it("persists only user-intended preferred widths within workspace bounds", () => {
    const setPreferredWidth = useRightDockStore.getState().setPreferredWidth;
    setPreferredWidth(projectId, 480);
    expect(useRightDockStore.getState().dockStateByProjectId[projectId]?.preferredWidthPx).toBe(
      480,
    );
    // A temporary clamp value outside the dock bounds never persists.
    setPreferredWidth(projectId, 2);
    expect(useRightDockStore.getState().dockStateByProjectId[projectId]?.preferredWidthPx).toBe(
      480,
    );
  });

  it("keeps an unavailable pane with its restoration diagnostic instead of dropping it", () => {
    const openPane = useRightDockStore.getState().openPane;
    openPane(projectId, { kind: "browser" });
    const dockStateBefore = useRightDockStore.getState().dockStateByProjectId[projectId];
    const paneId = dockStateBefore?.panes[0]?.id as string;

    const updatePane = useRightDockStore.getState().updatePane;
    updatePane(projectId, paneId, {
      restorationDiagnostic: "Browser workspace could not be restored (device offline).",
    });

    const dockStateAfter = useRightDockStore.getState().dockStateByProjectId[projectId];
    expect(dockStateAfter?.panes).toHaveLength(1);
    expect(dockStateAfter?.panes[0]?.restorationDiagnostic).toBe(
      "Browser workspace could not be restored (device offline).",
    );
  });
});
