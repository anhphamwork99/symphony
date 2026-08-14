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

/**
 * Bounded cleanup grace budget for one rollback disable fan-out (impl-08 F1,
 * Decisions 16/18, AC2 checklist item 4). Independent of the elapsed
 * activation deadline: an expired operation must still attempt to clean every
 * captured member, so each rollback disable call is bounded by this budget
 * instead of by the (possibly already elapsed) activation deadline. The total
 * cleanup window is bounded by wait-set size times this budget; every call is
 * bounded, so the rollback can never hang.
 */
export const SYNARA_MCP_PROJECT_CLEANUP_GRACE_MS = 30_000;

/**
 * The durable wait-set session-generation token format. Must match the
 * planner's mint in `synaraMcpCommand.ts` (`orchestration:<threadId>:<session.updatedAt>`):
 * the live session generation derived at reconciliation time is validated
 * against the captured token by the provider enable boundary (F3).
 */
const synaraMcpSessionGeneration = (threadId: ThreadId, sessionUpdatedAt: string): string =>
  `orchestration:${threadId}:${sessionUpdatedAt}`;

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
    /**
     * The live session generation derived from the current authoritative
     * read model (the same token the planner mints from the live
     * `thread.session.updatedAt`). The provider enable boundary refuses the
     * enable unless the expected (captured) token equals it exactly, so a
     * session recreated on the same thread after capture can never activate
     * from the stale wait-set token (F3, Decision 18).
     */
    readonly liveSessionGeneration: string | undefined;
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
        // The live session generation from the current authoritative read
        // model: the provider boundary matches the full captured token
        // against it (F3) so a recreated same-thread session is refused
        // before any staging. The member-liveness check above guarantees a
        // live session here; undefined stays fail-closed at the boundary.
        liveSessionGeneration: synaraMcpLiveSessionGeneration(current, member.sessionId),
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
 * Derive the live session generation for a wait-set member from the current
 * authoritative read model (F3): the same token the planner mints at
 * acceptance, re-derived from the live `thread.session.updatedAt`. A missing
 * live session yields `undefined`, which the provider enable boundary treats
 * as a fail-closed mismatch.
 */
function synaraMcpLiveSessionGeneration(
  readModel: OrchestrationReadModel,
  sessionId: ThreadId,
): string | undefined {
  const thread = readModel.threads.find((candidate) => candidate.id === sessionId);
  const session = thread?.session ?? null;
  return session === null ? undefined : synaraMcpSessionGeneration(sessionId, session.updatedAt);
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
    try {
      // Every captured member receives one bounded disable attempt under the
      // cleanup grace budget — independent of the elapsed activation
      // deadline (F1: an expired operation must still clean every enabled
      // sibling, Decisions 16/18).
      await seams.disableMember({
        threadId: member.sessionId,
        remainingMs: SYNARA_MCP_PROJECT_CLEANUP_GRACE_MS,
      });
    } catch {
      // Best-effort cleanup: an unproven disable cannot change the durable
      // failed-disabled terminal.
    }
  }
  await seams.dispatch(failure.activityCommand);
  return { terminal: "failed" };
}
