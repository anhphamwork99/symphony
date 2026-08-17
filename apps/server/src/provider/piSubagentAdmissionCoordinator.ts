import { createHash, randomUUID } from "node:crypto";
import {
  type OrchestrationReadModel,
  type PiSubagentNegotiatedCapability,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
  ProjectId,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import { Effect } from "effect";

import type { McpAuthorityBinding } from "../agentGateway/mcpSessionAuthority.ts";
import type { McpSessionAuthorityShape } from "../agentGateway/Services/McpSessionAuthority.ts";
import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type {
  PiSubagentControlHealthMarkContext,
  PiSubagentControlHealthShape,
  PiSubagentControlHealthTransition,
} from "./piSubagentControlHealth.ts";

export interface AdmissionSnapshotQuery {
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, unknown>;
}

/**
 * Server-minted trusted admission context (T20-AC5). Every value here is
 * derived inside the trusted server (session input, orchestration snapshot,
 * adapter constant, Decision-21 authority binding); identifiers supplied by
 * the extension never grant authority.
 */
export interface TrustedAdmissionContext {
  /** Server-minted session thread (ProviderSessionStartInput.threadId). */
  readonly trustedThreadId: ThreadId;
  /** Server snapshot truth for the thread's project. */
  readonly trustedProjectId: ProjectId;
  /** Server-tracked active turn for the session (null when idle). */
  readonly trustedActiveTurnId: TurnId | null;
  /** Adapter constant; only "pi" may admit managed Pi spawns. */
  readonly trustedProvider: string;
  /**
   * Full server-minted subject-bound MCP authority binding (Decision 21).
   * Missing (null) fails closed: the session has no provable subject
   * authority, so no managed spawn may start.
   */
  readonly mcpAuthority: McpAuthorityBinding | null;
}

export interface AdmitSubagentSpawnInput {
  readonly command: PiSubagentSpawnCommand;
  readonly sessionCapability?: PiSubagentNegotiatedCapability;
  readonly snapshotQuery: AdmissionSnapshotQuery;
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly controlHealth?: PiSubagentControlHealthShape;
  readonly trustedContext: TrustedAdmissionContext;
  /**
   * Live server authority registry admission check (McpSessionAuthority).
   * Absent while a binding exists fails closed: the binding cannot be
   * re-validated against server truth.
   */
  readonly authorityRegistry?: Pick<McpSessionAuthorityShape, "assertAdmittable">;
  /**
   * Operator observation seam for control-health status transitions
   * (Ticket 21). Called at most once per status change with safe metadata
   * only (from/to status, diagnostic code, timestamp, admission thread) —
   * never prompt, result, raw SQL, or rejection reason content.
   */
  readonly onHealthTransition?: (transition: PiSubagentControlHealthTransition) => void;
  readonly now?: string;
}

/**
 * Deterministic ownership fingerprint for a command identity. The replay scope
 * is (commandId, fingerprint): the same commandId under a different
 * subject/project/thread/turn/tool is a different command scope and can never
 * resolve to another execution's identities.
 */
export function computeCommandFingerprint(input: {
  readonly subject: string | null | undefined;
  readonly projectId: string;
  readonly parentThreadId: string;
  readonly parentTurnId: string | null | undefined;
  readonly parentToolCallId: string | null | undefined;
}): string {
  const parts = [
    input.subject ?? "",
    input.projectId,
    input.parentThreadId,
    input.parentTurnId ?? "",
    input.parentToolCallId ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

const rejectedResult = (
  input: Pick<AdmitSubagentSpawnInput, "command" | "repository">,
  fingerprint: string,
  now: string,
  diagnosticCode: PiSubagentSpawnResult["diagnosticCode"],
  rejectionReason: string,
) =>
  Effect.gen(function* () {
    const executionId = `exec_rejected_${randomUUID()}`;
    const attemptId = `att_rejected_${randomUUID()}`;
    // Rejected lifecycle truth commits durably (sequence 1, rejected) so the
    // audit trail and the terminal diagnostic survive restarts. Best-effort:
    // the terminal rejection is returned even if the audit write fails.
    yield* Effect.ignore(
      input.repository.recordAdmission({
        executionId,
        attemptId,
        generation: 1,
        commandId: input.command.commandId,
        commandFingerprint: fingerprint,
        clientCommandId: input.command.clientCommandId ?? null,
        projectId: input.command.projectId,
        parentThreadId: input.command.parentThreadId,
        parentTurnId: input.command.parentTurnId,
        parentToolCallId: input.command.parentToolCallId,
        agentType: input.command.agentType,
        prompt: input.command.prompt,
        mode: input.command.mode,
        cancellationScope: input.command.cancellationScope,
        state: "rejected",
        diagnosticCode,
        rejectionReason,
        now,
      }),
    );
    return {
      status: "rejected" as const,
      executionId,
      attemptId,
      generation: 1,
      state: "rejected" as const,
      diagnosticCode,
      rejectionReason,
    } satisfies PiSubagentSpawnResult;
  });

export const admitSubagentSpawn = (
  input: AdmitSubagentSpawnInput,
): Effect.Effect<PiSubagentSpawnResult, unknown> =>
  Effect.gen(function* () {
    const command = input.command;

    // 1. Capability handshake (managed sessions only). Legacy and unhandshaked
    //    sessions are never gated by control health and are never labeled
    //    managed (T21-AC7).
    if (
      !input.sessionCapability ||
      !input.sessionCapability.isManaged ||
      input.sessionCapability.status !== "managed_enabled"
    ) {
      return {
        status: "rejected",
        executionId: `exec_unmanaged_${randomUUID()}`,
        attemptId: `att_unmanaged_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: input.sessionCapability?.diagnosticCode ?? "pi_subagent_bridge_absent",
        rejectionReason:
          input.sessionCapability?.diagnosticMessage ??
          "Pi subagent managed execution is not enabled for this session",
      } satisfies PiSubagentSpawnResult;
    }

    // 2. Managed control health (Ticket 21). While degraded there is no
    //    immediate rejection: recovery is admission-driven and single-flight.
    //    This fresh command enters the shared recovery gate; at most one
    //    admission at a time executes its normal atomic `recordAdmission` as
    //    the durable recovery probe. A still-failing store keeps health
    //    degraded and rejects this command (fail-closed, no child, no row);
    //    a succeeding store marks health available and admits this same
    //    command. Waiters re-read health and then perform their own normal
    //    admission. There is no timer and no replay of rejected work.
    if (input.controlHealth) {
      const health = yield* input.controlHealth.getHealth();
      if (health.status === "degraded") {
        return yield* input.controlHealth.withRecoveryProbe(
          Effect.gen(function* () {
            const rechecked = yield* input.controlHealth!.getHealth();
            const recoveryProbe = rechecked.status === "degraded";
            return yield* runManagedAdmission(input, { recoveryProbe });
          }),
        );
      }
    }

    return yield* runManagedAdmission(input, { recoveryProbe: false });
  });

/**
 * The managed admission path (Ticket 21): provider authority, server-minted
 * ownership cross-checks, projection truth, approval gate, subject authority,
 * and the atomic durable admission write. Authorization is evaluated before
 * any recovery-probe write so degraded control health can never mask an
 * authorization diagnostic. When `recoveryProbe` is true, this execution is
 * the single-flight recovery probe: a successful durable write marks control
 * health available again and admits this same fresh command.
 */
const runManagedAdmission = (
  input: AdmitSubagentSpawnInput,
  probeOptions: { readonly recoveryProbe: boolean },
): Effect.Effect<PiSubagentSpawnResult, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date().toISOString();
    const command = input.command;
    const trusted = input.trustedContext;
    const reportTransition = (transition: PiSubagentControlHealthTransition | null) => {
      if (transition !== null) {
        input.onHealthTransition?.(transition);
      }
      return transition;
    };
    const healthContext: PiSubagentControlHealthMarkContext = {
      threadId: command.parentThreadId,
    };

    // 3. Provider authority (server-minted adapter constant)
    if (trusted.trustedProvider !== "pi") {
      return {
        status: "rejected",
        executionId: `exec_rejected_${randomUUID()}`,
        attemptId: `att_rejected_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_provider_mismatch",
        rejectionReason: `Provider mismatch: expected 'pi', received '${trusted.trustedProvider}'`,
      } satisfies PiSubagentSpawnResult;
    }

    // 4. Server-minted ownership cross-checks (defense in depth; identifiers
    //    supplied by the extension never grant authority)
    if (command.parentThreadId !== trusted.trustedThreadId) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        `Thread authorization mismatch: command specified '${command.parentThreadId}', trusted context is '${trusted.trustedThreadId}'`,
      );
    }

    if (command.projectId !== trusted.trustedProjectId) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_project_mismatch",
        `Project authorization mismatch: command specified '${command.projectId}', trusted context is '${trusted.trustedProjectId}'`,
      );
    }

    if (
      trusted.trustedActiveTurnId !== null &&
      command.parentTurnId !== null &&
      command.parentTurnId !== trusted.trustedActiveTurnId
    ) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_active_turn_required",
        `Active turn mismatch: command specified '${command.parentTurnId}', trusted active turn is '${trusted.trustedActiveTurnId}'`,
      );
    }

    // 5. Load server projection truth (thread/project/active-turn/approval).
    //    A snapshot failure is a terminal rejection: authority cannot be
    //    proven from server truth.
    const snapshotResult = yield* Effect.result(input.snapshotQuery.getSnapshot());
    if (snapshotResult._tag === "Failure") {
      return {
        status: "rejected",
        executionId: `exec_rejected_${randomUUID()}`,
        attemptId: `att_rejected_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_admission_unauthorized",
        rejectionReason: "Server projection snapshot is unavailable; admission cannot be authorized",
      } satisfies PiSubagentSpawnResult;
    }
    const snapshot = snapshotResult.success;
    const thread = snapshot.threads.find((t) => t.id === command.parentThreadId);

    if (!thread) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        `Parent thread '${command.parentThreadId}' not found in server projection`,
      );
    }

    if (thread.archivedAt != null) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        `Parent thread '${command.parentThreadId}' is archived`,
      );
    }

    if (thread.projectId !== command.projectId) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_project_mismatch",
        `Project mismatch: thread belongs to '${thread.projectId}', command specified '${command.projectId}'`,
      );
    }

    if (command.parentTurnId) {
      const hasActiveTurn =
        thread.session?.activeTurnId === command.parentTurnId ||
        (thread.latestTurn?.id === command.parentTurnId &&
          thread.latestTurn?.state === "running");

      if (!hasActiveTurn) {
        return yield* rejectedResult(
          input,
          computeCommandFingerprint({
            subject: trusted.mcpAuthority?.subject,
            projectId: command.projectId,
            parentThreadId: command.parentThreadId,
            parentTurnId: command.parentTurnId,
            parentToolCallId: command.parentToolCallId,
          }),
          now,
          "pi_subagent_admission_active_turn_required",
          `Parent thread '${command.parentThreadId}' has no active turn matching '${command.parentTurnId}'`,
        );
      }
    }

    // 6. Approval gate (server truth, fail closed). The Pi provider session has
    //    no approval gate (PiAdapter.respondToRequest is unsupported), so an
    //    approval-required thread can never produce an approval receipt. Per
    //    the existing gateless-provider precedent (BrowserDownloadApprovalRequired
    //    / DeviceApprovalRequired), the spawn is refused before it runs rather
    //    than silently auto-approved.
    if (thread.runtimeMode === "approval-required") {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority?.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        "Managed subagent spawn requires explicit user approval, but this Pi provider session has no approval gate; the spawn was refused before it ran. Ask the user to approve the action or switch the thread out of approval-required mode.",
      );
    }

    // 7. Subject authority via the live server registry (Decision 21). The
    //    binding is re-validated at admission time: missing, revoked, expired
    //    (auth or credential), stale-generation, or mismatched bindings all
    //    fail closed with the registry's deterministic reason.
    if (trusted.mcpAuthority === null) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: null,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        "No server-minted subject authority binding is bound to this Pi session; managed spawn is refused (missing-binding)",
      );
    }

    if (input.authorityRegistry === undefined) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        "MCP session authority registry is unavailable; the binding cannot be re-validated and managed spawn is refused",
      );
    }

    const authorityFailure = input.authorityRegistry.assertAdmittable(
      trusted.mcpAuthority,
      { projectId: thread.projectId, lifecycleGeneration: null },
    );
    if (authorityFailure !== null) {
      return yield* rejectedResult(
        input,
        computeCommandFingerprint({
          subject: trusted.mcpAuthority.subject,
          projectId: command.projectId,
          parentThreadId: command.parentThreadId,
          parentTurnId: command.parentTurnId,
          parentToolCallId: command.parentToolCallId,
        }),
        now,
        "pi_subagent_admission_unauthorized",
        `Subject authority admission failed (${authorityFailure}): the server-minted MCP authority binding is not currently admittable`,
      );
    }

    // 8. Authorized: mint identities and durably record the execution, first
    //    attempt, and accepted lifecycle truth atomically (T20-AC2).
    const fingerprint = computeCommandFingerprint({
      subject: trusted.mcpAuthority.subject,
      projectId: command.projectId,
      parentThreadId: command.parentThreadId,
      parentTurnId: command.parentTurnId,
      parentToolCallId: command.parentToolCallId,
    });
    const executionId = `exec_${randomUUID()}`;
    const attemptId = `att_${randomUUID()}`;

    const admissionResultOrError = yield* input.repository
      .recordAdmission({
        executionId,
        attemptId,
        generation: 1,
        commandId: command.commandId,
        commandFingerprint: fingerprint,
        clientCommandId: command.clientCommandId ?? null,
        subject: trusted.mcpAuthority.subject,
        projectId: command.projectId,
        parentThreadId: command.parentThreadId,
        parentTurnId: command.parentTurnId,
        parentToolCallId: command.parentToolCallId,
        agentType: command.agentType,
        prompt: command.prompt,
        mode: command.mode,
        cancellationScope: command.cancellationScope,
        state: "accepted",
        diagnosticCode: "pi_subagent_managed_enabled",
        now,
      })
      .pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "failure" as const, error }),
          onSuccess: (result) => ({ _tag: "success" as const, result }),
        }),
      );

    if (admissionResultOrError._tag === "failure") {
      const error = admissionResultOrError.error;
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as any).message)
            : String(error);

      if (input.controlHealth) {
        // Exactly one degraded transition is reported per outage; repeated
        // failures while already degraded keep the first diagnostic stable.
        reportTransition(
          yield* input.controlHealth.markDegraded(
            `Failed to persist execution lifecycle truth: ${errorMessage}`,
            "pi_subagent_lifecycle_persistence_failed",
            healthContext,
          ),
        );
      }

      return {
        status: "rejected",
        executionId: `exec_rejected_${randomUUID()}`,
        attemptId: `att_rejected_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
        rejectionReason: `Failed to persist execution lifecycle truth: ${errorMessage}`,
      } satisfies PiSubagentSpawnResult;
    }

    const admissionResult = admissionResultOrError.result;

    // The durable recovery probe succeeded (Ticket 21): control health
    // returns to available and this same fresh command is admitted. No
    // previously rejected command is replayed.
    if (probeOptions.recoveryProbe && input.controlHealth) {
      reportTransition(yield* input.controlHealth.markAvailable(healthContext));
    }

    if (admissionResult.kind === "already_applied") {
      return {
        status: "already_applied",
        executionId: admissionResult.execution.executionId,
        attemptId: admissionResult.execution.attemptId,
        generation: admissionResult.execution.generation,
        state: admissionResult.execution.observedState,
        diagnosticCode: "pi_subagent_already_applied",
      } satisfies PiSubagentSpawnResult;
    }

    if (admissionResult.kind === "command_identity_mismatch") {
      // Fail closed: the commandId already belongs to a different ownership
      // scope. The other execution's identities are NEVER returned; no
      // duplicate row is created (the existing row is the durable record).
      return {
        status: "rejected",
        executionId: `exec_rejected_${randomUUID()}`,
        attemptId: `att_rejected_${randomUUID()}`,
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_command_identity_mismatch",
        rejectionReason: `Command identity '${admissionResult.commandId}' is already bound to a different subject/project/thread/turn/tool scope; replay refused`,
      } satisfies PiSubagentSpawnResult;
    }

    return {
      status: "accepted",
      executionId: admissionResult.execution.executionId,
      attemptId: admissionResult.execution.attemptId,
      generation: admissionResult.execution.generation,
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
    } satisfies PiSubagentSpawnResult;
  });
