import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => null,
  exportToBlob: vi.fn(),
  exportToSvg: vi.fn(),
  restore: (scene: unknown) => scene,
  serializeAsJSON: vi.fn(),
}));

import {
  SynaraSyntheticScopeRegistry,
  type SynaraSceneInput,
  type SynaraSceneSnapshot,
  type SynaraSyntheticScopeContext,
  type SynaraSyntheticTraceEntry,
  type SynaraViewport,
} from "../ticket01/SynaraExcalidrawAdapter";
import { SynaraAiHistoryCoordinator, type SynaraAiHistoryHost } from "./SynaraAiHistoryCoordinator";
import {
  captureDocumentSnapshot,
  documentSnapshotsEqual,
  semanticFingerprint,
} from "./SynaraDocumentSnapshot";
import { createSettlementObserver, settleFamily } from "./SynaraHumanMutationSettlement";

function element(progress = 0) {
  return {
    id: "shape",
    type: "rectangle",
    x: progress * 10,
    y: 20,
    width: 100,
    height: 60,
    customData: { progress, nested: { retained: true } },
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

function progressUpdate(progress: number): SynaraSceneInput {
  return { elements: [element(progress)], files: {} };
}

describe("Ticket 02 deep canonical document snapshot", () => {
  it("deep-owns semantic content and excludes presentation/transient package state", () => {
    const source = scene();
    const snapshot = captureDocumentSnapshot(source);
    (source.elements[0]!.customData as { nested: { retained: boolean } }).nested.retained = false;
    (source.viewport as { scrollX: number }).scrollX = 999;
    (source.selectedElementIds as string[]).push("other");

    expect(
      (
        (snapshot.elements[0] as Record<string, unknown>).customData as {
          nested: { retained: boolean };
        }
      ).nested.retained,
    ).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.elements)).toBe(true);
    expect(snapshot.semanticFingerprint).toBe(
      captureDocumentSnapshot({ ...scene(), viewport: { scrollX: -20, scrollY: 30, zoom: 2 } })
        .semanticFingerprint,
    );
  });

  it("uses the file-map key for canonical active reference metadata", () => {
    const snapshot = captureDocumentSnapshot({
      ...scene(),
      elements: [{ ...element(), type: "image", fileId: "file-key" }],
      files: { "file-key": { id: "stale-id", mimeType: "image/png", created: 7 } },
    });
    expect(snapshot.activeFileReferences).toEqual([
      { fileId: "file-key", mimeType: "image/png", created: 7 },
    ]);
    expect(snapshot.semanticFingerprint).toContain("file-key");
  });
});

