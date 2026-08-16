import { randomUUID } from "node:crypto";
import {
  type OrchestrationReadModel,
  type PiSubagentNegotiatedCapability,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
} from "@synara/contracts";
import { Effect } from "effect";

import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";

export interface AdmissionSnapshotQuery {
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, unknown>;
}

export interface AdmitSubagentSpawnInput {
  readonly command: PiSubagentSpawnCommand;
  readonly sessionCapability?: PiSubagentNegotiatedCapability;
  readonly snapshotQuery: AdmissionSnapshotQuery;
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly now?: string;
}

export const admitSubagentSpawn = (
  input: AdmitSubagentSpawnInput,
): Effect.Effect<PiSubagentSpawnResult, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date().toISOString();

    // 1. Check capability handshake
    if (
      !input.sessionCapability ||
      !input.sessionCapability.isManaged ||
      input.sessionCapability.status !== "managed_enabled"
    ) {
      return {
        status: "rejected",
        executionId: `exec_unmanaged_${randomUUID()}`,
        attemptId: `att_unmanaged_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: input.sessionCapability?.diagnosticCode ?? "pi_subagent_bridge_absent",
        rejectionReason:
          input.sessionCapability?.diagnosticMessage ??
          "Pi subagent managed execution is not enabled for this session",
      };
    }

    // 2. Check snapshot for thread / project / active turn authorization
    const snapshot = yield* input.snapshotQuery.getSnapshot();
    const thread = snapshot.threads.find((t) => t.id === input.command.parentThreadId);

    if (!thread) {
      const executionId = `exec_rejected_${randomUUID()}`;
      const attemptId = `att_rejected_${randomUUID()}`;
      yield* input.repository.recordAdmission({
        executionId,
        attemptId,
        generation: 1,
        commandId: input.command.commandId,
        projectId: input.command.projectId,
        parentThreadId: input.command.parentThreadId,
        parentTurnId: input.command.parentTurnId,
        parentToolCallId: input.command.parentToolCallId,
        agentType: input.command.agentType,
        prompt: input.command.prompt,
        mode: input.command.mode,
        cancellationScope: input.command.cancellationScope,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_unauthorized",
        rejectionReason: `Parent thread '${input.command.parentThreadId}' not found`,
        now,
      });

      return {
        status: "rejected",
        executionId,
        attemptId,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_unauthorized",
        rejectionReason: `Parent thread '${input.command.parentThreadId}' not found`,
      };
    }

    if (thread.archivedAt != null) {
      const executionId = `exec_rejected_${randomUUID()}`;
      const attemptId = `att_rejected_${randomUUID()}`;
      yield* input.repository.recordAdmission({
        executionId,
        attemptId,
        generation: 1,
        commandId: input.command.commandId,
        projectId: input.command.projectId,
        parentThreadId: input.command.parentThreadId,
        parentTurnId: input.command.parentTurnId,
        parentToolCallId: input.command.parentToolCallId,
        agentType: input.command.agentType,
        prompt: input.command.prompt,
        mode: input.command.mode,
        cancellationScope: input.command.cancellationScope,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_unauthorized",
        rejectionReason: `Parent thread '${input.command.parentThreadId}' is archived`,
        now,
      });

      return {
        status: "rejected",
        executionId,
        attemptId,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_unauthorized",
        rejectionReason: `Parent thread '${input.command.parentThreadId}' is archived`,
      };
    }

    if (thread.projectId !== input.command.projectId) {
      const executionId = `exec_rejected_${randomUUID()}`;
      const attemptId = `att_rejected_${randomUUID()}`;
      yield* input.repository.recordAdmission({
        executionId,
        attemptId,
        generation: 1,
        commandId: input.command.commandId,
        projectId: input.command.projectId,
        parentThreadId: input.command.parentThreadId,
        parentTurnId: input.command.parentTurnId,
        parentToolCallId: input.command.parentToolCallId,
        agentType: input.command.agentType,
        prompt: input.command.prompt,
        mode: input.command.mode,
        cancellationScope: input.command.cancellationScope,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_project_mismatch",
        rejectionReason: `Project mismatch: thread belongs to '${thread.projectId}', command specified '${input.command.projectId}'`,
        now,
      });

      return {
        status: "rejected",
        executionId,
        attemptId,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_project_mismatch",
        rejectionReason: `Project mismatch: thread belongs to '${thread.projectId}', command specified '${input.command.projectId}'`,
      };
    }

    if (input.command.parentTurnId) {
      const hasActiveTurn =
        thread.session?.activeTurnId === input.command.parentTurnId ||
        (thread.latestTurn?.id === input.command.parentTurnId &&
          thread.latestTurn?.state === "running");

      if (!hasActiveTurn) {
        const executionId = `exec_rejected_${randomUUID()}`;
        const attemptId = `att_rejected_${randomUUID()}`;
        yield* input.repository.recordAdmission({
          executionId,
          attemptId,
          generation: 1,
          commandId: input.command.commandId,
          projectId: input.command.projectId,
          parentThreadId: input.command.parentThreadId,
          parentTurnId: input.command.parentTurnId,
          parentToolCallId: input.command.parentToolCallId,
          agentType: input.command.agentType,
          prompt: input.command.prompt,
          mode: input.command.mode,
          cancellationScope: input.command.cancellationScope,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_active_turn_required",
          rejectionReason: `Parent thread '${input.command.parentThreadId}' has no active turn matching '${input.command.parentTurnId}'`,
          now,
        });

        return {
          status: "rejected",
          executionId,
          attemptId,
          generation: 1,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_active_turn_required",
          rejectionReason: `Parent thread '${input.command.parentThreadId}' has no active turn matching '${input.command.parentTurnId}'`,
        };
      }
    }

    // 3. Authorized and valid: Record in repository (journal-first + deduplication)
    const executionId = `exec_${randomUUID()}`;
    const attemptId = `att_${randomUUID()}`;
    const admissionResult = yield* input.repository.recordAdmission({
      executionId,
      attemptId,
      generation: 1,
      commandId: input.command.commandId,
      projectId: input.command.projectId,
      parentThreadId: input.command.parentThreadId,
      parentTurnId: input.command.parentTurnId,
      parentToolCallId: input.command.parentToolCallId,
      agentType: input.command.agentType,
      prompt: input.command.prompt,
      mode: input.command.mode,
      cancellationScope: input.command.cancellationScope,
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
      now,
    });

    if (admissionResult.kind === "already_applied") {
      return {
        status: "already_applied",
        executionId: admissionResult.execution.executionId,
        attemptId: admissionResult.execution.attemptId,
        generation: admissionResult.execution.generation,
        state: admissionResult.execution.observedState,
        diagnosticCode: "pi_subagent_already_applied",
      };
    }

    return {
      status: "accepted",
      executionId: admissionResult.execution.executionId,
      attemptId: admissionResult.execution.attemptId,
      generation: admissionResult.execution.generation,
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
    };
  });
