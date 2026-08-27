import type { SynaraDocumentSnapshot } from "./SynaraDocumentSnapshot";

/**
 * Ticket 02 WP-GATE — AI-only history types.
 *
 * Humans are never events. A human mutation is a settlement/invalidation
 * input consumed by the coordinator; only AI batches become events. There is
 * no generic undo/redo dispatcher and no shared cursor with native history.
 */

export const SYNARA_HISTORY_DIAGNOSTIC_SCHEMA = "synara.whiteboard.history-diagnostic/v1" as const;

export type SynaraHistoryDiagnosticOwner = "adapter" | "coordinator";

export type SynaraHistoryDiagnosticSeverity = "info" | "warning" | "error" | "critical";

export type SynaraHistoryDiagnosticRecoverability =
  | "retryable"
  | "reset-required"
  | "locked"
  | "none";

/**
 * Bounded Gate evidence or AC identifiers. Never an acceptance verdict: the
 * Gate claims no AC passed.
 */
export type SynaraHistoryAcApplicability =
  | "gate-bounded-evidence"
  | "AC1"
  | "AC2"
  | "AC3"
  | "AC4"
  | "AC8"
  | "AC9"
  | "AC10";

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
  | "ai-history-cleared-by-human"
  | "ai-redo-cleared-by-new-ai-batch"
  | "restore-rollback-succeeded"
  | "restore-rollback-failed"
  | "operation-not-applicable"
  | "cursor-not-actionable"
  | "session-locked";

/** Serialized `synara.whiteboard.history-diagnostic/v1` diagnostic record. */
export interface SynaraHistoryDiagnostic {
  readonly schema: typeof SYNARA_HISTORY_DIAGNOSTIC_SCHEMA;
  readonly owner: SynaraHistoryDiagnosticOwner;
  readonly code: SynaraHistoryDiagnosticCode;
  readonly severity: SynaraHistoryDiagnosticSeverity;
  readonly recoverability: SynaraHistoryDiagnosticRecoverability;
  readonly acApplicability: SynaraHistoryAcApplicability;
  readonly phase: string;
  readonly scenario: string;
  readonly message: string;
  readonly summary: string;
  readonly packageVersion: string;
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
  readonly rollbackResult?: "succeeded" | "failed" | "not-attempted";
  readonly timestamp: number;
}

export type SynaraEditLockState = "unlocked" | "ai-batch" | "restore" | "locked-fault";

/** Outcome of a finalized AI batch. The Gate proves only `completed`. */
export type SynaraAiEventOutcome = "completed" | "interrupted" | "failed-partial";

/**
 * Immutable event provenance. Creation fields are never rewritten and need
 * not equal the current route epoch after AI Undo.
 */
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

export interface SynaraAiHistoryEvent {
  readonly id: string;
  readonly provenance: SynaraAiEventProvenance;
  readonly outcome: SynaraAiEventOutcome;
  readonly batchId: string;
  readonly acceptedSyntheticWriteCount: number;
  readonly before: SynaraDocumentSnapshot;
  readonly after: SynaraDocumentSnapshot;
}

/** Adapter identities fenced into every applicability decision. */
export interface SynaraHistoryIdentity {
  readonly canvasIdentity: string;
  readonly mountIdentity: string;
  readonly apiIdentity: string;
  readonly sessionEpoch: number;
}

/** Test-only ordered lifecycle trace for AI Undo/Redo clear proof (plan §6.5). */
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

/** Result of one settlement decision over a human mutation family. */
export interface SynaraHumanSettlementResult {
  readonly family: string;
  readonly settled: "changed" | "no-op" | "uncertain";
  readonly startFingerprint: string;
  readonly endFingerprint: string;
}

export interface SynaraAiHistoryState {
  readonly events: readonly SynaraAiHistoryEvent[];
  readonly cursor: number;
  readonly lockState: SynaraEditLockState;
  readonly routeEpoch: number;
  readonly mutationRevision: number;
  readonly identity: SynaraHistoryIdentity;
}

export interface SynaraAiHistoryReporter {
  readonly report: (diagnostic: Omit<SynaraHistoryDiagnostic, "schema">) => void;
  readonly diagnostics: () => readonly SynaraHistoryDiagnostic[];
  readonly traces: () => readonly SynaraAiCommandTrace[];
  readonly settlements: () => readonly SynaraHumanSettlementResult[];
}

/** Context the adapter fences into every synthetic write scope. */
export interface SynaraSyntheticScopeContext {
  readonly purpose: "ai-batch-progress" | "ai-batch-finalize" | "ai-undo" | "ai-redo" | "rollback";
  readonly operationId: string;
  readonly operationGeneration: number;
  readonly sessionEpoch: number;
  readonly routeEpoch: number;
  readonly expectedBeforeRevision: number;
  readonly batchId?: string;
}

/** Opaque receipt returned by scope.issue — no forgeable token inside. */
export interface SynaraSyntheticWriteReceipt {
  readonly adapterGlobalSyntheticSequence: number;
  readonly correlationId: string;
}

export interface SynaraSyntheticIssueInput {
  readonly operationLocalSequence: number;
  readonly expectedBeforeRevision: number;
  readonly apply: () => void;
}

export interface SynaraSyntheticWriteScope {
  readonly issue: (input: SynaraSyntheticIssueInput) => SynaraSyntheticWriteReceipt;
  readonly drain: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly abort: (reason: string) => void;
}

/** Public host observation consumed by the settlement protocol (plan §5.1). */
export interface SynaraHostObservation {
  readonly adapterCallbackSequence: number;
  readonly scopeActive: boolean;
  readonly tombstoneCount: number;
}

export type SynaraSettlementFamily =
  | "pointer-gesture"
  | "discrete-keyboard-mutation"
  | "text-edit-composition"
  | "generic-native-command"
  | "presentation-no-op";

export interface SynaraSettlementObservationInput {
  readonly kind:
    | "pointer-down"
    | "pointer-up"
    | "pointer-cancel"
    | "keyboard-candidate"
    | "text-edit-active"
    | "text-edit-inactive"
    | "semantic-callback"
    | "focus";
  readonly key?: string;
}
