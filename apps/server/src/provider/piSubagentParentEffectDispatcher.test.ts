import type { OrchestrationCommand, OrchestrationEvent } from "@synara/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  OrchestrationCommandAdmissionError,
  OrchestrationCommandIdentityCollisionError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationCommandTimeoutError,
} from "../orchestration/Errors.ts";
import {
  buildPiSubagentCompletionDispatchCommand,
  derivePiSubagentCompletionDispatchIdentity,
  serializePiSubagentCompletionDispatchCommand,
  type PiSubagentCompletionDispatchCommand,
} from "./piSubagentCompletionDispatchIdentity.ts";
import {
  makePiSubagentParentEffectDispatcher,
  type PiSubagentParentEffectEnginePort,
} from "./piSubagentParentEffectDispatcher.ts";

/**
 * Decision 0016 §4/§9 — parent-effect dispatcher bridge (WP4).
 *
 * - narrow single-assignment late-bound port: pre-bind unavailable, bind once,
 *   rebinding forbidden;
 * - delegates to OrchestrationEngine.dispatch (never inserts or interprets
 *   receipts itself, never duplicates fingerprint/replay logic);
 * - exact accepted receipt/message verification through the engine's durable
 *   thread-event read API;
 * - outcomes: accepted / rejected / collision / transient / unavailable /
 *   unverified.
 */

const MEMBERSHIP = ["outbox_a", "outbox_b"];

const makeCommand = (overrides?: { messageText?: string }): PiSubagentCompletionDispatchCommand =>
  buildPiSubagentCompletionDispatchCommand({
    identity: derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: "th_parent",
      outboxIds: MEMBERSHIP,
    }),
    commandInput: {
      parentThreadId: "th_parent",
      parentMessageText: overrides?.messageText ?? "[policy]\nA background subagent finished: ex1",
      runtimeMode: "full-access",
      interactionMode: "default",
      assistantDeliveryMode: "buffered",
      createdAt: "2026-08-18T13:00:00.000Z",
    },
  });

const commandPayload = (overrides?: { messageText?: string }): string =>
  serializePiSubagentCompletionDispatchCommand(makeCommand(overrides));

type DispatchResult = {
  readonly selected: "accept" | "reject" | "collision" | "timeout" | "unavailable" | "unknown";
  readonly sequence: number;
};

const makeFakeEngine = (
  dispatchResult: DispatchResult,
): {
  readonly engine: PiSubagentParentEffectEnginePort;
  readonly dispatched: OrchestrationCommand[];
  readonly visibleEvents: OrchestrationEvent[];
} => {
  const dispatched: OrchestrationCommand[] = [];
  const visibleEvents: OrchestrationEvent[] = [];
  const engine: PiSubagentParentEffectEnginePort = {
    dispatch: (command) => {
      dispatched.push(command as OrchestrationCommand);
      switch (dispatchResult.selected) {
        case "accept":
          return Effect.succeed({ sequence: dispatchResult.sequence });
        case "reject":
          return Effect.fail(
            new OrchestrationCommandPreviouslyRejectedError({
              commandId: (command as OrchestrationCommand).commandId,
              detail: "previously rejected",
            }),
          );
        case "collision":
          return Effect.fail(
            new OrchestrationCommandIdentityCollisionError({
              commandId: (command as OrchestrationCommand).commandId,
              detail: "bound to different content",
            }),
          );
        case "timeout":
          return Effect.fail(
            new OrchestrationCommandTimeoutError({
              commandId: (command as OrchestrationCommand).commandId,
              commandType: (command as OrchestrationCommand).type,
              timeoutMs: 45_000,
            }),
          );
        case "unavailable":
          return Effect.fail(
            new OrchestrationCommandAdmissionError({
              commandId: (command as OrchestrationCommand).commandId,
              commandType: (command as OrchestrationCommand).type,
              capacity: 64,
              reservedCapacity: 8,
              reason: "stopped",
            }),
          );
        default:
          return Effect.fail(new Error("unexpected transient engine failure")) as never;
      }
    },
    readThreadEventsThrough: (threadId, _from, _through, eventTypes) => {
      const filtered = visibleEvents.filter((event) =>
        eventTypes === undefined || eventTypes.length === 0
          ? true
          : eventTypes.includes(event.type),
      );
      return Stream.fromIterable(filtered);
    },
  };
  return { engine, dispatched, visibleEvents };
};

