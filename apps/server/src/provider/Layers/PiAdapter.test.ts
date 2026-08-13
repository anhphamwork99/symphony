// FILE: PiAdapter.test.ts
// Purpose: Verifies Pi adapter model discovery respects auth and SDK-supported thinking levels.
// Layer: Provider adapter tests
// Depends on: PiAdapter discovery helpers and Pi model metadata shapes.

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { McpAuthorityBinding, ProviderKind, ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createPiModelRuntime,
  ensurePiAnthropicCatalogModels,
  getPiDiscoverableModels,
  getPiSupportedThinkingOptions,
  buildPiAgentGatewayCustomTools,
  makePiBashProcessSupervisor,
  makePiRuntimeEventBase,
  makePiSessionSynaraMcpCoordinator,
  makePiUserInputOptions,
  PLAIN_PI_EXTENSION_THEME,
  toPiProviderModelDescriptor,
} from "./PiAdapter";
import {
  makePiSynaraMcpDormantExtension,
  PI_SYNARA_MCP_DISABLED_REFUSAL,
  type PiSynaraMcpDormantAdapter,
} from "../piSynaraMcpExtension";
import {
  PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
  type PiSynaraMcpLifecycleCoordinator,
} from "../piSynaraMcpLifecycle";
import { disablePiSynaraMcpSession, PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL } from "../piSynaraMcpDisable";
import {
  makePiSynaraMcpToolExecutionRegistry,
  SYNARA_MCP_DISABLED_ERROR_CODE,
} from "../piSynaraMcpToolExecution";

