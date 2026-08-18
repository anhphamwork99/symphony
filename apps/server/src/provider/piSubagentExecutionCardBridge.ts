import type { OrchestrationCommand, OrchestrationEvent } from "@synara/contracts";
import { CommandId, ThreadId } from "@synara/contracts";
import { Effect, Option, Stream } from "effect";

import type { PiSubagentExecutionLifecycleNotification } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";

/**
 * Ticket 11 execution-card projection bridge (T11-AC1/AC2/AC5).
 *
 * Converts repository post-commit lifecycle notifications into deterministic
 * internal `thread.pi-subagent-execution.upsert` commands through a narrow,
 * late-bound structural engine port (same construction-cycle avoidance as the
 * Decision 0016 completion dispatcher: the bridge is constructed before the
 * provider layer and bound exactly once when the engine is live). The durable
 * execution aggregate is RE-READ after the notification so the card carries
 * committed truth (lease, coalesced progress, terminal evidence, delivery
 * state), never the notification's partial snapshot.
 *
 * Publication is at-least-once with deterministic command identity
 * (`pisubcard_<executionId>_<attemptId>_gen<gen>_seq<journalSequence>`): a
 * replayed publication maps to the same command and the engine's
 * same-command-id replay produces no duplicate projection effect (T11-AC2).
 * Progress/heartbeat/walltime observations never reach this bridge — the
 * repository seam fires only on lifecycle-truth changes (T11-AC2: no
 * intermediate progress replay).
 */
export interface PiSubagentExecutionCardEnginePort {
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

export interface PiSubagentExecutionCardBridge {
  /** Binds the live engine exactly once (main.ts startup, post-engine). */
  readonly bindOnce: (engine: PiSubagentExecutionCardEnginePort) => void;
  /** True once the engine is bound. */
  readonly isBound: () => boolean;
  /**
   * Handles one post-commit lifecycle notification: re-reads the bounded card
   * from the repository and dispatches the deterministic upsert command.
   * Never throws; failures leave the snapshot authoritative.
   */
  readonly handleNotification: (
    repository: PiSubagentExecutionRepositoryShape,
    notification: PiSubagentExecutionLifecycleNotification,
  ) => void;
}

export const makePiSubagentExecutionCardBridge = (): PiSubagentExecutionCardBridge => {
  let engine: PiSubagentExecutionCardEnginePort | undefined;

  const handleNotification: PiSubagentExecutionCardBridge["handleNotification"] = (
    repository,
    notification,
  ) => {
    const live = engine;
    if (live === undefined) {
      // Pre-bind notifications are satisfied by the client's snapshot
      // hydration (T11-AC5); no durable truth is lost by skipping.
      return;
    }
    const commandId = CommandId.makeUnsafe(
      `pisubcard_${notification.executionId}_${notification.attemptId}_gen${notification.generation}_seq${notification.journalSequence}`,
    );
    void Effect.runPromise(
      Effect.gen(function* () {
        // Review R1 fix: read THIS execution's committed card by identity —
        // never the thread's newest row. Any sibling execution's lifecycle
        // truth publishes its own card event. `none` means the execution row
        // itself is gone (deleted) — nothing to project.
        const cardOption = yield* repository.getExecutionCard(notification.executionId);
        if (Option.isNone(cardOption)) {
          return;
        }
        const command: OrchestrationCommand = {
          type: "thread.pi-subagent-execution.upsert",
          commandId,
          threadId: ThreadId.makeUnsafe(notification.parentThreadId),
          executionId: notification.executionId,
          journalSequence: notification.journalSequence,
          card: cardOption.value,
          createdAt: new Date().toISOString(),
        };
        const result = yield* Effect.result(live.dispatch(command));
        if (result._tag === "Failure") {
          // Deterministic identity: a retryable publication replays the same
          // command id; a durable rejection means the engine refused this
          // card (e.g. invariant) — the snapshot stays authoritative.
          return;
        }
      }),
    ).catch(() => {
      // Swallowed: observation must never crash the notification path.
    });
  };

  const bindOnce: PiSubagentExecutionCardBridge["bindOnce"] = (candidate) => {
    if (engine !== undefined) {
      if (engine === candidate) {
        return;
      }
      throw new Error("execution-card bridge has already been bound; rebinding is forbidden");
    }
    engine = candidate;
  };

  return {
    bindOnce,
    isBound: () => engine !== undefined,
    handleNotification,
  };
};
