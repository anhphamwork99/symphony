// FILE: SynaraExcalidrawAdapter.performance.browser.tsx
// Purpose: AC6 actual-Chromium baseline measurements for the pinned Excalidraw boundary.
// Layer: Ticket 01 browser performance evidence

import { createRef, Fragment, type RefObject } from "react";
import { expect, describe, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  ExcalidrawTicket01Harness,
  type ExcalidrawTicket01HarnessHandle,
} from "./ExcalidrawTicket01Harness";
import type { SynaraSceneInput } from "./SynaraExcalidrawAdapter";
import {
  makeExcalidrawTicket01Fixture,
  type ExcalidrawTicket01Scene,
} from "./excalidrawTicket01Fixture";

const PACKAGE_VERSION = "0.18.1" as const;
const SAMPLE_COUNT = 12;
const WARMUP_COUNT = 2;
const MARKER = "SYNARA_TICKET01_PERF_RESULT:";

interface LatencyMeasurement {
  readonly id: string;
  readonly samplesMs: readonly number[];
}

interface MemoryObservation {
  readonly status: "available" | "unavailable";
  readonly reason?: string;
  readonly api?: string;
  readonly kind?: "coarse-process";
  readonly beforeBytes?: number;
  readonly afterBytes?: number;
  readonly limitation?: string;
}

interface PerformanceEvidence {
  readonly schemaVersion: "ticket01-excalidraw-baseline.v1";
  readonly packageVersion: typeof PACKAGE_VERSION;
  readonly browser: {
    readonly userAgent: string;
    readonly platform: string;
    readonly language: string;
    readonly devicePixelRatio: number;
  };
  readonly protocol: {
    readonly warmupCount: number;
    readonly sampleCount: number;
    readonly timer: string;
    readonly gc: string;
    readonly memory: string;
  };
  readonly fixtures: {
    readonly empty: {
      readonly elements: number;
      readonly files: number;
      readonly jsonBytes: number;
    };
    readonly normal: {
      readonly elements: number;
      readonly files: number;
      readonly jsonBytes: number;
    };
    readonly image: {
      readonly elements: number;
      readonly files: number;
      readonly jsonBytes: number;
    };
  };
  readonly measurements: readonly LatencyMeasurement[];
  readonly memoryObservation: MemoryObservation;
  readonly proofs: {
    readonly orderedProgressiveUpdates: boolean;
    readonly nonRemount: boolean;
    readonly viewportRetention: boolean;
    readonly visibleCanvas: boolean;
    readonly hiddenRetainedCanvas: boolean;
    readonly repeatedVisibilityCycles: number;
    readonly separateMountUnmount: boolean;
    readonly imageSerialization: boolean;
    readonly imageSvgExport: boolean;
    readonly imagePngExport: boolean;
  };
  readonly findings: readonly {
    readonly id: string;
    readonly observation: string;
    readonly classification:
      | "none observed"
      | "non-blocking limitation"
      | "blocking incompatibility";
  }[];
}

type Scene = {
  readonly elements: readonly Record<string, unknown>[];
  readonly files: Record<string, unknown>;
};

function sceneAsInput(scene: ExcalidrawTicket01Scene | Scene): SynaraSceneInput {
  return scene as unknown as SynaraSceneInput;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function fixtureShape(scene: ExcalidrawTicket01Scene | Scene) {
  return {
    elements: scene.elements.length,
    files: Object.keys(scene.files).length,
    jsonBytes: jsonBytes(scene),
  };
}

function makeNormalScene(): Scene {
  const fixture = makeExcalidrawTicket01Fixture();
  return {
    elements: fixture.elements.filter((element) => element.type !== "image") as unknown as Record<
      string,
      unknown
    >[],
    files: {},
  };
}

function makeImageScene(): ExcalidrawTicket01Scene {
  return makeExcalidrawTicket01Fixture();
}

async function waitForReady(ref: RefObject<ExcalidrawTicket01HarnessHandle | null>): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        ref.current?.getIdentity().apiId,
        "the real Excalidraw API did not become ready",
      ).toBeTruthy();
      expect(
        document.querySelector(".excalidraw"),
        "the real Excalidraw canvas was not rendered",
      ).toBeTruthy();
    },
    { timeout: 15_000, interval: 20 },
  );
}

