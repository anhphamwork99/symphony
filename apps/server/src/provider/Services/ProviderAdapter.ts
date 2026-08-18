/**
 * ProviderAdapter - Provider-specific runtime adapter contract.
 *
 * Defines the provider-native session/protocol operations that `ProviderService`
 * routes to after resolving the target provider. Implementations should focus
 * on provider behavior only and avoid cross-provider orchestration concerns.
 *
 * @module ProviderAdapter
 */
import type {
  ApprovalRequestId,
  ProviderComposerCapabilities,
  ProviderApprovalDecision,
  ProviderForkThreadInput,
  ProviderForkThreadResult,
  ProviderKind,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
  ProviderListSkillsResult,
  ProviderListSkillsInput,
  ProviderStartReviewInput,
  ProviderUserInputAnswers,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSteerTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ServerVoicePrewarmInput,
  ServerVoicePrewarmResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
  ThreadId,
  ProviderTurnStartResult,
  TurnId,
} from "@synara/contracts";
import type { Effect } from "effect";
import type { Stream } from "effect";

export type ProviderSessionModelSwitchMode = "in-session" | "restart-session" | "unsupported";

/**
 * Per-session Synara MCP disable outcome (impl-07). `dormant` means the
 * session reached the dormant surface with proven cleanup; `unavailable`
 * means cleanup/reload could not be proven (fail-closed, Decisions 13/14).
 */
export interface ProviderDisableSynaraMcpResult {
  readonly state: "dormant" | "unavailable";
  /** True when the session was already disabled (idempotent duplicate). */
  readonly alreadyDisabled?: boolean;
  /** Stable sanitized detail when cleanup could not be proven. */
  readonly detail?: string;
}

/**
 * Per-session Synara MCP enable outcome (impl-08). `active` means the
 * session reached the active surface with proven activation; `unavailable`
 * means activation could not be proven, the wait-set member is unsafe
 * (missing session, stale/misrouted generation, mid-deactivation), or the
 * session is fail-closed (Decisions 10/16/18).
 */
export interface ProviderEnableSynaraMcpResult {
  readonly state: "active" | "unavailable";
  /** True when the session was already active (idempotent duplicate). */
  readonly alreadyActive?: boolean;
  /** Stable sanitized detail when activation could not be proven. */
  readonly detail?: string;
}

/**
 * Per-adapter ingress budget. A bounded queue makes a slow durable consumer
 * apply backpressure to the provider instead of growing the process heap
 * without limit during a persistence outage.
 */
export const PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY = 2_048;

/**
 * Structured payload for steering a running subagent. Mirrors the turn-input
 * context fields so adapters can project attachments/skills/mentions into the
 * provider-native steering channel (which is typically text-only).
 */
export interface ProviderSteerSubagentPayload {
  readonly input: string;
  readonly attachments?: ProviderSendTurnInput["attachments"];
  readonly skills?: ProviderSendTurnInput["skills"];
  readonly mentions?: ProviderSendTurnInput["mentions"];
}
export type ProviderConversationRollbackMode = "native" | "restart-session";

export interface ProviderAdapterCapabilities {
  /**
   * Declares whether changing the model on an existing session is supported.
   */
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
  /** Restart-session adapters cannot rewind provider history and must rebuild context locally. */
  readonly conversationRollback?: ProviderConversationRollbackMode;
  readonly supportsSkillMentions?: boolean;
  readonly supportsSkillDiscovery?: boolean;
  readonly supportsNativeSlashCommandDiscovery?: boolean;
  readonly supportsPluginMentions?: boolean;
  readonly supportsPluginDiscovery?: boolean;
  readonly supportsRuntimeModelList?: boolean;
  readonly supportsTurnSteering?: boolean;
  /** True when `turn.diff.updated.payload.unifiedDiff` contains a parseable live patch. */
  readonly supportsLiveTurnDiffPatch?: boolean;
}

export interface ProviderThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

export interface ProviderThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<ProviderThreadTurnSnapshot>;
  readonly cwd?: string | null;
}

export interface ProviderAdapterShape<TError> {
  /**
   * Provider kind implemented by this adapter.
   */
  readonly provider: ProviderKind;
  readonly capabilities: ProviderAdapterCapabilities;

  /**
   * Start a provider-backed session.
   */
  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

