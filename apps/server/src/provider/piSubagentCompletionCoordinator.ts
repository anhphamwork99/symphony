import type { PiSubagentDiagnosticCode } from "@synara/contracts";
import { Effect, Option } from "effect";

import type {
  PiSubagentCompletionOutboxEntry,
  PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT } from "../config.ts";

/**
 * Ticket 09 — Per-thread completion coordinator.
 *
 * Completion delivery is coordinated PER PARENT THREAD on top of the Ticket 08
 * durable outbox (spec Implementation Decisions 23 and 24, Decision 0013 F3):
 *
 * 1. Production pump (T09 wiring obligation, Decision 0013 F3): this
 *    coordinator IS the production consumer of the outbox. It consumes the
 *    `piSubagentCompletionRetryLimit` policy through the same repository
 *    scan the Ticket 08 pump uses (`listRecoverableCompletionOutbox`), now
 *    filtered per parent thread.
 * 2. Bounded per-thread batching (T09-AC1): near-simultaneous completions
 *    for one thread inside `batchWindowMs` coalesce into ONE follow-up
 *    carrying bounded summaries and execution identities. The batch is
 *    capped (`maxBatchEntries`) so one follow-up stays bounded no matter
 *    how large the burst is; overflow joins the NEXT batch.
 * 3. At most one outstanding follow-up per thread (T09-AC2): while a
 *    thread's current batch is dispatched-but-unacknowledged, later bursts
 *    wait and join a later batch. Delivery state (`delivered` /
 *    `acknowledged`) is the durable one-outstanding ledger; the in-memory
 *    registry is only a cache of it.
 * 4. Safe parent boundary (T09-AC3): a follow-up is dispatched ONLY when
 *    the parent has no active turn. A busy parent defers the batch — the
 *    coordinator never interrupts current reasoning or tool work. When the
 *    parent turn settles (`onParentTurnSettled`), the deferred batch
 *    retries the boundary check. User-read state is structurally not an
 *    input of this coordinator — it can never be a delivery gate.
 * 5. Journal-first dispatch (T09-AC4, Decision 0013 F4): entries are marked
 *    `delivered` BEFORE the parent effect is dispatched. A dispatch failure
 *    returns them to `failed_retryable` (bounded by the retry policy) with
 *    a stable diagnostic; the execution outcome is NEVER rewritten. The
 *    stable outbox identity travels with every follow-up entry as the
 *    parent-effect dedupe key, so at-least-once redelivery can never create
 *    duplicate parent content. A follow-up turn that FAILS BEFORE RUNNING
 *    (prompt rejection) produced no parent content, so its entries safely
 *    return to retryable delivery (`notifyFollowUpSettled` with outcome
 *    `"failed"`); a follow-up turn that RAN is acknowledged — its content
 *    was seen and must never be re-sent.
 * 6. Supersede (T09-AC6): stale attempt/generation entries are fenced by
 *    the repository transitions (`markCompletionDelivered` /
 *    `markCompletionSuperseded` re-check the fence inside the transaction)
 *    and produce NO follow-up effect; their execution evidence remains
 *    retrievable by identity.
 *
 * Legacy sessions (extension without `completion-delivery-ownership`) never
 * reach this coordinator — the adapter dispositions their entries at
 * terminal-persist time (the legacy nudge path owns delivery there).
 */

/** Default retry budget when no config value is supplied (Ticket 08 knob). */
export const DEFAULT_COMPLETION_COORDINATOR_RETRY_LIMIT =
  DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;

/** Default per-follow-up entry cap keeps ONE follow-up bounded under any burst. */
export const DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES = 8;

/** Per-thread scheduler contract (virtual-clock injectable for tests). */
export interface CompletionCoordinatorScheduler {
  readonly now: () => number;
  readonly schedule: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
}

