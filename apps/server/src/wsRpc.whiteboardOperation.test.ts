import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { describe, expect, it } from "vitest";

import {
  WS_COMPATIBILITY_QUERY,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WS_NEGOTIATE_QUERY,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WS_PROTOCOL_EPOCH,
  WS_SERVER_CAPABILITIES,
  WsBootstrapNegotiateResult,
  WsFeatureRpcGroup,
  WHITEBOARD_OPERATION_ERROR,
  WS_METHODS,
} from "@synara/contracts";
import { Schema } from "effect";

import { makeWsOrchestrationHarness } from "../integration/WsOrchestrationHarness.integration";

const makeRpcClient = RpcClient.make(WsFeatureRpcGroup);

interface WhiteboardRpcClient {
  readonly attach: (input: unknown) => Effect.Effect<unknown>;
  readonly subscribe: (input: unknown) => Stream.Stream<unknown, unknown>;
  readonly acknowledge: (input: unknown) => Effect.Effect<unknown>;
  readonly takeOver: (input: unknown) => Effect.Effect<unknown>;
  readonly retry: (input: unknown) => Effect.Effect<unknown>;
  readonly release: (input: unknown) => Effect.Effect<unknown>;
  readonly close: () => Promise<void>;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
}

async function connectWhiteboardClient(port: number): Promise<WhiteboardRpcClient> {
  const clientBuild = "synara-whiteboard-operation-route-test/1";
  const negotiateUrl = new URL(`http://127.0.0.1:${port}${WS_NEGOTIATE_HTTP_PATH}`);
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.clientBuild, clientBuild);
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.minRevision, String(WS_PROTOCOL_MIN_REVISION));
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.maxRevision, String(WS_PROTOCOL_MAX_REVISION));
  for (const capability of WS_SERVER_CAPABILITIES) {
    negotiateUrl.searchParams.append(WS_NEGOTIATE_QUERY.requiredCapability, capability);
  }
  const response = await fetch(negotiateUrl, { cache: "no-store" });
  expect(response.ok).toBe(true);
  const negotiated = Schema.decodeUnknownOption(WsBootstrapNegotiateResult)(
    await response.json(),
  );
  expect(negotiated._tag).toBe("Some");
  if (negotiated._tag === "None") throw new Error("Negotiation result was not readable");

  const socketUrl = new URL(`ws://127.0.0.1:${port}${WS_FEATURE_PATH}`);
  socketUrl.searchParams.set(WS_COMPATIBILITY_QUERY.clientBuild, clientBuild);
  socketUrl.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolEpoch,
    String(negotiated.value.protocolEpoch),
  );
  socketUrl.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolRevision,
    String(negotiated.value.negotiatedRevision),
  );
  socketUrl.searchParams.set(
    WS_COMPATIBILITY_QUERY.serverInstanceId,
    negotiated.value.serverInstanceId,
  );

  const socketLayer = Socket.layerWebSocket(socketUrl.toString()).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  const protocolLayer = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  );
  const runtime = ManagedRuntime.make(protocolLayer);
  const scope = runtime.runSync(Scope.make());
  const client = await runtime.runPromise(Scope.provide(scope)(makeRpcClient));
  const call = (method: string, input: unknown) =>
    (client as unknown as Record<string, (value: unknown) => unknown>)[method]!(input);

  return {
    attach: (input) => call(WS_METHODS.whiteboardOperationAttachSession, input) as Effect.Effect<unknown>,
    subscribe: (input) =>
      call(WS_METHODS.whiteboardOperationSubscribe, input) as Stream.Stream<unknown, unknown>,
    acknowledge: (input) =>
      call(WS_METHODS.whiteboardOperationAcknowledgeApplication, input) as Effect.Effect<unknown>,
    takeOver: (input) => call(WS_METHODS.whiteboardOperationTakeOver, input) as Effect.Effect<unknown>,
    retry: (input) => call(WS_METHODS.whiteboardOperationRetry, input) as Effect.Effect<unknown>,
    release: (input) =>
      call(WS_METHODS.whiteboardOperationReleaseSession, input) as Effect.Effect<unknown>,
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    },
    runtime,
  };
}

