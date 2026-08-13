// FILE: piSynaraMcpDisable.ts
// Purpose: Per-session Synara MCP disable orchestration (impl-07, Decisions
// 13/14). The public provider/session disable boundary delegates here; the
// module fences new MCP admissions synchronously, then drives the lifecycle
// coordinator's ordered sequence (settle in-flight executions exactly once ->
// gateway cancel/drain with the bounded timeout -> revoke/clear -> reload at
// the safe boundary). It never aborts the Pi session/turn, never replays a
// cancelled call, and duplicate disables are idempotent.
import {
  PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE,
  PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
  type PiSynaraMcpDeactivationHandoff,
  type PiSynaraMcpLifecycleCoordinator,
} from "./piSynaraMcpLifecycle.ts";
import type { PiSynaraMcpToolExecutionRegistry } from "./piSynaraMcpToolExecution.ts";

/** Stable sanitized detail for an unproven disable (Decision 14 fail-closed). */
export const PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL =
  "Synara MCP cleanup could not be proven; the session stays unavailable until a fresh /Enable Synara MCP succeeds.";

export interface PiSynaraMcpDisableInput {
  /** The session's lifecycle coordinator; owns the ordered deactivation. */
  readonly coordinator: PiSynaraMcpLifecycleCoordinator;
  /** The session's Pi-local execution registry; fenced synchronously. */
  readonly executions: PiSynaraMcpToolExecutionRegistry;
  /**
   * When the session has an active turn, the runtime reload waits for the
   * safe boundary (the current turn's end); when false (idle session) the
   * reload runs immediately because no turn is running.
   */
  readonly awaitSafeBoundary?: boolean;
}

export interface PiSynaraMcpDisableResult {
  readonly state: "dormant" | "unavailable";
  /** True when the session was already disabled (idempotent duplicate). */
  readonly alreadyDisabled?: boolean;
  /** Stable sanitized detail when cleanup could not be proven. */
  readonly detail?: string;
}

/**
 * Disable one Pi session's Synara MCP integration. The synchronous fence is
 * installed before any asynchronous work so a registration racing disable is
 * rejected before its handler starts. A session that is not active (dormant,
 * or already finalized by a prior disable/dispose) returns an idempotent
 * result, and a session left unavailable stays unavailable until a fresh
 * activation succeeds.
 */
export async function disablePiSynaraMcpSession(
  input: PiSynaraMcpDisableInput,
): Promise<PiSynaraMcpDisableResult> {
  // Synchronous fence first: new MCP admissions fail fast with the structured
  // disabled error before any await yields control.
  input.executions.fence();

  let handoff: PiSynaraMcpDeactivationHandoff;
  try {
    handoff = await input.coordinator.beginDeactivation();
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause.message === PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE ||
        cause.message === PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL)
    ) {
      // The session is already settled (dormant, unavailable, or disposed):
      // the disable is an idempotent no-op that reports the settled state.
      if (input.coordinator.state === "unavailable") {
        return {
          state: "unavailable",
          alreadyDisabled: true,
          detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
        };
      }
      return { state: "dormant", alreadyDisabled: true };
    }
    throw cause;
  }

  const outcome = await handoff.complete({
    awaitSafeBoundary: input.awaitSafeBoundary ?? true,
  });
  if (outcome.state === "unavailable") {
    return { state: "unavailable", detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL };
  }
  return { state: "dormant" };
}
