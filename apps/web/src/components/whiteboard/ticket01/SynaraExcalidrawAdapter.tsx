import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  restore,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import "@excalidraw/excalidraw/index.css";

const PACKAGE_VERSION = "0.18.1" as const;

type PackageProps = ComponentProps<typeof Excalidraw>;
type PackageApi = NonNullable<Parameters<NonNullable<PackageProps["excalidrawAPI"]>>[0]>;
type PackageOnChange = NonNullable<PackageProps["onChange"]>;
type PackageElements = Parameters<PackageOnChange>[0];
type PackageAppState = Parameters<PackageOnChange>[1];
type PackageFiles = Parameters<PackageOnChange>[2];
type PackageSceneUpdate = Parameters<PackageApi["updateScene"]>[0];
type PackageBinaryFileData = Parameters<PackageApi["addFiles"]>[0][number];
type PackageInitialData = Exclude<PackageProps["initialData"], undefined>;

type JsonObject = { readonly [key: string]: unknown };

export type SynaraSceneElement = JsonObject;
export type SynaraSceneFile = JsonObject;

export interface SynaraSceneInput {
  readonly elements: readonly SynaraSceneElement[];
  readonly appState?: JsonObject;
  readonly files?: Readonly<Record<string, SynaraSceneFile>>;
}

export interface SynaraViewport {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

export interface SynaraSceneSnapshot {
  readonly elements: readonly SynaraSceneElement[];
  readonly files: Readonly<Record<string, SynaraSceneFile>>;
  readonly viewport: SynaraViewport;
  readonly selectedElementIds: readonly string[];
}

export interface SynaraSelectionObservation {
  readonly selectedElementIds: readonly string[];
  readonly observedAt: number;
  readonly settledAfterMs?: number;
}

export type SynaraDiagnosticAc = "AC1" | "AC2" | "AC3" | "AC4" | "AC5" | "AC6";

export interface SynaraExcalidrawDiagnostic {
  readonly code: string;
  readonly ac: SynaraDiagnosticAc;
  readonly phase: string;
  readonly packageVersion: typeof PACKAGE_VERSION;
  readonly scenario?: string;
  readonly expected: string;
  readonly observed: string;
  readonly cause?: string;
  readonly recoverable: boolean;
}

export type SynaraAdapterLifecycleKind = "mounted" | "unmounted" | "api-ready" | "update-applied";

export interface SynaraAdapterLifecycleEvent {
  readonly kind: SynaraAdapterLifecycleKind;
  readonly mountId: number;
  readonly apiId?: string;
  readonly updateSequence?: number;
  readonly observedAt: number;
}

export interface SynaraSceneUpdate extends SynaraSceneInput {
  readonly sequence?: number;
}

export interface SynaraExcalidrawHandle {
  readonly getIdentity: () => { readonly mountId: number; readonly apiId: string | null };
  readonly captureScene: () => SynaraSceneSnapshot;
  readonly serializeScene: () => string;
  readonly exportSvg: () => Promise<string>;
  readonly exportPng: () => Promise<Blob>;
  readonly updateScene: (update: SynaraSceneUpdate) => void;
  readonly setViewModeEnabled: (enabled: boolean) => void;
  readonly captureViewport: () => SynaraViewport;
  readonly restoreViewport: (viewport: SynaraViewport) => void;
  readonly clearNativeHistory: () => void;
  readonly restoreScene: (snapshot: SynaraSceneSnapshot) => void;
}

export interface SynaraExcalidrawAdapterProps {
  readonly initialScene?: SynaraSceneInput;
  readonly viewModeEnabled?: boolean;
  readonly selectionSettlementDelayMs?: number;
  /**
   * Test-policy injection only. Ticket 01 observes timeout behavior but does
   * not choose a production timeout value.
   */
  readonly selectionSettlementTimeoutMs?: number;
  /**
   * Test-policy injection only. Returning false proves the unstable-selection
   * diagnostic without making a production stability policy here.
   */
  readonly selectionStabilityCheck?: (selectedElementIds: readonly string[]) => boolean;
  readonly scenario?: string;
  readonly onDiagnostic?: (diagnostic: SynaraExcalidrawDiagnostic) => void;
  readonly onLifecycle?: (event: SynaraAdapterLifecycleEvent) => void;
  readonly onRawSelection?: (observation: SynaraSelectionObservation) => void;
  readonly onSettledSelection?: (observation: SynaraSelectionObservation) => void;
  readonly onViewportChange?: (viewport: SynaraViewport) => void;
  /**
   * Ticket 02 gate opt-in. Existing Ticket 01 consumers retain native undo
   * semantics until they explicitly own the Synara history boundary.
   */
  readonly containNativeHistory?: boolean;
  /**
   * The adapter clears the package history before exposing this callback. The
   * callback is intentionally scene-shaped and never receives the package API.
   */
  readonly onSceneChange?: (snapshot: SynaraSceneSnapshot) => void;
}

let nextMountId = 0;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readZoom(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isJsonObject(value) && typeof value.value === "number" && Number.isFinite(value.value)) {
    return value.value;
  }
  throw new Error("editor viewport contained an invalid zoom value");
}

