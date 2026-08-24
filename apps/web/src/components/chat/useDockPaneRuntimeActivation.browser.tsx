// FILE: useDockPaneRuntimeActivation.browser.tsx
// Purpose: Browser-runtime regressions for restored heavy dock pane hydration.
// Layer: Web browser tests
// Depends on: useDockPaneRuntimeActivation and a real React/browser event loop.

import { ProjectId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import { useDockPaneRuntimeActivation } from "~/hooks/useDockPaneRuntimeActivation";
import type { RightDockPane } from "~/rightDockStore.logic";

const PROJECT_A = ProjectId.makeUnsafe("project-a");
const PROJECT_B = ProjectId.makeUnsafe("project-b");
const BROWSER_PANE: RightDockPane = {
  id: "browser-pane",
  kind: "browser",
  threadId: null,
  diffTurnId: null,
  diffFilePath: null,
  filePath: null,
  pullRequestProjectId: null,
  pullRequestRepository: null,
  pullRequestNumber: null,
  pullRequestInitialTab: null,
  restorationDiagnostic: null,
};

interface RuntimeActivationProps {
  readonly projectId: ProjectId | null;
  readonly activePane: RightDockPane | null;
}

describe("useDockPaneRuntimeActivation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores a browser pane after a route round-trip when animation frames are paused", async () => {
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => nextFrameId++);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const initialProps: RuntimeActivationProps = {
      projectId: PROJECT_A,
      activePane: BROWSER_PANE,
    };

    const hook = await renderHook(
      (props?: RuntimeActivationProps) =>
        useDockPaneRuntimeActivation({
          projectId: props?.projectId ?? PROJECT_A,
          activePane: props ? props.activePane : BROWSER_PANE,
        }),
      {
        initialProps,
      },
    );

    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    await hook.rerender({ projectId: null, activePane: null });
    await hook.rerender({ projectId: PROJECT_A, activePane: { ...BROWSER_PANE } });

    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    await hook.unmount();
  });

  it("keeps a hydrated pane live across a same-Project conversation switch", async () => {
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => nextFrameId++);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const hook = await renderHook(
      (props: RuntimeActivationProps) =>
        useDockPaneRuntimeActivation({ projectId: props.projectId, activePane: props.activePane }),
      { initialProps: { projectId: PROJECT_A, activePane: BROWSER_PANE } },
    );

    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    // Same Project, same pane (fresh object identity from a store snapshot):
    // the runtime must stay live, not drop back to preview and rehydrate.
    await hook.rerender({ projectId: PROJECT_A, activePane: { ...BROWSER_PANE } });

    expect(hook.result.current.activePaneRuntimeMode).toBe("live");

    await hook.unmount();
  });

  it("resets hydration when another Project becomes the dock owner", async () => {
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => nextFrameId++);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const hook = await renderHook(
      (props: RuntimeActivationProps) =>
        useDockPaneRuntimeActivation({ projectId: props.projectId, activePane: props.activePane }),
      { initialProps: { projectId: PROJECT_A, activePane: BROWSER_PANE } },
    );

    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    // Another Project owns another dock slice; its identical-looking pane must
    // hydrate from scratch instead of inheriting the previous runtime.
    await hook.rerender({ projectId: PROJECT_B, activePane: { ...BROWSER_PANE } });

    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    await hook.unmount();
  });

  it("never hydrates a pane while the owner Project is unresolved", async () => {
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => nextFrameId++);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const hook = await renderHook(
      (props: RuntimeActivationProps) =>
        useDockPaneRuntimeActivation({ projectId: props.projectId, activePane: props.activePane }),
      { initialProps: { projectId: null, activePane: BROWSER_PANE } },
    );

    // A Project-less surface owns no dock slice, so there is no key to hydrate:
    // the explicit requests must not schedule (or consume) any deferred
    // hydration for a pane the surface cannot own.
    hook.result.current.requestActivePaneLive();
    hook.result.current.requestImmediateHydration();
    expect(hook.result.current.activePaneRuntimeMode).toBe("live");

    // Settling the owner Project then follows the normal restore path for its
    // own dock slice: preview first, live only after deferred hydration.
    await hook.rerender({ projectId: PROJECT_A, activePane: { ...BROWSER_PANE } });
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    await hook.unmount();
  });
});
