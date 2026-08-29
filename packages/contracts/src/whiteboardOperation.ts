import { Schema } from "effect";

import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";

/**
 * Whiteboard operation-session contracts (Ticket 02, Decision 0063 as amended
 * by Decision 0064).
 *
 * Schema-only: this module owns the strict, bounded, image-free wire shapes
 * for the ephemeral Whiteboard operation-session seam. It contains no timer,
 * state machine, retry loop, mutation implementation, persistence logic, or
 * Excalidraw runtime type. Raw Excalidraw JSON, `Schema.Unknown`, binary
 * data, data URLs, file IDs, and image operations are prohibited here.
 */

/** Optional server capability advertised during WebSocket negotiation. */
export const WHITEBOARD_OPERATION_SESSION_CAPABILITY = "whiteboard.operation-session-v1";

/** Bounded server diagnostic codes for the operation-session seam. */
export const WHITEBOARD_OPERATION_ERROR = {
  capabilityMissing: "WHITEBOARD_OPERATION_CAPABILITY_MISSING",
  sessionUnknown: "WHITEBOARD_OPERATION_SESSION_UNKNOWN",
  sessionEpochStale: "WHITEBOARD_OPERATION_SESSION_EPOCH_STALE",
  sessionActive: "WHITEBOARD_OPERATION_SESSION_ACTIVE",
  sessionReleased: "WHITEBOARD_OPERATION_SESSION_RELEASED",
  authorityChanged: "WHITEBOARD_OPERATION_AUTHORITY_CHANGED",
  resetRequired: "operation-session-reset-required",
  sessionLost: "operation-session-lost",
  identityMismatch: "WHITEBOARD_OPERATION_IDENTITY_MISMATCH",
  operationUnknown: "WHITEBOARD_OPERATION_OPERATION_UNKNOWN",
  operationTerminal: "WHITEBOARD_OPERATION_OPERATION_TERMINAL",
  operationNotRetryable: "WHITEBOARD_OPERATION_OPERATION_NOT_RETRYABLE",
  duplicateProducerInput: "WHITEBOARD_OPERATION_DUPLICATE_PRODUCER_INPUT",
  conflictingProducerInput: "WHITEBOARD_OPERATION_CONFLICTING_PRODUCER_INPUT",
  producerSequenceSkipped: "WHITEBOARD_OPERATION_PRODUCER_SEQUENCE_SKIPPED",
  dependencyInvalid: "WHITEBOARD_OPERATION_DEPENDENCY_INVALID",
  revisionConflict: "WHITEBOARD_OPERATION_REVISION_CONFLICT",
  ackUnknown: "WHITEBOARD_OPERATION_ACK_UNKNOWN",
  ackStale: "WHITEBOARD_OPERATION_ACK_STALE",
  ackConflict: "WHITEBOARD_OPERATION_ACK_CONFLICT",
  postContainmentInput: "WHITEBOARD_OPERATION_POST_CONTAINMENT_INPUT",
  takeOverRequestIdConflict: "WHITEBOARD_OPERATION_TAKE_OVER_REQUEST_CONFLICT",
  takeOverGenerationStale: "WHITEBOARD_OPERATION_TAKE_OVER_GENERATION_STALE",
  semanticVerificationFailed: "WHITEBOARD_OPERATION_SEMANTIC_VERIFICATION_FAILED",
} as const;
export type WhiteboardOperationErrorCode =
  (typeof WHITEBOARD_OPERATION_ERROR)[keyof typeof WHITEBOARD_OPERATION_ERROR];

/** Bounded document identity. Never inferred from an active tab or thread. */
export const WhiteboardDocumentKind = Schema.Literals(["file-canvas", "untitled-canvas"]);
export type WhiteboardDocumentKind = typeof WhiteboardDocumentKind.Type;

const BoundedId = (maxLength: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength));

const WhiteboardProjectId = ProjectId.check(Schema.isMaxLength(256));

const IsNotDataUrl = Schema.makeFilter((value: string) => !/^data:/i.test(value));

