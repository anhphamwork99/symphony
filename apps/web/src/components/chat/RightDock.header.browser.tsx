// FILE: RightDock.header.browser.tsx
// Purpose: Browser coverage for the right-dock header tab strip geometry: the
// Add-panel control rides INSIDE the horizontal tab scroller immediately after
// the last tab (scrolling with it on overflow), while Collapse stays OUTSIDE the
// scroller as a pinned header sibling. Add/collapse callbacks keep firing.
// Layer: Web DOM geometry tests
// Depends on: RightDock header + tab strip classes, real browser layout at the
// user-feedback viewport (1500x805), and Base UI menu popup behavior.

// Production CSS is part of the behavior under test: the tab strip's
// overflow-x-auto scroller only produces real overflow geometry when the real
// Tailwind utilities are applied to the real flex header.
import "../../index.css";

import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  type RightDockPaneKind,
  type RightDockThreadState,
  closePaneInState,
  openPaneInState,
} from "~/rightDockStore.logic";
import { RIGHT_DOCK_ADD_MENU_KINDS } from "./rightDockPaneMeta";
import { RIGHT_DOCK_DEFAULT_WIDTH, RIGHT_DOCK_MIN_WIDTH, RightDock } from "./RightDock";

const USER_FEEDBACK_VIEWPORT = { width: 1500, height: 805 } as const;

const ADD_BUTTON_LABEL = "Add panel";
const COLLAPSE_BUTTON_LABEL = "Collapse panel";

/** Long tab labels so a handful of panes force the strip to overflow. */
function paneLabel(paneId: string): string {
  return `Overflowing tab ${paneId.replace(/^pane-/, "")}`;
}

function findTabStrip(): HTMLElement {
  const strip = document.querySelector<HTMLElement>("[data-right-dock-tab-strip]");
  expect(strip, "tab strip scroller must be mounted").not.toBeNull();
  return strip as HTMLElement;
}

function findTriggerButton(label: string): HTMLButtonElement {
  // The add menu trigger renders a real <button data-slot='menu-trigger'>; the
  // collapse control is a plain icon button. Both are reachable by label.
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  expect(button, `${label} button must be mounted`).not.toBeNull();
  return button as HTMLButtonElement;
}

/**
 * The Add menu's <Menu> root wraps the trigger in a fragment-level container,
 * so the trigger's relevant scroller child is the element Menu contributes.
 * Climbing to the direct child of the strip gives a stable "last tab row item".
 */
function stripChildFor(strip: HTMLElement, element: HTMLElement): HTMLElement {
  let current: HTMLElement | null = element;
  while (current && current.parentElement !== strip) {
    current = current.parentElement;
  }
  expect(current, "element must descend from the tab strip").not.toBeNull();
  return current as HTMLElement;
}

/** "file" is the only multi-instance pane kind, so several tabs can coexist. */
function openOverflowingPanes(count: number): RightDockThreadState {
  let state: RightDockThreadState = {
    open: true,
    preferredWidthPx: null,
    panes: [],
    activePaneId: null,
  };
  for (let index = 0; index < count; index += 1) {
    state = openPaneInState(state, {
      paneId: `pane-${index}`,
      kind: "file",
      filePath: `src/overflowing-file-name-${index}.tsx`,
    });
  }
  return state;
}

function HeaderHarness(props: {
  state: RightDockThreadState;
  onAddPane?: (kind: RightDockPaneKind) => void;
  onCollapse?: () => void;
}) {
  const [paneState, setPaneState] = useState(props.state);
  const paneLabelOverrides = Object.fromEntries(
    paneState.panes.map((pane) => [pane.id, paneLabel(pane.id)]),
  );
  return (
    <div
      data-testid="dock-shell"
      style={{
        display: "flex",
        height: "600px",
        marginLeft: "auto",
        overflow: "hidden",
        width: `${USER_FEEDBACK_VIEWPORT.width}px`,
      }}
    >
      <main style={{ flex: "1 1 0%", minWidth: 0 }} />
      <RightDock
        state={paneState}
        minWidth={RIGHT_DOCK_MIN_WIDTH}
        defaultWidth={RIGHT_DOCK_DEFAULT_WIDTH}
        addMenuKinds={RIGHT_DOCK_ADD_MENU_KINDS}
        paneLabelOverrides={paneLabelOverrides}
        onSelectPane={() => {}}
        onClosePane={(paneId) => setPaneState(closePaneInState(paneState, paneId))}
        onCollapse={props.onCollapse ?? (() => {})}
        onOpenChange={() => {}}
        onAddPane={props.onAddPane ?? (() => {})}
        motionKey="header-harness"
        renderPane={() => <div data-right-dock-test-pane />}
      />
    </div>
  );
}

