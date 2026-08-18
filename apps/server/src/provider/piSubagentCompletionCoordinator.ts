import type { PiSubagentDiagnosticCode } from "@synara/contracts";
import { Effect, Option } from "effect";

import type {
  PiSubagentCompletionDispatchBatch,
  PiSubagentCompletionDispatchBatchContent,
  PiSubagentCompletionDispatchCreateResult,
  PiSubagentCompletionOutboxEntry,
  PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT } from "../config.ts";
import type { PiSubagentParentEffectDispatcher } from "./piSubagentParentEffectDispatcher.ts";
import { verifyPiSubagentCompletionDispatchFingerprint } from "./piSubagentCompletionDispatchIdentity.ts";

/**
 * Decision 0016 — per-thread completion coordinator (Ticket 09 remediation,
 * WP5).
 *
 * The durable completion-dispatch batch is the recovery authority. The
 * coordinator:
 *
 * 1. Batching (T09-AC1): near-simultaneous managed terminals for one parent
 *    thread inside the configured window coalesce into ONE immutable batch
 *    whose content (derived identities + frozen `thread.turn.start` command
 *    + bounded parent message with the harness-policy header) is authored
 *    transactionally with its canonical members.
 * 2. One outstanding follow-up per thread (T09-AC2): the durable
 *    one-active-batch partial unique index is the authority; later bursts
 *    wait outside the active batch and join the next batch after it settles.
 * 3. Safe parent boundary (T09-AC3): the ONLY delivery gate is `isParentBusy`;
 *    a busy or unavailable/lazy parent parks without writing durable state and
 *    without consuming retry budget, then re-flushes on settle/hydration.
 * 4. The parent effect is accepted exactly when the batch's deterministic
 *    internal command receives a fingerprint-matched accepted orchestration
 *    receipt (Decision 0016 §1). Dispatch goes through the narrow
 *    parent-effect dispatcher port; the coordinator NEVER calls Pi
 *    `session.prompt` and never infers acceptance from outbox `delivered`.
 * 5. Exact correlation (Decision 0016 §6): finalization only after the
 *    batch's stored command id + fingerprint + parent message id match the
 *    accepted receipt, and only its exact associated members are
 *    acknowledged. Generic thread-level `message_end` / settle / session
 *    events may trigger a recovery check but can never acknowledge a batch.
 * 6. Stable retry + exhaustion (Decision 0016 §7): transient no-receipt
 *    failures re-dispatch the STORED frozen command byte-for-byte under the
 *    same identity, consuming the Ticket 08 retry policy; the batch settles
 *    `exhausted` at the ceiling with evidence preserved and the execution
 *    outcome never mutated.
 * 7. Immutable rejection / collision: a fingerprint-matched persisted
 *    rejection or identity collision settles the batch `exhausted` with one
 *    genuine attempt and NO repeated increments.
 * 8. Supersede (T09-AC6): stale members (newer attempt/generation) are
 *    fenced at create and pre-submission with zero parent effect; evidence
 *    stays readable by identity.
 * 9. Ticket 09 recovery: awaiting + within-budget retryable batches are
 *    driven to acceptance/finalization on new completions, safe-boundary,
 *    managed-session hydration, dispatcher binding, and the adapter's bounded
 *    ongoing scan — no new terminal is required for recovery.
 *
 * Legacy sessions never reach this coordinator (the adapter dispositions
 * their entries at terminal-persist time).
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

/** One bounded batch member — the stable outbox identity travels with it. */
export interface PiSubagentCompletionCoordinatorFollowUpEntry {
  /** Stable outbox identity — the parent-effect key (Decision 0013 F4). */
  readonly dedupeId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly terminalState: "succeeded" | "failed";
  /** Bounded summary excerpt — never unbounded raw output. */
  readonly summary: string;
  readonly transcriptRef: string | null;
}

export interface PiSubagentCompletionCoordinatorDiagnosticEvent {
  readonly parentThreadId: string;
  readonly executionId?: string | undefined;
  readonly batchId?: string | undefined;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
  readonly diagnosticMessage: string;
}