describe("Ticket 02 adapter-owned opaque synthetic scope", () => {
  const identity = {
    mountIdentity: "mount-1",
    apiIdentity: "api-1",
    canvasIdentity: "canvas-1",
    sessionEpoch: 1,
    routeEpoch: 1,
    mutationRevision: 0,
  };
  const context: SynaraSyntheticScopeContext = {
    purpose: "ai-batch-progress",
    operationId: "operation-1",
    operationGeneration: 1,
    canvasIdentity: "canvas-1",
    mountIdentity: "mount-1",
    apiIdentity: "api-1",
    sessionEpoch: 1,
    routeEpoch: 1,
    expectedBeforeRevision: 0,
  };
  let locked = true;
  let syntheticSequence: { current: number };
  let callbackSequence: { current: number };
  let diagnostics: string[];
  let traces: SynaraSyntheticTraceEntry[];
  let registry: SynaraSyntheticScopeRegistry;
  let horizonMs: number;

  beforeEach(() => {
    locked = true;
    syntheticSequence = { current: 0 };
    callbackSequence = { current: 0 };
    diagnostics = [];
    traces = [];
    horizonMs = 100;
    registry = new SynaraSyntheticScopeRegistry(
      syntheticSequence,
      callbackSequence,
      (code) => diagnostics.push(code),
      () => horizonMs,
      () => identity,
      () => locked,
      (entry) => traces.push(entry),
    );
  });

  it("registers before write, acknowledges the exact callback, drains, closes, and tombstones", async () => {
    const scope = registry.open(context);
    let registeredBeforeApply = false;
    const receipt = scope.issue({
      operationLocalSequence: 1,
      expectedBeforeRevision: 0,
      targetProjection: "target",
      apply: () => {
        registeredBeforeApply = traces.some((entry) => entry.kind === "write-issued");
        callbackSequence.current = 1;
        expect(registry.associate(1, "target")).toMatchObject({ kind: "correlated" });
      },
    });
    await receipt.acknowledgement;
    await scope.drain();
    const closing = scope.close();
    await Promise.resolve();
    expect(registeredBeforeApply).toBe(true);
    expect(syntheticSequence.current).toBe(1);
    expect(registry.tombstoneCount).toBe(1);
    locked = false;
    expect(registry.associate(2, "delayed-target")).toMatchObject({
      kind: "duplicate-after-close",
    });
    await closing;
    horizonMs = 0;
    expect(registry.associate(3, "delayed-target")).toMatchObject({
      kind: "rejected",
      code: "unknown-callback-provenance",
    });
    registry.observePublicHumanActivity();
    expect(registry.associate(3, "human")).toEqual({ kind: "human-or-unknown" });
  });

  it("requires the supported lock before opening a mutation-capable scope", () => {
    locked = false;
    expect(() => registry.open(context)).toThrow("requires the supported edit/history lock");
    expect(diagnostics).toContain("synthetic-scope-unresolved");
    expect(registry.isOpen).toBe(false);
  });

  it("rejects duplicate/skipped local sequence, stale fences, extra and unknown callbacks", async () => {
    const stale = { ...context, routeEpoch: 0 };
    expect(() => registry.open(stale)).toThrow("stale-route-epoch");
    expect(diagnostics).toContain("stale-route-epoch");

    const scope = registry.open(context);
    expect(() =>
      scope.issue({
        operationLocalSequence: 2,
        expectedBeforeRevision: 0,
        targetProjection: "target",
        apply: () => undefined,
      }),
    ).toThrow("expected operation-local sequence 1");
    expect(syntheticSequence.current).toBe(0);
    expect(registry.associate(1, "unexpected")).toMatchObject({
      kind: "rejected",
      code: "unknown-callback-provenance",
    });
    scope.abort("expected test cleanup");

    const nextScope = registry.open(context);
    const receipt = nextScope.issue({
      operationLocalSequence: 1,
      expectedBeforeRevision: 0,
      targetProjection: "target",
      apply: () => undefined,
    });
    expect(registry.associate(2, "target")).toMatchObject({
      kind: "rejected",
      code: "unknown-callback-provenance",
    });
    await expect(receipt.acknowledgement).rejects.toThrow("expected callback 1");
    await expect(nextScope.drain()).rejects.toThrow("expected callback 1");
    nextScope.abort("expected test cleanup");
  });

  it("cannot drain or close successfully after semantic callback verification fails", async () => {
    const scope = registry.open(context);
    const receipt = scope.issue({
      operationLocalSequence: 1,
      expectedBeforeRevision: 0,
      targetProjection: "target",
      apply: () => undefined,
    });
    expect(registry.associate(1, "wrong-target")).toMatchObject({
      kind: "rejected",
      code: "semantic-verification-mismatch",
    });
    await expect(receipt.acknowledgement).rejects.toThrow("canonical target");
    await expect(scope.drain()).rejects.toThrow("canonical target");
    await expect(scope.close()).rejects.toThrow("canonical target");
    scope.abort("expected test cleanup");
  });

  it("rechecks route and revision fences when the callback arrives", async () => {
    const currentIdentity = { ...identity };
    const callbackRegistry = new SynaraSyntheticScopeRegistry(
      { current: 0 },
      { current: 0 },
      (code) => diagnostics.push(code),
      () => 100,
      () => currentIdentity,
      () => true,
      (entry) => traces.push(entry),
    );
    const scope = callbackRegistry.open(context);
    const receipt = scope.issue({
      operationLocalSequence: 1,
      expectedBeforeRevision: 0,
      targetProjection: "target",
      apply: () => undefined,
    });
    currentIdentity.routeEpoch = 2;
    expect(callbackRegistry.associate(1, "target")).toMatchObject({
      kind: "rejected",
      code: "stale-route-epoch",
    });
    await expect(receipt.acknowledgement).rejects.toThrow("stale-route-epoch");
    await expect(scope.drain()).rejects.toThrow("stale-route-epoch");
    expect(diagnostics).toContain("stale-route-epoch");
    scope.abort("expected test cleanup");
  });

  it.each([
    ["sessionEpoch", 0, "stale-session-epoch"],
    ["routeEpoch", 0, "stale-route-epoch"],
    ["expectedBeforeRevision", 1, "stale-mutation-revision"],
    ["mountIdentity", "mount-old", "stale-mount-identity"],
  ] as const)("rejects stale %s before opening", (field, value, code) => {
    expect(() => registry.open({ ...context, [field]: value })).toThrow();
    expect(diagnostics).toContain(code);
  });
});

