// FILE: rightDockSizing.browser.tsx
// Purpose: Browser geometry coverage for the desktop right-dock responsiveness
// contract: Main conversation never below 360px during open/drag/shell-shrink,
// the 416px floor with exact shell-360 shrinkage below 776px shells, shrink-only
// auto-shrink (never auto-grow), and the close/reopen default reset.
// Layer: Web DOM behavior tests
// Depends on: RightDock + rightDockSizing policy, real ResizeObserver/browser layout.

// Production CSS is part of the behavior under test: the dock's width comes from
// Tailwind utilities (`w-(--sidebar-width)`, fixed offcanvas shell, flex layout).
import "../../index.css";

import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  createDefaultRightDockState,
  openPaneInState,
  type RightDockThreadState,
} from "~/rightDockStore.logic";
import { RIGHT_DOCK_DEFAULT_WIDTH, RIGHT_DOCK_MIN_WIDTH, RightDock } from "./RightDock";

const MAIN_MIN_WIDTH = 360;
const DOCK_SHELL_TEST_ID = "dock-shell";
const DOCK_MAIN_TEST_ID = "dock-main";
const DRAG_POINTER_ID = 17;

function openBrowserDockState(): RightDockThreadState {
  return openPaneInState(createDefaultRightDockState(), {
    paneId: "pane-browser",
    kind: "browser",
  });
}

// The shell width and open flag are driven by props (tests rerender to change
// them); the pane set is created once and reused so rerenders never remount.
function DockHarness(props: { shellWidth: number; open: boolean }) {
  const [paneState] = useState(() => openBrowserDockState());
  return (
    // Right-aligned so the dock's viewport-fixed container (right: 0) sits flush
    // with the shell's right edge, mirroring the real chat route layout.
    <div
      data-testid={DOCK_SHELL_TEST_ID}
      style={{
        display: "flex",
        height: "600px",
        marginLeft: "auto",
        overflow: "hidden",
        width: `${props.shellWidth}px`,
      }}
    >
      <main data-testid={DOCK_MAIN_TEST_ID} style={{ flex: "1 1 0%", minWidth: 0 }} />
      <RightDock
        state={{ ...paneState, open: props.open }}
        minWidth={RIGHT_DOCK_MIN_WIDTH}
        defaultWidth={RIGHT_DOCK_DEFAULT_WIDTH}
        shouldAcceptWidth={() => true}
        mainMinWidth={MAIN_MIN_WIDTH}
        addMenuKinds={[]}
        onClosePane={() => {}}
        onCollapse={() => {}}
        onOpenChange={() => {}}
        onAddPane={() => {}}
        motionKey="harness"
        renderPane={() => <div data-right-dock-test-pane />}
      />
    </div>
  );
}

function findShell(): HTMLElement {
  const shell = document.querySelector<HTMLElement>(`[data-testid='${DOCK_SHELL_TEST_ID}']`);
  expect(shell, "dock shell must be mounted").not.toBeNull();
  return shell as HTMLElement;
}

function findWrapper(): HTMLElement {
  const wrapper = document.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']");
  expect(wrapper, "sidebar wrapper must be mounted").not.toBeNull();
  return wrapper as HTMLElement;
}

function findRail(): HTMLElement {
  const rail = document.querySelector<HTMLElement>("[data-slot='sidebar-rail']");
  expect(rail, "sidebar rail must be mounted").not.toBeNull();
  return rail as HTMLElement;
}

function findContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>("[data-slot='sidebar-container']");
  expect(container, "sidebar container must be mounted").not.toBeNull();
  return container as HTMLElement;
}

/** Committed dock width: the --sidebar-width the open/drag/shrink flows wrote. */
function readCommittedDockWidthPx(): number {
  const raw = findWrapper().style.getPropertyValue("--sidebar-width");
  return raw.length > 0 ? Number.parseFloat(raw) : Number.NaN;
}

