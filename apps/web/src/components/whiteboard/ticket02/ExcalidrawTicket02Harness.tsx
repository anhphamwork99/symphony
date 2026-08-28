import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type {
  SynaraAdapterLifecycleEvent,
  SynaraExcalidrawAdapterProps,
  SynaraExcalidrawDiagnostic,
  SynaraExcalidrawHandle,
  SynaraSceneInput,
  SynaraSceneObservation,
} from "../ticket01/SynaraExcalidrawAdapter";
import { SynaraAiHistoryActions } from "./SynaraAiHistoryActions";
import { SynaraAiHistoryCoordinator, type SynaraAiHistoryHost } from "./SynaraAiHistoryCoordinator";
import {
  captureDocumentSnapshot,
  documentSnapshotsEqual,
  semanticFingerprint,
  type SynaraDocumentSnapshot,
} from "./SynaraDocumentSnapshot";
import {
  SynaraWhiteboardOperationBridge,
  type SynaraWhiteboardOperationOutcome,
  type SynaraWhiteboardOperationTransport,
} from "./SynaraWhiteboardOperationBridge";
import type { SynaraSettlementResult } from "./SynaraHumanMutationSettlement";
import type {
  SynaraAiCommandTrace,
  SynaraAiHistoryState,
  SynaraHistoryDiagnostic,
  SynaraHistoryDiagnosticCode,
} from "./SynaraAiHistoryTypes";

const LazyAdapter = lazy(async () => {
  const module = await import("../ticket01/SynaraExcalidrawAdapter");
  return { default: module.SynaraExcalidrawAdapter };
});

/** Session fields the test-only operation bridge composition attaches with. */
export interface ExcalidrawTicket02OperationSessionProps {
  readonly projectId: string;
  readonly documentKind: "file-canvas" | "untitled-canvas";
  readonly documentId: string;
  readonly expectedDocumentRevision: number;
}

export interface ExcalidrawTicket02HarnessProps {
  readonly initialScene?: SynaraSceneInput;
  readonly scenario?: string;
  readonly settlementMaxWaitMs?: number;
  readonly onDiagnostic?: (diagnostic: SynaraHistoryDiagnostic) => void;
  /**
   * Test-only WP-B3 composition (Decision 0063 §9): a deterministic
   * contract-level transport fixture driving the real dormant operation
   * bridge. Never set in production UI.
   */
  readonly operationSession?: ExcalidrawTicket02OperationSessionProps & {
    readonly transport: SynaraWhiteboardOperationTransport;
  };
}

export interface ExcalidrawTicket02HarnessHandle {
  readonly getAdapter: () => SynaraExcalidrawHandle;
  readonly getHistory: () => SynaraAiHistoryState;
  readonly getDiagnostics: () => readonly SynaraHistoryDiagnostic[];
  readonly getCommandTraces: () => readonly SynaraAiCommandTrace[];
  readonly getSettlements: () => readonly SynaraSettlementResult[];
  readonly beginFakeOperation: (
    batchId: string,
    operationId?: string,
    generation?: number,
  ) => Promise<void>;
  readonly applyFakeProgress: (
    batchId: string,
    operationLocalSequence: number,
    update: SynaraSceneInput,
    generation?: number,
  ) => {
    readonly adapterGlobalSyntheticSequence: number;
    readonly correlationId: string;
    readonly acknowledgement: Promise<void>;
  };
  readonly completeFakeOperation: (batchId: string) => Promise<void>;
  readonly undoAiBatch: () => Promise<boolean>;
  readonly redoAiBatch: () => Promise<boolean>;
  readonly settleHumanMutation: () => Promise<SynaraSettlementResult>;
  /** Test-only WP-B3: opens the real operation bridge session exactly once. */
  readonly startOperationSession: () => Promise<void>;
  /** Test-only WP-B3: the real bridge (state, identity, resume cursor), or null before start. */
  readonly getOperationBridge: () => SynaraWhiteboardOperationBridge | null;
  /** Test-only WP-B3: terminal outcomes the real bridge exposed. */
  readonly getOperationOutcomes: () => readonly SynaraWhiteboardOperationOutcome[];
  /** Test-only WP-B3: transport-level diagnostics emitted by the real bridge. */
  readonly getOperationDiagnostics: () => readonly unknown[];
}

type OpenHumanFamily = "pointer" | "keyboard" | "text" | null;

function unavailable(operation: string): never {
  throw new Error(`Ticket 02 adapter is not ready for ${operation}`);
}

