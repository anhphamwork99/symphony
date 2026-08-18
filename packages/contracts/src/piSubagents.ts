import { Schema } from "effect";

import {
  EventId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";

export const PI_SUBAGENTS_PROTOCOL_VERSION = 1;
export const PI_SUBAGENTS_MIN_PROTOCOL_VERSION = 1;
export const PI_SUBAGENTS_MAX_PROTOCOL_VERSION = 1;

export const PI_SUBAGENT_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
  "coalesced-progress",
  "durable-cancellation",
  "journal-terminal-lifecycle",
  "terminal-outbox",
  "completion-delivery-ownership",
  "restart-reconciliation",
  "paginated-transcripts",
] as const;

export const PiSubagentCapability = Schema.Literals(PI_SUBAGENT_CAPABILITIES);
export type PiSubagentCapability = typeof PiSubagentCapability.Type;

export const PiSubagentDiagnosticCode = Schema.Literals([
  "pi_subagent_managed_enabled",
  "pi_subagent_bridge_absent",
  "pi_subagent_bridge_malformed_response",
  "pi_subagent_bridge_error",
  "pi_subagent_unsupported_version",
  "pi_subagent_capability_mismatch",
  "pi_subagent_admission_rejected",
  "pi_subagent_admission_unauthorized",
  "pi_subagent_admission_active_turn_required",
  "pi_subagent_admission_project_mismatch",
  "pi_subagent_admission_provider_mismatch",
  "pi_subagent_command_identity_mismatch",
  "pi_subagent_already_applied",
  "pi_subagent_lifecycle_persistence_failed",
  "pi_subagent_control_degraded",
  "pi_subagent_cancel_dispatch_failed",
  "pi_subagent_cancel_ack_timeout",
  "pi_subagent_cancel_stale_generation",
  "pi_subagent_cancel_already_terminal",
  "pi_subagent_cancel_owner_death",
  "pi_subagent_cancel_escalated",
  "pi_subagent_event_sequence_gap",
  "pi_subagent_terminal_stale_ignored",
  "pi_subagent_terminal_persistence_failed",
  "pi_subagent_completion_outbox_persistence_failed",
  "pi_subagent_completion_delivery_failed",
  "pi_subagent_completion_superseded",
  "pi_subagent_owner_loss_orphaned",
  "pi_subagent_restart_reconciliation_failed",
]);
export type PiSubagentDiagnosticCode = typeof PiSubagentDiagnosticCode.Type;

export const PiSubagentExecutionId = TrimmedNonEmptyString;
export type PiSubagentExecutionId = typeof PiSubagentExecutionId.Type;

export const PiSubagentAttemptId = TrimmedNonEmptyString;
export type PiSubagentAttemptId = typeof PiSubagentAttemptId.Type;

export const PiSubagentTransportMode = Schema.Literals(["foreground", "background"]);
export type PiSubagentTransportMode = typeof PiSubagentTransportMode.Type;

export const PiSubagentCancellationScope = Schema.Literals([
  "parent_turn",
  "session",
  "independent",
]);
export type PiSubagentCancellationScope = typeof PiSubagentCancellationScope.Type;

export const PiSubagentLifecycleState = Schema.Literals([
  "requested",
  "accepted",
  "queued",
  "running",
  "rejected",
  "cancelling",
  "cancelled",
  "succeeded",
  "failed",
  "orphaned",
]);
export type PiSubagentLifecycleState = typeof PiSubagentLifecycleState.Type;

export const PiSubagentHandshakeRequest = Schema.Struct({
  protocolVersion: PositiveInt,
  supportedProtocolVersions: Schema.Array(PositiveInt),
  clientVersion: TrimmedNonEmptyString,
  requiredCapabilities: Schema.Array(Schema.Union([PiSubagentCapability, TrimmedNonEmptyString])),
  optionalCapabilities: Schema.optional(
    Schema.Array(Schema.Union([PiSubagentCapability, TrimmedNonEmptyString])),
  ),
});
export type PiSubagentHandshakeRequest = typeof PiSubagentHandshakeRequest.Type;

export const PiSubagentHandshakeSuccessResponse = Schema.Struct({
  ok: Schema.Literal(true),
  protocolVersion: PositiveInt,
  extensionVersion: TrimmedNonEmptyString,
  capabilities: Schema.Array(Schema.Union([PiSubagentCapability, TrimmedNonEmptyString])),
});
export type PiSubagentHandshakeSuccessResponse = typeof PiSubagentHandshakeSuccessResponse.Type;

