import type { SynaraDocumentSnapshot } from "./SynaraDocumentSnapshot";

/** AI-only history types for the bounded Ticket 02 fallback Gate. */
export type SynaraHistoryDiagnosticOwner = "adapter" | "coordinator";
export type SynaraHistoryDiagnosticSeverity = "info" | "warning" | "error" | "critical";
export type SynaraHistoryDiagnosticRecoverability =
  | "retryable"
  | "reset-required"
  | "locked"
  | "none";

export type SynaraHistoryDiagnosticCode =
  | "adapter-not-ready"
  | "synthetic-sequence-mismatch"
  | "synthetic-scope-unresolved"
  | "duplicate-synthetic-callback"
  | "unknown-callback-provenance"
  | "stale-operation-generation"
  | "stale-route-epoch"
  | "stale-session-epoch"
  | "stale-mount-identity"
  | "stale-mutation-revision"
  | "semantic-verification-mismatch"
  | "native-history-clear-failed"
  | "native-history-reappeared-after-clear"
  | "edit-lock-failed"
  | "native-mutation-during-ai-lock"
  | "identity-changed-unexpectedly"
  | "human-settlement-uncertain"
  | "operation-not-applicable"
  | "cursor-not-actionable"
  | "ack-delivery-interrupted"
  | "operation-session-lost"
  | "operation-containment-unresolved"
  | "operation-conflicting-terminal";

export type SynaraEditLockState = "unlocked" | "ai-batch" | "restore" | "locked-fault";

/** Serialized diagnostic. `acApplicability` is evidence scope, never acceptance. */
export interface SynaraHistoryDiagnostic {
  readonly schema: "synara.whiteboard.history-diagnostic/v1";
  readonly owner: SynaraHistoryDiagnosticOwner;
  readonly code: SynaraHistoryDiagnosticCode;
  readonly severity: SynaraHistoryDiagnosticSeverity;
  readonly recoverability: SynaraHistoryDiagnosticRecoverability;
  readonly acApplicability: "bounded-gate-evidence";
  readonly phase: string;
  readonly scenario: string;
  readonly message: string;
  readonly summary: string;
  readonly packageVersion: "0.18.1";
  readonly browser: string;
  readonly platform: string;
  readonly canvasIdentity: string;
  readonly mountIdentity: string;
  readonly apiIdentity: string;
  readonly sessionEpoch: number;
  readonly routeEpoch: number;
  readonly mutationRevision: number;
  readonly operationId?: string;
  readonly operationGeneration?: number;
  readonly operationLocalSequence?: number;
  readonly adapterSyntheticSequence?: number;
  readonly adapterCallbackSequence?: number;
  readonly scopeCorrelationId?: string;
  readonly batchId?: string;
  readonly eventId?: string;
  readonly expected: string;
  readonly observed: string;
  readonly lockState: SynaraEditLockState;
  readonly timestamp: number;
}

export interface SynaraHistoryIdentity {
  readonly canvasIdentity: string;
  readonly mountIdentity: string;
  readonly apiIdentity: string;
  readonly sessionEpoch: number;
}

/** Immutable creation provenance; command applicability is evaluated separately. */
export interface SynaraAiEventProvenance {
  readonly canvasIdentity: string;
  readonly mountIdentity: string;
  readonly apiIdentity: string;
  readonly sessionEpoch: number;
  readonly creationRouteEpoch: number;
  readonly operationId: string;
  readonly operationGeneration: number;
  readonly beforeRevision: number;
  readonly afterRevision: number;
}

/**
 * Terminal outcome of one AI history event. Only server terminal outcomes
 * backed by acknowledged application evidence reach this union; `zero-valid`
 * produces no event at all (Decision 0063 §7).
 */
export type SynaraAiEventOutcome = "completed" | "interrupted" | "failed-partial";

export interface SynaraAiHistoryEvent {
  readonly id: string;
  readonly provenance: SynaraAiEventProvenance;
  readonly outcome: SynaraAiEventOutcome;
  readonly batchId: string;
  readonly acceptedSyntheticWriteCount: number;
  readonly before: SynaraDocumentSnapshot;
  readonly after: SynaraDocumentSnapshot;
}

export type SynaraAiCommandTraceStep =
  | "restore-write-issued"
  | "restore-callback-acknowledged"
  | "restore-target-verified"
  | "native-history-clear-invoked"
  | "native-history-clear-returned"
  | "post-clear-drain-complete"
  | "cursor-moved"
  | "result-exposed"
  | "lock-released";

export interface SynaraAiCommandTrace {
  readonly command: "undo-ai-batch" | "redo-ai-batch";
  readonly eventId: string;
  readonly steps: readonly SynaraAiCommandTraceStep[];
}

export interface SynaraAiHistoryState {
  readonly events: readonly SynaraAiHistoryEvent[];
  readonly cursor: number;
  readonly lockState: SynaraEditLockState;
  readonly routeEpoch: number;
  readonly mutationRevision: number;
  readonly identity: SynaraHistoryIdentity;
}
