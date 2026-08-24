// FILE: useTerminalSurfaceController.ts
// Purpose: Terminal-store controller for the right-dock terminal pane. Owns the
//          store selector slice, focus-request bump, and standard create/split/tab/
//          move/activate/close handlers.
// Layer: Web terminal UI hook
// Note: ChatView is intentionally NOT a consumer — it adds split limits, placeholder
//       thread cleanup, and split-view navigation, so it shares only the lower-level
//       terminalSession helpers instead of this controller.

import { type ProjectId, type ThreadId } from "@synara/contracts";
import { type TerminalCliKind } from "@synara/shared/terminalThreads";
import { useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  confirmTerminalTabClose,
  resolveTerminalCloseTitle,
  shouldPromptForTerminalClose,
} from "~/lib/terminalCloseConfirmation";
import { readNativeApi } from "~/nativeApi";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { randomTerminalId } from "~/components/terminal/terminalIds";
import { disposeAndCloseTerminalSession } from "~/components/terminal/terminalSession";
import {
  closeTerminalSession,
  preflightProjectTerminalRunning,
} from "~/components/terminal/terminalProjectRouting";
import { toastManager } from "~/components/ui/toast";

type TerminalMetadata = { cliKind: TerminalCliKind | null; label: string };
type TerminalActivity = {
  hasRunningSubprocess: boolean;
  agentState: "running" | "attention" | "review" | null;
};

