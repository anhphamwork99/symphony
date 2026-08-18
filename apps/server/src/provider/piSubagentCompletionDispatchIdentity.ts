import * as Crypto from "node:crypto";

import type {
  AssistantDeliveryMode,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@synara/contracts";
import { ThreadTurnStartCommand } from "@synara/contracts";

import {
  ORCHESTRATION_COMMAND_FINGERPRINT_VERSION,
  fingerprintOrchestrationCommand,
} from "../orchestration/commandFingerprint.ts";

/**
 * Decision 0016 §3 — stable identity and frozen payload (Ticket 09
 * remediation).
 *
 * Every completion-dispatch batch is identified by a versioned,
 * domain-separated deterministic SHA-256 over the protocol version, the
 * parent thread id, and the canonical ordered stable outbox ids. The derived
 * batch / orchestration-command / parent-message ids carry distinct literal
 * prefixes so one payload can never be misinterpreted across domains, and
 * identity rotation is forbidden (a retry reuses the exact derived ids).
 *
 * The frozen `thread.turn.start` command is authored once at batch creation
 * with a deterministic command/message id and the complete frozen payload
 * (timestamp, dispatch mode, origin, runtime/interaction modes,
 * assistant-delivery mode, parent thread, and the bounded parent message
 * including the current harness-policy header). Retry submits the STORED
 * content byte-for-byte; it never rebuilds from current time, session
 * configuration, summaries, or harness policy.
 *
 * The canonical orchestration command fingerprint uses the EXISTING
 * `fingerprintOrchestrationCommand` implementation — never duplicated here.
 */

/** Protocol version for the deterministic identity scheme. Bump only with a
 * deliberate, reviewed identity rotation (forbidden by Decision 0016). */
export const PI_SUBAGENT_COMPLETION_DISPATCH_IDENTITY_VERSION = "v1";

/** Re-exported: the batch's canonical command fingerprint protocol version. */
export const PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION =
  ORCHESTRATION_COMMAND_FINGERPRINT_VERSION;

// Separately typed ids (Decision 0016 §3 "separately typed batch, command and
// message IDs"). Nominal branded strings; the repository persists the raw
// string form.
declare const PiSubagentCompletionBatchIdBrand: unique symbol;
declare const PiSubagentCompletionCommandIdBrand: unique symbol;
declare const PiSubagentCompletionMessageIdBrand: unique symbol;

export type PiSubagentCompletionBatchId = string & {
  readonly [PiSubagentCompletionBatchIdBrand]: typeof PiSubagentCompletionBatchIdBrand;
};
export type PiSubagentCompletionCommandId = string & {
  readonly [PiSubagentCompletionCommandIdBrand]: typeof PiSubagentCompletionCommandIdBrand;
};
export type PiSubagentCompletionMessageId = string & {
  readonly [PiSubagentCompletionMessageIdBrand]: typeof PiSubagentCompletionMessageIdBrand;
};

/** Deterministic identity for one immutable batch. */
export interface PiSubagentCompletionDispatchIdentity {
  readonly batchId: PiSubagentCompletionBatchId;
  readonly parentCommandId: PiSubagentCompletionCommandId;
  readonly parentMessageId: PiSubagentCompletionMessageId;
}

const domainHash = (domain: string, parentThreadId: string, outboxIds: readonly string[]) =>
  Crypto.createHash("sha256")
    .update(
      [
        "pi-subagent-completion-dispatch",
        PI_SUBAGENT_COMPLETION_DISPATCH_IDENTITY_VERSION,
        domain,
        parentThreadId,
        ...outboxIds,
      ].join("\n"),
    )
    .digest("hex");

/**
 * Derive the batch identity from the parent thread and the CANONICAL ordered
 * outbox ids (oldest-first, matching the repository's scan order). The same
 * membership set in a different order produces a different identity — the
 * canonical order is part of the fingerprint input.
 */
export function derivePiSubagentCompletionDispatchIdentity(input: {
  readonly parentThreadId: ThreadId | string;
  readonly outboxIds: readonly string[];
}): PiSubagentCompletionDispatchIdentity {
  const parentThreadId = String(input.parentThreadId);
  const outboxIds = input.outboxIds;
  const batch = domainHash("batch", parentThreadId, outboxIds);
  const command = domainHash("command", parentThreadId, outboxIds);
  const message = domainHash("message", parentThreadId, outboxIds);
  return {
    batchId: `pi-cdb_${batch}` as PiSubagentCompletionBatchId,
    parentCommandId: `pi-ccmd_${command}` as PiSubagentCompletionCommandId,
    parentMessageId: `pi-cmsg_${message}` as PiSubagentCompletionMessageId,
  };
}

/** The bounded fields a frozen `thread.turn.start` command carries. */
export interface PiSubagentCompletionDispatchCommandInput {
  readonly parentThreadId: ThreadId | string;
  readonly parentMessageText: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
  readonly createdAt: string;
}

/**
 * Author the immutable deterministic `thread.turn.start` command for a batch.
 * The command id and message id are derived (via `identity`) from the parent
 * thread + canonical ordered outbox ids. `dispatchMode` is always `queue`
 * (busy roots create a durable queued turn) and `dispatchOrigin` is always
 * `agent` (server-internal dispatch; Decision 0016 accepted choices). The
 * message text is the frozen bounded parent message INCLUDING the current
 * harness-policy header captured at batch creation.
 */
/** The narrow frozen internal command type (a `thread.turn.start`). */
export type PiSubagentCompletionDispatchCommand = typeof ThreadTurnStartCommand.Type;

export function buildPiSubagentCompletionDispatchCommand(input: {
  readonly identity: PiSubagentCompletionDispatchIdentity;
  readonly commandInput: PiSubagentCompletionDispatchCommandInput;
}): PiSubagentCompletionDispatchCommand {
  const { identity, commandInput } = input;
  return {
    type: "thread.turn.start",
    commandId: identity.parentCommandId,
    threadId: commandInput.parentThreadId as ThreadId,
    message: {
      messageId: identity.parentMessageId,
      role: "user",
      text: commandInput.parentMessageText,
      attachments: [],
    },
    dispatchMode: "queue",
    dispatchOrigin: "agent",
    runtimeMode: commandInput.runtimeMode,
    interactionMode: commandInput.interactionMode,
    assistantDeliveryMode: commandInput.assistantDeliveryMode,
    createdAt: commandInput.createdAt,
  } as unknown as PiSubagentCompletionDispatchCommand;
}

/**
 * Canonical frozen payload serialization: store the command as JSON so a retry
 * replays the identical bytes. `JSON.stringify` is deterministic for the
 * authored key order.
 */
export const serializePiSubagentCompletionDispatchCommand = (
  command: PiSubagentCompletionDispatchCommand,
): string => JSON.stringify(command);

/**
 * Rebuild the dispatch command from its stored frozen payload. Returns null
 * when the payload cannot be decoded back to a `thread.turn.start` command;
 * the coordinator treats that as a fail-closed drift/collision (identity
 * rotation is forbidden and a malformed stored payload never dispatches).
 */
export function deserializePiSubagentCompletionDispatchCommand(
  commandPayloadJson: string,
): PiSubagentCompletionDispatchCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(commandPayloadJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.type !== "thread.turn.start" || typeof record.commandId !== "string") {
    return null;
  }
  return parsed as unknown as PiSubagentCompletionDispatchCommand;
}

