// FILE: piSubagentResumeCoordinator.ts
// Purpose: Ticket 14 (T14-AC1..AC6) explicit resume with a new attempt. An
// authorized user resumes ONE orphaned managed Pi subagent execution: the
// logical `executionId` is kept, a fresh `attemptId` is minted, the generation
// advances, the SAME authorization/admission gates as a new spawn re-run
// (project/thread authorization, active-turn policy, quotas, admission), and
// exactly one new child attempt starts — only after the resume journal event
// committed durably (queued, new attempt/generation). Nothing resumes
// automatically: the only trigger is the explicit user resume command routed
// through `thread.pi-subagent-execution.resume` → reactor → adapter → this
// coordinator. Late events, terminals, cancels, and completions from the
// superseded attempt remain generation-fenced (ignored and counted).
// Layer: Server provider coordinator (pure Effect; repository-injected)
// Exports: PI_SUBAGENT_RESUME_SEQUENCE, resumePiSubagentExecution

import { randomUUID } from "node:crypto";
import type {
  PiSubagentExecutionRecord,
  PiSubagentNegotiatedCapability,
  PiSubagentSpawnResult,
} from "@synara/contracts";
import { Effect, Option } from "effect";

import type {
  AdmissionSnapshotQuery,
  PiSubagentAdmissionArbiter,
  PiSubagentAdmissionPolicy,
  TrustedAdmissionContext,
} from "./piSubagentAdmissionCoordinator.ts";
import type { McpSessionAuthorityShape } from "../agentGateway/Services/McpSessionAuthority.ts";
import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type {
  PiSubagentControlHealthShape,
  PiSubagentControlHealthTransition,
} from "./piSubagentControlHealth.ts";
import { runAdmissionAuthorizationGates } from "./piSubagentAdmissionCoordinator.ts";

/**
 * Attempt-local sequence band for explicit resume events (Ticket 14).
 * Band 70–74 is reserved to Ticket 15 watchdog escalation; 80 is deliberately
 * disjoint so a resumed attempt can later persist every watchdog stage.
 */
export const PI_SUBAGENT_RESUME_SEQUENCE = 80;

export const PI_SUBAGENT_RESUME_DIAGNOSTIC_MESSAGE =
  "Explicit resume: a new attempt started under the same execution identity. " +
  "Prior-attempt evidence is retained in the journal; late events from the " +
  "superseded attempt are ignored.";

export interface ResumePiSubagentExecutionInput {
  /** The orphaned execution to resume (correlation, never authority). */
  readonly executionId: string;
  /** Owning parent thread (authorization correlation). */
  readonly threadId: string;
  readonly sessionCapability?: PiSubagentNegotiatedCapability;
  readonly snapshotQuery: AdmissionSnapshotQuery;
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly controlHealth?: PiSubagentControlHealthShape;
  readonly trustedContext: TrustedAdmissionContext;
  readonly authorityRegistry?: Pick<McpSessionAuthorityShape, "assertAdmittable">;
  readonly admissionPolicy?: PiSubagentAdmissionPolicy | null;
  /** Optional adapter-owned arbiter shared with the spawn path. */
  readonly admissionArbiter?: PiSubagentAdmissionArbiter;
  readonly onHealthTransition?: (transition: PiSubagentControlHealthTransition) => void;
  /**
   * Starts the new child attempt AFTER the resume journal event committed.
   * The launcher is the adapter's captured managed Agent-tool execute with
   * the resumed identities — it must never re-run admission (the gates and
   * the durable resume already ran here).
   */
  readonly launchChildAttempt: (attempt: {
    readonly execution: PiSubagentExecutionRecord;
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
  }) => Promise<void>;
  readonly now?: () => number;
}

