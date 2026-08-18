import type { PiSubagentDiagnosticCode } from "@synara/contracts";
import { Effect, Option } from "effect";

import type {
  PiSubagentCompletionOutboxEntry,
  PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";

/**
 * Ticket 08 — Durable completion outbox coordinator.
 *
 * Execution outcome and completion delivery are SEPARATE state machines
 * (spec Implementation Decision 22): this coordinator drives delivery state
 * only and can never rewrite a successful execution as failed.
 *
 * 1. Journal-first recovery (`recoverCompletionOutbox`, T08-AC1/AC4): every
 *    applicable terminal journal row without an outbox entry gets its
 *    durable pending entry. New terminals create the entry atomically inside
 *    `recordTerminalEvent`'s transaction; this scan covers pre-102 databases
 *    and any crash window between journal commit and outbox creation.
 * 2. Delivery pump (`processPendingCompletions`, T08-AC4/AC5): moves
 *    recoverably-pending entries to delivered through the injected
 *    parent-completion boundary, then to acknowledged. Retries carry the
 *    STABLE dedupe identity (`outboxId`), so at-least-once delivery can never
 *    create duplicate parent content.
 * 3. Supersede (T08-AC6): an entry fenced off by a newer attempt/generation
 *    is marked superseded and produces NO delivery effect, while its original
 *    execution evidence remains readable.
 *
 * Delivery failure is retryable within the configured retry budget and
 * leaves the execution outcome untouched — it degrades nothing on the
 * execution aggregate and reports a stable diagnostic instead.
 */

/** Default retry budget when no config value is supplied (test/legacy paths). */
export const DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT = 5;

/**
 * The parent completion-injection boundary (T08-AC5 seam). The parent side is
 * responsible for deduplicating by `dedupeId` (the stable outbox identity);
 * Ticket 09 owns the concrete follow-up-turn consumer. An acknowledgement
 * arriving with the accepted delivery settles the entry immediately;
 * otherwise the entry stays `delivered` and a later acknowledged delivery
 * pass settles it (redelivery is harmless by dedupe identity).
 */
export interface PiSubagentCompletionDeliveryRequest {
  /** Stable dedupe identity — deterministic per terminal attempt/generation. */
  readonly dedupeId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
  readonly terminalState: "succeeded" | "failed";
  /** Bounded summary excerpt — never unbounded raw output. */
  readonly summary: string;
  readonly transcriptRef: string | null;
}

export interface PiSubagentCompletionDeliveryOutcome {
  /** The parent boundary accepted the completion (at-least-once). */
  readonly accepted: boolean;
  /** The parent durably acknowledged; entry may settle to `acknowledged`. */
  readonly acknowledged: boolean;
  readonly error?: string;
}

export interface RecoverCompletionOutboxInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly now?: () => string;
  readonly onDiagnostic?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}

export interface RecoverCompletionOutboxResult {
  /** Terminal journal rows that were missing an outbox entry and got one. */
  readonly recovered: number;
  /** Recovery write failures (outbox persistence failure surface). */
  readonly failures: number;
}

/**
 * Journal-first recovery (T08-AC1/AC4): scan applicable terminal journal rows
 * without outbox entries and create their durable pending entries. Idempotent
 * — a second pass recovers nothing.
 */
