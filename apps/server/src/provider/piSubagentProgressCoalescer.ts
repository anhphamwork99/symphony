/**
 * Per-execution server-side progress coalescer (Ticket 23 / WP-B).
 *
 * The managed Alfie extension reports progress observations to the Symphony
 * server at producer-coalesced cadence. The server still has to protect its
 * own runtime-event stream and durable store from any misbehaving producer,
 * so every progress observation is funneled through one coalescer per
 * execution before it is ever offered to the runtime-event queue or the
 * repository: a single latest-snapshot slot plus a trailing-edge flush timer
 * at `1 / rateHz`.
 *
 * While a slot is pending, newer `progressJson` payloads REPLACE the slot
 * (trailing-edge latest snapshot) and increment a coalesced counter that is
 * handed to the repository as `droppedCountDelta` on flush — the durable
 * `dropped_progress_count` column stays an exact accounting of producer
 * progress that never reached the emission surface.
 *
 * Lifecycle kinds (started/detached) never pass through this queue: the
 * caller dispatches those on the non-coalescing journal path (ticket 22).
 *
 * Bounded-state guarantees (T23-AC6):
 * - one slot + at most one flush timer + at most one idle timer per
 *   execution (one Map entry);
 * - `trackedExecutions()` / `pendingCount()` expose the structural bounds;
 * - `dispose(executionId)` awaits the in-flight flush (inline completion);
 * - an idle TTL of `max(leaseMs, 2 * heartbeatIntervalMs)` without progress
 *   removes the entry entirely, so detached executions whose tool call
 *   already returned release their timers and observation ownership.
 *
 * All failures are swallowed by construction: progress is observation, not
 * control — a failing flush sink must never reject back to the producer and
 * never degrade control health (only lifecycle kinds keep the ticket-22
 * degrade semantics, and those never enter this coalescer).
 */

export interface PiSubagentProgressFlush {
  readonly executionId: string;
  readonly progressJson: string;
  /** Progress observations coalesced into this flush (excluding the flushed one). */
  readonly coalescedCount: number;
  /** Opaque per-execution metadata supplied with the latest observation. */
  readonly meta: unknown;
}

export interface PiSubagentProgressCoalescerOptions {
  /** Server wall clock in epoch milliseconds (injected for deterministic tests). */
  readonly now: () => number;
  /**
   * Schedules a callback after `delayMs`. Returns a cancel handle so disposed
   * entries never fire (injected for deterministic fake-timer tests).
   */
  readonly schedule: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
  /** Trailing-edge flush sink: runtime-event emission + durable UPDATE. */
  readonly onFlush: (flush: PiSubagentProgressFlush) => Promise<void> | void;
  /** Flush interval derived from the resolved server config rate (1/rateHz). */
  readonly flushIntervalMs: number;
  /** Idle TTL: max(leaseMs, 2 * heartbeat interval) from resolved server config. */
  readonly idleTtlMs: number;
}

export interface PiSubagentProgressCoalescerStats {
  readonly trackedExecutions: number;
  readonly pendingCount: number;
  readonly totalEmitted: number;
  readonly totalCoalesced: number;
}

export interface PiSubagentProgressCoalescer {
  /**
   * Records a progress observation. Resolves when the observation is accepted
   * into the coalescer (not when it is flushed); a pending slot with a
   * running flush timer guarantees an eventual flush. `meta` is carried on
   * the eventual flush (latest observation wins) for caller correlation —
   * e.g. the parent tool call id — without growing per-observation state.
   */
  readonly recordProgress: (
    executionId: string,
    progressJson: string,
    meta?: unknown,
  ) => Promise<void>;
  /** True while an unflushed progress slot is pending for the execution. */
  readonly hasPending: (executionId: string) => boolean;
  /** Number of tracked executions (structural bound: one entry per execution). */
  readonly trackedExecutions: () => number;
  /** Sum of pending slots across executions (each execution holds at most 1). */
  readonly pendingCount: () => number;
  readonly stats: () => PiSubagentProgressCoalescerStats;
  /**
   * Inline-completion disposal: cancels the idle timer, flushes any snapshot
   * still pending, then removes the entry. Idempotent. The awaited flush
   * failure is swallowed.
   */
  readonly dispose: (executionId: string) => Promise<void>;
  /** Cancels every timer, flushes pending snapshots, removes all entries. */
  readonly disposeAll: () => Promise<void>;
}

interface CoalescerEntry {
  pendingJson: string | undefined;
  pendingMeta: unknown;
  pendingSince: number;
  coalescedSinceFlush: number;
  totalEmitted: number;
  totalCoalesced: number;
  flushTimer: { readonly cancel: () => void } | undefined;
  flushInFlight: Promise<void> | undefined;
  idleTimer: { readonly cancel: () => void } | undefined;
  disposed: boolean;
}

const noopCancel = (): void => {};

const makeRealSchedule =
  () =>
  (delayMs: number, callback: () => void): { readonly cancel: () => void } => {
    const timer = setTimeout(callback, Math.max(0, delayMs));
    return { cancel: () => clearTimeout(timer) };
  };

/**
 * Builds a per-execution trailing-edge progress coalescer.
 */