describe("RightDock header Add-panel placement (user feedback 1500x805)", () => {
  beforeAll(async () => {
    await page.viewport(USER_FEEDBACK_VIEWPORT.width, USER_FEEDBACK_VIEWPORT.height);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps the Add-panel trigger inside the tab scroller immediately after the last tab", async () => {
    await render(<HeaderHarness state={openOverflowingPanes(8)} />);

    await vi.waitFor(() => {
      expect(document.querySelector("[data-right-dock-tab-strip]")).not.toBeNull();
    });

    const strip = findTabStrip();
    const addTrigger = findTriggerButton(ADD_BUTTON_LABEL);
    const collapseTrigger = findTriggerButton(COLLAPSE_BUTTON_LABEL);

    // The Add trigger is a DOM descendant of the tab-strip scroller; the
    // Collapse control lives outside it as a pinned header sibling.
    expect(strip.contains(addTrigger)).toBe(true);
    expect(strip.contains(collapseTrigger)).toBe(false);

    // The Add trigger is the LAST strip child: immediately after the mapped
    // tabs, with nothing between it and the strip's trailing edge.
    const lastTabRowItem = stripChildFor(strip, addTrigger);
    expect(Array.from(strip.children).indexOf(lastTabRowItem)).toBe(
      strip.children.length - 1,
    );

    // Real overflow geometry: strip content is wider than the visible box, so
    // the Add trigger (after the last tab) is clipped until the strip scrolls.
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);

    const stripRect = strip.getBoundingClientRect();
    const addRectBefore = addTrigger.getBoundingClientRect();
    expect(addRectBefore.right).toBeGreaterThan(stripRect.right);

    // The pinned Collapse control starts right where the scroller ends and is
    // fully inside the header row (never clipped, no scroll of its own).
    const headerRow = strip.parentElement as HTMLElement;
    const headerRowRect = headerRow.getBoundingClientRect();
    const collapseRectBefore = collapseTrigger.getBoundingClientRect();
    expect(collapseRectBefore.left).toBeGreaterThanOrEqual(stripRect.right - 1);
    expect(collapseRectBefore.right).toBeLessThanOrEqual(headerRowRect.right + 1);

    // Scrolling the tab strip to its end brings the Add trigger fully into the
    // visible box — proof the control scrolls WITH the tabs in one scroller.
    strip.scrollLeft = strip.scrollWidth;
    await vi.waitFor(() => {
      expect(addTrigger.getBoundingClientRect().right).toBeLessThanOrEqual(stripRect.right + 1);
    });

    // ...while the pinned Collapse control never moves.
    const collapseRectAfter = collapseTrigger.getBoundingClientRect();
    expect(collapseRectAfter.left).toBe(collapseRectBefore.left);
    expect(collapseRectAfter.right).toBe(collapseRectBefore.right);
  });

  it("opens the Add-panel menu, fires onAddPane with the picked kind, and Collapse fires onCollapse", async () => {
    const onAddPane = vi.fn();
    const onCollapse = vi.fn();
    await render(
      <HeaderHarness
        state={openOverflowingPanes(2)}
        onAddPane={onAddPane}
        onCollapse={onCollapse}
      />,
    );

    await vi.waitFor(() => {
      expect(findTriggerButton(ADD_BUTTON_LABEL)).toBeTruthy();
    });

    await page.getByRole("button", { name: ADD_BUTTON_LABEL }).click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-slot='menu-popup']")).not.toBeNull();
    });
    await page.getByText("Terminal").click();
    expect(onAddPane).toHaveBeenCalledWith("terminal");

    await page.getByRole("button", { name: COLLAPSE_BUTTON_LABEL }).click();
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it("hides the Add-panel trigger when no panes are open but keeps Collapse pinned", async () => {
    const onCollapse = vi.fn();
    await render(
      <HeaderHarness
        state={{ open: true, preferredWidthPx: null, panes: [], activePaneId: null }}
        onCollapse={onCollapse}
      />,
    );

    await vi.waitFor(() => {
      expect(findTriggerButton(COLLAPSE_BUTTON_LABEL)).toBeTruthy();
    });

    const addButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
      (candidate) => candidate.getAttribute("aria-label") === ADD_BUTTON_LABEL,
    );
    expect(addButtons).toHaveLength(0);
    expect(findTabStrip().children.length).toBe(0);

    await page.getByRole("button", { name: COLLAPSE_BUTTON_LABEL }).click();
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
