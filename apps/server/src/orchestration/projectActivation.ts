import type {
  OrchestrationProject,
  ProjectMcpActivationOperation,
  ProjectMcpActivationUpdateCommand,
} from "@synara/contracts";

export type ProjectActivationValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string };

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Validates the project-level activation CAS and operation identity boundary.
 * The operation record is append-only in the journal; only its outcome/version
 * may advance while a request is pending.
 */
export function validateProjectMcpActivationUpdate(input: {
  readonly project: OrchestrationProject;
  readonly command: ProjectMcpActivationUpdateCommand;
}): ProjectActivationValidationResult {
  const { project, command } = input;
  const currentVersion = project.synaraMcpActivationVersion ?? 0;
  if (command.expectedVersion !== currentVersion) {
    return {
      ok: false,
      detail: `Project MCP activation version is stale: expected ${currentVersion}, received ${command.expectedVersion}.`,
    };
  }

  const operation = command.operation;
  if (operation.projectId !== command.projectId) {
    return {
      ok: false,
      detail: "Activation operation project identity does not match the command.",
    };
  }
  if (operation.desiredState !== command.desiredState) {
    return { ok: false, detail: "Activation operation desired state does not match the command." };
  }
  if (operation.version !== currentVersion + 1) {
    return {
      ok: false,
      detail: `Activation operation version must advance to ${currentVersion + 1}.`,
    };
  }

  const currentOperation = project.synaraMcpActivationOperation;
  if (currentOperation === null || currentOperation === undefined) {
    if (operation.operationGeneration !== 1) {
      return { ok: false, detail: "The first activation operation must use generation 1." };
    }
    // impl-09: every newly created operation carries the recovery record.
    // Without a recovery identity the operation cannot be recovered after a
    // restart (legacy pending operations block startup instead), and without
    // the issuing thread the deterministic terminal activity has no durable
    // home. Fail closed at the write boundary so a new operation can never be
    // created without them.
    if (operation.recoveryIdentity === undefined || operation.issuingThreadId === undefined) {
      return {
        ok: false,
        detail: "A new activation operation must carry a recovery identity and issuing thread.",
      };
    }
    return { ok: true };
  }

  const sameRequest = operation.requestId === currentOperation.requestId;
  if (sameRequest) {
    if (currentOperation.aggregateStatus !== "pending") {
      return {
        ok: false,
        detail: "A terminal activation request cannot create a second durable operation.",
      };
    }
    const isFailedEnableRollback =
      currentOperation.desiredState === "enabled" &&
      operation.desiredState === "disabled" &&
      operation.aggregateStatus === "failed";
    if (!isFailedEnableRollback && operation.desiredState !== currentOperation.desiredState) {
      return { ok: false, detail: "An activation request cannot change its desired state." };
    }
    if (operation.operationGeneration !== currentOperation.operationGeneration) {
      return { ok: false, detail: "An operation request cannot change its generation." };
    }
    if (operation.recoveryIdentity !== currentOperation.recoveryIdentity) {
      return { ok: false, detail: "An activation operation recovery identity is immutable." };
    }
    if (operation.issuingThreadId !== currentOperation.issuingThreadId) {
      return { ok: false, detail: "An activation operation issuing thread is immutable." };
    }
    if (!sameJson(operation.waitSet, currentOperation.waitSet)) {
      return { ok: false, detail: "An activation operation wait-set is immutable." };
    }
    if (operation.absoluteDeadline !== currentOperation.absoluteDeadline) {
      return { ok: false, detail: "An activation operation deadline is immutable." };
    }
    if (operation.createdAt !== currentOperation.createdAt) {
      return { ok: false, detail: "An activation operation creation time is immutable." };
    }
    return { ok: true };
  }

  if (currentOperation.aggregateStatus === "pending") {
    return {
      ok: false,
      detail: "A project activation operation is already pending for another request.",
    };
  }
  if (operation.operationGeneration <= currentOperation.operationGeneration) {
    return {
      ok: false,
      detail: "A new activation request must advance the operation generation.",
    };
  }
  if (operation.recoveryIdentity === undefined || operation.issuingThreadId === undefined) {
    return {
      ok: false,
      detail: "A new activation operation must carry a recovery identity and issuing thread.",
    };
  }
  return { ok: true };
}

export function makeProjectMcpActivationEventOperation(
  operation: ProjectMcpActivationOperation,
): ProjectMcpActivationOperation {
  return {
    ...operation,
    waitSet: operation.waitSet.map((member) => ({ ...member })),
    outcomes: operation.outcomes.map((outcome) => ({ ...outcome })),
  };
}
