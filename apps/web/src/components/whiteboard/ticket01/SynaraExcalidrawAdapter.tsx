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

export type SynaraDiagnosticAc = "AC1" | "AC2" | "AC3" | "AC4" | "AC5" | "AC6" | "AC8" | "AC10";

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

/**
 * Adapter-owned opaque synthetic write scope (Ticket 02 plan §4.2). The
 * coordinator receives only this opaque handle and a stable diagnostic
 * correlation ID — never a forgeable provenance token.
 */
export interface SynaraSyntheticWriteScopeHandle {
  readonly issue: (input: {
    readonly operationLocalSequence: number;
    readonly expectedBeforeRevision: number;
    readonly targetProjection: string;
    readonly apply: () => void;
    readonly onAcknowledged?: () => void;
  }) => {
    readonly adapterGlobalSyntheticSequence: number;
    readonly correlationId: string;
    readonly acknowledgement: Promise<void>;
  };
  readonly drain: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly abort: (reason: string) => void;
}

export interface SynaraSyntheticTraceEntry {
  readonly kind:
    | "scope-opened"
    | "write-issued"
    | "callback-acknowledged"
    | "scope-drained"
    | "scope-closed"
    | "scope-aborted"
    | "callback-rejected";
  readonly scopeCorrelationId: string;
  readonly operationLocalSequence?: number;
  readonly adapterGlobalSyntheticSequence?: number;
  readonly adapterCallbackSequence?: number;
  readonly sessionEpoch: number;
  readonly routeEpoch: number;
  readonly mutationRevision: number;
  readonly reason?: string;
}

/** Public host observation consumed by human settlement (plan §5.1). */
export interface SynaraHostBoundaryObservation {
  readonly adapterCallbackSequence: number;
  readonly scopeActive: boolean;
  readonly tombstoneCount: number;
  readonly editingTextActive: boolean;
}

export interface SynaraSceneObservation {
  readonly snapshot: SynaraSceneSnapshot;
  readonly adapterCallbackSequence: number;
  readonly provenance: "synthetic" | "human" | "presentation" | "rejected";
  readonly correlationId?: string;
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
  readonly observeHostBoundary: () => SynaraHostBoundaryObservation;
  readonly getSyntheticTrace: () => readonly SynaraSyntheticTraceEntry[];
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
   * Ticket 02 human-settlement observation (plan §5.1). The adapter forwards
   * package public pointer observations; it never calls preventDefault,
   * stopPropagation, or dispatches history.
   */
  readonly onPointerActivity?: (kind: "pointer-down" | "pointer-up" | "pointer-cancel") => void;
  readonly onKeyboardActivity?: (
    kind: "key-down" | "key-up",
    key: string,
    primaryModifier: boolean,
    shiftKey: boolean,
  ) => void;
  readonly onCompositionActivity?: (
    kind: "composition-start" | "composition-update" | "composition-end",
  ) => void;
  readonly onFocusActivity?: (kind: "focus" | "blur") => void;
  readonly onPresentationActivity?: (kind: "selection" | "viewport" | "tool") => void;
  readonly projectSceneForSyntheticWrite?: (snapshot: SynaraSceneSnapshot) => string;
  readonly getSyntheticFenceContext?: () => {
    readonly canvasIdentity: string;
    readonly sessionEpoch: number;
    readonly routeEpoch: number;
    readonly mutationRevision: number;
  };
  /** Fail-closed notification for an uncorrelatable callback inside a scope. */
  readonly onUncorrelatableCallback?: () => void;
  /** Test-policy injection for the bounded synthetic drain/tombstone window. */
  readonly syntheticDrainWindowMs?: number;
  readonly onSceneObservation?: (observation: SynaraSceneObservation) => void;
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
  ].toSorted();
}

