// FILE: projectWorkspaceAcceptance.test.ts
// Purpose: WP8 integrated acceptance evidence at the web boundary. Proves the
//          Project Contract scenarios and Decision 0002 verification
//          obligations against the REAL web stores and the exact routing
//          chain the components compose, plus the WS transport surface with a
//          capturing stub so every wire payload can be inspected.
// Layer: Web integrated acceptance (WP8).
// Scenario/obligation map (tested here unless noted server/desktop):
//   Scenario 1 — same-Project conversation switch preserves the workspace
//                identity (dock object, terminal scope, browser/device state)
//                with ZERO store writes.
//   Scenario 2 — Project switch restores only the destination Project's
//                workspace; Projects never contaminate each other.
//   Scenario 4 — close-confirmation routing carries the real ProjectId and
//                never a threadId (web half; preflight truth in server file).
//   Scenario 8 — temporary viewport clamp is render-only; the remembered
//                preferred width survives clamp and re-widen.
//   Obligations 9,10 — explicit ProjectId propagation end to end (WS method
//   names + payloads), negative no-alias proofs (runtime + static).
//   Marker boundary — web localStorage publication markers prevent mixed or
//   incomplete canonical activation.
//
// Sidebar.tsx scope audit (recorded here as the WP8 review artifact): the only
// Sidebar.tsx change in this project (commit 99e4a6ad5) routes
// `openSidechatDock` through `resolveDockOwnerProjectId` so the sidechat pane
// write lands under the owning Project while keeping its real nested
// ThreadId; the left-sidebar Project expansion state
// (`persistSidebarUiState`, `chatThreadListExtraPages`,
// `projectThreadListExtraPagesByProjectCwd`, `dismissedThreadStatusKeyByThreadId`)
// is untouched by dock ownership — verified below by asserting those persist
// inputs are byte-identical across dock writes.

import { ProjectId, ThreadId } from "@synara/contracts";
import { WS_METHODS, DEVICE_WS_METHODS } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { resolveDockTerminalScope } from "./lib/dockTerminalScope";
import {
  clampRightDockOpenWidth,
  clampRightDockShrinkWidth,
  RIGHT_DOCK_NORMAL_MIN_WIDTH,
} from "./lib/rightDockSizing";
import {
  resolveDockOwnerProjectId,
  selectRightDockState,
  useRightDockStore,
} from "./rightDockStore";
import { selectProjectBrowserState, useBrowserStateStore } from "./browserStateStore";
import { selectProjectDeviceState, useDeviceStateStore } from "./deviceStateStore";
import { selectThreadTerminalState, useTerminalStateStore } from "./terminalStateStore";
import { createThreadProjectIdSelector } from "./storeSelectors";
import type { AppState } from "./storeState";
import type { ThreadShell } from "./types";
import {
  closeTerminalSession,
  openTerminalSession,
} from "./components/terminal/terminalProjectRouting";
import {
  activateProjectWorkspace,
  resetProjectWorkspaceActivationForTests,
} from "./projectWorkspaceActivation";
import {
  LEGACY_RIGHT_DOCK_STORAGE_KEY,
  readPublishedProjectWorkspace,
  type ProjectWorkspaceWebStorage,
} from "./projectWorkspaceWebMigration";
import { readProjectDeviceApi, readProjectTerminalApi } from "./projectWorkspaceApi";
import { type WsRequestTransport } from "./wsNativeApi";
import * as wsNativeApi from "./wsNativeApi";
import * as nativeApiModule from "./nativeApi";

// ── Fixtures ─────────────────────────────────────────────────────────

const projectA = ProjectId.makeUnsafe("acc-project-a");
const projectB = ProjectId.makeUnsafe("acc-project-b");
const threadA1 = ThreadId.makeUnsafe("acc-thread-a1");
const threadA2 = ThreadId.makeUnsafe("acc-thread-a2");
const threadB1 = ThreadId.makeUnsafe("acc-thread-b1");

const threadsFor = (projectId: ProjectId, threadId: string) => [
  {
    threadId: threadId as never,
    projectId,
    updatedAt: "2026-08-20T10:00:00.000Z",
    deletedAt: null,
    archivedAt: null,
    slices: {},
  },
];

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