const ImageFreeWireString = (maxLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength)).check(IsNotDataUrl);

/** Fail-closed object boundary for every Whiteboard wire shape, including nested objects. */
const StrictObject = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

const StrictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  StrictObject(Schema.Struct(fields));

/** Session and document identity shared by every command and event. */
export const WhiteboardOperationSessionIdentity = StrictStruct({
  serverInstanceId: BoundedId(64),
  operationSessionId: BoundedId(128),
  sessionEpoch: PositiveInt,
  projectId: WhiteboardProjectId,
  documentKind: WhiteboardDocumentKind,
  documentId: BoundedId(512),
  canvasIdentity: BoundedId(256),
});
export type WhiteboardOperationSessionIdentity = typeof WhiteboardOperationSessionIdentity.Type;

/** Fields a browser supplies when opening a session; the server mints the rest. */
export const WhiteboardOperationAttachSessionInput = StrictStruct({
  projectId: WhiteboardProjectId,
  documentKind: WhiteboardDocumentKind,
  documentId: BoundedId(512),
  canvasIdentity: BoundedId(256),
  expectedDocumentRevision: NonNegativeInt,
});
export type WhiteboardOperationAttachSessionInput = typeof WhiteboardOperationAttachSessionInput.Type;

/** Attach result: full server-minted session identity plus document revision. */
export const WhiteboardOperationAttachSessionResult = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  documentRevision: NonNegativeInt,
});
export type WhiteboardOperationAttachSessionResult =
  typeof WhiteboardOperationAttachSessionResult.Type;

/** Subscribe input: the exact live session epoch plus the last seen sequence. */
export const WhiteboardOperationSubscribeInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  lastServerSequence: NonNegativeInt,
});
export type WhiteboardOperationSubscribeInput = typeof WhiteboardOperationSubscribeInput.Type;

const WhiteboardOperationLineageFields = {
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
  expectedDocumentRevision: NonNegativeInt,
  retryOfOperationId: Schema.optional(BoundedId(128)),
  retryOfGeneration: Schema.optional(PositiveInt),
  retryOfAttempt: Schema.optional(NonNegativeInt),
  retryAttempt: NonNegativeInt,
} as const;

const HasValidOperationLineage = Schema.makeFilter(
  (operation: {
    readonly batchId: string;
    readonly operationId: string;
    readonly generation: number;
    readonly expectedDocumentRevision: number;
    readonly retryOfOperationId?: string | undefined;
    readonly retryOfGeneration?: number | undefined;
    readonly retryOfAttempt?: number | undefined;
    readonly retryAttempt: number;
  }) =>
    operation.retryAttempt === 0
      ? operation.retryOfOperationId === undefined &&
        operation.retryOfGeneration === undefined &&
        operation.retryOfAttempt === undefined
      : operation.retryOfOperationId !== undefined &&
        operation.retryOfGeneration !== undefined &&
        operation.retryOfAttempt !== undefined &&
        operation.operationId !== operation.retryOfOperationId &&
        operation.generation > operation.retryOfGeneration &&
        operation.retryAttempt === operation.retryOfAttempt + 1,
);

/** One admitted operation's identity, generation, and self-consistent retry lineage. */
export const WhiteboardOperationHandle = StrictObject(
  StrictStruct(WhiteboardOperationLineageFields).check(HasValidOperationLineage),
);
export type WhiteboardOperationHandle = typeof WhiteboardOperationHandle.Type;

/** Strict bounded progress element patch. Image/file fields do not exist. */
const FiniteNumber = Schema.Number.check(Schema.isFinite());

