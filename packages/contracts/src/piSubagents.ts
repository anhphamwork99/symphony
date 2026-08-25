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
  "child-bash-process-ownership",
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
  "pi_subagent_completion_delivery_succeeded",
  "pi_subagent_completion_superseded",
  "pi_subagent_completion_batch_persistence_failed",
  "pi_subagent_completion_batch_rejected",
  "pi_subagent_completion_batch_collision",
  "pi_subagent_completion_batch_recovery_failed",
  "pi_subagent_owner_loss_orphaned",
  "pi_subagent_restart_reconciliation_failed",
  "pi_subagent_admission_provider_concurrency_exhausted",
  "pi_subagent_admission_server_queue_saturated",
  "pi_subagent_admission_project_queue_saturated",
  "pi_subagent_admission_quota_unavailable",
  "pi_subagent_walltime_expired",
  "pi_subagent_watchdog_walltime_escalation",
  "pi_subagent_watchdog_idle_escalation",
  "pi_subagent_watchdog_stage_timeout",
  "pi_subagent_watchdog_terminal_evidence",
  "pi_subagent_watchdog_cleanup_uncertain",
  "pi_subagent_watchdog_session_stopped",
  "pi_subagent_teardown_requested",
  "pi_subagent_teardown_proven",
  "pi_subagent_teardown_survivors",
  "pi_subagent_teardown_owner_unproven",
  "pi_subagent_resumed",
  "pi_subagent_resume_not_found",
  "pi_subagent_resume_invalid_state",
  "pi_subagent_resume_stale_generation",
  "pi_subagent_resume_unavailable",
  "pi_subagent_resume_persistence_failed",
  "pi_subagent_read_denied",
  "pi_subagent_result_truncated",
  "pi_subagent_transcript_missing",
  "pi_subagent_transcript_unavailable",
  "pi_subagent_transcript_corrupt",
  "pi_subagent_transcript_entry_truncated",
  "pi_subagent_transcript_page_truncated",
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
  /**
   * Ticket 14: the admission-time delegation triplet, persisted so an
   * explicit resume can rebuild the exact four-string delegation request
   * the Agent tool validates. Optional for legacy compatibility; a resume
   * of a legacy row stamps explicit gap-naming placeholders.
   */
  delegationContext: Schema.optional(TrimmedNonEmptyString),
  delegationLinkReferences: Schema.optional(TrimmedNonEmptyString),
  delegationExpectedOutcome: Schema.optional(TrimmedNonEmptyString),
  /** Ticket 14: resolved `provider/modelId` the child attempt ran under. */
  resolvedModel: Schema.optional(TrimmedNonEmptyString),
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
  /** Ticket 14 durable delegation replay fields (NULL on legacy rows). */
  delegationContext: Schema.optional(TrimmedNonEmptyString),
  delegationLinkReferences: Schema.optional(TrimmedNonEmptyString),
  delegationExpectedOutcome: Schema.optional(TrimmedNonEmptyString),
  resolvedModel: Schema.optional(TrimmedNonEmptyString),
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
 * Decision 0033 child-owned teardown command (host → owner endpoint). The
 * bridge operation is the opaque `teardownOwnedProcesses` spelling; the
 * capability `child-bash-process-ownership` gates it. The command carries
 * ONLY the Ticket 06 identity-fencing conventions (command/execution/
 * attempt/generation): the owner identity is endpoint-local and opaque, so
 * raw PIDs, session keys, signals, and every other kill parameter stay out
 * of the request. A mismatching live owner is `stale` and is never signaled
 * (generation fencing, Ticket 16 ownership model).
 */
export const PiSubagentTeardownOwnedProcessesCommand = Schema.Struct({
  commandId: TrimmedNonEmptyString,
  executionId: PiSubagentExecutionId,
  expectedAttemptId: PiSubagentAttemptId,
  expectedGeneration: PositiveInt,
});
export type PiSubagentTeardownOwnedProcessesCommand =
  typeof PiSubagentTeardownOwnedProcessesCommand.Type;

