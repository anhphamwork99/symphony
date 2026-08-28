import { Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope, Stream } from "effect";
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
import { makeWhiteboardOperationSessionService } from "./whiteboard/WhiteboardOperationSessionService";
import { makeWsRequestAdmission } from "./wsRequestAdmission";

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

async function connectWhiteboardClient(
  port: number,
): Promise<WhiteboardRpcClient & { readonly serverInstanceId: string }> {
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
    serverInstanceId: negotiated.value.serverInstanceId,
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

async function expectRpcError(
  effect: Effect.Effect<unknown>,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
  expected: Record<string, unknown>,
) {
  let error: unknown;
  try {
    await runtime.runPromise(effect);
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject(expected);
  return error as Record<string, unknown>;
}

describe("canonical Whiteboard operation WebSocket route", () => {
  it("keeps the first same-key subscription live until replacement, then terminates it cleanly", async () => {
    const harness = await makeWsOrchestrationHarness();
    const client = await connectWhiteboardClient(harness.port);
    try {
      const attached = (await client.runtime.runPromise(client.attach(sessionInput))) as Record<string, unknown>;
      expect(attached.serverInstanceId).toBe(client.serverInstanceId);
      expect(String(attached.serverInstanceId)).toHaveLength(36);
      const identity = identityOf(attached);
      const firstSnapshotSeen = Deferred.makeUnsafe<void>();
      const firstCompletion = client.runtime.runPromise(
        Stream.runCollect(
          Stream.tap(client.subscribe({ ...identity, lastServerSequence: 0 }), () =>
            Deferred.succeed(firstSnapshotSeen, undefined)),
        ),
      );
      await client.runtime.runPromise(Deferred.await(firstSnapshotSeen));

      const second = Array.from(
        await client.runtime.runPromise(
          Stream.runCollect(Stream.take(client.subscribe({ ...identity, lastServerSequence: 0 }), 1)),
        ),
      );
      expect(second[0]).toMatchObject({ kind: "session-snapshot", ...identity });
      const firstEvents = Array.from(await firstCompletion);
      expect(firstEvents.length).toBeGreaterThanOrEqual(1);
      expect(firstEvents.every((event) => event.kind === "session-snapshot")).toBe(true);
      expect(firstEvents[0]).toMatchObject({ kind: "session-snapshot", ...identity });
      for (const producerName of ["admitOperation", "publishProgress", "completeOperation", "failOperation"]) {
        expect((client as unknown as Record<string, unknown>)[producerName]).toBeUndefined();
      }
    } finally {
      await client.close();
      await harness.dispose();
    }
  });

  it("proves the exact producer snapshot/replay/live sequence through the service seam", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeWhiteboardOperationSessionService({
            serverInstanceId: "whiteboard-route-seam-server",
          });
          const attached = yield* service.attachSession(sessionInput);
          const identity = identityOf(attached);
          const stream = yield* service.subscribe({ ...identity, lastServerSequence: 0 });
          const eventsPromise = Effect.runPromise(Stream.runCollect(Stream.take(stream, 4)));
          const admitted = yield* service.admitOperation({ ...identity, batchId: "route-seam-batch" });
          const progress = yield* service.publishProgress({
            ...identity,
            batchId: admitted.batchId,
            operationId: admitted.operationId,
            generation: admitted.generation,
            producerSequence: 1,
            dependsOnProducerSequences: [],
            expectedBeforeRevision: 0,
            expectedAfterRevision: 1,
            expectedSemanticFingerprint: "route-seam-fingerprint",
            mutation: {
              format: "synara.whiteboard.progress/v1",
              elements: [{ id: "route-seam-element", type: "rectangle", x: 1, y: 2 }],
            },
          });
          const events = Array.from(yield* Effect.promise(() => eventsPromise));
          expect(events.map((event) => event.kind)).toEqual([
            "session-snapshot",
            "session-snapshot",
            "operation-admitted",
            "operation-progress",
          ]);
          expect(events[0]).toMatchObject(identity);
          expect(events[1]).toMatchObject(identity);
          expect(events[2]).toMatchObject({
            ...identity,
            kind: "operation-admitted",
            batchId: admitted.batchId,
            operationId: admitted.operationId,
            generation: admitted.generation,
            retryAttempt: 0,
          });
          expect(events[3]).toMatchObject({
            ...identity,
            kind: "operation-progress",
            batchId: progress.batchId,
            operationId: progress.operationId,
            generation: progress.generation,
            producerSequence: 1,
            dependsOnProducerSequences: [],
            expectedBeforeRevision: 0,
            expectedAfterRevision: 1,
            expectedSemanticFingerprint: "route-seam-fingerprint",
            mutation: {
              format: "synara.whiteboard.progress/v1",
              elements: [{ id: "route-seam-element", type: "rectangle", x: 1, y: 2 }],
            },
          });
          expect(new Set(events.slice(2).map((event) => event.serverSequence)).size).toBe(2);
        }),
      ),
    );
  });

  it("enforces 20 stream leases and 12 standard unary leases with exact retry metadata", async () => {
    const harness = await makeWsOrchestrationHarness();
    const client = await connectWhiteboardClient(harness.port);
    const heldFibers: Array<ReturnType<typeof client.runtime.runFork>> = [];
    try {
      const identities: Record<string, unknown>[] = [];
      for (let index = 0; index < 21; index += 1) {
        const attached = (await client.runtime.runPromise(
          client.attach({
            ...sessionInput,
            documentId: `whiteboard-route-capacity-document-${index}`,
            canvasIdentity: `whiteboard-route-capacity-canvas-${index}`,
          }),
        )) as Record<string, unknown>;
        identities.push(identityOf(attached));
      }
      for (const identity of identities.slice(0, 20)) {
        heldFibers.push(
          client.runtime.runFork(Stream.runDrain(client.subscribe({ ...identity, lastServerSequence: 0 }))),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      await expectRpcError(
        Stream.runDrain(client.subscribe({ ...identities[20], lastServerSequence: 0 })),
        client.runtime,
        { code: "STREAM_CAPACITY_EXCEEDED", retryable: true, retryAfterMs: 1_000 },
      );

      const requestAdmission = await Effect.runPromise(makeWsRequestAdmission);
      const requestGate = Deferred.makeUnsafe<void>();
      const gatedHandler = () => Deferred.await(requestGate);
      const admittedRequests = Array.from({ length: 12 }, () =>
        Effect.runPromise(requestAdmission.guard(1, "whiteboard.gated.standard", gatedHandler())),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      await expect(
        Effect.runPromise(requestAdmission.guard(1, "whiteboard.gated.standard", gatedHandler())),
      ).rejects.toMatchObject({
        code: "RPC_REQUEST_CAPACITY_EXCEEDED",
        retryable: true,
        retryAfterMs: 250,
      });
      await Effect.runPromise(Deferred.succeed(requestGate, undefined));
      await Promise.all(admittedRequests);
    } finally {
      await Promise.all(heldFibers.map((fiber) => client.runtime.runPromise(Fiber.interrupt(fiber))));
      await client.close();
      await harness.dispose();
    }
  });

  it("reports complete retry metadata for competing attach and terminal identity errors", async () => {
    const harness = await makeWsOrchestrationHarness();
    const client = await connectWhiteboardClient(harness.port);
    const secondClient = await connectWhiteboardClient(harness.port);
    try {
      const attached = (await client.runtime.runPromise(client.attach(sessionInput))) as Record<string, unknown>;
      const identity = identityOf(attached);
      await expectRpcError(secondClient.attach(sessionInput), secondClient.runtime, {
        code: WHITEBOARD_OPERATION_ERROR.sessionActive,
        retryable: true,
        retryAfterMs: 250,
      });
      const unknown = {
        ...identity,
        batchId: "route-metadata-batch",
        operationId: "route-metadata-operation",
        generation: 1,
        producerSequence: 1,
        serverSequence: 2,
        adapterCorrelationId: "route-metadata-correlation",
        applicationResult: "applied-semantic",
        resultingMutationRevision: 0,
        verifiedSemanticFingerprint: "route-metadata-fingerprint",
      };
      const errors = [
        [client.acknowledge(unknown), WHITEBOARD_OPERATION_ERROR.ackUnknown],
        [client.takeOver({ ...identity, batchId: unknown.batchId, operationId: unknown.operationId, expectedGeneration: 1, takeOverRequestId: "route-metadata-take-over" }), WHITEBOARD_OPERATION_ERROR.operationUnknown],
        [client.retry({ ...identity, batchId: unknown.batchId, failedOperationId: unknown.operationId, failedGeneration: 1, failedRetryAttempt: 0 }), WHITEBOARD_OPERATION_ERROR.operationUnknown],
      ] as const;
      for (const [effect, code] of errors) {
        const error = await expectRpcError(effect, client.runtime, { code, retryable: false });
        expect(error).not.toHaveProperty("retryAfterMs");
      }
      await client.runtime.runPromise(client.release(identity));
      const releasedError = await expectRpcError(
        Stream.runDrain(client.subscribe({ ...identity, lastServerSequence: 0 })),
        client.runtime,
        { code: WHITEBOARD_OPERATION_ERROR.sessionReleased, retryable: false },
      );
      expect(releasedError).not.toHaveProperty("retryAfterMs");
    } finally {
      await client.close();
      await secondClient.close();
      await harness.dispose();
    }
  });

  it("returns one negotiated authority for attach/events and rejects a forged valid identity", async () => {
    const harness = await makeWsOrchestrationHarness();
    const client = await connectWhiteboardClient(harness.port);
    const secondClient = await connectWhiteboardClient(harness.port);
    try {
      const attached = (await client.runtime.runPromise(client.attach(sessionInput))) as Record<string, unknown>;
      const identity = identityOf(attached);
      expect(client.serverInstanceId).toBe(attached.serverInstanceId);
      expect(secondClient.serverInstanceId).toBe(attached.serverInstanceId);
      const event = Array.from(
        await client.runtime.runPromise(
          Stream.runCollect(Stream.take(client.subscribe({ ...identity, lastServerSequence: 0 }), 1)),
        ),
      )[0] as Record<string, unknown>;
      expect(event.serverInstanceId).toBe(attached.serverInstanceId);
      const forgedError = await expectRpcError(
        client.acknowledge({
          ...identity,
          serverInstanceId: "forged-whiteboard-authority",
          batchId: "forged-batch",
          operationId: "forged-operation",
          generation: 1,
          producerSequence: 1,
          serverSequence: 1,
          adapterCorrelationId: "forged-correlation",
          applicationResult: "applied-semantic",
          resultingMutationRevision: 0,
          verifiedSemanticFingerprint: "forged-fingerprint",
        }),
        client.runtime,
        { code: WHITEBOARD_OPERATION_ERROR.authorityChanged, retryable: false },
      );
      expect(forgedError).not.toHaveProperty("retryAfterMs");
    } finally {
      await client.close();
      await secondClient.close();
      await harness.dispose();
    }
  });
});
