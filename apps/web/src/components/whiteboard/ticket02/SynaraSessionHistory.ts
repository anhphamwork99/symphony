import type { SynaraSceneInput, SynaraSceneSnapshot } from "../ticket01/SynaraExcalidrawAdapter";
import {
  captureDocumentSnapshot,
  documentSnapshotsEqual,
  type SynaraDocumentSnapshot,
} from "./SynaraDocumentSnapshot";
import type {
  SynaraHistoryCommand,
  SynaraHistoryDiagnostic,
  SynaraHistoryEvent,
  SynaraHistoryState,
  SynaraHistoryTrace,
} from "./SynaraHistoryTypes";

export interface SynaraHistoryAdapter {
  readonly captureScene: () => SynaraSceneSnapshot;
  readonly restoreScene: (snapshot: SynaraSceneSnapshot) => void;
  readonly applyProgress: (update: SynaraSceneInput & { readonly sequence: number }) => void;
}

interface ActiveBatch {
  readonly id: string;
  readonly before: SynaraDocumentSnapshot;
  readonly nextSequence: number;
  readonly acceptedUpdateCount: number;
}

export class SynaraSessionHistory {
  private events: SynaraHistoryEvent[] = [];
  private cursor = 0;
  private activeBatch: ActiveBatch | null = null;
  private eventCounter = 0;
  private diagnostics: SynaraHistoryDiagnostic[] = [];
  private traces: SynaraHistoryTrace[] = [];

  public constructor(private readonly adapter: SynaraHistoryAdapter) {
    this.trace("initial", this.adapter.captureScene());
  }

  public getState(): SynaraHistoryState {
    return {
      events: this.events.slice(),
      cursor: this.cursor,
      activeTransaction: this.activeBatch ? "ai-batch" : "none",
    };
  }

  public getDiagnostics(): readonly SynaraHistoryDiagnostic[] {
    return this.diagnostics.slice();
  }

  public getTraces(): readonly SynaraHistoryTrace[] {
    return this.traces.slice();
  }

  public beginAiBatch(batchId: string): void {
    if (this.activeBatch !== null) {
      this.fail({
        code: "capture-failed",
        phase: "ai-batch-begin",
        expected: "no AI batch is active before accepting a new batch",
        observed: `batch ${this.activeBatch.id} is already active`,
        recoverable: false,
        batchId,
      });
      throw new Error("an AI batch is already active");
    }
    const before = captureDocumentSnapshot(this.adapter.captureScene());
    this.activeBatch = { id: batchId, before, nextSequence: 1, acceptedUpdateCount: 0 };
    this.trace("ai-batch-begin", before);
  }

  public applyAiProgress(
    batchId: string,
    update: SynaraSceneInput & { readonly sequence: number },
  ): void {
    const active = this.requireBatch(batchId);
    if (update.sequence !== active.nextSequence) {
      this.fail({
        code: "sequence-mismatch",
        phase: "ai-batch-progress",
        expected: `contiguous sequence ${active.nextSequence}`,
        observed: `received ${update.sequence}`,
        recoverable: false,
        batchId,
      });
      throw new Error(`expected progress sequence ${active.nextSequence}`);
    }
    this.adapter.applyProgress(update);
    this.activeBatch = {
      ...active,
      nextSequence: active.nextSequence + 1,
      acceptedUpdateCount: active.acceptedUpdateCount + 1,
    };
    this.trace(`ai-progress-${update.sequence}`, this.adapter.captureScene());
  }

  public completeAiBatch(batchId: string): SynaraHistoryEvent | null {
    const active = this.requireBatch(batchId);
    const after = captureDocumentSnapshot(this.adapter.captureScene());
    this.activeBatch = null;
    if (active.acceptedUpdateCount === 0 || documentSnapshotsEqual(active.before, after)) {
      this.trace("ai-batch-no-op", after);
      return null;
    }
    return this.append({
      id: `event-${++this.eventCounter}`,
      kind: "ai-batch",
      outcome: "completed",
      batchId,
      acceptedUpdateCount: active.acceptedUpdateCount,
      before: active.before,
      after,
    });
  }

