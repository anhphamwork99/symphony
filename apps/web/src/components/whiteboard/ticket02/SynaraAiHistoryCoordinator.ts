import type {
  SynaraSceneInput,
  SynaraSceneSnapshot,
  SynaraSyntheticWriteScopeHandle,
  SynaraViewport,
} from "../ticket01/SynaraExcalidrawAdapter";
import {
  captureDocumentSnapshot,
  documentSnapshotsEqual,
  toSceneSnapshot,
  type SynaraDocumentSnapshot,
} from "./SynaraDocumentSnapshot";
import {
  createSettlementObserver,
  settleFamily,
  settlementDrainWindow,
  type SynaraSettlementInput,
  type SynaraSettlementObserver,
  type SynaraSettlementResult,
} from "./SynaraHumanMutationSettlement";
import type {
  SynaraAiCommandTrace,
  SynaraAiCommandTraceStep,
  SynaraAiHistoryEvent,
  SynaraAiHistoryState,
  SynaraEditLockState,
  SynaraHistoryDiagnostic,
  SynaraHistoryDiagnosticCode,
  SynaraHistoryIdentity,
} from "./SynaraAiHistoryTypes";

export interface SynaraAiHistoryHost {
  readonly getIdentity: () => { readonly mountId: number; readonly apiId: string | null };
  readonly captureScene: () => SynaraSceneSnapshot;
  readonly captureViewport: () => SynaraViewport;
  readonly updateScene: (update: SynaraSceneInput & { readonly sequence?: number }) => void;
  readonly restoreScene: (snapshot: SynaraSceneSnapshot) => void;
  readonly clearNativeHistory: () => void;
  readonly setViewModeEnabled: (enabled: boolean) => void;
  readonly openSyntheticWriteScope: (context: {
    readonly purpose:
      | "ai-batch-progress"
      | "ai-batch-finalize"
      | "ai-undo"
      | "ai-redo"
      | "rollback";
    readonly canvasIdentity: string;
    readonly mountIdentity: string;
    readonly apiIdentity: string;
    readonly operationId: string;
    readonly operationGeneration: number;
    readonly sessionEpoch: number;
    readonly routeEpoch: number;
    readonly expectedBeforeRevision: number;
  }) => SynaraSyntheticWriteScopeHandle;
  readonly observeHostBoundary: () => {
    readonly adapterCallbackSequence: number;
    readonly scopeActive: boolean;
    readonly tombstoneCount: number;
    readonly editingTextActive: boolean;
  };
}

export interface SynaraAiHistoryCoordinatorOptions {
  readonly canvasIdentity: string;
  readonly scenario: string;
  readonly browser?: string;
  readonly platform?: string;
  readonly settlementMaxWaitMs?: number;
  readonly onDiagnostic?: (diagnostic: SynaraHistoryDiagnostic) => void;
}

interface ActiveAiBatch {
  readonly batchId: string;
  readonly operationId: string;
  readonly operationGeneration: number;
  readonly before: SynaraDocumentSnapshot;
  readonly beforeRevision: number;
  readonly creationRouteEpoch: number;
  readonly identity: SynaraHistoryIdentity;
  readonly scope: SynaraSyntheticWriteScopeHandle;
  acceptedSyntheticWriteCount: number;
  lastTarget: SynaraDocumentSnapshot;
}

type ApplicableSide = {
  readonly eventId: string;
  readonly side: "before" | "after";
  readonly routeEpoch: number;
  readonly mutationRevision: number;
} | null;

