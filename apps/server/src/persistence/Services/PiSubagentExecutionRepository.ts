import {
  type PiSubagentCancellationScope,
  type PiSubagentDiagnosticCode,
  type PiSubagentExecutionRecord,
  type PiSubagentLifecycleEvent,
  type PiSubagentLifecycleState,
  type PiSubagentTransportMode,
  type ServerDiagnosticsPiSubagents,
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

/**
 * Ticket 07 terminal evidence input (T07-AC5). The summary is server-bounded
 * before this call; the transcript reference is opaque authorization-scoped.
 */
export interface RecordPiSubagentTerminalEventInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  /** Attempt-local terminal sequence (band 40: child settlement terminals). */
  readonly sequence: number;
  readonly state: "succeeded" | "failed";
  readonly occurredAt: string;
  readonly summary: string;
  readonly transcriptRef?: string | null;
  readonly outcomeState?: string | null;
  readonly diagnosticCode?: PiSubagentDiagnosticCode | null;
  readonly diagnosticMessage?: string | null;
}

/**
 * Ticket 07 terminal ingest outcome. Exactly one state effect per terminal:
 * - `recorded` — first applicable terminal for the CURRENT attempt/generation
 *   (or non-terminal aggregate advancing into that terminal); aggregate and
 *   journal updated atomically.
 * - `already_applied` — exact replay of a previously ingested terminal
 *   (dedup identity: eventId or attempt/generation/sequence key).
 * - `ignored_stale` — journaled as history and counted, but never applied:
 *   either a superseded attempt/generation, or the aggregate already holds an
 *   applicable terminal from a different event (first applicable terminal
 *   wins; no flip-flop, T07-AC2/T07-AC4/T07-AC7).
 */
export type PiSubagentTerminalRecordResult =
  | {
      readonly kind: "recorded";
      readonly event: PiSubagentLifecycleEvent;
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      readonly kind: "already_applied";
      readonly event: PiSubagentLifecycleEvent;
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      readonly kind: "ignored_stale";
      readonly reason:
        | "superseded_attempt"
        | "superseded_generation"
        | "already_terminal_other_event";
      readonly staleTerminalEvents: number;
      readonly execution: PiSubagentExecutionRecord;
    };

/**
 * Ticket 07 attempt-sequence continuity evidence for the terminal ingest
 * (T07-AC3). Reported by the repository layer so the coordinator can emit a
 * stable sequence-gap diagnostic WITHOUT deleting or delaying the terminal.
 */
export interface PiSubagentSequenceContinuity {
  /** True when the ingested event's sequence is > max prior sequence + 1. */
  readonly hasGap: boolean;
  /** Highest sequence previously journaled for this attempt/generation. */
  readonly priorMaxSequence: number | null;
}

/**
 * Ticket 08 completion-outbox creation input (T08-AC1). The summary and
 * transcript reference are the SAME bounded terminal evidence persisted by
 * `recordTerminalEvent` — the outbox never expands bounded terminal evidence
 * into unbounded delivery payloads (Decision 0012 F2 obligation).
 */
export interface RecordPiSubagentCompletionOutboxInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  /** Journal event id of the applicable terminal this entry delivers. */
  readonly terminalEventId: string;
  readonly parentThreadId: string;
  readonly terminalState: "succeeded" | "failed";
  readonly summary: string;
  readonly transcriptRef?: string | null;
  readonly now: string;
}

export type PiSubagentCompletionOutboxRecordResult =
  | {
      readonly kind: "created";
      readonly entry: PiSubagentCompletionOutboxEntry;
    }
  | {
      readonly kind: "already_applied";
      readonly entry: PiSubagentCompletionOutboxEntry;
    };