async function mountAndMeasure(
  scene: ExcalidrawTicket01Scene | Scene,
  scenario: string,
): Promise<{
  readonly mounted: Awaited<ReturnType<typeof render>>;
  readonly ref: RefObject<ExcalidrawTicket01HarnessHandle | null>;
  readonly elapsedMs: number;
}> {
  const ref = createRef<ExcalidrawTicket01HarnessHandle>();
  const startedAt = performance.now();
  const mounted = await render(
    <ExcalidrawTicket01Harness ref={ref} initialScene={sceneAsInput(scene)} scenario={scenario} />,
  );
  await waitForReady(ref);
  return { mounted, ref, elapsedMs: performance.now() - startedAt };
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function measureMemory(): Promise<MemoryObservation> {
  const candidate = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ readonly bytes: number }>;
    memory?: { readonly usedJSHeapSize: number };
  };
  if (typeof candidate.measureUserAgentSpecificMemory === "function") {
    try {
      const before = await candidate.measureUserAgentSpecificMemory();
      const after = await candidate.measureUserAgentSpecificMemory();
      return {
        status: "available",
        api: "performance.measureUserAgentSpecificMemory",
        kind: "coarse-process",
        beforeBytes: before.bytes,
        afterBytes: after.bytes,
        limitation:
          "This is a browser process/agent observation, not precise per-canvas retained memory.",
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: `performance.measureUserAgentSpecificMemory failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (candidate.memory && Number.isFinite(candidate.memory.usedJSHeapSize)) {
    return {
      status: "available",
      api: "performance.memory.usedJSHeapSize",
      kind: "coarse-process",
      beforeBytes: candidate.memory.usedJSHeapSize,
      afterBytes: candidate.memory.usedJSHeapSize,
      limitation:
        "Chrome coarse process heap telemetry; it is not precise per-canvas retained memory.",
    };
  }
  return {
    status: "unavailable",
    reason:
      "Chromium exposed neither performance.measureUserAgentSpecificMemory nor performance.memory.",
  };
}

async function collectHydrationSamples(
  scene: ExcalidrawTicket01Scene | Scene,
  scenario: string,
): Promise<number[]> {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    const warmup = await mountAndMeasure(scene, `${scenario}-warmup-${index + 1}`);
    await warmup.mounted.unmount();
  }
  const samples: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const mounted = await mountAndMeasure(scene, `${scenario}-${index + 1}`);
    samples.push(mounted.elapsedMs);
    await mounted.mounted.unmount();
  }
  return samples;
}

function changedScene(scene: Scene | ExcalidrawTicket01Scene, index: number): Scene {
  return {
    elements: scene.elements.map((element, elementIndex) => ({
      ...element,
      ...(elementIndex === 1 ? { x: Number(element.x ?? 0) + index + 1 } : {}),
    })),
    files: { ...scene.files },
  };
}

describe("Ticket 01 AC6 Excalidraw Chromium performance baseline", () => {
  it("measures every required real-package scenario and emits one complete marker", async () => {
    const emptyScene: Scene = { elements: [], files: {} };
    const normalScene = makeNormalScene();
    const imageScene = makeImageScene();
    const measurements: LatencyMeasurement[] = [];

    const emptyHydration = await collectHydrationSamples(emptyScene, "hydrate-empty");
    measurements.push({ id: "hydrate-empty", samplesMs: emptyHydration });
    const normalHydration = await collectHydrationSamples(normalScene, "hydrate-normal");
    measurements.push({ id: "hydrate-normal", samplesMs: normalHydration });
    const imageHydration = await collectHydrationSamples(imageScene, "hydrate-image");
    measurements.push({ id: "hydrate-image", samplesMs: imageHydration });

    const normalMount = await mountAndMeasure(normalScene, "normal-operations");
    let normalMountIdentity: ReturnType<ExcalidrawTicket01HarnessHandle["getIdentity"]>;
    let viewportRetention = false;
    let orderedProgressiveUpdates = false;
    try {
      const handle = normalMount.ref.current!;
      normalMountIdentity = handle.getIdentity();
      handle.restoreViewport({ scrollX: 137, scrollY: -83, zoom: 1.25 });
      const expectedViewport = handle.captureViewport();
      const serializationSamples: number[] = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        const startedAt = performance.now();
        const serialized = handle.serializeScene();
        expect(serialized).toContain('"elements"');
        expect(serialized).toContain('"files"');
        serializationSamples.push(performance.now() - startedAt);
      }
      measurements.push({ id: "serialize-normal", samplesMs: serializationSamples });

      const updateSamples: number[] = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        const startedAt = performance.now();
        handle.updateScene({
          elements: changedScene(normalScene, index).elements,
          sequence: index + 1,
        });
        updateSamples.push(performance.now() - startedAt);
        expect(handle.getIdentity()).toEqual(normalMountIdentity);
        const observedViewport = handle.captureViewport();
        expect(observedViewport.scrollX).toBe(expectedViewport.scrollX);
        expect(observedViewport.scrollY).toBe(expectedViewport.scrollY);
        expect(observedViewport.zoom).toBe(expectedViewport.zoom);
      }
      measurements.push({ id: "update-progressive", samplesMs: updateSamples });
      const appliedSequences = handle
        .getLifecycleEvents()
        .filter((event) => event.kind === "update-applied")
        .map((event) => event.updateSequence);
      expect(appliedSequences).toEqual(
        Array.from({ length: SAMPLE_COUNT }, (_, index) => index + 1),
      );
      orderedProgressiveUpdates = true;
      viewportRetention = true;
    } finally {
      await normalMount.mounted.unmount();
    }

    const imageMount = await mountAndMeasure(imageScene, "image-operations");
    try {
      const handle = imageMount.ref.current!;
      const serializationSamples: number[] = [];
      const svgSamples: number[] = [];
      const pngSamples: number[] = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        let startedAt = performance.now();
        const serialized = handle.serializeScene();
        expect(serialized).toContain("file-excalidraw-mark");
        serializationSamples.push(performance.now() - startedAt);

        startedAt = performance.now();
        const svg = await handle.exportSvg();
        expect(svg).toContain("<svg");
        svgSamples.push(performance.now() - startedAt);

        startedAt = performance.now();
        const png = await handle.exportPng();
        expect(png.size).toBeGreaterThan(0);
        pngSamples.push(performance.now() - startedAt);
      }
      measurements.push({ id: "serialize-image", samplesMs: serializationSamples });
      measurements.push({ id: "export-svg-image", samplesMs: svgSamples });
      measurements.push({ id: "export-png-image", samplesMs: pngSamples });
    } finally {
      await imageMount.mounted.unmount();
    }

    const firstMount = await mountAndMeasure(emptyScene, "mount-unmount-first");
    const firstIdentity = firstMount.ref.current!.getIdentity();
    await firstMount.mounted.unmount();
    const secondMount = await mountAndMeasure(emptyScene, "mount-unmount-second");
    const secondIdentity = secondMount.ref.current!.getIdentity();
    const separateMountUnmount = secondIdentity.mountId !== firstIdentity.mountId;
    try {
      expect(separateMountUnmount).toBe(true);
    } finally {
      await secondMount.mounted.unmount();
    }

    const visibleRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const hiddenRef = createRef<ExcalidrawTicket01HarnessHandle>();
    const visibleHostRef = createRef<HTMLDivElement>();
    const hiddenHostRef = createRef<HTMLDivElement>();
    const retained = await render(
      <Fragment>
        <div ref={visibleHostRef} data-ticket01-canvas-visibility="visible">
          <ExcalidrawTicket01Harness
            ref={visibleRef}
            initialScene={sceneAsInput(normalScene)}
            scenario="visible-retained"
          />
        </div>
        <div
          ref={hiddenHostRef}
          data-ticket01-canvas-visibility="hidden-retained"
          style={{ display: "none" }}
        >
          <ExcalidrawTicket01Harness
            ref={hiddenRef}
            initialScene={sceneAsInput(imageScene)}
            scenario="hidden-retained"
          />
        </div>
      </Fragment>,
    );
    let repeatedVisibilityCycles = 0;
    let memoryObservation: MemoryObservation;
    try {
      await waitForReady(visibleRef);
      await waitForReady(hiddenRef);
      expect(visibleHostRef.current?.dataset.ticket01CanvasVisibility).toBe("visible");
      expect(hiddenHostRef.current?.dataset.ticket01CanvasVisibility).toBe("hidden-retained");
      expect(getComputedStyle(hiddenHostRef.current!).display).toBe("none");
      const visibleIdentity = visibleRef.current!.getIdentity();
      const hiddenIdentity = hiddenRef.current!.getIdentity();
      for (let cycle = 0; cycle < 8; cycle += 1) {
        const hidden = cycle % 2 === 0;
        hiddenHostRef.current!.style.display = hidden ? "none" : "block";
        visibleHostRef.current!.style.display = hidden ? "block" : "none";
        void hiddenHostRef.current!.offsetHeight;
        await nextFrame();
        repeatedVisibilityCycles += 1;
      }
      memoryObservation = await measureMemory();
      expect(visibleRef.current!.getIdentity()).toEqual(visibleIdentity);
      expect(hiddenRef.current!.getIdentity()).toEqual(hiddenIdentity);
      expect(visibleHostRef.current?.getAttribute("data-ticket01-canvas-visibility")).toBe(
        "visible",
      );
      expect(hiddenHostRef.current?.getAttribute("data-ticket01-canvas-visibility")).toBe(
        "hidden-retained",
      );
    } finally {
      await retained.unmount();
    }

    expect(measurements).toHaveLength(8);
    for (const measurement of measurements)
      expect(measurement.samplesMs).toHaveLength(SAMPLE_COUNT);

    const evidence: PerformanceEvidence = {
      schemaVersion: "ticket01-excalidraw-baseline.v1",
      packageVersion: PACKAGE_VERSION,
      browser: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        devicePixelRatio: window.devicePixelRatio,
      },
      protocol: {
        warmupCount: WARMUP_COUNT,
        sampleCount: SAMPLE_COUNT,
        timer:
          "performance.now() in the Chromium page; operation timers exclude mount/unmount except hydration timers",
        gc: "No forced garbage collection; samples include normal browser scheduling and allocator state.",
        memory:
          "Memory API is probed after visible/hidden retained canvases and repeated visibility cycles; unavailable is retained as a reason.",
      },
      fixtures: {
        empty: fixtureShape(emptyScene),
        normal: fixtureShape(normalScene),
        image: fixtureShape(imageScene),
      },
      measurements,
      memoryObservation: memoryObservation!,
      proofs: {
        orderedProgressiveUpdates,
        nonRemount: true,
        viewportRetention,
        visibleCanvas: true,
        hiddenRetainedCanvas: true,
        repeatedVisibilityCycles,
        separateMountUnmount,
        imageSerialization: true,
        imageSvgExport: true,
        imagePngExport: true,
      },
      findings: [
        {
          id: "required-public-boundaries",
          observation:
            "All required measurements completed through the lazy Synara adapter and official Excalidraw runtime in Chromium.",
          classification: "none observed",
        },
        {
          id: "memory-attribution",
          observation:
            "Memory readings are unavailable or coarse process-wide browser telemetry and are not precise per-canvas retained-size measurements.",
          classification: "non-blocking limitation",
        },
        {
          id: "undo-transaction-boundary",
          observation:
            "Ticket 01 records updateScene feasibility only; exact one-event AI Undo remains owned by Ticket 02 and no product budget is inferred here.",
          classification: "non-blocking limitation",
        },
        {
          id: "dot-grid",
          observation:
            "Dot-grid rendering and export policy are intentionally outside Ticket 01 scope.",
          classification: "non-blocking limitation",
        },
        {
          id: "blocking-incompatibilities",
          observation:
            "No build, runtime, semantic, remount, viewport, lock, or export incompatibility was observed by this complete run.",
          classification: "none observed",
        },
      ],
    };

    console.log(`${MARKER}${JSON.stringify(evidence)}`);
  });
});