/** Cap on ordered, deduplicated survivor PIDs carried per teardown result. */
export const MAX_PI_SUBAGENT_TEARDOWN_RESULT_SURVIVOR_PIDS = 16;

/** Positive safe-integer PID — the only individual PID shape the contract admits. */
const PositiveSafeIntPid = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(9007199254740991),
);

/**
 * Owner-reported survivor evidence is immutable diagnostic data, never host
 * kill authority. Require strict ascending order so the decoded evidence is
 * non-empty, deterministic, and deduplicated without host-side normalization.
 */
const OrderedUniqueSurvivorPids = Schema.Array(PositiveSafeIntPid)
  .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PI_SUBAGENT_TEARDOWN_RESULT_SURVIVOR_PIDS))
  .check(
    Schema.makeFilter((pids) => pids.every((pid, index) => index === 0 || pids[index - 1]! < pid)),
  );

/**
 * Decision 0033 owner-teardown result (owner endpoint → host), with the
 * correlation identity mirrored from the cancel result.
 *
 * - `proven` — the identity-matched owner proved every owned child process
 *   exited (liveness-verified, never a bare kill API return).
 * - `survivors` — the owner ran teardown but at least one owned child
 *   remained live past its escalation bounds; the ONLY status that may
 *   carry non-empty, ascending, deduplicated, bounded positive-safe-integer
 *   survivor PID evidence.
 * - `stale` — the live owner's identity does not match the command fencing;
 *   nothing was signaled.
 * - `missing` — no such execution under this owner.
 * - `owner_unavailable` — no live owner endpoint exists to ask (the honest
 *   owner-unproven state; never a kill claim).
 * - `dispatch_failed` — the dispatch to the owner endpoint failed; no
 *   teardown claim of any kind is made.
 */
export const PiSubagentTeardownOwnedProcessesResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("survivors"),
    executionId: PiSubagentExecutionId,
    attemptId: PiSubagentAttemptId,
    generation: PositiveInt,
    survivorPids: OrderedUniqueSurvivorPids,
  }),
  Schema.Struct({
    status: Schema.Literals(["proven", "stale", "missing", "owner_unavailable", "dispatch_failed"]),
    executionId: PiSubagentExecutionId,
    attemptId: PiSubagentAttemptId,
    generation: PositiveInt,
    /** Survivor PID data is forbidden on every non-survivor status. */
    survivorPids: Schema.optional(Schema.Never),
  }),
]);
export type PiSubagentTeardownOwnedProcessesResult =
  typeof PiSubagentTeardownOwnedProcessesResult.Type;

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
 * Ticket 11 reconnectable execution card (T11-AC1). Bounded, stable
 * projection of one managed Pi subagent execution as consumed by the web
 * execution-card experience over the WebSocket snapshot/replay surface.
 *
 * Every field is bounded server-side before it enters this shape: the card
 * NEVER carries the prompt, raw progress JSON, or full transcript content —
 * only bounded summaries and opaque references. Terminal evidence
 * (`terminalSummary`, `transcriptRef`) inherits the Ticket 07/08 bounds and
 * `deliveryState` exposes the completion-outbox delivery state without ever
 * conflating delivery failure with execution failure (T08-AC2). Ticket 03
 * adds bounded current-generation attachment/teardown-evidence fields
 * (T03-AC1) with null decoding defaults so pre-Ticket-03 persisted card
 * events replay unchanged.
 */
export const PI_SUBAGENT_EXECUTION_CARD_PROGRESS_SUMMARY_MAX_CHARS = 512;
export const PI_SUBAGENT_EXECUTION_CARD_DIAGNOSTIC_MAX_CHARS = 512;
export const PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD = 64;