export type PiSubagentResumeOutcome =
  | {
      /** Resume committed and the child launcher was invoked once. */
      readonly kind: "resumed";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
    }
  | {
      /** Replay of the same resume identity — NO second attempt, NO child. */
      readonly kind: "already_applied";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
    }
  | {
      /** The execution does not exist (denial: no child). */
      readonly kind: "not_found";
      readonly executionId: string;
    }
  | {
      /** The execution is not in the resumable `orphaned` state (denial). */
      readonly kind: "invalid_state";
      readonly executionId: string;
      readonly observedState: PiSubagentExecutionRecord["observedState"];
    }
  | {
      /** The aggregate advanced past the read attempt/generation (race). */
      readonly kind: "stale_generation";
      readonly executionId: string;
    }
  | {
      /** A shared admission gate refused the resume (authorization, active
       * turn, approval, subject authority, or quota) — no child, no mutation. */
      readonly kind: "gate_denied";
      readonly executionId: string;
      readonly diagnosticCode: PiSubagentSpawnResult["diagnosticCode"];
      readonly rejectionReason: string;
    }
  | {
      /** The session is not managed-capable (handshake absent/failed). */
      readonly kind: "unmanaged_session";
      readonly executionId: string;
      readonly diagnosticCode: string;
      readonly diagnosticMessage: string;
    }
  | {
      /** The durable resume write failed — no child started. */
      readonly kind: "persistence_failed";
      readonly executionId: string;
      readonly error: string;
    }
  | {
      /** The resume committed but launching the child threw. The new attempt
       * stays durably `queued`; reconciliation/wall-time settle it honestly. */
      readonly kind: "child_start_failed";
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
      readonly error: string;
    };

/**
 * Ticket 14 explicit resume (T14-AC1/AC4/AC6). Order of operations:
 *   1. capability gate (managed sessions only),
 *   2. load durable execution truth (missing → not_found),
 *   3. re-run the SHARED admission authorization gates with a derived command
 *      carrying the execution's project/thread + the CURRENT trusted active
 *      turn (denial → gate_denied, no child, no mutation),
 *   4. mint the new attempt, durably journal the resume (queued, generation
 *      advanced) BEFORE any child start (T14-AC1),
 *   5. launch exactly one child attempt; a launch failure leaves the honest
 *      durable `queued` state and surfaces child_start_failed.
 *
 * Idempotency: the deterministic resume event identity scoped to the SOURCE
 * attempt/generation makes a replayed resume return `already_applied` with
 * the committed (new) aggregate and start no second child (T14-AC1: exactly
 * one new attemptId).
 */
