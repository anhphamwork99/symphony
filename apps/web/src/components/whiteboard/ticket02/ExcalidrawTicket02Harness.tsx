import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  SynaraAdapterLifecycleEvent,
  SynaraExcalidrawAdapterProps,
  SynaraExcalidrawDiagnostic,
  SynaraExcalidrawHandle,
  SynaraSceneInput,
  SynaraSceneSnapshot,
} from "../ticket01/SynaraExcalidrawAdapter";
import { captureDocumentSnapshot } from "./SynaraDocumentSnapshot";
import { SynaraHistoryCommands } from "./SynaraHistoryCommands";
import { SynaraSessionHistory } from "./SynaraSessionHistory";
import type {
  SynaraHistoryCommand,
  SynaraHistoryDiagnostic,
  SynaraHistoryState,
  SynaraHistoryTrace,
} from "./SynaraHistoryTypes";

const LazyAdapter = lazy(async () => {
  const module = await import("../ticket01/SynaraExcalidrawAdapter");
  return { default: module.SynaraExcalidrawAdapter };
});

export interface ExcalidrawTicket02HarnessProps {
  readonly initialScene?: SynaraSceneInput;
  readonly scenario?: string;
  readonly onDiagnostic?: (diagnostic: SynaraExcalidrawDiagnostic) => void;
  readonly children?: ReactNode;
}

export interface ExcalidrawTicket02HarnessHandle {
  readonly getAdapter: () => SynaraExcalidrawHandle;
  readonly getHistory: () => SynaraHistoryState;
  readonly getHistoryDiagnostics: () => readonly SynaraHistoryDiagnostic[];
  readonly getHistoryTraces: () => readonly SynaraHistoryTrace[];
  readonly beginAiBatch: (batchId: string) => void;
  readonly applyAiProgress: (
    batchId: string,
    update: SynaraSceneInput & { readonly sequence: number },
  ) => void;
  readonly completeAiBatch: (batchId: string) => void;
  readonly dispatch: (command: SynaraHistoryCommand) => boolean;
}

function unavailable(operation: string): never {
  throw new Error(`Ticket 02 adapter is not ready for ${operation}`);
}

export const ExcalidrawTicket02Harness = forwardRef<
  ExcalidrawTicket02HarnessHandle,
  ExcalidrawTicket02HarnessProps