export interface PiSubagentCompletionCoordinatorInput {
  /** Live repository — may be a lazy getter bound inside an Effect scope. */
  readonly repository: PiSubagentExecutionRepositoryShape;
  /** Batching window in milliseconds; 0 flushes immediately (T09-AC1). */
  readonly batchWindowMs?: number;
  /** Ticket 08 retry policy — consumed from the resolved server config. */
  readonly retryLimit?: number | undefined;
  /** Per-batch bounded entry cap; overflow joins the NEXT batch. */
  readonly maxBatchEntries?: number | undefined;
  readonly scheduler?: CompletionCoordinatorScheduler | undefined;
  readonly now?: (() => number) | undefined;
  readonly schedule?: CompletionCoordinatorScheduler["schedule"] | undefined;
  /**
   * T09-AC3 parent-turn boundary: `true` while the parent thread has an
   * active turn. The ONLY delivery gate — user-read state is never an input.
   */
  readonly isParentBusy: (parentThreadId: string) => boolean;
  /**
   * Managed parent session availability. Absent / lazy / stopped sessions are
   * NOT failure: they park the thread without durable writes or retry
   * accounting and re-flush when the session hydrates (Decision 0016 §5).
   */
  readonly parentSessionAvailable?: ((parentThreadId: string) => boolean) | undefined;
  /**
   * The narrow parent-effect dispatcher port (Decision 0016 §4/§9). A
   * partially-wired composition (dispatcher absent) parks: dispatch is
   * `unavailable`, consuming no retry budget.
   */
  readonly parentEffectDispatcher?: PiSubagentParentEffectDispatcher | undefined;
  /**
   * Author the immutable batch content (derived identities + frozen
   * `thread.turn.start` command + bounded parent message text) from the
   * exact canonical member selection. Runs INSIDE the create transaction.
   * A throwing builder fails the create closed (`content_rejected`).
   */
  readonly buildBatchContent: (input: {
    readonly parentThreadId: string;
    readonly members: readonly PiSubagentCompletionOutboxEntry[];
    readonly createdAt: string;
  }) => PiSubagentCompletionDispatchBatchContent;
  readonly onDiagnostic?: (event: PiSubagentCompletionCoordinatorDiagnosticEvent) => void;
}

export interface PiSubagentCompletionCoordinator {
  /** Post-commit trigger: a durable pending completion exists for the thread. */
  readonly onCompletionPending: (event: { readonly parentThreadId: string }) => void;
  /**
   * T09-AC3 busy-then-idle release AND a Decision 0016 §6 recovery-trigger:
   * the parent turn settled; run a recovery check for the thread (may dispatch
   * or finalize an active batch). NEVER an acknowledgement by itself.
   */
  readonly onParentTurnSettled: (parentThreadId: string) => void;
  /**
   * Decision 0016 §5: a relevant managed parent session hydrated/started —
   * run a recovery check for that thread.
   */
  readonly onManagedSessionHydrated: (parentThreadId: string) => void;
  /**
   * Decision 0016 §5 bounded Ticket 09 recovery scan: drive recovery for each
   * listed managed-session thread (awaiting/retryable batches, then new
   * batches for pending members) without synthesizing absent sessions.
   */
  readonly triggerScan: (parentThreadIds: readonly string[]) => void;
  /** Test/diagnostics support: resolves when no dispatch work is in flight. */
  readonly waitForIdle: () => Promise<void>;
  /** Inspection: threads carrying a durable active (nonterminal) batch. */
  readonly outstandingThreads: () => ReadonlyArray<{ parentThreadId: string; state: string }>;
}

