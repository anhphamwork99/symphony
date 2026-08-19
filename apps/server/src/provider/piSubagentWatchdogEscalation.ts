import { Effect, Option } from "effect";

import type { PiSubagentDiagnosticCode, PiSubagentExecutionRecord } from "@synara/contracts";

import { DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT } from "../config.ts";
import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { PiSubagentActiveChild, PiSubagentExtensionBridge } from "./piSubagentBridge.ts";
import { cancelParentTurnScope } from "./piSubagentCancellationCoordinator.ts";
import { isTerminalPiSubagentState } from "./piSubagentLifecycleStates.ts";

/**
 * Ticket 15 — Watchdog escalation through provider-session stop.
 *
 * A managed execution that exceeds its idle or wall-time policy enters a
 * bounded, evidence-driven escalation sequence (spec Implementation
 * Decision 26):
 *
 *   stage 1 — child abort (the ticket 06 durable cancel protocol),
 *   stage 2 — provider-turn interrupt,
 *   stage 3 — provider-session stop,
 *   handoff — owned process-tree teardown (Ticket 16 consumes this stage).
 *
 * Every stage journals its command and result (band 70–74, one
 * deterministic idempotent record per execution/attempt/generation/stage —
 * the journal's
 * UNIQUE(execution, attempt, generation, sequence) forces one sequence per
 * stage), waits for its stage-appropriate evidence within the configured
 * stage timeout, and the projection preserves honest `cancelling` state
 * until termination is PROVED. Timer expiry alone is never termination
 * proof (T15-AC5): the watchdog never writes a terminal state — settlement
 * flows exclusively through the normal lifecycle paths
 * (`recordCancelledAck`, `recordTerminalEvent`) exactly once (T15-AC4).
 *
 * Entry policy (durable evidence, never producer-supplied truth):
 * - WALL-TIME: a band-60 `pi_subagent_walltime_expired` journal row exists
 *   for the CURRENT attempt/generation (the ticket 13 durable trigger).
 * - IDLE: the re-derived lease (last_heartbeat_at + leaseDurationMs against
 *   the server clock — the stored lease_expires_at is never trusted,
 *   Decisions 0009–0013 standing obligation) has been expired beyond the
 *   configured idle threshold with no heartbeat since. This coordinator is
 *   the production lease-expiry sweep driver Ticket 10 recorded as Ticket 15
 *   scope: here lease expiry ESCALATES control first (spec Decision 26);
 *   orphaning remains the restart-side reconciliation concern.
 *
 * Session-stop timeout or uncertain cleanup (T15-AC6) produces the stable
 * `pi_subagent_watchdog_cleanup_uncertain` diagnostic and journals a
 * teardown-handoff record so the process-teardown stage (Ticket 16) owns the
 * execution next. The handoff record itself does NOT fence the current
 * attempt/generation (Decision 0021 F3): a same-generation terminal arriving
 * before proven teardown remains ordinary lifecycle evidence (Decision 0012
 * first-applicable-terminal-wins); Ticket 16 owns proof-before-fence.
 */

/**
 * Attempt-local sequence band for watchdog escalation stage records. The
 * journal's UNIQUE(execution_id, attempt_id, generation, sequence) forces
 * one sequence per stage record: 70 = escalation started, 71 = child abort
 * timeout, 72 = provider-turn interrupt (command + observation), 73 =
 * provider-session stop (command + result), 74 = teardown handoff.
 */
export const PI_SUBAGENT_WATCHDOG_BAND = {
  escalationStarted: 70,
  childAbortTimeout: 71,
  providerTurnInterrupt: 72,
  providerSessionStop: 73,
  teardownHandoff: 74,
} as const;

/** Lowest sequence of the watchdog band (test/telemetry filter anchor). */
export const PI_SUBAGENT_WATCHDOG_ESCALATION_SEQUENCE = PI_SUBAGENT_WATCHDOG_BAND.escalationStarted;

