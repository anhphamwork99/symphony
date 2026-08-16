// FILE: rightDockSizing.browser.tsx
// Purpose: Browser geometry coverage for the desktop right-dock responsiveness
// contract: Main conversation never below 360px during open/drag/shell-shrink,
// the 416px floor with exact shell-360 shrinkage below 776px shells, shrink-only
// auto-shrink (never auto-grow), release idempotency, synchronous pointermove,
// and probe removal (AC-01 through AC-12).
// Layer: Web DOM behavior tests
// Depends on: RightDock + rightDockSizing policy, real ResizeObserver/browser layout.

// Production CSS is part of the behavior under test: the dock's width comes from
// Tailwind utilities (`w-(--sidebar-width)`, fixed offcanvas shell, flex layout).
import "../../index.css";

import { useRef, useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import * as panelResize from "~/lib/panelResize";
import {
  createDefaultRightDockState,
  openPaneInState,
  type RightDockThreadState,
} from "~/rightDockStore.logic";
import {
  createBoundedDockResizableOptions,
  RIGHT_DOCK_DEFAULT_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  RightDock,
} from "./RightDock";

// AC-12 spies on the real composer feasibility probe (implementation preserved,
// call observation added) to prove the bounded dock path never consults it.
// The mock lives only in this test file; production carries no instrumentation.
vi.mock("~/lib/panelResize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/panelResize")>();
  return {
    ...actual,
    canComposerHandlePanelWidth: vi.fn(actual.canComposerHandlePanelWidth),
  };
});

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

function DockHarness(props: {
  shellWidth: number;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [paneState] = useState(() => openBrowserDockState());
  const mainRef = useRef<HTMLElement | null>(null);
  return (
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
      <main ref={mainRef} data-testid={DOCK_MAIN_TEST_ID} style={{ flex: "1 1 0%", minWidth: 0 }} />
      <RightDock
        state={{ ...paneState, open: props.open }}
        minWidth={RIGHT_DOCK_MIN_WIDTH}
        defaultWidth={RIGHT_DOCK_DEFAULT_WIDTH}
        mainMinWidth={MAIN_MIN_WIDTH}
        mainTransitionTargetRef={mainRef}
        addMenuKinds={[]}
        onClosePane={() => {}}
        onCollapse={() => props.onOpenChange?.(false)}
        onOpenChange={(open) => props.onOpenChange?.(open)}
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

function findGap(): HTMLElement {
  const gap = document.querySelector<HTMLElement>("[data-slot='sidebar-gap']");
  expect(gap, "sidebar gap must be mounted").not.toBeNull();
  return gap as HTMLElement;
}

function findMain(): HTMLElement {
  const main = document.querySelector<HTMLElement>(`[data-testid='${DOCK_MAIN_TEST_ID}']`);
  expect(main, "dock main must be mounted").not.toBeNull();
  return main as HTMLElement;
}

/** Committed dock width: the --sidebar-width the open/drag/shrink flows wrote. */
function readCommittedDockWidthPx(): number {
  const raw = findWrapper().style.getPropertyValue("--sidebar-width");
  return raw.length > 0 ? Number.parseFloat(raw) : Number.NaN;
}

function readMainWidthPx(): number {
  return findMain().getBoundingClientRect().width;
}

function readGapWidthPx(): number {
  return findGap().getBoundingClientRect().width;
}

function readContainerWidthPx(): number {
  return findContainer().getBoundingClientRect().width;
}

function expectDockWidthPx(expected: number, timeout = 3_000): Promise<void> {
  return expect.poll(() => readCommittedDockWidthPx(), { timeout }).toBe(expected);
}

function expectMainWidthPx(expected: number, timeout = 3_000): Promise<void> {
  return expect.poll(() => readMainWidthPx(), { timeout }).toBeCloseTo(expected, 0);
}

function expectTerminalGeometry(expectedDockWidth: number, expectedShellWidth: number): void {
  expect(readCommittedDockWidthPx()).toBe(expectedDockWidth);
  expect(readGapWidthPx()).toBeCloseTo(expectedDockWidth, 0);
  expect(readContainerWidthPx()).toBeCloseTo(expectedDockWidth, 0);
  expect(readMainWidthPx()).toBeCloseTo(expectedShellWidth - expectedDockWidth, 0);
  const railRect = findRail().getBoundingClientRect();
  const mainRect = findMain().getBoundingClientRect();
  const railCenter = railRect.left + railRect.width / 2;
  expect(Math.abs(railCenter - mainRect.right)).toBeLessThanOrEqual(2);
}

function resizeShell(shell: HTMLElement, widthPx: number): void {
  shell.style.width = `${widthPx}px`;
}

function frameStep(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Patches pointer capture so synthetic rail drags exercise the real handlers. */
const capturedPointerIds = new Set<number>();
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;

function dispatchRailPointerDown(startX: number): void {
  const rail = findRail();
  const rect = rail.getBoundingClientRect();
  const clientY = rect.top + rect.height / 2;
  rail.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: startX,
      clientY,
      pointerId: DRAG_POINTER_ID,
    }),
  );
}

function dispatchRailPointerMove(clientX: number): void {
  const rail = findRail();
  const rect = rail.getBoundingClientRect();
  const clientY = rect.top + rect.height / 2;
  rail.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId: DRAG_POINTER_ID,
    }),
  );
}

