import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => null,
  exportToBlob: vi.fn(),
  exportToSvg: vi.fn(),
  restore: (scene: unknown) => scene,
  serializeAsJSON: vi.fn(),
}));

import type {
  WhiteboardOperationAttachSessionResult,
  WhiteboardOperationSessionEvent,
} from "@synara/contracts";

import {
  SynaraSyntheticScopeRegistry,
  type SynaraSceneInput,
  type SynaraSceneSnapshot,
  type SynaraSyntheticScopeContext,
  type SynaraSyntheticTraceEntry,
  type SynaraViewport,
} from "../ticket01/SynaraExcalidrawAdapter";
import { SynaraAiHistoryCoordinator, type SynaraAiHistoryHost } from "./SynaraAiHistoryCoordinator";
import { captureDocumentSnapshot, semanticFingerprint } from "./SynaraDocumentSnapshot";
import {
  SynaraWhiteboardOperationBridge,
  type SynaraWhiteboardOperationTransport,
} from "./SynaraWhiteboardOperationBridge";

const CAPABILITY = "whiteboard.operation-session-v1";

/** Matches the branded ProjectId wire type at the contract boundary. */
const projectId = "project-1" as unknown as import("@synara/contracts").ProjectId;

const IDENTITY = {
  serverInstanceId: "server-instance-1",
  operationSessionId: "wb-op-session-1",
  sessionEpoch: 1,
  projectId,
  documentKind: "file-canvas" as const,
  documentId: "doc-1",
  canvasIdentity: "canvas-1",
};

const ATTACH_RESULT = { ...IDENTITY, documentRevision: 0 };

function element(progress: number) {
  return {
    id: "shape",
    type: "rectangle" as const,
    x: progress * 10,
    y: 20,
    width: 100,
    height: 60,
  };
}

function scene(progress = 0): SynaraSceneSnapshot {
  return {
    elements: [element(progress)],
    files: {},
    viewport: { scrollX: 10, scrollY: 20, zoom: 1 },
    selectedElementIds: ["shape"],
  };
}

/** Existing FakeGateHost pattern: a real registry-backed host. */
class FakeGateHost implements SynaraAiHistoryHost {
  public current = scene();
  public viewModeEnabled = false;
  public nativeClearCount = 0;
  public callbackSequence = 0;
  public readonly syntheticTrace: SynaraSyntheticTraceEntry[] = [];
  public readonly adapterDiagnostics: string[] = [];
  private readonly syntheticSequence = { current: 0 };
  private readonly callbackSequenceRef = { current: 0 };
  private readonly registry = new SynaraSyntheticScopeRegistry(
    this.syntheticSequence,
    this.callbackSequenceRef,
    (code) => this.adapterDiagnostics.push(code),
    () => 100,
    () => ({ mountIdentity: "mount-1", apiIdentity: "api-1" }),
    () => this.viewModeEnabled,
    (entry) => this.syntheticTrace.push(entry),
  );

  public getIdentity() {
    return { mountId: 1, apiId: "api-1" };
  }

  public captureScene() {
    return this.current;
  }

  public captureViewport(): SynaraViewport {
    return this.current.viewport;
  }

  public updateScene(update: SynaraSceneInput) {
    this.current = {
      ...this.current,
      elements: update.elements ?? this.current.elements,
      files: update.files ?? this.current.files,
    };
    this.callbackSequence += 1;
    this.callbackSequenceRef.current = this.callbackSequence;
    this.registry.associate(this.callbackSequence, semanticFingerprint(this.current));
  }

  public restoreScene(snapshot: SynaraSceneSnapshot) {
    this.current = snapshot;
    this.callbackSequence += 1;
    this.callbackSequenceRef.current = this.callbackSequence;
    this.registry.associate(this.callbackSequence, semanticFingerprint(this.current));
  }

  public clearNativeHistory() {
    this.nativeClearCount += 1;
  }

  public setViewModeEnabled(enabled: boolean) {
    this.viewModeEnabled = enabled;
  }

  public openSyntheticWriteScope(context: SynaraSyntheticScopeContext) {
    return this.registry.open(context);
  }