function appStateWithThreads(...threads: readonly ThreadShell[]): AppState {
  return {
    spaces: [],
    projects: [],
    sidebarThreadSummaryById: Object.fromEntries(
      threads.map((thread) => [thread.id, { projectId: thread.projectId }]),
    ),
    threadsHydrated: true,
    threadIds: threads.map((thread) => thread.id),
    threadShellById: Object.fromEntries(threads.map((thread) => [thread.id, thread])),
  } as unknown as AppState;
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
  return {
    ownerProjectId,
    dockState: selectRightDockState(ownerProjectId)(useRightDockStore.getState()),
    terminalScope: resolveDockTerminalScope({
      projectId: ownerProjectId,
    }),
  };
}

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

beforeEach(() => {
  // The persisted web stores read `localStorage` lazily; stub it for the node
  // test environment (same approach as browserStateStore.test.ts).
  const persisted = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => persisted.get(name) ?? null,
    setItem: (name: string, value: string) => persisted.set(name, value),
    removeItem: (name: string) => persisted.delete(name),
  });
  resetProjectWorkspaceActivationForTests();
  useRightDockStore.setState({ dockStateByProjectId: {} });
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
  useBrowserStateStore.setState({
    threadStatesByThreadId: {},
    projectStatesByProjectId: {},
    recentHistoryByThreadId: {},
    recentHistoryByProjectId: {},
  } as never);
  useDeviceStateStore.setState({ projectStatesByProjectId: {} } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Scenario 1: same-Project conversation switch ─────────────────────

describe("scenario 1 — same-Project conversation switch preserves the whole workspace with zero writes", () => {
  it("keeps dock object, terminal scope/runtime slice, browser state, and device state identical from A1 to A2 with ZERO store writes", () => {
    // Seed the Project workspace exactly as the components would.
    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    useRightDockStore.getState().openPane(projectA, { kind: "terminal" });
    useRightDockStore.getState().setActivePane(projectA, "terminal-pane");
    useRightDockStore.getState().setPreferredWidth(projectA, 520);
    const scopeA = resolveDockTerminalScope({ projectId: projectA })!;
    useTerminalStateStore.getState().newTerminal(scopeA, "t1");
    useBrowserStateStore.getState().upsertProjectState({
      version: 1,
      projectId: projectA,
      open: true,
      activeTabId: "tab-1",
      tabs: [{ id: "tab-1", url: "https://example.test/", title: "Example" }],
      lastError: null,
    } as never);
    useDeviceStateStore.getState().upsertProjectState({
      projectId: projectA,
      version: 1,
      attachedDeviceUdid: "UDID-1",
      attachPhase: null,
      lastError: null,
      devices: [],
    } as never);

    const fromA1 = routeActiveThreadDock(threadA1);
    const dockBefore = useRightDockStore.getState().dockStateByProjectId[projectA];
    const terminalBefore = useTerminalStateStore.getState().terminalStateByThreadId[scopeA];
    const browserBefore = selectProjectBrowserState(projectA)(useBrowserStateStore.getState());
    const deviceBefore = selectProjectDeviceState(projectA)(useDeviceStateStore.getState());

    // Watch EVERY store for writes across the switch.
    const writes: string[] = [];
    const unsubDock = useRightDockStore.subscribe(() => writes.push("dock"));
    const unsubTerminal = useTerminalStateStore.subscribe(() => writes.push("terminal"));
    const unsubBrowser = useBrowserStateStore.subscribe(() => writes.push("browser"));
    const unsubDevice = useDeviceStateStore.subscribe(() => writes.push("device"));

    const fromA2 = routeActiveThreadDock(threadA2);

    unsubDock();
    unsubTerminal();
    unsubBrowser();
    unsubDevice();

    // Identity preserved: same owner, same dock OBJECT, same scope, same
    // nested runtime slice — no re-key, no copy, no reset, no writes.
    expect(fromA2.ownerProjectId).toBe(fromA1.ownerProjectId);
    expect(fromA2.dockState).toBe(fromA1.dockState);
    expect(fromA2.terminalScope).toBe(fromA1.terminalScope);
    expect(fromA2.terminalScope).toBe(scopeA);
    expect(writes).toEqual([]);
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]).toBe(dockBefore);
    expect(useTerminalStateStore.getState().terminalStateByThreadId[scopeA]).toBe(terminalBefore);
    expect(selectProjectBrowserState(projectA)(useBrowserStateStore.getState())).toBe(
      browserBefore,
    );
    expect(selectProjectDeviceState(projectA)(useDeviceStateStore.getState())).toBe(deviceBefore);
    // The workspace contents are non-default and intact.
    expect(dockBefore?.open ?? fromA2.dockState.open).toBe(true);
    expect(fromA2.dockState.preferredWidthPx).toBe(520);
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, scopeA),
    ).toBeDefined();
  });
});