/** One bounded follow-up entry — the parent-effect dedupe key travels with it. */
export interface PiSubagentCompletionCoordinatorFollowUpEntry {
  /** Stable outbox identity — the parent-effect dedupe key (Decision 0013 F4). */
  readonly dedupeId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly terminalState: "succeeded" | "failed";
  /** Bounded summary excerpt — never unbounded raw output. */
  readonly summary: string;
  readonly transcriptRef: string | null;
}

export interface PiSubagentCompletionCoordinatorInput {
  /** Live repository — may be a lazy getter bound inside an Effect scope. */
  readonly repository: PiSubagentExecutionRepositoryShape;
  /** Batching window in milliseconds; 0 flushes immediately (T09-AC1). */
  readonly batchWindowMs?: number;
  /** Ticket 08 retry policy — consumed from the resolved server config. */
  readonly retryLimit?: number | undefined;
  /** Per-follow-up bounded entry cap; overflow joins the NEXT batch. */
  readonly maxBatchEntries?: number | undefined;
  readonly scheduler?: CompletionCoordinatorScheduler | undefined;
  readonly now?: (() => number) | undefined;
  readonly schedule?: CompletionCoordinatorScheduler["schedule"] | undefined;
  /**
   * T09-AC3 parent-turn boundary: `true` while the parent thread has an
   * active turn. The ONLY delivery gate — user-read state is never an
   * input here.
   */
  readonly isParentBusy: (parentThreadId: string) => boolean;
  /**
   * The parent follow-up boundary: dispatches ONE bounded follow-up turn
   * for the batch. Must resolve `{ accepted: true }` only after the
   * follow-up turn was actually started; a synchronous dispatch failure
   * returns `{ accepted: false }` and the batch stays retryable.
   */
  readonly sendFollowUp: (
    parentThreadId: string,
    entries: readonly PiSubagentCompletionCoordinatorFollowUpEntry[],
  ) => Promise<{ accepted: boolean; error?: string }>;
  readonly onDiagnostic?: (event: {
    readonly parentThreadId: string;
    readonly executionId?: string | undefined;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}

type ThreadState = {
  readonly parentThreadId: string;
  /** Flush timer for the open batching window, when one is open. */
  windowTimer: { readonly cancel: () => void } | undefined;
  /**
   * Entries of the CURRENT dispatched-but-unacknowledged follow-up
   * (T09-AC2 one-outstanding ledger, in-memory cache of durable state).
   */
  outstanding: ReadonlyArray<PiSubagentCompletionCoordinatorFollowUpEntry>;
  /** True while a deferral wait is parked on the busy parent boundary. */
  parkedForParentBoundary: boolean;
};

export interface PiSubagentCompletionCoordinator {
  /** Post-commit trigger: a durable pending completion exists for the thread. */
  readonly onCompletionPending: (event: { readonly parentThreadId: string }) => void;
  /**
   * T09-AC3 busy-then-idle release: the parent turn settled; retry the
   * deferred batch at the now-safe boundary.
   */
  readonly onParentTurnSettled: (parentThreadId: string) => void;
  /**
   * The dispatched follow-up turn settled. `"completed"` (or any outcome of
   * a turn that RAN) acknowledges the batch; `"failed"` means the turn was
   * rejected BEFORE running — no parent content was shown, so the batch
   * returns to retryable delivery.
   */
  readonly notifyFollowUpSettled: (event: {
    readonly parentThreadId: string;
    readonly outcome: "completed" | "failed";
  }) => void;
  /** Test/diagnostics support: resolves when no dispatch work is in flight. */
  readonly waitForIdle: () => Promise<void>;
  /** Inspection: threads with an outstanding (unacknowledged) follow-up. */
  readonly outstandingThreads: () => ReadonlyArray<{ parentThreadId: string; entries: number }>;
}

const toEntry = (
  entry: PiSubagentCompletionOutboxEntry,
): PiSubagentCompletionCoordinatorFollowUpEntry => ({
  dedupeId: entry.outboxId,
  executionId: entry.executionId,
  attemptId: entry.attemptId,
  generation: entry.generation,
  terminalState: entry.terminalState,
  summary: entry.summary,
  transcriptRef: entry.transcriptRef ?? null,
});

export const makePiSubagentCompletionCoordinator = (
  input: PiSubagentCompletionCoordinatorInput,
): PiSubagentCompletionCoordinator => {
  const batchWindowMs =
    typeof input.batchWindowMs === "number" &&
    Number.isFinite(input.batchWindowMs) &&
    input.batchWindowMs >= 0
      ? Math.floor(input.batchWindowMs)
      : 0;
  const retryLimit =
    input.retryLimit !== undefined && Number.isInteger(input.retryLimit) && input.retryLimit >= 0
      ? input.retryLimit
      : DEFAULT_COMPLETION_COORDINATOR_RETRY_LIMIT;
  const maxBatchEntries =
    input.maxBatchEntries !== undefined &&
    Number.isInteger(input.maxBatchEntries) &&
    input.maxBatchEntries > 0
      ? input.maxBatchEntries
      : DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES;
  const now = input.scheduler?.now ?? input.now ?? (() => Date.now());
  const schedule = input.scheduler?.schedule ?? input.schedule ?? makeDefaultScheduler();

  const threads = new Map<string, ThreadState>();
  let idleResolvers: Array<() => void> = [];
  let inFlight = 0;

  const settleIdleWaiters = (): void => {
    if (inFlight > 0) {
      return;
    }
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  };

  const waitForIdle = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (inFlight === 0) {
        resolve();
        return;
      }
      idleResolvers.push(resolve);
    });

