import { createHash } from "node:crypto";

import {
  CommandId,
  EventId,
  PROJECT_MCP_ACTIVATION_DEADLINE_MS,
  type IsoDateTime,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type ProjectMcpActivationOperation,
  type ProjectMcpActivationOutcome,
  type ProjectMcpActivationUpdateCommand,
  type ProjectMcpActivationWaitSetEntry,
  ProjectId,
  ThreadId,
} from "@synara/contracts";

import { threadHasInFlightTurn } from "./commandInvariants.ts";

export const SYNARA_MCP_ENABLE_COMMAND = "/Enable Synara MCP" as const;
export const SYNARA_MCP_DISABLE_COMMAND = "/Disable Synara MCP" as const;

export const SYNARA_MCP_PENDING_ACTIVITY_KIND = "synara.mcp.command.pending" as const;
export const SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND = "synara.mcp.command.succeeded" as const;
export const SYNARA_MCP_FAILED_ACTIVITY_KIND = "synara.mcp.command.failed" as const;

const SYNARA_MCP_REQUEST_ID_PREFIX = "synara-mcp";
const SYNARA_MCP_SAFE_DIAGNOSTIC_FALLBACK = "The Synara MCP command could not be completed.";
const SYNARA_MCP_DIAGNOSTIC_MAX_BYTES = 1_024;

export type SynaraMcpCommand = "enable" | "disable";
export type SynaraMcpRequestedState = "enabled" | "disabled";

export interface SynaraMcpCommandPayload {
  readonly requestId: string;
  readonly command: SynaraMcpCommand;
  readonly phase: "pending" | "terminal";
  readonly status: "pending" | "succeeded" | "failed";
  readonly requestedState: SynaraMcpRequestedState;
  readonly finalState?: SynaraMcpRequestedState;
  readonly detail?: string;
}

export type SynaraMcpTurnCommand = Extract<OrchestrationCommand, { type: "thread.turn.start" }>;
export type SynaraMcpActivityAppendCommand = Extract<
  OrchestrationCommand,
  { type: "thread.activity.append" }
>;

export interface SynaraMcpCommandPlan {
  readonly command: SynaraMcpTurnCommand;
  readonly project: OrchestrationProject;
  readonly requestId: string;
  readonly operation: ProjectMcpActivationOperation;
  readonly projectCommand: ProjectMcpActivationUpdateCommand | null;
  readonly pending: boolean;
  readonly pendingActivityCommand: SynaraMcpActivityAppendCommand;
  readonly terminalActivityCommand: SynaraMcpActivityAppendCommand;
}

function commandKind(text: string): SynaraMcpCommand | null {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalized === SYNARA_MCP_ENABLE_COMMAND.toLowerCase()) return "enable";
  if (normalized === SYNARA_MCP_DISABLE_COMMAND.toLowerCase()) return "disable";
  return null;
}

export function parseSynaraMcpCommand(text: string): SynaraMcpCommand | null {
  return commandKind(text);
}

export function synaraMcpRequestedState(command: SynaraMcpCommand): SynaraMcpRequestedState {
  return command === "enable" ? "enabled" : "disabled";
}

/** The client command id is the stable receipt identity for this command. */
export function synaraMcpRequestId(commandId: string): string {
  return `${SYNARA_MCP_REQUEST_ID_PREFIX}:${createHash("sha256").update(commandId).digest("hex")}`;
}

function phaseId(requestId: string, phase: "pending" | "terminal"): EventId {
  return EventId.makeUnsafe(`${requestId}:${phase}`);
}

function phaseCommandId(
  requestId: string,
  phase: "operation" | "terminal-operation" | "pending" | "terminal" | `member:${string}`,
): CommandId {
  return CommandId.makeUnsafe(`${requestId}:${phase}`);
}

function isoNow(now: () => Date = () => new Date()): IsoDateTime {
  return now().toISOString();
}

function threadForCommand(
  readModel: OrchestrationReadModel,
  command: SynaraMcpTurnCommand,
): OrchestrationThread | undefined {
  return readModel.threads.find((thread) => thread.id === command.threadId);
}

function projectForThread(
  readModel: OrchestrationReadModel,
  thread: OrchestrationThread,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === thread.projectId);
}