describe("Ticket 02 AI-only coordinator", () => {
  it("turns three progress writes into one event and performs exact AI Undo/Redo", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-exact-batch",
      settlementMaxWaitMs: 100,
    });
    const before = captureDocumentSnapshot(host.current);
    const viewport = host.captureViewport();
    await coordinator.beginAiOperation({
      batchId: "batch-1",
      operationId: "op-1",
      operationGeneration: 1,
    });
    for (const sequence of [1, 2, 3]) {
      coordinator.applyAiProgress({
        batchId: "batch-1",
        operationGeneration: 1,
        operationLocalSequence: sequence,
        update: progressUpdate(sequence),
      });
      expect(coordinator.getState().events).toHaveLength(0);
    }
    const event = await coordinator.completeAiOperation("batch-1");
    expect(event).not.toBeNull();
    expect(event?.acceptedSyntheticWriteCount).toBe(3);
    expect(coordinator.getState()).toMatchObject({ cursor: 1, lockState: "unlocked" });
    const after = captureDocumentSnapshot(host.current);
    expect(after.semanticFingerprint).not.toBe(before.semanticFingerprint);
    expect(host.nativeClearCount).toBe(1);

    expect(await coordinator.undoAiBatch()).toBe(true);
    expect(documentSnapshotsEqual(before, captureDocumentSnapshot(host.current))).toBe(true);
    expect(host.captureViewport()).toEqual(viewport);
    expect(await coordinator.redoAiBatch()).toBe(true);
    expect(documentSnapshotsEqual(after, captureDocumentSnapshot(host.current))).toBe(true);
    expect(coordinator.getState().cursor).toBe(1);
    expect(host.nativeClearCount).toBe(3);
    expect(coordinator.getTraces()).toEqual([
      {
        command: "undo-ai-batch",
        eventId: "ai-event-1",
        steps: [
          "restore-write-issued",
          "restore-callback-acknowledged",
          "restore-target-verified",
          "native-history-clear-invoked",
          "native-history-clear-returned",
          "post-clear-drain-complete",
          "cursor-moved",
          "result-exposed",
          "lock-released",
        ],
      },
      {
        command: "redo-ai-batch",
        eventId: "ai-event-1",
        steps: [
          "restore-write-issued",
          "restore-callback-acknowledged",
          "restore-target-verified",
          "native-history-clear-invoked",
          "native-history-clear-returned",
          "post-clear-drain-complete",
          "cursor-moved",
          "result-exposed",
          "lock-released",
        ],
      },
    ]);
    expect(
      host.syntheticTrace
        .filter((entry) => entry.kind === "write-issued")
        .map((entry) => entry.adapterGlobalSyntheticSequence),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects stale producer generation before writing and serializes complete diagnostics", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-stale-generation",
    });
    await coordinator.beginAiOperation({
      batchId: "batch",
      operationId: "op",
      operationGeneration: 2,
    });
    expect(() =>
      coordinator.applyAiProgress({
        batchId: "batch",
        operationGeneration: 1,
        operationLocalSequence: 1,
        update: progressUpdate(1),
      }),
    ).toThrow("stale operation generation");
    expect(host.callbackSequence).toBe(0);
    expect(coordinator.getDiagnostics()[0]).toMatchObject({
      schema: "synara.whiteboard.history-diagnostic/v1",
      owner: "coordinator",
      code: "stale-operation-generation",
      scenario: "unit-stale-generation",
      packageVersion: "0.18.1",
      canvasIdentity: "canvas-1",
      mountIdentity: "mount-1",
      apiIdentity: "api-1",
      operationId: "op",
      operationGeneration: 1,
      operationLocalSequence: 1,
      lockState: "ai-batch",
    });
  });

  it("clears AI events once for a settled human change and preserves them for presentation no-op", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-human-settlement",
      settlementMaxWaitMs: 100,
    });
    await coordinator.beginAiOperation({
      batchId: "batch",
      operationId: "op",
      operationGeneration: 1,
    });
    coordinator.applyAiProgress({
      batchId: "batch",
      operationGeneration: 1,
      operationLocalSequence: 1,
      update: progressUpdate(1),
    });
    await coordinator.completeAiOperation("batch");
    const unchanged = captureDocumentSnapshot(host.current);
    coordinator.observeSettlementInput({ kind: "presentation", snapshot: unchanged });
    expect((await coordinator.settleHumanMutation()).settled).toBe("no-op");
    expect(coordinator.getState().events).toHaveLength(1);

    coordinator.observeSettlementInput({ kind: "pointer-down", snapshot: unchanged });
    const prior = captureDocumentSnapshot(host.current);
    host.current = scene(7);
    host.callbackSequence += 1;
    coordinator.observeSettlementInput({
      kind: "semantic-callback",
      beforeSnapshot: prior,
      snapshot: captureDocumentSnapshot(host.current),
      adapterCallbackSequence: host.callbackSequence,
      callbackProvenance: "human",
    });
    coordinator.observeSettlementInput({
      kind: "pointer-up",
      snapshot: captureDocumentSnapshot(host.current),
    });
    expect((await coordinator.settleHumanMutation()).settled).toBe("changed");
    expect(coordinator.getState().events).toHaveLength(0);
    expect(coordinator.getState().cursor).toBe(0);
  });
});

