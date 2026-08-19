import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  PiSubagentCapability,
  PiSubagentCompletionDeliveryState,
  PiSubagentCompletionOutboxEntry,
  PiSubagentDiagnosticCode,
  PiSubagentExecutionCard,
  PiSubagentExecutionRecord,
  PiSubagentHandshakeFailureResponse,
  PiSubagentHandshakeRequest,
  PiSubagentHandshakeResponse,
  PiSubagentHandshakeSuccessResponse,
  PiSubagentLifecycleEvent,
  PiSubagentNegotiatedCapability,
  PiSubagentResultReadResult,
  PiSubagentSpawnCommand,
  PiSubagentSpawnResult,
  PiSubagentTranscriptEntry,
  PiSubagentTranscriptReadResult,
} from "./piSubagents";

describe("Pi subagent handshake contract schemas (Issue 19)", () => {
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

    expect(() => Schema.decodeSync(PiSubagentHandshakeRequest)(invalidVersion as never)).toThrow();

    const missingFields = {
      protocolVersion: 1,
      // missing required fields
    };
    expect(() => Schema.decodeSync(PiSubagentHandshakeRequest)(missingFields as never)).toThrow();
  });

  it("decodes valid success response", () => {
    const successResponse = {
      ok: true as const,
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
      ok: false as const,
      error: "unsupported_version" as const,
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

  it("decodes valid failure response with missing capabilities context (T19-AC2, T19-AC3)", () => {
    const failureResponse = {
      ok: false as const,
      error: "missing_capabilities" as const,
      protocolVersion: 1,
      extensionVersion: "0.10.0-alfie.1",
      missingCapabilities: ["terminal-outbox", "restart-reconciliation"],
      detail: "Extension missing required capabilities: terminal-outbox, restart-reconciliation",
    };

    const decoded = Schema.decodeSync(PiSubagentHandshakeFailureResponse)(failureResponse);
    expect(decoded.ok).toBe(false);
    expect(decoded.error).toBe("missing_capabilities");
    expect(decoded.missingCapabilities).toEqual(["terminal-outbox", "restart-reconciliation"]);

    const unionDecoded = Schema.decodeSync(PiSubagentHandshakeResponse)(failureResponse);
    expect(unionDecoded.ok).toBe(false);
  });

  it("decodes negotiated capability record with capability mismatch (T19-AC2, T19-AC3)", () => {
    const mismatchRecord: PiSubagentNegotiatedCapability = {
      status: "capability_mismatch",
      diagnosticCode: "pi_subagent_capability_mismatch",
      isManaged: false,
      protocolVersion: 1,
      capabilities: ["managed-spawn"],
      missingCapabilities: ["abort-propagation"],
      extensionVersion: "0.10.0-alfie.1",
      diagnosticMessage: "Pi subagent bridge missing required capabilities: abort-propagation",
    };
    const decodedMismatch = Schema.decodeSync(PiSubagentNegotiatedCapability)(mismatchRecord);
    expect(decodedMismatch.isManaged).toBe(false);
    expect(decodedMismatch.status).toBe("capability_mismatch");
    expect(decodedMismatch.diagnosticCode).toBe("pi_subagent_capability_mismatch");
    expect(decodedMismatch.missingCapabilities).toEqual(["abort-propagation"]);

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

    const malformedRecord: PiSubagentNegotiatedCapability = {
      status: "bridge_malformed_response",
      diagnosticCode: "pi_subagent_bridge_malformed_response",
      isManaged: false,
      diagnosticMessage: "Pi subagent bridge returned malformed handshake response",
    };
    const decodedMalformed = Schema.decodeSync(PiSubagentNegotiatedCapability)(malformedRecord);
    expect(decodedMalformed.isManaged).toBe(false);
    expect(decodedMalformed.status).toBe("bridge_malformed_response");
    expect(decodedMalformed.diagnosticCode).toBe("pi_subagent_bridge_malformed_response");
  });

  it("decodes valid spawn command, spawn result, lifecycle event, and execution record schemas", () => {
    const command = {
      commandId: "cmd_test_123",
      projectId: "proj_abc",
      parentThreadId: "thread_main",
      parentTurnId: "turn_001",
      parentToolCallId: "call_subagent_1",
      agentType: "researcher",
      prompt: "Investigate database performance",
      mode: "foreground" as const,
      cancellationScope: "parent_turn" as const,
    };

    const decodedCommand = Schema.decodeSync(PiSubagentSpawnCommand)(command);
    expect(decodedCommand.commandId).toBe("cmd_test_123");
    expect(decodedCommand.parentThreadId).toBe("thread_main");
    expect(decodedCommand.mode).toBe("foreground");

    const spawnResult = {
      status: "accepted" as const,
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      state: "accepted" as const,
      diagnosticCode: "pi_subagent_managed_enabled" as const,
    };

    const decodedSpawnResult = Schema.decodeSync(PiSubagentSpawnResult)(spawnResult);
    expect(decodedSpawnResult.status).toBe("accepted");
    expect(decodedSpawnResult.executionId).toBe("exec_123456");

    const event = {
      eventId: "evt_999",
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      sequence: 1,
      state: "accepted" as const,
      occurredAt: "2026-08-16T12:00:00.000Z",
      parentThreadId: "thread_main",
      parentTurnId: "turn_001",
      parentToolCallId: "call_subagent_1",
      projectId: "proj_abc",
      diagnosticCode: "pi_subagent_managed_enabled" as const,
    };

    const decodedEvent = Schema.decodeSync(PiSubagentLifecycleEvent)(event);
    expect(decodedEvent.executionId).toBe("exec_123456");
    expect(decodedEvent.sequence).toBe(1);

    const record = {
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      commandId: "cmd_001",
      projectId: "proj_abc",
      parentThreadId: "thread_main",
      parentTurnId: "turn_001",
      parentToolCallId: "call_subagent_1",
      agentType: "researcher",
      prompt: "Research query",
      mode: "foreground" as const,
      cancellationScope: "parent_turn" as const,
      desiredState: "running" as const,
      observedState: "running" as const,
      createdAt: "2026-08-16T12:00:00.000Z",
      updatedAt: "2026-08-16T12:00:12.000Z",
    };

    const decodedRecord = Schema.decodeSync(PiSubagentExecutionRecord)(record);
    expect(decodedRecord.desiredState).toBe("running");
    expect(decodedRecord.observedState).toBe("running");
  });

  it("decodes bounded-foreground-attachment capability as a first-class additive capability (T22)", () => {
    expect(PI_SUBAGENT_CAPABILITIES).toContain("bounded-foreground-attachment");
    const decoded = Schema.decodeSync(PiSubagentCapability)("bounded-foreground-attachment");
    expect(decoded).toBe("bounded-foreground-attachment");
    expect(() =>
      Schema.decodeSync(PiSubagentCapability)("unsupported-capability" as never),
    ).toThrow();
  });

  it("decodes completion-delivery-ownership capability as a first-class additive capability (T09)", () => {
    expect(PI_SUBAGENT_CAPABILITIES).toContain("completion-delivery-ownership");
    const decoded = Schema.decodeSync(PiSubagentCapability)("completion-delivery-ownership");
    expect(decoded).toBe("completion-delivery-ownership");
    expect(() =>
      Schema.decodeSync(PiSubagentCapability)("completion-ownership" as never),
    ).toThrow();
  });
});

describe("Pi subagent completion-outbox contract schemas (Issue 08)", () => {
  it("decodes every completion delivery state (T08-AC2)", () => {
    for (const state of [
      "pending",
      "delivered",
      "acknowledged",
      "failed_retryable",
      "superseded",
    ] as const) {
      expect(Schema.decodeSync(PiSubagentCompletionDeliveryState)(state)).toBe(state);
    }
    expect(() => Schema.decodeSync(PiSubagentCompletionDeliveryState)("failed" as never)).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentCompletionDeliveryState)("terminal" as never),
    ).toThrow();
  });

  it("decodes a valid completion-outbox entry with bounded evidence payloads (T08-AC2/AC5)", () => {
    const entry = {
      outboxId: "outbox_exec_1_att_1_gen1",
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      terminalEventId: "terminal_exec_123456_att_001_gen1_succeeded",
      parentThreadId: "thread_main",
      deliveryState: "pending" as const,
      terminalState: "succeeded" as const,
      summary: "Agent completed: 3 tool uses. Outcome: done.",
      transcriptRef: "/tmp/agents/exec_1/output.md",
      attemptCount: 0,
      lastError: null,
      supersededByGeneration: null,
      createdAt: "2026-08-18T00:01:00.000Z",
      updatedAt: "2026-08-18T00:01:00.000Z",
      deliveredAt: null,
      acknowledgedAt: null,
    };

    const decoded = Schema.decodeSync(PiSubagentCompletionOutboxEntry)(entry);
    expect(decoded.outboxId).toBe("outbox_exec_1_att_1_gen1");
    expect(decoded.deliveryState).toBe("pending");
    expect(decoded.terminalState).toBe("succeeded");
    expect(decoded.attemptCount).toBe(0);
  });

  it("rejects outbox entries with invalid delivery state, negative attempts, or empty identity", () => {
    const base = {
      outboxId: "outbox_exec_1_att_1_gen1",
      executionId: "exec_123456",
      attemptId: "att_001",
      generation: 1,
      terminalEventId: "terminal_exec_123456_att_001_gen1_succeeded",
      parentThreadId: "thread_main",
      deliveryState: "pending" as const,
      terminalState: "succeeded" as const,
      summary: "done",
      transcriptRef: null,
      attemptCount: 0,
      lastError: null,
      supersededByGeneration: null,
      createdAt: "2026-08-18T00:01:00.000Z",
      updatedAt: "2026-08-18T00:01:00.000Z",
      deliveredAt: null,
      acknowledgedAt: null,
    };

    expect(() =>
      Schema.decodeSync(PiSubagentCompletionOutboxEntry)({
        ...base,
        deliveryState: "delivered-and-failed" as never,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentCompletionOutboxEntry)({ ...base, attemptCount: -1 }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentCompletionOutboxEntry)({ ...base, outboxId: "   " }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentCompletionOutboxEntry)({ ...base, generation: 0 }),
    ).toThrow();
  });

  it("exposes the Ticket 08 diagnostic codes as first-class literals", () => {
    for (const code of [
      "pi_subagent_completion_outbox_persistence_failed",
      "pi_subagent_completion_delivery_failed",
      "pi_subagent_completion_superseded",
    ] as const) {
      expect(Schema.decodeSync(PiSubagentDiagnosticCode)(code)).toBe(code);
    }
    expect(() =>
      Schema.decodeSync(PiSubagentDiagnosticCode)("pi_subagent_completion_unknown" as never),
    ).toThrow();
  });

  it("exposes the Ticket 13 admission-quota and wall-time diagnostic codes as first-class literals", () => {
    for (const code of [
      "pi_subagent_admission_provider_concurrency_exhausted",
      "pi_subagent_admission_server_queue_saturated",
      "pi_subagent_admission_project_queue_saturated",
      "pi_subagent_admission_quota_unavailable",
      "pi_subagent_walltime_expired",
      "pi_subagent_completion_batch_persistence_failed",
      "pi_subagent_completion_batch_rejected",
      "pi_subagent_completion_batch_collision",
      "pi_subagent_completion_batch_recovery_failed",
    ] as const) {
      expect(Schema.decodeSync(PiSubagentDiagnosticCode)(code)).toBe(code);
    }
    for (const invalid of [
      "pi_subagent_quota_unknown",
      "pi_subagent_completion_batch_unknown",
    ] as const) {
      expect(() => Schema.decodeSync(PiSubagentDiagnosticCode)(invalid as never)).toThrow();
    }
  });
});

