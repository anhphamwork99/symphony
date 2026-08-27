import type {
  SynaraSceneInput,
  SynaraSceneSnapshot,
  SynaraSyntheticWriteScopeHandle,
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
  SynaraAiHistoryReporter,
  SynaraEditLockState,
  SynaraHistoryDiagnostic,
  SynaraHistoryIdentity,
} from "./SynaraAiHistoryTypes";

/**
 * AI-only history coordinator (plan §§4.3, 6.4).
 *
 * Humans are settlement/invalidation inputs, never events. There is no
 * generic undo/redo dispatcher: `undoAiBatch` and `redoAiBatch` are the only
 * commands, they never dispatch native Undo/Redo, and native shortcuts pass
 * untouched to the package.
 */

const MAX_RETAINED_AI_EVENTS = 20;

export interface SynaraAiHistoryHost {
  readonly getIdentity: () => { readonly mountId: number; readonly apiId: string | null };
  readonly captureScene: () => SynaraSceneSnapshot;
  readonly captureViewport: () => { readonly scrollX: number; readonly scrollY: number; readonly zoom: number };
  readonly updateScene: (update: SynaraSceneInput & { readonly sequence?: number }) => void;
  readonly restoreScene: (snapshot: SynaraSceneSnapshot) => void;
  readonly restoreViewport: (viewport: { readonly scrollX: number; readonly scrollY: number; readonly zoom: number }) => void;
  readonly clearNativeHistory: () => void;
  readonly setViewModeEnabled: (enabled: boolean) => void;
  readonly openSyntheticWriteScope: (context: {
    readonly purpose: "ai-batch-progress" | "ai-batch-finalize" | "ai-undo" | "ai-redo" | "rollback";
    readonly operationId: string;
    readonly operationGeneration: number;
    readonly sessionEpoch: number;
    readonly routeEpoch: number;
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
  readonly syntheticDrainWindowMs?: number;
  readonly onDiagnostic?: (diagnostic: SynaraHistoryDiagnostic) => void;
}

interface ActiveAiBatch {
  readonly batchId: string;
  readonly operationId: string;
  readonly operationGeneration: number;
  readonly before: SynaraDocumentSnapshot;
  readonly beforeRevision: number;
  readonly creationRouteEpoch: number;
  acceptedSyntheticWriteCount: number;
  nextLocalSequence: number;
  scope: SynaraSyntheticWriteScopeHandle | null;
}

export class SynaraAiHistoryCoordinator implements SynaraAiHistoryReporter {
  private events: SynaraAiHistoryEvent[] = [];
  private cursor = 0;
  private lockState: SynaraEditLockState = "unlocked";
  private routeEpoch = 1;
  private mutationRevision = 0;
  private sessionEpoch = 1;
  private eventCounter = 0;
  private activeBatch: ActiveAiBatch | null = null;
  private readonly diagnostics: SynaraHistoryDiagnostic[] = [];
  private readonly traces: SynaraAiCommandTrace[] = [];
  private readonly settlements: SynaraSettlementResult[] = [];
  private readonly settlementObserver: SynaraSettlementObserver;
  private humanInvalidated = false;

  public constructor(
    private readonly host: SynaraAiHistoryHost,
    private readonly options: SynaraAiHistoryCoordinatorOptions,
  ) {
    this.settlementObserver = createSettlementObserver({
      maxWaitMs: options.settlementMaxWaitMs ?? 500,
    });
  }

  public getState() {
    return {
      events: Object.freeze([...this.events]),
      cursor: this.cursor,
      lockState: this.lockState,
      routeEpoch: this.routeEpoch,
      mutationRevision: this.mutationRevision,
      identity: this.identity(),
    };
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

  public report(
    diagnostic: Omit<SynaraHistoryDiagnostic, "schema">,
  ): void {
    const record = { ...diagnostic, schema: "synara.whiteboard.history-diagnostic/v1" as const };
    this.diagnostics.push(record);
    this.options.onDiagnostic?.(record);
  }

  private identity(): SynaraHistoryIdentity {
    const adapterIdentity = this.host.getIdentity();
    return {
      canvasIdentity: this.options.canvasIdentity,
      mountIdentity: `mount-${adapterIdentity.mountId}`,
      apiIdentity: adapterIdentity.apiId ?? "api-unready",
      sessionEpoch: this.sessionEpoch,
    };
  }

  private baseDiagnostic(
    owner: "adapter" | "coordinator",
    code: SynaraHistoryDiagnostic["code"],
    fields: {
      readonly severity: SynaraHistoryDiagnostic["severity"];
      readonly recoverability: SynaraHistoryDiagnostic["recoverability"];
      readonly acApplicability: SynaraHistoryDiagnostic["acApplicability"];
      readonly phase: string;
      readonly message: string;
      readonly summary: string;
      readonly expected: string;
      readonly observed: string;
      readonly batchId?: string;
      readonly eventId?: string;
      readonly operationId?: string;
      readonly operationGeneration?: number;
      readonly scopeCorrelationId?: string;
      readonly rollbackResult?: SynaraHistoryDiagnostic["rollbackResult"];
    },
  ): Omit<SynaraHistoryDiagnostic, "schema"> {
    const identity = this.identity();
    return {
      owner,
      code,
      severity: fields.severity,
      recoverability: fields.recoverability,
      acApplicability: fields.acApplicability,
      phase: fields.phase,
      scenario: this.options.scenario,
      message: fields.message,
      summary: fields.summary,
      packageVersion: "0.18.1",
      browser: this.options.browser ?? "stable-chromium",
      platform: this.options.platform ?? "gate-harness",
      canvasIdentity: identity.canvasIdentity,
      mountIdentity: identity.mountIdentity,
      apiIdentity: identity.apiIdentity,
      sessionEpoch: identity.sessionEpoch,
      routeEpoch: this.routeEpoch,
      mutationRevision: this.mutationRevision,
      ...(fields.operationId !== undefined ? { operationId: fields.operationId } : {}),
      ...(fields.operationGeneration !== undefined
        ? { operationGeneration: fields.operationGeneration }
        : {}),
      ...(fields.scopeCorrelationId !== undefined
        ? { scopeCorrelationId: fields.scopeCorrelationId }
        : {}),
      ...(fields.batchId !== undefined ? { batchId: fields.batchId } : {}),
      ...(fields.eventId !== undefined ? { eventId: fields.eventId } : {}),
      expected: fields.expected,
      observed: fields.observed,
      lockState: this.lockState,
      ...(fields.rollbackResult !== undefined ? { rollbackResult: fields.rollbackResult } : {}),
      timestamp: Date.now(),
    };
  }

  /**
   * Begin a fake AI operation: deep-capture pre-state before any progress and
   * open the edit lock plus the single mutation-capable synthetic scope.
   */
  public beginAiOperation(input: {
    readonly batchId: string;
    readonly operationId: string;
    readonly operationGeneration: number;
  }): void {
    if (this.activeBatch !== null) {
      this.report(
        this.baseDiagnostic("coordinator", "operation-not-applicable", {
          severity: "error",
          recoverability: "none",
          acApplicability: "AC2",
          phase: "ai-batch-begin",
          message: "an AI batch is already active",
          summary: "AI batch begin rejected: another batch is active",
          expected: "no AI batch is active before accepting a new batch",
          observed: `batch ${this.activeBatch.batchId} is active`,
          batchId: input.batchId,
          operationId: input.operationId,
          operationGeneration: input.operationGeneration,
        }),
      );
      throw new Error("an AI batch is already active");
    }
    if (this.lockState === "locked-fault") {
      this.report(
        this.baseDiagnostic("coordinator", "session-locked", {
          severity: "critical",
          recoverability: "locked",
          acApplicability: "AC8",
          phase: "ai-batch-begin",
          message: "editing is locked by an unrecoverable fault",
          summary: "AI batch begin rejected: session is locked",
          expected: "the session is not in a locked-fault state",
          observed: "locked-fault",
        }),
      );
      throw new Error("session is locked");
    }
    const before = captureDocumentSnapshot(this.host.captureScene());
    const scope = this.host.openSyntheticWriteScope({
      purpose: "ai-batch-progress",
      operationId: input.operationId,
      operationGeneration: input.operationGeneration,
      sessionEpoch: this.sessionEpoch,
      routeEpoch: this.routeEpoch,
    });
    this.host.setViewModeEnabled(true);
    this.lockState = "ai-batch";
    this.activeBatch = {
      batchId: input.batchId,
      operationId: input.operationId,
      operationGeneration: input.operationGeneration,
      before,
      beforeRevision: this.mutationRevision,
      creationRouteEpoch: this.routeEpoch,
      acceptedSyntheticWriteCount: 0,
      nextLocalSequence: 1,
      scope,
    };
  }

  /**
   * Ordered progress: `captureUpdate: "NEVER"` through the host updateScene,
   * issued inside the synthetic scope so every write is registered,
   * sequenced, and acknowledged before finalize.
   */
  public applyAiProgress(input: {
    readonly batchId: string;
    readonly operationLocalSequence: number;
    readonly update: SynaraSceneInput;
  }): { readonly adapterGlobalSyntheticSequence: number; readonly correlationId: string } {
    const batch = this.requireBatch(input.batchId);
    if (batch.scope === null) throw new Error("AI batch has no open synthetic scope");
    const receipt = batch.scope.issue({
      operationLocalSequence: input.operationLocalSequence,
      apply: () => {
        this.host.updateScene(input.update);
      },
    });
    batch.acceptedSyntheticWriteCount += 1;
    this.mutationRevision += 1;
    return receipt;
  }

  /**
   * Finalize the completed batch: verify canonically, drain/close the scope,
   * clear native history through the public boundary, observe the bounded
   * post-clear drain, and only then expose one event and unlock.
   */
  public async completeAiOperation(batchId: string): Promise<SynaraAiHistoryEvent | null> {
    const batch = this.requireBatch(batchId);
    if (batch.scope === null) throw new Error("AI batch has no open synthetic scope");
    const after = captureDocumentSnapshot(this.host.captureScene());
    if (
      batch.acceptedSyntheticWriteCount === 0 ||
      documentSnapshotsEqual(batch.before, after)
    ) {
      await batch.scope.drain();
      await batch.scope.close();
      this.activeBatch = null;
      this.lockState = "unlocked";
      this.host.setViewModeEnabled(false);
      return null;
    }
    await batch.scope.drain();
    await batch.scope.close();
    this.host.clearNativeHistory();
    await this.postClearDrain();
    const event = this.appendEvent(batch, after, "completed");
    this.activeBatch = null;
    this.routeEpoch += 1;
    this.lockState = "unlocked";
    this.host.setViewModeEnabled(false);
    return event;
  }

  private async postClearDrain(): Promise<void> {
    const before = this.host.observeHostBoundary().adapterCallbackSequence;
    await settlementDrainWindow({
      maxWaitMs: this.options.settlementMaxWaitMs ?? 500,
      onNewCallback: () => this.host.observeHostBoundary().adapterCallbackSequence !== before,
    });
  }

  private appendEvent(
    batch: ActiveAiBatch,
    after: SynaraDocumentSnapshot,
    outcome: SynaraAiHistoryEvent["outcome"],
  ): SynaraAiHistoryEvent {
    const identity = this.identity();
    const event: SynaraAiHistoryEvent = {
      id: `ai-event-${++this.eventCounter}`,
      provenance: {
        canvasIdentity: identity.canvasIdentity,
        mountIdentity: identity.mountIdentity,
        apiIdentity: identity.apiIdentity,
        sessionEpoch: identity.sessionEpoch,
        creationRouteEpoch: batch.creationRouteEpoch,
        operationId: batch.operationId,
        operationGeneration: batch.operationGeneration,
        beforeRevision: batch.beforeRevision,
        afterRevision: this.mutationRevision,
      },
      outcome,
      batchId: batch.batchId,
      acceptedSyntheticWriteCount: batch.acceptedSyntheticWriteCount,
      before: batch.before,
      after,
    };
    // A new mutated AI batch after Undo deletes only the AI Redo branch.
    this.events = [...this.events.slice(0, this.cursor), event].slice(-MAX_RETAINED_AI_EVENTS);
    this.cursor = this.events.length;
    return event;
  }

  /** Current command applicability for Undo, evaluated from live state. */
  public canUndoAiBatch(): boolean {
    return (
      this.lockState === "unlocked" &&
      !this.humanInvalidated &&
      this.cursor > 0 &&
      this.cursor <= this.events.length
    );
  }

  /** Current command applicability for Redo, evaluated from live state. */
  public canRedoAiBatch(): boolean {
    return (
      this.lockState === "unlocked" &&
      !this.humanInvalidated &&
      this.cursor >= 0 &&
      this.cursor < this.events.length
    );
  }

  private recordTrace(command: "undo-ai-batch" | "redo-ai-batch", eventId: string): {
    readonly push: (step: SynaraAiCommandTraceStep) => void;
    readonly finish: () => void;
  } {
    const steps: SynaraAiCommandTraceStep[] = [];
    return {
      push: (step) => {
        steps.push(step);
      },
      finish: () => {
        this.traces.push({ command, eventId, steps: Object.freeze([...steps]) });
      },
    };
  }

  /**
   * Explicit AI Undo. Never dispatches native Undo/Redo. Restores the exact
   * canonical pre-state with command-start viewport/zoom preserved, verifies
   * before moving the cursor, invokes the public native clear at the required
   * point, and exposes/unlocks only after the bounded post-clear drain.
   */
  public async undoAiBatch(): Promise<boolean> {
    return this.restoreCommand("undo-ai-batch");
  }

  /** Explicit AI Redo with the same ordered lifecycle as Undo. */
  public async redoAiBatch(): Promise<boolean> {
    return this.restoreCommand("redo-ai-batch");
  }

  private async restoreCommand(command: "undo-ai-batch" | "redo-ai-batch"): Promise<boolean> {
    if (this.lockState !== "unlocked" || this.activeBatch !== null) {
      this.report(
        this.baseDiagnostic("coordinator", "cursor-not-actionable", {
          severity: "warning",
          recoverability: "retryable",
          acApplicability: "AC3",
          phase: command,
          message: "AI command is unavailable while a batch or restore is active",
          summary: `${command} rejected: session busy or locked`,
          expected: "unlocked session with no active batch",
          observed: `lockState=${this.lockState}`,
        }),
      );
      return false;
    }
    if (this.humanInvalidated) {
      this.report(
        this.baseDiagnostic("coordinator", "ai-history-cleared-by-human", {
          severity: "info",
          recoverability: "none",
          acApplicability: "AC4",
          phase: command,
          message: "AI history was cleared by a settled semantic human mutation",
          summary: `${command} inert: AI history cleared by manual editing`,
          expected: "AI history still actionable",
          observed: "human mutation invalidated all AI events",
        }),
      );
      return false;
    }
    const event =
      command === "undo-ai-batch" ? this.events[this.cursor - 1] : this.events[this.cursor];
    if (event === undefined) {
      this.report(
        this.baseDiagnostic("coordinator", "cursor-not-actionable", {
          severity: "info",
          recoverability: "none",
          acApplicability: "AC3",
          phase: command,
          message: "no AI event is selected by the current cursor",
          summary: `${command} inert: cursor selects no event`,
          expected: "a cursor-selected AI event",
          observed: `cursor=${this.cursor}, events=${this.events.length}`,
        }),
      );
      return false;
    }
    const target =
      command === "undo-ai-batch" ? event.before : event.after;
    const commandStartSnapshot = captureDocumentSnapshot(this.host.captureScene());
    const commandStartViewport = this.host.captureViewport();
    const trace = this.recordTrace(command, event.id);
    this.lockState = "restore";
    const scope = this.host.openSyntheticWriteScope({
      purpose: command === "undo-ai-batch" ? "ai-undo" : "ai-redo",
      operationId: event.provenance.operationId,
      operationGeneration: event.provenance.operationGeneration,
      sessionEpoch: this.sessionEpoch,
      routeEpoch: this.routeEpoch,
    });
    try {
      trace.push("restore-write-issued");
      scope.issue({
        operationLocalSequence: 1,
        apply: () => {
          this.host.restoreScene(toSceneSnapshot(target));
        },
      });
      await scope.drain();
      trace.push("restore-callback-acknowledged");
      const verified = captureDocumentSnapshot(this.host.captureScene());
      if (!documentSnapshotsEqual(target, verified)) {
        this.report(
          this.baseDiagnostic("coordinator", "semantic-verification-mismatch", {
            severity: "critical",
            recoverability: "locked",
            acApplicability: "AC3",
            phase: command,
            message: "restored scene did not verify against the canonical target",
            summary: `${command} failed verification; editing locked`,
            expected: target.semanticFingerprint,
            observed: verified.semanticFingerprint,
            eventId: event.id,
          }),
        );
        // Smallest Gate-safe command-start restoration.
        this.host.restoreScene(toSceneSnapshot(commandStartSnapshot));
        this.host.restoreViewport(commandStartViewport);
        trace.push("restore-target-verified");
        this.lockState = "locked-fault";
        trace.finish();
        return false;
      }
      trace.push("restore-target-verified");
      this.host.restoreViewport(commandStartViewport);
      trace.push("native-history-clear-invoked");
      this.host.clearNativeHistory();
      trace.push("native-history-clear-returned");
      await this.postClearDrain();
      trace.push("post-clear-drain-complete");
      this.cursor += command === "undo-ai-batch" ? -1 : 1;
      trace.push("cursor-moved");
      this.mutationRevision += 1;
      this.routeEpoch += 1;
      trace.push("result-exposed");
      this.lockState = "unlocked";
      trace.push("lock-released");
      trace.finish();
      return true;
    } finally {
      await scope.close().catch(() => undefined);
    }
  }

  /**
   * Feed one public settlement observation. Returns the settlement result
   * when a family settles through the drain decision.
   */
  public observeSettlementInput(input: SynaraSettlementInput): SynaraSettlementResult | null {
    return this.settlementObserver.observe(input);
  }

  /**
   * Settle any open human family after the common drain window. A changed
   * projection clears all AI history exactly once; a proven no-op preserves
   * it; uncertainty invalidates conservatively and marks the family unproven.
   */
  public async settleHumanMutation(): Promise<SynaraSettlementResult> {
    const endSnapshot = captureDocumentSnapshot(this.host.captureScene());
    const result = settleFamily(this.settlementObserver, endSnapshot);
    this.settlements.push(result);
    if (result.settled === "changed") {
      this.clearAiHistory("human-mutation");
    } else if (result.settled === "uncertain") {
      this.report(
        this.baseDiagnostic("coordinator", "human-settlement-uncertain", {
          severity: "warning",
          recoverability: "none",
          acApplicability: "AC4",
          phase: "human-settlement",
          message: `settlement family ${result.family} could not be established safely`,
          summary: `human settlement uncertain for ${result.family}; AI history invalidated conservatively`,
          expected: "a reliable changed/no-op settlement",
          observed: result.reason,
        }),
      );
      this.clearAiHistory("settlement-uncertain");
    }
    return result;
  }

  private clearAiHistory(reason: string): void {
    if (this.events.length === 0 && this.cursor === 0 && !this.humanInvalidated) return;
    this.events = [];
    this.cursor = 0;
    this.humanInvalidated = true;
    this.routeEpoch += 1;
    this.mutationRevision += 1;
    void reason;
  }

  public isHumanInvalidated(): boolean {
    return this.humanInvalidated;
  }

  private requireBatch(batchId: string): ActiveAiBatch {
    if (this.activeBatch === null || this.activeBatch.batchId !== batchId) {
      this.report(
        this.baseDiagnostic("coordinator", "operation-not-applicable", {
          severity: "error",
          recoverability: "none",
          acApplicability: "AC2",
          phase: "ai-batch",
          message: "no matching active AI batch",
          summary: "AI batch operation rejected: batch not active",
          expected: `active batch ${batchId}`,
          observed: this.activeBatch === null ? "no active batch" : `active batch ${this.activeBatch.batchId}`,
          batchId,
        }),
      );
      throw new Error(`batch ${batchId} is not active`);
    }
    return this.activeBatch;
  }
}
