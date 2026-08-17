/**
 * McpSessionAuthority - server-side source of truth for authenticated MCP
 * authority, per Decision 21 (authenticated MCP session authority).
 *
 * One session-local authority record is created at trusted session
 * establishment (authenticated subject or server-minted local-owner
 * principal). Credentials issued into the shared Agent Gateway MCP admission
 * boundary carry a `McpAuthorityBinding` snapshot that is only valid while the
 * owning record stays active and unexpired.
 *
 * The registry also keeps server-written dispatch indices (`commandId` and
 * `threadId` → `authorityId`). These are the trusted propagation channel from
 * a dispatch site to the provider reactor; no subject or identity is ever
 * persisted into orchestration commands or events.
 *
 * @module agentGateway
 */
import { randomUUID } from "node:crypto";

export type McpAuthorityKind = "authenticated" | "local-owner";

export type McpAuthorityStatus = "active" | "revoked" | "expired";

export interface McpSessionAuthorityRecord {
  readonly authorityId: string;
  /** Canonical trusted principal (AuthenticatedSession.subject or local-owner). */
  readonly subject: string;
  readonly kind: McpAuthorityKind;
  /** AuthenticatedSession.sessionId; null for trusted loopback records. */
  readonly authSessionId: string | null;
  /** Epoch ms; null means the authentication never expires (local-owner). */
  readonly authExpiresAt: number | null;
  readonly issuedAt: number;
  readonly sessionGeneration: string;
  readonly status: McpAuthorityStatus;
  readonly revokedAt: number | null;
  readonly revokedReason: string | null;
}

/**
 * Non-secret snapshot carried by a gateway credential. The complete authority
 * record stays server-side; credentials must resolve back through
 * `authorityId` at admission.
 */
export interface McpAuthorityBinding {
  readonly authorityId: string;
  readonly subject: string;
  readonly kind: McpAuthorityKind;
  readonly authSessionId: string | null;
  readonly authExpiresAt: number | null;
  readonly issuedAt: number;
  /** Epoch ms; credentials age out independently of the auth session. */
  readonly credentialExpiresAt: number;
  readonly sessionGeneration: string;
  readonly lifecycleGeneration: string | null;
  readonly projectId: string | null;
}

export interface McpDispatchBindingOptions {
  readonly threadId: string;
  readonly provider: string;
  readonly projectId: string | null;
  readonly lifecycleGeneration: string | null;
  readonly credentialTtlMs: number;
}

/**
 * Deterministic fail-closed admission failure for one credential binding at
 * the shared Agent Gateway MCP admission boundary (Decision 21 / AC2). A
 * denial is derived only from server-side registry state plus the snapshot the
 * credential itself carries; it never consults request-supplied identity.
 */
export type McpAuthorityAdmissionFailure =
  | "missing-binding"
  | "unknown-authority"
  | "revoked"
  | "expired-auth"
  | "expired-credential"
  | "invalid-issuance"
  | "stale-session-generation"
  | "stale-lifecycle-generation"
  | "subject-mismatch"
  | "kind-mismatch"
  | "project-mismatch";

export interface McpAuthorityAdmissionContext {
  /** Trusted project of the invoking thread; null when not resolvable. */
  readonly projectId: string | null;
  /**
   * Trusted current MCP lifecycle generation of the owning runtime, when the
   * admission site can observe it (Decision 21 item 4). Omitted or null means
   * "unknown", so this arm is skipped; the transport only supplies it once the
   * lifecycle coordinator wires current generation state (impl-04 WP3).
   */
  readonly lifecycleGeneration?: string | null;
}

