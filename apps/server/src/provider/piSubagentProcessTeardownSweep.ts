import type { PiSubagentDiagnosticCode } from "@synara/contracts";

import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  runPiSubagentProcessTeardown,
  type PiSubagentOwnedTeardownDispatchResult,
} from "./piSubagentProcessTeardown.ts";

/**
 * Ticket 16 — Owned process-tree teardown sweep driver.
 *
 * One adapter-lifetime periodic timer drives `runPiSubagentProcessTeardown`
 * over durable execution truth (the ticket 15 teardown-handoff set). The
 * coordinator owns all teardown semantics (journal-first request/outcome,
 * owned-supervisor-only dispatch, proof-before-fence settlement); this
 * driver only schedules passes and resolves the owned supervisor per parent
 * thread from the adapter's session map.
 *
 * Sweep failures are swallowed — a failing pass retries on the next
 * interval. The driver never settles projection itself and never treats a
 * kill API return as proof (T16-AC3).
 */

export interface PiSubagentProcessTeardownSweepOptions {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /**
   * Resolves the owned supervisor teardown for one execution's parent
   * thread (T16-AC1). `undefined` = no live owned supervisor → no kill,
   * honest `owner_unproven` outcome.
   */
  readonly resolveOwnedTeardown: (execution: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
  }) => Promise<PiSubagentOwnedTeardownDispatchResult | undefined>;
  /** Injectable clock (epoch ms) for deterministic tests. */
  readonly now?: () => number;
  /** Cap on executions per pass (default 64, T16-AC7). */
  readonly maxPerPass?: number | undefined;
  /**
   * Safe operator observation for stable diagnostics (fixed vocabulary
   * only). Wired by the adapter to offer runtime warnings, so teardown
   * outcomes reach a durable operator surface.
   */
  readonly onDiagnostic?:
    | ((event: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly generation: number;
        readonly parentThreadId: string;
        readonly diagnosticCode: PiSubagentDiagnosticCode;
        readonly diagnosticMessage: string;
      }) => void)
    | undefined;
  /**
   * Safe operator observation for pass outcomes (fixed correlation
   * metadata only — never prompt, result, or transcript content). The
   * diagnostic code is derived from the outcome kind so the operator log
   * never asserts a proof that did not happen.
   */
  readonly onOutcome?: (outcome: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
    readonly outcomeKind: string;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
  }) => void;
}

export interface PiSubagentProcessTeardownSweepResult {
  readonly processed: number;
}

export const sweepPiSubagentProcessTeardown = async (
  options: PiSubagentProcessTeardownSweepOptions,
): Promise<PiSubagentProcessTeardownSweepResult> => {
  const result = await runPiSubagentProcessTeardown({
    repository: options.repository,
    dispatchOwnedTeardown: options.resolveOwnedTeardown,
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxPerPass !== undefined ? { maxPerPass: options.maxPerPass } : {}),
    onDiagnostic: options.onDiagnostic,
  });

  for (const outcome of result.outcomes) {
    options.onOutcome?.({
      executionId: outcome.executionId,
      attemptId: outcome.attemptId,
      generation: outcome.generation,
      parentThreadId: outcome.parentThreadId,
      outcomeKind: outcome.outcome.kind,
      // Truthful per-outcome operator vocabulary (review remediation):
      // survivors/owner_unproven must never log under the proven literal.
      diagnosticCode:
        outcome.outcome.kind === "settled_proven"
          ? "pi_subagent_teardown_proven"
          : outcome.outcome.kind === "survivors"
            ? "pi_subagent_teardown_survivors"
            : outcome.outcome.kind === "owner_unproven"
              ? "pi_subagent_teardown_owner_unproven"
              : "pi_subagent_lifecycle_persistence_failed",
    });
  }
  return { processed: result.outcomes.length };
};

export interface PiSubagentProcessTeardownSweepTimer {
  /** Stops the periodic sweep. Idempotent. */
  readonly stop: () => void;
}

/**
 * Starts the adapter-lifetime periodic teardown sweep. Production interval
 * is 30 seconds (matching the watchdog cadence so a teardown handoff is
 * picked up on the next pass); tests inject `schedule` for deterministic
 * passes.
 */
export const startPiSubagentProcessTeardownSweep = (
  options: PiSubagentProcessTeardownSweepOptions & {
    readonly intervalMs?: number;
    readonly schedule?: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
  },
): PiSubagentProcessTeardownSweepTimer => {
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
        await sweepPiSubagentProcessTeardown(options);
      } catch {
        // Swallowed by construction: a teardown pass must never reject into
        // the timer loop (retry on the next interval).
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
