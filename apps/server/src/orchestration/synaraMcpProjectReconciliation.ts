// FILE: synaraMcpProjectReconciliation.ts
// Purpose: Project-wide Synara MCP fan-out reconciliation (impl-08,
// Decisions 16/17/18/19). One durable wait-set is captured immutably at
// acceptance by the planner; this module reconciles every captured member
// independently through the public provider boundary (enable/disable), waits
// for all of them, and commits enabled only when every member succeeded. Any
// failure, timeout, or unsafe disappearance journals a durable failed-disabled
// operation, fans out disable cleanup to every captured member (successful
// siblings included), and emits exactly one deterministic terminal activity.
// The module is pure orchestration over injected seams (read model, dispatch,
// bounded provider calls, clock) so the command boundary can drive it with a
// real clock and tests can drive it with a controllable one.
import type {
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  ProjectMcpActivationOperation,
  ThreadId,
} from "@synara/contracts";

import {
  parseSynaraMcpCommand,
  planSynaraMcpCompletion,
  planSynaraMcpFailure,
  planSynaraMcpMemberOutcome,
  synaraMcpMemberStatus,
  type SynaraMcpCommandPlan,
} from "./synaraMcpCommand.ts";

/** Stable bounded detail for an enable member that exceeded the absolute deadline. */
export const SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL =
  "The Synara MCP activation did not complete before its deadline.";

/** Stable bounded detail for a disable member that exceeded the absolute deadline. */
export const SYNARA_MCP_PROJECT_DISABLE_TIMEOUT_DETAIL =
  "The Synara MCP disable did not complete before its deadline.";

/** Stable bounded detail for a wait-set member that disappeared before reconciliation. */
export const SYNARA_MCP_PROJECT_SESSION_DISAPPEARED_DETAIL =
  "A project session disappeared before the safe boundary.";

export type SynaraMcpEnableMemberResolution =
  | { readonly state: "active" }
  | { readonly state: "unavailable"; readonly detail?: string }
  | { readonly state: "timeout"; readonly detail: string };

export type SynaraMcpDisableMemberResolution =
  | { readonly state: "dormant" }
  | { readonly state: "unavailable"; readonly detail?: string }
  | { readonly state: "timeout"; readonly detail: string };

/**
 * External seams owned by the command boundary. The provider member calls are
 * already bounded by the remaining deadline at the boundary; the clock is
 * injectable so the 120-second absolute deadline is never waited on for real
 * in tests.
 */
export interface SynaraMcpProjectReconciliationSeams {
  readonly now: () => Date;
  readonly getReadModel: () => Promise<OrchestrationReadModel>;
  readonly dispatch: (command: OrchestrationCommand) => Promise<unknown>;
  readonly enableMember: (input: {
    readonly threadId: ThreadId;
    readonly expectedSessionGeneration: string;
    readonly remainingMs: number;
  }) => Promise<SynaraMcpEnableMemberResolution>;
  readonly disableMember: (input: {
    readonly threadId: ThreadId;
    readonly remainingMs: number;
  }) => Promise<SynaraMcpDisableMemberResolution>;
}

export interface SynaraMcpProjectReconciliationResult {
  /**
   * Exactly one terminal outcome: "succeeded" when every captured member
   * succeeded, "failed" after a durable failed-disabled rollback, or "none"
   * when the operation was already settled/superseded (stale work stops
   * without journaling anything).
   */
  readonly terminal: "succeeded" | "failed" | "none";
}

function projectFor(
  readModel: OrchestrationReadModel,
  projectId: ThreadId | OrchestrationProject["id"],
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

function currentPendingOperation(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject | undefined;
}): ProjectMcpActivationOperation | null {
  const currentOperation = input.project?.synaraMcpActivationOperation ?? null;
  if (
    currentOperation === null ||
    currentOperation.requestId !== input.plan.requestId ||
    currentOperation.operationGeneration !== input.plan.operation.operationGeneration ||
    currentOperation.aggregateStatus !== "pending"
  ) {
    return null;
  }
  return currentOperation;
}

/**
 * Reconcile one pending Synara MCP operation against its immutable wait-set.
 * Members are reconciled sequentially in deterministic wait-set order; each
 * member's provider call is bounded by the remaining absolute deadline and
 * its durable outcome is journaled independently. Stale work (a settled or
 * superseded operation) stops immediately and journals nothing.
 */
