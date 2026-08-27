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
  projectId: ProjectId,
  documentKind: WhiteboardDocumentKind,
  documentId: BoundedId(512),
  canvasIdentity: BoundedId(256),
});
export type WhiteboardOperationSessionIdentity = typeof WhiteboardOperationSessionIdentity.Type;

/** Fields a browser supplies when opening a session; the server mints the rest. */
export const WhiteboardOperationAttachSessionInput = StrictStruct({
  projectId: ProjectId,
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

/** One admitted operation's identity, generation, and retry lineage. */
export const WhiteboardOperationHandle = StrictStruct({
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
  expectedDocumentRevision: NonNegativeInt,
  retryOfOperationId: Schema.optional(BoundedId(128)),
  retryAttempt: NonNegativeInt,
});
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
  text: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
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
    verifiedSemanticFingerprint: BoundedId(8_192),
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

/** Acknowledgement result echoes the admission verdict for the caller. */
export const WhiteboardAcknowledgeApplicationResult = StrictStruct({
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

/** Recorded Take Over state returned for repeated equivalent requests. */
export const WhiteboardOperationTakeOverResult = StrictObject(
  StrictStruct({
    batchId: BoundedId(128),
    operationId: BoundedId(128),
    generation: PositiveInt,
    takeOverRequestId: BoundedId(128),
    requestedGeneration: PositiveInt,
    status: Schema.Literals(["pending", "contained"]),
    containmentResult: Schema.optional(WhiteboardContainmentResult),
  }).check(
    Schema.makeFilter((result) =>
      result.status === "contained"
        ? result.containmentResult !== undefined
        : result.containmentResult === undefined,
    ),
  ),
);
export type WhiteboardOperationTakeOverResult = typeof WhiteboardOperationTakeOverResult.Type;

/** Retry creates a NEW opaque operation id with a strictly greater generation. */
export const WhiteboardOperationRetryInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  failedOperationId: BoundedId(128),
});
export type WhiteboardOperationRetryInput = typeof WhiteboardOperationRetryInput.Type;

export const WhiteboardOperationRetryResult = StrictStruct({
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
  retryOfOperationId: BoundedId(128),
  retryAttempt: PositiveInt,
});
export type WhiteboardOperationRetryResult = typeof WhiteboardOperationRetryResult.Type;

export const WhiteboardOperationReleaseSessionInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
});
export type WhiteboardOperationReleaseSessionInput =
  typeof WhiteboardOperationReleaseSessionInput.Type;

export const WhiteboardOperationReleaseSessionResult = StrictStruct({
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
export const WhiteboardOperationAdmittedEvent = StrictStruct({
  kind: Schema.Literal("operation-admitted"),
  ...WhiteboardOperationSessionIdentity.fields,
  serverSequence: PositiveInt,
  batchId: BoundedId(128),
  operationId: BoundedId(128),
  generation: PositiveInt,
  expectedDocumentRevision: NonNegativeInt,
  retryOfOperationId: Schema.optional(BoundedId(128)),
  retryAttempt: NonNegativeInt,
});
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
    expectedSemanticFingerprint: BoundedId(8_192),
    mutation: WhiteboardProgressMutation,
  }).check(HasValidProducerDependencies),
);
export type WhiteboardOperationProgressEvent = typeof WhiteboardOperationProgressEvent.Type;

/** Stream event emitted when Take Over is recorded and the fence advanced. */
export const WhiteboardTakeOverPendingEvent = StrictStruct({
  kind: Schema.Literal("take-over-pending"),
  ...WhiteboardOperationSessionIdentity.fields,
  serverSequence: PositiveInt,
  batchId: BoundedId(128),
  ...ProducerSequenceFields,
  takeOverRequestId: BoundedId(128),
  requestedGeneration: PositiveInt,
});
export type WhiteboardTakeOverPendingEvent = typeof WhiteboardTakeOverPendingEvent.Type;