  public recordHumanMutation(
    beforeScene: SynaraSceneSnapshot,
    afterScene: SynaraSceneSnapshot,
  ): SynaraHistoryEvent | null {
    const before = captureDocumentSnapshot(beforeScene);
    const after = captureDocumentSnapshot(afterScene);
    if (documentSnapshotsEqual(before, after)) return null;
    return this.append({
      id: `event-${++this.eventCounter}`,
      kind: "human",
      outcome: "completed",
      acceptedUpdateCount: 1,
      before,
      after,
    });
  }

  public dispatch(command: SynaraHistoryCommand): boolean {
    if (this.activeBatch !== null) {
      // The Gate has no human transaction UI yet. Consuming the command here
      // proves it cannot fall through to package-native history.
      this.trace(`consume-${command}-during-ai`, this.adapter.captureScene());
      return false;
    }
    const event = command === "undo" ? this.events[this.cursor - 1] : this.events[this.cursor];
    if (event === undefined) {
      this.trace(`inert-${command}`, this.adapter.captureScene());
      return false;
    }
    const target = command === "undo" ? event.before : event.after;
    const start = captureDocumentSnapshot(this.adapter.captureScene());
    try {
      this.adapter.restoreScene({
        ...target,
        viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
      });
      const verified = captureDocumentSnapshot(this.adapter.captureScene());
      if (!documentSnapshotsEqual(target, verified)) {
        this.fail({
          code: "semantic-verification-mismatch",
          phase: command,
          expected: target.semanticFingerprint,
          observed: verified.semanticFingerprint,
          recoverable: false,
          eventId: event.id,
        });
        this.adapter.restoreScene({ ...start, viewport: { scrollX: 0, scrollY: 0, zoom: 1 } });
        return false;
      }
    } catch (error) {
      this.fail({
        code: "restore-failed",
        phase: command,
        expected: "restore and semantic verification complete before cursor movement",
        observed: error instanceof Error ? error.message : String(error),
        recoverable: true,
        eventId: event.id,
      });
      return false;
    }
    this.cursor += command === "undo" ? -1 : 1;
    this.trace(command, verifiedSnapshot(this.adapter), command, event.id);
    return true;
  }

  private append(event: SynaraHistoryEvent): SynaraHistoryEvent {
    this.events = [...this.events.slice(0, this.cursor), event];
    this.cursor = this.events.length;
    this.trace("append", event.after, undefined, event.id);
    return event;
  }

  private requireBatch(batchId: string): ActiveBatch {
    if (this.activeBatch === null || this.activeBatch.id !== batchId) {
      this.fail({
        code: "capture-failed",
        phase: "ai-batch",
        expected: `active batch ${batchId}`,
        observed: "no matching active batch",
        recoverable: false,
        batchId,
      });
      throw new Error(`batch ${batchId} is not active`);
    }
    return this.activeBatch;
  }

  private trace(
    phase: string,
    scene: SynaraSceneSnapshot | SynaraDocumentSnapshot,
    command?: SynaraHistoryCommand,
    eventId?: string,
  ): void {
    const snapshot = "semanticFingerprint" in scene ? scene : captureDocumentSnapshot(scene);
    this.traces.push({
      phase,
      ...(command ? { command } : {}),
      cursor: this.cursor,
      eventCount: this.events.length,
      fingerprint: snapshot.semanticFingerprint,
      ...(eventId ? { eventId } : {}),
    });
  }

  private fail(diagnostic: SynaraHistoryDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }
}

function verifiedSnapshot(adapter: SynaraHistoryAdapter): SynaraDocumentSnapshot {
  return captureDocumentSnapshot(adapter.captureScene());
}