export const PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_watchdog_walltime_escalation";
export const PI_SUBAGENT_WATCHDOG_IDLE_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_watchdog_idle_escalation";
export const PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_watchdog_stage_timeout";
export const PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_watchdog_cleanup_uncertain";
/**
 * Decision 0022 F2: truthful code for "applicable terminal evidence ended
 * escalation" — distinct from both stage timeouts and an actual
 * provider-session stop.
 */
export const PI_SUBAGENT_WATCHDOG_TERMINAL_EVIDENCE_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_watchdog_terminal_evidence";
export const PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC: PiSubagentDiagnosticCode =
  "pi_subagent_watchdog_session_stopped";

/** Result of a dispatched provider-session stop (T15-AC3/AC6). */
export type PiSubagentWatchdogSessionStopResult = "stopped" | "uncertain";

export interface PiSubagentWatchdogEscalationInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  /**
   * Extension bridge resolver per parent thread (undefined = no live
   * session / dispatch failure). The watchdog spans every session of the
   * adapter, so the bridge — and with it the cancel dispatch — is resolved
   * per execution from live session truth.
   */
  readonly resolveBridge: (threadId: string) => PiSubagentExtensionBridge | undefined;
  /** Owner-death probe from server-tracked session truth. */
  readonly isOwnerGenerationDead: () => boolean;
  /** Live active-children probe for one parent thread's bridge. */
  readonly listActive: (threadId: string) => ReadonlyArray<PiSubagentActiveChild> | undefined;
  /** Stage 2 control: interrupt the provider turn. */
  readonly interruptProviderTurn: (threadId: string) => Promise<void>;
  /**
   * Stage 3 control: stop the provider session. Resolves `"stopped"` when
   * the stop command completed, `"uncertain"` when cleanup could not be
   * proved (T15-AC6). A promise that never resolves is bounded by the stage
   * timeout and journaled as result `"timeout"`.
   */
  readonly stopProviderSession: (threadId: string) => Promise<PiSubagentWatchdogSessionStopResult>;
  /** Per-stage evidence wait bound in milliseconds (config knob). */
  readonly stageTimeoutMs?: number | undefined;
  /** Bounded retry limit forwarded to the ticket 06 cancel protocol. */
  readonly cancelRetryLimit?: number | undefined;
  /** Lease duration for the server-side lease re-derivation. */
  readonly leaseDurationMs?: number | undefined;
  /** Idle threshold: re-derived lease expired this long with no heartbeat. */
  readonly idleAfterMs?: number | undefined;
  /** Injectable clock (epoch ms) for deterministic tests. */
  readonly now?: () => number;
  /** Injectable sleep for deterministic retry tests. */
  readonly sleep?: (ms: number) => Effect.Effect<void>;
  /**
   * Injectable real-time wait used by the stage-2 post-dispatch
   * terminal-evidence window (F1, Decision 0021). Production defaults to a
   * setTimeout-based wait; deterministic tests inject a controllable one.
   */
  readonly wait?: (ms: number) => Promise<void>;
  /** Evidence poll interval inside the stage-2 window (default 50ms). */
  readonly evidencePollMs?: number | undefined;
  /**
   * Safe operator observation: fixed diagnostic vocabulary plus the safe
   * correlation identity (execution/attempt/generation/thread) and the
   * escalation stage that produced it — never prompt, result, or transcript
   * content. The stage identity disambiguates diagnostics that share a code
   * across stages (e.g. `pi_subagent_watchdog_stage_timeout` at bands 71
   * and 72).
   */
  readonly onDiagnostic?:
    | ((event: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly generation: number;
        readonly parentThreadId: string;
        readonly stage:
          | "escalation_started"
          | "child_abort_timeout"
          | "provider_turn_interrupt"
          | "provider_session_stop"
          | "teardown_handoff"
          | "failure";
        readonly diagnosticCode: PiSubagentDiagnosticCode;
        readonly diagnosticMessage: string;
      }) => void)
    | undefined;
}

