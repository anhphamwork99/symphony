import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  PiSubagentCapability,
  PiSubagentDiagnosticCode,
  PiSubagentHandshakeFailureResponse,
  PiSubagentHandshakeRequest,
  PiSubagentHandshakeResponse,
  PiSubagentHandshakeSuccessResponse,
  PiSubagentNegotiatedCapability,
} from "./piSubagents.ts";

describe("Pi subagent handshake contract schemas", () => {
  it("encodes and decodes valid handshake request", () => {
    const validRequest = {
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      supportedProtocolVersions: [1],
      clientVersion: "0.7.2",
      requiredCapabilities: ["managed-spawn", "abort-propagation"],
      optionalCapabilities: ["paginated-transcripts"],
    };

    const decoded = Schema.decodeSync(PiSubagentHandshakeRequest)(validRequest);
    expect(decoded.protocolVersion).toBe(1);
    expect(decoded.requiredCapabilities).toEqual(["managed-spawn", "abort-propagation"]);
  });

  it("rejects handshake request with invalid protocolVersion or missing fields", () => {
    const invalidVersion = {
      protocolVersion: 0, // must be positive int
      supportedProtocolVersions: [0],
      clientVersion: "0.7.2",
      requiredCapabilities: ["managed-spawn"],
    };

    expect(() => Schema.decodeSync(PiSubagentHandshakeRequest)(invalidVersion)).toThrow();

    const missingFields = {
      protocolVersion: 1,
      // missing required fields
    };
    expect(() => Schema.decodeSync(PiSubagentHandshakeRequest)(missingFields)).toThrow();
  });

  it("decodes valid success response", () => {
    const successResponse = {
      ok: true,
      protocolVersion: 1,
      extensionVersion: "0.1.0",
      capabilities: PI_SUBAGENT_CAPABILITIES,
    };

    const decoded = Schema.decodeSync(PiSubagentHandshakeSuccessResponse)(successResponse);
    expect(decoded.ok).toBe(true);
    expect(decoded.protocolVersion).toBe(1);
    expect(decoded.extensionVersion).toBe("0.1.0");
    expect(decoded.capabilities).toHaveLength(PI_SUBAGENT_CAPABILITIES.length);

    const unionDecoded = Schema.decodeSync(PiSubagentHandshakeResponse)(successResponse);
    expect(unionDecoded.ok).toBe(true);
  });

  it("decodes valid failure response with offered-vs-supported diagnostic context", () => {
    const failureResponse = {
      ok: false,
      error: "unsupported_version",
      protocolVersion: 99,
      supportedProtocolVersions: [99, 100],
      extensionVersion: "2.0.0",
      detail: "Host supports v1, extension requires v99+",
    };

    const decoded = Schema.decodeSync(PiSubagentHandshakeFailureResponse)(failureResponse);
    expect(decoded.ok).toBe(false);
    expect(decoded.error).toBe("unsupported_version");
    expect(decoded.protocolVersion).toBe(99);
    expect(decoded.supportedProtocolVersions).toEqual([99, 100]);

    const unionDecoded = Schema.decodeSync(PiSubagentHandshakeResponse)(failureResponse);
    expect(unionDecoded.ok).toBe(false);
  });

  it("decodes negotiated capability record", () => {
    const enabledRecord: PiSubagentNegotiatedCapability = {
      status: "managed_enabled",
      diagnosticCode: "pi_subagent_managed_enabled",
      isManaged: true,
      protocolVersion: 1,
      capabilities: ["managed-spawn"],
      extensionVersion: "0.1.0",
    };
    const decodedEnabled = Schema.decodeSync(PiSubagentNegotiatedCapability)(enabledRecord);
    expect(decodedEnabled.isManaged).toBe(true);
    expect(decodedEnabled.diagnosticCode).toBe("pi_subagent_managed_enabled");

    const absentRecord: PiSubagentNegotiatedCapability = {
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "Subagent extension bridge not found in Pi runtime",
    };
    const decodedAbsent = Schema.decodeSync(PiSubagentNegotiatedCapability)(absentRecord);
    expect(decodedAbsent.isManaged).toBe(false);
    expect(decodedAbsent.status).toBe("bridge_absent");
  });
});