export const resumePiSubagentExecution = (
  input: ResumePiSubagentExecutionInput,
  // Unknown error channel mirrors the admission coordinator contract.
): Effect.Effect<PiSubagentResumeOutcome, unknown> =>
  Effect.gen(function* () {
    // 1. Capability handshake (managed sessions only — same gate as spawn).
    if (
      !input.sessionCapability ||
      !input.sessionCapability.isManaged ||
      input.sessionCapability.status !== "managed_enabled"
    ) {
      return {
        kind: "unmanaged_session",
        executionId: input.executionId,
        diagnosticCode: input.sessionCapability?.diagnosticCode ?? "pi_subagent_bridge_absent",
        diagnosticMessage:
          input.sessionCapability?.diagnosticMessage ??
          "Pi subagent managed execution is not enabled for this session",
      } satisfies PiSubagentResumeOutcome;
    }

    // 2. Durable execution truth (T14-AC2/AC4): the resume targets a
    //    non-terminal `orphaned` execution; identity is correlation only.
    const lookup = yield* Effect.result(input.repository.getById(input.executionId));
    if (lookup._tag === "Failure") {
      return {
        kind: "persistence_failed",
        executionId: input.executionId,
        error: "Execution lookup is unavailable; resume is refused (fail-closed)",
      } satisfies PiSubagentResumeOutcome;
    }
    if (Option.isNone(lookup.success)) {
      return {
        kind: "not_found",
        executionId: input.executionId,
      } satisfies PiSubagentResumeOutcome;
    }
    const execution = lookup.success.value;

    // 3. The SAME admission gates as a new spawn (T14-AC4): the derived
    //    command carries the execution's durable project/thread identity plus
    //    the CURRENT trusted active turn (the resume runs under whatever turn
    //    the user is in; the parent scope re-binds to it in the resume write).
    const gateOutcome = yield* runAdmissionAuthorizationGates({
      command: {
        commandId: `resumecmd_${execution.executionId}_${execution.attemptId}_gen${execution.generation}_${input.threadId}`,
        clientCommandId: null,
        projectId: execution.projectId,
        parentThreadId: execution.parentThreadId,
        parentTurnId: input.trustedContext.trustedActiveTurnId,
        parentToolCallId: execution.parentToolCallId,
        agentType: execution.agentType,
        prompt: execution.prompt,
        ...(execution.delegationContext === undefined
          ? {}
          : { delegationContext: execution.delegationContext }),
        ...(execution.delegationLinkReferences === undefined
          ? {}
          : { delegationLinkReferences: execution.delegationLinkReferences }),
        ...(execution.delegationExpectedOutcome === undefined
          ? {}
          : { delegationExpectedOutcome: execution.delegationExpectedOutcome }),
        ...(execution.resolvedModel === undefined
          ? {}
          : { resolvedModel: execution.resolvedModel }),
        mode: execution.mode,
        cancellationScope: execution.cancellationScope,
      },
      snapshotQuery: input.snapshotQuery,
      repository: input.repository,
      trustedContext: input.trustedContext,
      authorityRegistry: input.authorityRegistry,
      admissionPolicy: input.admissionPolicy,
    });
    if (!gateOutcome.ok) {
      return {
        kind: "gate_denied",
        executionId: execution.executionId,
        diagnosticCode: gateOutcome.diagnosticCode,
        rejectionReason: gateOutcome.rejectionReason,
      } satisfies PiSubagentResumeOutcome;
    }

    // 4. Mint the new attempt and durably record the resume BEFORE any child
    //    start (T14-AC1). The deterministic event identity (scoped to the
    //    SOURCE attempt/generation) makes replays already_applied with no
    //    second child.
    const newAttemptId = `att_${randomUUID()}`;
    const nowIso = new Date((input.now ?? Date.now)()).toISOString();
    const resumeResult = yield* Effect.result(
      input.repository.recordResumeEvent({
        executionId: execution.executionId,
        expectedAttemptId: execution.attemptId,
        expectedGeneration: execution.generation,
        newAttemptId,
        parentTurnId: input.trustedContext.trustedActiveTurnId,
        occurredAt: nowIso,
        diagnosticMessage: PI_SUBAGENT_RESUME_DIAGNOSTIC_MESSAGE,
      }),
    );

    if (resumeResult._tag === "Failure") {
      const error = resumeResult.failure;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (input.controlHealth) {
        const transition = yield* Effect.result(
          input.controlHealth.markDegraded(
            `Failed to persist resume lifecycle truth: ${errorMessage}`,
            "pi_subagent_resume_persistence_failed",
            { threadId: execution.parentThreadId },
          ),
        );
        if (transition._tag === "Success" && transition.success !== null) {
          input.onHealthTransition?.(transition.success);
        }
      }
      return {
        kind: "persistence_failed",
        executionId: execution.executionId,
        error: errorMessage,
      } satisfies PiSubagentResumeOutcome;
    }

    const settled = resumeResult.success;
    if (settled.kind === "stale_generation") {
      return {
        kind: "stale_generation",
        executionId: execution.executionId,
      } satisfies PiSubagentResumeOutcome;
    }
    if (settled.kind === "invalid_state") {
      return {
        kind: "invalid_state",
        executionId: execution.executionId,
        observedState: settled.execution.observedState,
      } satisfies PiSubagentResumeOutcome;
    }
    if (settled.kind === "already_applied") {
      // Idempotent replay: the attempt already exists — return the committed
      // aggregate identities and start NO second child (T14-AC1).
      return {
        kind: "already_applied",
        executionId: settled.execution.executionId,
        attemptId: settled.execution.attemptId,
        generation: settled.execution.generation,
      } satisfies PiSubagentResumeOutcome;
    }

    const resumed = settled.execution;

    // 5. Exactly one child attempt, launched only after the durable commit.
    //    A launch failure never rolls back journal-first truth: the attempt
    //    stays `queued` and reconciliation/wall-time settles it honestly.
    const launch = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          input.launchChildAttempt({
            execution: resumed,
            executionId: resumed.executionId,
            attemptId: resumed.attemptId,
            generation: resumed.generation,
          }),
        catch: (cause) => cause,
      }),
    );
    if (launch._tag === "Failure") {
      const cause = launch.failure;
      const errorMessage = cause instanceof Error ? cause.message : String(cause);
      return {
        kind: "child_start_failed",
        executionId: resumed.executionId,
        attemptId: resumed.attemptId,
        generation: resumed.generation,
        error: errorMessage,
      } satisfies PiSubagentResumeOutcome;
    }

    return {
      kind: "resumed",
      executionId: resumed.executionId,
      attemptId: resumed.attemptId,
      generation: resumed.generation,
    } satisfies PiSubagentResumeOutcome;
  });
