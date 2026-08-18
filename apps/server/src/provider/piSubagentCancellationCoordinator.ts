import { type PiSubagentCancelCommand, type PiSubagentCancelResult } from "@synara/contracts";
import { Effect, Option } from "effect";

import {
  DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS,
  DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT,
} from "../config.ts";
import type {
  PiSubagentCancelExecutionOutcome,
  PiSubagentExecutionObservation,
  PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { PiSubagentActiveChild, PiSubagentExtensionBridge } from "./piSubagentBridge.ts";

/**
 * Ticket 06 — Durable parent-turn cancellation coordinator.
 *
 * Stop on a parent Pi turn must (in order):
 * 1. Record durable cancellation intent BEFORE dispatch (T06-AC1): every
 *    managed child declaring the parent-turn scope gets a journaled
 *    `cancelling` event and `desired_state = 'cancelling'` first.
 * 2. Dispatch a fenced cancel per child (T06-AC3): the command carries the
 *    expected attempt/generation; the extension refuses to abort a live child
 *    whose identity does not match.
 * 3. Report `cancelled` ONLY from termination evidence (T06-AC4/AC5):
 *    - a child terminal acknowledgement resolving AFTER the child operation
 *      settled on the extension side, carrying the same attempt/generation,
 *      or
 *    - owner-death proof: the owner process generation is dead, the lease
 *      (re-derived server-side from last_heartbeat_at + leaseDurationMs —
 *      never trusting producer-supplied occurredAt per Decisions 0009/0010)
 *      is expired, and the bridge's listActive no longer contains the
 *      execution.
 *    `session.abort()` resolution or a temporary describe miss is NOT proof.
 * 4. On dispatch failure or acknowledgement timeout (T06-AC6): keep
 *    `cancelling`, emit a stable diagnostic, retry within the configured
 *    bound, and escalate to the provider-turn interrupt (stage 1) without
 *    claiming success.
 *
 * Idempotency (T06-AC1): duplicate/replayed cancel commands reuse the same
 * deterministic cancelCommandId per (execution, attempt, generation), so the
 * journal dedup returns already_applied and no second child abort is
 * dispatched. Terminal executions are reported as already_terminal without
 * dispatch.
 */

export interface CancelChildDispatch {
  /** Dispatch one fenced cancel to the extension bridge. */
  readonly dispatch: (
    command: PiSubagentCancelCommand,
  ) => Promise<PiSubagentCancelResult | undefined>;
}

export interface CancelParentTurnScopeInput {
  readonly threadId: string;
  readonly repository: PiSubagentExecutionRepositoryShape;
  /**
   * Extension bridge for the live session, when one exists. Absent bridge or
   * absent `cancel` method (mixed-version extension without the
   * durable-cancellation capability) is a dispatch failure with a stable
   * diagnostic — never a silent skip and never a premature `cancelled`.
   */
  readonly bridge: PiSubagentExtensionBridge | undefined;
  /**
   * Owner-death probe (T06-AC4): whether the session context that owns the
   * children is dead (stopped or absent). Supplied by the adapter from
   * server-tracked session truth.
   */
  readonly isOwnerGenerationDead: () => boolean;
  /** Live active-children probe from the bridge (owner-death evidence leg). */
  readonly listActive: () => ReadonlyArray<PiSubagentActiveChild> | undefined;
  readonly cancelAckTimeoutMs?: number | undefined;
  readonly cancelRetryLimit?: number | undefined;
  /** Lease duration used to re-derive expiry from last_heartbeat_at. */
  readonly leaseDurationMs?: number | undefined;
  /** Injectable clock (epoch ms) for deterministic tests. */
  readonly now?: () => number;
  /** Injectable sleep for deterministic retry tests. */
  readonly sleep?: (ms: number) => Effect.Effect<void>;
  /** Escalation stage 1 hook: interrupt the provider turn WITHOUT claiming success. */
  readonly onEscalateProviderTurnInterrupt?: (executionId: string) => void;
  /** Stable diagnostic observer (per execution), for runtime warnings. */
  readonly onDiagnostic?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: string;
    readonly diagnosticMessage: string;
  }) => void;
}