function readViewport(appState: PackageAppState): SynaraViewport {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: readZoom(appState.zoom),
  };
}

function readSelectedIds(appState: PackageAppState): readonly string[] {
  return [
    ...new Set(
      Object.keys(appState.selectedElementIds).filter(
        (id) => appState.selectedElementIds[id] === true,
      ),
    ),
  ].sort();
}

function validateSceneInput(scene: SynaraSceneInput): void {
  if (!Array.isArray(scene.elements)) {
    throw new Error("scene elements must be an array");
  }
  if (scene.appState !== undefined && !isJsonObject(scene.appState)) {
    throw new Error("scene appState must be an object when supplied");
  }
  if (scene.files !== undefined && !isJsonObject(scene.files)) {
    throw new Error("scene files must be an object when supplied");
  }
}

/**
 * The sole conversion point between Synara's persistence-shaped scene and the
 * official package's restore boundary. Consumers never need package element or
 * app-state types to hydrate a scene.
 */
export function normalizeSynaraScene(scene: SynaraSceneInput): SynaraSceneInput {
  validateSceneInput(scene);
  const restored = restore(
    {
      elements: scene.elements as PackageElements,
      appState: (scene.appState ?? {}) as unknown as PackageAppState,
      files: (scene.files ?? {}) as PackageFiles,
    },
    null,
    null,
    { refreshDimensions: true, repairBindings: true },
  );

  return {
    elements: restored.elements as unknown as readonly SynaraSceneElement[],
    appState: restored.appState as unknown as JsonObject,
    files: restored.files as unknown as Readonly<Record<string, SynaraSceneFile>>,
  };
}

function toSnapshot(
  elements: readonly PackageElements[number][],
  appState: PackageAppState,
  files: PackageFiles,
): SynaraSceneSnapshot {
  return {
    elements: elements as unknown as readonly SynaraSceneElement[],
    files: files as unknown as Readonly<Record<string, SynaraSceneFile>>,
    viewport: readViewport(appState),
    selectedElementIds: readSelectedIds(appState),
  };
}

function adapterErrorDiagnostic(
  props: SynaraExcalidrawAdapterProps,
  details: Omit<SynaraExcalidrawDiagnostic, "packageVersion" | "scenario">,
): SynaraExcalidrawDiagnostic {
  return {
    ...details,
    packageVersion: PACKAGE_VERSION,
    ...(props.scenario ? { scenario: props.scenario } : {}),
  };
}

