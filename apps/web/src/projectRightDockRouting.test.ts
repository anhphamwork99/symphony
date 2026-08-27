// FILE: projectRightDockRouting.test.ts
// Purpose: Prove the Project-owned dock routing (Decision 0002) end to end at
//          the selection-chain level: a same-Project conversation switch
//          (thread A → thread B) resolves the identical owner ProjectId, the
//          identical dock state object, and the identical terminal scope with
//          ZERO store writes; switching to a different Project's conversation
//          resolves a different dock slice and scope key.
// Layer: Web workspace routing tests (WP6 review finding)
// Depends on: createThreadProjectIdSelector → resolveDockOwnerProjectId →
//             selectRightDockState / resolveDockTerminalScope (the exact chain
//             useActiveProjectRightDockState and the dock pane compose), plus
//             the real rightDockStore and terminalStateStore.

import { ProjectId, ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveDockTerminalScope } from "./lib/dockTerminalScope";
import { resolveRoutePanelBootstrap } from "./routes/-chatThreadRoute.logic";
import {
  resolveDockOwnerProjectId,
  selectRightDockState,
  useRightDockStore,
} from "./rightDockStore";
import { selectThreadTerminalState, useTerminalStateStore } from "./terminalStateStore";
import { createThreadProjectIdSelector } from "./storeSelectors";
import type { AppState } from "./storeState";
import type { ThreadShell } from "./types";

const projectA = ProjectId.makeUnsafe("project-a");
const projectB = ProjectId.makeUnsafe("project-b");
const threadA1 = ThreadId.makeUnsafe("thread-a1");
const threadA2 = ThreadId.makeUnsafe("thread-a2");
const threadB1 = ThreadId.makeUnsafe("thread-b1");

function shell(threadId: ThreadId, projectId: ProjectId): ThreadShell {
  return {
    id: threadId,
    codexThreadId: null,
    projectId,
    title: `Thread ${threadId}`,
    modelSelection: { provider: "anthropic", modelId: "claude" },
    runtimeMode: "agent",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    error: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  } as unknown as ThreadShell;
}

/** The app-store slice `createThreadProjectIdSelector` actually reads. */
function appStateWithThreads(...threads: readonly ThreadShell[]): AppState {
  return {
    spaces: [],
    projects: [],
    sidebarThreadSummaryById: {},
    threadsHydrated: true,
    threadIds: threads.map((thread) => thread.id),
    threadShellById: Object.fromEntries(threads.map((thread) => [thread.id, thread])),
  } as AppState;
}

const APP_STATE = appStateWithThreads(
  shell(threadA1, projectA),
  shell(threadA2, projectA),
  shell(threadB1, projectB),
);

/** The exact routing chain `useActiveProjectRightDockState` composes. */
function routeActiveThreadDock(activeThreadId: ThreadId | null) {
  const threadProjectId = createThreadProjectIdSelector(activeThreadId)(APP_STATE);
  const ownerProjectId = resolveDockOwnerProjectId({ threadProjectId, draftProjectId: null });
  const dockState = selectRightDockState(ownerProjectId)(useRightDockStore.getState());
  const terminalScope = resolveDockTerminalScope({
    projectId: ownerProjectId,
  })!;
  return { ownerProjectId, dockState, terminalScope };
}

/**
 * The deep-link replay chain `SingleChatSurface` composes when a route mounts:
 * the bootstrap scope is the dock owner Project, and an applied browser patch
 * opens the Project's browser pane exactly like the production effect does.
 */
function applyRouteDeepLink(input: {
  ownerProjectId: ProjectId | null;
  search: { panel?: "browser" | "diff" };
  lastAppliedSearchKey: string | null;
}): string | null {
  const { nextAppliedSearchKey, panelPatch } = resolveRoutePanelBootstrap({
    scopeId: input.ownerProjectId,
    search: input.search,
    lastAppliedSearchKey: input.lastAppliedSearchKey,
  });
  if (panelPatch?.panel === "browser") {
    useRightDockStore.getState().openPane(input.ownerProjectId!, { kind: "browser" });
  }
  return nextAppliedSearchKey;
}