export interface CancelParentTurnScopeResult {
  readonly outcomes: ReadonlyArray<PiSubagentCancelExecutionOutcome>;
}

const TERMINAL_STATES = new Set(["cancelled", "succeeded", "failed", "rejected"]);

/**
 * Re-derive lease expiry server-side (Decisions 0009/0010 standing
 * obligation): expiry = last_heartbeat_at + leaseDurationMs, compared against
 * the SERVER clock. The stored lease_expires_at (computed from
 * producer-supplied occurredAt) is never trusted as authority.
 */
function isLeaseExpired(
  observation: PiSubagentExecutionObservation,
  leaseDurationMs: number,
  nowMs: number,
): boolean {
  if (observation.lastHeartbeatAt === null) {
    // No heartbeat was ever observed: there is no lease to trust. Treat as
    // expired only for the owner-death path (the owner being dead is the
    // primary evidence; absence of heartbeat cannot prove liveness).
    return true;
  }
  const lastHeartbeatMs = Date.parse(observation.lastHeartbeatAt);
  if (!Number.isFinite(lastHeartbeatMs)) {
    return true;
  }
  return nowMs >= lastHeartbeatMs + leaseDurationMs;
}

const dispatchCancelOnce = (input: {
  readonly bridge: PiSubagentExtensionBridge | undefined;
  readonly command: PiSubagentCancelCommand;
  readonly ackTimeoutMs: number;
  readonly sleep: (ms: number) => Effect.Effect<void>;
}): Effect.Effect<PiSubagentCancelResult | undefined, never> =>
  Effect.gen(function* () {
    const cancelFn = input.bridge?.cancel;
    if (typeof cancelFn !== "function") {
      // Mixed-version extension (no durable-cancellation capability): stable
      // dispatch failure, never a skip, never a cancelled claim.
      return {
        status: "dispatch_failed" as const,
        executionId: input.command.executionId,
        attemptId: input.command.expectedAttemptId,
        generation: input.command.expectedGeneration,
        diagnosticCode: "pi_subagent_cancel_dispatch_failed",
        diagnosticMessage:
          "The extension bridge does not expose the durable-cancellation cancel method",
      };
    }
    // A throwing dispatch is a dispatch failure; a never-resolving dispatch
    // is an acknowledgement timeout. The timeout races the CALL ITSELF (not
    // its awaited result) so a hung bridge.cancel cannot block the bound.
    const dispatched = yield* Effect.promise(() =>
      Promise.race([
        Promise.resolve()
          .then(() => cancelFn(input.command))
          .catch(
            (): PiSubagentCancelResult => ({
              status: "dispatch_failed",
              executionId: input.command.executionId,
              attemptId: input.command.expectedAttemptId,
              generation: input.command.expectedGeneration,
              diagnosticCode: "pi_subagent_cancel_dispatch_failed",
              diagnosticMessage: "The extension bridge cancel dispatch threw",
            }),
          ),
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), input.ackTimeoutMs);
        }),
      ]),
    );
    return dispatched;
  });

