// FILE: SynaraWhiteboardOperationBridge.ts
// Purpose: Dormant browser bridge between the WP-B1 typed Whiteboard operation
// transport and the AI-only history coordinator (Ticket 02, Decisions 0063–0065).
// Layer: Web operation seam — not mounted in any production UI.

import type {
  WhiteboardAcknowledgeApplicationInput,
  WhiteboardApplicationDiagnosticCode,
  WhiteboardApplicationResult,
  WhiteboardContainmentResult,
  WhiteboardContainmentResultEvent,
  WhiteboardOperationAdmittedEvent,
  WhiteboardOperationAttachSessionResult,
  WhiteboardOperationProgressEvent,
  WhiteboardOperationSessionEvent,
  WhiteboardOperationSessionIdentity,
  WhiteboardOperationSnapshotEvent,
  WhiteboardOperationTerminalEvent,
  WhiteboardTakeOverPendingEvent,
  WhiteboardTerminalOutcome,
} from "@synara/contracts";

import type {
  SynaraSceneInput,
  SynaraSyntheticWriteScopeHandle,
  SynaraViewport,
} from "../ticket01/SynaraExcalidrawAdapter";
import type { SynaraAiHistoryEvent } from "./SynaraAiHistoryTypes";
import {
  SynaraAiHistoryCoordinator,
  type SynaraAiHistoryHost,
} from "./SynaraAiHistoryCoordinator";

/**
 * The exact transport surface this bridge consumes (WP-B1). Structural so a
 * deterministic contract fixture can drive unit tests without a socket; the
 * production value is the typed `WsTransport` instance.
 */
export interface SynaraWhiteboardOperationTransport {
  readonly hasWhiteboardOperationCapability: () => boolean;
  readonly onWhiteboardOperationFailure: (
    listener: (failure: { readonly code: string; readonly operationSessionId?: string }) => void,
  ) => () => void;
  readonly whiteboardOperationAttachSession: (input: {
    readonly projectId: string;
    readonly documentKind: "file-canvas" | "untitled-canvas";
    readonly documentId: string;
    readonly canvasIdentity: string;
    readonly expectedDocumentRevision: number;
  }) => Promise<WhiteboardOperationAttachSessionResult>;
  readonly whiteboardOperationSubscribe: (
    input: WhiteboardOperationSessionIdentity & { readonly lastServerSequence: number },
    listener: (event: WhiteboardOperationSessionEvent) => boolean | void,
  ) => () => void;
  readonly whiteboardOperationAcknowledgeApplication: (
    input: WhiteboardAcknowledgeApplicationInput,
  ) => Promise<unknown>;
}

export interface SynaraWhiteboardOperationBridgeOptions {
  readonly projectId: string;
  readonly documentKind: "file-canvas" | "untitled-canvas";
  readonly documentId: string;
  readonly canvasIdentity: string;
  /** Expected document revision at attach time (server fences stale input). */
  readonly expectedDocumentRevision: number;
  /** Factory for the AI-only history coordinator (stays the sole owner). */
  readonly createCoordinator: (host: SynaraAiHistoryHost) => SynaraAiHistoryCoordinator;
  readonly host: SynaraAiHistoryHost;
  readonly scenario?: string;
  readonly onDiagnostic?: (diagnostic: unknown) => void;
  readonly onOutcome?: (outcome: SynaraWhiteboardOperationOutcome) => void;
}

/** The immutable server-minted session identity held by the bridge. */
export type SynaraWhiteboardSessionIdentity = WhiteboardOperationSessionIdentity;

export interface SynaraWhiteboardOperationOutcome {
  readonly kind: "terminal";
  readonly outcome: WhiteboardTerminalOutcome;
  readonly operationId: string;
  readonly generation: number;
  /** The exactly-one AI event created for completed/interrupted/failed-partial. */
  readonly event: SynaraAiHistoryEvent | null;
}

export type SynaraWhiteboardBridgeState =
  | "idle"
  | "attaching"
  | "subscribed"
  | "operation-active"
  | "take-over-pending"
  | "settled"
  | "protected";

