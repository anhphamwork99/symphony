// FILE: browserIpc.ts
// Purpose: Centralizes the desktop browser IPC contract and handler wiring.
// Layer: Desktop IPC adapter
// Depends on: Electron ipcMain/webContents and DesktopBrowserManager

import type { IpcMain, WebContents } from "electron";

import type {
  BrowserAttachWebviewInput,
  BrowserAnnotationCancelInput,
  BrowserAnnotationEvent,
  BrowserAnnotationProjectCancelInput,
  BrowserAnnotationProjectEvent,
  BrowserAnnotationProjectStartInput,
  BrowserAnnotationProjectSyncMarkersInput,
  BrowserAnnotationStartInput,
  BrowserAnnotationSyncMarkersInput,
  BrowserCaptureScreenshotResult,
  BrowserCopyLinkEvent,
  BrowserDetachWebviewInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserProjectInput,
  BrowserProjectNavigateInput,
  BrowserProjectNewTabInput,
  BrowserProjectOpenInput,
  BrowserProjectSetPanelBoundsInput,
  BrowserProjectTabInput,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserThreadInput,
  ProjectBrowserState,
  ThreadBrowserState,
} from "@synara/contracts";

import type { DesktopBrowserManager } from "./browserManager";
import type { DesktopProjectWorkspaceActivation } from "./desktopProjectWorkspaceActivation";
import { BROWSER_IPC_CHANNELS, PROJECT_BROWSER_IPC_CHANNELS } from "./ipcChannels";

// Pushes the latest browser state snapshot to the renderer shell.
export function sendBrowserState(
  webContents: WebContents | null | undefined,
  state: ThreadBrowserState,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.state, state);
}

// Notifies the renderer that the native browser page handled the copy-link chord so the
// shell can surface the confirmation toast (the URL is already on the clipboard).
export function sendBrowserCopyLink(
  webContents: WebContents | null | undefined,
  event: BrowserCopyLinkEvent,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.copyLink, event);
}

export function sendBrowserAnnotationEvent(
  webContents: WebContents | null | undefined,
  event: BrowserAnnotationEvent,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.annotations.event, event);
}

export function sendProjectBrowserState(
  webContents: WebContents | null | undefined,
  state: ProjectBrowserState,
): void {
  webContents?.send(PROJECT_BROWSER_IPC_CHANNELS.state, state);
}

export function sendProjectBrowserCopyLink(
  webContents: WebContents | null | undefined,
  event: { readonly projectId: ProjectBrowserState["projectId"]; readonly url: string },
): void {
  webContents?.send(PROJECT_BROWSER_IPC_CHANNELS.copyLink, event);
}

export function sendProjectBrowserAnnotationEvent(
  webContents: WebContents | null | undefined,
  event: BrowserAnnotationProjectEvent,
): void {
  webContents?.send(PROJECT_BROWSER_IPC_CHANNELS.annotations.event, event);
}

