// FILE: wsTerminalProjectAdmission.integration.test.ts
// WP4 test-only continuation: proves the WS RPC admission guard
// (`requireActiveProjectForTerminal`) through the PRODUCTION
// `websocketRpcRouteLayer` mounted by the orchestration harness (real
// orchestration engine, real projection, real WS transport). A nonexistent
// Project is rejected PROJECT_NOT_FOUND and a deleted Project is rejected
// PROJECT_DELETED for `terminal.project.open` and for a representative
// guarded mutation (`terminal.project.write`); an existing live Project
// passes admission (control leg — the rejection is admission, not a broken
// route). `list` stays admission-free: the deletion flow itself lists.
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
  WS_METHODS,
} from "@synara/contracts";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { makeWsOrchestrationHarness } from "./WsOrchestrationHarness.integration.ts";

const HARNESS_CLIENT_BUILD = "synara-ws-terminal-admission-test/1";

const makeRpcClient = RpcClient.make(WsFeatureRpcGroup.merge(WsDeviceRpcGroup));

interface TerminalProjectRpcClient {
  readonly open: (input: unknown) => Promise<unknown>;
  readonly write: (input: unknown) => Promise<unknown>;
  readonly list: (input: unknown) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

async function connectTerminalProjectClient(
  port: number,
): Promise<TerminalProjectRpcClient> {
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
    open: (input) => call(WS_METHODS.terminalProjectOpen, input),
    write: (input) => call(WS_METHODS.terminalProjectWrite, input),
    list: (input) => call(WS_METHODS.terminalProjectList, input),
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

it("terminal.project admission rejects nonexistent and deleted Projects through the real WS RPC boundary", async () => {
  const harness = await makeWsOrchestrationHarness({ provider: "codex" });
  let terminalClient: TerminalProjectRpcClient | undefined;
  try {
    const createdAt = new Date().toISOString();
    const liveProjectId = ProjectId.makeUnsafe("ws-terminal-admission-live");
    const doomedProjectId = ProjectId.makeUnsafe("ws-terminal-admission-doomed");
    // Each Project needs a DISTINCT workspace root: the orchestration decider
    // enforces workspace-root-to-project ownership, so sharing one root would
    // retire the earlier shell (or reject the dispatch) instead of producing two
    // concurrently-live Projects. Distinct subdirectories under the harness root
    // keep both Projects live and independently deletable.
    const liveWorkspaceRoot = path.join(harness.rootDir, "admission-live-workspace");
    const doomedWorkspaceRoot = path.join(harness.rootDir, "admission-doomed-workspace");
    fs.mkdirSync(liveWorkspaceRoot, { recursive: true });
    fs.mkdirSync(doomedWorkspaceRoot, { recursive: true });

    await harness.client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-admission-live"),
      projectId: liveProjectId,
      title: "Live admission project",
      workspaceRoot: liveWorkspaceRoot,
      createdAt,
    });
    await harness.client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-admission-doomed"),
      projectId: doomedProjectId,
      title: "Doomed admission project",
      workspaceRoot: doomedWorkspaceRoot,
      createdAt,
    });
    // The delete dispatch has no Project terminals to settle (none were ever
    // opened), so it commits cleanly and the read model keeps the row with
    // deletedAt set — exactly the stale-client scenario the guard covers.
    await harness.client.dispatchCommand({
      type: "project.delete",
      commandId: CommandId.makeUnsafe("cmd-admission-doomed-delete"),
      projectId: doomedProjectId,
    });

    terminalClient = await connectTerminalProjectClient(harness.port);

    // Nonexistent Project: open and the representative guarded mutation
    // (write) are both rejected PROJECT_NOT_FOUND before any terminal
    // runtime touch.
    const nonexistentId = ProjectId.makeUnsafe("ws-terminal-admission-never-created");
    const openRejection = await terminalClient
      .open({
        projectId: nonexistentId,
        terminalId: "default",
        cwd: harness.workspaceDir,
        cols: 80,
        rows: 24,
      })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(rpcErrorCode(openRejection)).toBe("PROJECT_NOT_FOUND");
    await expect(
      terminalClient.write({ projectId: nonexistentId, terminalId: "default", data: "x" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    // Deleted Project: the read model retains the row with deletedAt set, so
    // both open and write are rejected PROJECT_DELETED (no reopen of a
    // workspace that no longer exists).
    await expect(
      terminalClient.open({
        projectId: doomedProjectId,
        terminalId: "default",
        cwd: doomedWorkspaceRoot,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toMatchObject({ code: "PROJECT_DELETED" });
    await expect(
      terminalClient.write({ projectId: doomedProjectId, terminalId: "default", data: "x" }),
    ).rejects.toMatchObject({ code: "PROJECT_DELETED" });

    // `list` stays admission-free: it is the truthful surface the deletion
    // warning itself uses, so it answers [] rather than rejecting.
    const listed = (await terminalClient.list({ projectId: doomedProjectId })) as unknown[];
    expect(listed).toEqual([]);

    // Control leg: a live Project passes admission. The real terminal runtime
    // then opens a real short-lived PTY session; close it right away so no
    // process outlives the harness.
    const opened = (await terminalClient.open({
      projectId: liveProjectId,
      terminalId: "default",
      cwd: liveWorkspaceRoot,
      cols: 80,
      rows: 24,
    })) as { readonly projectId: string; readonly terminalId: string };
    expect(opened.projectId).toBe(String(liveProjectId));
    // A live Project ALSO passes admission on the representative guarded
    // mutation: write is accepted (the rejection legs above prove the guard,
    // this proves the route is not simply rejecting everything). The contract
    // requires a non-empty payload (min length 1, max 65 536).
    await terminalClient.write({ projectId: liveProjectId, terminalId: "default", data: "\n" });
  } finally {
    await terminalClient?.close().catch(() => undefined);
    await harness.dispose();
  }
});
