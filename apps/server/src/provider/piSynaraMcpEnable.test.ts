// FILE: piSynaraMcpEnable.test.ts
// Purpose: Verifies the per-session Synara MCP enable orchestration (impl-08,
// Decisions 16/17/18). The public provider/session enable boundary delegates
// here; the helper drives the lifecycle coordinator's serialized activation,
// applies the safe boundary immediately for idle sessions (agent_end never
// fires without a turn), refuses stale/misrouted session generations, and
// maps every bounded activation outcome to a non-throwing result.
// Layer: Provider/session boundary tests
// Depends on: the lifecycle coordinator and dormant adapter public seams.

import type { McpAuthorityBinding, ProviderKind, ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import { makePiSynaraMcpDormantExtension } from "./piSynaraMcpExtension.ts";
import { type PiSynaraMcpLifecycleCoordinator } from "./piSynaraMcpLifecycle.ts";
import {
  enablePiSynaraMcpSession,
  PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
  PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
} from "./piSynaraMcpEnable.ts";
import { makePiSynaraMcpToolExecutionRegistry } from "./piSynaraMcpToolExecution.ts";
import { makePiSessionSynaraMcpCoordinator } from "./Layers/PiAdapter.ts";

describe("enablePiSynaraMcpSession at the Pi provider/session boundary (impl-08)", () => {
  const AUTHORITY_BINDING: McpAuthorityBinding = {
    authorityId: "mcp-authority-enable-test",
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

  interface EnableHarness {
    readonly adapter: ReturnType<typeof makePiSynaraMcpDormantExtension>["adapter"];
    readonly coordinator: PiSynaraMcpLifecycleCoordinator;
    readonly stagedTools: any[];
    readonly minted: Array<{ readonly url: string; readonly bearerToken: string }>;
    readonly revoked: string[];
    readonly requests: Array<{ readonly token: string | null; readonly method: string }>;
    readonly reload: ReturnType<typeof vi.fn>;
  }

  function makeEnableHarness(
    options: {
      readonly mcpAuthority?: McpAuthorityBinding | null;
      readonly catalogTools?: unknown[];
      readonly failDiscovery?: Error;
      readonly failReload?: Error;
      readonly failRevoke?: Error;
    } = {},
  ): EnableHarness {
    const { adapter } = makePiSynaraMcpDormantExtension();
    const stagedTools: any[] = [];
    const executions = makePiSynaraMcpToolExecutionRegistry();
    const minted: Array<{ url: string; bearerToken: string }> = [];
    const revoked: string[] = [];
    const requests: Array<{ token: string | null; method: string }> = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
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
        _authority?: McpAuthorityBinding | null,
      ) => {
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
    };
    const reload = vi.fn(async () => {
      if (options.failReload !== undefined) {
        throw options.failReload;
      }
    });
    const coordinator = makePiSessionSynaraMcpCoordinator({
      threadId: "thread-pi-enable-1" as ThreadId,
      adapter,
      stagedTools,
      executions,
      runtime: { session: { reload } },
      mcpAuthority: options.mcpAuthority,
      ...(options.mcpAuthority === undefined ? {} : { credentials }),
      fetch,
    });
    return { adapter, coordinator, stagedTools, minted, revoked, requests, reload };
  }

  const SESSION_GENERATION = "orchestration:thread-pi-enable-1:2026-08-12T12:00:00.000Z";
  const OTHER_SESSION_GENERATION = "orchestration:thread-pi-enable-2:2026-08-12T12:00:00.000Z";
  /** A newer live session generation on the SAME thread (session recreated after capture). */
  const RECREATED_SESSION_GENERATION = "orchestration:thread-pi-enable-1:2026-08-12T12:30:00.000Z";

  it("activates an idle dormant session through the coordinator with an immediate safe boundary", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    const notify = vi.spyOn(harness.adapter, "notifySafeBoundary");

    const result = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });

    expect(result).toEqual({ state: "active", alreadyActive: false });
    expect(harness.coordinator.state).toBe("active");
    expect(harness.stagedTools.map((tool) => tool.name)).toEqual([
      "synara_list_threads",
      "synara_invoke",
    ]);
    // The idle boundary pump fired at least once so the activation could
    // commit without waiting for an agent_end that never comes.
    expect(notify.mock.calls.length).toBeGreaterThan(0);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it("waits for the natural safe boundary when a turn is active and never pumps", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    const notify = vi.spyOn(harness.adapter, "notifySafeBoundary");

    const activation = enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
      activeTurnId: "turn-active-1" as never,
    });
    // Staging runs while the activation waits for the turn boundary; the
    // helper must not notify on the session's behalf.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(harness.coordinator.state).toBe("activating");
    expect(notify).not.toHaveBeenCalled();

    await harness.adapter.notifySafeBoundary();
    const result = await activation;
    expect(result).toEqual({ state: "active", alreadyActive: false });
    expect(harness.coordinator.state).toBe("active");
  });

  it("stops pumping once a turn starts so the boundary is never forced mid-turn", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    const notify = vi.spyOn(harness.adapter, "notifySafeBoundary");
    let stillIdle = true;

    const activation = enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
      isStillIdle: () => stillIdle,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const notifiedWhileIdle = notify.mock.calls.length;
    expect(notifiedWhileIdle).toBeGreaterThan(0);

    // A turn starts: the pump must stop notifying; the natural agent_end
    // boundary (fired by the runtime) resolves the activation instead.
    stillIdle = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(notify.mock.calls.length).toBe(notifiedWhileIdle);

    await harness.adapter.notifySafeBoundary();
    const result = await activation;
    expect(result).toEqual({ state: "active", alreadyActive: false });
    expect(harness.coordinator.state).toBe("active");
  });

  it("is idempotent for an already-active session", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });
    const mintedCount = harness.minted.length;

    const duplicate = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });

    expect(duplicate).toEqual({ state: "active", alreadyActive: true });
    expect(harness.coordinator.state).toBe("active");
    // No second activation ran: no new credential, no new discovery.
    expect(harness.minted).toHaveLength(mintedCount);
  });

  it("refuses a stale or misrouted session generation with a bounded unavailable result", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });

    const misrouted = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      // A wait-set member captured for a different session/thread: the live
      // session must never be activated under a stale foreign generation.
      expectedSessionGeneration: OTHER_SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });
    expect(misrouted).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
    });
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.minted).toEqual([]);
    expect(harness.stagedTools).toEqual([]);

    const malformed = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: "not-a-session-generation",
      liveSessionGeneration: SESSION_GENERATION,
    });
    expect(malformed).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
    });
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("refuses a session recreated on the same thread when the live session generation no longer matches the captured token (F3)", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });

    // The wait-set token was captured for the ORIGINAL session on this
    // thread; the live session generation is newer (the session was stopped
    // and recreated on the same thread). The prefix check alone would pass
    // (same thread), so the full captured token must be matched against the
    // live session generation and the stale enable refused before any
    // staging (Decision 18: a recreated session must never activate from a
    // stale wait-set token).
    const result = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: RECREATED_SESSION_GENERATION,
    });

    expect(result).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
    });
    // Fail closed before staging: no activation ran, nothing was minted, no
    // candidate resources were staged, and the coordinator never left the
    // dormant state.
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.minted).toEqual([]);
    expect(harness.stagedTools).toEqual([]);
    expect(harness.revoked).toEqual([]);
  });

  it("refuses activation while a disable is deactivating (fail-closed)", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });
    await harness.coordinator.beginDeactivation();

    const result = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });

    expect(result).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
    });
    expect(harness.coordinator.state).toBe("deactivating");
  });

  it("refuses activation for a disposed session (fail-closed)", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    await harness.coordinator.dispose();

    const result = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });

    expect(result).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
    });
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.minted).toEqual([]);
  });

  it("maps an activation failure to a bounded unavailable result without partial tools", async () => {
    const harness = makeEnableHarness({
      mcpAuthority: AUTHORITY_BINDING,
      failDiscovery: new Error("gateway unavailable"),
    });

    const result = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });

    expect(result).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
    });
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.stagedTools).toEqual([]);
    expect(harness.revoked).toEqual(["token-1"]);
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "activation.failed"),
    ).toBe(true);
  });

  it("re-enables a session left unavailable after a failed activation", async () => {
    const harness = makeEnableHarness({ mcpAuthority: AUTHORITY_BINDING });
    const first = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });
    expect(first).toEqual({ state: "active", alreadyActive: false });

    await harness.coordinator
      .beginDeactivation()
      .then((handoff) => handoff.complete({ awaitSafeBoundary: false }));
    expect(harness.coordinator.state).toBe("dormant");

    const reenable = await enablePiSynaraMcpSession({
      threadId: "thread-pi-enable-1" as ThreadId,
      coordinator: harness.coordinator,
      adapter: harness.adapter,
      expectedSessionGeneration: SESSION_GENERATION,
      liveSessionGeneration: SESSION_GENERATION,
    });
    expect(reenable).toEqual({ state: "active", alreadyActive: false });
    expect(harness.coordinator.state).toBe("active");
    expect(harness.stagedTools.map((tool) => tool.name)).toEqual([
      "synara_list_threads",
      "synara_invoke",
    ]);
  });
});
