import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";
import { describe, expect, it } from "vitest";

import {
  ProviderKind,
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

import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "./agentGateway/Services/McpSessionAuthority";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import {
  ServerConfig,
  deriveServerPaths,
  preparePrivateServerPaths,
  resolveCanonicalWorkspaceRoots,
  type ServerConfigShape,
} from "./config";
import { makeBoundedNodeHttpServer } from "./nodeHttpServer";
import { OpenLive } from "./open";
import { makeSqlitePersistenceLive } from "./persistence/Layers/Sqlite";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import { ProviderUnsupportedError } from "./provider/Errors";
import { ProviderDiscoveryServiceLive } from "./provider/Layers/ProviderDiscoveryService";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { ProviderAdapterRegistry } from "./provider/Services/ProviderAdapterRegistry";
import { ServerSettingsLive } from "./serverSettings";
import { makeServerRuntimeServicesLayer } from "./serverLayers";
import {
  makeRpcWebSocketHttpEffect,
  makeWebsocketNegotiationRouteLayer,
  makeWebsocketRpcRouteLayer,
} from "./wsRpc";
import { WsConnectionSessionsLive } from "./wsConnectionSessions";
import { makeWsOrchestrationHarness } from "../integration/WsOrchestrationHarness.integration";
import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "../integration/TestProviderAdapter.integration";
import {
  makeWhiteboardOperationSessionService,
  type WhiteboardOperationSessionService,
} from "./whiteboard/WhiteboardOperationSessionService";

const makeRpcClient = RpcClient.make(WsFeatureRpcGroup);

interface WhiteboardRouteGate {
  readonly started: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
}

interface WhiteboardRouteHarness {
  readonly port: number;
  readonly service: WhiteboardOperationSessionService;
  readonly close: () => Promise<void>;
}

function gatedWhiteboardService(
  service: WhiteboardOperationSessionService,
  gate: WhiteboardRouteGate,
): WhiteboardOperationSessionService {
  let started = 0;
  return {
    ...service,
    attachSession: (input) =>
      Effect.gen(function* () {
        started += 1;
        if (started === 12) yield* Deferred.succeed(gate.started, undefined);
        yield* Deferred.await(gate.release);
        return yield* service.attachSession(input);
      }),
  };
}

async function makeWhiteboardRouteHarness(
  options: { readonly gate?: WhiteboardRouteGate } = {},
): Promise<WhiteboardRouteHarness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-whiteboard-route-"));
  const homeDir = path.join(rootDir, "home");
  const workspaceDir = path.join(rootDir, "workspace");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  const configLayer = Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const paths = yield* deriveServerPaths(rootDir, undefined);
      yield* Effect.sync(() => preparePrivateServerPaths(paths));
      const { chatWorkspaceRoot, studioWorkspaceRoot } = yield* resolveCanonicalWorkspaceRoots({
        homeDir,
      });
      return {
        mode: "web",
        port: 0,
        host: "127.0.0.1",
        cwd: workspaceDir,
        homeDir,
        chatWorkspaceRoot,
        studioWorkspaceRoot,
        baseDir: rootDir,
        ...paths,
        staticDir: undefined,
        devUrl: undefined,
        publicUrl: undefined,
        allowInsecureRemote: false,
        noBrowser: true,
        authToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logProviderEvents: false,
        logWebSocketEvents: false,
      } satisfies ServerConfigShape;
    }),
  );

  let authority!: McpSessionAuthorityShape;
  const adapterHarness: TestProviderAdapterHarness = await Effect.runPromise(
    makeTestProviderAdapterHarness({
      provider: "codex" as ProviderKind,
      mcpSessionAuthority: () => authority,
    }),
  );
  const fakeRegistry = Layer.succeed(ProviderAdapterRegistry, {
    getByProvider: (provider) =>
      provider === adapterHarness.provider
        ? Effect.succeed(adapterHarness.adapter)
        : Effect.fail(new ProviderUnsupportedError({ provider })),
    listProviders: () => Effect.succeed([adapterHarness.provider]),
  } as typeof ProviderAdapterRegistry.Service);
  const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntimeRepositoryLive),
  );
  const providerLayer = Layer.mergeAll(
    makeProviderServiceLive().pipe(
      Layer.provide(providerSessionDirectoryLayer),
      Layer.provide(fakeRegistry),
    ),
    ProviderDiscoveryServiceLive.pipe(
      Layer.provide(fakeRegistry),
      Layer.provideMerge(ServerSettingsLive),
      Layer.provideMerge(ServerSecretStoreLive),
    ),
    fakeRegistry,
    providerSessionDirectoryLayer,
  );
  const runtimeLayer = Layer.mergeAll(
    makeServerRuntimeServicesLayer().pipe(Layer.provideMerge(providerLayer)),
    OpenLive,
  ).pipe(
    Layer.provideMerge(configLayer),
    Layer.provideMerge(makeSqlitePersistenceLive(path.join(rootDir, "userdata", "state.sqlite"))),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(runtimeLayer);
  const serviceScope = await runtime.runPromise(Scope.make("sequential"));
  const service = await runtime.runPromise(
    Scope.provide(
      makeWhiteboardOperationSessionService({
        serverInstanceId: "whiteboard-route-injected-server",
      }).pipe(
        Effect.map((created) =>
          options.gate === undefined ? created : gatedWhiteboardService(created, options.gate),
        ),
      ),
      serviceScope,
    ),
  );
  authority = await runtime.runPromise(Effect.service(McpSessionAuthority));

  const routeLayer = Layer.merge(
    makeWebsocketNegotiationRouteLayer(),
    makeWebsocketRpcRouteLayer(
      makeRpcWebSocketHttpEffect({ whiteboardOperationSessionService: service }),
    ),
  ).pipe(Layer.provide(WsConnectionSessionsLive));
  const serverScope = await runtime.runPromise(Scope.make("sequential"));
  const boundAddress: { current: HttpServer.Address | null } = { current: null };
  await runtime.runPromise(
    Scope.provide(
      Effect.gen(function* () {
        const httpServer = yield* makeBoundedNodeHttpServer(() => http.createServer(), {
          port: 0,
          host: "127.0.0.1",
        });
        boundAddress.current = httpServer.address;
        const httpApp = yield* HttpRouter.toHttpEffect(routeLayer);
        yield* httpServer.serve(httpApp);
      }),
      serverScope,
    ),
  );
  const address = boundAddress.current;
  if (address === null || address._tag !== "TcpAddress") {
    await runtime.runPromise(Scope.close(serverScope, Exit.void)).catch(() => undefined);
    await runtime.runPromise(Scope.close(serviceScope, Exit.void)).catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
    fs.rmSync(rootDir, { recursive: true, force: true });
    throw new Error("Whiteboard route test server did not bind a TCP port");
  }

  let closed = false;
  return {
    port: address.port,
    service,
    close: async () => {
      if (closed) return;
      closed = true;
      await runtime.runPromise(Scope.close(serverScope, Exit.void)).catch(() => undefined);
      await runtime.runPromise(Scope.close(serviceScope, Exit.void)).catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

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

  it("proves snapshot fencing, retained replay, and live producer delivery at the wire boundary", async () => {
    const harness = await makeWhiteboardRouteHarness();
    const client = await connectWhiteboardClient(harness.port);
    try {
      const attached = (await client.runtime.runPromise(client.attach(sessionInput))) as Record<
        string,
        unknown
      >;
      const identity = identityOf(attached);
      const admitted = await Effect.runPromise(
        harness.service.admitOperation({ ...identity, batchId: "route-wire-batch" }),
      );
      const firstProgress = await Effect.runPromise(
        harness.service.publishProgress({
          ...identity,
          batchId: admitted.batchId,
          operationId: admitted.operationId,
          generation: admitted.generation,
          producerSequence: 1,
          dependsOnProducerSequences: [],
          expectedBeforeRevision: 0,
          expectedAfterRevision: 1,
          expectedSemanticFingerprint: "route-wire-fingerprint-1",
          mutation: {
            format: "synara.whiteboard.progress/v1",
            elements: [{ id: "route-wire-element-1", type: "rectangle", x: 1, y: 2 }],
          },
        }),
      );
      const firstWireEvent = Deferred.makeUnsafe<void>();
      const eventsPromise = client.runtime.runPromise(
        Stream.runCollect(
          Stream.take(
            Stream.tap(client.subscribe({ ...identity, lastServerSequence: 0 }), (event) =>
              event.kind === "session-snapshot"
                ? Deferred.succeed(firstWireEvent, undefined)
                : Effect.void,
            ),
            5,
          ),
        ),
      );
      // The first snapshot has crossed the route, so the following producer
      // transition must be delivered through the live queue rather than folded
      // into the retained prefix.
      await client.runtime.runPromise(Deferred.await(firstWireEvent));
      const liveProgress = await Effect.runPromise(
        harness.service.publishProgress({
          ...identity,
          batchId: admitted.batchId,
          operationId: admitted.operationId,
          generation: admitted.generation,
          producerSequence: 2,
          dependsOnProducerSequences: [1],
          expectedBeforeRevision: 1,
          expectedAfterRevision: 2,
          expectedSemanticFingerprint: "route-wire-fingerprint-2",
          mutation: {
            format: "synara.whiteboard.progress/v1",
            elements: [{ id: "route-wire-element-2", type: "ellipse", x: 3, y: 4 }],
          },
        }),
      );
      const events = Array.from(await eventsPromise) as Array<Record<string, unknown>>;
      expect(events.map((event) => event.kind)).toEqual([
        "session-snapshot",
        "session-snapshot",
        "operation-admitted",
        "operation-progress",
        "operation-progress",
      ]);
      expect(events[0]).toMatchObject({ ...identity, kind: "session-snapshot", serverSequence: 3 });
      expect(events.slice(1).map((event) => event.serverSequence)).toEqual([1, 2, 3, 4]);
      expect(new Set(events.slice(1).map((event) => event.serverSequence)).size).toBe(4);
      expect(events.every((event) => Object.entries(identity).every(([key, value]) => event[key] === value))).toBe(
        true,
      );
      expect(events[1]).toMatchObject({
        ...identity,
        kind: "session-snapshot",
        serverSequence: 1,
      });
      expect(events[2]).toMatchObject({
        kind: "operation-admitted",
        batchId: admitted.batchId,
        operationId: admitted.operationId,
        generation: admitted.generation,
        retryAttempt: 0,
      });
      expect(events[3]).toMatchObject({
        kind: "operation-progress",
        batchId: firstProgress.batchId,
        operationId: firstProgress.operationId,
        producerSequence: 1,
        expectedBeforeRevision: 0,
        expectedAfterRevision: 1,
      });
      expect(events[4]).toMatchObject({
        kind: "operation-progress",
        batchId: liveProgress.batchId,
        operationId: liveProgress.operationId,
        producerSequence: 2,
        dependsOnProducerSequences: [1],
        expectedBeforeRevision: 1,
        expectedAfterRevision: 2,
      });
    } finally {
      await client.close();
      await harness.close();
    }
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

      const requestGate: WhiteboardRouteGate = {
        started: Deferred.makeUnsafe<void>(),
        release: Deferred.makeUnsafe<void>(),
      };
      const unaryHarness = await makeWhiteboardRouteHarness({ gate: requestGate });
      const unaryClient = await connectWhiteboardClient(unaryHarness.port);
      try {
        const admittedRequests = Array.from({ length: 12 }, (_, index) =>
          unaryClient.runtime.runPromise(
            unaryClient.attach({
              ...sessionInput,
              documentId: `whiteboard-route-unary-document-${index}`,
              canvasIdentity: `whiteboard-route-unary-canvas-${index}`,
            }),
          ),
        );
        await unaryClient.runtime.runPromise(Deferred.await(requestGate.started));
        await expect(
          unaryClient.runtime.runPromise(
            unaryClient.attach({
              ...sessionInput,
              documentId: "whiteboard-route-unary-document-over-capacity",
              canvasIdentity: "whiteboard-route-unary-canvas-over-capacity",
            }),
          ),
        ).rejects.toMatchObject({
          code: "RPC_REQUEST_CAPACITY_EXCEEDED",
          retryable: true,
          retryAfterMs: 250,
        });
        await unaryClient.runtime.runPromise(Deferred.succeed(requestGate.release, undefined));
        await expect(Promise.all(admittedRequests)).resolves.toHaveLength(12);
      } finally {
        await unaryClient.close();
        await unaryHarness.close();
      }
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
