import { Effect, FileSystem, Layer, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { AgentGatewayCredentialsWithSecretsLive } from "../agentGateway/Layers/AgentGatewayCredentials";
import type { McpSessionAuthority } from "../agentGateway/Services/McpSessionAuthority.ts";
import type { SecretStoreError } from "../auth/Services/ServerSecretStore.ts";
import { ServerConfig } from "../config";
import {
  makeProviderServerPasswordResolver,
  ProviderCredentials,
  ProviderCredentialsLive,
} from "../providerCredentials";
import { ServerSettingsLive } from "../serverSettings";
import { makeClaudeAdapterLive } from "./Layers/ClaudeAdapter";
import { makeCodexAdapterLive } from "./Layers/CodexAdapter";
import { makeCursorAdapterLive } from "./Layers/CursorAdapter";
import { makeEventNdjsonLogger } from "./Layers/EventNdjsonLogger";
import { makeAntigravityAdapterLive } from "./Layers/AntigravityAdapter";
import { makeDroidAdapterLive } from "./Layers/DroidAdapter";
import { makeGrokAdapterLive } from "./Layers/GrokAdapter";
import { makeKiloAdapterLive, makeOpenCodeAdapterLive } from "./Layers/OpenCodeAdapter";
import { makePiAdapterLive } from "./Layers/PiAdapter";
import { ProviderAdapterRegistryLive } from "./Layers/ProviderAdapterRegistry";
import { ProviderDiscoveryServiceLive } from "./Layers/ProviderDiscoveryService";
import { makeDurableProviderServiceLive } from "./Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "./Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime";
import { ProviderRuntimeEventRepositoryLive } from "../persistence/Layers/ProviderRuntimeEvents";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository";
import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { PiSubagentParentEffectDispatcher } from "./piSubagentParentEffectDispatcher.ts";

export function makeServerProviderLayer(options: {
  readonly agentGatewayCredentialsLayer?: typeof AgentGatewayCredentialsWithSecretsLive;
  /** Decision 0016 composition-owned late-bound parent-effect dispatcher. */
  readonly completionDispatchBridge?: PiSubagentParentEffectDispatcher;
  /**
   * Decision 21 production composition: the ONE live MCP session authority
   * registry, owned by `makeServerApplicationLayers` and shared with the
   * runtime-services graph. The PiAdapter captures this exact registry at
   * build time so managed admission re-validates the server-minted binding
   * against runtime truth (revocation, expiry, generation, subject/project
   * match). Required on purpose: a provider graph without it fails closed
   * on every managed spawn with the missing-registry diagnostic. Never
   * construct a second registry here — admission must consult the same
   * in-memory registry the gateway/reactor mint, bind, and revoke through.
   */
  readonly mcpSessionAuthorityLayer: Layer.Layer<
    McpSessionAuthority,
    SecretStoreError,
    FileSystem.FileSystem | Path.Path | ServerConfig
  >;
  /**
   * Decision 21 production composition: the ONE live projection snapshot
   * query, the same layer object the runtime-services graph merges. The
   * PiAdapter resolves the genuine server read service at build time; a
   * provider graph without it fails closed with the
   * `server projection snapshot is unavailable` diagnostic. Required so an
   * incomplete production construction is a compile error, not a silent
   * runtime rejection.
   */
  readonly projectionSnapshotQueryLayer: Layer.Layer<
    ProjectionSnapshotQuery,
    never,
    SqlClient.SqlClient
  >;
}) {
  return Effect.gen(function* () {
    const credentials = yield* ProviderCredentials;
    const resolveProviderServerPassword = makeProviderServerPasswordResolver(credentials);
    const { logProviderEvents, providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "native",
        })
      : undefined;
    const canonicalEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "canonical",
        })
      : undefined;
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    // Gives gateway-capable sessions their thread-scoped synara_* credentials.
    // OpenCode/Kilo isolate managed servers before installing MCP; Pi projects
    // the same MCP catalog/dispatcher through its native custom-tool API.
    const agentGatewayCredentialsLayer =
      options.agentGatewayCredentialsLayer ?? AgentGatewayCredentialsWithSecretsLive;
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const openCodeAdapterLayer = makeOpenCodeAdapterLive({
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
      resolveServerPassword: resolveProviderServerPassword,
    }).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const kiloAdapterLayer = makeKiloAdapterLive({
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
      resolveServerPassword: resolveProviderServerPassword,
    }).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const antigravityAdapterLayer = makeAntigravityAdapterLive().pipe(
      Layer.provide(agentGatewayCredentialsLayer),
    );
    const grokAdapterLayer = makeGrokAdapterLive(
      {},
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const droidAdapterLayer = makeDroidAdapterLive(
      {},
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const cursorAdapterLayer = makeCursorAdapterLive(
      {},
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const piAdapterLayer = makePiAdapterLive(
      nativeEventLogger || options.completionDispatchBridge
        ? {
            ...(nativeEventLogger ? { nativeEventLogger } : {}),
            ...(options.completionDispatchBridge
              ? { completionDispatchBridge: options.completionDispatchBridge }
              : {}),
          }
        : undefined,
    ).pipe(
      Layer.provide(agentGatewayCredentialsLayer),
      Layer.provide(PiSubagentExecutionRepositoryLive),
      // Decision 21 shared leaves: the EXACT layer objects the
      // runtime-services graph was composed with. Layer memoization builds
      // them once for the final graph, so the PiAdapter resolves the same
      // in-memory projection snapshot query and the same authority registry
      // the ProviderCommandReactor/AgentGateway bind and revoke through.
      Layer.provide(options.projectionSnapshotQueryLayer),
      Layer.provide(options.mcpSessionAuthorityLayer),
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provide(cursorAdapterLayer),
      Layer.provide(antigravityAdapterLayer),
      Layer.provide(grokAdapterLayer),
      Layer.provide(droidAdapterLayer),
      Layer.provide(kiloAdapterLayer),
      Layer.provide(openCodeAdapterLayer),
      Layer.provide(piAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerServiceLayer = makeDurableProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provide(providerSessionDirectoryLayer),
      Layer.provide(ProviderRuntimeEventRepositoryLive),
    );
    const providerDiscoveryLayer = ProviderDiscoveryServiceLive.pipe(
      Layer.provide(adapterRegistryLayer),
      // Skill toggles live in server settings; the shared ServerSettingsLive
      // layer is memoized so this reuses the instance built at the top level.
      Layer.provide(ServerSettingsLive),
    );
    return Layer.mergeAll(
      providerServiceLayer,
      providerDiscoveryLayer,
      adapterRegistryLayer,
      providerSessionDirectoryLayer,
    );
  }).pipe(Effect.provide(ProviderCredentialsLive.pipe(Layer.orDie)), Layer.unwrap);
}