  public observeHostBoundary() {
    return {
      adapterCallbackSequence: this.callbackSequence,
      scopeActive: this.registry.isOpen,
      tombstoneCount: this.registry.tombstoneCount,
      editingTextActive: false,
    };
  }
}

interface FakeTransportOptions {
  readonly capabilities?: readonly string[];
  readonly attachResult?: typeof ATTACH_RESULT;
}

/**
 * Deterministic contract transport: the exact WP-B1 surface with an
 * event-capture subscribe. No socket, no timers.
 */
class FakeTransport implements SynaraWhiteboardOperationTransport {
  public attachRequests: unknown[] = [];
  public ackRequests: unknown[] = [];
  public subscribeInputs: unknown[] = [];
  public listener: ((event: WhiteboardOperationSessionEvent) => boolean | void) | null = null;
  public failureListeners = new Set<
    (failure: { readonly code: string; readonly operationSessionId?: string }) => void
  >();
  public ackReplies: Promise<unknown>[] = [];
  public ackRejectNext = false;

  private readonly capabilities: readonly string[];
  private readonly attachResult: typeof ATTACH_RESULT;

  public constructor(options: FakeTransportOptions = {}) {
    this.capabilities = options.capabilities ?? [CAPABILITY];
    this.attachResult = options.attachResult ?? ATTACH_RESULT;
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
    this.attachRequests.push(input);
    return this.attachResult;
  }

  public whiteboardOperationSubscribe(
    input: unknown,
    listener: (event: WhiteboardOperationSessionEvent) => boolean | void,
  ): () => void {
    this.subscribeInputs.push(input);
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  public async whiteboardOperationAcknowledgeApplication(input: unknown) {
    this.ackRequests.push(input);
    if (this.ackRejectNext) {
      this.ackRejectNext = false;
      throw Object.assign(new Error("interrupted"), { retryable: true });
    }
    await this.ackReplies.shift();
    return { ...IDENTITY };
  }

  public emit(event: WhiteboardOperationSessionEvent) {
    return this.listener?.(event);
  }

  public async drainAckChain() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
  }

  public emitFailure(code: string, operationSessionId = IDENTITY.operationSessionId): void {
    for (const listener of [...this.failureListeners]) listener({ code, operationSessionId });
  }
}

function makeSnapshot(serverSequence: number): WhiteboardOperationSessionEvent {
  return {
    kind: "session-snapshot",
    ...IDENTITY,
    serverSequence,
    documentRevision: 0,
    acknowledgementSummary: {
      acceptedSemanticCount: 0,
      acceptedNoOpCount: 0,
      rejectedCount: 0,
      lastAcceptedProducerSequence: 0,
    },
  } as WhiteboardOperationSessionEvent;
}

function makeAdmitted(serverSequence: number): WhiteboardOperationSessionEvent {
  return {
    kind: "operation-admitted",
    ...IDENTITY,
    serverSequence,
    batchId: "batch-1",
    operationId: "operation-1",
    generation: 1,
    expectedDocumentRevision: 0,
    retryAttempt: 0,
  } as WhiteboardOperationSessionEvent;
}

function fingerprintAt(progress: number): string {
  return captureDocumentSnapshot(scene(progress)).semanticFingerprint;
}

function makeProgress(
  serverSequence: number,
  producerSequence: number,
  progress: number,
): WhiteboardOperationSessionEvent {
  return {
    kind: "operation-progress",
    ...IDENTITY,
    serverSequence,
    batchId: "batch-1",
    operationId: "operation-1",
    generation: 1,
    producerSequence,
    dependsOnProducerSequences: [],
    expectedBeforeRevision: producerSequence - 1,
    expectedAfterRevision: producerSequence,
    expectedSemanticFingerprint: fingerprintAt(progress),
    mutation: {
      format: "synara.whiteboard.progress/v1" as const,
      elements: [element(progress)],
    },
  } as unknown as WhiteboardOperationSessionEvent;
}

function makeTakeOverPending(serverSequence: number): WhiteboardOperationSessionEvent {
  return {
    kind: "take-over-pending",
    ...IDENTITY,
    serverSequence,
    batchId: "batch-1",
    operationId: "operation-1",
    generation: 2,
    takeOverRequestId: "tor-1",
    requestedGeneration: 1,
  } as WhiteboardOperationSessionEvent;
}