export function useTerminalSurfaceController(
  threadId: ThreadId,
  options?: {
    /**
     * Owning Project for a Project-owned dock terminal workspace (Decision
     * 0002). `threadId` then names only the local store/runtime scope; every
     * server call (open/write/close and the close preflight) routes through the
     * Project-owned surface keyed by the real ProjectId.
     */
    readonly projectId?: ProjectId | null;
  },
) {
  const { settings } = useAppSettings();
  const projectId = options?.projectId ?? null;
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const openTerminalThreadPage = useTerminalStateStore((s) => s.openTerminalThreadPage);
  const newTerminal = useTerminalStateStore((s) => s.newTerminal);
  const newTerminalTab = useTerminalStateStore((s) => s.newTerminalTab);
  const splitTerminalRightStore = useTerminalStateStore((s) => s.splitTerminalRight);
  const splitTerminalDownStore = useTerminalStateStore((s) => s.splitTerminalDown);
  const setActiveTerminalStore = useTerminalStateStore((s) => s.setActiveTerminal);
  const closeTerminalAndEnsureReplacementStore = useTerminalStateStore(
    (s) => s.closeTerminalAndEnsureReplacement,
  );
  const closeExitedTerminalStore = useTerminalStateStore((s) => s.closeExitedTerminal);
  const closeTerminalGroupStore = useTerminalStateStore((s) => s.closeTerminalGroup);
  const setTerminalHeightStore = useTerminalStateStore((s) => s.setTerminalHeight);
  const resizeTerminalSplitStore = useTerminalStateStore((s) => s.resizeTerminalSplit);
  const setTerminalMetadataStore = useTerminalStateStore((s) => s.setTerminalMetadata);
  const setTerminalActivityStore = useTerminalStateStore((s) => s.setTerminalActivity);

  const [focusRequestId, setFocusRequestId] = useState(0);
  const bumpFocusRequest = () => setFocusRequestId((value) => value + 1);

  const newTerminalGroup = () => {
    newTerminal(threadId, randomTerminalId());
    bumpFocusRequest();
  };

  const splitRight = () => {
    splitTerminalRightStore(threadId, randomTerminalId());
    bumpFocusRequest();
  };

  const splitDown = () => {
    splitTerminalDownStore(threadId, randomTerminalId());
    bumpFocusRequest();
  };

  const createTerminalTab = (targetTerminalId: string) => {
    newTerminalTab(threadId, targetTerminalId, randomTerminalId());
    bumpFocusRequest();
  };

  const moveTerminalToNewGroup = (terminalId: string) => {
    newTerminal(threadId, terminalId);
    bumpFocusRequest();
  };

  const activateTerminal = (terminalId: string) => {
    setActiveTerminalStore(threadId, terminalId);
    bumpFocusRequest();
  };

  /**
   * Truthful running state for the close warning. Project-owned terminals
   * preflight the server's live status (`terminal.project.list`) so an
   * idle-looking tab that still owns a running process still warns, and a
   * running-looking tab that already exited does not. The local view is the
   * fallback when the preflight cannot run (legacy surface, transport hiccup).
   */
  const resolveTerminalRunningForClose = async (terminalId: string): Promise<boolean> => {
    const localRunning =
      shouldPromptForTerminalClose({
        confirmationEnabled: true,
        runningTerminalIds: terminalState.runningTerminalIds,
        terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
        terminalId,
      }) || terminalState.runningTerminalIds.includes(terminalId);
    if (projectId === null) {
      return localRunning;
    }
    const preflight = await preflightProjectTerminalRunning(projectId, terminalId);
    return preflight ?? localRunning;
  };

  const closeTerminal = async (terminalId: string) => {
    const api = readNativeApi();
    const running = await resolveTerminalRunningForClose(terminalId);
    const confirmed = await confirmTerminalTabClose({
      api,
      enabled: running,
      terminalTitle: resolveTerminalCloseTitle({
        terminalId,
        terminalLabelsById: terminalState.terminalLabelsById,
        terminalTitleOverridesById: terminalState.terminalTitleOverridesById,
      }),
    });
    if (!confirmed) {
      // Cancel leaves both the process and the UI in a truthful, untouched state.
      return;
    }
    if (projectId !== null) {
      // A rejected close must leave the tab, the terminal state, and the live
      // xterm runtime untouched (truthful failure, no pretend success): surface
      // the server's failure to the user and keep the workspace exactly as it
      // was. Only a confirmed close disposes the runtime and replaces the tab.
      try {
        await closeTerminalSession({ projectId, threadId, terminalId }, { deleteHistory: true });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not close terminal",
          description:
            error instanceof Error
              ? `${error.message} The terminal tab stays open.`
              : "The close request failed. The terminal tab stays open.",
        });
        return;
      }
      disposeAndCloseTerminalRuntime({ threadId, terminalId });
      closeTerminalAndEnsureReplacementStore(threadId, terminalId, randomTerminalId());
      bumpFocusRequest();
      return;
    }
    disposeAndCloseTerminalSession({ api, threadId, terminalId });
    closeTerminalAndEnsureReplacementStore(threadId, terminalId, randomTerminalId());
    bumpFocusRequest();
  };

  const disposeExitedTerminal = (terminalId: string) => {
    disposeAndCloseTerminalSession({
      api: readNativeApi(),
      threadId,
      terminalId,
      processAlreadyExited: true,
    });
  };

  const handleTerminalSessionExited = (terminalId: string) => {
    disposeExitedTerminal(terminalId);
    closeTerminalAndEnsureReplacementStore(threadId, terminalId, randomTerminalId());
    bumpFocusRequest();
  };

  const handleDockTerminalSessionExited = (terminalId: string) => {
    disposeExitedTerminal(terminalId);
    const disposition = closeExitedTerminalStore(threadId, terminalId);
    bumpFocusRequest();
    return disposition;
  };

  const closeTerminalGroup = (groupId: string) => closeTerminalGroupStore(threadId, groupId);

  const setTerminalHeight = (height: number) => setTerminalHeightStore(threadId, height);

  const resizeTerminalSplit = (groupId: string, splitId: string, weights: number[]) =>
    resizeTerminalSplitStore(threadId, groupId, splitId, weights);

  const setTerminalMetadata = (terminalId: string, metadata: TerminalMetadata) =>
    setTerminalMetadataStore(threadId, terminalId, metadata);

  const setTerminalActivity = (terminalId: string, activity: TerminalActivity) =>
    setTerminalActivityStore(threadId, terminalId, activity);

  return {
    terminalState,
    focusRequestId,
    bumpFocusRequest,
    openTerminalThreadPage,
    newTerminalGroup,
    splitRight,
    splitDown,
    createTerminalTab,
    moveTerminalToNewGroup,
    activateTerminal,
    closeTerminal,
    handleTerminalSessionExited,
    handleDockTerminalSessionExited,
    closeTerminalGroup,
    setTerminalHeight,
    resizeTerminalSplit,
    setTerminalMetadata,
    setTerminalActivity,
  };
}

/**
 * Dispose only the local xterm runtime for a Project-owned terminal. Server
 * teardown goes through the Project surface in `closeTerminal`.
 */
async function disposeAndCloseTerminalRuntime(input: {
  threadId: string;
  terminalId: string;
}): Promise<void> {
  try {
    const { terminalRuntimeRegistry } = await import(
      "~/components/terminal/terminalRuntimeRegistry"
    );
    terminalRuntimeRegistry.disposeTerminal(input.threadId, input.terminalId);
  } catch (error) {
    console.error("Failed to dispose terminal runtime", { ...input, error });
  }
}