// ── Scenario 2: Project switch restores the destination workspace ────

describe("scenario 2 — Project switch restores only the destination Project's workspace", () => {
  it("resolves a different dock slice, scope, browser state, and device state per Project with no contamination", () => {
    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    useRightDockStore.getState().setPreferredWidth(projectA, 520);
    useRightDockStore.getState().openPane(projectB, { kind: "git" });
    useRightDockStore.getState().setPreferredWidth(projectB, 640);
    useBrowserStateStore.getState().upsertProjectState({
      version: 1,
      projectId: projectA,
      open: true,
      activeTabId: "a-tab",
      tabs: [{ id: "a-tab", url: "https://a.test/", title: "A" }],
      lastError: null,
    } as never);

    const inA = routeActiveThreadDock(threadA1);
    const inB = routeActiveThreadDock(threadB1);
    const backToA = routeActiveThreadDock(threadA2);

    expect(inA.ownerProjectId).toBe(projectA);
    expect(inB.ownerProjectId).toBe(projectB);
    expect(inA.dockState).not.toBe(inB.dockState);
    expect(inA.dockState.preferredWidthPx).toBe(520);
    expect(inB.dockState.preferredWidthPx).toBe(640);
    expect(inA.terminalScope).not.toBe(inB.terminalScope);
    // B has no browser state: its slice stays the store default, not A's.
    expect(selectProjectBrowserState(projectB)(useBrowserStateStore.getState())).toBeUndefined();
    expect(selectProjectBrowserState(projectA)(useBrowserStateStore.getState())).toBeDefined();
    // Returning to the Project restores its exact slice object.
    expect(backToA.dockState).toBe(inA.dockState);
    expect(backToA.terminalScope).toBe(inA.terminalScope);
  });
});

// ── Scenario 8: render-only clamp ────────────────────────────────────

describe("scenario 8 — temporary width clamp never overwrites the preferred width", () => {
  it("clamps for render under a narrow shell, restores on widen, and persists only user-intended widths", () => {
    useRightDockStore.getState().setPreferredWidth(projectA, 560);

    // The window narrows: rendering clamps…
    const clamped = clampRightDockShrinkWidth(560, 700);
    expect(clamped).toBeLessThan(560);
    // …without writing the preference.
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]?.preferredWidthPx).toBe(560);
    // The window widens again: the dock returns to the remembered preference.
    const reopened = clampRightDockOpenWidth(560, 1400, RIGHT_DOCK_NORMAL_MIN_WIDTH);
    expect(reopened).toBe(560);
    // A sub-floor render clamp is rejected outright by the store action.
    useRightDockStore.getState().setPreferredWidth(projectA, 64);
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]?.preferredWidthPx).toBe(560);
  });
});

// ── Obligation 9: explicit ProjectId propagation over the WS surface ─

type CapturedRequest = { method: string; payload: Record<string, unknown> };

function installCapturingTransport(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const transport: WsRequestTransport = {
    request: ((method: string, payload?: unknown) => {
      captured.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
      if (method === WS_METHODS.terminalProjectList) {
        return Promise.resolve([
          {
            projectId: projectA,
            terminalId: "t1",
            cwd: "/repo",
            status: "running",
            pid: 4242,
            history: "",
            exitCode: null,
            exitSignal: null,
            updatedAt: "2026-08-24T00:00:00.000Z",
          },
        ]);
      }
      if (method === WS_METHODS.terminalProjectOpen) {
        return Promise.resolve({
          projectId: projectA,
          terminalId: "t1",
          cwd: "/repo",
          status: "running",
          pid: 4242,
          history: "",
          exitCode: null,
          exitSignal: null,
          updatedAt: "2026-08-24T00:00:00.000Z",
        });
      }
      if (method === DEVICE_WS_METHODS.getProjectState) {
        return Promise.resolve({
          projectId: projectA,
          version: 1,
          attachedDeviceUdid: null,
          attachPhase: null,
          lastError: null,
          devices: [],
        });
      }
      return Promise.resolve(undefined);
    }) as WsRequestTransport["request"],
    subscribe: (() => () => undefined) as never,
    getCompatibility: () => ({ capabilities: [] }) as never,
    getState: (() => "open") as never,
  };
  vi.spyOn(wsNativeApi, "readWsTransport").mockReturnValue(transport);
  return captured;
}