export async function reconcileSynaraMcpProject(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly seams: SynaraMcpProjectReconciliationSeams;
}): Promise<SynaraMcpProjectReconciliationResult> {
  const { plan, seams } = input;
  if (!plan.pending) return { terminal: "none" };
  const kind = parseSynaraMcpCommand(plan.command.message.text);
  if (kind === null) return { terminal: "none" };

  for (const member of plan.operation.waitSet) {
    const current = await seams.getReadModel();
    const currentProject = projectFor(current, plan.project.id);
    const currentOperation = currentPendingOperation({ plan, project: currentProject });
    if (currentOperation === null) {
      // Settled, superseded, or gone: stale work stops without side effects.
      return { terminal: "none" };
    }
    const remainingMs = Date.parse(currentOperation.absoluteDeadline) - seams.now().getTime();
    const status = synaraMcpMemberStatus(current, currentOperation, member);

    if (kind === "enable") {
      if (status === "failed") {
        return journalRollback({
          plan,
          project: currentProject ?? plan.project,
          detail: SYNARA_MCP_PROJECT_SESSION_DISAPPEARED_DETAIL,
          seams,
        });
      }
      if (remainingMs <= 0) {
        return journalRollback({
          plan,
          project: currentProject ?? plan.project,
          detail: SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL,
          seams,
        });
      }
      const resolution = await seams.enableMember({
        threadId: member.sessionId,
        expectedSessionGeneration: member.sessionGeneration,
        remainingMs,
      });
      if (resolution.state !== "active") {
        return journalRollback({
          plan,
          project: currentProject ?? plan.project,
          detail:
            resolution.state === "timeout"
              ? resolution.detail
              : (resolution.detail ?? SYNARA_MCP_PROJECT_ENABLE_TIMEOUT_DETAIL),
          seams,
        });
      }
    } else {
      if (status === "failed") {
        // Nothing live to disable: the member's provider outcome is dormant
        // by construction (Decision 14) and its durable outcome is journaled.
        const after = await seams.getReadModel();
        const memberCommand = planSynaraMcpMemberOutcome({
          plan,
          project: projectFor(after, plan.project.id) ?? plan.project,
          member,
          now: seams.now,
        });
        if (memberCommand !== null) {
          await seams.dispatch(memberCommand);
        }
        continue;
      }
      if (remainingMs <= 0) {
        return journalRollback({
          plan,
          project: currentProject ?? plan.project,
          detail: SYNARA_MCP_PROJECT_DISABLE_TIMEOUT_DETAIL,
          seams,
        });
      }
      const resolution = await seams.disableMember({
        threadId: member.sessionId,
        remainingMs,
      });
      if (resolution.state !== "dormant") {
        return journalRollback({
          plan,
          project: currentProject ?? plan.project,
          detail:
            resolution.state === "timeout"
              ? resolution.detail
              : (resolution.detail ?? SYNARA_MCP_PROJECT_DISABLE_TIMEOUT_DETAIL),
          seams,
        });
      }
    }

    // The member succeeded: journal its durable outcome with the current
    // CAS snapshot (idempotent replays produce no command).
    const after = await seams.getReadModel();
    const memberCommand = planSynaraMcpMemberOutcome({
      plan,
      project: projectFor(after, plan.project.id) ?? plan.project,
      member,
      now: seams.now,
    });
    if (memberCommand !== null) {
      await seams.dispatch(memberCommand);
    }
  }

  // Every captured member succeeded: commit the deterministic terminal.
  const final = await seams.getReadModel();
  const terminal = planSynaraMcpCompletion({
    plan,
    project: projectFor(final, plan.project.id) ?? plan.project,
    now: seams.now,
  });
  if (terminal.projectCommand) {
    await seams.dispatch(terminal.projectCommand);
  }
  await seams.dispatch(terminal.terminalActivityCommand);
  return { terminal: "succeeded" };
}

/**
 * Journal the durable failed-disabled rollback, clean every captured member
 * (successful siblings included) through the bounded provider disable, then
 * journal exactly one failed terminal activity. Cleanup is best-effort: the
 * terminal outcome is already failed-disabled (Decisions 10/16).
 */
async function journalRollback(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject;
  readonly detail: string;
  readonly seams: SynaraMcpProjectReconciliationSeams;
}): Promise<SynaraMcpProjectReconciliationResult> {
  const { plan, project, detail, seams } = input;
  // Journal-first: the durable failed-disabled operation lands before any
  // provider cleanup.
  const failure = planSynaraMcpFailure({ plan, project, detail, now: seams.now });
  if (failure.projectCommand) {
    await seams.dispatch(failure.projectCommand);
  }
  for (const member of plan.operation.waitSet) {
    const remainingMs = Date.parse(plan.operation.absoluteDeadline) - seams.now().getTime();
    if (remainingMs <= 0) {
      continue;
    }
    try {
      await seams.disableMember({ threadId: member.sessionId, remainingMs });
    } catch {
      // Best-effort cleanup: an unproven disable cannot change the durable
      // failed-disabled terminal.
    }
  }
  await seams.dispatch(failure.activityCommand);
  return { terminal: "failed" };
}
