import type { PiSubagentDiagnosticCode } from "@synara/contracts";
import { Effect } from "effect";

import {
  DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
} from "../config.ts";
import type {
  PiSubagentExecutionRepositoryShape,
  PiSubagentSequenceContinuity,
  PiSubagentTerminalRecordResult,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";

/**
 * Ticket 07 — Journal-first terminal lifecycle coordinator.
 *
 * Terminal evidence from a child settlement becomes durable execution truth
 * BEFORE any completion delivery may begin (T07-AC1):
 *
 * 1. Bound the payload (T07-AC5): the producer summary is truncated
 *    server-side to the resolved config cap — never stored or emitted
 *    unbounded; the transcript reference is opaque.
 * 2. Persist via `recordTerminalEvent` (journal row + aggregate in one
 *    transaction): first applicable terminal wins, replays are
 *    already_applied, stale/racing terminals are journaled + counted and
 *    never overwrite truth (T07-AC2/AC4/AC7).
 * 3. Emit a stable sequence-gap diagnostic when attempt-local continuity
 *    reports a gap — WITHOUT deleting or delaying the already-persisted
 *    terminal (T07-AC3).
 * 4. Only AFTER the durable write returns, notify observers
 *    (`onTerminalPersisted`) — the completion-delivery seam Ticket 08 will
 *    consume. Persistence failure degrades control health via
 *    `onTerminalPersistenceFailed` and NEVER notifies.
 */

/** Attempt-local sequence band for child settlement terminals (band 40). */
export const PI_SUBAGENT_TERMINAL_SEQUENCE = 40;

export interface PiSubagentTerminalObservation {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly state: "succeeded" | "failed";
  readonly occurredAt: string;
  readonly summary: string;
  readonly transcriptRef?: string | undefined;
  readonly outcomeState?: string | undefined;
  readonly diagnosticMessage?: string | undefined;
}

export interface IngestPiSubagentTerminalInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly observation: PiSubagentTerminalObservation;
  /** Server-resolved terminal summary cap (config knob). */
  readonly summaryMaxChars?: number | undefined;
  /**
   * Post-commit notification seam (T07-AC1): invoked ONLY after the terminal
   * journal row and aggregate are durably committed. Ticket 08's completion
   * outbox creation attaches here.
   */
  readonly onTerminalPersisted?: (event: {
    readonly result: PiSubagentTerminalRecordResult;
    readonly continuity: PiSubagentSequenceContinuity;
  }) => void;
  /**
   * Stable diagnostic observer (sequence gaps, stale counting) for runtime
   * warnings — diagnostics never delay or delete the terminal (T07-AC3/AC4).
   */
  readonly onDiagnostic?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
  /**
   * Terminal persistence failure surface: unlike observation kinds, terminal
   * truth is control truth — a failed terminal write degrades control health
   * and MUST reject the producer (T07-AC1/T07-AC6: degradation of the
   * observation sink never applies to the terminal path).
   */
  readonly onTerminalPersistenceFailed?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}

export type IngestPiSubagentTerminalResult =
  | { readonly outcome: "persisted" | "already_applied" | "ignored_stale" }
  | { readonly outcome: "failed" };

const truncateSummary = (summary: string, maxChars: number): string => {
  if (summary.length <= maxChars) {
    return summary;
  }
  return `${summary.slice(0, Math.max(0, maxChars - 1))}…`;
};

export const ingestPiSubagentTerminal = (
  input: IngestPiSubagentTerminalInput,
): Effect.Effect<IngestPiSubagentTerminalResult, unknown> =>
  Effect.gen(function* () {
    const summaryMaxChars =
      input.summaryMaxChars !== undefined &&
      Number.isInteger(input.summaryMaxChars) &&
      input.summaryMaxChars >= MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS
        ? input.summaryMaxChars
        : DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;

    const boundedSummary = truncateSummary(input.observation.summary, summaryMaxChars);

    const recordEffect = input.repository.recordTerminalEvent({
      executionId: input.observation.executionId,
      attemptId: input.observation.attemptId,
      generation: input.observation.generation,
      sequence: PI_SUBAGENT_TERMINAL_SEQUENCE,
      state: input.observation.state,
      occurredAt: input.observation.occurredAt,
      summary: boundedSummary,
      transcriptRef: input.observation.transcriptRef ?? null,
      outcomeState: input.observation.outcomeState ?? null,
      diagnosticCode: null,
      diagnosticMessage: input.observation.diagnosticMessage ?? null,
    });

    const recordResult = yield* Effect.result(recordEffect);

    if (recordResult._tag === "Failure") {
      // Terminal persistence failure degrades control health and NEVER
      // notifies completion consumers (T07-AC1: delivery may not begin on
      // undurable truth).
      const failure = recordResult.failure;
      const message = failure instanceof Error ? failure.message : String(failure);
      input.onTerminalPersistenceFailed?.({
        executionId: input.observation.executionId,
        diagnosticCode: "pi_subagent_terminal_persistence_failed",
        diagnosticMessage: `Terminal evidence failed to persist: ${message}`,
      });
      return { outcome: "failed" as const };
    }

    const record = recordResult.success;

    // Stable sequence-gap diagnostic — reported only; the terminal above is
    // already persisted and is never deleted or delayed (T07-AC3).
    if (record.continuity.hasGap) {
      input.onDiagnostic?.({
        executionId: input.observation.executionId,
        diagnosticCode: "pi_subagent_event_sequence_gap",
        diagnosticMessage: `Attempt-local journal sequence gap: terminal at sequence ${PI_SUBAGENT_TERMINAL_SEQUENCE} follows prior max ${record.continuity.priorMaxSequence ?? "none"} for attempt '${input.observation.attemptId}' (generation ${input.observation.generation}); the terminal remains persisted`,
      });
    }

    if (record.kind === "ignored_stale") {
      input.onDiagnostic?.({
        executionId: input.observation.executionId,
        diagnosticCode: "pi_subagent_terminal_stale_ignored",
        diagnosticMessage: `Terminal evidence ignored (${record.reason}) and counted (${record.staleTerminalEvents} stale terminal event(s)); current execution truth is unchanged`,
      });
      return { outcome: "ignored_stale" as const };
    }

    if (record.kind === "already_applied") {
      return { outcome: "already_applied" as const };
    }

    // Durable commit happened: completion delivery may begin (T07-AC1).
    input.onTerminalPersisted?.({ result: record, continuity: record.continuity });
    return { outcome: "persisted" as const };
  });

/**
 * Shared runtime-warning shape for the adapter surfaces (terminal settled /
 * gap / stale / persistence-failure diagnostics).
 */
export interface PiSubagentTerminalDiagnosticEvent {
  readonly executionId: string;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
  readonly diagnosticMessage: string;
}