export type PiSubagentWatchdogEscalationOutcome =
  | { readonly kind: "settled_by_evidence"; readonly evidence: string }
  | { readonly kind: "already_terminal" }
  | { readonly kind: "stale_generation" }
  | { readonly kind: "cleanup_uncertain" }
  | { readonly kind: "failed"; readonly error: string };

export interface PiSubagentWatchdogEscalationEntry {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
  readonly trigger: "wall_time" | "idle";
  readonly outcome: PiSubagentWatchdogEscalationOutcome;
}

export interface PiSubagentWatchdogEscalationResult {
  readonly escalations: ReadonlyArray<PiSubagentWatchdogEscalationEntry>;
}

interface WatchdogCandidate {
  readonly execution: PiSubagentExecutionRecord;
  readonly trigger: "wall_time" | "idle";
}

const DEFAULT_STAGE_TIMEOUT_MS = 10000;
const DEFAULT_IDLE_AFTER_MS = 60000;
const DEFAULT_LEASE_DURATION_MS = 30000;

/**
 * Re-derive lease expiry server-side: expiry = last_heartbeat_at +
 * leaseDurationMs + beyondMs against the SERVER clock. A missing or
 * unparseable heartbeat is never liveness evidence (returns expired) — idle
 * escalation fires only when the execution has no fresh heartbeat and is
 * non-terminal, exactly like the ticket 10 owner-loss path.
 */
const isLeaseExpiredBeyond = (
  lastHeartbeatAt: string | null | undefined,
  leaseDurationMs: number,
  nowMs: number,
  beyondMs: number,
): boolean => {
  if (lastHeartbeatAt === null || lastHeartbeatAt === undefined) {
    return true;
  }
  const lastHeartbeatMs = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(lastHeartbeatMs)) {
    return true;
  }
  return nowMs >= lastHeartbeatMs + leaseDurationMs + beyondMs;
};

/**
 * Journal-first stage record (band 70–74, exactly one per stage) through the
 * journal-only repository seam: the row NEVER mutates the aggregate (a
 * stage record is control evidence, not a lifecycle transition), so a
 * concurrent terminal settlement can never be overwritten by escalation
 * bookkeeping (T15-AC4/AC5). The deterministic eventId per (execution,
 * attempt, generation, sequence) makes re-escalation idempotent — the
 * repository dedup returns already_applied and no duplicate history
 * accumulates for a wedged execution. Journal writes are best-effort at
 * this layer: a failing write is reported through onDiagnostic and the
 * stage still dispatches — the durable cancel intent (seq 90) inside stage
 * 1 is the authoritative control write, and a lost observation row must not
 * wedge the escalation chain.
 */
const journalStageRecord = async (
  input: PiSubagentWatchdogEscalationInput,
  execution: PiSubagentExecutionRecord,
  sequence: number,
  diagnosticCode: PiSubagentDiagnosticCode,
  metadata: Record<string, unknown>,
  nowIso: string,
): Promise<void> => {
  const result = await Effect.runPromise(
    Effect.result(
      input.repository.recordWatchdogStageEvent({
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation,
        sequence,
        state: execution.observedState,
        occurredAt: nowIso,
        diagnosticCode,
        diagnosticMessage: `Watchdog escalation stage record (sequence ${sequence})`,
        metadata: { phase: "watchdog_escalation", ...metadata },
      }),
    ),
  );
  if (result._tag === "Failure") {
    input.onDiagnostic?.({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      parentThreadId: String(execution.parentThreadId),
      stage: "failure",
      diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
      diagnosticMessage: `Watchdog stage journal write failed (sequence ${sequence}); escalation continues on durable cancel intent`,
    });
  }
};

interface EscalateOneInput {
  readonly input: PiSubagentWatchdogEscalationInput;
  readonly candidate: WatchdogCandidate;
}

