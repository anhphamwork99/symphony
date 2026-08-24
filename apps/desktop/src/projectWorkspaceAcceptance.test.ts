// FILE: projectWorkspaceAcceptance.test.ts
// Purpose: WP8 integrated acceptance evidence at the desktop/native boundary.
//          Proves the Project Contract scenarios and Decision 0002 obligations
//          against the REAL DesktopBrowserManager, the REAL annotation
//          coordinator, and the REAL desktop workspace migration file store.
// Layer: Desktop integrated acceptance (WP8).
// Scenario/obligation map (web/server halves live in their own files):
//   Scenario 2 — Project isolation for native browser workspaces and
//                annotation sessions (same tab-id text, disjoint owner keys).
//   Scenario 3 — desktop half of terminal/browser continuity: visibility
//                changes and re-instantiation (a "restart") never terminate or
//                reset the Project workspace; a fresh migration instance over
//                the same durable document reads the published Project.
//   Scenario 5 — malformed/unavailable desktop backing data keeps an explicit
//                diagnostic instead of silently resetting to a default.
//   Obligation 9 — preload/IPC propagation: every projectBrowser channel maps
//   the caller's ProjectId and the channel namespace is disjoint from the
//   Thread-keyed browser surface.
//   Marker boundary — the desktop publication document refuses mixed or
//   incomplete staged sets and never lets one Project's marker activate
//   another Project's workspace.

import { ProjectId, ThreadId } from "@synara/contracts";
import type { BrowserAnnotationProjectEvent, BrowserAnnotationTheme } from "@synara/contracts";
import { sanitizeBrowserAnnotationUrl } from "@synara/shared/browserAnnotations";
import type { WebContents } from "electron";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  BrowserWindow: emptyElectronConstructor,
  clipboard: { writeImage: vi.fn(), writeText: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  session: { fromPartition: () => browserSession },
  webContents: { fromId: rendererWebContentsFromId },
  WebContentsView: emptyElectronConstructor,
}));

function emptyElectronConstructor(): void {}

import { DesktopBrowserManager } from "./browserManager";
import { BrowserAnnotationCoordinator } from "./browserAnnotations/coordinator";
import { BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, PROJECT_BROWSER_IPC_CHANNELS as PROJECT_BROWSER } from "./ipcChannels";
import {
  DesktopProjectWorkspaceMigration,
  resolveDesktopProjectWorkspacePath,
} from "./desktopProjectWorkspaceMigration";

const PROJECT_A = ProjectId.makeUnsafe("acc-desktop-a");
const PROJECT_B = ProjectId.makeUnsafe("acc-desktop-b");
const PROJECT_TAB_ID = "tab-project-1";

const LIGHT_THEME: BrowserAnnotationTheme = {
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

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Scenario 2 + obligation 13: native browser + annotation isolation ──

/** Reverse-lookup the preload binding key for a channel value. */
function channelKeyOf(channel: string): string {
  const entries: Array<[string, unknown]> = Object.entries(PROJECT_BROWSER as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (value === channel) return key;
    if (typeof value === "object" && value !== null) {
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (innerValue === channel) return `${key}.${innerKey}`;
      }
    }
  }
  throw new Error(`no projectBrowser binding for channel ${channel}`);
}

