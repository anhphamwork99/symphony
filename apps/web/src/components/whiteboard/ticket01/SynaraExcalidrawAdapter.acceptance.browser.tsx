// FILE: SynaraExcalidrawAdapter.acceptance.browser.tsx
// Purpose: Real-Chromium acceptance evidence for Ticket 01 AC1-AC5.
// Boundary: the production-compatible lazy harness and the official Excalidraw
// 0.18.1 public APIs. No editor, restore, serialization, or export mocks.

import "../../../index.css";

import { restore } from "@excalidraw/excalidraw";
import { createRef, forwardRef, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  ExcalidrawTicket01Harness,
  type ExcalidrawTicket01HarnessHandle,
} from "./ExcalidrawTicket01Harness";
import {
  EXCALIDRAW_TICKET01_FIXTURE,
  makeExcalidrawTicket01Fixture,
  TICKET01_CARD_ID,
  TICKET01_CARD_TEXT_ID,
  TICKET01_CONNECTOR_ID,
  TICKET01_FRAME_ID,
  TICKET01_GROUP_ID,
  TICKET01_IMAGE_ID,
  TICKET01_TARGET_ID,
  type ExcalidrawTicket01Scene,
} from "./excalidrawTicket01Fixture";
import {
  compareExcalidrawTicket01Semantics,
  projectExcalidrawTicket01Semantics,
} from "./excalidrawTicket01Semantics";
import type {
  SynaraExcalidrawDiagnostic,
  SynaraSceneInput,
  SynaraSceneUpdate,
  SynaraSelectionObservation,
  SynaraViewport,
} from "./SynaraExcalidrawAdapter";

const PACKAGE_VERSION = "0.18.1" as const;
const BROWSER_VIEWPORT = { width: 1280, height: 860 } as const;
const SETTLEMENT_DELAY_MS = 80;

type TestHarnessProps = {
  readonly initialScene?: SynaraSceneInput;
  readonly viewModeEnabled?: boolean;
  readonly selectionSettlementDelayMs?: number;
  readonly selectionSettlementTimeoutMs?: number;
  readonly selectionStabilityCheck?: (selectedElementIds: readonly string[]) => boolean;
  readonly adapterLoadFailure?: string;
  readonly scenario: string;
  readonly onDiagnostic?: (diagnostic: SynaraExcalidrawDiagnostic) => void;
  readonly onRawSelection?: (observation: SynaraSelectionObservation) => void;
  readonly onSettledSelection?: (observation: SynaraSelectionObservation) => void;
  readonly onViewportChange?: (viewport: SynaraViewport) => void;
};

const RehydratableHarness = forwardRef<
  ExcalidrawTicket01HarnessHandle,
  TestHarnessProps & { readonly generation: number }
>((props, ref) => (
  <ExcalidrawTicket01Harness
    key={props.generation}
    ref={ref}
    {...(props.initialScene !== undefined ? { initialScene: props.initialScene } : {})}
    {...(props.viewModeEnabled !== undefined ? { viewModeEnabled: props.viewModeEnabled } : {})}
    {...(props.selectionSettlementDelayMs !== undefined
      ? { selectionSettlementDelayMs: props.selectionSettlementDelayMs }
      : {})}
    {...(props.selectionSettlementTimeoutMs !== undefined
      ? { selectionSettlementTimeoutMs: props.selectionSettlementTimeoutMs }
      : {})}
    {...(props.selectionStabilityCheck !== undefined
      ? { selectionStabilityCheck: props.selectionStabilityCheck }
      : {})}
    {...(props.adapterLoadFailure !== undefined
      ? { adapterLoadFailure: props.adapterLoadFailure }
      : {})}
    scenario={props.scenario}
    {...(props.onDiagnostic !== undefined ? { onDiagnostic: props.onDiagnostic } : {})}
    {...(props.onRawSelection !== undefined ? { onRawSelection: props.onRawSelection } : {})}
    {...(props.onSettledSelection !== undefined
      ? { onSettledSelection: props.onSettledSelection }
      : {})}
    {...(props.onViewportChange !== undefined ? { onViewportChange: props.onViewportChange } : {})}
  />
));
RehydratableHarness.displayName = "RehydratableHarness";