function dispatchRailPointerUp(clientX: number): void {
  findRail().dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: 0,
      pointerId: DRAG_POINTER_ID,
    }),
  );
}

function getRailStartX(): number {
  const rect = findRail().getBoundingClientRect();
  return rect.left + rect.width / 2;
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("RightDock desktop sizing contract (AC-01..AC-12)", () => {
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

  // AC-01: widen overshoot at geometric ceiling (shell 1200 → ceiling 840)
  it("AC-01: clamps widen overshoot at geometric ceiling 840 with Main >= 360", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // Drag left by 300px (startX - clientX = +300 -> candidate width 900)
    dispatchRailPointerMove(startX - 300);
    expect(readCommittedDockWidthPx()).toBe(840);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // Extra beyond-limit moves keep geometry static
    dispatchRailPointerMove(startX - 500);
    expect(readCommittedDockWidthPx()).toBe(840);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    dispatchRailPointerUp(startX - 500);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(840);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);
    expectTerminalGeometry(840, 1200);
  });

  // AC-02: single stop, no second boundary
  it("AC-02: stops exactly once at geometric ceiling 840 on fast jump 655->900 without intermediate boundary", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // Move to 655
    dispatchRailPointerMove(startX - 55);
    expect(readCommittedDockWidthPx()).toBe(655);

    // Jump past 840 directly to 900
    dispatchRailPointerMove(startX - 300);
    expect(readCommittedDockWidthPx()).toBe(840);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    dispatchRailPointerUp(startX - 300);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(840);
    expectTerminalGeometry(840, 1200);
  });

  // AC-03: narrow overshoot at 416 floor
  it("AC-03: clamps narrow overshoot at 416 floor and keeps geometry static", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // Drag right (dx = +300 -> candidate 300 < 416)
    dispatchRailPointerMove(startX + 300);
    expect(readCommittedDockWidthPx()).toBe(RIGHT_DOCK_MIN_WIDTH);
    expect(readContainerWidthPx()).toBeCloseTo(RIGHT_DOCK_MIN_WIDTH, 0);

    // Further right overshoot
    dispatchRailPointerMove(startX + 600);
    expect(readCommittedDockWidthPx()).toBe(RIGHT_DOCK_MIN_WIDTH);
    expect(readMainWidthPx()).toBeCloseTo(1200 - RIGHT_DOCK_MIN_WIDTH, 0);

    dispatchRailPointerUp(startX + 600);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(RIGHT_DOCK_MIN_WIDTH);
    expectTerminalGeometry(RIGHT_DOCK_MIN_WIDTH, 1200);
  });

  // AC-04: shell 700 (minDock === maxDock === 340)
  it("AC-04: pins both drag gestures at 340 when shell is 700 with Main == 360", async () => {
    mounted = await render(<DockHarness shellWidth={700} open />);
    await expectDockWidthPx(340);
    await expectMainWidthPx(360);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // Drag widen
    dispatchRailPointerMove(startX - 200);
    expect(readCommittedDockWidthPx()).toBe(340);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // Drag narrow
    dispatchRailPointerMove(startX + 200);
    expect(readCommittedDockWidthPx()).toBe(340);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    dispatchRailPointerUp(startX + 200);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(340);
    expectTerminalGeometry(340, 700);
  });

  // AC-05: fast same-task release at each limit
  it("AC-05: commits final width immediately on same-task release at widen and narrow limits", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    let startX = getRailStartX();
    // Same-task widen release
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 400);
    dispatchRailPointerUp(startX - 400);
    expect(readCommittedDockWidthPx()).toBe(840);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(840);
    expectTerminalGeometry(840, 1200);

    // Same-task narrow release
    startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX + 500);
    dispatchRailPointerUp(startX + 500);
    expect(readCommittedDockWidthPx()).toBe(416);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(416);
    expectTerminalGeometry(416, 1200);
  });

  // AC-06: snapshot S0 === S1 === S2 with MutationObserver check
  it("AC-06: ensures pre-up, sync post-up, and next-frame snapshots are identical with no post-up style mutations", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 150);

    const s0Var = readCommittedDockWidthPx();
    const s0Main = readMainWidthPx();
    const s0Container = readContainerWidthPx();
    expect(s0Var).toBe(750);

    let mutationsAfterUp = 0;
    const observer = new MutationObserver((mutations) => {
      mutationsAfterUp += mutations.length;
    });
    observer.observe(findWrapper(), { attributeFilter: ["style"], attributes: true });

    dispatchRailPointerUp(startX - 150);

    const s1Var = readCommittedDockWidthPx();
    const s1Main = readMainWidthPx();
    const s1Container = readContainerWidthPx();

    expect(s1Var).toBe(s0Var);
    expect(s1Main).toBeCloseTo(s0Main, 0);
    expect(s1Container).toBeCloseTo(s0Container, 0);

    await frameStep();

    const s2Var = readCommittedDockWidthPx();
    const s2Main = readMainWidthPx();
    const s2Container = readContainerWidthPx();

    expect(s2Var).toBe(s0Var);
    expect(s2Main).toBeCloseTo(s0Main, 0);
    expect(s2Container).toBeCloseTo(s0Container, 0);

    observer.disconnect();
    expect(mutationsAfterUp).toBe(0);
    expectTerminalGeometry(750, 1200);
  });

  // AC-07: reverse after overshoot
  it("AC-07: tracks immediately when reversing pointer after overshoot without hysteresis", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // Overshoot widen (candidate 950)
    dispatchRailPointerMove(startX - 350);
    expect(readCommittedDockWidthPx()).toBe(840);

    // Still outside (candidate 900)
    dispatchRailPointerMove(startX - 300);
    expect(readCommittedDockWidthPx()).toBe(840);

    // Re-enter in-range (candidate 800) -> immediately 800
    dispatchRailPointerMove(startX - 200);
    expect(readCommittedDockWidthPx()).toBe(800);

    // Move further in-range (candidate 700)
    dispatchRailPointerMove(startX - 100);
    expect(readCommittedDockWidthPx()).toBe(700);

    // Overshoot narrow (candidate 350)
    dispatchRailPointerMove(startX + 250);
    expect(readCommittedDockWidthPx()).toBe(416);

    // Re-enter in-range from narrow (candidate 500)
    dispatchRailPointerMove(startX + 100);
    expect(readCommittedDockWidthPx()).toBe(500);

    dispatchRailPointerUp(startX + 100);
    await frameStep();
    expectTerminalGeometry(500, 1200);
  });

  // AC-08: determinism across cadences
  it("AC-08: guarantees identical stopping width regardless of drag cadence or speed", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    // Cadence 1: one big jump to 750 (delta = -150)
    let startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 150);
    const widthSingleJump = readCommittedDockWidthPx();
    // Return to start
    dispatchRailPointerMove(startX);
    dispatchRailPointerUp(startX);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(600);

    // Cadence 2: 10 small steps of 15px to 750
    startX = getRailStartX();
    dispatchRailPointerDown(startX);
    for (let i = 1; i <= 10; i += 1) {
      dispatchRailPointerMove(startX - i * 15);
    }
    const widthMultiStep = readCommittedDockWidthPx();
    dispatchRailPointerUp(startX - 150);
    await frameStep();

    expect(widthSingleJump).toBe(750);
    expect(widthMultiStep).toBe(750);
    expectTerminalGeometry(750, 1200);
  });

  // AC-09: suppression coverage and restore
  it("AC-09: suppresses transition-duration on gap, container, rail, and Main seam during drag and restores after final paint", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const container = findContainer();
    const gap = findGap();
    const rail = findRail();
    const main = findMain();

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 100);

    // During drag: 0ms on all targets
    expect(container.style.transitionDuration).toBe("0ms");
    expect(gap.style.transitionDuration).toBe("0ms");
    expect(rail.style.transitionDuration).toBe("0ms");
    expect(main.style.transitionDuration).toBe("0ms");

    dispatchRailPointerUp(startX - 100);

    // Immediately after pointerup before double-rAF: still suppressed
    expect(container.style.transitionDuration).toBe("0ms");

    // After final paint: restored
    await frameStep();
    expect(container.style.transitionDuration).toBe("");
    expect(gap.style.transitionDuration).toBe("");
    expect(rail.style.transitionDuration).toBe("");
    expect(main.style.transitionDuration).toBe("");
    expectTerminalGeometry(700, 1200);
  });

  // AC-10: shell shrink during drag
  it("AC-10: updates session bounds inward and clamps synchronously when shell shrinks during an active drag", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 150); // width = 750
    expect(readCommittedDockWidthPx()).toBe(750);

    // Mid-gesture shell shrink from 1200 to 800 (maxDock = 440)
    resizeShell(shell, 800);
    await expectDockWidthPx(440);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // Further widen move during same gesture stays clamped to 440
    dispatchRailPointerMove(startX - 300);
    expect(readCommittedDockWidthPx()).toBe(440);

    // Narrowing within new bounds works
    dispatchRailPointerMove(startX + 175); // candidate 600 - 175 = 425
    expect(readCommittedDockWidthPx()).toBe(425);

    // Shell growth does not re-grow the bound or dock
    resizeShell(shell, 1200);
    expect(readCommittedDockWidthPx()).toBe(425);

    dispatchRailPointerUp(startX + 175);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(425);
    expectTerminalGeometry(425, 1200);
  });

  // AC-11: regression suite
  describe("AC-11: sizing and layout regressions", () => {
    it("opens at half-shell default and re-centers on close/reopen", async () => {
      mounted = await render(<DockHarness shellWidth={1200} open />);
      await expectDockWidthPx(600);
      await expectMainWidthPx(600);

      await mounted.rerender(<DockHarness shellWidth={1000} open={false} />);
      await mounted.rerender(<DockHarness shellWidth={1000} open />);
      await expectDockWidthPx(500);
      await expectMainWidthPx(500);
    });

    it("shrinks below 776px shell boundary to shell - 360", async () => {
      mounted = await render(<DockHarness shellWidth={768} open />);
      await expectDockWidthPx(768 - MAIN_MIN_WIDTH);
      await expectMainWidthPx(MAIN_MIN_WIDTH);

      await mounted.rerender(<DockHarness shellWidth={500} open />);
      await expectDockWidthPx(500 - MAIN_MIN_WIDTH);
      await expectMainWidthPx(MAIN_MIN_WIDTH);
    });

    it("auto-shrinks when shell narrows and never auto-grows when shell widens", async () => {
      mounted = await render(<DockHarness shellWidth={1200} open />);
      await expectDockWidthPx(600);
      const shell = findShell();

      resizeShell(shell, 800);
      await expectDockWidthPx(800 - MAIN_MIN_WIDTH);
      await expectMainWidthPx(MAIN_MIN_WIDTH);

      resizeShell(shell, 1200);
      await expectDockWidthPx(440);
      await expectMainWidthPx(1200 - 440);
    });

    it("snaps to exact fractional ceiling without rounding up", async () => {
      mounted = await render(<DockHarness shellWidth={1200} open />);
      await expectDockWidthPx(600);
      const shell = findShell();

      resizeShell(shell, 800.5);
      await expectDockWidthPx(800.5 - MAIN_MIN_WIDTH);
      await expectMainWidthPx(MAIN_MIN_WIDTH);
    });
  });

  // AC-12: negative probe assertion
  it("AC-12: never invokes composer feasibility during Right-Dock drag and bounded options contain no shouldAcceptWidth", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // 1. In-range widen
    dispatchRailPointerMove(startX - 100);
    expect(readCommittedDockWidthPx()).toBe(700);

    // 2. Widen overshoot
    dispatchRailPointerMove(startX - 350);
    expect(readCommittedDockWidthPx()).toBe(840);

    // 3. Narrow
    dispatchRailPointerMove(startX + 100);
    expect(readCommittedDockWidthPx()).toBe(500);

    // 4. Shell shrink during drag
    resizeShell(shell, 800);
    await expectDockWidthPx(440);

    dispatchRailPointerUp(startX + 100);
    await frameStep();

    // The composer feasibility probe (real implementation wrapped in a spy) must
    // never run on the bounded dock path across any of the four drag phases.
    expect(vi.mocked(panelResize.canComposerHandlePanelWidth)).not.toHaveBeenCalled();

    // The bounded option set production RightDock passes to Sidebar comes from
    // the pure builder below; it must never carry a shouldAcceptWidth hook.
    const boundedOptions = createBoundedDockResizableOptions({
      minWidth: 340,
      maxWidth: 840,
      getMainTransitionTarget: () => null,
      resolveSessionBounds: () => ({ min: 340, max: 840 }),
      sessionHandleRef: { current: null },
    });
    expect(Object.hasOwn(boundedOptions, "shouldAcceptWidth")).toBe(false);
    expect("shouldAcceptWidth" in boundedOptions).toBe(false);
  });

  // TG-1: Safe width, tightened ceiling
  it("TG-1: safe current width receives new tightened ceiling on shell shrink, clamping next widen", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // 1. Move dock to safe width 450 (600 - 150)
    dispatchRailPointerMove(startX + 150);
    expect(readCommittedDockWidthPx()).toBe(450);

    // 2. Shrink shell to 900; new max is 540, current width 450 is safe (no immediate write)
    resizeShell(shell, 900);
    await frameStep();
    expect(readCommittedDockWidthPx()).toBe(450);
    expect(readMainWidthPx()).toBeCloseTo(450, 0);

    // 3. Next widen toward candidate 800 clamps exactly to 540
    dispatchRailPointerMove(startX - 200);
    expect(readCommittedDockWidthPx()).toBe(540);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // 4. Further overshoot is static
    dispatchRailPointerMove(startX - 400);
    expect(readCommittedDockWidthPx()).toBe(540);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // 5. Release changes nothing
    dispatchRailPointerUp(startX - 400);
    await frameStep();
    expectTerminalGeometry(540, 900);
  });

  // TG-2: Two consecutive shell shrinks in one gesture
  it("TG-2: bounds only tighten inward and never reopen on shell growth across consecutive shrinks in one gesture", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);

    // 1. Drag dock to 700
    dispatchRailPointerMove(startX - 100);
    expect(readCommittedDockWidthPx()).toBe(700);

    // 2. First shrink to 900 (maxDock = 540)
    resizeShell(shell, 900);
    await expectDockWidthPx(540);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // 3. Second shrink to 800 without ending gesture (maxDock = 440)
    resizeShell(shell, 800);
    await expectDockWidthPx(440);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // 4. Shell growth back to 1200 does not reopen bounds
    resizeShell(shell, 1200);
    expect(readCommittedDockWidthPx()).toBe(440);

    // Pointer move widening past 440 stays clamped to 440
    dispatchRailPointerMove(startX - 200);
    expect(readCommittedDockWidthPx()).toBe(440);
    expect(readMainWidthPx()).toBeCloseTo(1200 - 440, 0);

    // 5. Release is geometry-idempotent
    dispatchRailPointerUp(startX - 200);
    await frameStep();
    expectTerminalGeometry(440, 1200);
  });

  // TG-3: Suppression and handle survive rerenders
  it("TG-3: preserves active session handle, suppression, and body styles across React rerenders during drag", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);
    const shell = findShell();

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 100); // 700
    expect(readCommittedDockWidthPx()).toBe(700);

    const container = findContainer();
    const gap = findGap();
    const rail = findRail();
    const main = findMain();

    expect(container.style.transitionDuration).toBe("0ms");
    expect(gap.style.transitionDuration).toBe("0ms");
    expect(rail.style.transitionDuration).toBe("0ms");
    expect(main.style.transitionDuration).toBe("0ms");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    // Force React rerender during active drag
    await mounted.rerender(<DockHarness shellWidth={1200} open />);

    // Suppression, cursor, and user-select survive rerender
    expect(container.style.transitionDuration).toBe("0ms");
    expect(gap.style.transitionDuration).toBe("0ms");
    expect(rail.style.transitionDuration).toBe("0ms");
    expect(main.style.transitionDuration).toBe("0ms");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    // Pointermove continues tracking synchronously
    dispatchRailPointerMove(startX - 150); // 750
    expect(readCommittedDockWidthPx()).toBe(750);

    // Active session handle still tightens bounds on shell shrink
    resizeShell(shell, 900);
    await expectDockWidthPx(540);
    expect(readMainWidthPx()).toBeCloseTo(360, 0);

    // True gesture end restores transitions and body styles
    dispatchRailPointerUp(startX - 150);
    await frameStep();

    expect(container.style.transitionDuration).toBe("");
    expect(gap.style.transitionDuration).toBe("");
    expect(rail.style.transitionDuration).toBe("");
    expect(main.style.transitionDuration).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expectTerminalGeometry(540, 900);
  });

  // TG-5: Lost pointer capture
  it("TG-5: cleans up idempotently on lostpointercapture and ignores trailing events before fresh gesture", async () => {
    mounted = await render(<DockHarness shellWidth={1200} open />);
    await expectDockWidthPx(600);

    const startX = getRailStartX();
    dispatchRailPointerDown(startX);
    dispatchRailPointerMove(startX - 100); // 700
    expect(readCommittedDockWidthPx()).toBe(700);

    // Dispatch matching lostpointercapture mid-drag
    findRail().dispatchEvent(
      new PointerEvent("lostpointercapture", {
        bubbles: true,
        cancelable: true,
        pointerId: DRAG_POINTER_ID,
      }),
    );

    // Trailing move from old gesture is a no-op
    dispatchRailPointerMove(startX - 200);
    expect(readCommittedDockWidthPx()).toBe(700);

    // Trailing up from old gesture is a no-op
    dispatchRailPointerUp(startX - 200);
    expect(readCommittedDockWidthPx()).toBe(700);

    await frameStep();
    expect(findContainer().style.transitionDuration).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // Fresh gesture starts and completes normally
    const newStartX = getRailStartX();
    dispatchRailPointerDown(newStartX);
    dispatchRailPointerMove(newStartX - 50); // 700 + 50 = 750
    expect(readCommittedDockWidthPx()).toBe(750);
    dispatchRailPointerUp(newStartX - 50);
    await frameStep();
    expectTerminalGeometry(750, 1200);
  });
});
