// FILE: useTerminalSurfaceController.close.test.ts
// Purpose: Prove the Project-owned dock-terminal close flow (Project Contract
//          scenario 4) at the controller level: a rejected server close keeps
//          the tab, the terminal state, and the live runtime untouched and
//          surfaces a user-visible error; a confirmed close replaces the tab;
//          cancelling leaves everything untouched.
// Layer: Web terminal close-flow tests (WP6 review finding)
// Depends on: useTerminalSurfaceController (react-harness driven, mirrors
//             useSidebarProjectRunController.test.ts).

import { ProjectId, ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactHarness = vi.hoisted(() => {
  interface HookSlot {
    value?: unknown;
    deps?: readonly unknown[];
    cleanup?: (() => void) | undefined;
  }
  let slots: HookSlot[] = [];
  let cursor = 0;
  const nextSlot = () => {
    const slot = (slots[cursor] ??= {});
    cursor += 1;
    return slot;
  };
  // Vitest requires helpers referenced by a hoisted factory to stay inside that factory.
  // oxlint-disable-next-line consistent-function-scoping
  const depsEqual = (left: readonly unknown[] | undefined, right: readonly unknown[]) =>
    left !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      slots = [];
      cursor = 0;
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const slot = nextSlot();
      if (depsEqual(slot.deps, deps)) return;
      slot.cleanup?.();
      slot.deps = deps;
      slot.cleanup = effect() ?? undefined;
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
      const slot = nextSlot();
      if (!depsEqual(slot.deps, deps)) {
        slot.deps = deps;
        slot.value = factory();
      }
      return slot.value as T;
    },
    useState<T>(initialValue: T | (() => T)) {
      const slot = nextSlot();
      if (!("value" in slot)) {
        slot.value =
          typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
      }
      const setValue = (next: T | ((current: T) => T)) => {
        slot.value =
          typeof next === "function" ? (next as (current: T) => T)(slot.value as T) : next;
      };
      return [slot.value as T, setValue] as const;
    },
  };
});

const harness = vi.hoisted(() => ({
  closeTerminalSession: vi.fn(),
  preflightProjectTerminalRunning: vi.fn(),
  confirmTerminalTabClose: vi.fn(),
  toast: vi.fn(),
  closeTerminalAndEnsureReplacement: vi.fn(),
  disposeTerminal: vi.fn(),
  terminalStateByScope: {} as Record<string, unknown>,
}));

vi.mock("react", () => ({
  useEffect: reactHarness.useEffect,
  useMemo: reactHarness.useMemo,
  useState: reactHarness.useState,
}));

vi.mock("~/appSettings", () => ({ useAppSettings: () => ({ settings: {} }) }));

vi.mock("~/components/terminal/terminalProjectRouting", () => ({
  closeTerminalSession: harness.closeTerminalSession,
  preflightProjectTerminalRunning: harness.preflightProjectTerminalRunning,
}));

vi.mock("~/components/terminal/terminalRuntimeRegistry", () => ({
  terminalRuntimeRegistry: { disposeTerminal: harness.disposeTerminal },
}));

vi.mock("~/components/ui/toast", () => ({ toastManager: { add: harness.toast } }));

vi.mock("~/lib/terminalCloseConfirmation", () => ({
  confirmTerminalTabClose: harness.confirmTerminalTabClose,
  resolveTerminalCloseTitle: () => "Terminal",
  shouldPromptForTerminalClose: () => false,
}));

vi.mock("~/nativeApi", () => ({ readNativeApi: () => ({}) }));