function readMainWidthPx(): number {
  const main = document.querySelector<HTMLElement>(`[data-testid='${DOCK_MAIN_TEST_ID}']`);
  return main?.getBoundingClientRect().width ?? Number.NaN;
}

function expectDockWidthPx(expected: number, timeout = 3_000): Promise<void> {
  return expect.poll(() => readCommittedDockWidthPx(), { timeout }).toBe(expected);
}

function expectMainWidthPx(expected: number, timeout = 3_000): Promise<void> {
  return expect.poll(() => readMainWidthPx(), { timeout }).toBeCloseTo(expected, 0);
}

function resizeShell(shell: HTMLElement, widthPx: number): void {
  shell.style.width = `${widthPx}px`;
}

/** Patches pointer capture so synthetic rail drags exercise the real handlers. */
const capturedPointerIds = new Set<number>();
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;

// pointerdown + one pointermove. The rail commits the width on the next
// animation frame, so tests must await the expected width before pointerup
// (stopResize cancels a pending frame, exactly like a real fast drag ending).
function railPointerDown(deltaPx: number): void {
  const rail = findRail();
  const rect = rail.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const options = {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: 0,
    clientY,
    pointerId: DRAG_POINTER_ID,
  };
  rail.dispatchEvent(new PointerEvent("pointerdown", { ...options, clientX: startX }));
  rail.dispatchEvent(new PointerEvent("pointermove", { ...options, clientX: startX + deltaPx }));
}