/** AI-only coordinator. Native history is never dispatched or represented here. */
export class SynaraAiHistoryCoordinator {
  private events: SynaraAiHistoryEvent[] = [];
  private cursor = 0;
  private lockState: SynaraEditLockState = "unlocked";
  private routeEpoch = 1;
  private mutationRevision = 0;
  private readonly sessionEpoch = 1;
  private eventCounter = 0;
  private activeBatch: ActiveAiBatch | null = null;
  private applicableSide: ApplicableSide = null;
  private readonly diagnostics: SynaraHistoryDiagnostic[] = [];
  private readonly traces: SynaraAiCommandTrace[] = [];
  private readonly settlements: SynaraSettlementResult[] = [];
  private readonly settlementObserver: SynaraSettlementObserver;
  private readonly initialIdentity: SynaraHistoryIdentity;

  public constructor(
    private readonly host: SynaraAiHistoryHost,
    private readonly options: SynaraAiHistoryCoordinatorOptions,
  ) {
    this.initialIdentity = this.identity();
    this.settlementObserver = createSettlementObserver({
      maxWaitMs: options.settlementMaxWaitMs ?? 500,
    });
  }

  public getState(): SynaraAiHistoryState {
    return Object.freeze({
      events: Object.freeze([...this.events]),
      cursor: this.cursor,
      lockState: this.lockState,
      routeEpoch: this.routeEpoch,
      mutationRevision: this.mutationRevision,
      identity: this.identity(),
    });
  }

  public getDiagnostics(): readonly SynaraHistoryDiagnostic[] {
    return Object.freeze([...this.diagnostics]);
  }

  public getTraces(): readonly SynaraAiCommandTrace[] {
    return Object.freeze([...this.traces]);
  }

  public getSettlements(): readonly SynaraSettlementResult[] {
    return Object.freeze([...this.settlements]);
  }

  private identity(): SynaraHistoryIdentity {
    const adapter = this.host.getIdentity();
    return {
      canvasIdentity: this.options.canvasIdentity,
      mountIdentity: `mount-${adapter.mountId}`,
      apiIdentity: adapter.apiId ?? "api-unready",
      sessionEpoch: this.sessionEpoch,
    };
  }

