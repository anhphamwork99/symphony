import "../../../index.css";

import { createRef, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type {
  SynaraSceneInput,
  SynaraSceneSnapshot,
} from "../ticket01/SynaraExcalidrawAdapter";
import {
  TICKET01_CARD_ID,
  TICKET01_IMAGE_ID,
  makeExcalidrawTicket01Fixture,
} from "../ticket01/excalidrawTicket01Fixture";
import {
  captureDocumentSnapshot,
  documentSnapshotsEqual,
  semanticFingerprint,
} from "./SynaraDocumentSnapshot";
import {
  ExcalidrawTicket02Harness,
  type ExcalidrawTicket02HarnessHandle,
} from "./ExcalidrawTicket02Harness";

function Shell(props: { readonly children: ReactNode }) {
  return <div style={{ height: 720, minHeight: 720, width: 1120 }}>{props.children}</div>;
}

function imageFreeFixture(): SynaraSceneInput {
  const fixture = makeExcalidrawTicket01Fixture();
  return {
    elements: fixture.elements.filter((element) => element.id !== TICKET01_IMAGE_ID),
    files: {},
  } as unknown as SynaraSceneInput;
}

function progressScene(current: SynaraSceneSnapshot, progress: number): SynaraSceneInput {
  return {
    elements: current.elements.map((element) => ({
      ...element,
      customData: {
        ...((element as Record<string, unknown>).customData as Record<string, unknown> | undefined),
        gateProgress: progress,
      },
    })),
    files: {},
  };
}

const STALE_SELECTION_ID = "ticket02-stale-selection";

async function nativeShortcut(kind: "undo" | "redo"): Promise<void> {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modifier = isMac ? "Meta" : "Control";
  const key = kind === "undo" || isMac ? "z" : "y";
  const shift = kind === "redo" && isMac;
  await userEvent.keyboard(
    `{${modifier}>}${shift ? "{Shift>}" : ""}${key}${shift ? "{/Shift}" : ""}{/${modifier}}`,
  );
}

async function waitForHarness(
  ref: { current: ExcalidrawTicket02HarnessHandle | null },
): Promise<ExcalidrawTicket02HarnessHandle> {
  await vi.waitFor(
    () => {
      expect(ref.current).not.toBeNull();
      expect(ref.current?.getAdapter().getIdentity().apiId).not.toBeNull();
      expect(ref.current?.getHistory().lockState).toBe("unlocked");
    },
    { timeout: 20_000, interval: 25 },
  );
  return ref.current as ExcalidrawTicket02HarnessHandle;
}

function canvas(): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.interactive",
  );
  expect(element, "real pinned Excalidraw interactive canvas").not.toBeNull();
  return element as HTMLCanvasElement;
}

function editorRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".excalidraw");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

async function clickNativeHistory(kind: "undo" | "redo"): Promise<void> {
  await userEvent.click(
    page.getByRole("button", {
      name: kind === "undo" ? "Undo" : "Redo",
      exact: true,
    }),
  );
}

function nativeHistoryElement(kind: "undo" | "redo"): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label")?.toLowerCase() === kind,
  );
  expect(element, `native ${kind} is observed by its stable accessible name`).toBeDefined();
  return element as HTMLButtonElement;
}

async function selectCardAndDelete(handle: ExcalidrawTicket02HarnessHandle): Promise<void> {
  const count = handle.getAdapter().captureScene().elements.length;
  const settlementCount = handle.getSettlements().length;
  editorRoot().focus();
  await userEvent.click(canvas(), { position: { x: 250, y: 205 } });
  await vi.waitFor(() =>
    expect(handle.getAdapter().captureScene().selectedElementIds).toContain(TICKET01_CARD_ID),
  );
  await waitForSettlements(handle, settlementCount + 1);
  await userEvent.keyboard("{Delete}");
  await vi.waitFor(() =>
    expect(handle.getAdapter().captureScene().elements.length).toBeLessThan(count),
  );
  await waitForSettlements(handle, settlementCount + 2);
}