export const recoverCompletionOutbox = (
  input: RecoverCompletionOutboxInput,
): Effect.Effect<RecoverCompletionOutboxResult, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? (() => new Date().toISOString());
    const missing = yield* Effect.result(input.repository.listTerminalEventsWithoutOutbox());
    if (missing._tag === "Failure") {
      return { recovered: 0, failures: 0 };
    }
    let recovered = 0;
    let failures = 0;
    for (const terminal of missing.success) {
      const summary =
        typeof terminal.summary === "string" && terminal.summary.trim().length > 0
          ? terminal.summary
          : `(terminal ${terminal.state}, no summary)`;
      const result = yield* Effect.result(
        input.repository.recordCompletionOutboxEntry({
          executionId: terminal.executionId,
          attemptId: terminal.attemptId,
          generation: terminal.generation,
          terminalEventId: terminal.eventId,
          parentThreadId: terminal.parentThreadId,
          terminalState: terminal.state,
          summary,
          transcriptRef: terminal.transcriptRef ?? null,
          now: now(),
        }),
      );
      if (result._tag === "Success") {
        recovered += 1;
      } else {
        failures += 1;
        const failure = result.failure;
        const message = failure instanceof Error ? failure.message : String(failure);
        input.onDiagnostic?.({
          executionId: terminal.executionId,
          diagnosticCode: "pi_subagent_completion_outbox_persistence_failed",
          diagnosticMessage: `Completion outbox recovery failed for execution '${terminal.executionId}' attempt '${terminal.attemptId}': ${message}`,
        });
      }
    }
    return { recovered, failures };
  });

export interface ProcessPendingCompletionsInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /**
   * Parent completion-injection boundary (T08-AC5). The parent side must
   * deduplicate by `dedupeId`.
   */
  readonly deliver: (
    request: PiSubagentCompletionDeliveryRequest,
  ) => Promise<PiSubagentCompletionDeliveryOutcome>;
  readonly retryLimit?: number;
  readonly now?: () => string;
  readonly onDiagnostic?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}

export interface ProcessPendingCompletionsResult {
  readonly delivered: number;
  readonly acknowledged: number;
  readonly failed: number;
  readonly superseded: number;
  readonly skipped: number;
}

/**
 * Delivery pump (T08-AC4/AC5): deliver every recoverably-pending entry,
 * acknowledge the ones the parent acknowledged, record retryable failures,
 * and supersede generation-fenced entries without any delivery effect.
 */
export const processPendingCompletions = (
  input: ProcessPendingCompletionsInput,
): Effect.Effect<ProcessPendingCompletionsResult, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? (() => new Date().toISOString());
    const retryLimit =
      input.retryLimit !== undefined && Number.isInteger(input.retryLimit) && input.retryLimit >= 0
        ? input.retryLimit
        : DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;

    const pendingResult = yield* Effect.result(
      input.repository.listRecoverableCompletionOutbox({ retryLimit }),
    );
    if (pendingResult._tag === "Failure") {
      return { delivered: 0, acknowledged: 0, failed: 0, superseded: 0, skipped: 0 };
    }

    let delivered = 0;
    let acknowledged = 0;
    let failed = 0;
    let superseded = 0;
    let skipped = 0;

    for (const entry of pendingResult.success) {
      // Supersede check BEFORE any delivery effect (T08-AC6): an entry whose
      // attempt/generation is no longer current must never reach the parent.
      const fence = yield* fenceEntry(input.repository, entry, now());
      if (fence === "superseded") {
        superseded += 1;
        input.onDiagnostic?.({
          executionId: entry.executionId,
          diagnosticCode: "pi_subagent_completion_superseded",
          diagnosticMessage: `Completion for execution '${entry.executionId}' attempt '${entry.attemptId}' generation ${entry.generation} superseded by a newer generation; no delivery effect`,
        });
        continue;
      }
      if (fence === "not_current_no_supersede") {
        // Entry already terminal on the delivery side (delivered/ack) — skip.
        skipped += 1;
        continue;
      }

      const outcomeResult = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            input.deliver({
              dedupeId: entry.outboxId,
              executionId: entry.executionId,
              attemptId: entry.attemptId,
              generation: entry.generation,
              parentThreadId: entry.parentThreadId,
              terminalState: entry.terminalState,
              summary: entry.summary,
              transcriptRef: entry.transcriptRef,
            }),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }),
      );

      if (outcomeResult._tag === "Failure") {
        const message = outcomeResult.failure.message;
        failed += 1;
        yield* markFailed(input.repository, entry, message, now(), input.onDiagnostic);
        continue;
      }

      const delivery = outcomeResult.success;
      if (!delivery.accepted) {
        failed += 1;
        yield* markFailed(
          input.repository,
          entry,
          delivery.error ?? "parent completion boundary rejected the delivery",
          now(),
          input.onDiagnostic,
        );
        continue;
      }

      const deliveredResult = yield* Effect.result(
        input.repository.markCompletionDelivered({ outboxId: entry.outboxId, now: now() }),
      );
      if (deliveredResult._tag === "Failure") {
        // The parent accepted, but the durable transition failed: report via
        // the diagnostic surface; the next pump redelivers (dedupe identity
        // makes the redelivery harmless).
        failed += 1;
        const cause = deliveredResult.failure;
        const message = cause instanceof Error ? cause.message : String(cause);
        input.onDiagnostic?.({
          executionId: entry.executionId,
          diagnosticCode: "pi_subagent_completion_delivery_failed",
          diagnosticMessage: `Durable delivered-transition failed for execution '${entry.executionId}': ${message}`,
        });
        continue;
      }
      const transition = deliveredResult.success;
      if (transition.kind === "superseded_instead") {
        superseded += 1;
        continue;
      }
      if (transition.kind === "invalid_transition" || transition.kind === "not_found") {
        skipped += 1;
        continue;
      }
      delivered += 1;

      if (delivery.acknowledged) {
        const ackResult = yield* Effect.result(
          input.repository.markCompletionAcknowledged({ outboxId: entry.outboxId, now: now() }),
        );
        if (ackResult._tag === "Success" && ackResult.success.kind === "transitioned") {
          acknowledged += 1;
        }
      }
    }

    return { delivered, acknowledged, failed, superseded, skipped };
  });

