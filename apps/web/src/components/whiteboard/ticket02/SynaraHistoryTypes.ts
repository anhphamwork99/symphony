export type SynaraHistoryOutcome = "completed";

export type SynaraHistoryCommand = "undo" | "redo";

export type SynaraHistoryTransaction = "none" | "ai-batch" | "human";

export interface SynaraHistoryEvent {
  readonly id: string;
  readonly kind: "ai-batch" | "human";
  readonly outcome: SynaraHistoryOutcome;
  readonly batchId?: string;
  readonly acceptedUpdateCount: number;
  readonly before: import("./SynaraDocumentSnapshot").SynaraDocumentSnapshot;
  readonly after: import("./SynaraDocumentSnapshot").SynaraDocumentSnapshot;
}

export interface SynaraHistoryDiagnostic {
  readonly code:
    | "adapter-not-ready"
    | "capture-failed"
    | "sequence-mismatch"
    | "semantic-verification-mismatch"
    | "restore-failed"
    | "duplicate-dispatch"
    | "native-history-containment-failed";
  readonly phase: string;
  readonly expected: string;
  readonly observed: string;
  readonly recoverable: boolean;
  readonly batchId?: string;
  readonly eventId?: string;
}

export interface SynaraHistoryTrace {
  readonly phase: string;
  readonly command?: SynaraHistoryCommand;
  readonly cursor: number;
  readonly eventCount: number;
  readonly fingerprint: string;
  readonly eventId?: string;
}

export interface SynaraHistoryState {
  readonly events: readonly SynaraHistoryEvent[];
  readonly cursor: number;
  readonly activeTransaction: SynaraHistoryTransaction;
}
