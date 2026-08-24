import { createHash } from "node:crypto";

import {
  ProjectId,
  ThreadId,
  type BrowserAnnotationEvent,
  type BrowserAnnotationProjectEvent,
  type BrowserAnnotationTheme,
} from "@synara/contracts";
import { sanitizeBrowserAnnotationUrl } from "@synara/shared/browserAnnotations";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import { BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL } from "../ipcChannels";
import { BrowserAnnotationCoordinator } from "./coordinator";

const THREAD_ID = ThreadId.makeUnsafe("thread-annotations");
const TAB_ID = "tab-1";
const FINGERPRINT = "fnv1a64:0123456789abcdef";
const LIGHT_ANNOTATION_THEME: BrowserAnnotationTheme = {
  mode: "light",
  accent: "rgb(82, 111, 255)",
  surface: "rgb(255, 255, 255)",
  text: "rgb(23, 23, 23)",
  mutedText: "rgb(113, 113, 122)",
  border: "rgb(212, 212, 216)",
  focusBorder: "rgb(82, 111, 255)",
  primary: "rgb(23, 23, 23)",
  primaryText: "rgb(255, 255, 255)",
};
const DARK_ANNOTATION_THEME: BrowserAnnotationTheme = {
  mode: "dark",
  accent: "rgb(96, 115, 204)",
  surface: "rgb(27, 27, 29)",
  text: "rgb(250, 250, 250)",
  mutedText: "rgb(161, 161, 170)",
  border: "rgb(63, 63, 70)",
  focusBorder: "rgb(96, 115, 204)",
  primary: "rgb(250, 250, 250)",
  primaryText: "rgb(24, 24, 27)",
};

function documentKey(url: string): string {
  return `sha256:${createHash("sha256").update(url).digest("hex")}`;
}

function createHarness(initialUrl = "https://example.test/app") {
  let url = initialUrl;
  const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
  const webContents = {
    id: 42,
    isDestroyed: () => false,
    getURL: () => url,
    send: (channel: string, payload: Record<string, unknown>) => {
      sent.push({ channel, payload });
    },
  } as unknown as WebContents;
  const runtime = { threadId: THREAD_ID, tabId: TAB_ID, webContents };
  const events: BrowserAnnotationEvent[] = [];
  const markHumanControl = vi.fn();
  const coordinator = new BrowserAnnotationCoordinator({
    resolveVisibleRuntime: () => runtime,
    resolveRuntimeByWebContentsId: (id) => (id === webContents.id ? runtime : null),
    markHumanControl,
  });
  coordinator.subscribe((event) => events.push(event));
  const ready = (documentToken: string, pageTitle = "Page") =>
    coordinator.handleGuestMessage(webContents, {
      version: 1,
      kind: "ready",
      documentToken,
      source: { url: sanitizeBrowserAnnotationUrl(url), pageTitle },
    });
  return {
    coordinator,
    events,
    markHumanControl,
    ready,
    sent,
    setUrl(nextUrl: string) {
      url = nextUrl;
    },
    webContents,
  };
}

function marker(url = "https://example.test/app", liveUrl = url) {
  return {
    id: "annotation-1",
    ordinal: 1,
    documentKey: documentKey(liveUrl),
    source: { url, pageTitle: "Page" },
    selector: "#target",
    fingerprint: FINGERPRINT,
  };
}