type FenceOutcome = "current" | "superseded" | "not_current_no_supersede";

const fenceEntry = (
  repository: PiSubagentExecutionRepositoryShape,
  entry: PiSubagentCompletionOutboxEntry,
  now: string,
): Effect.Effect<FenceOutcome, never> =>
  Effect.gen(function* () {
    const executionOption = yield* Effect.result(repository.getById(entry.executionId));
    if (executionOption._tag === "Failure") {
      return "current" as const;
    }
    if (Option.isNone(executionOption.success)) {
      return "current" as const;
    }
    const execution = executionOption.success.value;
    if (execution.attemptId === entry.attemptId && execution.generation === entry.generation) {
      return "current" as const;
    }
    // Newer attempt/generation owns the execution: supersede with no
    // delivery effect (T08-AC6).
    const superseded = yield* Effect.result(
      repository.markCompletionSuperseded({
        outboxId: entry.outboxId,
        supersededByGeneration: execution.generation,
        now,
      }),
    );
    if (superseded._tag === "Success" && superseded.success.kind !== "not_found") {
      return "superseded" as const;
    }
    return "not_current_no_supersede" as const;
  });

const markFailed = (
  repository: PiSubagentExecutionRepositoryShape,
  entry: PiSubagentCompletionOutboxEntry,
  message: string,
  now: string,
  onDiagnostic?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      repository.markCompletionDeliveryFailed({
        outboxId: entry.outboxId,
        now,
        error: message,
      }),
    );
    if (result._tag === "Failure") {
      onDiagnostic?.({
        executionId: entry.executionId,
        diagnosticCode: "pi_subagent_completion_delivery_failed",
        diagnosticMessage: `Durable failure-transition failed for execution '${entry.executionId}': ${message}`,
      });
      return;
    }
    const transition = result.success;
    // Delivery failure NEVER mutates the execution outcome — the diagnostic
    // is the only additional effect (spec story 21/22).
    onDiagnostic?.({
      executionId: entry.executionId,
      diagnosticCode: "pi_subagent_completion_delivery_failed",
      diagnosticMessage:
        transition.kind === "transitioned"
          ? `Completion delivery failed for execution '${entry.executionId}' (attempt ${transition.entry.attemptCount}, retryable): ${message}`
          : `Completion delivery failed for execution '${entry.executionId}': ${message}`,
    });
  });
