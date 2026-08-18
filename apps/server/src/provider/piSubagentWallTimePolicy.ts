/**
 * Ticket 13 wall-time budget policy (T13-AC3).
 *
 * Pure evaluation of the per-execution wall-time budget over durable
 * repository truth. Expiry NEVER settles the projection and never dispatches
 * control: it selects executions whose trigger must be journaled (band 60,
 * `pi_subagent_walltime_expired`) so ticket 15's watchdog stages can consume
 * the durable escalation trigger later.
 *
 * Clock and budget are injected for deterministic tests. The budget is
 * derived server-side from the resolved config knob (default two hours);
 * producer-supplied timestamps are never trusted for the decision itself —
 * the aggregate's own `updatedAt`/`createdAt` durable truth is used.
 */

import type { PiSubagentExecutionRecord } from "@synara/contracts";

export interface WallTimeExpiryCandidate {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
  /** Aggregate durable timestamp the budget is measured from. */
  readonly admittedAt: string;
}

export interface WallTimeExpirySelection {
  readonly candidates: ReadonlyArray<WallTimeExpiryCandidate>;
}

interface WallTimeExecutionRecord {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
  readonly observedState: PiSubagentExecutionRecord["observedState"];
  readonly createdAt: string;
}

const NON_TERMINAL_STATES: ReadonlySet<string> = new Set([
  "requested",
  "accepted",
  "queued",
  "running",
  "cancelling",
  "orphaned",
]);

/**
 * Selects non-terminal executions whose wall-time budget has elapsed.
 *
 * The budget is measured from the execution's durable `createdAt` (admission
 * truth). `wallTimeMs` must be a positive finite integer; anything else
 * yields an empty selection (fail-safe: no invalid budget can trigger
 * escalations — T13-AC7).
 */
export function selectWallTimeExpiries(
  executions: ReadonlyArray<WallTimeExecutionRecord>,
  options: {
    readonly wallTimeMs: number;
    readonly nowMs: number;
  },
): WallTimeExpirySelection {
  const { wallTimeMs, nowMs } = options;
  if (
    typeof wallTimeMs !== "number" ||
    !Number.isFinite(wallTimeMs) ||
    !Number.isInteger(wallTimeMs) ||
    wallTimeMs <= 0 ||
    typeof nowMs !== "number" ||
    !Number.isFinite(nowMs)
  ) {
    return { candidates: [] };
  }

  const candidates: WallTimeExpiryCandidate[] = [];
  for (const execution of executions) {
    if (!NON_TERMINAL_STATES.has(execution.observedState)) {
      continue;
    }
    const createdAtMs = Date.parse(execution.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      continue;
    }
    if (nowMs - createdAtMs >= wallTimeMs) {
      candidates.push({
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation,
        parentThreadId: execution.parentThreadId,
        admittedAt: execution.createdAt,
      });
    }
  }
  return { candidates };
}