describe("Ticket 02 coordinator outcome seam (WP-B2)", () => {
  it("finalizes an interrupted batch into one event with the interrupted outcome", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-finalize-interrupted",
      settlementMaxWaitMs: 50,
    });
    await coordinator.beginAiOperation({
      batchId: "batch-1",
      operationId: "op-1",
      operationGeneration: 1,
    });
    coordinator.applyAiProgress({
      batchId: "batch-1",
      operationGeneration: 1,
      operationLocalSequence: 1,
      update: progressUpdate(1),
    });
    const proof = coordinator.captureCanonicalSceneProof();
    expect(proof).toMatchObject({ mutationRevision: 1 });
    expect(proof.semanticFingerprint).toBe(captureDocumentSnapshot(host.current).semanticFingerprint);

    const event = await coordinator.finalizeAiOperation({ batchId: "batch-1", outcome: "interrupted" });
    expect(event).not.toBeNull();
    expect(event?.outcome).toBe("interrupted");
    expect(coordinator.getState().events).toHaveLength(1);
    expect(coordinator.getState().cursor).toBe(1);
    expect(coordinator.getState().lockState).toBe("unlocked");
    expect(host.nativeClearCount).toBe(1);
    // The interrupted event is a first-class history event: undo/redo apply.
    expect(await coordinator.undoAiBatch()).toBe(true);
    expect(coordinator.getState().cursor).toBe(0);
    expect(await coordinator.redoAiBatch()).toBe(true);
    expect(coordinator.getState().cursor).toBe(1);
  });

  it("finalizes a failed-partial batch into one event without unlocking early", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-finalize-failed-partial",
      settlementMaxWaitMs: 50,
    });
    await coordinator.beginAiOperation({
      batchId: "batch-2",
      operationId: "op-2",
      operationGeneration: 1,
    });
    expect(coordinator.getActiveAiBatch()).toMatchObject({
      batchId: "batch-2",
      operationId: "op-2",
      operationGeneration: 1,
    });
    coordinator.applyAiProgress({
      batchId: "batch-2",
      operationGeneration: 1,
      operationLocalSequence: 1,
      update: progressUpdate(2),
    });
    const event = await coordinator.finalizeAiOperation({ batchId: "batch-2", outcome: "failed-partial" });
    expect(event?.outcome).toBe("failed-partial");
    expect(coordinator.getActiveAiBatch()).toBeNull();
    expect(coordinator.getState().events[0]).toMatchObject({ outcome: "failed-partial" });
  });

  it("aborts a zero-valid batch without event, clear, or cursor movement", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-zero-valid-abort",
      settlementMaxWaitMs: 50,
    });
    await coordinator.beginAiOperation({
      batchId: "batch-3",
      operationId: "op-3",
      operationGeneration: 1,
    });
    coordinator.abortAiOperationForZeroValid({
      batchId: "batch-3",
      reason: "server terminal outcome zero-valid",
    });
    const state = coordinator.getState();
    expect(state.events).toHaveLength(0);
    expect(state.cursor).toBe(0);
    expect(state.lockState).toBe("unlocked");
    expect(host.nativeClearCount).toBe(0);
    expect(host.viewModeEnabled).toBe(false);
    expect(coordinator.getDiagnostics()[0]).toMatchObject({
      code: "operation-not-applicable",
      phase: "zero-valid-settlement",
      severity: "warning",
    });
  });

  it("protects a lost active operation session without event, unlock, or clear", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-session-loss-protection",
      settlementMaxWaitMs: 50,
    });
    await coordinator.beginAiOperation({
      batchId: "batch-4",
      operationId: "op-4",
      operationGeneration: 1,
    });
    coordinator.protectAiOperationOnSessionLoss({ reason: "stream failed while active" });
    const state = coordinator.getState();
    expect(state.events).toHaveLength(0);
    expect(state.cursor).toBe(0);
    expect(state.lockState).toBe("locked-fault");
    expect(host.viewModeEnabled).toBe(true);
    expect(host.nativeClearCount).toBe(0);
    expect(coordinator.getDiagnostics()[0]).toMatchObject({
      code: "operation-session-lost",
      recoverability: "reset-required",
      severity: "critical",
      batchId: "batch-4",
    });
  });

  it("keeps completeAiOperation behavior as the completed-outcome settlement", async () => {
    const host = new FakeGateHost();
    const coordinator = new SynaraAiHistoryCoordinator(host, {
      canvasIdentity: "canvas-1",
      scenario: "unit-complete-delegates",
      settlementMaxWaitMs: 50,
    });
    await coordinator.beginAiOperation({
      batchId: "batch-5",
      operationId: "op-5",
      operationGeneration: 1,
    });
    coordinator.applyAiProgress({
      batchId: "batch-5",
      operationGeneration: 1,
      operationLocalSequence: 1,
      update: progressUpdate(1),
    });
    const event = await coordinator.completeAiOperation("batch-5");
    expect(event?.outcome).toBe("completed");
    expect(coordinator.getState().events).toHaveLength(1);
  });
});