export const WhiteboardProgressElement = StrictStruct({
  id: BoundedId(128),
  type: Schema.Literals([
    "rectangle",
    "ellipse",
    "diamond",
    "arrow",
    "line",
    "freedraw",
    "text",
  ]),
  x: FiniteNumber,
  y: FiniteNumber,
  width: Schema.optional(FiniteNumber),
  height: Schema.optional(FiniteNumber),
  angle: Schema.optional(FiniteNumber),
  opacity: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(100))),
  strokeColor: Schema.optional(BoundedId(64)),
  backgroundColor: Schema.optional(BoundedId(64)),
  text: Schema.optional(ImageFreeWireString(4_096)),
  fontSize: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(512))),
  points: Schema.optional(
    Schema.Array(Schema.Tuple([FiniteNumber, FiniteNumber])).check(Schema.isMaxLength(1_024)),
  ),
  deleted: Schema.optional(Schema.Boolean),
});
export type WhiteboardProgressElement = typeof WhiteboardProgressElement.Type;

/** Versioned, bounded, image-free progress mutation envelope. */
export const WhiteboardProgressMutation = StrictStruct({
  format: Schema.Literal("synara.whiteboard.progress/v1"),
  elements: Schema.Array(WhiteboardProgressElement).check(Schema.isMaxLength(256)),
});
export type WhiteboardProgressMutation = typeof WhiteboardProgressMutation.Type;

/**
 * Browser application verdict. `applied-semantic` and `applied-no-op` are
 * legal only after a correlated adapter callback and canonical verification;
 * `rejected` carries a bounded diagnostic code.
 */
export const WhiteboardApplicationResult = Schema.Literals([
  "applied-semantic",
  "applied-no-op",
  "rejected",
]);
export type WhiteboardApplicationResult = typeof WhiteboardApplicationResult.Type;

export const WhiteboardApplicationDiagnosticCode = Schema.Literals([
  "adapter-callback-missing",
  "semantic-verification-mismatch",
  "stale-operation-generation",
  "stale-mutation-revision",
  "coordinator-locked",
  "adapter-not-ready",
]);
export type WhiteboardApplicationDiagnosticCode = typeof WhiteboardApplicationDiagnosticCode.Type;

/** Truthful semantic application acknowledgement. */
export const WhiteboardAcknowledgeApplicationInput = StrictObject(
  StrictStruct({
    ...WhiteboardOperationSessionIdentity.fields,
    batchId: BoundedId(128),
    operationId: BoundedId(128),
    generation: PositiveInt,
    producerSequence: PositiveInt,
    serverSequence: PositiveInt,
    adapterCorrelationId: BoundedId(128),
    applicationResult: WhiteboardApplicationResult,
    resultingMutationRevision: NonNegativeInt,
    verifiedSemanticFingerprint: ImageFreeWireString(8_192),
    diagnosticCode: Schema.optional(WhiteboardApplicationDiagnosticCode),
  }).check(
    Schema.makeFilter((input) =>
      input.applicationResult === "rejected"
        ? input.diagnosticCode !== undefined
        : input.diagnosticCode === undefined,
    ),
  ),
);
export type WhiteboardAcknowledgeApplicationInput =
  typeof WhiteboardAcknowledgeApplicationInput.Type;

/** Acknowledgement result echoes the admitted identity and verdict for the caller. */
export const WhiteboardAcknowledgeApplicationResult = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
  producerSequence: PositiveInt,
  serverSequence: PositiveInt,
  acceptedSemanticCount: NonNegativeInt,
  acceptedNoOpCount: NonNegativeInt,
  rejectedCount: NonNegativeInt,
});
export type WhiteboardAcknowledgeApplicationResult =
  typeof WhiteboardAcknowledgeApplicationResult.Type;

/** Take Over input: idempotent request id plus the expected generation. */
export const WhiteboardOperationTakeOverInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  expectedGeneration: PositiveInt,
  takeOverRequestId: BoundedId(128),
});
export type WhiteboardOperationTakeOverInput = typeof WhiteboardOperationTakeOverInput.Type;

export const WhiteboardContainmentResult = Schema.Literals([
  "acknowledged",
  "dispatch-failed",
  "ack-timeout",
  "containment-failed",
]);
export type WhiteboardContainmentResult = typeof WhiteboardContainmentResult.Type;

const HasAdvancedTakeOverGeneration = Schema.makeFilter(
  (state: { readonly generation: number; readonly requestedGeneration: number }) =>
    state.generation > state.requestedGeneration,
);

