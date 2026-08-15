// FILE: synaraClient.ts
// Purpose: WP4 — real WebSocket RPC client for the isolated Synara server.
// Mirrors the web app's transport: HTTP compatibility negotiation
// (`/ws/negotiate`), then the feature WebSocket (`/ws`) speaking the effect
// RPC protocol over JSON with the real `WsFeatureRpcGroup` client. All
// project/thread/session driving in the Synara modes goes through this
// client — no server internals are imported into the driver path.
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
  type OrchestrationThreadDetailSnapshot,
} from "@synara/contracts";
import { Schema } from "effect";

export interface SynaraClient {
  readonly dispatchCommand: (command: ClientOrchestrationCommand) => Promise<DispatchResult>;
  readonly getSnapshot: () => Promise<OrchestrationReadModel>;
  readonly getThreadDetailSnapshot: (
    threadId: string,
  ) => Promise<OrchestrationThreadDetailSnapshot | null>;
  readonly close: () => Promise<void>;
}

const HARNESS_CLIENT_BUILD = "synara-token-overhead-harness/1";

const makeRpcClient = RpcClient.make(WsFeatureRpcGroup.merge(WsDeviceRpcGroup));
type RpcClientEffect = typeof makeRpcClient;
type RpcClientInstance = RpcClientEffect extends Effect.Effect<infer Client, any, any>
  ? Client
  : never;

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

export async function connectSynaraClient(port: number): Promise<SynaraClient> {
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
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    },
  };
}

export type { RpcClientInstance };