describe("Ticket 02 human settlement families", () => {
  it.each([
    ["pointer-gesture", "pointer-down", "pointer-up"],
    ["discrete-keyboard-mutation", "keyboard-candidate", "keyboard-keyup"],
    ["text-edit-composition", "text-edit-active", "text-edit-inactive"],
  ] as const)("settles %s exactly once", (family, startKind, endKind) => {
    const observer = createSettlementObserver({ maxWaitMs: 500 });
    const before = captureDocumentSnapshot(scene());
    const after = captureDocumentSnapshot(scene(1));
    observer.observe({ kind: startKind, key: "Delete", snapshot: before });
    observer.observe({
      kind: "semantic-callback",
      snapshot: after,
      beforeSnapshot: before,
      adapterCallbackSequence: 1,
      callbackProvenance: "human",
    });
    observer.observe({ kind: endKind, key: "Delete", snapshot: after });
    expect(settleFamily(observer, after)).toMatchObject({ family, settled: "changed" });
    expect(settleFamily(observer, after)).toMatchObject({
      family: "presentation-no-op",
      settled: "no-op",
    });
  });

  it("marks missing termination and unknown callback provenance uncertain", () => {
    const before = captureDocumentSnapshot(scene());
    const observer = createSettlementObserver();
    observer.observe({ kind: "pointer-down", snapshot: before });
    expect(settleFamily(observer, before)).toMatchObject({
      settled: "uncertain",
      uncertaintyCode: "human-settlement-uncertain",
    });

    const unknown = createSettlementObserver();
    expect(
      unknown.observe({
        kind: "semantic-callback",
        snapshot: before,
        callbackProvenance: "unknown",
      }),
    ).toMatchObject({ settled: "uncertain" });
  });
});