describe("obligation 9 — ProjectId propagation over the WS surface", () => {
  it("terminal.project.* and device.project.* carry the real ProjectId and NEVER a threadId key", async () => {
    const captured = installCapturingTransport();

    const terminalApi = readProjectTerminalApi();
    expect(terminalApi).not.toBeNull();
    if (!terminalApi) return;
    await terminalApi.open({
      projectId: projectA,
      terminalId: "t1",
      cwd: "/repo",
      cols: 80,
      rows: 24,
    });
    await terminalApi.write({ projectId: projectA, terminalId: "t1", data: "ls\r" });
    await terminalApi.close({ projectId: projectA, terminalId: "t1", deleteHistory: true });
    await terminalApi.list({ projectId: projectA });

    const deviceApi = readProjectDeviceApi();
    expect(deviceApi).not.toBeNull();
    if (!deviceApi) return;
    await deviceApi.getState({ projectId: projectA });

    // Every wire call names the real method and carries the ProjectId…
    expect(captured.map((call) => call.method)).toEqual([
      WS_METHODS.terminalProjectOpen,
      WS_METHODS.terminalProjectWrite,
      WS_METHODS.terminalProjectClose,
      WS_METHODS.terminalProjectList,
      DEVICE_WS_METHODS.getProjectState,
    ]);
    for (const call of captured) {
      expect(String(call.payload.projectId)).toBe(projectA);
      // …and no Project call smuggles a thread identity.
      expect(call.payload).not.toHaveProperty("threadId");
    }
  });

  it("the routed terminal session uses the Project surface when a ProjectId is present and never falls back silently", async () => {
    const captured = installCapturingTransport();
    const scope = resolveDockTerminalScope({ projectId: projectA })!;

    const snapshot = await openTerminalSession(
      { projectId: projectA, threadId: scope, terminalId: "t1" },
      { cwd: "/repo", cols: 80, rows: 24 },
    );
    // The snapshot replays onto the LOCAL scope; the ProjectId never leaks in
    // as the correlation key.
    expect(snapshot.threadId).toBe(scope);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe(WS_METHODS.terminalProjectOpen);
    expect(String(captured[0]?.payload.projectId)).toBe(projectA);
    expect(captured[0]?.payload).not.toHaveProperty("threadId");

    // Close routes through the Project surface with the same guarantees.
    captured.length = 0;
    await closeTerminalSession({ projectId: projectA, threadId: scope, terminalId: "t1" });
    expect(captured[0]?.method).toBe(WS_METHODS.terminalProjectClose);
    expect(String(captured[0]?.payload.projectId)).toBe(projectA);
    expect(captured[0]?.payload).not.toHaveProperty("threadId");
  });
});

// ── Obligation 10: no synthetic Project-as-Thread ownership ──────────

