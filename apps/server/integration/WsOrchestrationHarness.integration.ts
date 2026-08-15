// FILE: WsOrchestrationHarness.integration.ts
// WP1 (impl-12 AC1 foundation): deterministic in-process harness that mounts
// the PRODUCTION `websocketRpcRouteLayer` over a bounded loopback HTTP server
// with the real orchestration/runtime layer graph
// (`makeServerRuntimeServicesLayer` from `serverLayers.ts`). The ONLY
// substitution is the `ProviderAdapterRegistry` (the deterministic test
// adapter harness), so no credentials and no real Pi/model calls are ever
// required: the loopback server has no auth token, so the trusted-loopback
// upgrade path admits the connection as owner without a session.
//
// All state lives under a fresh temp root (temp SQLite `userdata/state.sqlite`
// plus a temp home + git-initialized workspace). The harness exposes the real
// WebSocket RPC client (`dispatchCommand`, `getSnapshot`,
// `getThreadDetailSnapshot`, `replayEvents`), the bound port, temp paths, the
// adapter harness, the live MCP session authority service, wait helpers over
// the RPC snapshot, an idempotent dispose, and a reuse-root/db option so
// restart journeys can point a second harness at the same SQLite state.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderKind,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
} from "@synara/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";

import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../src/agentGateway/Services/McpSessionAuthority.ts";
import { ServerSecretStoreLive } from "../src/auth/Layers/ServerSecretStore.ts";
import {
  ServerConfig,
  deriveServerPaths,
  preparePrivateServerPaths,
  resolveCanonicalWorkspaceRoots,
  type ServerConfigShape,
} from "../src/config.ts";
import { makeBoundedNodeHttpServer } from "../src/nodeHttpServer.ts";
import { OpenLive } from "../src/open.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../src/orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationReactor } from "../src/orchestration/Services/OrchestrationReactor.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSqlitePersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../src/persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderUnsupportedError } from "../src/provider/Errors.ts";
import { ProviderDiscoveryServiceLive } from "../src/provider/Layers/ProviderDiscoveryService.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import { makeProviderServiceLive } from "../src/provider/Layers/ProviderService.ts";
import { ProviderAdapterRegistry } from "../src/provider/Services/ProviderAdapterRegistry.ts";
import { makeServerRuntimeServicesLayer } from "../src/serverLayers.ts";
import { ServerRuntimeStartup } from "../src/serverRuntimeStartup.ts";
import { ServerSettingsLive } from "../src/serverSettings.ts";
import { websocketRpcRouteLayer } from "../src/wsRpc.ts";

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";
import {
  connectSynaraWsClient,
  type SynaraWsClient,
} from "./synaraWsClient.integration.ts";

export interface MakeWsOrchestrationHarnessOptions {
  /** Provider identity the test adapter harness stands in for. Defaults to "codex". */
  readonly provider?: ProviderKind;
  /**
   * Reuse an existing harness root (home, workspace, and `userdata/state.sqlite`
   * under it) instead of creating a fresh temp root. The reused root is never
   * deleted by dispose. Enables restart/recovery journeys that must observe
   * state persisted by a previous harness instance.
   */
  readonly reuseRootDir?: string;
  /**
   * Reuse an existing SQLite database path instead of the root's default
   * `userdata/state.sqlite`. The database is never deleted by dispose.
   */
  readonly reuseDbPath?: string;
}