export interface McpSessionAuthorityRegistryShape {
  /** Mint one session-local authority record from trusted server context. */
  readonly mint: (input: {
    readonly subject: string;
    readonly kind: McpAuthorityKind;
    readonly authSessionId?: string | null;
    readonly authExpiresAt?: number | null;
  }) => McpSessionAuthorityRecord;
  readonly get: (authorityId: string) => McpSessionAuthorityRecord | undefined;
  /** Revoke a record; idempotent, returns whether the record existed. */
  readonly revoke: (authorityId: string, reason?: string) => boolean;
  /**
   * Resolve the complete credential binding for one active record, or null
   * when the record is missing, revoked, expired, or would outlive its
   * authentication.
   */
  readonly bindingFor: (
    authorityId: string,
    options: McpDispatchBindingOptions,
  ) => McpAuthorityBinding | null;
  /**
   * Fail-closed admission check for one credential binding (AC2). Returns the
   * deterministic denial reason, or null when the binding is currently
   * admittable against trusted registry state. Missing bindings are the
   * caller's `"missing-binding"` outcome.
   */
  readonly assertAdmittable: (
    binding: McpAuthorityBinding,
    context?: McpAuthorityAdmissionContext,
  ) => McpAuthorityAdmissionFailure | null;
  /** Server-side dispatch binding: commandId → authorityId (capped + TTL-pruned). */
  readonly bindDispatch: (commandId: string, authorityId: string) => boolean;
  /** Server-side thread binding: threadId → authorityId (capped + TTL-pruned). */
  readonly bindThread: (threadId: string, authorityId: string) => boolean;
  /** Resolve a turn's authority: exact command binding, else thread binding. */
  readonly resolveForCommand: (
    commandId: string,
    threadId: string,
  ) => McpSessionAuthorityRecord | undefined;
  /**
   * Resolve only the current trusted server-written thread binding. Used by
   * resume/recovery sites that have no dispatch command (provider-session
   * rotation restarts), so they never reuse a stale credential or invent an
   * identity; the thread binding itself is written only at trusted dispatch.
   */
  readonly resolveForThread: (threadId: string) => McpSessionAuthorityRecord | undefined;
}

export const MCP_AUTHORITY_ID_PREFIX = "mcp-authority-";

/**
 * Default lifetime of a credential binding snapshot minted from an authority
 * record before it is re-issued at the next session start (Decision 21).
 * Credentials are additionally clamped to their bound authentication expiry,
 * and admission re-validates the owning record at request time.
 */
export const MCP_AUTHORITY_CREDENTIAL_TTL_MS = 60 * 60 * 1_000;

const DEFAULT_MAX_DISPATCH_BINDINGS = 300;
const DEFAULT_DISPATCH_BINDING_TTL_MS = 60 * 60 * 1_000;