/** Ticket 08 durable outbox entry (delivery state machine, T08-AC2). */
export type PiSubagentCompletionOutboxEntry = {
  readonly outboxId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly terminalEventId: string;
  readonly parentThreadId: string;
  readonly deliveryState:
    | "pending"
    | "delivered"
    | "acknowledged"
    | "failed_retryable"
    | "superseded";
  readonly terminalState: "succeeded" | "failed";
  readonly summary: string;
  readonly transcriptRef: string | null;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly supersededByGeneration: number | null;
  readonly deliveredAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * Ticket 08 delivery-transition outcomes (T08-AC2/AC5/AC6). Every transition
 * is guarded: an invalid transition is reported, never silently applied, and
 * NO transition mutates the execution aggregate's outcome.
 */
export type PiSubagentCompletionDeliveryTransitionResult =
  | {
      readonly kind: "transitioned";
      readonly entry: PiSubagentCompletionOutboxEntry;
    }
  | {
      readonly kind: "invalid_transition";
      readonly reason: "already_terminal_delivery_state";
      readonly entry: PiSubagentCompletionOutboxEntry;
    }
  | {
      readonly kind: "not_found";
    }
  | {
      readonly kind: "superseded_instead";
      readonly entry: PiSubagentCompletionOutboxEntry;
    };

/**
 * Ticket 10 reconciliation-mode selector (T10-AC7). `restart` reconciles
 * immediately — server process death is owner-loss proof and no in-process
 * child can be proven alive after restart. `lease_expiry` additionally
 * requires the re-derived lease to have been expired for at least the
 * configured orphan threshold before owner-loss settlement.
 */
export type PiSubagentReconciliationMode = "restart" | "lease_expiry";

/**
 * Ticket 10 owner-loss settlement input (T10-AC1). The orphan event is
 * journaled (sequence band 50) and the aggregate becomes non-terminal
 * `orphaned`. The generation advances by one (reconciliation fence, spec
 * Implementation Decision 27) so late events from the orphaned attempt or
 * generation are stale and cannot reverse the settled projection (T10-AC5).
 */
export interface RecordPiSubagentOrphanedEventInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly occurredAt: string;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
  readonly diagnosticMessage: string;
}

/**
 * Ticket 13 wall-time expiry trigger (T13-AC3). Journal-only evidence: the
 * durable escalation trigger consumed by ticket 15's watchdog stages. It
 * NEVER settles the aggregate — observed state is left untouched.
 */
export interface RecordPiSubagentWallTimeExpiryInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly occurredAt: string;
  readonly wallTimeMs: number;
}

export type PiSubagentWallTimeExpiryRecordResult =
  | {
      readonly kind: "recorded";
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      readonly kind: "already_applied";
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      /** The aggregate advanced past the listed attempt/generation — the
       * expiry trigger must not fire for a superseded attempt. */
      readonly kind: "stale_generation";
      readonly execution: PiSubagentExecutionRecord;
    };