const escalateOne = async ({
  input,
  candidate,
}: EscalateOneInput): Promise<PiSubagentWatchdogEscalationEntry> => {
  const { execution } = candidate;
  const now = input.now ?? (() => Date.now());
  const nowIso = () => new Date(now()).toISOString();
  const stageTimeoutMs =
    input.stageTimeoutMs !== undefined && input.stageTimeoutMs > 0
      ? input.stageTimeoutMs
      : DEFAULT_STAGE_TIMEOUT_MS;

  const reportDiagnostic = (event: {
    readonly stage:
      | "escalation_started"
      | "child_abort_timeout"
      | "provider_turn_interrupt"
      | "provider_session_stop"
      | "teardown_handoff"
      | "failure";
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }): void => {
    input.onDiagnostic?.({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      parentThreadId: String(execution.parentThreadId),
      ...event,
    });
  };

  const finished = (
    outcome: PiSubagentWatchdogEscalationOutcome,
  ): PiSubagentWatchdogEscalationEntry => ({
    executionId: execution.executionId,
    attemptId: execution.attemptId,
    generation: execution.generation,
    parentThreadId: String(execution.parentThreadId),
    trigger: candidate.trigger,
    outcome,
  });

  const isTerminalNow = async (): Promise<boolean> => {
    const current = await Effect.runPromise(
      Effect.result(input.repository.getById(execution.executionId)),
    );
    if (current._tag === "Failure") {
      return false;
    }
    return (
      Option.isSome(current.success) &&
      isTerminalPiSubagentState(current.success.value.observedState)
    );
  };

  const threadId = String(execution.parentThreadId);
  const bridge = input.resolveBridge(threadId);

  const childStillActive = (): boolean => {
    const active = input.listActive(threadId);
    return (
      active?.some(
        (child) =>
          child.executionId === execution.executionId &&
          child.attemptId === execution.attemptId &&
          child.generation === execution.generation &&
          child.isRunning,
      ) ?? false
    );
  };

  const waitMs =
    input.wait ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, ms));
        timer.unref?.();
      }));
  const evidencePollMs =
    input.evidencePollMs !== undefined && input.evidencePollMs > 0 ? input.evidencePollMs : 50;

  /**
   * F1 (Decision 0021): after a dispatched stage command resolves, wait the
   * REMAINING stage window for applicable durable terminal/cancellation
   * evidence before advancing. Command resolution alone is never evidence.
   * The window is bounded by poll count (stageTimeoutMs / evidencePollMs) so
   * an injected frozen clock cannot wedge the loop; each poll pays one
   * evidencePollMs wait.
   */
  const waitForTerminalEvidence = async (
    deadlineMs: number,
    onPoll?: (poll: number) => void,
  ): Promise<boolean> => {
    const remainingMs = Math.max(0, deadlineMs - now());
    const maxPolls = Math.ceil(remainingMs / evidencePollMs);
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (await isTerminalNow()) {
        return true;
      }
      onPoll?.(poll);
      await waitMs(Math.min(evidencePollMs, remainingMs - poll * evidencePollMs));
    }
    return await isTerminalNow();
  };

  /**
   * Race a stage action against the stage timeout. Resolves `"timed_out"`
   * when the bound elapsed first, `"failed"` when the action rejected, or
   * `"completed"` with the action's value otherwise — a void-resolving
   * action is distinguishable from a timeout by the marker, not the value.
   */
  const raceStageTimeout = async <T>(
    action: () => Promise<T>,
  ): Promise<
    | { readonly status: "timed_out" }
    | { readonly status: "failed" }
    | { readonly status: "completed"; readonly value: T }
  > => {
    let settled = false;
    const actionPromise = Promise.resolve()
      .then(action)
      .then(
        (value) => {
          settled = true;
          return { status: "completed" as const, value };
        },
        () => {
          settled = true;
          return { status: "failed" as const };
        },
      );
    const timeoutPromise = new Promise<{ readonly status: "timed_out" }>((resolve) => {
      setTimeout(
        () => {
          if (!settled) {
            resolve({ status: "timed_out" as const });
          }
        },
        Math.max(0, stageTimeoutMs),
      );
    });
    return Promise.race([actionPromise, timeoutPromise]);
  };

  // Entry diagnostic + journaled escalation start (T15-AC1).
  const entryDiagnostic =
    candidate.trigger === "wall_time"
      ? PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC
      : PI_SUBAGENT_WATCHDOG_IDLE_DIAGNOSTIC;
  const entryMessage =
    candidate.trigger === "wall_time"
      ? "Execution wall-time budget expired; watchdog escalation started"
      : "Execution idle (re-derived lease expired beyond threshold with no heartbeat); watchdog escalation started";
  reportDiagnostic({
    stage: "escalation_started",
    diagnosticCode: entryDiagnostic,
    diagnosticMessage: entryMessage,
  });
  await journalStageRecord(
    input,
    execution,
    PI_SUBAGENT_WATCHDOG_BAND.escalationStarted,
    candidate.trigger === "wall_time"
      ? PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC
      : PI_SUBAGENT_WATCHDOG_IDLE_DIAGNOSTIC,
    { trigger: candidate.trigger, stageTimeoutMs },
    nowIso(),
  );

  // ---- Stage 1: child abort (ticket 06 durable cancel protocol) ----
  const cancelOutcome = await Effect.runPromise(
    Effect.result(
      cancelParentTurnScope({
        threadId,
        repository: input.repository,
        bridge,
        isOwnerGenerationDead: input.isOwnerGenerationDead,
        listActive: () => input.listActive(threadId),
        cancelAckTimeoutMs: stageTimeoutMs,
        cancelRetryLimit: input.cancelRetryLimit ?? DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT,
        leaseDurationMs: input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
        ...(input.now ? { now: input.now } : {}),
        ...(input.sleep ? { sleep: input.sleep } : {}),
        onDiagnostic: (event) => {
          reportDiagnostic({
            stage: "child_abort_timeout",
            diagnosticCode: event.diagnosticCode as PiSubagentDiagnosticCode,
            diagnosticMessage: event.diagnosticMessage,
          });
        },
      }),
    ),
  );

  if (cancelOutcome._tag === "Failure") {
    const cause = cancelOutcome.failure;
    const message = cause instanceof Error ? cause.message : String(cause);
    return finished({ kind: "failed", error: message });
  }

  // Evidence check after stage 1 (T15-AC4): ack / owner-death / terminal.
  for (const outcome of cancelOutcome.success.outcomes) {
    if (outcome.executionId !== execution.executionId) {
      continue;
    }
    if (outcome.kind === "cancelled_ack" || outcome.kind === "cancelled_owner_death") {
      return finished({ kind: "settled_by_evidence", evidence: outcome.kind });
    }
    if (outcome.kind === "already_terminal") {
      return finished({ kind: "already_terminal" });
    }
    if (outcome.kind === "stale_generation") {
      return finished({ kind: "stale_generation" });
    }
  }

  // No stage-1 evidence: journal the timeout (T15-AC2) — the projection
  // stays `cancelling`; nothing has been claimed.
  reportDiagnostic({
    stage: "child_abort_timeout",
    diagnosticCode: PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
    diagnosticMessage:
      "Child abort acknowledgement missing within the stage timeout; escalating to provider-turn interrupt without claiming stopped or cancelled",
  });
  await journalStageRecord(
    input,
    execution,
    PI_SUBAGENT_WATCHDOG_BAND.childAbortTimeout,
    PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
    { trigger: candidate.trigger },
    nowIso(),
  );

  // ---- Stage 2: provider-turn interrupt ----
  // F1 (Decision 0021): the stage deadline covers BOTH the command dispatch
  // and a post-dispatch terminal-evidence window — a quickly resolving
  // interrupt must not advance to session stop while durable terminal
  // evidence is still inbound.
  const stage2Deadline = now() + stageTimeoutMs;
  const interruptRace = await raceStageTimeout(() => input.interruptProviderTurn(threadId));
  let interruptObserved: "terminal_evidence" | "child_still_active" | "child_not_active";
  if (interruptRace.status === "completed") {
    const evidenceArrived = await waitForTerminalEvidence(stage2Deadline);
    interruptObserved = evidenceArrived
      ? "terminal_evidence"
      : childStillActive()
        ? "child_still_active"
        : "child_not_active";
  } else {
    // Dispatch itself timed out or failed: no accepted command means no
    // evidence window — the observation is the live probe only.
    interruptObserved = childStillActive() ? "child_still_active" : "child_not_active";
  }
  await journalStageRecord(
    input,
    execution,
    PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
    interruptObserved === "terminal_evidence"
      ? PI_SUBAGENT_WATCHDOG_TERMINAL_EVIDENCE_DIAGNOSTIC
      : PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
    {
      dispatched: interruptRace.status === "completed",
      observed: interruptObserved,
    },
    nowIso(),
  );
  if (interruptObserved === "terminal_evidence") {
    reportDiagnostic({
      stage: "provider_turn_interrupt",
      diagnosticCode: PI_SUBAGENT_WATCHDOG_TERMINAL_EVIDENCE_DIAGNOSTIC,
      diagnosticMessage:
        "Provider-turn interrupt surfaced durable terminal evidence before the stage deadline; escalation settled by evidence",
    });
    return finished({ kind: "settled_by_evidence", evidence: "terminal_after_interrupt" });
  }

  // Decision 0023 condition 1: the no-evidence outcome of the stage-2
  // window gets its OWN operator event — distinct from the band-71 child-
  // abort timeout by stage identity. The durable band-72 row and the
  // operator surface both say "stage 2 timed out without evidence";
  // nothing has been claimed stopped or cancelled.
  reportDiagnostic({
    stage: "provider_turn_interrupt",
    diagnosticCode: PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
    diagnosticMessage:
      "Provider-turn interrupt dispatched but no terminal evidence arrived within the stage-2 window; escalating to provider-session stop without claiming stopped or cancelled",
  });

  // ---- Stage 3: provider-session stop ----
  const stopRace = await raceStageTimeout(() => input.stopProviderSession(threadId));
  if (stopRace.status === "timed_out" || stopRace.status === "failed") {
    // T15-AC6: session-stop timeout — stable diagnostics, journaled command
    // + result, teardown handoff. Never claim success.
    reportDiagnostic({
      stage: "provider_session_stop",
      diagnosticCode: PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
      diagnosticMessage:
        "Provider-session stop timed out; cleanup is uncertain and the execution is handed to the process-teardown stage",
    });
    await journalStageRecord(
      input,
      execution,
      PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
      PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
      { dispatched: true, result: stopRace.status === "failed" ? "failed" : "timeout" },
      nowIso(),
    );
    reportDiagnostic({
      stage: "teardown_handoff",
      diagnosticCode: PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
      diagnosticMessage:
        "Watchdog cleanup remains uncertain: the session stop could not be proven and the owned execution is handed to the process-teardown stage",
    });
    await journalStageRecord(
      input,
      execution,
      PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
      { reason: "session_stop_timeout" },
      nowIso(),
    );
    return finished({ kind: "cleanup_uncertain" });
  }

  if (stopRace.value === "stopped") {
    await journalStageRecord(
      input,
      execution,
      PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
      PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC,
      { dispatched: true, result: "stopped" },
      nowIso(),
    );
    if (await isTerminalNow()) {
      return finished({ kind: "settled_by_evidence", evidence: "terminal_after_session_stop" });
    }
    // The command completed, but command completion is not child
    // termination proof (T15-AC5): the honest state remains `cancelling`
    // and the teardown stage (Ticket 16) must prove the process tree.
    reportDiagnostic({
      stage: "teardown_handoff",
      diagnosticCode: PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC,
      diagnosticMessage:
        "Provider session stopped by watchdog; the owned execution awaits process-teardown proof before settling",
    });
    await journalStageRecord(
      input,
      execution,
      PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
      { reason: "session_stopped" },
      nowIso(),
    );
    return finished({ kind: "cleanup_uncertain" });
  }

  // stopResult === "uncertain": stable diagnostic + teardown handoff.
  reportDiagnostic({
    stage: "teardown_handoff",
    diagnosticCode: PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
    diagnosticMessage:
      "Watchdog cleanup remains uncertain: the session stop could not be proven and the owned execution is handed to the process-teardown stage",
  });
  await journalStageRecord(
    input,
    execution,
    PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
    PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
    { dispatched: true, result: "uncertain" },
    nowIso(),
  );
  await journalStageRecord(
    input,
    execution,
    PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
    PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
    { reason: "session_stop_uncertain" },
    nowIso(),
  );
  return finished({ kind: "cleanup_uncertain" });
};