/** Recorded Take Over state returned for repeated equivalent requests. */
export const WhiteboardOperationTakeOverResult = StrictObject(
  StrictStruct({
    ...WhiteboardOperationSessionIdentity.fields,
    batchId: BoundedId(128),
    operationId: BoundedId(128),
    generation: PositiveInt,
    takeOverRequestId: BoundedId(128),
    requestedGeneration: PositiveInt,
    status: Schema.Literals(["pending", "resolved"]),
    containmentResult: Schema.optional(WhiteboardContainmentResult),
  }).check(
    Schema.makeFilter((result) =>
      result.status === "resolved"
        ? result.containmentResult !== undefined
        : result.containmentResult === undefined,
    ),
    HasAdvancedTakeOverGeneration,
  ),
);
export type WhiteboardOperationTakeOverResult = typeof WhiteboardOperationTakeOverResult.Type;

/** Retry creates a NEW opaque operation id with a strictly greater generation. */
export const WhiteboardOperationRetryInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  failedOperationId: BoundedId(128),
  failedGeneration: PositiveInt,
  failedRetryAttempt: NonNegativeInt,
});
export type WhiteboardOperationRetryInput = typeof WhiteboardOperationRetryInput.Type;

export const WhiteboardOperationRetryResult = StrictObject(
  StrictStruct({
    ...WhiteboardOperationSessionIdentity.fields,
    ...WhiteboardOperationHandle.fields,
    retryOfOperationId: BoundedId(128),
    retryOfGeneration: PositiveInt,
    retryOfAttempt: NonNegativeInt,
    retryAttempt: PositiveInt,
  }).check(HasValidOperationLineage),
);
export type WhiteboardOperationRetryResult = typeof WhiteboardOperationRetryResult.Type;

export const WhiteboardOperationReleaseSessionInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
});
export type WhiteboardOperationReleaseSessionInput =
  typeof WhiteboardOperationReleaseSessionInput.Type;

export const WhiteboardOperationReleaseSessionResult = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  released: Schema.Boolean,
});
export type WhiteboardOperationReleaseSessionResult =
  typeof WhiteboardOperationReleaseSessionResult.Type;

/** Terminal outcome taxonomy (Decision 0063 §7). The server derives it. */
export const WhiteboardTerminalOutcome = Schema.Literals([
  "completed",
  "interrupted",
  "failed-partial",
  "zero-valid",
]);
export type WhiteboardTerminalOutcome = typeof WhiteboardTerminalOutcome.Type;

export const WhiteboardZeroValidReason = Schema.Literals([
  "zero-mutation",
  "semantic-no-op",
  "pre-batch-capture-failed",
  "invalid-first-operation",
  "all-operations-rejected",
  "application-rejected-before-first-valid",
]);
export type WhiteboardZeroValidReason = typeof WhiteboardZeroValidReason.Type;

export const WhiteboardFailedPartialTerminalReason = Schema.Literals([
  "producer-failed",
  "validation-failed",
  "dependency-failed",
  "browser-application-failed",
]);
export type WhiteboardFailedPartialTerminalReason =
  typeof WhiteboardFailedPartialTerminalReason.Type;

/** Closed terminal reason vocabulary derived from Decision 0063 §7. */
export const WhiteboardTerminalReason = Schema.Literals([
  "completed",
  "take-over-acknowledged",
  "producer-failed",
  "validation-failed",
  "dependency-failed",
  "browser-application-failed",
  "zero-mutation",
  "semantic-no-op",
  "pre-batch-capture-failed",
  "invalid-first-operation",
  "all-operations-rejected",
  "application-rejected-before-first-valid",
]);
export type WhiteboardTerminalReason = typeof WhiteboardTerminalReason.Type;

const FailedContainmentResults = new Set<WhiteboardContainmentResult>([
  "dispatch-failed",
  "ack-timeout",
  "containment-failed",
]);