  /**
   * Send a turn to an active provider session.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /**
   * Redirect an active turn toward a new prompt when the provider supports it.
   */
  readonly steerTurn?: (
    input: ProviderSteerTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /**
   * Start a native provider review run when the adapter supports it.
   */
  readonly startReview?: (
    input: ProviderStartReviewInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /**
   * Interrupt an active turn.
   */
  readonly interruptTurn: (
    threadId: ThreadId,
    turnId?: TurnId,
    providerThreadId?: string,
  ) => Effect.Effect<void, TError>;

  /**
   * Stop one provider-native background task when the adapter supports it.
   */
  readonly stopTask?: (threadId: ThreadId, taskId: string) => Effect.Effect<void, TError>;

  /**
   * Ticket 11 (T11-AC6): cancel ONE managed Pi subagent execution through the
   * durable cancel path. Optional — only the Pi adapter implements it.
   */
  readonly cancelPiSubagentExecution?: (
    threadId: ThreadId,
    executionId: string,
  ) => Effect.Effect<void, TError>;

  /**
   * Move one in-flight foreground task to the background when the adapter supports it.
   */
  readonly backgroundTask?: (threadId: ThreadId, toolUseId: string) => Effect.Effect<void, TError>;

  /**
   * Deliver a mid-task user message to a running subagent when the adapter supports it.
   */
  readonly steerSubagent?: (
    threadId: ThreadId,
    providerThreadId: string,
    input: ProviderSteerSubagentPayload,
  ) => Effect.Effect<void, TError>;

  /**
   * Respond to an interactive approval request.
   */
  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, TError>;

  /**
   * Respond to a structured user-input request.
   */
  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, TError>;

  /**
   * Enable the per-session Synara MCP integration (impl-08): drive the
   * session's lifecycle coordinator activation through the existing
   * `coordinator.activate` machinery, applying the safe boundary immediately
   * for idle sessions. The durable wait-set member's FULL session generation
   * is validated against the live session generation before any staging
   * (stale/misrouted/recreated-session tokens are refused), and the result is
   * bounded (active/unavailable); adapters without a Synara MCP runtime omit
   * the operation.
   */
  readonly enableSynaraMcp?: (input: {
    readonly threadId: ThreadId;
    readonly expectedSessionGeneration: string;
    /**
     * Live session generation derived from the authoritative read model at
     * reconciliation time (F3). The enable fails closed unless the expected
     * (captured) token matches it exactly.
     */
    readonly liveSessionGeneration: string | undefined;
  }) => Effect.Effect<ProviderEnableSynaraMcpResult, TError>;

  /**
   * Disable the per-session Synara MCP integration (impl-07): synchronously
   * fence new MCP admission, settle in-flight Pi-facing executions exactly
   * once, cancel/drain the gateway within the bounded window, revoke
   * credentials, clear resources, and reload at the safe boundary — without
   * aborting the Pi turn. Idempotent; adapters without a Synara MCP runtime
   * omit the operation.
   */
  readonly disableSynaraMcp?: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<ProviderDisableSynaraMcpResult, TError>;

  /**
   * Stop and release every resource owned by a thread.
   *
   * This operation is idempotent: an already-stopped or unknown thread is a
   * successful no-op. Callers use it as a cleanup barrier after restarts, when
   * the persisted binding can outlive the adapter's in-memory session.
   */
  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, TError>;

  /**
   * List currently active provider sessions for this adapter.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Check whether this adapter owns an active session id.
   */
  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;

  /**
   * Read a provider thread snapshot.
   */
  readonly readThread: (threadId: ThreadId) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Read a persisted provider thread snapshot without requiring a local app thread binding.
   */
  readonly readExternalThread?: (input: {
    readonly externalThreadId: string;
    readonly cwd?: string;
  }) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Roll back a provider thread by N turns.
   */
  readonly rollbackThread: (
    threadId: ThreadId,
    numTurns: number,
  ) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Trigger provider-native context compaction for a thread when supported.
   */
  readonly compactThread?: (threadId: ThreadId) => Effect.Effect<void, TError>;

  /**
   * Fork one provider thread into another persisted thread cursor when supported.
   *
   * Adapters may omit this to signal that the caller should fall back to
   * conversation-history-only forking.
   */
  readonly forkThread?: (
    input: ProviderForkThreadInput,
  ) => Effect.Effect<ProviderForkThreadResult, TError>;

  /**
   * Stop all sessions owned by this adapter.
   */
  readonly stopAll: () => Effect.Effect<void, TError>;

  /**
   * Canonical runtime event stream emitted by this adapter.
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;

  /**
   * Read provider-specific composer capabilities.
   */
  readonly getComposerCapabilities?: () => Effect.Effect<ProviderComposerCapabilities, TError>;

  /**
   * List skills available for a given cwd.
   */
  readonly listSkills?: (
    input: ProviderListSkillsInput,
  ) => Effect.Effect<ProviderListSkillsResult, TError>;

  /**
   * List provider-native slash commands available for a given cwd.
   */
  readonly listCommands?: (
    input: ProviderListCommandsInput,
  ) => Effect.Effect<ProviderListCommandsResult, TError>;

  /**
   * List plugins available for the current provider/runtime.
   */
  readonly listPlugins?: (
    input: ProviderListPluginsInput,
  ) => Effect.Effect<ProviderListPluginsResult, TError>;

  /**
   * Read one plugin in detail from a marketplace entry.
   */
  readonly readPlugin?: (
    input: ProviderReadPluginInput,
  ) => Effect.Effect<ProviderReadPluginResult, TError>;

  /**
   * List models directly from the provider runtime when supported.
   */
  readonly listModels?: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ProviderListModelsResult, TError>;

  /**
   * List agents/subagents directly from the provider runtime when supported.
   */
  readonly listAgents?: (
    input: ProviderListAgentsInput,
  ) => Effect.Effect<ProviderListAgentsResult, TError>;

  /**
   * Warm provider state needed by voice transcription when supported.
   */
  readonly prewarmVoice?: (
    input: ServerVoicePrewarmInput,
  ) => Effect.Effect<ServerVoicePrewarmResult, TError>;

  /**
   * Transcribe one captured voice clip into plain text when supported.
   */
  readonly transcribeVoice?: (
    input: ServerVoiceTranscriptionInput,
  ) => Effect.Effect<ServerVoiceTranscriptionResult, TError>;
}