export const PiSubagentHandshakeFailureResponse = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Literals([
    "unsupported_version",
    "missing_capabilities",
    "bridge_error",
    "invalid_request",
  ]),
  protocolVersion: Schema.optional(PositiveInt),
  supportedProtocolVersions: Schema.optional(Schema.Array(PositiveInt)),
  extensionVersion: Schema.optional(TrimmedNonEmptyString),
  missingCapabilities: Schema.optional(
    Schema.Array(Schema.Union([PiSubagentCapability, TrimmedNonEmptyString])),
  ),
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentHandshakeFailureResponse = typeof PiSubagentHandshakeFailureResponse.Type;

export const PiSubagentHandshakeResponse = Schema.Union([
  PiSubagentHandshakeSuccessResponse,
  PiSubagentHandshakeFailureResponse,
]);
export type PiSubagentHandshakeResponse = typeof PiSubagentHandshakeResponse.Type;

export const PiSubagentNegotiatedCapability = Schema.Struct({
  status: Schema.Literals([
    "managed_enabled",
    "bridge_absent",
    "bridge_malformed_response",
    "unsupported_version",
    "capability_mismatch",
    "bridge_error",
  ]),
  diagnosticCode: PiSubagentDiagnosticCode,
  isManaged: Schema.Boolean,
  protocolVersion: Schema.optional(PositiveInt),
  capabilities: Schema.optional(
    Schema.Array(Schema.Union([PiSubagentCapability, TrimmedNonEmptyString])),
  ),
  missingCapabilities: Schema.optional(
    Schema.Array(Schema.Union([PiSubagentCapability, TrimmedNonEmptyString])),
  ),
  extensionVersion: Schema.optional(TrimmedNonEmptyString),
  offeredVersion: Schema.optional(PositiveInt),
  supportedVersions: Schema.optional(Schema.Array(PositiveInt)),
  diagnosticMessage: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentNegotiatedCapability = typeof PiSubagentNegotiatedCapability.Type;

export const PiSubagentSpawnCommand = Schema.Struct({
  commandId: TrimmedNonEmptyString,
  /**
   * Extension-supplied correlation identity (params.commandId or tool call
   * id). The durable dedup identity is the server-minted commandId scoped by
   * the ownership fingerprint; this field preserves the client correlation.
   */
  clientCommandId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projectId: ProjectId,
  parentThreadId: ThreadId,
  parentTurnId: Schema.NullOr(TurnId),
  parentToolCallId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  agentType: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  mode: Schema.optional(PiSubagentTransportMode),
  cancellationScope: Schema.optional(PiSubagentCancellationScope),
});
export type PiSubagentSpawnCommand = typeof PiSubagentSpawnCommand.Type;

export const PiSubagentSpawnResult = Schema.Struct({
  status: Schema.Literals(["accepted", "already_applied", "rejected"]),
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  state: PiSubagentLifecycleState,
  diagnosticCode: PiSubagentDiagnosticCode,
  rejectionReason: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentSpawnResult = typeof PiSubagentSpawnResult.Type;

export const PiSubagentLifecycleEvent = Schema.Struct({
  eventId: Schema.Union([EventId, TrimmedNonEmptyString]),
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  sequence: PositiveInt,
  state: PiSubagentLifecycleState,
  occurredAt: TrimmedNonEmptyString,
  parentThreadId: ThreadId,
  parentTurnId: Schema.NullOr(TurnId),
  parentToolCallId: Schema.NullOr(TrimmedNonEmptyString),
  projectId: ProjectId,
  diagnosticCode: Schema.optional(PiSubagentDiagnosticCode),
  diagnosticMessage: Schema.optional(TrimmedNonEmptyString),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type PiSubagentLifecycleEvent = typeof PiSubagentLifecycleEvent.Type;

export const PiSubagentExecutionRecord = Schema.Struct({
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  commandId: TrimmedNonEmptyString,
  projectId: ProjectId,
  parentThreadId: ThreadId,
  parentTurnId: Schema.NullOr(TurnId),
  parentToolCallId: Schema.NullOr(TrimmedNonEmptyString),
  agentType: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  mode: PiSubagentTransportMode,
  cancellationScope: PiSubagentCancellationScope,
  desiredState: PiSubagentLifecycleState,
  observedState: PiSubagentLifecycleState,
  diagnosticCode: Schema.optional(PiSubagentDiagnosticCode),
  rejectionReason: Schema.optional(TrimmedNonEmptyString),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
});
export type PiSubagentExecutionRecord = typeof PiSubagentExecutionRecord.Type;

/**
 * Ticket 06 durable cancel command (host → extension). Carries the exact
 * attempt/generation the server expects to terminate; a mismatching live
 * child is stale and must not be aborted (generation fencing, T06-AC3).
 */
export const PiSubagentCancelCommand = Schema.Struct({
  cancelCommandId: TrimmedNonEmptyString,
  executionId: PiSubagentExecutionId,
  expectedAttemptId: PiSubagentAttemptId,
  expectedGeneration: PositiveInt,
});
export type PiSubagentCancelCommand = typeof PiSubagentCancelCommand.Type;

/**
 * Ticket 06 terminal acknowledgement (extension → host). `cancelled` is
 * claimed ONLY after the child operation settled on the extension side —
 * never merely because abort() was invoked (T06-AC4/AC5).
 */
export const PiSubagentCancelResult = Schema.Struct({
  status: Schema.Literals(["cancelled", "already_terminal", "stale", "missing", "dispatch_failed"]),
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  diagnosticCode: Schema.optional(PiSubagentDiagnosticCode),
  diagnosticMessage: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentCancelResult = typeof PiSubagentCancelResult.Type;

/**
 * Ticket 07 terminal states a child settlement may report. `cancelled` is
 * NOT reported through this surface — the durable cancel coordinator owns
 * cancellation settlement from termination evidence (T06-AC4); an extension
 * terminal arriving after a durable `cancelled` is ignored and counted
 * without flip-flop (T07-AC7).
 */
export const PiSubagentTerminalState = Schema.Literals(["succeeded", "failed"]);
export type PiSubagentTerminalState = typeof PiSubagentTerminalState.Type;

/**
 * Ticket 07 bounded terminal payload (T07-AC5). The summary is a bounded
 * excerpt of the child result; the transcript reference points at the
 * extension-owned output/transcript artifact. Never raw unbounded output.
 */
export const PiSubagentTerminalEvidence = Schema.Struct({
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  state: PiSubagentTerminalState,
  occurredAt: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  /** Reference (opaque to the server) to the authorized transcript artifact. */
  transcriptRef: Schema.optional(TrimmedNonEmptyString),
  /** Best-effort parsed outcome judgment, distinct from execution status. */
  outcomeState: Schema.optional(TrimmedNonEmptyString),
  diagnosticMessage: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentTerminalEvidence = typeof PiSubagentTerminalEvidence.Type;

/**
 * Ticket 08 completion-delivery states (T08-AC2). These are DELIVERY states,
 * entirely separate from the execution outcome: a `failed_retryable` or
 * `superseded` delivery never rewrites a `succeeded` execution as failed.
 *
 * - `pending` — created atomically with the applicable terminal; not yet
 *   delivered to the parent notification boundary.
 * - `delivered` — the parent notification boundary accepted the completion
 *   payload (dedupe identity carried); acknowledgement has not arrived yet.
 * - `acknowledged` — the parent durably acknowledged the completion; the
 *   entry is complete and can no longer produce follow-up effects.
 * - `failed_retryable` — a delivery attempt failed; retry is idempotent and
 *   bounded by the configured retry limit. Execution outcome is untouched.
 * - `superseded` — a newer attempt/generation owns the execution now; this
 *   entry must never produce a delivery effect (T08-AC6).
 */
export const PiSubagentCompletionDeliveryState = Schema.Literals([
  "pending",
  "delivered",
  "acknowledged",
  "failed_retryable",
  "superseded",
]);
export type PiSubagentCompletionDeliveryState = typeof PiSubagentCompletionDeliveryState.Type;

/**
 * Ticket 08 durable completion-outbox entry (T08-AC2/AC3/AC5). One entry per
 * applicable terminal (succeeded|failed) for an attempt/generation. The
 * stable dedupe identity (`outboxId`) is deterministic so at-least-once
 * delivery retries can never create duplicate parent content.
 */
export const PiSubagentCompletionOutboxEntry = Schema.Struct({
  /** Deterministic: `outbox_<executionId>_<attemptId>_gen<generation>`. */
  outboxId: TrimmedNonEmptyString,
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  /** Journal event id of the applicable terminal this entry delivers. */
  terminalEventId: TrimmedNonEmptyString,
  parentThreadId: ThreadId,
  deliveryState: PiSubagentCompletionDeliveryState,
  /** Bounded terminal-state label (succeeded|failed) — outcome reference. */
  terminalState: PiSubagentTerminalState,
  /** Bounded result summary excerpt carried to the parent boundary. */
  summary: TrimmedNonEmptyString,
  /** Opaque authorized transcript reference (bounded, T07-AC5 inheritance). */
  transcriptRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  attemptCount: NonNegativeInt,
  lastError: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Generation that superseded this entry, when `superseded`. */
  supersededByGeneration: Schema.optional(Schema.NullOr(PositiveInt)),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
  deliveredAt: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  acknowledgedAt: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type PiSubagentCompletionOutboxEntry = typeof PiSubagentCompletionOutboxEntry.Type;

/**
 * Ticket 10 restart-reconciliation evidence (T10-AC1/AC2/AC3). Evidence is
 * matched against the execution's CURRENT attempt/generation: only a live
 * owner or a terminal marker carrying the same identity and generation can
 * keep an execution running or restore its outcome (T10-AC2); anything else
 * reconciles to non-terminal `orphaned` with an owner-loss diagnostic
 * (T10-AC1).
 */
export const PiSubagentLiveOwnerEvidence = Schema.Struct({
  /** Bridge listActive/describe match for the current attempt/generation. */
  kind: Schema.Literal("live_owner"),
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  /** Server clock at which liveness was proven (observation refresh). */
  observedAt: TrimmedNonEmptyString,
});
export type PiSubagentLiveOwnerEvidence = typeof PiSubagentLiveOwnerEvidence.Type;

/**
 * Ticket 10 transcript terminal marker (T10-AC2). A terminal marker recovered
 * from transcript evidence carries the attempt/generation it settles; a
 * marker whose identity does not match the current attempt/generation is
 * stale and cannot restore an outcome.
 */
export const PiSubagentTranscriptTerminalMarker = Schema.Struct({
  kind: Schema.Literal("transcript_terminal"),
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  /** Restored outcome for the execution aggregate (never `cancelled`). */
  state: PiSubagentTerminalState,
  /** Bounded summary excerpt; the server truncates again before persisting. */
  summary: TrimmedNonEmptyString,
  transcriptRef: Schema.optional(TrimmedNonEmptyString),
  outcomeState: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentTranscriptTerminalMarker =
  typeof PiSubagentTranscriptTerminalMarker.Type;

/**
 * Ticket 10 reconciliation outcome per execution (T10-AC1..AC6). `orphaned`
 * is non-terminal: it exits only through new evidence or explicit resume
 * (Ticket 14) and makes no claim that prior side effects were rolled back.
 */
export const PiSubagentReconciliationOutcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("orphaned"),
    executionId: PiSubagentExecutionId,
    attemptId: PiSubagentAttemptId,
    /** Generation AFTER the reconciliation fence (old generation + 1). */
    generation: PositiveInt,
    diagnosticCode: PiSubagentDiagnosticCode,
  }),
  Schema.Struct({
    kind: Schema.Literal("running_refreshed"),
    executionId: PiSubagentExecutionId,
    attemptId: PiSubagentAttemptId,
    generation: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("terminal_restored"),
    executionId: PiSubagentExecutionId,
    attemptId: PiSubagentAttemptId,
    generation: PositiveInt,
    state: PiSubagentTerminalState,
    source: Schema.Literals(["journal", "transcript_marker"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("already_terminal"),
    executionId: PiSubagentExecutionId,
    observedState: PiSubagentLifecycleState,
  }),
  Schema.Struct({
    kind: Schema.Literal("lease_not_expired"),
    executionId: PiSubagentExecutionId,
    attemptId: PiSubagentAttemptId,
    generation: PositiveInt,
  }),
]);
export type PiSubagentReconciliationOutcome = typeof PiSubagentReconciliationOutcome.Type;