type ThreadState = {
  readonly parentThreadId: string;
  /** Flush timer for the open batching window, when one is open. */
  windowTimer: { readonly cancel: () => void } | undefined;
  /** True while a dispatch/defer decision for the thread is in flight. */
  processing: boolean;
};

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
  const dispatcher = input.parentEffectDispatcher;
  const parentSessionAvailable = input.parentSessionAvailable ?? (() => true);

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
    event: Partial<Omit<PiSubagentCompletionCoordinatorDiagnosticEvent, "parentThreadId">> & {
      readonly diagnosticCode: PiSubagentDiagnosticCode;
      readonly diagnosticMessage: string;
    },
  ): void => {
    input.onDiagnostic?.({
      parentThreadId,
      ...(event.executionId !== undefined ? { executionId: event.executionId } : {}),
      ...(event.batchId !== undefined ? { batchId: event.batchId } : {}),
      diagnosticCode: event.diagnosticCode,
      diagnosticMessage: event.diagnosticMessage,
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
      processing: false,
    };
    threads.set(parentThreadId, created);
    return created;
  };

  /** True when a batch member's execution is no longer on the batch's
   * attempt/generation (a resume advanced past it → the completion is stale). */
  const batchMembersStale = (
    batch: PiSubagentCompletionDispatchBatch,
  ): Effect.Effect<boolean, never> =>
    Effect.gen(function* () {
      for (const outboxId of batch.membership) {
        const entryOpt = yield* Effect.result(input.repository.getCompletionOutboxEntry(outboxId));
        if (entryOpt._tag === "Failure" || Option.isNone(entryOpt.success)) {
          // Missing entry: treat as stale — the durable membership cannot be
          // re-verified, so the batch must not produce a parent effect.
          return true;
        }
        const entry = entryOpt.success.value;
        const executionOpt = yield* Effect.result(input.repository.getById(entry.executionId));
        if (executionOpt._tag === "Failure" || Option.isNone(executionOpt.success)) {
          return true;
        }
        const execution = executionOpt.success.value;
        if (execution.attemptId !== entry.attemptId || execution.generation !== entry.generation) {
          return true;
        }
      }
      return false;
    });

  /** After the active slot releases (finalize/supersede/exhaust/reject), any
   * remaining recoverable members may form the next batch immediately. */
  const scheduleRedrive = (parentThreadId: string): void => {
    schedule(0, () => advanceThread(parentThreadId));
  };

  /** Drive ONE durable active batch: dispatch or finalize per its state. */
  const driveBatch = (batch: PiSubagentCompletionDispatchBatch): void => {
    if (batch.state === "accepted") {
      finalizeAcceptedBatch(batch);
      return;
    }
    if (batch.state !== "awaiting_acceptance" && batch.state !== "retryable") {
      // superseded / exhausted: already terminal, nothing to drive.
      return;
    }

    inFlight += 1;
    // Stale-before-submission: supersede with zero parent effect and release
    // the slot (T09-AC6 / Decision 0016 §10).
    void Effect.runPromise(
      Effect.gen(function* () {
        const stale = yield* batchMembersStale(batch);
        if (stale) {
          const result = yield* Effect.result(
            input.repository.supersedeCompletionDispatchBatch({
              batchId: batch.batchId,
              now: new Date(now()).toISOString(),
              supersededByReason: "a member's attempt/generation advanced before submission",
            }),
          );
          if (result._tag === "Success" && result.success.kind === "transitioned") {
            emit(batch.parentThreadId, {
              batchId: batch.batchId,
              diagnosticCode: "pi_subagent_completion_superseded",
              diagnosticMessage: `Completion dispatch batch '${batch.batchId}' superseded before submission (stale generation); zero parent effect`,
            });
          }
          scheduleRedrive(batch.parentThreadId);
          return;
        }

        // Safe boundary still holds at dispatch time (T09-AC3): never steer
        // into an active parent turn.
        if (input.isParentBusy(batch.parentThreadId)) {
          return; // parked; onParentTurnSettled re-flushes
        }
        if (!parentSessionAvailable(batch.parentThreadId)) {
          return; // parked; onManagedSessionHydrated re-flushes
        }

        if (dispatcher === undefined) {
          // Partially-wired composition: dispatch unavailable — consume no
          // retry budget; the adapter binds / triggers recovery later.
          return;
        }

        // Drift / malformed stored payload fails closed BEFORE dispatch under
        // the SAME identity — no rotated identity, no parent effect
        // (Decision 0016 §3, §10). A mismatched fingerprint means this batch
        // can never be accepted; settle it exhausted with evidence.
        if (
          !verifyPiSubagentCompletionDispatchFingerprint({
            commandPayloadJson: batch.commandPayloadJson,
            expectedCommandFingerprint: batch.commandFingerprint,
            expectedFingerprintVersion: batch.fingerprintVersion,
          })
        ) {
          yield* settleRejected(
            batch,
            "stored frozen command payload drift: fingerprint mismatch under the same identity",
            "collision",
          );
          return;
        }

        const outcome = yield* Effect.tryPromise({
          try: () => dispatcher.dispatch(batch.commandPayloadJson),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(Effect.result);

        if (outcome._tag === "Failure") {
          yield* recordTransientFailure(batch, `dispatcher threw: ${outcome.failure.message}`);
          return;
        }

        const dispatch = outcome.success;
        const startedAt = new Date(now()).toISOString();
        switch (dispatch.kind) {
          case "accepted": {
            // Exact receipt correlation (Decision 0016 §6) — the repository
            // guards command id + fingerprint + message id + sequence.
            const accepted = yield* Effect.result(
              input.repository.recordCompletionDispatchAccepted({
                batchId: batch.batchId,
                fingerprintVersion: batch.fingerprintVersion,
                commandFingerprint: batch.commandFingerprint,
                parentCommandId: batch.parentCommandId,
                parentMessageId: batch.parentMessageId,
                acceptedReceiptSequence: dispatch.receipt.resultSequence,
                now: startedAt,
              }),
            );
            if (accepted._tag === "Failure") {
              yield* recordTransientFailure(
                batch,
                `durable accepted-recording failed: ${accepted.failure.message}`,
              );
              return;
            }
            if (accepted.success.kind === "transitioned") {
              emit(batch.parentThreadId, {
                batchId: batch.batchId,
                diagnosticCode: "pi_subagent_completion_delivery_failed",
                diagnosticMessage: `completion-recovery-correlation-confirmed:${dispatch.receipt.resultSequence}`,
              });
              finalizeAcceptedBatch({ ...batch, state: "accepted" as const });
              return;
            }
            if (accepted.success.kind === "receipt_mismatch") {
              // Identity drift / collision: this identity can never be
              // accepted — settle exhausted with evidence, no rotated identity.
              yield* settleRejected(batch, accepted.success.reason, "collision");
              return;
            }
            // invalid_transition / not_found — terminal elsewhere.
            return;
          }
          case "rejected":
            yield* settleRejected(batch, dispatch.error, "rejected");
            return;
          case "collision":
            yield* settleRejected(batch, dispatch.error, "collision");
            return;
          case "transient":
          case "unverified":
            yield* recordTransientFailure(batch, dispatch.error);
            return;
          case "unavailable":
            // Pre-bind or engine stopped: no retry accounting; wait for the
            // bind/session trigger.
            return;
        }
      }),
    )
      .finally(() => {
        inFlight -= 1;
        settleIdleWaiters();
      })
      .catch(() => {
        // Framing-level containment: failures are reported through Effect.result
        // + diagnostics; never an unhandled rejection from the coordinator.
      });
  };

  const recordTransientFailure = (
    batch: PiSubagentCompletionDispatchBatch,
    error: string,
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const failed = yield* Effect.result(
        input.repository.failCompletionDispatchBatch({
          batchId: batch.batchId,
          now: new Date(now()).toISOString(),
          error,
          retryLimit,
        }),
      );
      if (failed._tag === "Failure") {
        emit(batch.parentThreadId, {
          batchId: batch.batchId,
          diagnosticCode: "pi_subagent_completion_batch_persistence_failed",
          diagnosticMessage: `Batch failure-transition failed for '${batch.batchId}': ${failed.failure.message}`,
        });
        return;
      }
      const transition = failed.success;
      if (transition.kind !== "transitioned") {
        return;
      }
      if (transition.batch.state === "exhausted") {
        emit(batch.parentThreadId, {
          batchId: batch.batchId,
          diagnosticCode: "pi_subagent_completion_delivery_failed",
          diagnosticMessage: `Completion dispatch batch '${batch.batchId}' exhausted after ${transition.batch.attemptCount} attempt(s): ${error}`,
        });
        scheduleRedrive(batch.parentThreadId);
        return;
      }
      emit(batch.parentThreadId, {
        batchId: batch.batchId,
        diagnosticCode: "pi_subagent_completion_delivery_failed",
        diagnosticMessage: `Completion dispatch failed for batch '${batch.batchId}' (attempt ${transition.batch.attemptCount}, retryable): ${error}`,
      });
      // Stable-identity byte-identical redrive after one batching window.
      schedule(batchWindowMs, () => advanceThread(batch.parentThreadId));
    });

  const settleRejected = (
    batch: PiSubagentCompletionDispatchBatch,
    error: string,
    reason: "rejected" | "collision",
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const rejected = yield* Effect.result(
        input.repository.rejectCompletionDispatchBatch({
          batchId: batch.batchId,
          now: new Date(now()).toISOString(),
          error,
          reason,
        }),
      );
      if (rejected._tag === "Failure") {
        emit(batch.parentThreadId, {
          batchId: batch.batchId,
          diagnosticCode: "pi_subagent_completion_batch_persistence_failed",
          diagnosticMessage: `Batch rejection-transition failed for '${batch.batchId}': ${rejected.failure.message}`,
        });
        return;
      }
      if (rejected.success.kind !== "transitioned") {
        return;
      }
      emit(batch.parentThreadId, {
        batchId: batch.batchId,
        diagnosticCode:
          reason === "collision"
            ? "pi_subagent_completion_batch_collision"
            : "pi_subagent_completion_batch_rejected",
        diagnosticMessage: `Completion dispatch batch '${batch.batchId}' permanently ${reason === "collision" ? "failed closed (identity collision)" : "rejected"}: ${error}`,
      });
      // The slot is released (exhausted is terminal); remaining members may
      // form the next batch.
      scheduleRedrive(batch.parentThreadId);
    });

  const finalizeAcceptedBatch = (batch: PiSubagentCompletionDispatchBatch): void => {
    inFlight += 1;
    void Effect.runPromise(
      Effect.gen(function* () {
        const finalized = yield* Effect.result(
          input.repository.finalizeCompletionDispatchBatch({
            batchId: batch.batchId,
            now: new Date(now()).toISOString(),
          }),
        );
        if (finalized._tag === "Failure") {
          emit(batch.parentThreadId, {
            batchId: batch.batchId,
            diagnosticCode: "pi_subagent_completion_batch_persistence_failed",
            diagnosticMessage: `Batch finalization failed for '${batch.batchId}'; recovery will re-finalize: ${finalized.failure.message}`,
          });
          schedule(batchWindowMs, () => advanceThread(batch.parentThreadId));
          return;
        }
        if (finalized.success.kind !== "transitioned") {
          return;
        }
        emit(batch.parentThreadId, {
          batchId: batch.batchId,
          diagnosticCode: "pi_subagent_completion_delivery_failed",
          diagnosticMessage: `completion follow-up accepted and acknowledged for batch '${batch.batchId}' (receipt-correlated finalization)`,
        });
        scheduleRedrive(batch.parentThreadId);
      }),
    )
      .finally(() => {
        inFlight -= 1;
        settleIdleWaiters();
      })
      .catch(() => {
        // Framing-level containment.
      });
  };

  /**
   * Advance ONE parent thread: drive its durable active batch (dispatch /
   * finalize / supersede) or create the next batch from pending members at the
   * safe boundary. Everything the coordinator decides is backed by the batch
   * ledger; in-memory state is only a reentrancy/scheduling optimization.
   */
  const advanceThread = (parentThreadId: string): void => {
    const state = stateFor(parentThreadId);
    if (state.processing) {
      return;
    }
    state.processing = true;
    inFlight += 1;
    void Effect.runPromise(
      Effect.gen(function* () {
        const active = yield* Effect.result(
          input.repository.getActiveCompletionDispatchBatch(parentThreadId),
        );
        if (active._tag === "Failure") {
          emit(parentThreadId, {
            diagnosticCode: "pi_subagent_completion_batch_recovery_failed",
            diagnosticMessage: `Active batch lookup failed for parent thread; retrying on next trigger: ${active.failure.message}`,
          });
          return;
        }
        if (Option.isSome(active.success)) {
          // Drive the existing active batch first (recovery); its finalization
          // redrives for the new completion.
          driveBatch(active.success.value);
          return;
        }

        // No active batch: safe-boundary checks BEFORE any durable write.
        // Deferral consumes no retry budget and writes no state (T09-AC3).
        if (input.isParentBusy(parentThreadId)) {
          return;
        }
        if (!parentSessionAvailable(parentThreadId)) {
          return;
        }

        const scan = yield* Effect.result(
          input.repository.listRecoverableCompletionOutbox({ retryLimit, parentThreadId }),
        );
        if (scan._tag === "Failure") {
          emit(parentThreadId, {
            diagnosticCode: "pi_subagent_completion_delivery_failed",
            diagnosticMessage:
              "Completion batch scan failed for parent thread; retrying on next trigger",
          });
          return;
        }
        if (scan.success.length === 0) {
          return;
        }

        // Authorman the immutable batch (selection, generation fence, cap,
        // content, association) in one transaction (Decision 0016 §2).
        const createdAt = new Date(now()).toISOString();
        const created = yield* Effect.result(
          input.repository.createCompletionDispatchBatch({
            parentThreadId,
            maxBatchEntries,
            retryLimit,
            now: createdAt,
            buildBatchContent: (members) =>
              input.buildBatchContent({ parentThreadId, members, createdAt }),
          }),
        );
        if (created._tag === "Failure") {
          emit(parentThreadId, {
            diagnosticCode: "pi_subagent_completion_batch_persistence_failed",
            diagnosticMessage: `Completion batch creation failed for parent thread: ${created.failure.message}`,
          });
          return;
        }
        const create = created.success;
        switch (create.kind) {
          case "created": {
            if (create.supersededCount > 0) {
              emit(parentThreadId, {
                diagnosticCode: "pi_subagent_completion_superseded",
                diagnosticMessage: `${create.supersededCount} stale completion member(s) superseded before batch creation; no follow-up effect`,
              });
            }
            driveBatch(create.batch);
            return;
          }
          case "batch_already_present":
            driveBatch(create.batch);
            return;
          case "no_members":
            if (create.supersededCount > 0) {
              emit(parentThreadId, {
                diagnosticCode: "pi_subagent_completion_superseded",
                diagnosticMessage: `${create.supersededCount} stale completion member(s) superseded before batch creation; no follow-up effect`,
              });
            }
            return;
          case "active_batch_exists": {
            // A concurrent process created the active batch first — drive the
            // durable authority (unique index guarantees at most one).
            const existing = yield* Effect.result(
              input.repository.getActiveCompletionDispatchBatch(parentThreadId),
            );
            if (existing._tag === "Success" && Option.isSome(existing.success)) {
              driveBatch(existing.success.value);
            }
            return;
          }
          case "member_collision":
            emit(parentThreadId, {
              diagnosticCode: "pi_subagent_completion_batch_collision",
              diagnosticMessage:
                "Completion batch member collision; the create transaction rolled back",
            });
            return;
          case "content_rejected":
            emit(parentThreadId, {
              diagnosticCode: "pi_subagent_completion_batch_collision",
              diagnosticMessage: `Completion batch content rejected (fail closed): ${create.detail}`,
            });
            return;
        }
      }),
    )
      .finally(() => {
        inFlight -= 1;
        state.processing = false;
        settleIdleWaiters();
      })
      .catch(() => {
        // Framing-level containment.
      });
  };

  const openBatchWindow = (parentThreadId: string): void => {
    const state = stateFor(parentThreadId);
    if (state.windowTimer !== undefined) {
      // Window already open: the newcomer joins this batch (T09-AC1).
      return;
    }
    if (batchWindowMs === 0) {
      advanceThread(parentThreadId);
      return;
    }
    state.windowTimer = schedule(batchWindowMs, () => {
      const threadState = threads.get(parentThreadId);
      if (threadState !== undefined) {
        threadState.windowTimer = undefined;
      }
      advanceThread(parentThreadId);
    });
  };

  const onCompletionPending = (event: { readonly parentThreadId: string }): void => {
    openBatchWindow(event.parentThreadId);
  };

  const onParentTurnSettled = (parentThreadId: string): void => {
    // Safe boundary opened (busy-then-idle) and/or a parent settle occurred:
    // run a recovery check. This NEVER acknowledges a batch by itself.
    advanceThread(parentThreadId);
  };

  const onManagedSessionHydrated = (parentThreadId: string): void => {
    advanceThread(parentThreadId);
  };

  const triggerScan = (parentThreadIds: readonly string[]): void => {
    for (const parentThreadId of parentThreadIds) {
      advanceThread(parentThreadId);
    }
  };

  const outstandingThreads = () =>
    [...threads.values()]
      .filter((state) => state.windowTimer !== undefined || state.processing)
      .map((state) => ({
        parentThreadId: state.parentThreadId,
        state: state.processing ? "processing" : "window_open",
      }));

  return {
    onCompletionPending,
    onParentTurnSettled,
    onManagedSessionHydrated,
    triggerScan,
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
