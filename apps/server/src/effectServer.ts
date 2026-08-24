import http from "node:http";

import type { ProjectId, ServerSettingsError } from "@synara/contracts";
import { Effect, Exit, FileSystem, Layer, Path, Schema, Scope, ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { agentGatewayRouteLayer } from "./agentGateway/httpRoute";
import { AgentGatewayCredentials } from "./agentGateway/Services/AgentGatewayCredentials";
import { AutomationRunReactor } from "./automation/Services/AutomationRunReactor";
import { AutomationScheduler } from "./automation/Services/AutomationScheduler";
import { AutomationService } from "./automation/Services/AutomationService";
import {
  clearPersistedServerRuntimeState,
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "./serverRuntimeState";
import { remoteAccessPolicyError, ServerConfig } from "./config";
import { resolveListeningPort } from "./startupAccess";
import { patchBunWebSocketCloseEventCompatibility } from "./bunWebSocketCompatibility";
import { makeEffectHttpRouteLayer } from "./http";
import { Keybindings } from "./keybindings";
import {
  ManagedAttachmentCleanup,
  type ManagedAttachmentCleanupShape,
} from "./managedAttachmentCleanup";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./orchestration/Services/OrchestrationEngine";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ThreadDeletionReactor } from "./orchestration/Services/ThreadDeletionReactor";
import { reconcileRestartStuckTurns } from "./orchestration/startupTurnReconciliation";
import { recoverSynaraMcpPendingOperations } from "./orchestration/synaraMcpStartupRecovery";
import { ProviderSessionReaper } from "./provider/Services/ProviderSessionReaper";
import { ProviderRuntimeReconciler } from "./provider/Services/ProviderRuntimeReconciler";
import { ProviderService, type ProviderServiceShape } from "./provider/Services/ProviderService";
import {
  ProjectWorkspaceMigrationCoordinator,
  type ProjectWorkspaceMigrationCoordinatorShape,
} from "./projectWorkspace/projectWorkspaceMigrationCoordinator";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { makeServerReadiness } from "./server/readiness";
import { makeServerShutdownController, type ServerShutdownController } from "./serverShutdown";
import { makeBoundedNodeHttpServer } from "./nodeHttpServer";
import { websocketRpcRouteLayer } from "./wsRpc";
import { recoverGitHandoffOperations } from "./gitHandoffOperations";
import { externalMcpRouteLayer } from "./externalMcp/httpRoute";
import { ExternalMcpGateway } from "./externalMcp/Services/ExternalMcpGateway";
import { ExternalMcpService } from "./externalMcp/Services/ExternalMcpService";

export interface ServerShape {
  readonly start: Effect.Effect<
    http.Server,
    ServerLifecycleError | ServerSettingsError,
    | Scope.Scope
    | ServerConfig
    | AgentGatewayCredentials
    | ExternalMcpGateway
    | ExternalMcpService
    | FileSystem.FileSystem
    | Path.Path
    | Keybindings
    | ManagedAttachmentCleanup
    | AutomationRunReactor
    | AutomationScheduler
    | AutomationService
    | ServerLifecycleEvents
    | OrchestrationEngineService
    | OrchestrationReactor
    | ProjectionSnapshotQuery
    | ProjectWorkspaceMigrationCoordinator
    | ProviderSessionReaper
    | ProviderRuntimeReconciler
    | ProviderService
    | ServerRuntimeStartup
    | ServerSettingsService
    | ThreadDeletionReactor
    | SqlClient.SqlClient
  >;
  readonly stopSignal: Effect.Effect<void, never>;
}

export class Server extends ServiceMap.Service<Server, ServerShape>()(
  "synara/effectServer/Server",
) {}

export class ServerLifecycleError extends Schema.TaggedErrorClass<ServerLifecycleError>()(
  "ServerLifecycleError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ProjectWorkspaceMigrationStartupInput {
  /** The composed production coordinator (WP3). */
  readonly coordinator: ProjectWorkspaceMigrationCoordinatorShape;
}

/** Startup outcome of the Project workspace staged publication pass. */
export interface ProjectWorkspaceMigrationStartupOutcome {
  readonly published: ReadonlyArray<ProjectId>;
  readonly kept: ReadonlyArray<ProjectId>;
  readonly failed: ReadonlyArray<{ readonly projectId: ProjectId; readonly reason: string }>;
}

/**
 * Run the per-Project staged workspace publication once at startup.
 *
 * Never fails: a per-Project failure is collected as a diagnostic and logged
 * — the server stays command-ready and the next start retries that Project
 * from the same deterministic derivation (Decision 0002 F.6/F.8). Extracted
 * as its own exported function so the startup ordering and the nonblocking
 * contract are testable without booting the full server graph.
 */
export function runProjectWorkspaceMigrationOnStartup(
  input: ProjectWorkspaceMigrationStartupInput,
): Effect.Effect<ProjectWorkspaceMigrationStartupOutcome> {
  return Effect.gen(function* () {
    const results = yield* input.coordinator.migrateAllProjects({
      legacySlicesByThreadId: new Map(),
    });
    const published: ProjectId[] = [];
    const kept: ProjectId[] = [];
    const failed: Array<{ readonly projectId: ProjectId; readonly reason: string }> = [];
    for (const result of results) {
      if (result.outcome.kind === "published") {
        published.push(result.projectId);
      } else if (result.outcome.kind === "kept-published") {
        kept.push(result.projectId);
      } else {
        failed.push({ projectId: result.projectId, reason: result.outcome.reason });
      }
    }
    if (failed.length > 0) {
      yield* Effect.logWarning(
        "Project workspace migration left Projects unpublished and retryable",
        {
          failed: failed.map((entry) => `${entry.projectId}:${entry.reason}`).join(","),
        },
      );
    }
    return { published, kept, failed };
  });
}

export function closeServerRuntimePipeline(input: {
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "quiesce" | "drain" | "stop">;
  readonly providerService: Pick<ProviderServiceShape, "closeRuntimeEvents">;
  readonly managedAttachmentCleanup: Pick<ManagedAttachmentCleanupShape, "drain">;
  readonly subscriptionsScope: Scope.Closeable;
}): Effect.Effect<void> {
  return input.orchestrationEngine.quiesce.pipe(
    // Drain already-admitted commands while every subscriber is live. Provider
    // close then fences terminal runtime events into subscriber workers; scope
    // close drains those workers before the engine accepts its final stop.
    Effect.andThen(input.orchestrationEngine.drain),
    Effect.andThen(input.providerService.closeRuntimeEvents),
    Effect.andThen(Scope.close(input.subscriptionsScope, Exit.void)),
    Effect.andThen(input.managedAttachmentCleanup.drain),
    Effect.andThen(input.orchestrationEngine.stop),
  );
}

export const createEffectServer = Effect.fn(function* (
  shutdownController: ServerShutdownController,
) {
  const config = yield* ServerConfig;
  const remotePolicyError = remoteAccessPolicyError(config);
  if (remotePolicyError) {
    return yield* new ServerLifecycleError({
      operation: "validateRemoteAccessPolicy",
      cause: new Error(remotePolicyError),
    });
  }
  const agentGatewayCredentials = yield* AgentGatewayCredentials;
  const automationRunReactor = yield* AutomationRunReactor;
  const automationScheduler = yield* AutomationScheduler;
  const keybindings = yield* Keybindings;
  const managedAttachmentCleanup = yield* ManagedAttachmentCleanup;
  const lifecycleEvents = yield* ServerLifecycleEvents;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const orchestrationReactor = yield* OrchestrationReactor;
  const providerService = yield* ProviderService;
  const providerSessionReaper = yield* ProviderSessionReaper;
  const providerRuntimeReconciler = yield* ProviderRuntimeReconciler;
  const projectWorkspaceMigrationCoordinator = yield* ProjectWorkspaceMigrationCoordinator;
  const runtimeStartup = yield* ServerRuntimeStartup;
  const serverSettings = yield* ServerSettingsService;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const readiness = yield* makeServerReadiness;

  yield* keybindings.syncDefaultKeybindingsOnStartup.pipe(
    Effect.catch((error) =>
      Effect.logWarning("failed to sync keybindings defaults on startup", {
        path: error.configPath,
        detail: error.detail,
        cause: error.cause,
      }),
    ),
  );
  yield* serverSettings.start;
  yield* readiness.markPushBusReady;
  yield* readiness.markKeybindingsReady;

  let nodeServer: http.Server | null = null;
  patchBunWebSocketCloseEventCompatibility();
  // Keep embedded/test callers safe if they construct ServerConfig without
  // passing through the CLI's loopback-default resolution.
  const listenOptions = { host: config.host ?? "127.0.0.1", port: config.port };
  const httpServer = yield* makeBoundedNodeHttpServer(() => {
    nodeServer = http.createServer();
    return nodeServer;
  }, listenOptions).pipe(
    Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerListen", cause })),
  );

  const routesLayer = Layer.mergeAll(
    makeEffectHttpRouteLayer(readiness, shutdownController),
    websocketRpcRouteLayer,
    agentGatewayRouteLayer,
    externalMcpRouteLayer,
  );
  const httpApp = yield* HttpRouter.toHttpEffect(routesLayer);
  yield* httpServer
    .serve(httpApp)
    .pipe(
      Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerServe", cause })),
    );

  const listeningPort = resolveListeningPort(
    (nodeServer as http.Server | null)?.address() ?? null,
    config.port,
  );
  agentGatewayCredentials.setListeningPort(listeningPort);
  yield* persistServerRuntimeState({
    path: config.serverRuntimeStatePath,
    state: makePersistedServerRuntimeState({
      config,
      port: listeningPort,
    }),
  }).pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "persistServerRuntimeState", cause }),
    ),
  );
  yield* Effect.addFinalizer(() => clearPersistedServerRuntimeState(config.serverRuntimeStatePath));
  yield* readiness.markHttpListening;

  const subscriptionsScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() =>
    closeServerRuntimePipeline({
      orchestrationEngine,
      providerService,
      managedAttachmentCleanup,
      subscriptionsScope,
    }),
  );
  yield* Scope.provide(orchestrationReactor.start, subscriptionsScope);
  yield* Scope.provide(automationScheduler.start(), subscriptionsScope);
  yield* Scope.provide(automationRunReactor.start(), subscriptionsScope);
  yield* Scope.provide(threadDeletionReactor.start(), subscriptionsScope);
  yield* Scope.provide(providerSessionReaper.start(), subscriptionsScope);
  yield* Scope.provide(providerRuntimeReconciler.start(), subscriptionsScope);
  yield* readiness.markOrchestrationSubscriptionsReady;
  yield* readiness.markTerminalSubscriptionsReady;
  // Heal turns orphaned by the previous process exit (their in-memory runtimes
  // died, so they can never complete on their own) before clients can observe
  // the stale "Working" state.
  yield* reconcileRestartStuckTurns;
  // The reconciliation above terminalizes durable turn projections without a
  // provider terminal event. Remove their replay-ledger rows now so the next
  // process start cannot replay state-dependent commands against the terminal
  // projection.
  yield* orchestrationReactor.reconcileSettledOpenTurns;
  yield* recoverGitHandoffOperations((command) => orchestrationEngine.dispatch(command)).pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "recoverGitHandoffOperations", cause }),
    ),
  );
  // impl-09 AC1: startup recovery of pending Synara MCP activation operations.
  // Runs after the projection bootstrap and before markCommandReady, so the
  // server is never command-ready (or marked ready for clients) with an
  // unsettled pending operation. Recovery settles every durable pending
  // operation from its persisted deadline with ZERO provider/MCP replay
  // (pending enable rolls back failed-disabled because the pre-restart
  // runtimes are gone; pending disable converges safely disabled), and a
  // legacy pending operation without a recovery identity blocks startup with
  // a bounded diagnostic instead of being recovered blindly.
  yield* Effect.tryPromise(() =>
    recoverSynaraMcpPendingOperations({
      seams: {
        now: () => new Date(),
        getReadModel: () => Effect.runPromise(orchestrationEngine.getReadModel()),
        dispatch: (command) => Effect.runPromise(orchestrationEngine.dispatch(command)),
      },
    }),
  ).pipe(
    Effect.flatMap((result) =>
      result.kind === "blocked"
        ? Effect.fail(
            new ServerLifecycleError({
              operation: "recoverSynaraMcpPendingOperations",
              cause: new Error(result.detail),
            }),
          )
        : Effect.succeed(result.operations),
    ),
    Effect.tap((operations) =>
      operations.length === 0
        ? Effect.void
        : Effect.logWarning("Synara MCP startup recovery settled pending operations", {
            operations: operations
              .map(
                (operation) =>
                  `${operation.projectId}:${operation.requestId}->${operation.terminal}`,
              )
              .join(","),
          }),
    ),
    Effect.mapError(
      (cause) =>
        new ServerLifecycleError({ operation: "recoverSynaraMcpPendingOperations", cause }),
    ),
  );
  // WP3 production wiring (Decision 0002 F): stage and publish every
  // Project-owned workspace boundary BEFORE command-ready so the first client
  // that observes the advertised `project.right-sidebar-workspace` capability
  // can only ever read a fully published target — never a partial stage. The
  // server's durable truth is its own Thread/Project projection; the v1 legacy
  // workspace slices live in web/desktop storage, so the server boundary runs
  // with an empty legacy-slice map: every Thread is ineligible and the plan
  // publishes the canonical empty workspace per Project (Decision 0002 C.5).
  // The boundary is idempotent (`keep-published` never rewrites) and each
  // Project is independent; a per-Project failure is a logged diagnostic that
  // stays retryable (next start reruns the same deterministic derivation) —
  // it never blocks server readiness and never touches v1 rows or cleanup.
  yield* runProjectWorkspaceMigrationOnStartup({
    coordinator: projectWorkspaceMigrationCoordinator,
  });
  yield* runtimeStartup.markCommandReady;

  yield* lifecycleEvents.publish({
    type: "welcome",
    payload: {
      cwd: config.cwd,
      homeDir: config.homeDir,
      chatWorkspaceRoot: config.chatWorkspaceRoot,
      studioWorkspaceRoot: config.studioWorkspaceRoot,
      projectName: config.cwd.split(/[\\/]/).findLast(Boolean) ?? config.cwd,
    },
  });
  yield* lifecycleEvents.publish({
    type: "ready",
    payload: { at: new Date().toISOString() },
  });

  if (!nodeServer) {
    return yield* new ServerLifecycleError({ operation: "httpServerListen" });
  }
  return nodeServer as http.Server;
});

export const ServerLive = Layer.effect(
  Server,
  Effect.gen(function* () {
    const shutdownController = yield* makeServerShutdownController();
    return {
      start: createEffectServer(shutdownController) as ServerShape["start"],
      stopSignal: shutdownController.stopSignal,
    } satisfies ServerShape;
  }),
);