describe("BrowserAnnotationCoordinator", () => {
  it("takes human control once and accepts consecutive commits until cancellation", () => {
    const harness = createHarness();
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 1,
      markers: [marker()],
    });
    expect(harness.sent).toHaveLength(0);

    harness.ready("document-a");
    expect(harness.sent.at(-1)).toMatchObject({
      channel: BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL,
      payload: { kind: "sync-markers", projectionVersion: 1 },
    });
    const session = harness.coordinator.start({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      theme: DARK_ANNOTATION_THEME,
    });
    expect(harness.markHumanControl).toHaveBeenCalledOnce();

    harness.coordinator.handleGuestMessage(harness.webContents, {
      version: 1,
      kind: "committed",
      documentToken: "document-a",
      sessionId: session.sessionId,
      annotation: {
        id: "annotation-1",
        source: { url: "https://example.test/app", pageTitle: "SPA title changed" },
        selector: "#target",
        tagName: "BUTTON",
        role: "button",
        name: "Save",
        text: "Save",
        fingerprint: FINGERPRINT,
        comment: null,
        capturedAt: "2026-07-23T10:00:00.000Z",
      },
    });
    expect(harness.events.at(-1)).toMatchObject({
      kind: "committed",
      source: { pageTitle: "SPA title changed" },
    });
    expect(harness.coordinator.isInteractive(THREAD_ID)).toBe(true);

    harness.coordinator.handleGuestMessage(harness.webContents, {
      version: 1,
      kind: "committed",
      documentToken: "document-a",
      sessionId: session.sessionId,
      annotation: {
        id: "annotation-2",
        source: { url: "https://example.test/app", pageTitle: "Page" },
        selector: "#secondary",
        tagName: "BUTTON",
        role: "button",
        name: "Cancel",
        text: "Cancel",
        fingerprint: FINGERPRINT,
        comment: "Remove this",
        capturedAt: "2026-07-23T10:01:00.000Z",
      },
    });
    expect(harness.events.filter((event) => event.kind === "committed")).toHaveLength(2);
    expect(harness.coordinator.isInteractive(THREAD_ID)).toBe(true);

    harness.setUrl("https://example.test/next");
    harness.coordinator.handleNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    expect(harness.coordinator.isInteractive(THREAD_ID)).toBe(false);
    harness.ready("document-b", "Page B");
    expect(harness.sent.at(-1)).toMatchObject({
      payload: { kind: "sync-markers", projectionVersion: 1 },
    });
  });

  it("cancel closes only the picker and leaves inert marker projection available", () => {
    const harness = createHarness();
    harness.ready("document-a");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 2,
      markers: [marker()],
    });
    harness.coordinator.start({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });
    harness.coordinator.cancel({ threadId: THREAD_ID, tabId: TAB_ID });

    harness.setUrl("https://example.test/next");
    harness.coordinator.handleNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    harness.ready("document-b");
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 2,
    });
  });

  it("refreshes strict document/source affinity across SPA navigation and back", () => {
    const harness = createHarness();
    harness.ready("same-document");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 3,
      markers: [marker()],
    });
    harness.coordinator.start({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });

    harness.setUrl("https://example.test/next");
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    expect(harness.sent.at(-2)?.payload).toMatchObject({
      kind: "cancel",
      documentToken: "same-document",
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "refresh-document",
      documentToken: "same-document",
    });
    harness.ready("same-document", "Page B");
    expect(harness.events.some((event) => event.kind === "cancelled")).toBe(true);
    expect(harness.events.at(-1)).toMatchObject({
      kind: "document-changed",
      document: { url: "https://example.test/next" },
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 3,
    });

    harness.setUrl("https://example.test/app");
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    harness.ready("same-document", "Page A");
    expect(
      harness.events
        .filter((event) => event.kind === "document-changed")
        .map((event) => event.source.url),
    ).toEqual([
      "https://example.test/app",
      "https://example.test/next",
      "https://example.test/app",
    ]);
  });

  it("preserves marker projection across fragment-only in-page navigation", () => {
    const harness = createHarness();
    harness.ready("same-document");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 4,
      markers: [marker()],
    });
    harness.coordinator.start({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });

    harness.setUrl("https://example.test/app#details");
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "refresh-document",
      documentToken: "same-document",
    });
    harness.ready("same-document", "Hash target");
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 4,
      markers: [{ id: "annotation-1" }],
    });
    expect(harness.events.at(-1)).toMatchObject({
      kind: "document-changed",
      document: { key: documentKey("https://example.test/app") },
    });
  });

  it("accepts persisted full-href document keys on an initial fragmented URL", () => {
    const liveUrl = "https://example.test/app#details";
    const harness = createHarness(liveUrl);
    harness.ready("document-with-fragment");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 5,
      markers: [marker("https://example.test/app", liveUrl)],
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 5,
      markers: [{ id: "annotation-1" }],
    });
  });

  it("accepts hashless markers when an initially fragmented URL clears its fragment", () => {
    const harness = createHarness("https://example.test/app#details");
    harness.ready("document-with-fragment");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 6,
      markers: [marker()],
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 6,
      markers: [{ id: "annotation-1" }],
    });

    harness.setUrl("https://example.test/app");
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    harness.ready("document-with-fragment", "Fragment cleared");
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 6,
      markers: [{ id: "annotation-1" }],
    });
  });

  it("keeps private query identities isolated when the public source is unchanged", () => {
    const firstLiveUrl = "https://example.test/app?token=first";
    const harness = createHarness(firstLiveUrl);
    harness.ready("same-document");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 7,
      markers: [marker("https://example.test/app", firstLiveUrl)],
    });

    harness.setUrl("https://example.test/app?token=second");
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    harness.ready("same-document", "Another private page");
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      projectionVersion: 7,
      markers: [],
    });
  });

  it("recovers readiness when a top-level navigation aborts on the old document", () => {
    const harness = createHarness();
    harness.ready("document-a");
    harness.coordinator.start({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });
    harness.coordinator.handleNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "cancel",
      documentToken: "document-a",
    });
    expect(harness.coordinator.isInteractive(THREAD_ID)).toBe(false);
    expect(() =>
      harness.coordinator.start({
        threadId: THREAD_ID,
        tabId: TAB_ID,
        theme: LIGHT_ANNOTATION_THEME,
      }),
    ).toThrow(/not ready/i);

    harness.coordinator.recoverNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "refresh-document",
      documentToken: "document-a",
    });
    harness.ready("document-a");
    expect(() =>
      harness.coordinator.start({
        threadId: THREAD_ID,
        tabId: TAB_ID,
        theme: LIGHT_ANNOTATION_THEME,
      }),
    ).not.toThrow();
  });

  it("stores and sends the canonical bounded marker projection", () => {
    const harness = createHarness();
    harness.ready("document-a");
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 4,
      markers: [
        {
          ...marker(),
          id: " annotation-1 ",
          selector: " #target ",
          source: { url: " https://example.test/app ", pageTitle: " Page " },
        },
      ],
    });

    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      markers: [
        {
          id: "annotation-1",
          selector: "#target",
          source: { url: "https://example.test/app", pageTitle: "Page" },
        },
      ],
    });
  });

  it("persists only a safe URL while restoring exact affinity for a stable logical tab", () => {
    const firstLiveUrl = "https://alice:secret@example.test/docs?token=first-secret#first";
    const secondLiveUrl = "https://example.test/docs?token=second-secret#second";
    const safeUrl = "https://example.test/docs";
    const harness = createHarness(firstLiveUrl);
    harness.ready("same-document", "Private page");

    const session = harness.coordinator.start({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });
    expect(session).toMatchObject({
      document: { url: safeUrl },
      source: { url: safeUrl },
    });
    expect(JSON.stringify(harness.events)).not.toContain("first-secret");
    expect(JSON.stringify(harness.events)).not.toContain("alice");

    harness.coordinator.handleGuestMessage(harness.webContents, {
      version: 1,
      kind: "committed",
      documentToken: "same-document",
      sessionId: session.sessionId,
      annotation: {
        id: "annotation-private",
        source: { url: safeUrl, pageTitle: "Private page" },
        selector: "#target",
        tagName: "BUTTON",
        role: "button",
        name: "Save",
        text: "Save",
        fingerprint: FINGERPRINT,
        comment: null,
        capturedAt: "2026-07-23T10:00:00.000Z",
      },
    });
    expect(
      harness.coordinator.resolveNavigationTarget(THREAD_ID, "annotation-private", TAB_ID),
    ).toEqual({ tabId: TAB_ID, liveUrl: firstLiveUrl });
    expect(
      harness.coordinator.resolveNavigationTarget(
        ThreadId.makeUnsafe("thread-other"),
        "annotation-private",
        TAB_ID,
      ),
    ).toBeNull();
    expect(
      harness.coordinator.resolveNavigationTarget(THREAD_ID, "annotation-private", "tab-other"),
    ).toBeNull();
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 1,
      markers: [{ ...marker(safeUrl, firstLiveUrl), id: "annotation-private" }],
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      markers: [{ id: "annotation-private" }],
    });

    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 2,
      markers: [],
    });
    harness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 3,
      markers: [{ ...marker(safeUrl, firstLiveUrl), id: "annotation-private" }],
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      markers: [{ id: "annotation-private" }],
    });

    harness.setUrl(secondLiveUrl);
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    harness.ready("same-document", "Other private page");
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      markers: [],
    });

    harness.setUrl(firstLiveUrl);
    harness.coordinator.handleInPageNavigation(THREAD_ID, TAB_ID, harness.webContents.id);
    harness.ready("same-document", "Private page");
    expect(harness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      markers: [{ id: "annotation-private" }],
    });

    const restartedHarness = createHarness(firstLiveUrl);
    restartedHarness.ready("new-document", "Private page");
    restartedHarness.coordinator.syncMarkers({
      threadId: THREAD_ID,
      tabId: TAB_ID,
      version: 1,
      markers: [{ ...marker(safeUrl, firstLiveUrl), id: "annotation-private" }],
    });
    expect(restartedHarness.sent.at(-1)?.payload).toMatchObject({
      kind: "sync-markers",
      markers: [{ id: "annotation-private" }],
    });
    expect(
      restartedHarness.coordinator.resolveNavigationTarget(THREAD_ID, "annotation-private", TAB_ID),
    ).toEqual({ tabId: TAB_ID, liveUrl: firstLiveUrl });
  });
});

