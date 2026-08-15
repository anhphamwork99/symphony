/**
 * Deterministic MCP session authority test fixtures (Decision 21).
 *
 * Test-only support for existing runtime/adapter fixtures. It mirrors the two
 * established precedents (`ProviderCommandReactor.test.ts`
 * `makeTestMcpSessionAuthorityShape` and `AgentGateway.test.ts`
 * `bindingForToken`) so fixture code can hand `startSession` the same
 * server-minted, subject-bound authority snapshot that production derives at
 * trusted dispatch (`wsRpc.ts` `bindDispatch`/`bindThread` →
 * `resolveForCommand` → `bindingFor`). Ids are injected, so every
 * authorityId, session generation, and binding is deterministic within one
 * fixture instance.
 *
 * The fixture never weakens fail-closed authority validation: it only mints
 * records into an in-memory registry and binds them to the exact fixture
 * thread, exactly as the trusted server would. Admission still requires the
 * owning record to be active and unexpired, and a session started without a
 * binding still gets no gateway credential (the production lease seam fails
 * closed on its own).
 *
 * @module agentGateway
 */
import { DateTime } from "effect";
import type { ProviderKind } from "@synara/contracts";

import {
  makeMcpSessionAuthorityRegistry,
  type McpAuthorityBinding,
  type McpSessionAuthorityRegistryShape,
} from "./mcpSessionAuthority.ts";
import type { McpSessionAuthorityShape } from "./Services/McpSessionAuthority.ts";

/** Credential snapshot TTL used by fixture bindings (well inside TTL during tests). */
const FIXTURE_CREDENTIAL_TTL_MS = 300_000;

export interface TestMcpSessionAuthorityFixture {
  /** Bare registry, for direct `bindDispatch`/`bindThread` assertions. */
  readonly registry: McpSessionAuthorityRegistryShape;
  /** Full service shape (registry + `mintForLocalOwner`/`mintForAuthenticated`). */
  readonly shape: McpSessionAuthorityShape;
  /**
   * Mint (or reuse) a local-owner authority record owned by the given thread
   * and return its admittable credential binding, as production derives at
   * trusted dispatch. Cached per thread so repeated session starts inside one
   * test observe the same record/binding.
   */
  readonly bindingForThread: (input: {
    readonly threadId: string;
    readonly provider: ProviderKind;
    readonly projectId?: string | null;
  }) => McpAuthorityBinding;
}

export function makeTestMcpSessionAuthorityFixture(options?: {
  readonly subject?: string;
}): TestMcpSessionAuthorityFixture {
  const subject = options?.subject ?? "local-owner:test";
  let nextAuthorityId = 0;
  const registry = makeMcpSessionAuthorityRegistry({
    randomId: () => `test-authority-${++nextAuthorityId}`,
  });
  const shape: McpSessionAuthorityShape = {
    ...registry,
    mintForLocalOwner: () =>
      registry.mint({
        subject,
        kind: "local-owner",
        authSessionId: null,
        authExpiresAt: null,
      }),
    mintForAuthenticated: (session) =>
      registry.mint({
        subject: session.subject,
        kind: "authenticated",
        authSessionId: session.sessionId,
        authExpiresAt: session.expiresAt ? DateTime.toEpochMillis(session.expiresAt) : null,
      }),
  };
  const bindingByThread = new Map<string, McpAuthorityBinding>();
  const bindingForThread: TestMcpSessionAuthorityFixture["bindingForThread"] = ({
    threadId,
    provider,
    projectId = null,
  }) => {
    const cached = bindingByThread.get(threadId);
    if (cached !== undefined) return cached;
    const record = shape.mintForLocalOwner();
    registry.bindThread(threadId, record.authorityId);
    const binding = registry.bindingFor(record.authorityId, {
      threadId,
      provider,
      projectId,
      lifecycleGeneration: null,
      credentialTtlMs: FIXTURE_CREDENTIAL_TTL_MS,
    });
    if (binding === null) throw new Error("Expected an admittable fixture authority binding");
    bindingByThread.set(threadId, binding);
    return binding;
  };
  return { registry, shape, bindingForThread };
}
