import type { PiSubagentDiagnosticCode, ThreadId } from "@synara/contracts";
import { Effect, Ref, Semaphore, ServiceMap } from "effect";

export type PiSubagentControlHealthStatus = "available" | "degraded";

export interface PiSubagentControlHealthState {
  readonly status: PiSubagentControlHealthStatus;
  readonly diagnosticCode?: PiSubagentDiagnosticCode;
  readonly reason?: string;
  readonly degradedAt?: string;
}

/**
 * A control-health status change (Ticket 21). Exactly one transition is
 * reported per status change; repeated marks in the same status are no-ops.
 * `threadId` scopes the transition to the managed admission thread that drove
 * it so operator warnings can be attributed without leaking command content.
 */
export interface PiSubagentControlHealthTransition {
  readonly from: PiSubagentControlHealthStatus;
  readonly to: PiSubagentControlHealthStatus;
  readonly diagnosticCode?: PiSubagentDiagnosticCode;
  readonly occurredAt: string;
  readonly threadId?: ThreadId;
}

/** Optional attribution context for a health mark (never command content). */
export interface PiSubagentControlHealthMarkContext {
  readonly threadId?: ThreadId;
}

export interface PiSubagentControlHealthShape {
  readonly getHealth: () => Effect.Effect<PiSubagentControlHealthState>;
  /**
   * Degrade control health. Returns the reported transition, or `null` when
   * health was already degraded (the first diagnostic and timestamp stay
   * stable so repeated failures do not churn operator surfaces).
   */
  readonly markDegraded: (
    reason?: string,
    diagnosticCode?: PiSubagentDiagnosticCode,
    context?: PiSubagentControlHealthMarkContext,
  ) => Effect.Effect<PiSubagentControlHealthTransition | null>;
  /**
   * Recover control health. Returns the reported transition, or `null` when
   * health was already available.
   */
  readonly markAvailable: (
    context?: PiSubagentControlHealthMarkContext,
  ) => Effect.Effect<PiSubagentControlHealthTransition | null>;
  /**
   * Single-flight gate for admission-driven recovery probes (Ticket 21).
   * While control health is degraded, at most one admission at a time may
   * execute its durable recovery probe; other admissions wait, then re-read
   * health and perform their own normal admission or probe. There is no timer
   * and no automatic replay: only a fresh authorized command probes.
   */
  readonly withRecoveryProbe: <A, E, R>(
    probe: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class PiSubagentControlHealth extends ServiceMap.Service<
  PiSubagentControlHealth,
  PiSubagentControlHealthShape
>()("synara/provider/PiSubagentControlHealth") {}

export function makePiSubagentControlHealth(
  initialState?: Partial<PiSubagentControlHealthState>,
): Effect.Effect<PiSubagentControlHealthShape> {
  return Effect.gen(function* () {
    const initial: PiSubagentControlHealthState = initialState
      ? {
          status: initialState.status ?? "available",
          ...(initialState.diagnosticCode !== undefined
            ? { diagnosticCode: initialState.diagnosticCode }
            : {}),
          ...(initialState.reason !== undefined ? { reason: initialState.reason } : {}),
          ...(initialState.degradedAt !== undefined
            ? { degradedAt: initialState.degradedAt }
            : {}),
        }
      : { status: "available" };

    const stateRef = yield* Ref.make(initial);
    const recoveryProbeSemaphore = Semaphore.makeUnsafe(1);

    const getHealth = () => Ref.get(stateRef);

    const markDegraded = (
      reason?: string,
      diagnosticCode: PiSubagentDiagnosticCode = "pi_subagent_control_degraded",
      context?: PiSubagentControlHealthMarkContext,
    ): Effect.Effect<PiSubagentControlHealthTransition | null> =>
      Effect.gen(function* () {
        const occurredAt = new Date().toISOString();
        const transition = yield* Ref.modify(stateRef, (state) => {
          if (state.status === "degraded") {
            // Already degraded: not a new transition. The first diagnostic,
            // reason, and timestamp stay stable.
            return [null, state] as const;
          }
          const next: PiSubagentControlHealthState = {
            status: "degraded",
            diagnosticCode,
            reason: reason ?? "Managed subagent control health is degraded",
            degradedAt: occurredAt,
          };
          const reported: PiSubagentControlHealthTransition = {
            from: "available",
            to: "degraded",
            diagnosticCode,
            occurredAt,
            ...(context?.threadId !== undefined ? { threadId: context.threadId } : {}),
          };
          return [reported, next] as const;
        });
        return transition;
      });

    const markAvailable = (
      context?: PiSubagentControlHealthMarkContext,
    ): Effect.Effect<PiSubagentControlHealthTransition | null> =>
      Effect.gen(function* () {
        const occurredAt = new Date().toISOString();
        const transition = yield* Ref.modify(stateRef, (state) => {
          if (state.status === "available") {
            return [null, state] as const;
          }
          const next: PiSubagentControlHealthState = { status: "available" };
          const reported: PiSubagentControlHealthTransition = {
            from: "degraded",
            to: "available",
            occurredAt,
            ...(state.diagnosticCode !== undefined
              ? { diagnosticCode: state.diagnosticCode }
              : {}),
            ...(context?.threadId !== undefined ? { threadId: context.threadId } : {}),
          };
          return [reported, next] as const;
        });
        return transition;
      });

    const withRecoveryProbe: PiSubagentControlHealthShape["withRecoveryProbe"] = (probe) =>
      recoveryProbeSemaphore.withPermits(1)(probe);

    return {
      getHealth,
      markDegraded,
      markAvailable,
      withRecoveryProbe,
    } satisfies PiSubagentControlHealthShape;
  });
}
