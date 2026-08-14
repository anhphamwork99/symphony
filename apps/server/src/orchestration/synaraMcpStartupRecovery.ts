// FILE: synaraMcpStartupRecovery.ts
// Purpose: Startup recovery of pending project MCP activation operations
// (impl-09, Decisions 16/17/18/19, spec user story 28). Runs after the
// projection bootstrap and before the server marks itself command-ready.
// Every durable pending operation is settled from its persisted deadline with
// ZERO provider/MCP replay (the pre-restart runtimes are gone and cannot be
// re-proven):
//   - pending enable  -> durable failed-disabled rollback + exactly one
//     deterministic failed terminal activity;
//   - pending disable -> durable succeeded-disabled convergence + exactly one
//     deterministic succeeded terminal activity.
// A legacy pending operation created before the impl-09 recovery record
// (no `recoveryIdentity`) cannot be correlated safely and BLOCKS startup with
// a bounded diagnostic instead of being recovered blindly. The module is pure
// orchestration over injected seams (read model, dispatch, clock) so the
// server boundary can drive it with the real clock and tests with a
// controllable one. Journal-first ordering and deterministic command/activity
// IDs make recovery idempotent and replay-safe.
import type {
  OrchestrationCommand,
  OrchestrationReadModel,
  ProjectMcpActivationOperation,
} from "@synara/contracts";

import {
  planSynaraMcpCompletion,
  planSynaraMcpFailure,
  planSynaraMcpRecovery,
} from "./synaraMcpCommand.ts";

/** Stable bounded detail for a pending enable settled by startup recovery. */
export const SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL =
  "The server restarted while Synara MCP activation was pending; the project is rolled back to disabled because the pre-restart runtimes cannot be re-proven without replay. Run /Enable Synara MCP again to activate.";

/** Stable bounded detail when the persisted activation deadline also elapsed. */
export const SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DEADLINE_ELAPSED_DETAIL =
  "The persisted Synara MCP activation deadline also elapsed before the restart completed.";

/**
 * Bounded diagnostic for a legacy pending operation without the impl-09
 * recovery record. Never echoes credentials or raw payloads; it names the
 * operation identity so an operator can locate the journal row.
 */
export function synaraMcpRecoveryBlockedDetail(input: {
  readonly projectId: string;
  readonly requestId: string;
  readonly operationGeneration: number;
}): string {
  return `A pending Synara MCP activation operation without a recovery identity blocks startup: project '${input.projectId}', request '${input.requestId}', operation generation ${input.operationGeneration}. The operation was created before runtime recovery support and cannot be settled safely; resolve the pending operation in the durable journal or restore a consistent journal before starting the server.`;
}

export interface SynaraMcpStartupRecoverySeams {
  readonly now: () => Date;
  readonly getReadModel: () => Promise<OrchestrationReadModel>;
  readonly dispatch: (command: OrchestrationCommand) => Promise<unknown>;
}

export interface SynaraMcpRecoveredOperation {
  readonly projectId: string;
  readonly requestId: string;
  readonly operationGeneration: number;
  /** Exactly one durable terminal outcome per recovered operation. */
  readonly terminal: "succeeded" | "failed";
}

export type SynaraMcpStartupRecoveryResult =
  | { readonly kind: "recovered"; readonly operations: ReadonlyArray<SynaraMcpRecoveredOperation> }
  | { readonly kind: "blocked"; readonly detail: string };

function pendingOperations(readModel: OrchestrationReadModel): ReadonlyArray<{
  readonly projectId: string;
  readonly operation: ProjectMcpActivationOperation;
}> {
  const pending: Array<{ projectId: string; operation: ProjectMcpActivationOperation }> = [];
  for (const project of readModel.projects) {
    const operation = project.synaraMcpActivationOperation;
    if (operation !== null && operation !== undefined && operation.aggregateStatus === "pending") {
      pending.push({ projectId: project.id, operation });
    }
  }
  return pending.sort((left, right) => left.projectId.localeCompare(right.projectId));
}