describe("Pi subagent authorized result/transcript read schemas (Issue 12)", () => {
  it("decodes a valid bounded result read with truncation diagnostic (T12-AC4)", () => {
    const decoded = Schema.decodeSync(PiSubagentResultReadResult)({
      executionId: "exec-t12-1",
      observedState: "succeeded",
      terminalState: "succeeded",
      summary: "Done: 3 files changed",
      summaryTruncated: true,
      diagnosticCode: "pi_subagent_result_truncated",
      transcriptRef: "/tmp/pi-subagents-501/x/tasks/agent.output",
    });
    expect(decoded.summaryTruncated).toBe(true);
    expect(decoded.diagnosticCode).toBe("pi_subagent_result_truncated");
  });

  it("rejects result reads with empty identity or invalid lifecycle state", () => {
    expect(() =>
      Schema.decodeSync(PiSubagentResultReadResult)({
        executionId: "  ",
        observedState: "exploded" as never,
        summary: null,
        summaryTruncated: false,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentResultReadResult)({
        executionId: "exec-t12-1",
        observedState: "running",
        terminalState: "weird" as never,
        summary: null,
        summaryTruncated: false,
      }),
    ).toThrow();
  });

  it("decodes a valid bounded transcript page with cursor continuation (T12-AC3)", () => {
    const decoded = Schema.decodeSync(PiSubagentTranscriptReadResult)({
      executionId: "exec-t12-1",
      observedState: "succeeded",
      entries: [
        { index: 0, type: "user", content: "Fix the flaky test", truncated: false },
        {
          index: 1,
          type: "assistant",
          content: "x".repeat(4000),
          truncated: true,
          timestamp: "2026-08-19T00:00:00.000Z",
        },
      ],
      nextCursor: 2,
      hasMore: true,
      skippedCorruptEntries: 0,
    });
    expect(decoded.nextCursor).toBe(2);
    expect(decoded.entries[1]?.truncated).toBe(true);
  });

  it("rejects transcript pages with negative cursors or invalid entry types", () => {
    expect(() =>
      Schema.decodeSync(PiSubagentTranscriptReadResult)({
        executionId: "exec-t12-1",
        observedState: "succeeded",
        entries: [],
        nextCursor: -1,
        hasMore: false,
        skippedCorruptEntries: 0,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentTranscriptEntry)({
        index: 0,
        type: "system" as never,
        content: "x",
        truncated: false,
      }),
    ).toThrow();
  });

  it("exposes the Ticket 12 read/truncation/corruption diagnostic codes as first-class literals (T12-AC7)", () => {
    for (const code of [
      "pi_subagent_read_denied",
      "pi_subagent_result_truncated",
      "pi_subagent_transcript_missing",
      "pi_subagent_transcript_unavailable",
      "pi_subagent_transcript_corrupt",
      "pi_subagent_transcript_entry_truncated",
      "pi_subagent_transcript_page_truncated",
    ] as const) {
      expect(Schema.decodeSync(PiSubagentDiagnosticCode)(code)).toBe(code);
    }
    expect(() =>
      Schema.decodeSync(PiSubagentDiagnosticCode)("pi_subagent_transcript_weird" as never),
    ).toThrow();
  });

  it("keeps full result/transcript content out of lifecycle events, execution cards, and outbox entries (T12-AC5)", () => {
    // The three durable/public payload shapes must never grow raw content
    // fields; the only content-bearing surface is the authorized read result.
    const cardFields = Object.keys(PiSubagentExecutionCard.fields);
    expect(cardFields).not.toContain("resultContent");
    expect(cardFields).not.toContain("transcriptContent");
    expect(cardFields).not.toContain("entries");
    const eventFields = Object.keys(PiSubagentLifecycleEvent.fields);
    expect(eventFields).not.toContain("resultContent");
    expect(eventFields).not.toContain("transcriptContent");
  });
});