/** One applied, correlated, verified progress mutation. */
interface AppliedProgressLedgerRecord {
  readonly batchId: string;
  readonly operationId: string;
  readonly generation: number;
  readonly producerSequence: number;
  readonly serverSequence: number;
  readonly expectedSemanticFingerprint: string;
  readonly adapterCorrelationId: string;
  readonly applicationResult: WhiteboardApplicationResult;
  readonly verifiedSemanticFingerprint: string;
  readonly resultingMutationRevision: number;
  /** Delivery truth: only transport interruptions are eligible for exact resend. */
  ackState: "sent" | "interrupted" | "rejected";
  readonly diagnosticCode?: WhiteboardApplicationDiagnosticCode;
}

function isRetryableTransportInterruption(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "WsTransportRequestInterruptedError" &&
    "retryable" in error &&
    error.retryable === true
  );
}

function progressRecordEquivalent(
  record: AppliedProgressLedgerRecord,
  event: WhiteboardOperationProgressEvent,
): boolean {
  return (
    record.batchId === event.batchId &&
    record.operationId === event.operationId &&
    record.generation === event.generation &&
    record.producerSequence === event.producerSequence &&
    record.serverSequence === event.serverSequence &&
    record.expectedSemanticFingerprint === event.expectedSemanticFingerprint
  );
}

/**
 * Dormant operation bridge. Owns no AI history: `SynaraAiHistoryCoordinator`
 * remains the sole AI-history owner. The bridge only correlates server truth
 * (identity, sequencing, Take Over, containment, terminal outcomes) with
 * truthful browser application evidence and forwards settlements.
 */
export class SynaraWhiteboardOperationBridge {
  public state: SynaraWhiteboardBridgeState = "idle";
  /** Exact server-minted identity from attach; null until attach succeeds. */
  public sessionIdentity: SynaraWhiteboardSessionIdentity | null = null;
  /** Resume cursor: the last server sequence this bridge accepted. */
  public lastAcceptedServerSequence = 0;

  private readonly transport: SynaraWhiteboardOperationTransport;
  private readonly options: SynaraWhiteboardOperationBridgeOptions;
  private coordinator: SynaraAiHistoryCoordinator | null = null;
  private unsubscribe: (() => void) | null = null;
  private offTransportFailure: (() => void) | null = null;
  private disposed = false;

  private activeOperation: {
    readonly batchId: string;
    readonly operationId: string;
    readonly generation: number;
  } | null = null;
  private readonly ledger = new Map<number, AppliedProgressLedgerRecord>();
  private lastVerifiedSemanticFingerprint: string | null = null;
  private pendingTakeOver: {
    readonly batchId: string;
    readonly operationId: string;
    readonly generation: number;
    readonly requestedGeneration: number;
    readonly takeOverRequestId: string;
  } | null = null;
  private containmentResult: WhiteboardContainmentResult | null = null;
  private terminalOutcome: WhiteboardTerminalOutcome | null = null;
  private settledTerminal: {
    readonly operationId: string;
    readonly generation: number;
    readonly outcome: WhiteboardTerminalOutcome;
  } | null = null;
  private terminalEventSettled = false;
  private ackChain: Promise<void> = Promise.resolve();

  public constructor(
    transport: SynaraWhiteboardOperationTransport,
    options: SynaraWhiteboardOperationBridgeOptions,
  ) {
    this.transport = transport;
    this.options = options;
  }

