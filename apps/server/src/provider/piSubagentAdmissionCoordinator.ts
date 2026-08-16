import { randomUUID } from "node:crypto";
import {
  type OrchestrationReadModel,
  type PiSubagentNegotiatedCapability,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
} from "@synara/contracts";
import { Effect } from "effect";

import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { PiSubagentControlHealthShape } from "./piSubagentControlHealth.ts";

export interface AdmissionSnapshotQuery {
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, unknown>;
}

export interface TrustedAdmissionContext {
  readonly trustedThreadId?: string;
  readonly trustedProjectId?: string;
  readonly trustedActiveTurnId?: string | null;
  readonly trustedProvider?: string;
  readonly mcpAuthority?: {
    readonly subject?: string;
    readonly expiresAt?: string;
  } | null;
  readonly approvalRequired?: boolean;
  readonly approvalGranted?: boolean;
}

export interface AdmitSubagentSpawnInput {
  readonly command: PiSubagentSpawnCommand;
  readonly sessionCapability?: PiSubagentNegotiatedCapability;
  readonly snapshotQuery: AdmissionSnapshotQuery;
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly controlHealth?: PiSubagentControlHealthShape;
  readonly trustedContext?: TrustedAdmissionContext;
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

    // 2. Check managed control health (fails closed when degraded)
    if (input.controlHealth) {
      const health = yield* input.controlHealth.getHealth();
      if (health.status === "degraded") {
        return {
          status: "rejected",
          executionId: `exec_rejected_${randomUUID()}`,
          attemptId: `att_rejected_${randomUUID()}`,
          generation: 1,
          state: "rejected",
          diagnosticCode: health.diagnosticCode ?? "pi_subagent_control_degraded",
          rejectionReason:
            health.reason ?? "Managed subagent control health is degraded due to persistence unavailability",
        };
      }
    }

    // 3. Check server-minted trusted authority context (T20-AC5)
    if (input.trustedContext) {
      const {
        trustedThreadId,
        trustedProjectId,
        trustedActiveTurnId,
        trustedProvider,
        mcpAuthority,
        approvalRequired,
        approvalGranted,
      } = input.trustedContext;

      if (trustedProvider !== undefined && trustedProvider !== "pi") {
        const executionId = `exec_rejected_${randomUUID()}`;
        const attemptId = `att_rejected_${randomUUID()}`;
        return {
          status: "rejected",
          executionId,
          attemptId,
          generation: 1,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_provider_mismatch",
          rejectionReason: `Provider mismatch: expected 'pi', received '${trustedProvider}'`,
        };
      }

      if (mcpAuthority?.expiresAt) {
        const expiryTime = new Date(mcpAuthority.expiresAt).getTime();
        const currentTime = new Date(now).getTime();
        if (Number.isFinite(expiryTime) && expiryTime <= currentTime) {
          const executionId = `exec_rejected_${randomUUID()}`;
          const attemptId = `att_rejected_${randomUUID()}`;
          return {
            status: "rejected",
            executionId,
            attemptId,
            generation: 1,
            state: "rejected",
            diagnosticCode: "pi_subagent_admission_unauthorized",
            rejectionReason: "Subject authority credentials have expired",
          };
        }
      }

      if (trustedThreadId !== undefined && input.command.parentThreadId !== trustedThreadId) {
        const executionId = `exec_rejected_${randomUUID()}`;
        const attemptId = `att_rejected_${randomUUID()}`;
        return {
          status: "rejected",
          executionId,
          attemptId,
          generation: 1,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_unauthorized",
          rejectionReason: `Thread authorization mismatch: command specified '${input.command.parentThreadId}', trusted context is '${trustedThreadId}'`,
        };
      }

      if (trustedProjectId !== undefined && input.command.projectId !== trustedProjectId) {
        const executionId = `exec_rejected_${randomUUID()}`;
        const attemptId = `att_rejected_${randomUUID()}`;
        return {
          status: "rejected",
          executionId,
          attemptId,
          generation: 1,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_project_mismatch",
          rejectionReason: `Project authorization mismatch: command specified '${input.command.projectId}', trusted context is '${trustedProjectId}'`,
        };
      }

      if (
        trustedActiveTurnId !== undefined &&
        input.command.parentTurnId &&
        input.command.parentTurnId !== trustedActiveTurnId
      ) {
        const executionId = `exec_rejected_${randomUUID()}`;
        const attemptId = `att_rejected_${randomUUID()}`;
        return {
          status: "rejected",
          executionId,
          attemptId,
          generation: 1,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_active_turn_required",
          rejectionReason: `Active turn mismatch: command specified '${input.command.parentTurnId}', trusted active turn is '${trustedActiveTurnId}'`,
        };
      }

      if (approvalRequired && !approvalGranted) {
        const executionId = `exec_rejected_${randomUUID()}`;
        const attemptId = `att_rejected_${randomUUID()}`;
        return {
          status: "rejected",
          executionId,
          attemptId,
          generation: 1,
          state: "rejected",
          diagnosticCode: "pi_subagent_admission_unauthorized",
          rejectionReason: "Subagent spawn requires approval which was not granted",
        };
      }
    }

    // 4. Check snapshot for thread / project / active turn authorization
    const snapshot = yield* input.snapshotQuery.getSnapshot();
    const thread = snapshot.threads.find((t) => t.id === input.command.parentThreadId);

    if (!thread) {
      const executionId = `exec_rejected_${randomUUID()}`;
      const attemptId = `att_rejected_${randomUUID()}`;
      yield* Effect.ignore(
        input.repository.recordAdmission({
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
        }),
      );

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
      yield* Effect.ignore(
        input.repository.recordAdmission({
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
        }),
      );

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
      yield* Effect.ignore(
        input.repository.recordAdmission({
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
        }),
      );

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
        yield* Effect.ignore(
          input.repository.recordAdmission({
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
          }),
        );

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

    // 4. Authorized and valid: Record in repository (journal-first + deduplication)
    const executionId = `exec_${randomUUID()}`;
    const attemptId = `att_${randomUUID()}`;

    const admissionResultOrError = yield* input.repository
      .recordAdmission({
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
      })
      .pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "failure" as const, error }),
          onSuccess: (result) => ({ _tag: "success" as const, result }),
        }),
      );

    if (admissionResultOrError._tag === "failure") {
      const error = admissionResultOrError.error;
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as any).message)
            : String(error);

      if (input.controlHealth) {
        yield* input.controlHealth.markDegraded(
          `Failed to persist execution lifecycle truth: ${errorMessage}`,
          "pi_subagent_lifecycle_persistence_failed",
        );
      }

      return {
        status: "rejected",
        executionId: `exec_rejected_${randomUUID()}`,
        attemptId: `att_rejected_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
        rejectionReason: `Failed to persist execution lifecycle truth: ${errorMessage}`,
      };
    }

    const admissionResult = admissionResultOrError.result;

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