// ── Project-owned annotation surface (Decision 0002, WP7 stage 2A) ────

const PROJECT_ID = ProjectId.makeUnsafe("project-annotations");
const OTHER_PROJECT_ID = ProjectId.makeUnsafe("project-other");
const PROJECT_TAB_ID = "project-tab-1";

function createProjectHarness(initialUrl = "https://example.test/project") {
  let url = initialUrl;
  const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
  const webContents = {
    id: 77,
    isDestroyed: () => false,
    getURL: () => url,
    send: (channel: string, payload: Record<string, unknown>) => {
      sent.push({ channel, payload });
    },
  } as unknown as WebContents;
  const runtime = { projectId: PROJECT_ID, tabId: PROJECT_TAB_ID, webContents };
  const events: BrowserAnnotationProjectEvent[] = [];
  const markHumanControl = vi.fn();
  const coordinator = new BrowserAnnotationCoordinator({
    resolveVisibleRuntime: () => {
      throw new Error("legacy surface must not resolve project runtimes");
    },
    resolveProjectVisibleRuntime: (input) =>
      input.projectId === PROJECT_ID && input.tabId === PROJECT_TAB_ID ? runtime : null,
    resolveRuntimeByWebContentsId: (id) => (id === webContents.id ? runtime : null),
    markHumanControl,
  });
  coordinator.subscribeProjectEvents((event) => events.push(event));
  const ready = (documentToken: string, pageTitle = "Project Page") =>
    coordinator.handleGuestMessage(webContents, {
      version: 1,
      kind: "ready",
      documentToken,
      source: { url: sanitizeBrowserAnnotationUrl(url), pageTitle },
    });
  return {
    coordinator,
    events,
    markHumanControl,
    ready,
    sent,
    setUrl(nextUrl: string) {
      url = nextUrl;
    },
    webContents,
  };
}