const messageSentEventFor = (command: PiSubagentCompletionDispatchCommand): OrchestrationEvent =>
  ({
    type: "thread.message-sent",
    commandId: command.commandId,
    payload: { messageId: command.message.messageId, threadId: command.threadId },
    occurredAt: "2026-08-18T13:00:05.000Z",
    sequence: 100,
  }) as unknown as OrchestrationEvent;

describe("Decision 0016 parent-effect dispatcher (bridge)", () => {
  it("returns unavailable before binding (no retry); binds once; rebinding is forbidden", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    expect(dispatcher.isBound()).toBe(false);

    const preBind = await dispatcher.dispatch(commandPayload());
    expect(preBind.kind).toBe("unavailable");

    const { engine } = makeFakeEngine({ selected: "accept", sequence: 100 });
    dispatcher.bindOnce(engine);
    expect(dispatcher.isBound()).toBe(true);
    // Same-object rebind is a no-op.
    dispatcher.bindOnce(engine);
    // A different engine rebind must fail closed.
    const { engine: other } = makeFakeEngine({ selected: "accept", sequence: 100 });
    expect(() => dispatcher.bindOnce(other)).toThrow(/already been bound/);
  });

  it("accepts with an exact receipt when the frozen parent message is committed", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const command = makeCommand();
    const { engine, visibleEvents, dispatched } = makeFakeEngine({
      selected: "accept",
      sequence: 100,
    });
    visibleEvents.push(messageSentEventFor(command));
    dispatcher.bindOnce(engine);

    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.receipt.commandId).toBe(command.commandId);
      expect(outcome.receipt.resultSequence).toBe(100);
      expect(outcome.receipt.messageId).toBe(command.message.messageId);
    }
    // Delegates to the engine once for a single dispatch.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.commandId).toBe(command.commandId);
  });

  it("returns unverified when the committed message cannot be confirmed", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine } = makeFakeEngine({ selected: "accept", sequence: 100 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("unverified");
  });

  it("maps persisted rejection to rejected", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine } = makeFakeEngine({ selected: "reject", sequence: 0 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.error).toContain("previously rejected");
    }
  });

  it("maps identity collision to collision (permanent fail-closed)", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine } = makeFakeEngine({ selected: "collision", sequence: 0 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("collision");
  });

  it("maps timeout-without-receipt to transient (byte-identical retry)", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine } = makeFakeEngine({ selected: "timeout", sequence: 0 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("transient");
    if (outcome.kind === "transient") {
      expect(outcome.error).toContain("timed out");
    }
  });

  it("maps engine-stopped admission to unavailable (no retry accounting)", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine } = makeFakeEngine({ selected: "unavailable", sequence: 0 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("unavailable");
  });

  it("maps transitive engine failures to transient", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine } = makeFakeEngine({ selected: "unknown", sequence: 0 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch(commandPayload());
    expect(outcome.kind).toBe("transient");
  });

  it("treats a malformed stored payload as transient without touching the engine", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    const { engine, dispatched } = makeFakeEngine({ selected: "accept", sequence: 100 });
    dispatcher.bindOnce(engine);
    const outcome = await dispatcher.dispatch("not-json{{");
    expect(outcome.kind).toBe("transient");
    expect(dispatched).toHaveLength(0);
  });

  it("fires onBound callbacks exactly once on bind", async () => {
    const dispatcher = makePiSubagentParentEffectDispatcher();
    let fires = 0;
    const unsubscribe = dispatcher.onBound(() => {
      fires += 1;
    });
    const { engine } = makeFakeEngine({ selected: "accept", sequence: 100 });
    dispatcher.bindOnce(engine);
    // Unsubscribed callbacks no longer fire (and rebinding is forbidden).
    unsubscribe();
    expect(fires).toBe(1);
  });
});