export function makePiSubagentProgressCoalescer(
  options: PiSubagentProgressCoalescerOptions,
): PiSubagentProgressCoalescer {
  const now = options.now;
  const schedule = options.schedule;
  const onFlush = options.onFlush;
  const flushIntervalMs = Math.max(0, options.flushIntervalMs);
  const idleTtlMs = Math.max(0, options.idleTtlMs);

  const entries = new Map<string, CoalescerEntry>();
  let totalEmitted = 0;
  let totalCoalesced = 0;

  const makeEntry = (): CoalescerEntry => ({
    pendingJson: undefined,
    pendingMeta: undefined,
    pendingSince: 0,
    coalescedSinceFlush: 0,
    totalEmitted: 0,
    totalCoalesced: 0,
    flushTimer: undefined,
    flushInFlight: undefined,
    idleTimer: undefined,
    disposed: false,
  });

  const runFlush = (executionId: string, entry: CoalescerEntry): Promise<void> => {
    const payload = entry.pendingJson;
    const meta = entry.pendingMeta;
    entry.pendingJson = undefined;
    entry.pendingMeta = undefined;
    entry.flushTimer = undefined;
    if (payload === undefined) {
      entry.flushInFlight = undefined;
      return Promise.resolve();
    }
    const coalesced = entry.coalescedSinceFlush;
    entry.coalescedSinceFlush = 0;
    entry.totalEmitted += 1;
    totalEmitted += 1;
    entry.flushInFlight = (async () => {
      try {
        await onFlush({
          executionId,
          progressJson: payload,
          coalescedCount: coalesced,
          meta,
        });
      } catch {
        // Progress is observation, not control: flush failures are swallowed.
      }
    })();
    return entry.flushInFlight;
  };

  const scheduleIdleCleanup = (executionId: string, entry: CoalescerEntry): void => {
    entry.idleTimer?.cancel();
    entry.idleTimer = undefined;
    if (entry.disposed) return;
    entry.idleTimer = schedule(idleTtlMs, () => {
      // No progress for the idle TTL: release observation ownership. Any
      // still-pending snapshot would have been flushed by its own flush
      // timer long before this fires (flushInterval << idleTtl), and a
      // pending-but-unreachable snapshot is re-created by the next
      // observation anyway.
      entries.delete(executionId);
    });
  };

  const coalescer: PiSubagentProgressCoalescer = {
    recordProgress: async (executionId, progressJson, meta) => {
      if (
        typeof executionId !== "string" ||
        executionId.trim().length === 0 ||
        typeof progressJson !== "string"
      ) {
        return;
      }
      let entry = entries.get(executionId);
      if (entry === undefined) {
        entry = makeEntry();
        entries.set(executionId, entry);
      } else {
        entry.idleTimer?.cancel();
        entry.idleTimer = undefined;
      }
      entry.disposed = false;

      if (entry.pendingJson !== undefined) {
        // Trailing edge: the newer snapshot replaces the pending one and is
        // accounted as coalesced (dropped) progress.
        entry.pendingJson = progressJson;
        entry.pendingMeta = meta;
        entry.coalescedSinceFlush += 1;
        entry.totalCoalesced += 1;
        totalCoalesced += 1;
        return;
      }

      entry.pendingJson = progressJson;
      entry.pendingMeta = meta;
      entry.pendingSince = now();
      entry.flushTimer = schedule(flushIntervalMs, () => {
        entry!.flushTimer = undefined;
        const current = entries.get(executionId);
        if (current === undefined || current.disposed) return;
        void runFlush(executionId, current).then(() => {
          const after = entries.get(executionId);
          if (after === undefined || after.disposed) return;
          // Restart the idle window so detached executions self-release once
          // their producer stops reporting progress.
          scheduleIdleCleanup(executionId, after);
        });
      });
    },

    hasPending: (executionId) => {
      const entry = entries.get(executionId);
      return entry !== undefined && entry.pendingJson !== undefined;
    },

    trackedExecutions: () => entries.size,

    pendingCount: () => {
      let pending = 0;
      for (const entry of entries.values()) {
        if (entry.pendingJson !== undefined) pending += 1;
      }
      return pending;
    },

    stats: () => ({
      trackedExecutions: entries.size,
      pendingCount: coalescer.pendingCount(),
      totalEmitted,
      totalCoalesced,
    }),

    dispose: async (executionId) => {
      const entry = entries.get(executionId);
      if (entry === undefined) return;
      entry.idleTimer?.cancel();
      entry.idleTimer = undefined;
      const flushTimer = entry.flushTimer;
      entry.flushTimer = undefined;
      entry.disposed = true;
      flushTimer?.cancel();
      entries.delete(executionId);
      // A pending snapshot whose flush timer was cancelled by this disposal
      // still emits once (latest observation is never lost on inline
      // completion); an already in-flight flush is awaited.
      const inFlight = entry.flushInFlight;
      const pendingFlush =
        entry.pendingJson !== undefined ? runFlush(executionId, entry) : undefined;
      await Promise.allSettled(
        [inFlight, pendingFlush].filter((p): p is Promise<void> => p !== undefined),
      );
    },

    disposeAll: async () => {
      const pending: Array<Promise<void>> = [];
      for (const [executionId, entry] of [...entries]) {
        entry.idleTimer?.cancel();
        entry.idleTimer = undefined;
        const flushTimer = entry.flushTimer;
        entry.flushTimer = undefined;
        entry.disposed = true;
        flushTimer?.cancel();
        entries.delete(executionId);
        if (entry.flushInFlight !== undefined) {
          pending.push(entry.flushInFlight);
        }
        if (entry.pendingJson !== undefined) {
          pending.push(runFlush(executionId, entry));
        }
      }
      await Promise.allSettled(pending);
    },
  };

  return coalescer;
}

export const makeDefaultPiSubagentProgressSchedule = makeRealSchedule;