  private report(
    owner: "adapter" | "coordinator",
    code: SynaraHistoryDiagnosticCode,
    input: {
      readonly phase: string;
      readonly message: string;
      readonly expected: string;
      readonly observed: string;
      readonly severity?: SynaraHistoryDiagnostic["severity"];
      readonly recoverability?: SynaraHistoryDiagnostic["recoverability"];
      readonly operationId?: string;
      readonly operationGeneration?: number;
      readonly operationLocalSequence?: number;
      readonly adapterSyntheticSequence?: number;
      readonly adapterCallbackSequence?: number;
      readonly scopeCorrelationId?: string;
      readonly batchId?: string;
      readonly eventId?: string;
    },
  ): SynaraHistoryDiagnostic {
    const identity = this.identity();
    const diagnostic: SynaraHistoryDiagnostic = Object.freeze({
      schema: "synara.whiteboard.history-diagnostic/v1",
      owner,
      code,
      severity: input.severity ?? "error",
      recoverability: input.recoverability ?? "locked",
      acApplicability: "bounded-gate-evidence",
      phase: input.phase,
      scenario: this.options.scenario,
      message: input.message,
      summary: `${code}: ${input.message}`,
      packageVersion: "0.18.1",
      browser: this.options.browser ?? "stable-chromium",
      platform: this.options.platform ?? "gate-harness",
      canvasIdentity: identity.canvasIdentity,
      mountIdentity: identity.mountIdentity,
      apiIdentity: identity.apiIdentity,
      sessionEpoch: identity.sessionEpoch,
      routeEpoch: this.routeEpoch,
      mutationRevision: this.mutationRevision,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.operationGeneration === undefined
        ? {}
        : { operationGeneration: input.operationGeneration }),
      ...(input.operationLocalSequence === undefined
        ? {}
        : { operationLocalSequence: input.operationLocalSequence }),
      ...(input.adapterSyntheticSequence === undefined
        ? {}
        : { adapterSyntheticSequence: input.adapterSyntheticSequence }),
      ...(input.adapterCallbackSequence === undefined
        ? {}
        : { adapterCallbackSequence: input.adapterCallbackSequence }),
      ...(input.scopeCorrelationId === undefined
        ? {}
        : { scopeCorrelationId: input.scopeCorrelationId }),
      ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      expected: input.expected,
      observed: input.observed,
      lockState: this.lockState,
      timestamp: Date.now(),
    });
    this.diagnostics.push(diagnostic);
    this.options.onDiagnostic?.(diagnostic);
    return diagnostic;
  }

  public recordAdapterDiagnostic(input: {
    readonly code: SynaraHistoryDiagnosticCode;
    readonly phase: string;
    readonly expected: string;
    readonly observed: string;
  }): void {
    this.report("adapter", input.code, {
      ...input,
      message: input.observed,
      severity: input.code === "duplicate-synthetic-callback" ? "error" : "critical",
      recoverability: "locked",
    });
  }

  public failClosedForUnknownCallback(): void {
    this.lockState = "locked-fault";
    this.host.setViewModeEnabled(true);
  }

  public async beginAiOperation(input: {
    readonly batchId: string;
    readonly operationId: string;
    readonly operationGeneration: number;
  }): Promise<void> {
    if (this.activeBatch !== null || this.lockState !== "unlocked") {
      this.report("coordinator", "operation-not-applicable", {
        phase: "ai-batch-begin",
        message: "AI batch begin requires one unlocked idle coordinator",
        expected: "unlocked with no active batch",
        observed: `lock=${this.lockState}, active=${this.activeBatch?.batchId ?? "none"}`,
        batchId: input.batchId,
        operationId: input.operationId,
        operationGeneration: input.operationGeneration,
        recoverability: "none",
      });
      throw new Error("AI operation is not applicable");
    }
    this.assertStableIdentity("ai-batch-begin");
    const before = captureDocumentSnapshot(this.host.captureScene());
    const identity = this.identity();
    this.lockState = "ai-batch";
    this.host.setViewModeEnabled(true);
    await this.awaitHostQuiescence();
    const locked = captureDocumentSnapshot(this.host.captureScene());
    if (!documentSnapshotsEqual(before, locked)) {
      this.report("adapter", "edit-lock-failed", {
        phase: "ai-batch-begin",
        message: "document changed while establishing the supported AI edit lock",
        expected: before.semanticFingerprint,
        observed: locked.semanticFingerprint,
      });
      this.lockFault();
      throw new Error("AI edit lock failed");
    }
    const scope = this.openScope(
      "ai-batch-progress",
      input.operationId,
      input.operationGeneration,
      this.mutationRevision,
    );
    this.activeBatch = {
      ...input,
      before,
      beforeRevision: this.mutationRevision,
      creationRouteEpoch: this.routeEpoch,
      identity,
      scope,
      acceptedSyntheticWriteCount: 0,
      lastTarget: before,
    };
  }

  public applyAiProgress(input: {
    readonly batchId: string;
    readonly operationGeneration: number;
    readonly operationLocalSequence: number;
    readonly update: SynaraSceneInput;
  }): {
    readonly adapterGlobalSyntheticSequence: number;
    readonly correlationId: string;
    readonly acknowledgement: Promise<void>;
  } {
    const batch = this.requireBatch(input.batchId);
    if (input.operationGeneration !== batch.operationGeneration) {
      this.report("coordinator", "stale-operation-generation", {
        phase: "ai-progress",
        message: "stale operation generation was rejected before a scene write",
        expected: String(batch.operationGeneration),
        observed: String(input.operationGeneration),
        operationId: batch.operationId,
        operationGeneration: input.operationGeneration,
        operationLocalSequence: input.operationLocalSequence,
        batchId: batch.batchId,
        recoverability: "none",
      });
      throw new Error("stale operation generation");
    }
    const current = this.host.captureScene();
    const targetScene: SynaraSceneSnapshot = {
      ...current,
      elements: input.update.elements ?? current.elements,
      files: input.update.files ?? current.files,
    };
    const target = captureDocumentSnapshot(targetScene);
    const receipt = batch.scope.issue({
      operationLocalSequence: input.operationLocalSequence,
      expectedBeforeRevision: this.mutationRevision,
      targetProjection: target.semanticFingerprint,
      apply: () => this.host.updateScene(input.update),
      onAcknowledged: () => {
        batch.acceptedSyntheticWriteCount += 1;
        batch.lastTarget = target;
        this.mutationRevision += 1;
      },
    });
    return receipt;
  }

  public async completeAiOperation(batchId: string): Promise<SynaraAiHistoryEvent | null> {
    const batch = this.requireBatch(batchId);
    try {
      await batch.scope.drain();
      this.assertOperationLock("ai-batch", "ai-batch-complete");
      const after = captureDocumentSnapshot(this.host.captureScene());
      if (!documentSnapshotsEqual(after, batch.lastTarget)) {
        throw this.failSemanticVerification("ai-batch-complete", batch.lastTarget, after);
      }
      await batch.scope.close();
      this.assertOperationLock("ai-batch", "ai-batch-complete");
      if (batch.acceptedSyntheticWriteCount === 0 || documentSnapshotsEqual(batch.before, after)) {
        this.activeBatch = null;
        this.host.setViewModeEnabled(false);
        this.lockState = "unlocked";
        return null;
      }
      await this.clearAndProveStable(after, "ai-batch-complete");
      this.assertOperationLock("ai-batch", "ai-batch-complete");
      const event = this.appendCompletedEvent(batch, after);
      this.activeBatch = null;
      this.routeEpoch += 1;
      this.applicableSide = {
        eventId: event.id,
        side: "after",
        routeEpoch: this.routeEpoch,
        mutationRevision: this.mutationRevision,
      };
      this.host.setViewModeEnabled(false);
      this.lockState = "unlocked";
      return event;
    } catch (error) {
      batch.scope.abort(error instanceof Error ? error.message : String(error));
      this.lockFault();
      throw error;
    }
  }

  private appendCompletedEvent(
    batch: ActiveAiBatch,
    after: SynaraDocumentSnapshot,
  ): SynaraAiHistoryEvent {
    const event: SynaraAiHistoryEvent = Object.freeze({
      id: `ai-event-${++this.eventCounter}`,
      provenance: Object.freeze({
        canvasIdentity: batch.identity.canvasIdentity,
        mountIdentity: batch.identity.mountIdentity,
        apiIdentity: batch.identity.apiIdentity,
        sessionEpoch: batch.identity.sessionEpoch,
        creationRouteEpoch: batch.creationRouteEpoch,
        operationId: batch.operationId,
        operationGeneration: batch.operationGeneration,
        beforeRevision: batch.beforeRevision,
        afterRevision: this.mutationRevision,
      }),
      outcome: "completed",
      batchId: batch.batchId,
      acceptedSyntheticWriteCount: batch.acceptedSyntheticWriteCount,
      before: batch.before,
      after,
    });
    this.events = [...this.events.slice(0, this.cursor), event];
    this.cursor = this.events.length;
    return event;
  }

  public canUndoAiBatch(): boolean {
    return this.commandEvent("undo-ai-batch", false) !== null;
  }

  public canRedoAiBatch(): boolean {
    return this.commandEvent("redo-ai-batch", false) !== null;
  }

  public undoAiBatch(): Promise<boolean> {
    return this.restoreCommand("undo-ai-batch");
  }

  public redoAiBatch(): Promise<boolean> {
    return this.restoreCommand("redo-ai-batch");
  }

  private async restoreCommand(command: "undo-ai-batch" | "redo-ai-batch"): Promise<boolean> {
    const event = this.commandEvent(command, true);
    if (event === null) return false;
    const target = command === "undo-ai-batch" ? event.before : event.after;
    if (target.activeFileReferences.length !== 0) {
      this.report("coordinator", "operation-not-applicable", {
        phase: command,
        message: "Gate restore requires an empty active-file closure",
        expected: "zero active file references",
        observed: String(target.activeFileReferences.length),
        eventId: event.id,
        recoverability: "none",
      });
      return false;
    }
    const viewport = this.host.captureViewport();
    const selected = this.host.captureScene().selectedElementIds;
    const targetIds = new Set(
      target.elements.map((element) => String((element as Record<string, unknown>).id ?? "")),
    );
    const targetScene = {
      ...toSceneSnapshot(target),
      viewport,
      selectedElementIds: selected.filter((id) => targetIds.has(id)),
    };
    const traceSteps: SynaraAiCommandTraceStep[] = [];
    const push = (step: SynaraAiCommandTraceStep) => traceSteps.push(step);
    this.lockState = "restore";
    this.host.setViewModeEnabled(true);
    await this.awaitHostQuiescence();
    const scope = this.openScope(
      command === "undo-ai-batch" ? "ai-undo" : "ai-redo",
      event.provenance.operationId,
      event.provenance.operationGeneration,
      this.mutationRevision,
    );
    try {
      push("restore-write-issued");
      const receipt = scope.issue({
        operationLocalSequence: 1,
        expectedBeforeRevision: this.mutationRevision,
        targetProjection: target.semanticFingerprint,
        apply: () => this.host.restoreScene(targetScene),
      });
      await receipt.acknowledgement;
      push("restore-callback-acknowledged");
      await scope.drain();
      this.assertOperationLock("restore", command);
      const verified = captureDocumentSnapshot(this.host.captureScene());
      if (!documentSnapshotsEqual(target, verified)) {
        throw this.failSemanticVerification(command, target, verified, event.id);
      }
      push("restore-target-verified");
      await scope.close();
      this.assertOperationLock("restore", command);
      push("native-history-clear-invoked");
      this.host.clearNativeHistory();
      push("native-history-clear-returned");
      await this.provePostClearStable(target, command);
      this.assertOperationLock("restore", command);
      push("post-clear-drain-complete");
      this.cursor += command === "undo-ai-batch" ? -1 : 1;
      this.mutationRevision += 1;
      this.routeEpoch += 1;
      this.applicableSide = {
        eventId: event.id,
        side: command === "undo-ai-batch" ? "before" : "after",
        routeEpoch: this.routeEpoch,
        mutationRevision: this.mutationRevision,
      };
      push("cursor-moved");
      push("result-exposed");
      this.host.setViewModeEnabled(false);
      this.lockState = "unlocked";
      push("lock-released");
      this.traces.push(
        Object.freeze({ command, eventId: event.id, steps: Object.freeze(traceSteps) }),
      );
      return true;
    } catch (error) {
      scope.abort(error instanceof Error ? error.message : String(error));
      this.lockFault();
      return false;
    }
  }

  private commandEvent(
    command: "undo-ai-batch" | "redo-ai-batch",
    reportFailure: boolean,
  ): SynaraAiHistoryEvent | null {
    const event =
      command === "undo-ai-batch" ? this.events[this.cursor - 1] : this.events[this.cursor];
    const expectedSide = command === "undo-ai-batch" ? "after" : "before";
    const invalid =
      this.lockState !== "unlocked" ||
      this.activeBatch !== null ||
      event === undefined ||
      this.applicableSide?.eventId !== event.id ||
      this.applicableSide?.side !== expectedSide ||
      this.applicableSide?.routeEpoch !== this.routeEpoch ||
      this.applicableSide?.mutationRevision !== this.mutationRevision ||
      !this.sameIdentity(event) ||
      !documentSnapshotsEqual(
        captureDocumentSnapshot(this.host.captureScene()),
        expectedSide === "after" ? event.after : event.before,
      );
    if (!invalid) return event;
    if (reportFailure) {
      this.report("coordinator", "cursor-not-actionable", {
        phase: command,
        message:
          "current identity, lineage, cursor, revision side, and projection must be actionable",
        expected: `${expectedSide} side of one cursor-selected AI event`,
        observed: `lock=${this.lockState}, cursor=${this.cursor}, events=${this.events.length}, side=${this.applicableSide?.side ?? "none"}`,
        ...(event === undefined ? {} : { eventId: event.id }),
        recoverability: "none",
        severity: "info",
      });
    }
    return null;
  }

  private sameIdentity(event: SynaraAiHistoryEvent): boolean {
    const current = this.identity();
    return (
      current.canvasIdentity === event.provenance.canvasIdentity &&
      current.mountIdentity === event.provenance.mountIdentity &&
      current.apiIdentity === event.provenance.apiIdentity &&
      current.sessionEpoch === event.provenance.sessionEpoch
    );
  }

  public observeSettlementInput(input: SynaraSettlementInput): SynaraSettlementResult | null {
    if (this.lockState === "ai-batch" || this.lockState === "restore") {
      if (input.kind === "semantic-callback" && input.callbackProvenance !== "synthetic") {
        this.report("coordinator", "native-mutation-during-ai-lock", {
          phase: "human-settlement",
          message: "a human semantic callback arrived while AI mutation was locked",
          expected: "only correlated synthetic callbacks while locked",
          observed: input.callbackProvenance ?? "human",
          ...(input.adapterCallbackSequence === undefined
            ? {}
            : { adapterCallbackSequence: input.adapterCallbackSequence }),
        });
        this.lockFault();
      }
      return null;
    }
    const immediate = this.settlementObserver.observe(input);
    if (immediate !== null) this.acceptSettlement(immediate);
    return immediate;
  }

  public async settleHumanMutation(): Promise<SynaraSettlementResult> {
    let callbackSequence = this.host.observeHostBoundary().adapterCallbackSequence;
    await settlementDrainWindow({
      maxWaitMs: this.options.settlementMaxWaitMs ?? 500,
      onNewCallback: () => {
        const next = this.host.observeHostBoundary().adapterCallbackSequence;
        const changed = next !== callbackSequence;
        callbackSequence = next;
        return changed;
      },
    });
    const result = settleFamily(
      this.settlementObserver,
      captureDocumentSnapshot(this.host.captureScene()),
    );
    this.acceptSettlement(result);
    return result;
  }

  private acceptSettlement(result: SynaraSettlementResult): void {
    this.settlements.push(result);
    if (result.settled === "no-op") return;
    if (result.settled === "uncertain") {
      this.report("coordinator", "human-settlement-uncertain", {
        phase: "human-settlement",
        message: `settlement family ${result.family} remained uncertain`,
        expected: "reliable changed/no-op settlement within 500ms",
        observed: result.reason,
        recoverability: "none",
        severity: "warning",
      });
    }
    this.events = [];
    this.cursor = 0;
    this.applicableSide = null;
    this.routeEpoch += 1;
    if (result.settled === "changed") this.mutationRevision += 1;
  }

  private openScope(
    purpose: "ai-batch-progress" | "ai-batch-finalize" | "ai-undo" | "ai-redo" | "rollback",
    operationId: string,
    operationGeneration: number,
    expectedBeforeRevision: number,
  ): SynaraSyntheticWriteScopeHandle {
    const identity = this.identity();
    return this.host.openSyntheticWriteScope({
      purpose,
      canvasIdentity: identity.canvasIdentity,
      mountIdentity: identity.mountIdentity,
      apiIdentity: identity.apiIdentity,
      operationId,
      operationGeneration,
      sessionEpoch: identity.sessionEpoch,
      routeEpoch: this.routeEpoch,
      expectedBeforeRevision,
    });
  }

  private async clearAndProveStable(
    expected: SynaraDocumentSnapshot,
    phase: string,
  ): Promise<void> {
    try {
      this.host.clearNativeHistory();
    } catch (error) {
      this.report("adapter", "native-history-clear-failed", {
        phase,
        message: "public native history clear failed",
        expected: "api.history.clear returns",
        observed: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await this.provePostClearStable(expected, phase);
  }

  private async awaitHostQuiescence(): Promise<void> {
    let callbackSequence = this.host.observeHostBoundary().adapterCallbackSequence;
    await settlementDrainWindow({
      maxWaitMs: this.options.settlementMaxWaitMs ?? 500,
      onNewCallback: () => {
        const next = this.host.observeHostBoundary().adapterCallbackSequence;
        const changed = next !== callbackSequence;
        callbackSequence = next;
        return changed;
      },
    });
  }

  private async provePostClearStable(
    expected: SynaraDocumentSnapshot,
    phase: string,
  ): Promise<void> {
    let callbackSequence = this.host.observeHostBoundary().adapterCallbackSequence;
    await settlementDrainWindow({
      maxWaitMs: this.options.settlementMaxWaitMs ?? 500,
      onNewCallback: () => {
        const next = this.host.observeHostBoundary().adapterCallbackSequence;
        const changed = next !== callbackSequence;
        callbackSequence = next;
        return changed;
      },
    });
    const observed = captureDocumentSnapshot(this.host.captureScene());
    if (!documentSnapshotsEqual(expected, observed)) {
      this.report("adapter", "native-history-reappeared-after-clear", {
        phase,
        message: "document content changed during the bounded post-clear drain",
        expected: expected.semanticFingerprint,
        observed: observed.semanticFingerprint,
      });
      throw new Error("native history reappeared after clear");
    }
  }

  private failSemanticVerification(
    phase: string,
    expected: SynaraDocumentSnapshot,
    observed: SynaraDocumentSnapshot,
    eventId?: string,
  ): Error {
    this.report("coordinator", "semantic-verification-mismatch", {
      phase,
      message: "canonical target verification failed",
      expected: expected.semanticFingerprint,
      observed: observed.semanticFingerprint,
      ...(eventId === undefined ? {} : { eventId }),
    });
    return new Error("canonical target verification failed");
  }

  private assertStableIdentity(phase: string): void {
    const current = this.identity();
    if (
      current.mountIdentity === this.initialIdentity.mountIdentity &&
      current.apiIdentity === this.initialIdentity.apiIdentity
    ) {
      return;
    }
    this.report("adapter", "identity-changed-unexpectedly", {
      phase,
      message: "adapter mount/API identity changed outside a lifecycle boundary",
      expected: `${this.initialIdentity.mountIdentity}/${this.initialIdentity.apiIdentity}`,
      observed: `${current.mountIdentity}/${current.apiIdentity}`,
    });
    this.lockFault();
    throw new Error("adapter identity changed unexpectedly");
  }

  private requireBatch(batchId: string): ActiveAiBatch {
    if (this.activeBatch?.batchId === batchId) return this.activeBatch;
    this.report("coordinator", "operation-not-applicable", {
      phase: "ai-batch",
      message: "no matching active AI batch",
      expected: batchId,
      observed: this.activeBatch?.batchId ?? "none",
      batchId,
      recoverability: "none",
    });
    throw new Error(`batch ${batchId} is not active`);
  }

  private lockFault(): void {
    this.lockState = "locked-fault";
    this.host.setViewModeEnabled(true);
  }

  private assertOperationLock(
    expected: Extract<SynaraEditLockState, "ai-batch" | "restore">,
    phase: string,
  ): void {
    if (this.lockState === expected) return;
    this.report("coordinator", "operation-not-applicable", {
      phase,
      message: "operation faulted before its result could be exposed",
      expected: `lock=${expected}`,
      observed: `lock=${this.lockState}`,
    });
    this.lockFault();
    throw new Error("operation faulted before completion");
  }
}
