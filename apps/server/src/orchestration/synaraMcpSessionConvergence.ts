// FILE: synaraMcpSessionConvergence.ts
// Purpose: Per-session Synara MCP convergence from the final durable project
// state (impl-09, Decisions 15/19, spec user stories 14-16). A session that
// starts, resumes, or is recreated never activates from a stale operation:
// while a project activation operation is pending the session waits (it is
// not a wait-set member and cannot alter the operation's outcome), and only
// the FINAL durable state decides — terminal enabled activates through the
// public provider boundary with the exact fresh session generation (fresh
// subject-bound authority rides the session start contract), anything else
// stays dormant. The module never writes project state, so a stale or
// duplicate convergence can never restore enabled state or replay completed
// work. Pure orchestration over injected seams (read model, provider enable,
// clock); the activation is bounded so a hung MCP discovery can never wedge a
// session start.
import type { OrchestrationProject, OrchestrationReadModel, ThreadId } from "@synara/contracts";

import { sanitizeSynaraMcpDiagnostic, synaraMcpSessionGeneration } from "./synaraMcpCommand.ts";

/**
 * Bound for one convergence activation: fresh MCP discovery for a new or
 * recreated session is bounded so a hung discovery degrades to a dormant
 * session (retried at the next session ensure) instead of wedging a turn
 * start (Decision 18 bounded-wait principle).
 */
export const SYNARA_MCP_CONVERGENCE_ACTIVATION_BOUND_MS = 30_000;

/** Stable bounded detail when the convergence activation exceeds its bound. */
export const SYNARA_MCP_CONVERGENCE_ACTIVATION_TIMEOUT_DETAIL =
  "The Synara MCP activation did not complete within the convergence bound; the session stays dormant until the next safe boundary.";

export type SynaraMcpSessionConvergenceDecision = "wait" | "activate" | "dormant";

/**
 * Pure decision for one session against the durable project state (AC2
 * representative states). A missing project fails closed to dormant; any
 * pending operation — enable or disable — makes the session wait for the
 * exact operation terminal; only a terminal succeeded-enable operation
 * activates; terminal failed, terminal disabled, and legacy no-operation
 * states stay dormant.
 */
export function decideSynaraMcpSessionConvergence(
  project: OrchestrationProject | undefined,
): SynaraMcpSessionConvergenceDecision {
  if (project === undefined) return "dormant";
  const operation = project.synaraMcpActivationOperation;
  if (operation === null || operation === undefined) return "dormant";
  if (operation.aggregateStatus === "pending") return "wait";
  if (operation.aggregateStatus === "succeeded" && operation.desiredState === "enabled") {
    return "activate";
  }
  return "dormant";
}

export type SynaraMcpSessionConvergenceEnableResolution =
  | { readonly state: "active" }
  | { readonly state: "unavailable"; readonly detail?: string };

export interface SynaraMcpSessionConvergenceSeams {
  readonly getReadModel: () => Promise<OrchestrationReadModel>;
  readonly enable: (input: {
    readonly threadId: ThreadId;
    readonly expectedSessionGeneration: string;
    readonly liveSessionGeneration: string | undefined;
  }) => Promise<SynaraMcpSessionConvergenceEnableResolution>;
}

export type SynaraMcpSessionConvergenceResult =
  | { readonly kind: "activated" }
  | { readonly kind: "waiting" }
  | { readonly kind: "dormant" }
  | { readonly kind: "unavailable"; readonly detail: string };

/**
 * Converge one session's Synara MCP lifecycle at a safe session boundary.
 * `sessionUpdatedAt` is the EXACT generation of the session that was just
 * created, resumed, or recreated: the enable token is minted from it, never
 * from a captured wait-set token, so a recreated runtime converges under its
 * own fresh generation and stale tokens cannot reattach. When the durable
 * project state is terminal-enabled the enable is attempted exactly once
 * (idempotent for already-active sessions); every failure mode degrades to a
 * dormant session and never touches the durable project state.
 */
export async function convergeSynaraMcpSession(input: {
  readonly threadId: ThreadId;
  readonly sessionUpdatedAt: string;
  readonly seams: SynaraMcpSessionConvergenceSeams;
  readonly boundMs?: number;
}): Promise<SynaraMcpSessionConvergenceResult> {
  const { threadId, sessionUpdatedAt, seams } = input;
  const boundMs = input.boundMs ?? SYNARA_MCP_CONVERGENCE_ACTIVATION_BOUND_MS;

  const readModel = await seams.getReadModel();
  const thread = readModel.threads.find((candidate) => candidate.id === threadId);
  const project =
    thread === undefined
      ? undefined
      : readModel.projects.find((candidate) => candidate.id === thread.projectId);
  const decision = decideSynaraMcpSessionConvergence(project);
  if (decision === "wait") return { kind: "waiting" };
  if (decision === "dormant") return { kind: "dormant" };

  // Terminal enabled: activate under the exact fresh session generation.
  const token = synaraMcpSessionGeneration(threadId, sessionUpdatedAt);
  let resolution: SynaraMcpSessionConvergenceEnableResolution;
  try {
    resolution = await Promise.race([
      seams.enable({
        threadId,
        expectedSessionGeneration: token,
        liveSessionGeneration: token,
      }),
      new Promise<SynaraMcpSessionConvergenceEnableResolution>((resolve) =>
        setTimeout(
          () =>
            resolve({
              state: "unavailable",
              detail: SYNARA_MCP_CONVERGENCE_ACTIVATION_TIMEOUT_DETAIL,
            }),
          boundMs,
        ),
      ),
    ]);
  } catch (cause) {
    // A throwing provider boundary degrades to a dormant session; the next
    // session ensure retries the convergence (never replay).
    return { kind: "unavailable", detail: sanitizeSynaraMcpDiagnostic(cause) };
  }
  if (resolution.state === "active") {
    return { kind: "activated" };
  }
  return {
    kind: "unavailable",
    detail: sanitizeSynaraMcpDiagnostic(
      resolution.detail ?? "The Synara MCP activation could not be proven.",
    ),
  };
}