function currentSessionWaitSet(readModel: OrchestrationReadModel, projectId: ProjectId) {
  return readModel.threads
    .filter((thread) => thread.projectId === projectId && thread.session !== null)
    .map((thread) => ({
      sessionId: thread.id,
      // The session contract currently exposes no provider runtime
      // generation. This durable session snapshot token is the acceptance-time
      // generation the provider enable boundary validates against the live
      // session (impl-08); it is replaced by the provider lifecycle
      // generation when that lifecycle is fully exposed to orchestration.
      sessionGeneration: `orchestration:${thread.id}:${thread.session!.updatedAt}`,
    }))
    .toSorted((left, right) => left.sessionId.localeCompare(right.sessionId));
}

/**
 * Wait-set for a new Synara MCP operation (impl-08): both enable and disable
 * fan out to every current session of the project, captured immutably at
 * acceptance. Future sessions never join an accepted operation. An empty
 * wait-set succeeds immediately (enable) or stays schema-valid terminal
 * (disable with a session-less issuing thread: its provider outcome is
 * dormant by construction, Decisions 14/18).
 */
function waitSetForCommand(input: {
  readonly readModel: OrchestrationReadModel;
  readonly thread: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly kind: SynaraMcpCommand;
}): ProjectMcpActivationOperation["waitSet"] {
  return currentSessionWaitSet(input.readModel, input.project.id);
}

function activityCommand(input: {
  readonly threadId: ThreadId;
  readonly requestId: string;
  readonly command: SynaraMcpCommand;
  readonly requestedState: SynaraMcpRequestedState;
  readonly phase: "pending" | "terminal";
  readonly status: "pending" | "succeeded" | "failed";
  readonly summary: string;
  readonly finalState?: SynaraMcpRequestedState;
  readonly detail?: string;
  readonly createdAt: IsoDateTime;
}): SynaraMcpActivityAppendCommand {
  const payload: SynaraMcpCommandPayload = {
    requestId: input.requestId,
    command: input.command,
    phase: input.phase,
    status: input.status,
    requestedState: input.requestedState,
    ...(input.finalState === undefined ? {} : { finalState: input.finalState }),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  };
  const activity: OrchestrationThreadActivity = {
    id: phaseId(input.requestId, input.phase),
    tone: input.status === "failed" ? "error" : "info",
    kind:
      input.status === "pending"
        ? SYNARA_MCP_PENDING_ACTIVITY_KIND
        : input.status === "succeeded"
          ? SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND
          : SYNARA_MCP_FAILED_ACTIVITY_KIND,
    summary: input.summary,
    payload: payload as unknown as OrchestrationThreadActivity["payload"],
    turnId: null,
    createdAt: input.createdAt,
  };
  return {
    type: "thread.activity.append",
    commandId: phaseCommandId(input.requestId, input.phase),
    threadId: input.threadId,
    activity,
    createdAt: input.createdAt,
  };
}