/** Stream event carrying exactly one authoritative containment result. */
export const WhiteboardContainmentResultEvent = StrictStruct({
  kind: Schema.Literal("containment-result"),
  ...WhiteboardOperationSessionIdentity.fields,
  serverSequence: PositiveInt,
  batchId: BoundedId(128),
  ...ProducerSequenceFields,
  takeOverRequestId: BoundedId(128),
  result: WhiteboardContainmentResult,
});
export type WhiteboardContainmentResultEvent = typeof WhiteboardContainmentResultEvent.Type;

/** Stream event carrying exactly one terminal outcome for an operation. */
export const WhiteboardOperationTerminalEvent = StrictObject(
  StrictStruct({
    kind: Schema.Literal("operation-terminal"),
    ...WhiteboardOperationSessionIdentity.fields,
    serverSequence: PositiveInt,
    batchId: BoundedId(128),
    operationId: BoundedId(128),
    generation: PositiveInt,
    outcome: WhiteboardTerminalOutcome,
    zeroValidReason: Schema.optional(WhiteboardZeroValidReason),
    acceptedSemanticCount: NonNegativeInt,
    acceptedNoOpCount: NonNegativeInt,
    rejectedCount: NonNegativeInt,
    lastAcceptedProducerSequence: NonNegativeInt,
    containmentResult: Schema.optional(WhiteboardContainmentResult),
  }).check(
    Schema.makeFilter((event) =>
      event.outcome === "zero-valid"
        ? event.zeroValidReason !== undefined
        : event.zeroValidReason === undefined,
    ),
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
    StrictStruct({
      batchId: BoundedId(128),
      operationId: BoundedId(128),
      generation: PositiveInt,
      expectedDocumentRevision: NonNegativeInt,
      retryOfOperationId: Schema.optional(BoundedId(128)),
      retryAttempt: NonNegativeInt,
    }),
  ),
  takeOver: Schema.optional(
    StrictObject(
      StrictStruct({
        takeOverRequestId: BoundedId(128),
        requestedGeneration: PositiveInt,
        status: Schema.Literals(["pending", "contained"]),
        containmentResult: Schema.optional(WhiteboardContainmentResult),
      }).check(
        Schema.makeFilter((state) =>
          state.status === "contained"
            ? state.containmentResult !== undefined
            : state.containmentResult === undefined,
        ),
      ),
    ),
  ),
  acknowledgementSummary: StrictStruct({
    acceptedSemanticCount: NonNegativeInt,
    acceptedNoOpCount: NonNegativeInt,
    rejectedCount: NonNegativeInt,
    lastAcceptedProducerSequence: NonNegativeInt,
  }),
  terminal: Schema.optional(
    StrictObject(
      StrictStruct({
        batchId: BoundedId(128),
        operationId: BoundedId(128),
        generation: PositiveInt,
        outcome: WhiteboardTerminalOutcome,
        zeroValidReason: Schema.optional(WhiteboardZeroValidReason),
        containmentResult: Schema.optional(WhiteboardContainmentResult),
      }).check(
        Schema.makeFilter((terminal) =>
          terminal.outcome === "zero-valid"
            ? terminal.zeroValidReason !== undefined
            : terminal.zeroValidReason === undefined,
        ),
      ),
    ),
  ),
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
    expectedSemanticFingerprint: BoundedId(8_192),
    mutation: WhiteboardProgressMutation,
  }).check(HasValidProducerDependencies),
);
export type WhiteboardPublishProgressInput = typeof WhiteboardPublishProgressInput.Type;

/** Producer-facing completion input for the internal `completeOperation`. */
export const WhiteboardCompleteOperationInput = StrictStruct({
  ...WhiteboardOperationSessionIdentity.fields,
  batchId: BoundedId(128),
  operationId: BoundedId(128),
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
});
export type WhiteboardFailOperationInput = typeof WhiteboardFailOperationInput.Type;
