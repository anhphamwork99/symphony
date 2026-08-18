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
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  type PiSubagentAdmissionRecordResult,
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
  type PiSubagentExecutionObservation,
  type PiSubagentLifecycleRecordResult,
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
            const nextDesired =
              input.state === "cancelling"
                ? "cancelling"
                : input.state === "cancelled" ||
                    input.state === "failed" ||
                    input.state === "succeeded" ||
                    input.state === "rejected"
                  ? input.state
                  : currentExecution.desiredState;

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
  } satisfies PiSubagentExecutionRepositoryShape;
});

export const PiSubagentExecutionRepositoryLive = Layer.effect(
  PiSubagentExecutionRepository,
  makePiSubagentExecutionRepository,
);