export interface WsOrchestrationHarness {
  /** Bound TCP port of the loopback HTTP/WebSocket server. */
  readonly port: number;
  /** `http://127.0.0.1:<port>` — the origin the WS client negotiated against. */
  readonly origin: string;
  /** Root of all temp state (home, workspace, userdata). */
  readonly rootDir: string;
  /** Temp home directory backing the server config (never the real user home). */
  readonly homeDir: string;
  /** Git-initialized workspace directory used as the project workspace root. */
  readonly workspaceDir: string;
  /** SQLite database path backing the orchestration journal/projection. */
  readonly dbPath: string;
  /** The deterministic provider adapter harness standing in for the registry. */
  readonly adapterHarness: TestProviderAdapterHarness;
  /** Real WebSocket RPC client speaking the public WS boundary. */
  readonly client: SynaraWsClient;
  /** Direct engine handle (same service the WS dispatch path targets). */
  readonly engine: OrchestrationEngineShape;
  /** Direct projection snapshot query handle for deterministic reads. */
  readonly snapshotQuery: ProjectionSnapshotQuery["Service"];
  /** Live MCP session authority service minted by the trusted-loopback upgrade. */
  readonly authority: McpSessionAuthorityShape;
  /** Polls the real `getSnapshot` RPC until `predicate` holds (default 30s). */
  readonly waitForSnapshot: (
    predicate: (snapshot: OrchestrationReadModel) => boolean,
    timeoutMs?: number,
  ) => Promise<OrchestrationReadModel>;
  /** Polls the real `getSnapshot` RPC until the project exists (and `predicate` holds). */
  readonly waitForProject: (
    projectId: string,
    predicate?: (project: OrchestrationProject) => boolean,
    timeoutMs?: number,
  ) => Promise<OrchestrationProject>;
  /** Polls the real `getSnapshot` RPC until the thread exists (and `predicate` holds). */
  readonly waitForThread: (
    threadId: string,
    predicate?: (thread: OrchestrationThread) => boolean,
    timeoutMs?: number,
  ) => Promise<OrchestrationThread>;
  /** Polls the real `getThreadDetailSnapshot` RPC until the detail read model resolves. */
  readonly waitForThreadDetail: (
    threadId: string,
    timeoutMs?: number,
  ) => Promise<OrchestrationThreadDetailSnapshot>;
  /**
   * Idempotent teardown: closes the WS client, the HTTP/WS server scope, the
   * orchestration reactor scope, the runtime, and (only for a harness-owned
   * temp root) removes the temp root. A reused root/db is preserved.
   */
  readonly dispose: () => Promise<void>;
}

export class WsOrchestrationHarnessError extends Error {
  constructor(message: string, readonly operation: string) {
    super(message);
    this.name = "WsOrchestrationHarnessError";
  }
}

export class WsOrchestrationWaitTimeoutError extends Error {
  constructor(description: string, readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    this.name = "WsOrchestrationWaitTimeoutError";
  }
}

function runGit(cwd: string, args: ReadonlyArray<string>): void {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function initializeGitWorkspace(cwd: string): void {
  // Restart-safe: a reused root may already carry a git-initialized workspace.
  const isRepository = (() => {
    try {
      return (
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        }).trim() === "true"
      );
    } catch {
      return false;
    }
  })();
  if (isRepository) return;
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "v1\n");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const WAIT_POLL_MS = 10;