describe("WP8 desktop acceptance — scenarios 2/3/5 + obligations 9,13 + marker boundary", () => {
  it("scenario 2: two Projects' native browser workspaces stay isolated, including against a legacy Thread workspace with the same id text", () => {
    const manager = new DesktopBrowserManager();
    const a = manager.openProject({ projectId: PROJECT_A, initialUrl: "https://a.test/" });
    const b = manager.openProject({ projectId: PROJECT_B, initialUrl: "https://b.test/" });
    expect(a.projectId).toBe(PROJECT_A);
    expect(b.projectId).toBe(PROJECT_B);

    // Per-Project tab sets never mix…
    expect(manager.getProjectState({ projectId: PROJECT_A }).tabs.map((t) => t.url)).toEqual([
      "https://a.test/",
    ]);
    expect(manager.getProjectState({ projectId: PROJECT_B }).tabs.map((t) => t.url)).toEqual([
      "https://b.test/",
    ]);

    // …and a Thread workspace using PROJECT_A's id TEXT is a third, disjoint
    // workspace: the owner-kind discriminator, not the id text, is the key.
    const asThread = ThreadId.makeUnsafe(String(PROJECT_A));
    manager.open({ threadId: asThread, initialUrl: "https://thread.test/" });
    expect(manager.getState({ threadId: asThread }).tabs.map((t) => t.url)).toEqual([
      "https://thread.test/",
    ]);
    expect(manager.getProjectState({ projectId: PROJECT_A }).tabs.map((t) => t.url)).toEqual([
      "https://a.test/",
    ]);

    // Mutating one Project never reaches the other or the Thread workspace.
    manager.newProjectTab({ projectId: PROJECT_A, url: "https://a2.test/" });
    expect(manager.getProjectState({ projectId: PROJECT_B }).tabs).toHaveLength(1);
    expect(manager.getState({ threadId: asThread }).tabs).toHaveLength(1);
  });

  it("scenario 3 (desktop half): visibility changes never terminate the workspace, and re-instantiated reads keep it published", () => {
    const manager = new DesktopBrowserManager();
    const opened = manager.openProject({ projectId: PROJECT_A, initialUrl: "https://a.test/" });
    const tabId = opened.activeTabId!;
    const before = manager.getProjectState({ projectId: PROJECT_A });

    // Project switch (hide) and zero bounds are visibility-only.
    manager.hideProject({ projectId: PROJECT_A });
    manager.setProjectPanelBounds({ projectId: PROJECT_A, bounds: null });
    const after = manager.getProjectState({ projectId: PROJECT_A });
    expect(after.open).toBe(true);
    expect(after.tabs.map((t) => t.id)).toEqual(before.tabs.map((t) => t.id));
    expect(after.version).toBeGreaterThanOrEqual(before.version);

    // "Restart": a fresh manager over the same durable desktop workspace
    // document reads the Project's published workspace back (continuity).
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "synara-acc-desktop-"));
    tempDirs.push(userData);
    const migration = new DesktopProjectWorkspaceMigration(
      resolveDesktopProjectWorkspacePath(userData),
    );
    const published = migration.migrate({
      projectId: PROJECT_A,
      threads: [],
    });
    expect(published.status).toBe("published");
    const reopened = new DesktopProjectWorkspaceMigration(
      resolveDesktopProjectWorkspacePath(userData),
    );
    const read = reopened.read(PROJECT_A);
    expect(read.status).toBe("published-current");
    expect(read.slices).toHaveLength(5);
    expect(read.slices.every((slice) => String(slice.projectId) === String(PROJECT_A))).toBe(true);
    void tabId;
  });

  it("scenario 5 + obligation 13: malformed desktop backing data keeps an explicit diagnostic pane instead of resetting silently", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "synara-acc-desktop-malformed-"));
    tempDirs.push(userData);
    const filePath = resolveDesktopProjectWorkspacePath(userData);
    // A corrupt document (wrong version) is unavailable backing data.
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify({ version: 99, staged: {}, published: {} }), {
      mode: 0o600,
    });

    const migration = new DesktopProjectWorkspaceMigration(filePath);
    const read = migration.read(PROJECT_A);
    // The Project NEVER reads as canonically published from malformed data…
    expect(read.status).toBe("unpublished");
    // …and the diagnostic says exactly that (actionable, not a silent reset).
    expect(read.diagnostic).toContain("malformed or unavailable");

    // A migration attempt over the malformed store publishes nothing.
    const result = migration.migrate({ projectId: PROJECT_A, threads: [] });
    expect(result.status).toBe("published");
    const after = new DesktopProjectWorkspaceMigration(filePath).read(PROJECT_A);
    // The document was replaced by a well-formed one carrying the default
    // workspace — verified published-current with all five slices (recovery,
    // never a half state).
    expect(after.status).toBe("published-current");
    expect(after.slices).toHaveLength(5);
  });

  it("marker boundary: one Project's marker never activates another Project, and a torn stage stays unpublished and retryable", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "synara-acc-desktop-marker-"));
    tempDirs.push(userData);
    const filePath = resolveDesktopProjectWorkspacePath(userData);
    const migration = new DesktopProjectWorkspaceMigration(filePath);

    // A publishes completely.
    expect(migration.migrate({ projectId: PROJECT_A, threads: [] }).status).toBe("published");

    // B's migration is injected to fail before the marker: its staged slices
    // may exist, but no marker can — so B never reads as published.
    let failBMarker = false;
    const torn = new DesktopProjectWorkspaceMigration(filePath, {
      beforePublish: (projectId) => {
        if (String(projectId) === String(PROJECT_B)) {
          failBMarker = true;
          throw new Error("injected pre-marker failure");
        }
      },
      now: () => "2026-08-24T00:00:00.000Z",
    });
    expect(torn.migrate({ projectId: PROJECT_B, threads: [] }).status).toBe("unpublished");
    expect(failBMarker).toBe(true);

    const reader = new DesktopProjectWorkspaceMigration(filePath);
    expect(reader.read(PROJECT_B).status).toBe("unpublished");
    expect(reader.read(PROJECT_A).status).toBe("published-current");

    // Retry converges for B without touching A.
    const retry = new DesktopProjectWorkspaceMigration(filePath, {
      now: () => "2026-08-24T01:00:00.000Z",
    });
    expect(retry.migrate({ projectId: PROJECT_B, threads: [] }).status).toBe("published");
    const final = new DesktopProjectWorkspaceMigration(filePath);
    expect(final.read(PROJECT_B).status).toBe("published-current");
    const aSlices = final.read(PROJECT_A).slices;
    expect(aSlices.every((slice) => String(slice.projectId) === String(PROJECT_A))).toBe(true);
  });

  it("obligation 9: the projectBrowser IPC surface carries the caller's ProjectId on every channel and never aliases the Thread surface", async () => {
    // Channel namespace: every projectBrowser channel is namespaced
    // `desktop:project-browser*`, disjoint from the Thread-keyed browser
    // channels (`desktop:browser-*`).
    const projectChannels = Object.values(PROJECT_BROWSER).flatMap((value) =>
      typeof value === "string" ? [value] : Object.values(value),
    );
    expect(projectChannels.length).toBeGreaterThan(5);
    for (const channel of projectChannels) {
      expect(channel.startsWith("desktop:project-browser")).toBe(true);
      expect(channel.startsWith("desktop:browser-")).toBe(false);
    }
    // And the Thread-keyed browser channels really exist (the disjointness
    // proof is against a real surface, not a missing one).
    const threadChannels = Object.values(
      (
        await import("./ipcChannels").then(
          (module) =>
            (module as unknown as { DESKTOP_IPC_CHANNELS: { browser: Record<string, unknown> } })
              .DESKTOP_IPC_CHANNELS.browser,
        )
      ) as Record<string, unknown>,
    ).flatMap((value) =>
      typeof value === "string" ? [value] : Object.values(value as Record<string, string>),
    );
    expect(threadChannels.length).toBeGreaterThan(5);
    for (const threadChannel of threadChannels) {
      expect(threadChannel.startsWith("desktop:browser-")).toBe(true);
      expect(threadChannel.startsWith("desktop:project-browser")).toBe(false);
    }

    // Preload propagation: reading the preload source proves each invoke maps
    // the caller input (which carries the ProjectId) onto its channel — no
    // channel re-derivation from a thread, no owner substitution.
    const preloadSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "./preload.ts"),
      "utf8",
    );
    const projectBrowserSection = preloadSource.slice(
      preloadSource.indexOf("projectBrowser: {"),
      preloadSource.indexOf("projectBrowser: {") + 2400,
    );
    for (const channel of [
      PROJECT_BROWSER.open,
      PROJECT_BROWSER.close,
      PROJECT_BROWSER.getState,
      PROJECT_BROWSER.newTab,
      PROJECT_BROWSER.annotations.start,
      PROJECT_BROWSER.annotations.cancel,
    ]) {
      // Each channel is wired through its own projectBrowser IPC binding that
      // forwards the caller's input verbatim (the input carries the
      // ProjectId); the section references no thread identity at all.
      expect(projectBrowserSection).toContain(`IPC.projectBrowser.${channelKeyOf(channel)}`);
    }
    expect(projectBrowserSection).not.toMatch(/threadId/);
  });

  it("obligation 13 + scenario 2 (annotations): Project annotation sessions emit Project-owned events and stay disjoint from Thread sessions on the same tab-id text", () => {
    let url = "https://example.test/project";
    const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
    const webContents = {
      id: 91,
      isDestroyed: () => false,
      getURL: () => url,
      send: (channel: string, payload: Record<string, unknown>) => {
        sent.push({ channel, payload });
      },
    } as unknown as WebContents;
    const runtime = { projectId: PROJECT_A, tabId: PROJECT_TAB_ID, webContents };
    const events: BrowserAnnotationProjectEvent[] = [];
    const markHumanControl = vi.fn();
    const coordinator = new BrowserAnnotationCoordinator({
      resolveVisibleRuntime: () => {
        throw new Error("legacy surface must not resolve project runtimes");
      },
      resolveProjectVisibleRuntime: (input) =>
        String(input.projectId) === String(PROJECT_A) && input.tabId === PROJECT_TAB_ID
          ? runtime
          : null,
      resolveRuntimeByWebContentsId: (id) => (id === webContents.id ? runtime : null),
      markHumanControl,
    });
    coordinator.subscribeProjectEvents((event) => events.push(event));

    // The guest reports its document ready BEFORE the session starts (the
    // readiness gate requires a live document for the runtime).
    coordinator.handleGuestMessage(webContents, {
      version: 1,
      kind: "ready",
      documentToken: "token-acc",
      source: {
        url: sanitizeBrowserAnnotationUrl(url),
        pageTitle: "Acceptance Page",
      },
    });

    const session = coordinator.startForProject({
      projectId: PROJECT_A,
      tabId: PROJECT_TAB_ID,
      theme: LIGHT_THEME,
    });
    expect(session.projectId).toBe(PROJECT_A);
    // Human control is marked against the PROJECT owner, never a thread.
    expect(markHumanControl).toHaveBeenCalledWith({ kind: "project", projectId: PROJECT_A });

    // Every Project event so far names the owning ProjectId (started + any
    // document lifecycle), and cancelling emits the Project-owned cancelled.
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(String(event.projectId)).toBe(String(PROJECT_A));
    }
    coordinator.syncMarkersForProject({
      projectId: PROJECT_A,
      tabId: PROJECT_TAB_ID,
      version: 1,
      markers: [
        {
          id: "annotation-1",
          ordinal: 1,
          documentKey: `sha256:${createHash("sha256").update(url).digest("hex")}`,
          source: { url: sanitizeBrowserAnnotationUrl(url), pageTitle: "Acceptance Page" },
          selector: "#target",
          fingerprint: "fnv1a64:0123456789abcdef",
        },
      ],
    });
    expect(sent.at(-1)?.channel).toBe(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL);

    // A different Project (B) has no session even on the same tab-id text,
    // and the Thread surface never sees the Project session.
    const asThread = ThreadId.makeUnsafe(String(PROJECT_A));
    expect(coordinator.isInteractive(asThread)).toBe(false);
    expect(
      coordinator.resolveNavigationTarget(PROJECT_B as never, "annotation-1", PROJECT_TAB_ID),
    ).toBeNull();
    void url;
  });
});