  const emit = (
    parentThreadId: string,
    executionId: string | undefined,
    diagnosticCode: PiSubagentDiagnosticCode,
    diagnosticMessage: string,
  ): void => {
    input.onDiagnostic?.({
      parentThreadId,
      ...(executionId !== undefined ? { executionId } : {}),
      diagnosticCode,
      diagnosticMessage,
    });
  };

  const stateFor = (parentThreadId: string): ThreadState => {
    const existing = threads.get(parentThreadId);
    if (existing !== undefined) {
      return existing;
    }
    const created: ThreadState = {
      parentThreadId,
      windowTimer: undefined,
      outstanding: [],
      parkedForParentBoundary: false,
    };
    threads.set(parentThreadId, created);
    return created;
  };

  /**
   * Delivery attempt for one thread (window elapsed, boundary reached, or
   * retry). Journal-first: entries transition to `delivered` BEFORE the
   * parent effect; a dispatch failure immediately returns them to
   * `failed_retryable` (T09-AC4). Stale entries are fenced by the
   * repository transaction and produce no effect (T09-AC6).
   */
  const deliverThread = (parentThreadId: string): void => {
    const state = stateFor(parentThreadId);
    if (state.outstanding.length > 0) {
      // T09-AC2: one outstanding follow-up per thread — later bursts wait.
      return;
    }
    inFlight += 1;
    void Effect.runPromise(
      Effect.gen(function* () {
        const scan = yield* Effect.result(
          input.repository.listRecoverableCompletionOutbox({ retryLimit, parentThreadId }),
        );
        if (scan._tag === "Failure") {
          emit(
            parentThreadId,
            undefined,
            "pi_subagent_completion_delivery_failed",
            "Completion batch scan failed for parent thread; retrying on next trigger",
          );
          return;
        }
        if (scan.success.length === 0) {
          return;
        }

        // T09-AC3 safe boundary FIRST: never interrupt an active parent
        // turn. Checking the boundary BEFORE any durable transition means a
        // deferral consumes no retry budget and writes no delivery state —
        // the batch stays exactly as it was (`pending` or
        // `failed_retryable`) and re-flushes when the boundary opens
        // (`onParentTurnSettled`) or on the next completion trigger.
        if (input.isParentBusy(parentThreadId)) {
          stateFor(parentThreadId).parkedForParentBoundary = true;
          return;
        }

        // Journal-first intent: mark every batch entry delivered BEFORE the
        // parent effect. The repository fences stale entries inside the
        // transaction (superseded entries never join a follow-up).
        const accepted: PiSubagentCompletionCoordinatorFollowUpEntry[] = [];
        for (const raw of scan.success) {
          if (accepted.length >= maxBatchEntries) {
            break;
          }
          const transition = yield* Effect.result(
            input.repository.markCompletionDelivered({
              outboxId: raw.outboxId,
              now: new Date(now()).toISOString(),
            }),
          );
          if (transition._tag === "Failure") {
            emit(
              parentThreadId,
              raw.executionId,
              "pi_subagent_completion_delivery_failed",
              `Durable delivered-transition failed for execution '${raw.executionId}'; it stays retryable`,
            );
            continue;
          }
          const result = transition.success;
          if (result.kind === "transitioned") {
            accepted.push(toEntry(result.entry));
            continue;
          }
          if (result.kind === "superseded_instead") {
            emit(
              parentThreadId,
              raw.executionId,
              "pi_subagent_completion_superseded",
              `Completion for execution '${raw.executionId}' superseded by generation ${result.entry.generation}; no follow-up effect`,
            );
            continue;
          }
          // invalid_transition / not_found — settled elsewhere; skip.
        }

        if (accepted.length === 0) {
          // Overflow beyond the cap, or every entry fenced/failed: if any
          // entries remain recoverable, run the next batch immediately.
          const remaining = yield* Effect.result(
            input.repository.listRecoverableCompletionOutbox({ retryLimit, parentThreadId }),
          );
          if (remaining._tag === "Success" && remaining.success.length > 0) {
            schedule(0, () => deliverThread(parentThreadId));
          }
          return;
        }

        stateFor(parentThreadId).outstanding = accepted;
        const dispatch = yield* Effect.tryPromise({
          try: () => input.sendFollowUp(parentThreadId, accepted),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(Effect.result);

        if (dispatch._tag === "Failure" || !dispatch.success.accepted) {
          // Dispatch failed BEFORE any parent effect: return every entry to
          // retryable delivery. No follow-up content exists — a later retry
          // cannot duplicate it (T09-AC4).
          stateFor(parentThreadId).outstanding = [];
          const message =
            dispatch._tag === "Failure"
              ? dispatch.failure.message
              : (dispatch.success.error ?? "parent follow-up boundary rejected the batch");
          let retryable = 0;
          for (const entry of accepted) {
            const failed = yield* Effect.result(
              input.repository.markCompletionDeliveryFailed({
                outboxId: entry.dedupeId,
                now: new Date(now()).toISOString(),
                error: message,
              }),
            );
            if (failed._tag === "Success" && failed.success.kind === "transitioned") {
              retryable += 1;
              emit(
                parentThreadId,
                entry.executionId,
                "pi_subagent_completion_delivery_failed",
                `Follow-up dispatch failed for execution '${entry.executionId}' (attempt ${failed.success.entry.attemptCount}, retryable): ${message}`,
              );
            } else {
              emit(
                parentThreadId,
                entry.executionId,
                "pi_subagent_completion_delivery_failed",
                `Follow-up dispatch failed for execution '${entry.executionId}': ${message}`,
              );
            }
          }
          // T09-AC4 bounded automatic retry: when at least one entry stayed
          // within the retry budget, re-flush the thread after one batching
          // window (the repository scan itself drops exhausted entries).
          if (retryable > 0) {
            schedule(batchWindowMs, () => deliverThread(parentThreadId));
          }
          return;
        }
      }),
    ).finally(() => {
      inFlight -= 1;
      settleIdleWaiters();
    }).catch(() => {
      // Framing-level containment (see notifyFollowUpSettled): internal
      // failures are reported through Effect.result + diagnostics — never
      // an unhandled rejection from the coordinator.
    });
  };

  const onCompletionPending = (event: { readonly parentThreadId: string }): void => {
    const state = stateFor(event.parentThreadId);
    if (state.outstanding.length > 0 || state.parkedForParentBoundary) {
      // One outstanding follow-up / parked deferral: the next batch flush
      // happens at settle (T09-AC2) or boundary release (T09-AC3).
      return;
    }
    if (state.windowTimer !== undefined) {
      // Window already open: the newcomer joins this batch (T09-AC1).
      return;
    }
    state.windowTimer = schedule(batchWindowMs, () => {
      const threadState = threads.get(event.parentThreadId);
      if (threadState !== undefined) {
        threadState.windowTimer = undefined;
      }
      deliverThread(event.parentThreadId);
    });
  };

  const onParentTurnSettled = (parentThreadId: string): void => {
    const state = threads.get(parentThreadId);
    if (state === undefined || !state.parkedForParentBoundary) {
      return;
    }
    state.parkedForParentBoundary = false;
    deliverThread(parentThreadId);
  };

  const notifyFollowUpSettled = (event: {
    readonly parentThreadId: string;
    readonly outcome: "completed" | "failed";
  }): void => {
    const state = threads.get(event.parentThreadId);
    if (state === undefined || state.outstanding.length === 0) {
      return;
    }
    const batch = state.outstanding;
    state.outstanding = [];
    inFlight += 1;
    void Effect.runPromise(
      Effect.gen(function* () {
        if (event.outcome === "failed") {
          // The follow-up turn was rejected BEFORE running: no parent
          // content was shown — return the entries to retryable delivery
          // (T09-AC4). This does NOT count a delivery attempt against the
          // retry budget: the journal-first `delivered` marks are rolled
          // back through the same retryable transition without a dispatch
          // failure.
          for (const entry of batch) {
            yield* Effect.result(
              input.repository.markCompletionDeliveryFailed({
                outboxId: entry.dedupeId,
                now: new Date(now()).toISOString(),
                error: "follow-up turn failed before running",
              }),
            );
          }
          return;
        }
        // The follow-up turn ran to completion: acknowledge the batch.
        for (const entry of batch) {
          yield* Effect.result(
            input.repository.markCompletionAcknowledged({
              outboxId: entry.dedupeId,
              now: new Date(now()).toISOString(),
            }),
          );
        }
      }),
    ).finally(() => {
      inFlight -= 1;
      settleIdleWaiters();
      // A later burst waiting on the one-outstanding slot flushes now.
      void waitForIdle().then(() => {
        const threadState = threads.get(event.parentThreadId);
        if (threadState !== undefined && threadState.outstanding.length === 0) {
          deliverThread(event.parentThreadId);
        }
      });
    }).catch(() => {
      // Framing-level containment: internal failures are already reported
      // through Effect.result + diagnostics; a coordinator must never leak an
      // unhandled rejection into the host process (e.g. a scheduled retry
      // firing after the owning scope was torn down).
    });
  };

  const outstandingThreads = () =>
    [...threads.values()]
      .filter((state) => state.outstanding.length > 0)
      .map((state) => ({
        parentThreadId: state.parentThreadId,
        entries: state.outstanding.length,
      }));

  return {
    onCompletionPending,
    onParentTurnSettled,
    notifyFollowUpSettled,
    waitForIdle,
    outstandingThreads,
  };
};

/** Production scheduler (real timers); tests inject a virtual clock. */
const makeDefaultScheduler = (): CompletionCoordinatorScheduler["schedule"] => {
  const schedule: CompletionCoordinatorScheduler["schedule"] = (delayMs, callback) => {
    const timer = setTimeout(callback, Math.max(0, delayMs));
    return {
      cancel: () => {
        clearTimeout(timer);
      },
    };
  };
  return schedule;
};

// Re-exported for adapter wiring: the entry projection used in follow-ups.
export { toEntry as projectCompletionFollowUpEntry };