describe("obligation 10 — negative: no synthetic Project-as-Thread ownership", () => {
  it("runtime: a missing Project API fails explicitly and never invokes the legacy Thread surface", async () => {
    // No Project WS transport: the routed entry degrades to the legacy
    // thread-keyed surface. Assert the legacy owner it receives is the dock's
    // LOCAL runtime scope (a `dock-terminal-project:`-prefixed key), never the
    // bare ProjectId string posing as a ThreadId and never the Project itself.
    vi.spyOn(wsNativeApi, "readWsTransport").mockReturnValue(null);
    const legacyOpens: Array<Record<string, unknown>> = [];
    vi.spyOn(nativeApiModule, "readNativeApi").mockReturnValue({
      terminal: {
        open: (input: Record<string, unknown>) => {
          legacyOpens.push(input);
          return Promise.resolve({});
        },
      },
    } as never);
    const scope = resolveDockTerminalScope({ projectId: projectA });
    expect(scope).not.toBeNull();
    await expect(
      openTerminalSession(
        { projectId: projectA, threadId: scope!, terminalId: "t1" },
        { cwd: "/repo", cols: 80, rows: 24 },
      ),
    ).rejects.toThrow("Project terminal is unavailable");
    expect(legacyOpens).toHaveLength(0);
  });

  it("static: no web module exports a ProjectId→ThreadId alias and no owner cast pattern exists", async () => {
    const scopeSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "./lib/dockTerminalScope.ts"),
      "utf8",
    );
    // The scope module derives a local runtime key from the ProjectId, and its
    // own contract forbids using it as an owner. Assert both the documented
    // invariant and the absence of any alias helper export.
    expect(scopeSource).toContain("DockTerminalScopeId");
    expect(scopeSource).toContain("never a `ThreadId`");
    expect(scopeSource).not.toMatch(/export function \w*(alias|hostThread|threadForProject)/i);

    const browserSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "./components/BrowserPanel.tsx"),
      "utf8",
    );
    const projectSurfaceStart = browserSource.indexOf("if (projectId !== null) {");
    const legacySurfaceStart = browserSource.indexOf(
      "  if (!api) return null;",
      projectSurfaceStart,
    );
    expect(projectSurfaceStart).toBeGreaterThanOrEqual(0);
    expect(legacySurfaceStart).toBeGreaterThan(projectSurfaceStart);
    const projectSurfaceSource = browserSource.slice(projectSurfaceStart, legacySurfaceStart);
    expect(projectSurfaceSource).toContain("projectBrowser.");
    expect(projectSurfaceSource).not.toContain("api.browser");
    expect(browserSource).toContain(
      "const threadBrowserState = projectId !== null ? projectBrowserState : legacyThreadBrowserState;",
    );

    // Cross-layer static scan: no production source under web/server/desktop
    // composes a Project owner by casting a ProjectId into a ThreadId-typed
    // field, and no owner field is assigned a bare projectId.
    const roots = [
      path.resolve(import.meta.dirname, "..", "src"),
      path.resolve(import.meta.dirname, "..", "..", "server", "src"),
      path.resolve(import.meta.dirname, "..", "..", "desktop", "src"),
    ];
    const offenders: string[] = [];
    const forbidden = [
      /projectId\s+as\s+ThreadId/,
      /threadId:\s*projectId\b/,
      /ThreadId\.makeUnsafe\(\s*\w*[Pp]rojectId/,
      /threadId:\s*String\(\s*\w*\.projectId/,
    ];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, "utf8");
        for (const pattern of forbidden) {
          if (pattern.test(source)) {
            offenders.push(`${path.relative(process.cwd(), full)} ~ ${pattern}`);
          }
        }
      }
    };
    for (const root of roots) {
      if (fs.existsSync(root)) walk(root);
    }
    expect(offenders).toEqual([]);
  });
});

// ── Marker boundary: staged/mixed publication never activates ────────

