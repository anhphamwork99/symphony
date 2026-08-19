import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import {
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "./baseSchemas";
import {
  ChatAttachment,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderKind,
  ProviderRequestKind,
  ProviderReviewTarget,
  ProviderSandboxMode,
  ProviderStartOptions,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration";
import { ProviderMentionReference, ProviderSkillReference } from "./providerDiscovery";

const ProviderSessionStatus = Schema.Literals([
  "connecting",
  "ready",
  "running",
  "error",
  "closed",
]);

/**
 * Opaque server-controlled snapshot of the session-local MCP authority record
 * (Decision 21). It is minted only inside the trusted server and must never
 * be accepted from clients, provider payloads, or request-supplied identity.
 * Provider adapters pass it through to the shared Agent Gateway MCP admission
 * boundary; admission re-validates the owning authority record at request time.
 */
export const McpAuthorityBinding = Schema.Struct({
  authorityId: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
  kind: Schema.Union([Schema.Literal("authenticated"), Schema.Literal("local-owner")]),
  authSessionId: Schema.NullOr(TrimmedNonEmptyString),
  authExpiresAt: Schema.NullOr(Schema.Number),
  issuedAt: Schema.Number,
  credentialExpiresAt: Schema.Number,
  sessionGeneration: TrimmedNonEmptyString,
  lifecycleGeneration: Schema.NullOr(TrimmedNonEmptyString),
  projectId: Schema.NullOr(TrimmedNonEmptyString),
});
export type McpAuthorityBinding = typeof McpAuthorityBinding.Type;

export const ProviderSession = Schema.Struct({
  provider: ProviderKind,
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderKind),
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  /** Optional server-minted subject-bound MCP authority (Decision 21). */
  mcpAuthority: Schema.optional(McpAuthorityBinding),
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  forkSourceResumeCursor: Schema.optional(Schema.Unknown),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  providerOptions: Schema.optional(ProviderStartOptions),
  runtimeMode: RuntimeMode,
});
export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  skills: Schema.optional(Schema.Array(ProviderSkillReference)),
  mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;
export const ProviderSteerTurnInput = ProviderSendTurnInput;
export type ProviderSteerTurnInput = typeof ProviderSteerTurnInput.Type;

export const ProviderForkThreadInput = Schema.Struct({
  sourceThreadId: ThreadId,
  threadId: ThreadId,
  sourceResumeCursor: Schema.optional(Schema.Unknown),
  sourceCwd: Schema.optional(TrimmedNonEmptyString),
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  runtimeMode: RuntimeMode,
  /** Optional server-minted subject-bound MCP authority (Decision 21). */
  mcpAuthority: Schema.optional(McpAuthorityBinding),
});
export type ProviderForkThreadInput = typeof ProviderForkThreadInput.Type;

export const ProviderForkThreadResult = Schema.Struct({
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderForkThreadResult = typeof ProviderForkThreadResult.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderStartReviewInput = Schema.Struct({
  threadId: ThreadId,
  target: ProviderReviewTarget,
});
export type ProviderStartReviewInput = typeof ProviderStartReviewInput.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderStopTaskInput = Schema.Struct({
  threadId: ThreadId,
  taskId: TrimmedNonEmptyString,
});
export type ProviderStopTaskInput = typeof ProviderStopTaskInput.Type;

export const ProviderBackgroundTaskInput = Schema.Struct({
  threadId: ThreadId,
  toolUseId: TrimmedNonEmptyString,
});
export type ProviderBackgroundTaskInput = typeof ProviderBackgroundTaskInput.Type;

/**
 * Ticket 11 card cancel input (T11-AC6). Cancels ONE managed Pi subagent
 * execution through the durable cancel path. Execution identity is
 * correlation, not authority: the provider layer resolves the owning thread's
 * session and the coordinator enforces attempt/generation fencing.
 */
export const ProviderCancelPiSubagentExecutionInput = Schema.Struct({
  threadId: ThreadId,
  executionId: TrimmedNonEmptyString,
});
export type ProviderCancelPiSubagentExecutionInput =
  typeof ProviderCancelPiSubagentExecutionInput.Type;

/**
 * Ticket 14 explicit resume input (T14-AC1/AC4/AC6). Resumes ONE orphaned
 * managed Pi subagent execution: the logical executionId is kept, a new
 * attemptId is minted, the generation advances, and the same authorization,
 * active-turn, quota, and admission gates as a fresh spawn run before any
 * child starts. Execution identity is correlation, not authority.
 */
export const ProviderResumePiSubagentExecutionInput = Schema.Struct({
  threadId: ThreadId,
  executionId: TrimmedNonEmptyString,
});
export type ProviderResumePiSubagentExecutionInput =
  typeof ProviderResumePiSubagentExecutionInput.Type;

export const ProviderSteerSubagentInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: TrimmedNonEmptyString,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  skills: Schema.optional(Schema.Array(ProviderSkillReference)),
  mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
});
export type ProviderSteerSubagentInput = typeof ProviderSteerSubagentInput.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderCompactThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderCompactThreadInput = typeof ProviderCompactThreadInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  decision: ProviderApprovalDecision,
});
export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  answers: ProviderUserInputAnswers,
});
export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderKind,
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  parentTurnId: Schema.optional(TurnId),
  itemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  providerParentThreadId: Schema.optional(TrimmedNonEmptyString),
  textDelta: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown),
});
export type ProviderEvent = typeof ProviderEvent.Type;
