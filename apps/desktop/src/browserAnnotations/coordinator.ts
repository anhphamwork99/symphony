import * as Crypto from "node:crypto";

import type { WebContents } from "electron";
import type {
  BrowserAnnotation,
  BrowserAnnotationCancelInput,
  BrowserAnnotationCancelReason,
  BrowserAnnotationEvent,
  BrowserAnnotationProjectCancelInput,
  BrowserAnnotationProjectEvent,
  BrowserAnnotationProjectSession,
  BrowserAnnotationProjectStartInput,
  BrowserAnnotationProjectSyncMarkersInput,
  BrowserAnnotationSession,
  BrowserAnnotationStartInput,
  BrowserAnnotationSyncMarkersInput,
  BrowserAnnotationDocument,
  BrowserAnnotationSource,
  BrowserAnnotationTheme,
  ProjectId,
  ThreadId,
} from "@synara/contracts";
import {
  browserAnnotationDocumentIdentityUrl,
  sanitizeBrowserAnnotationUrl,
} from "@synara/shared/browserAnnotations";

import { BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL } from "../ipcChannels";
import {
  BROWSER_ANNOTATION_PROTOCOL_VERSION,
  parseAnnotationGuestMessage,
  parseBrowserAnnotationTheme,
  parseBrowserAnnotationMarkers,
} from "./protocol";

export interface BrowserAnnotationRuntime {
  /**
   * Provenance conversation for the legacy Thread-keyed surface. Present only
   * when the owning workspace is a Thread: a Project-owned runtime carries
   * `projectId` instead — there is no synthetic Thread alias (Decision 0002).
   */
  readonly threadId?: ThreadId;
  /** Owning Project when this runtime belongs to a Project workspace. */
  readonly projectId?: ProjectId;
  readonly tabId: string;
  readonly webContents: WebContents;
}

/**
 * Internal workspace owner of one annotation surface (Decision 0002): the
 * Right-sidebar browser/annotation workspace belongs to the real ProjectId.
 * `thread` is the legacy v1 owner kept for the unchanged Thread-keyed
 * surface; the two key spaces are disjoint and never merged.
 */
export type BrowserAnnotationWorkspaceOwner =
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "project"; readonly projectId: ProjectId };

/** Deterministic, collision-free key for one owner plus its tab. */
export function browserAnnotationOwnerKey(
  owner: BrowserAnnotationWorkspaceOwner,
  tabId: string,
): string {
  return owner.kind === "thread"
    ? `t:${owner.threadId}:${tabId}`
    : `p:${owner.projectId}:${tabId}`;
}

/** Extract the owning ProjectId, or null for a legacy Thread-owned surface. */
export function browserAnnotationOwnerProjectId(
  owner: BrowserAnnotationWorkspaceOwner,
): ProjectId | null {
  return owner.kind === "project" ? owner.projectId : null;
}

interface BrowserAnnotationCoordinatorOptions {
  readonly resolveVisibleRuntime: (
    input: BrowserAnnotationStartInput | BrowserAnnotationCancelInput,
  ) => BrowserAnnotationRuntime;
  /** Project-owned runtime resolution (v2); absent means no Project surface. */
  readonly resolveProjectVisibleRuntime?: (
    input: BrowserAnnotationProjectStartInput | BrowserAnnotationProjectCancelInput,
  ) => BrowserAnnotationRuntime | null;
  readonly resolveRuntimeByWebContentsId: (
    webContentsId: number,
  ) => BrowserAnnotationRuntime | null;
  readonly markHumanControl: (owner: BrowserAnnotationWorkspaceOwner) => void;
}

interface ReadyDocument {
  readonly webContentsId: number;
  readonly liveUrl: string;
  readonly compatibleDocumentKeys: ReadonlySet<string>;
  readonly document: BrowserAnnotationDocument;
  readonly source: BrowserAnnotationSource;
}

interface ActiveSession {
  readonly sessionId: string;
  readonly runtime: BrowserAnnotationRuntime;
  readonly liveUrl: string;
  readonly document: BrowserAnnotationDocument;
  readonly source: BrowserAnnotationSource;
  readonly theme: BrowserAnnotationTheme;
}

