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
  PiSubagentLifecycleEvent,
  PiSubagentNegotiatedCapability,
  PiSubagentSpawnCommand,
  PiSubagentSpawnResult,
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

describe("Pi subagent admission and identity contract schemas (T02-AC1, T02-AC2, T02-AC5)", () => {
  it("encodes and decodes valid spawn command", () => {
    const command = {
      commandId: "cmd_test_123",
      projectId: "proj_abc",
      parentThreadId: "thread_main",
      parentTurnId: "turn_001",
      parentToolCallId: "call_subagent_1",
      agentType: "researcher",
      prompt: "Investigate database performance",
      mode: "foreground",
      cancellationScope: "parent_turn",
    };

    const decoded = Schema.decodeSync(PiSubagentSpawnCommand)(command);
    expect(decoded.commandId).toBe("cmd_test_123");
    expect(decoded.parentThreadId).toBe("thread_main");
    expect(decoded.mode).toBe("foreground");
    expect(decoded.cancellationScope).toBe("parent_turn");
  });

  it("decodes valid accepted spawn result", () => {
    const acceptedResult = {
      status: "accepted",
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
    };

    const decoded = Schema.decodeSync(PiSubagentSpawnResult)(acceptedResult);
    expect(decoded.status).toBe("accepted");
    expect(decoded.executionId).toBe("exec_123456");
    expect(decoded.attemptId).toBe("att_001");
    expect(decoded.generation).toBe(1);
    expect(decoded.state).toBe("accepted");
  });

  it("decodes valid rejected spawn result with diagnostic code and reason", () => {
    const rejectedResult = {
      status: "rejected",
      executionId: "exec_rejected",
      attemptId: "att_rejected",
      generation: 1,
      state: "rejected",
      diagnosticCode: "pi_subagent_admission_unauthorized",
      rejectionReason: "Caller thread does not belong to active project",
    };

    const decoded = Schema.decodeSync(PiSubagentSpawnResult)(rejectedResult);
    expect(decoded.status).toBe("rejected");
    expect(decoded.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
    expect(decoded.rejectionReason).toContain("does not belong");
  });

  it("decodes rejected spawn result with lifecycle persistence failure and degraded diagnostics", () => {
    const persistenceFailedResult = {
      status: "rejected",
      executionId: "exec_rejected_1",
      attemptId: "att_rejected_1",
      generation: 1,
      state: "rejected",
      diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
      rejectionReason: "Durable write failed",
    };
    const decoded1 = Schema.decodeSync(PiSubagentSpawnResult)(persistenceFailedResult);
    expect(decoded1.diagnosticCode).toBe("pi_subagent_lifecycle_persistence_failed");

    const degradedResult = {
      status: "rejected",
      executionId: "exec_rejected_2",
      attemptId: "att_rejected_2",
      generation: 1,
      state: "rejected",
      diagnosticCode: "pi_subagent_control_degraded",
      rejectionReason: "Control plane is degraded",
    };
    const decoded2 = Schema.decodeSync(PiSubagentSpawnResult)(degradedResult);
    expect(decoded2.diagnosticCode).toBe("pi_subagent_control_degraded");
  });

  it("decodes valid already-applied spawn result with original identities", () => {
    const alreadyAppliedResult = {
      status: "already_applied",
      executionId: "exec_existing_123",
      attemptId: "att_001",
      generation: 1,
      state: "accepted",
      diagnosticCode: "pi_subagent_already_applied",
    };

    const decoded = Schema.decodeSync(PiSubagentSpawnResult)(alreadyAppliedResult);
    expect(decoded.status).toBe("already_applied");
    expect(decoded.executionId).toBe("exec_existing_123");
    expect(decoded.attemptId).toBe("att_001");
  });

  it("decodes valid lifecycle event with correlation, generation, and sequence", () => {
    const event = {
      eventId: "evt_999",
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      sequence: 1,
      state: "accepted",
      occurredAt: "2026-08-16T12:00:00.000Z",
      parentThreadId: "thread_main",
      parentTurnId: "turn_001",
      parentToolCallId: "call_subagent_1",
      projectId: "proj_abc",
      diagnosticCode: "pi_subagent_managed_enabled",
    };

    const decoded = Schema.decodeSync(PiSubagentLifecycleEvent)(event);
    expect(decoded.executionId).toBe("exec_123456");
    expect(decoded.attemptId).toBe("att_001");
    expect(decoded.generation).toBe(1);
    expect(decoded.sequence).toBe(1);
    expect(decoded.state).toBe("accepted");
  });
});