function makeContainmentResult(
  serverSequence: number,
  result: "acknowledged" | "containment-failed",
): WhiteboardOperationSessionEvent {
  return {
    kind: "containment-result",
    ...IDENTITY,
    serverSequence,
    batchId: "batch-1",
    operationId: "operation-1",
    generation: 2,
    takeOverRequestId: "tor-1",
    requestedGeneration: 1,
    result,
  } as WhiteboardOperationSessionEvent;
}

function makeTerminal(
  serverSequence: number,
  outcome: "completed" | "interrupted" | "failed-partial" | "zero-valid",
  extra: Record<string, unknown> = {},
): WhiteboardOperationSessionEvent {
  const shared = {
    kind: "operation-terminal" as const,
    ...IDENTITY,
    serverSequence,
    batchId: "batch-1",
    operationId: "operation-1",
    generation: 1,
    acceptedSemanticCount: outcome === "zero-valid" ? 0 : 1,
    acceptedNoOpCount: 0,
    rejectedCount: 0,
    lastAcceptedProducerSequence: outcome === "zero-valid" ? 0 : 1,
    ...extra,
  };
  if (outcome === "completed") {
    return { ...shared, outcome, terminalReason: "completed" } as WhiteboardOperationSessionEvent;
  }
  if (outcome === "interrupted") {
    return {
      ...shared,
      outcome,
      terminalReason: "take-over-acknowledged",
      containmentResult: "acknowledged",
    } as WhiteboardOperationSessionEvent;
  }
  if (outcome === "failed-partial") {
    return {
      ...shared,
      outcome,
      terminalReason: "browser-application-failed",
    } as WhiteboardOperationSessionEvent;
  }
  return {
    ...shared,
    outcome,
    terminalReason: "all-operations-rejected",
    zeroValidReason: "all-operations-rejected",
  } as WhiteboardOperationSessionEvent;
}

interface Rig {
  readonly host: FakeGateHost;
  readonly transport: FakeTransport;
  readonly bridge: SynaraWhiteboardOperationBridge;
  readonly outcomes: unknown[];
}

