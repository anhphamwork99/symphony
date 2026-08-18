import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION,
  PI_SUBAGENT_COMPLETION_DISPATCH_IDENTITY_VERSION,
  buildPiSubagentCompletionDispatchCommand,
  derivePiSubagentCompletionDispatchIdentity,
  deserializePiSubagentCompletionDispatchCommand,
  frozenParentMessageIdOf,
  serializePiSubagentCompletionDispatchCommand,
  verifyPiSubagentCompletionDispatchFingerprint,
} from "./piSubagentCompletionDispatchIdentity.ts";
import { fingerprintOrchestrationCommand } from "../orchestration/commandFingerprint.ts";

/**
 * Decision 0016 §3 — stable identity and frozen payload (Ticket 09
 * remediation, WP2).
 *
 * - versioned domain-separated SHA-256 over parentThreadId + canonical ordered
 *   outbox ids;
 * - separately typed batch / command / message ids;
 * - the EXISTING orchestration fingerprint implementation is reused (never
 *   duplicated) and matches batch creation exactly;
 * - stored payloads replay byte-identically;
 * - payload drift / malformed payload fails closed.
 */

const CANONICAL_OUTBOX = ["outbox_a", "outbox_b", "outbox_c"];

const commandInput = () => ({
  parentThreadId: "th_parent" as const,
  parentMessageText: "[policy v1]\nA background subagent finished:\nexecution id",
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  assistantDeliveryMode: "buffered" as const,
  createdAt: "2026-08-18T13:00:00.000Z",
});

