import { BROWSER_TOOL_NAMES, ProjectId } from "@synara/contracts";
import type { DesktopBrowserManager as DesktopBrowserManagerType } from "./browserManager";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { browserSession } = vi.hoisted(() => ({
  browserSession: {
    setUserAgent: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn() },
    protocol: { handle: vi.fn(), unhandle: vi.fn() },
  },
}));

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
  webContents: { fromId: () => null },
  WebContentsView: emptyElectronConstructor,
}));

import { DesktopBrowserManager } from "./browserManager";
import {
  createActivationGatedAutomationHost,
  DesktopProjectWorkspaceActivation,
  ProjectWorkspaceActivationError,
} from "./desktopProjectWorkspaceActivation";
import {
  DesktopProjectWorkspaceMigration,
  resolveDesktopProjectWorkspacePath,
} from "./desktopProjectWorkspaceMigration";
import { registerBrowserIpcHandlers } from "./browserIpc";
import { PROJECT_BROWSER_IPC_CHANNELS } from "./ipcChannels";

function emptyElectronConstructor(): void {}

const PROJECT_A = ProjectId.makeUnsafe("activation-project-a");
const PROJECT_B = ProjectId.makeUnsafe("activation-project-b");
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createWorkspacePath(): string {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "synara-d0004-activation-"));
  tempDirectories.push(userDataPath);
  return resolveDesktopProjectWorkspacePath(userDataPath);
}

function publishDefaults(filePath: string, projectId: ProjectId): void {
  expect(new DesktopProjectWorkspaceMigration(filePath).migrate({ projectId, threads: [] })).toMatchObject({
    status: "published",
  });
}

