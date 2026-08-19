import type {
  PiSubagentDiagnosticCode,
  PiSubagentExecutionRecord,
  PiSubagentReconciliationOutcome,
  PiSubagentTranscriptTerminalMarker,
} from "@synara/contracts";
import { Effect, Option } from "effect";

import {
  DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS,
  DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
} from "../config.ts";
import type {
  PiSubagentExecutionRepositoryShape,
  PiSubagentReconciliationMode,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { PI_SUBAGENT_TERMINAL_SEQUENCE } from "./piSubagentTerminalCoordinator.ts";
import { truncateWithEllipsis } from "./piSubagentBoundedText.ts";
import type { PiSubagentActiveChild } from "./piSubagentBridge.ts";
import { isTerminalPiSubagentState } from "./piSubagentLifecycleStates.ts";

/**
 * Ticket 10 — Restart / lease-expiry reconciliation to terminal or orphaned.
 *
 * On server restart (mode `"restart"`), Synara reconciles EVERY non-terminal
 * managed execution against live bridge ownership and terminal evidence
 * (spec Implementation Decision 29):
 *
 *   evidence ladder (per execution, current attempt/generation only):
 *   1. LIVE OWNER (T10-AC3): a bridge `listActive` record matching
 *      executionId + attemptId + generation proves the child is still owned
 *      and running — the observation is refreshed (server-side heartbeat
 *      touch) and NO new attempt is created. `running` is never asserted
 *      without this evidence (T10-AC1).
 *   2. TERMINAL EVIDENCE (T10-AC2): a terminal journal row for the current
 *      attempt/generation, or a transcript terminal marker carrying the same
 *      identity and generation, restores the applicable terminal outcome via
 *      the idempotent journal-first terminal path (which also creates the
 *      completion-outbox entry atomically — Decision 0013 linkage). A marker
 *      whose identity/generation does NOT match is stale and restores
 *      nothing.
 *   3. NEITHER → `orphaned` (T10-AC1): non-terminal owner-loss state with a
 *      stable diagnostic that explains partial external/workspace side
 *      effects may already exist and recommends inspection (T10-AC6). The
 *      generation advances by one (reconciliation fence, spec Implementation
 *      Decision 27) so late events from the orphaned attempt/generation are
 *      ignored and counted (T10-AC5).
 *
 * Reconciliation NEVER replays the delegation automatically (T10-AC4): no
 * spawn, no resume, no dispatch of any kind — the coordinator only reads
 * evidence and records durable state. Resume of an orphaned execution is
 * explicit user action (Ticket 14).
 *
 * Lease expiry (mode `"lease_expiry"`, T10-AC7): the same owner-loss
 * reconciliation, entered when the re-derived lease (last_heartbeat_at +
 * leaseDurationMs, server clock — the stored lease_expires_at is never
 * trusted, Decisions 0009–0013 standing obligation) has been expired for at
 * least the configured orphan threshold (approximately 60 seconds,
 * configurable). Live-owner evidence still wins: a bridge-active child is
 * refreshed, never orphaned.
 */

/** Attempt-local sequence band for reconciliation owner-loss events. */
export const PI_SUBAGENT_ORPHAN_SEQUENCE = 50;

export const PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_CODE: PiSubagentDiagnosticCode =
  "pi_subagent_owner_loss_orphaned";

/**
 * T10-AC6: the orphan diagnostic MUST explain that partial side effects may
 * already exist and recommend inspection before any resume. Projected as-is
 * through the execution record's diagnostic fields and runtime events.
 */
export const PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE =
  "Owner loss: no live bridge owner or terminal evidence could be proven for this execution. " +
  "Partial external or workspace side effects may already exist — inspect the workspace and " +
  "the transcript before resuming; the execution was not automatically replayed.";

/** Live-owner probe: bridge active-children snapshot per live session. */
export type PiSubagentLiveOwnerProbe = () => ReadonlyArray<PiSubagentActiveChild> | undefined;

/**
 * T10-AC2 transcript terminal-evidence reader. Production restart recovery
 * reads the durable journal; transcript-marker recovery is exercised through
 * this injectable seam (approved Testing Seams: terminal-marker fixtures).
 * A marker carries the attempt/generation it settles; only an exact
 * identity+generation match restores an outcome.
 */
export type PiSubagentTranscriptTerminalReader = (execution: {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
}) => Promise<PiSubagentTranscriptTerminalMarker | undefined | null>;

export interface ReconcilePiSubagentExecutionsInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /** `"restart`" orphans immediately; `"lease_expiry"` requires the threshold. */
  readonly mode: PiSubagentReconciliationMode;
  /**
   * Live-owner probes (one per live bridge session). Empty at server
   * startup — an in-process Pi child cannot survive server process death,
   * so no startup probe can exist.
   */
  readonly liveOwnerProbes?: ReadonlyArray<PiSubagentLiveOwnerProbe>;
  /** T10-AC2 transcript terminal-evidence reader (optional seam). */
  readonly readTranscriptTerminal?: PiSubagentTranscriptTerminalReader;
  /** Lease duration for the server-side lease re-derivation (T10-AC7). */
  readonly leaseDurationMs?: number | undefined;
  /** Lease-expiry orphan threshold (T10-AC7); default ~60 seconds. */
  readonly orphanAfterMs?: number | undefined;
  /** Terminal summary cap for restored outcomes (Decision 0012 bounds). */
  readonly summaryMaxChars?: number | undefined;
  /** Injectable clock (epoch ms) for deterministic tests. */
  readonly now?: () => number;
  /** Diagnostic observer (stable codes; projected runtime warnings). */
  readonly onDiagnostic?: (event: {
    readonly executionId: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}

export interface ReconcilePiSubagentExecutionsResult {
  readonly outcomes: ReadonlyArray<PiSubagentReconciliationOutcome>;
  /** Executions whose settlement write failed (fail-closed diagnostic). */
  readonly failures: ReadonlyArray<{ readonly executionId: string; readonly error: string }>;
}

const truncateSummary = (summary: string, maxChars: number): string =>
  truncateWithEllipsis(summary, maxChars);

/**
 * Server-side lease re-derivation (Decisions 0009–0013 standing obligation):
 * expiry = last_heartbeat_at + leaseDurationMs against the SERVER clock.
 * The stored producer-supplied lease_expires_at is never trusted, and a
 * missing/unparseable heartbeat is not liveness evidence.
 */
const isLeaseExpiredBeyond = (
  lastHeartbeatAt: string | null,
  leaseDurationMs: number,
  nowMs: number,
  beyondMs: number,
): boolean => {
  if (lastHeartbeatAt === null) {
    return true;
  }
  const lastHeartbeatMs = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(lastHeartbeatMs)) {
    return true;
  }
  return nowMs >= lastHeartbeatMs + leaseDurationMs + beyondMs;
};

const matchesCurrentAttempt = (
  child: PiSubagentActiveChild,
  execution: PiSubagentExecutionRecord,
): boolean =>
  child.executionId === execution.executionId &&
  child.attemptId === execution.attemptId &&
  child.generation === execution.generation &&
  child.isRunning;

const findLiveOwnerEvidence = (
  execution: PiSubagentExecutionRecord,
  probes: ReadonlyArray<PiSubagentLiveOwnerProbe>,
): PiSubagentActiveChild | undefined => {
  for (const probe of probes) {
    const active = probe();
    if (active === undefined) {
      continue;
    }
    const match = active.find((child) => matchesCurrentAttempt(child, execution));
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
};

/**
 * T10-AC2: restore an applicable terminal outcome through the journal-first
 * idempotent terminal path (`recordTerminalEvent`). A replay is
 * `already_applied`; the first applicable terminal wins; the completion
 * outbox entry is created in the same transaction when applicable — so a
 * restored outcome immediately enters the fenced delivery path (Decision
 * 0013: recovered pending entries enter the fenced delivery path).
 */
const restoreTerminalOutcome = (
  input: ReconcilePiSubagentExecutionsInput,
  execution: PiSubagentExecutionRecord,
  marker: {
    readonly state: "succeeded" | "failed";
    readonly summary: string;
    readonly transcriptRef?: string | null;
    readonly outcomeState?: string | null;
    readonly source: "journal" | "transcript_marker";
  },
  nowIso: string,
): Effect.Effect<
  Extract<PiSubagentReconciliationOutcome, { kind: "terminal_restored" }> | { kind: "failed" },
  never
> =>
  Effect.gen(function* () {
    const summaryMaxChars =
      input.summaryMaxChars !== undefined &&
      Number.isInteger(input.summaryMaxChars) &&
      input.summaryMaxChars >= MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS &&
      input.summaryMaxChars <= MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS
        ? input.summaryMaxChars
        : DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;
    const boundedTranscriptRef =
      typeof marker.transcriptRef === "string" && marker.transcriptRef.length > 1024
        ? `${marker.transcriptRef.slice(0, 1023)}…`
        : marker.transcriptRef;
    const result = yield* Effect.result(
      input.repository.recordTerminalEvent({
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation,
        sequence: PI_SUBAGENT_TERMINAL_SEQUENCE,
        state: marker.state,
        occurredAt: nowIso,
        summary: truncateSummary(marker.summary, summaryMaxChars),
        transcriptRef: boundedTranscriptRef ?? null,
        outcomeState: marker.outcomeState ?? null,
        diagnosticCode: null,
        diagnosticMessage: null,
      }),
    );
    if (result._tag === "Failure") {
      return { kind: "failed" as const };
    }
    return {
      kind: "terminal_restored" as const,
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      state: marker.state,
      source: marker.source,
    };
  });

export const reconcilePiSubagentExecutions = (
  input: ReconcilePiSubagentExecutionsInput,
): Effect.Effect<ReconcilePiSubagentExecutionsResult, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? (() => Date.now());
    const probes = input.liveOwnerProbes ?? [];
    const leaseDurationMs =
      input.leaseDurationMs !== undefined && input.leaseDurationMs > 0
        ? input.leaseDurationMs
        : 30000;
    const orphanAfterMs =
      input.orphanAfterMs !== undefined && input.orphanAfterMs >= 0
        ? input.orphanAfterMs
        : DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS;

    const scan = yield* Effect.result(input.repository.listNonTerminalExecutions());
    if (scan._tag === "Failure") {
      return { outcomes: [], failures: [] };
    }

    const outcomes: PiSubagentReconciliationOutcome[] = [];
    const failures: { executionId: string; error: string }[] = [];

    for (const execution of scan.success) {
      // Snapshot races are settled by the guarded repository writes below:
      // a terminal aggregate, a newer attempt, or an already-orphaned
      // execution each report their own outcome kind without mutation.

      // Evidence 1 — LIVE OWNER (T10-AC3): a bridge-active record under the
      // SAME execution/attempt/generation refreshes observation and keeps the
      // execution running. No new attempt is created and no state changes.
      const liveChild = findLiveOwnerEvidence(execution, probes);
      if (liveChild !== undefined) {
        const nowIso = new Date(now()).toISOString();
        const refresh = yield* Effect.result(
          input.repository.recordHeartbeatObservation({
            executionId: execution.executionId,
            occurredAt: nowIso,
            leaseExpiresAt: new Date(now() + leaseDurationMs).toISOString(),
          }),
        );
        if (refresh._tag === "Failure") {
          const cause = refresh.failure;
          const message = cause instanceof Error ? cause.message : String(cause);
          failures.push({ executionId: execution.executionId, error: message });
          continue;
        }
        outcomes.push({
          kind: "running_refreshed",
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: execution.generation,
        });
        continue;
      }

      // Evidence 2 — TERMINAL EVIDENCE for the CURRENT attempt/generation
      // (T10-AC2). Journal rows first (durable production path), then the
      // injectable transcript-marker seam. Identity+generation must match.
      const journal = yield* Effect.result(
        input.repository.listJournalEvents(execution.executionId),
      );
      let terminalMarker:
        | {
            readonly state: "succeeded" | "failed";
            readonly summary: string;
            readonly transcriptRef?: string | null;
            readonly outcomeState?: string | null;
            readonly source: "journal" | "transcript_marker";
          }
        | undefined;
      if (journal._tag === "Success") {
        const journalTerminal = journal.success.find(
          (event) =>
            (event.state === "succeeded" || event.state === "failed") &&
            event.attemptId === execution.attemptId &&
            event.generation === execution.generation,
        );
        if (
          journalTerminal !== undefined &&
          (journalTerminal.state === "succeeded" || journalTerminal.state === "failed")
        ) {
          const journalState: "succeeded" | "failed" = journalTerminal.state;
          const metadata = (journalTerminal.metadata ?? {}) as Record<string, unknown>;
          const summary =
            typeof metadata.summary === "string" && metadata.summary.length > 0
              ? metadata.summary
              : `(terminal ${journalState} recovered from journal)`;
          const transcriptRef =
            typeof metadata.transcriptRef === "string" ? metadata.transcriptRef : null;
          const outcomeState =
            typeof metadata.outcomeState === "string" ? metadata.outcomeState : null;
          terminalMarker = {
            state: journalState,
            summary,
            transcriptRef,
            outcomeState,
            source: "journal",
          };
        }
      }
      if (terminalMarker === undefined && input.readTranscriptTerminal !== undefined) {
        const marker = yield* Effect.tryPromise({
          try: () =>
            input.readTranscriptTerminal!({
              executionId: execution.executionId,
              attemptId: execution.attemptId,
              generation: execution.generation,
            }),
          catch: () => null,
        }).pipe(Effect.option);
        if (Option.isSome(marker) && marker.value != null) {
          const candidate = marker.value;
          // T10-AC2 identity+generation match: a marker for a different
          // attempt/generation is stale and restores nothing.
          if (
            candidate.executionId === execution.executionId &&
            candidate.attemptId === execution.attemptId &&
            candidate.generation === execution.generation &&
            (candidate.state === "succeeded" || candidate.state === "failed")
          ) {
            terminalMarker = {
              state: candidate.state,
              summary: candidate.summary,
              transcriptRef: candidate.transcriptRef ?? null,
              outcomeState: candidate.outcomeState ?? null,
              source: "transcript_marker",
            };
          }
        }
      }

      if (terminalMarker !== undefined) {
        const restore = yield* restoreTerminalOutcome(
          input,
          execution,
          terminalMarker,
          new Date(now()).toISOString(),
        );
        if (restore.kind === "failed") {
          failures.push({
            executionId: execution.executionId,
            error: "terminal restoration write failed",
          });
          continue;
        }
        outcomes.push(restore);
        continue;
      }

      // Evidence 3 — NEITHER: owner-loss reconciliation (T10-AC1/AC7).
      // Restart mode settles immediately (process death is owner-loss
      // proof). Lease-expiry mode requires the re-derived lease to have
      // been expired beyond the configured orphan threshold; otherwise the
      // execution is reported as not-yet-orphanable and stays untouched
      // (it must not remain running forever — the sweep re-enters this
      // path as the lease ages past the threshold).
      if (input.mode === "lease_expiry") {
        const observationResult = yield* Effect.result(
          input.repository.getObservation(execution.executionId),
        );
        let lastHeartbeatAt: string | null = null;
        if (observationResult._tag === "Success") {
          const observationOpt = observationResult.success;
          if (Option.isSome(observationOpt)) {
            lastHeartbeatAt = observationOpt.value.lastHeartbeatAt ?? null;
          }
        }
        if (!isLeaseExpiredBeyond(lastHeartbeatAt, leaseDurationMs, now(), orphanAfterMs)) {
          outcomes.push({
            kind: "lease_not_expired",
            executionId: execution.executionId,
            attemptId: execution.attemptId,
            generation: execution.generation,
          });
          continue;
        }
      }

      const nowIso = new Date(now()).toISOString();
      const settle = yield* Effect.result(
        input.repository.recordOrphanedEvent({
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: execution.generation,
          occurredAt: nowIso,
          diagnosticCode: PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_CODE,
          diagnosticMessage: PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE,
        }),
      );
      if (settle._tag === "Failure") {
        const cause = settle.failure;
        const message = cause instanceof Error ? cause.message : String(cause);
        failures.push({ executionId: execution.executionId, error: message });
        input.onDiagnostic?.({
          executionId: execution.executionId,
          diagnosticCode: "pi_subagent_restart_reconciliation_failed",
          diagnosticMessage: `Owner-loss settlement failed: ${message}`,
        });
        continue;
      }
      const settled = settle.success;
      if (settled.kind === "stale_generation") {
        // A concurrent resume owns a newer attempt: reconciliation must not
        // fence it. The newer attempt reconciles on a later pass.
        outcomes.push({
          kind: "already_terminal",
          executionId: execution.executionId,
          observedState: settled.execution.observedState,
        });
        continue;
      }
      if (settled.kind === "already_applied" && settled.execution.observedState === "orphaned") {
        // Idempotent re-reconciliation: the SAME attempt/generation already
        // settled as orphaned and its fence (generation advance) stands —
        // report the already-fenced generation, never advance again.
        outcomes.push({
          kind: "orphaned",
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: settled.execution.generation,
          diagnosticCode: PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_CODE,
        });
        continue;
      }
      if (
        settled.kind === "already_applied" &&
        isTerminalPiSubagentState(settled.execution.observedState)
      ) {
        outcomes.push({
          kind: "already_terminal",
          executionId: execution.executionId,
          observedState: settled.execution.observedState,
        });
        continue;
      }
      outcomes.push({
        kind: "orphaned",
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation + 1,
        diagnosticCode: PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_CODE,
      });
      input.onDiagnostic?.({
        executionId: execution.executionId,
        diagnosticCode: PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_CODE,
        diagnosticMessage: PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE,
      });
    }

    return { outcomes, failures };
  });