/**
 * Shared wire invariant across every terminal outcome: the last accepted
 * producer sequence is zero exactly when nothing was accepted (semantic or
 * no-op). Rejected attempts never occupy accepted sequence space, so they
 * carry no last-accepted-sequence constraint.
 */
const WhiteboardTerminalRecordFields = {
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
  outcome: WhiteboardTerminalOutcome,
  terminalReason: WhiteboardTerminalReason,
  zeroValidReason: Schema.optional(WhiteboardZeroValidReason),
  acceptedSemanticCount: NonNegativeInt,
  acceptedNoOpCount: NonNegativeInt,
  rejectedCount: NonNegativeInt,
  lastAcceptedProducerSequence: NonNegativeInt,
  containmentResult: Schema.optional(WhiteboardContainmentResult),
} as const;

const HasValidTerminalRecord = Schema.makeFilter(
  (terminal: {
    readonly batchId: string;
    readonly operationId: string;
    readonly generation: number;
    readonly outcome: WhiteboardTerminalOutcome;
    readonly terminalReason: WhiteboardTerminalReason;
    readonly zeroValidReason?: WhiteboardZeroValidReason | undefined;
    readonly acceptedSemanticCount: number;
    readonly acceptedNoOpCount: number;
    readonly rejectedCount: number;
    readonly lastAcceptedProducerSequence: number;
    readonly containmentResult?: WhiteboardContainmentResult | undefined;
  }) => {
    // Shared wire invariant across every terminal outcome: the last accepted
    // producer sequence is zero exactly when nothing was accepted (semantic or
    // no-op). Rejected attempts never occupy accepted sequence space, so they
    // carry no last-accepted-sequence constraint.
    if (
      (terminal.lastAcceptedProducerSequence === 0) !==
      (terminal.acceptedSemanticCount + terminal.acceptedNoOpCount === 0)
    ) {
      return false;
    }
    switch (terminal.outcome) {
      case "completed":
        return (
          terminal.terminalReason === "completed" &&
          terminal.acceptedSemanticCount >= 1 &&
          terminal.acceptedNoOpCount >= 0 &&
          terminal.rejectedCount === 0 &&
          terminal.lastAcceptedProducerSequence >= 1 &&
          terminal.zeroValidReason === undefined &&
          terminal.containmentResult === undefined
        );
      case "interrupted":
        return (
          terminal.terminalReason === "take-over-acknowledged" &&
          terminal.acceptedSemanticCount >= 1 &&
          terminal.acceptedNoOpCount >= 0 &&
          terminal.rejectedCount === 0 &&
          terminal.lastAcceptedProducerSequence >= 1 &&
          terminal.zeroValidReason === undefined &&
          terminal.containmentResult === "acknowledged"
        );
      case "failed-partial":
        // Decision 0063 §7: failed-partial requires acknowledged containment
        // where work could still be active. The schema cannot observe whether
        // work is still active, so it permits acknowledged, absent, and the
        // failure results; whether containment is mandatory for a given
        // failure is a stateful server decision (WP2), not a wire shape.
        return (
          WhiteboardFailedPartialTerminalReason.literals.includes(
            terminal.terminalReason as WhiteboardFailedPartialTerminalReason,
          ) &&
          terminal.acceptedSemanticCount >= 1 &&
          terminal.acceptedNoOpCount >= 0 &&
          terminal.lastAcceptedProducerSequence >= 1 &&
          terminal.zeroValidReason === undefined &&
          (terminal.containmentResult === undefined ||
            terminal.containmentResult === "acknowledged" ||
            FailedContainmentResults.has(terminal.containmentResult))
        );
      case "zero-valid":
        return (
          terminal.zeroValidReason !== undefined &&
          terminal.terminalReason === terminal.zeroValidReason &&
          terminal.acceptedSemanticCount === 0 &&
          terminal.acceptedNoOpCount >= 0 &&
          terminal.rejectedCount >= 0
        );
    }
  },
);

