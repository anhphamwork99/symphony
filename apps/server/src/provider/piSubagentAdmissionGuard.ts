import type { PiSubagentDiagnosticCode, PiSubagentNegotiatedCapability } from "@synara/contracts";

import type { PiSubagentControlHealthState } from "./piSubagentControlHealth.ts";

export interface PiSubagentAdmissionCheckResult {
  readonly admitted: boolean;
  readonly reason?: string;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
}

export function checkManagedSubagentAdmission(
  capability: PiSubagentNegotiatedCapability | undefined,
  health?: PiSubagentControlHealthState,
): PiSubagentAdmissionCheckResult {
  if (!capability || !capability.isManaged || capability.status !== "managed_enabled") {
    return {
      admitted: false,
      reason:
        capability?.diagnosticMessage ??
        "Pi subagent managed execution is not enabled for this session",
      diagnosticCode: capability?.diagnosticCode ?? "pi_subagent_bridge_absent",
    };
  }

  if (health && health.status === "degraded") {
    return {
      admitted: false,
      reason: health.reason ?? "Pi subagent managed control health is degraded",
      diagnosticCode: health.diagnosticCode ?? "pi_subagent_control_degraded",
    };
  }

  return {
    admitted: true,
    diagnosticCode: "pi_subagent_managed_enabled",
  };
}
