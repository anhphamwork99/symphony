import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";

import {
  WHITEBOARD_OPERATION_ERROR,
  WHITEBOARD_OPERATION_SESSION_CAPABILITY,
  WhiteboardAcknowledgeApplicationInput,
  WhiteboardOperationProgressEvent,
  WhiteboardOperationSnapshotEvent,
  WhiteboardOperationTakeOverResult,
  WhiteboardOperationTerminalEvent,
  WhiteboardProgressMutation,
  WhiteboardPublishProgressInput,
  WhiteboardOperationSessionEvent,
} from "./whiteboardOperation";
import { WS_METHODS } from "./ws";
import { WsFeatureRpcGroup } from "./rpc";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const sessionIdentity = {
  serverInstanceId: "server-1",
  operationSessionId: "session-1",
  sessionEpoch: 1,
  projectId: "project-1",
  documentKind: "untitled-canvas" as const,
  documentId: "doc-1",
  canvasIdentity: "canvas-1",
};

const validMutation = {
  format: "synara.whiteboard.progress/v1" as const,
  elements: [
    {
      id: "shape-1",
      type: "rectangle" as const,
      x: 10,
      y: 20,
      width: 100,
      height: 60,
    },
  ],
};

const validPublishProgressInput = {
  ...sessionIdentity,
  batchId: "batch-1",
  operationId: "op-1",
  generation: 1,
  producerSequence: 3,
  dependsOnProducerSequences: [1, 2],
  expectedBeforeRevision: 0,
  expectedAfterRevision: 1,
  expectedSemanticFingerprint: "fp",
  mutation: validMutation,
};

const validProgressEvent = {
  kind: "operation-progress" as const,
  ...validPublishProgressInput,
  serverSequence: 3,
};

const acknowledgementSummary = {
  acceptedSemanticCount: 0,
  acceptedNoOpCount: 0,
  rejectedCount: 0,
  lastAcceptedProducerSequence: 0,
};