export type PiSubagentOrphanedRecordResult =
  | {
      readonly kind: "recorded";
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      readonly kind: "already_applied";
      readonly execution: PiSubagentExecutionRecord;
    }
  | {
      /** The aggregate advanced past the listed attempt/generation (e.g. a
       * concurrent resume admitted a new attempt) — the orphan must not fence
       * the newer attempt. */
      readonly kind: "stale_generation";
      readonly execution: PiSubagentExecutionRecord;
    };

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
  /**
   * Ticket 07 journal-first terminal ingest (T07-AC1/AC2/AC4/AC7). Appends
   * the terminal journal row and applies the aggregate atomically: the first
   * applicable terminal wins; replays are already_applied; superseded or
   * racing terminals are journaled, counted (stale_terminal_events), and
   * never overwrite current truth. Sequence-gap evidence is returned so the
   * caller emits a stable diagnostic (T07-AC3) without deleting or delaying
   * the terminal.
   */
  readonly recordTerminalEvent: (
    input: RecordPiSubagentTerminalEventInput,
  ) => Effect.Effect<
    PiSubagentTerminalRecordResult & { readonly continuity: PiSubagentSequenceContinuity },
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 07 durable terminal evidence reader (bounded summary + transcript
   * reference + stale counter) for projections and reconciliation.
   */
  readonly getTerminalEvidence: (executionId: string) => Effect.Effect<
    Option.Option<{
      readonly terminalSummary: string | null;
      readonly terminalTranscriptRef: string | null;
      readonly staleTerminalEvents: number;
    }>,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 idempotent outbox-entry creation (T08-AC3). Used directly by
   * the journal-first recovery scan and safe to replay: the deterministic
   * outbox identity makes a duplicate create return already_applied.
   */
  readonly recordCompletionOutboxEntry: (
    input: RecordPiSubagentCompletionOutboxInput,
  ) => Effect.Effect<PiSubagentCompletionOutboxRecordResult, PiSubagentExecutionRepositoryError>;
  /** Ticket 08 outbox reader by deterministic identity. */
  readonly getCompletionOutboxEntry: (
    outboxId: string,
  ) => Effect.Effect<
    Option.Option<PiSubagentCompletionOutboxEntry>,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 recoverable-pending scan (T08-AC4): every entry that may still
   * produce a delivery effect — `pending`, plus `failed_retryable` entries
   * within the retry budget — oldest first. Ticket 09 adds the optional
   * `parentThreadId` filter for the per-thread completion coordinator
   * (index `idx_pi_subagent_completion_outbox_thread`).
   */
  readonly listRecoverableCompletionOutbox: (options: {
    readonly retryLimit: number;
    /** Ticket 09 (T09-AC2): restrict the scan to one parent thread. */
    readonly parentThreadId?: string | undefined;
  }) => Effect.Effect<
    ReadonlyArray<PiSubagentCompletionOutboxEntry>,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 terminal journal rows with NO outbox entry (T08-AC1
   * journal-first recovery): pre-102 databases and any crash window between
   * journal commit and outbox creation.
   */
  readonly listTerminalEventsWithoutOutbox: () => Effect.Effect<
    ReadonlyArray<{
      readonly eventId: string;
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
      readonly state: "succeeded" | "failed";
      readonly occurredAt: string;
      readonly summary: string | null;
      readonly transcriptRef: string | null;
      readonly parentThreadId: string;
    }>,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 delivery transition: pending|failed_retryable → delivered
   * (T08-AC2/AC5). Fenced by the CURRENT execution attempt/generation: an
   * entry whose generation is no longer current is superseded instead and
   * produces no delivery effect (T08-AC6).
   */
  readonly markCompletionDelivered: (input: {
    readonly outboxId: string;
    readonly now: string;
  }) => Effect.Effect<
    PiSubagentCompletionDeliveryTransitionResult,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 delivery acknowledgement: delivered → acknowledged (T08-AC5).
   * Acknowledged entries are complete and can no longer produce effects.
   */
  readonly markCompletionAcknowledged: (input: {
    readonly outboxId: string;
    readonly now: string;
  }) => Effect.Effect<
    PiSubagentCompletionDeliveryTransitionResult,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 retryable delivery failure: pending|delivered|failed_retryable
   * → failed_retryable with attempt_count + 1 (T08-AC2/AC5). The execution
   * outcome is NEVER mutated — delivery failure is not execution failure.
   */
  readonly markCompletionDeliveryFailed: (input: {
    readonly outboxId: string;
    readonly now: string;
    readonly error: string;
  }) => Effect.Effect<
    PiSubagentCompletionDeliveryTransitionResult,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 08 supersede (T08-AC6): a newer attempt/generation owns the
   * execution; this entry must never produce a delivery effect while its
   * original execution evidence remains readable.
   */
  readonly markCompletionSuperseded: (input: {
    readonly outboxId: string;
    readonly supersededByGeneration: number;
    readonly now: string;
  }) => Effect.Effect<
    PiSubagentCompletionDeliveryTransitionResult,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 10: every execution whose observed state is non-terminal
   * (`requested`, `accepted`, `queued`, `running`, `cancelling`,
   * `orphaned`) — the restart/lease-expiry reconciliation scan set.
   * `orphaned` is included because it is non-terminal and may still exit
   * through new evidence (T10-AC1 state machine).
   */
  readonly listNonTerminalExecutions: () => Effect.Effect<
    ReadonlyArray<PiSubagentExecutionRecord>,
    PiSubagentExecutionRepositoryError
  >;
  /**
   * Ticket 10 owner-loss settlement (T10-AC1/AC5/AC6): journals the
   * `orphaned` event (band 50, deterministic idempotent eventId), sets the
   * aggregate to non-terminal `orphaned` with the owner-loss diagnostic, and
   * advances the generation by one as the reconciliation fence so late
   * events from the orphaned attempt/generation are ignored and counted.
   * Requires the aggregate to still be on the given attempt/generation.
   */
  readonly recordOrphanedEvent: (
    input: RecordPiSubagentOrphanedEventInput,
  ) => Effect.Effect<PiSubagentOrphanedRecordResult, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 13 wall-time expiry trigger (T13-AC3): journal-only insert
   * (band 60, deterministic idempotent eventId, `pi_subagent_walltime_expired`
   * diagnostic). The aggregate is never mutated — projection is never
   * silently settled; ticket 15's watchdog owns any staged escalation.
   */
  readonly recordWallTimeExpiryEvent: (
    input: RecordPiSubagentWallTimeExpiryInput,
  ) => Effect.Effect<PiSubagentWallTimeExpiryRecordResult, PiSubagentExecutionRepositoryError>;
  /**
   * Ticket 13 operator snapshot (T13-AC4): bounded SQL aggregates only. The
   * result contains no prompt, result, transcript, summary, or secret content.
   */
  readonly getTelemetrySnapshot: (
    now: string,
  ) => Effect.Effect<ServerDiagnosticsPiSubagents, PiSubagentExecutionRepositoryError>;
}

export class PiSubagentExecutionRepository extends ServiceMap.Service<
  PiSubagentExecutionRepository,
  PiSubagentExecutionRepositoryShape
>()("synara/persistence/Services/PiSubagentExecutionRepository") {}