async function completeThreeWriteBatch(
  handle: ExcalidrawTicket02HarnessHandle,
  batchId = "completed-batch",
): Promise<void> {
  await handle.beginFakeOperation(batchId, "fake-operation", 1);
  for (const sequence of [1, 2, 3]) {
    const receipt = handle.applyFakeProgress(
      batchId,
      sequence,
      progressScene(handle.getAdapter().captureScene(), sequence),
      1,
    );
    await receipt.acknowledgement;
    expect(handle.getHistory().events).toHaveLength(0);
  }
  await handle.completeFakeOperation(batchId);
}

async function waitForSettlements(handle: ExcalidrawTicket02HarnessHandle, count: number) {
  await vi.waitFor(() => expect(handle.getSettlements().length).toBeGreaterThanOrEqual(count), {
    timeout: 5_000,
    interval: 20,
  });
}

describe("Ticket 02 fallback dual-history Gate in stable Chromium", () => {
  beforeAll(async () => {
    await page.viewport(1280, 900);
  });

  it("proves native ownership, AI lock, three-write exactness, split clear, and stable identity", async () => {
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={imageFreeFixture()}
          scenario="gate-core-exactness"
          settlementMaxWaitMs={500}
        />
      </Shell>,
    );
    const handle = await waitForHarness(ref);
    const identity = handle.getAdapter().getIdentity();

    // Create real native history first. This human route never creates an AI event.
    await selectCardAndDelete(handle);
    expect(handle.getHistory().events).toHaveLength(0);
    const preAi = captureDocumentSnapshot(handle.getAdapter().captureScene());
    expect(nativeHistoryElement("undo").isConnected).toBe(true);

    await handle.beginFakeOperation("completed-batch", "fake-operation", 1);
    expect(handle.getHistory().lockState).toBe("ai-batch");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.getAttribute("aria-label")?.toLowerCase() === "undo",
      ),
      "the supported package view-mode lock makes its own native mutation control unavailable",
    ).toBe(false);
    const first = handle.applyFakeProgress(
      "completed-batch",
      1,
      progressScene(handle.getAdapter().captureScene(), 1),
      1,
    );
    await first.acknowledgement;
    const lockedProjection = captureDocumentSnapshot(handle.getAdapter().captureScene());

    // Package-owned controls remain present but cannot mutate during the AI lock.
    editorRoot().focus();
    await userEvent.click(canvas(), { position: { x: 600, y: 400 } });
    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Meta>}z{/Meta}");
    await nativeShortcut("undo");
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(
      documentSnapshotsEqual(
        lockedProjection,
        captureDocumentSnapshot(handle.getAdapter().captureScene()),
      ),
    ).toBe(true);

    // Plan §6.6 scenario 2: an explicit accessible activation attempt under the
    // AI lock through public user interaction only. The Synara "Undo AI batch"
    // surface is reached by stable role/name and its own data action attribute,
    // receives real keyboard focus, and Enter/Space are pressed on it; with
    // `busy` the guarded action must not mutate document content and must
    // retain its aria-disabled state.
    const lockedUndoButton = page.getByRole("button", { name: "Undo AI batch" });
    const lockedUndoElement = lockedUndoButton.element() as HTMLButtonElement;
    expect(lockedUndoElement).not.toBeNull();
    expect(lockedUndoElement.dataset.ticket02Action).toBe("undo-ai-batch");
    lockedUndoElement.focus();
    expect(document.activeElement).toBe(lockedUndoElement);
    expect(lockedUndoElement.getAttribute("aria-disabled")).toBe("true");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(
      documentSnapshotsEqual(
        lockedProjection,
        captureDocumentSnapshot(handle.getAdapter().captureScene()),
      ),
    ).toBe(true);
    expect(lockedUndoElement.getAttribute("aria-disabled")).toBe("true");
    expect(handle.getDiagnostics().filter((diagnostic) => diagnostic.severity === "critical")).toEqual([]);

    const lockedViewport = handle.getAdapter().captureViewport();
    await userEvent.wheel(canvas(), { delta: { y: 160 } });
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureViewport().scrollY).not.toBe(lockedViewport.scrollY),
    );
    const pannedViewport = handle.getAdapter().captureViewport();
    await userEvent.keyboard("{Control>}");
    await userEvent.wheel(canvas(), { delta: { y: -260 } });
    await userEvent.keyboard("{/Control}");
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureViewport().zoom).not.toBe(pannedViewport.zoom),
    );
    const retainedViewport = handle.getAdapter().captureViewport();

    for (const sequence of [2, 3]) {
      const receipt = handle.applyFakeProgress(
        "completed-batch",
        sequence,
        progressScene(handle.getAdapter().captureScene(), sequence),
        1,
      );
      await receipt.acknowledgement;
    }
    expect(handle.getHistory().events).toHaveLength(0);
    await handle.completeFakeOperation("completed-batch");
    const final = captureDocumentSnapshot(handle.getAdapter().captureScene());
    expect(
      handle.getHistory(),
      JSON.stringify({ diagnostics: handle.getDiagnostics(), trace: handle.getAdapter().getSyntheticTrace() }),
    ).toMatchObject({ cursor: 1, lockState: "unlocked" });
    expect(
      handle.getHistory().events,
      JSON.stringify({ settlements: handle.getSettlements(), diagnostics: handle.getDiagnostics() }),
    ).toHaveLength(1);
    expect(handle.getHistory().events[0]?.acceptedSyntheticWriteCount).toBe(3);
    // Establish a stale selection through the public app-state update path.
    // The selected ID is absent from the AI event's before/after elements and
    // must therefore be filtered during restore.
    handle.getAdapter().updateScene({
      appState: { selectedElementIds: { [STALE_SELECTION_ID]: true } },
    });
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().selectedElementIds).toEqual([STALE_SELECTION_ID]),
    );
    // Initial-commit clear: native Undo cannot resurrect the pre-AI deleted card.
    editorRoot().focus();
    await nativeShortcut("undo");
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(
      documentSnapshotsEqual(final, captureDocumentSnapshot(handle.getAdapter().captureScene())),
    ).toBe(true);
    expect(
      handle.getHistory().events,
      JSON.stringify({ settlements: handle.getSettlements(), diagnostics: handle.getDiagnostics() }),
    ).toHaveLength(1);

    const undoAiButton = page.getByRole("button", { name: "Undo AI batch" });
    await userEvent.click(undoAiButton);
    await vi.waitFor(() =>
      expect(
        documentSnapshotsEqual(preAi, captureDocumentSnapshot(handle.getAdapter().captureScene())),
      ).toBe(true),
    );
    expect(handle.getAdapter().captureViewport()).toEqual(retainedViewport);
    expect(handle.getAdapter().captureScene().selectedElementIds).toEqual([]);
    expect(document.activeElement).toHaveAttribute("aria-label", "Undo AI batch");
    const redo = document.querySelector<HTMLButtonElement>(
      "[data-ticket02-action='redo-ai-batch']",
    );
    expect(redo).not.toBeNull();
    await vi.waitFor(() => expect((redo as HTMLButtonElement).disabled).toBe(false));
    await vi.waitFor(() => expect((redo as HTMLButtonElement).getAttribute("aria-disabled")).toBe("false"));
    // Plan §6.6 scenario 4: Redo by Enter/Space keyboard activation of the
    // plainly labeled public AI action. A real keyboard user reaches the
    // focused Redo surface and presses Enter; on a native button this fires
    // its public click activation. No pointer event is used for Redo.
    (redo as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(redo);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(
        documentSnapshotsEqual(final, captureDocumentSnapshot(handle.getAdapter().captureScene())),
        JSON.stringify({ diagnostics: handle.getDiagnostics(), trace: handle.getAdapter().getSyntheticTrace() }),
      ).toBe(true),
    );
    expect(handle.getAdapter().captureViewport()).toEqual(retainedViewport);
    expect(handle.getAdapter().captureScene().selectedElementIds).toEqual([]);
    expect(document.activeElement).toHaveAttribute("aria-label", "Redo AI batch");
    await vi.waitFor(() => expect(handle.getCommandTraces()).toHaveLength(2));
    for (const trace of handle.getCommandTraces()) {
      expect(trace.steps).toEqual([
        "restore-write-issued",
        "restore-callback-acknowledged",
        "restore-target-verified",
        "native-history-clear-invoked",
        "native-history-clear-returned",
        "post-clear-drain-complete",
        "cursor-moved",
        "result-exposed",
        "lock-released",
      ]);
    }
    expect(handle.getAdapter().getIdentity()).toEqual(identity);
    expect(handle.getDiagnostics().filter((diagnostic) => diagnostic.severity === "critical")).toEqual([]);
    await mounted.unmount();
  });

  it("keeps native pointer/Delete/Undo/Redo human and settles changed families without AI events", async () => {
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={imageFreeFixture()}
          scenario="gate-human-changed-families"
        />
      </Shell>,
    );
    const handle = await waitForHarness(ref);
    const initialCount = handle.getAdapter().captureScene().elements.length;
    await selectCardAndDelete(handle);
    await waitForSettlements(handle, 2);
    expect(handle.getHistory().events).toHaveLength(0);

    await clickNativeHistory("undo");
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().elements.length).toBe(initialCount),
    );
    await clickNativeHistory("redo");
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().elements.length).toBeLessThan(initialCount),
    );
    await waitForSettlements(handle, 4);

    // Native keyboard shortcuts remain package-owned while the coordinator is
    // unlocked: they mutate the document but never create an AI event.
    editorRoot().focus();
    await nativeShortcut("undo");
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().elements.length).toBe(initialCount),
    );
    await waitForSettlements(handle, 5);
    expect(handle.getHistory().events).toHaveLength(0);
    editorRoot().focus();
    await nativeShortcut("redo");
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().elements.length).toBeLessThan(initialCount),
    );
    await waitForSettlements(handle, 6);
    expect(handle.getHistory().events).toHaveLength(0);

    const beforePointerDraw = handle.getAdapter().captureScene().elements.length;
    const beforePointerSettlement = handle.getSettlements().length;
    editorRoot().focus();
    await userEvent.keyboard("2");
    await userEvent.dragAndDrop(canvas(), canvas(), {
      sourcePosition: { x: 700, y: 480 },
      targetPosition: { x: 810, y: 570 },
    } as never);
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().elements.length).toBeGreaterThan(beforePointerDraw),
    );
    await waitForSettlements(handle, beforePointerSettlement + 1);

    const beforeText = handle.getAdapter().captureScene().elements.length;
    const beforeTextSettlement = handle.getSettlements().length;
    editorRoot().focus();
    await userEvent.keyboard("8");
    await userEvent.click(canvas(), { position: { x: 760, y: 350 } });
    editorRoot().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await userEvent.keyboard("Gate text");
    editorRoot().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(handle.getAdapter().captureScene().elements.length).toBeGreaterThan(beforeText),
    );
    await vi.waitFor(
      () =>
        expect(
          handle
            .getSettlements()
            .slice(beforeTextSettlement)
            .some((result) => result.family === "text-edit-composition"),
        ).toBe(true),
      { timeout: 5_000, interval: 20 },
    );

    const changed = handle.getSettlements().filter((result) => result.settled === "changed");
    expect(changed.some((result) => result.family === "discrete-keyboard-mutation")).toBe(true);
    expect(changed.some((result) => result.family === "generic-native-command")).toBe(true);
    expect(changed.some((result) => result.family === "pointer-gesture")).toBe(true);
    expect(
      changed.some((result) => result.family === "text-edit-composition"),
      JSON.stringify(handle.getSettlements()),
    ).toBe(true);
    expect(
      handle.getSettlements().some((result) => result.settled === "uncertain"),
      JSON.stringify(handle.getSettlements()),
    ).toBe(false);
    expect(handle.getHistory().events).toHaveLength(0);
    await mounted.unmount();
  });

  it("settles selection, pan, zoom, tool, focus, cancelled pointer/composition as no-op", async () => {
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={imageFreeFixture()}
          scenario="gate-human-noop-families"
        />
      </Shell>,
    );
    const handle = await waitForHarness(ref);
    await completeThreeWriteBatch(handle, "noop-history-batch");
    const eventId = handle.getHistory().events[0]?.id;
    const baselineSettlements = handle.getSettlements().length;

    editorRoot().focus();
    let boundary = handle.getSettlements().length;
    await userEvent.click(canvas(), { position: { x: 250, y: 205 } });
    await waitForSettlements(handle, ++boundary);
    boundary = handle.getSettlements().length;

    await userEvent.wheel(canvas(), { delta: { y: 120 } });
    await waitForSettlements(handle, ++boundary);
    boundary = handle.getSettlements().length;

    await userEvent.keyboard("{Control>}");
    await userEvent.wheel(canvas(), { delta: { y: -180 } });
    await userEvent.keyboard("{/Control}");
    await waitForSettlements(handle, ++boundary);
    boundary = handle.getSettlements().length;

    await userEvent.keyboard("h");
    await waitForSettlements(handle, ++boundary);
    boundary = handle.getSettlements().length;
    editorRoot().blur();
    await userEvent.keyboard("1");
    editorRoot().focus();
    await waitForSettlements(handle, ++boundary);
    boundary = handle.getSettlements().length;

    const undoAi = document.querySelector<HTMLButtonElement>(
      "[data-ticket02-action='undo-ai-batch']",
    );
    expect(undoAi).not.toBeNull();
    (undoAi as HTMLButtonElement).focus();
    editorRoot().focus();
    await waitForSettlements(handle, ++boundary);
    boundary = handle.getSettlements().length;

    const target = document.querySelector<HTMLButtonElement>(
      "[data-ticket02-cancelled-pointer-probe='true']",
    );
    expect(target).not.toBeNull();
    const beforeCancelledPointer = handle.getSettlements().length;
    (target as HTMLButtonElement).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 91, pointerType: "mouse" }),
    );
    (target as HTMLButtonElement).dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, pointerId: 1, pointerType: "mouse" }),
    );
    await waitForSettlements(handle, beforeCancelledPointer + 1);
    boundary = handle.getSettlements().length;
    editorRoot().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    editorRoot().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    editorRoot().blur();
    await waitForSettlements(handle, boundary + 1);
    expect(handle.getSettlements().length).toBeGreaterThanOrEqual(baselineSettlements + 7);

    expect(
      handle.getSettlements().some((result) => result.settled === "uncertain"),
      JSON.stringify(handle.getSettlements()),
    ).toBe(false);
    expect(handle.getSettlements().filter((result) => result.settled === "no-op").length).toBeGreaterThanOrEqual(5);
    expect(handle.getHistory().events[0]?.id).toBe(eventId);
    expect(handle.getHistory().cursor).toBe(1);
    await mounted.unmount();
  });

  it("rejects stale, delayed, duplicate, extra, and unknown synthetic provenance fail-closed", async () => {
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={imageFreeFixture()}
          scenario="gate-negative-scope-provenance"
          settlementMaxWaitMs={100}
        />
      </Shell>,
    );
    const handle = await waitForHarness(ref);
    const adapter = handle.getAdapter();
    const state = handle.getHistory();
    const identity = adapter.getIdentity();
    const context = {
      purpose: "ai-batch-progress" as const,
      canvasIdentity: state.identity.canvasIdentity,
      mountIdentity: state.identity.mountIdentity,
      apiIdentity: state.identity.apiIdentity,
      operationId: "negative-operation",
      operationGeneration: 1,
      sessionEpoch: state.identity.sessionEpoch,
      routeEpoch: state.routeEpoch,
      expectedBeforeRevision: state.mutationRevision,
    };
    adapter.setViewModeEnabled(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(() =>
      adapter.openSyntheticWriteScope({ ...context, mountIdentity: "mount-stale" }),
    ).toThrow("stale");
    expect(() =>
      adapter.openSyntheticWriteScope({ ...context, sessionEpoch: context.sessionEpoch + 1 }),
    ).toThrow("stale-session-epoch");
    expect(() =>
      adapter.openSyntheticWriteScope({ ...context, routeEpoch: context.routeEpoch + 1 }),
    ).toThrow("stale-route-epoch");
    expect(() =>
      adapter.openSyntheticWriteScope({
        ...context,
        expectedBeforeRevision: context.expectedBeforeRevision + 1,
      }),
    ).toThrow("stale-mutation-revision");

    const current = adapter.captureScene();
    const scope = adapter.openSyntheticWriteScope(context);
    const receipt = scope.issue({
      operationLocalSequence: 1,
      expectedBeforeRevision: context.expectedBeforeRevision,
      targetProjection: semanticFingerprint(current),
      apply: () => adapter.restoreScene(current),
    });
    await receipt.acknowledgement;
    await scope.drain();
    const closing = scope.close();
    await Promise.resolve();
    const delayed = {
      ...current,
      elements: current.elements.map((element) => ({
        ...element,
        customData: {
          ...((element as Record<string, unknown>).customData as Record<string, unknown> | undefined),
          delayedDuplicate: true,
        },
      })),
    };
    adapter.restoreScene(delayed);
    await vi.waitFor(() =>
      expect(
        handle.getDiagnostics().some((diagnostic) => diagnostic.code === "duplicate-synthetic-callback"),
      ).toBe(true),
    );
    await closing;
    // A callback after the bounded tombstone horizon is still synthetic or
    // unknown; it must not be reclassified as a human edit after unlock.
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    adapter.restoreScene(delayed);
    await vi.waitFor(() =>
      expect(
        handle.getDiagnostics().some(
          (diagnostic) => diagnostic.code === "unknown-callback-provenance",
        ),
      ).toBe(true),
    );
    expect(handle.getHistory().lockState).toBe("locked-fault");
    expect(adapter.getIdentity()).toEqual(identity);
    await mounted.unmount();

    const unknownRef = createRef<ExcalidrawTicket02HarnessHandle>();
    const unknownMounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={unknownRef}
          initialScene={imageFreeFixture()}
          scenario="gate-negative-unknown-provenance"
          settlementMaxWaitMs={100}
        />
      </Shell>,
    );
    const unknownHandle = await waitForHarness(unknownRef);
    const unknownAdapter = unknownHandle.getAdapter();
    const unknownState = unknownHandle.getHistory();
    unknownAdapter.setViewModeEnabled(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    unknownAdapter.openSyntheticWriteScope({
      ...context,
      mountIdentity: unknownState.identity.mountIdentity,
      apiIdentity: unknownState.identity.apiIdentity,
      sessionEpoch: unknownState.identity.sessionEpoch,
      routeEpoch: unknownState.routeEpoch,
      expectedBeforeRevision: unknownState.mutationRevision,
    });
    const unknownCurrent = unknownAdapter.captureScene();
    unknownAdapter.restoreScene({
      ...unknownCurrent,
      elements: unknownCurrent.elements.map((element) => ({
        ...element,
        customData: {
          ...((element as Record<string, unknown>).customData as Record<string, unknown> | undefined),
          unknownCallback: true,
        },
      })),
    });
    await vi.waitFor(() =>
      expect(unknownHandle.getHistory().lockState).toBe("locked-fault"),
    );
    expect(
      unknownHandle.getDiagnostics().some(
        (diagnostic) => diagnostic.code === "unknown-callback-provenance",
      ),
    ).toBe(true);
    expect(unknownHandle.getHistory().cursor).toBe(0);
    expect(unknownHandle.getHistory().events).toHaveLength(0);
    await unknownMounted.unmount();

    const staleGenerationRef = createRef<ExcalidrawTicket02HarnessHandle>();
    const staleGenerationMounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={staleGenerationRef}
          initialScene={imageFreeFixture()}
          scenario="gate-negative-stale-generation"
          settlementMaxWaitMs={100}
        />
      </Shell>,
    );
    const staleGeneration = await waitForHarness(staleGenerationRef);
    await staleGeneration.beginFakeOperation("stale-batch", "stale-operation", 2);
    expect(() =>
      staleGeneration.applyFakeProgress(
        "stale-batch",
        1,
        progressScene(staleGeneration.getAdapter().captureScene(), 1),
        1,
      ),
    ).toThrow("stale operation generation");
    expect(
      staleGeneration.getDiagnostics().some(
        (diagnostic) => diagnostic.code === "stale-operation-generation",
      ),
    ).toBe(true);
    await staleGenerationMounted.unmount();
  });
});