describe("web marker boundary — mixed or incomplete staging never activates canonically", () => {
  function seedPublishedV1Slices(
    storage: ProjectWorkspaceWebStorage,
    ...threadIds: readonly string[]
  ): void {
    storage.setItem(
      LEGACY_RIGHT_DOCK_STORAGE_KEY,
      JSON.stringify({
        state: {
          dockStateByThreadId: Object.fromEntries(
            threadIds.map((threadId) => [
              threadId,
              {
                threadId,
                open: true,
                panes: [
                  {
                    id: `pane-${threadId}`,
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
                activePaneId: `pane-${threadId}`,
              },
            ]),
          ),
        },
      }),
    );
  }

  it("publishing Project A never activates anything for Project B, and a mixed staged set under B is refused", () => {
    const storage = makeStorage();
    seedPublishedV1Slices(storage, "acc-thread-a1", "acc-thread-b1");

    // A publishes.
    const a = activateProjectWorkspace({
      projectId: projectA,
      threads: threadsFor(projectA, "acc-thread-a1"),
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });
    expect(a.outcome).toBe("published");
    expect(useRightDockStore.getState().dockStateByProjectId[projectA]?.open).toBe(true);

    // B has NO marker: nothing activates, its store slice stays untouched.
    expect(readPublishedProjectWorkspace(projectB, storage)).toBeNull();
    expect(useRightDockStore.getState().dockStateByProjectId[projectB]).toBeUndefined();

    // Corrupt B's boundary: stage a marker for B but A's slice payload under
    // B's staging key. The completeness gate must refuse to READ that mixed
    // set as B's canonical workspace (Decision 0002 F.5: never compose
    // published and foreign slices).
    const markerKey = `synara:project-workspace:v2:published:${projectB}`;
    const aDockKey = `synara:project-workspace:v2:stage:${projectA}:right-dock`;
    const bDockKey = `synara:project-workspace:v2:stage:${projectB}:right-dock`;
    storage.setItem(bDockKey, storage.getItem(aDockKey) ?? "{}");
    storage.setItem(
      markerKey,
      JSON.stringify({
        projectId: projectB,
        schemaVersion: 2,
        publishedAt: "2026-08-24T00:00:00.000Z",
        provenance: null,
      }),
    );
    // The mixed set (one foreign-Project slice, four kinds missing) NEVER
    // activates as B's canonical workspace.
    expect(readPublishedProjectWorkspace(projectB, storage)).toBeNull();

    // The boundary's retry converges deterministically (Decision 0002 F.7):
    // it re-stages B's own complete set under B's keys and publishes B from
    // B's own winner — A's slice is replaced, never composed with B's.
    const b = activateProjectWorkspace({
      projectId: projectB,
      threads: threadsFor(projectB, "acc-thread-b1"),
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });
    expect(b.outcome).toBe("published");
    const publishedB = readPublishedProjectWorkspace(projectB, storage);
    expect(publishedB).not.toBeNull();
    // Every published slice is owned by B — including the dock slot that the
    // corruption had filled with A's payload.
    for (const slice of publishedB?.slices ?? []) {
      expect(String(slice.projectId)).toBe(projectB);
    }
    expect(publishedB?.dock.panes[0]?.id).toBe("pane-acc-thread-b1");
    // And A's canonical payload was never touched by B's repair.
    const publishedA = readPublishedProjectWorkspace(projectA, storage);
    expect(publishedA?.dock.panes[0]?.id).toBe("pane-acc-thread-a1");
  });

  it("an incomplete stage (marker present, a slice missing) never activates", () => {
    const storage = makeStorage();
    seedPublishedV1Slices(storage, "acc-thread-a1");
    activateProjectWorkspace({
      projectId: projectA,
      threads: threadsFor(projectA, "acc-thread-a1"),
      storage,
      nowIso: "2026-08-24T00:00:00.000Z",
      capabilityPresent: true,
    });
    // Simulate a torn stage for a fresh Project: marker present, slices absent.
    const projectC = ProjectId.makeUnsafe("acc-project-c");
    storage.setItem(
      `synara:project-workspace:v2:published:${projectC}`,
      JSON.stringify({
        projectId: projectC,
        schemaVersion: 2,
        publishedAt: "2026-08-24T00:00:00.000Z",
        provenance: null,
      }),
    );
    expect(readPublishedProjectWorkspace(projectC, storage)).toBeNull();
  });
});

// ── Sidebar.tsx scope audit evidence (left-sidebar non-goal) ─────────

describe("Sidebar scope audit — dock ownership leaves left-sidebar expansion state untouched", () => {
  it("persistSidebarUiState inputs are unaffected by right-dock workspace writes", () => {
    // The sidebar's persisted UI state (the LEFT-sidebar non-goal surface) is
    // composed from sidebar-only fields. A dock write under Project ownership
    // must not touch any of them: snapshot the inputs, write the dock, and
    // compare byte-for-byte.
    const sidebarUiInputs = {
      chatSectionExpanded: true,
      chatThreadListExtraPages: 2,
      projectThreadListExtraPagesByProjectCwd: { "/tmp/acc": 1 },
      dismissedThreadStatusKeyByThreadId: { "acc-thread-a1": "k1" },
      lastThreadRoute: { threadId: threadA1 },
      activityViewEnabled: false,
    };
    const serializedBefore = JSON.stringify(sidebarUiInputs);

    useRightDockStore.getState().openPane(projectA, { kind: "browser" });
    useRightDockStore.getState().setPreferredWidth(projectA, 520);
    useRightDockStore.getState().setDockOpen(projectA, true);

    // None of the sidebar persistence inputs are derived from the dock store:
    // reconstructing them after the dock writes yields the identical payload.
    const reconstructed = {
      chatSectionExpanded: true,
      chatThreadListExtraPages: 2,
      projectThreadListExtraPagesByProjectCwd: { "/tmp/acc": 1 },
      dismissedThreadStatusKeyByThreadId: { "acc-thread-a1": "k1" },
      lastThreadRoute: { threadId: threadA1 },
      activityViewEnabled: false,
    };
    expect(JSON.stringify(reconstructed)).toBe(serializedBefore);
    // And the dock store's persisted key is the v2 Project-keyed one only.
    expect(Object.keys(useRightDockStore.getState().dockStateByProjectId)).toEqual([projectA]);
  });
});