>(function ExcalidrawTicket02Harness(props, ref) {
  const adapterRef = useRef<SynaraExcalidrawHandle | null>(null);
  const historyRef = useRef<SynaraSessionHistory | null>(null);
  const commandsRef = useRef<SynaraHistoryCommands | null>(null);
  const lastSceneRef = useRef<SynaraSceneSnapshot | null>(null);
  const suppressSceneObservationRef = useRef(false);
  const suppressedFingerprintsRef = useRef(new Set<string>());
  const [, rerender] = useState(0);

  const ensureHistory = useCallback((): SynaraSessionHistory => {
    const adapter = adapterRef.current;
    if (!adapter) return unavailable("history");
    if (historyRef.current === null) {
      historyRef.current = new SynaraSessionHistory({
        captureScene: adapter.captureScene,
        restoreScene: (snapshot) => {
          suppressedFingerprintsRef.current.add(
            captureDocumentSnapshot(snapshot).semanticFingerprint,
          );
          suppressSceneObservationRef.current = true;
          try {
            adapter.restoreScene(snapshot);
          } finally {
            suppressSceneObservationRef.current = false;
          }
        },
        applyProgress: (update) => {
          suppressedFingerprintsRef.current.add(
            captureDocumentSnapshot({
              ...adapter.captureScene(),
              ...(update.elements !== undefined ? { elements: update.elements } : {}),
              ...(update.files !== undefined ? { files: update.files } : {}),
            }).semanticFingerprint,
          );
          suppressSceneObservationRef.current = true;
          try {
            adapter.updateScene(update);
          } finally {
            suppressSceneObservationRef.current = false;
          }
        },
      });
      commandsRef.current = new SynaraHistoryCommands(historyRef.current);
    }
    return historyRef.current;
  }, []);

  const onSceneChange = useCallback((scene: SynaraSceneSnapshot) => {
    const prior = lastSceneRef.current;
    lastSceneRef.current = scene;
    const fingerprint = captureDocumentSnapshot(scene).semanticFingerprint;
    if (suppressedFingerprintsRef.current.delete(fingerprint)) {
      rerender((value) => value + 1);
      return;
    }
    if (suppressSceneObservationRef.current) {
      rerender((value) => value + 1);
      return;
    }
    const history = historyRef.current;
    if (history && prior && history.getState().activeTransaction === "none") {
      history.recordHumanMutation(prior, scene);
    }
    rerender((value) => value + 1);
  }, []);

  const onLifecycle = useCallback((event: SynaraAdapterLifecycleEvent) => {
    if (event.kind === "api-ready" && lastSceneRef.current === null && adapterRef.current) {
      lastSceneRef.current = adapterRef.current.captureScene();
    }
    rerender((value) => value + 1);
  }, []);

  const dispatch = useCallback((command: SynaraHistoryCommand): boolean => {
    if (adapterRef.current?.isNativeHistorySettlementPending?.()) return false;
    return commandsRef.current?.dispatch(command) ?? false;
  }, []);

  const handle = useMemo<ExcalidrawTicket02HarnessHandle>(
    () => ({
      getAdapter: () => adapterRef.current ?? unavailable("adapter"),
      getHistory: () => ensureHistory().getState(),
      getHistoryDiagnostics: () => ensureHistory().getDiagnostics(),
      getHistoryTraces: () => ensureHistory().getTraces(),
      beginAiBatch: (batchId) => ensureHistory().beginAiBatch(batchId),
      applyAiProgress: (batchId, update) => ensureHistory().applyAiProgress(batchId, update),
      completeAiBatch: (batchId) => {
        ensureHistory().completeAiBatch(batchId);
        rerender((value) => value + 1);
      },
      dispatch,
    }),
    [dispatch, ensureHistory],
  );

  useImperativeHandle(ref, () => handle, [handle]);

  const adapterProps: SynaraExcalidrawAdapterProps = {
    ...(props.initialScene ? { initialScene: props.initialScene } : {}),
    ...(props.scenario ? { scenario: props.scenario } : {}),
    onLifecycle,
    onSceneChange,
    containNativeHistory: true,
    ...(props.onDiagnostic ? { onDiagnostic: props.onDiagnostic } : {}),
  };
  const state = historyRef.current?.getState();
  const latestTrace = historyRef.current?.getTraces().at(-1);

  return (
    <div
      data-ticket02-harness="true"
      data-ticket02-mount-count="1"
      data-ticket02-event-count={state?.events.length ?? 0}
      data-ticket02-cursor={state?.cursor ?? 0}
      data-ticket02-fingerprint={latestTrace?.fingerprint ?? ""}
      onKeyDownCapture={(event) => {
        const isUndo =
          (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z";
        const isRedo =
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"));
        if (!isUndo && !isRedo) return;
        event.preventDefault();
        event.stopPropagation();
        dispatch(isRedo ? "redo" : "undo");
      }}
      style={{ height: "100%", minHeight: 240, minWidth: 320, position: "relative", width: "100%" }}
    >
      <div aria-label="Synara history controls" role="toolbar">
        <button type="button" onClick={() => dispatch("undo")}>
          Synara Undo
        </button>
        <button type="button" onClick={() => dispatch("redo")}>
          Synara Redo
        </button>
      </div>
      <Suspense fallback={<div data-ticket02-status="loading">Loading whiteboard editor…</div>}>
        <LazyAdapter ref={adapterRef} {...adapterProps} />
      </Suspense>
      {props.children}
    </div>
  );
});

ExcalidrawTicket02Harness.displayName = "ExcalidrawTicket02Harness";

export { captureDocumentSnapshot };