function parsePositiveSvgDimension(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validateSvgMarkup(markup: string): void {
  const document = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = document.documentElement;
  if (root.tagName.toLowerCase() !== "svg") {
    throw new Error("official SVG export did not produce an SVG root element");
  }
  const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  const hasPositiveViewBox =
    viewBox !== undefined &&
    viewBox.length === 4 &&
    viewBox.slice(2).every((value) => Number.isFinite(value) && value > 0);
  const hasPositiveDimensions =
    parsePositiveSvgDimension(root.getAttribute("width")) !== null &&
    parsePositiveSvgDimension(root.getAttribute("height")) !== null;
  if (!hasPositiveViewBox && !hasPositiveDimensions) {
    throw new Error("official SVG export did not provide positive dimensions or viewBox");
  }
  if (root.childElementCount === 0) {
    throw new Error("official SVG export contained no rendered content");
  }
}

async function validatePngBlob(blob: Blob): Promise<void> {
  if (blob.type.toLowerCase() !== "image/png") {
    throw new Error(`official PNG export returned MIME type ${blob.type || "unknown"}`);
  }
  const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < signature.length ||
    !signature.every((value, index) => bytes[index] === value)
  ) {
    throw new Error("official PNG export did not contain a valid PNG signature");
  }
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      bitmap.close();
      throw new Error("official PNG export decoded with non-positive dimensions");
    }
    bitmap.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? resolve()
          : reject(new Error("official PNG export decoded with non-positive dimensions"));
      image.onerror = () => reject(new Error("official PNG export was not browser-decodable"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AdapterFailure(props: { diagnostic: SynaraExcalidrawDiagnostic }) {
  return (
    <div
      role="alert"
      data-ticket01-status="error"
      data-ticket01-diagnostic-code={props.diagnostic.code}
      style={{ minHeight: 240, minWidth: 320, padding: 16 }}
    >
      <strong>Whiteboard editor failed to load.</strong>
      <div>{props.diagnostic.observed}</div>
    </div>
  );
}

export const SynaraExcalidrawAdapter = forwardRef<
  SynaraExcalidrawHandle,
  SynaraExcalidrawAdapterProps
>(function SynaraExcalidrawAdapter(props, ref) {
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const mountIdRef = useRef<number | null>(null);
  if (mountIdRef.current === null) mountIdRef.current = ++nextMountId;
  const mountId = mountIdRef.current;
  const apiRef = useRef<PackageApi | null>(null);
  const apiIdRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<SynaraSceneSnapshot | null>(null);
  const latestViewportRef = useRef<SynaraViewport | null>(null);
  const lastSettledSelectionKeyRef = useRef<string | null>(null);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateSequenceRef = useRef(0);
  const [viewModeEnabled, setViewModeEnabled] = useState(props.viewModeEnabled ?? false);
  const [apiReady, setApiReady] = useState(false);

  const report = useCallback(
    (details: Omit<SynaraExcalidrawDiagnostic, "packageVersion" | "scenario">) => {
      callbacksRef.current.onDiagnostic?.(adapterErrorDiagnostic(callbacksRef.current, details));
    },
    [],
  );

  const lifecycle = useCallback(
    (event: Omit<SynaraAdapterLifecycleEvent, "mountId" | "observedAt">) => {
      callbacksRef.current.onLifecycle?.({
        ...event,
        mountId,
        observedAt: Date.now(),
      });
    },
    [mountId],
  );

  const initialDataRef = useRef<PackageInitialData | null>(null);
  const initialErrorRef = useRef<SynaraExcalidrawDiagnostic | null>(null);
  if (initialDataRef.current === null && initialErrorRef.current === null) {
    try {
      const initialScene = props.initialScene ?? { elements: [], files: {} };
      initialDataRef.current = normalizeSynaraScene(initialScene) as PackageInitialData;
    } catch (error) {
      initialErrorRef.current = adapterErrorDiagnostic(props, {
        code: "hydration-failed",
        ac: "AC2",
        phase: "initial-hydration",
        expected: "the supplied scene is restored through the official public utility",
        observed: error instanceof Error ? error.message : String(error),
        recoverable: false,
      });
    }
  }

  useEffect(() => {
    if (initialErrorRef.current) callbacksRef.current.onDiagnostic?.(initialErrorRef.current);
  }, []);

  useEffect(() => {
    lifecycle({ kind: "mounted" });
    return () => {
      if (selectionTimerRef.current !== null) clearTimeout(selectionTimerRef.current);
      if (selectionTimeoutRef.current !== null) clearTimeout(selectionTimeoutRef.current);
      lifecycle({ kind: "unmounted", ...(apiIdRef.current ? { apiId: apiIdRef.current } : {}) });
    };
  }, [lifecycle]);

  useEffect(() => {
    const enabled = props.viewModeEnabled;
    if (enabled === undefined) return;
    setViewModeEnabled(enabled);
    if (apiRef.current) {
      apiRef.current.updateScene({
        appState: { viewModeEnabled: enabled },
        captureUpdate: "NEVER",
      } as PackageSceneUpdate);
    }
  }, [props.viewModeEnabled]);

  useEffect(() => {
    if (!apiReady) return;
    const editorRoot = document.querySelector<HTMLElement>(".excalidraw");
    const interactiveCanvas = editorRoot?.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.interactive",
    );
    if (
      editorRoot === null ||
      interactiveCanvas == null ||
      getComputedStyle(editorRoot).display === "none" ||
      getComputedStyle(interactiveCanvas).display === "none"
    ) {
      report({
        code: "package-assets-not-ready",
        ac: "AC1",
        phase: "runtime-assets",
        expected: "the package CSS and canvas runtime surface are available after API readiness",
        observed: "the Excalidraw root or interactive canvas is missing or hidden",
        recoverable: false,
      });
    }
  }, [apiReady, report]);

  const requireApi = useCallback(
    (details: Omit<SynaraExcalidrawDiagnostic, "packageVersion" | "scenario" | "observed">) => {
      const api = apiRef.current;
      if (api) return api;
      const error = new Error("editor API is not ready");
      report({
        ...details,
        observed: error.message,
        recoverable: true,
      });
      throw error;
    },
    [report],
  );

  const captureScene = useCallback((): SynaraSceneSnapshot => {
    const api = requireApi({
      code: "api-not-ready",
      ac: "AC1",
      phase: "capture-scene",
      expected: "a stable public editor API handle",
      recoverable: true,
    });
    const snapshot = toSnapshot(api.getSceneElements(), api.getAppState(), api.getFiles());
    latestSnapshotRef.current = snapshot;
    latestViewportRef.current = snapshot.viewport;
    return snapshot;
  }, [requireApi]);

  const captureViewport = useCallback(
    (): SynaraViewport => captureScene().viewport,
    [captureScene],
  );

  const serializeScene = useCallback((): string => {
    const api = requireApi({
      code: "api-not-ready",
      ac: "AC1",
      phase: "serialize",
      expected: "serialization from the current mounted scene",
      recoverable: true,
    });
    try {
      const serialized = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      if (serialized.length === 0) throw new Error("official serializer returned an empty payload");
      return serialized;
    } catch (error) {
      report({
        code: "serialization-failed",
        ac: "AC2",
        phase: "serialize",
        expected: "a non-empty editable .excalidraw representation",
        observed: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      throw error;
    }
  }, [report, requireApi]);

  const exportSvg = useCallback(async (): Promise<string> => {
    try {
      const api = requireApi({
        code: "api-not-ready",
        ac: "AC1",
        phase: "export-svg",
        expected: "official export from the current mounted scene",
        recoverable: true,
      });
      const svg = await exportToSvg({
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      });
      const markup = svg.outerHTML;
      validateSvgMarkup(markup);
      return markup;
    } catch (error) {
      report({
        code: "svg-export-failed",
        ac: "AC2",
        phase: "export-svg",
        expected: "a validated SVG document from the official exporter",
        observed: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      throw error;
    }
  }, [report, requireApi]);

  const exportPng = useCallback(async (): Promise<Blob> => {
    try {
      const api = requireApi({
        code: "api-not-ready",
        ac: "AC1",
        phase: "export-png",
        expected: "official export from the current mounted scene",
        recoverable: true,
      });
      const blob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
        mimeType: "image/png",
      });
      if (blob.size === 0) throw new Error("official PNG export returned an empty blob");
      await validatePngBlob(blob);
      return blob;
    } catch (error) {
      report({
        code: "png-export-failed",
        ac: "AC2",
        phase: "export-png",
        expected: "a non-empty PNG blob from the official exporter",
        observed: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      throw error;
    }
  }, [report, requireApi]);

  const updateScene = useCallback(
    (update: SynaraSceneUpdate): void => {
      const api = requireApi({
        code: "api-not-ready",
        ac: "AC1",
        phase: "imperative-update",
        expected: "imperative updates use the existing mounted editor API",
        recoverable: true,
      });
      const sequence = update.sequence ?? lastUpdateSequenceRef.current + 1;
      if (!Number.isSafeInteger(sequence) || sequence !== lastUpdateSequenceRef.current + 1) {
        const error = new Error(
          `expected scene update ${lastUpdateSequenceRef.current + 1}, received ${sequence}`,
        );
        report({
          code: "update-order-mismatch",
          ac: "AC3",
          phase: "imperative-update",
          expected: "ordered updates applied to the existing editor instance",
          observed: error.message,
          recoverable: false,
        });
        throw error;
      }
      try {
        if (update.files) {
          api.addFiles(Object.values(update.files) as unknown as PackageBinaryFileData[]);
        }
        api.updateScene({
          ...(update.elements !== undefined
            ? { elements: update.elements as PackageElements }
            : {}),
          ...(update.appState !== undefined
            ? { appState: update.appState as PackageSceneUpdate["appState"] }
            : {}),
          captureUpdate: "NEVER",
        } as PackageSceneUpdate);
        lastUpdateSequenceRef.current = sequence;
        lifecycle({
          kind: "update-applied",
          ...(apiIdRef.current ? { apiId: apiIdRef.current } : {}),
          updateSequence: sequence,
        });
      } catch (error) {
        report({
          code: "imperative-update-failed",
          ac: "AC3",
          phase: "imperative-update",
          expected: "the existing editor instance remains mounted while applying the update",
          observed: error instanceof Error ? error.message : String(error),
          recoverable: false,
        });
        throw error;
      }
    },
    [lifecycle, report, requireApi],
  );

  const clearNativeHistory = useCallback((): void => {
    const api = requireApi({
      code: "api-not-ready",
      ac: "AC4",
      phase: "clear-native-history",
      expected: "the public history.clear API is available before exposing a settled scene change",
      recoverable: true,
    });
    try {
      api.history.clear();
    } catch (error) {
      report({
        code: "native-history-clear-failed",
        ac: "AC4",
        phase: "clear-native-history",
        expected: "public api.history.clear contains package-native history",
        observed: error instanceof Error ? error.message : String(error),
        recoverable: false,
      });
      throw error;
    }
  }, [report, requireApi]);

  const restoreScene = useCallback(
    (snapshot: SynaraSceneSnapshot): void => {
      const api = requireApi({
        code: "api-not-ready",
        ac: "AC2",
        phase: "restore-scene",
        expected: "the mounted public editor API is available before restoring a snapshot",
        recoverable: true,
      });
      try {
        if (snapshot.files) {
          api.addFiles(Object.values(snapshot.files) as unknown as PackageBinaryFileData[]);
        }
        api.updateScene({
          elements: snapshot.elements as PackageElements,
          appState: {
            selectedElementIds: Object.fromEntries(
              snapshot.selectedElementIds.map((id) => [id, true]),
            ),
          },
          captureUpdate: "NEVER",
        } as PackageSceneUpdate);
        latestSnapshotRef.current = snapshot;
        latestViewportRef.current = snapshot.viewport;
      } catch (error) {
        report({
          code: "scene-restore-failed",
          ac: "AC2",
          phase: "restore-scene",
          expected: "public addFiles and updateScene restore the complete document snapshot",
          observed: error instanceof Error ? error.message : String(error),
          recoverable: true,
        });
        throw error;
      }
    },
    [report, requireApi],
  );

  const setViewMode = useCallback(
    (enabled: boolean): void => {
      setViewModeEnabled(enabled);
      try {
        const api = requireApi({
          code: "api-not-ready",
          ac: "AC1",
          phase: "edit-lock",
          expected: "the mounted editor API is available before changing view mode",
          recoverable: true,
        });
        api.updateScene({
          appState: { viewModeEnabled: enabled },
          captureUpdate: "NEVER",
        } as PackageSceneUpdate);
      } catch (error) {
        report({
          code: "view-mode-update-failed",
          ac: "AC4",
          phase: "edit-lock",
          expected: "view mode prevents element mutation without disabling navigation",
          observed: error instanceof Error ? error.message : String(error),
          recoverable: false,
        });
        throw error;
      }
    },
    [report, requireApi],
  );

  const restoreViewport = useCallback(
    (viewport: SynaraViewport): void => {
      if (
        !Number.isFinite(viewport.scrollX) ||
        !Number.isFinite(viewport.scrollY) ||
        !Number.isFinite(viewport.zoom) ||
        viewport.zoom <= 0
      ) {
        const error = new Error("viewport contains non-finite or non-positive values");
        report({
          code: "invalid-viewport",
          ac: "AC5",
          phase: "restore-viewport",
          expected: "finite scroll coordinates and a positive zoom",
          observed: error.message,
          recoverable: true,
        });
        throw error;
      }
      try {
        const api = requireApi({
          code: "api-not-ready",
          ac: "AC5",
          phase: "restore-viewport",
          expected: "the mounted editor API is available before restoring viewport",
          recoverable: true,
        });
        api.updateScene({
          appState: {
            scrollX: viewport.scrollX,
            scrollY: viewport.scrollY,
            zoom: { value: viewport.zoom },
          },
          captureUpdate: "NEVER",
        } as PackageSceneUpdate);
        latestViewportRef.current = viewport;
      } catch (error) {
        report({
          code: "viewport-restore-failed",
          ac: "AC5",
          phase: "restore-viewport",
          expected: "the public updateScene viewport boundary preserves the requested viewport",
          observed: error instanceof Error ? error.message : String(error),
          recoverable: true,
        });
        throw error;
      }
    },
    [report, requireApi],
  );

  const handle = useMemo<SynaraExcalidrawHandle>(
    () => ({
      getIdentity: () => ({ mountId, apiId: apiIdRef.current }),
      captureScene,
      serializeScene,
      exportSvg,
      exportPng,
      updateScene,
      setViewModeEnabled: setViewMode,
      captureViewport,
      restoreViewport,
      clearNativeHistory,
      restoreScene,
    }),
    [
      captureScene,
      captureViewport,
      exportPng,
      exportSvg,
      mountId,
      restoreViewport,
      clearNativeHistory,
      restoreScene,
      serializeScene,
      setViewMode,
      updateScene,
    ],
  );

  useImperativeHandle(ref, () => handle, [handle]);

  const onChange = useCallback<PackageOnChange>(
    (elements, appState, files) => {
      const snapshot = toSnapshot(elements, appState, files);
      latestSnapshotRef.current = snapshot;
      latestViewportRef.current = snapshot.viewport;
      // This is the only package-history containment point. It uses the
      // documented imperative API and runs before any Synara observer sees
      // the new scene.
      if (callbacksRef.current.containNativeHistory) clearNativeHistory();
      callbacksRef.current.onSceneChange?.(snapshot);
      callbacksRef.current.onViewportChange?.(snapshot.viewport);

      const observation: SynaraSelectionObservation = {
        selectedElementIds: snapshot.selectedElementIds,
        observedAt: Date.now(),
      };
      callbacksRef.current.onRawSelection?.(observation);
      if (selectionTimerRef.current !== null) clearTimeout(selectionTimerRef.current);
      if (selectionTimeoutRef.current !== null) clearTimeout(selectionTimeoutRef.current);
      const configuredDelay = callbacksRef.current.selectionSettlementDelayMs ?? 0;
      const delay = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : 0;
      if (!Number.isFinite(configuredDelay) || configuredDelay < 0) {
        report({
          code: "invalid-selection-delay",
          ac: "AC5",
          phase: "selection-settlement",
          expected: "a finite non-negative injected settlement delay",
          observed: String(configuredDelay),
          recoverable: true,
        });
      }
      const configuredTimeout = callbacksRef.current.selectionSettlementTimeoutMs;
      if (
        configuredTimeout !== undefined &&
        (!Number.isFinite(configuredTimeout) || configuredTimeout < 0)
      ) {
        report({
          code: "invalid-selection-timeout",
          ac: "AC5",
          phase: "selection-settlement",
          expected: "a finite non-negative injected settlement timeout",
          observed: String(configuredTimeout),
          recoverable: true,
        });
      }
      selectionTimerRef.current = setTimeout(() => {
        const key = snapshot.selectedElementIds.join("\u001f");
        if (selectionTimeoutRef.current !== null) clearTimeout(selectionTimeoutRef.current);
        if (key === lastSettledSelectionKeyRef.current) return;
        const stabilityCheck = callbacksRef.current.selectionStabilityCheck;
        if (stabilityCheck !== undefined) {
          try {
            if (!stabilityCheck(snapshot.selectedElementIds)) {
              report({
                code: "unstable-selection",
                ac: "AC5",
                phase: "selection-settlement",
                expected: "the injected selection policy reports a stable selected-ID set",
                observed: `selection [${snapshot.selectedElementIds.join(", ")}] remained unstable`,
                recoverable: true,
              });
              return;
            }
          } catch (error) {
            report({
              code: "unstable-selection",
              ac: "AC5",
              phase: "selection-settlement",
              expected: "the injected selection policy can determine stability",
              observed: error instanceof Error ? error.message : String(error),
              recoverable: true,
            });
            return;
          }
        }
        lastSettledSelectionKeyRef.current = key;
        const settledAt = Date.now();
        callbacksRef.current.onSettledSelection?.({
          selectedElementIds: snapshot.selectedElementIds,
          observedAt: settledAt,
          settledAfterMs: settledAt - observation.observedAt,
        });
      }, delay);
      if (
        Number.isFinite(configuredTimeout) &&
        configuredTimeout !== undefined &&
        configuredTimeout >= 0
      ) {
        selectionTimeoutRef.current = setTimeout(() => {
          report({
            code: "selection-settlement-timeout",
            ac: "AC5",
            phase: "selection-settlement",
            expected: "the selected-ID set settles within the injected timeout policy",
            observed: `selection [${snapshot.selectedElementIds.join(", ")}] did not settle within ${configuredTimeout}ms`,
            recoverable: true,
          });
        }, configuredTimeout);
      }
    },
    [clearNativeHistory, report],
  );

  const onApiReady = useCallback(
    (api: PackageApi) => {
      apiRef.current = api;
      apiIdRef.current = api.id;
      lifecycle({ kind: "api-ready", apiId: api.id });
      setApiReady(true);
      const snapshot = toSnapshot(api.getSceneElements(), api.getAppState(), api.getFiles());
      latestSnapshotRef.current = snapshot;
      latestViewportRef.current = snapshot.viewport;
    },
    [lifecycle],
  );

  const onScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      const viewport = { scrollX, scrollY, zoom: zoom.value } satisfies SynaraViewport;
      latestViewportRef.current = viewport;
      callbacksRef.current.onViewportChange?.(viewport);
    },
    [],
  );

  if (initialErrorRef.current) return <AdapterFailure diagnostic={initialErrorRef.current} />;

  return (
    <div
      data-ticket01-status="ready"
      data-ticket01-mount-id={mountId}
      style={{ height: "100%", minHeight: 240, minWidth: 320, width: "100%" }}
    >
      <Excalidraw
        initialData={initialDataRef.current}
        viewModeEnabled={viewModeEnabled}
        onChange={onChange}
        onScrollChange={onScrollChange}
        excalidrawAPI={onApiReady}
      />
    </div>
  );
});

SynaraExcalidrawAdapter.displayName = "SynaraExcalidrawAdapter";
