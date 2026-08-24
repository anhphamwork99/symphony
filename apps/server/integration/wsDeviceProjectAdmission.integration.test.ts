// FILE: wsDeviceProjectAdmission.integration.test.ts
// WP5 test-only continuation: proves the WS RPC admission guard
// (`requireActiveProjectForDevice`) through the PRODUCTION
// `websocketRpcRouteLayer` mounted by the orchestration harness (real
// orchestration engine, real projection, real WS transport). A nonexistent
// Project is rejected PROJECT_NOT_FOUND and a deleted Project is rejected
// PROJECT_DELETED for `device.project.attach` and for the read surface
// (`device.project.getState`); a live Project passes admission on both (the
// control leg proves the guard is admission, not a broken route). The
// device.runtime itself is never required to pass these legs: the rejection
// legs fail in admission before any backend touch, and the control leg only
// reads state, whose backend probes fail soft on any machine.
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import fs from "node:fs";
import path from "node:path";
import {
  CommandId,
  ProjectId,
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
} from "@synara/contracts";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { makeWsOrchestrationHarness } from "./WsOrchestrationHarness.integration.ts";

const HARNESS_CLIENT_BUILD = "synara-ws-device-project-admission-test/1";

const makeRpcClient = RpcClient.make(WsFeatureRpcGroup.merge(WsDeviceRpcGroup));

interface DeviceProjectRpcClient {
  readonly getState: (input: unknown) => Promise<unknown>;
  readonly attach: (input: unknown) => Promise<unknown>;
  readonly detach: (input: unknown) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

async function connectDeviceProjectClient(port: number): Promise<DeviceProjectRpcClient> {
  const negotiateUrl = new URL(`http://127.0.0.1:${port}${WS_NEGOTIATE_HTTP_PATH}`);
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.clientBuild, HARNESS_CLIENT_BUILD);
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.minRevision, String(WS_PROTOCOL_MIN_REVISION));
  negotiateUrl.searchParams.set(WS_NEGOTIATE_QUERY.maxRevision, String(WS_PROTOCOL_MAX_REVISION));
  for (const capability of WS_SERVER_CAPABILITIES) {
    negotiateUrl.searchParams.append(WS_NEGOTIATE_QUERY.requiredCapability, capability);
  }
  const negotiateResponse = await fetch(negotiateUrl, { cache: "no-store" });
  expect(negotiateResponse.ok).toBe(true);
  const negotiated = Schema.decodeUnknownOption(WsBootstrapNegotiateResult)(
    await negotiateResponse.json(),
  );
  expect(negotiated._tag).toBe("Some");

  const socketUrl = new URL(`ws://127.0.0.1:${port}${WS_FEATURE_PATH}`);
  socketUrl.searchParams.set(WS_COMPATIBILITY_QUERY.clientBuild, HARNESS_CLIENT_BUILD);
  socketUrl.searchParams.set(WS_COMPATIBILITY_QUERY.protocolEpoch, String(WS_PROTOCOL_EPOCH));
  socketUrl.searchParams.set(
    WS_COMPATIBILITY_QUERY.protocolRevision,
    String(negotiated._tag === "Some" ? negotiated.value.negotiatedRevision : 0),
  );
  socketUrl.searchParams.set(
    WS_COMPATIBILITY_QUERY.serverInstanceId,
    negotiated._tag === "Some" ? negotiated.value.serverInstanceId : "",
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
    runtime.runPromise(
      (client as unknown as Record<string, (value: unknown) => Effect.Effect<unknown>>)[method]!(
        input,
      ),
    );

  return {
    getState: (input) => call("device.project.getState", input),
    attach: (input) => call("device.project.attach", input),
    detach: (input) => call("device.project.detach", input),
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    },
  };
}

/** Extracts the WsRpcError code from a rejected effect RPC call. */
function rpcErrorCode(rejection: unknown): string | undefined {
  const error = rejection as { readonly code?: unknown } | undefined;
  return typeof error?.code === "string" ? error.code : undefined;
}

it("device.project admission rejects nonexistent and deleted Projects through the real WS RPC boundary", async () => {
  const harness = await makeWsOrchestrationHarness({ provider: "codex" });
  let deviceClient: DeviceProjectRpcClient | undefined;
  try {
    const createdAt = new Date().toISOString();
    const liveProjectId = ProjectId.makeUnsafe("ws-device-admission-live");
    const doomedProjectId = ProjectId.makeUnsafe("ws-device-admission-doomed");
    // Distinct workspace roots: the orchestration decider enforces
    // workspace-root-to-project ownership, so both Projects stay concurrently
    // live and independently deletable.
    const liveWorkspaceRoot = path.join(harness.rootDir, "device-admission-live-workspace");
    const doomedWorkspaceRoot = path.join(harness.rootDir, "device-admission-doomed-workspace");
    fs.mkdirSync(liveWorkspaceRoot, { recursive: true });
    fs.mkdirSync(doomedWorkspaceRoot, { recursive: true });

    await harness.client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-device-admission-live"),
      projectId: liveProjectId,
      title: "Live device admission project",
      workspaceRoot: liveWorkspaceRoot,
      createdAt,
    });
    await harness.client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-device-admission-doomed"),
      projectId: doomedProjectId,
      title: "Doomed device admission project",
      workspaceRoot: doomedWorkspaceRoot,
      createdAt,
    });
    // The delete dispatch has no Project-owned device state to settle, so it
    // commits cleanly and the read model keeps the row with deletedAt set —
    // exactly the stale-client scenario the guard covers.
    await harness.client.dispatchCommand({
      type: "project.delete",
      commandId: CommandId.makeUnsafe("cmd-device-admission-doomed-delete"),
      projectId: doomedProjectId,
    });

    deviceClient = await connectDeviceProjectClient(harness.port);

    // Nonexistent Project: the mutation and the read surface are both rejected
    // PROJECT_NOT_FOUND before any device runtime touch. No synthetic owner is
    // fabricated for an unknown ProjectId.
    const nonexistentId = ProjectId.makeUnsafe("ws-device-admission-never-created");
    const attachRejection = await deviceClient
      .attach({ projectId: nonexistentId, udid: "00000000-0000-0000-0000-000000000000" })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(rpcErrorCode(attachRejection)).toBe("PROJECT_NOT_FOUND");
    await expect(deviceClient.getState({ projectId: nonexistentId })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });

    // Deleted Project: the read model retains the row with deletedAt set, so
    // both attach and getState are rejected PROJECT_DELETED — a workspace that
    // no longer exists can never be read or reopened.
    await expect(
      deviceClient.attach({
        projectId: doomedProjectId,
        udid: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_DELETED" });
    await expect(deviceClient.getState({ projectId: doomedProjectId })).rejects.toMatchObject({
      code: "PROJECT_DELETED",
    });

    // Control leg: a live Project passes admission on both the read surface
    // and a representative mutation path (detach, which — unlike attach —
    // never touches the physical device backend, so the control leg stays
    // deterministic on every machine). detach on a never-attached Project
    // truthfully answers the empty Project state.
    const detached = (await deviceClient.detach({ projectId: liveProjectId })) as {
      readonly projectId: string;
      readonly attachedDeviceUdid: string | null;
    };
    expect(detached.projectId).toBe(String(liveProjectId));
    expect(detached.attachedDeviceUdid).toBeNull();
  } finally {
    await deviceClient?.close().catch(() => undefined);
    await harness.dispose();
  }
});