  /**
   * Opens the operation session. Refuses fail-closed when the negotiated
   * server did not advertise the exact operation-session capability, before
   * any attach request leaves the browser.
   */
  public async startSession(): Promise<SynaraWhiteboardSessionIdentity> {
    if (this.state !== "idle") {
      throw new Error(`bridge session already ${this.state}`);
    }
    if (!this.transport.hasWhiteboardOperationCapability()) {
      throw new Error("whiteboard operation-session capability is missing");
    }
    this.state = "attaching";
    const attached = await this.transport.whiteboardOperationAttachSession({
      projectId: this.options.projectId,
      documentKind: this.options.documentKind,
      documentId: this.options.documentId,
      canvasIdentity: this.options.canvasIdentity,
      expectedDocumentRevision: this.options.expectedDocumentRevision,
    });
    if (this.disposed) throw new Error("bridge disposed during attach");
    // Store the exact server-minted identity; never reconstruct or infer it.
    this.sessionIdentity = {
      serverInstanceId: attached.serverInstanceId,
      operationSessionId: attached.operationSessionId,
      sessionEpoch: attached.sessionEpoch,
      projectId: attached.projectId,
      documentKind: attached.documentKind,
      documentId: attached.documentId,
      canvasIdentity: attached.canvasIdentity,
    };
    this.lastAcceptedServerSequence = 0;
    this.offTransportFailure = this.transport.onWhiteboardOperationFailure((failure) => {
      this.handleTransportFailure(failure.code, failure.operationSessionId);
    });
    this.unsubscribe = this.transport.whiteboardOperationSubscribe(
      { ...this.sessionIdentity, lastServerSequence: this.lastAcceptedServerSequence },
      (event) => this.handleEvent(event),
    );
    this.state = "subscribed";
    return this.sessionIdentity;
  }

