import {
  type PiSubagentCancellationScope,
  type PiSubagentDiagnosticCode,
  type PiSubagentExecutionRecord,
  type PiSubagentLifecycleEvent,
  type PiSubagentLifecycleState,
  type PiSubagentTransportMode,
  ProjectId,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { type PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
  type PiSubagentExecutionObservation,
  type PiSubagentCompletionOutboxEntry,

  type PiSubagentCompletionDispatchBatch,
  type PiSubagentCompletionDispatchBatchContent,
  type PiSubagentCompletionDispatchBatchState,
  type PiSubagentCompletionDispatchCreateResult,
  type PiSubagentCompletionDispatchTransitionResult,
  type CreatePiSubagentCompletionDispatchBatchInput,
  type FailPiSubagentCompletionDispatchBatchInput,
  type RejectPiSubagentCompletionDispatchBatchInput,
  type RecordPiSubagentCompletionDispatchAcceptedInput,
  PI_SUBAGENT_COMPLETION_DISPATCH_ACTIVE_STATES,
  type RecordPiSubagentCompletionOutboxInput,
  type RecordPiSubagentAdmissionInput,
  type RecordPiSubagentHeartbeatObservationInput,
  type RecordPiSubagentLifecycleEventInput,
  type RecordPiSubagentProgressObservationInput,
} from "../Services/PiSubagentExecutionRepository.ts";

interface ExecutionRow {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly commandId: string;
  readonly commandFingerprint: string;
  readonly clientCommandId: string | null;
  readonly subject: string | null;
  readonly projectId: string;
  readonly parentThreadId: string;
  readonly parentTurnId: string | null;
  readonly parentToolCallId: string | null;
  readonly agentType: string;
  readonly prompt: string;
  readonly mode: PiSubagentTransportMode;
  readonly cancellationScope: PiSubagentCancellationScope;
  readonly desiredState: PiSubagentLifecycleState;
  readonly observedState: PiSubagentLifecycleState;
  readonly diagnosticCode: PiSubagentDiagnosticCode | null;
  readonly rejectionReason: string | null;
  readonly firstAttemptId: string | null;
  readonly firstAttemptGeneration: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface JournalRow {
  readonly eventId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly state: PiSubagentLifecycleState;
  readonly occurredAt: string;
  readonly diagnosticCode: PiSubagentDiagnosticCode | null;
  readonly diagnosticMessage: string | null;
  readonly metadataJson: string | null;
}

function rowToExecutionRecord(row: ExecutionRow): PiSubagentExecutionRecord {
  return {
    executionId: row.executionId,
    attemptId: row.attemptId,
    generation: row.generation,
    commandId: row.commandId,
    projectId: row.projectId as ProjectId,
    parentThreadId: row.parentThreadId as ThreadId,
    parentTurnId: (row.parentTurnId as TurnId) ?? null,
    parentToolCallId: row.parentToolCallId ?? null,
    agentType: row.agentType,
    prompt: row.prompt,
    mode: row.mode,
    cancellationScope: row.cancellationScope,
    desiredState: row.desiredState,
    observedState: row.observedState,
    diagnosticCode: row.diagnosticCode ?? undefined,
    rejectionReason: row.rejectionReason ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const executionColumns = (sql: SqlClient.SqlClient) => sql`
  execution_id AS "executionId",
  attempt_id AS "attemptId",
  generation,
  command_id AS "commandId",
  command_fingerprint AS "commandFingerprint",
  client_command_id AS "clientCommandId",
  subject,
  project_id AS "projectId",
  parent_thread_id AS "parentThreadId",
  parent_turn_id AS "parentTurnId",
  parent_tool_call_id AS "parentToolCallId",
  agent_type AS "agentType",
  prompt,
  mode,
  cancellation_scope AS "cancellationScope",
  desired_state AS "desiredState",
  observed_state AS "observedState",
  diagnostic_code AS "diagnosticCode",
  rejection_reason AS "rejectionReason",
  first_attempt_id AS "firstAttemptId",
  first_attempt_generation AS "firstAttemptGeneration",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

interface ObservationRow {
  readonly lastProgressJson: string | null;
  readonly lastProgressAt: string | null;
  readonly droppedProgressCount: number;
  readonly lastHeartbeatAt: string | null;
  readonly leaseExpiresAt: string | null;
}

interface TerminalEvidenceRow {
  readonly terminalSummary: string | null;
  readonly terminalTranscriptRef: string | null;
  readonly staleTerminalEvents: number;
}

interface TelemetrySnapshotRow {
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly cancellingCount: number;
  readonly orphanedCount: number;
  readonly terminalCount: number;
  readonly leaseExpiryCount: number;
  readonly detachP50Ms: number;
  readonly detachP95Ms: number;
  readonly detachMaxMs: number;
  readonly cancelP50Ms: number;
  readonly cancelP95Ms: number;
  readonly cancelMaxMs: number;
  readonly progressCoalesced: number;
  readonly completionRetries: number;
}

/** Ticket 08 completion-outbox row (delivery state machine, T08-AC2). */
interface OutboxRow {
  readonly outboxId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly terminalEventId: string;
  readonly parentThreadId: string;
  readonly deliveryState: PiSubagentCompletionOutboxEntry["deliveryState"];
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
  /** Decision 0016 batch-membership association (nullable). */
  readonly dispatchBatchId: string | null;
}

const TERMINAL_OBSERVED_STATES = new Set(["cancelled", "succeeded", "failed", "rejected"]);

const telemetryMetric = (value: number | undefined): number =>
  Math.max(0, Math.round(Number.isFinite(value) ? (value ?? 0) : 0));

export const makePiSubagentExecutionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /**
   * Replay dedup lookup. The command identity is scoped by its ownership
   * fingerprint: a redelivery of the same commandId under the SAME scope
   * resolves to the original execution, while the same commandId under a
   * different scope resolves to nothing (and is rejected by the caller — it
   * must never receive another execution's identities).
   */
  const getByCommandIdInternal = (commandId: string, commandFingerprint?: string) =>
    sql<ExecutionRow>`
      SELECT ${executionColumns(sql)}
      FROM pi_subagent_executions
      WHERE command_id = ${commandId}
        ${commandFingerprint === undefined ? sql`` : sql`AND command_fingerprint = ${commandFingerprint}`}
      LIMIT 1
    `;

  const getByIdInternal = (executionId: string) =>
    sql<ExecutionRow>`
      SELECT ${executionColumns(sql)}
      FROM pi_subagent_executions
      WHERE execution_id = ${executionId}
      LIMIT 1
    `;

  const recordAdmission: PiSubagentExecutionRepositoryShape["recordAdmission"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existingRows = yield* getByCommandIdInternal(
            input.commandId,
            input.commandFingerprint,
          );

          if (existingRows.length > 0) {
            const existing = rowToExecutionRecord(existingRows[0]!);
            return {
              kind: "already_applied" as const,
              execution: existing,
            };
          }

          const eventId = crypto.randomUUID();
          const mode = input.mode ?? "foreground";
          const cancellationScope = input.cancellationScope ?? "parent_turn";
          const desiredState = input.state === "rejected" ? "rejected" : "running";
          const parentTurnId = input.parentTurnId ?? null;
          const parentToolCallId = input.parentToolCallId ?? null;
          const diagnosticCode = input.diagnosticCode ?? null;
          const rejectionReason = input.rejectionReason ?? null;
          const clientCommandId = input.clientCommandId ?? null;
          const subject = input.subject ?? null;

          // Atomic insert into lifecycle journal and executions: either both
          // the sequence-1 journal event and the execution aggregate commit,
          // or neither becomes visible (T20-AC2).
          yield* sql`
            INSERT INTO pi_subagent_lifecycle_journal (
              event_id,
              execution_id,
              attempt_id,
              generation,
              sequence,
              state,
              occurred_at,
              diagnostic_code,
              diagnostic_message,
              metadata_json
            ) VALUES (
              ${eventId},
              ${input.executionId},
              ${input.attemptId},
              ${input.generation},
              ${1},
              ${input.state},
              ${input.now},
              ${diagnosticCode},
              ${rejectionReason},
              ${null}
            )
          `;

          yield* sql`
            INSERT INTO pi_subagent_executions (
              execution_id,
              attempt_id,
              generation,
              command_id,
              command_fingerprint,
              client_command_id,
              subject,
              project_id,
              parent_thread_id,
              parent_turn_id,
              parent_tool_call_id,
              agent_type,
              prompt,
              mode,
              cancellation_scope,
              desired_state,
              observed_state,
              diagnostic_code,
              rejection_reason,
              first_attempt_id,
              first_attempt_generation,
              created_at,
              updated_at
            ) VALUES (
              ${input.executionId},
              ${input.attemptId},
              ${input.generation},
              ${input.commandId},
              ${input.commandFingerprint},
              ${clientCommandId},
              ${subject},
              ${input.projectId},
              ${input.parentThreadId},
              ${parentTurnId},
              ${parentToolCallId},
              ${input.agentType},
              ${input.prompt},
              ${mode},
              ${cancellationScope},
              ${desiredState},
              ${input.state},
              ${diagnosticCode},
              ${rejectionReason},
              ${input.attemptId},
              ${input.generation},
              ${input.now},
              ${input.now}
            )
          `;

          const createdRecord: PiSubagentExecutionRecord = {
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            commandId: input.commandId,
            projectId: input.projectId as ProjectId,
            parentThreadId: input.parentThreadId as ThreadId,
            parentTurnId: (parentTurnId as TurnId) ?? null,
            parentToolCallId,
            agentType: input.agentType,
            prompt: input.prompt,
            mode,
            cancellationScope,
            desiredState,
            observedState: input.state,
            diagnosticCode: input.diagnosticCode ?? undefined,
            rejectionReason: input.rejectionReason ?? undefined,
            createdAt: input.now,
            updatedAt: input.now,
          };

          return {
            kind: "admitted" as const,
            execution: createdRecord,
          };
        }),
      )
      .pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            // Concurrent race on the command_id unique constraint: re-check the
            // scoped dedup first (same identity → already_applied), then the
            // unscoped key. A row under a DIFFERENT ownership fingerprint is a
            // deterministic fail-closed mismatch, never another execution's
            // identities; anything else is a genuine persistence failure.
            const scopedRows = yield* getByCommandIdInternal(
              input.commandId,
              input.commandFingerprint,
            ).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordAdmission:dedup-recheck-scoped",
                ),
              ),
            );
            if (scopedRows.length > 0) {
              return {
                kind: "already_applied" as const,
                execution: rowToExecutionRecord(scopedRows[0]!),
              };
            }
            const anyScopeRows = yield* getByCommandIdInternal(input.commandId).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordAdmission:dedup-recheck-unscoped",
                ),
              ),
            );
            if (anyScopeRows.length > 0) {
              return {
                kind: "command_identity_mismatch" as const,
                commandId: input.commandId,
              };
            }
            return yield* Effect.fail(
              toPersistenceSqlError("PiSubagentExecutionRepository.recordAdmission:insert")(err),
            );
          }),
        ),
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.recordAdmission:insert"),
        ),
      );

  const recordLifecycleEvent: PiSubagentExecutionRepositoryShape["recordLifecycleEvent"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          // Dedup by event identity OR the attempt/generation-local sequence
          // key. There is deliberately NO (execution_id, sequence) fallback:
          // sequence restarts at 1 for a future attempt/generation (T20-AC4).
          const existingEventRows = yield* sql<JournalRow>`
            SELECT
              event_id AS "eventId",
              execution_id AS "executionId",
              attempt_id AS "attemptId",
              generation,
              sequence,
              state,
              occurred_at AS "occurredAt",
              diagnostic_code AS "diagnosticCode",
              diagnostic_message AS "diagnosticMessage",
              metadata_json AS "metadataJson"
            FROM pi_subagent_lifecycle_journal
            WHERE event_id = ${input.eventId}
               OR (
                 execution_id = ${input.executionId}
                 AND attempt_id = ${input.attemptId}
                 AND generation = ${input.generation}
                 AND sequence = ${input.sequence}
               )
            LIMIT 1
          `;

          const executionRows = yield* getByIdInternal(input.executionId);
          if (executionRows.length === 0) {
            return yield* Effect.fail(
              toPersistenceSqlError(
                "PiSubagentExecutionRepository.recordLifecycleEvent:execution-lookup",
              )(new Error(`Execution '${input.executionId}' not found`)),
            );
          }

          const currentExecution = executionRows[0]!;

          if (existingEventRows.length > 0) {
            const row = existingEventRows[0]!;
            const event: PiSubagentLifecycleEvent = {
              eventId: row.eventId,
              executionId: row.executionId,
              attemptId: row.attemptId,
              generation: row.generation,
              sequence: row.sequence,
              state: row.state,
              occurredAt: row.occurredAt,
              parentThreadId: currentExecution.parentThreadId as ThreadId,
              parentTurnId: (currentExecution.parentTurnId as TurnId) ?? null,
              parentToolCallId: currentExecution.parentToolCallId ?? null,
              projectId: currentExecution.projectId as ProjectId,
              diagnosticCode: row.diagnosticCode ?? undefined,
              diagnosticMessage: row.diagnosticMessage ?? undefined,
              metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
            };
            return {
              kind: "already_applied" as const,
              event,
              execution: rowToExecutionRecord(currentExecution),
            };
          }

          const diagnosticCode = input.diagnosticCode ?? null;
          const diagnosticMessage = input.diagnosticMessage ?? null;
          const metadataJson = input.metadataJson ?? null;

          yield* sql`
            INSERT INTO pi_subagent_lifecycle_journal (
              event_id,
              execution_id,
              attempt_id,
              generation,
              sequence,
              state,
              occurred_at,
              diagnostic_code,
              diagnostic_message,
              metadata_json
            ) VALUES (
              ${input.eventId},
              ${input.executionId},
              ${input.attemptId},
              ${input.generation},
              ${input.sequence},
              ${input.state},
              ${input.occurredAt},
              ${diagnosticCode},
              ${diagnosticMessage},
              ${metadataJson}
            )
          `;

          // Aggregate advancement is generation-gated: a late event from a
          // stale attempt/generation is journaled as history but never
          // regresses the current aggregate (spec: late events must not
          // overwrite current truth).
          if (input.generation >= currentExecution.generation) {
            // Ticket 06: a `cancelling` journal event is durable INTENT, not
            // termination — desired stays `cancelling` until a `cancelled`
            // terminal event arrives with evidence (T06-AC4). The legacy
            // premature mapping of cancelling→cancelled(desired) is removed;
            // terminal states map desired=state as before.
            const inputIsTerminal =
              input.state === "cancelled" ||
              input.state === "failed" ||
              input.state === "succeeded" ||
              input.state === "rejected";
            const aggregateAlreadyTerminal = TERMINAL_OBSERVED_STATES.has(
              currentExecution.observedState,
            );
            const nextDesired =
              input.state === "cancelling"
                ? "cancelling"
                : inputIsTerminal
                  ? input.state
                  : currentExecution.desiredState;

            // Ticket 07: a terminal event through the generic lifecycle path
            // must never overwrite an already-terminal aggregate — the first
            // applicable terminal wins (T07-AC2/T07-AC7). Such a terminal is
            // journaled as history only (the journal insert above stands);
            // the dedicated recordTerminalEvent seam additionally counts it.
            if (inputIsTerminal && aggregateAlreadyTerminal) {
              // No aggregate mutation: first applicable terminal stays owner.
            } else {
              yield* sql`
                UPDATE pi_subagent_executions
                SET
                  attempt_id = ${input.attemptId},
                  generation = ${input.generation},
                  observed_state = ${input.state},
                  desired_state = ${nextDesired},
                  diagnostic_code = ${diagnosticCode},
                  rejection_reason = ${diagnosticMessage},
                  updated_at = ${input.occurredAt}
                WHERE execution_id = ${input.executionId}
              `;
            }
          }

          const updatedExecutionRows = yield* getByIdInternal(input.executionId);
          const updatedExecution = rowToExecutionRecord(
            updatedExecutionRows[0] ?? currentExecution,
          );

          const event: PiSubagentLifecycleEvent = {
            eventId: input.eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
            state: input.state,
            occurredAt: input.occurredAt,
            parentThreadId: updatedExecution.parentThreadId,
            parentTurnId: updatedExecution.parentTurnId,
            parentToolCallId: updatedExecution.parentToolCallId,
            projectId: updatedExecution.projectId,
            diagnosticCode: input.diagnosticCode,
            diagnosticMessage: input.diagnosticMessage,
            metadata: metadataJson ? JSON.parse(metadataJson) : undefined,
          };

          return {
            kind: "recorded" as const,
            event,
            execution: updatedExecution,
          };
        }),
      )
      .pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            const existingEventRows = yield* sql<JournalRow>`
              SELECT
                event_id AS "eventId",
                execution_id AS "executionId",
                attempt_id AS "attemptId",
                generation,
                sequence,
                state,
                occurred_at AS "occurredAt",
                diagnostic_code AS "diagnosticCode",
                diagnostic_message AS "diagnosticMessage",
                metadata_json AS "metadataJson"
              FROM pi_subagent_lifecycle_journal
              WHERE event_id = ${input.eventId}
                 OR (
                   execution_id = ${input.executionId}
                   AND attempt_id = ${input.attemptId}
                   AND generation = ${input.generation}
                   AND sequence = ${input.sequence}
                 )
              LIMIT 1
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordLifecycleEvent:dedup-recheck",
                ),
              ),
            );

            const executionRows = yield* getByIdInternal(input.executionId).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordLifecycleEvent:execution-recheck",
                ),
              ),
            );

            if (existingEventRows.length > 0 && executionRows.length > 0) {
              const row = existingEventRows[0]!;
              const currentExecution = executionRows[0]!;
              const event: PiSubagentLifecycleEvent = {
                eventId: row.eventId,
                executionId: row.executionId,
                attemptId: row.attemptId,
                generation: row.generation,
                sequence: row.sequence,
                state: row.state,
                occurredAt: row.occurredAt,
                parentThreadId: currentExecution.parentThreadId as ThreadId,
                parentTurnId: (currentExecution.parentTurnId as TurnId) ?? null,
                parentToolCallId: currentExecution.parentToolCallId ?? null,
                projectId: currentExecution.projectId as ProjectId,
                diagnosticCode: row.diagnosticCode ?? undefined,
                diagnosticMessage: row.diagnosticMessage ?? undefined,
                metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
              };
              return {
                kind: "already_applied" as const,
                event,
                execution: rowToExecutionRecord(currentExecution),
              };
            }
            return yield* Effect.fail(
              toPersistenceSqlError("PiSubagentExecutionRepository.recordLifecycleEvent:insert")(
                err,
              ),
            );
          }),
        ),
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.recordLifecycleEvent:insert"),
        ),
      );

  // ---------------------------------------------------------------------
  // Ticket 23 observation paths. These are deliberately UPDATE-only with NO
  // transaction, NO journal insert, and NO aggregate-state mutation: progress
  // and heartbeat are observation, not control truth (T23-AC3/AC4).
  // ---------------------------------------------------------------------

  const getObservationInternal = (executionId: string) =>
    sql<ObservationRow>`
      SELECT
        last_progress_json AS "lastProgressJson",
        last_progress_at AS "lastProgressAt",
        dropped_progress_count AS "droppedProgressCount",
        last_heartbeat_at AS "lastHeartbeatAt",
        lease_expires_at AS "leaseExpiresAt"
      FROM pi_subagent_executions
      WHERE execution_id = ${executionId}
      LIMIT 1
    `;

  const recordProgressObservation: PiSubagentExecutionRepositoryShape["recordProgressObservation"] =
    (input) =>
      Effect.gen(function* () {
        const updatedRows = yield* sql<{
          readonly execution_id: string;
        }>`
          UPDATE pi_subagent_executions
          SET
            last_progress_json = ${input.progressJson},
            last_progress_at = ${input.occurredAt},
            dropped_progress_count = dropped_progress_count + ${input.droppedCountDelta},
            updated_at = ${input.occurredAt}
          WHERE execution_id = ${input.executionId}
          RETURNING execution_id
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError("PiSubagentExecutionRepository.recordProgressObservation:update"),
          ),
        );
        if (updatedRows.length === 0) {
          return yield* Effect.fail(
            toPersistenceSqlError("PiSubagentExecutionRepository.recordProgressObservation:update")(
              new Error(`Execution '${input.executionId}' not found for progress observation`),
            ),
          );
        }
      });

  const recordHeartbeatObservation: PiSubagentExecutionRepositoryShape["recordHeartbeatObservation"] =
    (input) =>
      Effect.gen(function* () {
        const updatedRows = yield* sql<{
          readonly execution_id: string;
        }>`
          UPDATE pi_subagent_executions
          SET
            last_heartbeat_at = ${input.occurredAt},
            lease_expires_at = ${input.leaseExpiresAt},
            updated_at = ${input.occurredAt}
          WHERE execution_id = ${input.executionId}
          RETURNING execution_id
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.recordHeartbeatObservation:update",
            ),
          ),
        );
        if (updatedRows.length === 0) {
          return yield* Effect.fail(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.recordHeartbeatObservation:update",
            )(new Error(`Execution '${input.executionId}' not found for heartbeat observation`)),
          );
        }
      });

  const getObservation: PiSubagentExecutionRepositoryShape["getObservation"] = (executionId) =>
    Effect.gen(function* () {
      const rows = yield* getObservationInternal(executionId).pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.getObservation:query"),
        ),
      );
      if (rows.length === 0) {
        return Option.none();
      }
      const row = rows[0]!;
      const observation: PiSubagentExecutionObservation = {
        lastProgressJson: row.lastProgressJson ?? null,
        lastProgressAt: row.lastProgressAt ?? null,
        droppedProgressCount:
          typeof row.droppedProgressCount === "number" ? row.droppedProgressCount : 0,
        lastHeartbeatAt: row.lastHeartbeatAt ?? null,
        leaseExpiresAt: row.leaseExpiresAt ?? null,
      };
      return Option.some(observation);
    });

  const getById: PiSubagentExecutionRepositoryShape["getById"] = (executionId) =>
    Effect.gen(function* () {
      const rows = yield* getByIdInternal(executionId).pipe(
        Effect.mapError(toPersistenceSqlError("PiSubagentExecutionRepository.getById:query")),
      );
      return rows.length > 0 ? Option.some(rowToExecutionRecord(rows[0]!)) : Option.none();
    });

  const getByCommandId: PiSubagentExecutionRepositoryShape["getByCommandId"] = (commandId) =>
    Effect.gen(function* () {
      const rows = yield* getByCommandIdInternal(commandId).pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.getByCommandId:query"),
        ),
      );
      return rows.length > 0 ? Option.some(rowToExecutionRecord(rows[0]!)) : Option.none();
    });

  const listByThreadId: PiSubagentExecutionRepositoryShape["listByThreadId"] = (threadId) =>
    Effect.gen(function* () {
      const rows = yield* sql<ExecutionRow>`
        SELECT ${executionColumns(sql)}
        FROM pi_subagent_executions
        WHERE parent_thread_id = ${threadId}
        ORDER BY created_at ASC
      `.pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.listByThreadId:query"),
        ),
      );

      return rows.map(rowToExecutionRecord);
    });

  // ---------------------------------------------------------------------
  // Ticket 06 durable parent-turn cancellation paths.
  // ---------------------------------------------------------------------

  const listCancellableByParentTurn: PiSubagentExecutionRepositoryShape["listCancellableByParentTurn"] =
    (threadId) =>
      Effect.gen(function* () {
        const rows = yield* sql<ExecutionRow>`
          SELECT ${executionColumns(sql)}
          FROM pi_subagent_executions
          WHERE parent_thread_id = ${threadId}
            AND cancellation_scope = 'parent_turn'
            AND observed_state IN (
              'requested', 'accepted', 'queued', 'running', 'cancelling', 'orphaned'
            )
          ORDER BY created_at ASC
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.listCancellableByParentTurn:query",
            ),
          ),
        );
        return rows.map(rowToExecutionRecord);
      });

  const makeJournalInsert = (input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly sequence: number;
    readonly state: PiSubagentLifecycleState;
    readonly occurredAt: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode | null;
    readonly diagnosticMessage: string | null;
    readonly metadataJson: string | null;
  }) =>
    sql`
      INSERT INTO pi_subagent_lifecycle_journal (
        event_id,
        execution_id,
        attempt_id,
        generation,
        sequence,
        state,
        occurred_at,
        diagnostic_code,
        diagnostic_message,
        metadata_json
      ) VALUES (
        ${input.eventId},
        ${input.executionId},
        ${input.attemptId},
        ${input.generation},
        ${input.sequence},
        ${input.state},
        ${input.occurredAt},
        ${input.diagnosticCode},
        ${input.diagnosticMessage},
        ${input.metadataJson}
      )
    `;

  const lookupJournalEvent = (input: {
    readonly eventId: string;
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly sequence: number;
  }) =>
    sql<JournalRow>`
      SELECT
        event_id AS "eventId",
        execution_id AS "executionId",
        attempt_id AS "attemptId",
        generation,
        sequence,
        state,
        occurred_at AS "occurredAt",
        diagnostic_code AS "diagnosticCode",
        diagnostic_message AS "diagnosticMessage",
        metadata_json AS "metadataJson"
      FROM pi_subagent_lifecycle_journal
      WHERE event_id = ${input.eventId}
         OR (
           execution_id = ${input.executionId}
           AND attempt_id = ${input.attemptId}
           AND generation = ${input.generation}
           AND sequence = ${input.sequence}
         )
      LIMIT 1
    `;

  const journalRowToEvent = (
    row: JournalRow,
    execution: PiSubagentExecutionRecord,
  ): PiSubagentLifecycleEvent => ({
    eventId: row.eventId,
    executionId: row.executionId,
    attemptId: row.attemptId,
    generation: row.generation,
    sequence: row.sequence,
    state: row.state,
    occurredAt: row.occurredAt,
    parentThreadId: execution.parentThreadId,
    parentTurnId: execution.parentTurnId,
    parentToolCallId: execution.parentToolCallId,
    projectId: execution.projectId,
    diagnosticCode: row.diagnosticCode ?? undefined,
    diagnosticMessage: row.diagnosticMessage ?? undefined,
    metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
  });

  /**
   * Ticket 06 journal-first cancellation intent (T06-AC1). The `cancelling`
   * event is written BEFORE any dispatch; the desired state on the aggregate
   * becomes `cancelling` (never `cancelled` — that requires termination
   * evidence). Idempotency: the dedup identity is the deterministic eventId
   * `cancel_<cancelCommandId>` plus the attempt/generation sequence key, so a
   * replayed cancel command returns already_applied WITHOUT re-dispatching.
   */
  const recordCancellationIntent: PiSubagentExecutionRepositoryShape["recordCancellationIntent"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const eventId = `cancel_${input.cancelCommandId}`;
          const metadataJson = JSON.stringify({
            phase: "cancelling",
            cancelCommandId: input.cancelCommandId,
            reason: input.reason ?? null,
          });

          const existing = yield* lookupJournalEvent({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
          });
          const executionRows = yield* getByIdInternal(input.executionId);
          if (executionRows.length === 0) {
            return yield* Effect.fail(
              toPersistenceSqlError(
                "PiSubagentExecutionRepository.recordCancellationIntent:execution-lookup",
              )(new Error(`Execution '${input.executionId}' not found`)),
            );
          }
          const execution = rowToExecutionRecord(executionRows[0]!);

          if (existing.length > 0) {
            return {
              kind: "already_applied" as const,
              event: journalRowToEvent(existing[0]!, execution),
              execution,
            };
          }

          yield* makeJournalInsert({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
            state: "cancelling",
            occurredAt: input.occurredAt,
            diagnosticCode: null,
            diagnosticMessage: input.reason ?? null,
            metadataJson,
          });

          // Generation-gated aggregate advance: desired → cancelling only
          // when this intent targets the CURRENT attempt/generation. A stale
          // intent (older generation) journals as history without touching
          // the newer attempt's truth (T06-AC3).
          if (input.generation >= execution.generation) {
            yield* sql`
                UPDATE pi_subagent_executions
                SET
                  desired_state = 'cancelling',
                  updated_at = ${input.occurredAt}
                WHERE execution_id = ${input.executionId}
                  AND desired_state NOT IN ('cancelled', 'succeeded', 'failed', 'rejected')
              `;
          }

          const refreshedRows = yield* getByIdInternal(input.executionId);
          const refreshed = rowToExecutionRecord(refreshedRows[0] ?? executionRows[0]!);
          return {
            kind: "recorded" as const,
            event: journalRowToEvent(
              {
                eventId,
                executionId: input.executionId,
                attemptId: input.attemptId,
                generation: input.generation,
                sequence: input.sequence,
                state: "cancelling",
                occurredAt: input.occurredAt,
                diagnosticCode: null,
                diagnosticMessage: input.reason ?? null,
                metadataJson,
              },
              refreshed,
            ),
            execution: refreshed,
          };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.recordCancellationIntent:insert"),
        ),
      );

  /**
   * Ticket 06 terminal cancellation settlement (T06-AC4). Requires the
   * aggregate to still be on the acknowledged attempt/generation; a late
   * stale settlement journals as history only and does not regress a newer
   * attempt (T06-AC3).
   */
  const recordCancelledAck: PiSubagentExecutionRepositoryShape["recordCancelledAck"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const eventId = `cancel_ack_${input.executionId}_${input.attemptId}_gen${input.generation}`;
          const metadataJson = JSON.stringify({
            phase: "cancelled",
            evidenceChannel: input.evidenceChannel,
          });

          const existing = yield* lookupJournalEvent({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
          });
          const executionRows = yield* getByIdInternal(input.executionId);
          if (executionRows.length === 0) {
            return yield* Effect.fail(
              toPersistenceSqlError(
                "PiSubagentExecutionRepository.recordCancelledAck:execution-lookup",
              )(new Error(`Execution '${input.executionId}' not found`)),
            );
          }
          const execution = rowToExecutionRecord(executionRows[0]!);

          if (existing.length > 0) {
            return {
              kind: "already_applied" as const,
              event: journalRowToEvent(existing[0]!, execution),
              execution,
            };
          }

          yield* makeJournalInsert({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
            state: "cancelled",
            occurredAt: input.occurredAt,
            diagnosticCode: input.diagnosticCode ?? null,
            diagnosticMessage: input.diagnosticMessage ?? null,
            metadataJson,
          });

          // Terminal settlement requires the SAME attempt/generation to still
          // be current: a stale late settlement cannot affect a newer attempt
          // (T06-AC3) and a terminal aggregate never regresses.
          if (
            input.generation === execution.generation &&
            input.attemptId === execution.attemptId
          ) {
            yield* sql`
              UPDATE pi_subagent_executions
              SET
                observed_state = 'cancelled',
                desired_state = 'cancelled',
                diagnostic_code = ${input.diagnosticCode ?? null},
                updated_at = ${input.occurredAt}
              WHERE execution_id = ${input.executionId}
                AND observed_state NOT IN ('cancelled', 'succeeded', 'failed', 'rejected')
            `;
          }

          const refreshedRows = yield* getByIdInternal(input.executionId);
          const refreshed = rowToExecutionRecord(refreshedRows[0] ?? executionRows[0]!);
          return {
            kind: "recorded" as const,
            event: journalRowToEvent(
              {
                eventId,
                executionId: input.executionId,
                attemptId: input.attemptId,
                generation: input.generation,
                sequence: input.sequence,
                state: "cancelled",
                occurredAt: input.occurredAt,
                diagnosticCode: input.diagnosticCode ?? null,
                diagnosticMessage: input.diagnosticMessage ?? null,
                metadataJson,
              },
              refreshed,
            ),
            execution: refreshed,
          };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.recordCancelledAck:insert"),
        ),
      );

  /**
   * Ticket 07 journal-first terminal ingest (T07-AC1/AC2/AC4/AC7).
   *
   * One transaction, in order: dedup lookup → execution lookup → sequence
   * continuity evidence → journal insert → guarded aggregate UPDATE. The
   * first applicable terminal for the CURRENT attempt/generation wins and
   * the UPDATE applies only when the aggregate is not already terminal;
   * stale/racing terminals increment the durable stale counter and never
   * mutate truth. Sequence gaps are REPORTED (continuity), never repaired,
   * deleted, or delayed (T07-AC3).
   */
  const recordTerminalEvent: PiSubagentExecutionRepositoryShape["recordTerminalEvent"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const eventId = `terminal_${input.executionId}_${input.attemptId}_gen${input.generation}_${input.state}`;
          const metadataJson = JSON.stringify({
            phase: "terminal",
            summary: input.summary,
            ...(input.transcriptRef !== undefined && input.transcriptRef !== null
              ? { transcriptRef: input.transcriptRef }
              : {}),
            ...(input.outcomeState !== undefined && input.outcomeState !== null
              ? { outcomeState: input.outcomeState }
              : {}),
          });

          const existing = yield* lookupJournalEvent({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
          });
          const executionRows = yield* getByIdInternal(input.executionId);
          if (executionRows.length === 0) {
            return yield* Effect.fail(
              toPersistenceSqlError(
                "PiSubagentExecutionRepository.recordTerminalEvent:execution-lookup",
              )(new Error(`Execution '${input.executionId}' not found`)),
            );
          }
          const execution = rowToExecutionRecord(executionRows[0]!);

          // Sequence continuity evidence (T07-AC3): attempt/generation-local
          // prior max. Computed BEFORE the insert so the gap signal describes
          // the ingest, not the post-state.
          const priorMaxRows = yield* sql<{ readonly maxSequence: number | null }>`
              SELECT MAX(sequence) AS "maxSequence"
              FROM pi_subagent_lifecycle_journal
              WHERE execution_id = ${input.executionId}
                AND attempt_id = ${input.attemptId}
                AND generation = ${input.generation}
            `;
          const priorMaxSequence = priorMaxRows[0]?.maxSequence ?? null;
          const hasGap = priorMaxSequence !== null && input.sequence > priorMaxSequence + 1;
          const continuity = { hasGap, priorMaxSequence };

          if (existing.length > 0) {
            return {
              kind: "already_applied" as const,
              event: journalRowToEvent(existing[0]!, execution),
              execution,
              continuity,
            };
          }

          yield* makeJournalInsert({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence: input.sequence,
            state: input.state,
            occurredAt: input.occurredAt,
            diagnosticCode: input.diagnosticCode ?? null,
            diagnosticMessage: input.diagnosticMessage ?? null,
            metadataJson,
          });

          // Stale classification BEFORE any aggregate mutation.
          const supersededAttempt = input.attemptId !== execution.attemptId;
          const supersededGeneration = input.generation < execution.generation;
          const alreadyTerminal = TERMINAL_OBSERVED_STATES.has(execution.observedState);

          if (supersededAttempt || supersededGeneration) {
            // Journaled as history + counted; never overwrites current
            // truth (T07-AC4).
            const counted = yield* sql<{ readonly stale: number }>`
                UPDATE pi_subagent_executions
                SET stale_terminal_events = stale_terminal_events + 1,
                    updated_at = ${input.occurredAt}
                WHERE execution_id = ${input.executionId}
                RETURNING stale_terminal_events AS "stale"
              `;
            const refreshed = yield* getByIdInternal(input.executionId);
            const reason: "superseded_attempt" | "superseded_generation" = supersededAttempt
              ? "superseded_attempt"
              : "superseded_generation";
            return {
              kind: "ignored_stale" as const,
              reason,
              staleTerminalEvents: counted[0]?.stale ?? 1,
              execution: rowToExecutionRecord(refreshed[0] ?? executionRows[0]!),
              continuity,
            };
          }

          if (alreadyTerminal) {
            // First applicable terminal already owns the aggregate (a
            // durable `cancelled` from the cancel coordinator, or another
            // terminal). This terminal is history + counted (T07-AC7).
            const counted = yield* sql<{ readonly stale: number }>`
                UPDATE pi_subagent_executions
                SET stale_terminal_events = stale_terminal_events + 1,
                    updated_at = ${input.occurredAt}
                WHERE execution_id = ${input.executionId}
                RETURNING stale_terminal_events AS "stale"
              `;
            const refreshed = yield* getByIdInternal(input.executionId);
            return {
              kind: "ignored_stale" as const,
              reason: "already_terminal_other_event" as const,
              staleTerminalEvents: counted[0]?.stale ?? 1,
              execution: rowToExecutionRecord(refreshed[0] ?? executionRows[0]!),
              continuity,
            };
          }

          // First applicable terminal: applied atomically with the journal
          // insert (single transaction). observed+desired both settle.
          yield* sql`
              UPDATE pi_subagent_executions
              SET
                attempt_id = ${input.attemptId},
                generation = ${input.generation},
                observed_state = ${input.state},
                desired_state = ${input.state},
                diagnostic_code = ${input.diagnosticCode ?? null},
                rejection_reason = ${input.diagnosticMessage ?? null},
                terminal_summary = ${input.summary},
                terminal_transcript_ref = ${input.transcriptRef ?? null},
                updated_at = ${input.occurredAt}
              WHERE execution_id = ${input.executionId}
                AND observed_state NOT IN ('cancelled', 'succeeded', 'failed', 'rejected')
            `;

          // Ticket 08 durable completion outbox (T08-AC1): the outbox entry
          // is created in the SAME transaction as the terminal journal row
          // and aggregate settlement — terminal persistence and outbox
          // creation are atomic, so a crash can never leave a terminal
          // without its recoverably-pending completion entry, and an outbox
          // write failure fails the whole transaction (no terminal, no
          // notification). The payload reuses the SAME bounded terminal
          // evidence (Decision 0012 F2 obligation) — never unbounded.
          yield* sql`
              INSERT INTO pi_subagent_completion_outbox (
                outbox_id,
                execution_id,
                attempt_id,
                generation,
                terminal_event_id,
                parent_thread_id,
                delivery_state,
                terminal_state,
                summary,
                transcript_ref,
                attempt_count,
                created_at,
                updated_at
              ) VALUES (
                ${`outbox_${input.executionId}_${input.attemptId}_gen${input.generation}`},
                ${input.executionId},
                ${input.attemptId},
                ${input.generation},
                ${eventId},
                ${execution.parentThreadId},
                'pending',
                ${input.state},
                ${input.summary},
                ${input.transcriptRef ?? null},
                0,
                ${input.occurredAt},
                ${input.occurredAt}
              )
              ON CONFLICT (execution_id, attempt_id, generation) DO NOTHING
            `;

          const refreshedRows = yield* getByIdInternal(input.executionId);
          const refreshed = rowToExecutionRecord(refreshedRows[0] ?? executionRows[0]!);
          return {
            kind: "recorded" as const,
            event: journalRowToEvent(
              {
                eventId,
                executionId: input.executionId,
                attemptId: input.attemptId,
                generation: input.generation,
                sequence: input.sequence,
                state: input.state,
                occurredAt: input.occurredAt,
                diagnosticCode: input.diagnosticCode ?? null,
                diagnosticMessage: input.diagnosticMessage ?? null,
                metadataJson,
              },
              refreshed,
            ),
            execution: refreshed,
            continuity,
          };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.recordTerminalEvent:insert"),
        ),
      );

  /**
   * Ticket 07 durable terminal-evidence reader (bounded summary,
   * transcript reference, stale counter) for projections/reconciliation.
   */
  const getTerminalEvidence: PiSubagentExecutionRepositoryShape["getTerminalEvidence"] = (
    executionId,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<TerminalEvidenceRow>`
          SELECT
            terminal_summary AS "terminalSummary",
            terminal_transcript_ref AS "terminalTranscriptRef",
            stale_terminal_events AS "staleTerminalEvents"
          FROM pi_subagent_executions
          WHERE execution_id = ${executionId}
          LIMIT 1
        `.pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.getTerminalEvidence:query"),
        ),
      );
      if (rows.length === 0) {
        return Option.none();
      }
      const row = rows[0]!;
      return Option.some({
        terminalSummary: row.terminalSummary ?? null,
        terminalTranscriptRef: row.terminalTranscriptRef ?? null,
        staleTerminalEvents:
          typeof row.staleTerminalEvents === "number" ? row.staleTerminalEvents : 0,
      });
    });

  const listJournalEvents: PiSubagentExecutionRepositoryShape["listJournalEvents"] = (
    executionId,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<JournalRow>`
        SELECT
          j.event_id AS "eventId",
          j.execution_id AS "executionId",
          j.attempt_id AS "attemptId",
          j.generation,
          j.sequence,
          j.state,
          j.occurred_at AS "occurredAt",
          j.diagnostic_code AS "diagnosticCode",
          j.diagnostic_message AS "diagnosticMessage",
          j.metadata_json AS "metadataJson",
          e.parent_thread_id AS "parentThreadId",
          e.parent_turn_id AS "parentTurnId",
          e.parent_tool_call_id AS "parentToolCallId",
          e.project_id AS "projectId"
        FROM pi_subagent_lifecycle_journal j
        JOIN pi_subagent_executions e ON j.execution_id = e.execution_id
        WHERE j.execution_id = ${executionId}
        ORDER BY j.generation ASC, j.sequence ASC
      `.pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.listJournalEvents:query"),
        ),
      );

      return rows.map((row: any) => ({
        eventId: row.eventId,
        executionId: row.executionId,
        attemptId: row.attemptId,
        generation: row.generation,
        sequence: row.sequence,
        state: row.state,
        occurredAt: row.occurredAt,
        parentThreadId: row.parentThreadId as ThreadId,
        parentTurnId: (row.parentTurnId as TurnId) ?? null,
        parentToolCallId: row.parentToolCallId ?? null,
        projectId: row.projectId as ProjectId,
        diagnosticCode: row.diagnosticCode ?? undefined,
        diagnosticMessage: row.diagnosticMessage ?? undefined,
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
      }));
    });

  // ---------------------------------------------------------------------
  // Ticket 08 durable completion outbox. Delivery state is a SEPARATE state
  // machine from the execution outcome: no method below ever touches the
  // pi_subagent_executions aggregate (T08-AC2).
  // ---------------------------------------------------------------------

  const outboxColumns = sql`
    outbox_id AS "outboxId",
    execution_id AS "executionId",
    attempt_id AS "attemptId",
    generation,
    terminal_event_id AS "terminalEventId",
    parent_thread_id AS "parentThreadId",
    delivery_state AS "deliveryState",
    terminal_state AS "terminalState",
    summary,
    transcript_ref AS "transcriptRef",
    attempt_count AS "attemptCount",
    last_error AS "lastError",
    superseded_by_generation AS "supersededByGeneration",
    delivered_at AS "deliveredAt",
    acknowledged_at AS "acknowledgedAt",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    dispatch_batch_id AS "dispatchBatchId"
  `;

  const getOutboxByIdInternal = (outboxId: string) =>
    sql<OutboxRow>`
      SELECT ${outboxColumns}
      FROM pi_subagent_completion_outbox
      WHERE outbox_id = ${outboxId}
      LIMIT 1
    `;

  const recordCompletionOutboxEntry: PiSubagentExecutionRepositoryShape["recordCompletionOutboxEntry"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const outboxId = `outbox_${input.executionId}_${input.attemptId}_gen${input.generation}`;
            const existing = yield* sql<OutboxRow>`
              SELECT ${outboxColumns}
              FROM pi_subagent_completion_outbox
              WHERE execution_id = ${input.executionId}
                AND attempt_id = ${input.attemptId}
                AND generation = ${input.generation}
              LIMIT 1
            `;
            if (existing.length > 0) {
              return { kind: "already_applied" as const, entry: existing[0]! };
            }
            yield* sql`
              INSERT INTO pi_subagent_completion_outbox (
                outbox_id,
                execution_id,
                attempt_id,
                generation,
                terminal_event_id,
                parent_thread_id,
                delivery_state,
                terminal_state,
                summary,
                transcript_ref,
                attempt_count,
                created_at,
                updated_at
              ) VALUES (
                ${outboxId},
                ${input.executionId},
                ${input.attemptId},
                ${input.generation},
                ${input.terminalEventId},
                ${input.parentThreadId},
                'pending',
                ${input.terminalState},
                ${input.summary},
                ${input.transcriptRef ?? null},
                0,
                ${input.now},
                ${input.now}
              )
            `;
            const created = yield* getOutboxByIdInternal(outboxId);
            return { kind: "created" as const, entry: created[0]! };
          }),
        )
        .pipe(
          Effect.catch((err) =>
            Effect.gen(function* () {
              // Concurrent create on the unique identity: replay-safe.
              const outboxId = `outbox_${input.executionId}_${input.attemptId}_gen${input.generation}`;
              const existing = yield* getOutboxByIdInternal(outboxId).pipe(
                Effect.mapError(
                  toPersistenceSqlError(
                    "PiSubagentExecutionRepository.recordCompletionOutboxEntry:dedup-recheck",
                  ),
                ),
              );
              if (existing.length > 0) {
                return { kind: "already_applied" as const, entry: existing[0]! };
              }
              return yield* Effect.fail(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordCompletionOutboxEntry:insert",
                )(err),
              );
            }),
          ),
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.recordCompletionOutboxEntry:insert",
            ),
          ),
        );

  const getCompletionOutboxEntry: PiSubagentExecutionRepositoryShape["getCompletionOutboxEntry"] = (
    outboxId,
  ) =>
    Effect.gen(function* () {
      const rows = yield* getOutboxByIdInternal(outboxId).pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.getCompletionOutboxEntry:query"),
        ),
      );
      return rows.length > 0 ? Option.some(rows[0]!) : Option.none();
    });

  const listRecoverableCompletionOutbox: PiSubagentExecutionRepositoryShape["listRecoverableCompletionOutbox"] =
    (options) => {
      const mapError = toPersistenceSqlError(
        "PiSubagentExecutionRepository.listRecoverableCompletionOutbox:query",
      );
      // Ticket 09 per-thread filter: a separate query shape (not an
      // optional SQL fragment) keeps each statement cacheable.
      if (options.parentThreadId !== undefined && options.parentThreadId !== null) {
        return sql<OutboxRow>`
          SELECT ${outboxColumns}
          FROM pi_subagent_completion_outbox
          WHERE parent_thread_id = ${options.parentThreadId}
            AND (
              delivery_state = 'pending'
              OR (
                delivery_state = 'failed_retryable'
                AND attempt_count < ${options.retryLimit}
              )
            )
          ORDER BY created_at ASC, outbox_id ASC
        `.pipe(Effect.mapError(mapError));
      }
      return sql<OutboxRow>`
        SELECT ${outboxColumns}
        FROM pi_subagent_completion_outbox
        WHERE delivery_state = 'pending'
           OR (
             delivery_state = 'failed_retryable'
             AND attempt_count < ${options.retryLimit}
           )
        ORDER BY created_at ASC, outbox_id ASC
      `.pipe(Effect.mapError(mapError));
    };

  const listTerminalEventsWithoutOutbox: PiSubagentExecutionRepositoryShape["listTerminalEventsWithoutOutbox"] =
    () =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          readonly eventId: string;
          readonly executionId: string;
          readonly attemptId: string;
          readonly generation: number;
          readonly state: "succeeded" | "failed";
          readonly occurredAt: string;
          readonly summary: string | null;
          readonly transcriptRef: string | null;
          readonly parentThreadId: string;
        }>`
          SELECT
            j.event_id AS "eventId",
            j.execution_id AS "executionId",
            j.attempt_id AS "attemptId",
            j.generation,
            j.state,
            j.occurred_at AS "occurredAt",
            j.metadata_json ->> 'summary' AS "summary",
            j.metadata_json ->> 'transcriptRef' AS "transcriptRef",
            e.parent_thread_id AS "parentThreadId"
          FROM pi_subagent_lifecycle_journal j
          JOIN pi_subagent_executions e ON j.execution_id = e.execution_id
          WHERE j.state IN ('succeeded', 'failed')
            AND j.attempt_id = e.attempt_id
            AND j.generation = e.generation
            AND NOT EXISTS (
              SELECT 1
              FROM pi_subagent_completion_outbox o
              WHERE o.execution_id = j.execution_id
                AND o.attempt_id = j.attempt_id
                AND o.generation = j.generation
            )
          ORDER BY j.occurred_at ASC, j.event_id ASC
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.listTerminalEventsWithoutOutbox:query",
            ),
          ),
        );
        return rows;
      });

  /**
   * Generation fence for delivery transitions (T08-AC6): an entry whose
   * attempt/generation no longer matches the CURRENT aggregate is superseded
   * — its completion must never produce a delivery effect.
   */
  const fenceOrSupersede = (
    entry: OutboxRow,
    now: string,
  ): Effect.Effect<
    { kind: "current" } | { kind: "superseded_instead"; entry: OutboxRow },
    PersistenceSqlError
  > =>
    Effect.gen(function* () {
      const executionRows = yield* getByIdInternal(entry.executionId).pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.fenceOrSupersede:execution-lookup"),
        ),
      );
      const execution = executionRows[0];
      if (
        execution === undefined ||
        (execution.attemptId === entry.attemptId && execution.generation === entry.generation)
      ) {
        return { kind: "current" as const };
      }
      const superseded = yield* sql<OutboxRow>`
          UPDATE pi_subagent_completion_outbox
          SET
            delivery_state = 'superseded',
            superseded_by_generation = ${execution.generation},
            updated_at = ${now}
          WHERE outbox_id = ${entry.outboxId}
            AND delivery_state IN ('pending', 'failed_retryable')
          RETURNING ${outboxColumns}
        `.pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.fenceOrSupersede:update"),
        ),
      );
      const after = superseded[0] ?? entry;
      return { kind: "superseded_instead" as const, entry: after };
    });

  const markCompletionDelivered: PiSubagentExecutionRepositoryShape["markCompletionDelivered"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* getOutboxByIdInternal(input.outboxId);
          if (rows.length === 0) {
            return { kind: "not_found" as const };
          }
          const entry = rows[0]!;
          if (entry.deliveryState !== "pending" && entry.deliveryState !== "failed_retryable") {
            return {
              kind: "invalid_transition" as const,
              reason: "already_terminal_delivery_state" as const,
              entry,
            };
          }
          const fence = yield* fenceOrSupersede(entry, input.now);
          if (fence.kind === "superseded_instead") {
            return { kind: "superseded_instead" as const, entry: fence.entry };
          }
          const updated = yield* sql<OutboxRow>`
              UPDATE pi_subagent_completion_outbox
              SET
                delivery_state = 'delivered',
                delivered_at = ${input.now},
                last_error = NULL,
                updated_at = ${input.now}
              WHERE outbox_id = ${input.outboxId}
                AND delivery_state IN ('pending', 'failed_retryable')
              RETURNING ${outboxColumns}
            `;
          const after = updated[0] ?? entry;
          return { kind: "transitioned" as const, entry: after };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.markCompletionDelivered:update"),
        ),
      );

  const markCompletionAcknowledged: PiSubagentExecutionRepositoryShape["markCompletionAcknowledged"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getOutboxByIdInternal(input.outboxId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const entry = rows[0]!;
            if (entry.deliveryState === "acknowledged") {
              // Idempotent ack replay: exactly-once effect already applied.
              return { kind: "transitioned" as const, entry };
            }
            if (entry.deliveryState !== "delivered") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal_delivery_state" as const,
                entry,
              };
            }
            const updated = yield* sql<OutboxRow>`
                UPDATE pi_subagent_completion_outbox
                SET
                  delivery_state = 'acknowledged',
                  acknowledged_at = ${input.now},
                  updated_at = ${input.now}
                WHERE outbox_id = ${input.outboxId}
                  AND delivery_state = 'delivered'
                RETURNING ${outboxColumns}
              `;
            const after = updated[0] ?? entry;
            return { kind: "transitioned" as const, entry: after };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.markCompletionAcknowledged:update",
            ),
          ),
        );

  const markCompletionDeliveryFailed: PiSubagentExecutionRepositoryShape["markCompletionDeliveryFailed"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getOutboxByIdInternal(input.outboxId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const entry = rows[0]!;
            if (entry.deliveryState === "acknowledged" || entry.deliveryState === "superseded") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal_delivery_state" as const,
                entry,
              };
            }
            const fence = yield* fenceOrSupersede(entry, input.now);
            if (fence.kind === "superseded_instead") {
              return { kind: "superseded_instead" as const, entry: fence.entry };
            }
            const updated = yield* sql<OutboxRow>`
                UPDATE pi_subagent_completion_outbox
                SET
                  delivery_state = 'failed_retryable',
                  attempt_count = attempt_count + 1,
                  last_error = ${input.error},
                  updated_at = ${input.now}
                WHERE outbox_id = ${input.outboxId}
                  AND delivery_state IN ('pending', 'delivered', 'failed_retryable')
                RETURNING ${outboxColumns}
              `;
            const after = updated[0] ?? entry;
            return { kind: "transitioned" as const, entry: after };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.markCompletionDeliveryFailed:update",
            ),
          ),
        );

  const markCompletionSuperseded: PiSubagentExecutionRepositoryShape["markCompletionSuperseded"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* getOutboxByIdInternal(input.outboxId);
          if (rows.length === 0) {
            return { kind: "not_found" as const };
          }
          const entry = rows[0]!;
          if (entry.deliveryState === "acknowledged") {
            return {
              kind: "invalid_transition" as const,
              reason: "already_terminal_delivery_state" as const,
              entry,
            };
          }
          const updated = yield* sql<OutboxRow>`
                UPDATE pi_subagent_completion_outbox
                SET
                  delivery_state = 'superseded',
                  superseded_by_generation = ${input.supersededByGeneration},
                  updated_at = ${input.now}
                WHERE outbox_id = ${input.outboxId}
                  AND delivery_state IN ('pending', 'delivered', 'failed_retryable')
                RETURNING ${outboxColumns}
              `;
          const after = updated[0] ?? entry;
          return { kind: "transitioned" as const, entry: after };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.markCompletionSuperseded:update"),
        ),
      );

  // ---------------------------------------------------------------------
  // Decision 0016 — completion-dispatch batch ledger (Ticket 09 remediation).
  //
  // The BATCH is the durable recovery authority. `delivered` members carry
  // `dispatchBatchId` as membership evidence only — never parent-effect
  // acceptance. All transitions are guarded, replayable, and never touch the
  // execution aggregate. Frozen command/message/membership content is
  // authored once at creation and replayed byte-for-byte.
  // ---------------------------------------------------------------------

  interface BatchRow {
    readonly batchId: string;
    readonly parentThreadId: string;
    readonly parentCommandId: string;
    readonly parentMessageId: string;
    readonly fingerprintVersion: number;
    readonly commandFingerprint: string;
    readonly membershipJson: string;
    readonly parentMessageText: string;
    readonly commandPayloadJson: string;
    readonly state: PiSubagentCompletionDispatchBatchState;
    readonly attemptCount: number;
    readonly acceptedReceiptSequence: number | null;
    readonly lastError: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly acceptedAt: string | null;
    readonly acknowledgedAt: string | null;
    readonly supersededAt: string | null;
    readonly exhaustedAt: string | null;
  }

  const batchColumns = sql`
    batch_id AS "batchId",
    parent_thread_id AS "parentThreadId",
    parent_command_id AS "parentCommandId",
    parent_message_id AS "parentMessageId",
    fingerprint_version AS "fingerprintVersion",
    command_fingerprint AS "commandFingerprint",
    membership_json AS "membershipJson",
    parent_message_text AS "parentMessageText",
    command_payload_json AS "commandPayloadJson",
    state,
    attempt_count AS "attemptCount",
    accepted_receipt_sequence AS "acceptedReceiptSequence",
    last_error AS "lastError",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    accepted_at AS "acceptedAt",
    acknowledged_at AS "acknowledgedAt",
    superseded_at AS "supersededAt",
    exhausted_at AS "exhaustedAt"
  `;

  const getBatchByIdInternal = (
    batchId: string,
  ): Effect.Effect<readonly BatchRow[], PersistenceSqlError> =>
    sql<BatchRow>`
      SELECT ${batchColumns}
      FROM pi_subagent_completion_dispatch_batches
      WHERE batch_id = ${batchId}
      LIMIT 1
    `.pipe(
      Effect.mapError(
        toPersistenceSqlError("PiSubagentExecutionRepository.getCompletionDispatchBatch:query"),
      ),
    );

  const decodeBatch = (row: BatchRow): PiSubagentCompletionDispatchBatch => ({
    ...row,
    membership: JSON.parse(row.membershipJson) as readonly string[],
  });

  const decodeBatchOption = (rows: readonly BatchRow[]) =>
    rows.length > 0 ? Option.some(decodeBatch(rows[0]!)) : Option.none();

  /** Internal sentinel: a selected member is already claimed by another batch. */
  class CompletionBatchMemberCollisionError extends Error {
    override readonly name = "CompletionBatchMemberCollisionError";
  }

  /**
   * Fail-closed structural validation of the builder-produced immutable
   * content against the canonical in-transaction member selection
   * (Decision 0016 §2: duplicate / noncanonical / cross-thread / missing /
   * oversized membership fails closed; identity immutability).
   */
  const validateBatchContent = (
    content: PiSubagentCompletionDispatchBatchContent,
    members: readonly OutboxRow[],
    parentThreadId: string,
  ): string | null => {
    if (content.parentCommandId.trim().length === 0) {
      return "batch parent command id must be non-empty";
    }
    if (content.parentMessageId.trim().length === 0) {
      return "batch parent message id must be non-empty";
    }
    if (content.batchId.trim().length === 0) {
      return "batch id must be non-empty";
    }
    if (content.membership.length !== members.length) {
      return "batch membership length does not match the canonically selected members";
    }
    for (let index = 0; index < members.length; index += 1) {
      if (content.membership[index] !== members[index]!.outboxId) {
        return "batch membership is noncanonical or references an unselected member";
      }
    }
    if (new Set(content.membership).size !== content.membership.length) {
      return "batch membership contains a duplicate outbox id";
    }
    let payload: unknown;
    try {
      payload = JSON.parse(content.commandPayloadJson);
    } catch {
      return "batch command payload is not valid JSON";
    }
    if (typeof payload !== "object" || payload === null) {
      return "batch command payload must be an object";
    }
    const command = payload as Record<string, unknown>;
    const message = command.message as Record<string, unknown> | undefined;
    if (command.type !== "thread.turn.start") {
      return "batch command payload must type thread.turn.start";
    }
    if (command.threadId !== parentThreadId) {
      return "batch command payload threads a different parent than membership";
    }
    if (command.commandId !== content.parentCommandId) {
      return "batch command payload commandId does not match the frozen parent command id";
    }
    if (message?.messageId !== content.parentMessageId) {
      return "batch command payload messageId does not match the frozen parent message id";
    }
    if (message?.text !== content.parentMessageText) {
      return "batch command payload message text does not match the frozen parent message text";
    }
    return null;
  };

  const createCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["createCompletionDispatchBatch"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            // 1. Canonical selection: generation-applicable pending or
            //    within-budget failed_retryable rows for one parent thread,
            //    oldest first (matches the durable outbox scan order).
            const candidates = yield* sql<OutboxRow>`
              SELECT ${outboxColumns}
              FROM pi_subagent_completion_outbox
              WHERE parent_thread_id = ${input.parentThreadId}
                AND (
                  delivery_state = 'pending'
                  OR (
                    delivery_state = 'failed_retryable'
                    AND attempt_count < ${input.retryLimit}
                  )
                )
              ORDER BY created_at ASC, outbox_id ASC
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.createCompletionDispatchBatch:scan",
                ),
              ),
            );

            // 2. Supersede stale members BEFORE any parent command submission
            //    (Decision 0016 §2 / T09-AC6) and cap the membership.
            const members: OutboxRow[] = [];
            let supersededCount = 0;
            for (const candidate of candidates) {
              if (members.length >= input.maxBatchEntries) {
                break;
              }
              const fence = yield* fenceOrSupersede(candidate, input.now);
              if (fence.kind === "superseded_instead") {
                supersededCount += 1;
                continue;
              }
              members.push(candidate);
            }
            if (members.length === 0) {
              return { kind: "no_members" as const, supersededCount };
            }

            // 3. Author immutable batch content from the exact selected
            //    members (identity + frozen command). Fail closed on any
            //    builder error.
            let content: PiSubagentCompletionDispatchBatchContent;
            try {
              content = input.buildBatchContent(
                members as readonly PiSubagentCompletionOutboxEntry[],
              );
            } catch (cause) {
              const detail =
                cause instanceof Error
                  ? cause.message
                  : `batch content build failed: ${String(cause)}`;
              return { kind: "content_rejected" as const, detail };
            }
            const validationError = validateBatchContent(content, members, input.parentThreadId);
            if (validationError !== null) {
              return { kind: "content_rejected" as const, detail: validationError };
            }

            // 4. Identity collision / idempotent replay guard: a pre-existing
            //    batch under the same batch id must carry byte-identical
            //    content; otherwise fail closed (identity rotation forbidden).
            const existing = yield* getBatchByIdInternal(content.batchId);
            if (existing.length > 0) {
              const prior = existing[0]!;
              const identical =
                prior.parentCommandId === content.parentCommandId &&
                prior.parentMessageId === content.parentMessageId &&
                prior.fingerprintVersion === content.fingerprintVersion &&
                prior.commandFingerprint === content.commandFingerprint &&
                prior.membershipJson === JSON.stringify(content.membership) &&
                prior.parentMessageText === content.parentMessageText &&
                prior.commandPayloadJson === content.commandPayloadJson;
              return identical
                ? { kind: "batch_already_present" as const, batch: decodeBatch(prior) }
                : {
                    kind: "content_rejected" as const,
                    detail: "batch id identity bound to different frozen content",
                  };
            }

            // 5. Insert the immutable batch (active slot reserved by the
            //    partial unique index — a duplicate parent command/message id
            //    or a concurrent active batch fails the transaction).
            yield* sql`
              INSERT INTO pi_subagent_completion_dispatch_batches (
                batch_id,
                parent_thread_id,
                parent_command_id,
                parent_message_id,
                fingerprint_version,
                command_fingerprint,
                membership_json,
                parent_message_text,
                command_payload_json,
                state,
                attempt_count,
                created_at,
                updated_at
              ) VALUES (
                ${content.batchId},
                ${input.parentThreadId},
                ${content.parentCommandId},
                ${content.parentMessageId},
                ${content.fingerprintVersion},
                ${content.commandFingerprint},
                ${JSON.stringify(content.membership)},
                ${content.parentMessageText},
                ${content.commandPayloadJson},
                'awaiting_acceptance',
                0,
                ${input.now},
                ${input.now}
              )
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.createCompletionDispatchBatch:insert",
                ),
              ),
            );

            // 6. Associate every member exactly once. A member already claimed
            //    by a concurrent batch FAILS the transaction so the batch
            //    insert and all prior associations roll back together
            //    (multiply-associated membership fails closed).
            for (const member of members) {
              const updated = yield* sql<OutboxRow>`
                UPDATE pi_subagent_completion_outbox
                SET
                  dispatch_batch_id = ${content.batchId},
                  delivery_state = 'delivered',
                  delivered_at = ${input.now},
                  updated_at = ${input.now}
                WHERE outbox_id = ${member.outboxId}
                  AND dispatch_batch_id IS NULL
                  AND delivery_state IN ('pending', 'failed_retryable')
                RETURNING ${outboxColumns}
              `.pipe(
                Effect.mapError(
                  toPersistenceSqlError(
                    "PiSubagentExecutionRepository.createCompletionDispatchBatch:associate",
                  ),
                ),
              );
              if (updated.length !== 1) {
                return yield* Effect.fail(new CompletionBatchMemberCollisionError());
              }
            }

            const created = yield* getBatchByIdInternal(content.batchId);
            return { kind: "created" as const, batch: decodeBatch(created[0]!), supersededCount };
          }),
        )
        .pipe(
          Effect.catchIf(
            (error): error is CompletionBatchMemberCollisionError =>
              error instanceof CompletionBatchMemberCollisionError,
            () =>
              Effect.succeed<PiSubagentCompletionDispatchCreateResult>({
                kind: "member_collision",
              }),
          ),
          Effect.catchIf(
            (error: unknown) =>
              error instanceof Error && /UNIQUE constraint failed/iu.test(error.message),
            () =>
              Effect.succeed<PiSubagentCompletionDispatchCreateResult>({
                kind: "active_batch_exists",
              }),
          ),
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.createCompletionDispatchBatch:transaction",
            ),
          ),
        );

  const getCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["getCompletionDispatchBatch"] =
    (batchId) =>
      Effect.gen(function* () {
        const rows = yield* getBatchByIdInternal(batchId);
        return decodeBatchOption(rows);
      });

  const getCompletionDispatchBatchByCommandId: PiSubagentExecutionRepositoryShape["getCompletionDispatchBatchByCommandId"] =
    (parentCommandId) =>
      Effect.gen(function* () {
        const rows = yield* sql<BatchRow>`
          SELECT ${batchColumns}
          FROM pi_subagent_completion_dispatch_batches
          WHERE parent_command_id = ${parentCommandId}
          LIMIT 1
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.getCompletionDispatchBatchByCommandId:query",
            ),
          ),
        );
        return decodeBatchOption(rows);
      });

  const getActiveCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["getActiveCompletionDispatchBatch"] =
    (parentThreadId) =>
      Effect.gen(function* () {
        const rows = yield* sql<BatchRow>`
          SELECT ${batchColumns}
          FROM pi_subagent_completion_dispatch_batches
          WHERE parent_thread_id = ${parentThreadId}
            AND state IN ${sql.in(PI_SUBAGENT_COMPLETION_DISPATCH_ACTIVE_STATES)}
          LIMIT 1
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.getActiveCompletionDispatchBatch:query",
            ),
          ),
        );
        return decodeBatchOption(rows);
      });

  const listRecoverableCompletionDispatchBatches: PiSubagentExecutionRepositoryShape["listRecoverableCompletionDispatchBatches"] =
    (options) => {
      const mapError = toPersistenceSqlError(
        "PiSubagentExecutionRepository.listRecoverableCompletionDispatchBatches:query",
      );
      // `Effect.map` applies its function to the whole success value; map over
      // the returned rows explicitly so decodeBatch sees each row, not the array.
      const decodeRows = (rows: readonly BatchRow[]): PiSubagentCompletionDispatchBatch[] =>
        rows.map((row) => decodeBatch(row));
      if (options.parentThreadId !== undefined && options.parentThreadId !== null) {
        return sql<BatchRow>`
          SELECT ${batchColumns}
          FROM pi_subagent_completion_dispatch_batches
          WHERE parent_thread_id = ${options.parentThreadId}
            AND (
              state = 'awaiting_acceptance'
              OR (state = 'retryable' AND attempt_count < ${options.retryLimit})
            )
          ORDER BY created_at ASC, batch_id ASC
        `.pipe(Effect.map(decodeRows), Effect.mapError(mapError));
      }
      return sql<BatchRow>`
        SELECT ${batchColumns}
        FROM pi_subagent_completion_dispatch_batches
        WHERE state = 'awaiting_acceptance'
           OR (state = 'retryable' AND attempt_count < ${options.retryLimit})
        ORDER BY created_at ASC, batch_id ASC
      `.pipe(Effect.map(decodeRows), Effect.mapError(mapError));
    };

  const recordCompletionDispatchAccepted: PiSubagentExecutionRepositoryShape["recordCompletionDispatchAccepted"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getBatchByIdInternal(input.batchId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const batch = rows[0]!;

            // Exact correlation before any state change (Decision 0016 §6).
            if (batch.parentCommandId !== input.parentCommandId) {
              return {
                kind: "receipt_mismatch" as const,
                reason: "command_mismatch" as const,
                batch: decodeBatch(batch),
              };
            }
            if (
              batch.fingerprintVersion !== input.fingerprintVersion ||
              batch.commandFingerprint !== input.commandFingerprint
            ) {
              return {
                kind: "receipt_mismatch" as const,
                reason: "fingerprint_mismatch" as const,
                batch: decodeBatch(batch),
              };
            }
            if (batch.parentMessageId !== input.parentMessageId) {
              return {
                kind: "receipt_mismatch" as const,
                reason: "message_mismatch" as const,
                batch: decodeBatch(batch),
              };
            }
            if (batch.state === "accepted") {
              // Idempotent replay of the same accepted receipt.
              return { kind: "transitioned" as const, batch: decodeBatch(batch) };
            }
            if (batch.state === "acknowledged") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(batch),
              };
            }
            if (batch.state === "superseded" || batch.state === "exhausted") {
              return {
                kind: "receipt_mismatch" as const,
                reason: "already_exhausted" as const,
                batch: decodeBatch(batch),
              };
            }
            const updated = yield* sql<BatchRow>`
              UPDATE pi_subagent_completion_dispatch_batches
              SET
                state = 'accepted',
                accepted_receipt_sequence = ${input.acceptedReceiptSequence},
                accepted_at = ${input.now},
                updated_at = ${input.now}
              WHERE batch_id = ${input.batchId}
                AND state IN ('awaiting_acceptance', 'retryable')
              RETURNING ${batchColumns}
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordCompletionDispatchAccepted:update",
                ),
              ),
            );
            const after = updated[0] ?? batch;
            return { kind: "transitioned" as const, batch: decodeBatch(after) };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.recordCompletionDispatchAccepted:transaction",
            ),
          ),
        );

  const finalizeCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["finalizeCompletionDispatchBatch"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getBatchByIdInternal(input.batchId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const batch = rows[0]!;
            if (batch.state === "acknowledged") {
              // Idempotent finalization replay.
              return { kind: "transitioned" as const, batch: decodeBatch(batch) };
            }
            if (batch.state === "superseded" || batch.state === "exhausted") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(batch),
              };
            }
            // Acknowledge ONLY the exact associated members (Decision 0016
            // §6 — never unrelated content; generic message_end cannot ack).
            yield* sql`
              UPDATE pi_subagent_completion_outbox
              SET
                delivery_state = 'acknowledged',
                acknowledged_at = ${input.now},
                updated_at = ${input.now}
              WHERE dispatch_batch_id = ${input.batchId}
                AND delivery_state = 'delivered'
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.finalizeCompletionDispatchBatch:members",
                ),
              ),
            );
            const updated = yield* sql<BatchRow>`
              UPDATE pi_subagent_completion_dispatch_batches
              SET
                state = 'acknowledged',
                acknowledged_at = ${input.now},
                updated_at = ${input.now}
              WHERE batch_id = ${input.batchId}
                AND state IN ('awaiting_acceptance', 'retryable', 'accepted')
              RETURNING ${batchColumns}
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.finalizeCompletionDispatchBatch:batch",
                ),
              ),
            );
            if (updated.length === 0) {
              const after = yield* getBatchByIdInternal(input.batchId);
              if (after.length === 0) {
                return { kind: "not_found" as const };
              }
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(after[0]!),
              };
            }
            return { kind: "transitioned" as const, batch: decodeBatch(updated[0]!) };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.finalizeCompletionDispatchBatch:transaction",
            ),
          ),
        );

  const failCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["failCompletionDispatchBatch"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getBatchByIdInternal(input.batchId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const batch = rows[0]!;
            if (batch.state !== "awaiting_acceptance" && batch.state !== "retryable") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(batch),
              };
            }
            // Transient no-receipt failure: one attempt under the SAME stable
            // identity; exhausted at the configured ceiling (Decision 0016
            // §7). Byte-identical redrive is the coordinator's job.
            const nextAttemptCount = batch.attemptCount + 1;
            const exhausted = nextAttemptCount >= input.retryLimit;
            const updated = yield* sql<BatchRow>`
              UPDATE pi_subagent_completion_dispatch_batches
              SET
                state = ${exhausted ? "exhausted" : "retryable"},
                attempt_count = ${nextAttemptCount},
                last_error = ${input.error},
                exhausted_at = ${exhausted ? input.now : null},
                updated_at = ${input.now}
              WHERE batch_id = ${input.batchId}
                AND state IN ('awaiting_acceptance', 'retryable')
              RETURNING ${batchColumns}
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.failCompletionDispatchBatch:update",
                ),
              ),
            );
            const after = updated[0] ?? batch;
            return { kind: "transitioned" as const, batch: decodeBatch(after) };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.failCompletionDispatchBatch:transaction",
            ),
          ),
        );

  const rejectCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["rejectCompletionDispatchBatch"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getBatchByIdInternal(input.batchId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const batch = rows[0]!;
            if (batch.state === "acknowledged") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(batch),
              };
            }
            if (batch.state === "exhausted") {
              // Immutable rejection replay: evidence preserved, no repeated
              // increments under the same identity (Decision 0016 §7).
              return { kind: "transitioned" as const, batch: decodeBatch(batch) };
            }
            if (batch.state === "superseded") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(batch),
              };
            }
            // One genuine boundary-failure attempt, then terminal exhaustion:
            // that identity can never become accepted (fingerprint-matched
            // immutable rejection / collision is not a transport failure).
            const nextAttemptCount = batch.attemptCount + 1;
            const updated = yield* sql<BatchRow>`
              UPDATE pi_subagent_completion_dispatch_batches
              SET
                state = 'exhausted',
                attempt_count = ${nextAttemptCount},
                last_error = ${input.error},
                exhausted_at = ${input.now},
                updated_at = ${input.now}
              WHERE batch_id = ${input.batchId}
                AND state IN ('awaiting_acceptance', 'retryable', 'accepted')
              RETURNING ${batchColumns}
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.rejectCompletionDispatchBatch:update",
                ),
              ),
            );
            const after = updated[0] ?? batch;
            return { kind: "transitioned" as const, batch: decodeBatch(after) };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.rejectCompletionDispatchBatch:transaction",
            ),
          ),
        );

  const supersedeCompletionDispatchBatch: PiSubagentExecutionRepositoryShape["supersedeCompletionDispatchBatch"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* getBatchByIdInternal(input.batchId);
            if (rows.length === 0) {
              return { kind: "not_found" as const };
            }
            const batch = rows[0]!;
            if (batch.state === "acknowledged" || batch.state === "exhausted") {
              return {
                kind: "invalid_transition" as const,
                reason: "already_terminal" as const,
                batch: decodeBatch(batch),
              };
            }
            if (batch.state === "superseded") {
              return { kind: "transitioned" as const, batch: decodeBatch(batch) };
            }
            // Stale-before-submission: supersedes the batch (zero parent
            // effect, T09-AC6) and releases the active-thread slot; members
            // remain `delivered` as readable evidence.
            const updated = yield* sql<BatchRow>`
              UPDATE pi_subagent_completion_dispatch_batches
              SET
                state = 'superseded',
                last_error = ${input.supersededByReason},
                superseded_at = ${input.now},
                updated_at = ${input.now}
              WHERE batch_id = ${input.batchId}
                AND state IN ('awaiting_acceptance', 'retryable', 'accepted')
              RETURNING ${batchColumns}
            `.pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.supersedeCompletionDispatchBatch:update",
                ),
              ),
            );
            const after = updated[0] ?? batch;
            return { kind: "transitioned" as const, batch: decodeBatch(after) };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PiSubagentExecutionRepository.supersedeCompletionDispatchBatch:transaction",
            ),
          ),
        );

  // ---------------------------------------------------------------------
  // Ticket 10 restart / lease-expiry reconciliation.
  // ---------------------------------------------------------------------

  const listNonTerminalExecutions: PiSubagentExecutionRepositoryShape["listNonTerminalExecutions"] =
    () =>
      Effect.gen(function* () {
        const rows = yield* sql<ExecutionRow>`
          SELECT ${executionColumns(sql)}
          FROM pi_subagent_executions
          WHERE observed_state IN (
            'requested', 'accepted', 'queued', 'running', 'cancelling', 'orphaned'
          )
          ORDER BY created_at ASC
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError("PiSubagentExecutionRepository.listNonTerminalExecutions:query"),
          ),
        );
        return rows.map(rowToExecutionRecord);
      });

  /**
   * Ticket 10 owner-loss settlement (T10-AC1/AC5/AC6). One transaction:
   * dedup (deterministic eventId `orphan_<exec>_<attempt>_gen<gen>` plus the
   * attempt/generation/sequence key) → execution lookup → journal insert
   * (band 50, `orphaned`, owner-loss diagnostic) → guarded aggregate UPDATE.
   *
   * The aggregate becomes non-terminal `orphaned` and the generation ADVANCES
   * by one — the reconciliation fence (spec Implementation Decision 27): late
   * events from the orphaned attempt/generation fail the generation gate,
   * journal as history only (ignored), and late terminals are additionally
   * counted through the stale_terminal_events counter (T10-AC5).
   */
  const recordOrphanedEvent: PiSubagentExecutionRepositoryShape["recordOrphanedEvent"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const eventId = `orphan_${input.executionId}_${input.attemptId}_gen${input.generation}`;
          const sequence = 50;
          const metadataJson = JSON.stringify({
            phase: "orphaned",
            priorAttemptId: input.attemptId,
            priorGeneration: input.generation,
            reason: "owner_loss",
          });

          const existing = yield* lookupJournalEvent({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence,
          });
          const executionRows = yield* getByIdInternal(input.executionId);
          if (executionRows.length === 0) {
            return yield* Effect.fail(
              toPersistenceSqlError(
                "PiSubagentExecutionRepository.recordOrphanedEvent:execution-lookup",
              )(new Error(`Execution '${input.executionId}' not found`)),
            );
          }
          const execution = rowToExecutionRecord(executionRows[0]!);

          if (existing.length > 0) {
            return {
              kind: "already_applied" as const,
              execution,
            };
          }

          // The settlement targets the listed attempt/generation only: a
          // concurrent resume (newer attempt/generation) must never be fenced
          // by a stale reconciliation decision (T10-AC5 stale guard).
          if (
            execution.attemptId !== input.attemptId ||
            execution.generation !== input.generation
          ) {
            return {
              kind: "stale_generation" as const,
              execution,
            };
          }

          // Already orphaned on the SAME attempt/generation: idempotent
          // re-reconciliation (e.g. a second sweep) must NOT fence the
          // generation again — every sweep would otherwise advance the
          // generation unboundedly and orphan evidence would drift.
          if (execution.observedState === "orphaned") {
            return {
              kind: "already_applied" as const,
              execution,
            };
          }

          // A terminal aggregate can never be orphaned — terminal truth wins
          // over owner loss (T10-AC1: `running` is never asserted without
          // evidence; terminal evidence is never reversed).
          if (TERMINAL_OBSERVED_STATES.has(execution.observedState)) {
            return {
              kind: "already_applied" as const,
              execution,
            };
          }

          yield* makeJournalInsert({
            eventId,
            executionId: input.executionId,
            attemptId: input.attemptId,
            generation: input.generation,
            sequence,
            state: "orphaned",
            occurredAt: input.occurredAt,
            diagnosticCode: input.diagnosticCode,
            diagnosticMessage: input.diagnosticMessage,
            metadataJson,
          });

          yield* sql`
            UPDATE pi_subagent_executions
            SET
              observed_state = 'orphaned',
              generation = ${input.generation + 1},
              diagnostic_code = ${input.diagnosticCode},
              rejection_reason = ${input.diagnosticMessage},
              updated_at = ${input.occurredAt}
            WHERE execution_id = ${input.executionId}
              AND attempt_id = ${input.attemptId}
              AND generation = ${input.generation}
              AND observed_state NOT IN ('cancelled', 'succeeded', 'failed', 'rejected')
          `;

          const refreshedRows = yield* getByIdInternal(input.executionId);
          const refreshed = rowToExecutionRecord(refreshedRows[0] ?? executionRows[0]!);
          return {
            kind: "recorded" as const,
            execution: refreshed,
          };
        }),
      )
      .pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            // Concurrent same-identity settlement raced the insert: replay
            // the dedup answer instead of surfacing a constraint failure.
            const eventId = `orphan_${input.executionId}_${input.attemptId}_gen${input.generation}`;
            const existing = yield* lookupJournalEvent({
              eventId,
              executionId: input.executionId,
              attemptId: input.attemptId,
              generation: input.generation,
              sequence: 50,
            }).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordOrphanedEvent:dedup-recheck",
                ),
              ),
            );
            const executionRows = yield* getByIdInternal(input.executionId).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordOrphanedEvent:execution-recheck",
                ),
              ),
            );
            if (existing.length > 0 && executionRows.length > 0) {
              return {
                kind: "already_applied" as const,
                execution: rowToExecutionRecord(executionRows[0]!),
              };
            }
            return yield* Effect.fail(
              toPersistenceSqlError("PiSubagentExecutionRepository.recordOrphanedEvent:insert")(
                err,
              ),
            );
          }),
        ),
        Effect.mapError(
          toPersistenceSqlError("PiSubagentExecutionRepository.recordOrphanedEvent:insert"),
        ),
      );

  /**
   * Ticket 13 wall-time expiry trigger (T13-AC3). Journal-only transaction:
   * dedup (deterministic eventId `walltime_<exec>_<attempt>_gen<gen>`, band
   * 60) → execution lookup → attempt/generation fence → journal insert with
   * the `pi_subagent_walltime_expired` diagnostic. The aggregate is NEVER
   * mutated — no observed/desired change, no generation advance, no
   * terminal claim. Ticket 15's watchdog stages consume this trigger.
   */
  const recordWallTimeExpiryEvent: PiSubagentExecutionRepositoryShape["recordWallTimeExpiryEvent"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const eventId = `walltime_${input.executionId}_${input.attemptId}_gen${input.generation}`;
            const sequence = 60;
            const metadataJson = JSON.stringify({
              phase: "walltime_expiry",
              wallTimeMs: input.wallTimeMs,
              attemptId: input.attemptId,
              generation: input.generation,
            });

            const existing = yield* lookupJournalEvent({
              eventId,
              executionId: input.executionId,
              attemptId: input.attemptId,
              generation: input.generation,
              sequence,
            });
            const executionRows = yield* getByIdInternal(input.executionId);
            if (executionRows.length === 0) {
              return yield* Effect.fail(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordWallTimeExpiryEvent:execution-lookup",
                )(new Error(`Execution '${input.executionId}' not found`)),
              );
            }
            const execution = rowToExecutionRecord(executionRows[0]!);

            if (existing.length > 0) {
              return {
                kind: "already_applied" as const,
                execution,
              };
            }

            // The trigger targets the current attempt/generation only: a
            // resumed or reconciled execution must not fire a stale expiry.
            if (
              execution.attemptId !== input.attemptId ||
              execution.generation !== input.generation
            ) {
              return {
                kind: "stale_generation" as const,
                execution,
              };
            }

            // Terminal truth wins: no expiry trigger for a settled
            // aggregate (the diagnostic would mislead ticket 15's consumer).
            if (TERMINAL_OBSERVED_STATES.has(execution.observedState)) {
              return {
                kind: "already_applied" as const,
                execution,
              };
            }

            yield* makeJournalInsert({
              eventId,
              executionId: input.executionId,
              attemptId: input.attemptId,
              generation: input.generation,
              sequence,
              state: execution.observedState,
              occurredAt: input.occurredAt,
              diagnosticCode: "pi_subagent_walltime_expired",
              diagnosticMessage: `Execution wall-time budget of ${input.wallTimeMs}ms expired`,
              metadataJson,
            });

            // Aggregate is intentionally untouched (T13-AC3: expiry never
            // silently settles projection).
            return {
              kind: "recorded" as const,
              execution,
            };
          }),
        )
        .pipe(
          Effect.catch((err) =>
            Effect.gen(function* () {
              const eventId = `walltime_${input.executionId}_${input.attemptId}_gen${input.generation}`;
              const existing = yield* lookupJournalEvent({
                eventId,
                executionId: input.executionId,
                attemptId: input.attemptId,
                generation: input.generation,
                sequence: 60,
              }).pipe(
                Effect.mapError(
                  toPersistenceSqlError(
                    "PiSubagentExecutionRepository.recordWallTimeExpiryEvent:dedup-recheck",
                  ),
                ),
              );
              const executionRows = yield* getByIdInternal(input.executionId).pipe(
                Effect.mapError(
                  toPersistenceSqlError(
                    "PiSubagentExecutionRepository.recordWallTimeExpiryEvent:execution-recheck",
                  ),
                ),
              );
              if (existing.length > 0 && executionRows.length > 0) {
                return {
                  kind: "already_applied" as const,
                  execution: rowToExecutionRecord(executionRows[0]!),
                };
              }
              return yield* Effect.fail(
                toPersistenceSqlError(
                  "PiSubagentExecutionRepository.recordWallTimeExpiryEvent:insert",
                )(err),
              );
            }),
          ),
          Effect.mapError(
            toPersistenceSqlError("PiSubagentExecutionRepository.recordWallTimeExpiryEvent:insert"),
          ),
        );

  /**
   * T13-AC4 bounded operator snapshot. Percentiles are nearest-rank values
   * calculated inside SQLite so diagnostics never materializes an unbounded
   * latency sample array in the Node process.
   *
   * `dropped_progress_count` currently counts snapshots replaced by the
   * server's latest-slot coalescer. Every such snapshot is both coalesced and
   * dropped from emission, so the two approved fields intentionally share the
   * same durable value until another drop mode is introduced.
   */
  const getTelemetrySnapshot: PiSubagentExecutionRepositoryShape["getTelemetrySnapshot"] = (now) =>
    sql<TelemetrySnapshotRow>`
      WITH
      detach_samples AS (
        SELECT MAX(
          0,
          ROUND(
            (julianday(detached.occurred_at) - julianday(admitted.occurred_at))
            * 86400000.0
          )
        ) AS value
        FROM pi_subagent_lifecycle_journal AS detached
        INNER JOIN pi_subagent_lifecycle_journal AS admitted
          ON admitted.execution_id = detached.execution_id
         AND admitted.attempt_id = detached.attempt_id
         AND admitted.generation = detached.generation
         AND admitted.sequence = 1
        WHERE detached.sequence = 3
          AND json_extract(detached.metadata_json, '$.phase') = 'detached'
          AND detached.occurred_at >= admitted.occurred_at
      ),
      detach_ranked AS (
        SELECT
          value,
          row_number() OVER (ORDER BY value) AS rank,
          count(*) OVER () AS sample_count
        FROM detach_samples
      ),
      cancel_starts AS (
        SELECT
          execution_id,
          attempt_id,
          generation,
          MIN(occurred_at) AS occurred_at
        FROM pi_subagent_lifecycle_journal
        WHERE state = 'cancelling'
        GROUP BY execution_id, attempt_id, generation
      ),
      cancel_samples AS (
        SELECT MAX(
          0,
          ROUND(
            (julianday(MIN(terminal.occurred_at)) - julianday(started.occurred_at))
            * 86400000.0
          )
        ) AS value
        FROM cancel_starts AS started
        INNER JOIN pi_subagent_lifecycle_journal AS terminal
          ON terminal.execution_id = started.execution_id
         AND terminal.attempt_id = started.attempt_id
         AND terminal.generation = started.generation
         AND terminal.state IN ('cancelled', 'succeeded', 'failed')
         AND terminal.occurred_at >= started.occurred_at
        GROUP BY started.execution_id, started.attempt_id, started.generation
      ),
      cancel_ranked AS (
        SELECT
          value,
          row_number() OVER (ORDER BY value) AS rank,
          count(*) OVER () AS sample_count
        FROM cancel_samples
      )
      SELECT
        COALESCE(SUM(CASE
          WHEN execution.observed_state IN ('requested', 'accepted', 'running')
          THEN 1 ELSE 0 END), 0) AS "activeCount",
        COALESCE(SUM(CASE WHEN execution.observed_state = 'queued' THEN 1 ELSE 0 END), 0)
          AS "queuedCount",
        COALESCE(SUM(CASE WHEN execution.observed_state = 'cancelling' THEN 1 ELSE 0 END), 0)
          AS "cancellingCount",
        COALESCE(SUM(CASE WHEN execution.observed_state = 'orphaned' THEN 1 ELSE 0 END), 0)
          AS "orphanedCount",
        COALESCE(SUM(CASE
          WHEN execution.observed_state IN ('cancelled', 'succeeded', 'failed', 'rejected')
          THEN 1 ELSE 0 END), 0) AS "terminalCount",
        COALESCE(SUM(CASE
          WHEN execution.observed_state NOT IN ('cancelled', 'succeeded', 'failed', 'rejected')
           AND execution.lease_expires_at IS NOT NULL
           AND execution.lease_expires_at <= ${now}
          THEN 1 ELSE 0 END), 0) AS "leaseExpiryCount",
        COALESCE((
          SELECT MAX(CASE
            WHEN rank = CAST((sample_count + 1) / 2 AS INTEGER) THEN value END)
          FROM detach_ranked
        ), 0) AS "detachP50Ms",
        COALESCE((
          SELECT MAX(CASE
            WHEN rank = CAST((95 * sample_count + 99) / 100 AS INTEGER) THEN value END)
          FROM detach_ranked
        ), 0) AS "detachP95Ms",
        COALESCE((SELECT MAX(value) FROM detach_ranked), 0) AS "detachMaxMs",
        COALESCE((
          SELECT MAX(CASE
            WHEN rank = CAST((sample_count + 1) / 2 AS INTEGER) THEN value END)
          FROM cancel_ranked
        ), 0) AS "cancelP50Ms",
        COALESCE((
          SELECT MAX(CASE
            WHEN rank = CAST((95 * sample_count + 99) / 100 AS INTEGER) THEN value END)
          FROM cancel_ranked
        ), 0) AS "cancelP95Ms",
        COALESCE((SELECT MAX(value) FROM cancel_ranked), 0) AS "cancelMaxMs",
        COALESCE(SUM(execution.dropped_progress_count), 0) AS "progressCoalesced",
        COALESCE((
          SELECT SUM(attempt_count) FROM pi_subagent_completion_outbox
        ), 0) AS "completionRetries"
      FROM pi_subagent_executions AS execution
    `.pipe(
      Effect.map(([row]) => {
        const coalesced = telemetryMetric(row?.progressCoalesced);
        return {
          executionCounts: {
            active: telemetryMetric(row?.activeCount),
            queued: telemetryMetric(row?.queuedCount),
            cancelling: telemetryMetric(row?.cancellingCount),
            orphaned: telemetryMetric(row?.orphanedCount),
            terminal: telemetryMetric(row?.terminalCount),
          },
          leaseExpiryCount: telemetryMetric(row?.leaseExpiryCount),
          detachLatencyMs: {
            p50: telemetryMetric(row?.detachP50Ms),
            p95: telemetryMetric(row?.detachP95Ms),
            max: telemetryMetric(row?.detachMaxMs),
          },
          cancelLatencyMs: {
            p50: telemetryMetric(row?.cancelP50Ms),
            p95: telemetryMetric(row?.cancelP95Ms),
            max: telemetryMetric(row?.cancelMaxMs),
          },
          progress: {
            coalesced,
            dropped: coalesced,
          },
          completionRetries: telemetryMetric(row?.completionRetries),
        };
      }),
      Effect.mapError(
        toPersistenceSqlError("PiSubagentExecutionRepository.getTelemetrySnapshot:query"),
      ),
    );

  return {
    recordAdmission,
    recordLifecycleEvent,
    recordProgressObservation,
    recordHeartbeatObservation,
    getObservation,
    getById,
    getByCommandId,
    listByThreadId,
    listJournalEvents,
    listCancellableByParentTurn,
    recordCancellationIntent,
    recordCancelledAck,
    recordTerminalEvent,
    getTerminalEvidence,
    recordCompletionOutboxEntry,
    getCompletionOutboxEntry,
    listRecoverableCompletionOutbox,
    listTerminalEventsWithoutOutbox,
    markCompletionDelivered,
    markCompletionAcknowledged,
    markCompletionDeliveryFailed,
    markCompletionSuperseded,
    createCompletionDispatchBatch,
    getCompletionDispatchBatch,
    getCompletionDispatchBatchByCommandId,
    getActiveCompletionDispatchBatch,
    listRecoverableCompletionDispatchBatches,
    recordCompletionDispatchAccepted,
    finalizeCompletionDispatchBatch,
    failCompletionDispatchBatch,
    rejectCompletionDispatchBatch,
    supersedeCompletionDispatchBatch,
    listNonTerminalExecutions,
    recordOrphanedEvent,
    recordWallTimeExpiryEvent,
    getTelemetrySnapshot,
  } satisfies PiSubagentExecutionRepositoryShape;
});

export const PiSubagentExecutionRepositoryLive = Layer.effect(
  PiSubagentExecutionRepository,
  makePiSubagentExecutionRepository,
);