describe("Pi native Synara gateway tools", () => {  it("uses canonical MCP schemas and keeps same-cwd thread tokens distinct", async () => {
    const requests: Array<{ readonly token: string | null; readonly body: any }> = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push({
        token: new Headers(init?.headers).get("Authorization"),
        body,
      });
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "synara_list_threads",
                    description: "List Synara threads.",
                    inputSchema: {
                      type: "object",
                      properties: { limit: { type: "number" } },
                    },
                  },
                ],
              }
            : {
                content: [{ type: "text", text: body.params.arguments.owner }],
              },
      });
    };
    const defineTool = (tool: any) => tool;
    const firstConnection = {
      url: "http://127.0.0.1:3773/mcp",
      bearerToken: "token-a",
    };
    const first = await buildPiAgentGatewayCustomTools({
      connection: firstConnection,
      defineTool,
      fetch,
    });
    const second = await buildPiAgentGatewayCustomTools({
      connection: { url: "http://127.0.0.1:3773/mcp", bearerToken: "token-b" },
      defineTool,
      fetch,
    });

    expect(first[0]?.parameters).toEqual({
      type: "object",
      properties: { limit: { type: "number" } },
    });
    await expect(
      first[0]?.execute("call-a", { owner: "thread-a" }, undefined, undefined, {} as never),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "thread-a" }] });
    await expect(
      second[0]?.execute("call-b", { owner: "thread-b" }, undefined, undefined, {} as never),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "thread-b" }] });
    expect(requests.map((request) => request.token)).toEqual([
      "Bearer token-a",
      "Bearer token-b",
      "Bearer token-a",
      "Bearer token-b",
    ]);
    expect(requests[2]?.body.params.arguments).toEqual({ owner: "thread-a" });
    expect(requests[3]?.body.params.arguments).toEqual({ owner: "thread-b" });
    Object.assign(firstConnection, { bearerToken: "token-c" });
    await first[0]?.execute("call-c", {}, undefined, undefined, {} as never);
    expect(requests[4]?.token).toBe("Bearer token-c");
  });

  it("forwards Pi tool cancellation to the in-flight MCP request", async () => {
    let callSignal: AbortSignal | null = null;
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "synara_create_threads",
                description: "Create Synara threads.",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          },
        });
      }

      callSignal = init?.signal ?? null;
      return await new Promise<Response>((_resolve, reject) => {
        const rejectAborted = () =>
          reject(
            callSignal?.reason ?? new DOMException("The operation was aborted.", "AbortError"),
          );
        if (callSignal?.aborted) {
          rejectAborted();
          return;
        }
        callSignal?.addEventListener("abort", rejectAborted, { once: true });
      });
    };
    const tools = await buildPiAgentGatewayCustomTools({
      connection: { url: "http://127.0.0.1:3773/mcp", bearerToken: "token-a" },
      defineTool: (tool) => tool,
      fetch,
    });
    const controller = new AbortController();
    const execution = tools[0]?.execute("call-a", {}, controller.signal, undefined, {} as never);

    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect(callSignal).toBe(controller.signal);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("makePiSessionSynaraMcpCoordinator", () => {
  const AUTHORITY_BINDING: McpAuthorityBinding = {
    authorityId: "mcp-authority-test-1",
    subject: "subject-1",
    kind: "authenticated",
    authSessionId: "auth-session-1",
    authExpiresAt: Date.now() + 60_000,
    issuedAt: Date.now(),
    credentialExpiresAt: Date.now() + 60_000,
    sessionGeneration: "gen-1",
    lifecycleGeneration: null,
    projectId: null,
  };
  const CATALOG_TOOLS = [
    {
      name: "synara_list_threads",
      description: "List Synara threads.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "synara_invoke",
      description: "Invoke a Synara operation.",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  interface CoordinatorHarness {
    readonly adapter: PiSynaraMcpDormantAdapter;
    readonly coordinator: PiSynaraMcpLifecycleCoordinator;
    readonly stagedTools: any[];
    readonly executions: ReturnType<typeof makePiSynaraMcpToolExecutionRegistry>;
    readonly minted: Array<{ readonly url: string; readonly bearerToken: string }>;
    readonly mintedAuthorities: McpAuthorityBinding[];
    readonly revoked: string[];
    readonly requests: Array<{ readonly token: string | null; readonly method: string }>;
    readonly reload: ReturnType<typeof vi.fn>;
    readonly abort: ReturnType<typeof vi.fn>;
  }

  function makeCoordinatorHarness(options: {
    readonly mcpAuthority?: McpAuthorityBinding | null;
    readonly withCredentials?: boolean;
    readonly catalogTools?: unknown[];
    readonly failDiscovery?: Error;
    readonly failReload?: Error;
    readonly failRevoke?: Error;
    readonly discoveryGate?: Promise<void>;
    readonly gatewayCancel?: {
      readonly verifySession?: (token: string) => { readonly sessionKey: string } | null;
      readonly cancelInFlightRequests?: (selector: {
        readonly sessionKey: string;
      }) => { readonly count: number; readonly settled: Promise<void> };
    };
    readonly drainTimeoutMs?: number;
  } = {}): CoordinatorHarness {
    const { adapter } = makePiSynaraMcpDormantExtension();
    const stagedTools: any[] = [];
    const executions = makePiSynaraMcpToolExecutionRegistry();
      const minted: Array<{ url: string; bearerToken: string }> = [];
      const mintedAuthorities: McpAuthorityBinding[] = [];
    const revoked: string[] = [];
    const requests: Array<{ token: string | null; method: string }> = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      if (options.discoveryGate !== undefined) {
        await options.discoveryGate;
      }
      const body = JSON.parse(String(init?.body));
      requests.push({
        token: new Headers(init?.headers).get("Authorization"),
        method: body.method,
      });
      if (options.failDiscovery !== undefined) {
        throw options.failDiscovery;
      }
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.method === "initialize"
              ? {
                  protocolVersion: "2025-06-18",
                  capabilities: {},
                  serverInfo: { name: "synara", version: "1.0.0" },
                }
              : { tools: options.catalogTools ?? CATALOG_TOOLS },
        });
    };
    const credentials = {
        connectionForThread: (
          _threadId: ThreadId,
          _provider: ProviderKind,
          authority?: McpAuthorityBinding | null,
        ) => {
          if (authority !== undefined && authority !== null) {
            mintedAuthorities.push(authority);
          }
        const connection = {
          url: "http://127.0.0.1:3773/mcp",
          bearerToken: `token-${minted.length + 1}`,
        };
        minted.push(connection);
        return connection;
      },
      revokeSessionToken: (token: string) => {
        if (options.failRevoke !== undefined) {
          throw options.failRevoke;
        }
        revoked.push(token);
      },
      ...(options.gatewayCancel === undefined
        ? {}
        : {
            verifySession: options.gatewayCancel.verifySession,
            cancelInFlightRequests: options.gatewayCancel.cancelInFlightRequests,
          }),
    };
    const reload = vi.fn(async () => {
      if (options.failReload !== undefined) {
        throw options.failReload;
      }
    });
    const abort = vi.fn(async () => undefined);
    const coordinator = makePiSessionSynaraMcpCoordinator({
      threadId: "thread-pi-1" as ThreadId,
      adapter,
      stagedTools,
      executions,
      runtime: { session: { reload, abort } },
      mcpAuthority: options.mcpAuthority,
      ...(options.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: options.drainTimeoutMs }),
      ...(options.withCredentials === false ? {} : { credentials }),
      fetch,
    });
      return {
        adapter,
        coordinator,
        stagedTools,
        executions,
        minted,
        mintedAuthorities,
        revoked,
        requests,
        reload,
        abort,
      };
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  async function activateAndCommit(harness: CoordinatorHarness): Promise<void> {
    const activation = harness.coordinator.activate({});
    await flush();
    await harness.adapter.notifySafeBoundary();
    const result = await activation;
    expect(result).toMatchObject({ ok: true, state: "active" });
  }

  it("creates one dormant coordinator with zero MCP activity and no staged tools", async () => {
    const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });

    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.adapter.state).toBe("dormant");
    expect(harness.stagedTools).toEqual([]);
    expect(harness.minted).toEqual([]);
    expect(harness.requests).toEqual([]);
    await expect(harness.adapter.invoke({ method: "tools/list" })).rejects.toThrow(
      PI_SYNARA_MCP_DISABLED_REFUSAL,
    );
  });

  it("stages identity, credentials, connection, and discovery before applying the complete catalog at the safe boundary", async () => {
    const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });

    const activation = harness.coordinator.activate({});
    await flush();

      // Staging: one fresh credential, one initialize handshake, then discovery.
      expect(harness.minted).toHaveLength(1);
      expect(harness.mintedAuthorities[0]?.lifecycleGeneration).toMatch(/^[0-9a-f-]{36}$/);
      expect(harness.mintedAuthorities[0]?.lifecycleGeneration).not.toBe(
        AUTHORITY_BINDING.lifecycleGeneration,
      );
      expect(harness.requests.map((request) => request.method)).toEqual([
        "initialize",
        "tools/list",
      ]);
    expect(harness.requests[0]?.token).toBe("Bearer token-1");
    // Nothing is exposed before the safe boundary.
    expect(harness.stagedTools).toEqual([]);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.coordinator.state).toBe("activating");

    await harness.adapter.notifySafeBoundary();
    const result = await activation;

    expect(result).toMatchObject({ ok: true, state: "active", alreadyActive: false });
    expect(harness.coordinator.state).toBe("active");
    expect(harness.stagedTools.map((tool) => tool.name)).toEqual([
      "synara_list_threads",
      "synara_invoke",
    ]);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it("fails closed at the authority stage when no server-minted binding exists", async () => {
      const harness = makeCoordinatorHarness();

    const result = await harness.coordinator.activate({});

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "authority" });
    expect(harness.minted).toEqual([]);
    expect(harness.requests).toEqual([]);
    expect(harness.stagedTools).toEqual([]);
    expect(harness.coordinator.state).toBe("dormant");
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "activation.failed"),
    ).toBe(true);
  });

  it("fails closed at the credential stage when the gateway layer is absent", async () => {
    const harness = makeCoordinatorHarness({
      mcpAuthority: AUTHORITY_BINDING,
      withCredentials: false,
    });

    const result = await harness.coordinator.activate({});

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "credential" });
    expect(harness.requests).toEqual([]);
    expect(harness.stagedTools).toEqual([]);
    expect(harness.coordinator.state).toBe("dormant");
  });

    it("rolls back initialize failure to dormant without partial tools and revokes the candidate credential", async () => {
    const harness = makeCoordinatorHarness({
      mcpAuthority: AUTHORITY_BINDING,
      failDiscovery: new Error("gateway unavailable"),
    });

    const result = await harness.coordinator.activate({});

      expect(result).toMatchObject({ ok: false, state: "dormant", stage: "connection" });
    expect(harness.stagedTools).toEqual([]);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.revoked).toEqual(["token-1"]);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("rejects an empty catalog without exposure", async () => {
    const harness = makeCoordinatorHarness({
      mcpAuthority: AUTHORITY_BINDING,
      catalogTools: [],
    });

    const result = await harness.coordinator.activate({});

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "catalog" });
    expect(harness.stagedTools).toEqual([]);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.revoked).toEqual(["token-1"]);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("rolls back apply failure without partial tools and revokes the candidate credential", async () => {
    const harness = makeCoordinatorHarness({
      mcpAuthority: AUTHORITY_BINDING,
      failReload: new Error("reload failed"),
    });

    const activation = harness.coordinator.activate({});
    await flush();
    await harness.adapter.notifySafeBoundary();
    const result = await activation;

      expect(result).toMatchObject({ ok: false, state: "unavailable", stage: "apply" });
    // The staged registry is cleared by rollback cleanup, so no later load
    // can expose a partial catalog.
    expect(harness.stagedTools).toEqual([]);
      expect(harness.revoked).toEqual(["token-1"]);
      expect(harness.coordinator.state).toBe("unavailable");
      expect(harness.reload).toHaveBeenCalledTimes(2);
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "activation.failed"),
    ).toBe(true);
  });

  it("leaves the session unavailable with diagnostics when cleanup cannot be proven", async () => {
    const harness = makeCoordinatorHarness({
      mcpAuthority: AUTHORITY_BINDING,
      failDiscovery: new Error("gateway unavailable"),
      failRevoke: new Error("cannot prove cleanup"),
    });

    const result = await harness.coordinator.activate({});

      expect(result).toMatchObject({ ok: false, state: "unavailable", stage: "connection" });
    expect(harness.coordinator.state).toBe("unavailable");
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "cleanup.uncertain"),
    ).toBe(true);
  });

  it("dispose deactivates an active session, revokes the credential, and clears the registry", async () => {
    const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
    await activateAndCommit(harness);

    await harness.coordinator.dispose();

      expect(harness.coordinator.state).toBe("dormant");
      expect(harness.revoked).toEqual(["token-1"]);
      expect(harness.stagedTools).toEqual([]);
      // Dispose tears the runtime down immediately: the apply reload ran once
      // and teardown performs no redundant reload (impl-07 boundary reload is
      // reserved for the disable path).
      expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it("supersedes an in-flight activation on dispose so stale completion exposes nothing", async () => {
    let releaseDiscovery!: () => void;
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const harness = makeCoordinatorHarness({
      mcpAuthority: AUTHORITY_BINDING,
      discoveryGate,
    });

    const activation = harness.coordinator.activate({});
    await flush();
    // Staging reached the gated discovery: one credential was minted and the
    // discovery request is still in flight.
    expect(harness.minted).toHaveLength(1);

    const disposePromise = harness.coordinator.dispose();
    releaseDiscovery();
    const result = await activation;

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "superseded" });
    await disposePromise;
      expect(harness.requests.map((request) => request.method)).toEqual(["initialize"]);
    expect(harness.stagedTools).toEqual([]);
    expect(harness.revoked).toEqual(["token-1"]);
    expect(harness.reload).not.toHaveBeenCalled();

    // A boundary firing after dispose exposes nothing.
    await harness.adapter.notifySafeBoundary();
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.stagedTools).toEqual([]);
  });

  it("refuses an activation queued behind dispose without exposure", async () => {
    const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
    await activateAndCommit(harness);

    const queued = harness.coordinator.activate({});
    const disposePromise = harness.coordinator.dispose();

    await expect(queued).rejects.toThrow(PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL);
    await disposePromise;
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.stagedTools).toEqual([]);
    expect(harness.revoked).toEqual(["token-1"]);
  });

  describe("disablePiSynaraMcpSession at the Pi provider/session boundary (impl-07 AC1)", () => {
    const deferred = <T = void>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };

    it("fences new calls synchronously and settles in-flight executions with the structured disabled error", async () => {
      const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
      await activateAndCommit(harness);
      const gate = deferred<unknown>();
      const inFlight = harness.executions.execute({ call: async () => gate.promise });
      expect(harness.executions.inFlightCount()).toBe(1);

      const disable = disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });
      // The fence is installed synchronously by the disable call itself.
      expect(harness.executions.isFenced()).toBe(true);
      const racingCall = harness.executions.execute({ call: async () => "late" });
      await expect(racingCall).rejects.toMatchObject({
        code: SYNARA_MCP_DISABLED_ERROR_CODE,
        message: PI_SYNARA_MCP_DISABLED_REFUSAL,
      });

      await expect(disable).resolves.toEqual({ state: "dormant" });
      await expect(inFlight).rejects.toMatchObject({
        code: SYNARA_MCP_DISABLED_ERROR_CODE,
        message: PI_SYNARA_MCP_DISABLED_REFUSAL,
      });
      expect(harness.executions.inFlightCount()).toBe(0);
      expect(harness.executions.disabledSettledCount()).toBe(1);
      expect(harness.revoked).toEqual(["token-1"]);
      expect(harness.reload).toHaveBeenCalledTimes(2);
      expect(harness.coordinator.state).toBe("dormant");
    });

    it("cancels and drains gateway requests before revoking the credential", async () => {
      const drainGate = deferred();
      const cancelled: Array<{ readonly sessionKey: string }> = [];
      const harness = makeCoordinatorHarness({
        mcpAuthority: AUTHORITY_BINDING,
        gatewayCancel: {
          verifySession: (token) =>
            token === "token-1" ? { sessionKey: "session-key-1" } : null,
          cancelInFlightRequests: (selector) => {
            cancelled.push(selector);
            return { count: 1, settled: drainGate.promise };
          },
        },
      });
      await activateAndCommit(harness);

      const disable = disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The gateway drain barrier is still pending: revocation must wait.
      expect(cancelled).toEqual([{ sessionKey: "session-key-1" }]);
      expect(harness.revoked).toEqual([]);

      drainGate.resolve();
      await expect(disable).resolves.toEqual({ state: "dormant" });
      expect(harness.revoked).toEqual(["token-1"]);
      expect(harness.coordinator.state).toBe("dormant");
    });

    it("reloads the runtime only at the safe boundary when a turn is active", async () => {
      const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
      await activateAndCommit(harness);

      const disable = disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.reload).toHaveBeenCalledTimes(1);
      expect(harness.coordinator.state).toBe("deactivating");

      await harness.adapter.notifySafeBoundary();
      await expect(disable).resolves.toEqual({ state: "dormant" });
      expect(harness.reload).toHaveBeenCalledTimes(2);
      expect(harness.coordinator.state).toBe("dormant");
    });

    it("suppresses late callbacks so they cannot mutate state or emit duplicate results", async () => {
      const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
      await activateAndCommit(harness);
      const gate = deferred<unknown>();
      const inFlight = harness.executions.execute({ call: async () => gate.promise });

      await disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });
      await expect(inFlight).rejects.toMatchObject({
        code: SYNARA_MCP_DISABLED_ERROR_CODE,
      });

      // The abandoned gateway call resolves late: the Pi-facing execution is
      // already settled once, the registry entry is gone, and no duplicate
      // result or state mutation can occur.
      gate.resolve({ content: [{ type: "text", text: "late" }] });
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.executions.inFlightCount()).toBe(0);
      expect(harness.executions.disabledSettledCount()).toBe(1);
      await expect(inFlight).rejects.toMatchObject({
        code: SYNARA_MCP_DISABLED_ERROR_CODE,
      });
    });

    it("is idempotent for duplicate disables", async () => {
      const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
      await activateAndCommit(harness);

      const first = await disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });
      const duplicate = await disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });

      expect(first).toEqual({ state: "dormant" });
      expect(duplicate).toEqual({ state: "dormant", alreadyDisabled: true });
      expect(harness.revoked).toEqual(["token-1"]);
      expect(harness.reload).toHaveBeenCalledTimes(2);
      expect(harness.coordinator.state).toBe("dormant");
    });

    it("leaves the session unavailable on a drain timeout while still revoking best-effort", async () => {
      const harness = makeCoordinatorHarness({
        mcpAuthority: AUTHORITY_BINDING,
        drainTimeoutMs: 25,
        gatewayCancel: {
          verifySession: () => ({ sessionKey: "session-key-1" }),
          cancelInFlightRequests: () => ({
            count: 1,
            settled: new Promise<void>(() => undefined),
          }),
        },
      });
      await activateAndCommit(harness);

      const outcome = await disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });

      expect(outcome).toEqual({
        state: "unavailable",
        detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
      });
      expect(harness.coordinator.state).toBe("unavailable");
      // Authority is still revoked and the project stays disabled.
      expect(harness.revoked).toEqual(["token-1"]);
      expect(
        harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "disable.drain.timeout"),
      ).toBe(true);
    });

    it("leaves the session unavailable when cleanup cannot be proven", async () => {
      const harness = makeCoordinatorHarness({
        mcpAuthority: AUTHORITY_BINDING,
        failRevoke: new Error("cannot prove cleanup"),
      });
      await activateAndCommit(harness);

      const outcome = await disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });

      expect(outcome).toEqual({
        state: "unavailable",
        detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
      });
      expect(harness.coordinator.state).toBe("unavailable");
      expect(
        harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "cleanup.uncertain"),
      ).toBe(true);
    });

    it("never aborts the Pi session and leaves non-MCP work usable (AC2 turn continuity)", async () => {
      const harness = makeCoordinatorHarness({ mcpAuthority: AUTHORITY_BINDING });
      await activateAndCommit(harness);

      await disablePiSynaraMcpSession({
        coordinator: harness.coordinator,
        executions: harness.executions,
        awaitSafeBoundary: false,
      });

      // The disable path never touches session.abort: the Pi turn continues
      // with coding-agent tools after the structured disabled result.
      expect(harness.abort).not.toHaveBeenCalled();
      // Non-MCP work is unaffected: a plain coding-agent tool call still runs.
      await expect(Promise.resolve("coding-agent-tool-ok")).resolves.toBe("coding-agent-tool-ok");
      // A later Synara admission is fenced and rejected before its handler runs.
      const call = vi.fn(async () => "gateway");
      await expect(harness.executions.execute({ call })).rejects.toMatchObject({
        code: SYNARA_MCP_DISABLED_ERROR_CODE,
      });
      expect(call).not.toHaveBeenCalled();
    });
  });
});

