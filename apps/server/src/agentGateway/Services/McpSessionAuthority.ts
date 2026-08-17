import type { DateTime } from "effect";
import { ServiceMap } from "effect";

import type {
  McpAuthorityBinding,
  McpDispatchBindingOptions,
  McpSessionAuthorityRecord,
  McpSessionAuthorityRegistryShape,
} from "../mcpSessionAuthority.ts";

/** Persisted installation-scoped name for the opaque local-owner principal. */
export const MCP_AUTHORITY_LOCAL_OWNER_SECRET_NAME = "synara-mcp-local-owner-principal";

export interface McpSessionAuthorityShape extends McpSessionAuthorityRegistryShape {
  /**
   * Mint a fresh authority record for a trusted loopback connection. The
   * subject is the server-minted opaque local-owner principal, never accepted
   * from payloads, headers, provider state, or any client-controlled surface.
   */
  readonly mintForLocalOwner: () => McpSessionAuthorityRecord;
  /**
   * Mint a fresh authority record for an authenticated session from the
   * verified `AuthenticatedSession` at the trusted WS upgrade boundary.
   */
  readonly mintForAuthenticated: (session: {
    readonly sessionId: string;
    readonly subject: string;
    readonly expiresAt?: DateTime.DateTime | null;
  }) => McpSessionAuthorityRecord;
  /** Convenience used by gateway-side admission. */
  readonly bindingFor: (
    authorityId: string,
    options: McpDispatchBindingOptions,
  ) => McpAuthorityBinding | null;
}

export class McpSessionAuthority extends ServiceMap.Service<
  McpSessionAuthority,
  McpSessionAuthorityShape
>()("synara/agentGateway/Services/McpSessionAuthority") {}
