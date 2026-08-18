import {
  type PiSubagentCancellationScope,
  type PiSubagentDiagnosticCode,
  type PiSubagentExecutionRecord,
  type PiSubagentLifecycleEvent,
  type PiSubagentLifecycleState,
  type PiSubagentTransportMode,
} from "@synara/contracts";
import { type Effect, type Option, ServiceMap } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export type PiSubagentExecutionRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export interface RecordPiSubagentAdmissionInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly commandId: string;
  /**
   * Server-computed ownership fingerprint for the command identity
   * (subject/project/thread/turn/tool scope). Replay dedup is scoped to
   * (commandId, fingerprint), so the same commandId under a different
   * subject/project/thread/turn/tool can never receive another execution's
   * identities — it is deterministically rejected instead.
   */
  readonly commandFingerprint: string;
  /** Extension-supplied correlation id (params.commandId or tool call id). */
  readonly clientCommandId?: string | null;
  /** Trusted canonical principal (McpAuthorityBinding.subject), when known. */
  readonly subject?: string | null;
  readonly projectId: string;
  readonly parentThreadId: string;
  readonly parentTurnId?: string | null;
  readonly parentToolCallId?: string | null;
  readonly agentType: string;
  readonly prompt: string;
  readonly mode?: PiSubagentTransportMode;
  readonly cancellationScope?: PiSubagentCancellationScope;
  readonly state: "accepted" | "rejected";
  readonly diagnosticCode?: PiSubagentDiagnosticCode;
  readonly rejectionReason?: string;
  readonly now: string;
}

export type PiSubagentAdmissionRecordResult =
  | {
      readonly kind: "admitted";
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      readonly kind: "already_applied";
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      /**
       * The commandId already exists under a DIFFERENT ownership scope
       * (fingerprint). Fail-closed: the caller must NOT receive the other
       * execution's identities and must NOT create a duplicate row.
       */
      readonly kind: "command_identity_mismatch";
      readonly commandId: string;
    };

export interface RecordPiSubagentLifecycleEventInput {
  readonly eventId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly state: PiSubagentLifecycleState;
  readonly occurredAt: string;
  readonly diagnosticCode?: PiSubagentDiagnosticCode;
  readonly diagnosticMessage?: string;
  readonly metadataJson?: string | null;
}

export type PiSubagentLifecycleRecordResult =
  | {
      readonly kind: "recorded";
      readonly event: PiSubagentLifecycleEvent;
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      readonly kind: "already_applied";
      readonly event: PiSubagentLifecycleEvent;
      readonly execution: PiSubagentExecutionRecord;
    };

/** Ticket 23 latest-snapshot progress observation (UPDATE-only path). */
export interface RecordPiSubagentProgressObservationInput {
  readonly executionId: string;
  readonly progressJson: string;
  readonly occurredAt: string;
  /** Coalesced-since-flush count added to dropped_progress_count. */
  readonly droppedCountDelta: number;
}

/** Ticket 23 heartbeat lease refresh (UPDATE-only path). */
export interface RecordPiSubagentHeartbeatObservationInput {
  readonly executionId: string;
  readonly occurredAt: string;
  /** Server-computed lease expiry (occurredAt + resolved leaseMs). */
  readonly leaseExpiresAt: string;
}

/** Ticket 23 durable latest observation reader. */
export interface PiSubagentExecutionObservation {
  readonly lastProgressJson: string | null;
  readonly lastProgressAt: string | null;
  readonly droppedProgressCount: number;
  readonly lastHeartbeatAt: string | null;
  readonly leaseExpiresAt: string | null;
}

/**
 * Ticket 06 durable cancellation outcome for one execution in a parent-turn
 * scope. The state machine reports `cancelled` only from termination
 * evidence: a child terminal acknowledgement carrying the expected
 * attempt/generation, or owner-death proof (dead owner generation + expired
 * re-derived lease + listActive no longer contains the execution).
 */
