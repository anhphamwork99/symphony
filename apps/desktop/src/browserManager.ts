// FILE: browserManager.ts
// Purpose: Owns the desktop in-app browser runtime and maps thread/tab state onto Electron views.
// Layer: Desktop runtime manager
// Depends on: Electron BrowserWindow/WebContentsView, shared browser IPC contracts

import * as Crypto from "node:crypto";

import {
  BrowserWindow,
  clipboard,
  nativeImage,
  session as electronSession,
  webContents as electronWebContents,
  WebContentsView,
} from "electron";
import type { WebContents } from "electron";
import type {
  BrowserAnnotationCancelInput,
  BrowserAnnotationEvent,
  BrowserAnnotationProjectCancelInput,
  BrowserAnnotationProjectEvent,
  BrowserAnnotationProjectSession,
  BrowserAnnotationProjectStartInput,
  BrowserAnnotationProjectSyncMarkersInput,
  BrowserAnnotationSession,
  BrowserAnnotationStartInput,
  BrowserAnnotationSyncMarkersInput,
  BrowserAttachWebviewInput,
  BrowserCaptureScreenshotResult,
  BrowserCopyLinkEvent,
  BrowserDetachWebviewInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserPanelBounds,
  BrowserProjectInput,
  BrowserProjectNavigateInput,
  BrowserProjectNewTabInput,
  BrowserProjectOpenInput,
  BrowserProjectSetPanelBoundsInput,
  BrowserProjectTabInput,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserTabState,
  BrowserThreadInput,
  ProjectBrowserState,
  ProjectId,
  ThreadBrowserState,
  ThreadId,
} from "@synara/contracts";
import { isBrowserCopyLinkChord } from "@synara/shared/browserShortcuts";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  classifyBrowserWindowOpen,
  isBlankBrowserTabUrl,
  normalizeBrowserUrlInput as normalizeUrlInput,
  resolveCopyableBrowserTabUrl,
} from "@synara/shared/browserSession";
import {
  BROWSER_SESSION_PARTITION,
  BrowserSessionPolicy,
  type BrowserSessionDownloadEvent,
} from "./browserSessionPolicy";
import {
  BrowserAnnotationCoordinator,
  type BrowserAnnotationRuntime,
} from "./browserAnnotations/coordinator";
import {
  isLocalFileUrl,
  isLocalHtmlPreviewUrl,
  isSameLocalHtmlPreviewGrant,
} from "./localHtmlPreviewProtocol";

export { BROWSER_SESSION_PARTITION } from "./browserSessionPolicy";
const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS = 1_500;
const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS = 400;
const BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD = 1;
const BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES = 4;
// Browser tools have a published maximum 30 second deadline. Keep a newly
// acquired runtime out of the eviction pool until that action has drained.
const BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS = 31_000;
const BROWSER_THREAD_SUSPEND_DELAY_MS = 30_000;
const BROWSER_AUTOMATION_WINDOW_OPEN_FALLBACK_MS = 2_000;
const BROWSER_DEFERRED_PUBLICATION_DELAY_MS = 16;
const BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS = 100;
const BROWSER_ERROR_ABORTED = -3;

type BrowserStateListener = (state: ThreadBrowserState) => void;
type BrowserProjectStateListener = (state: ProjectBrowserState) => void;

/** Project-owned mirror of {@link BrowserCopyLinkEvent}. */
export interface ProjectBrowserCopyLinkEvent {
  readonly projectId: ProjectId;
  readonly url: string;
}
type BrowserCopyLinkListener = (event: BrowserCopyLinkEvent) => void;
type BrowserHumanControlListener = () => void;
type ProjectBrowserCopyLinkListener = (event: ProjectBrowserCopyLinkEvent) => void;
type BrowserAutomationWindowOpenListener = (event: BrowserAutomationWindowOpenEvent) => void;
type BrowserAutomationDownloadListener = (event: BrowserAutomationDownloadEvent) => void;

export type BrowserAutomationExpectedInput =
  | {
      readonly kind: "key";
      readonly key: string;
      readonly alt: boolean;
      readonly control: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
    }
  | {
      readonly kind: "mouse";
      readonly type: "mouseDown" | "mouseWheel" | "contextMenu";
      readonly x: number;
      readonly y: number;
      readonly button?: "left" | "middle" | "right";
    };

interface PendingBrowserAutomationInput {
  readonly signal: BrowserAutomationExpectedInput;
  expiresAt: number;
}

interface BrowserAutomationDownloadLease {
  readonly listener: BrowserAutomationDownloadListener;
  readonly humanControlEpoch: number;
}

interface BrowserAutomationSideEffectProvenance {
  readonly owner: BrowserWorkspaceOwner;
  readonly humanControlEpoch: number;
}

interface LiveTabRuntime {
  key: string;
  owner: BrowserWorkspaceOwner;
  tabId: string;
  webContents: WebContents;
  view: WebContentsView | null;
  ownsWebContents: boolean;
  listenerDisposers: Array<() => void>;
}

interface OAuthPopupContext {
  owner: BrowserWorkspaceOwner;
  tabId: string;
}

interface OAuthPopupRuntime extends OAuthPopupContext {
  window: BrowserWindow;
  listenerDisposers: Array<() => void>;
}

interface NativeBrowserViewVisibility {
  setVisible?: (visible: boolean) => void;
}

interface PendingRuntimeSync {
  owner: BrowserWorkspaceOwner;
  tabId: string;
  faviconUrls?: string[];
}

interface PendingWindowOpenTask {
  readonly handle: ReturnType<typeof setImmediate>;
  readonly sourceWebContents: WebContents;
}

interface PendingAutomationWindowOpenCommit {
  readonly owner: BrowserWorkspaceOwner;
  readonly sourceTabId: string;
  readonly sourceWebContents: WebContents;
  readonly tab: BrowserTabState;
  readonly fallbackTimer: ReturnType<typeof setTimeout>;
}

interface PendingStatePublication {
  readonly handle: ReturnType<typeof setTimeout>;
  readonly owner: BrowserWorkspaceOwner;
  readonly reattachActiveTab: boolean;
  readonly rendererGuestToReset?: WebContents;
}

const LIVE_TAB_STATUS: BrowserTabState["status"] = "live";
const SUSPENDED_TAB_STATUS: BrowserTabState["status"] = "suspended";
const BACKGROUND_AUTOMATION_BOUNDS: BrowserPanelBounds = {
  x: -10_000,
  y: 0,
  width: 1_280,
  height: 800,
};

interface BrowserPerformanceSnapshot {
  counters: {
    setPanelBoundsCalls: number;
    setPanelBoundsNoopSkips: number;
    setPanelBoundsViewportUpdates: number;
    stateEmitCalls: number;
    stateEmitSkips: number;
    stateCloneCount: number;
    runtimeSyncQueueFlushes: number;
    syncRuntimeStateCalls: number;
    inactiveTabSuspendScheduled: number;
    inactiveTabSuspendCancelled: number;
    inactiveTabBudgetEvictions: number;
    warmInactiveRuntimeCount: number;
  };
  trackedProcessIds: number[];
}

export interface BrowserAutomationVisibleRuntime {
  /** Owning workspace (Decision 0002): Project when known, legacy Thread otherwise. */
  /**
   * Owning workspace. Current manager-created runtimes always provide this;
   * optional keeps existing low-level CDP test fixtures and legacy callers
   * source-compatible while the Project surface is adopted.
   */
  readonly owner?: BrowserWorkspaceOwner;
  /**
   * Caller/provenance conversation for legacy Thread-keyed automation
   * surfaces (panel reveal, host bookkeeping). Present only when the owning
   * workspace is a Thread: a Project-owned runtime carries `owner` and
   * `projectId` instead — there is no synthetic Thread alias (Decision 0002).
   */
  readonly threadId: ThreadId | undefined;
  /** Owning Project when the workspace is Project-owned. */
  readonly projectId?: ProjectId;
  readonly tabId: string;
  readonly webContents: WebContents;
  /**
   * Classifies one imminent native input as agent-generated. The returned
   * disposer must be called once the dispatch has drained so a stale expected
   * signal can never mask a later human action.
   */
  readonly expectAgentInput?: (signal: BrowserAutomationExpectedInput) => () => void;
}

export interface BrowserAutomationPrepareTabInput {
  readonly owner: BrowserWorkspaceOwner;
  readonly url?: string;
  readonly reuse: boolean;
}

export interface BrowserAutomationPrepareNavigationInput {
  readonly owner: BrowserWorkspaceOwner;
  readonly tabId: string;
  readonly url: string;
}

export interface BrowserAutomationWindowOpenEvent {
  readonly owner: BrowserWorkspaceOwner;
  readonly sourceTabId: string;
  readonly kind: "tab" | "popup" | "blocked";
  readonly openedTabId: string | null;
}

export interface BrowserAutomationDownloadEvent {
  readonly owner: BrowserWorkspaceOwner;
  readonly sourceTabId: string;
}

export interface DesktopBrowserManagerOptions {
  beforeInputEvent?: (event: Electron.Event, input: Electron.Input) => boolean;
  annotationPreloadPath?: string;
  /**
   * Notified when a Project's workspace is deleted (Decision 0004): the
   * activation boundary clears only that Project's bookkeeping in response.
   */
  onProjectWorkspaceDeactivated?: (projectId: ProjectId) => void;
}

function createBrowserTab(url = ABOUT_BLANK_URL): BrowserTabState {
  return {
    id: Crypto.randomUUID(),
    url,
    title: defaultTitleForUrl(url),
    runtimeSurface: "renderer",
    status: SUSPENDED_TAB_STATUS,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
  };
}

function threadOwner(threadId: ThreadId): { kind: "thread"; threadId: ThreadId } {
  return { kind: "thread", threadId };
}

/** Map an internal owner onto the annotation coordinator's owner union. */
function toAnnotationOwner(
  owner: BrowserWorkspaceOwner,
): { kind: "thread"; threadId: ThreadId } | { kind: "project"; projectId: ProjectId } {
  return owner;
}

/**
 * Provenance fields for a visible automation runtime: the real ThreadId for a
 * Thread-owned workspace, the real ProjectId for a Project-owned one. A
 * Project runtime never carries a ThreadId — there is no synthetic alias.
 */
function runtimeOwnerProvenance(owner: BrowserWorkspaceOwner): {
  threadId: ThreadId | undefined;
  projectId?: ProjectId;
} {
  if (owner.kind === "thread") return { threadId: owner.threadId };
  return { threadId: undefined, projectId: owner.projectId };
}

function projectOwner(projectId: ProjectId): { kind: "project"; projectId: ProjectId } {
  return { kind: "project", projectId };
}