/**
 * Ticket 03 current-generation attachment truth (T03-AC1). Derived
 * server-side from exact current execution/attempt/generation durable
 * evidence only: `detached` for a durable background admission or an exact
 * seq-3 `phase=detached` journal row; `attached` for any other current live
 * execution; `null` for terminal/orphaned/non-live aggregates and for cards
 * replayed from pre-Ticket-03 persisted events (decoding default).
 */
export const PiSubagentExecutionCardAttachment = Schema.Literals(["attached", "detached"]);
export type PiSubagentExecutionCardAttachment = typeof PiSubagentExecutionCardAttachment.Type;

/**
 * Ticket 03 current-generation teardown evidence (T03-AC1). Derived only
 * from journal bands of the exact current execution/attempt/generation:
 * `survivors` (77, wins over `owner_unproven` when both exist),
 * `owner_unproven` (78), `requested` (75). Band 76 `proven` is excluded —
 * proven teardown settles cancellation and advances the generation, so it
 * can never describe the current generation. `none` is the fresh default;
 * `null` decodes from pre-Ticket-03 persisted card events.
 */
export const PiSubagentTeardownEvidence = Schema.Literals([
  "none",
  "requested",
  "survivors",
  "owner_unproven",
]);
export type PiSubagentTeardownEvidence = typeof PiSubagentTeardownEvidence.Type;