export type PiSubagentCancelExecutionOutcome =
  | {
      readonly kind: "cancelled_ack";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
    }
  | {
      readonly kind: "cancelled_owner_death";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
    }
  | {
      readonly kind: "already_terminal";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
      readonly observedState: PiSubagentLifecycleState;
    }
  | {
      readonly kind: "stale_generation";
      readonly executionId: string;
      readonly expectedAttemptId: string;
      readonly expectedGeneration: number;
      readonly currentAttemptId: string;
      readonly currentGeneration: number;
    }
  | {
      readonly kind: "still_cancelling";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
      readonly diagnosticCode: PiSubagentDiagnosticCode;
      readonly diagnosticMessage: string;
      /** Number of dispatch attempts performed for this execution. */
      readonly dispatchAttempts: number;
      /** True when the provider-turn interrupt escalation stage was applied. */
      readonly escalated: boolean;
    };

export interface RecordPiSubagentCancellationIntentInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly cancelCommandId: string;
  readonly occurredAt: string;
  readonly reason?: string | null;
}

export interface RecordPiSubagentCancelledAckInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly evidenceChannel: "child_ack" | "owner_death";
  readonly diagnosticCode?: PiSubagentDiagnosticCode;
  readonly diagnosticMessage?: string;
}

export interface PiSubagentExecutionRepositoryShape {
  readonly recordAdmission: (
    input: RecordPiSubagentAdmissionInput,
  ) => Effect.Effect<PiSubagentAdmissionRecordResult, PiSubagentExecutionRepositoryError>;
  readonly recordLifecycleEvent: (
    input: RecordPiSubagentLifecycleEventInput,
  ) => Effect.Effect<PiSubagentLifecycleRecordResult, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 23 progress observation: UPDATE-only on the 099 columns, never
   * touches desired/observed state, never inserts journal rows.
   */
  readonly recordProgressObservation: (
    input: RecordPiSubagentProgressObservationInput,
  ) => Effect.Effect<void, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 23 heartbeat observation: UPDATE-only lease refresh, never
   * touches desired/observed state, never inserts journal rows.
   */
  readonly recordHeartbeatObservation: (
    input: RecordPiSubagentHeartbeatObservationInput,
  ) => Effect.Effect<void, PiSubagentExecutionRepositoryError>;
  /** Ticket 23 durable latest-observation reader (reopen restore). */
  readonly getObservation: (
    executionId: string,
  ) => Effect.Effect<
    Option.Option<PiSubagentExecutionObservation>,
    PiSubagentExecutionRepositoryError
  >;
  readonly getById: (
    executionId: string,
  ) => Effect.Effect<Option.Option<PiSubagentExecutionRecord>, PiSubagentExecutionRepositoryError>;
  readonly getByCommandId: (
    commandId: string,
  ) => Effect.Effect<Option.Option<PiSubagentExecutionRecord>, PiSubagentExecutionRepositoryError>;
  readonly listByThreadId: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<PiSubagentExecutionRecord>, PiSubagentExecutionRepositoryError>;
  readonly listJournalEvents: (
    executionId: string,
  ) => Effect.Effect<ReadonlyArray<PiSubagentLifecycleEvent>, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 06: every non-terminal execution declaring the parent-turn
   * cancellation scope for the given thread (both transport modes:
   * foreground-detached and background — T06-AC2).
   */
  readonly listCancellableByParentTurn: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<PiSubagentExecutionRecord>, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 06 journal-first durable cancellation intent (T06-AC1). Records
   * the `cancelling` desired state BEFORE dispatch; replaying the same
   * cancel command identity is idempotent (already_applied) and never
   * re-dispatches.
   */
  readonly recordCancellationIntent: (
    input: RecordPiSubagentCancellationIntentInput,
  ) => Effect.Effect<PiSubagentLifecycleRecordResult, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 06 terminal cancellation settlement from termination evidence
   * (T06-AC4): a child terminal acknowledgement carrying the same
   * attempt/generation, or owner-death proof. Requires the aggregate to still
   * be on that attempt/generation (stale settlements journal as history only).
   */
  readonly recordCancelledAck: (
    input: RecordPiSubagentCancelledAckInput,
  ) => Effect.Effect<PiSubagentLifecycleRecordResult, PiSubagentExecutionRepositoryError>;
}

export class PiSubagentExecutionRepository extends ServiceMap.Service<
  PiSubagentExecutionRepository,
  PiSubagentExecutionRepositoryShape
>()("synara/persistence/Services/PiSubagentExecutionRepository") {}