/**
 * Runs one watchdog escalation pass over durable execution truth. Selection
 * is pure with respect to the repository: candidates come from band-60
 * journal rows for the current attempt/generation (wall-time) or the
 * re-derived idle policy — never from producer-supplied timestamps. An
 * execution whose journal already carries the teardown-handoff record has
 * exhausted this watchdog's stages and stays owned by Ticket 16.
 */
export const runPiSubagentWatchdogEscalation = async (
  input: PiSubagentWatchdogEscalationInput,
): Promise<PiSubagentWatchdogEscalationResult> => {
  const now = input.now ?? (() => Date.now());
  const leaseDurationMs =
    input.leaseDurationMs !== undefined && input.leaseDurationMs > 0
      ? input.leaseDurationMs
      : DEFAULT_LEASE_DURATION_MS;
  const idleAfterMs =
    input.idleAfterMs !== undefined && input.idleAfterMs >= 0
      ? input.idleAfterMs
      : DEFAULT_IDLE_AFTER_MS;

  const listed = await Effect.runPromise(
    Effect.result(input.repository.listNonTerminalExecutions()),
  );
  if (listed._tag === "Failure") {
    // Repository unavailable: retry on the next sweep; never throw into the
    // timer loop.
    return { escalations: [] };
  }

  const escalations: PiSubagentWatchdogEscalationEntry[] = [];
  for (const execution of listed.success) {
    const journal = await Effect.runPromise(
      Effect.result(input.repository.listJournalEvents(execution.executionId)),
    );
    if (journal._tag === "Failure") {
      continue;
    }

    // Skip executions already handed to the teardown stage (Ticket 16 owns
    // them; re-escalation would re-dispatch settled stage commands).
    if (
      journal.success.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff)
    ) {
      continue;
    }

    let trigger: "wall_time" | "idle" | undefined;
    if (
      journal.success.some(
        (event) =>
          event.sequence === 60 &&
          event.attemptId === execution.attemptId &&
          event.generation === execution.generation,
      )
    ) {
      trigger = "wall_time";
    } else {
      const observation = await Effect.runPromise(
        Effect.result(input.repository.getObservation(execution.executionId)),
      );
      let lastHeartbeatAt: string | null = null;
      if (observation._tag === "Success" && Option.isSome(observation.success)) {
        lastHeartbeatAt = observation.success.value.lastHeartbeatAt ?? null;
      }
      if (lastHeartbeatAt === null) {
        // No heartbeat was ever observed. A missing heartbeat is never
        // liveness evidence, but it must not fire the idle trigger on the
        // FIRST sweep either: the age of the no-heartbeat state is measured
        // from the aggregate's durable updatedAt (admission or the latest
        // lifecycle write), so a freshly admitted or just-resumed execution
        // gets the full lease + idle threshold before escalation.
        const updatedMs = Date.parse(execution.updatedAt);
        if (Number.isFinite(updatedMs) && now() < updatedMs + leaseDurationMs + idleAfterMs) {
          continue;
        }
        trigger = "idle";
      } else if (isLeaseExpiredBeyond(lastHeartbeatAt, leaseDurationMs, now(), idleAfterMs)) {
        trigger = "idle";
      }
    }

    if (trigger === undefined) {
      continue;
    }

    escalations.push(
      await escalateOne({
        input,
        candidate: { execution, trigger },
      }),
    );
  }
  return { escalations };
};
