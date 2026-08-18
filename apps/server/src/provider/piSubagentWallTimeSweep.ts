/**
 * Ticket 13 wall-time expiry sweep (T13-AC3).
 *
 * Adapter-lifetime periodic sweep over durable non-terminal executions:
 * evaluates the configured wall-time budget (pure policy) and journals the
 * band-60 durable escalation trigger for every expired execution. The sweep
 * NEVER settles projection and NEVER dispatches control (abort/interrupt):
 * ticket 15's watchdog stages own escalation. Sweep failures are swallowed —
 * a failing sweep retries on the next interval; expiry is observation, not
 * control truth, and must not degrade control health.
 *
 * Operator visibility: a fixed-vocabulary runtime warning is offered once per
 * recorded trigger (executionId, attemptId, generation, diagnosticCode,
 * wallTimeMs — safe correlation fields only, T13-AC5).
 */

import { Effect } from "effect";

import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { selectWallTimeExpiries } from "./piSubagentWallTimePolicy.ts";

export interface PiSubagentWallTimeSweepOptions {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /** Resolved per-execution wall-time budget in milliseconds. */
  readonly wallTimeMs: number;
  /** Server wall clock in epoch milliseconds (injected for tests). */
  readonly nowMs?: () => number;
  /**
   * Safe operator observation for recorded triggers. Receives fixed
   * correlation metadata only — never prompt, result, or transcript content.
   */
  readonly onExpiryRecorded?: (trigger: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
    readonly diagnosticCode: "pi_subagent_walltime_expired";
    readonly wallTimeMs: number;
  }) => void;
}

export interface PiSubagentWallTimeSweepResult {
  /** Newly journaled triggers this sweep. */
  readonly recorded: number;
  /** Already-applied or stale re-observations this sweep skipped. */
  readonly skipped: number;
}

export const sweepPiSubagentWallTimeExpiry = async (
  options: PiSubagentWallTimeSweepOptions,
): Promise<PiSubagentWallTimeSweepResult> => {
  const nowMs = options.nowMs ?? (() => Date.now());
  const executions = await Effect.runPromise(
    Effect.result(options.repository.listNonTerminalExecutions()),
  );
  if (executions._tag === "Failure") {
    // Repository unavailable: retry on the next interval; never throw into
    // the timer loop.
    return { recorded: 0, skipped: 0 };
  }

  const { candidates } = selectWallTimeExpiries(executions.success, {
    wallTimeMs: options.wallTimeMs,
    nowMs: nowMs(),
  });

  let recorded = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const result = await Effect.runPromise(
      Effect.result(
        options.repository.recordWallTimeExpiryEvent({
          executionId: candidate.executionId,
          attemptId: candidate.attemptId,
          generation: candidate.generation,
          occurredAt: new Date(nowMs()).toISOString(),
          wallTimeMs: options.wallTimeMs,
        }),
      ),
    );
    if (result._tag === "Failure") {
      skipped += 1;
      continue;
    }
    if (result.success.kind === "recorded") {
      recorded += 1;
      options.onExpiryRecorded?.({
        executionId: candidate.executionId,
        attemptId: candidate.attemptId,
        generation: candidate.generation,
        parentThreadId: candidate.parentThreadId,
        diagnosticCode: "pi_subagent_walltime_expired",
        wallTimeMs: options.wallTimeMs,
      });
    } else {
      skipped += 1;
    }
  }
  return { recorded, skipped };
};

export interface PiSubagentWallTimeSweepTimer {
  /** Stops the periodic sweep. Idempotent. */
  readonly stop: () => void;
}

/**
 * Starts the adapter-lifetime periodic wall-time sweep. Production interval
 * is 30 seconds (well below the 60-second minimum budget); tests inject
 * `schedule` for deterministic sweeps.
 */
export const startPiSubagentWallTimeSweep = (
  options: PiSubagentWallTimeSweepOptions & {
    readonly intervalMs?: number;
    readonly schedule?: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
  },
): PiSubagentWallTimeSweepTimer => {
  const intervalMs =
    typeof options.intervalMs === "number" &&
    Number.isFinite(options.intervalMs) &&
    options.intervalMs > 0
      ? options.intervalMs
      : 30000;
  const schedule =
    options.schedule ??
    ((delayMs: number, callback: () => void) => {
      const timer = setTimeout(callback, Math.max(0, delayMs));
      timer.unref?.();
      return { cancel: () => clearTimeout(timer) };
    });

  let stopped = false;
  let handle: { readonly cancel: () => void } | undefined;
  let sweepInFlight: Promise<void> | undefined;

  const tick = (): void => {
    if (stopped) {
      return;
    }
    sweepInFlight = (async () => {
      try {
        await sweepPiSubagentWallTimeExpiry(options);
      } catch {
        // Swallowed by construction: expiry observation must never reject
        // into the timer loop.
      } finally {
        if (!stopped) {
          handle = schedule(intervalMs, tick);
        }
      }
    })();
  };

  handle = schedule(intervalMs, tick);
  return {
    stop: () => {
      stopped = true;
      handle?.cancel();
      void sweepInFlight?.catch(() => undefined);
    },
  };
};