export async function makeWsOrchestrationHarness(
  options: MakeWsOrchestrationHarnessOptions = {},
): Promise<WsOrchestrationHarness> {
  const provider = options.provider ?? "codex";
  const ownsRootDir = options.reuseRootDir === undefined;
  const rootDir =
    options.reuseRootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "synara-ws-harness-"));
  const homeDir = path.join(rootDir, "home");
  const workspaceDir = path.join(rootDir, "workspace");
  let dbPath: string;
  try {
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    initializeGitWorkspace(workspaceDir);
    const derivedPaths = await Effect.runPromise(
      deriveServerPaths(rootDir, undefined).pipe(Effect.provide(NodeServices.layer)),
    );
    dbPath = options.reuseDbPath ?? derivedPaths.dbPath;
  } catch (cause) {
    // A failure before the runtime exists must not leak a harness-owned root.
    if (ownsRootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    throw cause;
  }

  // ServerConfig with temp home/state: loopback-only, no auth token, port 0.
  // `requiresWebSocketAuthentication` is therefore false and the upgrade path
  // admits the harness client through the trusted-loopback owner branch.
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

  // The ONE substitution: the deterministic test adapter registry. Everything
  // else on the provider side stays the real production graph. The repo's
  // layer convention (and this effect build) wires every member with explicit
  // provide/provideMerge chains — `Layer.mergeAll` members do not see each
  // other's services — so ProviderDiscoveryService gets its own
  // ServerSettings/ServerSecretStore wiring exactly like `makeServerProviderLayer`.
  const adapterHarness = await Effect.runPromise(makeTestProviderAdapterHarness({ provider }));
  const fakeRegistry = Layer.succeed(ProviderAdapterRegistry, {
    getByProvider: (resolvedProvider) =>
      resolvedProvider === adapterHarness.provider
        ? Effect.succeed(adapterHarness.adapter)
        : Effect.fail(new ProviderUnsupportedError({ provider: resolvedProvider })),
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
    Layer.provideMerge(makeSqlitePersistenceLive(dbPath)),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(runtimeLayer);

  const loadService = <A>(service: Effect.Effect<A, never, never>): Promise<A> =>
    runtime.runPromise(service);

  let engine: OrchestrationEngineShape;
  let reactor: OrchestrationReactor["Service"];
  let snapshotQuery: ProjectionSnapshotQuery["Service"];
  let runtimeStartup: ServerRuntimeStartup["Service"];
  let authority: McpSessionAuthorityShape;
  try {
    engine = await loadService(Effect.service(OrchestrationEngineService));
    reactor = await loadService(Effect.service(OrchestrationReactor));
    snapshotQuery = await loadService(Effect.service(ProjectionSnapshotQuery));
    runtimeStartup = await loadService(Effect.service(ServerRuntimeStartup));
    authority = await loadService(Effect.service(McpSessionAuthority));
  } catch (cause) {
    await runtime.dispose().catch(() => undefined);
    if (ownsRootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    throw new WsOrchestrationHarnessError(
      cause instanceof Error ? cause.message : String(cause),
      "loadRuntimeServices",
    );
  }

  // Start the real orchestration reactor (journal -> projection pipeline) and
  // then mark the server command-ready, exactly like `createEffectServer`.
  const reactorScope = await runtime.runPromise(Scope.make("sequential"));
  try {
    await runtime.runPromise(reactor.start.pipe(Scope.provide(reactorScope)));
    await runtime.runPromise(Effect.sleep(10));
    await runtime.runPromise(runtimeStartup.markCommandReady);
  } catch (cause) {
    await runtime
      .runPromise(Scope.close(reactorScope, Exit.void))
      .catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
    if (ownsRootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    throw new WsOrchestrationHarnessError(
      cause instanceof Error ? cause.message : String(cause),
      "startOrchestrationReactor",
    );
  }

  // Mount the production WS route layer over a bounded loopback HTTP server.
  const serverScope = await runtime.runPromise(Scope.make("sequential"));
  let nodeServer: http.Server | null = null;
  try {
    await runtime.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const httpServer = yield* makeBoundedNodeHttpServer(
            () => {
              nodeServer = http.createServer();
              return nodeServer;
            },
            { port: 0, host: "127.0.0.1" },
          );
          const httpApp = yield* HttpRouter.toHttpEffect(websocketRpcRouteLayer);
          yield* httpServer.serve(httpApp);
        }),
        serverScope,
      ),
    );
  } catch (cause) {
    await runtime
      .runPromise(Scope.close(serverScope, Exit.void))
      .catch(() => undefined);
    await runtime
      .runPromise(Scope.close(reactorScope, Exit.void))
      .catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
    if (ownsRootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    throw new WsOrchestrationHarnessError(
      cause instanceof Error ? cause.message : String(cause),
      "httpServerMount",
    );
  }
  const address = nodeServer?.address();
  if (!address || typeof address !== "object" || !Number.isInteger(address.port)) {
    await runtime.runPromise(Scope.close(serverScope, Exit.void)).catch(() => undefined);
    await runtime.runPromise(Scope.close(reactorScope, Exit.void)).catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
    if (ownsRootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    throw new WsOrchestrationHarnessError("Server did not bind a TCP port.", "httpServerListen");
  }
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;

  // Real WebSocket RPC client through the public boundary.
  let client: SynaraWsClient;
  try {
    client = await connectSynaraWsClient(port);
  } catch (cause) {
    await runtime.runPromise(Scope.close(serverScope, Exit.void)).catch(() => undefined);
    await runtime.runPromise(Scope.close(reactorScope, Exit.void)).catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
    if (ownsRootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    throw new WsOrchestrationHarnessError(
      cause instanceof Error ? cause.message : String(cause),
      "connectWsClient",
    );
  }

  const waitForSnapshot: WsOrchestrationHarness["waitForSnapshot"] = async (
    predicate,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ) => {
    const deadline = Date.now() + timeoutMs;
    let last: OrchestrationReadModel | null = null;
    while (true) {
      last = await client.getSnapshot();
      if (predicate(last)) return last;
      if (Date.now() >= deadline) {
        throw new WsOrchestrationWaitTimeoutError("snapshot predicate", timeoutMs);
      }
      await sleep(WAIT_POLL_MS);
    }
  };

  const waitForProject: WsOrchestrationHarness["waitForProject"] = async (
    projectId,
    predicate,
    timeoutMs,
  ) => {
    const snapshot = await waitForSnapshot(
      (current) => {
        const project = current.projects.find((entry) => entry.id === projectId) ?? null;
        return project !== null && (predicate === undefined || predicate(project));
      },
      timeoutMs,
    );
    const project = snapshot.projects.find((entry) => entry.id === projectId)!;
    return project;
  };

  const waitForThread: WsOrchestrationHarness["waitForThread"] = async (
    threadId,
    predicate,
    timeoutMs,
  ) => {
    const snapshot = await waitForSnapshot(
      (current) => {
        const thread = current.threads.find((entry) => entry.id === threadId) ?? null;
        return thread !== null && (predicate === undefined || predicate(thread));
      },
      timeoutMs,
    );
    const thread = snapshot.threads.find((entry) => entry.id === threadId)!;
    return thread;
  };

  const waitForThreadDetail: WsOrchestrationHarness["waitForThreadDetail"] = async (
    threadId,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const detail = await client.getThreadDetailSnapshot(threadId);
      if (detail !== null) return detail;
      if (Date.now() >= deadline) {
        throw new WsOrchestrationWaitTimeoutError(`thread detail '${threadId}'`, timeoutMs);
      }
      await sleep(WAIT_POLL_MS);
    }
  };

  let disposed = false;
  const dispose: WsOrchestrationHarness["dispose"] = async () => {
    if (disposed) return;
    disposed = true;
    const failures: unknown[] = [];
    await client.close().catch((cause) => failures.push(cause));
    await runtime
      .runPromise(Scope.close(serverScope, Exit.void))
      .catch((cause) => failures.push(cause));
    await runtime
      .runPromise(Scope.close(reactorScope, Exit.void))
      .catch((cause) => failures.push(cause));
    await runtime.dispose().catch((cause) => failures.push(cause));
    if (ownsRootDir) {
      try {
        fs.rmSync(rootDir, { recursive: true, force: true });
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0) {
      throw new WsOrchestrationHarnessError(
        failures.map((cause) => (cause instanceof Error ? cause.message : String(cause))).join("; "),
        "dispose",
      );
    }
  };

  return {
    port,
    origin,
    rootDir,
    homeDir,
    workspaceDir,
    dbPath,
    adapterHarness,
    client,
    engine,
    snapshotQuery,
    authority,
    waitForSnapshot,
    waitForProject,
    waitForThread,
    waitForThreadDetail,
    dispose,
  } satisfies WsOrchestrationHarness;
}
