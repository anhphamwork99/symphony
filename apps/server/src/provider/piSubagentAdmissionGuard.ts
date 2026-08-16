import type { PiSubagentDiagnosticCode, PiSubagentNegotiatedCapability } from "@synara/contracts";

export interface PiSubagentAdmissionCheckResult {
  readonly admitted: boolean;
  readonly reason?: string;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
}

export function checkManagedSubagentAdmission(
  capability: PiSubagentNegotiatedCapability | undefined,
): PiSubagentAdmissionCheckResult {
  if (!capability || !capability.isManaged || capability.status !== "managed_enabled") {
    return {
      admitted: false,
      reason: capability?.diagnosticMessage ?? "Pi subagent managed execution is not enabled for this session",
      diagnosticCode: capability?.diagnosticCode ?? "pi_subagent_bridge_absent",
    };
  }

  return {
    admitted: true,
    diagnosticCode: "pi_subagent_managed_enabled",
  };
}
