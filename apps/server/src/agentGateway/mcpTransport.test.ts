import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId, TurnId, type OrchestrationThreadShell } from "@synara/contracts";
import { Deferred, Effect, Fiber, Option } from "effect";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeAgentGatewayBrowserTools } from "./browserTools.ts";
import { BrowserHostRpcError } from "../browserAutomation/browserHostRpcClient.ts";
import { makeAgentGatewaySessionRegistry } from "./Layers/AgentGatewaySessionRegistry.ts";
import type { AgentGatewayCredentialsShape } from "./Services/AgentGatewayCredentials.ts";
import { makeAgentGatewayInFlightRequestRegistry } from "./inFlightRequestRegistry.ts";
import {
  makeMcpSessionAuthorityRegistry,
  type McpAuthorityBinding,
  type McpSessionAuthorityRegistryShape,
} from "./mcpSessionAuthority.ts";
import { makeAgentGatewayMcpTransport } from "./mcpTransport.ts";
import { acquireAgentGatewaySessionLease, type AgentGatewaySessionLease } from "./sessionLease.ts";
import type { ToolEntry } from "./toolRuntime.ts";

const NOW = "2026-07-22T03:00:00.000Z";
const TEST_PROJECT_ID = "project-mcp-cancellation";
const TEST_AUTHORITY_SUBJECT = "test-owner";

function makeThread(threadId: string): OrchestrationThreadShell {
  return {
    id: ThreadId.makeUnsafe(threadId),
    projectId: ProjectId.makeUnsafe(TEST_PROJECT_ID),
    title: threadId,
    modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    envMode: "local",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createBranchFlowCompleted: false,
    isPinned: false,
    parentThreadId: null,
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    forkSourceThreadId: null,
    sidechatSourceThreadId: null,
    lastKnownPr: null,
    latestTurn: {
      turnId: TurnId.makeUnsafe(`turn-${threadId}`),
      state: "running",
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: null,
      assistantMessageId: null,
    },
    latestUserMessageAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    handoff: null,
    session: null,
  };
}

