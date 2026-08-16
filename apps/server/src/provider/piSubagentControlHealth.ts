import type { PiSubagentDiagnosticCode } from "@synara/contracts";
import { Effect, Ref, ServiceMap } from "effect";

export type PiSubagentControlHealthStatus = "available" | "degraded";

export interface PiSubagentControlHealthState {
  readonly status: PiSubagentControlHealthStatus;
  readonly diagnosticCode?: PiSubagentDiagnosticCode;
  readonly reason?: string;
  readonly degradedAt?: string;
}

export interface PiSubagentControlHealthShape {
  readonly getHealth: () => Effect.Effect<PiSubagentControlHealthState>;
  readonly markDegraded: (
    reason?: string,
    diagnosticCode?: PiSubagentDiagnosticCode,
  ) => Effect.Effect<void>;
  readonly markAvailable: () => Effect.Effect<void>;
}

export class PiSubagentControlHealth extends ServiceMap.Service<
  PiSubagentControlHealth,
  PiSubagentControlHealthShape
>()("synara/provider/PiSubagentControlHealth") {}

export function makePiSubagentControlHealth(
  initialState?: Partial<PiSubagentControlHealthState>,
): Effect.Effect<PiSubagentControlHealthShape> {
  return Effect.gen(function* () {
    const initial: PiSubagentControlHealthState = {
      status: initialState?.status ?? "available",
      diagnosticCode: initialState?.diagnosticCode,
      reason: initialState?.reason,
      degradedAt: initialState?.degradedAt,
    };

    const stateRef = yield* Ref.make(initial);

    const getHealth = () => Ref.get(stateRef);

    const markDegraded = (
      reason?: string,
      diagnosticCode: PiSubagentDiagnosticCode = "pi_subagent_control_degraded",
    ) =>
      Ref.set(stateRef, {
        status: "degraded",
        diagnosticCode,
        reason: reason ?? "Managed subagent control health is degraded",
        degradedAt: new Date().toISOString(),
      });

    const markAvailable = () =>
      Ref.set(stateRef, {
        status: "available",
        diagnosticCode: undefined,
        reason: undefined,
        degradedAt: undefined,
      });

    return {
      getHealth,
      markDegraded,
      markAvailable,
    } satisfies PiSubagentControlHealthShape;
  });
}