function makeRig(transportOptions?: FakeTransportOptions): Rig {
  const host = new FakeGateHost();
  const transport = new FakeTransport(transportOptions);
  const outcomes: unknown[] = [];
  const bridge = new SynaraWhiteboardOperationBridge(transport, {
    projectId: IDENTITY.projectId,
    documentKind: IDENTITY.documentKind,
    documentId: IDENTITY.documentId,
    canvasIdentity: IDENTITY.canvasIdentity,
    expectedDocumentRevision: 0,
    host,
    scenario: "bridge-unit",
    createCoordinator: (bridgeHost) =>
      new SynaraAiHistoryCoordinator(bridgeHost, {
        canvasIdentity: IDENTITY.canvasIdentity,
        scenario: "bridge-unit",
        settlementMaxWaitMs: 50,
      }),
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  return { host, transport, bridge, outcomes };
}

async function startActiveOperation(rig: Rig): Promise<void> {
  await rig.bridge.startSession();
  rig.transport.emit(makeSnapshot(1));
  rig.transport.emit(makeAdmitted(2));
  // Wait for the async coordinator begin to settle.
  await vi.waitFor(() =>
    expect(rig.bridge.getCoordinator()!.getActiveAiBatch()).not.toBeNull(),
  );
}

describe("Ticket 02 dormant Whiteboard operation bridge (WP-B2)", () => {
  let host: FakeGateHost;
  let transport: FakeTransport;
  let bridge: SynaraWhiteboardOperationBridge;
  let outcomes: unknown[];

  beforeEach(() => {
    ({ host, transport, bridge, outcomes } = makeRig());
  });

  it("refuses to start without the exact operation-session capability", async () => {
    const offline = makeRig({ capabilities: ["transport.http-negotiate"] });
    await expect(offline.bridge.startSession()).rejects.toThrow(
      "operation-session capability is missing",
    );
    expect(offline.transport.attachRequests).toHaveLength(0);
    expect(offline.transport.subscribeInputs).toHaveLength(0);
  });

  it("stores the exact attach identity and subscribes at cursor zero", async () => {
    await bridge.startSession();
    expect(bridge.sessionIdentity).toEqual(IDENTITY);
    expect(bridge.lastAcceptedServerSequence).toBe(0);
    expect(transport.attachRequests).toEqual([
      {
        projectId: IDENTITY.projectId,
        documentKind: "file-canvas",
        documentId: IDENTITY.documentId,
        canvasIdentity: IDENTITY.canvasIdentity,
        expectedDocumentRevision: 0,
      },
    ]);
    expect(transport.subscribeInputs).toEqual([{ ...IDENTITY, lastServerSequence: 0 }]);
  });

  it("starts the coordinator only on an admitted operation, never on snapshot alone", async () => {
    await bridge.startSession();
    transport.emit(makeSnapshot(1));
    expect(bridge.getCoordinator()).toBeNull();

    transport.emit(makeAdmitted(2));
    expect(bridge.getCoordinator()).not.toBeNull();
    expect(bridge.state).toBe("operation-active");
    await vi.waitFor(() => {
      expect(bridge.getCoordinator()!.getActiveAiBatch()).toMatchObject({
        batchId: "batch-1",
        operationId: "operation-1",
        operationGeneration: 1,
      });
    });
  });
  it("applies progress through the real adapter scope and acknowledges only after semantic proof", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    expect(host.callbackSequence).toBe(1);
    expect(host.current.elements[0]!.x).toBe(10);

    await transport.drainAckChain();
    expect(transport.ackRequests).toHaveLength(1);
    expect(transport.ackRequests[0]).toMatchObject({
      ...IDENTITY,
      batchId: "batch-1",
      operationId: "operation-1",
      generation: 1,
      producerSequence: 1,
      serverSequence: 3,
      applicationResult: "applied-semantic",
      resultingMutationRevision: 1,
      verifiedSemanticFingerprint: fingerprintAt(1),
    });
    expect(bridge.getAppliedProgressCount()).toBe(1);
  });

  it("drops equivalent replayed progress without reapplying or re-acking", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();
    expect(transport.ackRequests).toHaveLength(1);
    expect(host.callbackSequence).toBe(1);

    // Identical replay of the same server sequence content.
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();
    expect(host.callbackSequence).toBe(1);
    expect(host.current.elements[0]!.x).toBe(10);
    expect(transport.ackRequests).toHaveLength(1);
    expect(bridge.getAppliedProgressCount()).toBe(1);
  });

  it("fails closed when replayed progress conflicts with the applied ledger", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();

    transport.emit(makeProgress(3, 1, 5));
    expect(bridge.state).toBe("protected");
    expect(bridge.getCoordinator()!.getState().lockState).toBe("locked-fault");
  });

  it("resends only the interrupted acknowledgement on identical replay without reapply", async () => {
    transport.ackRejectNext = true;
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();
    expect(transport.ackRequests).toHaveLength(1);
    expect(host.callbackSequence).toBe(1);

    // The identical replay reaches the ledger: identical ack resent, no
    // second application.
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();
    expect(transport.ackRequests).toHaveLength(2);
    expect(transport.ackRequests[1]).toEqual(transport.ackRequests[0]);
    expect(host.callbackSequence).toBe(1);
    expect(host.current.elements[0]!.x).toBe(10);
  });

  it("fences progress for a stale or foreign operation before any scene write", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    const foreign = {
      ...makeProgress(3, 1, 1),
      operationId: "operation-foreign",
      generation: 7,
    };
    transport.emit(foreign);
    expect(host.callbackSequence).toBe(0);
    expect(bridge.state).toBe("protected");
    expect(bridge.getAppliedProgressCount()).toBe(0);
  });

  it("maintains the Take Over pending lock and rejects post-TakeOver progress", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeTakeOverPending(3));
    expect(bridge.state).toBe("take-over-pending");
    expect(bridge.getCoordinator()!.getState().lockState).toBe("ai-batch");

    transport.emit(makeProgress(4, 1, 1));
    expect(host.callbackSequence).toBe(0);
    expect(bridge.state).toBe("protected");
  });

  it("permits interrupted finalization only on acknowledged containment and creates exactly one event", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();

    transport.emit(makeTakeOverPending(4));
    transport.emit(makeContainmentResult(5, "acknowledged"));
    transport.emit(makeTerminal(6, "interrupted"));

    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    const event = bridge.getCoordinator()!.getState().events;
    expect(event).toHaveLength(1);
    expect(event[0]).toMatchObject({
      id: "ai-event-1",
      outcome: "interrupted",
      batchId: "batch-1",
      acceptedSyntheticWriteCount: 1,
    });
    expect(outcomes[0]).toMatchObject({
      kind: "terminal",
      outcome: "interrupted",
      operationId: "operation-1",
    });
    expect(host.nativeClearCount).toBe(1);
    expect(bridge.getCoordinator()!.getState().lockState).toBe("unlocked");

    // Duplicate terminal is idempotent: still exactly one event.
    transport.emit(makeTerminal(6, "interrupted"));
    await transport.drainAckChain();
    expect(bridge.getCoordinator()!.getState().events).toHaveLength(1);
  });

  it("keeps the session protected when containment failed and never finalizes", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();

    transport.emit(makeTakeOverPending(4));
    transport.emit(makeContainmentResult(5, "containment-failed"));
    expect(bridge.state).toBe("protected");
    expect(bridge.getCoordinator()!.getState().lockState).toBe("locked-fault");

    transport.emit(makeTerminal(6, "interrupted"));
    await transport.drainAckChain();
    expect(bridge.getCoordinator()!.getState().events).toHaveLength(0);
    expect(host.nativeClearCount).toBe(0);
  });

  it("creates exactly one event for completed terminal and treats duplicates idempotently", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();
    transport.emit(makeTerminal(4, "completed"));

    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    const events = bridge.getCoordinator()!.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "completed", acceptedSyntheticWriteCount: 1 });
    expect(host.nativeClearCount).toBe(1);
    expect(bridge.getCoordinator()!.getState().cursor).toBe(1);

    transport.emit(makeTerminal(4, "completed"));
    await transport.drainAckChain();
    expect(bridge.getCoordinator()!.getState().events).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
  });

  it("keeps conflicting terminal outcomes protected without settling", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();
    transport.emit(makeTerminal(4, "completed"));
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));

    const conflicting = { ...makeTerminal(4, "completed"), outcome: "failed-partial" as const };
    transport.emit(conflicting);
    expect(bridge.state).toBe("protected");
    expect(bridge.getCoordinator()!.getState().events).toHaveLength(1);
  });

  it("creates no event, clear, or cursor movement for zero-valid and reports it", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeTerminal(3, "zero-valid"));

    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatchObject({ kind: "terminal", outcome: "zero-valid", event: null });
    const state = bridge.getCoordinator()!.getState();
    expect(state.events).toHaveLength(0);
    expect(state.cursor).toBe(0);
    expect(state.lockState).toBe("unlocked");
    expect(host.nativeClearCount).toBe(0);
    expect(bridge.getCoordinator()!.getDiagnostics().some((d) => d.phase === "zero-valid-settlement"))
      .toBe(true);
  });

  it("stays protected without terminal truth when the operation session stream fails", async () => {
    await startActiveOperation({ host, transport, bridge, outcomes });
    transport.emit(makeProgress(3, 1, 1));
    await transport.drainAckChain();

    transport.emitFailure("WHITEBOARD_OPERATION_SESSION_UNKNOWN");
    expect(bridge.state).toBe("protected");
    expect(bridge.getCoordinator()!.getState().lockState).toBe("locked-fault");
    expect(bridge.getCoordinator()!.getState().events).toHaveLength(0);
    expect(host.nativeClearCount).toBe(0);
    expect(
      bridge
        .getCoordinator()!
        .getDiagnostics()
        .some((d) => d.code === "operation-session-lost"),
    ).toBe(true);
  });

  it("ignores transport failures for a different operation session", async () => {
    await bridge.startSession();
    transport.emit(makeSnapshot(1));
    transport.emit(makeAdmitted(2));
    await vi.waitFor(() =>
      expect(bridge.getCoordinator()!.getActiveAiBatch()).not.toBeNull(),
    );

    transport.emitFailure("WHITEBOARD_OPERATION_SESSION_UNKNOWN", "wb-op-session-other");
    expect(bridge.state).toBe("operation-active");
  });
});
