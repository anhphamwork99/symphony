import type { OrchestrationEvent } from "@synara/contracts";
import { Effect, Stream } from "effect";

import type { OrchestrationCommand } from "@synara/contracts";
import {
  OrchestrationCommandAdmissionError,
  OrchestrationCommandIdentityCollisionError,
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationCommandTimeoutError,
} from "../orchestration/Errors.ts";
import { deserializePiSubagentCompletionDispatchCommand } from "./piSubagentCompletionDispatchIdentity.ts";

/**
 * Decision 0016 §4/§9 — narrow parent-effect dispatcher port (Ticket 09
 * remediation, WP4).
 *
 * A single-assignment, late-bound bridge from the coordinator to the live
 * `OrchestrationEngine`. The port is constructed BEFORE the provider layer
 * (composition-owned) and bound exactly once when the engine is live, which
 * avoids the OrchestrationEngine → ProviderCommandReactor → ProviderService /
 * PiAdapter construction cycle.
 *
 * The implementation delegates to `OrchestrationEngine.dispatch` and verifies
 * the committed parent message through the engine's public thread-event read
 * API. It NEVER inserts or interprets receipt rows itself and never duplicates
 * fingerprint / replay logic (the engine owns receipt persistence and
 * same-command-id replay).
 *
 * Outcome semantics (stable-identity coordinator):
 * - accepted — dispatch returned an accepted result sequence AND the
 *   committed `thread.message-sent` event carrying our exact command/message
 *   id is present in the engine's durable event set (Decision 0016 §6
 *   "parent message ID in the accepted command's committed event set");
 * - rejected — engine persisted an immutable fingerprint-matched rejection
 *   (previously-rejected / invariant), which can never become accepted;
 * - collision — identity collision (same command id bound to different
 *   command content) — permanent fail-closed, not a transport failure;
 * - transient — no receipt could be confirmed (timeout without a stored
 *   receipt, admission/queue pressure, SQL/unknown failure). A byte-identical
 *   retry under the SAME stable identity resolves both never-accepted and
 *   accepted-despite-caller-timeout (receipt replay);
 * - unavailable — pre-bind or the engine is stopped; consumes no retry;
 * - unverified — dispatch reported success but the committed message could
 *   not be confirmed; treated conservatively (retryable, byte-identical).
 */

/** Exported dispatch outcome set (Decision 0016 §9). */
export type PiSubagentParentEffectDispatchOutcome =
  | {
      readonly kind: "accepted";
      readonly receipt: {
        readonly commandId: string;
        readonly resultSequence: number;
        readonly messageId: string;
        readonly acceptedAt: string;
      };
    }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "collision"; readonly error: string }
  | { readonly kind: "transient"; readonly error: string }
  | { readonly kind: "unavailable"; readonly error: string }
  | { readonly kind: "unverified"; readonly error: string };

/** The narrow engine surface the bridge depends on (structural subset of
 * OrchestrationEngineShape; the real service satisfies it). */
export interface PiSubagentParentEffectEnginePort {
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ readonly sequence: number }, unknown, never>;
  readonly readThreadEventsThrough: (
    threadId: string,
    fromSequenceExclusive: number,
    throughSequenceInclusive: number,
    eventTypes?: ReadonlyArray<string>,
  ) => Stream.Stream<OrchestrationEvent, unknown, never>;
}

export interface PiSubagentParentEffectDispatcher {
  /** Dispatch ONE frozen deterministic internal command, never throws. */
  readonly dispatch: (commandPayloadJson: string) => Promise<PiSubagentParentEffectDispatchOutcome>;
  /** Bind exactly once when the engine is live; rebinding is forbidden. */
  readonly bindOnce: (engine: PiSubagentParentEffectEnginePort) => void;
  readonly isBound: () => boolean;
  /** Subscribe to binding (used to trigger Ticket 09 recovery on bind). */
  readonly onBound: (callback: () => void) => () => void;
}

const PARENT_EFFECT_DISPATCH_BOUNDARY_MS = 50_000;

/** Run a promise with a hard wall boundary; the inner promise's rejection is
 * captured so dispatch never throws to the coordinator. */
type WithBoundary<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "error"; readonly error: Error }
  | { readonly _tag: "timeout" };