beforeEach(() => {
  useRightDockStore.setState({ dockStateByProjectId: {} });
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
});

describe("Project-owned dock routing — same-Project conversation switch (A → B)", () => {
  it("keeps the dock object, slice key, and terminal scope identical with zero writes", () => {
    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    useRightDockStore.getState().openPane(projectA, { kind: "sidechat", threadId: threadA2 });
    // Seed the Project's dock terminal slice under its scope with a live runtime.
    const scopeA = resolveDockTerminalScope({ projectId: projectA })!;
    useTerminalStateStore.getState().newTerminal(scopeA, "t1");

    const fromA = routeActiveThreadDock(threadA1);
    const dockBefore = useRightDockStore.getState().dockStateByProjectId[projectA];
    const sliceBefore =
      useTerminalStateStore.getState().terminalStateByThreadId[scopeA] ?? undefined;
    const rightDockWrites: unknown[] = [];
    const unsubscribeRightDock = useRightDockStore.subscribe((state) => {
      rightDockWrites.push(state.dockStateByProjectId);
    });
    const terminalWrites: unknown[] = [];
    const unsubscribeTerminal = useTerminalStateStore.subscribe((state) => {
      terminalWrites.push(state.terminalStateByThreadId);
    });

    const fromB = routeActiveThreadDock(threadA2);

    // Same Project: identical dock object and scope — no re-key, no copy, no reset.
    expect(fromB.ownerProjectId).toBe(fromA.ownerProjectId);
    expect(fromB.dockState).toBe(fromA.dockState);
    expect(fromB.terminalScope).toBe(fromA.terminalScope);
    expect(fromB.terminalScope).toBe(scopeA);
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]).toBe(dockBefore);
    const sliceAfter =
      useTerminalStateStore.getState().terminalStateByThreadId[scopeA] ?? undefined;
    expect(sliceAfter).toBe(sliceBefore);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        fromB.terminalScope,
      ),
    ).toBe(sliceBefore);
    // Zero writes: the conversation switch itself never touched either store.
    expect(rightDockWrites).toHaveLength(0);
    expect(terminalWrites).toHaveLength(0);

    unsubscribeRightDock();
    unsubscribeTerminal();
  });

  it("keeps the workspace across a same-Project switch after the destination thread also exists", () => {
    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    const first = routeActiveThreadDock(threadA1);
    const second = routeActiveThreadDock(threadA2);
    // Object identity, not deep equality: the workspace is the same slice.
    expect(second.dockState).toBe(first.dockState);
    expect(Object.keys(useRightDockStore.getState().dockStateByProjectId)).toEqual([projectA]);
  });
});

describe("Project-owned dock routing — different-Project switch", () => {
  it("resolves a different dock slice and terminal scope key", () => {
    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    useRightDockStore.getState().openPane(projectB, { kind: "file" });

    const fromA = routeActiveThreadDock(threadA1);
    const fromB1 = routeActiveThreadDock(threadB1);

    expect(fromA.ownerProjectId).toBe(projectA);
    expect(fromB1.ownerProjectId).toBe(projectB);
    expect(fromB1.dockState).not.toBe(fromA.dockState);
    expect(fromA.terminalScope).not.toBe(fromB1.terminalScope);
    expect(fromA.terminalScope).toBe(`dock-terminal-project:${projectA}`);
    expect(fromB1.terminalScope).toBe(`dock-terminal-project:${projectB}`);
    // Each Project reads only its own slice.
    expect(fromA.dockState.panes.map((pane) => pane.kind)).toEqual(["browser"]);
    expect(fromB1.dockState.panes.map((pane) => pane.kind)).toEqual(["file"]);
  });

  it("yields the stable default snapshot for a Project without persisted state", () => {
    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    const fromB1 = routeActiveThreadDock(threadB1);
    const fromB1Again = routeActiveThreadDock(threadB1);
    // No slice for projectB: the frozen shared default, still reference-stable.
    expect(fromB1.dockState).toBe(fromB1Again.dockState);
    expect(fromB1.dockState.panes).toHaveLength(0);
    expect(fromB1.dockState).not.toBe(routeActiveThreadDock(threadA1).dockState);
  });
});

