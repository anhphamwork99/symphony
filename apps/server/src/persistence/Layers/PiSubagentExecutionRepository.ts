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

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  type PiSubagentAdmissionRecordResult,
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
  type RecordPiSubagentAdmissionInput,
} from "../Services/PiSubagentExecutionRepository.ts";

interface ExecutionRow {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly commandId: string;
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

export const makePiSubagentExecutionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getByCommandIdInternal = (commandId: string) =>
    sql<ExecutionRow>`
      SELECT
        execution_id AS "executionId",
        attempt_id AS "attemptId",
        generation,
        command_id AS "commandId",
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
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM pi_subagent_executions
      WHERE command_id = ${commandId}
      LIMIT 1
    `;

  const getByIdInternal = (executionId: string) =>
    sql<ExecutionRow>`
      SELECT
        execution_id AS "executionId",
        attempt_id AS "attemptId",
        generation,
        command_id AS "commandId",
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
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM pi_subagent_executions
      WHERE execution_id = ${executionId}
      LIMIT 1
    `;

  const recordAdmission: PiSubagentExecutionRepositoryShape["recordAdmission"] = (input) =>
    Effect.gen(function* () {
      const existingRows = yield* getByCommandIdInternal(input.commandId).pipe(
        Effect.mapError(toPersistenceSqlError),
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

      // Journal-first: write to lifecycle journal before or in transaction with execution record
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
      `.pipe(Effect.mapError(toPersistenceSqlError));

      yield* sql`
        INSERT INTO pi_subagent_executions (
          execution_id,
          attempt_id,
          generation,
          command_id,
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
          created_at,
          updated_at
        ) VALUES (
          ${input.executionId},
          ${input.attemptId},
          ${input.generation},
          ${input.commandId},
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
          ${input.now},
          ${input.now}
        )
      `.pipe(Effect.mapError(toPersistenceSqlError));

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
    });

  const getById: PiSubagentExecutionRepositoryShape["getById"] = (executionId) =>
    Effect.gen(function* () {
      const rows = yield* getByIdInternal(executionId).pipe(
        Effect.mapError(toPersistenceSqlError),
      );
      return rows.length > 0 ? Option.some(rowToExecutionRecord(rows[0]!)) : Option.none();
    });

  const getByCommandId: PiSubagentExecutionRepositoryShape["getByCommandId"] = (commandId) =>
    Effect.gen(function* () {
      const rows = yield* getByCommandIdInternal(commandId).pipe(
        Effect.mapError(toPersistenceSqlError),
      );
      return rows.length > 0 ? Option.some(rowToExecutionRecord(rows[0]!)) : Option.none();
    });

  const listByThreadId: PiSubagentExecutionRepositoryShape["listByThreadId"] = (threadId) =>
    Effect.gen(function* () {
      const rows = yield* sql<ExecutionRow>`
        SELECT
          execution_id AS "executionId",
          attempt_id AS "attemptId",
          generation,
          command_id AS "commandId",
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
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM pi_subagent_executions
        WHERE parent_thread_id = ${threadId}
        ORDER BY created_at ASC
      `.pipe(Effect.mapError(toPersistenceSqlError));

      return rows.map(rowToExecutionRecord);
    });

  const listJournalEvents: PiSubagentExecutionRepositoryShape["listJournalEvents"] = (executionId) =>
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
        ORDER BY j.sequence ASC
      `.pipe(Effect.mapError(toPersistenceSqlError));

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
    getById,
    getByCommandId,
    listByThreadId,
    listJournalEvents,
  } satisfies PiSubagentExecutionRepositoryShape;
});

export const PiSubagentExecutionRepositoryLive = Layer.effect(
  PiSubagentExecutionRepository,
  makePiSubagentExecutionRepository,
);