describe("Decision 0016 identity derivation", () => {
  it("is deterministic for identical (thread, canonical membership)", () => {
    const a = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const b = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: [...CANONICAL_OUTBOX],
    });
    expect(a).toEqual(b);
    expect(a.batchId).toMatch(/^pi-cdb_[0-9a-f]{64}$/);
  });

  it("is domain-separated: batch/command/message ids never collide", () => {
    const ids = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    expect(ids.batchId).toMatch(/^pi-cdb_/u);
    expect(ids.parentCommandId).toMatch(/^pi-ccmd_/u);
    expect(ids.parentMessageId).toMatch(/^pi-cmsg_/u);
    expect(ids.batchId).not.toBe(ids.parentCommandId);
    expect(ids.parentCommandId).not.toBe(ids.parentMessageId);
    expect(ids.batchId).not.toBe(ids.parentMessageId);
  });

  it("separates domains: the same payload must not produce the same id in a different domain", () => {
    const ids = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const batchHex = ids.batchId.replace(/^pi-cdb_/, "");
    const commandHex = ids.parentCommandId.replace(/^pi-ccmd_/, "");
    expect(batchHex).not.toBe(commandHex);
  });

  it("changes with the parent thread", () => {
    const a = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const b = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_other",
      outboxIds: CANONICAL_OUTBOX,
    });
    expect(a.batchId).not.toBe(b.batchId);
  });

  it("changes with membership (set, count, and order)", () => {
    const base = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const fewer = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: ["outbox_a", "outbox_b"],
    });
    const reordered = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: ["outbox_c", "outbox_b", "outbox_a"],
    });
    expect(base.batchId).not.toBe(fewer.batchId);
    // CANONICAL ORDER is part of the identity: the same set in a different
    // order yields a different id (fail-closed noncanonical membership).
    expect(base.batchId).not.toBe(reordered.batchId);
  });

  it("is versioned (protocol version participates in the hash)", () => {
    const ids = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    expect(PI_SUBAGENT_COMPLETION_DISPATCH_IDENTITY_VERSION).toBe("v1");
    // The prefix/length guard: derived ids always carry the 64-hex SHA-256.
    expect(ids.batchId.slice("pi-cdb_".length)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Decision 0016 frozen command authoring and fingerprint", () => {
  it("authors a deterministic thread.turn.start carrying derived ids and frozen fields", () => {
    const identity = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const command = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: commandInput(),
    });

    expect(command.type).toBe("thread.turn.start");
    expect(command.commandId).toBe(identity.parentCommandId);
    expect(command.message.messageId).toBe(identity.parentMessageId);
    expect(command.threadId).toBe("th_parent");
    expect(command.message.text).toContain("[policy");
    expect(command.message.text).toContain("A background subagent finished:");
    expect(command.dispatchMode).toBe("queue");
    expect(command.dispatchOrigin).toBe("agent");
    expect(command.runtimeMode).toBe("full-access");
    expect(command.interactionMode).toBe("default");
    expect(command.assistantDeliveryMode).toBe("buffered");
    expect(command.createdAt).toBe("2026-08-18T13:00:00.000Z");
    expect(frozenParentMessageIdOf(command)).toBe(identity.parentMessageId);
  });

  it("replays the stored payload byte-identically", () => {
    const identity = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const command = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: commandInput(),
    });
    const serialized = serializePiSubagentCompletionDispatchCommand(command);
    const replayed = deserializePiSubagentCompletionDispatchCommand(serialized);
    expect(replayed).not.toBeNull();
    expect(serializePiSubagentCompletionDispatchCommand(replayed!)).toBe(serialized);
    expect(JSON.parse(serialized)).toEqual(JSON.parse(serializePiSubagentCompletionDispatchCommand(replayed!)));
  });

  it("uses the existing orchestration fingerprint and recomputes it exactly", () => {
    const identity = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const command = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: commandInput(),
    });
    const fingerprint = fingerprintOrchestrationCommand(command);
    const serialized = serializePiSubagentCompletionDispatchCommand(command);
    expect(
      verifyPiSubagentCompletionDispatchFingerprint({
        commandPayloadJson: serialized,
        expectedCommandFingerprint: fingerprint.value,
        expectedFingerprintVersion: fingerprint.version,
      }),
    ).toBe(true);
    expect(fingerprint.version).toBe(PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION);
  });

  it("fails closed on payload drift under the same identity", () => {
    const identity = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const command = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: commandInput(),
    });
    const correct = fingerprintOrchestrationCommand(command);

    const drifted = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: { ...commandInput(), parentMessageText: "[policy v1]\ndifferent message" },
    });
    const driftedPayload = serializePiSubagentCompletionDispatchCommand(drifted);
    expect(
      verifyPiSubagentCompletionDispatchFingerprint({
        commandPayloadJson: driftedPayload,
        expectedCommandFingerprint: correct.value,
        expectedFingerprintVersion: correct.version,
      }),
    ).toBe(false);
  });

  it("fails closed on malformed stored payload", () => {
    expect(
      verifyPiSubagentCompletionDispatchFingerprint({
        commandPayloadJson: "{{{not json",
        expectedCommandFingerprint: "x",
        expectedFingerprintVersion: PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION,
      }),
    ).toBe(false);
    expect(
      verifyPiSubagentCompletionDispatchFingerprint({
        commandPayloadJson: JSON.stringify({ type: "thread.interrupt", commandId: "x" }),
        expectedCommandFingerprint: "x",
        expectedFingerprintVersion: PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION,
      }),
    ).toBe(false);
    expect(
      verifyPiSubagentCompletionDispatchFingerprint({
        commandPayloadJson: serializePiSubagentCompletionDispatchCommand(
          buildPiSubagentCompletionDispatchCommand({
            identity: derivePiSubagentCompletionDispatchIdentity({
              parentThreadId: "th_parent",
              outboxIds: CANONICAL_OUTBOX,
            }),
            commandInput: commandInput(),
          }),
        ),
        expectedCommandFingerprint: "any",
        expectedFingerprintVersion: PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION,
      }),
    ).toBe(false);
  });

  it("fails closed on fingerprint-version mismatch", () => {
    const identity = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: CANONICAL_OUTBOX,
    });
    const command = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: commandInput(),
    });
    expect(
      verifyPiSubagentCompletionDispatchFingerprint({
        commandPayloadJson: serializePiSubagentCompletionDispatchCommand(command),
        expectedCommandFingerprint: fingerprintOrchestrationCommand(command).value,
        expectedFingerprintVersion: 999,
      }),
    ).toBe(false);
  });
});