describe("Pi Bash process supervision", () => {
  it("keeps an aborted command pending until process-tree exit is proven", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 64_201,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
    let proveExit!: () => void;
    const exitProof = new Promise<void>((resolve) => {
      proveExit = resolve;
    });
    let observeTeardown!: () => void;
    const teardownStarted = new Promise<void>((resolve) => {
      observeTeardown = resolve;
    });
    const supervisor = makePiBashProcessSupervisor({
      getShellConfig: () => ({ shell: "/bin/sh", args: ["-c"] }),
      spawnProcess: () => child,
      teardownProcessTree: async (input) => {
        observeTeardown();
        await exitProof;
        (child as ChildProcess & { exitCode: number | null }).exitCode = 0;
        child.emit("exit", 0, null);
        await input.rootExited;
        return { escalated: false, signalErrors: [] };
      },
    });
    const abortController = new AbortController();
    const command = supervisor.operations.exec("sleep 10", "/tmp", {
      signal: abortController.signal,
      onData: () => undefined,
    });
    let settled = false;
    void command.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    abortController.abort();
    await teardownStarted;
    await Promise.resolve();
    expect(settled).toBe(false);

    proveExit();
    await expect(command).rejects.toThrow("aborted");
    expect(settled).toBe(true);
  });
});

function makePiModel(input: {
  reasoning: boolean;
  thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
}): Pick<Model<Api>, "reasoning" | "thinkingLevelMap"> {
  return {
    reasoning: input.reasoning,
    ...(input.thinkingLevelMap !== undefined ? { thinkingLevelMap: input.thinkingLevelMap } : {}),
  };
}