function BrowserShell(props: { readonly children: ReactNode }) {
  return (
    <div style={{ height: "700px", minHeight: "700px", width: "1100px" }}>{props.children}</div>
  );
}

function mutableProgressScene(progress: number): SynaraSceneInput {
  return {
    elements: EXCALIDRAW_TICKET01_FIXTURE.elements.map((element) => ({
      ...element,
      customData: { ...element.customData, progress },
    })),
    files: EXCALIDRAW_TICKET01_FIXTURE.files as unknown as NonNullable<SynaraSceneInput["files"]>,
  };
}

function selectionUpdate(sequence: number, selectedIds: readonly string[]): SynaraSceneUpdate {
  return {
    sequence,
    appState: { selectedElementIds: Object.fromEntries(selectedIds.map((id) => [id, true])) },
  } as unknown as SynaraSceneUpdate;
}

async function waitForApi(handleRef: { current: ExcalidrawTicket01HarnessHandle | null }) {
  await vi.waitFor(
    () => {
      expect(handleRef.current).not.toBeNull();
      expect(
        handleRef.current?.getLifecycleEvents().some((event) => event.kind === "api-ready"),
      ).toBe(true);
    },
    { timeout: 20_000, interval: 25 },
  );
  return handleRef.current as ExcalidrawTicket01HarnessHandle;
}

async function waitForSettledSelection(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs + 30));
}

function sceneFromOfficialRestore(value: unknown): ExcalidrawTicket01Scene {
  const restored = restore(value as never, null, null, {
    refreshDimensions: true,
    repairBindings: true,
  });
  return {
    elements: restored.elements as unknown as ExcalidrawTicket01Scene["elements"],
    files: restored.files as unknown as ExcalidrawTicket01Scene["files"],
  };
}

function diagnosticFor(diagnostics: readonly SynaraExcalidrawDiagnostic[], code: string) {
  const diagnostic = diagnostics.find((candidate) => candidate.code === code);
  expect(diagnostic, `expected structured diagnostic ${code}`).toBeDefined();
  expect(diagnostic).toMatchObject({ packageVersion: PACKAGE_VERSION });
  return diagnostic as SynaraExcalidrawDiagnostic;
}

function canvasElement(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.interactive");
  expect(canvas, "the real Excalidraw canvas must be mounted").not.toBeNull();
  return canvas as HTMLCanvasElement;
}