function makeTransport(input: {
  readonly tool: ToolEntry;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  /**
   * Shared authority registry for minting test credentials (Decision 21).
   * Pass a registry with a controlled clock to drive expiry and staleness in
   * admission tests; when omitted the harness mints its own live bindings.
   */
  readonly mcpSessionAuthority?: McpSessionAuthorityRegistryShape;
}) {
  const threads = new Map(input.threads.map((thread) => [String(thread.id), thread]));
  let nextSession = 0;
  let nextRandomPartIsSession = true;
  const sessionRegistry = makeAgentGatewaySessionRegistry({
    randomId: () => {
      if (nextRandomPartIsSession) {
        nextSession += 1;
        nextRandomPartIsSession = false;
        return `session-${nextSession}`;
      }
      nextRandomPartIsSession = true;
      return `token-${nextSession}`;
    },
  });
  let nextAuthority = 0;
  const mcpSessionAuthority =
    input.mcpSessionAuthority ??
    makeMcpSessionAuthorityRegistry({ randomId: () => `authority-${++nextAuthority}` });
  const inFlightRequests = makeAgentGatewayInFlightRequestRegistry();
  // Counted so a denial can prove admission ran before any write-authority
  // binding, not merely before the handler (Decision 21 / AC2).
  const bindWriteAuthorityCalls: string[] = [];
  const credentials = {
    verifySession: sessionRegistry.verify,
    bindWriteAuthority: (token: string, turnId: string) => {
      bindWriteAuthorityCalls.push(turnId);
      return sessionRegistry.bindWriteAuthority(token, turnId);
    },
    verifyWriteAuthority: sessionRegistry.verifyWriteAuthority,
    registerInFlightRequest: inFlightRequests.register,
    cancelInFlightRequests: inFlightRequests.cancel,
    cancelSessionTurnRequests: (token: string, turnId: string) => {
      const session = sessionRegistry.verify(token);
      return session
        ? inFlightRequests.cancelTurn(session.sessionKey, turnId).settled
        : Promise.resolve();
    },
    retireSessionTurn: (token: string, turnId: string) => {
      const session = sessionRegistry.verify(token);
      if (!session) return Promise.resolve();
      sessionRegistry.retireWriteAuthority(token, turnId);
      return inFlightRequests.cancelTurn(session.sessionKey, turnId).settled;
    },
    revokeSessionToken: (token: string) => {
      const session = sessionRegistry.verify(token);
      sessionRegistry.revoke(token);
      if (session) inFlightRequests.revokeSession(session.sessionKey);
    },
    connectionForThread: (
      threadId: ThreadId,
      _provider: "codex",
      mcpAuthority?: McpAuthorityBinding | null,
    ) => {
      const issued = sessionRegistry.issue(threadId, "codex", mcpAuthority ?? null);
      return {
        url: "http://127.0.0.1:48123/mcp",
        bearerToken: issued.token,
      };
    },
  } as unknown as AgentGatewayCredentialsShape;
  const tokenAliases = new Map<string, string>();
  const sessionKeyAliases = new Map<string, string>();
  const leases = new Map<string, AgentGatewaySessionLease>();
  const mcpAuthorityForThread = new Map<string, McpAuthorityBinding>();
  const startRuntime = (threadId: string, tokenAlias: string): AgentGatewaySessionLease => {
    // Every runtime gets a fresh server-minted authority record and resolves
    // one credential snapshot from it, mirroring the trusted issuance path.
    const record = mcpSessionAuthority.mint({
      subject: TEST_AUTHORITY_SUBJECT,
      kind: "local-owner",
      authSessionId: null,
      authExpiresAt: null,
    });
    const binding = mcpSessionAuthority.bindingFor(record.authorityId, {
      threadId,
      provider: "codex",
      projectId: TEST_PROJECT_ID,
      lifecycleGeneration: null,
      credentialTtlMs: 300_000,
    });
    if (!binding) throw new Error("Expected an admittable authority binding");
    mcpAuthorityForThread.set(threadId, binding);
    const lease = acquireAgentGatewaySessionLease(
      credentials,
      ThreadId.makeUnsafe(threadId),
      "codex",
      binding,
    );
    if (!lease) throw new Error("Expected gateway session lease");
    tokenAliases.set(tokenAlias, lease.connection.bearerToken);
    const session = sessionRegistry.verify(lease.connection.bearerToken);
    if (!session) throw new Error("Expected registered gateway session");
    sessionKeyAliases.set(`session-${leases.size + 1}`, session.sessionKey);
    leases.set(threadId, lease);
    return lease;
  };
  input.threads.forEach((thread, index) => {
    startRuntime(String(thread.id), `token-${index + 1}`);
  });
  const snapshotQuery = {
    getThreadShellById: (threadId: ThreadId) =>
      Effect.succeed(Option.fromNullishOr(threads.get(String(threadId)))),
  } as unknown as ProjectionSnapshotQueryShape;

  const transport = makeAgentGatewayMcpTransport({
    credentials,
    mcpSessionAuthority,
    snapshotQuery,
    tools: [input.tool],
    instructions: "test",
    requireThreadShell: (threadId) => {
      const thread = threads.get(threadId);
      return thread ? Effect.succeed(thread) : Effect.fail(new Error("missing thread"));
    },
  });
  return Object.assign(transport, {
    resolveToken: (token: string) => tokenAliases.get(token) ?? token,
    sessionKeyForToken: (token: string) => sessionRegistry.verify(token)?.sessionKey ?? null,
    /**
     * Mint a credential for an arbitrary authority binding (or none). Raw
     * bearer tokens are valid directly in `post`.
     */
    issueCredential: (threadId: string, mcpAuthority?: McpAuthorityBinding | null) =>
      sessionRegistry.issue(ThreadId.makeUnsafe(threadId), "codex", mcpAuthority ?? null).token,
    /** Number of requests currently registered in-flight for one turn. */
    inFlightCountFor: (sessionKey: string, turnId: string) =>
      inFlightRequests.cancelTurn(sessionKey, turnId).count,
    /** How many times this transport bound write authority for a turn. */
    bindWriteAuthorityCount: () => bindWriteAuthorityCalls.length,
    mcpSessionAuthority,
    cancelTurn: (sessionKey: string, turnId: string) =>
      inFlightRequests.cancelTurn(sessionKeyAliases.get(sessionKey) ?? sessionKey, turnId),
    setThreadTurnState: (
      threadId: string,
      state: "running" | "completed" | "error" | "interrupted",
    ) => {
      const thread = threads.get(threadId);
      if (!thread?.latestTurn) return;
      threads.set(threadId, {
        ...thread,
        latestTurn: {
          ...thread.latestTurn,
          state,
          completedAt: state === "running" ? null : NOW,
        },
      });
    },
    completeTurnAndRestartRuntime: async (
      threadId: string,
      completedTurnId: string,
      replacementTokenAlias: string,
    ) => {
      const outgoing = leases.get(threadId);
      if (!outgoing) throw new Error("Expected outgoing gateway session lease");
      await outgoing.retireTurn(completedTurnId);
      outgoing.release();
      startRuntime(threadId, replacementTokenAlias);
    },
    setThreadTurn: (threadId: string, turnId: string) => {
      const thread = threads.get(threadId);
      if (!thread?.latestTurn) return;
      threads.set(threadId, {
        ...thread,
        latestTurn: {
          ...thread.latestTurn,
          turnId: TurnId.makeUnsafe(turnId),
          state: "running",
          completedAt: null,
        },
      });
    },
  });
}