describe("Whiteboard operation-session contracts", () => {
  it("names exactly the six browser methods authorized by Decision 0063", () => {
    expect(WS_METHODS.whiteboardOperationAttachSession).toBe(
      "whiteboard.operation.attachSession",
    );
    expect(WS_METHODS.whiteboardOperationSubscribe).toBe("whiteboard.operation.subscribe");
    expect(WS_METHODS.whiteboardOperationAcknowledgeApplication).toBe(
      "whiteboard.operation.acknowledgeApplication",
    );
    expect(WS_METHODS.whiteboardOperationTakeOver).toBe("whiteboard.operation.takeOver");
    expect(WS_METHODS.whiteboardOperationRetry).toBe("whiteboard.operation.retry");
    expect(WS_METHODS.whiteboardOperationReleaseSession).toBe(
      "whiteboard.operation.releaseSession",
    );
    const whiteboardMethods = Object.values(WS_METHODS).filter((method) =>
      method.startsWith("whiteboard.operation."),
    );
    expect(whiteboardMethods).toHaveLength(6);
  });

  it("places all six browser methods in the canonical WsFeatureRpcGroup and no producer method", () => {
    const memberTags = [...WsFeatureRpcGroup.requests.keys()];
    for (const method of [
      WS_METHODS.whiteboardOperationAttachSession,
      WS_METHODS.whiteboardOperationSubscribe,
      WS_METHODS.whiteboardOperationAcknowledgeApplication,
      WS_METHODS.whiteboardOperationTakeOver,
      WS_METHODS.whiteboardOperationRetry,
      WS_METHODS.whiteboardOperationReleaseSession,
    ]) {
      expect(memberTags).toContain(method);
    }
    // The internal producer methods must never become browser-callable RPC.
    for (const producer of [
      "admitOperation",
      "publishProgress",
      "completeOperation",
      "failOperation",
    ]) {
      expect(memberTags).not.toContain(producer);
    }
    expect(memberTags.filter((tag) => tag.startsWith("whiteboard."))).toHaveLength(6);
  });

  it("keeps the capability optional and off the client-required list", async () => {
    const { WS_CLIENT_REQUIRED_CAPABILITIES, WS_SERVER_CAPABILITIES } = await import(
      "./wsCompatibility"
    );
    expect(WHITEBOARD_OPERATION_SESSION_CAPABILITY).toBe("whiteboard.operation-session-v1");
    expect(WS_SERVER_CAPABILITIES).toContain(WHITEBOARD_OPERATION_SESSION_CAPABILITY);
    expect(WS_CLIENT_REQUIRED_CAPABILITIES).not.toContain(
      WHITEBOARD_OPERATION_SESSION_CAPABILITY,
    );
  });

  it.effect("accepts a strict bounded progress mutation", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(WhiteboardProgressMutation, validMutation);
      assert.strictEqual(parsed.elements.length, 1);
    }),
  );

  it.effect("rejects oversized, unversioned, and wrongly-versioned payloads", () =>
    Effect.gen(function* () {
      const exitWrongFormat = yield* Effect.exit(
        decode(WhiteboardProgressMutation, { ...validMutation, format: "v2" }),
      );
      assert.strictEqual(exitWrongFormat._tag, "Failure");

      const exitTooManyElements = yield* Effect.exit(
        decode(WhiteboardProgressMutation, {
          ...validMutation,
          elements: Array.from({ length: 257 }, (_, index) => ({
            id: `shape-${index}`,
            type: "rectangle" as const,
            x: 0,
            y: 0,
          })),
        }),
      );
      assert.strictEqual(exitTooManyElements._tag, "Failure");

      const exitOversizedId = yield* Effect.exit(
        decode(WhiteboardProgressMutation, {
          ...validMutation,
          elements: [{ id: "x".repeat(129), type: "rectangle", x: 0, y: 0 }],
        }),
      );
      assert.strictEqual(exitOversizedId._tag, "Failure");
    }),
  );

  it.effect("fails closed on top-level and nested unknown, image, and file fields", () =>
    Effect.gen(function* () {
      yield* decode(WhiteboardProgressMutation, validMutation);

      const forbiddenPayloads = [
        { ...validMutation, unknownTopLevel: true },
        { ...validMutation, files: { "file-1": {} } },
        { ...validMutation, dataURL: "data:image/png;base64,AAAA" },
        { ...validMutation, image: { width: 1, height: 1 } },
        { ...validMutation, binary: new Uint8Array([1]) },
        { ...validMutation, elements: [{ ...validMutation.elements[0], fileId: "file-1" }] },
        {
          ...validMutation,
          elements: [
            { ...validMutation.elements[0], dataUrl: "data:image/png;base64,AAAA" },
          ],
        },
        { ...validMutation, elements: [{ ...validMutation.elements[0], files: {} }] },
        { ...validMutation, elements: [{ ...validMutation.elements[0], image: {} }] },
        { ...validMutation, elements: [{ ...validMutation.elements[0], binary: [1, 2] }] },
      ];

      for (const payload of forbiddenPayloads) {
        const exit = yield* Effect.exit(decode(WhiteboardProgressMutation, payload));
        assert.strictEqual(exit._tag, "Failure");
      }

      const exitNestedSnapshotField = yield* Effect.exit(
        decode(WhiteboardOperationSnapshotEvent, {
          kind: "session-snapshot",
          ...sessionIdentity,
          serverSequence: 1,
          documentRevision: 0,
          acknowledgementSummary: { ...acknowledgementSummary, files: {} },
        }),
      );
      assert.strictEqual(exitNestedSnapshotField._tag, "Failure");

      const snapshotBase = {
        kind: "session-snapshot" as const,
        ...sessionIdentity,
        serverSequence: 1,
        documentRevision: 0,
        acknowledgementSummary,
      };
      for (const nestedState of [
        {
          activeOperation: {
            batchId: "batch-1",
            operationId: "op-1",
            generation: 1,
            expectedDocumentRevision: 0,
            retryAttempt: 0,
            fileId: "file-1",
          },
        },
        {
          takeOver: {
            takeOverRequestId: "take-over-1",
            requestedGeneration: 1,
            status: "pending",
            image: {},
          },
        },
        {
          terminal: {
            batchId: "batch-1",
            operationId: "op-1",
            generation: 1,
            outcome: "completed",
            dataURL: "data:image/png;base64,AAAA",
          },
        },
      ]) {
        const exit = yield* Effect.exit(
          decode(WhiteboardOperationSnapshotEvent, { ...snapshotBase, ...nestedState }),
        );
        assert.strictEqual(exit._tag, "Failure");
      }

      const exitCheckedTopLevelField = yield* Effect.exit(
        decode(WhiteboardPublishProgressInput, {
          ...validPublishProgressInput,
          unknownTopLevel: true,
        }),
      );
      assert.strictEqual(exitCheckedTopLevelField._tag, "Failure");

      const jsonCodec = Schema.toCodecJson(WhiteboardPublishProgressInput);
      const exitCodecUnknownField = yield* Effect.exit(
        Schema.decodeUnknownEffect(jsonCodec)({
          ...validPublishProgressInput,
          files: {},
        }),
      );
      assert.strictEqual(exitCodecUnknownField._tag, "Failure");

      const exitNonFinite = yield* Effect.exit(
        decode(WhiteboardProgressMutation, {
          format: "synara.whiteboard.progress/v1",
          elements: [{ id: "shape-1", type: "rectangle", x: Number.POSITIVE_INFINITY, y: 0 }],
        }),
      );
      assert.strictEqual(exitNonFinite._tag, "Failure");
    }),
  );

  it.effect("enforces bounded, unique, strictly earlier publish dependencies", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(WhiteboardPublishProgressInput, validPublishProgressInput);
      assert.deepStrictEqual(parsed.dependsOnProducerSequences, [1, 2]);

      const exitTooManyDependencies = yield* Effect.exit(
        decode(WhiteboardPublishProgressInput, {
          ...validPublishProgressInput,
          producerSequence: 18,
          dependsOnProducerSequences: Array.from({ length: 17 }, (_, index) => index + 1),
        }),
      );
      assert.strictEqual(exitTooManyDependencies._tag, "Failure");

      const exitZeroProducerSequence = yield* Effect.exit(
        decode(WhiteboardPublishProgressInput, {
          ...validPublishProgressInput,
          producerSequence: 0,
          dependsOnProducerSequences: [],
        }),
      );
      assert.strictEqual(exitZeroProducerSequence._tag, "Failure");

      for (const dependsOnProducerSequences of [[1, 1], [1, 3], [4]]) {
        const exit = yield* Effect.exit(
          decode(WhiteboardPublishProgressInput, {
            ...validPublishProgressInput,
            dependsOnProducerSequences,
          }),
        );
        assert.strictEqual(exit._tag, "Failure");
      }
    }),
  );

  it.effect("enforces unique, strictly earlier dependencies on progress events", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(WhiteboardOperationProgressEvent, validProgressEvent);
      assert.deepStrictEqual(parsed.dependsOnProducerSequences, [1, 2]);

      for (const dependsOnProducerSequences of [[2, 2], [1, 3], [4]]) {
        const exit = yield* Effect.exit(
          decode(WhiteboardOperationProgressEvent, {
            ...validProgressEvent,
            dependsOnProducerSequences,
          }),
        );
        assert.strictEqual(exit._tag, "Failure");
      }
    }),
  );

  it.effect("bounds acknowledgement fingerprints and restricts application results", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(WhiteboardAcknowledgeApplicationInput, {
        ...sessionIdentity,
        batchId: "batch-1",
        operationId: "op-1",
        generation: 1,
        producerSequence: 1,
        serverSequence: 1,
        adapterCorrelationId: "corr-1",
        applicationResult: "applied-semantic",
        resultingMutationRevision: 1,
        verifiedSemanticFingerprint: "fp",
      });
      assert.strictEqual(parsed.applicationResult, "applied-semantic");

      for (const invalid of ["applied", "semantic", "failed", 42]) {
        const exit = yield* Effect.exit(
          decode(WhiteboardAcknowledgeApplicationInput, {
            ...sessionIdentity,
            batchId: "batch-1",
            operationId: "op-1",
            generation: 1,
            producerSequence: 1,
            serverSequence: 1,
            adapterCorrelationId: "corr-1",
            applicationResult: invalid,
            resultingMutationRevision: 1,
            verifiedSemanticFingerprint: "fp",
          }),
        );
        assert.strictEqual(exit._tag, "Failure");
      }

      const exitOversizedFingerprint = yield* Effect.exit(
        decode(WhiteboardAcknowledgeApplicationInput, {
          ...sessionIdentity,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          producerSequence: 1,
          serverSequence: 1,
          adapterCorrelationId: "corr-1",
          applicationResult: "applied-semantic",
          resultingMutationRevision: 1,
          verifiedSemanticFingerprint: "f".repeat(8_193),
        }),
      );
      assert.strictEqual(exitOversizedFingerprint._tag, "Failure");
    }),
  );

  it.effect("requires diagnostics only for rejected application acknowledgements", () =>
    Effect.gen(function* () {
      const baseAcknowledgement = {
        ...sessionIdentity,
        batchId: "batch-1",
        operationId: "op-1",
        generation: 1,
        producerSequence: 1,
        serverSequence: 1,
        adapterCorrelationId: "corr-1",
        resultingMutationRevision: 1,
        verifiedSemanticFingerprint: "fp",
      };

      yield* decode(WhiteboardAcknowledgeApplicationInput, {
        ...baseAcknowledgement,
        applicationResult: "rejected",
        diagnosticCode: "adapter-not-ready",
      });
      for (const applicationResult of ["applied-semantic", "applied-no-op"] as const) {
        yield* decode(WhiteboardAcknowledgeApplicationInput, {
          ...baseAcknowledgement,
          applicationResult,
        });
      }

      const invalidAcknowledgements = [
        { ...baseAcknowledgement, applicationResult: "rejected" },
        {
          ...baseAcknowledgement,
          applicationResult: "applied-semantic",
          diagnosticCode: "adapter-not-ready",
        },
        {
          ...baseAcknowledgement,
          applicationResult: "applied-no-op",
          diagnosticCode: "adapter-not-ready",
        },
      ];
      for (const acknowledgement of invalidAcknowledgements) {
        const exit = yield* Effect.exit(
          decode(WhiteboardAcknowledgeApplicationInput, acknowledgement),
        );
        assert.strictEqual(exit._tag, "Failure");
      }
    }),
  );

  it.effect("enforces terminal zero-valid reasons in events and snapshots", () =>
    Effect.gen(function* () {
      const terminalBase = {
        kind: "operation-terminal" as const,
        ...sessionIdentity,
        serverSequence: 9,
        batchId: "batch-1",
        operationId: "op-1",
        generation: 1,
        acceptedSemanticCount: 0,
        acceptedNoOpCount: 0,
        rejectedCount: 0,
        lastAcceptedProducerSequence: 0,
      };
      const snapshotBase = {
        kind: "session-snapshot" as const,
        ...sessionIdentity,
        serverSequence: 9,
        documentRevision: 0,
        acknowledgementSummary,
      };

      yield* decode(WhiteboardOperationTerminalEvent, {
        ...terminalBase,
        outcome: "zero-valid",
        zeroValidReason: "zero-mutation",
      });
      yield* decode(WhiteboardOperationTerminalEvent, {
        ...terminalBase,
        outcome: "completed",
      });
      yield* decode(WhiteboardOperationSnapshotEvent, {
        ...snapshotBase,
        terminal: {
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          outcome: "zero-valid",
          zeroValidReason: "semantic-no-op",
        },
      });
      yield* decode(WhiteboardOperationSnapshotEvent, {
        ...snapshotBase,
        terminal: {
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          outcome: "interrupted",
        },
      });

      const invalidTerminalStates = [
        { ...terminalBase, outcome: "zero-valid" },
        {
          ...terminalBase,
          outcome: "completed",
          zeroValidReason: "zero-mutation",
        },
      ];
      for (const terminal of invalidTerminalStates) {
        const exit = yield* Effect.exit(decode(WhiteboardOperationTerminalEvent, terminal));
        assert.strictEqual(exit._tag, "Failure");
      }

      const invalidSnapshotTerminals = [
        {
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          outcome: "zero-valid",
        },
        {
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          outcome: "failed-partial",
          zeroValidReason: "all-operations-rejected",
        },
      ];
      for (const terminal of invalidSnapshotTerminals) {
        const exit = yield* Effect.exit(
          decode(WhiteboardOperationSnapshotEvent, { ...snapshotBase, terminal }),
        );
        assert.strictEqual(exit._tag, "Failure");
      }
    }),
  );

  it.effect("enforces Take Over containment state in results and snapshots", () =>
    Effect.gen(function* () {
      const takeOverResultBase = {
        batchId: "batch-1",
        operationId: "op-1",
        generation: 2,
        takeOverRequestId: "take-over-1",
        requestedGeneration: 1,
      };
      const snapshotBase = {
        kind: "session-snapshot" as const,
        ...sessionIdentity,
        serverSequence: 4,
        documentRevision: 0,
        acknowledgementSummary,
      };

      yield* decode(WhiteboardOperationTakeOverResult, {
        ...takeOverResultBase,
        status: "pending",
      });
      yield* decode(WhiteboardOperationTakeOverResult, {
        ...takeOverResultBase,
        status: "contained",
        containmentResult: "acknowledged",
      });
      yield* decode(WhiteboardOperationSnapshotEvent, {
        ...snapshotBase,
        takeOver: {
          takeOverRequestId: "take-over-1",
          requestedGeneration: 1,
          status: "pending",
        },
      });
      yield* decode(WhiteboardOperationSnapshotEvent, {
        ...snapshotBase,
        takeOver: {
          takeOverRequestId: "take-over-1",
          requestedGeneration: 1,
          status: "contained",
          containmentResult: "dispatch-failed",
        },
      });

      for (const result of [
        { ...takeOverResultBase, status: "contained" },
        {
          ...takeOverResultBase,
          status: "pending",
          containmentResult: "acknowledged",
        },
      ]) {
        const exit = yield* Effect.exit(decode(WhiteboardOperationTakeOverResult, result));
        assert.strictEqual(exit._tag, "Failure");
      }

      for (const takeOver of [
        {
          takeOverRequestId: "take-over-1",
          requestedGeneration: 1,
          status: "contained",
        },
        {
          takeOverRequestId: "take-over-1",
          requestedGeneration: 1,
          status: "pending",
          containmentResult: "acknowledged",
        },
      ]) {
        const exit = yield* Effect.exit(
          decode(WhiteboardOperationSnapshotEvent, { ...snapshotBase, takeOver }),
        );
        assert.strictEqual(exit._tag, "Failure");
      }
    }),
  );

  it.effect("decodes every stream event kind through the session event union", () =>
    Effect.gen(function* () {
      const events: ReadonlyArray<Record<string, unknown>> = [
        {
          kind: "session-snapshot",
          ...sessionIdentity,
          serverSequence: 1,
          documentRevision: 0,
          acknowledgementSummary,
        },
        {
          kind: "operation-admitted",
          ...sessionIdentity,
          serverSequence: 2,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          expectedDocumentRevision: 0,
          retryAttempt: 0,
        },
        validProgressEvent,
        {
          kind: "take-over-pending",
          ...sessionIdentity,
          serverSequence: 4,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 2,
          takeOverRequestId: "take-over-1",
          requestedGeneration: 1,
        },
        {
          kind: "containment-result",
          ...sessionIdentity,
          serverSequence: 5,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 2,
          takeOverRequestId: "take-over-1",
          result: "acknowledged",
        },
        {
          kind: "operation-terminal",
          ...sessionIdentity,
          serverSequence: 6,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 2,
          outcome: "completed",
          acceptedSemanticCount: 1,
          acceptedNoOpCount: 0,
          rejectedCount: 0,
          lastAcceptedProducerSequence: 3,
        },
      ];

      for (const event of events) {
        const parsed = yield* decode(WhiteboardOperationSessionEvent, event);
        assert.strictEqual(parsed.kind, event.kind);
        for (const [field, value] of Object.entries(sessionIdentity)) {
          assert.strictEqual(parsed[field as keyof typeof parsed], value);
        }
      }

      for (const event of events) {
        for (const field of Object.keys(sessionIdentity)) {
          const missingIdentity = { ...event };
          delete missingIdentity[field];
          const exit = yield* Effect.exit(
            decode(WhiteboardOperationSessionEvent, missingIdentity),
          );
          assert.strictEqual(exit._tag, "Failure");
        }
      }

      const exitInvalidOutcome = yield* Effect.exit(
        decode(WhiteboardOperationSessionEvent, {
          kind: "operation-terminal",
          ...sessionIdentity,
          serverSequence: 9,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          outcome: "partially-completed",
          acceptedSemanticCount: 0,
          acceptedNoOpCount: 0,
          rejectedCount: 0,
          lastAcceptedProducerSequence: 0,
        }),
      );
      assert.strictEqual(exitInvalidOutcome._tag, "Failure");
    }),
  );

  it("keeps the bounded diagnostic-code vocabulary closed", () => {
    expect(Object.keys(WHITEBOARD_OPERATION_ERROR)).toHaveLength(24);
    expect(WHITEBOARD_OPERATION_ERROR.resetRequired).toBe("operation-session-reset-required");
    expect(WHITEBOARD_OPERATION_ERROR.sessionLost).toBe("operation-session-lost");
  });
});