export function makeMcpSessionAuthorityRegistry(
  options: {
    readonly now?: () => number;
    readonly randomId?: () => string;
    readonly maxDispatchBindings?: number;
    readonly dispatchBindingTtlMs?: number;
  } = {},
): McpSessionAuthorityRegistryShape {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;
  const maxDispatchBindings = options.maxDispatchBindings ?? DEFAULT_MAX_DISPATCH_BINDINGS;
  const dispatchBindingTtlMs = options.dispatchBindingTtlMs ?? DEFAULT_DISPATCH_BINDING_TTL_MS;

  const records = new Map<string, McpSessionAuthorityRecord>();
  // Insertion-ordered so the oldest entries are evicted first when capped.
  const commandAuthority = new Map<string, { readonly authorityId: string; writtenAt: number }>();
  const threadAuthority = new Map<string, { readonly authorityId: string; writtenAt: number }>();

  const recordIsAdmittable = (record: McpSessionAuthorityRecord, at: number): boolean =>
    record.status === "active" && (record.authExpiresAt === null || record.authExpiresAt > at);

  const pruneIndex = (index: Map<string, { authorityId: string; writtenAt: number }>) => {
    const cutoff = now() - dispatchBindingTtlMs;
    for (const [key, entry] of index) {
      if (entry.writtenAt < cutoff) index.delete(key);
    }
  };

  const writeIndex = (
    index: Map<string, { authorityId: string; writtenAt: number }>,
    key: string,
    authorityId: string,
  ): boolean => {
    const record = records.get(authorityId);
    if (record === undefined) return false;
    pruneIndex(index);
    index.set(key, { authorityId, writtenAt: now() });
    while (index.size > maxDispatchBindings) {
      const oldest = index.keys().next().value;
      if (oldest === undefined) break;
      index.delete(oldest);
    }
    return true;
  };

  const assertAdmittable: McpSessionAuthorityRegistryShape["assertAdmittable"] = (
    binding,
    context,
  ) => {
    const record = records.get(binding.authorityId);
    if (record === undefined) return "unknown-authority";
    const at = now();
    if (record.status === "revoked") return "revoked";
    if (record.status === "expired") return "expired-auth";
    if (record.authExpiresAt !== null && record.authExpiresAt <= at) {
      return "expired-auth";
    }
    // A snapshot cannot be issued by the trusted server after admission time.
    if (binding.issuedAt > at) return "invalid-issuance";
    if (binding.credentialExpiresAt <= at) return "expired-credential";
    if (record.sessionGeneration !== binding.sessionGeneration) {
      return "stale-session-generation";
    }
    if (
      context?.lifecycleGeneration != null &&
      binding.lifecycleGeneration !== context.lifecycleGeneration
    ) {
      return "stale-lifecycle-generation";
    }
    if (record.subject !== binding.subject) return "subject-mismatch";
    if (record.kind !== binding.kind) return "kind-mismatch";
    if (record.authSessionId !== binding.authSessionId) return "subject-mismatch";
    if (
      binding.projectId !== null &&
      context?.projectId != null &&
      binding.projectId !== context.projectId
    ) {
      return "project-mismatch";
    }
    return null;
  };

  return {
    mint: ({ subject, kind, authSessionId = null, authExpiresAt = null }) => {
      const issuedAt = now();
      const record: McpSessionAuthorityRecord = {
        authorityId: `${MCP_AUTHORITY_ID_PREFIX}${randomId()}`,
        subject,
        kind,
        authSessionId,
        authExpiresAt,
        issuedAt,
        sessionGeneration: `gen-${randomId()}`,
        status: authExpiresAt !== null && authExpiresAt <= issuedAt ? "expired" : "active",
        revokedAt: null,
        revokedReason: null,
      };
      records.set(record.authorityId, record);
      return record;
    },
    get: (authorityId) => records.get(authorityId),
    revoke: (authorityId, reason = "revoked") => {
      const record = records.get(authorityId);
      if (record === undefined) return false;
      if (record.status === "active") {
        records.set(authorityId, {
          ...record,
          status: "revoked",
          revokedAt: now(),
          revokedReason: reason,
        });
      }
      return true;
    },
    bindingFor: (authorityId, options) => {
      const record = records.get(authorityId);
      const at = now();
      if (record === undefined || !recordIsAdmittable(record, at)) return null;
      // A credential must never outlive the authentication it is bound to.
      if (record.authExpiresAt !== null && record.authExpiresAt <= at + options.credentialTtlMs) {
        return null;
      }
      return {
        authorityId: record.authorityId,
        subject: record.subject,
        kind: record.kind,
        authSessionId: record.authSessionId,
        authExpiresAt: record.authExpiresAt,
        issuedAt: record.issuedAt,
        credentialExpiresAt: at + options.credentialTtlMs,
        sessionGeneration: record.sessionGeneration,
        lifecycleGeneration: options.lifecycleGeneration,
        projectId: options.projectId,
      } satisfies McpAuthorityBinding;
    },
    assertAdmittable,
    bindDispatch: (commandId, authorityId) => writeIndex(commandAuthority, commandId, authorityId),
    bindThread: (threadId, authorityId) => writeIndex(threadAuthority, threadId, authorityId),
    resolveForCommand: (commandId, threadId) => {
      const byCommand = commandAuthority.get(commandId);
      const authorityId = byCommand?.authorityId ?? threadAuthority.get(threadId)?.authorityId;
      return authorityId === undefined ? undefined : records.get(authorityId);
    },
    resolveForThread: (threadId) => {
      const authorityId = threadAuthority.get(threadId)?.authorityId;
      return authorityId === undefined ? undefined : records.get(authorityId);
    },
  };
}
