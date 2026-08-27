import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";

import {
  WHITEBOARD_OPERATION_ERROR,
  WHITEBOARD_OPERATION_SESSION_CAPABILITY,
  WhiteboardAcknowledgeApplicationInput,
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

  it.effect("rejects image-bearing, file-bearing, and non-finite payloads", () =>
    Effect.gen(function* () {
      // File/image fields are not part of the schema: a payload shaped like an
      // image mutation carries no canonical field and cannot introduce a file
      // reference through any admitted field.
      const imageShaped = yield* decode(WhiteboardProgressMutation, {
        format: "synara.whiteboard.progress/v1",
        elements: [
          {
            id: "image-1",
            type: "rectangle",
            x: 0,
            y: 0,
            fileId: "file-binary",
            dataUrl: "data:image/png;base64,AAAA",
            files: { "file-binary": {} },
          },
        ],
      });
      expect(imageShaped.elements[0]).not.toHaveProperty("fileId");
      expect(imageShaped.elements[0]).not.toHaveProperty("dataUrl");
      expect(imageShaped.elements[0]).not.toHaveProperty("files");

      const exitNonFinite = yield* Effect.exit(
        decode(WhiteboardProgressMutation, {
          format: "synara.whiteboard.progress/v1",
          elements: [{ id: "shape-1", type: "rectangle", x: Number.POSITIVE_INFINITY, y: 0 }],
        }),
      );
      assert.strictEqual(exitNonFinite._tag, "Failure");
    }),
  );

  it.effect("bounds dependency lists and requires positive sequences", () =>
    Effect.gen(function* () {
      const exitTooManyDependencies = yield* Effect.exit(
        decode(WhiteboardPublishProgressInput, {
          ...sessionIdentity,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          producerSequence: 1,
          dependsOnProducerSequences: Array.from({ length: 17 }, (_, index) => index + 1),
          expectedBeforeRevision: 0,
          expectedAfterRevision: 1,
          expectedSemanticFingerprint: "fp",
          mutation: validMutation,
        }),
      );
      assert.strictEqual(exitTooManyDependencies._tag, "Failure");

      const exitZeroProducerSequence = yield* Effect.exit(
        decode(WhiteboardPublishProgressInput, {
          ...sessionIdentity,
          batchId: "batch-1",
          operationId: "op-1",
          generation: 1,
          producerSequence: 0,
          dependsOnProducerSequences: [],
          expectedBeforeRevision: 0,
          expectedAfterRevision: 1,
          expectedSemanticFingerprint: "fp",
          mutation: validMutation,
        }),
      );
      assert.strictEqual(exitZeroProducerSequence._tag, "Failure");
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

  it.effect("decodes every stream event kind through the session event union", () =>
    Effect.gen(function* () {
      const snapshot = yield* decode(WhiteboardOperationSessionEvent, {
        kind: "session-snapshot",
        serverSequence: 1,
        documentRevision: 0,
        acknowledgementSummary: {
          acceptedSemanticCount: 0,
          acceptedNoOpCount: 0,
          rejectedCount: 0,
          lastAcceptedProducerSequence: 0,
        },
      });
      assert.strictEqual(snapshot.kind, "session-snapshot");

      const terminal = yield* decode(WhiteboardOperationSessionEvent, {
        kind: "operation-terminal",
        serverSequence: 9,
        batchId: "batch-1",
        operationId: "op-1",
        generation: 1,
        outcome: "zero-valid",
        zeroValidReason: "semantic-no-op",
        acceptedSemanticCount: 0,
        acceptedNoOpCount: 1,
        rejectedCount: 0,
        lastAcceptedProducerSequence: 1,
      });
      expect(
        terminal.kind === "operation-terminal" ? terminal.zeroValidReason : undefined,
      ).toBe("semantic-no-op");

      const exitInvalidOutcome = yield* Effect.exit(
        decode(WhiteboardOperationSessionEvent, {
          kind: "operation-terminal",
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