vi.mock("~/terminalStateStore", () => ({
  selectThreadTerminalState: (_states: Record<string, unknown>, key: string) =>
    harness.terminalStateByScope[key] ?? {
      entryPoint: "chat",
      terminalOpen: false,
      presentationMode: "drawer",
      workspaceLayout: "both",
      workspaceActiveTab: "terminal",
      terminalHeight: 240,
      terminalIds: [],
      terminalLabelsById: {},
      terminalTitleOverridesById: {},
      terminalCliKindsById: {},
      terminalAttentionStatesById: {},
      runningTerminalIds: [],
      activeTerminalId: "",
      terminalGroups: [],
      activeTerminalGroupId: "",
    },
  useTerminalStateStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openTerminalThreadPage: vi.fn(),
      newTerminal: vi.fn(),
      newTerminalTab: vi.fn(),
      splitTerminalRight: vi.fn(),
      splitTerminalDown: vi.fn(),
      setActiveTerminal: vi.fn(),
      closeTerminalAndEnsureReplacement: harness.closeTerminalAndEnsureReplacement,
      closeExitedTerminal: vi.fn(),
      closeTerminalGroup: vi.fn(),
      setTerminalHeight: vi.fn(),
      resizeTerminalSplit: vi.fn(),
      setTerminalMetadata: vi.fn(),
      setTerminalActivity: vi.fn(),
    }),
}));

import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";

const projectId = ProjectId.makeUnsafe("project-1");
const scope = ThreadId.makeUnsafe("dock-terminal-project:project-1");

function render() {
  reactHarness.beginRender();
  return useTerminalSurfaceController(scope, { projectId });
}

beforeEach(() => {
  reactHarness.reset();
  harness.terminalStateByScope = {};
  for (const mock of [
    harness.closeTerminalSession,
    harness.preflightProjectTerminalRunning,
    harness.confirmTerminalTabClose,
    harness.toast,
    harness.closeTerminalAndEnsureReplacement,
    harness.disposeTerminal,
  ]) {
    mock.mockReset();
  }
  harness.closeTerminalSession.mockResolvedValue(undefined);
  harness.preflightProjectTerminalRunning.mockResolvedValue(true);
  harness.confirmTerminalTabClose.mockResolvedValue(true);
});

describe("useTerminalSurfaceController.closeTerminal — Project-owned close", () => {
  it("a rejected server close keeps the tab, state, and runtime untouched and surfaces the error", async () => {
    harness.closeTerminalSession.mockRejectedValueOnce(new Error("server refused"));

    await render().closeTerminal("t1");

    expect(harness.closeTerminalSession).toHaveBeenCalledWith(
      { projectId, threadId: scope, terminalId: "t1" },
      { deleteHistory: true },
    );
    // Truthful failure: the user sees it…
    expect(harness.toast).toHaveBeenCalledTimes(1);
    const toast = harness.toast.mock.calls[0]?.[0] as { type: string; title: string };
    expect(toast.type).toBe("error");
    expect(toast.title).toBe("Could not close terminal");
    // …and nothing local is torn down: no runtime dispose, no tab replacement.
    expect(harness.disposeTerminal).not.toHaveBeenCalled();
    expect(harness.closeTerminalAndEnsureReplacement).not.toHaveBeenCalled();
  });

  it("a confirmed successful close disposes the runtime and replaces the tab", async () => {
    await render().closeTerminal("t1");
    // disposeAndCloseTerminalRuntime awaits a dynamic import (fire-and-forget
    // from the controller), so flush it before asserting.
    await vi.waitFor(() => expect(harness.disposeTerminal).toHaveBeenCalled());

    expect(harness.closeTerminalSession).toHaveBeenCalledTimes(1);
    expect(harness.disposeTerminal).toHaveBeenCalledWith(scope, "t1");
    expect(harness.closeTerminalAndEnsureReplacement).toHaveBeenCalledTimes(1);
    expect(harness.closeTerminalAndEnsureReplacement.mock.calls[0]?.[0]).toBe(scope);
    expect(harness.closeTerminalAndEnsureReplacement.mock.calls[0]?.[1]).toBe("t1");
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation leaves process and UI untouched", async () => {
    harness.confirmTerminalTabClose.mockResolvedValueOnce(false);

    await render().closeTerminal("t1");

    expect(harness.closeTerminalSession).not.toHaveBeenCalled();
    expect(harness.disposeTerminal).not.toHaveBeenCalled();
    expect(harness.closeTerminalAndEnsureReplacement).not.toHaveBeenCalled();
    expect(harness.toast).not.toHaveBeenCalled();
  });
});