function readDocument(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function writeDocument(filePath: string, document: Record<string, unknown>): void {
  fs.writeFileSync(filePath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
}

describe("Decision 0004 Desktop project workspace activation", () => {
  it("activates every durable startup Project ID, while an empty store does not invent a Project list", async () => {
    const filePath = createWorkspacePath();
    publishDefaults(filePath, PROJECT_B);
    const manager = new DesktopBrowserManager();
    const activation = new DesktopProjectWorkspaceActivation(filePath, manager);

    const outcome = await activation.activateKnownProjects();

    expect(outcome.diagnostic).toBeNull();
    expect(outcome.results.map((result) => String(result.projectId))).toEqual([String(PROJECT_B)]);
    expect(outcome.results[0]?.status).toBe("activated");
    expect(manager.isProjectWorkspaceActivated(PROJECT_B)).toBe(true);

    const emptyPath = createWorkspacePath();
    const emptyActivation = new DesktopProjectWorkspaceActivation(emptyPath, manager);
    expect(await emptyActivation.activateKnownProjects()).toEqual({
      results: [],
      diagnostic: null,
    });
  });

  it("lazily activates the first real ProjectId with canonical defaults and no Thread fallback", async () => {
    const manager = new DesktopBrowserManager();
    const activation = new DesktopProjectWorkspaceActivation(createWorkspacePath(), manager);

    await activation.ensureProjectWorkspaceActivated(PROJECT_A);

    expect(activation.isActivated(PROJECT_A)).toBe(true);
    expect(manager.getProjectState({ projectId: PROJECT_A })).toMatchObject({
      projectId: PROJECT_A,
      open: false,
      activeTabId: null,
      tabs: [],
    });
    expect(manager.getProjectState({ projectId: ProjectId.makeUnsafe("different-project") })).toMatchObject({
      tabs: [],
    });
  });

  it("shares one in-flight activation and never reapplies over later live Project mutations", async () => {
    const manager = new DesktopBrowserManager();
    const beforeApply = vi.fn();
    const activation = new DesktopProjectWorkspaceActivation(createWorkspacePath(), manager, {
      beforeApply,
    });

    await Promise.all([
      activation.ensureProjectWorkspaceActivated(PROJECT_A),
      activation.ensureProjectWorkspaceActivated(PROJECT_A),
    ]);
    expect(beforeApply).toHaveBeenCalledOnce();

    const changed = manager.newProjectTab({ projectId: PROJECT_A, url: "https://live.test/" });
    await activation.ensureProjectWorkspaceActivated(PROJECT_A);
    expect(beforeApply).toHaveBeenCalledOnce();
    expect(manager.getProjectState({ projectId: PROJECT_A }).tabs).toEqual(changed.tabs);
  });

  it("isolates Projects and lets a current published browser/annotation projection win", async () => {
    const filePath = createWorkspacePath();
    publishDefaults(filePath, PROJECT_A);
    const document = readDocument(filePath);
    const staged = document.staged as Record<string, unknown>;
    const browserKey = `synara:project-workspace:v2:stage:${PROJECT_A}:browser`;
    const annotationsKey = `synara:project-workspace:v2:stage:${PROJECT_A}:browser-annotations`;
    staged[browserKey] = {
      ...(staged[browserKey] as Record<string, unknown>),
      open: true,
      activeTabId: "durable-tab",
      tabs: [{ id: "durable-tab", url: "https://published.test/", title: "Published" }],
    };
    staged[annotationsKey] = {
      ...(staged[annotationsKey] as Record<string, unknown>),
      markers: [
        {
          id: "durable-marker",
          tabId: "durable-tab",
          ordinal: 1,
          documentKey: "sha256:published",
        },
      ],
    };
    writeDocument(filePath, document);

    const manager = new DesktopBrowserManager();
    const activation = new DesktopProjectWorkspaceActivation(filePath, manager);
    await activation.ensureProjectWorkspaceActivated(PROJECT_A);
    await activation.ensureProjectWorkspaceActivated(PROJECT_B);

    expect(manager.getProjectState({ projectId: PROJECT_A })).toMatchObject({
      open: true,
      activeTabId: "durable-tab",
      tabs: [{ id: "durable-tab", url: "https://published.test/", title: "Published" }],
    });
    const annotations = (manager as unknown as {
      annotations: {
        projectWorkspaceSeededMarkers: (input: {
          projectId: typeof PROJECT_A;
          tabId: string;
        }) => unknown;
      };
    }).annotations;
    expect(annotations.projectWorkspaceSeededMarkers({ projectId: PROJECT_A, tabId: "durable-tab" })).toEqual([
      { id: "durable-marker", ordinal: 1, documentKey: "sha256:published" },
    ]);
    expect(manager.getProjectState({ projectId: PROJECT_B }).tabs).toEqual([]);
    expect(() =>
      manager.getVisibleOwnerAutomationRuntime({
        owner: { kind: "project", projectId: PROJECT_A },
        tabId: "durable-tab",
      }),
    ).toThrow(/not available|not ready/i);
  });

  it("hydrates before the gated operation and deletion invalidates only that Project", async () => {
    const filePath = createWorkspacePath();
    let activation: DesktopProjectWorkspaceActivation | undefined;
    const manager = new DesktopBrowserManager({
      onProjectWorkspaceDeactivated: (projectId) => activation?.forgetProject(projectId),
    });
    const projectActivation = new DesktopProjectWorkspaceActivation(filePath, manager);
    activation = projectActivation;

    await projectActivation.ensureProjectWorkspaceActivated(PROJECT_A);
    expect(manager.openProject({ projectId: PROJECT_A, initialUrl: "https://first.test/" }).tabs).toHaveLength(1);
    manager.handleProjectRemoved(PROJECT_A);
    await projectActivation.ensureProjectWorkspaceActivated(PROJECT_A);
    expect(manager.getProjectState({ projectId: PROJECT_A }).tabs).toEqual([]);
    expect(manager.getProjectState({ projectId: PROJECT_B }).tabs).toEqual([]);
  });

  it("gates automation only when a real ProjectId is present", async () => {
    const executeTool = vi.fn(async () => ({ ok: true }));
    const ensure = vi.fn(async () => undefined);
    const host = createActivationGatedAutomationHost(
      { executeTool },
      { ensureProjectWorkspaceActivated: ensure } as unknown as DesktopProjectWorkspaceActivation,
    );

    await host.executeTool({
      sessionId: "session",
      provider: "test",
      threadId: "thread" as never,
      projectId: PROJECT_A,
      name: BROWSER_TOOL_NAMES[0],
      arguments: {},
    });
    await host.executeTool({
      sessionId: "session",
      provider: "test",
      threadId: "thread" as never,
      name: BROWSER_TOOL_NAMES[0],
      arguments: {},
    });

    expect(ensure).toHaveBeenCalledOnce();
    expect(ensure).toHaveBeenCalledWith(PROJECT_A);
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("blocks malformed, mixed, and stale publications, retains diagnostics, and retries after repair", async () => {
    for (const corruption of ["malformed", "mixed", "stale"] as const) {
      const filePath = createWorkspacePath();
      publishDefaults(filePath, PROJECT_A);
      const document = readDocument(filePath);
      if (corruption === "malformed") {
        writeDocument(filePath, { version: 99, staged: {}, published: {} });
      } else if (corruption === "mixed") {
        const staged = document.staged as Record<string, unknown>;
        staged[`synara:project-workspace:v2:stage:${PROJECT_A}:browser`] = {
          ...(staged[`synara:project-workspace:v2:stage:${PROJECT_A}:browser`] as Record<string, unknown>),
          projectId: PROJECT_B,
        };
        writeDocument(filePath, document);
      } else {
        const published = document.published as Record<string, unknown>;
        published[`synara:project-workspace:v2:published:${PROJECT_A}`] = {
          ...(published[`synara:project-workspace:v2:published:${PROJECT_A}`] as Record<string, unknown>),
          schemaVersion: 1,
        };
        writeDocument(filePath, document);
      }

      const apply = vi.fn();
      const activation = new DesktopProjectWorkspaceActivation(filePath, {
        applyProjectWorkspaceActivation: apply,
      } as unknown as DesktopBrowserManagerType);
      await expect(activation.ensureProjectWorkspaceActivated(PROJECT_A)).rejects.toBeInstanceOf(
        ProjectWorkspaceActivationError,
      );
      expect(apply).not.toHaveBeenCalled();
      expect(activation.diagnosticFor(PROJECT_A)).toMatch(/publication|malformed|unavailable/i);

      writeDocument(filePath, { version: 2, staged: {}, published: {}, diagnostics: {} });
      await activation.ensureProjectWorkspaceActivated(PROJECT_A);
      expect(apply).toHaveBeenCalledOnce();
    }
  });

  it("blocks stage and application failures without partial activation, then retries", async () => {
    const stagePath = createWorkspacePath();
    let failStage = true;
    const stagedManager = { applyProjectWorkspaceActivation: vi.fn() };
    const stagedActivation = new DesktopProjectWorkspaceActivation(stagePath, stagedManager as never, {
      beforePublish: () => {
        if (failStage) throw new Error("stage publication failed");
      },
    });
    await expect(stagedActivation.ensureProjectWorkspaceActivated(PROJECT_A)).rejects.toThrow(
      "stage publication failed",
    );
    expect(stagedManager.applyProjectWorkspaceActivation).not.toHaveBeenCalled();
    failStage = false;
    await stagedActivation.ensureProjectWorkspaceActivated(PROJECT_A);
    expect(stagedManager.applyProjectWorkspaceActivation).toHaveBeenCalledOnce();

    const applicationPath = createWorkspacePath();
    const apply = vi.fn().mockImplementationOnce(() => {
      throw new Error("application failed");
    });
    const applicationActivation = new DesktopProjectWorkspaceActivation(applicationPath, {
      applyProjectWorkspaceActivation: apply,
    } as never);
    await expect(applicationActivation.ensureProjectWorkspaceActivated(PROJECT_A)).rejects.toThrow(
      "application failed",
    );
    expect(applicationActivation.isActivated(PROJECT_A)).toBe(false);
    await applicationActivation.ensureProjectWorkspaceActivated(PROJECT_A);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("reports a durable read failure and retries once the store path is repaired", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synara-d0004-read-failure-"));
    tempDirectories.push(directory);
    const activation = new DesktopProjectWorkspaceActivation(directory, {
      applyProjectWorkspaceActivation: vi.fn(),
    } as never);

    await expect(activation.ensureProjectWorkspaceActivated(PROJECT_A)).rejects.toBeInstanceOf(
      ProjectWorkspaceActivationError,
    );
    expect(activation.diagnosticFor(PROJECT_A)).toMatch(/EISDIR|directory|rename|persist/i);

    fs.rmSync(directory, { recursive: true, force: true });
    await activation.ensureProjectWorkspaceActivated(PROJECT_A);
    expect(activation.isActivated(PROJECT_A)).toBe(true);
  });
});

describe("Decision 0004 Project browser and annotation IPC activation gates", () => {
  it("awaits activation before every Project browser/annotation method, including bounds", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = {
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
      handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      on: vi.fn(),
    };
    const order: string[] = [];
    const projectMethodNames = [
      "openProject",
      "closeProject",
      "hideProject",
      "getProjectState",
      "setProjectPanelBounds",
      "navigateProject",
      "reloadProject",
      "goBackProject",
      "goForwardProject",
      "newProjectTab",
      "closeProjectTab",
      "selectProjectTab",
      "openProjectDevTools",
      "startProjectAnnotation",
      "cancelProjectAnnotation",
      "syncProjectAnnotationMarkers",
    ] as const;
    const manager = {
      isTrustedRenderer: () => true,
      ...Object.fromEntries(
        projectMethodNames.map((name) => [
          name,
          vi.fn(() => {
            order.push(name);
          }),
        ]),
      ),
    };
    const activation = {
      ensureProjectWorkspaceActivated: vi.fn(async () => {
        order.push("activate");
      }),
    };
    registerBrowserIpcHandlers(
      ipcMain as never,
      manager as unknown as DesktopBrowserManagerType,
      activation as unknown as DesktopProjectWorkspaceActivation,
    );

    const event = { sender: { id: 7 } };
    const inputByChannel: Record<string, unknown> = {
      [PROJECT_BROWSER_IPC_CHANNELS.open]: { projectId: PROJECT_A },
      [PROJECT_BROWSER_IPC_CHANNELS.close]: { projectId: PROJECT_A },
      [PROJECT_BROWSER_IPC_CHANNELS.hide]: { projectId: PROJECT_A },
      [PROJECT_BROWSER_IPC_CHANNELS.getState]: { projectId: PROJECT_A },
      [PROJECT_BROWSER_IPC_CHANNELS.setBounds]: { projectId: PROJECT_A, bounds: null },
      [PROJECT_BROWSER_IPC_CHANNELS.navigate]: { projectId: PROJECT_A, tabId: "tab", url: "https://test/" },
      [PROJECT_BROWSER_IPC_CHANNELS.reload]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.goBack]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.goForward]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.newTab]: { projectId: PROJECT_A },
      [PROJECT_BROWSER_IPC_CHANNELS.closeTab]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.selectTab]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.openDevTools]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.annotations.start]: {
        projectId: PROJECT_A,
        tabId: "tab",
        theme: {},
      },
      [PROJECT_BROWSER_IPC_CHANNELS.annotations.cancel]: { projectId: PROJECT_A, tabId: "tab" },
      [PROJECT_BROWSER_IPC_CHANNELS.annotations.syncMarkers]: {
        projectId: PROJECT_A,
        tabId: "tab",
        version: 0,
        markers: [],
      },
    };

    for (const [channel, input] of Object.entries(inputByChannel)) {
      order.length = 0;
      await handlers.get(channel)?.(event, input);
      expect(activation.ensureProjectWorkspaceActivated).toHaveBeenCalledWith(PROJECT_A);
      expect(order[0]).toBe("activate");
      expect(order).toHaveLength(2);
    }
    expect(activation.ensureProjectWorkspaceActivated).toHaveBeenCalledTimes(
      Object.keys(inputByChannel).length,
    );
  });
});
