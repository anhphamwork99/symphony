import { Option, Schema, SchemaIssue } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

export const PROJECT_MCP_ACTIVATION_DEADLINE_MS = 120_000;
export const PROJECT_MCP_ACTIVATION_WAIT_SET_MAX_SIZE = 256;
export const PROJECT_MCP_ACTIVATION_DETAIL_MAX_LENGTH = 1_024;

export const ProjectMcpDesiredState = Schema.Literals(["disabled", "enabled"]);
export type ProjectMcpDesiredState = typeof ProjectMcpDesiredState.Type;

export const ProjectMcpActivationOperationStatus = Schema.Literals([
  "pending",
  "succeeded",
  "failed",
]);
export type ProjectMcpActivationOperationStatus =
  typeof ProjectMcpActivationOperationStatus.Type;

export const ProjectMcpActivationOutcomeStatus = Schema.Literals([
  "pending",
  "succeeded",
  "failed",
]);
export type ProjectMcpActivationOutcomeStatus = typeof ProjectMcpActivationOutcomeStatus.Type;

export const ProjectMcpActivationWaitSetEntry = Schema.Struct({
  sessionId: ThreadId,
  sessionGeneration: TrimmedNonEmptyString,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectMcpActivationWaitSetEntry = typeof ProjectMcpActivationWaitSetEntry.Type;

const ProjectMcpActivationOutcomeDetail = Schema.NullOr(
  TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_MCP_ACTIVATION_DETAIL_MAX_LENGTH)),
);

export const ProjectMcpActivationOutcome = Schema.Struct({
  sessionId: ThreadId,
  sessionGeneration: TrimmedNonEmptyString,
  status: ProjectMcpActivationOutcomeStatus,
  detail: ProjectMcpActivationOutcomeDetail,
  updatedAt: IsoDateTime,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectMcpActivationOutcome = typeof ProjectMcpActivationOutcome.Type;

const ProjectMcpActivationAbsoluteDeadline = IsoDateTime.check(
  Schema.makeFilter(
    (value) => !Number.isNaN(Date.parse(value)),
    { identifier: "ProjectMcpActivationAbsoluteDeadline" },
  ),
);

const duplicateEntryIssue = (value: unknown, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(value), { message });

const validateProjectMcpActivationOperation = Schema.makeFilter(
  (operation: {
    readonly projectId: ProjectId;
    readonly requestId: string;
    readonly operationGeneration: number;
    readonly absoluteDeadline: string;
    readonly desiredState: ProjectMcpDesiredState;
    readonly waitSet: ReadonlyArray<ProjectMcpActivationWaitSetEntry>;
    readonly outcomes: ReadonlyArray<ProjectMcpActivationOutcome>;
    readonly aggregateStatus: ProjectMcpActivationOperationStatus;
    readonly version: number;
    readonly createdAt: IsoDateTime;
    readonly updatedAt: IsoDateTime;
  }) => {
    const waitSetIds = new Set<string>();
    for (const member of operation.waitSet) {
      if (waitSetIds.has(member.sessionId)) {
        return duplicateEntryIssue(
          operation.waitSet,
          `Activation wait-set contains duplicate session '${member.sessionId}'.`,
        );
      }
      waitSetIds.add(member.sessionId);
    }

    const outcomeIds = new Set<string>();
    for (const outcome of operation.outcomes) {
      if (!waitSetIds.has(outcome.sessionId)) {
        return duplicateEntryIssue(
          operation.outcomes,
          `Activation outcome '${outcome.sessionId}' is not a member of the immutable wait-set.`,
        );
      }
      if (outcomeIds.has(outcome.sessionId)) {
        return duplicateEntryIssue(
          operation.outcomes,
          `Activation outcomes contain duplicate session '${outcome.sessionId}'.`,
        );
      }
      const member = operation.waitSet.find((candidate) => candidate.sessionId === outcome.sessionId);
      if (member?.sessionGeneration !== outcome.sessionGeneration) {
        return duplicateEntryIssue(
          operation.outcomes,
          `Activation outcome '${outcome.sessionId}' has a stale session generation.`,
        );
      }
      if (outcome.status === "failed" && outcome.detail === null) {
        return duplicateEntryIssue(
          operation.outcomes,
          `Failed activation outcome '${outcome.sessionId}' must include a bounded detail.`,
        );
      }
      if (outcome.status !== "failed" && outcome.detail !== null) {
        return duplicateEntryIssue(
          operation.outcomes,
          "Only failed activation outcomes may include a detail.",
        );
      }
      outcomeIds.add(outcome.sessionId);
    }

    if (outcomeIds.size !== waitSetIds.size) {
      return duplicateEntryIssue(
        operation.outcomes,
        "Activation outcomes must contain exactly one entry for every wait-set member.",
      );
    }

    const pendingCount = operation.outcomes.filter((outcome) => outcome.status === "pending").length;
    const failedCount = operation.outcomes.filter((outcome) => outcome.status === "failed").length;
    const expectedStatus = failedCount > 0 ? "failed" : pendingCount > 0 ? "pending" : "succeeded";
    if (operation.aggregateStatus !== expectedStatus) {
      return duplicateEntryIssue(
        operation.aggregateStatus,
        `Activation aggregate status must be '${expectedStatus}' for its outcomes.`,
      );
    }

    if (operation.aggregateStatus === "failed" && operation.desiredState !== "disabled") {
      return duplicateEntryIssue(
        operation.desiredState,
        "A failed activation operation must leave the project disabled.",
      );
    }

    return true;
  },
  { identifier: "ProjectMcpActivationOperation" },
);

export const ProjectMcpActivationOperation = Schema.Struct({
  projectId: ProjectId,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  operationGeneration: PositiveInt,
  absoluteDeadline: ProjectMcpActivationAbsoluteDeadline,
  desiredState: ProjectMcpDesiredState,
  waitSet: Schema.Array(ProjectMcpActivationWaitSetEntry).check(
    Schema.isMaxLength(PROJECT_MCP_ACTIVATION_WAIT_SET_MAX_SIZE),
  ),
  outcomes: Schema.Array(ProjectMcpActivationOutcome).check(
    Schema.isMaxLength(PROJECT_MCP_ACTIVATION_WAIT_SET_MAX_SIZE),
  ),
  aggregateStatus: ProjectMcpActivationOperationStatus,
  version: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
  .check(validateProjectMcpActivationOperation)
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectMcpActivationOperation = typeof ProjectMcpActivationOperation.Type;

export const ProjectMcpActivationOperationUpdate = Schema.Struct({
  expectedVersion: NonNegativeInt,
  operation: ProjectMcpActivationOperation,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectMcpActivationOperationUpdate = typeof ProjectMcpActivationOperationUpdate.Type;