interface MarkerProjection {
  readonly version: number;
  readonly markers: BrowserAnnotationSyncMarkersInput["markers"];
}

interface BrowserAnnotationAffinity {
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  readonly tabId: string;
  readonly liveUrl: string;
}

type BrowserAnnotationEventListener = (event: BrowserAnnotationEvent) => void;
type BrowserAnnotationProjectEventListener = (
  event: BrowserAnnotationProjectEvent,
) => void;

function runtimeKey(threadId: ThreadId, tabId: string): string {
  return `t:${threadId}:${tabId}`;
}

function canonicalWebUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function browserAnnotationDocumentKey(liveUrl: string): string {
  return `sha256:${Crypto.createHash("sha256").update(liveUrl).digest("hex")}`;
}

export class BrowserAnnotationCoordinator {
  private readonly documentsByRuntimeKey = new Map<string, ReadyDocument>();
  private readonly sessionsByRuntimeKey = new Map<string, ActiveSession>();
  private readonly projectionsByRuntimeKey = new Map<string, MarkerProjection>();
  private readonly invalidatedDocumentRuntimeKeys = new Set<string>();
  private readonly listeners = new Set<BrowserAnnotationEventListener>();
  private readonly projectListeners = new Set<BrowserAnnotationProjectEventListener>();
  private readonly committedAnnotationIds = new Set<string>();
  private readonly affinityByAnnotationId = new Map<string, BrowserAnnotationAffinity>();

  constructor(private readonly options: BrowserAnnotationCoordinatorOptions) {}

