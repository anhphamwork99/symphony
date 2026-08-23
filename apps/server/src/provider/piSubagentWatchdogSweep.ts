import type { PiSubagentDiagnosticCode } from "@synara/contracts";

import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { runPiSubagentWatchdogEscalation } from "./piSubagentWatchdogEscalation.ts";
import type { PiSubagentExtensionBridge } from "./piSubagentBridge.ts";

/**
 * Ticket 15 — Watchdog escalation sweep driver (the production consumer of
 * the ticket 13 band-60 wall-time triggers and the production lease-expiry
 * sweep driver Ticket 10 recorded as Ticket 15 scope).
 *
 * One adapter-lifetime periodic timer drives `runPiSubagentWatchdogEscalation`
 * over durable execution truth. The coordinator owns all escalation
 * semantics (journal-first stage records, evidence settlement, honest
 * cancelling projection); this driver only schedules passes and resolves the
 * live-session controls (bridge, provider-turn interrupt, provider-session
 * stop) from the adapter's session map.
 *
 * Sweep failures are swallowed — a failing pass retries on the next
 * interval. The driver NEVER settles projection itself and never treats a
 * timer as termination proof (T15-AC5).
 */

export interface PiSubagentWatchdogSweepOptions {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /** Live-bridge resolver per parent thread (undefined = no live session). */
  readonly resolveBridge: (threadId: string) => PiSubagentExtensionBridge | undefined;
  /** Provider-turn interrupt control (stage 2). */
  readonly interruptProviderTurn: (threadId: string) => Promise<void>;
  /** Provider-session stop control (stage 3). */
  readonly stopProviderSession: (threadId: string) => Promise<"stopped" | "uncertain">;
  /** Owner-death probe from server-tracked session truth. */
  readonly isOwnerGenerationDead: () => boolean;
  /** Per-stage evidence wait bound (config knob). */
  readonly stageTimeoutMs?: number | undefined;
  /** Bounded retry limit forwarded to the ticket 06 cancel protocol. */
  readonly cancelRetryLimit?: number | undefined;
  /** Lease duration for the server-side lease re-derivation. */
  readonly leaseDurationMs?: number | undefined;
  /** Idle threshold: re-derived lease expired this long with no heartbeat. */
  readonly idleAfterMs?: number | undefined;
  /** Injectable clock (epoch ms) for deterministic tests. */
  readonly now?: () => number;
  /**
   * Safe operator observation for stable diagnostics (fixed vocabulary
   * only). Wired by the adapter to offer runtime warnings, so the AC1
   * entry diagnostics reach a durable operator surface.
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
   * Safe operator observation for escalation outcomes (fixed correlation
   * metadata only — never prompt, result, or transcript content).
   */
  readonly onEscalation?: (escalation: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
    readonly trigger: "wall_time" | "idle";
    readonly outcomeKind: string;
  }) => void;
}

export interface PiSubagentWatchdogSweepResult {
  readonly escalated: number;
}

export const sweepPiSubagentWatchdogEscalation = async (
  options: PiSubagentWatchdogSweepOptions,
): Promise<PiSubagentWatchdogSweepResult> => {
  // The bridge is resolved PER PARENT THREAD from live session truth; a
  // thread whose session died between listing and dispatch simply dispatches
  // through the owner-death evidence path inside the ticket 06 protocol.
  const result = await runPiSubagentWatchdogEscalation({
    repository: options.repository,
    resolveBridge: options.resolveBridge,
    isOwnerGenerationDead: options.isOwnerGenerationDead,
    listActive: (threadId) => {
      const bridge = options.resolveBridge(threadId);
      return typeof bridge?.getActiveExecutions === "function"
        ? bridge.getActiveExecutions()
        : undefined;
    },
    interruptProviderTurn: options.interruptProviderTurn,
    stopProviderSession: options.stopProviderSession,
    stageTimeoutMs: options.stageTimeoutMs,
    cancelRetryLimit: options.cancelRetryLimit,
    leaseDurationMs: options.leaseDurationMs,
    idleAfterMs: options.idleAfterMs,
    ...(options.now ? { now: options.now } : {}),
    onDiagnostic: options.onDiagnostic,
  });

  for (const escalation of result.escalations) {
    options.onEscalation?.({
      executionId: escalation.executionId,
      attemptId: escalation.attemptId,
      generation: escalation.generation,
      parentThreadId: escalation.parentThreadId,
      trigger: escalation.trigger,
      outcomeKind: escalation.outcome.kind,
    });
  }
  return { escalated: result.escalations.length };
};

export interface PiSubagentWatchdogSweepTimer {
  /** Stops the periodic sweep. Idempotent. */
  readonly stop: () => void;
}

/**
 * Starts the adapter-lifetime periodic watchdog escalation sweep. Production
 * interval is 30 seconds (matching the wall-time trigger cadence); tests
 * inject `schedule` for deterministic passes.
 */
export const startPiSubagentWatchdogSweep = (
  options: PiSubagentWatchdogSweepOptions & {
    readonly intervalMs?: number;
    readonly schedule?: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
  },
): PiSubagentWatchdogSweepTimer => {
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
        await sweepPiSubagentWatchdogEscalation(options);
      } catch {
        // Swallowed by construction: an escalation pass must never reject
        // into the timer loop (retry on the next interval).
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