function publicPresentationSignature(appState: PackageAppState): string {
  return JSON.stringify({
    activeTool: appState.activeTool?.type ?? null,
    editingTextElementId: appState.editingTextElement?.id ?? null,
    selectedElementIds: readSelectedIds(appState),
    viewModeEnabled: appState.viewModeEnabled,
    viewport: readViewport(appState),
  });
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

type AdapterSyntheticCallback =
  | { readonly kind: "correlated"; readonly correlationId: string }
  | { readonly kind: "duplicate-after-close"; readonly correlationId: string }
  | { readonly kind: "rejected"; readonly code: string; readonly reason: string }
  | { readonly kind: "human-or-unknown" };

export interface SynaraSyntheticScopeContext {
  readonly purpose: "ai-batch-progress" | "ai-batch-finalize" | "ai-undo" | "ai-redo" | "rollback";
  readonly canvasIdentity: string;
  readonly mountIdentity: string;
  readonly apiIdentity: string;
  readonly operationId: string;
  readonly operationGeneration: number;
  readonly sessionEpoch: number;
  readonly routeEpoch: number;
  readonly expectedBeforeRevision: number;
}

interface AdapterPendingWriteRecord {
  readonly correlationId: string;
  readonly scopeId: number;
  readonly operationLocalSequence: number;
  readonly adapterGlobalSyntheticSequence: number;
  readonly expectedCallbackSequence: number;
  readonly expectedBeforeRevision: number;
  readonly targetProjection: string;
  readonly context: SynaraSyntheticScopeContext;
  readonly acknowledgement: Promise<void>;
  readonly settle: () => void;
  readonly failWith: (reason: Error) => void;
  readonly onAcknowledged?: () => void;
}

interface AdapterClosedScope {
  readonly correlationId: string;
  readonly records: readonly AdapterPendingWriteRecord[];
  readonly closedAt: number;
}

/**
 * Adapter-owned synthetic provenance registry (plan \u00a74.2). Correlation is
 * by adapter-owned invocation order (FIFO over registered pending records),
 * the callback sequence window, and scope state \u2014 never by fingerprint
 * equality. The coordinator sees only the opaque scope handle and stable
 * correlation IDs, never a forgeable provenance token.
 */
export class SynaraSyntheticScopeRegistry {
  private readonly pending: AdapterPendingWriteRecord[] = [];
  private readonly acknowledged: AdapterPendingWriteRecord[] = [];
  private readonly closedScopes: AdapterClosedScope[] = [];
  private openScopeCorrelationId: string | null = null;
  private openScopeContext: SynaraSyntheticScopeContext | null = null;
  private nextLocalSequence = 1;
  private nextScopeSequence = 0;
  private drained = false;
  private failedScopeReason: Error | null = null;
  private applyingIssuedWrite = false;
  private lastClosedScopeAt = Number.NEGATIVE_INFINITY;
  private lastPublicHumanActivityAt = Number.NEGATIVE_INFINITY;

  public constructor(
    private readonly syntheticSequenceRef: { current: number },
    private readonly callbackSequenceRef: { current: number },
    private readonly emitDiagnostic: (code: string, expected: string, observed: string) => void,
    private readonly boundedWindowMs: () => number,
    private readonly currentIdentity: () => {
      readonly mountIdentity: string;
      readonly apiIdentity: string;
      readonly canvasIdentity?: string;
      readonly sessionEpoch?: number;
      readonly routeEpoch?: number;
      readonly mutationRevision?: number;
    },
    private readonly isSyntheticLockHeld: () => boolean,
    private readonly trace: (entry: SynaraSyntheticTraceEntry) => void,
  ) {}

  public open(context: SynaraSyntheticScopeContext): SynaraSyntheticWriteScopeHandle {
    if (this.openScopeCorrelationId !== null) {
      throw new Error("only one mutation-capable synthetic scope may be open at a time");
    }
    if (!this.isSyntheticLockHeld()) {
      this.emitDiagnostic(
        "synthetic-scope-unresolved",
        "a supported edit/history lock before opening a mutation-capable synthetic scope",
        "synthetic lock is not held",
      );
      throw new Error("synthetic scope requires the supported edit/history lock");
    }
    const identity = this.currentIdentity();
    if (
      context.mountIdentity !== identity.mountIdentity ||
      context.apiIdentity !== identity.apiIdentity
    ) {
      this.emitDiagnostic(
        "stale-mount-identity",
        `${identity.mountIdentity}/${identity.apiIdentity}`,
        `${context.mountIdentity}/${context.apiIdentity}`,
      );
      throw new Error("synthetic scope identity is stale");
    }
    const fenceChecks = [
      ["stale-session-epoch", identity.sessionEpoch, context.sessionEpoch],
      ["stale-route-epoch", identity.routeEpoch, context.routeEpoch],
      ["stale-mutation-revision", identity.mutationRevision, context.expectedBeforeRevision],
    ] as const;
    for (const [code, current, received] of fenceChecks) {
      if (current === undefined || current === received) continue;
      this.emitDiagnostic(code, String(current), String(received));
      throw new Error(`${code}: expected ${current}, received ${received}`);
    }
    if (
      identity.canvasIdentity !== undefined &&
      identity.canvasIdentity !== context.canvasIdentity
    ) {
      this.emitDiagnostic("stale-session-epoch", identity.canvasIdentity, context.canvasIdentity);
      throw new Error("synthetic scope canvas identity is stale");
    }
    const scopeCorrelationId = `scope-${++this.nextScopeSequence}`;
    this.openScopeCorrelationId = scopeCorrelationId;
    this.openScopeContext = context;
    this.nextLocalSequence = 1;
    this.drained = false;
    this.failedScopeReason = null;
    this.trace({
      kind: "scope-opened",
      scopeCorrelationId,
      sessionEpoch: context.sessionEpoch,
      routeEpoch: context.routeEpoch,
      mutationRevision: context.expectedBeforeRevision,
    });
    return {
      issue: (input) => this.issue(scopeCorrelationId, input),
      drain: () => this.drain(scopeCorrelationId),
      close: () => this.close(scopeCorrelationId),
      abort: (reason) => this.abort(scopeCorrelationId, reason),
    };
  }

  private issue(
    scopeCorrelationId: string,
    input: {
      readonly operationLocalSequence: number;
      readonly expectedBeforeRevision: number;
      readonly targetProjection: string;
      readonly apply: () => void;
      readonly onAcknowledged?: () => void;
    },
  ): {
    readonly adapterGlobalSyntheticSequence: number;
    readonly correlationId: string;
    readonly acknowledgement: Promise<void>;
  } {
    if (this.openScopeCorrelationId !== scopeCorrelationId || this.openScopeContext === null) {
      throw new Error("synthetic scope is not open");
    }
    if (this.drained) throw new Error("cannot issue a write after synthetic scope drain");
    if (input.operationLocalSequence !== this.nextLocalSequence) {
      this.emitDiagnostic(
        "synthetic-sequence-mismatch",
        `contiguous operation-local sequence ${this.nextLocalSequence} before any scene write`,
        `received ${input.operationLocalSequence}`,
      );
      throw new Error(
        `expected operation-local sequence ${this.nextLocalSequence}, received ${input.operationLocalSequence}`,
      );
    }
    const expectedRevision =
      this.openScopeContext.expectedBeforeRevision + input.operationLocalSequence - 1;
    if (input.expectedBeforeRevision !== expectedRevision) {
      this.emitDiagnostic(
        "stale-mutation-revision",
        `expected-before revision ${expectedRevision}`,
        `received ${input.expectedBeforeRevision}`,
      );
      throw new Error(
        `expected mutation revision ${expectedRevision}, received ${input.expectedBeforeRevision}`,
      );
    }
    this.nextLocalSequence += 1;
    this.syntheticSequenceRef.current += 1;
    const correlationId = `${scopeCorrelationId}-write-${this.syntheticSequenceRef.current}`;
    let settle!: () => void;
    let failWith!: (reason: Error) => void;
    const acknowledgement = new Promise<void>((resolve, reject) => {
      settle = resolve;
      failWith = reject;
    });
    void acknowledgement.catch(() => undefined);
    const previousExpected = this.pending.at(-1)?.expectedCallbackSequence;
    const record: AdapterPendingWriteRecord = {
      correlationId,
      scopeId: this.nextScopeSequence,
      operationLocalSequence: input.operationLocalSequence,
      adapterGlobalSyntheticSequence: this.syntheticSequenceRef.current,
      expectedCallbackSequence: Math.max(
        this.callbackSequenceRef.current + 1,
        (previousExpected ?? 0) + 1,
      ),
      expectedBeforeRevision: input.expectedBeforeRevision,
      targetProjection: input.targetProjection,
      context: this.openScopeContext!,
      acknowledgement,
      settle,
      failWith,
      ...(input.onAcknowledged === undefined ? {} : { onAcknowledged: input.onAcknowledged }),
    };
    // Registration happens strictly before the public write so the arriving
    // callback is correlated by invocation order and sequence window.
    this.pending.push(record);
    this.trace({
      kind: "write-issued",
      scopeCorrelationId,
      operationLocalSequence: record.operationLocalSequence,
      adapterGlobalSyntheticSequence: record.adapterGlobalSyntheticSequence,
      sessionEpoch: record.context.sessionEpoch,
      routeEpoch: record.context.routeEpoch,
      mutationRevision: record.expectedBeforeRevision,
    });
    try {
      this.applyingIssuedWrite = true;
      input.apply();
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.failOpenScope(reason);
      throw error;
    } finally {
      this.applyingIssuedWrite = false;
    }
    return {
      adapterGlobalSyntheticSequence: this.syntheticSequenceRef.current,
      correlationId,
      acknowledgement,
    };
  }

  private removePending(correlationId: string): void {
    const index = this.pending.findIndex((record) => record.correlationId === correlationId);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private async drain(scopeCorrelationId: string): Promise<void> {
    if (this.openScopeCorrelationId !== scopeCorrelationId) {
      throw new Error("synthetic scope is not open");
    }
    if (this.drained) return;
    const deadline = Date.now() + this.boundedWindowMs();
    while (this.pending.length > 0) {
      if (this.failedScopeReason !== null) throw this.failedScopeReason;
      if (Date.now() >= deadline) {
        const unresolved = this.pending.map((record) => record.correlationId).join(", ");
        this.emitDiagnostic(
          "synthetic-scope-unresolved",
          "every issued synthetic write reaches a correlated callback within the bounded window",
          `unresolved: ${unresolved}`,
        );
        const error = new Error(`synthetic scope drain timed out: ${unresolved}`);
        this.failOpenScope(error);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (this.failedScopeReason !== null) throw this.failedScopeReason;
    const callbackAtDrain = this.callbackSequenceRef.current;
    await this.waitForTwoCallbackFreeFrames(deadline);
    if (this.callbackSequenceRef.current !== callbackAtDrain) {
      throw new Error("synthetic callback stream changed after acknowledgements drained");
    }
    this.drained = true;
    const context = this.openScopeContext!;
    this.trace({
      kind: "scope-drained",
      scopeCorrelationId,
      sessionEpoch: context.sessionEpoch,
      routeEpoch: context.routeEpoch,
      mutationRevision: context.expectedBeforeRevision + this.acknowledged.length,
    });
  }

  private async close(scopeCorrelationId: string): Promise<void> {
    await this.drain(scopeCorrelationId);
    if (this.openScopeCorrelationId !== scopeCorrelationId || this.openScopeContext === null) {
      throw new Error("synthetic scope is not open");
    }
    // Closed-scope correlation tombstones survive the delayed-callback
    // horizon so a delayed duplicate is diagnosed and rejected without being
    // reclassified as human.
    const closedAt = Date.now();
    this.closedScopes.push({
      correlationId: scopeCorrelationId,
      records: [...this.acknowledged],
      closedAt,
    });
    this.lastClosedScopeAt = closedAt;
    const context = this.openScopeContext;
    this.trace({
      kind: "scope-closed",
      scopeCorrelationId,
      sessionEpoch: context.sessionEpoch,
      routeEpoch: context.routeEpoch,
      mutationRevision: context.expectedBeforeRevision + this.acknowledged.length,
    });
    this.acknowledged.length = 0;
    this.openScopeCorrelationId = null;
    this.openScopeContext = null;
    this.failedScopeReason = null;
    // Retain the supported lock until the entire delayed-callback horizon has
    // elapsed. A changed callback in this interval is evaluated against the
    // tombstone before any later public human activity can be considered.
    const remaining = closedAt + this.boundedWindowMs() - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    this.purgeExpiredTombstones();
  }

  private abort(scopeCorrelationId: string, reason: string): void {
    if (this.openScopeCorrelationId !== scopeCorrelationId || this.openScopeContext === null) {
      return;
    }
    for (const record of Array.from(this.pending)) {
      this.emitDiagnostic(
        "synthetic-scope-unresolved",
        "abort invalidates unissued work and reports unresolved callbacks",
        `aborted: ${reason}`,
      );
      record.failWith(new Error(`synthetic scope aborted: ${reason}`));
      this.removePending(record.correlationId);
    }
    const context = this.openScopeContext;
    this.trace({
      kind: "scope-aborted",
      scopeCorrelationId,
      sessionEpoch: context.sessionEpoch,
      routeEpoch: context.routeEpoch,
      mutationRevision: context.expectedBeforeRevision,
      reason,
    });
    this.acknowledged.length = 0;
    this.openScopeCorrelationId = null;
    this.openScopeContext = null;
    this.failedScopeReason = null;
  }

  /**
   * Correlate one callback from the monotonic stream by invocation order,
   * sequence window, and scope state. Never by fingerprint equality.
   */
  public associate(
    callbackSequence: number,
    observedProjection: string | null,
  ): AdapterSyntheticCallback {
    if (this.pending.length > 0) {
      const record = this.pending[0]!;
      if (!this.isSyntheticLockHeld()) {
        const reason = "synthetic callback arrived after the supported lock was lost";
        this.traceRejected(record, callbackSequence, reason);
        this.failOpenScope(new Error(reason));
        return { kind: "rejected", code: "unknown-callback-provenance", reason };
      }
      const identity = this.currentIdentity();
      const fenceFailure = (
        [
          [
            "stale-mount-identity",
            `${record.context.mountIdentity}/${record.context.apiIdentity}`,
            `${identity.mountIdentity}/${identity.apiIdentity}`,
          ],
          [
            "stale-session-epoch",
            String(record.context.sessionEpoch),
            String(identity.sessionEpoch),
          ],
          ["stale-route-epoch", String(record.context.routeEpoch), String(identity.routeEpoch)],
          [
            "stale-mutation-revision",
            String(record.expectedBeforeRevision),
            String(identity.mutationRevision),
          ],
        ] as const
      ).find(([, expected, observed]) => observed !== "undefined" && expected !== observed);
      if (fenceFailure !== undefined) {
        const [code, expected, observed] = fenceFailure;
        const reason = `${code}: expected ${expected}, observed ${observed}`;
        this.emitDiagnostic(code, expected, observed);
        this.traceRejected(record, callbackSequence, reason);
        this.failOpenScope(new Error(reason));
        return { kind: "rejected", code, reason };
      }
      if (
        identity.canvasIdentity !== undefined &&
        identity.canvasIdentity !== record.context.canvasIdentity
      ) {
        const reason = `stale-session-epoch: expected ${record.context.canvasIdentity}, observed ${identity.canvasIdentity}`;
        this.emitDiagnostic(
          "stale-session-epoch",
          record.context.canvasIdentity,
          identity.canvasIdentity,
        );
        this.traceRejected(record, callbackSequence, reason);
        this.failOpenScope(new Error(reason));
        return { kind: "rejected", code: "stale-session-epoch", reason };
      }
      if (callbackSequence !== record.expectedCallbackSequence) {
        const reason = `expected callback ${record.expectedCallbackSequence}, received ${callbackSequence}`;
        this.traceRejected(record, callbackSequence, reason);
        this.failOpenScope(new Error(reason));
        return { kind: "rejected", code: "unknown-callback-provenance", reason };
      }
      if (observedProjection === null || observedProjection !== record.targetProjection) {
        const reason = "correlated callback did not match the registered canonical target";
        this.traceRejected(record, callbackSequence, reason);
        this.failOpenScope(new Error(reason));
        return { kind: "rejected", code: "semantic-verification-mismatch", reason };
      }
      this.pending.shift();
      this.acknowledged.push(record);
      record.onAcknowledged?.();
      record.settle();
      this.trace({
        kind: "callback-acknowledged",
        scopeCorrelationId: this.openScopeCorrelationId!,
        operationLocalSequence: record.operationLocalSequence,
        adapterGlobalSyntheticSequence: record.adapterGlobalSyntheticSequence,
        adapterCallbackSequence: callbackSequence,
        sessionEpoch: record.context.sessionEpoch,
        routeEpoch: record.context.routeEpoch,
        mutationRevision: record.expectedBeforeRevision + 1,
      });
      return { kind: "correlated", correlationId: record.correlationId };
    }
    if (this.openScopeCorrelationId !== null) {
      // An extra callback inside an open synthetic scope cannot be uniquely
      // correlated and changed content cannot be dismissed as presentation.
      const reason = "extra callback inside an open synthetic scope";
      this.failedScopeReason = new Error(reason);
      return {
        kind: "rejected",
        code: "unknown-callback-provenance",
        reason,
      };
    }
    const horizon = this.boundedWindowMs();
    const tombstone = this.closedScopes.find(
      (candidate) => Date.now() - candidate.closedAt <= horizon,
    );
    if (tombstone !== undefined && tombstone.records.length > 0) {
      return {
        kind: "duplicate-after-close",
        correlationId: tombstone.records.at(-1)!.correlationId,
      };
    }
    this.purgeExpiredTombstones();
    if (
      this.lastClosedScopeAt !== Number.NEGATIVE_INFINITY &&
      this.lastPublicHumanActivityAt <= this.lastClosedScopeAt + horizon
    ) {
      return {
        kind: "rejected",
        code: "unknown-callback-provenance",
        reason: "callback arrived after the closed-scope tombstone horizon",
      };
    }
    if (!this.isSyntheticLockHeld()) return { kind: "human-or-unknown" };
    return { kind: "human-or-unknown" };
  }

  private failOpenScope(reason: Error): void {
    this.failedScopeReason ??= reason;
    for (const record of Array.from(this.pending)) {
      record.failWith(this.failedScopeReason);
      this.removePending(record.correlationId);
    }
  }

  private traceRejected(
    record: AdapterPendingWriteRecord,
    callbackSequence: number,
    reason: string,
  ): void {
    this.trace({
      kind: "callback-rejected",
      scopeCorrelationId: this.openScopeCorrelationId!,
      operationLocalSequence: record.operationLocalSequence,
      adapterGlobalSyntheticSequence: record.adapterGlobalSyntheticSequence,
      adapterCallbackSequence: callbackSequence,
      sessionEpoch: record.context.sessionEpoch,
      routeEpoch: record.context.routeEpoch,
      mutationRevision: record.expectedBeforeRevision,
      reason,
    });
  }

  private purgeExpiredTombstones(): void {
    const horizon = this.boundedWindowMs();
    for (let index = this.closedScopes.length - 1; index >= 0; index -= 1) {
      if (Date.now() - this.closedScopes[index]!.closedAt > horizon) {
        this.closedScopes.splice(index, 1);
      }
    }
  }

  private async waitForTwoCallbackFreeFrames(deadline: number): Promise<void> {
    for (;;) {
      await Promise.resolve();
      const first = this.callbackSequenceRef.current;
      await nextAnimationFrame();
      const secondStart = this.callbackSequenceRef.current;
      await nextAnimationFrame();
      if (first === secondStart && secondStart === this.callbackSequenceRef.current) return;
      if (Date.now() >= deadline) {
        throw new Error("synthetic callback drain did not become stable within the bounded window");
      }
    }
  }

  public get isOpen(): boolean {
    return this.openScopeCorrelationId !== null;
  }

  public get expectsCallback(): boolean {
    return this.pending.length > 0;
  }

  public get isApplyingIssuedWrite(): boolean {
    return this.applyingIssuedWrite;
  }

  public observePublicHumanActivity(): void {
    this.lastPublicHumanActivityAt = Date.now();
  }

  public get tombstoneCount(): number {
    let count = 0;
    this.purgeExpiredTombstones();
    for (const tombstone of this.closedScopes) count += tombstone.records.length;
    return count;
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
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
      image.addEventListener(
        "load",
        () =>
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? resolve()
            : reject(new Error("official PNG export decoded with non-positive dimensions")),
        { once: true },
      );
      image.addEventListener(
        "error",
        () => reject(new Error("official PNG export was not browser-decodable")),
        { once: true },
      );
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
  const lastObservedSelectionKeyRef = useRef("");
  const lastObservedToolRef = useRef("");
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateSequenceRef = useRef(0);
  const adapterSyntheticSequenceRef = useRef(0);
  const adapterCallbackSequenceRef = useRef(0);
  const editingTextActiveRef = useRef(false);
  const lastSemanticProjectionRef = useRef<string | null>(null);
  const lastPresentationSignatureRef = useRef<string | null>(null);
  const lastPackageElementsRef = useRef<PackageElements | null>(null);
  const syntheticLockHeldRef = useRef(props.viewModeEnabled ?? false);
  const syntheticTraceRef = useRef<SynaraSyntheticTraceEntry[]>([]);
  const syntheticScopeRegistryRef = useRef<SynaraSyntheticScopeRegistry | null>(null);
  if (syntheticScopeRegistryRef.current === null) {
    syntheticScopeRegistryRef.current = new SynaraSyntheticScopeRegistry(
      adapterSyntheticSequenceRef,
      adapterCallbackSequenceRef,
      (code, expected, observed) => {
        report({
          code,
          ac: "AC8",
          phase: "synthetic-scope",
          expected,
          observed,
          recoverable: false,
        });
      },
      () => callbacksRef.current.syntheticDrainWindowMs ?? 500,
      () => ({
        mountIdentity: `mount-${mountId}`,
        apiIdentity: apiIdRef.current ?? "api-unready",
        ...callbacksRef.current.getSyntheticFenceContext?.(),
      }),
      () => syntheticLockHeldRef.current,
      (entry) => syntheticTraceRef.current.push(entry),
    );
  }
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
      const registry = syntheticScopeRegistryRef.current!;
      const targetProjection =
        callbacksRef.current.projectSceneForSyntheticWrite?.(snapshot) ?? null;
      if (
        syntheticLockHeldRef.current &&
        !registry.isApplyingIssuedWrite &&
        targetProjection !== null &&
        targetProjection === lastSemanticProjectionRef.current
      ) {
        report({
          code: "unknown-callback-provenance",
          ac: "AC8",
          phase: "scene-restore",
          expected: "a mutation-capable restore while locked is issued through the opaque scope",
          observed: "an unscoped same-content restore was rejected before the public write",
          recoverable: false,
        });
        callbacksRef.current.onUncorrelatableCallback?.();
        throw new Error("unscoped restore while synthetic lock is held");
      }
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
            scrollX: snapshot.viewport.scrollX,
            scrollY: snapshot.viewport.scrollY,
            zoom: { value: snapshot.viewport.zoom },
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
      syntheticLockHeldRef.current = enabled;
      setViewModeEnabled(enabled);
      requireApi({
        code: "api-not-ready",
        ac: "AC1",
        phase: "edit-lock",
        expected: "the mounted editor API is available before changing view mode",
        recoverable: true,
      });
    },
    [requireApi],
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

  const openSyntheticWriteScope = useCallback<SynaraExcalidrawHandle["openSyntheticWriteScope"]>(
    (context) => {
      requireApi({
        code: "adapter-not-ready",
        ac: "AC1",
        phase: "open-synthetic-scope",
        expected: "the mounted editor API is available before opening a synthetic scope",
        recoverable: true,
      });
      return syntheticScopeRegistryRef.current!.open(context);
    },
    [requireApi],
  );

  const observeHostBoundary = useCallback<SynaraExcalidrawHandle["observeHostBoundary"]>(
    () => ({
      adapterCallbackSequence: adapterCallbackSequenceRef.current,
      scopeActive: syntheticScopeRegistryRef.current?.isOpen ?? false,
      tombstoneCount: syntheticScopeRegistryRef.current?.tombstoneCount ?? 0,
      editingTextActive: editingTextActiveRef.current,
    }),
    [],
  );

  const getSyntheticTrace = useCallback<SynaraExcalidrawHandle["getSyntheticTrace"]>(
    () => Object.freeze([...syntheticTraceRef.current]),
    [],
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
      openSyntheticWriteScope,
      observeHostBoundary,
      getSyntheticTrace,
    }),
    [
      captureScene,
      captureViewport,
      exportPng,
      exportSvg,
      getSyntheticTrace,
      mountId,
      observeHostBoundary,
      openSyntheticWriteScope,
      restoreViewport,
      clearNativeHistory,
      restoreScene,
      serializeScene,
      setViewMode,
      updateScene,
    ],
  );

  useImperativeHandle(ref, () => handle, [handle]);

  const exposeSceneChange = useCallback(
    (snapshot: SynaraSceneSnapshot): void => {
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
    [report],
  );

  const onChange = useCallback<PackageOnChange>(
    (elements, appState, files) => {
      const snapshot = toSnapshot(elements, appState, files);
      latestSnapshotRef.current = snapshot;
      latestViewportRef.current = snapshot.viewport;
      adapterCallbackSequenceRef.current += 1;
      editingTextActiveRef.current = appState.editingTextElement !== null;
      const registry = syntheticScopeRegistryRef.current!;
      const observedProjection =
        callbacksRef.current.projectSceneForSyntheticWrite?.(snapshot) ?? null;
      const presentationSignature = publicPresentationSignature(appState);
      const packageDocumentReferencesStable =
        lastPackageElementsRef.current !== null &&
        elements.length === lastPackageElementsRef.current.length &&
        elements.every((element, index) => element === lastPackageElementsRef.current?.[index]);
      if (
        !registry.expectsCallback &&
        observedProjection !== null &&
        observedProjection === lastSemanticProjectionRef.current &&
        (presentationSignature !== lastPresentationSignatureRef.current ||
          packageDocumentReferencesStable)
      ) {
        // Content equality is used only to prove this callback is semantically
        // inert. It is not synthetic provenance and cannot acknowledge a write.
        callbacksRef.current.onSceneObservation?.({
          snapshot,
          adapterCallbackSequence: adapterCallbackSequenceRef.current,
          provenance: "presentation",
        });
        const selectionKey = snapshot.selectedElementIds.join("\u001f");
        if (selectionKey !== lastObservedSelectionKeyRef.current) {
          lastObservedSelectionKeyRef.current = selectionKey;
          callbacksRef.current.onPresentationActivity?.("selection");
        }
        const activeTool = String(appState.activeTool?.type ?? "");
        if (activeTool !== lastObservedToolRef.current) {
          lastObservedToolRef.current = activeTool;
          callbacksRef.current.onPresentationActivity?.("tool");
        }
        lastPresentationSignatureRef.current = presentationSignature;
        lastPackageElementsRef.current = elements;
        exposeSceneChange(snapshot);
        return;
      }
      const correlation = registry.associate(
        adapterCallbackSequenceRef.current,
        observedProjection,
      );
      if (correlation.kind === "correlated") {
        lastSemanticProjectionRef.current = observedProjection;
        lastPresentationSignatureRef.current = presentationSignature;
        lastPackageElementsRef.current = elements;
        // Synthetic writes are acknowledged through the scope contract and
        // are never reclassified as human input. The host still observes the
        // scene/viewport for presentation, but settlement excludes it.
        callbacksRef.current.onSceneObservation?.({
          snapshot,
          adapterCallbackSequence: adapterCallbackSequenceRef.current,
          provenance: "synthetic",
          correlationId: correlation.correlationId,
        });
        exposeSceneChange(snapshot);
        return;
      }
      if (correlation.kind === "duplicate-after-close") {
        report({
          code: "duplicate-synthetic-callback",
          ac: "AC8",
          phase: "callback-correlation",
          expected: "a delayed duplicate is diagnosed and rejected through the tombstone",
          observed: `duplicate callback for ${correlation.correlationId} after scope close`,
          recoverable: false,
        });
        syntheticLockHeldRef.current = true;
        setViewModeEnabled(true);
        callbacksRef.current.onSceneObservation?.({
          snapshot,
          adapterCallbackSequence: adapterCallbackSequenceRef.current,
          provenance: "rejected",
          correlationId: correlation.correlationId,
        });
        callbacksRef.current.onUncorrelatableCallback?.();
        return;
      }
      if (correlation.kind === "rejected") {
        report({
          code: correlation.code,
          ac: "AC8",
          phase: "callback-correlation",
          expected: "each callback inside an open synthetic scope correlates to an issued write",
          observed: `${correlation.reason}; failing closed`,
          recoverable: false,
        });
        syntheticLockHeldRef.current = true;
        setViewModeEnabled(true);
        callbacksRef.current.onSceneObservation?.({
          snapshot,
          adapterCallbackSequence: adapterCallbackSequenceRef.current,
          provenance: "rejected",
        });
        callbacksRef.current.onUncorrelatableCallback?.();
        return;
      }
      callbacksRef.current.onSceneObservation?.({
        snapshot,
        adapterCallbackSequence: adapterCallbackSequenceRef.current,
        provenance: "human",
      });
      lastSemanticProjectionRef.current = observedProjection;
      lastPresentationSignatureRef.current = presentationSignature;
      lastPackageElementsRef.current = elements;
      const selectionKey = snapshot.selectedElementIds.join("\u001f");
      if (selectionKey !== lastObservedSelectionKeyRef.current) {
        lastObservedSelectionKeyRef.current = selectionKey;
        callbacksRef.current.onPresentationActivity?.("selection");
      }
      const activeTool = String(appState.activeTool?.type ?? "");
      if (activeTool !== lastObservedToolRef.current) {
        lastObservedToolRef.current = activeTool;
        callbacksRef.current.onPresentationActivity?.("tool");
      }
      exposeSceneChange(snapshot);
    },
    [exposeSceneChange, report],
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
      lastSemanticProjectionRef.current =
        callbacksRef.current.projectSceneForSyntheticWrite?.(snapshot) ?? null;
      lastPresentationSignatureRef.current = publicPresentationSignature(api.getAppState());
      lastPackageElementsRef.current = api.getSceneElements();
    },
    [lifecycle],
  );

  const onScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      syntheticScopeRegistryRef.current?.observePublicHumanActivity();
      const viewport = { scrollX, scrollY, zoom: zoom.value } satisfies SynaraViewport;
      latestViewportRef.current = viewport;
      callbacksRef.current.onViewportChange?.(viewport);
      callbacksRef.current.onPresentationActivity?.("viewport");
    },
    [],
  );

  // Public pointer observations only (plan \u00a75.1): the adapter forwards the
  // package's own callbacks and never calls preventDefault, stopPropagation,
  // or dispatches history.
  const onPointerActivityDown = useCallback(() => {
    syntheticScopeRegistryRef.current?.observePublicHumanActivity();
    callbacksRef.current.onPointerActivity?.("pointer-down");
  }, []);

  const onPointerActivityUp = useCallback(() => {
    syntheticScopeRegistryRef.current?.observePublicHumanActivity();
    callbacksRef.current.onPointerActivity?.("pointer-up");
  }, []);

  const onPointerActivityCancel = useCallback(() => {
    syntheticScopeRegistryRef.current?.observePublicHumanActivity();
    callbacksRef.current.onPointerActivity?.("pointer-cancel");
  }, []);

  if (initialErrorRef.current) return <AdapterFailure diagnostic={initialErrorRef.current} />;

  return (
    <div
      data-ticket01-status="ready"
      data-ticket01-mount-id={mountId}
      onPointerCancelCapture={onPointerActivityCancel}
      onLostPointerCapture={onPointerActivityCancel}
      onKeyDownCapture={(event) => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onKeyboardActivity?.(
          "key-down",
          event.key,
          event.metaKey || event.ctrlKey,
          event.shiftKey,
        );
      }}
      onKeyUpCapture={(event) => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onKeyboardActivity?.(
          "key-up",
          event.key,
          event.metaKey || event.ctrlKey,
          event.shiftKey,
        );
      }}
      onCompositionStartCapture={() => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onCompositionActivity?.("composition-start");
      }}
      onCompositionUpdateCapture={() => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onCompositionActivity?.("composition-update");
      }}
      onCompositionEndCapture={() => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onCompositionActivity?.("composition-end");
      }}
      onFocusCapture={() => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onFocusActivity?.("focus");
      }}
      onBlurCapture={() => {
        syntheticScopeRegistryRef.current?.observePublicHumanActivity();
        callbacksRef.current.onFocusActivity?.("blur");
      }}
      style={{ height: "100%", minHeight: 240, minWidth: 320, width: "100%" }}
    >
      <Excalidraw
        initialData={initialDataRef.current}
        viewModeEnabled={viewModeEnabled}
        onChange={onChange}
        onScrollChange={onScrollChange}
        onPointerDown={onPointerActivityDown}
        onPointerUp={onPointerActivityUp}
        excalidrawAPI={onApiReady}
      />
    </div>
  );
});

SynaraExcalidrawAdapter.displayName = "SynaraExcalidrawAdapter";