describe("getPiDiscoverableModels", () => {
  it("normalizes the malformed Pi extension model metadata before returning it through RPC", () => {
    const descriptor = toPiProviderModelDescriptor(
      {
        provider: "openrouter",
        id: "google/gemma-4-26b-a4b-it",
        name: "Google: Gemma 4 26B A4B ",
        reasoning: false,
      } as Model<Api>,
      () => " OpenRouter ",
    );

    expect(descriptor).toMatchObject({
      slug: "openrouter/google/gemma-4-26b-a4b-it",
      name: "Google: Gemma 4 26B A4B",
      upstreamProviderId: "openrouter",
      upstreamProviderName: "OpenRouter",
    });
  });

  it("omits models whose normalized identity would no longer resolve in the registry", () => {
    expect(
      toPiProviderModelDescriptor(
        {
          provider: " openrouter",
          id: "google/gemma-4-26b-a4b-it",
          name: "Google: Gemma 4 26B A4B",
          reasoning: false,
        } as Model<Api>,
        () => "OpenRouter",
      ),
    ).toBeNull();
    expect(
      toPiProviderModelDescriptor(
        {
          provider: "openrouter",
          id: " google/gemma-4-26b-a4b-it",
          name: "Google: Gemma 4 26B A4B",
          reasoning: false,
        } as Model<Api>,
        () => "OpenRouter",
      ),
    ).toBeNull();
  });

  it("isolates extension providers between sessions that share an agent directory", async () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "synara-pi-runtime-isolation-"));

    try {
      const firstRuntime = await createPiModelRuntime(agentDir, { ModelRuntime });
      const secondRuntime = await createPiModelRuntime(agentDir, { ModelRuntime });
      const firstRegistry = new ModelRegistry(firstRuntime);
      const secondRegistry = new ModelRegistry(secondRuntime);

      firstRegistry.registerProvider("project-local", {
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        apiKey: "test-key",
        models: [
          {
            id: "project-model",
            name: "Project Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 16_384,
          },
        ],
      });

      expect(firstRegistry.find("project-local", "project-model")).toBeDefined();
      expect(secondRegistry.find("project-local", "project-model")).toBeUndefined();
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("includes custom-provider models authenticated through auth.json semantics", async () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "synara-pi-models-"));
    const modelsPath = path.join(agentDir, "models.json");
    const authPath = path.join(agentDir, "auth.json");

    try {
      writeFileSync(
        modelsPath,
        JSON.stringify({
          providers: {
            local: {
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:11434/v1",
              models: [{ id: "glm-5.2" }],
            },
          },
        }),
      );
      writeFileSync(
        authPath,
        JSON.stringify({
          local: { type: "api_key", key: "test-key" },
        }),
      );
      const modelRuntime = await ModelRuntime.create({
        authPath,
        modelsPath,
        allowModelNetwork: false,
      });
      const registry = new ModelRegistry(modelRuntime);

      const models = getPiDiscoverableModels(registry);

      expect(models.some((model) => model.provider === "local" && model.id === "glm-5.2")).toBe(
        true,
      );
      expect(models.some((model) => model.provider === "anthropic")).toBe(false);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("restores Fable 5 and Opus 4.8 after an extension replaces the Anthropic catalog", async () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "synara-pi-anthropic-"));
    const modelsPath = path.join(agentDir, "models.json");
    const authPath = path.join(agentDir, "auth.json");

    try {
      writeFileSync(modelsPath, "{}");
      writeFileSync(
        authPath,
        JSON.stringify({
          anthropic: {
            type: "oauth",
            access: "tok",
            refresh: "ref",
            expires: Date.now() + 60_000,
          },
        }),
      );
      const modelRuntime = await ModelRuntime.create({
        authPath,
        modelsPath,
        allowModelNetwork: false,
      });
      const registry = new ModelRegistry(modelRuntime);
      registry.registerProvider("anthropic", {
        baseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        apiKey: "test-key",
        models: [
          {
            id: "claude-opus-4-7",
            name: "Claude Opus 4.7",
            api: "anthropic-messages",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
            contextWindow: 1_000_000,
            maxTokens: 128_000,
          },
        ],
      });

      expect(
        registry
          .getAll()
          .filter((model) => model.provider === "anthropic")
          .map((model) => model.id),
      ).toEqual(["claude-opus-4-7"]);
      const models = getPiDiscoverableModels(registry);

      expect(
        models.some((model) => model.provider === "anthropic" && model.id === "claude-fable-5"),
      ).toBe(true);
      expect(
        models.some((model) => model.provider === "anthropic" && model.id === "claude-opus-4-8"),
      ).toBe(true);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});

