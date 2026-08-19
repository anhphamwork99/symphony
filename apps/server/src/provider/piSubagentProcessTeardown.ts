import type { PiSubagentDiagnosticCode, PiSubagentExecutionRecord } from "@synara/contracts";
import { Effect } from "effect";

import type {
  PiSubagentExecutionRepositoryShape,
  PiSubagentWatchdogStageRecordResult,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";

/**
 * Ticket 16 — Owned process-tree teardown and fencing.
 *
 * When provider-session stop cannot prove cleanup (the ticket 15 teardown
 * handoff, band 74), Synara tears down ONLY the process tree owned by the
 * managed execution/provider session, verifies that it is dead, fences the
 * terminated generation, and reports any survivor explicitly.
 *
 * Ownership model (T16-AC1): the ONLY kill authority is the provider
 * session's own process supervisor (`PiBashProcessSupervisor.teardownAll`),
 * which exclusively signals processes it spawned itself —
 * identity-captured descendants with PID-reuse guards
 * (`teardownProviderProcessTree` proves exit through the exact root exit
 * plus identity-matched captured descendants). This coordinator NEVER
 * signals a bare PID from outside the supervisor: a resolved live session
 * supplies the owned set; when no live session context exists (post-stop or
 * post-restart), ownership cannot be proven, nothing is killed, and the
 * honest `owner_unproven` outcome is journaled (T16-AC7).
 *
 * Journal bands (attempt-local, one deterministic idempotent row each under
 * the journal UNIQUE(execution_id, attempt_id, generation, sequence)):
 * - 75 `pi_subagent_teardown_requested` — journal-only request evidence,
 *   recorded BEFORE dispatch (at-least-once dispatch, exactly-once journal
 *   effect; a crashed pass re-requests safely and observes already_applied).
 * - 76 `pi_subagent_teardown_{proven|survivors|owner_unproven}` — the
 *   outcome. PROOF-BEFORE-FENCE (T16-AC5, Decision 0021 F3): only a
 *   `proven` outcome settles the aggregate to terminal `cancelled` and
 *   advances the generation (the fence) inside the same repository
 *   transaction — never the band-74 handoff, never a timer. Survivors and
 *   unproven ownership journal honest uncertain-cleanup evidence and leave
 *   the projection `cancelling` (T16-AC4).
 *
 * Entry policy (T16-AC6): ONLY executions whose journal carries the
 * band-74 teardown-handoff row for the CURRENT attempt/generation. Graceful
 * cancellation settles through the ticket 06 seq-92 acknowledgement and the
 * normal terminal path settles through band 40 — neither ever journals 74,
 * so neither can enter teardown. An execution that settled between passes
 * is skipped by the non-terminal scan.
 *
 * Server restart (T16-AC7): the same scan is bounded (durable journal
 * truth, capped per pass). After a true restart no live session context can
 * exist, so no process kill can be ownership-justified — the pass records
 * the bounded `owner_unproven` evidence once per execution and cleans up
 * only for sessions that are STILL live with a provable supervisor.
 */

/** Attempt-local journal band for teardown evidence (75 request, 76 outcome). */
export const PI_SUBAGENT_TEARDOWN_BAND = {
  request: 75,
  outcome: 76,
} as const;

/** Lowest sequence of the teardown band (test/telemetry filter anchor). */
export const PI_SUBAGENT_TEARDOWN_SEQUENCE = PI_SUBAGENT_TEARDOWN_BAND.request;

export const PI_SUBAGENT_TEARDOWN_REQUESTED_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_teardown_requested";
export const PI_SUBAGENT_TEARDOWN_PROVEN_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_teardown_proven";
export const PI_SUBAGENT_TEARDOWN_SURVIVORS_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_teardown_survivors";
export const PI_SUBAGENT_TEARDOWN_OWNER_UNPROVEN_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_teardown_owner_unproven";

/** Cap on survivor PIDs persisted/journaled per outcome (bounded evidence). */
export const MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS = 16;

/** Cap on executions processed per pass (bounded restart discovery, T16-AC7). */
export const MAX_PI_SUBAGENT_TEARDOWN_PASS_EXECUTIONS = 64;

/**
 * The owned-process kill authority (T16-AC1). Production resolves the
 * provider session's own supervisor — the only component that knows which
 * processes it spawned. Resolves `undefined` when no live owned supervisor
 * exists (session stopped / server restarted): teardown is then NOT
 * dispatched and the outcome is `owner_unproven`.
 */
export type PiSubagentOwnedTeardownDispatch = (input: {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
}) => Promise<PiSubagentOwnedTeardownDispatchResult>;

export interface PiSubagentOwnedTeardownDispatchResult {
  /**
   * `proven` — every owned process tree proved exit (liveness-verified, not
   * just a kill API return; T16-AC3).
   * `survivors` — teardown ran but at least one owned process remained
   * alive past the escalation bounds (survivorPids, bounded).
   */
  readonly kind: "proven" | "survivors";
  /** Present for `survivors` only; already capped by the caller's fixture. */
  readonly survivorPids?: ReadonlyArray<number>;
}

export interface PiSubagentProcessTeardownInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /**
   * Resolves the owned supervisor teardown for one execution's parent
   * thread. `undefined` = no live owned supervisor → no kill (honest
   * `owner_unproven` outcome, T16-AC1/AC7).
   */
  readonly dispatchOwnedTeardown: (execution: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
  }) => Promise<PiSubagentOwnedTeardownDispatchResult | undefined>;
  /** Injectable clock (epoch ms) for deterministic tests. */
  readonly now?: () => number;
  /** Cap on executions per pass (default 64). */
  readonly maxPerPass?: number | undefined;
  /**
   * Safe operator observation: fixed diagnostic vocabulary plus the safe
   * correlation identity (execution/attempt/generation/thread) and the
   * teardown stage that produced it — never prompt, result, or transcript
   * content.
   */
  readonly onDiagnostic?:
    | ((event: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly generation: number;
        readonly parentThreadId: string;
        readonly stage:
          | "teardown_requested"
          | "teardown_proven"
          | "teardown_survivors"
          | "teardown_owner_unproven"
          | "failure";
        readonly diagnosticCode: PiSubagentDiagnosticCode;
        readonly diagnosticMessage: string;
      }) => void)
    | undefined;
}

