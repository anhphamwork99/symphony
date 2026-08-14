/**
 * McpSessionAuthorityLive - live layer for the MCP session authority registry.
 *
 * The opaque local-owner principal is read from the persisted
 * `ServerSecretStore` (`getOrCreateRandom`), so it is stable across reconnects
 * and server restarts while remaining unguessable and installation-scoped. It
 * is minted exclusively here and never serialized into client-controlled state.
 *
 * @module agentGateway/Layers/McpSessionAuthority
 */
import { Buffer } from "node:buffer";

import { DateTime, Effect, Layer } from "effect";

import { ServerSecretStore, SecretStoreError } from "../../auth/Services/ServerSecretStore.ts";
import { makeMcpSessionAuthorityRegistry } from "../mcpSessionAuthority.ts";
import {
  MCP_AUTHORITY_LOCAL_OWNER_SECRET_NAME,
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../Services/McpSessionAuthority.ts";

export const makeMcpSessionAuthorityLive: Effect.Effect<
  McpSessionAuthorityShape,
  SecretStoreError,
  ServerSecretStore
> = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore;
  const registry = makeMcpSessionAuthorityRegistry();

  const principalBytes = yield* secretStore.getOrCreateRandom(
    MCP_AUTHORITY_LOCAL_OWNER_SECRET_NAME,
    32,
  );
  const localOwnerSubject = `local-owner:${Buffer.from(principalBytes).toString("base64url")}`;

  const mintForLocalOwner = () =>
    registry.mint({
      subject: localOwnerSubject,
      kind: "local-owner",
      authSessionId: null,
      authExpiresAt: null,
    });

  const mintForAuthenticated: McpSessionAuthorityShape["mintForAuthenticated"] = (session) =>
    registry.mint({
      subject: session.subject,
      kind: "authenticated",
      authSessionId: session.sessionId,
      authExpiresAt: session.expiresAt ? DateTime.toEpochMillis(session.expiresAt) : null,
    });

  return {
    ...registry,
    mintForLocalOwner,
    mintForAuthenticated,
  };
});

export const McpSessionAuthorityLive = Layer.effect(
  McpSessionAuthority,
  makeMcpSessionAuthorityLive,
);