describe("ensurePiAnthropicCatalogModels", () => {
  it("does not invent Anthropic models when Anthropic is unauthenticated", () => {
    const models = ensurePiAnthropicCatalogModels([
      {
        id: "glm-5.2",
        name: "GLM 5.2",
        api: "openai-completions",
        provider: "local",
        baseUrl: "http://127.0.0.1:11434/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
    ]);

    expect(models.every((model) => model.provider !== "anthropic")).toBe(true);
  });

  it("restores Fable 5 and Opus 4.8 when an oauth catalog omitted them", () => {
    const peer = {
      id: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      api: "anthropic-messages" as const,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    };
    const models = ensurePiAnthropicCatalogModels([peer], [peer]);

    expect(models.map((model) => model.id)).toEqual([
      "claude-opus-4-7",
      "claude-fable-5",
      "claude-opus-4-8",
    ]);
    expect(models.find((model) => model.id === "claude-fable-5")).toMatchObject({
      provider: "anthropic",
      name: "Claude Fable 5",
      reasoning: true,
    });
    expect(models.find((model) => model.id === "claude-opus-4-8")).toMatchObject({
      provider: "anthropic",
      name: "Claude Opus 4.8",
      reasoning: true,
    });
  });
});

describe("getPiSupportedThinkingOptions", () => {
  it("hides thinking controls for non-reasoning models", () => {
    expect(getPiSupportedThinkingOptions(makePiModel({ reasoning: false }))).toEqual([]);
  });

  it("advertises xhigh and max only when the concrete Pi model supports them", () => {
    const withoutExtended = getPiSupportedThinkingOptions(makePiModel({ reasoning: true }));
    const withXHigh = getPiSupportedThinkingOptions(
      makePiModel({ reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } }),
    );
    const withMax = getPiSupportedThinkingOptions(
      makePiModel({ reasoning: true, thinkingLevelMap: { max: "max" } }),
    );

    expect(withoutExtended.map((option) => option.value)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(withXHigh.map((option) => option.value)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(withMax.map((option) => option.value)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  it("respects provider-level disabled thinking levels", () => {
    const options = getPiSupportedThinkingOptions(
      makePiModel({
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: "low",
          low: "low",
          medium: "medium",
          high: "high",
        },
      }),
    );

    expect(options.map((option) => option.value)).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("preserves kimi-k3 style ladders that expose low, high, and max", () => {
    const options = getPiSupportedThinkingOptions(
      makePiModel({
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: "low",
          medium: null,
          high: "high",
          xhigh: null,
          max: "max",
        },
      }),
    );

    expect(options.map((option) => option.value)).toEqual(["low", "high", "max"]);
  });
});

describe("Pi extension UI helpers", () => {
  it("stamps events from the lifecycle generation captured by the session context", () => {
    const eventBase = makePiRuntimeEventBase({
      lifecycleGeneration: "generation-pi-7",
      session: { threadId: "thread-pi" as never },
      activeTurnId: "turn-pi" as never,
    });

    expect(eventBase).toMatchObject({
      provider: "pi",
      threadId: "thread-pi",
      turnId: "turn-pi",
      lifecycleGeneration: "generation-pi-7",
    });
  });

  it("keeps original select values while showing normalized unique labels", () => {
    const mappings = makePiUserInputOptions(["  OpenRouter  ", "", "OpenRouter"]);

    expect(mappings.map((mapping) => mapping.value)).toEqual(["  OpenRouter  ", "", "OpenRouter"]);
    expect(mappings.map((mapping) => mapping.option.label)).toEqual([
      "OpenRouter",
      "Option 2",
      "OpenRouter (2)",
    ]);
  });

  it("provides a no-color theme object for UI-gated extensions", () => {
    expect(PLAIN_PI_EXTENSION_THEME.fg("accent", "ready")).toBe("ready");
    expect(PLAIN_PI_EXTENSION_THEME.bold("done")).toBe("done");
    expect(PLAIN_PI_EXTENSION_THEME.getThinkingBorderColor("medium")("thinking")).toBe("thinking");
  });
});