  subscribe(listener: BrowserAnnotationEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(input: BrowserAnnotationStartInput): BrowserAnnotationSession {
    const theme = parseBrowserAnnotationTheme(input.theme);
    if (!theme) {
      throw new Error("Invalid browser annotation theme.");
    }
    const runtime = this.options.resolveVisibleRuntime(input);
    const key = runtimeKey(input.threadId, input.tabId);
    const documentState = this.documentsByRuntimeKey.get(key);
    if (
      !documentState ||
      this.invalidatedDocumentRuntimeKeys.has(key) ||
      documentState.webContentsId !== runtime.webContents.id ||
      runtime.webContents.isDestroyed()
    ) {
      throw new Error("The browser page is not ready for annotation.");
    }
    const liveUrl = canonicalWebUrl(runtime.webContents.getURL());
    if (
      !liveUrl ||
      liveUrl !== documentState.liveUrl ||
      sanitizeBrowserAnnotationUrl(liveUrl) !== documentState.source.url
    ) {
      throw new Error("The browser page changed before annotation could start.");
    }

    const existing = this.sessionsByRuntimeKey.get(key);
    if (
      existing &&
      existing.runtime.webContents.id === runtime.webContents.id &&
      existing.document.token === documentState.document.token
    ) {
      return this.toPublicSession(existing);
    }
    if (existing) {
      this.finishSession(existing, "replaced", true);
    }

    // Starting the picker is an explicit human takeover. This interrupts any
    // in-flight agent command before the guest becomes interactive.
    this.options.markHumanControl({ kind: "thread", threadId: input.threadId });
    const session: ActiveSession = {
      sessionId: Crypto.randomUUID(),
      runtime,
      liveUrl,
      document: documentState.document,
      source: documentState.source,
      theme,
    };
    this.sessionsByRuntimeKey.set(key, session);
    runtime.webContents.send(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, {
      version: BROWSER_ANNOTATION_PROTOCOL_VERSION,
      kind: "start",
      documentToken: session.document.token,
      sessionId: session.sessionId,
      theme: session.theme,
    });
    this.emit({
      kind: "started",
      sessionId: session.sessionId,
      threadId: this.threadProvenance(session.runtime),
      tabId: session.runtime.tabId,
      document: session.document,
      source: session.source,
    });
    return this.toPublicSession(session);
  }

  cancel(input: BrowserAnnotationCancelInput): void {
    const key = runtimeKey(input.threadId, input.tabId);
    const session = this.sessionsByRuntimeKey.get(key);
    if (!session) return;
    // Resolve again so a stale renderer command cannot cancel a session after
    // the logical tab has moved to another physical guest.
    const runtime = this.options.resolveVisibleRuntime(input);
    if (runtime.webContents.id !== session.runtime.webContents.id) return;
    this.finishSession(session, "user", true);
  }

  syncMarkers(input: BrowserAnnotationSyncMarkersInput): void {
    const parsedMarkers = parseBrowserAnnotationMarkers(input.markers);
    if (!Number.isSafeInteger(input.version) || input.version < 0 || parsedMarkers === null) {
      throw new Error("Invalid browser annotation marker projection.");
    }
    const key = runtimeKey(input.threadId, input.tabId);
    const previous = this.projectionsByRuntimeKey.get(key);
    if (previous && input.version < previous.version) return;
    if (previous && input.version === previous.version) return;
    const projection: MarkerProjection = {
      version: input.version,
      // parsedMarkers is a freshly-parsed array owned by this call; replace
      // source in place instead of allocating a spread copy per marker.
      markers: parsedMarkers.map((marker) => {
        marker.source = { ...marker.source };
        return marker;
      }),
    };
    this.projectionsByRuntimeKey.set(key, projection);
    const runtime = this.options.resolveRuntimeByWebContentsId(
      this.documentsByRuntimeKey.get(key)?.webContentsId ?? -1,
    );
    if (runtime && runtime.threadId === input.threadId && runtime.tabId === input.tabId) {
      this.sendProjection(runtime, projection);
    }
  }

  handleGuestMessage(sender: WebContents, rawMessage: unknown): void {
    const runtime = this.options.resolveRuntimeByWebContentsId(sender.id);
    if (!runtime || runtime.webContents !== sender || sender.isDestroyed()) return;
    const message = parseAnnotationGuestMessage(rawMessage);
    if (!message) return;
    const key = this.ownerRuntimeKey(runtime);

    if (message.kind === "ready") {
      const liveUrl = canonicalWebUrl(sender.getURL());
      if (!liveUrl || sanitizeBrowserAnnotationUrl(liveUrl) !== message.source.url) return;
      const previousDocument = this.documentsByRuntimeKey.get(key);
      this.invalidatedDocumentRuntimeKeys.delete(key);
      const activeSession = this.sessionsByRuntimeKey.get(key);
      if (
        activeSession &&
        (activeSession.runtime.webContents.id !== sender.id ||
          activeSession.document.token !== message.documentToken ||
          activeSession.liveUrl !== liveUrl)
      ) {
        this.finishSession(activeSession, "navigation", false);
      }
      const identityKey = browserAnnotationDocumentKey(
        browserAnnotationDocumentIdentityUrl(liveUrl),
      );
      const compatibleDocumentKeys = new Set([identityKey, browserAnnotationDocumentKey(liveUrl)]);
      const document: BrowserAnnotationDocument = {
        token: message.documentToken,
        key: identityKey,
        url: message.source.url,
      };
      const ready: ReadyDocument = {
        webContentsId: sender.id,
        liveUrl,
        compatibleDocumentKeys,
        document,
        source: message.source,
      };
      this.documentsByRuntimeKey.set(key, ready);
      if (
        !previousDocument ||
        previousDocument.webContentsId !== sender.id ||
        previousDocument.document.token !== document.token ||
        previousDocument.liveUrl !== liveUrl
      ) {
        this.emitDocumentChanged(runtime, document, message.source);
      }
      const projection = this.projectionsByRuntimeKey.get(key);
      if (projection) this.sendProjection(runtime, projection);
      return;
    }

    const documentState = this.documentsByRuntimeKey.get(key);
    if (
      !documentState ||
      documentState.webContentsId !== sender.id ||
      documentState.document.token !== message.documentToken
    ) {
      return;
    }

    if (message.kind === "markers-projected") {
      const projection = this.projectionsByRuntimeKey.get(key);
      if (!projection || projection.version !== message.projectionVersion) return;
      const allowedIds = new Set(
        this.markersForDocument(documentState, projection).map((marker) => marker.id),
      );
      if (message.projectedMarkerIds.some((id) => !allowedIds.has(id))) return;
      this.emitMarkersSynced(runtime, documentState, projection, message.projectedMarkerIds);
      return;
    }

    const session = this.sessionsByRuntimeKey.get(key);
    if (
      !session ||
      session.runtime.webContents.id !== sender.id ||
      session.document.token !== message.documentToken ||
      session.sessionId !== message.sessionId
    ) {
      return;
    }
    if (message.kind === "cancelled") {
      this.finishSession(session, "user", false);
      return;
    }

    if (
      message.annotation.source.url !== session.source.url ||
      canonicalWebUrl(sender.getURL()) !== session.liveUrl ||
      this.committedAnnotationIds.has(message.annotation.id)
    ) {
      return;
    }
    this.rememberCommittedAnnotation(message.annotation.id);
    this.rememberAnnotationAffinity(message.annotation.id, runtime, session.liveUrl);
    this.emitCommitted(runtime, session, message.annotation);
  }

  startForProject(
    input: BrowserAnnotationProjectStartInput,
  ): BrowserAnnotationProjectSession {
    const theme = parseBrowserAnnotationTheme(input.theme);
    if (!theme) {
      throw new Error("Invalid browser annotation theme.");
    }
    const runtime = this.resolveProjectRuntime(input);
    const key = browserAnnotationOwnerKey(
      { kind: "project", projectId: input.projectId },
      input.tabId,
    );
    const documentState = this.documentsByRuntimeKey.get(key);
    if (
      !documentState ||
      this.invalidatedDocumentRuntimeKeys.has(key) ||
      documentState.webContentsId !== runtime.webContents.id ||
      runtime.webContents.isDestroyed()
    ) {
      throw new Error("The browser page is not ready for annotation.");
    }
    const liveUrl = canonicalWebUrl(runtime.webContents.getURL());
    if (
      !liveUrl ||
      liveUrl !== documentState.liveUrl ||
      sanitizeBrowserAnnotationUrl(liveUrl) !== documentState.source.url
    ) {
      throw new Error("The browser page changed before annotation could start.");
    }

    const existing = this.sessionsByRuntimeKey.get(key);
    if (
      existing &&
      existing.runtime.webContents.id === runtime.webContents.id &&
      existing.document.token === documentState.document.token
    ) {
      return this.toPublicProjectSession(existing);
    }
    if (existing) {
      this.finishSession(existing, "replaced", true);
    }

    this.options.markHumanControl({ kind: "project", projectId: input.projectId });
    const session: ActiveSession = {
      sessionId: Crypto.randomUUID(),
      runtime,
      liveUrl,
      document: documentState.document,
      source: documentState.source,
      theme,
    };
    this.sessionsByRuntimeKey.set(key, session);
    runtime.webContents.send(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, {
      version: BROWSER_ANNOTATION_PROTOCOL_VERSION,
      kind: "start",
      documentToken: session.document.token,
      sessionId: session.sessionId,
      theme: session.theme,
    });
    this.emitProject({
      kind: "started",
      sessionId: session.sessionId,
      projectId: input.projectId,
      tabId: session.runtime.tabId,
      document: session.document,
      source: session.source,
    });
    return this.toPublicProjectSession(session);
  }

  private resolveProjectRuntime(
    input: BrowserAnnotationProjectStartInput | BrowserAnnotationProjectCancelInput,
  ): BrowserAnnotationRuntime {
    const runtime = this.options.resolveProjectVisibleRuntime?.(input);
    if (!runtime) {
      throw new Error("The requested browser tab is not available in this project.");
    }
    return runtime;
  }

  cancelForProject(input: BrowserAnnotationProjectCancelInput): void {
    const runtime = this.resolveProjectRuntime(input);
    if (runtime.projectId === undefined) {
      return;
    }
    const key = browserAnnotationOwnerKey(
      { kind: "project", projectId: input.projectId },
      input.tabId,
    );
    const session = this.sessionsByRuntimeKey.get(key);
    if (!session) return;
    if (runtime.webContents.id !== session.runtime.webContents.id) return;
    this.finishSession(session, "user", true);
  }

  syncMarkersForProject(input: BrowserAnnotationProjectSyncMarkersInput): void {
    const parsedMarkers = parseBrowserAnnotationMarkers(input.markers);
    if (!Number.isSafeInteger(input.version) || input.version < 0 || parsedMarkers === null) {
      throw new Error("Invalid browser annotation marker projection.");
    }
    const key = browserAnnotationOwnerKey(
      { kind: "project", projectId: input.projectId },
      input.tabId,
    );
    const previous = this.projectionsByRuntimeKey.get(key);
    if (previous && input.version < previous.version) return;
    if (previous && input.version === previous.version) return;
    const projection: MarkerProjection = {
      version: input.version,
      markers: parsedMarkers.map((marker) => {
        marker.source = { ...marker.source };
        return marker;
      }),
    };
    this.projectionsByRuntimeKey.set(key, projection);
    const runtime = this.options.resolveRuntimeByWebContentsId(
      this.documentsByRuntimeKey.get(key)?.webContentsId ?? -1,
    );
    if (
      runtime &&
      runtime.projectId === input.projectId &&
      runtime.tabId === input.tabId
    ) {
      this.sendProjection(runtime, projection);
    }
  }

  resolveProjectAnnotationNavigationTarget(input: {
    projectId: ProjectId;
    tabId?: string;
    annotationId: string;
  }): { readonly tabId: string; readonly liveUrl: string } | null {
    const affinity = this.affinityByAnnotationId.get(input.annotationId);
    if (
      !affinity ||
      affinity.projectId !== input.projectId ||
      (input.tabId !== undefined && affinity.tabId !== input.tabId)
    ) {
      return null;
    }
    return { tabId: affinity.tabId, liveUrl: affinity.liveUrl };
  }

  subscribeProjectEvents(listener: (event: BrowserAnnotationProjectEvent) => void): () => void {
    this.projectListeners.add(listener);
    return () => {
      this.projectListeners.delete(listener);
    };
  }

  isInteractive(threadId: ThreadId): boolean {
    for (const session of this.sessionsByRuntimeKey.values()) {
      if (session.runtime.threadId === threadId) return true;
    }
    return false;
  }

  /** Whether any session is interactive for the given owner (owner-keyed). */
  hasInteractiveSession(owner: BrowserAnnotationWorkspaceOwner): boolean {
    for (const session of this.sessionsByRuntimeKey.values()) {
      if (
        (owner.kind === "thread" && session.runtime.threadId === owner.threadId) ||
        (owner.kind === "project" &&
          session.runtime.projectId !== undefined &&
          session.runtime.projectId === owner.projectId)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Project-owned variant of {@link isInteractive} (Decision 0002). */
  isInteractiveByOwner(owner: BrowserAnnotationWorkspaceOwner): boolean {
    if (owner.kind === "thread") {
      return this.isInteractive(owner.threadId);
    }
    for (const session of this.sessionsByRuntimeKey.values()) {
      if (session.runtime.projectId === owner.projectId) return true;
    }
    return false;
  }

  resolveNavigationTarget(
    threadId: ThreadId,
    annotationId: string,
    expectedTabId?: string,
  ): { readonly tabId: string; readonly liveUrl: string } | null {
    const affinity = this.affinityByAnnotationId.get(annotationId);
    if (
      !affinity ||
      affinity.threadId !== threadId ||
      (expectedTabId !== undefined && affinity.tabId !== expectedTabId)
    ) {
      return null;
    }
    return { tabId: affinity.tabId, liveUrl: affinity.liveUrl };
  }

  handleNavigation(threadId: ThreadId, tabId: string, webContentsId: number): void {
    this.handleOwnerNavigation({ kind: "thread", threadId }, tabId, webContentsId);
  }

  handleOwnerNavigation(
    owner: BrowserAnnotationWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    const key = browserAnnotationOwnerKey(owner, tabId);
    const documentState = this.documentsByRuntimeKey.get(key);
    if (documentState?.webContentsId !== webContentsId) return;
    const session = this.sessionsByRuntimeKey.get(key);
    if (session?.runtime.webContents.id === webContentsId) {
      this.finishSession(session, "navigation", true);
    }
    this.invalidatedDocumentRuntimeKeys.add(key);
  }

  recoverNavigation(threadId: ThreadId, tabId: string, webContentsId: number): void {
    return this.recoverOwnerNavigation({ kind: "thread", threadId }, tabId, webContentsId);
  }

  recoverOwnerNavigation(
    owner: BrowserAnnotationWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    const key = browserAnnotationOwnerKey(owner, tabId);
    if (!this.invalidatedDocumentRuntimeKeys.has(key)) return;
    const documentState = this.documentsByRuntimeKey.get(key);
    const runtime = this.options.resolveRuntimeByWebContentsId(webContentsId);
    if (
      !documentState ||
      documentState.webContentsId !== webContentsId ||
      !runtime ||
      runtime.webContents.isDestroyed()
    ) {
      return;
    }
    runtime.webContents.send(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, {
      version: BROWSER_ANNOTATION_PROTOCOL_VERSION,
      kind: "refresh-document",
      documentToken: documentState.document.token,
    });
  }

  handleInPageNavigation(threadId: ThreadId, tabId: string, webContentsId: number): void {
    this.handleOwnerInPageNavigation({ kind: "thread", threadId }, tabId, webContentsId);
  }

  handleOwnerInPageNavigation(
    owner: BrowserAnnotationWorkspaceOwner,
    tabId: string,
    webContentsId: number,
  ): void {
    const key = browserAnnotationOwnerKey(owner, tabId);
    const documentState = this.documentsByRuntimeKey.get(key);
    if (documentState?.webContentsId !== webContentsId) return;
    const session = this.sessionsByRuntimeKey.get(key);
    if (session?.runtime.webContents.id === webContentsId) {
      this.finishSession(session, "navigation", true);
    }
    const runtime = this.options.resolveRuntimeByWebContentsId(webContentsId);
    if (!runtime || runtime.webContents.isDestroyed()) return;
    runtime.webContents.send(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, {
      version: BROWSER_ANNOTATION_PROTOCOL_VERSION,
      kind: "refresh-document",
      documentToken: documentState.document.token,
    });
  }

  handleRuntimeDetached(
    threadId: ThreadId,
    tabId: string,
    webContentsId: number,
    reason: Extract<BrowserAnnotationCancelReason, "detached" | "destroyed" | "replaced">,
  ): void {
    this.handleOwnerRuntimeDetached({ kind: "thread", threadId }, tabId, webContentsId, reason);
  }

  handleOwnerRuntimeDetached(
    owner: BrowserAnnotationWorkspaceOwner,
    tabId: string,
    webContentsId: number,
    reason: Extract<BrowserAnnotationCancelReason, "detached" | "destroyed" | "replaced">,
  ): void {
    const key = browserAnnotationOwnerKey(owner, tabId);
    const session = this.sessionsByRuntimeKey.get(key);
    if (session?.runtime.webContents.id === webContentsId) {
      this.finishSession(session, reason, false);
    }
    if (this.documentsByRuntimeKey.get(key)?.webContentsId === webContentsId) {
      this.documentsByRuntimeKey.delete(key);
    }
    this.invalidatedDocumentRuntimeKeys.delete(key);
  }

  clearProjection(threadId: ThreadId, tabId: string): void {
    this.clearOwnerProjection({ kind: "thread", threadId }, tabId);
  }

  clearOwnerProjection(owner: BrowserAnnotationWorkspaceOwner, tabId: string): void {
    const key = browserAnnotationOwnerKey(owner, tabId);
    this.projectionsByRuntimeKey.delete(key);
  }

  dispose(): void {
    // finishSession removes entries from sessionsByRuntimeKey mid-iteration,
    // so the snapshot spread below is load-bearing, not a useless copy.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const session of [...this.sessionsByRuntimeKey.values()]) {
      this.finishSession(session, "destroyed", true);
    }
    this.documentsByRuntimeKey.clear();
    this.projectionsByRuntimeKey.clear();
    this.invalidatedDocumentRuntimeKeys.clear();
    this.listeners.clear();
    this.projectListeners.clear();
    this.committedAnnotationIds.clear();
    this.affinityByAnnotationId.clear();
  }

  private finishSession(
    session: ActiveSession,
    reason: BrowserAnnotationCancelReason,
    notifyGuest: boolean,
  ): void {
    const key = this.ownerRuntimeKey(session.runtime);
    if (this.sessionsByRuntimeKey.get(key) !== session) return;
    this.sessionsByRuntimeKey.delete(key);
    if (notifyGuest && !session.runtime.webContents.isDestroyed()) {
      session.runtime.webContents.send(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, {
        version: BROWSER_ANNOTATION_PROTOCOL_VERSION,
        kind: "cancel",
        documentToken: session.document.token,
        sessionId: session.sessionId,
      });
    }
    if (session.runtime.projectId !== undefined) {
      this.emitProject({
        kind: "cancelled",
        sessionId: session.sessionId,
        reason,
        projectId: session.runtime.projectId,
        tabId: session.runtime.tabId,
        document: session.document,
        source: session.source,
      });
      return;
    }
    this.emit({
      kind: "cancelled",
      sessionId: session.sessionId,
      reason,
      threadId: this.threadProvenance(session.runtime),
      tabId: session.runtime.tabId,
      document: session.document,
      source: session.source,
    });
  }

  private sendProjection(runtime: BrowserAnnotationRuntime, projection: MarkerProjection): void {
    const documentState = this.documentsByRuntimeKey.get(
      this.ownerRuntimeKey(runtime),
    );
    if (
      !documentState ||
      documentState.webContentsId !== runtime.webContents.id ||
      runtime.webContents.isDestroyed()
    ) {
      return;
    }
    const markers = this.markersForDocument(documentState, projection);
    for (const marker of markers) {
      this.rememberAnnotationAffinity(marker.id, runtime, documentState.liveUrl);
    }
    runtime.webContents.send(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, {
      version: BROWSER_ANNOTATION_PROTOCOL_VERSION,
      kind: "sync-markers",
      documentToken: documentState.document.token,
      projectionVersion: projection.version,
      markers,
    });
  }

  private markersForDocument(
    documentState: ReadyDocument,
    projection: MarkerProjection,
  ): BrowserAnnotationSyncMarkersInput["markers"] {
    return projection.markers.filter((marker) => {
      if (marker.source.url !== documentState.source.url) return false;
      return documentState.compatibleDocumentKeys.has(marker.documentKey);
    });
  }

  private toPublicSession(session: ActiveSession): BrowserAnnotationSession {
    return {
      sessionId: session.sessionId,
      threadId: this.threadProvenance(session.runtime),
      tabId: session.runtime.tabId,
      document: session.document,
      source: session.source,
    };
  }

  private rememberCommittedAnnotation(annotationId: string): void {
    this.committedAnnotationIds.add(annotationId);
    if (this.committedAnnotationIds.size <= 1_024) return;
    const oldest = this.committedAnnotationIds.values().next().value;
    if (oldest) this.committedAnnotationIds.delete(oldest);
  }

  private rememberAnnotationAffinity(
    annotationId: string,
    runtime: BrowserAnnotationRuntime,
    liveUrl: string,
  ): void {
    this.affinityByAnnotationId.delete(annotationId);
    this.affinityByAnnotationId.set(annotationId, {
      threadId: runtime.projectId === undefined ? this.threadProvenance(runtime) : null,
      projectId: runtime.projectId ?? null,
      tabId: runtime.tabId,
      liveUrl,
    });
    if (this.affinityByAnnotationId.size <= 1_024) return;
    const oldest = this.affinityByAnnotationId.keys().next().value;
    if (oldest) this.affinityByAnnotationId.delete(oldest);
  }

  /** Key under which one runtime's documents/sessions/projections live. */
  private ownerRuntimeKey(runtime: BrowserAnnotationRuntime): string {
    return runtime.projectId === undefined
      ? runtimeKey(this.threadProvenance(runtime), runtime.tabId)
      : browserAnnotationOwnerKey({ kind: "project", projectId: runtime.projectId }, runtime.tabId);
  }

  /**
   * Legacy-surface provenance: the real ThreadId of a Thread-owned runtime.
   * Every caller has already branched on `projectId === undefined`; this only
   * narrows the optional field for the type system. A Project-owned runtime
   * never reaches the Thread-keyed surface.
   */
  private threadProvenance(runtime: BrowserAnnotationRuntime): ThreadId {
    if (runtime.threadId === undefined) {
      throw new Error("A project-owned runtime cannot use the thread annotation surface.");
    }
    return runtime.threadId;
  }

  private emitDocumentChanged(
    runtime: BrowserAnnotationRuntime,
    document: BrowserAnnotationDocument,
    source: BrowserAnnotationSource,
  ): void {
    if (runtime.projectId !== undefined) {
      this.emitProject({
        kind: "document-changed",
        sessionId: null,
        projectId: runtime.projectId,
        tabId: runtime.tabId,
        document,
        source,
      });
      return;
    }
    this.emit({
      kind: "document-changed",
      sessionId: null,
      threadId: this.threadProvenance(runtime),
      tabId: runtime.tabId,
      document,
      source,
    });
  }

  private emitMarkersSynced(
    runtime: BrowserAnnotationRuntime,
    documentState: ReadyDocument,
    projection: MarkerProjection,
    projectedMarkerIds: ReadonlyArray<string>,
  ): void {
    if (runtime.projectId !== undefined) {
      this.emitProject({
        kind: "markers-synced",
        sessionId: null,
        projectId: runtime.projectId,
        tabId: runtime.tabId,
        document: documentState.document,
        source: documentState.source,
        version: projection.version,
        projectedMarkerIds: [...projectedMarkerIds],
      });
      return;
    }
    this.emit({
      kind: "markers-synced",
      sessionId: null,
      threadId: this.threadProvenance(runtime),
      tabId: runtime.tabId,
      document: documentState.document,
      source: documentState.source,
      version: projection.version,
      projectedMarkerIds: [...projectedMarkerIds],
    });
  }

  private emitCommitted(
    runtime: BrowserAnnotationRuntime,
    session: ActiveSession,
    annotation: BrowserAnnotation,
  ): void {
    if (runtime.projectId !== undefined) {
      this.emitProject({
        kind: "committed",
        sessionId: session.sessionId,
        projectId: runtime.projectId,
        tabId: runtime.tabId,
        document: session.document,
        source: annotation.source,
        annotation,
      });
      return;
    }
    this.emit({
      kind: "committed",
      sessionId: session.sessionId,
      threadId: this.threadProvenance(runtime),
      tabId: runtime.tabId,
      document: session.document,
      source: annotation.source,
      annotation,
    });
  }

  private toPublicProjectSession(session: ActiveSession): BrowserAnnotationProjectSession {
    if (session.runtime.projectId === undefined) {
      throw new Error("The annotation session does not belong to a project workspace.");
    }
    return {
      sessionId: session.sessionId,
      projectId: session.runtime.projectId,
      tabId: session.runtime.tabId,
      document: session.document,
      source: session.source,
    };
  }

  private emitProject(event: BrowserAnnotationProjectEvent): void {
    // Same snapshot-spread delivery contract as emit(): a listener may
    // unsubscribe mid-dispatch and the delivery set must stay stable.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...this.projectListeners]) {
      try {
        listener(event);
      } catch {
        // A renderer listener must never disrupt guest/runtime cleanup.
      }
    }
  }

  private emit(event: BrowserAnnotationEvent): void {
    // Listeners may unsubscribe during dispatch; iterating over a snapshot
    // keeps the delivery set stable (a live Set iterator skips entries).
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A renderer listener must never disrupt guest/runtime cleanup.
      }
    }
  }
}