const post = (transport: ReturnType<typeof makeTransport>, token: string, body: unknown) =>
  transport({ authorizationHeader: `Bearer ${transport.resolveToken(token)}`, body });

describe("makeAgentGatewayMcpTransport cancellation", () => {
  it.effect(
    "rejects turn A's credential after production completion and restart admit turn B",
    () =>
      Effect.gen(function* () {
        let handlerCalls = 0;
        const transport = makeTransport({
          threads: [makeThread("thread-rotated")],
          tool: {
            definition: {
              name: "browser_click",
              description: "test",
              inputSchema: { type: "object" },
            },
            requiredCapability: "browser:control",
            requiresActiveTurn: true,
            handler: () => {
              handlerCalls += 1;
              return Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] });
            },
          },
        });
        yield* Effect.promise(() =>
          transport.completeTurnAndRestartRuntime(
            "thread-rotated",
            "turn-thread-rotated",
            "token-b",
          ),
        );
        transport.setThreadTurn("thread-rotated", "turn-b");
        const body = {
          jsonrpc: "2.0",
          id: "browser-click",
          method: "tools/call",
          params: { name: "browser_click", arguments: {} },
        };

        const lateA = yield* post(transport, "token-1", body);
        assert.equal(lateA.status, 401);
        const turnB = yield* post(transport, "token-b", body);
        assert.equal(turnB.status, 200);
        assert.equal(handlerCalls, 1);
      }),
  );

  it.effect(
    "cancels a detached MCP call by gateway session and turn without a client notification",
    () =>
      Effect.gen(function* () {
        const hostStarted = yield* Deferred.make<void>();
        const hostAbortObserved = yield* Deferred.make<void>();
        let hostCalls = 0;
        const browserWait = makeAgentGatewayBrowserTools({
          available: true,
          execute: () => {
            hostCalls += 1;
            return Effect.tryPromise({
              try: (signal) => {
                return new Promise<never>((_resolve, reject) => {
                  signal.addEventListener(
                    "abort",
                    () => {
                      Deferred.doneUnsafe(hostAbortObserved, Effect.void);
                      reject(new Error("browser host request aborted"));
                    },
                    { once: true },
                  );
                  // Wake the Stop path before tryPromise returns, reproducing
                  // the re-entrant window where a direct interrupt would miss
                  // Effect's not-yet-installed AbortController finalizer.
                  Deferred.doneUnsafe(hostStarted, Effect.void);
                });
              },
              catch: (error) => new BrowserHostRpcError("transport", String(error)),
            });
          },
        }).find((tool) => tool.definition.name === "browser_wait");
        assert.isDefined(browserWait);
        const transport = makeTransport({
          threads: [makeThread("thread-detached")],
          tool: browserWait!,
        });
        const body = {
          jsonrpc: "2.0",
          id: "detached-browser-wait",
          method: "tools/call",
          params: {
            name: "browser_wait",
            arguments: {
              tabId: "53756993-1de8-47a5-82c9-e00766199802",
              conditions: [{ kind: "text", text: "STOP_SENTINEL_NEVER_APPEARS", state: "present" }],
              timeoutMs: 30_000,
            },
          },
        };

        const request = yield* post(transport, "token-1", body).pipe(Effect.forkChild);
        yield* Deferred.await(hostStarted);

        const cancellation = transport.cancelTurn("session-1", "turn-thread-detached");
        assert.equal(cancellation.count, 1);
        yield* Effect.promise(() => cancellation.settled);
        yield* Deferred.await(hostAbortObserved);
        assert.deepEqual(yield* Fiber.join(request), { status: 202 });

        // A detached cell can race and issue the request after Stop. The turn
        // tombstone must reject it before the handler starts.
        assert.deepEqual(yield* post(transport, "token-1", { ...body, id: "late-request" }), {
          status: 202,
        });
        transport.setThreadTurnState("thread-detached", "interrupted");
        const afterProjectionSettled = yield* post(transport, "token-1", {
          ...body,
          id: "after-turn-terminal",
        });
        assert.equal(afterProjectionSettled.status, 200);
        assert.equal(hostCalls, 1);
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("cleans a completed request before the same JSON-RPC id is reused", () =>
    Effect.gen(function* () {
      const transport = makeTransport({
        threads: [makeThread("thread-reuse")],
        tool: {
          definition: {
            name: "unused",
            description: "unused",
            inputSchema: { type: "object" },
          },
          requiredCapability: "thread:read",
          handler: () => Effect.never,
        },
      });
      const ping = { jsonrpc: "2.0", id: "reusable", method: "ping" };

      for (let iteration = 0; iteration < 25; iteration += 1) {
        const response = yield* post(transport, "token-1", ping);
        assert.deepEqual(response, {
          status: 200,
          body: { jsonrpc: "2.0", id: "reusable", result: {} },
        });
      }
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect(
    "interrupts only the matching session request and keeps a following ping responsive",
    () =>
      Effect.gen(function* () {
        const startedOne = yield* Deferred.make<void>();
        const startedTwo = yield* Deferred.make<void>();
        const interruptedOne = yield* Deferred.make<void>();
        const interruptedTwo = yield* Deferred.make<void>();
        const releaseFirstCleanup = yield* Deferred.make<void>();
        const tool: ToolEntry = {
          definition: {
            name: "slow",
            description: "Wait until cancelled",
            inputSchema: { type: "object" },
          },
          requiredCapability: "thread:read",
          handler: (_args, context) => {
            const first = context.callerSessionKey.endsWith(":session-1");
            return Deferred.succeed(first ? startedOne : startedTwo, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(first ? interruptedOne : interruptedTwo, undefined);
                  if (first) yield* Deferred.await(releaseFirstCleanup);
                }),
              ),
            );
          },
        };
        const transport = makeTransport({
          tool,
          threads: [makeThread("thread-one"), makeThread("thread-two")],
        });
        const slowBody = {
          jsonrpc: "2.0",
          id: "shared-id",
          method: "tools/call",
          params: { name: "slow", arguments: {} },
        };
        const requestOne = yield* post(transport, "token-1", slowBody).pipe(Effect.forkChild);
        const requestTwo = yield* post(transport, "token-2", slowBody).pipe(Effect.forkChild);
        yield* Deferred.await(startedOne);
        yield* Deferred.await(startedTwo);

        const cancellation = yield* post(transport, "token-1", {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: "shared-id", reason: "test" },
        });
        assert.deepEqual(cancellation, { status: 202 });
        yield* Deferred.await(interruptedOne);
        assert.isUndefined(yield* Deferred.poll(interruptedTwo));

        const ping = yield* post(transport, "token-1", {
          jsonrpc: "2.0",
          id: "ping-after-cancel",
          method: "ping",
        });
        assert.equal(ping.status, 200);
        assert.deepEqual(ping.body, {
          jsonrpc: "2.0",
          id: "ping-after-cancel",
          result: {},
        });
        assert.isUndefined(requestOne.pollUnsafe());
        yield* Deferred.succeed(releaseFirstCleanup, undefined);

        yield* post(transport, "token-2", {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: "shared-id" },
        });
        yield* Deferred.await(interruptedTwo);
        assert.deepEqual(yield* Fiber.join(requestOne), { status: 202 });
        assert.deepEqual(yield* Fiber.join(requestTwo), { status: 202 });
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect(
    "runs batch requests concurrently and applies cancellation without head-of-line blocking",
    () =>
      Effect.gen(function* () {
        const interrupted = yield* Deferred.make<void>();
        const transport = makeTransport({
          threads: [makeThread("thread-batch")],
          tool: {
            definition: {
              name: "slow",
              description: "Wait until cancelled",
              inputSchema: { type: "object" },
            },
            requiredCapability: "thread:read",
            handler: () =>
              Effect.never.pipe(
                Effect.onInterrupt(() =>
                  Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                ),
              ),
          },
        });

        const response = yield* post(transport, "token-1", [
          {
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: "slow-batch" },
          },
          {
            jsonrpc: "2.0",
            id: "slow-batch",
            method: "tools/call",
            params: { name: "slow", arguments: {} },
          },
          { jsonrpc: "2.0", id: "fast-batch", method: "ping" },
        ]);

        yield* Deferred.await(interrupted);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, [{ jsonrpc: "2.0", id: "fast-batch", result: {} }]);
      }).pipe(Effect.timeout("2 seconds")),
  );
});

