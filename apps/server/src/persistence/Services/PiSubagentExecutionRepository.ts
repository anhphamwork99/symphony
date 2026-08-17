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
}

export class PiSubagentExecutionRepository extends ServiceMap.Service<
  PiSubagentExecutionRepository,
  PiSubagentExecutionRepositoryShape
>()("synara/persistence/Services/PiSubagentExecutionRepository") {}