export type PiSubagentProcessTeardownOutcome =
  | { readonly kind: "settled_proven"; readonly fencedGeneration: number }
  | { readonly kind: "survivors"; readonly survivorPids: ReadonlyArray<number> }
  | { readonly kind: "owner_unproven" }
  | { readonly kind: "already_terminal" }
  | { readonly kind: "stale_generation" }
  | { readonly kind: "failed"; readonly error: string };

export interface PiSubagentProcessTeardownResult {
  readonly outcomes: ReadonlyArray<{
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
    readonly outcome: PiSubagentProcessTeardownOutcome;
  }>;
}

const TERMINAL_STATES = new Set(["cancelled", "succeeded", "failed", "rejected"]);

const capSurvivorPids = (
  pids: ReadonlyArray<number> | undefined,
): ReadonlyArray<number> | undefined =>
  pids === undefined ? undefined : pids.slice(0, MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS);

const isTerminalState = (state: string): boolean => TERMINAL_STATES.has(state);

const teardownOne = async (
  input: PiSubagentProcessTeardownInput,
  execution: PiSubagentExecutionRecord,
): Promise<TeardownOneResult> => {
  const now = input.now ?? (() => Date.now());
  const nowIso = () => new Date(now()).toISOString();
  const threadId = String(execution.parentThreadId);

  const reportDiagnostic = (event: {
    readonly stage:
      | "teardown_requested"
      | "teardown_proven"
      | "teardown_survivors"
      | "teardown_owner_unproven"
      | "failure";
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }): void => {
    input.onDiagnostic?.({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      parentThreadId: threadId,
      ...event,
    });
  };

  const finished = (outcome: PiSubagentProcessTeardownOutcome): TeardownOneResult => ({
    executionId: execution.executionId,
    attemptId: execution.attemptId,
    generation: execution.generation,
    parentThreadId: threadId,
    outcome,
  });

  // T16-AC2: journal the request (band 75) BEFORE dispatch — at-least-once
  // dispatch with exactly-once journal effect. already_applied means an
  // earlier pass dispatched (or crashed mid-flight); re-dispatch is safe and
  // idempotent (signalling a dead owned PID is a no-op under ESRCH; the
  // identity capture prevents PID-reuse kills), so the pass continues.
  const requestResult = await Effect.runPromise(
    Effect.result(
      input.repository.recordTeardownRequested({
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation,
        state: execution.observedState,
        occurredAt: nowIso(),
        metadata: { phase: "process_tree_teardown", reason: "watchdog_teardown_handoff" },
      }),
    ),
  );
  if (requestResult._tag === "Failure") {
    const cause = requestResult.failure;
    const message = cause instanceof Error ? cause.message : String(cause);
    reportDiagnostic({
      stage: "failure",
      diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
      diagnosticMessage: `Teardown request journal write failed: ${message}`,
    });
    return finished({ kind: "failed", error: message });
  }
  const request = requestResult.success as PiSubagentWatchdogStageRecordResult;
  if (request.kind === "stale_generation") {
    return finished({ kind: "stale_generation" });
  }
  if (isTerminalState(request.execution.observedState)) {
    // Settled between the scan and the request: terminal truth wins.
    return finished({ kind: "already_terminal" });
  }
  if (request.kind === "recorded") {
    reportDiagnostic({
      stage: "teardown_requested",
      diagnosticCode: PI_SUBAGENT_TEARDOWN_REQUESTED_DIAGNOSTIC,
      diagnosticMessage:
        "Owned process-tree teardown requested for the handed-off execution; only processes proven owned by its provider session will be signalled",
    });
  }

  // T16-AC1: resolve the OWNED supervisor. No live owned supervisor → no
  // kill, honest owner_unproven outcome (also the bounded restart case,
  // T16-AC7).
  const dispatch = await input
    .dispatchOwnedTeardown({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      parentThreadId: threadId,
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      reportDiagnostic({
        stage: "failure",
        diagnosticCode: PI_SUBAGENT_TEARDOWN_SURVIVORS_DIAGNOSTIC,
        diagnosticMessage: `Owned teardown dispatch failed: ${message}`,
      });
      return { kind: "survivors" as const, survivorPids: [] };
    });

  if (dispatch === undefined) {
    const message =
      "Owned process-tree teardown could not be dispatched: no live owned process supervisor could be proven for this execution (session stopped or server restarted); nothing was killed and cleanup remains uncertain";
    reportDiagnostic({
      stage: "teardown_owner_unproven",
      diagnosticCode: PI_SUBAGENT_TEARDOWN_OWNER_UNPROVEN_DIAGNOSTIC,
      diagnosticMessage: message,
    });
    const outcome = await Effect.runPromise(
      Effect.result(
        input.repository.recordTeardownOutcome({
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: execution.generation,
          outcome: "owner_unproven",
          occurredAt: nowIso(),
          diagnosticMessage: message,
          metadata: { reason: "no_live_owned_supervisor" },
        }),
      ),
    );
    if (outcome._tag === "Failure") {
      return finished({ kind: "failed", error: "owner_unproven outcome journal write failed" });
    }
    return finished({ kind: "owner_unproven" });
  }

  if (dispatch.kind === "survivors") {
    // T16-AC4: survivors produce the stable uncertain-cleanup diagnostic and
    // remain operationally visible; the projection stays `cancelling`.
    const survivorPids = capSurvivorPids(dispatch.survivorPids);
    const message =
      `Owned process-tree teardown left ${String(survivorPids?.length ?? 0)} captured survivor` +
      `${survivorPids?.length === 1 ? "" : "s"}` +
      (survivorPids !== undefined && survivorPids.length > 0
        ? ` (${survivorPids.join(", ")})`
        : "") +
      "; cleanup remains uncertain and the execution stays cancelling";
    reportDiagnostic({
      stage: "teardown_survivors",
      diagnosticCode: PI_SUBAGENT_TEARDOWN_SURVIVORS_DIAGNOSTIC,
      diagnosticMessage: message,
    });
    const outcome = await Effect.runPromise(
      Effect.result(
        input.repository.recordTeardownOutcome({
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: execution.generation,
          outcome: "survivors",
          occurredAt: nowIso(),
          ...(survivorPids !== undefined ? { survivorPids } : {}),
          diagnosticMessage: message,
          metadata: { reason: "survivors_after_escalation" },
        }),
      ),
    );
    if (outcome._tag === "Failure") {
      return finished({ kind: "failed", error: "survivors outcome journal write failed" });
    }
    return finished({
      kind: "survivors",
      survivorPids: survivorPids ?? [],
    });
  }

  // dispatch.kind === "proven": T16-AC3 (liveness-verified) → T16-AC5
  // (proof-before-fence settle): the repository settles `cancelled` AND
  // advances the generation in the same transaction.
  const message =
    "Owned process-tree teardown proven: every process tree owned by the execution's provider session verified dead (exit + identity-matched descendants gone); the terminated generation is fenced and late events will be ignored and counted";
  reportDiagnostic({
    stage: "teardown_proven",
    diagnosticCode: PI_SUBAGENT_TEARDOWN_PROVEN_DIAGNOSTIC,
    diagnosticMessage: message,
  });
  const outcome = await Effect.runPromise(
    Effect.result(
      input.repository.recordTeardownOutcome({
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation,
        outcome: "proven",
        occurredAt: nowIso(),
        diagnosticMessage: message,
        metadata: { reason: "owned_supervisor_proof" },
      }),
    ),
  );
  if (outcome._tag === "Failure") {
    const cause = outcome.failure;
    const failureMessage = cause instanceof Error ? cause.message : String(cause);
    return finished({ kind: "failed", error: failureMessage });
  }
  if (outcome.success.kind === "stale_generation") {
    return finished({ kind: "stale_generation" });
  }
  const settled = outcome.success.execution;
  if (isTerminalState(settled.observedState) && settled.observedState !== "cancelled") {
    // Terminal truth won the race inside the transaction.
    return finished({ kind: "already_terminal" });
  }
  return finished({
    kind: "settled_proven",
    fencedGeneration: settled.generation,
  });
};