/** The message id carried by the frozen command (Decision 0016 §6 correlation). */
export function frozenParentMessageIdOf(
  command: PiSubagentCompletionDispatchCommand,
): string | null {
  if (command.type !== "thread.turn.start") {
    return null;
  }
  return command.message.messageId;
}

/**
 * Recompute and compare the canonical fingerprint of the STORED frozen command
 * against the fingerprint frozen at batch creation. Payload drift or
 * malformed membership fails closed (Decision 0016 §3, §10 "altered payload
 * under same ID → fail-closed collision, no rotated identity"). Returns true
 * only when the stored payload is decodable AND its fingerprint exactly
 * matches the batch-creation fingerprint.
 */
export function verifyPiSubagentCompletionDispatchFingerprint(input: {
  readonly commandPayloadJson: string;
  readonly expectedCommandFingerprint: string;
  readonly expectedFingerprintVersion: number;
}): boolean {
  if (input.expectedFingerprintVersion !== PI_SUBAGENT_COMPLETION_DISPATCH_FINGERPRINT_VERSION) {
    return false;
  }
  const command = deserializePiSubagentCompletionDispatchCommand(input.commandPayloadJson);
  if (command === null) {
    return false;
  }
  try {
    return (
      fingerprintOrchestrationCommand(command as never).value === input.expectedCommandFingerprint
    );
  } catch {
    // A stored payload that cannot even be fingerprinted must fail closed.
    return false;
  }
}
