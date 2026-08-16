import { describe, expect, it } from "vitest";

import type { PiSubagentNegotiatedCapability } from "@synara/contracts";

import { checkManagedSubagentAdmission } from "./piSubagentAdmissionGuard.ts";

describe("Pi subagent admission guard (T01-AC6)", () => {
  it("admits managed subagents only when session has successful managed_enabled handshake", () => {
    const enabledCapability: PiSubagentNegotiatedCapability = {
      status: "managed_enabled",
      diagnosticCode: "pi_subagent_managed_enabled",
      isManaged: true,
      protocolVersion: 1,
      capabilities: ["managed-spawn", "abort-propagation"],
    };

    const result = checkManagedSubagentAdmission(enabledCapability);
    expect(result.admitted).toBe(true);
    expect(result.diagnosticCode).toBe("pi_subagent_managed_enabled");
  });

  it("rejects managed admission when capability is absent or undefined", () => {
    const result = checkManagedSubagentAdmission(undefined);
    expect(result.admitted).toBe(false);
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
  });

  it("rejects managed admission when bridge was absent during handshake", () => {
    const absentCapability: PiSubagentNegotiatedCapability = {
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "Bridge absent",
    };

    const result = checkManagedSubagentAdmission(absentCapability);
    expect(result.admitted).toBe(false);
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
    expect(result.reason).toContain("Bridge absent");
  });

  it("rejects managed admission when handshake failed due to unsupported version", () => {
    const unsupportedCapability: PiSubagentNegotiatedCapability = {
      status: "unsupported_version",
      diagnosticCode: "pi_subagent_unsupported_version",
      isManaged: false,
      offeredVersion: 1,
      supportedVersions: [99],
      diagnosticMessage: "Version 99 required",
    };

    const result = checkManagedSubagentAdmission(unsupportedCapability);
    expect(result.admitted).toBe(false);
    expect(result.diagnosticCode).toBe("pi_subagent_unsupported_version");
    expect(result.reason).toContain("Version 99 required");
  });

  it("rejects managed admission when handshake resulted in bridge_error", () => {
    const errorCapability: PiSubagentNegotiatedCapability = {
      status: "bridge_error",
      diagnosticCode: "pi_subagent_bridge_error",
      isManaged: false,
      diagnosticMessage: "Bridge threw exception",
    };

    const result = checkManagedSubagentAdmission(errorCapability);
    expect(result.admitted).toBe(false);
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_error");
    expect(result.reason).toContain("Bridge threw exception");
  });
});