/**
 * Settle every durable pending operation at startup. The operation's own
 * persisted identity (request id, operation generation, absolute deadline)
 * and recovery record govern the settlement; the persisted deadline is never
 * extended and no provider/MCP call is made. Stale work (an operation that
 * settled between reads) stops without journaling anything. Returns `blocked`
 * with a bounded diagnostic when a legacy pending operation without a
 * recovery identity is found: startup must fail closed rather than guess.
 */
export async function recoverSynaraMcpPendingOperations(input: {
  readonly seams: SynaraMcpStartupRecoverySeams;
}): Promise<SynaraMcpStartupRecoveryResult> {
  const { seams } = input;
  const initial = await seams.getReadModel();
  const pending = pendingOperations(initial);
  const recovered: Array<SynaraMcpRecoveredOperation> = [];

  for (const { projectId, operation } of pending) {
    if (operation.recoveryIdentity === undefined || operation.issuingThreadId === undefined) {
      return {
        kind: "blocked",
        detail: synaraMcpRecoveryBlockedDetail({
          projectId,
          requestId: operation.requestId,
          operationGeneration: operation.operationGeneration,
        }),
      };
    }

    // Fresh read model for the CAS-guarded transition: recovery that races a
    // live settlement (or a second recovery pass) stops without side effects.
    const current = await seams.getReadModel();
    const currentProject = current.projects.find((project) => project.id === projectId);
    const currentOperation = currentProject?.synaraMcpActivationOperation ?? null;
    if (
      currentOperation === null ||
      currentOperation.requestId !== operation.requestId ||
      currentOperation.operationGeneration !== operation.operationGeneration ||
      currentOperation.aggregateStatus !== "pending"
    ) {
      continue;
    }
    const plan = planSynaraMcpRecovery({ project: currentProject, operation: currentOperation });
    if (plan === null) {
      // Defensive: the identity check above already guarantees a recoverable
      // pending operation; an incomplete record still blocks startup rather
      // than settling without a home for the terminal activity.
      return {
        kind: "blocked",
        detail: synaraMcpRecoveryBlockedDetail({
          projectId,
          requestId: operation.requestId,
          operationGeneration: operation.operationGeneration,
        }),
      };
    }

    if (currentOperation.desiredState === "enabled") {
      // Pending enable: the pre-restart runtimes are gone, so activation
      // cannot be re-proven without replaying MCP work. Journal the durable
      // failed-disabled rollback first, then exactly one deterministic
      // failed terminal (Decisions 10/16; AC1 no-replay).
      const deadlineElapsed =
        Date.parse(currentOperation.absoluteDeadline) <= seams.now().getTime();
      const detail = deadlineElapsed
        ? `${SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL} ${SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DEADLINE_ELAPSED_DETAIL}`
        : SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL;
      const failure = planSynaraMcpFailure({
        plan,
        project: currentProject,
        detail,
        now: seams.now,
      });
      if (failure.projectCommand !== null) {
        await seams.dispatch(failure.projectCommand);
      }
      await seams.dispatch(failure.activityCommand);
      recovered.push({
        projectId,
        requestId: operation.requestId,
        operationGeneration: operation.operationGeneration,
        terminal: "failed",
      });
    } else {
      // Pending disable: every captured member's runtime was recreated
      // dormant, so the member provider outcomes are dormant by construction
      // (Decisions 14/18) and the operation converges to the committed
      // disabled state with exactly one deterministic succeeded terminal.
      const completion = planSynaraMcpCompletion({
        plan,
        project: currentProject,
        now: seams.now,
      });
      if (completion.projectCommand !== null) {
        await seams.dispatch(completion.projectCommand);
      }
      await seams.dispatch(completion.terminalActivityCommand);
      recovered.push({
        projectId,
        requestId: operation.requestId,
        operationGeneration: operation.operationGeneration,
        terminal: "succeeded",
      });
    }
  }

  return { kind: "recovered", operations: recovered };
}