// Registers the desktop browser bridge in one place so main.ts stays focused on app boot.
export function registerBrowserIpcHandlers(
  ipcMain: IpcMain,
  browserManager: DesktopBrowserManager,
  projectWorkspaceActivation: DesktopProjectWorkspaceActivation,
): void {
  const requireTrustedRenderer = (senderId: number): void => {
    if (!browserManager.isTrustedRenderer(senderId)) {
      throw new Error("Browser annotation IPC rejected an untrusted renderer.");
    }
  };
  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.open);
  ipcMain.handle(BROWSER_IPC_CHANNELS.open, async (_event, input: BrowserOpenInput) =>
    browserManager.open(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.close);
  ipcMain.handle(BROWSER_IPC_CHANNELS.close, async (_event, input: BrowserThreadInput) =>
    browserManager.close(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.hide);
  ipcMain.handle(BROWSER_IPC_CHANNELS.hide, async (_event, input: BrowserThreadInput) => {
    browserManager.hide(input);
  });

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.getState);
  ipcMain.handle(BROWSER_IPC_CHANNELS.getState, async (_event, input: BrowserThreadInput) =>
    browserManager.getState(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.setBounds);
  ipcMain.removeAllListeners(BROWSER_IPC_CHANNELS.setBounds);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.setBounds,
    async (_event, input: BrowserSetPanelBoundsInput) => {
      browserManager.setPanelBounds(input);
    },
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.attachWebview);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.attachWebview,
    async (event, input: BrowserAttachWebviewInput) =>
      browserManager.attachWebview(input, event.sender.id),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.detachWebview);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.detachWebview,
    async (_event, input: BrowserDetachWebviewInput) => {
      browserManager.detachWebview(input);
    },
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.captureScreenshot);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.captureScreenshot,
    async (_event, input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> =>
      browserManager.captureScreenshot(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.copyScreenshotToClipboard);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.copyScreenshotToClipboard,
    async (_event, input: BrowserTabInput) => {
      await browserManager.copyScreenshotToClipboard(input);
    },
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.requestCopyLink);
  ipcMain.handle(BROWSER_IPC_CHANNELS.requestCopyLink, async (_event, input: BrowserTabInput) => {
    browserManager.copyLink(input);
  });

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.navigate);
  ipcMain.handle(BROWSER_IPC_CHANNELS.navigate, async (_event, input: BrowserNavigateInput) =>
    browserManager.navigate(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.reload);
  ipcMain.handle(BROWSER_IPC_CHANNELS.reload, async (_event, input: BrowserTabInput) =>
    browserManager.reload(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.goBack);
  ipcMain.handle(BROWSER_IPC_CHANNELS.goBack, async (_event, input: BrowserTabInput) =>
    browserManager.goBack(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.goForward);
  ipcMain.handle(BROWSER_IPC_CHANNELS.goForward, async (_event, input: BrowserTabInput) =>
    browserManager.goForward(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.newTab);
  ipcMain.handle(BROWSER_IPC_CHANNELS.newTab, async (_event, input: BrowserNewTabInput) =>
    browserManager.newTab(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.closeTab);
  ipcMain.handle(BROWSER_IPC_CHANNELS.closeTab, async (_event, input: BrowserTabInput) =>
    browserManager.closeTab(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.selectTab);
  ipcMain.handle(BROWSER_IPC_CHANNELS.selectTab, async (_event, input: BrowserTabInput) =>
    browserManager.selectTab(input),
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.openDevTools);
  ipcMain.handle(BROWSER_IPC_CHANNELS.openDevTools, async (_event, input: BrowserTabInput) => {
    browserManager.openDevTools(input);
  });

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.annotations.start);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.annotations.start,
    async (event, input: BrowserAnnotationStartInput) => {
      requireTrustedRenderer(event.sender.id);
      return browserManager.startAnnotation(input);
    },
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.annotations.cancel);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.annotations.cancel,
    async (event, input: BrowserAnnotationCancelInput) => {
      requireTrustedRenderer(event.sender.id);
      browserManager.cancelAnnotation(input);
    },
  );

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.annotations.syncMarkers);
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.annotations.syncMarkers,
    async (event, input: BrowserAnnotationSyncMarkersInput) => {
      requireTrustedRenderer(event.sender.id);
      browserManager.syncAnnotationMarkers(input);
    },
  );

  ipcMain.removeAllListeners(BROWSER_IPC_CHANNELS.annotations.guestMessage);
  ipcMain.on(BROWSER_IPC_CHANNELS.annotations.guestMessage, (event, payload: unknown) => {
    // Guest subframes inherit the preload in some embed configurations. Only
    // the current main frame may establish document/session affinity.
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return;
    browserManager.handleAnnotationGuestMessage(event.sender, payload);
  });

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.removeProject);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.removeProject,
    async (_event, input: BrowserProjectInput) => {
      await projectWorkspaceActivation.handleProjectRemoved(input.projectId);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.open);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.open,
    async (_event, input: BrowserProjectOpenInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.openProject(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.close);
  ipcMain.handle(PROJECT_BROWSER_IPC_CHANNELS.close, async (_event, input: BrowserProjectInput) => {
    await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
    return browserManager.closeProject(input);
  });

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.hide);
  ipcMain.handle(PROJECT_BROWSER_IPC_CHANNELS.hide, async (_event, input: BrowserProjectInput) => {
    await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
    browserManager.hideProject(input);
  });

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.getState);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.getState,
    async (_event, input: BrowserProjectInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.getProjectState(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.setBounds);
  ipcMain.removeAllListeners(PROJECT_BROWSER_IPC_CHANNELS.setBounds);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.setBounds,
    async (_event, input: BrowserProjectSetPanelBoundsInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      browserManager.setProjectPanelBounds(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.navigate);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.navigate,
    async (_event, input: BrowserProjectNavigateInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.navigateProject(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.reload);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.reload,
    async (_event, input: BrowserProjectTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.reloadProject(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.goBack);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.goBack,
    async (_event, input: BrowserProjectTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.goBackProject(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.goForward);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.goForward,
    async (_event, input: BrowserProjectTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.goForwardProject(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.newTab);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.newTab,
    async (_event, input: BrowserProjectNewTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.newProjectTab(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.closeTab);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.closeTab,
    async (_event, input: BrowserProjectTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.closeProjectTab(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.selectTab);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.selectTab,
    async (_event, input: BrowserProjectTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.selectProjectTab(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.openDevTools);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.openDevTools,
    async (_event, input: BrowserProjectTabInput) => {
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      browserManager.openProjectDevTools(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.annotations.start);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.annotations.start,
    async (event, input: BrowserAnnotationProjectStartInput) => {
      requireTrustedRenderer(event.sender.id);
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      return browserManager.startProjectAnnotation(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.annotations.cancel);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.annotations.cancel,
    async (event, input: BrowserAnnotationProjectCancelInput) => {
      requireTrustedRenderer(event.sender.id);
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      browserManager.cancelProjectAnnotation(input);
    },
  );

  ipcMain.removeHandler(PROJECT_BROWSER_IPC_CHANNELS.annotations.syncMarkers);
  ipcMain.handle(
    PROJECT_BROWSER_IPC_CHANNELS.annotations.syncMarkers,
    async (event, input: BrowserAnnotationProjectSyncMarkersInput) => {
      requireTrustedRenderer(event.sender.id);
      await projectWorkspaceActivation.ensureProjectWorkspaceActivated(input.projectId);
      browserManager.syncProjectAnnotationMarkers(input);
    },
  );
}