const REQUIRED_ADAPTER_CODES = new Set<SynaraHistoryDiagnosticCode>([
  "adapter-not-ready",
  "synthetic-sequence-mismatch",
  "synthetic-scope-unresolved",
  "duplicate-synthetic-callback",
  "unknown-callback-provenance",
  "stale-operation-generation",
  "stale-route-epoch",
  "stale-session-epoch",
  "stale-mount-identity",
  "stale-mutation-revision",
  "semantic-verification-mismatch",
  "native-history-clear-failed",
  "native-history-reappeared-after-clear",
  "edit-lock-failed",
  "native-mutation-during-ai-lock",
  "identity-changed-unexpectedly",
  "human-settlement-uncertain",
]);

export const ExcalidrawTicket02Harness = forwardRef<
  ExcalidrawTicket02HarnessHandle,
  ExcalidrawTicket02HarnessProps
>(function ExcalidrawTicket02Harness(props, ref) {
  const adapterRef = useRef<SynaraExcalidrawHandle | null>(null);
  const coordinatorRef = useRef<SynaraAiHistoryCoordinator | null>(null);
  const lastSceneRef = useRef<SynaraDocumentSnapshot | null>(null);
  const editingTextRef = useRef(false);
  const humanObservationReadyRef = useRef(false);
  const openHumanFamilyRef = useRef<OpenHumanFamily>(null);
  const settlementScheduledRef = useRef(false);
  const settlementPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAdapterDiagnosticsRef = useRef<SynaraExcalidrawDiagnostic[]>([]);
  const operationBridgeRef = useRef<SynaraWhiteboardOperationBridge | null>(null);
  const operationOutcomesRef = useRef<SynaraWhiteboardOperationOutcome[]>([]);
  const operationDiagnosticsRef = useRef<unknown[]>([]);
  const [, rerender] = useState(0);

  const getAdapter = useCallback(() => adapterRef.current ?? unavailable("adapter"), []);

  const ensureCoordinator = useCallback((): SynaraAiHistoryCoordinator => {
    if (coordinatorRef.current !== null) return coordinatorRef.current;
    const adapter = getAdapter();
    if (adapter.getIdentity().apiId === null) return unavailable("history coordinator");
    const coordinator = new SynaraAiHistoryCoordinator(adapter as SynaraAiHistoryHost, {
      canvasIdentity: "ticket-02-gate-canvas",
      scenario: props.scenario ?? "ticket-02-fallback-gate",
      settlementMaxWaitMs: props.settlementMaxWaitMs ?? 500,
      ...(props.onDiagnostic === undefined ? {} : { onDiagnostic: props.onDiagnostic }),
    });
    coordinatorRef.current = coordinator;
    for (const diagnostic of pendingAdapterDiagnosticsRef.current.splice(0)) {
      if (!REQUIRED_ADAPTER_CODES.has(diagnostic.code as SynaraHistoryDiagnosticCode)) continue;
      coordinator.recordAdapterDiagnostic({
        code: diagnostic.code as SynaraHistoryDiagnosticCode,
        phase: diagnostic.phase,
        expected: diagnostic.expected,
        observed: diagnostic.observed,
      });
    }
    return coordinator;
  }, [getAdapter, props.onDiagnostic, props.scenario, props.settlementMaxWaitMs]);

  const snapshotNow = useCallback(
    () => captureDocumentSnapshot(getAdapter().captureScene()),
    [getAdapter],
  );

  const scheduleSettlement = useCallback(() => {
    if (settlementScheduledRef.current) return;
    settlementScheduledRef.current = true;
    settlementPromiseRef.current = settlementPromiseRef.current.then(() =>
      ensureCoordinator()
        .settleHumanMutation()
        .then(() => undefined)
        .finally(() => {
          settlementScheduledRef.current = false;
          rerender((value) => value + 1);
        }),
    );
  }, [ensureCoordinator]);

  const awaitRenderAndSettlementDrain = useCallback(async () => {
    const deadline = Date.now() + (props.settlementMaxWaitMs ?? 500);
    for (;;) {
      const before = adapterRef.current?.observeHostBoundary().adapterCallbackSequence ?? 0;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await settlementPromiseRef.current;
      const after = adapterRef.current?.observeHostBoundary().adapterCallbackSequence ?? 0;
      if (!settlementScheduledRef.current && before === after) return;
      if (Date.now() >= deadline) return;
    }
  }, [props.settlementMaxWaitMs]);

  const onSceneObservation = useCallback(
    (observation: SynaraSceneObservation) => {
      const coordinator = ensureCoordinator();
      const beforeSnapshot = lastSceneRef.current;
      const snapshot = captureDocumentSnapshot(observation.snapshot);
      lastSceneRef.current = snapshot;
      if (!humanObservationReadyRef.current) return;
      if (observation.provenance === "synthetic") {
        rerender((value) => value + 1);
        return;
      }
      if (observation.provenance === "presentation") {
        rerender((value) => value + 1);
        return;
      }
      if (observation.provenance === "rejected") {
        coordinator.failClosedForUnknownCallback();
        rerender((value) => value + 1);
        return;
      }
      const lockState = coordinator.getState().lockState;
      if (
        (lockState === "ai-batch" || lockState === "restore") &&
        beforeSnapshot !== null &&
        documentSnapshotsEqual(beforeSnapshot, snapshot)
      ) {
        rerender((value) => value + 1);
        return;
      }
      const editingText = getAdapter().observeHostBoundary().editingTextActive;
      if (editingText && !editingTextRef.current) {
        editingTextRef.current = true;
        openHumanFamilyRef.current = "text";
        coordinator.observeSettlementInput({ kind: "text-edit-active", snapshot });
      }
      coordinator.observeSettlementInput({
        kind: "semantic-callback",
        snapshot,
        ...(beforeSnapshot === null ? {} : { beforeSnapshot }),
        adapterCallbackSequence: observation.adapterCallbackSequence,
        callbackProvenance: "human",
      });
      if (!editingText && editingTextRef.current) {
        editingTextRef.current = false;
        coordinator.observeSettlementInput({ kind: "text-edit-inactive", snapshot });
        openHumanFamilyRef.current = null;
        scheduleSettlement();
      } else if (openHumanFamilyRef.current === null) {
        scheduleSettlement();
      }
      rerender((value) => value + 1);
    },
    [ensureCoordinator, getAdapter, scheduleSettlement],
  );

  const onLifecycle = useCallback(
    (event: SynaraAdapterLifecycleEvent) => {
      if (event.kind === "api-ready") {
        const coordinator = ensureCoordinator();
        lastSceneRef.current = snapshotNow();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            humanObservationReadyRef.current = true;
            rerender((value) => value + 1);
          }),
        );
        void coordinator;
      }
      rerender((value) => value + 1);
    },
    [ensureCoordinator, snapshotNow],
  );

  const onAdapterDiagnostic = useCallback((diagnostic: SynaraExcalidrawDiagnostic) => {
    const coordinator = coordinatorRef.current;
    if (coordinator === null) {
      pendingAdapterDiagnosticsRef.current.push(diagnostic);
    } else if (REQUIRED_ADAPTER_CODES.has(diagnostic.code as SynaraHistoryDiagnosticCode)) {
      coordinator.recordAdapterDiagnostic({
        code: diagnostic.code as SynaraHistoryDiagnosticCode,
        phase: diagnostic.phase,
        expected: diagnostic.expected,
        observed: diagnostic.observed,
      });
    }
    rerender((value) => value + 1);
  }, []);

  const observePointer = useCallback(
    (kind: "pointer-down" | "pointer-up" | "pointer-cancel") => {
      const coordinator = ensureCoordinator();
      const snapshot = snapshotNow();
      if (kind === "pointer-down") {
        openHumanFamilyRef.current = "pointer";
        coordinator.observeSettlementInput({ kind, snapshot });
        return;
      }
      coordinator.observeSettlementInput({ kind, snapshot });
      if (openHumanFamilyRef.current === "pointer") {
        if (getAdapter().observeHostBoundary().editingTextActive) {
          editingTextRef.current = true;
          openHumanFamilyRef.current = "text";
          coordinator.observeSettlementInput({ kind: "text-edit-active", snapshot });
          return;
        }
        openHumanFamilyRef.current = null;
        scheduleSettlement();
      }
    },
    [ensureCoordinator, getAdapter, scheduleSettlement, snapshotNow],
  );

  const observeKeyboard = useCallback(
    (kind: "key-down" | "key-up", key: string, primaryModifier: boolean) => {
      const editingText = getAdapter().observeHostBoundary().editingTextActive;
      if (editingText && !editingTextRef.current) {
        const coordinator = ensureCoordinator();
        const snapshot = snapshotNow();
        editingTextRef.current = true;
        openHumanFamilyRef.current = "text";
        coordinator.observeSettlementInput({ kind: "text-edit-active", snapshot });
      }
      const candidate =
        key === "Delete" || key === "Backspace" || (primaryModifier && /[zy]/i.test(key));
      if (!candidate || editingTextRef.current) return;
      const coordinator = ensureCoordinator();
      const snapshot = snapshotNow();
      if (kind === "key-down") {
        openHumanFamilyRef.current = "keyboard";
        coordinator.observeSettlementInput({ kind: "keyboard-candidate", key, snapshot });
      } else {
        coordinator.observeSettlementInput({ kind: "keyboard-keyup", key, snapshot });
        if (openHumanFamilyRef.current === "keyboard") {
          openHumanFamilyRef.current = null;
          scheduleSettlement();
        }
      }
    },
    [ensureCoordinator, getAdapter, scheduleSettlement, snapshotNow],
  );

  const observeComposition = useCallback(
    (kind: "composition-start" | "composition-update" | "composition-end") => {
      const coordinator = ensureCoordinator();
      const snapshot = snapshotNow();
      if (kind === "composition-start") {
        openHumanFamilyRef.current = "text";
        editingTextRef.current = true;
        coordinator.observeSettlementInput({ kind, snapshot });
      } else if (kind === "composition-update") {
        coordinator.observeSettlementInput({ kind, snapshot });
      } else {
        coordinator.observeSettlementInput({ kind, snapshot });
        coordinator.observeSettlementInput({ kind: "text-edit-inactive", snapshot });
        openHumanFamilyRef.current = null;
        editingTextRef.current = false;
        scheduleSettlement();
      }
    },
    [ensureCoordinator, scheduleSettlement, snapshotNow],
  );

  const observePresentation = useCallback(
    (kind: "selection" | "viewport" | "tool" | "focus") => {
      if (openHumanFamilyRef.current !== null || coordinatorRef.current === null) return;
      ensureCoordinator().observeSettlementInput({
        kind: kind === "focus" ? "focus" : "presentation",
        snapshot: snapshotNow(),
      });
      scheduleSettlement();
    },
    [ensureCoordinator, scheduleSettlement, snapshotNow],
  );

  const startOperationSession = useCallback(async (): Promise<void> => {
    const session = props.operationSession;
    if (session === undefined) {
      throw new Error("no operation session is composed for this harness");
    }
    if (operationBridgeRef.current !== null) {
      throw new Error("operation bridge already started");
    }
    const bridge = new SynaraWhiteboardOperationBridge(session.transport, {
      projectId: session.projectId,
      documentKind: session.documentKind,
      documentId: session.documentId,
      canvasIdentity: "ticket-02-gate-canvas",
      expectedDocumentRevision: session.expectedDocumentRevision,
      host: getAdapter() as unknown as SynaraAiHistoryHost,
      // The real harness coordinator stays the sole AI-history owner.
      createCoordinator: () => ensureCoordinator(),
      scenario: props.scenario ?? "ticket-02-fallback-gate",
      onDiagnostic: (diagnostic) => {
        operationDiagnosticsRef.current = [...operationDiagnosticsRef.current, diagnostic];
        props.onDiagnostic?.(diagnostic as SynaraHistoryDiagnostic);
      },
      onOutcome: (outcome) => {
        operationOutcomesRef.current = [...operationOutcomesRef.current, outcome];
        rerender((value) => value + 1);
      },
    });
    operationBridgeRef.current = bridge;
    await bridge.startSession();
    rerender((value) => value + 1);
  }, [ensureCoordinator, getAdapter, props.operationSession, props.scenario, props.onDiagnostic]);

  useImperativeHandle(
    ref,
    (): ExcalidrawTicket02HarnessHandle => ({
      getAdapter,
      getHistory: () => ensureCoordinator().getState(),
      getDiagnostics: () => ensureCoordinator().getDiagnostics(),
      getCommandTraces: () => ensureCoordinator().getTraces(),
      getSettlements: () => ensureCoordinator().getSettlements(),
      beginFakeOperation: async (batchId, operationId = "fake-operation", generation = 1) => {
        await settlementPromiseRef.current;
        await ensureCoordinator().beginAiOperation({
          batchId,
          operationId,
          operationGeneration: generation,
        });
        rerender((value) => value + 1);
      },
      applyFakeProgress: (batchId, operationLocalSequence, update, generation = 1) => {
        const receipt = ensureCoordinator().applyAiProgress({
          batchId,
          operationGeneration: generation,
          operationLocalSequence,
          update,
        });
        rerender((value) => value + 1);
        return receipt;
      },
      completeFakeOperation: async (batchId) => {
        await ensureCoordinator().completeAiOperation(batchId);
        await awaitRenderAndSettlementDrain();
        rerender((value) => value + 1);
      },
      undoAiBatch: async () => {
        const moved = await ensureCoordinator().undoAiBatch();
        await awaitRenderAndSettlementDrain();
        rerender((value) => value + 1);
        return moved;
      },
      redoAiBatch: async () => {
        const moved = await ensureCoordinator().redoAiBatch();
        await awaitRenderAndSettlementDrain();
        rerender((value) => value + 1);
        return moved;
      },
      settleHumanMutation: async () => {
        const settled = await ensureCoordinator().settleHumanMutation();
        rerender((value) => value + 1);
        return settled;
      },
      startOperationSession,
      getOperationBridge: () => operationBridgeRef.current,
      getOperationOutcomes: () => operationOutcomesRef.current,
      getOperationDiagnostics: () => operationDiagnosticsRef.current,
    }),
    [awaitRenderAndSettlementDrain, ensureCoordinator, getAdapter, startOperationSession],
  );

  const state = coordinatorRef.current?.getState();
  const adapterProps: SynaraExcalidrawAdapterProps = {
    ...(props.initialScene === undefined ? {} : { initialScene: props.initialScene }),
    scenario: props.scenario ?? "ticket-02-fallback-gate",
    syntheticDrainWindowMs: props.settlementMaxWaitMs ?? 500,
    projectSceneForSyntheticWrite: semanticFingerprint,
    getSyntheticFenceContext: () => {
      const state = ensureCoordinator().getState();
      return {
        canvasIdentity: state.identity.canvasIdentity,
        sessionEpoch: state.identity.sessionEpoch,
        routeEpoch: state.routeEpoch,
        mutationRevision: state.mutationRevision,
      };
    },
    onLifecycle,
    onDiagnostic: onAdapterDiagnostic,
    onSceneObservation,
    onPointerActivity: observePointer,
    onKeyboardActivity: (kind, key, primaryModifier) => observeKeyboard(kind, key, primaryModifier),
    onCompositionActivity: observeComposition,
    onFocusActivity: () => observePresentation("focus"),
    onPresentationActivity: observePresentation,
    onUncorrelatableCallback: () => coordinatorRef.current?.failClosedForUnknownCallback(),
  };

  return (
    <div
      data-ticket02-harness="true"
      data-ticket02-event-count={state?.events.length ?? 0}
      data-ticket02-cursor={state?.cursor ?? 0}
      data-ticket02-lock={state?.lockState ?? "initializing"}
      style={{ height: "100%", minHeight: 240, minWidth: 320, position: "relative", width: "100%" }}
    >
      <SynaraAiHistoryActions
        canUndo={coordinatorRef.current?.canUndoAiBatch() ?? false}
        canRedo={coordinatorRef.current?.canRedoAiBatch() ?? false}
        undoReason="No completed AI batch is currently actionable."
        redoReason="No undone AI batch is currently actionable."
        busy={state?.lockState !== "unlocked"}
        onUndo={() => {
          void ensureCoordinator()
            .undoAiBatch()
            .then(awaitRenderAndSettlementDrain)
            .finally(() => rerender((value) => value + 1));
        }}
        onRedo={() => {
          void ensureCoordinator()
            .redoAiBatch()
            .then(awaitRenderAndSettlementDrain)
            .finally(() => rerender((value) => value + 1));
        }}
      />
      <button
        type="button"
        aria-label="Cancelled pointer settlement probe"
        data-ticket02-cancelled-pointer-probe="true"
        onPointerDown={() => observePointer("pointer-down")}
        onPointerCancel={() => observePointer("pointer-cancel")}
        style={{
          height: 1,
          opacity: 0,
          overflow: "hidden",
          padding: 0,
          position: "absolute",
          width: 1,
        }}
      />
      <Suspense fallback={<div data-ticket02-status="loading">Loading whiteboard editor…</div>}>
        <LazyAdapter ref={adapterRef} {...adapterProps} />
      </Suspense>
    </div>
  );
});

ExcalidrawTicket02Harness.displayName = "ExcalidrawTicket02Harness";