type TeardownOneResult = {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
  readonly outcome: PiSubagentProcessTeardownOutcome;
};

/**
 * Runs one owned process-tree teardown pass over durable execution truth.
 * Candidates: non-terminal executions whose journal carries the ticket 15
 * band-74 teardown-handoff row for the CURRENT attempt/generation (the
 * watchdog already skips those; this coordinator owns them next). Every
 * other execution — graceful cancels (seq 92) and normal terminals
 * (band 40) never journal 74 — is skipped without dispatch (T16-AC6).
 * The pass is bounded (default 64 executions, T16-AC7).
 */
export const runPiSubagentProcessTeardown = async (
  input: PiSubagentProcessTeardownInput,
): Promise<PiSubagentProcessTeardownResult> => {
  const maxPerPass =
    input.maxPerPass !== undefined && Number.isInteger(input.maxPerPass) && input.maxPerPass > 0
      ? input.maxPerPass
      : MAX_PI_SUBAGENT_TEARDOWN_PASS_EXECUTIONS;

  const listed = await Effect.runPromise(
    Effect.result(input.repository.listNonTerminalExecutions()),
  );
  if (listed._tag === "Failure") {
    // Repository unavailable: retry on the next pass; never throw.
    return { outcomes: [] };
  }

  const outcomes: TeardownOneResult[] = [];
  for (const execution of listed.success) {
    if (outcomes.length >= maxPerPass) {
      break;
    }
    const journal = await Effect.runPromise(
      Effect.result(input.repository.listJournalEvents(execution.executionId)),
    );
    if (journal._tag === "Failure") {
      continue;
    }
    // Entry predicate (T16-AC6): only a CURRENT attempt/generation
    // teardown-handoff row hands the execution to this stage.
    const handedOff = journal.success.some(
      (event) =>
        event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff &&
        event.attemptId === execution.attemptId &&
        event.generation === execution.generation,
    );
    if (!handedOff) {
      continue;
    }
    outcomes.push(await teardownOne(input, execution));
  }
  return { outcomes };
};