describe("BrowserAnnotationCoordinator Project-owned sessions", () => {
  it("starts and cancels a Project session and emits Project events", () => {
    const harness = createProjectHarness();
    harness.ready("token-1");

    const session = harness.coordinator.startForProject({
      projectId: PROJECT_ID,
      tabId: PROJECT_TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });

    expect(session.projectId).toBe(PROJECT_ID);
    expect(session.tabId).toBe(PROJECT_TAB_ID);
    expect(harness.markHumanControl).toHaveBeenCalledWith({
      kind: "project",
      projectId: PROJECT_ID,
    });
    expect(harness.events.at(-1)).toMatchObject({
      kind: "started",
      projectId: PROJECT_ID,
      tabId: PROJECT_TAB_ID,
    });
    // The guest command channel is unchanged: the guest never learns about owners.
    expect(harness.sent.at(-1)?.channel).toBe(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL);

    harness.coordinator.cancelForProject({ projectId: PROJECT_ID, tabId: PROJECT_TAB_ID });
    expect(harness.events.at(-1)).toMatchObject({
      kind: "cancelled",
      projectId: PROJECT_ID,
      reason: "user",
    });
  });

  it("isolates a Project session from a Thread session on the same tab id text", () => {
    const harness = createProjectHarness();
    harness.ready("token-project");

    const threadEvents: BrowserAnnotationEvent[] = [];
    harness.coordinator.subscribe((event) => threadEvents.push(event));

    harness.coordinator.startForProject({
      projectId: PROJECT_ID,
      tabId: PROJECT_TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });

    // The Thread-keyed surface (same tab id text) has no session, projection,
    // or document: keys are disjoint (t: vs p:) and never alias.
    expect(harness.coordinator.isInteractive(THREAD_ID)).toBe(false);
    expect(
      harness.coordinator.resolveNavigationTarget(THREAD_ID, "annotation-1", PROJECT_TAB_ID),
    ).toBeNull();
    expect(threadEvents).toHaveLength(0);
  });

  it("routes marker projections and committed annotations through Project events", () => {
    const harness = createProjectHarness();
    harness.ready("token-2");
    harness.coordinator.startForProject({
      projectId: PROJECT_ID,
      tabId: PROJECT_TAB_ID,
      theme: DARK_ANNOTATION_THEME,
    });

    harness.coordinator.syncMarkersForProject({
      projectId: PROJECT_ID,
      tabId: PROJECT_TAB_ID,
      version: 1,
      markers: [marker("https://example.test/project")],
    });
    expect(harness.sent.at(-1)?.payload).toMatchObject({ kind: "sync-markers" });

    harness.coordinator.handleGuestMessage(harness.webContents, {
      version: 1,
      kind: "markers-projected",
      documentToken: "token-2",
      projectionVersion: 1,
      projectedMarkerIds: ["annotation-1"],
    });
    expect(harness.events.at(-1)).toMatchObject({
      kind: "markers-synced",
      projectId: PROJECT_ID,
      projectedMarkerIds: ["annotation-1"],
    });

    const startedSession = harness.events.find((event) => event.kind === "started");
    harness.coordinator.handleGuestMessage(harness.webContents, {
      version: 1,
      kind: "committed",
      documentToken: "token-2",
      sessionId: startedSession?.kind === "started" ? startedSession.sessionId : "",
      annotation: {
        id: "annotation-1",
        source: {
          url: sanitizeBrowserAnnotationUrl("https://example.test/project"),
          pageTitle: "Project Page",
        },
        selector: "#target",
        tagName: "BUTTON",
        role: "button",
        name: "Save",
        text: "Save",
        fingerprint: FINGERPRINT,
        comment: null,
        capturedAt: new Date().toISOString(),
      },
    });
    const committed = harness.events.find((event) => event.kind === "committed");
    expect(committed).toMatchObject({ kind: "committed", projectId: PROJECT_ID });

    // The committed annotation's navigation affinity is Project-scoped.
    const target = harness.coordinator.resolveProjectAnnotationNavigationTarget({
      projectId: PROJECT_ID,
      annotationId: "annotation-1",
    });
    expect(target).toMatchObject({ tabId: PROJECT_TAB_ID });
    // A different Project cannot navigate to it.
    expect(
      harness.coordinator.resolveProjectAnnotationNavigationTarget({
        projectId: OTHER_PROJECT_ID,
        annotationId: "annotation-1",
      }),
    ).toBeNull();
  });

  it("finishes the session on navigation and recovers through the Project surface", () => {
    const harness = createProjectHarness("https://example.test/before");
    harness.ready("token-3");
    harness.coordinator.startForProject({
      projectId: PROJECT_ID,
      tabId: PROJECT_TAB_ID,
      theme: LIGHT_ANNOTATION_THEME,
    });

    harness.coordinator.handleOwnerNavigation(
      { kind: "project", projectId: PROJECT_ID },
      PROJECT_TAB_ID,
      harness.webContents.id,
    );
    expect(harness.events.at(-1)).toMatchObject({
      kind: "cancelled",
      reason: "navigation",
      projectId: PROJECT_ID,
    });

    harness.setUrl("https://example.test/after");
    harness.coordinator.recoverOwnerNavigation(
      { kind: "project", projectId: PROJECT_ID },
      PROJECT_TAB_ID,
      harness.webContents.id,
    );
    expect(harness.sent.at(-1)?.payload).toMatchObject({ kind: "refresh-document" });
  });

  it("rejects Project starts when the runtime is not visible in that Project", () => {
    const harness = createProjectHarness();
    harness.ready("token-4");
    expect(() =>
      harness.coordinator.startForProject({
        projectId: OTHER_PROJECT_ID,
        tabId: PROJECT_TAB_ID,
        theme: LIGHT_ANNOTATION_THEME,
      }),
    ).toThrow(/not available in this project/i);
  });
});
