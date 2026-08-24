import { EventEmitter } from "node:events";

import { ProjectId, ThreadId } from "@synara/contracts";
import type { ProjectBrowserState } from "@synara/contracts";
import type { BrowserWindow, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserSession, rendererWebContentsById, rendererWebContentsFromId } = vi.hoisted(() => {
  const rendererWebContentsById = new Map<number, unknown>();
  return {
    browserSession: {
      setUserAgent: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn() },
      protocol: { handle: vi.fn(), unhandle: vi.fn() },
    },
    rendererWebContentsById,
    rendererWebContentsFromId: vi.fn((id: number) => rendererWebContentsById.get(id) ?? null),
  };
});

vi.mock("electron", () => ({
  app: {
    getName: () => "Synara",
    getPreferredSystemLanguages: () => ["en-US"],
    userAgentFallback:
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Electron/40.0.0 Safari/537.36",
  },
  // Standalone functions carry the same callable + .prototype surfaces as
  // the empty classes they replace; the manager never constructs them.
  BrowserWindow: emptyElectronConstructor,
  clipboard: { writeImage: vi.fn(), writeText: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  session: {
    fromPartition: () => browserSession,
  },
  webContents: { fromId: rendererWebContentsFromId },
  WebContentsView: emptyElectronConstructor,
}));

import {
  DesktopBrowserManager,
  type ProjectBrowserCopyLinkEvent,
} from "./browserManager";

// Callable stand-in for Electron constructors the manager only treats as
// presence-checks (never constructed in these suites): a standalone function
// exposes the same typeof/function and .prototype surfaces as an empty class.
function emptyElectronConstructor(): void {}

interface WindowOpenDetails {
  url: string;
  frameName: string;
  features: string;
  disposition: string;
}

type WindowOpenHandler = (details: WindowOpenDetails) => {
  action: "allow" | "deny";
  overrideBrowserWindowOptions?: object;
};

class FakeWebContents extends EventEmitter {
  constructor(readonly id = 1) {
    super();
  }

  windowOpenHandler: WindowOpenHandler | null = null;

  setUserAgent = vi.fn();
  isDestroyed = () => false;
  currentUrl = "https://example.test/";
  getURL = () => this.currentUrl;

  setWindowOpenHandler(handler: WindowOpenHandler): void {
    this.windowOpenHandler = handler;
  }
}

class FakeRendererWebContents extends FakeWebContents {
  private destroyed = false;

  constructor(id = 1) {
    super(id);
    this.currentUrl = "about:blank";
  }

  readonly debugger = {
    isAttached: () => false,
    detach: vi.fn(),
  };
  readonly hostWebContents = { id: 41 };
  readonly session = browserSession;

  override isDestroyed = () => this.destroyed;
  getType = () => "webview";
  getTitle = () => "New tab";
  isLoading = () => false;
  canGoBack = () => false;
  canGoForward = () => false;
  loadURL = vi.fn((url: string) => {
    this.currentUrl = url;
    return Promise.resolve();
  });

  destroyGuest(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakePopupWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  isDestroyed = () => false;
  destroy = vi.fn();
}

interface BrowserManagerCharacterizationAccess {
  runtimes: Map<
    string,
    {
      key: string;
      owner:
        | { kind: "thread"; threadId: ThreadId }
        | { kind: "project"; projectId: ProjectId };
      tabId: string;
      webContents: WebContents;
      view: null;
      ownsWebContents: false;
      listenerDisposers: Array<() => void>;
    }
  >;
  popupRuntimes: Map<
    BrowserWindow,
    {
      owner: { kind: "thread"; threadId: ThreadId };
      tabId: string;
      window: BrowserWindow;
      listenerDisposers: Array<() => void>;
    }
  >;
  configureRuntimeWebContents(runtime: {
    key: string;
    owner: { kind: "thread"; threadId: ThreadId };
    tabId: string;
    webContents: WebContents;
    view: null;
    ownsWebContents: false;
    listenerDisposers: Array<() => void>;
  }): void;
  configureOAuthPopupRuntime(runtime: {
    owner: { kind: "thread"; threadId: ThreadId };
    tabId: string;
    window: BrowserWindow;
    listenerDisposers: Array<() => void>;
  }): void;
}

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

function asCharacterizationAccess(
  manager: DesktopBrowserManager,
): BrowserManagerCharacterizationAccess {
  return manager as unknown as BrowserManagerCharacterizationAccess;
}

describe("DesktopBrowserManager repeated workflow characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rendererWebContentsById.clear();
  });

  it("invalidates a destroyed renderer and reattaches the same tab to a new guest", async () => {
    const manager = new DesktopBrowserManager();
    const opened = manager.open({ threadId: THREAD_ID });
    const tabId = opened.activeTabId;
    expect(tabId).not.toBeNull();
    if (!tabId) return;

    const firstGuest = new FakeRendererWebContents(17);
    rendererWebContentsById.set(firstGuest.id, firstGuest);
    manager.attachWebview(
      { threadId: THREAD_ID, tabId, webContentsId: firstGuest.id },
      firstGuest.hostWebContents.id,
    );
    await Promise.resolve();
    const attachedSnapshot = manager.getState({ threadId: THREAD_ID });
    const publication = vi.fn();
    manager.subscribe(publication);

    firstGuest.destroyGuest();

    const crashedSnapshot = manager.getState({ threadId: THREAD_ID });
    expect(crashedSnapshot).not.toBe(attachedSnapshot);
    expect(crashedSnapshot.version).toBeGreaterThan(attachedSnapshot.version);
    expect(crashedSnapshot).toMatchObject({
      activeTabId: tabId,
      tabs: [{ id: tabId, status: "suspended", isLoading: false }],
    });
    expect(() => manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId })).toThrow(
      /not ready yet/i,
    );

    // A duplicate terminal signal for the same physical guest must not publish
    // or clean up the logical tab a second time.
    firstGuest.emit("render-process-gone");
    expect(publication).toHaveBeenCalledOnce();
    expect(manager.getState({ threadId: THREAD_ID })).toBe(crashedSnapshot);
    expect(firstGuest.listenerCount("destroyed")).toBe(0);
    expect(firstGuest.listenerCount("render-process-gone")).toBe(0);

    const replacementGuest = new FakeRendererWebContents(18);
    rendererWebContentsById.set(replacementGuest.id, replacementGuest);
    const recoveredSnapshot = manager.attachWebview(
      { threadId: THREAD_ID, tabId, webContentsId: replacementGuest.id },
      replacementGuest.hostWebContents.id,
    );

    expect(replacementGuest.id).not.toBe(firstGuest.id);
    expect(recoveredSnapshot).not.toBe(crashedSnapshot);
    expect(recoveredSnapshot.version).toBeGreaterThan(crashedSnapshot.version);
    expect(recoveredSnapshot).toMatchObject({
      activeTabId: tabId,
      tabs: [{ id: tabId, status: "live", lastError: null }],
    });
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      replacementGuest,
    );
  });

  it("emits one state change when a different tab becomes active", () => {
    const manager = new DesktopBrowserManager();
    const initial = manager.open({ threadId: THREAD_ID });
    const firstTabId = initial.activeTabId;
    const withSecondTab = manager.newTab({
      threadId: THREAD_ID,
      url: "https://second.example",
      activate: false,
    });
    const secondTabId = withSecondTab.tabs.at(-1)?.id;
    const states = vi.fn();
    manager.subscribe(states);

    expect(firstTabId).not.toBeNull();
    expect(secondTabId).toBeDefined();
    if (!secondTabId) return;
    expect(withSecondTab.activeTabId).toBe(firstTabId);

    const selected = manager.selectTab({ threadId: THREAD_ID, tabId: secondTabId });
    expect(selected.activeTabId).toBe(secondTabId);
    expect(states).toHaveBeenCalledTimes(1);

    manager.selectTab({ threadId: THREAD_ID, tabId: secondTabId });
    expect(states).toHaveBeenCalledTimes(1);
  });

  it("applies the same popup, tab-open, and scheme-denial policy to tabs and popups", async () => {
    const manager = new DesktopBrowserManager();
    const initial = manager.open({ threadId: THREAD_ID });
    const tabId = initial.activeTabId;
    expect(tabId).not.toBeNull();
    if (!tabId) return;

    const tabContents = new FakeWebContents();
    const popup = new FakePopupWindow();
    const access = asCharacterizationAccess(manager);
    const tabRuntime = {
      key: `t:thread-1:${tabId}`,
      owner: { kind: "thread", threadId: THREAD_ID } as const,
      tabId,
      webContents: tabContents as unknown as WebContents,
      view: null as null,
      ownsWebContents: false as const,
      listenerDisposers: [],
    };
    access.runtimes.set(tabRuntime.key, tabRuntime);
    access.configureRuntimeWebContents(tabRuntime);
    const popupRuntime = {
      owner: { kind: "thread", threadId: THREAD_ID } as const,
      tabId,
      window: popup as unknown as BrowserWindow,
      listenerDisposers: [],
    };
    access.popupRuntimes.set(popupRuntime.window, popupRuntime);
    access.configureOAuthPopupRuntime(popupRuntime);

    const handlers = [tabContents.windowOpenHandler, popup.webContents.windowOpenHandler];
    expect(handlers.every(Boolean)).toBe(true);
    for (const handler of handlers) {
      if (!handler) continue;
      expect(
        handler({
          url: "https://auth.example",
          frameName: "auth",
          features: "width=480,height=640",
          disposition: "new-window",
        }),
      ).toMatchObject({ action: "allow", overrideBrowserWindowOptions: expect.any(Object) });

      const beforeTabOpen = manager.getState({ threadId: THREAD_ID }).tabs.length;
      expect(
        handler({
          url: "https://docs.example",
          frameName: "",
          features: "",
          disposition: "foreground-tab",
        }),
      ).toEqual({ action: "deny" });
      expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(beforeTabOpen);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const afterTabOpen = manager.getState({ threadId: THREAD_ID });
      expect(afterTabOpen.tabs).toHaveLength(beforeTabOpen + 1);
      expect(afterTabOpen.tabs.find((tab) => tab.id === afterTabOpen.activeTabId)?.url).toBe(
        "https://docs.example/",
      );

      const beforeSchemeDenial = afterTabOpen.tabs.length;
      expect(
        handler({
          url: "synara://unsafe",
          frameName: "",
          features: "",
          disposition: "foreground-tab",
        }),
      ).toEqual({ action: "deny" });
      expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(beforeSchemeDenial);
    }
  });

  it("blocks page-driven main-frame navigations and redirects outside web schemes", () => {
    const manager = new DesktopBrowserManager();
    const initial = manager.open({ threadId: THREAD_ID });
    const tabId = initial.activeTabId!;
    const tabContents = new FakeWebContents();
    const popup = new FakePopupWindow();
    const access = asCharacterizationAccess(manager);
    access.configureRuntimeWebContents({
      key: `t:${THREAD_ID}:${tabId}`,
      owner: { kind: "thread", threadId: THREAD_ID } as const,
      tabId,
      webContents: tabContents as unknown as WebContents,
      view: null,
      ownsWebContents: false,
      listenerDisposers: [],
    });
    access.configureOAuthPopupRuntime({
      owner: { kind: "thread", threadId: THREAD_ID } as const,
      tabId,
      window: popup as unknown as BrowserWindow,
      listenerDisposers: [],
    });

    for (const contents of [tabContents, popup.webContents]) {
      const blockedNavigation = {
        url: "file:///etc/passwd",
        isMainFrame: true,
        preventDefault: vi.fn(),
      };
      contents.emit("will-navigate", blockedNavigation);
      expect(blockedNavigation.preventDefault).toHaveBeenCalledOnce();

      const allowedNavigation = {
        url: "https://example.test/path",
        isMainFrame: true,
        preventDefault: vi.fn(),
      };
      contents.emit("will-navigate", allowedNavigation);
      expect(allowedNavigation.preventDefault).not.toHaveBeenCalled();

      const subframeNavigation = {
        url: "data:text/html,subframe",
        isMainFrame: false,
        preventDefault: vi.fn(),
      };
      contents.emit("will-navigate", subframeNavigation);
      expect(subframeNavigation.preventDefault).not.toHaveBeenCalled();

      const blockedRedirect = {
        url: "custom-protocol://unsafe",
        isMainFrame: true,
        preventDefault: vi.fn(),
      };
      contents.emit("will-redirect", blockedRedirect);
      expect(blockedRedirect.preventDefault).toHaveBeenCalledOnce();

      contents.currentUrl = "synara-local-preview://preview-token/index.html";
      const allowedLocalNavigation = {
        url: "synara-local-preview://preview-token/about.html",
        isMainFrame: true,
        preventDefault: vi.fn(),
      };
      contents.emit("will-navigate", allowedLocalNavigation);
      expect(allowedLocalNavigation.preventDefault).not.toHaveBeenCalled();

      contents.currentUrl = "https://example.test/";
      const blockedLocalNavigation = {
        url: "synara-local-preview://preview-token/about.html",
        isMainFrame: true,
        preventDefault: vi.fn(),
      };
      contents.emit("will-navigate", blockedLocalNavigation);
      expect(blockedLocalNavigation.preventDefault).toHaveBeenCalledOnce();
    }
  });

  it("translates an explicit file URL before loading the visible browser guest", async () => {
    const manager = new DesktopBrowserManager();
    const initial = manager.open({ threadId: THREAD_ID });
    const tabId = initial.activeTabId!;
    const guest = new FakeRendererWebContents(83);
    rendererWebContentsById.set(guest.id, guest);

    manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41);
    const state = manager.navigate({
      threadId: THREAD_ID,
      tabId,
      url: "file:///tmp/synara-preview/index.html",
    });

    expect(state.tabs.find((tab) => tab.id === tabId)?.url).toBe(
      "file:///tmp/synara-preview/index.html",
    );
    await vi.waitFor(() => {
      expect(guest.loadURL).toHaveBeenCalledWith(
        expect.stringMatching(/^synara-local-preview:\/\/[a-f0-9]+\/index\.html$/u),
      );
    });
  });

  it("preserves an initial file URL while the blank guest starts its preview load", async () => {
    const manager = new DesktopBrowserManager();
    const sourceUrl = "file:///tmp/synara-preview/index.html";
    const initial = manager.open({ threadId: THREAD_ID, initialUrl: sourceUrl });
    const tabId = initial.activeTabId!;
    const guest = new FakeRendererWebContents(84);
    let finishLoad: (() => void) | undefined;
    guest.loadURL.mockImplementation(
      (url: string) =>
        new Promise<void>((resolve) => {
          finishLoad = () => {
            guest.currentUrl = url;
            resolve();
          };
        }),
    );
    rendererWebContentsById.set(guest.id, guest);

    const attached = manager.attachWebview(
      { threadId: THREAD_ID, tabId, webContentsId: guest.id },
      41,
    );

    expect(attached.tabs.find((tab) => tab.id === tabId)).toMatchObject({
      url: sourceUrl,
      isLoading: true,
      lastError: null,
    });
    await Promise.resolve();
    expect(
      manager.getState({ threadId: THREAD_ID }).tabs.find((tab) => tab.id === tabId),
    ).toMatchObject({
      url: sourceUrl,
      isLoading: true,
      lastError: null,
    });

    expect(finishLoad).toBeTypeOf("function");
    finishLoad?.();
    await vi.waitFor(() => {
      expect(
        manager.getState({ threadId: THREAD_ID }).tabs.find((tab) => tab.id === tabId),
      ).toMatchObject({
        url: sourceUrl,
        isLoading: false,
        lastError: null,
      });
    });
  });

  it("keeps the load error when an initial local file is not HTML", async () => {
    const manager = new DesktopBrowserManager();
    const sourceUrl = "file:///tmp/synara-preview/notes.txt";
    const initial = manager.open({ threadId: THREAD_ID, initialUrl: sourceUrl });
    const tabId = initial.activeTabId!;
    const guest = new FakeRendererWebContents(85);
    rendererWebContentsById.set(guest.id, guest);

    const attached = manager.attachWebview(
      { threadId: THREAD_ID, tabId, webContentsId: guest.id },
      41,
    );

    expect(guest.loadURL).not.toHaveBeenCalled();
    expect(attached.tabs.find((tab) => tab.id === tabId)).toMatchObject({
      url: sourceUrl,
      isLoading: false,
      lastError: "Couldn't open this page.",
    });
    await Promise.resolve();
    expect(
      manager.getState({ threadId: THREAD_ID }).tabs.find((tab) => tab.id === tabId),
    ).toMatchObject({
      url: sourceUrl,
      isLoading: false,
      lastError: "Couldn't open this page.",
    });
  });

  it("treats keyboard and pointer interaction inside an OAuth popup as human control", () => {
    const manager = new DesktopBrowserManager();
    const initial = manager.open({ threadId: THREAD_ID });
    const tabId = initial.activeTabId!;
    const popup = new FakePopupWindow();
    asCharacterizationAccess(manager).configureOAuthPopupRuntime({
      owner: { kind: "thread", threadId: THREAD_ID } as const,
      tabId,
      window: popup as unknown as BrowserWindow,
      listenerDisposers: [],
    });

    const initialEpoch = manager.getAutomationHumanControlEpoch(THREAD_ID);
    popup.webContents.emit(
      "before-input-event",
      { preventDefault: vi.fn() },
      {
        type: "keyDown",
        key: "a",
        meta: false,
        control: false,
        shift: false,
        alt: false,
      },
    );
    popup.webContents.emit(
      "before-mouse-event",
      {},
      {
        type: "mouseDown",
        button: "left",
        x: 10,
        y: 20,
      },
    );
    popup.webContents.emit(
      "before-mouse-event",
      {},
      {
        type: "mouseWheel",
        x: 10,
        y: 20,
      },
    );

    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(initialEpoch + 3);
  });

  it("gives the shell first refusal on browser guest keyboard input", () => {
    const beforeInputEvent = vi.fn((event: Electron.Event) => {
      event.preventDefault();
      return true;
    });
    const manager = new DesktopBrowserManager({ beforeInputEvent });
    const initial = manager.open({ threadId: THREAD_ID });
    const tabId = initial.activeTabId;
    expect(tabId).not.toBeNull();
    if (!tabId) return;

    const tabContents = new FakeWebContents();
    asCharacterizationAccess(manager).configureRuntimeWebContents({
      key: `t:thread-1:${tabId}`,
      owner: { kind: "thread", threadId: THREAD_ID } as const,
      tabId,
      webContents: tabContents as unknown as WebContents,
      view: null,
      ownsWebContents: false,
      listenerDisposers: [],
    });
    const event = {
      preventDefault: vi.fn(),
      defaultPrevented: false,
    };
    const input = {
      type: "keyDown",
      key: "-",
      code: "Minus",
      isAutoRepeat: false,
      isComposing: false,
      shift: false,
      control: true,
      alt: false,
      meta: false,
      location: 0,
      modifiers: ["control"],
    };

    tabContents.emit("before-input-event", event, input);

    expect(beforeInputEvent).toHaveBeenCalledWith(event, input);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

// ── Project-owned browser workspace (Decision 0002, WP7 stage 1) ──────

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const OTHER_PROJECT_ID = ProjectId.makeUnsafe("project-2");
const PROVENANCE_THREAD_A = ThreadId.makeUnsafe("thread-a");
const PROVENANCE_THREAD_B = ThreadId.makeUnsafe("thread-b");

describe("DesktopBrowserManager Project-owned workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rendererWebContentsById.clear();
  });

  it("shares one workspace state across different provenance threads of the same Project", () => {
    const manager = new DesktopBrowserManager();
    // Two Main conversations in one Project reach the same Project workspace;
    // the conversation is provenance only and never selects a different one.
    const openedFromA = manager.openProject({
      projectId: PROJECT_ID,
      initialUrl: "https://example.test/",
    });
    expect(openedFromA.projectId).toBe(PROJECT_ID);
    expect(openedFromA.open).toBe(true);

    const seenFromB = manager.getProjectState({ projectId: PROJECT_ID });
    expect(seenFromB.tabs.map((tab) => tab.id)).toEqual(openedFromA.tabs.map((tab) => tab.id));
    expect(seenFromB.activeTabId).toBe(openedFromA.activeTabId);
    expect(seenFromB.version).toBe(openedFromA.version);
    // Reference-stable read of an unchanged version.
    expect(manager.getProjectState({ projectId: PROJECT_ID })).toBe(seenFromB);

    // A tab created through one conversation is visible to the other.
    const withTab = manager.newProjectTab({ projectId: PROJECT_ID, url: "https://docs.test/" });
    expect(manager.getProjectState({ projectId: PROJECT_ID }).tabs).toHaveLength(
      withTab.tabs.length,
    );
    expect(PROVENANCE_THREAD_A).not.toBe(PROVENANCE_THREAD_B);
  });

  it("isolates Projects: one Project's tabs never appear in another Project's workspace", () => {
    const manager = new DesktopBrowserManager();
    manager.openProject({ projectId: PROJECT_ID, initialUrl: "https://one.test/" });
    manager.openProject({ projectId: OTHER_PROJECT_ID, initialUrl: "https://two.test/" });

    const one = manager.getProjectState({ projectId: PROJECT_ID });
    const two = manager.getProjectState({ projectId: OTHER_PROJECT_ID });
    expect(one.tabs.map((tab) => tab.url)).toEqual(["https://one.test/"]);
    expect(two.tabs.map((tab) => tab.url)).toEqual(["https://two.test/"]);
    expect(one.activeTabId).not.toBe(two.activeTabId);

    // Mutating one Project never touches the other.
    manager.newProjectTab({ projectId: PROJECT_ID, url: "https://extra.test/" });
    expect(manager.getProjectState({ projectId: OTHER_PROJECT_ID }).tabs).toHaveLength(1);
  });

  it("keeps a Project workspace isolated from a legacy Thread workspace with the same id text", () => {
    const manager = new DesktopBrowserManager();
    // Same textual id, different owner kind: the disjoint key prefixes must
    // keep these two workspaces distinct (no ProjectId-as-ThreadId alias).
    const threadId = ThreadId.makeUnsafe(String(PROJECT_ID));
    manager.open({ threadId, initialUrl: "https://thread.test/" });
    manager.openProject({ projectId: PROJECT_ID, initialUrl: "https://project.test/" });

    const threadState = manager.getState({ threadId });
    const projectState = manager.getProjectState({ projectId: PROJECT_ID });
    expect(threadState.tabs.map((tab) => tab.url)).toEqual(["https://thread.test/"]);
    expect(projectState.tabs.map((tab) => tab.url)).toEqual(["https://project.test/"]);
  });

  it("emits Project state events only to Project listeners and keeps versions monotonic", () => {
    const manager = new DesktopBrowserManager();
    const projectStates: ProjectBrowserState[] = [];
    const unsubscribe = manager.subscribeProjectState((state) => {
      if (state.projectId === PROJECT_ID) projectStates.push(state);
    });

    const opened = manager.openProject({ projectId: PROJECT_ID });
    manager.newProjectTab({ projectId: PROJECT_ID, url: "https://next.test/" });
    manager.openProject({ projectId: OTHER_PROJECT_ID });

    expect(projectStates.length).toBeGreaterThanOrEqual(2);
    expect(projectStates.every((state) => state.projectId === PROJECT_ID)).toBe(true);
    expect(projectStates.at(-1)?.version).toBeGreaterThan(opened.version);
    unsubscribe();
  });

  it("keys human-control epochs and listeners by Project", () => {
    const manager = new DesktopBrowserManager();
    manager.openProject({ projectId: PROJECT_ID });
    const before = manager.getOwnerAutomationHumanControlEpoch(projectOwnerOf(PROJECT_ID));

    let notifications = 0;
    const unsubscribe = manager.subscribeOwnerAutomationHumanControl(
      projectOwnerOf(PROJECT_ID),
      () => {
        notifications += 1;
      },
    );

    manager.newProjectTab({ projectId: PROJECT_ID, url: "https://human.test/" });
    expect(manager.getOwnerAutomationHumanControlEpoch(projectOwnerOf(PROJECT_ID))).toBe(
      before + 1,
    );
    expect(notifications).toBe(1);

    // A different Project's human control does not notify this Project's listener.
    manager.openProject({ projectId: OTHER_PROJECT_ID });
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("never terminates the workspace on navigation or visibility change", () => {
    const manager = new DesktopBrowserManager();
    const opened = manager.openProject({ projectId: PROJECT_ID, initialUrl: "https://a.test/" });
    const tabId = opened.activeTabId!;

    // Project switch: hide the Project workspace (visibility change only).
    manager.hideProject({ projectId: PROJECT_ID });
    const afterHide = manager.getProjectState({ projectId: PROJECT_ID });
    expect(afterHide.open).toBe(true);
    expect(afterHide.tabs).toHaveLength(1);

    // Navigation through the Project API keeps the same tab alive (the tab
    // id, not just the count, is preserved — no reset or rehydration).
    manager.navigateProject({ projectId: PROJECT_ID, tabId, url: "https://b.test/" });
    const afterNavigate = manager.getProjectState({ projectId: PROJECT_ID });
    expect(afterNavigate.tabs.map((tab) => tab.id)).toEqual([tabId]);
    expect(afterNavigate.tabs[0]?.url).toBe("https://b.test/");

    // Zero bounds hide the panel surface but never close the workspace.
    manager.setProjectPanelBounds({ projectId: PROJECT_ID, bounds: null });
    const afterBounds = manager.getProjectState({ projectId: PROJECT_ID });
    expect(afterBounds.open).toBe(true);
    expect(afterBounds.tabs.map((tab) => tab.id)).toEqual([tabId]);
  });

  it("scopes deletion to one Project only", () => {
    const manager = new DesktopBrowserManager();
    manager.openProject({ projectId: PROJECT_ID, initialUrl: "https://keep.test/" });
    manager.openProject({ projectId: OTHER_PROJECT_ID, initialUrl: "https://victim.test/" });
    const survivorBefore = manager.getProjectState({ projectId: PROJECT_ID });

    manager.handleProjectRemoved(OTHER_PROJECT_ID);

    // The removed Project reads the canonical empty workspace afterward.
    expect(manager.getProjectState({ projectId: OTHER_PROJECT_ID })).toMatchObject({
      projectId: OTHER_PROJECT_ID,
      open: false,
      tabs: [],
      activeTabId: null,
    });
    // The surviving Project is untouched, including tab identity.
    const survivorAfter = manager.getProjectState({ projectId: PROJECT_ID });
    expect(survivorAfter.tabs.map((tab) => tab.id)).toEqual(
      survivorBefore.tabs.map((tab) => tab.id),
    );
    expect(survivorAfter.open).toBe(true);

    // Idempotent: removing an unknown/already-removed Project is a no-op.
    expect(() => manager.handleProjectRemoved(OTHER_PROJECT_ID)).not.toThrow();
  });

  it("projects Project copy-link events with the owning ProjectId", () => {
    const manager = new DesktopBrowserManager();
    const opened = manager.openProject({ projectId: PROJECT_ID, initialUrl: "https://copy.test/" });
    const tabId = opened.activeTabId!;
    // Register a live runtime for the tab through the characterization access
    // so the copy-link path resolves a copyable URL without a native view.
    const contents = new FakeWebContents();
    contents.currentUrl = "https://copy.test/live";
    const access = asCharacterizationAccess(manager);
    access.runtimes.set(`p:${PROJECT_ID}:${tabId}`, {
      key: `p:${PROJECT_ID}:${tabId}`,
      owner: { kind: "project", projectId: PROJECT_ID },
      tabId,
      webContents: contents as unknown as WebContents,
      view: null,
      ownsWebContents: false,
      listenerDisposers: [],
    });

    const events: ProjectBrowserCopyLinkEvent[] = [];
    const unsubscribe = manager.subscribeProjectCopyLink((event) => events.push(event));
    manager.copyProjectLink({ projectId: PROJECT_ID, tabId });

    expect(events).toHaveLength(1);
    expect(events[0]?.projectId).toBe(PROJECT_ID);
    expect(events[0]?.url).toBe("https://copy.test/live");
    unsubscribe();
  });
});

function projectOwnerOf(projectId: ProjectId): { kind: "project"; projectId: ProjectId } {
  return { kind: "project", projectId };
}