function makeOperation(input: {
  readonly project: OrchestrationProject;
  readonly requestId: string;
  readonly desiredState: SynaraMcpRequestedState;
  readonly waitSet: ProjectMcpActivationOperation["waitSet"];
  readonly createdAt: IsoDateTime;
}): ProjectMcpActivationOperation {
  const version = (input.project.synaraMcpActivationVersion ?? 0) + 1;
  const operationGeneration =
    (input.project.synaraMcpActivationOperation?.operationGeneration ?? 0) + 1;
  const outcomes: ReadonlyArray<ProjectMcpActivationOutcome> = input.waitSet.map((member) => ({
    ...member,
    status: "pending",
    detail: null,
    updatedAt: input.createdAt,
  }));
  return {
    projectId: input.project.id,
    requestId: input.requestId,
    operationGeneration,
    absoluteDeadline: new Date(
      Date.parse(input.createdAt) + PROJECT_MCP_ACTIVATION_DEADLINE_MS,
    ).toISOString(),
    desiredState: input.desiredState,
    waitSet: [...input.waitSet],
    outcomes,
    aggregateStatus: outcomes.length === 0 ? "succeeded" : "pending",
    version,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function makeProjectCommand(input: {
  readonly project: OrchestrationProject;
  readonly operation: ProjectMcpActivationOperation;
  readonly commandId: CommandId;
}): ProjectMcpActivationUpdateCommand {
  return {
    type: "project.mcp-activation.update",
    commandId: input.commandId,
    projectId: input.project.id,
    desiredState: input.operation.desiredState,
    expectedVersion: input.operation.version - 1,
    operation: input.operation,
  };
}

function makeSucceededOperationCommand(input: {
  readonly project: OrchestrationProject;
  readonly operation: ProjectMcpActivationOperation;
  readonly completedAt: IsoDateTime;
}): ProjectMcpActivationUpdateCommand {
  const operation: ProjectMcpActivationOperation = {
    ...input.operation,
    outcomes: input.operation.outcomes.map((outcome) => ({
      ...outcome,
      status: "succeeded",
      detail: null,
      updatedAt: input.completedAt,
    })),
    aggregateStatus: "succeeded",
    version: input.operation.version + 1,
    updatedAt: input.completedAt,
  };
  return makeProjectCommand({
    project: input.project,
    operation,
    commandId: phaseCommandId(input.operation.requestId, "terminal-operation"),
  });
}

export function isSynaraMcpTurnCommand(
  command: OrchestrationCommand,
): command is SynaraMcpTurnCommand {
  return command.type === "thread.turn.start" && commandKind(command.message.text) !== null;
}

export function planSynaraMcpCommand(input: {
  readonly command: SynaraMcpTurnCommand;
  readonly readModel: OrchestrationReadModel;
  readonly now?: () => Date;
}): SynaraMcpCommandPlan | null {
  const kind = commandKind(input.command.message.text);
  if (kind === null) return null;

  const thread = threadForCommand(input.readModel, input.command);
  const project = thread === undefined ? undefined : projectForThread(input.readModel, thread);
  if (thread === undefined || project === undefined) return null;

  const createdAt = isoNow(input.now);
  const requestId = synaraMcpRequestId(input.command.commandId);
  const requestedState = synaraMcpRequestedState(kind);
  const existingOperation = project.synaraMcpActivationOperation;
  const isRetry = existingOperation?.requestId === requestId;
  const operation =
    isRetry && existingOperation
      ? existingOperation
      : makeOperation({
          project,
          requestId,
          desiredState: requestedState,
          waitSet: waitSetForCommand({
            readModel: input.readModel,
            thread,
            project,
            kind,
          }),
          createdAt,
        });
  const pending = operation.aggregateStatus === "pending";
  const activityCreatedAt = isRetry ? operation.updatedAt : createdAt;
  const existingFailure =
    isRetry && operation.aggregateStatus === "failed"
      ? (operation.outcomes.find((outcome) => outcome.status === "failed")?.detail ??
        "The previous Synara MCP activation attempt failed.")
      : null;
  return {
    command: input.command,
    project,
    requestId,
    operation,
    projectCommand: isRetry
      ? null
      : makeProjectCommand({
          project,
          operation,
          commandId: phaseCommandId(requestId, "operation"),
        }),
    pending,
    pendingActivityCommand: activityCommand({
      threadId: thread.id,
      requestId,
      command: kind,
      requestedState,
      phase: "pending",
      status: "pending",
      summary:
        kind === "enable"
          ? "Synara MCP will be enabled after the current turn completes"
          : "Synara MCP will be disabled after the current turn completes",
      createdAt: activityCreatedAt,
    }),
    terminalActivityCommand: activityCommand({
      threadId: thread.id,
      requestId,
      command: kind,
      requestedState,
      phase: "terminal",
      status: existingFailure === null ? "succeeded" : "failed",
      finalState: existingFailure === null ? requestedState : "disabled",
      ...(existingFailure === null ? {} : { detail: existingFailure }),
      summary:
        existingFailure === null
          ? kind === "enable"
            ? "Synara MCP is enabled for this project"
            : "Synara MCP is disabled"
          : kind === "enable"
            ? "Synara MCP activation failed; the project remains disabled"
            : "Synara MCP could not be disabled",
      createdAt: activityCreatedAt,
    }),
  };
}

export type SynaraMcpDispatchDecision =
  | { readonly kind: "plan"; readonly plan: SynaraMcpCommandPlan }
  | {
      readonly kind: "unprocessable";
      readonly activityCommand: SynaraMcpActivityAppendCommand;
    };

const SYNARA_MCP_UNPROCESSABLE_DETAIL =
  "The Synara MCP command could not be processed because its thread or project was not available at the command boundary.";

function planSynaraMcpUnprocessableActivity(input: {
  readonly command: SynaraMcpTurnCommand;
  readonly createdAt: IsoDateTime;
}): SynaraMcpActivityAppendCommand {
  const kind = commandKind(input.command.message.text)!;
  const requestId = synaraMcpRequestId(input.command.commandId);
  return activityCommand({
    threadId: input.command.threadId,
    requestId,
    command: kind,
    requestedState: synaraMcpRequestedState(kind),
    phase: "terminal",
    status: "failed",
    finalState: "disabled",
    detail: sanitizeSynaraMcpDiagnostic(SYNARA_MCP_UNPROCESSABLE_DETAIL),
    summary:
      kind === "enable"
        ? "Synara MCP activation failed; the project remains disabled"
        : "Synara MCP could not be disabled",
    createdAt: input.createdAt,
  });
}

/**
 * Dispatch decision at the Synara MCP command boundary. Every exact
 * `/Enable Synara MCP` or `/Disable Synara MCP` turn command is owned by
 * Synara: when planning cannot produce a normal plan (the command thread or
 * project is unavailable in the read model), the decision yields only a
 * durable journaled failure activity (`thread.activity.append` ->
 * `thread.activity-appended`) and never the original turn command, so the
 * command can never reach Pi/model history.
 */
export function planSynaraMcpDispatch(input: {
  readonly command: SynaraMcpTurnCommand;
  readonly readModel: OrchestrationReadModel;
  readonly now?: () => Date;
}): SynaraMcpDispatchDecision {
  const plan = planSynaraMcpCommand({
    command: input.command,
    readModel: input.readModel,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (plan !== null) {
    return { kind: "plan", plan };
  }
  return {
    kind: "unprocessable",
    activityCommand: planSynaraMcpUnprocessableActivity({
      command: input.command,
      createdAt: isoNow(input.now),
    }),
  };
}

export function planSynaraMcpCompletion(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject;
  readonly now?: () => Date;
}): {
  readonly projectCommand: ProjectMcpActivationUpdateCommand | null;
  readonly terminalActivityCommand: SynaraMcpActivityAppendCommand;
} {
  const command = commandKind(input.plan.command.message.text)!;
  const requestedState = synaraMcpRequestedState(command);
  const currentOperation = input.project.synaraMcpActivationOperation;
  const completedAt = isoNow(input.now);
  return {
    projectCommand:
      currentOperation?.requestId === input.plan.requestId &&
      currentOperation.operationGeneration === input.plan.operation.operationGeneration &&
      currentOperation.aggregateStatus === "pending"
        ? makeSucceededOperationCommand({
            project: input.project,
            operation: currentOperation,
            completedAt,
          })
        : null,
    terminalActivityCommand: activityCommand({
      threadId: input.plan.command.threadId,
      requestId: input.plan.requestId,
      command,
      requestedState,
      phase: "terminal",
      status: "succeeded",
      finalState: requestedState,
      summary:
        command === "enable" ? "Synara MCP is enabled for this project" : "Synara MCP is disabled",
      createdAt: completedAt,
    }),
  };
}

export type SynaraMcpDisableOutcome =
  | { readonly state: "dormant" }
  | { readonly state: "unavailable"; readonly detail?: string };

/**
 * Plan the exactly-one terminal for a per-session disable (impl-07): a proven
 * dormant outcome journals the succeeded terminal with `finalState: disabled`
 * through the normal completion path, and an unavailable outcome journals the
 * failed terminal with `finalState: disabled` and a sanitized bounded detail.
 */
export function planSynaraMcpDisableTerminal(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject;
  readonly outcome: SynaraMcpDisableOutcome;
  readonly now?: () => Date;
}): {
  readonly projectCommand: ProjectMcpActivationUpdateCommand | null;
  readonly activityCommand: SynaraMcpActivityAppendCommand;
} {
  if (input.outcome.state === "dormant") {
    const completion = planSynaraMcpCompletion({
      plan: input.plan,
      project: input.project,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return {
      projectCommand: completion.projectCommand,
      activityCommand: completion.terminalActivityCommand,
    };
  }
  return planSynaraMcpFailure({
    plan: input.plan,
    project: input.project,
    detail: input.outcome.detail ?? "The Synara MCP disable could not prove its cleanup.",
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export type SynaraMcpDisableResolution =
  | SynaraMcpDisableOutcome
  | { readonly state: "timeout"; readonly detail: string };

/**
 * Shared impl-07 disable terminal planning for the command boundary (wsRpc
 * inline and pending reconcile paths): maps a bounded provider disable result
 * (dormant, unavailable, or a bounded-wait timeout) to the exactly-one
 * terminal. A non-pending plan (a retried command whose operation already
 * settled, or a session-less thread whose schema-valid aggregate is terminal)
 * yields only the deterministic terminal replay and never re-transitions the
 * durable operation, so duplicate resolutions stay idempotent. A pending plan
 * journals the provider-driven terminal exactly once; the operation
 * transition itself remains guarded by the current read model at the call
 * site.
 */
export function planSynaraMcpDisableResolution(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject;
  readonly outcome: SynaraMcpDisableResolution;
  readonly now?: () => Date;
}): {
  readonly projectCommand: ProjectMcpActivationUpdateCommand | null;
  readonly activityCommand: SynaraMcpActivityAppendCommand;
} {
  if (!input.plan.pending) {
    return {
      projectCommand: null,
      activityCommand: input.plan.terminalActivityCommand,
    };
  }
  if (input.outcome.state === "timeout") {
    return planSynaraMcpFailure({
      plan: input.plan,
      project: input.project,
      detail: input.outcome.detail,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  }
  return planSynaraMcpDisableTerminal({
    plan: input.plan,
    project: input.project,
    outcome: input.outcome,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  return new TextDecoder().decode(bytes.slice(0, maxBytes)).trimEnd();
}

/** Keep failures bounded and free of raw credential, URL, and path diagnostics. */
export function sanitizeSynaraMcpDiagnostic(input: unknown): string {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  const sanitized = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(
      /\b(bearer|token|secret|password|credential|api[-_ ]?key)\s*[:=]?\s*[^,; ]+/gi,
      "$1 [redacted]",
    )
    .replace(/https?:\/\/[^\s,;]+/gi, "[redacted-url]")
    .replace(
      /(?:^|\s)(?:[A-Za-z]:[\\/]|\/Users\/|\/private\/|\/tmp\/)[^\s,;]*/g,
      " [redacted-path]",
    )
    .trim();
  return truncateUtf8(
    sanitized || SYNARA_MCP_SAFE_DIAGNOSTIC_FALLBACK,
    SYNARA_MCP_DIAGNOSTIC_MAX_BYTES,
  );
}

function makeFailedOperationCommand(input: {
  readonly project: OrchestrationProject;
  readonly requestId: string;
  readonly operation: ProjectMcpActivationOperation;
  readonly detail: string;
  readonly completedAt: IsoDateTime;
}): ProjectMcpActivationUpdateCommand | null {
  const currentOperation = input.project.synaraMcpActivationOperation;
  if (
    currentOperation === null ||
    currentOperation === undefined ||
    currentOperation.requestId !== input.requestId ||
    currentOperation.operationGeneration !== input.operation.operationGeneration ||
    currentOperation.aggregateStatus !== "pending"
  ) {
    return null;
  }
  const operation: ProjectMcpActivationOperation = {
    ...input.operation,
    desiredState: "disabled",
    outcomes: input.operation.outcomes.map((outcome) => ({
      ...outcome,
      status: "failed",
      detail: input.detail,
      updatedAt: input.completedAt,
    })),
    aggregateStatus: "failed",
    version: input.operation.version + 1,
    updatedAt: input.completedAt,
  };
  return makeProjectCommand({
    project: input.project,
    operation,
    commandId: phaseCommandId(input.operation.requestId, "terminal-operation"),
  });
}

export type SynaraMcpWaitStatus = "waiting" | "ready" | "failed";

export function synaraMcpWaitStatus(
  readModel: OrchestrationReadModel,
  operation: ProjectMcpActivationOperation,
): SynaraMcpWaitStatus {
  for (const member of operation.waitSet) {
    const thread = readModel.threads.find((candidate) => candidate.id === member.sessionId);
    if (thread === undefined || thread.session === null) return "failed";
    if (threadHasInFlightTurn(thread)) return "waiting";
  }
  return "ready";
}

export type SynaraMcpMemberStatus = "ready" | "failed";

/**
 * Per-member liveness for the project reconciliation (impl-08): a captured
 * wait-set member whose thread or session is gone can no longer be
 * reconciled and is an unsafe disappearance for the operation.
 */
export function synaraMcpMemberStatus(
  readModel: OrchestrationReadModel,
  operation: ProjectMcpActivationOperation,
  member: ProjectMcpActivationWaitSetEntry,
): SynaraMcpMemberStatus {
  const thread = readModel.threads.find((candidate) => candidate.id === member.sessionId);
  if (thread === undefined || thread.session === null) return "failed";
  return "ready";
}

/**
 * Journal one wait-set member's succeeded outcome independently (impl-08).
 * The resolution must match the current operation's request id, operation
 * generation, wait-set membership, and the captured session generation;
 * stale or settled resolutions are ignored (Decision 18: stale work is
 * discarded). The aggregate succeeds only when every member has succeeded;
 * a failed member is not journaled here — it immediately triggers the
 * full failed-disabled rollback through {@link planSynaraMcpFailure}.
 */
export function planSynaraMcpMemberOutcome(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject;
  readonly member: ProjectMcpActivationWaitSetEntry;
  readonly now?: () => Date;
}): ProjectMcpActivationUpdateCommand | null {
  const currentOperation = input.project.synaraMcpActivationOperation;
  if (
    currentOperation === null ||
    currentOperation === undefined ||
    currentOperation.requestId !== input.plan.requestId ||
    currentOperation.operationGeneration !== input.plan.operation.operationGeneration ||
    currentOperation.aggregateStatus !== "pending"
  ) {
    return null;
  }
  const captured = currentOperation.waitSet.find(
    (entry) => entry.sessionId === input.member.sessionId,
  );
  if (captured === undefined || captured.sessionGeneration !== input.member.sessionGeneration) {
    return null;
  }
  const existing = currentOperation.outcomes.find(
    (outcome) => outcome.sessionId === input.member.sessionId,
  );
  if (existing !== undefined && existing.status === "succeeded") {
    return null;
  }
  const completedAt = isoNow(input.now);
  const outcomes = currentOperation.outcomes.map((outcome) =>
    outcome.sessionId === input.member.sessionId
      ? { ...outcome, status: "succeeded" as const, detail: null, updatedAt: completedAt }
      : outcome,
  );
  const operation: ProjectMcpActivationOperation = {
    ...currentOperation,
    outcomes,
    aggregateStatus: outcomes.some((outcome) => outcome.status === "pending")
      ? "pending"
      : "succeeded",
    version: currentOperation.version + 1,
    updatedAt: completedAt,
  };
  return makeProjectCommand({
    project: input.project,
    operation,
    commandId: phaseCommandId(input.plan.requestId, `member:${input.member.sessionId}`),
  });
}

export function planSynaraMcpFailure(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly project: OrchestrationProject;
  readonly detail: unknown;
  readonly now?: () => Date;
}): {
  readonly projectCommand: ProjectMcpActivationUpdateCommand | null;
  readonly activityCommand: SynaraMcpActivityAppendCommand;
} {
  const detail = sanitizeSynaraMcpDiagnostic(input.detail);
  return {
    projectCommand: makeFailedOperationCommand({
      project: input.project,
      requestId: input.plan.requestId,
      operation: input.project.synaraMcpActivationOperation ?? input.plan.operation,
      detail,
      completedAt: isoNow(input.now),
    }),
    activityCommand: planSynaraMcpFailureActivity({
      plan: input.plan,
      detail,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
  };
}

export function planSynaraMcpFailureActivity(input: {
  readonly plan: SynaraMcpCommandPlan;
  readonly detail: unknown;
  readonly now?: () => Date;
}): SynaraMcpActivityAppendCommand {
  const command = commandKind(input.plan.command.message.text)!;
  return activityCommand({
    threadId: input.plan.command.threadId,
    requestId: input.plan.requestId,
    command,
    requestedState: synaraMcpRequestedState(command),
    phase: "terminal",
    status: "failed",
    finalState: "disabled",
    detail: sanitizeSynaraMcpDiagnostic(input.detail),
    summary:
      command === "enable"
        ? "Synara MCP activation failed; the project remains disabled"
        : "Synara MCP could not be disabled",
    createdAt: isoNow(input.now),
  });
}