  public dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.offTransportFailure?.();
    this.offTransportFailure = null;
  }

  /** The coordinator, only after an admitted operation started it. */
  public getCoordinator(): SynaraAiHistoryCoordinator | null {
    return this.coordinator;
  }

  public getAppliedProgressCount(): number {
    return this.ledger.size;
  }

  private handleTransportFailure(code: string, operationSessionId?: string): void {
    if (this.disposed) return;
    if (
      this.sessionIdentity !== null &&
      operationSessionId !== undefined &&
      operationSessionId !== this.sessionIdentity.operationSessionId
    ) {
      return;
    }
    // A stream failure with an active operation is a lost session: remain
    // protected, create no terminal truth and no unlock claim.
    if (this.activeOperation !== null && this.coordinator !== null) {
      this.coordinator.protectAiOperationOnSessionLoss({
        reason: `operation session stream failed (${code}) while an operation was active`,
      });
    }
    this.activeOperation = null;
    this.state = "protected";
  }

  /**
   * Order-gated event handling. The transport already guarantees strict
   * serverSequence order, exact session identity, and duplicate-conflict
   * fail-closed delivery; this gate serializes snapshot/replay/live into one
   * ledger so replayed progress never re-applies.
   */
  private handleEvent(event: WhiteboardOperationSessionEvent): boolean {
    if (this.disposed) return false;
    const accepted = this.dispatch(event);
    if (
      accepted &&
      event.kind !== "session-snapshot" &&
      event.serverSequence > this.lastAcceptedServerSequence
    ) {
      // The high-water snapshot is a state fence. Only replay/live data
      // advances the resume cursor (Decision 0065 D5).
      this.lastAcceptedServerSequence = event.serverSequence;
    }
    return accepted;
  }

  private dispatch(event: WhiteboardOperationSessionEvent): boolean {
    switch (event.kind) {
      case "session-snapshot":
        return this.handleSnapshot(event);
      case "operation-admitted":
        return this.handleAdmitted(event);
      case "operation-progress":
        return this.handleProgress(event);
      case "take-over-pending":
        return this.handleTakeOverPending(event);
      case "containment-result":
        return this.handleContainmentResult(event);
      case "operation-terminal":
        return this.handleTerminal(event);
    }
  }

  private handleSnapshot(event: WhiteboardOperationSnapshotEvent): boolean {
    if (event.terminal !== undefined && event.terminal.operationId !== undefined) {
      if (this.activeOperation !== null || this.coordinator !== null) {
        // During an active same-authority reconnect, D5 replays the retained
        // pending/containment/terminal rows after this fence. Do not let the
        // summary bypass generation, acknowledgement-counter, or coordinator
        // settlement checks; the sequenced terminal event remains authoritative.
        // The snapshot still proves same-authority reconnect, so resend exact
        // interrupted acknowledgement evidence now even when the progress row
        // is already behind the resume cursor and will not replay.
        for (const record of this.ledger.values()) {
          if (record.ackState === "interrupted") this.queueAck(record);
        }
        return true;
      }
      // With no local operation/coordinator to settle, adopt the already
      // terminal session without manufacturing browser history.
      this.terminalOutcome = event.terminal.outcome;
      this.settledTerminal = {
        operationId: event.terminal.operationId,
        generation: event.terminal.generation,
        outcome: event.terminal.outcome,
      };
      this.terminalEventSettled = true;
      this.activeOperation = null;
      this.pendingTakeOver = null;
      this.state = "settled";
      return true;
    }
    if (event.takeOver !== undefined && event.takeOver.status === "pending") {
      this.pendingTakeOver = {
        batchId: event.takeOver.batchId,
        operationId: event.takeOver.operationId,
        generation: event.takeOver.generation,
        requestedGeneration: event.takeOver.requestedGeneration,
        takeOverRequestId: event.takeOver.takeOverRequestId,
      };
      this.state = "take-over-pending";
    }
    // A same-authority snapshot is the reconnect signal for acknowledgements
    // whose request/response transport was interrupted. Resend the exact
    // idempotent evidence without waiting for duplicate progress or reapplying.
    for (const record of this.ledger.values()) {
      if (record.ackState === "interrupted") this.queueAck(record);
    }
    return true;
  }

  private handleAdmitted(event: WhiteboardOperationAdmittedEvent): boolean {
    if (this.terminalEventSettled) {
      // Post-terminal work for the settled operation can never be admitted.
      return this.protectConflicting("operation admitted after a terminal outcome", event.operationId);
    }
    if (this.activeOperation === null) {
      if (this.coordinator !== null) {
        return this.protectConflicting(
          "another operation was admitted while the bridge already owned a coordinator",
          event.operationId,
        );
      }
      this.coordinator = this.options.createCoordinator(this.options.host);
      this.activeOperation = {
        batchId: event.batchId,
        operationId: event.operationId,
        generation: event.generation,
      };
      this.pendingTakeOver = null;
      this.containmentResult = null;
      this.state = "operation-active";
      // Starts the coordinator only now: an admitted operation exists.
      void this.coordinator
        .beginAiOperation({
          batchId: event.batchId,
          operationId: event.operationId,
          operationGeneration: event.generation,
        })
        .catch(() => {
          // beginAiOperation already reported and locked on failure.
          this.state = "protected";
        });
      return true;
    }
    if (
      this.activeOperation.operationId === event.operationId &&
      this.activeOperation.generation === event.generation
    ) {
      // Equivalent replayed admission: idempotent.
      return true;
    }
    return this.protectConflicting(
      "a different operation was admitted while one was active",
      event.operationId,
    );
  }

  private handleProgress(event: WhiteboardOperationProgressEvent): boolean {
    const active = this.activeOperation;
    if (
      active === null ||
      event.operationId !== active.operationId ||
      event.generation !== active.generation
    ) {
      // Stale or foreign-generation progress is fenced before any scene write.
      return this.protectConflicting(
        "progress for a stale or foreign operation/generation was fenced",
        event.operationId,
      );
    }
    if (this.pendingTakeOver !== null) {
      // Post-TakeOver producer work for the fenced generation is inapplicable.
      return this.protectConflicting(
        "progress arrived after Take Over fenced the operation generation",
        event.operationId,
      );
    }

    const existing = this.ledger.get(event.producerSequence);
    if (existing !== undefined) {
      if (!progressRecordEquivalent(existing, event)) {
        // Canonical duplicate ledger: conflicting replay fails closed.
        return this.protectConflicting(
          "replayed progress conflicts with the applied ledger record",
          event.operationId,
        );
      }
      if (existing.ackState === "interrupted") {
        // Identical replay after an interrupted acknowledgement: resend the
        // exact same acknowledgement. Never reapply.
        this.queueAck(existing);
      }
      return true;
    }

    const coordinator = this.coordinator;
    if (coordinator === null) {
      return this.protectConflicting(
        "progress arrived without an admitted operation",
        event.operationId,
      );
    }

    // Image-free application through the coordinator and the real adapter
    // scope. Element patches are mapped 1:1; no files, assets, or raw
    // Excalidraw values cross this boundary.
    const update: SynaraSceneInput = {
      elements: event.mutation.elements.map((element) => ({ ...element })),
      files: {},
    };
    let receipt: ReturnType<SynaraSyntheticWriteScopeHandle["issue"]> | null = null;
    try {
      receipt = coordinator.applyAiProgress({
        batchId: active.batchId,
        operationGeneration: event.generation,
        operationLocalSequence: event.producerSequence,
        update,
      });
    } catch {
      // The coordinator already reported the diagnostic and faulted the lock.
      this.state = "protected";
      return true;
    }

    const expectedRevision = event.expectedAfterRevision;
    const expectedFingerprint = event.expectedSemanticFingerprint;
    void receipt.acknowledgement
      .then(() => {
        if (this.disposed) return;
        const proof = coordinator.captureCanonicalSceneProof();
        // Semantic proof: correlated callback received (acknowledgement
        // resolved) and canonical verification of the expected target.
        if (
          proof.semanticFingerprint !== expectedFingerprint ||
          proof.mutationRevision !== expectedRevision
        ) {
          this.protectConflicting(
            "canonical semantic verification failed for the applied progress",
            event.operationId,
          );
          return;
        }
        const record: AppliedProgressLedgerRecord = {
          batchId: event.batchId,
          operationId: event.operationId,
          generation: event.generation,
          producerSequence: event.producerSequence,
          serverSequence: event.serverSequence,
          expectedSemanticFingerprint: expectedFingerprint,
          adapterCorrelationId: receipt.correlationId,
          applicationResult: "applied-semantic",
          verifiedSemanticFingerprint: proof.semanticFingerprint,
          resultingMutationRevision: proof.mutationRevision,
          ackState: "interrupted",
        };
        this.ledger.set(record.producerSequence, record);
        this.lastVerifiedSemanticFingerprint = proof.semanticFingerprint;
        // Acknowledge only now: correlated callback + semantic proof exist.
        this.queueAck(record);
      })
      .catch(() => {
        // The adapter callback never correlated or verified; the coordinator
        // faulted the lock and reported. Remain protected.
        this.state = "protected";
      });
    return true;
  }

  private queueAck(record: AppliedProgressLedgerRecord): void {
    if (this.sessionIdentity === null) return;
    const identity = this.sessionIdentity;
    const input: WhiteboardAcknowledgeApplicationInput = {
      ...identity,
      batchId: record.batchId,
      operationId: record.operationId,
      generation: record.generation,
      producerSequence: record.producerSequence,
      serverSequence: record.serverSequence,
      adapterCorrelationId: record.adapterCorrelationId,
      applicationResult: record.applicationResult,
      resultingMutationRevision: record.resultingMutationRevision,
      verifiedSemanticFingerprint: record.verifiedSemanticFingerprint,
    };
    // Serialize acknowledgement sends so ordering stays deterministic.
    this.ackChain = this.ackChain.then(async () => {
      if (this.disposed) return;
      try {
        await this.transport.whiteboardOperationAcknowledgeApplication(input);
        record.ackState = "sent";
      } catch (error) {
        if (isRetryableTransportInterruption(error)) {
          // Interrupted transport: the exact idempotent acknowledgement is
          // resent on an equivalent replay or the next same-authority snapshot.
          record.ackState = "interrupted";
          this.options.onDiagnostic?.({
            code: "ack-delivery-interrupted",
            producerSequence: record.producerSequence,
          });
          return;
        }
        // A typed server rejection (stale/conflict/unknown) is authoritative,
        // not a transport interruption. Never retry or expose success.
        record.ackState = "rejected";
        this.coordinator?.protectAiOperationOnSessionLoss({
          reason: "server rejected Whiteboard semantic acknowledgement evidence",
          code: "operation-session-lost",
        });
        this.state = "protected";
        this.options.onDiagnostic?.({
          code: "acknowledgement-rejected",
          producerSequence: record.producerSequence,
          error,
        });
      }
    });
  }

  private handleTakeOverPending(event: WhiteboardTakeOverPendingEvent): boolean {
    const active = this.activeOperation;
    if (
      active === null ||
      event.batchId !== active.batchId ||
      event.operationId !== active.operationId ||
      event.requestedGeneration !== active.generation ||
      event.generation <= event.requestedGeneration
    ) {
      return this.protectConflicting(
        "Take Over pending identity does not advance the active operation generation",
        event.operationId,
      );
    }
    const pending = {
      batchId: event.batchId,
      operationId: event.operationId,
      generation: event.generation,
      requestedGeneration: event.requestedGeneration,
      takeOverRequestId: event.takeOverRequestId,
    };
    if (this.pendingTakeOver !== null) {
      if (
        this.pendingTakeOver.batchId === pending.batchId &&
        this.pendingTakeOver.operationId === pending.operationId &&
        this.pendingTakeOver.generation === pending.generation &&
        this.pendingTakeOver.requestedGeneration === pending.requestedGeneration &&
        this.pendingTakeOver.takeOverRequestId === pending.takeOverRequestId
      ) {
        return true;
      }
      return this.protectConflicting(
        "a conflicting Take Over request arrived while containment was pending",
        event.operationId,
      );
    }
    this.pendingTakeOver = pending;
    this.state = "take-over-pending";
    // The Take Over pending lock stays until the matching advanced-generation
    // containment result and terminal resolve it; no unlock happens here.
    return true;
  }

  private handleContainmentResult(event: WhiteboardContainmentResultEvent): boolean {
    const pending = this.pendingTakeOver;
    if (
      pending === null ||
      event.batchId !== pending.batchId ||
      event.operationId !== pending.operationId ||
      event.generation !== pending.generation ||
      event.requestedGeneration !== pending.requestedGeneration ||
      event.takeOverRequestId !== pending.takeOverRequestId
    ) {
      return this.protectConflicting(
        "containment result identity does not match the pending Take Over",
        event.operationId,
      );
    }
    this.containmentResult = event.result;
    if (event.result === "acknowledged") {
      // Only acknowledged containment may lead to advanced-generation
      // interrupted/failed-partial/zero-valid settlement. The terminal event
      // itself still drives coordinator settlement.
      this.state = "operation-active";
      return true;
    }
    // Failed containment: remain protected — no interrupted success, no
    // unlock, no event.
    if (this.coordinator !== null && this.activeOperation !== null) {
      this.coordinator.protectAiOperationOnSessionLoss({
        reason: `containment result ${event.result} keeps the operation protected`,
        code: "operation-containment-unresolved",
      });
    }
    this.state = "protected";
    return true;
  }

  private handleTerminal(event: WhiteboardOperationTerminalEvent): boolean {
    if (this.terminalEventSettled) {
      if (
        this.settledTerminal !== null &&
        this.settledTerminal.operationId === event.operationId &&
        this.settledTerminal.generation === event.generation &&
        this.settledTerminal.outcome === event.outcome &&
        this.activeOperation === null
      ) {
        // Exact duplicate terminal for the already-settled operation.
        return true;
      }
      return this.protectConflicting(
        "a conflicting terminal outcome arrived for a settled operation",
        event.operationId,
      );
    }

    const active = this.activeOperation;
    const pending = this.pendingTakeOver;
    const matchesActiveGeneration =
      active !== null &&
      event.batchId === active.batchId &&
      event.operationId === active.operationId &&
      event.generation === active.generation;
    const matchesAcknowledgedTakeOverGeneration =
      active !== null &&
      pending !== null &&
      event.batchId === active.batchId &&
      event.operationId === active.operationId &&
      event.generation === pending.generation &&
      pending.requestedGeneration === active.generation &&
      this.containmentResult === "acknowledged" &&
      event.containmentResult === "acknowledged";
    const identityMatches =
      event.outcome === "interrupted"
        ? matchesAcknowledgedTakeOverGeneration
        : event.outcome === "completed"
          ? matchesActiveGeneration && pending === null
          : pending === null
            ? matchesActiveGeneration
            : matchesAcknowledgedTakeOverGeneration;
    if (this.terminalOutcome !== null || !identityMatches) {
      return this.protectConflicting(
        "a conflicting terminal outcome arrived for the active operation",
        event.operationId,
      );
    }

    const appliedSemanticCount = this.ledger.size;
    const hasRejectedAcknowledgement = [...this.ledger.values()].some(
      (record) => record.ackState === "rejected",
    );
    if (
      hasRejectedAcknowledgement ||
      event.acceptedSemanticCount !== appliedSemanticCount
    ) {
      this.coordinator?.protectAiOperationOnSessionLoss({
        reason:
          "server terminal acknowledgement counters do not match locally applied semantic work",
        code: "operation-session-lost",
      });
      this.state = "protected";
      this.options.onDiagnostic?.({
        code: "terminal-acknowledgement-mismatch",
        expectedAcceptedSemanticCount: appliedSemanticCount,
        observedAcceptedSemanticCount: event.acceptedSemanticCount,
      });
      return true;
    }

    if (event.outcome === "zero-valid") {
      // Zero-valid: no AI event, no native-history clear, no cursor movement,
      // and no silent success — the coordinator aborts with a diagnostic.
      this.terminalOutcome = "zero-valid";
      this.settledTerminal = {
        operationId: event.operationId,
        generation: event.generation,
        outcome: event.outcome,
      };
      this.terminalEventSettled = true;
      const coordinator = this.coordinator;
      const active = this.activeOperation;
      if (coordinator !== null && active !== null) {
        coordinator.abortAiOperationForZeroValid({
          batchId: active.batchId,
          reason: `server terminal outcome zero-valid (${event.terminalReason})`,
        });
      }
      this.activeOperation = null;
      this.pendingTakeOver = null;
      this.state = "settled";
      this.options.onOutcome?.({
        kind: "terminal",
        outcome: "zero-valid",
        operationId: event.operationId,
        generation: event.generation,
        event: null,
      });
      return true;
    }

    const coordinator = this.coordinator;
    if (coordinator === null || active === null) {
      return this.protectConflicting(
        "a terminal outcome arrived without an admitted active operation",
        event.operationId,
      );
    }
    if (event.outcome === "interrupted" && this.containmentResult !== "acknowledged") {
      // Interrupted finalization requires acknowledged containment.
      coordinator.protectAiOperationOnSessionLoss({
        reason: "interrupted terminal without acknowledged containment stays protected",
        code: "operation-containment-unresolved",
      });
      this.state = "protected";
      return true;
    }
    if (event.outcome !== "completed" && event.outcome !== "interrupted" && event.outcome !== "failed-partial") {
      return this.protectConflicting("unknown terminal outcome", event.operationId);
    }

    // Local proof: the current canonical scene must still match the last
    // verified semantic application of this operation.
    const proof = coordinator.captureCanonicalSceneProof();
    if (
      this.lastVerifiedSemanticFingerprint !== null &&
      proof.semanticFingerprint !== this.lastVerifiedSemanticFingerprint
    ) {
      coordinator.protectAiOperationOnSessionLoss({
        reason: "local canonical proof no longer matches the verified application",
      });
      this.state = "protected";
      return true;
    }

    this.terminalOutcome = event.outcome;
    void coordinator
      .finalizeAiOperation({ batchId: active.batchId, outcome: event.outcome })
      .then((aiEvent) => {
        if (this.disposed) return;
        // Exactly one event — created after matching local proof and the
        // coordinator's verified native-history clear.
        this.settledTerminal = {
          operationId: event.operationId,
          generation: event.generation,
          outcome: event.outcome,
        };
        this.terminalEventSettled = true;
        this.activeOperation = null;
        this.pendingTakeOver = null;
        this.state = "settled";
        this.options.onOutcome?.({
          kind: "terminal",
          outcome: event.outcome,
          operationId: event.operationId,
          generation: event.generation,
          event: aiEvent,
        });
      })
      .catch(() => {
        // finalizeAiOperation reported and locked the fault.
        this.state = "protected";
      });
    return true;
  }

  /** Fail-closed protection: keeps locks, reports, and never unlocks. */
  private protectConflicting(message: string, operationId: string): boolean {
    if (this.coordinator !== null) {
      this.coordinator.protectAiOperationOnSessionLoss({ reason: message });
    }
    this.state = "protected";
    this.options.onDiagnostic?.({ code: "operation-conflicting-terminal", message, operationId });
    return true;
  }
}