/** Shared terminal record used by stream events and snapshot state. */
export const WhiteboardOperationTerminalRecord = StrictObject(
  StrictStruct(WhiteboardTerminalRecordFields).check(HasValidTerminalRecord),
);
export type WhiteboardOperationTerminalRecord =
  typeof WhiteboardOperationTerminalRecord.Type;

/** Bounded progress element patch delivered inside a progress event. */
const ProducerSequenceFields = {
  operationId: BoundedId(128),
  generation: PositiveInt,
} as const;

const HasValidProducerDependencies = Schema.makeFilter(
  (value: { readonly producerSequence: number; readonly dependsOnProducerSequences: readonly number[] }) =>
    new Set(value.dependsOnProducerSequences).size === value.dependsOnProducerSequences.length &&
    value.dependsOnProducerSequences.every(
      (dependency) => dependency < value.producerSequence,
    ),
);

/** Stream event emitted when the producer admits a new operation. */
export const WhiteboardOperationAdmittedEvent = StrictObject(
  WhiteboardOperationHandle.mapFields(
    (fields) => ({
      kind: Schema.Literal("operation-admitted"),
      ...WhiteboardOperationSessionIdentity.fields,
      serverSequence: PositiveInt,
      ...fields,
    }),
    { unsafePreserveChecks: true },
  ),
);
export type WhiteboardOperationAdmittedEvent = typeof WhiteboardOperationAdmittedEvent.Type;

/** Stream event carrying one admitted, sequenced progress mutation. */
export const WhiteboardOperationProgressEvent = StrictObject(
  StrictStruct({
    kind: Schema.Literal("operation-progress"),
    ...WhiteboardOperationSessionIdentity.fields,
    serverSequence: PositiveInt,
    batchId: BoundedId(128),
    ...ProducerSequenceFields,
    producerSequence: PositiveInt,
    dependsOnProducerSequences: Schema.Array(PositiveInt).check(Schema.isMaxLength(16)),
    expectedBeforeRevision: NonNegativeInt,
    expectedAfterRevision: NonNegativeInt,
    expectedSemanticFingerprint: ImageFreeWireString(8_192),
    mutation: WhiteboardProgressMutation,
  }).check(HasValidProducerDependencies),
);
export type WhiteboardOperationProgressEvent = typeof WhiteboardOperationProgressEvent.Type;

/** Stream event emitted when Take Over is recorded and the fence advanced. */
export const WhiteboardTakeOverPendingEvent = StrictObject(
  StrictStruct({
    kind: Schema.Literal("take-over-pending"),
    ...WhiteboardOperationSessionIdentity.fields,
    serverSequence: PositiveInt,
    batchId: BoundedId(128),
    ...ProducerSequenceFields,
    takeOverRequestId: BoundedId(128),
    requestedGeneration: PositiveInt,
  }).check(HasAdvancedTakeOverGeneration),
);
export type WhiteboardTakeOverPendingEvent = typeof WhiteboardTakeOverPendingEvent.Type;

/** Stream event carrying exactly one authoritative containment result. */
export const WhiteboardContainmentResultEvent = StrictObject(
  StrictStruct({
    kind: Schema.Literal("containment-result"),
    ...WhiteboardOperationSessionIdentity.fields,
    serverSequence: PositiveInt,
    batchId: BoundedId(128),
    ...ProducerSequenceFields,
    takeOverRequestId: BoundedId(128),
    requestedGeneration: PositiveInt,
    result: WhiteboardContainmentResult,
  }).check(HasAdvancedTakeOverGeneration),
);
export type WhiteboardContainmentResultEvent = typeof WhiteboardContainmentResultEvent.Type;

/** Stream event carrying exactly one terminal outcome for an operation. */
export const WhiteboardOperationTerminalEvent = StrictObject(
  WhiteboardOperationTerminalRecord.mapFields(
    (fields) => ({
      kind: Schema.Literal("operation-terminal"),
      ...WhiteboardOperationSessionIdentity.fields,
      serverSequence: PositiveInt,
      ...fields,
    }),
    { unsafePreserveChecks: true },
  ),
);
export type WhiteboardOperationTerminalEvent = typeof WhiteboardOperationTerminalEvent.Type;