export const PiSubagentExecutionCard = Schema.Struct({
  executionId: PiSubagentExecutionId,
  attemptId: PiSubagentAttemptId,
  generation: PositiveInt,
  projectId: ProjectId,
  parentThreadId: ThreadId,
  parentTurnId: Schema.NullOr(TurnId),
  parentToolCallId: Schema.NullOr(TrimmedNonEmptyString),
  agentType: TrimmedNonEmptyString,
  mode: PiSubagentTransportMode,
  cancellationScope: PiSubagentCancellationScope,
  desiredState: PiSubagentLifecycleState,
  observedState: PiSubagentLifecycleState,
  diagnosticCode: Schema.optional(PiSubagentDiagnosticCode),
  /** Bounded human-facing diagnostic/rejection text (truncated server-side). */
  diagnosticMessage: Schema.optional(TrimmedNonEmptyString),
  /** Lease state for the current attempt (null before first heartbeat). */
  leaseExpiresAt: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Bounded latest-progress summary (coalesced; never the raw JSON). */
  lastProgressSummary: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  lastProgressAt: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  droppedProgressCount: Schema.optional(NonNegativeInt),
  /** Bounded terminal summary for terminal executions (Ticket 07 bounds). */
  terminalSummary: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Opaque authorized transcript reference (never transcript content). */
  transcriptRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Completion-outbox delivery state, when a delivery entry exists. */
  deliveryState: Schema.optional(PiSubagentCompletionDeliveryState),
  /**
   * Ticket 03 bounded current-generation attachment truth (T03-AC1).
   * Optional with decoding default `null` so old persisted card events
   * replay: the web treats `null` conservatively (ordinary observed-state
   * presentation). Fresh server cards always emit an explicit value.
   */
  currentAttachment: Schema.optional(Schema.NullOr(PiSubagentExecutionCardAttachment)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  /**
   * Ticket 03 bounded current-generation teardown evidence (T03-AC1).
   * Same old-shape decoding default `null`; fresh server cards always emit
   * an explicit value (`none` when no teardown band exists).
   */
  currentTeardownEvidence: Schema.optional(Schema.NullOr(PiSubagentTeardownEvidence)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  /**
   * Completed child model turns for the current attempt (bounded counter
   * projected from coalesced progress; zero is valid, null before the first
   * turn-completion observation).
   */
  turnCount: Schema.optional(Schema.NullOr(NonNegativeInt)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  /**
   * Spawn-time turn budget for the current attempt (strictly positive;
   * null when the spawn carried no turn budget or none is known).
   */
  maxTurns: Schema.optional(Schema.NullOr(PositiveInt)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
});
export type PiSubagentExecutionCard = typeof PiSubagentExecutionCard.Type;

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
export type PiSubagentTranscriptTerminalMarker = typeof PiSubagentTranscriptTerminalMarker.Type;

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

/**
 * Ticket 12 authorized result read (T12-AC3/AC4). Returns the bounded
 * terminal summary the durable aggregate already holds — never raw
 * unbounded output — with a stable truncation diagnostic when the stored
 * summary hit the ingest cap, plus the continuation pointer for reading the
 * full content through the paginated transcript surface.
 */
export const PI_SUBAGENT_RESULT_SUMMARY_EXCERPT_MAX_CHARS = 4000;
export const PI_SUBAGENT_TRANSCRIPT_PAGE_DEFAULT_ENTRIES = 50;
export const PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES = 200;

export const PiSubagentResultReadResult = Schema.Struct({
  executionId: PiSubagentExecutionId,
  /** Durable observed state at read time; a read is never liveness proof. */
  observedState: PiSubagentLifecycleState,
  /** Terminal label when the execution is terminal (null otherwise). */
  terminalState: Schema.optional(
    Schema.NullOr(Schema.Literals(["succeeded", "failed", "cancelled"])),
  ),
  /** Bounded terminal summary excerpt (≤ PI_SUBAGENT_RESULT_SUMMARY_EXCERPT_MAX_CHARS). */
  summary: Schema.NullOr(TrimmedNonEmptyString),
  /** True when the stored summary hit the ingest cap (content was omitted). */
  summaryTruncated: Schema.Boolean,
  /** Stable diagnostic code for the truncation (T12-AC4). */
  diagnosticCode: Schema.optional(PiSubagentDiagnosticCode),
  /** Continuation pointer when transcript evidence exists (T12-AC4). */
  transcriptRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type PiSubagentResultReadResult = typeof PiSubagentResultReadResult.Type;

/**
 * Ticket 12 authorized paginated transcript entry (T12-AC3/AC5). One bounded
 * entry of the extension-owned JSONL transcript artifact: identity-bearing
 * metadata plus a bounded content excerpt. The raw JSONL line is never
 * returned; per-entry excerpts carry their own truncation diagnostic.
 */
export const PiSubagentTranscriptEntry = Schema.Struct({
  /** Zero-based entry index inside the transcript artifact (the cursor unit). */
  index: NonNegativeInt,
  type: Schema.Literals(["user", "assistant", "toolResult", "outcome"]),
  /** Bounded content excerpt of the entry's message content. */
  content: Schema.String,
  /** True when this entry's excerpt was truncated at the per-entry cap. */
  truncated: Schema.Boolean,
  timestamp: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type PiSubagentTranscriptEntry = typeof PiSubagentTranscriptEntry.Type;

/**
 * Ticket 12 authorized paginated transcript page (T12-AC3). Cursor is the
 * exclusive entry index; `nextCursor` is null exactly when the artifact is
 * exhausted. `skippedCorruptEntries` counts lines that failed to parse so a
 * corrupt artifact degrades to stable diagnostics without changing the
 * execution outcome (T12-AC7).
 */
export const PiSubagentTranscriptReadResult = Schema.Struct({
  executionId: PiSubagentExecutionId,
  /** Durable observed state at read time; a read is never liveness proof. */
  observedState: PiSubagentLifecycleState,
  entries: Schema.Array(PiSubagentTranscriptEntry),
  /** Exclusive cursor for the next page; null when exhausted. */
  nextCursor: Schema.NullOr(NonNegativeInt),
  /** Entries omitted from this page because the page was full. */
  hasMore: Schema.Boolean,
  skippedCorruptEntries: NonNegativeInt,
  diagnosticCode: Schema.optional(PiSubagentDiagnosticCode),
});
export type PiSubagentTranscriptReadResult = typeof PiSubagentTranscriptReadResult.Type;