function railPointerUp(): void {
  findRail().dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
      pointerId: DRAG_POINTER_ID,
    }),
  );
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("RightDock desktop sizing contract", () => {
  beforeAll(async () => {
    Element.prototype.setPointerCapture = function setPointerCaptureTest(pointerId: number) {
      capturedPointerIds.add(pointerId);
    };
    Element.prototype.releasePointerCapture = function releasePointerCaptureTest(
      pointerId: number,
    ) {
      capturedPointerIds.delete(pointerId);
    };
    Element.prototype.hasPointerCapture = function hasPointerCaptureTest(pointerId: number) {
      return capturedPointerIds.has(pointerId);
    };
    await page.viewport(1400, 900);
  });

  afterAll(() => {
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    capturedPointerIds.clear();
  });

  afterEach(async () => {
    capturedPointerIds.clear();
    await mounted?.unmount();
    mounted = null;
    document.body.replaceChildren();
  });

  it("opens at the half-shell default at wide shells and re-centers on close/reopen", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    // Wide shell: existing half-shell default, Main conversation at half the shell.
    await expectDockWidthPx(600);
    await expectMainWidthPx(600);

    // Close, narrow the shell, reopen: the dock is re-pinned to the current
    // default (half of 1000), not the previously committed 600 — no persistence.
    await mounted.rerender(<DockHarness shellWidth={1000} open={false} />);
    await mounted.rerender(<DockHarness shellWidth={1000} open />);
    await expectDockWidthPx(500);
    await expectMainWidthPx(500);
  });

  it("shrinks the dock to exactly shell - 360 below the 776px shell boundary", async () => {
    mounted = await render(<DockHarness shellWidth={768} open />);
    await expectDockWidthPx(768 - MAIN_MIN_WIDTH);
    await expectMainWidthPx(MAIN_MIN_WIDTH);

    await mounted.rerender(<DockHarness shellWidth={500} open />);
    await expectDockWidthPx(500 - MAIN_MIN_WIDTH);
    await expectMainWidthPx(MAIN_MIN_WIDTH);
  });

  it("auto-shrinks the open dock when the shell narrows and never auto-grows it", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    // Shell shrinks: the dock follows so the Main conversation stays at 360.
    resizeShell(shell, 800);
    await expectDockWidthPx(800 - MAIN_MIN_WIDTH);
    await expectMainWidthPx(MAIN_MIN_WIDTH);

    // Shell grows again: the dock stays put (manual drag is the only way wider).
    resizeShell(shell, 1200);
    await expectDockWidthPx(440);
    await expectMainWidthPx(1200 - 440);
  });

  it("snaps the dock to the exact fractional shell - 360 ceiling and never auto-grows it", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    // Fractional shell width: the automatic shrink writes the exact, non-rounded
    // ceiling (440.5, never 441), so Main keeps its full 360px.
    resizeShell(shell, 800.5);
    await expectDockWidthPx(800.5 - MAIN_MIN_WIDTH);
    await expectMainWidthPx(MAIN_MIN_WIDTH);

    // Shell growth back up never auto-grows the dock either.
    resizeShell(shell, 1200);
    await expectDockWidthPx(800.5 - MAIN_MIN_WIDTH);
    await expectMainWidthPx(1200 - (800.5 - MAIN_MIN_WIDTH));
  });

  it("opens already clamped to the exact ceiling on narrow fractional shells", async () => {
    mounted = await render(<DockHarness shellWidth={768.5} open />);
    await expectDockWidthPx(768.5 - MAIN_MIN_WIDTH);
    await expectMainWidthPx(MAIN_MIN_WIDTH);
  });

  it("suppresses the width transition only for the automatic shrink write and restores it", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();
    const container = findContainer();
    // Normal (post-mount) state: open/close and manual drags animate the width.
    await expect
      .poll(() => getComputedStyle(container).transitionDuration, { timeout: 3_000 })
      .toBe("0.3s");

    // At the moment the automatic shrink commits --sidebar-width, the width
    // transition must be suppressed inline (duration 0), so the dock snaps and
    // Main never animates below 360.
    let durationAtShrinkWrite: string | null = null;
    const shrinkCommitted = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const raw = findWrapper().style.getPropertyValue("--sidebar-width");
        if (Number.parseFloat(raw) === 800 - MAIN_MIN_WIDTH) {
          durationAtShrinkWrite = getComputedStyle(container).transitionDuration;
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(findWrapper(), { attributeFilter: ["style"], attributes: true });
      resizeShell(shell, 800);
    });
    await shrinkCommitted;
    expect(durationAtShrinkWrite).toBe("0s");

    // The suppression is temporary: the next frame restores the prior inline
    // values, so subsequent open/close and manual drags keep their transitions.
    await expect
      .poll(() => getComputedStyle(container).transitionDuration, { timeout: 3_000 })
      .toBe("0.3s");
    await expectDockWidthPx(800 - MAIN_MIN_WIDTH);
  });

  it("clamps drags to shell - 360 and keeps the 416px floor", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    // Drag far left (widen): the geometric ceiling stops it at 1200 - 360.
    railPointerDown(-500);
    await expectDockWidthPx(1200 - MAIN_MIN_WIDTH);
    railPointerUp();
    railPointerDown(-1200);
    await expectDockWidthPx(1200 - MAIN_MIN_WIDTH);
    railPointerUp();

    // Drag far right (narrow): the 416px floor stops it.
    railPointerDown(700);
    await expectDockWidthPx(RIGHT_DOCK_MIN_WIDTH);
    railPointerUp();
    railPointerDown(1200);
    await expectDockWidthPx(RIGHT_DOCK_MIN_WIDTH);
    railPointerUp();
  });

  it("commits a fast drag's final position even when the release precedes the next frame", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    // pointerdown + pointermove + pointerup dispatched in the same task: no
    // animation frame can run in between, so only the release-flush path can
    // commit the final candidate (a regression here reproduces the "first drag
    // blocked, second drag works" symptom).
    railPointerDown(-120);
    railPointerUp();
    await expectDockWidthPx(600 + 120);

    // Same flush guarantee for the narrowing direction.
    railPointerDown(160);
    railPointerUp();
    await expectDockWidthPx(600 + 120 - 160);

    // The flushed candidate is clamped into the resize bounds.
    railPointerDown(-1_000);
    railPointerUp();
    await expectDockWidthPx(1200 - MAIN_MIN_WIDTH);
  });
});