describe("makeAgentGatewayMcpTransport subject-bound authority admission", () => {
  const NOW_MS = 1_780_000_000_000;

  function makeAuthorityFixture() {
    let time = NOW_MS;
    const registry = makeMcpSessionAuthorityRegistry({
      randomId: () => "authority-fixed",
      now: () => time,
    });
    return {
      registry,
      setTime: (value: number) => {
        time = value;
      },
    };
  }

  function makeProbeTool(options: { readonly probeCalls: { count: number } }) {
    const tool: ToolEntry = {
      definition: {
        name: "probe",
        description: "test",
        inputSchema: { type: "object" },
      },
      requiredCapability: "thread:read",
      // A running turn is present in `makeThread`, so any reachable write
      // authority would bind successfully. A denial therefore proves the
      // admission gate ran first.
      requiresActiveTurn: true,
      handler: () => {
        options.probeCalls.count += 1;
        return Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] });
      },
    };
    return tool;
  }

  function mintBinding(
    registry: McpSessionAuthorityRegistryShape,
    overrides: Partial<McpAuthorityBinding> = {},
  ): McpAuthorityBinding {
    const record = registry.mint({
      subject: TEST_AUTHORITY_SUBJECT,
      kind: "local-owner",
      authSessionId: null,
      authExpiresAt: null,
    });
    const binding = registry.bindingFor(record.authorityId, {
      threadId: "thread-admission",
      provider: "codex",
      projectId: TEST_PROJECT_ID,
      lifecycleGeneration: null,
      credentialTtlMs: 300_000,
    });
    if (!binding) throw new Error("Expected an admittable authority binding");
    return { ...binding, ...overrides };
  }

  /**
   * Drives one denied request and proves the admission gate precedes write
   * authority binding, in-flight registration, and handler execution.
   */
  async function expectDenied(
    transport: ReturnType<typeof makeTransport>,
    token: string,
    reason: string,
    body: unknown = {
      jsonrpc: "2.0",
      id: "probe",
      method: "tools/call",
      params: { name: "probe", arguments: {} },
    },
  ) {
    const sessionKey = transport.sessionKeyForToken(token);
    const bindsBefore = transport.bindWriteAuthorityCount();
    const response = await Effect.runPromise(post(transport, token, body));
    assert.equal(response.status, 401);
    const message = (response.body as { error?: { message?: string } }).error?.message;
    assert.isString(message);
    assert.include(message, `mcp_authority_denied:${reason}`);
    // The handler never started, so no request was ever registered in-flight
    // and no write authority was ever bound for the running turn.
    if (sessionKey !== null) {
      assert.equal(transport.inFlightCountFor(sessionKey, "turn-thread-admission"), 0);
    }
    assert.equal(transport.bindWriteAuthorityCount(), bindsBefore);
    return message;
  }

  it.effect("admits a valid server-issued credential for the bound thread", () =>
    Effect.gen(function* () {
      const fixture = makeAuthorityFixture();
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let handlerCalls = 0;
      const tool: ToolEntry = {
        definition: {
          name: "probe",
          description: "test",
          inputSchema: { type: "object" },
        },
        requiredCapability: "thread:read",
        requiresActiveTurn: true,
        handler: () => {
          handlerCalls += 1;
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(
              Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] }),
            ),
          );
        },
      };
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool,
        mcpSessionAuthority: fixture.registry,
      });
      const binding = mintBinding(fixture.registry);
      const token = transport.issueCredential("thread-admission", binding);
      const sessionKey = transport.sessionKeyForToken(token);

      const request = yield* post(transport, token, {
        jsonrpc: "2.0",
        id: "probe",
        method: "tools/call",
        params: { name: "probe", arguments: {} },
      }).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      // The request is registered in-flight only after MCP authority admission
      // approved the credential; write authority bound for the running turn.
      assert.equal(transport.inFlightCountFor(sessionKey!, "turn-thread-admission"), 1);
      assert.equal(handlerCalls, 1);
      yield* Deferred.succeed(release, undefined);
      const response = yield* Fiber.join(request);
      assert.equal(response.status, 200);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a missing subject-bound authority before any side effect", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const unboundToken = transport.issueCredential("thread-admission", null);

      const message = yield* Effect.promise(() =>
        expectDenied(transport, unboundToken, "missing-binding"),
      );
      assert.equal(probeCalls.count, 0);
      assert.include(message, "reissued");
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a revoked authority even though the bearer itself is still active", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const record = fixture.registry.mint({ subject: TEST_AUTHORITY_SUBJECT, kind: "local-owner" });
      const binding = fixture.registry.bindingFor(record.authorityId, {
        threadId: "thread-admission",
        provider: "codex",
        projectId: TEST_PROJECT_ID,
        lifecycleGeneration: null,
        credentialTtlMs: 300_000,
      });
      if (!binding) throw new Error("Expected an admittable authority binding");
      fixture.registry.revoke(record.authorityId, "rotation");
      const token = transport.issueCredential("thread-admission", binding);

      yield* Effect.promise(() => expectDenied(transport, token, "revoked"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a credential whose bound authentication has expired", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const record = fixture.registry.mint({
        subject: TEST_AUTHORITY_SUBJECT,
        kind: "authenticated",
        authSessionId: "session-auth",
        // Beyond the credential TTL at issuance so `bindingFor` accepts it;
        // the authentication then expires before the credential does.
        authExpiresAt: NOW_MS + 400_000,
      });
      const binding = fixture.registry.bindingFor(record.authorityId, {
        threadId: "thread-admission",
        provider: "codex",
        projectId: TEST_PROJECT_ID,
        lifecycleGeneration: null,
        credentialTtlMs: 300_000,
      });
      if (!binding) throw new Error("Expected an admittable authority binding");
      const token = transport.issueCredential("thread-admission", binding);

      fixture.setTime(NOW_MS + 450_000);
      yield* Effect.promise(() => expectDenied(transport, token, "expired-auth"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a credential past its own expiry before handler work", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const record = fixture.registry.mint({ subject: TEST_AUTHORITY_SUBJECT, kind: "local-owner" });
      const binding = fixture.registry.bindingFor(record.authorityId, {
        threadId: "thread-admission",
        provider: "codex",
        projectId: TEST_PROJECT_ID,
        lifecycleGeneration: null,
        credentialTtlMs: 10_000,
      });
      if (!binding) throw new Error("Expected an admittable authority binding");
      const token = transport.issueCredential("thread-admission", binding);

      fixture.setTime(NOW_MS + 20_000);
      yield* Effect.promise(() => expectDenied(transport, token, "expired-credential"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a stale session-generation snapshot deterministically", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const stale = {
        ...mintBinding(fixture.registry),
        sessionGeneration: "gen-from-revoked-session",
      };
      const token = transport.issueCredential("thread-admission", stale);

      yield* Effect.promise(() => expectDenied(transport, token, "stale-session-generation"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a mismatched subject or kind snapshot deterministically", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const mismatchedSubject = { ...mintBinding(fixture.registry), subject: "another-user" };
      const mismatchedKind = { ...mintBinding(fixture.registry), kind: "authenticated" as const };
      const subjectToken = transport.issueCredential("thread-admission", mismatchedSubject);
      const kindToken = transport.issueCredential("thread-admission", mismatchedKind);

      yield* Effect.promise(() => expectDenied(transport, subjectToken, "subject-mismatch"));
      yield* Effect.promise(() => expectDenied(transport, kindToken, "kind-mismatch"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a credential bound to a different project than the invoking thread", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const wrongProject = { ...mintBinding(fixture.registry), projectId: "project-other" };
      const token = transport.issueCredential("thread-admission", wrongProject);

      yield* Effect.promise(() => expectDenied(transport, token, "project-mismatch"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies an unknown or future-dated authority deterministically", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const unknown = { ...mintBinding(fixture.registry), authorityId: "mcp-authority-elsewhere" };
      const unknownToken = transport.issueCredential("thread-admission", unknown);
      yield* Effect.promise(() => expectDenied(transport, unknownToken, "unknown-authority"));

      const futureDated = mintBinding(fixture.registry);
      const futureToken = transport.issueCredential("thread-admission", futureDated);
      fixture.setTime(NOW_MS - 1_000);
      yield* Effect.promise(() => expectDenied(transport, futureToken, "invalid-issuance"));
      assert.equal(probeCalls.count, 0);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a stale MCP lifecycle generation surfaced by trusted runtime state", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      // The transport passes the trusted admission context through to the
      // registry; it does not itself observe the runtime's current MCP
      // lifecycle generation yet (that coordinator is impl-06's seam). This
      // registry stands in for the trusted runtime supplying it, so the
      // transport's handling of a `stale-lifecycle-generation` denial is
      // proven end-to-end without changing lifecycle semantics here.
      const currentLifecycleGeneration = "mcp-lifecycle-gen-2";
      const registryWithLifecycleState: McpSessionAuthorityRegistryShape = {
        ...fixture.registry,
        assertAdmittable: (binding, context) =>
          fixture.registry.assertAdmittable(binding, {
            projectId: context?.projectId ?? null,
            lifecycleGeneration: currentLifecycleGeneration,
          }),
      };
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: registryWithLifecycleState,
      });
      const stale = {
        ...mintBinding(fixture.registry),
        lifecycleGeneration: "mcp-lifecycle-gen-1",
      };
      const token = transport.issueCredential("thread-admission", stale);

      yield* Effect.promise(() => expectDenied(transport, token, "stale-lifecycle-generation"));
      assert.equal(probeCalls.count, 0);

      // The same credential re-minted for the current generation is admitted,
      // so the denial is generation-specific and not a blanket failure.
      const currentToken = transport.issueCredential("thread-admission", {
        ...stale,
        lifecycleGeneration: currentLifecycleGeneration,
      });
      const admitted = yield* post(transport, currentToken, {
        jsonrpc: "2.0",
        id: "probe",
        method: "tools/call",
        params: { name: "probe", arguments: {} },
      });
      assert.equal(admitted.status, 200);
      assert.equal(probeCalls.count, 1);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("never lets request-supplied identity override the trusted credential binding", () =>
    Effect.gen(function* () {
      const fixture = makeAuthorityFixture();
      const observed: Array<{
        readonly subject: unknown;
        readonly sessionKey: string;
        readonly threadId: string;
      }> = [];
      const tool: ToolEntry = {
        definition: { name: "probe", description: "test", inputSchema: { type: "object" } },
        requiredCapability: "thread:read",
        requiresActiveTurn: true,
        handler: (args, context) => {
          observed.push({
            subject: (args as { subject?: unknown }).subject,
            sessionKey: context.callerSessionKey,
            threadId: context.callerThreadId,
          });
          return Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] });
        },
      };
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool,
        mcpSessionAuthority: fixture.registry,
      });
      const trusted = mintBinding(fixture.registry);
      // Identity fields an attacker could try to smuggle through the request.
      const spoofedIdentity = {
        subject: "root",
        authorityId: trusted.authorityId,
        sessionGeneration: trusted.sessionGeneration,
        kind: "authenticated",
        authSessionId: "session-root",
        projectId: TEST_PROJECT_ID,
        mcpAuthority: trusted,
        // A thread this credential is not bound to.
        threadId: "thread-elsewhere",
        callerThreadId: "thread-elsewhere",
      };

      // 1. A credential with no server-side binding stays denied no matter how
      //    complete the request-supplied authority looks.
      const unboundToken = transport.issueCredential("thread-admission", null);
      yield* Effect.promise(() =>
        expectDenied(transport, unboundToken, "missing-binding", {
          jsonrpc: "2.0",
          id: "probe",
          method: "tools/call",
          params: { name: "probe", arguments: spoofedIdentity, ...spoofedIdentity },
        }),
      );
      assert.deepEqual(observed, []);

      // 2. A credential whose server-side subject is mismatched stays denied
      //    even when the request supplies the record's real subject.
      const mismatchedToken = transport.issueCredential("thread-admission", {
        ...mintBinding(fixture.registry),
        subject: "another-user",
      });
      yield* Effect.promise(() =>
        expectDenied(transport, mismatchedToken, "subject-mismatch", {
          jsonrpc: "2.0",
          id: "probe",
          method: "tools/call",
          params: {
            name: "probe",
            arguments: { ...spoofedIdentity, subject: TEST_AUTHORITY_SUBJECT },
          },
        }),
      );
      assert.deepEqual(observed, []);

      // 3. On the admitted path the trusted credential — not the request —
      //    still determines the caller principal.
      const validToken = transport.issueCredential("thread-admission", trusted);
      const admitted = yield* post(transport, validToken, {
        jsonrpc: "2.0",
        id: "probe",
        method: "tools/call",
        params: { name: "probe", arguments: spoofedIdentity },
      });
      assert.equal(admitted.status, 200);
      assert.lengthOf(observed, 1);
      assert.equal(observed[0]!.threadId, "thread-admission");
      assert.equal(observed[0]!.sessionKey, transport.sessionKeyForToken(validToken));
      assert.notEqual(observed[0]!.sessionKey, null);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies a spoofed bearer header carrying inline identity assertions", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const trusted = mintBinding(fixture.registry);
      const validToken = transport.issueCredential("thread-admission", trusted);
      const body = {
        jsonrpc: "2.0",
        id: "probe",
        method: "tools/call",
        params: { name: "probe", arguments: {} },
      };

      // Identity appended to the credential header is not parsed as identity;
      // it only produces an unknown credential, which fails closed.
      for (const header of [
        `Bearer ${validToken}; subject=root`,
        `Bearer ${validToken}, X-Synara-Subject: root`,
        `Bearer subject=${TEST_AUTHORITY_SUBJECT}`,
        `Bearer ${trusted.authorityId}`,
      ]) {
        const response = yield* transport({ authorizationHeader: header, body });
        assert.equal(response.status, 401);
        assert.include(
          (response.body as { error?: { message?: string } }).error?.message ?? "",
          "caller_session_inactive",
        );
      }
      assert.equal(probeCalls.count, 0);
      assert.equal(transport.bindWriteAuthorityCount(), 0);

      // The unmodified header on the same credential still works.
      const admitted = yield* transport({
        authorizationHeader: `Bearer ${validToken}`,
        body,
      });
      assert.equal(admitted.status, 200);
      assert.equal(probeCalls.count, 1);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("denies with a deterministic status before any registration even for read-only tools", () =>
    Effect.gen(function* () {
      const probeCalls = { count: 0 };
      const fixture = makeAuthorityFixture();
      const transport = makeTransport({
        threads: [makeThread("thread-admission")],
        tool: makeProbeTool({ probeCalls }),
        mcpSessionAuthority: fixture.registry,
      });
      const token = transport.issueCredential("thread-admission", null);

      // A batch keeps ping (read-only, non-turn) in the same request: the
      // denial must short-circuit the whole request without dispatching ping.
      const response = yield* post(transport, token, [
        { jsonrpc: "2.0", id: "probe", method: "tools/call", params: { name: "probe", arguments: {} } },
        { jsonrpc: "2.0", id: "ping", method: "ping" },
      ]);
      assert.equal(response.status, 401);
      assert.include(
        (response.body as { error?: { message?: string } }).error?.message ?? "",
        "mcp_authority_denied:missing-binding",
      );
      assert.equal(probeCalls.count, 0);
      const sessionKey = transport.sessionKeyForToken(token);
      assert.equal(transport.inFlightCountFor(sessionKey!, "turn-thread-admission"), 0);
    }).pipe(Effect.timeout("2 seconds")),
  );
});