export const cancelParentTurnScope = (
  input: CancelParentTurnScopeInput,
): Effect.Effect<CancelParentTurnScopeResult, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? (() => Date.now());
    const sleep =
      input.sleep ?? ((ms: number) => Effect.sleep(`${Math.max(0, ms)} millis` as const));
    const ackTimeoutMs =
      input.cancelAckTimeoutMs !== undefined && input.cancelAckTimeoutMs > 0
        ? input.cancelAckTimeoutMs
        : DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS;
    const retryLimit =
      input.cancelRetryLimit !== undefined && input.cancelRetryLimit >= 0
        ? input.cancelRetryLimit
        : DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT;
    const leaseDurationMs =
      input.leaseDurationMs !== undefined && input.leaseDurationMs > 0
        ? input.leaseDurationMs
        : 30000;

    // T06-AC2: every managed child declaring the parent-turn scope, both
    // transport modes.
    const cancellable = yield* input.repository.listCancellableByParentTurn(input.threadId);
    const outcomes: PiSubagentCancelExecutionOutcome[] = [];

    for (const execution of cancellable) {
      const expectedAttemptId = execution.attemptId;
      const expectedGeneration = execution.generation;

      if (TERMINAL_STATES.has(execution.observedState)) {
        outcomes.push({
          kind: "already_terminal",
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: execution.generation,
          observedState: execution.observedState,
        });
        continue;
      }

      // T06-AC1: journal-first durable intent with a deterministic
      // cancelCommandId scoped to (execution, attempt, generation). Replays
      // dedup to already_applied and never re-dispatch.
      const cancelCommandId = `cancelcmd_${execution.executionId}_${expectedAttemptId}_gen${expectedGeneration}_${input.threadId}`;
      const intentResult = yield* input.repository.recordCancellationIntent({
        executionId: execution.executionId,
        attemptId: expectedAttemptId,
        generation: expectedGeneration,
        sequence: 90,
        cancelCommandId,
        occurredAt: new Date(now()).toISOString(),
        reason: "parent_turn_stop",
      });

      // Re-read the aggregate AFTER the intent write: a concurrent terminal
      // (child completed between the list and the intent) wins.
      const afterIntent = intentResult.execution;
      if (TERMINAL_STATES.has(afterIntent.observedState)) {
        outcomes.push({
          kind: "already_terminal",
          executionId: execution.executionId,
          attemptId: afterIntent.attemptId,
          generation: afterIntent.generation,
          observedState: afterIntent.observedState,
        });
        continue;
      }

      // T06-AC3: the cancel targets the CURRENT attempt/generation only. If
      // the aggregate advanced past what we listed, this cancel is stale.
      if (
        afterIntent.attemptId !== expectedAttemptId ||
        afterIntent.generation !== expectedGeneration
      ) {
        outcomes.push({
          kind: "stale_generation",
          executionId: execution.executionId,
          expectedAttemptId,
          expectedGeneration,
          currentAttemptId: afterIntent.attemptId,
          currentGeneration: afterIntent.generation,
        });
        continue;
      }

      // Owner-death evidence path (T06-AC4): dead owner generation + expired
      // re-derived lease + listActive no longer contains the execution.
      const ownerDead = input.isOwnerGenerationDead();
      if (ownerDead) {
        const activeChildren = input.listActive();
        const stillActive =
          activeChildren?.some((child) => child.executionId === execution.executionId) ?? false;
        if (!stillActive) {
          const observationOption = yield* input.repository.getObservation(execution.executionId);
          const observation = Option.isSome(observationOption) ? observationOption.value : null;
          if (observation === null || isLeaseExpired(observation, leaseDurationMs, now())) {
            yield* input.repository.recordCancelledAck({
              executionId: execution.executionId,
              attemptId: expectedAttemptId,
              generation: expectedGeneration,
              sequence: 91,
              occurredAt: new Date(now()).toISOString(),
              evidenceChannel: "owner_death",
              diagnosticCode: "pi_subagent_cancel_owner_death",
              diagnosticMessage:
                "Cancelled by owner-death evidence: owner process generation dead, lease expired (re-derived server-side), and listActive no longer contains the execution",
            });
            outcomes.push({
              kind: "cancelled_owner_death",
              executionId: execution.executionId,
              attemptId: expectedAttemptId,
              generation: expectedGeneration,
            });
            continue;
          }
          // Owner dead + not in listActive but lease not yet expired: no
          // termination proof yet — remain cancelling with a stable
          // diagnostic (retry path below still runs bounded dispatch).
          input.onDiagnostic?.({
            executionId: execution.executionId,
            diagnosticCode: "pi_subagent_cancel_ack_timeout",
            diagnosticMessage:
              "Owner generation is dead and the execution is no longer active, but the re-derived lease has not expired; cancellation remains pending",
          });
        }
      }

      // T06-AC6: bounded dispatch + acknowledgement wait.
      const command: PiSubagentCancelCommand = {
        cancelCommandId,
        executionId: execution.executionId,
        expectedAttemptId,
        expectedGeneration,
      };
      let dispatchAttempts = 0;
      let ack: PiSubagentCancelResult | undefined;
      let lastFailure: "dispatch_failed" | "ack_timeout" = "ack_timeout";
      for (let attempt = 0; attempt <= retryLimit && ack === undefined; attempt++) {
        dispatchAttempts++;
        const result = yield* dispatchCancelOnce({
          bridge: input.bridge,
          command,
          ackTimeoutMs,
          sleep,
        });
        if (result === undefined) {
          // Dispatched but no acknowledgement within the bound.
          lastFailure = "ack_timeout";
          if (attempt < retryLimit) {
            yield* sleep(Math.min(250 * (attempt + 1), 1000));
          }
          continue;
        }
        if (result.status === "cancelled") {
          if (result.attemptId === expectedAttemptId && result.generation === expectedGeneration) {
            ack = result;
            break;
          }
          // Ack carried a different attempt/generation: not valid evidence
          // for this cancel (T06-AC4 requires the same attempt/generation).
          lastFailure = "ack_timeout";
          continue;
        }
        if (result.status === "already_terminal") {
          outcomes.push({
            kind: "already_terminal",
            executionId: execution.executionId,
            attemptId: expectedAttemptId,
            generation: expectedGeneration,
            observedState: "cancelled",
          });
          break;
        }
        if (result.status === "stale") {
          outcomes.push({
            kind: "stale_generation",
            executionId: execution.executionId,
            expectedAttemptId,
            expectedGeneration,
            currentAttemptId: result.attemptId,
            currentGeneration: result.generation,
          });
          break;
        }
        // dispatch_failed / missing: retry within bounds.
        lastFailure = "dispatch_failed";
        if (attempt < retryLimit) {
          yield* sleep(Math.min(250 * (attempt + 1), 1000));
        }
      }

      if (ack !== undefined) {
        yield* input.repository.recordCancelledAck({
          executionId: execution.executionId,
          attemptId: expectedAttemptId,
          generation: expectedGeneration,
          sequence: 92,
          occurredAt: new Date(now()).toISOString(),
          evidenceChannel: "child_ack",
        });
        outcomes.push({
          kind: "cancelled_ack",
          executionId: execution.executionId,
          attemptId: expectedAttemptId,
          generation: expectedGeneration,
        });
        continue;
      }

      // No valid acknowledgement: preserve `cancelling`, stable diagnostic,
      // escalation stage 1 (provider-turn interrupt) WITHOUT claiming
      // success (T06-AC6).
      const diagnosticCode =
        lastFailure === "dispatch_failed"
          ? "pi_subagent_cancel_dispatch_failed"
          : "pi_subagent_cancel_ack_timeout";
      const diagnosticMessage =
        lastFailure === "dispatch_failed"
          ? `Cancellation dispatch failed after ${dispatchAttempts} attempt(s); execution remains cancelling and the child may still be active`
          : `Cancellation acknowledgement timed out after ${dispatchAttempts} attempt(s); execution remains cancelling and the child may still be active`;
      input.onDiagnostic?.({
        executionId: execution.executionId,
        diagnosticCode,
        diagnosticMessage,
      });
      input.onEscalateProviderTurnInterrupt?.(execution.executionId);
      outcomes.push({
        kind: "still_cancelling",
        executionId: execution.executionId,
        attemptId: expectedAttemptId,
        generation: expectedGeneration,
        diagnosticCode: diagnosticCode as typeof diagnosticCode,
        diagnosticMessage,
        dispatchAttempts,
        escalated: true,
      });
    }

    return { outcomes };
  });

/**
 * Bridge dispatch helper for the adapter: resolves the extension bridge from
 * the live session target using the same extraction rules as the capability
 * probe.
 */
export const dispatchCancelCommand = async (
  bridge: PiSubagentExtensionBridge | undefined,
  command: PiSubagentCancelCommand,
): Promise<PiSubagentCancelResult | undefined> => {
  if (bridge === undefined || typeof bridge.cancel !== "function") {
    return undefined;
  }
  return bridge.cancel(command);
};