function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) {
    return "New tab";
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function screenshotFileNameForUrl(url: string): string {
  const fallback = "browser";
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase();
    const normalizedHost = hostname.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${normalizedHost || fallback}-${Date.now()}.png`;
  } catch {
    return `${fallback}-${Date.now()}.png`;
  }
}

function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) return null;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null;
  }

  const width = Math.max(0, Math.floor(bounds.width));
  const height = Math.max(0, Math.floor(bounds.height));
  if (width === 0 || height === 0) {
    return null;
  }

  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  };
}

function isAbortedNavigationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /ERR_ABORTED|\(-3\)/i.test(error.message);
}

function mapBrowserLoadError(errorCode: number): string {
  switch (errorCode) {
    case -102:
      return "Connection refused.";
    case -105:
      return "Couldn't resolve this address.";
    case -106:
      return "You're offline.";
    case -118:
      return "This page took too long to respond.";
    case -137:
      return "A secure connection couldn't be established.";
    case -200:
      return "A secure connection couldn't be established.";
    default:
      return "Couldn't open this page.";
  }
}

/**
 * Internal owner of one browser workspace (Decision 0002): the Right-sidebar
 * browser workspace belongs to the real `ProjectId` and is shared by every
 * Main conversation in that Project. `thread` is the unchanged legacy v1
 * owner surface. Every derived workspace/runtime key carries a disjoint
 * `t:`/`p:` prefix, so a `ProjectId` can never collide with — or alias — a
 * `ThreadId`, and no synthetic Thread identity is ever fabricated.
 */
export type BrowserWorkspaceOwner =
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "project"; readonly projectId: ProjectId };

/** Collision-free workspace key for one owner (not branded as a ThreadId). */
export function browserOwnerWorkspaceKey(owner: BrowserWorkspaceOwner): string {
  return owner.kind === "thread" ? `t:${owner.threadId}` : `p:${owner.projectId}`;
}

/** Collision-free runtime key for one owner's tab. */
export function browserOwnerRuntimeKey(owner: BrowserWorkspaceOwner, tabId: string): string {
  return owner.kind === "thread" ? `t:${owner.threadId}:${tabId}` : `p:${owner.projectId}:${tabId}`;
}

/** Structural equality of two owners via their canonical keys. */
export function browserOwnersEqual(
  left: BrowserWorkspaceOwner,
  right: BrowserWorkspaceOwner,
): boolean {
  return browserOwnerWorkspaceKey(left) === browserOwnerWorkspaceKey(right);
}

/** Owner + tab identity shared by the owner-generic core. */
export interface BrowserOwnerTabInput {
  readonly owner: BrowserWorkspaceOwner;
  readonly tabId: string;
}

/**
 * Owner-generic internal workspace state. Identical tab semantics for Thread
 * (legacy v1) and Project (v2) owners; public projections add the owner
 * identity field at the API boundary (see the to*BrowserState functions).
 */
interface OwnerWorkspaceState {
  version: number;
  open: boolean;
  activeTabId: string | null;
  tabs: BrowserTabState[];
  lastError: string | null;
}

function defaultOwnerWorkspaceState(): OwnerWorkspaceState {
  return {
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

/** Structural slice the state-sync helpers actually consume. */
interface WorkspaceTabErrorView {
  activeTabId: string | null;
  tabs: BrowserTabState[];
  lastError: string | null;
}

function cloneOwnerState(state: OwnerWorkspaceState): OwnerWorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
  };
}

function toThreadBrowserState(
  owner: { readonly kind: "thread"; readonly threadId: ThreadId },
  state: OwnerWorkspaceState,
): ThreadBrowserState {
  return {
    threadId: owner.threadId,
    version: state.version,
    open: state.open,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    lastError: state.lastError,
  };
}

function toProjectBrowserState(
  owner: { readonly kind: "project"; readonly projectId: ProjectId },
  state: OwnerWorkspaceState,
): ProjectBrowserState {
  return {
    projectId: owner.projectId,
    version: state.version,
    open: state.open,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    lastError: state.lastError,
  };
}

function browserBoundsSignature(bounds: BrowserPanelBounds | null): string {
  if (!bounds) {
    return "hidden";
  }

  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
}

function isAllowedBrowserRuntimeNavigation(url: string, currentUrl: string): boolean {
  if (url === ABOUT_BLANK_URL) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return true;
    }
    return isLocalHtmlPreviewUrl(url) && isSameLocalHtmlPreviewGrant(currentUrl, url);
  } catch {
    return false;
  }
}

function normalizeAutomationKey(value: string): string {
  if (value === "Space" || value === " ") {
    return " ";
  }
  return value.length === 1 ? value.toLocaleLowerCase("en-US") : value;
}

function browserAutomationInputMatches(
  expected: BrowserAutomationExpectedInput,
  actual: BrowserAutomationExpectedInput,
): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "key" && actual.kind === "key") {
    return (
      normalizeAutomationKey(expected.key) === normalizeAutomationKey(actual.key) &&
      expected.alt === actual.alt &&
      expected.control === actual.control &&
      expected.meta === actual.meta &&
      expected.shift === actual.shift
    );
  }
  if (expected.kind !== "mouse" || actual.kind !== "mouse") return false;
  return (
    expected.type === actual.type &&
    (expected.button === undefined || expected.button === actual.button) &&
    Math.abs(expected.x - actual.x) <= 1.5 &&
    Math.abs(expected.y - actual.y) <= 1.5
  );
}

export class DesktopBrowserManager {
  private window: BrowserWindow | null = null;
  private activeOwner: BrowserWorkspaceOwner | null = null;
  private activeBounds: BrowserPanelBounds | null = null;
  private activeBoundsOwner: BrowserWorkspaceOwner | null = null;
  private attachedRuntimeKey: string | null = null;
  private attachedBoundsSignature: string | null = null;
  // Owner-keyed workspace registries (Decision 0002). Keys are the disjoint
  // `t:`/`p:` strings from browserOwnerWorkspaceKey — never a branded
  // ThreadId — so legacy Thread workspaces and Project workspaces cannot
  // alias one another.
  private readonly states = new Map<string, OwnerWorkspaceState>();
  private readonly ownerVersionByKey = new Map<string, number>();
  private readonly snapshotCacheByOwnerKey = new Map<
    string,
    { version: number; snapshot: OwnerWorkspaceState }
  >();
  private readonly threadProjectionCacheByKey = new Map<
    string,
    { version: number; projection: ThreadBrowserState }
  >();
  private readonly projectProjectionCacheByKey = new Map<
    string,
    { version: number; projection: ProjectBrowserState }
  >();
  private readonly lastEmittedVersionByOwnerKey = new Map<string, number>();
  private readonly humanControlEpochByOwnerKey = new Map<string, number>();
  private readonly humanControlListenersByOwnerKey = new Map<
    string,
    Set<BrowserHumanControlListener>
  >();
  private readonly expectedAutomationInputsByRuntimeKey = new Map<
    string,
    ReadonlyArray<PendingBrowserAutomationInput>
  >();
  private readonly automationGestureDepthByRuntimeKey = new Map<string, number>();
  private readonly automationWindowOpenListenersByRuntimeKey = new Map<
    string,
    Set<BrowserAutomationWindowOpenListener>
  >();
  private readonly automationDownloadListenersByRuntimeKey = new Map<
    string,
    Set<BrowserAutomationDownloadLease>
  >();
  private readonly automationSideEffectProvenanceByRuntimeKey = new Map<
    string,
    BrowserAutomationSideEffectProvenance
  >();
  private readonly pendingWindowOpenTasksByRuntimeKey = new Map<string, PendingWindowOpenTask>();
  private readonly pendingAutomationWindowOpenCommitsByRuntimeKey = new Map<
    string,
    PendingAutomationWindowOpenCommit
  >();
  private readonly pendingStatePublicationsByKey = new Map<string, PendingStatePublication>();
  private readonly runtimes = new Map<string, LiveTabRuntime>();
  private readonly rendererOnlyRuntimeKeys = new Set<string>();
  private readonly automationRuntimeKeys = new Set<string>();
  private readonly automationRuntimeProtectedUntilByKey = new Map<string, number>();
  private readonly runtimeLastActiveAtByKey = new Map<string, number>();
  private readonly pendingRuntimeSyncs = new Map<string, PendingRuntimeSync>();
  private readonly listeners = new Set<BrowserStateListener>();
  private readonly projectListeners = new Set<BrowserProjectStateListener>();
  private readonly copyLinkListeners = new Set<BrowserCopyLinkListener>();
  private readonly projectCopyLinkListeners = new Set<ProjectBrowserCopyLinkListener>();
  private readonly annotations: BrowserAnnotationCoordinator;
  /** Projects whose workspace publication this manager already applied (Decision 0004). */
  private readonly activatedProjectWorkspaceKeys = new Set<string>();
  // OAuth/sign-in popups opened by pages via `window.open`. Tracked so they can be sized over
  // the panel and torn down cleanly without leaking native windows.
  private readonly popupRuntimes = new Map<BrowserWindow, OAuthPopupRuntime>();
  private readonly sessionPolicy: BrowserSessionPolicy;
  private readonly tabSuspendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly suspendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private backgroundAutomationEvictionTimer: ReturnType<typeof setTimeout> | null = null;
  private runtimeSyncFlushScheduled = false;
  private disposed = false;
  private readonly perfCounters = {
    setPanelBoundsCalls: 0,
    setPanelBoundsNoopSkips: 0,
    setPanelBoundsViewportUpdates: 0,
    stateEmitCalls: 0,
    stateEmitSkips: 0,
    stateCloneCount: 0,
    runtimeSyncQueueFlushes: 0,
    syncRuntimeStateCalls: 0,
    inactiveTabSuspendScheduled: 0,
    inactiveTabSuspendCancelled: 0,
    inactiveTabBudgetEvictions: 0,
    warmInactiveRuntimeCount: 0,
  };

  constructor(private readonly options: DesktopBrowserManagerOptions = {}) {
    this.sessionPolicy = new BrowserSessionPolicy((event) => {
      this.handleSessionDownload(event);
    });
    this.annotations = new BrowserAnnotationCoordinator({
      resolveVisibleRuntime: (input) => {
        const runtime = this.getVisibleAutomationRuntime(input);
        return {
          threadId: input.threadId,
          tabId: runtime.tabId,
          webContents: runtime.webContents,
        };
      },
      resolveProjectVisibleRuntime: (input) => {
        try {
          const runtime = this.getVisibleOwnerAutomationRuntime({
            owner: projectOwner(input.projectId),
            tabId: input.tabId,
          });
          return {
            projectId: input.projectId,
            tabId: runtime.tabId,
            webContents: runtime.webContents,
          };
        } catch {
          return null;
        }
      },
      resolveRuntimeByWebContentsId: (webContentsId) =>
        this.toAnnotationRuntime(this.findRuntimeByWebContentsId(webContentsId)),
      markHumanControl: (owner) => this.markOwnerHumanControl(owner),
    });
  }

  // ── Owner-keyed annotation bridge ───────────────────────────────────
  // The coordinator is keyed by BrowserAnnotationWorkspaceOwner with disjoint
  // t:/p: keys: Thread and Project sessions can never alias. Project-owned
  // runtimes route through the coordinator's Project surface directly; there
  // is no cross-owner mapping anywhere (Decision 0002).
  private clearOwnerAnnotationProjection(owner: BrowserWorkspaceOwner, tabId: string): void {
    this.annotations.clearOwnerProjection(toAnnotationOwner(owner), tabId);
  }

  private handleOwnerAnnotationRuntimeDetached(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContentsId: number,
    reason: "detached" | "destroyed" | "replaced",
  ): void {
    this.annotations.handleOwnerRuntimeDetached(
      toAnnotationOwner(owner),
      tabId,
      webContentsId,
      reason,
    );
  }

  private handleOwnerAnnotationNavigation(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    this.annotations.handleOwnerNavigation(toAnnotationOwner(owner), tabId, webContentsId);
  }

  private handleOwnerAnnotationInPageNavigation(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    this.annotations.handleOwnerInPageNavigation(toAnnotationOwner(owner), tabId, webContentsId);
  }

  private recoverOwnerAnnotationNavigation(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    this.annotations.recoverOwnerNavigation(toAnnotationOwner(owner), tabId, webContentsId);
  }

  setWindow(window: BrowserWindow | null): void {
    const previousWindow = this.window;
    if (previousWindow && previousWindow !== window) {
      // Detach while the old BrowserWindow is still addressable; clearing the
      // field first leaves native child views orphaned over the next renderer.
      this.detachAttachedRuntime();
      this.destroyAllRuntimes();
      this.closeAllPopupWindows();
    }
    this.window = window;
    if (window) {
      const bounds = this.activeOwner ? this.getVisibleBoundsForOwner(this.activeOwner) : null;
      if (this.activeOwner && bounds) {
        this.attachActiveTab(this.activeOwner, bounds);
      }
      return;
    }
  }

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeCopyLink(listener: BrowserCopyLinkListener): () => void {
    this.copyLinkListeners.add(listener);
    return () => {
      this.copyLinkListeners.delete(listener);
    };
  }

  subscribeAnnotationEvents(listener: (event: BrowserAnnotationEvent) => void): () => void {
    return this.annotations.subscribe(listener);
  }

  startAnnotation(input: BrowserAnnotationStartInput): BrowserAnnotationSession {
    return this.annotations.start(input);
  }

  cancelAnnotation(input: BrowserAnnotationCancelInput): void {
    this.annotations.cancel(input);
  }

  syncAnnotationMarkers(input: BrowserAnnotationSyncMarkersInput): void {
    const state = this.states.get(browserOwnerWorkspaceKey(threadOwner(input.threadId)));
    if (!state?.tabs.some((tab) => tab.id === input.tabId)) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    this.annotations.syncMarkers(input);
  }

  resolveAnnotationNavigationTarget(input: {
    threadId: ThreadId;
    tabId?: string;
    annotationId: string;
  }): { readonly tabId: string; readonly url: string } | null {
    const state = this.states.get(browserOwnerWorkspaceKey(threadOwner(input.threadId)));
    if (!state) {
      return null;
    }
    const target = this.annotations.resolveNavigationTarget(
      input.threadId,
      input.annotationId,
      input.tabId,
    );
    if (!target || !state.tabs.some((tab) => tab.id === target.tabId)) {
      return null;
    }
    return { tabId: target.tabId, url: target.liveUrl };
  }

  handleAnnotationGuestMessage(sender: WebContents, payload: unknown): void {
    this.annotations.handleGuestMessage(sender, payload);
  }

  isAnnotationInteractive(threadId: ThreadId): boolean {
    return this.annotations.isInteractive(threadId);
  }

  // ── Owner-keyed annotation surface (Decision 0002, WP7 stage 2A) ────
  //
  // Project annotation requests route through these methods directly; the
  // coordinator keys every session/projection by the owning ProjectId, so a
  // Project surface can never observe a Thread's sessions or vice versa.

  startProjectAnnotation(
    input: BrowserAnnotationProjectStartInput,
  ): BrowserAnnotationProjectSession {
    return this.annotations.startForProject(input);
  }

  cancelProjectAnnotation(input: BrowserAnnotationProjectCancelInput): void {
    this.annotations.cancelForProject(input);
  }

  syncProjectAnnotationMarkers(input: BrowserAnnotationProjectSyncMarkersInput): void {
    const state = this.states.get(browserOwnerWorkspaceKey(projectOwner(input.projectId)));
    if (!state?.tabs.some((tab) => tab.id === input.tabId)) {
      throw new Error("The requested browser tab is not available in this project.");
    }
    this.annotations.syncMarkersForProject(input);
  }

  resolveProjectAnnotationNavigationTarget(input: {
    projectId: ProjectId;
    tabId?: string;
    annotationId: string;
  }): { readonly tabId: string; readonly url: string } | null {
    const state = this.states.get(browserOwnerWorkspaceKey(projectOwner(input.projectId)));
    if (!state) {
      return null;
    }
    const target = this.annotations.resolveProjectAnnotationNavigationTarget(input);
    if (!target || !state.tabs.some((tab) => tab.id === target.tabId)) {
      return null;
    }
    return { tabId: target.tabId, url: target.liveUrl };
  }

  subscribeProjectAnnotationEvents(
    listener: (event: BrowserAnnotationProjectEvent) => void,
  ): () => void {
    return this.annotations.subscribeProjectEvents(listener);
  }

  isOwnerAnnotationInteractive(owner: BrowserWorkspaceOwner): boolean {
    return this.annotations.isInteractiveByOwner(toAnnotationOwner(owner));
  }

  isTrustedRenderer(webContentsId: number): boolean {
    return Boolean(
      this.window && !this.window.isDestroyed() && this.window.webContents.id === webContentsId,
    );
  }

  /**
   * Correlates a page-created window with the agent input that caused it. The
   * short-lived gesture lease stays active until the caller disposes it, so an
   * Electron window-open callback delivered just after the input transport is
   * acknowledged is still classified as agent-owned.
   */
  trackAutomationWindowOpen(
    input: BrowserTabInput,
    listener: BrowserAutomationWindowOpenListener,
  ): () => void {
    return this.trackOwnerAutomationWindowOpen(
      { owner: threadOwner(input.threadId), tabId: input.tabId },
      listener,
    );
  }

  /** Owner-generic core behind {@link trackAutomationWindowOpen}. */
  trackOwnerAutomationWindowOpen(
    input: BrowserOwnerTabInput,
    listener: BrowserAutomationWindowOpenListener,
  ): () => void {
    const key = browserOwnerRuntimeKey(input.owner, input.tabId);
    const listeners = this.automationWindowOpenListenersByRuntimeKey.get(key) ?? new Set();
    listeners.add(listener);
    this.automationWindowOpenListenersByRuntimeKey.set(key, listeners);
    this.beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(listener);
      if (listeners.size === 0) this.automationWindowOpenListenersByRuntimeKey.delete(key);
      this.endAutomationGesture(key);
      if (listeners.size === 0) this.commitPendingAutomationWindowOpen(key);
    };
  }

  /**
   * Observes downloads while a host action is live and records their runtime
   * provenance. Releasing the observer ends host notification, while the
   * provenance remains until human control or runtime teardown so a deferred
   * page side effect still cannot write to disk.
   */
  trackAutomationDownload(
    input: BrowserTabInput,
    listener: BrowserAutomationDownloadListener,
  ): () => void {
    return this.trackOwnerAutomationDownload(
      { owner: threadOwner(input.threadId), tabId: input.tabId },
      listener,
    );
  }

  /** Owner-generic core behind {@link trackAutomationDownload}. */
  trackOwnerAutomationDownload(
    input: BrowserOwnerTabInput,
    listener: BrowserAutomationDownloadListener,
  ): () => void {
    const key = browserOwnerRuntimeKey(input.owner, input.tabId);
    const listeners = this.automationDownloadListenersByRuntimeKey.get(key) ?? new Set();
    const humanControlEpoch = this.getOwnerAutomationHumanControlEpoch(input.owner);
    const lease: BrowserAutomationDownloadLease = {
      listener,
      humanControlEpoch,
    };
    listeners.add(lease);
    this.automationDownloadListenersByRuntimeKey.set(key, listeners);
    // A page can defer the actual navigation/download beyond the native input
    // acknowledgement and the host listener's lifetime. Retain one provenance
    // marker per logical runtime until genuine human input advances the epoch
    // or the runtime is destroyed.
    this.automationSideEffectProvenanceByRuntimeKey.set(key, {
      owner: input.owner,
      humanControlEpoch,
    });
    this.beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(lease);
      if (listeners.size === 0) this.automationDownloadListenersByRuntimeKey.delete(key);
      this.endAutomationGesture(key);
    };
  }

  private beginAutomationGesture(key: string): void {
    this.automationGestureDepthByRuntimeKey.set(
      key,
      (this.automationGestureDepthByRuntimeKey.get(key) ?? 0) + 1,
    );
  }

  private endAutomationGesture(key: string): void {
    const nextDepth = Math.max(0, (this.automationGestureDepthByRuntimeKey.get(key) ?? 1) - 1);
    if (nextDepth === 0) {
      this.automationGestureDepthByRuntimeKey.delete(key);
      return;
    }
    this.automationGestureDepthByRuntimeKey.set(key, nextDepth);
  }

  private configureWindowOpenHandling(
    webContents: WebContents,
    context: OAuthPopupContext,
    listenerDisposers: Array<() => void>,
  ): void {
    const { owner, tabId } = context;

    const blockUnsafeMainFrameNavigation = (
      details: Electron.Event<
        Electron.WebContentsWillNavigateEventParams | Electron.WebContentsWillRedirectEventParams
      >,
      legacyUrl?: string,
      _legacyIsSameDocument?: boolean,
      legacyIsMainFrame?: boolean,
    ) => {
      const url = typeof details.url === "string" ? details.url : (legacyUrl ?? "");
      const isMainFrame =
        typeof details.isMainFrame === "boolean"
          ? details.isMainFrame
          : legacyIsMainFrame !== false;
      if (isMainFrame && !isAllowedBrowserRuntimeNavigation(url, webContents.getURL())) {
        details.preventDefault();
      }
    };
    webContents.on("will-navigate", blockUnsafeMainFrameNavigation);
    webContents.on("will-redirect", blockUnsafeMainFrameNavigation);
    listenerDisposers.push(() => {
      webContents.removeListener("will-navigate", blockUnsafeMainFrameNavigation);
      webContents.removeListener("will-redirect", blockUnsafeMainFrameNavigation);
    });

    // Auth providers can chain web popups (provider -> consent). Page-controlled custom
    // schemes are denied here: browser content must never launch an OS handler implicitly.
    webContents.setWindowOpenHandler((details) => {
      const { url } = details;
      const automationGestureActive = this.isOwnerAutomationGestureActive(owner, tabId);
      const isWebUrl =
        url.startsWith("http://") || url.startsWith("https://") || url === ABOUT_BLANK_URL;
      if (!isWebUrl) {
        if (automationGestureActive) {
          this.emitAutomationWindowOpen({
            owner,
            sourceTabId: tabId,
            kind: "blocked",
            openedTabId: null,
          });
        }
        return { action: "deny" };
      }

      const kind = classifyBrowserWindowOpen({
        url,
        frameName: details.frameName,
        features: details.features,
        disposition: details.disposition,
      });
      if (kind === "popup") {
        if (automationGestureActive) {
          this.emitAutomationWindowOpen({
            owner,
            sourceTabId: tabId,
            kind: "popup",
            openedTabId: null,
          });
        }
        // Allow (don't deny) so Electron creates a real child window that keeps
        // `window.opener`, which the OAuth callback needs to message the page back.
        return {
          action: "allow",
          overrideBrowserWindowOptions: this.sessionPolicy.buildOAuthPopupWindowOptions(
            this.window,
          ),
        };
      }

      // Electron is waiting synchronously for this decision. Updating state here
      // can make the renderer remove the source <webview> re-entrantly while its
      // WebContents is still opening the window. Defer the canonical tab
      // transition until after the handler has returned to Electron.
      this.scheduleWindowOpenTab({
        owner,
        sourceTabId: tabId,
        sourceWebContents: webContents,
        url,
        automationGestureActive,
      });
      return { action: "deny" };
    });

    const didCreateWindow = (childWindow: BrowserWindow) => {
      this.registerOAuthPopupWindow(childWindow, { owner, tabId });
    };
    webContents.on("did-create-window", didCreateWindow);
    listenerDisposers.push(() => {
      webContents.removeListener("did-create-window", didCreateWindow);
    });
  }

  private findRuntimeContext(webContents: WebContents): OAuthPopupContext | null {
    for (const runtime of this.runtimes.values()) {
      if (runtime.webContents === webContents) {
        return { owner: runtime.owner, tabId: runtime.tabId };
      }
    }
    for (const popup of this.popupRuntimes.values()) {
      if (!popup.window.isDestroyed() && popup.window.webContents === webContents) {
        return { owner: popup.owner, tabId: popup.tabId };
      }
    }
    return null;
  }

  private handleSessionDownload(input: BrowserSessionDownloadEvent): void {
    if (this.disposed) return;
    const context = this.findRuntimeContext(input.webContents);
    if (!context) {
      return;
    }
    const runtimeKey = browserOwnerRuntimeKey(context.owner, context.tabId);
    const currentHumanEpoch = this.getOwnerAutomationHumanControlEpoch(context.owner);
    const provenance = this.automationSideEffectProvenanceByRuntimeKey.get(runtimeKey);
    if (!provenance || provenance.humanControlEpoch !== currentHumanEpoch) {
      // A manual download after genuine user input remains native Electron
      // behavior. In particular, no global partition policy blocks it.
      return;
    }

    // Electron guarantees that preventing `will-download` cancels before a
    // target path is selected or bytes are written. Notify the host only after
    // the side effect has been contained so listener failures cannot leak it.
    input.event.preventDefault();
    this.emitAutomationDownload({
      owner: context.owner,
      sourceTabId: context.tabId,
    });
  }

  private scheduleWindowOpenTab(input: {
    readonly owner: BrowserWorkspaceOwner;
    readonly sourceTabId: string;
    readonly sourceWebContents: WebContents;
    readonly url: string;
    readonly automationGestureActive: boolean;
  }): void {
    if (this.disposed) return;
    const key = browserOwnerRuntimeKey(input.owner, input.sourceTabId);
    // One native activation can surface duplicate callbacks in embedded guest
    // runtimes. Only the first decision may create a canonical Synara tab.
    if (
      this.pendingWindowOpenTasksByRuntimeKey.has(key) ||
      this.pendingAutomationWindowOpenCommitsByRuntimeKey.has(key)
    )
      return;

    const handle = setImmediate(() => {
      const pending = this.pendingWindowOpenTasksByRuntimeKey.get(key);
      if (!pending || pending.handle !== handle) return;
      this.pendingWindowOpenTasksByRuntimeKey.delete(key);
      if (
        this.disposed ||
        input.sourceWebContents.isDestroyed() ||
        !this.isCurrentWindowOpenSource(input.owner, input.sourceTabId, input.sourceWebContents)
      ) {
        return;
      }
      const sourceState = this.states.get(browserOwnerWorkspaceKey(input.owner));
      if (!sourceState?.open || !sourceState.tabs.some((tab) => tab.id === input.sourceTabId)) {
        return;
      }

      if (input.automationGestureActive) {
        const tab = createBrowserTab(normalizeUrlInput(input.url));
        const fallbackTimer = setTimeout(() => {
          this.commitPendingAutomationWindowOpen(key);
        }, BROWSER_AUTOMATION_WINDOW_OPEN_FALLBACK_MS);
        fallbackTimer.unref?.();
        this.pendingAutomationWindowOpenCommitsByRuntimeKey.set(key, {
          owner: input.owner,
          sourceTabId: input.sourceTabId,
          sourceWebContents: input.sourceWebContents,
          tab,
          fallbackTimer,
        });
        this.emitAutomationWindowOpen({
          owner: input.owner,
          sourceTabId: input.sourceTabId,
          kind: "tab",
          openedTabId: tab.id,
        });
      } else {
        this.newOwnerTab(input.owner, { url: input.url, activate: true });
      }
      if (!input.automationGestureActive) {
        const bounds = this.getVisibleBoundsForOwner(input.owner);
        if (this.isActiveOwner(input.owner) && bounds) {
          this.attachActiveTab(input.owner, bounds);
        }
      }
    });
    handle.unref?.();
    this.pendingWindowOpenTasksByRuntimeKey.set(key, {
      handle,
      sourceWebContents: input.sourceWebContents,
    });
  }

  private isCurrentWindowOpenSource(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContents: WebContents,
  ): boolean {
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, tabId));
    if (runtime?.webContents === webContents) return true;
    for (const popup of this.popupRuntimes.values()) {
      if (
        browserOwnersEqual(popup.owner, owner) &&
        popup.tabId === tabId &&
        popup.window.webContents === webContents
      ) {
        return true;
      }
    }
    return false;
  }

  private commitPendingAutomationWindowOpen(key: string): void {
    const pending = this.pendingAutomationWindowOpenCommitsByRuntimeKey.get(key);
    if (!pending) return;
    this.pendingAutomationWindowOpenCommitsByRuntimeKey.delete(key);
    clearTimeout(pending.fallbackTimer);
    if (
      this.disposed ||
      pending.sourceWebContents.isDestroyed() ||
      !this.isCurrentWindowOpenSource(pending.owner, pending.sourceTabId, pending.sourceWebContents)
    ) {
      return;
    }
    const state = this.states.get(browserOwnerWorkspaceKey(pending.owner));
    if (
      !state?.open ||
      !state.tabs.some((tab) => tab.id === pending.sourceTabId) ||
      state.tabs.some((tab) => tab.id === pending.tab.id)
    ) {
      return;
    }

    state.tabs = [...state.tabs, pending.tab];
    state.activeTabId = pending.tab.id;
    pending.tab.runtimeSurface = "native";
    this.automationRuntimeKeys.add(browserOwnerRuntimeKey(pending.owner, pending.tab.id));
    syncThreadLastError(state);
    this.markOwnerStateChanged(pending.owner);
    // The host can now reconcile openedTabId from canonical state, but the
    // renderer must not remove the source guest until Electron has completely
    // unwound the native window-open activation and the click response.
    this.scheduleDeferredStatePublication(key, pending.owner, true);
  }

  private scheduleDeferredStatePublication(
    key: string,
    owner: BrowserWorkspaceOwner,
    reattachActiveTab: boolean,
    rendererGuestToReset?: WebContents,
  ): void {
    if (this.disposed || this.pendingStatePublicationsByKey.has(key)) return;
    const handle = setTimeout(() => {
      const pending = this.pendingStatePublicationsByKey.get(key);
      if (!pending || pending.handle !== handle) return;
      this.pendingStatePublicationsByKey.delete(key);
      if (this.disposed || !this.states.has(browserOwnerWorkspaceKey(owner))) return;
      if (pending.rendererGuestToReset && !pending.rendererGuestToReset.isDestroyed()) {
        void pending.rendererGuestToReset.loadURL(ABOUT_BLANK_URL).catch(() => {
          // The logical tab is already closed and unroutable. A guest destroyed
          // concurrently by the renderer needs no further cleanup here.
        });
      }
      this.emitOwnerState(owner);
      const bounds = pending.reattachActiveTab ? this.getVisibleBoundsForOwner(owner) : null;
      if (pending.reattachActiveTab && this.isActiveOwner(owner) && bounds) {
        this.attachActiveTab(owner, bounds);
      }
    }, BROWSER_DEFERRED_PUBLICATION_DELAY_MS);
    // This timer is part of the observable close/window-open handshake. Keep it
    // referenced: an unref'ed Node timer does not reliably wake Electron's main
    // loop once the triggering IPC request has drained, which can leave the
    // renderer displaying a WebView for a tab that is already closed.
    this.pendingStatePublicationsByKey.set(key, {
      handle,
      owner,
      reattachActiveTab,
      ...(rendererGuestToReset ? { rendererGuestToReset } : {}),
    });
  }

  private discardPendingAutomationWindowOpen(key: string): void {
    const pending = this.pendingAutomationWindowOpenCommitsByRuntimeKey.get(key);
    if (!pending) return;
    clearTimeout(pending.fallbackTimer);
    this.pendingAutomationWindowOpenCommitsByRuntimeKey.delete(key);
  }

  private clearPendingWindowOpenTask(owner: BrowserWorkspaceOwner, tabId: string): void {
    const key = browserOwnerRuntimeKey(owner, tabId);
    const pending = this.pendingWindowOpenTasksByRuntimeKey.get(key);
    if (pending) {
      clearImmediate(pending.handle);
      this.pendingWindowOpenTasksByRuntimeKey.delete(key);
    }
    this.discardPendingAutomationWindowOpen(key);
    const publication = this.pendingStatePublicationsByKey.get(key);
    if (publication) {
      clearTimeout(publication.handle);
      this.pendingStatePublicationsByKey.delete(key);
    }
  }

  private clearAllPendingWindowOpenTasks(): void {
    for (const pending of this.pendingWindowOpenTasksByRuntimeKey.values()) {
      clearImmediate(pending.handle);
    }
    this.pendingWindowOpenTasksByRuntimeKey.clear();
    for (const pending of this.pendingAutomationWindowOpenCommitsByRuntimeKey.values()) {
      clearTimeout(pending.fallbackTimer);
    }
    this.pendingAutomationWindowOpenCommitsByRuntimeKey.clear();
    for (const pending of this.pendingStatePublicationsByKey.values()) {
      clearTimeout(pending.handle);
    }
    this.pendingStatePublicationsByKey.clear();
  }

  private registerOAuthPopupWindow(popup: BrowserWindow, context: OAuthPopupContext): void {
    if (this.popupRuntimes.has(popup)) {
      return;
    }
    const runtime: OAuthPopupRuntime = {
      ...context,
      window: popup,
      listenerDisposers: [],
    };
    this.popupRuntimes.set(popup, runtime);
    popup.setMenuBarVisibility(false);
    this.configureOAuthPopupRuntime(runtime);
    this.centerPopupWindow(runtime);
  }

  private configureOAuthPopupRuntime(runtime: OAuthPopupRuntime): void {
    const { window: popup } = runtime;
    const { webContents } = popup;
    this.sessionPolicy.applyUserAgent(webContents);
    const closeOnInput = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== "keyDown") {
        return;
      }
      this.markOwnerHumanControl(runtime.owner);
      const key = input.key.toLowerCase();
      const isCloseChord =
        key === "escape" ||
        (key === "w" && !input.shift && !input.alt && (input.meta || input.control));
      if (!isCloseChord) {
        return;
      }
      event.preventDefault();
      this.closePopupRuntime(runtime);
    };
    webContents.on("before-input-event", closeOnInput);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-input-event", closeOnInput);
    });

    const markPopupPointerControl = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
      if (
        input.type === "mouseDown" ||
        input.type === "mouseWheel" ||
        input.type === "contextMenu"
      ) {
        this.markOwnerHumanControl(runtime.owner);
      }
    };
    webContents.on("before-mouse-event", markPopupPointerControl);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-mouse-event", markPopupPointerControl);
    });

    this.configureWindowOpenHandling(webContents, runtime, runtime.listenerDisposers);

    popup.once("closed", () => {
      this.removePopupRuntime(runtime);
    });
  }

  private removePopupRuntime(runtime: OAuthPopupRuntime): void {
    if (this.popupRuntimes.get(runtime.window) !== runtime) {
      return;
    }
    for (const dispose of runtime.listenerDisposers.splice(0)) {
      dispose();
    }
    this.popupRuntimes.delete(runtime.window);
  }

  private closePopupRuntime(runtime: OAuthPopupRuntime): void {
    this.removePopupRuntime(runtime);
    if (!runtime.window.isDestroyed()) {
      runtime.window.destroy();
    }
  }

  private centerPopupWindow(runtime: OAuthPopupRuntime): void {
    const parent = this.window;
    const popup = runtime.window;
    if (!parent || parent.isDestroyed() || popup.isDestroyed()) {
      return;
    }
    const parentBounds = parent.getBounds();
    const popupBounds = popup.getBounds();
    const nextBounds = {
      x: Math.round(parentBounds.x + (parentBounds.width - popupBounds.width) / 2),
      y: Math.round(parentBounds.y + (parentBounds.height - popupBounds.height) / 2),
      width: popupBounds.width,
      height: popupBounds.height,
    };
    if (
      popupBounds.x === nextBounds.x &&
      popupBounds.y === nextBounds.y &&
      popupBounds.width === nextBounds.width &&
      popupBounds.height === nextBounds.height
    ) {
      return;
    }
    popup.setBounds(nextBounds);
  }

  private updatePopupWindowsForOwner(owner: BrowserWorkspaceOwner): void {
    for (const runtime of this.popupRuntimes.values()) {
      if (browserOwnersEqual(runtime.owner, owner)) {
        this.centerPopupWindow(runtime);
      }
    }
  }

  private closePopupWindowsWhere(shouldClose: (runtime: OAuthPopupRuntime) => boolean): void {
    // closePopupRuntime removes entries from popupRuntimes mid-iteration;
    // the snapshot spread keeps the loop over the original set stable.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const runtime of [...this.popupRuntimes.values()]) {
      if (shouldClose(runtime)) {
        this.closePopupRuntime(runtime);
      }
    }
  }

  private closePopupWindowsForOwner(owner: BrowserWorkspaceOwner): void {
    this.closePopupWindowsWhere((runtime) => browserOwnersEqual(runtime.owner, owner));
  }

  private closePopupWindowsForTab(owner: BrowserWorkspaceOwner, tabId: string): void {
    this.closePopupWindowsWhere(
      (runtime) => browserOwnersEqual(runtime.owner, owner) && runtime.tabId === tabId,
    );
  }

  private closeAllPopupWindows(): void {
    this.closePopupWindowsWhere(() => true);
  }

  dispose(): void {
    this.disposed = true;
    this.annotations.dispose();
    this.sessionPolicy.dispose();
    this.clearAllPendingWindowOpenTasks();
    for (const timer of this.suspendTimers.values()) {
      clearTimeout(timer);
    }
    this.suspendTimers.clear();
    for (const timer of this.tabSuspendTimers.values()) {
      clearTimeout(timer);
    }
    this.tabSuspendTimers.clear();
    if (this.backgroundAutomationEvictionTimer !== null) {
      clearTimeout(this.backgroundAutomationEvictionTimer);
      this.backgroundAutomationEvictionTimer = null;
    }
    this.detachAttachedRuntime();
    this.destroyAllRuntimes();
    this.closeAllPopupWindows();
    this.pendingRuntimeSyncs.clear();
    this.runtimeLastActiveAtByKey.clear();
    this.rendererOnlyRuntimeKeys.clear();
    this.automationRuntimeKeys.clear();
    this.automationRuntimeProtectedUntilByKey.clear();
    this.listeners.clear();
    this.projectListeners.clear();
    this.copyLinkListeners.clear();
    this.projectCopyLinkListeners.clear();
    this.states.clear();
    this.ownerVersionByKey.clear();
    this.snapshotCacheByOwnerKey.clear();
    this.threadProjectionCacheByKey.clear();
    this.projectProjectionCacheByKey.clear();
    this.lastEmittedVersionByOwnerKey.clear();
    this.humanControlEpochByOwnerKey.clear();
    this.humanControlListenersByOwnerKey.clear();
    this.expectedAutomationInputsByRuntimeKey.clear();
    this.automationGestureDepthByRuntimeKey.clear();
    this.automationWindowOpenListenersByRuntimeKey.clear();
    this.automationDownloadListenersByRuntimeKey.clear();
    this.automationSideEffectProvenanceByRuntimeKey.clear();
    this.window = null;
    this.activeOwner = null;
    this.activeBounds = null;
    this.activeBoundsOwner = null;
    this.attachedBoundsSignature = null;
    this.runtimeSyncFlushScheduled = false;
  }

  getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    this.perfCounters.warmInactiveRuntimeCount = this.countWarmInactiveRuntimes();
    return {
      counters: { ...this.perfCounters },
      trackedProcessIds: this.getTrackedProcessIds(),
    };
  }

  getAutomationHumanControlEpoch(threadId: ThreadId): number {
    return this.getOwnerAutomationHumanControlEpoch(threadOwner(threadId));
  }

  subscribeAutomationHumanControl(
    threadId: ThreadId,
    listener: BrowserHumanControlListener,
  ): () => void {
    return this.subscribeOwnerAutomationHumanControl(threadOwner(threadId), listener);
  }

  /** Owner-generic human-control epoch (Decision 0002). */
  getOwnerAutomationHumanControlEpoch(owner: BrowserWorkspaceOwner): number {
    return this.humanControlEpochByOwnerKey.get(browserOwnerWorkspaceKey(owner)) ?? 0;
  }

  /** Owner-generic human-control subscription (Decision 0002). */
  subscribeOwnerAutomationHumanControl(
    owner: BrowserWorkspaceOwner,
    listener: BrowserHumanControlListener,
  ): () => void {
    const key = browserOwnerWorkspaceKey(owner);
    let listeners = this.humanControlListenersByOwnerKey.get(key);
    if (!listeners) {
      listeners = new Set();
      this.humanControlListenersByOwnerKey.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.humanControlListenersByOwnerKey.delete(key);
    };
  }

  /** Legacy Thread-keyed automation surface (provenance caller for v1 hosts). */
  prepareAutomationTab(input: {
    readonly threadId: ThreadId;
    readonly url?: string;
    readonly reuse: boolean;
  }): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.prepareOwnerAutomationTab({
        owner,
        ...(input.url === undefined ? {} : { url: input.url }),
        reuse: input.reuse,
      }),
    );
  }

  /** Selects a scoped tab for a legacy Thread-keyed automation caller. */
  selectAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.selectOwnerAutomationTab({ owner, tabId: input.tabId }),
    );
  }

  /** Projects a navigation for a legacy Thread-keyed automation caller. */
  prepareAutomationNavigation(input: {
    readonly threadId: ThreadId;
    readonly tabId: string;
    readonly url: string;
  }): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.prepareOwnerAutomationNavigation({ owner, tabId: input.tabId, url: input.url }),
    );
  }

  /** Returns the visible runtime for a legacy Thread-keyed automation caller. */
  getVisibleAutomationRuntime(input: BrowserTabInput): BrowserAutomationVisibleRuntime {
    return this.getVisibleOwnerAutomationRuntime({
      owner: threadOwner(input.threadId),
      tabId: input.tabId,
    });
  }

  /** Returns the canonical runtime for a legacy Thread-keyed automation caller. */
  async getAutomationRuntime(
    input: BrowserTabInput,
    options: { readonly restore?: boolean } = {},
  ): Promise<BrowserAutomationVisibleRuntime> {
    return this.getOwnerAutomationRuntime(
      { owner: threadOwner(input.threadId), tabId: input.tabId },
      options,
    );
  }

  /** Closes a tab for a legacy Thread-keyed automation caller. */
  closeAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.closeOwnerAutomationTab({ owner, tabId: input.tabId }),
    );
  }

  /** Prepares an agent-owned tab whose native runtime can outlive the chat route. */
  prepareOwnerAutomationTab(input: {
    readonly owner: BrowserWorkspaceOwner;
    readonly url?: string | undefined;
    readonly reuse: boolean;
  }): OwnerWorkspaceState {
    const hadExistingTab =
      (this.states.get(browserOwnerWorkspaceKey(input.owner))?.tabs.length ?? 0) > 0;
    const state = this.ensureOwnerWorkspace(input.owner, input.url);
    let tab = input.reuse || !hadExistingTab ? this.getActiveTab(state) : null;
    if (!tab) {
      tab = createBrowserTab(normalizeUrlInput(input.url));
      state.tabs = [...state.tabs, tab];
    }

    this.claimOwnerAutomationTab(input.owner, tab);

    if (input.url !== undefined) {
      const nextUrl = normalizeUrlInput(input.url);
      tab.url = nextUrl;
      tab.title = defaultTitleForUrl(nextUrl);
      tab.lastCommittedUrl = null;
      tab.lastError = null;
    }
    state.open = true;
    state.activeTabId = tab.id;
    syncThreadLastError(state);
    this.markOwnerStateChanged(input.owner);
    this.emitOwnerState(input.owner);
    return state;
  }

  /** Selects a scoped tab and keeps it available to background automation. */
  selectOwnerAutomationTab(input: BrowserOwnerTabInput): OwnerWorkspaceState {
    const state = this.states.get(browserOwnerWorkspaceKey(input.owner));
    const tab = state ? this.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this workspace.");
    }

    let didChange = false;
    didChange = this.claimOwnerAutomationTab(input.owner, tab) || didChange;
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      didChange = true;
    }
    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      this.markOwnerStateChanged(input.owner);
      this.emitOwnerState(input.owner);
    }
    return state;
  }

  /** Projects a navigation into the persistent agent-owned runtime state. */
  prepareOwnerAutomationNavigation(
    input: BrowserAutomationPrepareNavigationInput,
  ): OwnerWorkspaceState {
    const state = this.states.get(browserOwnerWorkspaceKey(input.owner));
    const tab = state ? this.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this workspace.");
    }
    this.claimOwnerAutomationTab(input.owner, tab);
    const nextUrl = normalizeUrlInput(input.url);
    tab.url = nextUrl;
    tab.title = defaultTitleForUrl(nextUrl);
    tab.lastCommittedUrl = null;
    tab.lastError = null;
    state.activeTabId = tab.id;
    syncThreadLastError(state);
    this.markOwnerStateChanged(input.owner);
    this.emitOwnerState(input.owner);
    return state;
  }

  /**
   * Returns the existing page currently displayed by the requested thread,
   * whether it is a native agent view or a legacy renderer guest. Annotation
   * callers rely on this method never constructing or revealing a runtime.
   */
  getVisibleOwnerAutomationRuntime(input: BrowserOwnerTabInput): BrowserAutomationVisibleRuntime {
    const state = this.states.get(browserOwnerWorkspaceKey(input.owner));
    const tab = state ? this.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this workspace.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("The requested browser tab is not the visible tab for this workspace.");
    }

    const runtime = this.runtimes.get(browserOwnerRuntimeKey(input.owner, tab.id));
    if (!runtime || runtime.webContents.isDestroyed()) {
      throw new Error("The visible browser page is not ready yet.");
    }
    if (runtime.ownsWebContents) {
      if (
        !runtime.view ||
        !this.window ||
        !this.isActiveOwner(input.owner) ||
        this.attachedRuntimeKey !== runtime.key ||
        this.getVisibleBoundsForOwner(input.owner) === null
      ) {
        throw new Error("The requested native browser page is not currently visible.");
      }
      return {
        owner: input.owner,
        ...runtimeOwnerProvenance(input.owner),
        tabId: tab.id,
        webContents: runtime.webContents,
        expectAgentInput: (signal) => this.expectOwnerAutomationInput(input.owner, tab.id, signal),
      };
    }
    // A renderer guest can remain alive briefly while its panel is hidden or a
    // different workspace is becoming active. It is not the user-visible browser
    // during that interval, so routing CDP to it would create exactly the split
    // brain this boundary exists to prevent.
    if (
      this.window &&
      (!this.isActiveOwner(input.owner) ||
        this.attachedRuntimeKey !== runtime.key ||
        this.getVisibleBoundsForOwner(input.owner) === null ||
        runtime.webContents.hostWebContents?.id !== this.window.webContents.id)
    ) {
      throw new Error("The requested browser webview is not currently visible.");
    }
    return {
      owner: input.owner,
      ...runtimeOwnerProvenance(input.owner),
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) => this.expectOwnerAutomationInput(input.owner, tab.id, signal),
    };
  }

  /**
   * Returns the canonical agent runtime even when its thread is not visible.
   * Agent tabs are native WebContentsViews: hiding a view changes only its
   * bounds, never the page process, DOM, history, or in-flight navigation.
   */
  async getOwnerAutomationRuntime(
    input: BrowserOwnerTabInput,
    options: { readonly restore?: boolean } = {},
  ): Promise<BrowserAutomationVisibleRuntime> {
    const state = this.states.get(browserOwnerWorkspaceKey(input.owner));
    const tab = state ? this.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this workspace.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("The requested browser tab is not the active tab for this workspace.");
    }

    const didChange = this.claimOwnerAutomationTab(input.owner, tab);
    const runtime = this.ensureOwnerLiveRuntime(input.owner, tab.id);
    this.noteAutomationRuntimeUse(runtime.key);
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const currentUrl = this.sessionPolicy.resolveDisplayUrl(runtime.webContents.getURL());
    if ((options.restore ?? true) && (currentUrl.length === 0 || currentUrl !== expectedUrl)) {
      await this.loadOwnerTab(input.owner, tab.id, { force: true, runtime });
    } else if (!(options.restore ?? true) && currentUrl.length === 0) {
      // A fresh WebContentsView has no main frame until its first load. Bootstrap
      // an inert document so the host's subsequent CDP Page.navigate can observe
      // lifecycle events even while the view is parked outside the visible shell.
      await runtime.webContents.loadURL(ABOUT_BLANK_URL);
      tab.url = expectedUrl;
      tab.title = defaultTitleForUrl(expectedUrl);
      tab.lastCommittedUrl = null;
      tab.lastError = null;
    } else {
      this.queueOwnerRuntimeStateSync(input.owner, tab.id);
    }
    if (didChange) {
      this.markOwnerStateChanged(input.owner);
      this.emitOwnerState(input.owner);
    }
    return {
      owner: input.owner,
      ...runtimeOwnerProvenance(input.owner),
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) => this.expectOwnerAutomationInput(input.owner, tab.id, signal),
    };
  }

  /** Closes a tab without selecting or constructing a native fallback. */
  closeOwnerAutomationTab(input: BrowserOwnerTabInput): OwnerWorkspaceState {
    const state = this.states.get(browserOwnerWorkspaceKey(input.owner));
    const tab = state ? this.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this workspace.");
    }

    this.closePopupWindowsForTab(input.owner, input.tabId);
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(input.owner, input.tabId));
    const preservesRendererGuest = Boolean(
      runtime &&
      !runtime.ownsWebContents &&
      state.tabs.some((candidate) => candidate.id !== input.tabId),
    );
    const defersFinalRendererRemoval = Boolean(
      runtime && !runtime.ownsWebContents && !preservesRendererGuest,
    );
    this.destroyOwnerRuntime(input.owner, input.tabId, {
      preserveRendererDebugger: preservesRendererGuest,
    });
    this.clearOwnerAnnotationProjection(input.owner, input.tabId);
    this.rendererOnlyRuntimeKeys.delete(browserOwnerRuntimeKey(input.owner, input.tabId));
    this.automationRuntimeKeys.delete(browserOwnerRuntimeKey(input.owner, input.tabId));
    state.tabs = state.tabs.filter((candidate) => candidate.id !== input.tabId);
    if (state.activeTabId === input.tabId) {
      state.activeTabId = state.tabs.at(-1)?.id ?? null;
    }
    syncThreadLastError(state);
    this.markOwnerStateChanged(input.owner);
    if (defersFinalRendererRemoval) {
      // Removing a live <webview> from an IPC state callback while the close
      // request is still unwinding can deadlock Electron. Publish on the next
      // frame after the debugger has detached and the tool response can drain.
      this.scheduleDeferredStatePublication(
        browserOwnerRuntimeKey(input.owner, input.tabId),
        input.owner,
        false,
        runtime?.webContents,
      );
    } else {
      const bounds = this.getVisibleBoundsForOwner(input.owner);
      if (this.isActiveOwner(input.owner) && state.activeTabId && bounds) {
        this.attachActiveTab(input.owner, bounds);
      }
      this.emitOwnerState(input.owner);
    }
    return state;
  }

  open(input: BrowserOpenInput): ThreadBrowserState {
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.openOwner(threadOwner(input.threadId), input.initialUrl),
    );
  }

  /** Owner-generic open core (Decision 0002). */
  private openOwner(
    owner: BrowserWorkspaceOwner,
    initialUrl?: string | undefined,
  ): OwnerWorkspaceState {
    const previousState = this.states.get(browserOwnerWorkspaceKey(owner));
    const nextInitialUrl = initialUrl ? normalizeUrlInput(initialUrl) : null;
    const previousActiveTab = previousState ? this.getActiveTab(previousState) : null;
    const willNavigateExistingTab =
      nextInitialUrl !== null &&
      previousActiveTab !== null &&
      previousActiveTab.url !== nextInitialUrl;
    // BrowserPanel mounts by hydrating state already prepared by browser_open.
    // That renderer lifecycle is agent-caused, not a human takeover. Manual
    // opens that change visibility still advance the epoch; URL changes flow
    // through navigate(), which advances it exactly once.
    if (previousState?.open !== true && !willNavigateExistingTab) {
      this.markOwnerHumanControl(owner);
    }
    const state = this.ensureOwnerWorkspace(owner, initialUrl);
    const didChange = !state.open;
    state.open = true;
    const activeTab = nextInitialUrl ? this.getActiveTab(state) : null;
    if (nextInitialUrl && activeTab && activeTab.url !== nextInitialUrl) {
      this.navigateOwner(owner, activeTab.id, nextInitialUrl);
      return this.states.get(browserOwnerWorkspaceKey(owner)) ?? state;
    }

    const nextDidChange = syncThreadLastError(state) || didChange;

    if (
      this.activeBounds &&
      this.activeBoundsOwner !== null &&
      browserOwnersEqual(this.activeBoundsOwner, owner) &&
      (this.activeOwner === null || this.isActiveOwner(owner))
    ) {
      const visibleTab = this.getActiveTab(state);
      if (!isBlankBrowserTabUrl(visibleTab)) {
        this.activateOwner(owner, this.activeBounds);
      }
    }

    if (nextDidChange) {
      this.markOwnerStateChanged(owner);
    }
    this.emitOwnerState(owner);
    return state;
  }

  close(input: BrowserThreadInput): ThreadBrowserState {
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.closeOwner(threadOwner(input.threadId)),
    );
  }

  /** Owner-generic close core (explicit user close only — never navigation). */
  private closeOwner(owner: BrowserWorkspaceOwner): OwnerWorkspaceState {
    this.markOwnerHumanControl(owner);
    this.clearSuspendTimer(owner);

    if (this.isActiveOwner(owner)) {
      this.detachAttachedRuntime();
      this.activeOwner = null;
    }
    this.clearActiveBoundsForOwner(owner);
    this.closePopupWindowsForOwner(owner);

    const existingState = this.states.get(browserOwnerWorkspaceKey(owner));
    this.destroyOwnerRuntimes(owner);
    for (const tab of existingState?.tabs ?? []) {
      this.clearOwnerAnnotationProjection(owner, tab.id);
      this.rendererOnlyRuntimeKeys.delete(browserOwnerRuntimeKey(owner, tab.id));
      this.automationRuntimeKeys.delete(browserOwnerRuntimeKey(owner, tab.id));
    }

    const state = this.getOrCreateOwnerState(owner);
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
    this.markOwnerStateChanged(owner);
    this.lastEmittedVersionByOwnerKey.delete(browserOwnerWorkspaceKey(owner));
    this.emitOwnerState(owner);
    return state;
  }

  hide(input: BrowserThreadInput): void {
    this.hideOwner(threadOwner(input.threadId));
  }

  // ── Project-owned browser workspace API (Decision 0002, WP7) ────────
  //
  // Mirrors BrowserProjectControlMethods from @synara/contracts. Every method
  // keys the workspace by the real ProjectId; the same Project reached from
  // different Main conversations (provenance) resolves one workspace.

  openProject(input: BrowserProjectOpenInput): ProjectBrowserState {
    const owner = projectOwner(input.projectId);
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.openOwner(owner, input.initialUrl === undefined ? undefined : input.initialUrl),
    );
  }

  closeProject(input: BrowserProjectInput): ProjectBrowserState {
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.closeOwner(projectOwner(input.projectId)),
    );
  }

  hideProject(input: BrowserProjectInput): void {
    this.hideOwner(projectOwner(input.projectId));
  }

  getProjectState(input: BrowserProjectInput): ProjectBrowserState {
    return this.projectStateProjection(projectOwner(input.projectId));
  }

  setProjectPanelBounds(input: BrowserProjectSetPanelBoundsInput): void {
    this.setOwnerPanelBounds(projectOwner(input.projectId), input.bounds, input.surface);
  }

  navigateProject(input: BrowserProjectNavigateInput): ProjectBrowserState {
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.navigateOwner(projectOwner(input.projectId), input.tabId, input.url),
    );
  }

  reloadProject(input: BrowserProjectTabInput): ProjectBrowserState {
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.reloadOwnerTab({ owner: projectOwner(input.projectId), tabId: input.tabId }),
    );
  }

  goBackProject(input: BrowserProjectTabInput): ProjectBrowserState {
    const owner = projectOwner(input.projectId);
    this.markOwnerHumanControl(owner);
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, input.tabId));
    if (runtime && canWebContentsGoBack(runtime.webContents)) {
      runtime.webContents.goBack();
    }
    return this.getProjectState({ projectId: input.projectId });
  }

  goForwardProject(input: BrowserProjectTabInput): ProjectBrowserState {
    const owner = projectOwner(input.projectId);
    this.markOwnerHumanControl(owner);
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, input.tabId));
    if (runtime && canWebContentsGoForward(runtime.webContents)) {
      runtime.webContents.goForward();
    }
    return this.getProjectState({ projectId: input.projectId });
  }

  newProjectTab(input: BrowserProjectNewTabInput): ProjectBrowserState {
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.newOwnerTab(projectOwner(input.projectId), {
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.activate === undefined ? {} : { activate: input.activate }),
      }),
    );
  }

  closeProjectTab(input: BrowserProjectTabInput): ProjectBrowserState {
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.closeOwnerTab({ owner: projectOwner(input.projectId), tabId: input.tabId }),
    );
  }

  selectProjectTab(input: BrowserProjectTabInput): ProjectBrowserState {
    return toProjectBrowserState(
      { kind: "project", projectId: input.projectId },
      this.selectOwnerTab({ owner: projectOwner(input.projectId), tabId: input.tabId }),
    );
  }

  openProjectDevTools(input: BrowserProjectTabInput): void {
    this.openOwnerDevTools({ owner: projectOwner(input.projectId), tabId: input.tabId });
  }

  captureProjectScreenshot(input: BrowserProjectTabInput): Promise<BrowserCaptureScreenshotResult> {
    return this.captureOwnerScreenshot({
      owner: projectOwner(input.projectId),
      tabId: input.tabId,
    });
  }

  copyProjectScreenshotToClipboard(input: BrowserProjectTabInput): Promise<void> {
    return this.copyOwnerScreenshotToClipboard({
      owner: projectOwner(input.projectId),
      tabId: input.tabId,
    });
  }

  copyProjectLink(input: BrowserProjectTabInput): void {
    this.copyOwnerLink({ owner: projectOwner(input.projectId), tabId: input.tabId });
  }

  // ── Project workspace activation application (Decision 0004) ────────
  //
  // Applies the Desktop-owned slices of one freshly read, freshly validated
  // publication: browser tabs/active tab/open state plus the durable
  // annotation marker projection. The ENTIRE bundle is validated before any
  // mutation, so a rejected bundle leaves zero observable manager state, and
  // success is remembered per manager lifetime — a later activation request
  // for the same Project never reapplies over newer live mutations.

  /** Has this Project's workspace been hydrated already in this lifetime? */
  isProjectWorkspaceActivated(projectId: ProjectId): boolean {
    return this.activatedProjectWorkspaceKeys.has(
      browserOwnerWorkspaceKey(projectOwner(projectId)),
    );
  }

  applyProjectWorkspaceActivation(input: {
    readonly projectId: ProjectId;
    readonly browser: {
      readonly open: boolean;
      readonly activeTabId: string | null;
      readonly tabs: ReadonlyArray<{
        readonly id: string;
        readonly url: string;
        readonly title: string;
      }>;
    };
    readonly annotations: ReadonlyArray<{
      readonly id: string;
      readonly tabId: string;
      readonly ordinal: number;
      readonly documentKey: string;
    }>;
  }): void {
    const owner = projectOwner(input.projectId);
    const key = browserOwnerWorkspaceKey(owner);
    if (this.activatedProjectWorkspaceKeys.has(key)) {
      // Already applied in this manager lifetime: never reapplied over newer
      // live mutations (Decision 0004 item 4).
      return;
    }

    // ── Validate the entire bundle before any mutation. ──
    const tabIds = new Set<string>();
    for (const tab of input.browser.tabs) {
      if (
        typeof tab.id !== "string" ||
        tab.id.length === 0 ||
        typeof tab.url !== "string" ||
        typeof tab.title !== "string"
      ) {
        throw new Error("Project workspace browser publication has a malformed tab.");
      }
      if (tabIds.has(tab.id)) {
        throw new Error("Project workspace browser publication has duplicate tab ids.");
      }
      tabIds.add(tab.id);
    }
    if (input.browser.activeTabId !== null && !tabIds.has(input.browser.activeTabId)) {
      throw new Error(
        "Project workspace browser publication names an active tab that does not exist.",
      );
    }
    const annotationIds = new Set<string>();
    for (const marker of input.annotations) {
      if (
        typeof marker.id !== "string" ||
        marker.id.length === 0 ||
        !Number.isSafeInteger(marker.ordinal) ||
        marker.ordinal <= 0 ||
        typeof marker.documentKey !== "string" ||
        marker.documentKey.length === 0
      ) {
        throw new Error("Project workspace annotation publication has a malformed marker.");
      }
      // The annotation projection may reference only valid tabs.
      if (!tabIds.has(marker.tabId)) {
        throw new Error(
          "Project workspace annotation publication references a tab the browser slice does not restore.",
        );
      }
      if (annotationIds.has(marker.id)) {
        throw new Error("Project workspace annotation publication has duplicate marker ids.");
      }
      annotationIds.add(marker.id);
    }

    // ── Apply atomically: metadata only, no fabricated native runtime. ──
    // Restored tabs are suspended renderer-surface metadata; normal runtime
    // restoration owns the transition to a live native surface.
    const state: OwnerWorkspaceState = {
      version: (this.ownerVersionByKey.get(key) ?? 0) + 1,
      open: input.browser.open,
      activeTabId: input.browser.activeTabId,
      tabs: input.browser.tabs.map((tab) => ({
        ...createBrowserTab(tab.url),
        id: tab.id,
        title: tab.title,
      })),
      lastError: null,
    };
    this.states.set(key, state);
    this.ownerVersionByKey.set(key, state.version);
    this.snapshotCacheByOwnerKey.delete(key);
    this.threadProjectionCacheByKey.delete(key);
    this.projectProjectionCacheByKey.delete(key);
    this.lastEmittedVersionByOwnerKey.delete(key);
    this.annotations.seedProjectWorkspaceMarkers({
      projectId: input.projectId,
      markers: [...input.annotations],
    });
    // The hydrated workspace counts as activated only once everything —
    // including the annotation seed — has been applied.
    this.activatedProjectWorkspaceKeys.add(key);
    this.emitOwnerState(owner);
  }

  subscribeProjectState(listener: BrowserProjectStateListener): () => void {
    this.projectListeners.add(listener);
    return () => {
      this.projectListeners.delete(listener);
    };
  }
  subscribeProjectCopyLink(listener: (event: ProjectBrowserCopyLinkEvent) => void): () => void {
    this.projectCopyLinkListeners.add(listener);
    return () => {
      this.projectCopyLinkListeners.delete(listener);
    };
  }

  /**
   * A committed `project.deleted` is terminal for that Project's browser
   * workspace (WP7 deletion settlement). Tears down the Project's runtimes and
   * state; every OTHER Project's and Thread's workspace is untouched. An
   * unknown Project is a no-op. Navigation and visibility changes never reach
   * this path.
   */
  handleProjectRemoved(projectId: ProjectId): void {
    const owner = projectOwner(projectId);
    const key = browserOwnerWorkspaceKey(owner);
    if (!this.states.has(key)) {
      return;
    }
    if (this.isActiveOwner(owner)) {
      this.detachAttachedRuntime();
      this.activeOwner = null;
    }
    this.clearActiveBoundsForOwner(owner);
    this.clearSuspendTimer(owner);
    this.closePopupWindowsForOwner(owner);
    this.destroyOwnerRuntimes(owner);
    const existingState = this.states.get(key);
    for (const tab of existingState?.tabs ?? []) {
      this.clearOwnerAnnotationProjection(owner, tab.id);
    }
    this.states.delete(key);
    this.ownerVersionByKey.delete(key);
    this.snapshotCacheByOwnerKey.delete(key);
    this.threadProjectionCacheByKey.delete(key);
    this.projectProjectionCacheByKey.delete(key);
    this.lastEmittedVersionByOwnerKey.delete(key);
    this.humanControlEpochByOwnerKey.delete(key);
    this.humanControlListenersByOwnerKey.delete(key);
    // Deletion clears ONLY this Project's manager state and activation
    // bookkeeping (Decision 0004 item 8): the hydrated-workspace memory and
    // the seeded durable annotation markers go with it; every other Project —
    // and the activation boundary itself — is notified, not torn down.
    this.activatedProjectWorkspaceKeys.delete(key);
    this.annotations.clearProjectWorkspaceSeededMarkers(projectId);
    this.options.onProjectWorkspaceDeactivated?.(projectId);
  }

  /** Owner-generic hide core. Visibility change is never ownership termination. */
  private hideOwner(owner: BrowserWorkspaceOwner): void {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    const activeTab = state ? this.getActiveTab(state) : null;
    const keepsAgentRuntimeAlive = Boolean(
      activeTab && this.automationRuntimeKeys.has(browserOwnerRuntimeKey(owner, activeTab.id)),
    );
    if (!keepsAgentRuntimeAlive) {
      this.markOwnerHumanControl(owner);
    }
    if (this.isActiveOwner(owner)) {
      this.detachAttachedRuntime();
      this.activeOwner = null;
    }

    if (!state?.open) {
      return;
    }

    this.scheduleOwnerSuspend(owner);
    this.enforceBackgroundAutomationRuntimeBudget();
  }

  getState(input: BrowserThreadInput): ThreadBrowserState {
    return this.threadStateProjection(threadOwner(input.threadId));
  }

  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    this.setOwnerPanelBounds(threadOwner(input.threadId), input.bounds, input.surface);
  }

  /** Owner-generic bounds core. Navigation/visibility never terminates a workspace. */
  private setOwnerPanelBounds(
    owner: BrowserWorkspaceOwner,
    bounds: BrowserPanelBounds | null,
    surface?: "native" | "renderer",
  ): void {
    this.perfCounters.setPanelBoundsCalls += 1;
    const state = this.getOrCreateOwnerState(owner);
    const nextBounds = normalizeBounds(bounds);
    const nextBoundsSignature = browserBoundsSignature(nextBounds);
    const activeTabId = this.getActiveTab(state)?.id ?? null;
    const activeRuntimeKey = activeTabId ? browserOwnerRuntimeKey(owner, activeTabId) : null;
    const activeRuntime = activeRuntimeKey ? this.runtimes.get(activeRuntimeKey) : null;
    const requiresRenderer = activeRuntimeKey
      ? this.rendererOnlyRuntimeKeys.has(activeRuntimeKey)
      : false;
    this.setActiveBounds(owner, nextBounds);

    if (!state.open || nextBounds === null) {
      if (this.isActiveOwner(owner)) {
        this.detachAttachedRuntime();
        this.activeOwner = null;
        this.scheduleOwnerSuspend(owner);
      }
      return;
    }

    if (
      surface === "native" &&
      !requiresRenderer &&
      activeTabId &&
      activeRuntime &&
      !activeRuntime.ownsWebContents
    ) {
      // Sheet mode renders more reliably with the native WebContentsView than a translated <webview>.
      this.destroyOwnerRuntime(owner, activeTabId);
      const activeTab = this.getTab(state, activeTabId);
      if (activeTab) {
        suspendTabState(activeTab);
        this.markOwnerStateChanged(owner);
      }
      this.attachedRuntimeKey = null;
      this.attachedBoundsSignature = null;
    }

    if ((surface === "renderer" || requiresRenderer) && activeTabId && !activeRuntime) {
      this.activateOwnerForPendingRenderer(owner, nextBounds);
      return;
    }

    // Bounds sync fires often during panel motion. If the visible runtime and
    // applied viewport are already current, avoid waking the browser stack again.
    if (
      this.isActiveOwner(owner) &&
      this.attachedRuntimeKey === activeRuntimeKey &&
      this.attachedBoundsSignature === nextBoundsSignature
    ) {
      this.perfCounters.setPanelBoundsNoopSkips += 1;
      return;
    }

    this.updatePopupWindowsForOwner(owner);

    if (this.isActiveOwner(owner)) {
      if (activeRuntimeKey && this.attachedRuntimeKey === activeRuntimeKey) {
        const runtime = this.runtimes.get(activeRuntimeKey);
        if (runtime) {
          this.perfCounters.setPanelBoundsViewportUpdates += 1;
          this.attachRuntime(runtime, nextBounds);
          return;
        }
      }
      this.attachActiveTab(owner, nextBounds);
      return;
    }

    this.activateOwner(owner, nextBounds);
  }

  // Adopts the renderer-owned <webview> so the visible page and browser host tools
  // share one WebContents instead of racing a hidden native WebContentsView.
  attachWebview(input: BrowserAttachWebviewInput, hostWebContentsId: number): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.attachOwnerWebview(owner, input.tabId, input.webContentsId, hostWebContentsId),
    );
  }

  /** Owner-generic renderer-guest adoption core. */
  private attachOwnerWebview(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContentsId: number,
    hostWebContentsId: number,
  ): OwnerWorkspaceState {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    const tab = state ? this.getTab(state, tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this workspace.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("A visible browser webview can only attach to the active tab.");
    }
    if (tab.runtimeSurface === "native") {
      // A late renderer attach can race the state update that promotes a tab to
      // background automation. Keep the native runtime canonical; the panel
      // will remove this unused guest when it observes the new surface.
      return state;
    }
    const webContents = electronWebContents.fromId(webContentsId);
    if (!webContents || webContents.isDestroyed()) {
      throw new Error("The visible browser webview is not available.");
    }
    if (
      webContents.getType() !== "webview" ||
      webContents.hostWebContents?.id !== hostWebContentsId ||
      (this.window !== null && hostWebContentsId !== this.window.webContents.id) ||
      webContents.session !== electronSession.fromPartition(BROWSER_SESSION_PARTITION)
    ) {
      throw new Error("The browser webview does not belong to this Synara window and partition.");
    }

    const key = browserOwnerRuntimeKey(owner, tab.id);
    const existingRendererRuntime = this.findRendererRuntimeByWebContentsId(webContents.id);
    if (existingRendererRuntime && existingRendererRuntime.key !== key) {
      this.destroyOwnerRuntime(existingRendererRuntime.owner, existingRendererRuntime.tabId, {
        preserveRendererDebugger: true,
        annotationReason: "replaced",
      });
    }

    const existing = this.runtimes.get(key);
    if (existing?.webContents.id !== webContents.id) {
      if (existing) {
        if (!existing.ownsWebContents && !existing.webContents.isDestroyed()) {
          // Never let a late dom-ready/invoke from a duplicate hidden WebView
          // steal a live logical tab from the guest already bound to it. A real
          // renderer replacement first detaches the old guest (or Electron has
          // destroyed it during a shell reload), after which retries may bind.
          throw new Error("This browser tab is already attached to another visible webview.");
        }
        this.destroyOwnerRuntime(owner, tab.id, {
          preserveAutomationDownloadTracking: true,
          annotationReason: "replaced",
        });
      }
      const runtime: LiveTabRuntime = {
        key,
        owner,
        tabId: tab.id,
        webContents,
        view: null,
        ownsWebContents: false,
        listenerDisposers: [],
      };
      this.configureRuntimeWebContents(runtime);
      this.runtimes.set(key, runtime);
    }
    this.rendererOnlyRuntimeKeys.add(key);

    const bounds = this.getVisibleBoundsForOwner(owner);
    const runtime = this.runtimes.get(key);
    if (runtime && bounds) {
      this.attachRuntime(runtime, bounds);
    }

    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const requiresLocalPreviewBootstrap =
      isLocalFileUrl(expectedUrl) &&
      this.sessionPolicy.resolveDisplayUrl(webContents.getURL()) !== expectedUrl;
    if (requiresLocalPreviewBootstrap) {
      void this.loadOwnerTab(owner, tab.id, {
        force: true,
        ...(runtime ? { runtime } : {}),
      });
      return state;
    }

    const didChange = tab.status !== LIVE_TAB_STATUS || tab.lastError !== null;
    tab.status = LIVE_TAB_STATUS;
    tab.lastError = null;
    const nextDidChange = syncThreadLastError(state) || didChange;
    if (nextDidChange) {
      this.markOwnerStateChanged(owner);
    }
    this.queueOwnerRuntimeStateSync(owner, tab.id);
    if (nextDidChange) {
      this.emitOwnerState(owner);
    }
    return state;
  }

  // Drops main-process ownership of a renderer-owned <webview> that React removed.
  // The webContents id guard keeps stale cleanup calls from tearing down a newly attached view.
  detachWebview(input: BrowserDetachWebviewInput): void {
    this.detachOwnerWebview(threadOwner(input.threadId), input.tabId, input.webContentsId);
  }

  private detachOwnerWebview(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    const tab = state ? this.getTab(state, tabId) : null;
    if (!state || !tab) {
      return;
    }

    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, tabId));
    if (!runtime || runtime.ownsWebContents || runtime.webContents.id !== webContentsId) {
      return;
    }

    this.destroyOwnerRuntime(owner, tabId);
    const didChange = suspendTabState(tab) || syncThreadLastError(state);
    if (didChange) {
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    }
  }

  navigate(input: BrowserNavigateInput): ThreadBrowserState {
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.navigateOwner(threadOwner(input.threadId), input.tabId, input.url),
    );
  }

  /** Owner-generic navigate core. */
  private navigateOwner(
    owner: BrowserWorkspaceOwner,
    tabId: string | undefined,
    url: string,
  ): OwnerWorkspaceState {
    this.markOwnerHumanControl(owner);
    const state = this.ensureOwnerWorkspace(owner);
    const tab = this.resolveTab(state, tabId);
    const nextUrl = normalizeUrlInput(url);
    tab.url = nextUrl;
    tab.title = defaultTitleForUrl(nextUrl);
    tab.lastCommittedUrl = null;
    tab.lastError = null;
    syncThreadLastError(state);
    this.markOwnerStateChanged(owner);

    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, tab.id));
    if (runtime) {
      const bounds = this.getVisibleBoundsForOwner(owner);
      if (state.activeTabId === tab.id && bounds) {
        this.attachRuntime(runtime, bounds);
      }
      void this.loadOwnerTab(owner, tab.id, { force: true, runtime });
    } else if (
      this.isActiveOwner(owner) &&
      !this.rendererOnlyRuntimeKeys.has(browserOwnerRuntimeKey(owner, tab.id))
    ) {
      // Load the target tab directly so we don't clobber its pending URL with a
      // workspace-wide runtime sync from the old live page state.
      const nextRuntime = this.ensureOwnerLiveRuntime(owner, tab.id);
      this.clearSuspendTimer(owner);
      const bounds = this.getVisibleBoundsForOwner(owner);
      if (state.activeTabId === tab.id && bounds) {
        this.attachRuntime(nextRuntime, bounds);
      }
      void this.loadOwnerTab(owner, tab.id, { force: true, runtime: nextRuntime });
    }

    this.emitOwnerState(owner);
    return state;
  }

  reload(input: BrowserTabInput): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.reloadOwnerTab({ owner, tabId: input.tabId }),
    );
  }

  private reloadOwnerTab(input: BrowserOwnerTabInput): OwnerWorkspaceState {
    this.markOwnerHumanControl(input.owner);
    const state = this.ensureOwnerWorkspace(input.owner);
    const tab = this.resolveTab(state, input.tabId);
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(input.owner, tab.id));
    if (runtime) {
      runtime.webContents.reload();
    } else if (this.isActiveOwner(input.owner)) {
      this.resumeOwner(input.owner);
      void this.loadOwnerTab(input.owner, tab.id, { force: true });
    }
    return state;
  }

  goBack(input: BrowserTabInput): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    this.markOwnerHumanControl(owner);
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, input.tabId));
    if (runtime && canWebContentsGoBack(runtime.webContents)) {
      runtime.webContents.goBack();
    }
    return this.getState({ threadId: input.threadId });
  }

  goForward(input: BrowserTabInput): ThreadBrowserState {
    const owner = threadOwner(input.threadId);
    this.markOwnerHumanControl(owner);
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, input.tabId));
    if (runtime && canWebContentsGoForward(runtime.webContents)) {
      runtime.webContents.goForward();
    }
    return this.getState({ threadId: input.threadId });
  }

  newTab(input: BrowserNewTabInput): ThreadBrowserState {
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.newOwnerTab(threadOwner(input.threadId), {
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.activate === undefined ? {} : { activate: input.activate }),
      }),
    );
  }

  /** Owner-generic new-tab core. */
  private newOwnerTab(
    owner: BrowserWorkspaceOwner,
    input: {
      readonly url?: string | undefined;
      readonly activate?: boolean | undefined;
    },
  ): OwnerWorkspaceState {
    this.markOwnerHumanControl(owner);
    const state = this.ensureOwnerWorkspace(owner);
    const tab = createBrowserTab(normalizeUrlInput(input.url));
    state.tabs = [...state.tabs, tab];
    if (input.activate !== false || !state.activeTabId) {
      state.activeTabId = tab.id;
    }

    if (this.isActiveOwner(owner)) {
      this.resumeOwner(owner);
      const bounds = this.getVisibleBoundsForOwner(owner);
      if (state.activeTabId === tab.id && bounds) {
        this.attachActiveTab(owner, bounds, { forceLoad: true });
      }
    } else {
      tab.status = "suspended";
    }

    syncThreadLastError(state);
    this.markOwnerStateChanged(owner);
    this.emitOwnerState(owner);
    return state;
  }

  closeTab(input: BrowserTabInput): ThreadBrowserState {
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.closeOwnerTab({ owner: threadOwner(input.threadId), tabId: input.tabId }),
    );
  }

  /** Owner-generic close-tab core. */
  private closeOwnerTab(input: BrowserOwnerTabInput): OwnerWorkspaceState {
    this.markOwnerHumanControl(input.owner);
    const state = this.ensureOwnerWorkspace(input.owner);
    const nextTabs = state.tabs.filter((tab) => tab.id !== input.tabId);
    if (nextTabs.length === state.tabs.length) {
      return state;
    }

    this.closePopupWindowsForTab(input.owner, input.tabId);
    this.destroyOwnerRuntime(input.owner, input.tabId);
    this.clearOwnerAnnotationProjection(input.owner, input.tabId);
    this.rendererOnlyRuntimeKeys.delete(browserOwnerRuntimeKey(input.owner, input.tabId));
    this.automationRuntimeKeys.delete(browserOwnerRuntimeKey(input.owner, input.tabId));
    state.tabs = nextTabs;

    if (nextTabs.length === 0) {
      // Closing the last tab keeps the browser open on a fresh blank tab (the same state
      // as a brand-new browser session) so the user can type a new URL in the search box,
      // instead of tearing the whole panel down.
      const replacementTab = createBrowserTab();
      state.tabs = [replacementTab];
      state.activeTabId = replacementTab.id;
      state.lastError = null;

      this.markOwnerStateChanged(input.owner);
      this.emitOwnerState(input.owner);
      return state;
    }

    if (!state.activeTabId || state.activeTabId === input.tabId) {
      state.activeTabId = nextTabs[Math.max(0, nextTabs.length - 1)]?.id ?? null;
    }

    const bounds = this.getVisibleBoundsForOwner(input.owner);
    if (this.isActiveOwner(input.owner) && bounds) {
      this.attachActiveTab(input.owner, bounds);
    }

    syncThreadLastError(state);
    this.markOwnerStateChanged(input.owner);
    this.emitOwnerState(input.owner);
    return state;
  }

  selectTab(input: BrowserTabInput): ThreadBrowserState {
    return toThreadBrowserState(
      { kind: "thread", threadId: input.threadId },
      this.selectOwnerTab({ owner: threadOwner(input.threadId), tabId: input.tabId }),
    );
  }

  private selectOwnerTab(input: BrowserOwnerTabInput): OwnerWorkspaceState {
    this.markOwnerHumanControl(input.owner);
    const state = this.ensureOwnerWorkspace(input.owner);
    const tab = this.resolveTab(state, input.tabId);
    this.activateOwnerTab(input.owner, state, tab);

    if (this.isActiveOwner(input.owner)) {
      this.resumeOwner(input.owner);
      const bounds = this.getVisibleBoundsForOwner(input.owner);
      if (bounds) {
        this.attachActiveTab(input.owner, bounds);
      }
    }

    return state;
  }

  openDevTools(input: BrowserTabInput): void {
    this.openOwnerDevTools({ owner: threadOwner(input.threadId), tabId: input.tabId });
  }

  private openOwnerDevTools(input: BrowserOwnerTabInput): void {
    this.markOwnerHumanControl(input.owner);
    const state = this.ensureOwnerWorkspace(input.owner);
    const tab = this.resolveTab(state, input.tabId);
    this.activateOwnerTab(input.owner, state, tab);

    this.resumeOwner(input.owner);
    const runtime = this.ensureOwnerLiveRuntime(input.owner, tab.id);
    const bounds = this.getVisibleBoundsForOwner(input.owner);
    if (bounds) {
      this.attachActiveTab(input.owner, bounds);
    }
    runtime.webContents.openDevTools({ mode: "detach" });
  }

  // Ensures the requested tab is active/live, then returns a fresh PNG capture
  // from the native browser surface for whichever destination needs it next.
  private async captureOwnerScreenshotPng(input: BrowserOwnerTabInput): Promise<{
    name: string;
    pngBytes: Buffer;
  }> {
    const state = this.ensureOwnerWorkspace(input.owner);
    const tab = this.resolveTab(state, input.tabId);
    this.activateOwnerTab(input.owner, state, tab);

    this.resumeOwner(input.owner);
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
    const runtime = this.ensureOwnerLiveRuntime(input.owner, tab.id);
    const webContents = runtime.webContents;
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const currentUrl = this.sessionPolicy.resolveDisplayUrl(webContents.getURL());
    const bounds = this.getVisibleBoundsForOwner(input.owner);
    if (bounds) {
      this.attachActiveTab(input.owner, bounds);
    }

    if (wasSuspended || currentUrl.length === 0 || currentUrl !== expectedUrl) {
      await this.loadOwnerTab(input.owner, tab.id, { runtime });
    } else {
      this.queueOwnerRuntimeStateSync(input.owner, tab.id);
    }

    const pngBytes = (await webContents.capturePage()).toPNG();
    if (pngBytes.byteLength === 0) {
      throw new Error("Couldn't capture a browser screenshot.");
    }

    return {
      name: screenshotFileNameForUrl(tab.lastCommittedUrl ?? tab.url),
      pngBytes,
    };
  }

  // Captures the current browser viewport as a PNG so the renderer can attach
  // it directly to the composer without introducing temp-file disk churn.
  async captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    return this.captureOwnerScreenshot({ owner: threadOwner(input.threadId), tabId: input.tabId });
  }

  /** Owner-generic screenshot capture (Decision 0002). */
  async captureOwnerScreenshot(
    input: BrowserOwnerTabInput,
  ): Promise<BrowserCaptureScreenshotResult> {
    const { name, pngBytes } = await this.captureOwnerScreenshotPng(input);

    return {
      name,
      mimeType: "image/png",
      sizeBytes: pngBytes.byteLength,
      bytes: Uint8Array.from(pngBytes),
    };
  }

  // Copies the active tab's URL via the native clipboard and emits the copy-link
  // event, mirroring the keyboard-chord path. The renderer's navigator.clipboard
  // can reject with "Document is not focused" while the native page view holds
  // focus, so the React toolbar button routes through here for reliability.
  copyLink(input: BrowserTabInput): void {
    this.copyOwnerTabLink({ owner: threadOwner(input.threadId), tabId: input.tabId });
  }

  /** Owner-generic native copy-link chord (Decision 0002). */
  copyOwnerLink(input: BrowserOwnerTabInput): void {
    this.copyOwnerTabLink(input);
  }

  // Writes the current browser viewport screenshot straight to the native
  // clipboard so the renderer does not have to ferry image payloads over IPC.
  async copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    await this.copyOwnerScreenshotToClipboard({
      owner: threadOwner(input.threadId),
      tabId: input.tabId,
    });
  }

  /** Owner-generic screenshot-to-clipboard core (Decision 0002). */
  async copyOwnerScreenshotToClipboard(input: BrowserOwnerTabInput): Promise<void> {
    const { pngBytes } = await this.captureOwnerScreenshotPng(input);
    const image = nativeImage.createFromBuffer(pngBytes);
    if (image.isEmpty()) {
      throw new Error("Couldn't copy a browser screenshot to the clipboard.");
    }
    clipboard.writeImage(image);
  }

  private activateOwner(owner: BrowserWorkspaceOwner, bounds: BrowserPanelBounds): void {
    const previousOwner = this.activeOwner;
    if (previousOwner && !browserOwnersEqual(previousOwner, owner)) {
      this.scheduleOwnerSuspend(previousOwner);
    }

    this.activeOwner = owner;
    this.activeBounds = bounds;
    this.activeBoundsOwner = owner;
    if (previousOwner && !browserOwnersEqual(previousOwner, owner)) {
      this.updatePopupWindowsForOwner(previousOwner);
    }
    this.resumeOwner(owner);
    this.attachActiveTab(owner, bounds);
    this.updatePopupWindowsForOwner(owner);
  }

  // Renderer panels create their own <webview>; keep active-thread bookkeeping current while
  // waiting for attachWebview so startup does not create a duplicate native WebContentsView.
  private activateOwnerForPendingRenderer(
    owner: BrowserWorkspaceOwner,
    bounds: BrowserPanelBounds,
  ): void {
    const previousOwner = this.activeOwner;
    if (previousOwner && !browserOwnersEqual(previousOwner, owner)) {
      this.scheduleOwnerSuspend(previousOwner);
      this.updatePopupWindowsForOwner(previousOwner);
    }
    this.activeOwner = owner;
    this.activeBounds = bounds;
    this.activeBoundsOwner = owner;
    this.clearSuspendTimer(owner);
    this.updatePopupWindowsForOwner(owner);
  }

  private setActiveBounds(owner: BrowserWorkspaceOwner, bounds: BrowserPanelBounds | null): void {
    if (!bounds) {
      this.clearActiveBoundsForOwner(owner);
      return;
    }
    this.activeBounds = bounds;
    this.activeBoundsOwner = owner;
  }

  private clearActiveBoundsForOwner(owner: BrowserWorkspaceOwner): void {
    if (this.activeBoundsOwner === null || !browserOwnersEqual(this.activeBoundsOwner, owner)) {
      return;
    }
    this.activeBounds = null;
    this.activeBoundsOwner = null;
  }

  private getVisibleBoundsForOwner(owner: BrowserWorkspaceOwner): BrowserPanelBounds | null {
    return this.activeBoundsOwner !== null && browserOwnersEqual(this.activeBoundsOwner, owner)
      ? this.activeBounds
      : null;
  }

  private isActiveOwner(owner: BrowserWorkspaceOwner): boolean {
    return this.activeOwner !== null && browserOwnersEqual(this.activeOwner, owner);
  }

  private resumeOwner(owner: BrowserWorkspaceOwner): void {
    const state = this.ensureOwnerWorkspace(owner);
    if (!state.open) {
      return;
    }

    this.clearSuspendTimer(owner);
    const activeTab = this.getActiveTab(state);
    let didChange = this.suspendInactiveTabs(owner, activeTab?.id ?? null);

    // Only resume the visible tab. Waking every tab can fan out into several
    // Chromium renderer processes and background page activity at once.
    for (const tab of state.tabs) {
      if (tab.id !== activeTab?.id) {
        continue;
      }
      const runtimeKey = browserOwnerRuntimeKey(owner, tab.id);
      if (this.rendererOnlyRuntimeKeys.has(runtimeKey)) {
        const rendererRuntime = this.runtimes.get(runtimeKey);
        if (!rendererRuntime || rendererRuntime.ownsWebContents) {
          if (rendererRuntime?.ownsWebContents) this.destroyOwnerRuntime(owner, tab.id);
          continue;
        }
      }
      const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
      const runtime = this.ensureOwnerLiveRuntime(owner, tab.id);
      if (wasSuspended && !this.automationRuntimeKeys.has(runtimeKey)) {
        void this.loadOwnerTab(owner, tab.id, { force: true, runtime });
      } else {
        didChange =
          syncTabStateFromRuntime(state, tab, runtime.webContents, (url) =>
            this.sessionPolicy.resolveDisplayUrl(url),
          ) || didChange;
      }
    }

    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    }
    this.enforceBackgroundAutomationRuntimeBudget();
  }

  private noteAutomationRuntimeUse(key: string): void {
    const now = Date.now();
    this.runtimeLastActiveAtByKey.set(key, now);
    this.automationRuntimeProtectedUntilByKey.set(
      key,
      now + BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS,
    );
    this.enforceBackgroundAutomationRuntimeBudget();
  }

  /**
   * Keeps background agent pages useful without allowing one Chromium runtime
   * per historical thread to accumulate for the lifetime of the app. A page
   * currently displayed by the shell never counts against the background cap;
   * expired hidden pages are evicted least-recently-used and restored from their
   * canonical tab URL on the next browser tool call.
   */
  private enforceBackgroundAutomationRuntimeBudget(): void {
    if (this.disposed) return;
    if (this.backgroundAutomationEvictionTimer !== null) {
      clearTimeout(this.backgroundAutomationEvictionTimer);
      this.backgroundAutomationEvictionTimer = null;
    }

    // An OAuth popup is a live user interaction even when its opener's panel is
    // hidden. Evicting that opener would sever window.opener and break sign-in.
    const popupOwnerRuntimeKeys = new Set(
      [...this.popupRuntimes.values()].map((popup) =>
        browserOwnerRuntimeKey(popup.owner, popup.tabId),
      ),
    );
    const backgroundRuntimes = [...this.runtimes.values()].filter(
      (runtime) =>
        runtime.ownsWebContents &&
        runtime.key !== this.attachedRuntimeKey &&
        !popupOwnerRuntimeKeys.has(runtime.key) &&
        this.automationRuntimeKeys.has(runtime.key),
    );
    let excess = backgroundRuntimes.length - BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES;
    if (excess <= 0) return;

    const now = Date.now();
    const evictionCandidates = backgroundRuntimes
      .filter((runtime) => (this.automationRuntimeProtectedUntilByKey.get(runtime.key) ?? 0) <= now)
      .toSorted(
        (left, right) =>
          (this.runtimeLastActiveAtByKey.get(left.key) ?? 0) -
          (this.runtimeLastActiveAtByKey.get(right.key) ?? 0),
      );

    const changedOwners: BrowserWorkspaceOwner[] = [];
    for (const runtime of evictionCandidates) {
      if (excess <= 0) break;
      const state = this.states.get(browserOwnerWorkspaceKey(runtime.owner));
      const tab = state ? this.getTab(state, runtime.tabId) : null;
      this.destroyOwnerRuntime(runtime.owner, runtime.tabId);
      if (state && tab) {
        const didChange = suspendTabState(tab);
        if (syncThreadLastError(state) || didChange) {
          changedOwners.push(runtime.owner);
        }
      }
      excess -= 1;
      this.perfCounters.inactiveTabBudgetEvictions += 1;
    }

    for (const owner of changedOwners) {
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    }

    if (excess <= 0) return;
    const nextProtectionExpiry = backgroundRuntimes
      .map((runtime) => this.automationRuntimeProtectedUntilByKey.get(runtime.key) ?? 0)
      .filter((protectedUntil) => protectedUntil > now)
      .toSorted((left, right) => left - right)[0];
    if (nextProtectionExpiry === undefined) return;

    this.backgroundAutomationEvictionTimer = setTimeout(
      () => {
        this.backgroundAutomationEvictionTimer = null;
        this.enforceBackgroundAutomationRuntimeBudget();
      },
      Math.max(1, nextProtectionExpiry - now + 1),
    );
    this.backgroundAutomationEvictionTimer.unref();
  }

  private suspendInactiveTabs(owner: BrowserWorkspaceOwner, activeTabId: string | null): boolean {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    if (!state) {
      return false;
    }

    let didChange = false;
    const inactiveRuntimeTabIds = state.tabs
      .filter((tab) => tab.id !== activeTabId)
      .filter((tab) => this.runtimes.has(browserOwnerRuntimeKey(owner, tab.id)))
      .toSorted((left, right) => {
        const leftKey = browserOwnerRuntimeKey(owner, left.id);
        const rightKey = browserOwnerRuntimeKey(owner, right.id);
        return (
          (this.runtimeLastActiveAtByKey.get(rightKey) ?? 0) -
          (this.runtimeLastActiveAtByKey.get(leftKey) ?? 0)
        );
      });
    const warmRuntimeTabIds = new Set(
      inactiveRuntimeTabIds
        .slice(0, BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD)
        .map((tab) => tab.id),
    );

    for (const tab of state.tabs) {
      if (tab.id === activeTabId) {
        this.clearTabSuspendTimer(owner, tab.id);
        continue;
      }

      const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, tab.id));
      if (runtime) {
        if (warmRuntimeTabIds.has(tab.id)) {
          this.scheduleInactiveTabSuspend(owner, tab.id);
          continue;
        }

        this.perfCounters.inactiveTabBudgetEvictions += 1;
        this.destroyOwnerRuntime(owner, tab.id);
        didChange = suspendTabState(tab) || didChange;
        continue;
      }

      didChange = suspendTabState(tab) || didChange;
    }

    return didChange;
  }

  private scheduleOwnerSuspend(owner: BrowserWorkspaceOwner): void {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    if (!state?.open || this.isActiveOwner(owner)) {
      return;
    }

    this.clearSuspendTimer(owner);
    const timer = setTimeout(() => {
      this.suspendOwner(owner);
      this.suspendTimers.delete(browserOwnerWorkspaceKey(owner));
    }, BROWSER_THREAD_SUSPEND_DELAY_MS);
    timer.unref();
    this.suspendTimers.set(browserOwnerWorkspaceKey(owner), timer);
  }

  private suspendOwner(owner: BrowserWorkspaceOwner): void {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    if (!state || this.isActiveOwner(owner)) {
      return;
    }

    let didChange = false;
    for (const tab of state.tabs) {
      if (
        tab.id === state.activeTabId &&
        this.automationRuntimeKeys.has(browserOwnerRuntimeKey(owner, tab.id))
      ) {
        continue;
      }
      this.destroyOwnerRuntime(owner, tab.id);
      didChange = suspendTabState(tab) || didChange;
    }

    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    }
    this.enforceBackgroundAutomationRuntimeBudget();
  }

  private clearSuspendTimer(owner: BrowserWorkspaceOwner): void {
    const existing = this.suspendTimers.get(browserOwnerWorkspaceKey(owner));
    if (!existing) {
      return;
    }
    clearTimeout(existing);
    this.suspendTimers.delete(browserOwnerWorkspaceKey(owner));
  }

  private scheduleInactiveTabSuspend(owner: BrowserWorkspaceOwner, tabId: string): void {
    const key = browserOwnerRuntimeKey(owner, tabId);
    if (this.tabSuspendTimers.has(key)) {
      return;
    }

    this.perfCounters.inactiveTabSuspendScheduled += 1;
    const delayMs = this.resolveInactiveTabSuspendDelay(owner);
    const timer = setTimeout(() => {
      this.tabSuspendTimers.delete(key);
      const state = this.states.get(browserOwnerWorkspaceKey(owner));
      const tab = state ? this.getTab(state, tabId) : null;
      if (!state || !tab) {
        return;
      }

      this.destroyOwnerRuntime(owner, tabId);
      const didChange = suspendTabState(tab) || syncThreadLastError(state);
      if (didChange) {
        this.markOwnerStateChanged(owner);
        this.emitOwnerState(owner);
      }
    }, delayMs);
    timer.unref();
    this.tabSuspendTimers.set(key, timer);
  }

  private clearTabSuspendTimer(owner: BrowserWorkspaceOwner, tabId: string): void {
    const key = browserOwnerRuntimeKey(owner, tabId);
    const existing = this.tabSuspendTimers.get(key);
    if (!existing) {
      return;
    }

    clearTimeout(existing);
    this.tabSuspendTimers.delete(key);
    this.perfCounters.inactiveTabSuspendCancelled += 1;
  }

  private attachActiveTab(
    owner: BrowserWorkspaceOwner,
    bounds: BrowserPanelBounds,
    options: { forceLoad?: boolean } = {},
  ): void {
    const state = this.ensureOwnerWorkspace(owner);
    const activeTab = this.getActiveTab(state);
    if (!activeTab) {
      return;
    }

    this.suspendInactiveTabs(owner, activeTab.id);
    const runtimeKey = browserOwnerRuntimeKey(owner, activeTab.id);
    if (this.rendererOnlyRuntimeKeys.has(runtimeKey)) {
      const rendererRuntime = this.runtimes.get(runtimeKey);
      if (!rendererRuntime || rendererRuntime.ownsWebContents) {
        if (rendererRuntime?.ownsWebContents) this.destroyOwnerRuntime(owner, activeTab.id);
        this.activateOwnerForPendingRenderer(owner, bounds);
        return;
      }
    }
    const wasSuspended = activeTab.status === SUSPENDED_TAB_STATUS;
    const runtime = this.ensureOwnerLiveRuntime(owner, activeTab.id);
    this.attachRuntime(runtime, bounds);
    const shouldLoadProjectedUrl =
      options.forceLoad || (wasSuspended && !this.automationRuntimeKeys.has(runtimeKey));
    if (shouldLoadProjectedUrl) {
      void this.loadOwnerTab(owner, activeTab.id, {
        force: true,
        runtime,
      });
    } else {
      this.syncOwnerRuntimeState(owner, activeTab.id);
    }
  }

  private attachRuntime(runtime: LiveTabRuntime, bounds: BrowserPanelBounds): void {
    const window = this.window;
    if (!window) {
      return;
    }

    const nextBoundsSignature = browserBoundsSignature(bounds);
    this.runtimeLastActiveAtByKey.set(runtime.key, Date.now());
    // Renderer-owned <webview> runtimes are already visible in React; keep any
    // old native view detached so it cannot cover the real browser surface.
    if (!runtime.ownsWebContents) {
      if (this.attachedRuntimeKey && this.attachedRuntimeKey !== runtime.key) {
        this.detachAttachedRuntime();
      }
      this.attachedRuntimeKey = runtime.key;
      this.attachedBoundsSignature = nextBoundsSignature;
      this.updatePopupWindowsForOwner(runtime.owner);
      this.enforceBackgroundAutomationRuntimeBudget();
      return;
    }
    if (!runtime.view) {
      this.attachedRuntimeKey = runtime.key;
      this.attachedBoundsSignature = nextBoundsSignature;
      this.updatePopupWindowsForOwner(runtime.owner);
      this.enforceBackgroundAutomationRuntimeBudget();
      return;
    }
    if (this.attachedRuntimeKey === runtime.key) {
      this.setRuntimeViewHidden(runtime, false);
      this.bringRuntimeViewToFront(runtime);
      if (this.attachedBoundsSignature === nextBoundsSignature) {
        return;
      }
      runtime.view.setBounds(bounds);
      this.attachedBoundsSignature = nextBoundsSignature;
      this.updatePopupWindowsForOwner(runtime.owner);
      return;
    }

    this.detachAttachedRuntime();
    this.setRuntimeViewHidden(runtime, false);
    this.bringRuntimeViewToFront(runtime);
    runtime.view.setBounds(bounds);
    this.attachedRuntimeKey = runtime.key;
    this.attachedBoundsSignature = nextBoundsSignature;
    this.updatePopupWindowsForOwner(runtime.owner);
    this.enforceBackgroundAutomationRuntimeBudget();
  }

  private bringRuntimeViewToFront(runtime: LiveTabRuntime): void {
    const window = this.window;
    if (!window || !runtime.view) {
      return;
    }

    try {
      window.contentView.removeChildView(runtime.view);
    } catch {
      // Electron throws when the view is not attached yet; adding it below is the desired state.
    }
    window.contentView.addChildView(runtime.view);
  }

  private detachAttachedRuntime(): void {
    if (!this.window || !this.attachedRuntimeKey) {
      this.attachedRuntimeKey = null;
      this.attachedBoundsSignature = null;
      return;
    }

    const runtime = this.runtimes.get(this.attachedRuntimeKey);
    if (runtime?.view) {
      this.setRuntimeViewHidden(runtime, true);
      if (!this.automationRuntimeKeys.has(runtime.key)) {
        this.window.contentView.removeChildView(runtime.view);
      }
    }
    this.attachedRuntimeKey = null;
    this.attachedBoundsSignature = null;
  }

  private setRuntimeViewHidden(runtime: LiveTabRuntime, hidden: boolean): void {
    if (!runtime.view) {
      return;
    }
    const keepRenderingInBackground = hidden && this.automationRuntimeKeys.has(runtime.key);
    const nativeView = runtime.view as typeof runtime.view & NativeBrowserViewVisibility;
    nativeView.setVisible?.(!hidden || keepRenderingInBackground);
    if (hidden) {
      runtime.view.setBounds(
        keepRenderingInBackground
          ? { ...BACKGROUND_AUTOMATION_BOUNDS }
          : { x: 0, y: 0, width: 0, height: 0 },
      );
    }
  }

  private ensureOwnerLiveRuntime(owner: BrowserWorkspaceOwner, tabId: string): LiveTabRuntime {
    const key = browserOwnerRuntimeKey(owner, tabId);
    this.clearTabSuspendTimer(owner, tabId);
    const existing = this.runtimes.get(key);
    if (existing) {
      if (existing.webContents.isDestroyed()) {
        this.destroyOwnerRuntime(owner, tabId);
      } else {
        return existing;
      }
    }

    if (this.rendererOnlyRuntimeKeys.has(key)) {
      throw new Error("This tab requires its renderer-owned browser webview.");
    }

    const runtime = this.createOwnerLiveRuntime(owner, tabId);
    this.runtimes.set(key, runtime);
    const state = this.ensureOwnerWorkspace(owner);
    const tab = this.getTab(state, tabId);
    if (tab) {
      const didChange = tab.status !== "live" || tab.lastError !== null;
      tab.status = "live";
      tab.lastError = null;
      syncThreadLastError(state);
      if (didChange) {
        this.markOwnerStateChanged(owner);
      }
    }
    return runtime;
  }

  private claimOwnerAutomationTab(owner: BrowserWorkspaceOwner, tab: BrowserTabState): boolean {
    const key = browserOwnerRuntimeKey(owner, tab.id);
    this.automationRuntimeKeys.add(key);
    this.rendererOnlyRuntimeKeys.delete(key);
    let didChange = false;
    if (tab.runtimeSurface !== "native") {
      tab.runtimeSurface = "native";
      didChange = true;
    }

    const runtime = this.runtimes.get(key);
    if (runtime && !runtime.ownsWebContents) {
      this.destroyOwnerRuntime(owner, tab.id, {
        preserveAutomationDownloadTracking: true,
        annotationReason: "replaced",
      });
      didChange = suspendTabState(tab) || didChange;
    }
    return didChange;
  }

  private createOwnerLiveRuntime(owner: BrowserWorkspaceOwner, tabId: string): LiveTabRuntime {
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        ...(this.options.annotationPreloadPath
          ? { preload: this.options.annotationPreloadPath }
          : {}),
      },
    });
    const runtime: LiveTabRuntime = {
      key: browserOwnerRuntimeKey(owner, tabId),
      owner,
      tabId,
      webContents: view.webContents,
      view,
      ownsWebContents: true,
      listenerDisposers: [],
    };
    if (this.automationRuntimeKeys.has(runtime.key)) {
      view.setBounds({ ...BACKGROUND_AUTOMATION_BOUNDS });
      const nativeView = view as typeof view & NativeBrowserViewVisibility;
      nativeView.setVisible?.(true);
      this.window?.contentView.addChildView(view);
    }
    this.configureRuntimeWebContents(runtime);
    return runtime;
  }

  private configureRuntimeWebContents(runtime: LiveTabRuntime): void {
    const { owner, tabId, webContents } = runtime;

    // Belt-and-suspenders alongside the session-level UA: also covers an adopted renderer
    // <webview> for any navigation after it attaches.
    this.sessionPolicy.applyUserAgent(webContents);

    this.configureWindowOpenHandling(webContents, runtime, runtime.listenerDisposers);

    // The native page owns keyboard focus while browsing, so the renderer never sees the
    // shell's physical zoom fallback or copy-link chord. Give the shell first refusal,
    // then handle browser-local chords here.
    const beforeInputEvent = (event: Electron.Event, input: Electron.Input) => {
      if (this.options.beforeInputEvent?.(event, input)) {
        return;
      }
      if (input.type !== "keyDown") {
        return;
      }
      if (
        this.consumeOwnerExpectedAutomationInput(owner, tabId, {
          kind: "key",
          key: input.key,
          alt: input.alt === true,
          control: input.control === true,
          meta: input.meta === true,
          shift: input.shift === true,
        })
      ) {
        return;
      }
      this.markOwnerHumanControl(owner);
      const matches = isBrowserCopyLinkChord(
        {
          meta: input.meta,
          ctrl: input.control,
          shift: input.shift,
          alt: input.alt,
          key: input.key,
        },
        process.platform === "darwin",
      );
      if (!matches) {
        return;
      }
      event.preventDefault();
      this.copyOwnerTabLink({ owner, tabId });
    };
    webContents.on("before-input-event", beforeInputEvent);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-input-event", beforeInputEvent);
    });

    const beforeMouseEvent = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
      if (
        input.type === "mouseDown" ||
        input.type === "mouseWheel" ||
        input.type === "contextMenu"
      ) {
        if (
          this.consumeOwnerExpectedAutomationInput(owner, tabId, {
            kind: "mouse",
            type: input.type,
            x: input.x,
            y: input.y,
            ...(input.button === undefined ? {} : { button: input.button }),
          })
        ) {
          return;
        }
        this.markOwnerHumanControl(owner);
      }
    };
    webContents.on("before-mouse-event", beforeMouseEvent);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-mouse-event", beforeMouseEvent);
    });

    const pageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault();
      this.queueOwnerRuntimeStateSync(owner, tabId);
    };
    webContents.on("page-title-updated", pageTitleUpdated);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("page-title-updated", pageTitleUpdated);
    });

    const pageFaviconUpdated = (_event: Electron.Event, faviconUrls: string[]) => {
      this.queueOwnerRuntimeStateSync(owner, tabId, faviconUrls);
    };
    webContents.on("page-favicon-updated", pageFaviconUpdated);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("page-favicon-updated", pageFaviconUpdated);
    });

    const didStartLoading = () => {
      this.queueOwnerRuntimeStateSync(owner, tabId);
    };
    webContents.on("did-start-loading", didStartLoading);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-start-loading", didStartLoading);
    });

    const didStopLoading = () => {
      this.queueOwnerRuntimeStateSync(owner, tabId);
      this.recoverOwnerAnnotationNavigation(toAnnotationOwner(owner), tabId, webContents.id);
    };
    webContents.on("did-stop-loading", didStopLoading);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-stop-loading", didStopLoading);
    });

    const didNavigate = () => {
      this.queueOwnerRuntimeStateSync(owner, tabId);
    };
    webContents.on("did-navigate", didNavigate);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-navigate", didNavigate);
    });

    const didStartNavigation = (
      _event: Electron.Event,
      _url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame && !_isInPlace) {
        this.handleOwnerAnnotationNavigation(toAnnotationOwner(owner), tabId, webContents.id);
      }
    };
    webContents.on("did-start-navigation", didStartNavigation);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-start-navigation", didStartNavigation);
    });

    const didNavigateInPage = () => {
      this.queueOwnerRuntimeStateSync(owner, tabId);
      this.handleOwnerAnnotationInPageNavigation(toAnnotationOwner(owner), tabId, webContents.id);
    };
    webContents.on("did-navigate-in-page", didNavigateInPage);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-navigate-in-page", didNavigateInPage);
    });

    const didFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) {
        return;
      }
      this.recoverOwnerAnnotationNavigation(toAnnotationOwner(owner), tabId, webContents.id);
      if (errorCode === BROWSER_ERROR_ABORTED) return;

      const state = this.states.get(browserOwnerWorkspaceKey(owner));
      const tab = state ? this.getTab(state, tabId) : null;
      if (!state || !tab) {
        return;
      }

      tab.url = validatedURL ? this.sessionPolicy.resolveDisplayUrl(validatedURL) : tab.url;
      tab.title = defaultTitleForUrl(tab.url);
      tab.isLoading = false;
      tab.lastError = mapBrowserLoadError(errorCode);
      syncThreadLastError(state);
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    };
    webContents.on("did-fail-load", didFailLoad);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-fail-load", didFailLoad);
    });

    let runtimeLossHandled = false;
    const handleRuntimeLoss = () => {
      // Electron can report both a crashed process and the eventual
      // WebContents destruction. Only the runtime that installed this handler
      // may invalidate the logical tab; a late event from an old guest must not
      // tear down a replacement already stored under the same runtime key.
      if (runtimeLossHandled || this.runtimes.get(runtime.key) !== runtime) {
        return;
      }
      runtimeLossHandled = true;
      const state = this.states.get(browserOwnerWorkspaceKey(owner));
      const tab = state ? this.getTab(state, tabId) : null;
      this.destroyOwnerRuntime(owner, tabId);
      if (state && tab) {
        tab.status = "suspended";
        tab.isLoading = false;
        tab.lastError = "This tab stopped unexpectedly.";
        syncThreadLastError(state);
        this.markOwnerStateChanged(owner);
        this.emitOwnerState(owner);
      }
      const bounds = this.getVisibleBoundsForOwner(owner);
      if (this.isActiveOwner(owner) && bounds) {
        this.attachActiveTab(owner, bounds);
      }
    };
    webContents.on("render-process-gone", handleRuntimeLoss);
    webContents.on("destroyed", handleRuntimeLoss);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("render-process-gone", handleRuntimeLoss);
      webContents.removeListener("destroyed", handleRuntimeLoss);
    });
  }

  private async loadOwnerTab(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    options: { force?: boolean; runtime?: LiveTabRuntime } = {},
  ): Promise<void> {
    const state = this.ensureOwnerWorkspace(owner);
    const tab = this.getTab(state, tabId);
    if (!tab) {
      return;
    }

    const runtime = options.runtime ?? this.ensureOwnerLiveRuntime(owner, tabId);
    const webContents = runtime.webContents;
    const nextUrl = normalizeUrlInput(
      options.force === true ? tab.url : (tab.lastCommittedUrl ?? tab.url),
    );
    const currentUrl = this.sessionPolicy.resolveDisplayUrl(webContents.getURL());
    const shouldLoad = options.force === true || currentUrl !== nextUrl || currentUrl.length === 0;

    if (!shouldLoad) {
      this.queueOwnerRuntimeStateSync(owner, tabId);
      return;
    }

    tab.url = nextUrl;
    tab.status = "live";
    tab.isLoading = true;
    tab.lastError = null;
    syncThreadLastError(state);
    this.markOwnerStateChanged(owner);
    this.emitOwnerState(owner);

    try {
      await webContents.loadURL(this.sessionPolicy.resolveRuntimeUrl(nextUrl));
      this.queueOwnerRuntimeStateSync(owner, tabId);
    } catch (error) {
      if (isAbortedNavigationError(error)) {
        this.queueOwnerRuntimeStateSync(owner, tabId);
        return;
      }

      tab.isLoading = false;
      tab.lastError = "Couldn't open this page.";
      syncThreadLastError(state);
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    }
  }

  private syncOwnerRuntimeState(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    faviconUrls?: string[],
  ): void {
    this.perfCounters.syncRuntimeStateCalls += 1;
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    const tab = state ? this.getTab(state, tabId) : null;
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(owner, tabId));
    if (!state || !tab || !runtime) {
      return;
    }

    const didChange = syncTabStateFromRuntime(
      state,
      tab,
      runtime.webContents,
      (url) => this.sessionPolicy.resolveDisplayUrl(url),
      faviconUrls,
    );
    const nextDidChange = syncThreadLastError(state) || didChange;
    if (nextDidChange) {
      this.markOwnerStateChanged(owner);
      this.emitOwnerState(owner);
    }
  }

  private queueOwnerRuntimeStateSync(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    faviconUrls?: string[],
  ): void {
    const key = browserOwnerRuntimeKey(owner, tabId);
    const existing = this.pendingRuntimeSyncs.get(key);
    const nextPendingSync: PendingRuntimeSync = {
      owner,
      tabId,
    };
    const nextFaviconUrls = faviconUrls ?? existing?.faviconUrls;
    if (nextFaviconUrls !== undefined) {
      nextPendingSync.faviconUrls = nextFaviconUrls;
    }
    this.pendingRuntimeSyncs.set(key, nextPendingSync);

    if (this.runtimeSyncFlushScheduled) {
      return;
    }

    this.runtimeSyncFlushScheduled = true;
    queueMicrotask(() => {
      this.runtimeSyncFlushScheduled = false;
      if (this.pendingRuntimeSyncs.size === 0) {
        return;
      }

      this.perfCounters.runtimeSyncQueueFlushes += 1;
      const pendingSyncs = [...this.pendingRuntimeSyncs.values()];
      this.pendingRuntimeSyncs.clear();
      for (const pendingSync of pendingSyncs) {
        this.syncOwnerRuntimeState(pendingSync.owner, pendingSync.tabId, pendingSync.faviconUrls);
      }
    });
  }

  private destroyOwnerRuntimes(owner: BrowserWorkspaceOwner): void {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    if (!state) {
      return;
    }

    for (const tab of state.tabs) {
      this.destroyOwnerRuntime(owner, tab.id);
    }
  }

  private destroyAllRuntimes(): void {
    for (const runtime of this.runtimes.values()) {
      this.destroyOwnerRuntime(runtime.owner, runtime.tabId);
    }
  }

  private destroyOwnerRuntime(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    options: {
      readonly preserveRendererDebugger?: boolean;
      readonly preserveAutomationDownloadTracking?: boolean;
      readonly annotationReason?: "detached" | "destroyed" | "replaced";
    } = {},
  ): void {
    const key = browserOwnerRuntimeKey(owner, tabId);
    const preserveAutomationDownloadTracking =
      options.preserveAutomationDownloadTracking === true &&
      (this.automationDownloadListenersByRuntimeKey.has(key) ||
        this.automationSideEffectProvenanceByRuntimeKey.has(key));
    this.clearPendingWindowOpenTask(owner, tabId);
    this.clearTabSuspendTimer(owner, tabId);
    this.pendingRuntimeSyncs.delete(key);
    this.runtimeLastActiveAtByKey.delete(key);
    this.automationRuntimeProtectedUntilByKey.delete(key);
    this.expectedAutomationInputsByRuntimeKey.delete(key);
    this.automationWindowOpenListenersByRuntimeKey.delete(key);
    if (!preserveAutomationDownloadTracking) {
      this.automationGestureDepthByRuntimeKey.delete(key);
      this.automationDownloadListenersByRuntimeKey.delete(key);
      this.automationSideEffectProvenanceByRuntimeKey.delete(key);
    }
    const runtime = this.runtimes.get(key);
    if (!runtime) {
      return;
    }
    this.handleOwnerAnnotationRuntimeDetached(
      toAnnotationOwner(owner),
      tabId,
      runtime.webContents.id,
      options.annotationReason ?? (runtime.webContents.isDestroyed() ? "destroyed" : "detached"),
    );

    if (this.attachedRuntimeKey === key) {
      this.detachAttachedRuntime();
    }

    // Bookkeeping should normally identify the attached native view, but an
    // interrupted renderer transition must not be able to leave an untracked
    // WebContentsView over the canonical renderer WebView. Remove it from the
    // window hierarchy defensively before closing its WebContents.
    if (runtime.view && this.window) {
      this.setRuntimeViewHidden(runtime, true);
      try {
        this.window.contentView.removeChildView(runtime.view);
      } catch {
        // The view was already detached, which is the desired final state.
      }
    }

    this.runtimes.delete(key);
    const webContents = runtime.webContents;
    for (const disposeListener of runtime.listenerDisposers.splice(0)) {
      disposeListener();
    }
    if (!webContents.isDestroyed()) {
      if (
        webContents.debugger.isAttached() &&
        (runtime.ownsWebContents || !options.preserveRendererDebugger)
      ) {
        try {
          webContents.debugger.detach();
        } catch {
          // The guest/runtime is being torn down anyway; ignore stale cleanup noise.
        }
      }
      if (runtime.ownsWebContents) {
        webContents.close({ waitForBeforeUnload: false });
      }
      // A renderer-owned WebView may be rebound to another logical tab without
      // replacing its physical WebContents. That explicit path preserves CDP.
      // Final logical close detaches CDP and resets the pooled guest to blank in
      // the deferred publication handshake; forcing physical destruction here
      // can wedge Electron while the tool IPC is still unwinding.
    }
  }

  private findRendererRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (!runtime.ownsWebContents && runtime.webContents.id === webContentsId) {
        return runtime;
      }
    }
    return null;
  }

  private findRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (runtime.webContents.id === webContentsId) return runtime;
    }
    return null;
  }

  private toAnnotationRuntime(runtime: LiveTabRuntime | null): BrowserAnnotationRuntime | null {
    if (!runtime || runtime.webContents.isDestroyed()) return null;
    if (runtime.owner.kind === "thread") {
      return {
        threadId: runtime.owner.threadId,
        tabId: runtime.tabId,
        webContents: runtime.webContents,
      };
    }
    return {
      projectId: runtime.owner.projectId,
      tabId: runtime.tabId,
      webContents: runtime.webContents,
    };
  }

  private getOrCreateOwnerState(owner: BrowserWorkspaceOwner): OwnerWorkspaceState {
    const key = browserOwnerWorkspaceKey(owner);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const initial = defaultOwnerWorkspaceState();
    this.states.set(key, initial);
    this.ownerVersionByKey.set(key, 0);
    return initial;
  }

  private markOwnerStateChanged(owner: BrowserWorkspaceOwner): void {
    const key = browserOwnerWorkspaceKey(owner);
    const nextVersion = (this.ownerVersionByKey.get(key) ?? 0) + 1;
    this.ownerVersionByKey.set(key, nextVersion);
    const state = this.states.get(key);
    if (state) {
      state.version = nextVersion;
    }
  }

  private markOwnerHumanControl(owner: BrowserWorkspaceOwner): void {
    const key = browserOwnerWorkspaceKey(owner);
    const state = this.states.get(key);
    const activeTab = state ? this.getActiveTab(state) : null;
    if (activeTab) {
      this.runtimeLastActiveAtByKey.set(browserOwnerRuntimeKey(owner, activeTab.id), Date.now());
    }
    this.humanControlEpochByOwnerKey.set(key, (this.humanControlEpochByOwnerKey.get(key) ?? 0) + 1);
    for (const [runtimeKey, provenance] of this.automationSideEffectProvenanceByRuntimeKey) {
      if (browserOwnersEqual(provenance.owner, owner)) {
        this.automationSideEffectProvenanceByRuntimeKey.delete(runtimeKey);
      }
    }
    for (const listener of this.humanControlListenersByOwnerKey.get(key) ?? []) {
      try {
        listener();
      } catch {
        // Input delivery must never be disrupted by an automation observer.
      }
    }
  }

  private expectOwnerAutomationInput(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ): () => void {
    const key = browserOwnerRuntimeKey(owner, tabId);
    const now = Date.now();
    const pending: PendingBrowserAutomationInput = {
      signal,
      expiresAt: now + 1_000,
    };
    const current = (this.expectedAutomationInputsByRuntimeKey.get(key) ?? [])
      .filter((entry) => entry.expiresAt > now)
      .slice(-63);
    this.expectedAutomationInputsByRuntimeKey.set(key, [...current, pending]);
    this.beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const releaseTime = Date.now();
      const remaining = (this.expectedAutomationInputsByRuntimeKey.get(key) ?? []).filter(
        (entry) => entry.expiresAt > releaseTime,
      );
      if (remaining.includes(pending)) {
        // debugger.sendCommand() resolves when CDP accepts the event, while
        // Electron may publish the corresponding before-mouse-event on the
        // following main-loop turn. Keep only this exact, one-shot signal alive
        // for that bounded delivery gap. Gesture/window-open correlation still
        // ends immediately below, so unrelated agent attribution cannot leak.
        pending.expiresAt = Math.min(
          pending.expiresAt,
          releaseTime + BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS,
        );
      }
      if (remaining.length === 0) this.expectedAutomationInputsByRuntimeKey.delete(key);
      else this.expectedAutomationInputsByRuntimeKey.set(key, remaining);
      this.endAutomationGesture(key);
    };
  }

  private isOwnerAutomationGestureActive(owner: BrowserWorkspaceOwner, tabId: string): boolean {
    return (
      (this.automationGestureDepthByRuntimeKey.get(browserOwnerRuntimeKey(owner, tabId)) ?? 0) > 0
    );
  }

  private emitAutomationWindowOpen(event: BrowserAutomationWindowOpenEvent): void {
    const key = browserOwnerRuntimeKey(event.owner, event.sourceTabId);
    for (const listener of this.automationWindowOpenListenersByRuntimeKey.get(key) ?? []) {
      try {
        listener(event);
      } catch {
        // Window creation must not be disrupted by an automation observer.
      }
    }
  }

  private emitAutomationDownload(event: BrowserAutomationDownloadEvent): void {
    const key = browserOwnerRuntimeKey(event.owner, event.sourceTabId);
    const humanControlEpoch = this.getOwnerAutomationHumanControlEpoch(event.owner);
    for (const lease of this.automationDownloadListenersByRuntimeKey.get(key) ?? []) {
      if (lease.humanControlEpoch !== humanControlEpoch) continue;
      try {
        lease.listener(event);
      } catch {
        // The download was already prevented. Observer failures must never
        // destabilize the shared browser session or re-enable the side effect.
      }
    }
  }

  private consumeOwnerExpectedAutomationInput(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ): boolean {
    const key = browserOwnerRuntimeKey(owner, tabId);
    const now = Date.now();
    const pending = (this.expectedAutomationInputsByRuntimeKey.get(key) ?? []).filter(
      (entry) => entry.expiresAt > now,
    );
    const matchedIndex = pending.findIndex((entry) =>
      browserAutomationInputMatches(entry.signal, signal),
    );
    if (matchedIndex < 0) {
      if (pending.length === 0) this.expectedAutomationInputsByRuntimeKey.delete(key);
      else this.expectedAutomationInputsByRuntimeKey.set(key, pending);
      return false;
    }
    pending.splice(matchedIndex, 1);
    if (pending.length === 0) this.expectedAutomationInputsByRuntimeKey.delete(key);
    else this.expectedAutomationInputsByRuntimeKey.set(key, pending);
    return true;
  }

  private snapshotOwnerState(
    owner: BrowserWorkspaceOwner,
    state = this.getOrCreateOwnerState(owner),
  ): OwnerWorkspaceState {
    const key = browserOwnerWorkspaceKey(owner);
    const version = state.version;
    const cached = this.snapshotCacheByOwnerKey.get(key);
    if (cached && cached.version === version) {
      return cached.snapshot;
    }

    const snapshot = cloneOwnerState(state);
    this.perfCounters.stateCloneCount += 1;
    this.snapshotCacheByOwnerKey.set(key, {
      version,
      snapshot,
    });
    return snapshot;
  }

  /**
   * Public Thread projection with the legacy identity contract: repeated reads
   * of an unchanged version return the same object (renderer caches rely on
   * reference equality for change detection).
   */
  private threadStateProjection(owner: { kind: "thread"; threadId: ThreadId }): ThreadBrowserState {
    const key = browserOwnerWorkspaceKey(owner);
    const snapshot = this.snapshotOwnerState(owner);
    const cached = this.threadProjectionCacheByKey.get(key);
    if (cached && cached.version === snapshot.version) {
      return cached.projection;
    }
    const projection = toThreadBrowserState(owner, snapshot);
    this.threadProjectionCacheByKey.set(key, { version: snapshot.version, projection });
    return projection;
  }

  /** Public Project projection with the same identity contract. */
  private projectStateProjection(owner: {
    kind: "project";
    projectId: ProjectId;
  }): ProjectBrowserState {
    const key = browserOwnerWorkspaceKey(owner);
    const snapshot = this.snapshotOwnerState(owner);
    const cached = this.projectProjectionCacheByKey.get(key);
    if (cached && cached.version === snapshot.version) {
      return cached.projection;
    }
    const projection = toProjectBrowserState(owner, snapshot);
    this.projectProjectionCacheByKey.set(key, { version: snapshot.version, projection });
    return projection;
  }

  private getTrackedProcessIds(): number[] {
    const processIds = new Set<number>();
    for (const runtime of this.runtimes.values()) {
      const webContents = runtime.webContents;
      if (webContents.isDestroyed()) {
        continue;
      }
      processIds.add(webContents.getProcessId());
    }
    return [...processIds];
  }

  private countWarmInactiveRuntimes(): number {
    let count = 0;
    for (const [key] of this.tabSuspendTimers) {
      if (this.runtimes.has(key)) {
        count += 1;
      }
    }
    return count;
  }

  private resolveInactiveTabSuspendDelay(owner: BrowserWorkspaceOwner): number {
    const ownerRuntimeCount = [...this.runtimes.values()].filter((runtime) =>
      browserOwnersEqual(runtime.owner, owner),
    ).length;
    if (
      ownerRuntimeCount > BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD + 1 ||
      this.runtimes.size > 4
    ) {
      return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS;
    }

    return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS;
  }

  private ensureOwnerWorkspace(
    owner: BrowserWorkspaceOwner,
    initialUrl?: string | undefined,
  ): OwnerWorkspaceState {
    this.sessionPolicy.ensureConfigured();
    const state = this.getOrCreateOwnerState(owner);
    if (state.tabs.length === 0) {
      const initialTab = createBrowserTab(normalizeUrlInput(initialUrl));
      state.tabs = [initialTab];
      state.activeTabId = initialTab.id;
    }

    if (!state.activeTabId || !state.tabs.some((tab) => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[0]?.id ?? null;
    }

    return state;
  }

  private resolveTab(state: WorkspaceTabErrorView, tabId?: string): BrowserTabState {
    const resolvedTabId = tabId ?? state.activeTabId;
    const existing =
      (resolvedTabId ? state.tabs.find((tab) => tab.id === resolvedTabId) : undefined) ??
      state.tabs[0];
    if (existing) {
      return existing;
    }

    const fallback = createBrowserTab();
    state.tabs = [fallback];
    state.activeTabId = fallback.id;
    return fallback;
  }

  private activateOwnerTab(
    owner: BrowserWorkspaceOwner,
    state: OwnerWorkspaceState,
    tab: BrowserTabState,
  ): void {
    if (state.activeTabId === tab.id) {
      return;
    }

    state.activeTabId = tab.id;
    syncThreadLastError(state);
    this.markOwnerStateChanged(owner);
    this.emitOwnerState(owner);
  }

  private getActiveTab(state: WorkspaceTabErrorView): BrowserTabState | null {
    if (!state.activeTabId) {
      return state.tabs[0] ?? null;
    }
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
  }

  private getTab(state: WorkspaceTabErrorView, tabId: string): BrowserTabState | null {
    return state.tabs.find((tab) => tab.id === tabId) ?? null;
  }

  // Resolves the most accurate URL for a tab, preferring the live page over cached state and
  // ignoring blank placeholders so the copy-link chord never yields "about:blank".
  private resolveCopyableOwnerTabUrl(
    owner: BrowserWorkspaceOwner,
    tabId: string,
    runtime: LiveTabRuntime | undefined,
  ): string | null {
    const state = this.states.get(browserOwnerWorkspaceKey(owner));
    const tab = state ? this.getTab(state, tabId) : null;
    const liveUrl =
      runtime && !runtime.webContents.isDestroyed() ? runtime.webContents.getURL() : null;
    return resolveCopyableBrowserTabUrl(tab, liveUrl);
  }

  private copyOwnerTabLink(input: BrowserOwnerTabInput): void {
    const runtime = this.runtimes.get(browserOwnerRuntimeKey(input.owner, input.tabId));
    const url = this.resolveCopyableOwnerTabUrl(input.owner, input.tabId, runtime);
    if (!url) {
      return;
    }
    clipboard.writeText(url);
    this.emitCopyLink(input.owner, url);
  }

  private emitCopyLink(owner: BrowserWorkspaceOwner, url: string): void {
    if (owner.kind === "thread") {
      const event: BrowserCopyLinkEvent = { threadId: owner.threadId, url };
      for (const listener of this.copyLinkListeners) {
        listener(event);
      }
      return;
    }
    const event: ProjectBrowserCopyLinkEvent = { projectId: owner.projectId, url };
    for (const listener of this.projectCopyLinkListeners) {
      listener(event);
    }
  }

  private emitOwnerState(owner: BrowserWorkspaceOwner): void {
    this.perfCounters.stateEmitCalls += 1;
    const key = browserOwnerWorkspaceKey(owner);
    const state = this.getOrCreateOwnerState(owner);
    const nextVersion = state.version;
    if (this.lastEmittedVersionByOwnerKey.get(key) === nextVersion) {
      this.perfCounters.stateEmitSkips += 1;
      return;
    }
    this.lastEmittedVersionByOwnerKey.set(key, nextVersion);
    const snapshot = this.snapshotOwnerState(owner, state);
    if (owner.kind === "thread") {
      const projected = toThreadBrowserState(owner, snapshot);
      for (const listener of this.listeners) {
        listener(projected);
      }
      return;
    }
    const projected = toProjectBrowserState(owner, snapshot);
    for (const listener of this.projectListeners) {
      listener(projected);
    }
  }
}

function setIfChanged<T>(current: T, next: T, apply: (value: T) => void): boolean {
  if (Object.is(current, next)) {
    return false;
  }
  apply(next);
  return true;
}

function suspendTabState(tab: BrowserTabState): boolean {
  let didChange = false;
  didChange =
    setIfChanged(tab.status, SUSPENDED_TAB_STATUS, (value) => {
      tab.status = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.isLoading, false, (value) => {
      tab.isLoading = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoBack, false, (value) => {
      tab.canGoBack = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoForward, false, (value) => {
      tab.canGoForward = value;
    }) || didChange;
  return didChange;
}

function syncTabStateFromRuntime(
  state: WorkspaceTabErrorView,
  tab: BrowserTabState,
  webContents: WebContents,
  resolveDisplayUrl: (url: string) => string,
  faviconUrls?: string[],
): boolean {
  const currentUrl = resolveDisplayUrl(webContents.getURL());
  const nextUrl = currentUrl || tab.url;
  const nextTitle = webContents.getTitle();
  let didChange = false;
  didChange =
    setIfChanged(tab.status, LIVE_TAB_STATUS, (value) => {
      tab.status = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.url, nextUrl, (value) => {
      tab.url = value;
    }) || didChange;
  const resolvedTitle =
    !nextTitle || nextTitle === ABOUT_BLANK_URL ? defaultTitleForUrl(nextUrl) : nextTitle;
  didChange =
    setIfChanged(tab.title, resolvedTitle, (value) => {
      tab.title = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.isLoading, webContents.isLoading(), (value) => {
      tab.isLoading = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoBack, canWebContentsGoBack(webContents), (value) => {
      tab.canGoBack = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoForward, canWebContentsGoForward(webContents), (value) => {
      tab.canGoForward = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.lastCommittedUrl, currentUrl || tab.lastCommittedUrl, (value) => {
      tab.lastCommittedUrl = value;
    }) || didChange;
  if (faviconUrls) {
    didChange =
      setIfChanged(tab.faviconUrl, faviconUrls[0] ?? tab.faviconUrl, (value) => {
        tab.faviconUrl = value;
      }) || didChange;
  }
  if (tab.lastError && !tab.isLoading) {
    tab.lastError = null;
    didChange = true;
  }
  didChange = syncThreadLastError(state) || didChange;
  return didChange;
}

function canWebContentsGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack();
}

function canWebContentsGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward();
}

function syncThreadLastError(state: WorkspaceTabErrorView): boolean {
  const activeTab =
    (state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) : undefined) ??
    state.tabs[0];
  const nextLastError = activeTab?.lastError ?? null;
  if (state.lastError === nextLastError) {
    return false;
  }
  state.lastError = nextLastError;
  return true;
}
