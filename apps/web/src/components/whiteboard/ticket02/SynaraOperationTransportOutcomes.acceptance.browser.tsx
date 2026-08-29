import "../../../index.css";

import { createRef, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type {
  WhiteboardOperationAttachSessionResult,
  WhiteboardOperationSessionEvent,
} from "@synara/contracts";

import type {
  SynaraSceneInput,
  SynaraSceneSnapshot,
  SynaraSyntheticTraceEntry,
} from "../ticket01/SynaraExcalidrawAdapter";
import {
  TICKET01_CARD_ID,
  makeExcalidrawTicket01Fixture,
} from "../ticket01/excalidrawTicket01Fixture";
import { captureDocumentSnapshot } from "./SynaraDocumentSnapshot";
import {
  ExcalidrawTicket02Harness,
  type ExcalidrawTicket02HarnessHandle,
} from "./ExcalidrawTicket02Harness";
import { WsTransport } from "../../../wsTransport";
import type { SynaraWhiteboardOperationTransport } from "./SynaraWhiteboardOperationBridge";

const CAPABILITY = "whiteboard.operation-session-v1";

/** Matches the branded ProjectId wire type at the contract boundary. */
const projectId = "project-wp-b3" as unknown as import("@synara/contracts").ProjectId;

const IDENTITY = {
  serverInstanceId: "server-instance-wp-b3",
  operationSessionId: "wb-op-session-wp-b3",
  sessionEpoch: 1,
  projectId,
  documentKind: "file-canvas" as const,
  documentId: "doc-wp-b3",
  canvasIdentity: "ticket-02-gate-canvas",
};

const ATTACH_RESULT: WhiteboardOperationAttachSessionResult = {
  ...IDENTITY,
  documentRevision: 0,
} as unknown as WhiteboardOperationAttachSessionResult;

const BATCH_ID = "batch-wp-b3";
const OPERATION_ID = "operation-wp-b3";
const GENERATION = 1;

function Shell(props: { readonly children: ReactNode }) {
  return <div style={{ height: 720, minHeight: 720, width: 1120 }}>{props.children}</div>;
}

function imageFreeFixture(): SynaraSceneInput {
  const fixture = makeExcalidrawTicket01Fixture();
  return {
    elements: fixture.elements.filter((element) => element.type !== "image"),
    files: {},
  } as unknown as SynaraSceneInput;
}

/**
 * Deterministic contract-level transport fixture (Decision 0063 §11): the
 * exact WP-B1 transport surface with strict server-sequence bookkeeping and
 * no socket, no timers, and no server. It delivers real session events to the
 * real dormant bridge only when a test emits them.
 */
interface ProductionGateSubscription {
  identity: typeof IDENTITY | null;
  readonly expectedIdentity: typeof IDENTITY;
  lastAcceptedServerSequence: number;
  awaitingSnapshotFence: boolean;
  readonly acceptedEvents: Map<number, WhiteboardOperationSessionEvent>;
  readonly listener: (event: WhiteboardOperationSessionEvent) => boolean | void;
}

class TransportFixture implements SynaraWhiteboardOperationTransport {
  public attachInputs: unknown[] = [];
  public subscribeInputs: unknown[] = [];
  public ackInputs: unknown[] = [];
  public failureInputs: { code: string; operationSessionId?: string }[] = [];
  /** The next acknowledgement send throws, simulating an interrupted transport. */
  public ackRejectNext = false;
  public ackInterruptCount = 0;

  private readonly capabilities: readonly string[];
  private readonly productionGate = new WsTransport("ws://whiteboard-gate.invalid");
  private gateSubscription: ProductionGateSubscription | null = null;
  private readonly failureListeners = new Set<
    (failure: { readonly code: string; readonly operationSessionId?: string }) => void
  >();

  public constructor(capabilities: readonly string[] = [CAPABILITY]) {
    this.capabilities = capabilities;
    this.productionGate.onWhiteboardOperationFailure((failure) => {
      this.gateSubscription = null;
      this.failureInputs.push({
        code: failure.code,
        operationSessionId: failure.operationSessionId,
      });
      for (const listener of [...this.failureListeners]) {
        listener({ code: failure.code, operationSessionId: failure.operationSessionId });
      }
    });
  }

  public hasWhiteboardOperationCapability(): boolean {
    return this.capabilities.includes(CAPABILITY);
  }

  public onWhiteboardOperationFailure(
    listener: (failure: { readonly code: string; readonly operationSessionId?: string }) => void,
  ): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  public async whiteboardOperationAttachSession(input: {
    readonly projectId: string;
    readonly documentKind: "file-canvas" | "untitled-canvas";
    readonly documentId: string;
    readonly canvasIdentity: string;
    readonly expectedDocumentRevision: number;
  }): Promise<WhiteboardOperationAttachSessionResult> {
    this.attachInputs.push(input);
    return ATTACH_RESULT;
  }

  public whiteboardOperationSubscribe(
    input: unknown,
    listener: (event: WhiteboardOperationSessionEvent) => boolean | void,
  ): () => void {
    this.subscribeInputs.push(input);
    const subscribeInput = input as typeof IDENTITY & { readonly lastServerSequence: number };
    const subscription: ProductionGateSubscription = {
      identity: null,
      expectedIdentity: IDENTITY,
      lastAcceptedServerSequence: subscribeInput.lastServerSequence,
      awaitingSnapshotFence: true,
      acceptedEvents: new Map(),
      listener,
    };
    this.gateSubscription = subscription;
    (
      this.productionGate as unknown as {
        whiteboardOperationSubscriptions: Map<string, ProductionGateSubscription>;
      }
    ).whiteboardOperationSubscriptions.set(IDENTITY.operationSessionId, subscription);
    return () => {
      if (this.gateSubscription === subscription) this.gateSubscription = null;
    };
  }

  public async whiteboardOperationAcknowledgeApplication(input: unknown): Promise<unknown> {
    this.ackInputs.push(input);
    if (this.ackRejectNext) {
      this.ackRejectNext = false;
      this.ackInterruptCount += 1;
      throw Object.assign(new Error("transport interrupted"), { retryable: true });
    }
    return { ...IDENTITY };
  }

  public beginStream(): void {
    if (this.gateSubscription !== null) {
      this.gateSubscription.awaitingSnapshotFence = true;
    }
  }

  public emit(event: WhiteboardOperationSessionEvent): void {
    if (this.gateSubscription === null) return;
    (
      this.productionGate as unknown as {
        handleWhiteboardOperationEvent: (
          operationSessionId: string,
          subscription: ProductionGateSubscription,
          event: WhiteboardOperationSessionEvent,
        ) => void;
      }
    ).handleWhiteboardOperationEvent(
      IDENTITY.operationSessionId,
      this.gateSubscription,
      event,
    );
  }

  public emitFailure(code: string, operationSessionId = IDENTITY.operationSessionId): void {
    this.failureInputs.push({ code, operationSessionId });
    for (const listener of [...this.failureListeners]) listener({ code, operationSessionId });
  }
}

interface HarnessRig {
  readonly handle: ExcalidrawTicket02HarnessHandle;
  readonly transport: TransportFixture;
  readonly mounted: { unmount: () => Promise<void> };
}

async function mountOperationHarness(scenario: string): Promise<HarnessRig> {
  const transport = new TransportFixture();
  const ref = createRef<ExcalidrawTicket02HarnessHandle>();
  const mounted = await render(
    <Shell>
      <ExcalidrawTicket02Harness
        ref={ref}
        initialScene={imageFreeFixture()}
        scenario={scenario}
        settlementMaxWaitMs={150}
        operationSession={{
          projectId: IDENTITY.projectId,
          documentKind: IDENTITY.documentKind,
          documentId: IDENTITY.documentId,
          expectedDocumentRevision: 0,
          transport,
        }}
      />
    </Shell>,
  );
  await vi.waitFor(
    () => {
      expect(ref.current).not.toBeNull();
      expect(ref.current?.getAdapter().getIdentity().apiId).not.toBeNull();
      expect(ref.current?.getHistory().lockState).toBe("unlocked");
      expect(document.querySelector("canvas.excalidraw__canvas.interactive")).not.toBeNull();
    },
    { timeout: 20_000, interval: 25 },
  );
  const handle = ref.current as ExcalidrawTicket02HarnessHandle;
  // Excalidraw remeasures text once webfonts finish loading; those late
  // presentation callbacks must be observed and settled before progress
  // events are derived, or the first expectedBeforeRevision is stale.
  await document.fonts.ready;
  const fontSettleDeadline = Date.now() + 5_000;
  for (;;) {
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    await handle.settleHumanMutation();
    if (Date.now() >= fontSettleDeadline) break;
    // Stop as soon as two consecutive observations agree: remeasurement is
    // done producing callbacks.
    const revision = handle.getHistory().mutationRevision;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    for (let frame = 0; frame < 2; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (handle.getHistory().mutationRevision === revision) break;
  }
  return { handle, transport, mounted };
}

/** Opens the real bridge session and proves the attach/subscribe identity. */
async function startSession(rig: HarnessRig): Promise<void> {
  await rig.handle.startOperationSession();
  const bridge = rig.handle.getOperationBridge();
  expect(bridge).not.toBeNull();
  expect(bridge!.sessionIdentity).toEqual(IDENTITY);
  expect(bridge!.lastAcceptedServerSequence).toBe(0);
  expect(bridge!.state).toBe("subscribed");
  expect(rig.transport.subscribeInputs).toEqual([{ ...IDENTITY, lastServerSequence: 0 }]);
  expect(rig.transport.attachInputs).toEqual([
    {
      projectId: IDENTITY.projectId,
      documentKind: IDENTITY.documentKind,
      documentId: IDENTITY.documentId,
      canvasIdentity: IDENTITY.canvasIdentity,
      expectedDocumentRevision: 0,
    },
  ]);
}

function emitSnapshot(rig: HarnessRig, serverSequence: number, summary = {
  acceptedSemanticCount: 0,
  acceptedNoOpCount: 0,
  rejectedCount: 0,
  lastAcceptedProducerSequence: 0,
}): void {
  const snapshot = {
    kind: "session-snapshot",
    ...IDENTITY,
    serverSequence,
    documentRevision: 0,
    acknowledgementSummary: summary,
  } as unknown as WhiteboardOperationSessionEvent;
  rig.transport.beginStream();
  rig.transport.emit(snapshot);
  if (serverSequence === 1) {
    // The attached session retains its baseline snapshot as data row 1 after
    // the current high-water snapshot fence (Decision 0065 D5).
    rig.transport.emit(snapshot);
  }
}

function emitAdmitted(rig: HarnessRig, serverSequence: number): void {
  rig.transport.emit({
    kind: "operation-admitted",
    ...IDENTITY,
    serverSequence,
    batchId: BATCH_ID,
    operationId: OPERATION_ID,
    generation: GENERATION,
    expectedDocumentRevision: 0,
    retryAttempt: 0,
  } as unknown as WhiteboardOperationSessionEvent);
}

/**
 * The image-free element patch for one progress mutation: the captured
 * normalized real elements with the named element moved to `x`. Fingerprint
 * and mutation are derived from this exact patch before the event is emitted.
 */
function patchCardX(scene: SynaraSceneSnapshot, x: number): Record<string, unknown>[] {
  return scene.elements.map((element) => {
    const record = element as Record<string, unknown>;
    return record.id === TICKET01_CARD_ID ? { ...element, x } : element;
  }) as unknown as Record<string, unknown>[];
}

function expectedFingerprint(scene: SynaraSceneSnapshot, patch: Record<string, unknown>[]): string {
  return captureDocumentSnapshot({
    ...scene,
    elements: patch,
    files: {},
  } as unknown as SynaraSceneSnapshot).semanticFingerprint;
}

/** The coordinator's current canonical mutation revision. */
function currentRevision(rig: HarnessRig): number {
  return rig.handle.getHistory().mutationRevision;
}

/**
 * Builds the complete operation-progress event from a freshly captured
 * normalized real scene: the patch, its semantic fingerprint, and the
 * revision bookkeeping (expectedBeforeRevision = current coordinator
 * revision, expectedAfterRevision = +1) are all derived at build time. The
 * returned event object is emitted as-is; replays must reuse the identical
 * object.
 */
function buildProgressEvent(
  rig: HarnessRig,
  input: {
    readonly serverSequence: number;
    readonly producerSequence: number;
    readonly x: number;
    readonly operationId?: string;
    readonly generation?: number;
  },
): {
  readonly event: WhiteboardOperationSessionEvent;
  readonly expectedSemanticFingerprint: string;
} {
  const scene = rig.handle.getAdapter().captureScene();
  const patch = patchCardX(scene, input.x);
  const expectedSemanticFingerprint = expectedFingerprint(scene, patch);
  return {
    expectedSemanticFingerprint,
    event: {
      kind: "operation-progress",
      ...IDENTITY,
      serverSequence: input.serverSequence,
      batchId: BATCH_ID,
      operationId: input.operationId ?? OPERATION_ID,
      generation: input.generation ?? GENERATION,
      producerSequence: input.producerSequence,
      dependsOnProducerSequences: [],
      expectedBeforeRevision: currentRevision(rig),
      expectedAfterRevision: currentRevision(rig) + 1,
      expectedSemanticFingerprint,
      mutation: {
        format: "synara.whiteboard.progress/v1" as const,
        elements: patch,
      },
    } as unknown as WhiteboardOperationSessionEvent,
  };
}

function emitProgressEvent(rig: HarnessRig, built: { readonly event: WhiteboardOperationSessionEvent }): void {
  rig.transport.emit(built.event);
}

function emitTakeOverPending(rig: HarnessRig, serverSequence: number): void {
  rig.transport.emit({
    kind: "take-over-pending",
    ...IDENTITY,
    serverSequence,
    batchId: BATCH_ID,
    operationId: OPERATION_ID,
    generation: GENERATION + 1,
    takeOverRequestId: "tor-wp-b3",
    requestedGeneration: GENERATION,
  } as unknown as WhiteboardOperationSessionEvent);
}

function emitContainmentResult(
  rig: HarnessRig,
  serverSequence: number,
  result: "acknowledged" | "containment-failed",
): void {
  rig.transport.emit({
    kind: "containment-result",
    ...IDENTITY,
    serverSequence,
    batchId: BATCH_ID,
    operationId: OPERATION_ID,
    generation: GENERATION + 1,
    takeOverRequestId: "tor-wp-b3",
    requestedGeneration: GENERATION,
    result,
  } as unknown as WhiteboardOperationSessionEvent);
}

function emitTerminal(
  rig: HarnessRig,
  input: {
    readonly serverSequence: number;
    readonly outcome: "completed" | "interrupted" | "failed-partial" | "zero-valid";
  },
): void {
  const shared = {
    kind: "operation-terminal" as const,
    ...IDENTITY,
    serverSequence: input.serverSequence,
    batchId: BATCH_ID,
    operationId: OPERATION_ID,
    generation: input.outcome === "interrupted" ? GENERATION + 1 : GENERATION,
    acceptedSemanticCount: input.outcome === "zero-valid" ? 0 : 1,
    acceptedNoOpCount: 0,
    rejectedCount: 0,
    lastAcceptedProducerSequence: input.outcome === "zero-valid" ? 0 : 1,
  };
  if (input.outcome === "completed") {
    rig.transport.emit({ ...shared, outcome: "completed", terminalReason: "completed" } as unknown as WhiteboardOperationSessionEvent);
    return;
  }
  if (input.outcome === "interrupted") {
    rig.transport.emit({
      ...shared,
      outcome: "interrupted",
      terminalReason: "take-over-acknowledged",
      containmentResult: "acknowledged",
    } as unknown as WhiteboardOperationSessionEvent);
    return;
  }
  if (input.outcome === "failed-partial") {
    rig.transport.emit({
      ...shared,
      outcome: "failed-partial",
      terminalReason: "producer-failed",
    } as unknown as WhiteboardOperationSessionEvent);
    return;
  }
  rig.transport.emit({
    ...shared,
    outcome: "zero-valid",
    terminalReason: "all-operations-rejected",
    zeroValidReason: "all-operations-rejected",
  } as unknown as WhiteboardOperationSessionEvent);
}

/** Waits until the real coordinator owns the admitted active batch. */
async function awaitActiveOperation(rig: HarnessRig): Promise<void> {
  await vi.waitFor(() => {
    const bridge = rig.handle.getOperationBridge();
    expect(bridge).not.toBeNull();
    expect(bridge!.getCoordinator()).not.toBeNull();
    expect(bridge!.getCoordinator()!.getActiveAiBatch()).toMatchObject({
      batchId: BATCH_ID,
      operationId: OPERATION_ID,
      operationGeneration: GENERATION,
    });
    expect(bridge!.state).toBe("operation-active");
  });
}

/** Waits for the truthful `applied-semantic` acknowledgement of one write. */
async function awaitAcks(rig: HarnessRig, count: number): Promise<void> {
  await vi.waitFor(() => expect(rig.transport.ackInputs).toHaveLength(count));
  await vi.waitFor(() => {
    const bridge = rig.handle.getOperationBridge();
    expect(bridge!.getAppliedProgressCount()).toBe(count);
  });
}

function cardX(handle: ExcalidrawTicket02HarnessHandle): number {
  const card = handle
    .getAdapter()
    .captureScene()
    .elements.find((element) => (element as Record<string, unknown>).id === TICKET01_CARD_ID);
  expect(card, "fixture card is present on the real canvas").toBeDefined();
  return (card as unknown as Record<string, unknown>).x as number;
}

function traceOfKind(handle: ExcalidrawTicket02HarnessHandle, kind: SynaraSyntheticTraceEntry["kind"]) {
  return handle.getAdapter().getSyntheticTrace().filter((entry) => entry.kind === kind);
}

function undoAiDisabled(): boolean {
  const button = document.querySelector<HTMLButtonElement>("[data-ticket02-action='undo-ai-batch']");
  expect(button, "AI history undo action is rendered").not.toBeNull();
  return (button as HTMLButtonElement).getAttribute("aria-disabled") === "true";
}

describe("Ticket 02 operation transport outcomes in stable Chromium (WP-B3)", () => {
  beforeAll(async () => {
    await page.viewport(1280, 900);
  });

  it("settles the completed outcome exactly once through the real coordinator and treats duplicate terminals idempotently", async () => {
    const rig = await mountOperationHarness("wp-b3-completed");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      expect(rig.handle.getOperationBridge()!.getCoordinator()).toBeNull();
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      const progress = buildProgressEvent(rig, {
        serverSequence: 3,
        producerSequence: 1,
        x: 240,
      });
      emitProgressEvent(rig, progress);
      await awaitAcks(rig, 1);
      expect(rig.transport.ackInputs[0]).toMatchObject({
        ...IDENTITY,
        batchId: BATCH_ID,
        operationId: OPERATION_ID,
        generation: GENERATION,
        producerSequence: 1,
        serverSequence: 3,
        adapterCorrelationId: expect.any(String),
        applicationResult: "applied-semantic",
        resultingMutationRevision: 1,
        verifiedSemanticFingerprint: progress.expectedSemanticFingerprint,
      });
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(1);
      expect(traceOfKind(rig.handle, "callback-acknowledged")).toHaveLength(1);
      expect(rig.handle.getHistory().lockState).toBe("ai-batch");
      expect(rig.handle.getHistory().events).toHaveLength(0);

      emitTerminal(rig, { serverSequence: 4, outcome: "completed" });
      await vi.waitFor(() => expect(rig.handle.getOperationOutcomes()).toHaveLength(1));
      expect(rig.handle.getOperationOutcomes()[0]).toMatchObject({
        kind: "terminal",
        outcome: "completed",
        operationId: OPERATION_ID,
        generation: GENERATION,
      });
      const outcomeEvent = rig.handle.getOperationOutcomes()[0]!.event;
      expect(outcomeEvent).not.toBeNull();
      const history = rig.handle.getHistory();
      expect(history.events).toHaveLength(1);
      expect(history.events[0]).toMatchObject({
        outcome: "completed",
        batchId: BATCH_ID,
        acceptedSyntheticWriteCount: 1,
      });
      expect(history.cursor).toBe(1);
      expect(history.lockState).toBe("unlocked");
      expect(rig.handle.getOperationBridge()!.state).toBe("settled");
      expect(cardX(rig.handle)).toBe(240);
      // The real native-history clear is proven by the restored AI action.
      expect(undoAiDisabled()).toBe(false);

      // Duplicate terminal: still exactly one event and one outcome.
      emitTerminal(rig, { serverSequence: 4, outcome: "completed" });
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect(rig.handle.getOperationOutcomes()).toHaveLength(1);
      expect(rig.handle.getHistory().events).toHaveLength(1);
      expect(rig.handle.getHistory().cursor).toBe(1);
      expect(cardX(rig.handle)).toBe(240);

      // Stale foreign progress after settle: fenced before any scene write.
      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 5,
          producerSequence: 2,
          x: 999,
          operationId: "operation-foreign",
          generation: 9,
        }),
      );
      expect(rig.handle.getOperationBridge()!.state).toBe("protected");
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(1);
      expect(rig.handle.getHistory().events).toHaveLength(1);
      expect(rig.handle.getHistory().lockState).toBe("locked-fault");
      expect(
        rig.handle
          .getDiagnostics()
          .some((diagnostic) => diagnostic.code === "operation-session-lost"),
      ).toBe(true);
      expect(
        rig.handle
          .getOperationDiagnostics()
          .some((diagnostic) => (diagnostic as { code?: string }).code === "operation-conflicting-terminal"),
      ).toBe(true);
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("holds the Take Over pending lock, unlocks only on acknowledged containment with exactly one interrupted event, and resends a delayed truthful acknowledgement without reapplication", async () => {
    const rig = await mountOperationHarness("wp-b3-interrupted");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      const progressOne = buildProgressEvent(rig, {
        serverSequence: 3,
        producerSequence: 1,
        x: 240,
      });
      emitProgressEvent(rig, progressOne);
      await awaitAcks(rig, 1);
      expect(rig.transport.ackInputs[0]).toMatchObject({
        producerSequence: 1,
        serverSequence: 3,
        applicationResult: "applied-semantic",
        resultingMutationRevision: 1,
        verifiedSemanticFingerprint: progressOne.expectedSemanticFingerprint,
      });

      // Second application lands, but its truthful acknowledgement transport
      // is interrupted before the server receives it.
      rig.transport.ackRejectNext = true;
      const progressTwo = buildProgressEvent(rig, {
        serverSequence: 4,
        producerSequence: 2,
        x: 340,
      });
      emitProgressEvent(rig, progressTwo);
      // ackInputs[0]: producer 1 success. ackInputs[1]: producer 2 attempt
      // whose transport throws. The canonical proof for producer 2 is held in
      // the ledger with ackState "interrupted".
      await vi.waitFor(() => expect(rig.transport.ackInputs).toHaveLength(2));
      await vi.waitFor(() =>
        expect(
          rig.handle
            .getOperationDiagnostics()
            .some((diagnostic) => (diagnostic as { code?: string }).code === "ack-delivery-interrupted"),
        ).toBe(true),
      );
      expect(rig.transport.ackInterruptCount).toBe(1);
      expect(cardX(rig.handle)).toBe(340);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(2);

      // A same-authority reconnect snapshot reaches the real production event
      // gate. The bridge resends the exact interrupted acknowledgement as
      // ackInputs[2] without requiring duplicate progress or a second write.
      emitSnapshot(rig, 4, {
        acceptedSemanticCount: 1,
        acceptedNoOpCount: 0,
        rejectedCount: 0,
        lastAcceptedProducerSequence: 1,
      });
      await vi.waitFor(() => expect(rig.transport.ackInputs).toHaveLength(3));
      expect(rig.transport.ackInputs[1]).toMatchObject({
        producerSequence: 2,
        serverSequence: 4,
        adapterCorrelationId: "scope-1-write-2",
        resultingMutationRevision: 2,
        applicationResult: "applied-semantic",
        verifiedSemanticFingerprint: progressTwo.expectedSemanticFingerprint,
      });
      expect(rig.transport.ackInputs[2]).toEqual(rig.transport.ackInputs[1]);
      expect(cardX(rig.handle)).toBe(340);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(2);
      expect(rig.handle.getOperationBridge()!.getAppliedProgressCount()).toBe(2);
      expect(rig.handle.getOperationBridge()!.state).toBe("operation-active");

      // Take Over pending: the AI edit lock stays held, nothing unlocks.
      emitTakeOverPending(rig, 5);
      expect(rig.handle.getOperationBridge()!.state).toBe("take-over-pending");
      expect(rig.handle.getHistory().lockState).toBe("ai-batch");
      expect(rig.handle.getHistory().events).toHaveLength(0);

      // Authoritative containment acknowledgement permits finalization only.
      emitContainmentResult(rig, 6, "acknowledged");
      expect(rig.handle.getOperationBridge()!.state).toBe("operation-active");

      emitTerminal(rig, { serverSequence: 7, outcome: "interrupted" });
      await vi.waitFor(() => expect(rig.handle.getOperationOutcomes()).toHaveLength(1));
      expect(rig.handle.getOperationOutcomes()[0]).toMatchObject({
        kind: "terminal",
        outcome: "interrupted",
        operationId: OPERATION_ID,
      });
      expect(rig.handle.getOperationOutcomes()[0]!.event).not.toBeNull();
      const history = rig.handle.getHistory();
      expect(history.events).toHaveLength(1);
      expect(history.events[0]).toMatchObject({
        outcome: "interrupted",
        acceptedSyntheticWriteCount: 2,
      });
      expect(history.cursor).toBe(1);
      expect(history.lockState).toBe("unlocked");
      expect(cardX(rig.handle)).toBe(340);
      expect(rig.transport.ackInterruptCount).toBe(1);
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("commits exactly one failed-partial event for the verified valid prefix and never applies the failed remainder", async () => {
    const rig = await mountOperationHarness("wp-b3-failed-partial");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 3,
          producerSequence: 1,
          x: 240,
        }),
      );
      await awaitAcks(rig, 1);

      // The producer fails: the dependent remainder never arrives, and the
      // server derives failed-partial with producer-failed reason.
      emitTerminal(rig, { serverSequence: 4, outcome: "failed-partial" });
      await vi.waitFor(() => expect(rig.handle.getOperationOutcomes()).toHaveLength(1));
      expect(rig.handle.getOperationOutcomes()[0]).toMatchObject({
        kind: "terminal",
        outcome: "failed-partial",
        operationId: OPERATION_ID,
      });
      expect(rig.handle.getOperationOutcomes()[0]!.event).not.toBeNull();
      const history = rig.handle.getHistory();
      expect(history.events).toHaveLength(1);
      expect(history.events[0]).toMatchObject({
        outcome: "failed-partial",
        acceptedSyntheticWriteCount: 1,
      });
      expect(history.cursor).toBe(1);
      expect(history.lockState).toBe("unlocked");
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(1);
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("creates no AI event, no native-history clear, and no cursor movement for the zero-valid outcome", async () => {
    const rig = await mountOperationHarness("wp-b3-zero-valid");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      emitTerminal(rig, { serverSequence: 3, outcome: "zero-valid" });
      await vi.waitFor(() => expect(rig.handle.getOperationOutcomes()).toHaveLength(1));
      expect(rig.handle.getOperationOutcomes()[0]).toMatchObject({
        kind: "terminal",
        outcome: "zero-valid",
        event: null,
      });
      const history = rig.handle.getHistory();
      expect(history.events).toHaveLength(0);
      expect(history.cursor).toBe(0);
      expect(history.lockState).toBe("unlocked");
      expect(cardX(rig.handle)).toBe(140);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(0);
      expect(traceOfKind(rig.handle, "scope-aborted")).toHaveLength(1);
      expect(traceOfKind(rig.handle, "scope-closed")).toHaveLength(0);
      expect(
        rig.handle
          .getDiagnostics()
          .some((diagnostic) => diagnostic.phase === "zero-valid-settlement"),
      ).toBe(true);
      expect(undoAiDisabled()).toBe(true);
      expect(rig.handle.getOperationBridge()!.state).toBe("settled");
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("resumes the same authority gap-free: snapshot replay and duplicate admission apply each mutation exactly once before live continuation", async () => {
    const rig = await mountOperationHarness("wp-b3-resume-gapfree");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      const progressOneEvent = buildProgressEvent(rig, {
        serverSequence: 3,
        producerSequence: 1,
        x: 240,
      });
      emitProgressEvent(rig, progressOneEvent);
      await awaitAcks(rig, 1);
      expect(cardX(rig.handle)).toBe(240);

      // Same-authority reconnect: current fence at the accepted cursor, then
      // duplicate overlap that the real transport gate drops before the bridge.
      emitSnapshot(rig, 3, {
        acceptedSemanticCount: 1,
        acceptedNoOpCount: 0,
        rejectedCount: 0,
        lastAcceptedProducerSequence: 1,
      });
      emitAdmitted(rig, 2);
      emitProgressEvent(rig, progressOneEvent);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(1);
      expect(rig.transport.ackInputs).toHaveLength(1);
      expect(rig.handle.getOperationBridge()!.state).toBe("operation-active");
      expect(rig.handle.getHistory().lockState).toBe("ai-batch");

      // Live continuation after resume applies the next mutation exactly once.
      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 4,
          producerSequence: 2,
          x: 340,
        }),
      );
      await awaitAcks(rig, 2);
      expect(cardX(rig.handle)).toBe(340);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(2);

      emitTerminal(rig, { serverSequence: 5, outcome: "completed" });
      await vi.waitFor(() => expect(rig.handle.getOperationOutcomes()).toHaveLength(1));
      expect(rig.handle.getHistory().events).toHaveLength(1);
      expect(rig.handle.getHistory().events[0]).toMatchObject({
        outcome: "completed",
        acceptedSyntheticWriteCount: 2,
      });
      expect(rig.handle.getHistory().lockState).toBe("unlocked");
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("adopts a resumed terminal outcome from the snapshot without re-running settlement and fences post-terminal progress", async () => {
    const rig = await mountOperationHarness("wp-b3-resume-terminal");
    try {
      await startSession(rig);
      const terminalSnapshot = {
        kind: "session-snapshot",
        ...IDENTITY,
        serverSequence: 1,
        documentRevision: 1,
        acknowledgementSummary: {
          acceptedSemanticCount: 1,
          acceptedNoOpCount: 0,
          rejectedCount: 0,
          lastAcceptedProducerSequence: 1,
        },
        terminal: {
          batchId: BATCH_ID,
          operationId: OPERATION_ID,
          generation: GENERATION,
          outcome: "completed",
          terminalReason: "completed",
          acceptedSemanticCount: 1,
          acceptedNoOpCount: 0,
          rejectedCount: 0,
          lastAcceptedProducerSequence: 1,
        },
      } as unknown as WhiteboardOperationSessionEvent;
      rig.transport.beginStream();
      rig.transport.emit(terminalSnapshot);
      rig.transport.emit(terminalSnapshot);
      expect(rig.handle.getOperationBridge()!.state).toBe("settled");
      expect(rig.handle.getOperationBridge()!.getCoordinator()).toBeNull();
      expect(rig.handle.getOperationOutcomes()).toHaveLength(0);
      expect(rig.handle.getHistory().events).toHaveLength(0);
      expect(cardX(rig.handle)).toBe(140);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(0);

      // Post-terminal progress for the terminated operation is fenced.
      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 2,
          producerSequence: 1,
          x: 999,
        }),
      );
      expect(rig.handle.getOperationBridge()!.state).toBe("protected");
      expect(cardX(rig.handle)).toBe(140);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(0);
      expect(rig.handle.getHistory().events).toHaveLength(0);
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("keeps a lost active operation session protected with no event, no clear, and no unlock", async () => {
    const rig = await mountOperationHarness("wp-b3-session-lost");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 3,
          producerSequence: 1,
          x: 240,
        }),
      );
      await awaitAcks(rig, 1);

      rig.transport.emitFailure("WHITEBOARD_OPERATION_SESSION_UNKNOWN");
      expect(rig.handle.getOperationBridge()!.state).toBe("protected");
      expect(rig.handle.getHistory().lockState).toBe("locked-fault");
      expect(
        rig.handle
          .getDiagnostics()
          .some((diagnostic) => diagnostic.code === "operation-session-lost"),
      ).toBe(true);
      expect(rig.handle.getHistory().events).toHaveLength(0);
      expect(rig.handle.getHistory().cursor).toBe(0);
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "scope-closed")).toHaveLength(0);

      // A late terminal for the lost session cannot settle or unlock it.
      emitTerminal(rig, { serverSequence: 4, outcome: "completed" });
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect(rig.handle.getOperationOutcomes()).toHaveLength(0);
      expect(rig.handle.getHistory().events).toHaveLength(0);
      expect(rig.handle.getHistory().lockState).toBe("locked-fault");
      expect(rig.handle.getOperationBridge()!.state).toBe("protected");
    } finally {
      await rig.mounted.unmount();
    }
  });

  it("fences post-TakeOver producer input and keeps every non-acknowledged containment path protected without an interruption success", async () => {
    const rig = await mountOperationHarness("wp-b3-containment-failed");
    try {
      await startSession(rig);
      emitSnapshot(rig, 1);
      emitAdmitted(rig, 2);
      await awaitActiveOperation(rig);

      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 3,
          producerSequence: 1,
          x: 240,
        }),
      );
      await awaitAcks(rig, 1);

      emitTakeOverPending(rig, 4);
      expect(rig.handle.getOperationBridge()!.state).toBe("take-over-pending");

      // Producer input after the generation fence never reaches the canvas.
      emitProgressEvent(
        rig,
        buildProgressEvent(rig, {
          serverSequence: 5,
          producerSequence: 2,
          x: 999,
        }),
      );
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "write-issued")).toHaveLength(1);
      expect(rig.handle.getOperationBridge()!.state).toBe("protected");
      expect(rig.handle.getHistory().lockState).toBe("locked-fault");

      // Failed containment keeps the browser protected: no interrupted
      // success, no event, no native-history clear, no unlock.
      emitContainmentResult(rig, 6, "containment-failed");
      emitTerminal(rig, { serverSequence: 7, outcome: "interrupted" });
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect(rig.handle.getOperationOutcomes()).toHaveLength(0);
      expect(rig.handle.getHistory().events).toHaveLength(0);
      expect(rig.handle.getHistory().lockState).toBe("locked-fault");
      expect(cardX(rig.handle)).toBe(240);
      expect(traceOfKind(rig.handle, "scope-closed")).toHaveLength(0);
      expect(traceOfKind(rig.handle, "scope-aborted")).toHaveLength(0);
      expect(
        rig.handle
          .getDiagnostics()
          .some((diagnostic) => diagnostic.code === "operation-containment-unresolved"),
      ).toBe(true);
    } finally {
      await rig.mounted.unmount();
    }
  });
});