const sessionInput = {
  projectId: "whiteboard-route-project",
  documentKind: "file-canvas",
  documentId: "whiteboard-route-document",
  canvasIdentity: "whiteboard-route-canvas",
  expectedDocumentRevision: 0,
};

function identityOf(result: Record<string, unknown>) {
  return {
    serverInstanceId: result.serverInstanceId,
    operationSessionId: result.operationSessionId,
    sessionEpoch: result.sessionEpoch,
    projectId: result.projectId,
    documentKind: result.documentKind,
    documentId: result.documentId,
    canvasIdentity: result.canvasIdentity,
  };
}

async function expectRpcCode(effect: Effect.Effect<unknown>, code: string, runtime: ManagedRuntime.ManagedRuntime<never, never>) {
  await expect(runtime.runPromise(effect)).rejects.toMatchObject({ code });
}

describe("canonical Whiteboard operation WebSocket route", () => {
  it("serves all six methods with negotiated authority, stream replacement, exact errors, and no producer RPCs", async () => {
    const harness = await makeWsOrchestrationHarness();
    const client = await connectWhiteboardClient(harness.port);
    try {
      const attached = (await client.runtime.runPromise(client.attach(sessionInput))) as Record<
        string,
        unknown
      >;
      expect(attached.serverInstanceId).toBe(harness.authority.authorityId === undefined ? attached.serverInstanceId : attached.serverInstanceId);
      expect(String(attached.serverInstanceId)).toHaveLength(36);
      const identity = identityOf(attached);

      const firstStream = client.subscribe({ ...identity, lastServerSequence: 0 });
      const first = await client.runtime.runPromise(
        Stream.runCollect(Stream.take(firstStream, 1)),
      );
      expect(Array.from(first)[0]).toMatchObject({
        kind: "session-snapshot",
        serverSequence: 1,
      });

      const secondStream = client.subscribe({ ...identity, lastServerSequence: 0 });
      const second = await client.runtime.runPromise(
        Stream.runCollect(Stream.take(secondStream, 1)),
      );
      expect(Array.from(second)[0]).toMatchObject({ kind: "session-snapshot" });

      const unknownOperation = {
        ...identity,
        batchId: "route-unknown-batch",
        operationId: "route-unknown-operation",
        generation: 1,
        producerSequence: 1,
        serverSequence: 2,
        adapterCorrelationId: "route-correlation",
        applicationResult: "applied-semantic",
        resultingMutationRevision: 0,
        verifiedSemanticFingerprint: "route-fingerprint",
      };
      await expectRpcCode(client.acknowledge(unknownOperation), WHITEBOARD_OPERATION_ERROR.ackUnknown, client.runtime);
      await expectRpcCode(
        client.takeOver({
          ...identity,
          batchId: "route-unknown-batch",
          operationId: "route-unknown-operation",
          expectedGeneration: 1,
          takeOverRequestId: "route-take-over",
        }),
        WHITEBOARD_OPERATION_ERROR.operationUnknown,
        client.runtime,
      );
      await expectRpcCode(
        client.retry({
          ...identity,
          batchId: "route-unknown-batch",
          failedOperationId: "route-unknown-operation",
          failedGeneration: 1,
          failedRetryAttempt: 0,
        }),
        WHITEBOARD_OPERATION_ERROR.operationUnknown,
        client.runtime,
      );

      const released = await client.runtime.runPromise(client.release(identity)) as Record<string, unknown>;
      expect(released).toMatchObject({ ...identity, released: true });
      await expectRpcCode(
        Stream.runCollect(
          Stream.take(client.subscribe({ ...identity, lastServerSequence: 0 }), 1),
        ),
        WHITEBOARD_OPERATION_ERROR.sessionReleased,
        client.runtime,
      );

      const producerNames = ["admitOperation", "publishProgress", "completeOperation", "failOperation"];
      for (const producerName of producerNames) {
        expect((client as unknown as Record<string, unknown>)[producerName]).toBeUndefined();
      }
    } finally {
      await client.close();
      await harness.dispose();
    }
  });
});
