import { Schema } from "effect";

import {
  EventId,
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
  "coalesced-progress",
  "terminal-outbox",
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
  "pi_subagent_already_applied",
  "pi_subagent_lifecycle_persistence_failed",
  "pi_subagent_control_degraded",
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