const runWithBoundary = async <T>(
  make: () => Promise<T>,
  label: string,
): Promise<WithBoundary<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const boundaryMessage = `${label} exceeded ${PARENT_EFFECT_DISPATCH_BOUNDARY_MS}ms`;
  const boundary = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(boundaryMessage)),
      PARENT_EFFECT_DISPATCH_BOUNDARY_MS,
    );
  });
  try {
    const outcome = await Promise.race([make(), boundary]);
    return { _tag: "ok", value: outcome };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(`${label}: ${String(cause)}`);
    if (error.message === boundaryMessage) {
      return { _tag: "timeout" };
    }
    return { _tag: "error", error };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const makePiSubagentParentEffectDispatcher = (): PiSubagentParentEffectDispatcher => {
  let engine: PiSubagentParentEffectEnginePort | undefined;
  const boundCallbacks = new Set<() => void>();

  const dispatch: PiSubagentParentEffectDispatcher["dispatch"] = async (commandPayloadJson) => {
    const live = engine;
    if (live === undefined) {
      return {
        kind: "unavailable",
        error: "completion dispatcher is not bound to the orchestration engine",
      };
    }
    const command = deserializePiSubagentCompletionDispatchCommand(commandPayloadJson);
    if (command === null || command.type !== "thread.turn.start") {
      return {
        kind: "transient",
        error: "stored completion dispatch command payload is malformed",
      };
    }

    // Engine dispatch: the engine owns receipt persistence, fingerprint
    // deduplication, and same-command-id replay. A failure here yields the
    // engine's typed dispatch error (resolved stored receipt where one
    // exists).
    const dispatched = await runWithBoundary(
      () => Effect.runPromise(Effect.result(live.dispatch(command))),
      "completion dispatch",
    );
    if (dispatched._tag === "timeout") {
      return {
        kind: "unverified",
        error: "completion dispatch exceeded the wall boundary without a confirmed outcome",
      };
    }
    if (dispatched._tag === "error") {
      return mapEngineError(dispatched.error);
    }
    if (dispatched.value._tag === "Failure") {
      return mapEngineError(dispatched.value.failure);
    }
    const resultSequence = dispatched.value.success.sequence;

    // Exact parent-message proof: the accepted command's committed event set
    // must contain thread.message-sent for OUR exact command/message id.
    const verified = await runWithBoundary(
      () =>
        Effect.runPromise(
          live
            .readThreadEventsThrough(String(command.threadId), 0, resultSequence, [
              "thread.message-sent",
            ])
            .pipe(
              Stream.filter(
                (event): event is Extract<OrchestrationEvent, { type: "thread.message-sent" }> =>
                  event.type === "thread.message-sent" &&
                  event.commandId === command.commandId &&
                  event.payload.messageId === command.message.messageId,
              ),
              Stream.take(1),
              Stream.runCollect,
            ),
        ),
      "completion dispatch message verification",
    );
    if (verified._tag !== "ok") {
      return {
        kind: "unverified",
        error:
          verified._tag === "timeout"
            ? "accepted dispatch message verification exceeded the wall boundary"
            : `accepted dispatch message verification failed: ${verified.error.message}`,
      };
    }
    const messageEvent = verified.value[0];
    if (messageEvent === undefined) {
      return {
        kind: "unverified",
        error: "accepted dispatch did not commit the frozen parent message",
      };
    }
    return {
      kind: "accepted",
      receipt: {
        commandId: command.commandId,
        resultSequence,
        messageId: command.message.messageId,
        acceptedAt: messageEvent.occurredAt,
      },
    };
  };

  const bindOnce: PiSubagentParentEffectDispatcher["bindOnce"] = (candidate) => {
    if (engine !== undefined) {
      if (engine === candidate) {
        return;
      }
      throw new Error("completion dispatcher has already been bound; rebinding is forbidden");
    }
    engine = candidate;
    for (const callback of Array.from(boundCallbacks)) {
      try {
        callback();
      } catch (cause) {
        // A binding-triggered recovery callback must never break binding;
        // the callback is advisory and its failure is contained.
        console.error("completion dispatcher onBound callback failed", cause);
      }
    }
  };

  return {
    dispatch,
    bindOnce,
    isBound: () => engine !== undefined,
    onBound: (callback) => {
      if (engine !== undefined) {
        // Already bound: fire immediately (composition may construct the
        // provider layer after the engine is bound).
        try {
          callback();
        } catch (cause) {
          // Advisory; contained.
          console.error("completion dispatcher onBound callback failed", cause);
        }
      }
      boundCallbacks.add(callback);
      return () => boundCallbacks.delete(callback);
    },
  };
};

const mapEngineError = (error: unknown): PiSubagentParentEffectDispatchOutcome => {
  if (error instanceof OrchestrationCommandIdentityCollisionError) {
    return {
      kind: "collision",
      error: `completion dispatch identity collision: ${error.message}`,
    };
  }
  if (
    error instanceof OrchestrationCommandPreviouslyRejectedError ||
    error instanceof OrchestrationCommandInvariantError
  ) {
    return { kind: "rejected", error: `completion dispatch rejected: ${error.message}` };
  }
  if (error instanceof OrchestrationCommandTimeoutError) {
    return {
      kind: "transient",
      error: `completion dispatch timed out without a stored receipt: ${error.message}`,
    };
  }
  if (
    error instanceof OrchestrationCommandAdmissionError &&
    (error as { reason?: string }).reason === "stopped"
  ) {
    return { kind: "unavailable", error: `completion dispatcher stopped: ${error.message}` };
  }
  return {
    kind: "transient",
    error: `completion dispatch transient failure: ${error instanceof Error ? error.message : String(error)}`,
  };
};