/**
 * Session snapshot: the first item of every subscription. It contains
 * operation identity/generation, Take Over and containment state,
 * acknowledgement summary, terminal outcome, and the latest sequence — and
 * no scene, AI history snapshot, binary asset, or durable orchestration
 * history.
 */
export const WhiteboardOperationSnapshotEvent = StrictStruct({
  kind: Schema.Literal("session-snapshot"),
  ...WhiteboardOperationSessionIdentity.fields,
  serverSequence: PositiveInt,
  documentRevision: NonNegativeInt,
  activeOperation: Schema.optional(
    WhiteboardOperationHandle,
  ),
  takeOver: Schema.optional(
    StrictObject(
      StrictStruct({
        batchId: BoundedId(128),
        operationId: BoundedId(128),
        generation: PositiveInt,
        takeOverRequestId: BoundedId(128),
        requestedGeneration: PositiveInt,
        status: Schema.Literals(["pending", "resolved"]),
        containmentResult: Schema.optional(WhiteboardContainmentResult),
      }).check(
        Schema.makeFilter((state) =>
          state.status === "resolved"
            ? state.containmentResult !== undefined
            : state.containmentResult === undefined,
        ),
        HasAdvancedTakeOverGeneration,
      ),
    ),
  ),
  acknowledgementSummary: StrictStruct({
    acceptedSemanticCount: NonNegativeInt,
    acceptedNoOpCount: NonNegativeInt,
    rejectedCount: NonNegativeInt,
    lastAcceptedProducerSequence: NonNegativeInt,
  }),
  terminal: Schema.optional(WhiteboardOperationTerminalRecord),
});
export type WhiteboardOperationSnapshotEvent = typeof WhiteboardOperationSnapshotEvent.Type;

export const WhiteboardOperationSessionEvent = Schema.Union([
  WhiteboardOperationSnapshotEvent,
  WhiteboardOperationAdmittedEvent,
  WhiteboardOperationProgressEvent,
  WhiteboardTakeOverPendingEvent,
  WhiteboardContainmentResultEvent,
  WhiteboardOperationTerminalEvent,
]);
export type WhiteboardOperationSessionEvent = typeof WhiteboardOperationSessionEvent.Type;

/**
 * Producer-facing admission input for the internal (non-WebSocket)
 * `admitOperation` method. The server mints `operationId` and `generation`.
 */
export const WhiteboardAdmitOperationInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
});
export type WhiteboardAdmitOperationInput = typeof WhiteboardAdmitOperationInput.Type;

/**
 * Producer-facing progress input for the internal `publishProgress` method.
 * The server mints `serverSequence` and rejects skipped/out-of-order input
 * before browser delivery.
 */
export const WhiteboardPublishProgressInput = StrictObject(
  StrictStruct({
    ...WhiteboardOperationSessionIdentity.fields,
    batchId: BoundedId(128),
    operationId: BoundedId(128),
    generation: PositiveInt,
    producerSequence: PositiveInt,
    dependsOnProducerSequences: Schema.Array(PositiveInt).check(Schema.isMaxLength(16)),
    expectedBeforeRevision: NonNegativeInt,
    expectedAfterRevision: NonNegativeInt,
    expectedSemanticFingerprint: ImageFreeWireString(8_192),
    mutation: WhiteboardProgressMutation,
  }).check(HasValidProducerDependencies),
);
export type WhiteboardPublishProgressInput = typeof WhiteboardPublishProgressInput.Type;

/** Producer-facing completion input for the internal `completeOperation`. */
export const WhiteboardCompleteOperationInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
});
export type WhiteboardCompleteOperationInput = typeof WhiteboardCompleteOperationInput.Type;

/**
 * Producer-facing failure input for the internal `failOperation`. The
 * terminal taxonomy is still derived by the server from acknowledgement
 * evidence; this input only reports producer-side failure.
 */
export const WhiteboardFailOperationInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
});
export type WhiteboardFailOperationInput = typeof WhiteboardFailOperationInput.Type;
