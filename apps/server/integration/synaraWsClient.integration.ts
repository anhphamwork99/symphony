// FILE: synaraWsClient.integration.ts
// WP1 (impl-12 AC1 foundation): real WebSocket RPC client for the in-process
// orchestration harness. Mirrors the web app transport used by
// `apps/server/src/measurement/synaraClient.ts`: HTTP compatibility
// negotiation (`/ws/negotiate`), then the feature WebSocket (`/ws`) speaking
// the effect RPC protocol over JSON with the real `WsFeatureRpcGroup` client.
// Adds the `replayEvents` method needed by orchestration bootstrap journeys.
// No server internals are imported; everything goes through the public RPC
// boundary.
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import {
  ORCHESTRATION_WS_METHODS,
  WS_COMPATIBILITY_QUERY,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WS_NEGOTIATE_QUERY,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WS_SERVER_CAPABILITIES,
  WsBootstrapNegotiateResult,
  WsDeviceRpcGroup,
  WsFeatureRpcGroup,
  type ClientOrchestrationCommand,
  type DispatchResult,
  type OrchestrationReadModel,
  type OrchestrationReplayEventsInput,
  type OrchestrationReplayEventsResult,
  type OrchestrationThreadDetailSnapshot,
} from "@synara/contracts";
import { Schema } from "effect";

export interface SynaraWsClient {
  readonly dispatchCommand: (command: ClientOrchestrationCommand) => Promise<DispatchResult>;
  readonly getSnapshot: () => Promise<OrchestrationReadModel>;
  readonly getThreadDetailSnapshot: (
    threadId: string,
  ) => Promise<OrchestrationThreadDetailSnapshot | null>;
  readonly replayEvents: (
    input: OrchestrationReplayEventsInput,
  ) => Promise<OrchestrationReplayEventsResult>;
  readonly close: () => Promise<void>;
}

const HARNESS_CLIENT_BUILD = "synara-ws-orchestration-harness/1";

const makeRpcClient = RpcClient.make(WsFeatureRpcGroup.merge(WsDeviceRpcGroup));

function negotiateUrl(port: number): string {
  const url = new URL(`http://127.0.0.1:${port}${WS_NEGOTIATE_HTTP_PATH}`);
  url.searchParams.set(WS_NEGOTIATE_QUERY.clientBuild, HARNESS_CLIENT_BUILD);
  url.searchParams.set(WS_NEGOTIATE_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  url.searchParams.set(WS_NEGOTIATE_QUERY.minRevision, String(WS_PROTOCOL_MIN_REVISION));
  url.searchParams.set(WS_NEGOTIATE_QUERY.maxRevision, String(WS_PROTOCOL_MAX_REVISION));
  for (const capability of WS_SERVER_CAPABILITIES) {
    url.searchParams.append(WS_NEGOTIATE_QUERY.requiredCapability, capability);
  }
  return url.toString();
}

async function negotiate(port: number): Promise<WsBootstrapNegotiateResult> {
  const response = await fetch(negotiateUrl(port), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Synara WS negotiation failed with HTTP ${response.status}: ${await response
        .text()
        .catch(() => "")}`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(WsBootstrapNegotiateResult)(body);
  if (decoded._tag === "None") {
    throw new Error("Synara WS negotiation returned an unreadable result.");
  }
  return decoded.value;
}

function featureSocketUrl(port: number, compatibility: WsBootstrapNegotiateResult): string {
  const url = new URL(`ws://127.0.0.1:${port}${WS_FEATURE_PATH}`);
  url.searchParams.set(WS_COMPATIBILITY_QUERY.clientBuild, HARNESS_CLIENT_BUILD);
  url.searchParams.set(WS_COMPATIBILITY_QUERY.protocolEpoch, String(compatibility.protocolEpoch));
  url.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolRevision,
    String(compatibility.negotiatedRevision),
  );
  url.searchParams.set(WS_COMPATIBILITY_QUERY.serverInstanceId, compatibility.serverInstanceId);
  return url.toString();
}

export async function connectSynaraWsClient(port: number): Promise<SynaraWsClient> {
  const compatibility = await negotiate(port);
  const socketLayer = Socket.layerWebSocket(featureSocketUrl(port, compatibility)).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  const protocolLayer = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  );
  const runtime = ManagedRuntime.make(protocolLayer);
  const scope = runtime.runSync(Scope.make());
  const client = await runtime.runPromise(Scope.provide(scope)(makeRpcClient));

  const call = <A>(method: string, input: unknown): Promise<A> =>
    runtime.runPromise(
      (client as unknown as Record<string, (value: unknown) => Effect.Effect<A>>)[method]!(input),
    );

  return {
    dispatchCommand: (command) => call(ORCHESTRATION_WS_METHODS.dispatchCommand, command),
    getSnapshot: () => call(ORCHESTRATION_WS_METHODS.getSnapshot, {}),
    getThreadDetailSnapshot: (threadId) =>
      call(ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot, { threadId }),
    replayEvents: (input) => call(ORCHESTRATION_WS_METHODS.replayEvents, input),
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    },
  };
}