describe("Project-owned dock routing — deep-link bootstrap scoping", () => {
  it("keeps a closed browser pane closed across a same-Project switch carrying the same deep-link payload", () => {
    // Conversation A1 follows a browser deep link: the bootstrap opens the
    // Project's browser pane once.
    const a1 = routeActiveThreadDock(threadA1);
    const appliedKey = applyRouteDeepLink({
      ownerProjectId: a1.ownerProjectId,
      search: { panel: "browser" },
      lastAppliedSearchKey: null,
    });
    expect(typeof appliedKey).toBe("string");
    expect(
      useRightDockStore.getState().dockStateByProjectId[projectA]!.panes.map((pane) => pane.kind),
    ).toEqual(["browser"]);

    // The user closes the browser tab and activates a file pane instead.
    const slice = useRightDockStore.getState().dockStateByProjectId[projectA]!;
    const browserPaneId = slice.panes.find((pane) => pane.kind === "browser")!.id;
    useRightDockStore.getState().closePane(projectA, browserPaneId);
    useRightDockStore.getState().openPane(projectA, { kind: "file", filePath: "src/app.ts" });
    const filePane = useRightDockStore
      .getState()
      .dockStateByProjectId[projectA]!.panes.find((pane) => pane.kind === "file")!;
    useRightDockStore.getState().setActivePane(projectA, filePane.id);

    // Switch to conversation A2 while the same deep-link payload is still in
    // the URL. The bootstrap scope is the Project, the payload is identical, so
    // the deep link dedupes and must not reopen the closed browser pane.
    const dockBefore = useRightDockStore.getState().dockStateByProjectId[projectA];
    const writes: unknown[] = [];
    const unsubscribe = useRightDockStore.subscribe((state) => {
      writes.push(state.dockStateByProjectId);
    });

    const a2 = routeActiveThreadDock(threadA2);
    const replayKey = applyRouteDeepLink({
      ownerProjectId: a2.ownerProjectId,
      search: { panel: "browser" },
      lastAppliedSearchKey: appliedKey,
    });

    expect(replayKey).toBe(appliedKey);
    expect(a2.ownerProjectId).toBe(a1.ownerProjectId);
    // Browser pane stays closed; the file pane stays active; zero extra writes.
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]).toBe(dockBefore);
    expect(
      useRightDockStore.getState().dockStateByProjectId[projectA]!.panes.map((pane) => pane.kind),
    ).toEqual(["file"]);
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]!.activePaneId).toBe(
      filePane.id,
    );
    expect(writes).toHaveLength(0);

    unsubscribe();
  });

  it("applies a deep link independently for another Project's dock", () => {
    const a = routeActiveThreadDock(threadA1);
    const appliedKeyA = applyRouteDeepLink({
      ownerProjectId: a.ownerProjectId,
      search: { panel: "browser" },
      lastAppliedSearchKey: null,
    });
    expect(typeof appliedKeyA).toBe("string");

    // Moving to Project B's conversation carries the same payload, but B owns a
    // different dock slice: its bootstrap applies and opens B's browser pane.
    const b = routeActiveThreadDock(threadB1);
    const appliedKeyB = applyRouteDeepLink({
      ownerProjectId: b.ownerProjectId,
      search: { panel: "browser" },
      lastAppliedSearchKey: appliedKeyA,
    });

    expect(b.ownerProjectId).toBe(projectB);
    expect(appliedKeyB).not.toBe(appliedKeyA);
    expect(
      useRightDockStore.getState().dockStateByProjectId[projectB]!.panes.map((pane) => pane.kind),
    ).toEqual(["browser"]);
    // Project A's dock is untouched by B's application.
    expect(
      useRightDockStore.getState().dockStateByProjectId[projectA]!.panes.map((pane) => pane.kind),
    ).toEqual(["browser"]);
  });
});
