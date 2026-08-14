// FILE: piSynaraMcpEnable.ts
// Purpose: Per-session Synara MCP enable orchestration (impl-08, Decisions
// 16/17/18). The public provider/session enable boundary delegates here; the
// module drives the lifecycle coordinator's serialized activation and maps
// every bounded activation outcome to a non-throwing result. A wait-set
// member's durable session generation is validated before any activation
// (a stale or misrouted generation is refused), and an idle session — whose
// runtime never fires `agent_end` — gets its safe boundary pumped locally so
// the catalog applies immediately instead of waiting forever.
import type { ThreadId, TurnId } from "@synara/contracts";

import {
  PI_SYNARA_MCP_DEACTIVATION_IN_PROGRESS_REFUSAL,
  PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
  type PiSynaraMcpActivationResult,
  type PiSynaraMcpLifecycleCoordinator,
} from "./piSynaraMcpLifecycle.ts";
import type { PiSynaraMcpDormantAdapter } from "./piSynaraMcpExtension.ts";

/** Stable sanitized detail for an unproven enable (Decisions 10/16 fail-closed). */
export const PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL =
  "Synara MCP activation could not be proven; the project remains disabled until a fresh /Enable Synara MCP succeeds.";

/** Stable sanitized detail when the enable carries a stale/misrouted session generation. */
export const PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL =
  "The enable request carries a stale session generation for this session.";

/** Idle-boundary pump cadence: no real deadline is involved, only the local apply boundary. */
export const PI_SYNARA_MCP_ENABLE_IDLE_BOUNDARY_PUMP_MS = 25;

/** The durable wait-set session-generation format the orchestration planner binds. */
const SESSION_GENERATION_PREFIX = "orchestration:";

export interface PiSynaraMcpEnableInput {
  /** The session's thread; the expected generation must be bound to it. */
  readonly threadId: ThreadId;
  /** The session's lifecycle coordinator; owns the serialized activation. */
  readonly coordinator: PiSynaraMcpLifecycleCoordinator;
  /**
   * The session's dormant adapter; its `notifySafeBoundary` is the idle
   * session's safe-boundary source (a runtime without an active turn never
   * emits `agent_end`).
   */
  readonly adapter: PiSynaraMcpDormantAdapter;
  /**
   * The durable wait-set session generation this activation is bound to
   * (impl-08). A stale or misrouted generation is refused before any staging.
   */
  readonly expectedSessionGeneration: string;
  /**
   * The session's exact active turn at enable time. When undefined the
   * session is idle and its safe boundary is immediate (pumped locally);
   * when a turn is active the natural `agent_end` boundary is awaited.
   */
  readonly activeTurnId?: TurnId;
  /**
   * Whether an idle session is still idle (a turn may start mid-activation).
   * Once a turn starts, the pump stops notifying so the tool surface is never
   * applied mid-turn; the natural boundary resolves the activation instead.
   * Defaults to true.
   */
  readonly isStillIdle?: () => boolean;
}

export interface PiSynaraMcpEnableResult {
  readonly state: "active" | "unavailable";
  /** True when the session was already active (idempotent duplicate). */
  readonly alreadyActive?: boolean;
  /** Stable sanitized detail when activation could not be proven. */
  readonly detail?: string;
}

function mapActivationResult(result: PiSynaraMcpActivationResult): PiSynaraMcpEnableResult {
  if (result.ok) {
    return { state: "active", alreadyActive: result.alreadyActive };
  }
  return { state: "unavailable", detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL };
}

/**
 * Enable one Pi session's Synara MCP integration. The activation is refused
 * before any staging when the expected session generation does not bind to
 * this thread (a stale wait-set member must never activate a different or
 * recreated session), and a session that is mid-deactivation or disposed
 * cannot be enabled (fail-closed: the disable wins). Idle sessions receive a
 * bounded local boundary pump; sessions with an active turn wait for the
 * natural `agent_end` boundary. Duplicate enables are idempotent.
 */
export async function enablePiSynaraMcpSession(
  input: PiSynaraMcpEnableInput,
): Promise<PiSynaraMcpEnableResult> {
  // Stale/misrouted generation refusal: the durable wait-set token captured
  // for this session must identify exactly this thread. Anything else is a
  // stale generation from an older operation or a different session and can
  // never activate this session.
  if (
    !input.expectedSessionGeneration.startsWith(`${SESSION_GENERATION_PREFIX}${input.threadId}:`)
  ) {
    return { state: "unavailable", detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL };
  }

  const activation = input.coordinator.activate({
    expectedSessionGeneration: input.expectedSessionGeneration,
  });

  // An idle session's runtime never emits `agent_end`: pump the safe boundary
  // until the activation settles so the staged catalog applies immediately.
  // The pump is harmless before the coordinator registers its boundary
  // listener (no listener, no-op) and stops as soon as the activation settles
  // or a turn starts (the natural boundary then resolves it). The activation
  // starts in a microtask, so the pump must not gate on the coordinator state
  // it will observe at startup.
  let settled = false;
  const boundaryPump =
    input.activeTurnId !== undefined
      ? Promise.resolve()
      : (async () => {
          while (!settled) {
            try {
              if (input.isStillIdle?.() ?? true) {
                await input.adapter.notifySafeBoundary();
              }
            } catch {
              // A listener failure must not wedge the pump; the coordinator's
              // own boundary handling records the failure.
            }
            await new Promise((resolve) =>
              setTimeout(resolve, PI_SYNARA_MCP_ENABLE_IDLE_BOUNDARY_PUMP_MS),
            );
          }
        })();

  try {
    const result = await activation;
    return mapActivationResult(result);
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause.message === PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL ||
        cause.message === PI_SYNARA_MCP_DEACTIVATION_IN_PROGRESS_REFUSAL)
    ) {
      // The session is disposed or a disable is in progress: the enable is a
      // bounded fail-closed refusal.
      return { state: "unavailable", detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL };
    }
    throw cause;
  } finally {
    settled = true;
    await boundaryPump;
  }
}
