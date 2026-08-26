import {
  Component,
  lazy,
  forwardRef,
  Suspense,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import type {
  SynaraAdapterLifecycleEvent,
  SynaraExcalidrawAdapterProps,
  SynaraExcalidrawDiagnostic,
  SynaraExcalidrawHandle,
  SynaraSceneInput,
  SynaraSceneSnapshot,
  SynaraSceneUpdate,
  SynaraSelectionObservation,
  SynaraViewport,
} from "./SynaraExcalidrawAdapter";

const LazyAdapter = lazy(async () => {
  const module = await import("./SynaraExcalidrawAdapter");
  return { default: module.SynaraExcalidrawAdapter };
});

export interface ExcalidrawTicket01HarnessProps {
  readonly initialScene?: SynaraSceneInput;
  readonly viewModeEnabled?: boolean;
  readonly selectionSettlementDelayMs?: number;
  readonly selectionSettlementTimeoutMs?: number;
  readonly selectionStabilityCheck?: (selectedElementIds: readonly string[]) => boolean;
  /**
   * Lower-seam fault injection for the lazy-loader diagnostic only. Material
   * package behavior is still proved by the real browser harness.
   */
  readonly adapterLoadFailure?: string;
  readonly scenario?: string;
  readonly onDiagnostic?: (diagnostic: SynaraExcalidrawDiagnostic) => void;
  readonly onRawSelection?: (observation: SynaraSelectionObservation) => void;
  readonly onSettledSelection?: (observation: SynaraSelectionObservation) => void;
  readonly onViewportChange?: (viewport: SynaraViewport) => void;
  readonly children?: ReactNode;
}

export interface ExcalidrawTicket01HarnessHandle extends SynaraExcalidrawHandle {
  readonly getDiagnostics: () => readonly SynaraExcalidrawDiagnostic[];
  readonly getLifecycleEvents: () => readonly SynaraAdapterLifecycleEvent[];
}

type ErrorBoundaryState = { readonly error: Error | null };

type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly onError: (error: Error, info: ErrorInfo) => void;
};

class AdapterLoadBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  public override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-ticket01-status="error"
          data-ticket01-diagnostic-code="lazy-load-failed"
          style={{ minHeight: 240, minWidth: 320, padding: 16 }}
        >
          <strong>Whiteboard editor chunk failed to load.</strong>
          <div>{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingState() {
  return (
    <div data-ticket01-status="loading" style={{ minHeight: 240, minWidth: 320, padding: 16 }}>
      Loading whiteboard editor…
    </div>
  );
}

function ForcedAdapterLoadFailure(props: { readonly message: string }): never {
  throw new Error(props.message);
}

export const ExcalidrawTicket01Harness = forwardRef<
  ExcalidrawTicket01HarnessHandle,
  ExcalidrawTicket01HarnessProps
>(function ExcalidrawTicket01Harness(props, ref) {
  const adapterRef = useRef<SynaraExcalidrawHandle | null>(null);
  const diagnosticsRef = useRef<readonly SynaraExcalidrawDiagnostic[]>([]);
  const lifecycleRef = useRef<readonly SynaraAdapterLifecycleEvent[]>([]);
  const [, rerender] = useState(0);
  const onDiagnostic = props.onDiagnostic;

  const recordDiagnostic = useCallback(
    (diagnostic: SynaraExcalidrawDiagnostic) => {
      diagnosticsRef.current = [...diagnosticsRef.current, diagnostic];
      onDiagnostic?.(diagnostic);
      rerender((value) => value + 1);
    },
    [onDiagnostic],
  );

  const recordLifecycle = (event: SynaraAdapterLifecycleEvent) => {
    lifecycleRef.current = [...lifecycleRef.current, event];
    rerender((value) => value + 1);
  };

  const unavailable = useCallback(
    (operation: string): never => {
      const diagnostic: SynaraExcalidrawDiagnostic = {
        code: "adapter-not-ready",
        ac: "AC1",
        phase: operation,
        packageVersion: "0.18.1",
        ...(props.scenario ? { scenario: props.scenario } : {}),
        expected: "the lazy adapter is loaded before imperative use",
        observed: "the adapter is still loading or failed to load",
        recoverable: true,
      };
      recordDiagnostic(diagnostic);
      throw new Error(diagnostic.observed);
    },
    [props.scenario, recordDiagnostic],
  );

  const handle = useMemo<ExcalidrawTicket01HarnessHandle>(
    () => ({
      getIdentity: () => adapterRef.current?.getIdentity() ?? unavailable("get-identity"),
      captureScene: () => adapterRef.current?.captureScene() ?? unavailable("capture-scene"),
      serializeScene: () => adapterRef.current?.serializeScene() ?? unavailable("serialize"),
      exportSvg: () => adapterRef.current?.exportSvg() ?? unavailable("export-svg"),
      exportPng: () => adapterRef.current?.exportPng() ?? unavailable("export-png"),
      updateScene: (update: SynaraSceneUpdate) => {
        const adapter = adapterRef.current;
        if (!adapter) return unavailable("imperative-update");
        adapter.updateScene(update);
      },
      setViewModeEnabled: (enabled: boolean) => {
        const adapter = adapterRef.current;
        if (!adapter) return unavailable("edit-lock");
        adapter.setViewModeEnabled(enabled);
      },
      captureViewport: () =>
        adapterRef.current?.captureViewport() ?? unavailable("capture-viewport"),
      restoreViewport: (viewport: SynaraViewport) => {
        const adapter = adapterRef.current;
        if (!adapter) return unavailable("restore-viewport");
        adapter.restoreViewport(viewport);
      },
      getDiagnostics: () => diagnosticsRef.current,
      getLifecycleEvents: () => lifecycleRef.current,
    }),
    [unavailable],
  );

  useImperativeHandle(ref, () => handle, [handle]);

  const adapterProps: SynaraExcalidrawAdapterProps = {
    ...(props.initialScene ? { initialScene: props.initialScene } : {}),
    ...(props.viewModeEnabled !== undefined ? { viewModeEnabled: props.viewModeEnabled } : {}),
    ...(props.selectionSettlementDelayMs !== undefined
      ? { selectionSettlementDelayMs: props.selectionSettlementDelayMs }
      : {}),
    ...(props.selectionSettlementTimeoutMs !== undefined
      ? { selectionSettlementTimeoutMs: props.selectionSettlementTimeoutMs }
      : {}),
    ...(props.selectionStabilityCheck !== undefined
      ? { selectionStabilityCheck: props.selectionStabilityCheck }
      : {}),
    ...(props.scenario ? { scenario: props.scenario } : {}),
    onDiagnostic: recordDiagnostic,
    onLifecycle: recordLifecycle,
    ...(props.onRawSelection ? { onRawSelection: props.onRawSelection } : {}),
    ...(props.onSettledSelection ? { onSettledSelection: props.onSettledSelection } : {}),
    ...(props.onViewportChange ? { onViewportChange: props.onViewportChange } : {}),
  };

  const mountCount = lifecycleRef.current.filter((event) => event.kind === "mounted").length;
  const latestApiReady = [...lifecycleRef.current]
    .toReversed()
    .find((event) => event.kind === "api-ready");
  const latestDiagnostic = diagnosticsRef.current.at(-1);

  return (
    <div
      data-ticket01-harness="true"
      data-ticket01-status={latestDiagnostic ? "diagnostic" : "ready"}
      data-ticket01-mount-count={mountCount}
      data-ticket01-api-id={latestApiReady?.apiId ?? ""}
      data-ticket01-diagnostic-count={diagnosticsRef.current.length}
      style={{ height: "100%", minHeight: 240, minWidth: 320, position: "relative", width: "100%" }}
    >
      <AdapterLoadBoundary
        onError={(error) => {
          recordDiagnostic({
            code: "lazy-load-failed",
            ac: "AC1",
            phase: "lazy-loader",
            packageVersion: "0.18.1",
            ...(props.scenario ? { scenario: props.scenario } : {}),
            expected: "the adapter and package chunk load through the isolated lazy boundary",
            observed: error.message,
            cause: error.name,
            recoverable: false,
          });
        }}
      >
        {props.adapterLoadFailure ? (
          <ForcedAdapterLoadFailure message={props.adapterLoadFailure} />
        ) : null}
        <Suspense fallback={<LoadingState />}>
          <LazyAdapter ref={adapterRef} {...adapterProps} />
        </Suspense>
      </AdapterLoadBoundary>
      {props.children}
    </div>
  );
});

ExcalidrawTicket01Harness.displayName = "ExcalidrawTicket01Harness";

export type { SynaraSceneInput, SynaraSceneSnapshot };