async function assertDecodablePng(blob: Blob): Promise<void> {
  expect(blob.type).toBe("image/png");
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  expect([...signature]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const bitmap = await createImageBitmap(blob);
  expect(bitmap.width).toBeGreaterThan(0);
  expect(bitmap.height).toBeGreaterThan(0);
  bitmap.close();
}

function assertMeaningfulSvg(markup: string): void {
  const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  expect(root.tagName.toLowerCase()).toBe("svg");
  const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  const dimensions = [root.getAttribute("width"), root.getAttribute("height")].map((value) =>
    value === null ? null : Number.parseFloat(value),
  );
  expect(
    (viewBox?.length === 4 &&
      viewBox.slice(2).every((value) => Number.isFinite(value) && value > 0)) ||
      dimensions.every((value) => value !== null && Number.isFinite(value) && value > 0),
  ).toBe(true);
  expect(root.childElementCount).toBeGreaterThan(0);
}

afterEach(() => {
  document.body.replaceChildren();
});

beforeAll(async () => {
  await page.viewport(BROWSER_VIEWPORT.width, BROWSER_VIEWPORT.height);
});

describe("Synara Excalidraw Ticket 01 real-Chromium acceptance", () => {
  it("AC1-AC2: hydrates, persists, rehydrates, exports, and preserves semantic meaning", async () => {
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const firstMount = await render(
      <BrowserShell>
        <RehydratableHarness
          ref={handleRef}
          generation={1}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          scenario="ac1-ac2-round-trip"
        />
      </BrowserShell>,
    );
    const firstHandle = await waitForApi(handleRef);
    const firstIdentity = firstHandle.getIdentity();
    expect(firstIdentity.apiId).toEqual(
      firstHandle.getLifecycleEvents().find((event) => event.kind === "api-ready")?.apiId,
    );
    expect(document.querySelector('[data-ticket01-status="ready"]')).not.toBeNull();
    expect(firstHandle.getDiagnostics()).toEqual([]);

    const firstSnapshot = firstHandle.captureScene();
    expect(firstSnapshot.elements).toHaveLength(EXCALIDRAW_TICKET01_FIXTURE.elements.length);
    expect(firstSnapshot.files).toHaveProperty("file-excalidraw-mark");
    const originalToFirst = compareExcalidrawTicket01Semantics(
      EXCALIDRAW_TICKET01_FIXTURE,
      firstSnapshot as unknown as ExcalidrawTicket01Scene,
    );
    expect(originalToFirst.equal, originalToFirst.diagnostics.join("\n")).toBe(true);
    const firstSemantics = projectExcalidrawTicket01Semantics(
      firstSnapshot as unknown as ExcalidrawTicket01Scene,
    );
    expect(firstSemantics.elements.map((element) => element.id)).toEqual(
      projectExcalidrawTicket01Semantics(EXCALIDRAW_TICKET01_FIXTURE).elements.map(
        (element) => element.id,
      ),
    );
    expect(
      firstSemantics.elements.find((element) => element.id === TICKET01_CARD_TEXT_ID),
    ).toMatchObject({
      relationships: {
        containerId: TICKET01_CARD_ID,
        groupIds: [TICKET01_GROUP_ID],
        frameId: TICKET01_FRAME_ID,
      },
    });
    expect(
      firstSemantics.elements.find((element) => element.id === TICKET01_CONNECTOR_ID),
    ).toMatchObject({
      relationships: {
        startBinding: { elementId: TICKET01_CARD_ID },
        endBinding: { elementId: TICKET01_TARGET_ID },
      },
    });
    expect(
      firstSemantics.elements.find((element) => element.id === TICKET01_IMAGE_ID)?.image,
    ).toMatchObject({
      fileId: "file-excalidraw-mark",
      fileAvailable: true,
      mimeType: "image/png",
    });
    expect(firstSemantics.elements.some((element) => element.customData !== null)).toBe(true);

    const editablePayload = firstHandle.serializeScene();
    expect(editablePayload.length).toBeGreaterThan(0);
    const parsedPayload = JSON.parse(editablePayload) as {
      readonly type?: string;
      readonly elements?: unknown;
    };
    expect(parsedPayload.type).toBe("excalidraw");
    expect(parsedPayload.elements).toHaveLength(EXCALIDRAW_TICKET01_FIXTURE.elements.length);

    const restoredPayload = sceneFromOfficialRestore(parsedPayload);
    const secondMount = await firstMount.rerender(
      <BrowserShell>
        <RehydratableHarness
          ref={handleRef}
          generation={2}
          initialScene={restoredPayload as unknown as SynaraSceneInput}
          scenario="ac1-ac2-round-trip"
        />
      </BrowserShell>,
    );
    void secondMount;
    const secondHandle = await waitForApi(handleRef);
    const secondIdentity = secondHandle.getIdentity();
    expect(secondIdentity.mountId).not.toBe(firstIdentity.mountId);
    expect(secondIdentity.apiId).not.toBe(firstIdentity.apiId);
    expect(secondHandle.getDiagnostics()).toEqual([]);

    const secondSnapshot = secondHandle.captureScene();
    const semanticComparison = compareExcalidrawTicket01Semantics(
      firstSnapshot as unknown as ExcalidrawTicket01Scene,
      secondSnapshot as unknown as ExcalidrawTicket01Scene,
    );
    expect(semanticComparison.equal, semanticComparison.diagnostics.join("\n")).toBe(true);
    expect(
      projectExcalidrawTicket01Semantics(secondSnapshot as unknown as ExcalidrawTicket01Scene),
    ).toEqual(semanticComparison.after);

    const svg = await secondHandle.exportSvg();
    assertMeaningfulSvg(svg);
    expect(svg).toContain("Official API boundary");
    const png = await secondHandle.exportPng();
    expect(png.size).toBeGreaterThan(100);
    await assertDecodablePng(png);

    await firstMount.unmount();
  });

  it("AC3: applies ordered intermediate updates without remounting or losing viewport", async () => {
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const mounted = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={handleRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          scenario="ac3-progressive-updates"
        />
      </BrowserShell>,
    );
    const handle = await waitForApi(handleRef);
    const identity = handle.getIdentity();
    const viewport = { scrollX: 145, scrollY: -70, zoom: 1.35 } satisfies SynaraViewport;
    handle.restoreViewport(viewport);
    await vi.waitFor(() => expect(handle.captureViewport()).toEqual(viewport));

    handle.updateScene({ sequence: 1, ...mutableProgressScene(1) });
    await vi.waitFor(() =>
      expect(handle.captureScene().elements[0]?.customData).toMatchObject({ progress: 1 }),
    );
    const intermediateOne = handle.captureScene();
    expect(intermediateOne.elements[0]?.customData).toMatchObject({ progress: 1 });
    expect(handle.getIdentity()).toEqual(identity);
    expect(handle.captureViewport()).toEqual(viewport);

    handle.updateScene({ sequence: 2, ...mutableProgressScene(2) });
    await vi.waitFor(() =>
      expect(handle.captureScene().elements[0]?.customData).toMatchObject({ progress: 2 }),
    );
    const intermediateTwo = handle.captureScene();
    expect(intermediateTwo.elements[0]?.customData).toMatchObject({ progress: 2 });
    expect(intermediateTwo.elements[0]?.customData).not.toMatchObject({ progress: 1 });
    expect(handle.getIdentity()).toEqual(identity);
    expect(handle.captureViewport()).toEqual(viewport);
    expect(
      handle
        .getLifecycleEvents()
        .filter((event) => event.kind === "update-applied")
        .map((event) => event.updateSequence),
    ).toEqual([1, 2]);

    expect(() => handle.updateScene({ sequence: 4, ...mutableProgressScene(4) })).toThrow(
      "expected scene update 3, received 4",
    );
    const mismatch = diagnosticFor(handle.getDiagnostics(), "update-order-mismatch");
    expect(mismatch).toMatchObject({ ac: "AC3", phase: "imperative-update", recoverable: false });

    await mounted.unmount();
  });

  it("AC4: blocks element mutation in view mode while real pan/zoom remain available", async () => {
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const mounted = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={handleRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          viewModeEnabled
          scenario="ac4-view-lock"
        />
      </BrowserShell>,
    );
    const handle = await waitForApi(handleRef);
    const baselineElementCount = handle.captureScene().elements.length;
    const canvas = canvasElement();
    document.querySelector<HTMLElement>(".excalidraw")?.focus();
    await userEvent.click(canvas, { position: { x: 250, y: 205 } });
    await userEvent.keyboard("{Delete}");
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(handle.captureScene().elements).toHaveLength(baselineElementCount);

    const lockedViewport = handle.captureViewport();
    await userEvent.wheel(canvas, { delta: { y: 160 } });
    await vi.waitFor(() =>
      expect(handle.captureViewport().scrollY).not.toBe(lockedViewport.scrollY),
    );
    const pannedViewport = handle.captureViewport();
    await userEvent.keyboard("{Control>}");
    await userEvent.wheel(canvas, { delta: { y: -260 } });
    await userEvent.keyboard("{/Control}");
    await vi.waitFor(() => expect(handle.captureViewport().zoom).not.toBe(pannedViewport.zoom));

    handle.setViewModeEnabled(false);
    handle.restoreViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
    await vi.waitFor(() =>
      expect(handle.captureViewport()).toEqual({ scrollX: 0, scrollY: 0, zoom: 1 }),
    );
    document.querySelector<HTMLElement>(".excalidraw")?.focus();
    await userEvent.click(canvas, { position: { x: 250, y: 205 } });
    await vi.waitFor(() =>
      expect(handle.captureScene().selectedElementIds).toContain(TICKET01_CARD_ID),
    );
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() =>
      expect(handle.captureScene().elements.length).toBeLessThan(baselineElementCount),
    );
    expect(handle.getDiagnostics()).toEqual([]);

    await mounted.unmount();
  });

  it("AC5: observes zero-delay and settled selection traces plus viewport capture/restore", async () => {
    const raw: SynaraSelectionObservation[] = [];
    const settled: SynaraSelectionObservation[] = [];
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const mounted = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={handleRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          selectionSettlementDelayMs={0}
          scenario="ac5-selection-zero-delay"
          onRawSelection={(observation) => raw.push(observation)}
          onSettledSelection={(observation) => settled.push(observation)}
        />
      </BrowserShell>,
    );
    const handle = await waitForApi(handleRef);

    handle.updateScene(selectionUpdate(1, [TICKET01_CARD_ID]));
    handle.updateScene(selectionUpdate(2, [TICKET01_CARD_ID]));
    await waitForSettledSelection(0);
    handle.updateScene(selectionUpdate(3, [TICKET01_TARGET_ID]));
    await waitForSettledSelection(0);
    handle.updateScene(selectionUpdate(4, []));
    await waitForSettledSelection(0);

    const rawIds = raw.map((observation) => observation.selectedElementIds);
    const settledIds = settled.map((observation) => observation.selectedElementIds);
    expect(rawIds).toContainEqual([TICKET01_CARD_ID]);
    expect(rawIds).toContainEqual([TICKET01_TARGET_ID]);
    expect(rawIds).toContainEqual([]);
    expect(settledIds).toContainEqual([TICKET01_CARD_ID]);
    expect(settledIds).toContainEqual([TICKET01_TARGET_ID]);
    expect(settledIds).toContainEqual([]);
    expect(settledIds.filter((ids) => ids.join(",") === TICKET01_CARD_ID)).toHaveLength(1);

    const restoredViewport = { scrollX: 210, scrollY: -95, zoom: 1.2 } satisfies SynaraViewport;
    handle.restoreViewport(restoredViewport);
    await vi.waitFor(() => expect(handle.captureViewport()).toEqual(restoredViewport));

    await mounted.unmount();
  });

  it("AC5: non-zero settlement coalesces rapid replacement and exposes timing", async () => {
    const raw: SynaraSelectionObservation[] = [];
    const settled: SynaraSelectionObservation[] = [];
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const mounted = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={handleRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          selectionSettlementDelayMs={SETTLEMENT_DELAY_MS}
          scenario="ac5-selection-settled-delay"
          onRawSelection={(observation) => raw.push(observation)}
          onSettledSelection={(observation) => settled.push(observation)}
        />
      </BrowserShell>,
    );
    const handle = await waitForApi(handleRef);

    const startedAt = Date.now();
    handle.updateScene(selectionUpdate(1, [TICKET01_CARD_ID]));
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    handle.updateScene(selectionUpdate(2, [TICKET01_TARGET_ID]));
    await waitForSettledSelection(SETTLEMENT_DELAY_MS);
    const settledAt = Date.now();
    handle.updateScene(selectionUpdate(3, []));
    await waitForSettledSelection(SETTLEMENT_DELAY_MS);

    expect(raw.map((observation) => observation.selectedElementIds)).toContainEqual([
      TICKET01_CARD_ID,
    ]);
    expect(raw.map((observation) => observation.selectedElementIds)).toContainEqual([
      TICKET01_TARGET_ID,
    ]);
    expect(settled.map((observation) => observation.selectedElementIds)).not.toContainEqual([
      TICKET01_CARD_ID,
    ]);
    expect(settled.map((observation) => observation.selectedElementIds)).toContainEqual([
      TICKET01_TARGET_ID,
    ]);
    expect(settled.map((observation) => observation.selectedElementIds)).toContainEqual([]);
    expect(settledAt - startedAt).toBeGreaterThanOrEqual(SETTLEMENT_DELAY_MS);
    expect(settled.at(-1)?.observedAt).toBeGreaterThanOrEqual(settledAt);

    await mounted.unmount();
  });

  it("retains structured diagnostics for malformed scenes and nearest public negative boundaries", async () => {
    const loadFailureRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const loadFailure = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={loadFailureRef}
          adapterLoadFailure="injected lazy-loader failure"
          scenario="negative-lazy-load"
        />
      </BrowserShell>,
    );
    await vi.waitFor(() =>
      expect(
        loadFailureRef.current
          ?.getDiagnostics()
          .some((diagnostic) => diagnostic.code === "lazy-load-failed"),
      ).toBe(true),
    );
    expect(
      diagnosticFor(loadFailureRef.current!.getDiagnostics(), "lazy-load-failed"),
    ).toMatchObject({
      ac: "AC1",
      phase: "lazy-loader",
      recoverable: false,
    });
    await loadFailure.unmount();

    const notReadyRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const notReady = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={notReadyRef}
          adapterLoadFailure="adapter is intentionally unavailable"
          scenario="negative-api-not-ready"
        />
      </BrowserShell>,
    );
    expect(notReadyRef.current).not.toBeNull();
    expect(() => notReadyRef.current!.serializeScene()).toThrow();
    expect(() => notReadyRef.current!.exportSvg()).toThrow();
    expect(() => notReadyRef.current!.exportPng()).toThrow();
    expect(() => notReadyRef.current!.updateScene(selectionUpdate(1, []))).toThrow();
    expect(() =>
      notReadyRef.current!.restoreViewport({ scrollX: 0, scrollY: 0, zoom: 1 }),
    ).toThrow();
    expect(
      notReadyRef
        .current!.getDiagnostics()
        .some((diagnostic) => ["adapter-not-ready", "api-not-ready"].includes(diagnostic.code)),
    ).toBe(true);
    await notReady.unmount();

    const malformedRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const malformed = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={malformedRef}
          initialScene={{ elements: "not-an-array" } as unknown as SynaraSceneInput}
          scenario="negative-malformed-scene"
        />
      </BrowserShell>,
    );
    await vi.waitFor(() =>
      expect(malformedRef.current?.getDiagnostics().length).toBeGreaterThan(0),
    );
    const hydrationFailure = diagnosticFor(
      malformedRef.current!.getDiagnostics(),
      "hydration-failed",
    );
    expect(hydrationFailure).toMatchObject({
      ac: "AC2",
      phase: "initial-hydration",
      expected: "the supplied scene is restored through the official public utility",
      recoverable: false,
    });
    expect(
      document.querySelector('[data-ticket01-diagnostic-code="hydration-failed"]'),
    ).not.toBeNull();
    await malformed.unmount();

    const missingImage = makeExcalidrawTicket01Fixture();
    const missingImageFiles = { ...missingImage.files };
    delete missingImageFiles["file-excalidraw-mark"];
    const missingImageComparison = compareExcalidrawTicket01Semantics(EXCALIDRAW_TICKET01_FIXTURE, {
      ...missingImage,
      files: missingImageFiles,
    });
    expect(missingImageComparison.equal).toBe(false);
    expect(missingImageComparison.differences.map((difference) => difference.code)).toContain(
      "missing-image-file",
    );
    expect(missingImageComparison.diagnostics.join("\n")).toContain(
      "image/file relationship changed",
    );

    const invalidViewportRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const invalidViewport = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={invalidViewportRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          scenario="negative-invalid-viewport"
        />
      </BrowserShell>,
    );
    const invalidViewportHandle = await waitForApi(invalidViewportRef);
    expect(() =>
      invalidViewportHandle.restoreViewport({ scrollX: 0, scrollY: 0, zoom: 0 }),
    ).toThrow("viewport contains non-finite or non-positive values");
    expect(diagnosticFor(invalidViewportHandle.getDiagnostics(), "invalid-viewport")).toMatchObject(
      {
        ac: "AC5",
        phase: "restore-viewport",
      },
    );
    await invalidViewport.unmount();
  });

  it("retains deterministic selection timeout and unstable-selection diagnostics", async () => {
    const timeoutRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const timeoutHarness = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={timeoutRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          selectionSettlementDelayMs={80}
          selectionSettlementTimeoutMs={1}
          scenario="negative-selection-timeout"
        />
      </BrowserShell>,
    );
    const timeoutHandle = await waitForApi(timeoutRef);
    timeoutHandle.updateScene(selectionUpdate(1, [TICKET01_CARD_ID]));
    await vi.waitFor(() =>
      expect(
        timeoutHandle
          .getDiagnostics()
          .some((diagnostic) => diagnostic.code === "selection-settlement-timeout"),
      ).toBe(true),
    );
    await timeoutHarness.unmount();

    const unstableRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const unstableHarness = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={unstableRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          selectionStabilityCheck={() => false}
          scenario="negative-unstable-selection"
        />
      </BrowserShell>,
    );
    const unstableHandle = await waitForApi(unstableRef);
    unstableHandle.updateScene(selectionUpdate(1, [TICKET01_CARD_ID]));
    await vi.waitFor(() =>
      expect(
        unstableHandle
          .getDiagnostics()
          .some((diagnostic) => diagnostic.code === "unstable-selection"),
      ).toBe(true),
    );
    await unstableHarness.unmount();
  });

  it("canonicalizes selected-ID sets before deduplication", async () => {
    const settled: SynaraSelectionObservation[] = [];
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const mounted = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={handleRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          selectionSettlementDelayMs={0}
          scenario="ac5-selection-canonicalization"
          onSettledSelection={(observation) => settled.push(observation)}
        />
      </BrowserShell>,
    );
    const handle = await waitForApi(handleRef);
    handle.updateScene(selectionUpdate(1, [TICKET01_TARGET_ID, TICKET01_CARD_ID]));
    await waitForSettledSelection(0);
    handle.updateScene(selectionUpdate(2, [TICKET01_CARD_ID, TICKET01_TARGET_ID]));
    await waitForSettledSelection(0);
    const canonicalSelection = settled.filter(
      (observation) =>
        observation.selectedElementIds.join(",") === `${TICKET01_CARD_ID},${TICKET01_TARGET_ID}`,
    );
    expect(canonicalSelection).toHaveLength(1);
    expect(canonicalSelection[0]?.selectedElementIds).toEqual([
      TICKET01_CARD_ID,
      TICKET01_TARGET_ID,
    ]);
    await mounted.unmount();
  });

  it("probes real-package Undo feasibility without claiming Ticket 02 acceptance", async () => {
    const handleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const mounted = await render(
      <BrowserShell>
        <ExcalidrawTicket01Harness
          ref={handleRef}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          scenario="undo-feasibility-probe"
        />
      </BrowserShell>,
    );
    const handle = await waitForApi(handleRef);
    const preBatch = handle.captureScene();
    handle.updateScene({ sequence: 1, ...mutableProgressScene(1) });
    handle.updateScene({ sequence: 2, ...mutableProgressScene(2) });
    expect(handle.captureScene().elements[0]?.customData).toMatchObject({ progress: 2 });

    handle.updateScene(selectionUpdate(3, [TICKET01_CARD_ID]));
    await vi.waitFor(() =>
      expect(handle.captureScene().selectedElementIds).toContain(TICKET01_CARD_ID),
    );
    document.querySelector<HTMLElement>(".excalidraw")?.focus();
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() =>
      expect(handle.captureScene().elements.length).toBeLessThan(preBatch.elements.length),
    );
    await userEvent.keyboard("{Meta>}z{/Meta}");
    await vi.waitFor(() =>
      expect(handle.captureScene().elements.length).toBe(preBatch.elements.length),
    );
    expect(handle.captureScene().elements[0]?.customData).toMatchObject({ progress: 2 });
    expect(handle.captureScene().elements[0]?.customData).not.toMatchObject({
      progress: undefined,
    });
    await mounted.unmount();
  });
});
